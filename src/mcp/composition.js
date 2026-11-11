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
import { AccountService } from './application/account-service.js';
import { buildClientSetup } from './interfaces/web/client-setup.js';
import { ProjectLibraryService } from './application/project-library-service.js';
import { ItemRequestService } from './application/item-request-service.js';
import { BindingService } from './application/binding-service.js';
import { DesignSessionService } from './application/design-session-service.js';
import { StudioToolsService } from './application/studio-tools-service.js';
import { FocusRepository } from './infrastructure/sqlite/focus-repository.js';
import { ApiBridge } from './server/api-bridge.js';
import { AGENT_USERNAME } from './domain/agent-user.js';
import { publicUserId as publicUserIdOf } from '../domain/system-users.js';

/** Per-key limits (doc §15). Override with `limits` for tests or bigger installations. */
export const DEFAULT_LIMITS = {
  calls: { limit: 120, windowMs: 60_000 },
  bundles: { limit: 10, windowMs: 3_600_000 },
  projects: { limit: 10, windowMs: 3_600_000 },
  authfail: { limit: 20, windowMs: 300_000 }   // rejected API keys per client address
};

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function buildMcpModule({ db, dbFile, projects, users, auth, transaction, now, services, workflows, exporter, settings, collaboration, parseSvg, pollMs, getContainer = null, projectService = null, limits = DEFAULT_LIMITS, allowedOrigins = [] }) {
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
  const publicUserId = () => publicUserIdOf(db);
  const out = { apiKeys, schemaRegistry, contentHashes, agentUserId, publicUserId, info: { pepperSource } };

  // M2: read model + MCP server (needs the core design services; absent in minimal test containers)
  if (services && workflows && exporter && settings) {
    const query = new DesignQueryService({ agentUserId, publicUserId, reads: new DesignReadRepository(db), hashes: contentHashes, registry: schemaRegistry, services, workflows, exporter, projects, settings });
    const bundles = new BundleService({ query, exporter });
    const limiter = new RateLimiter(limits);
    const aiPack = new AiPackService({ artifacts: new AiArtifactRepository(db), query, bundles, projects, auth, clientSetup: buildClientSetup });
    // account (user-wide) keys: per-call project resolution + create / clone projects (needs the core ProjectService)
    const accounts = projectService ? new AccountService({ projects, projectService, users, auth, limiter }) : null;
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
    // AI-assisted design: focus + edit session + versions for account keys with the "design" scope
    const design = accounts && changesets
      ? new DesignSessionService({ focus: new FocusRepository(db), accounts, projectService, projects, users, versions, changesets, query, versionRepo, services, workflows, db, transaction, ...(now ? { now } : {}) })
      : null;
    const resolveContainer = getContainer || (() => ({
      db, users, auth, projects: projectService || projects, services, ...services, workflows, exporter, settings, collaboration, mcp: out, publicUserId
    }));
    const apiBridge = new ApiBridge({ getContainer: resolveContainer, apiKeys, accounts, design, versions });
    const studioTools = new StudioToolsService({ getContainer: resolveContainer, db, query, reads, hashes: contentHashes, library, versions, parseSvg, transaction, publicUserId });
    const protocol = new McpProtocol({ apiKeys, query, bundles, limiter, aiPack, versions, changesets, requests, bindings, accounts, design, apiBridge, studioTools });
    const http = createMcpHttpHandler({ apiKeys, protocol, bundles, limiter, allowedOrigins, versions, ...(pollMs ? { pollMs } : {}) });
    // live updates for subscribed sessions (resources/subscribe + GET /mcp event stream)
    versions.onChange = projectId => http.notify(projectId, ['uiux://project/manifest', 'uiux://project/versions']);
    requests.onChange = projectId => http.notify(projectId, ['uiux://requests/open']);
    apiBridge.onMutate = projectId => http.notify(projectId, ['uiux://project/manifest']);
    studioTools.onMutate = projectId => http.notify(projectId, ['uiux://project/manifest']);
    Object.assign(out, { query, bundles, limiter, protocol, aiPack, versions, changesets, library, requests, bindings, design, apiBridge, studioTools, http });
  }
  return out;
}
