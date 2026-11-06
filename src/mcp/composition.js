/**
 * Composition root of the MCP layer. Called once from the core composition root; returns the `mcp`
 * object exposed on the container (`container.mcp`).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { uuidv7 } from './domain/uid.js';
import { loadKeyPepper } from './infrastructure/secrets.js';
import { ApiKeyRepository, AuditLogRepository } from './infrastructure/sqlite/api-key-repository.js';
import { SchemaRegistryRepository } from './infrastructure/sqlite/schema-registry-repository.js';
import { ContentHashStore } from './infrastructure/sqlite/content-hash-store.js';
import { ApiKeyService } from './application/api-key-service.js';
import { DesignReadRepository } from './infrastructure/sqlite/design-read-repository.js';
import { DesignQueryService } from './application/design-query-service.js';
import { BundleService } from './application/bundle-service.js';
import { RateLimiter } from './server/rate-limiter.js';
import { McpProtocol } from './server/protocol.js';
import { createMcpHttpHandler } from './server/http.js';
import { AiArtifactRepository } from './infrastructure/sqlite/ai-artifact-repository.js';
import { AiPackService } from './application/ai-pack-service.js';
import { VersionRepository } from './infrastructure/sqlite/version-repository.js';
import { VersionService } from './application/version-service.js';
import { ChangesetService } from './application/changeset-service.js';
import { ProjectLibraryService } from './application/project-library-service.js';
import { ItemRequestService } from './application/item-request-service.js';
import { BindingService } from './application/binding-service.js';
import { AGENT_USERNAME } from './domain/agent-user.js';

/** Per-key limits (doc §15). Override with `limits` for tests or bigger installations. */
export const DEFAULT_LIMITS = {
  calls: { limit: 120, windowMs: 60_000 },
  bundles: { limit: 10, windowMs: 3_600_000 }
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function buildMcpModule({ db, dbFile, projects, users, auth, transaction, now, services, workflows, exporter, settings, collaboration, parseSvg, pollMs, limits = DEFAULT_LIMITS, allowedOrigins = [] }) {
  const { pepper, source: pepperSource } = loadKeyPepper(dbFile);
  const hashKey = plaintext => createHmac('sha256', pepper).update(plaintext).digest('hex');

  const apiKeys = new ApiKeyService({
    keys: new ApiKeyRepository(db),
    audit: new AuditLogRepository(db),
    projects,
    users,
    auth,
    hashKey,
    safeEqual,
    randomBytes,
    newUid: () => uuidv7(randomBytes),
    transaction,
    ...(now ? { now } : {})
  });

  const schemaRegistry = new SchemaRegistryRepository(db);
  const contentHashes = new ContentHashStore(db);
  const agentUserId = () => db.prepare('SELECT id FROM users WHERE username = ?').get(AGENT_USERNAME)?.id ?? 1;
  const out = { apiKeys, schemaRegistry, contentHashes, agentUserId, info: { pepperSource } };

  // M2: read model + MCP server (needs the core design services; absent in minimal test containers)
  if (services && workflows && exporter && settings) {
    const query = new DesignQueryService({ agentUserId, reads: new DesignReadRepository(db), hashes: contentHashes, registry: schemaRegistry, services, workflows, exporter, projects, settings });
    const bundles = new BundleService({ query, exporter });
    const limiter = new RateLimiter(limits);
    const aiPack = new AiPackService({ artifacts: new AiArtifactRepository(db), query, bundles, projects, auth });
    // M4: versions + changesets (need the core change list for review)
    const reads = query.reads;
    const versionRepo = new VersionRepository(db);
    const library = new ProjectLibraryService({ db, reads, services, workflows, projects, agentUserId });
    const versions = new VersionService({ repo: versionRepo, query, projects, auth, transaction, library });
    const changesets = collaboration ? new ChangesetService({
      repo: versionRepo, versions, query, reads, hashes: contentHashes, services, workflows, exporter, collaboration,
      projects, auth, db, transaction, parseSvg, library, agentUserId, newUid: () => uuidv7(randomBytes), ...(now ? { now } : {})
    }) : null;
    const newUid = () => uuidv7(randomBytes);
    const requests = new ItemRequestService({ db, query, reads, versionRepo, projects, auth, newUid, library, transaction, ...(now ? { now } : {}) });
    const bindings = new BindingService({ db, reads, hashes: contentHashes, versions, newUid, ...(now ? { now } : {}) });
    if (changesets) { changesets.requests = requests; changesets.bindings = bindings; }
    if (changesets) {
      // the core change list delegates AI change requests (afterSnapshot.mcp) to the changeset review
      collaboration.externalReviewer = {
        handles: ch => Boolean(ch?.afterSnapshot?.mcp?.changesetUid),
        review: (ch, decision, opts) => changesets.reviewChangeRequest(ch, decision, opts)
      };
    }
    const protocol = new McpProtocol({ apiKeys, query, bundles, limiter, aiPack, versions, changesets, requests, bindings });
    const http = createMcpHttpHandler({ apiKeys, protocol, bundles, limiter, allowedOrigins, versions, ...(pollMs ? { pollMs } : {}) });
    // live updates for subscribed sessions (resources/subscribe + GET /mcp event stream)
    versions.onChange = projectId => http.notify(projectId, ['uiux://project/manifest', 'uiux://project/versions']);
    requests.onChange = projectId => http.notify(projectId, ['uiux://requests/open']);
    Object.assign(out, { query, bundles, limiter, protocol, aiPack, versions, changesets, library, requests, bindings, http });
  }
  return out;
}
