/**
 * Milestone M0 sensors (docs/project-definition/project-definition-mcp.md §17):
 *  - every table has `mcp_context` and a documented schema_registry row (table + every column)
 *  - identity tables have a unique uid, filled on insert and backfilled on migration
 *  - content_hash is id-free, cached, and invalidated by row and child-row changes
 *  - the MCP schema pass is idempotent and survives a core table rebuild
 *  - PostgreSQL DDL carries the same columns
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { buildContainer } from '../../composition-root.js';
import { ValidationError } from '../../domain/errors.js';
import { applyMcpSchema, dropMcpTriggers } from '../infrastructure/sqlite/mcp-schema.js';
import { ContentHashStore } from '../infrastructure/sqlite/content-hash-store.js';
import { SchemaRegistryRepository } from '../infrastructure/sqlite/schema-registry-repository.js';
import { MCP_PG_SCHEMA_SQL, PG_TABLES } from '../infrastructure/postgres/mcp-pg-schema.js';
import { PG_SCHEMA_SQL } from '../../infrastructure/postgres/pg-sync-service.js';
import { IDENTITY_TABLES, PROJECT_KEY_TABLES } from '../domain/tables.js';
import { parseMcpContext, validateMcpContext, mergeMcpContext, serializeMcpContext, MCP_CONTEXT_MAX_BYTES } from '../domain/mcp-context.js';
import { uuidv7, isUid } from '../domain/uid.js';
import { canonicalJson } from '../domain/content-hash.js';

const fresh = () => buildContainer({ dbFile: ':memory:', syncEnabled: false });
const tables = db => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
const cols = (db, t) => db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
const uidOf = (db, table, id) => db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(id).uid;

test('M0: every table has an mcp_context column (TEXT NOT NULL DEFAULT {})', () => {
  const c = fresh();
  for (const t of tables(c.db)) {
    const col = c.db.prepare(`PRAGMA table_info("${t}")`).all().find(x => x.name === 'mcp_context');
    assert.ok(col, `${t} has no mcp_context`);
    assert.equal(col.type, 'TEXT', t);
    assert.equal(col.notnull, 1, t);
    assert.equal(col.dflt_value, "'{}'", t);
  }
  c.close();
});

test('M0: every table and every column is documented in schema_registry', () => {
  const c = fresh();
  const reg = new SchemaRegistryRepository(c.db);
  assert.deepEqual(reg.undocumented().map(e => `${e.tableName}.${e.columnName}`), [], 'add the missing entries to src/mcp/domain/schema-registry-seed.js');
  for (const t of tables(c.db)) {
    const d = reg.describeTable(t);
    assert.ok(d.context.purpose, `${t} purpose`);
    for (const col of d.columns) {
      if (t === 'schema_registry' && col.name === 'mcp_context') continue;
      assert.ok(col.context.purpose, `${t}.${col.name} purpose`);
    }
  }
  c.close();
});

test('M0: a new table or column gets a placeholder registry row and mcp_context on the next pass', () => {
  const c = fresh();
  c.db.exec('CREATE TABLE future_things (id INTEGER PRIMARY KEY, title TEXT)');
  const report = applyMcpSchema(c.db);
  assert.deepEqual(report.mcpContextAdded, ['future_things']);
  assert.ok(cols(c.db, 'future_things').includes('mcp_context'));
  const reg = new SchemaRegistryRepository(c.db);
  const missing = reg.undocumented().map(e => `${e.tableName}.${e.columnName}`).sort();
  assert.deepEqual(missing, ['future_things.', 'future_things.id', 'future_things.mcp_context', 'future_things.title']);
  reg.upsert({ tableName: 'future_things', context: { purpose: 'Things for later.' }, source: 'user' });
  assert.equal(reg.describeTable('future_things').context.purpose, 'Things for later.');
  c.close();
});

test('M0: seed refresh never overwrites user-edited registry rows', () => {
  const c = fresh();
  const reg = new SchemaRegistryRepository(c.db);
  reg.upsert({ tableName: 'icons', context: { purpose: 'Edited by a human.' }, source: 'user' });
  c.db.prepare("UPDATE schema_registry SET version = 0 WHERE source = 'seed'").run();   // pretend the seed is newer
  const report = applyMcpSchema(c.db);
  assert.ok(report.registryUpdated > 0);
  assert.equal(reg.describeTable('icons').context.purpose, 'Edited by a human.');
  c.close();
});

test('M0: the MCP schema pass is idempotent', () => {
  const c = fresh();
  const again = applyMcpSchema(c.db);
  assert.deepEqual(again, { migrations: [], mcpContextAdded: [], uidBackfilled: {}, registryInserted: 0, registryUpdated: 0, registryPlaceholders: [], aiArtifacts: 0, keyUniqueDropped: [] });
  c.close();
});

test('M0: identity tables get unique uids on insert, and the uid survives updates and NULL writes', () => {
  const c = fresh();
  for (const t of IDENTITY_TABLES) {
    assert.ok(cols(c.db, t).includes('uid'), `${t}.uid`);
    assert.ok(cols(c.db, t).includes('content_hash'), `${t}.content_hash`);
  }
  const a = c.icon.create({ name: 'Uid A' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } }] });
  const b = c.icon.create({ name: 'Uid B' });
  const ua = uidOf(c.db, 'icons', a.id);
  assert.ok(isUid(ua)); assert.notEqual(ua, uidOf(c.db, 'icons', b.id));
  c.icon.update(a.id, { label: 'changed' });
  assert.equal(uidOf(c.db, 'icons', a.id), ua, 'uid is stable across updates');
  c.db.prepare('UPDATE icons SET uid = NULL WHERE id = ?').run(a.id);   // e.g. a sync pull from a remote without uids
  assert.equal(uidOf(c.db, 'icons', a.id), ua, 'uid_keep trigger restores the local uid');
  assert.throws(() => c.db.prepare('UPDATE icons SET uid = ? WHERE id = ?').run(ua, b.id), /UNIQUE/);
  const wf = c.workflows.create({ name: 'Uid Flow' });
  assert.ok(isUid(uidOf(c.db, 'workflows', wf.id)));
  for (const t of PROJECT_KEY_TABLES) {
    const idx = c.db.prepare(`PRAGMA index_list("${t}")`).all().find(i => i.name === `ux_${t}_project_key`);
    assert.ok(idx && idx.unique, `${t} (project_id, key) unique index`);
  }
  c.close();
});

test('M0: rows without uid are backfilled, and a core table rebuild is repaired on the next pass', () => {
  const c = fresh();
  const p = c.path.create({ name: 'Rebuilt path' });
  const before = uidOf(c.db, 'paths', p.id);
  // simulate a future core migration that rebuilds the table without the MCP columns (like migration 7 did for themes)
  assert.ok(dropMcpTriggers(c.db) > 0, 'database.js does this before pending core migrations');
  const coreCols = cols(c.db, 'paths').filter(x => !['uid', 'content_hash', 'mcp_context'].includes(x));
  c.db.exec(`CREATE TABLE paths_v2 AS SELECT ${coreCols.join(',')} FROM paths; DROP TABLE paths; ALTER TABLE paths_v2 RENAME TO paths;`);
  assert.ok(!cols(c.db, 'paths').includes('uid'));
  const report = applyMcpSchema(c.db);
  assert.ok(report.mcpContextAdded.includes('paths'));
  assert.ok(report.uidBackfilled.paths >= 1);
  const after = uidOf(c.db, 'paths', p.id);
  assert.ok(isUid(after)); assert.notEqual(after, before, 'a rebuild that drops uid loses identity; core rebuilds must copy uid');
  const tr = c.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_mcp_%'").get().n;
  assert.ok(tr > 0, 'triggers are back');
  c.path.addNode(p.id, { tag: 'circle', attrs: { cx: 1, cy: 1, r: 1 } });   // triggers work against the rebuilt table
  c.close();
});

test('M0: content_hash ignores ids/project/lineage and changes with visible content', () => {
  const c = fresh();
  const hashes = new ContentHashStore(c.db);
  const nodes = [{ tag: 'path', attrs: { d: 'M12 5v14M5 12h14', stroke: '{{accent}}' } }];
  const a = c.icon.create({ name: 'Plus', key: 'plus-a' }, { nodes });
  c.icon.create({ name: 'Filler' });   // shift ids so the two copies get different node ids
  const b = c.icon.create({ name: 'Plus', key: 'plus-b' }, { nodes });
  const ha = hashes.get('icon', a.id);
  assert.match(ha, /^[0-9a-f]{64}$/);
  assert.notEqual(ha, hashes.get('icon', b.id), 'key is part of the content');
  // move one copy to another project and change its visibility: not content, so only the key differs
  c.db.prepare("UPDATE icons SET project_id = 7, visibility = 'project', position = 99 WHERE id = ?").run(a.id);
  assert.notEqual(c.icon.get(a.id).nodes[0].id, c.icon.get(b.id).nodes[0].id);
  const ca = hashes.canonical('icon', a.id).replace('"plus-a"', '"K"');
  const cb = hashes.canonical('icon', b.id).replace('"plus-b"', '"K"');
  assert.equal(ca, cb, 'canonical form is independent of ids, project, visibility and position');
  assert.equal(hashes.get('icon', a.id), ha, 'hash is unchanged by those non-content updates');
  c.close();
});

test('M0: content_hash is cached and invalidated by row, node, animation, menu and workflow changes', () => {
  const c = fresh();
  const hashes = new ContentHashStore(c.db);
  const stored = (t, id) => c.db.prepare(`SELECT content_hash FROM ${t} WHERE id = ?`).get(id).content_hash;

  const ic = c.icon.create({ name: 'Spin' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 5 } }] });
  const h1 = hashes.get('icon', ic.id);
  assert.equal(stored('icons', ic.id), h1, 'cached');
  assert.equal(hashes.get('icon', ic.id), h1, 'stable');
  assert.equal(hashes.compute('icon', ic.id), h1);
  assert.equal(stored('icons', ic.id), h1, 'recomputing an unchanged hash keeps the cache');

  c.icon.update(ic.id, { label: 'Spinner' });
  assert.equal(stored('icons', ic.id), null, 'row update invalidates');
  const h2 = hashes.get('icon', ic.id);
  assert.notEqual(h2, h1);

  const node = c.icon.get(ic.id).nodes[0];
  c.icon.updateNode(node.id, { attrs: { cx: 12, cy: 12, r: 6 } });
  assert.equal(stored('icons', ic.id), null, 'node update invalidates the owner');
  const h3 = hashes.get('icon', ic.id);
  assert.notEqual(h3, h2);

  c.db.prepare("INSERT INTO animations (node_id, type) VALUES (?, 'rotate')").run(node.id);
  assert.equal(stored('icons', ic.id), null, 'animation insert invalidates the owner');
  assert.notEqual(hashes.get('icon', ic.id), h3);

  const btn = c.button.create({ name: 'Menu button' });
  hashes.get('button', btn.id);
  c.db.prepare("INSERT INTO menu_items (button_id, name, label) VALUES (?, 'home', 'Home')").run(btn.id);
  assert.equal(stored('buttons', btn.id), null, 'menu item insert invalidates the button');

  const a = c.screen.create({ name: 'A' }, { nodes: [{ tag: 'text', kind: 'text', text: 'Go', attrs: { x: 1, y: 1 } }] });
  const b = c.screen.create({ name: 'B' });
  const wf = c.workflows.create({ name: 'Flow' });
  const w1 = hashes.get('workflow', wf.id);
  const hot = c.screen.get(a.id).nodes[0];
  c.workflows.addLink(wf.id, { fromScreenId: a.id, toScreenId: b.id, fromNodeId: hot.id, name: 'Open B' });
  assert.equal(stored('workflows', wf.id), null, 'link insert invalidates the workflow');
  const w2 = hashes.get('workflow', wf.id);
  assert.notEqual(w2, w1);
  assert.ok(JSON.parse(hashes.canonical('workflow', wf.id)).l[0][1] === '0', 'hotspot node is referenced by tree path, not id');
  c.screen.updateNode(hot.id, { text: 'Go!' });
  assert.equal(stored('workflows', wf.id), null, 'hotspot screen node change invalidates linked workflows');

  const counts = hashes.refreshStale();
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM icons WHERE content_hash IS NULL').get().n, 0);
  assert.ok(Object.values(counts).every(n => n >= 0));
  c.close();
});

test('M0: references are hashed by uid, so a re-pointed instance changes the hash', () => {
  const c = fresh();
  const hashes = new ContentHashStore(c.db);
  const i1 = c.icon.create({ name: 'Ref one' });
  const i2 = c.icon.create({ name: 'Ref two' });
  const btn = c.button.create({ name: 'Ref button' }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: i1.id, attrs: { x: 0, y: 0, width: 24, height: 24 } }] });
  const h1 = hashes.get('button', btn.id);
  assert.ok(hashes.canonical('button', btn.id).includes(uidOf(c.db, 'icons', i1.id)));
  const inst = c.button.get(btn.id).nodes[0];
  c.button.updateNode(inst.id, { refId: i2.id });
  assert.notEqual(hashes.get('button', btn.id), h1);
  c.close();
});

test('M0: mcp_context validation', () => {
  assert.deepEqual(parseMcpContext(null), {});
  assert.deepEqual(parseMcpContext('not json'), {});
  assert.deepEqual(parseMcpContext('[1,2]'), {});
  assert.deepEqual(parseMcpContext('{"purpose":"x"}'), { purpose: 'x' });
  const ok = { purpose: 'Back arrow', usage: 'Top-left of every pushed screen', constraints: ['24x24'], codeHints: { web: '<svg/>' }, related: [{ type: 'icon', key: 'arrow-right' }], source: 'designer', custom: { any: 1 } };
  assert.equal(validateMcpContext(ok), ok);
  assert.throws(() => validateMcpContext('x'), ValidationError);
  assert.throws(() => validateMcpContext({ purpose: 3 }), ValidationError);
  assert.throws(() => validateMcpContext({ constraints: 'one' }), ValidationError);
  assert.throws(() => validateMcpContext({ codeHints: { web: 1 } }), ValidationError);
  assert.throws(() => validateMcpContext({ related: [{ type: 'icon' }] }), ValidationError);
  assert.throws(() => validateMcpContext({ source: 'hacker' }), ValidationError);
  assert.throws(() => validateMcpContext({ notes: 'x'.repeat(4001) }), ValidationError);
  assert.throws(() => validateMcpContext({ blob: 'x'.repeat(MCP_CONTEXT_MAX_BYTES) }), ValidationError);
  assert.deepEqual(mergeMcpContext({ purpose: 'a', usage: 'b' }, { usage: null, source: 'ai-push' }), { purpose: 'a', source: 'ai-push' });
  assert.equal(serializeMcpContext('{"purpose":"x"}'), '{"purpose":"x"}');
});

test('M0: uuidv7 and canonicalJson', () => {
  const ids = Array.from({ length: 50 }, (_, i) => uuidv7(randomBytes, 1_700_000_000_000 + i));
  assert.ok(ids.every(isUid));
  assert.ok(ids.every(id => id[14] === '7'), 'version nibble');
  assert.deepEqual([...ids].sort(), ids, 'time ordered');
  assert.equal(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
});

test('M0: PostgreSQL DDL carries mcp_context, uid, content_hash and schema_registry', () => {
  assert.ok(PG_SCHEMA_SQL.endsWith(MCP_PG_SCHEMA_SQL), 'core PG DDL includes the MCP part');
  assert.match(MCP_PG_SCHEMA_SQL, /CREATE TABLE IF NOT EXISTS schema_registry/);
  for (const t of PG_TABLES) {
    assert.ok(PG_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${t} `) || PG_SCHEMA_SQL.includes(`CREATE TABLE IF NOT EXISTS ${t}(`), `${t} exists in core PG DDL`);
    assert.ok(MCP_PG_SCHEMA_SQL.includes(`ALTER TABLE IF EXISTS "${t}" ADD COLUMN IF NOT EXISTS mcp_context`), `${t}.mcp_context in PG`);
  }
  for (const t of IDENTITY_TABLES) {
    assert.ok(MCP_PG_SCHEMA_SQL.includes(`ALTER TABLE IF EXISTS "${t}" ADD COLUMN IF NOT EXISTS uid TEXT`), `${t}.uid in PG`);
  }
});
