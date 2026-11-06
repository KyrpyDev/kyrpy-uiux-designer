/**
 * PostgreSQL parity and sync of every MCP table. The DDL checks always run; the live round trip runs
 * against an isolated database (`kyrpy-uiux-designer-test-db`, dropped afterwards) and is skipped when
 * PostgreSQL is not configured or not reachable. It never touches the real `kyrpy-uiux-designer-db`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../../composition-root.js';
import { PostgresSyncService, PG_SCHEMA_SQL, SYNC_TABLES } from '../../infrastructure/postgres/pg-sync-service.js';
import { MCP_SYNC_TABLES, sqliteToPgDdl } from '../infrastructure/postgres/mcp-pg-schema.js';
import { MCP_TABLES } from '../domain/tables.js';

const TEST_DB = 'kyrpy-uiux-designer-test-db';
const docs = p => ({ descriptionDev: `pg test ${p}`, mcpContext: { purpose: p } });

test('PG: every MCP table except the local ledger is in the PG DDL and the sync list', () => {
  const synced = new Set(SYNC_TABLES.map(t => t.name));
  for (const t of MCP_TABLES.filter(n => n !== 'mcp_migrations')) {
    assert.ok(PG_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${t} (`), `${t} DDL`);
    assert.ok(synced.has(t), `${t} synced`);
  }
  assert.equal(MCP_SYNC_TABLES.length, 8);
  const ddl = sqliteToPgDdl("id INTEGER PRIMARY KEY AUTOINCREMENT, p INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, t TEXT NOT NULL DEFAULT (strftime('%Y','now')) -- note");
  assert.equal(ddl.trim(), "id INTEGER PRIMARY KEY, p INTEGER NOT NULL, t TEXT NOT NULL DEFAULT ''");
});

function seed() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'PG App' }, { actor: ada.user });
  const key = c.mcp.apiKeys.create({ name: 'agent', projectId: p.id, scopes: ['read', 'request', 'propose'] }, ada.user).key;
  const pr = c.mcp.apiKeys.authenticate(key);
  const cs = c.mcp.changesets;
  const b = cs.begin(pr, { summary: 'pg' });
  cs.stage(pr, { changeset: b.changeset, item: { type: 'icon', key: 'pg-dot', name: 'Dot', ...docs('dot'), nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 5 } }] }, binding: { file: 'src/Dot.tsx', symbol: 'Dot' } });
  const sub = cs.submit(pr, { changeset: b.changeset, message: 'dot' });
  cs.review(sub.changeset, { approve: sub.ops.map(o => o.opUid) }, ada.user);
  c.mcp.requests.request(pr, { type: 'icon', intent: 'bell icon' });
  return { c, p, key };
}

const count = (c, t) => c.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;

test('PG live: push all tables, pull into a fresh instance, the MCP state survives', async t => {
  const probe = new PostgresSyncService({ db: buildContainer({ dbFile: ':memory:', syncEnabled: false }).db, config: { database: TEST_DB } });
  if (!probe.enabled) return t.skip('PostgreSQL not configured');
  const init = probe.ensureRemoteDatabase();
  if (!init.ok) return t.skip(`PostgreSQL not reachable: ${init.error}`);

  const lonely = buildContainer({ dbFile: ':memory:', syncEnabled: false });   // its own random pepper
  process.env.KYRPY_UIUX_KEY_PEPPER = 'pg-sync-test-shared-pepper-0123456789abcdef';
  const a = seed();
  const b = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  delete process.env.KYRPY_UIUX_KEY_PEPPER;
  try {
    const pushA = new PostgresSyncService({ db: a.c.db, config: { database: TEST_DB } });
    const push = pushA.pushToPostgres();
    assert.ok(push.ok, push.error);
    for (const tbl of ['project_versions', 'changesets', 'changeset_ops', 'item_requests', 'code_bindings', 'api_keys', 'ai_artifacts']) {
      assert.equal(push.tableCounts[tbl], count(a.c, tbl), `${tbl} pushed`);
    }
    const pull = new PostgresSyncService({ db: b.db, config: { database: TEST_DB } }).pullFromPostgres();
    assert.ok(pull.ok, pull.error);
    for (const tbl of ['project_versions', 'changesets', 'changeset_ops', 'item_requests', 'code_bindings', 'api_keys']) {
      assert.equal(count(b, tbl), count(a.c, tbl), `${tbl} pulled`);
    }
    const headA = a.c.mcp.versions.repo.head(a.p.id), headB = b.mcp.versions.repo.head(a.p.id);
    assert.equal(headB.number, headA.number);
    assert.equal(headB.manifestHash, headA.manifestHash);
    assert.equal(b.mcp.versions.liveManifest(a.p.id).manifestHash, headA.manifestHash, 'pulled design = pulled head (uids and hashes survive)');
    const pb = b.mcp.apiKeys.authenticate(a.key);   // shared KYRPY_UIUX_KEY_PEPPER → the synced key works
    assert.ok(new PostgresSyncService({ db: lonely.db, config: { database: TEST_DB } }).pullFromPostgres().ok);
    assert.throws(() => lonely.mcp.apiKeys.authenticate(a.key), /invalid/, 'another pepper → synced hashes are useless');
    assert.equal(pb.project.id, a.p.id);
    assert.equal(b.mcp.requests.list(pb, {}).requests.length, 1);
    assert.equal(b.mcp.bindings.list(pb, {}).bindings[0].file, 'src/Dot.tsx');
  } finally {
    a.c.close(); b.close(); lonely.close();
    probe.execPg(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE);`, { database: probe.config.adminDb, timeoutMs: 10000 });
  }
});
