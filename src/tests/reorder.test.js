import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { ForbiddenError, ValidationError } from '../domain/errors.js';

function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' }).user;
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' }).user;
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada });
  const mk = n => c.button.create({ name: n, key: n.toLowerCase(), projectId: p.id, visibility: 'project', creatorId: ada.id }, { nodes: [] });
  const items = Object.fromEntries(['A', 'B', 'C', 'D'].map(n => [n, mk(n)]));
  const order = () => c.db.prepare('SELECT name FROM buttons WHERE project_id = ? ORDER BY position, name').all(p.id).map(r => r.name).join('');
  return { c, ada, bob, items, order };
}

test('display order: forward / backward move one step, front / back jump, edges are no-ops', () => {
  const w = world();
  try {
    assert.equal(w.order(), 'ABCD');
    const r = w.c.button.reorder(w.items.D.id, 'forward', { actor: w.ada });
    assert.equal(r.moved, true); assert.equal(w.order(), 'ABDC');
    w.c.button.reorder(w.items.A.id, 'backward', { actor: w.ada }); assert.equal(w.order(), 'BADC');
    w.c.button.reorder(w.items.C.id, 'front', { actor: w.ada });    assert.equal(w.order(), 'CBAD');
    w.c.button.reorder(w.items.C.id, 'back', { actor: w.ada });     assert.equal(w.order(), 'BADC');
    const edge = w.c.button.reorder(w.items.B.id, 'forward', { actor: w.ada });
    assert.equal(edge.moved, false); assert.equal(w.order(), 'BADC');
    // positions are dense and unique afterwards
    const pos = w.c.db.prepare('SELECT position FROM buttons ORDER BY position').all().map(x => x.position);
    assert.equal(new Set(pos).size, pos.length);
  } finally { w.c.close(); }
});

test('display order: only the owner (or superadmin) may reorder; bad modes are rejected; content is not touched', () => {
  const w = world();
  try {
    assert.throws(() => w.c.button.reorder(w.items.A.id, 'back', { actor: w.bob }), ForbiddenError);
    assert.throws(() => w.c.button.reorder(w.items.A.id, 'sideways', { actor: w.ada }), ValidationError);
    const before = w.c.db.prepare('SELECT updated_at, content_hash FROM buttons WHERE id = ?').get(w.items.A.id);
    w.c.button.reorder(w.items.A.id, 'back', { actor: w.ada });
    const after = w.c.db.prepare('SELECT updated_at, content_hash FROM buttons WHERE id = ?').get(w.items.A.id);
    assert.deepEqual(after, before, 'an order change is not a content edit');
  } finally { w.c.close(); }
});
