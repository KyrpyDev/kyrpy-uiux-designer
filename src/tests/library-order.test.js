import test from 'node:test';
import assert from 'node:assert/strict';
import { privateFirst, scopeFirst, visClass } from '../domain/entities.js';

test('privateFirst lists the user\'s own private items first and keeps every other order (stable)', () => {
  const list = [
    { id: 1, visibility: 'public', creatorId: 1 },
    { id: 2, visibility: 'private', creatorId: 7 },
    { id: 3, visibility: 'project', creatorId: 7 },
    { id: 4, visibility: 'private', creatorId: 2 },
    { id: 5, visibility: 'private', creatorId: 7 },
    { id: 6 }
  ];
  assert.deepEqual(privateFirst(list, 7).map(d => d.id), [2, 5, 1, 3, 4, 6]);
  assert.deepEqual(privateFirst(list, 99).map(d => d.id), [1, 2, 3, 4, 5, 6], 'no own private items: order unchanged');
  assert.deepEqual(privateFirst([{ id: 1, visibility: 'private' }], undefined).map(d => d.id), [1], 'missing ids default to user 1');
  assert.deepEqual(privateFirst(null, 1), []);
});

test('privateFirst stays linear for a large icon library', () => {
  const big = Array.from({ length: 11000 }, (_, i) => ({ id: i, visibility: i % 1000 === 0 ? 'private' : 'public', creatorId: 1 }));
  const out = privateFirst(big, 1);
  assert.equal(out.length, big.length);
  assert.deepEqual(out.slice(0, 11).map(d => d.id), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  assert.equal(out[11].id, 1);
});

test('scopeFirst orders project items, then own private, then public (stable) and visClass tags them', () => {
  const list = [
    { id: 1, visibility: 'public' }, { id: 2, visibility: 'project' }, { id: 3, visibility: 'private', creatorId: 7 },
    { id: 4, visibility: 'public' }, { id: 5, visibility: 'project' }, { id: 6, visibility: 'private', creatorId: 7 }
  ];
  assert.deepEqual(scopeFirst(list, 7).map(d => d.id), [2, 5, 3, 6, 1, 4]);
  assert.deepEqual(scopeFirst(list.filter(d => d.visibility === 'public'), 7).map(d => d.id), [1, 4]);
  assert.equal(visClass({ visibility: 'project' }), ' vis-own');
  assert.equal(visClass({ visibility: 'private' }), ' vis-own');
  assert.equal(visClass({ visibility: 'public' }), '');
  // public items the active project uses: purple and listed right after the green ones
  const used = new Set(['icon:4']);
  assert.equal(visClass({ id: 4, visibility: 'public' }, used, 'icon'), ' vis-used');
  assert.equal(visClass({ id: 1, visibility: 'public' }, used, 'icon'), '');
  assert.equal(visClass({ id: 4, visibility: 'public' }, used, 'button'), '');
  assert.deepEqual(scopeFirst(list, 7, used, 'icon').map(d => d.id), [2, 5, 3, 6, 4, 1]);
});

test('NodeRepository.usedByProject follows screen -> element -> button -> icon references', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { NodeRepository } = await import('../infrastructure/sqlite/repositories/node-repository.js');
  const db = new DatabaseSync(':memory:');
  for (const t of ['screens', 'elements', 'buttons', 'icons', 'paths']) db.exec(`CREATE TABLE ${t} (id INTEGER PRIMARY KEY, project_id INTEGER)`);
  db.exec('CREATE TABLE nodes (id INTEGER PRIMARY KEY, owner_type TEXT, owner_id INTEGER, ref_type TEXT, ref_id INTEGER)');
  db.exec(`INSERT INTO screens VALUES (1, 5), (2, 6); INSERT INTO elements VALUES (10, 1); INSERT INTO buttons VALUES (20, 1); INSERT INTO icons VALUES (30, 1), (31, 1);
    INSERT INTO nodes (owner_type, owner_id, ref_type, ref_id) VALUES ('screen', 1, 'element', 10), ('element', 10, 'button', 20), ('button', 20, 'icon', 30), ('screen', 2, 'icon', 31)`);
  const used = new NodeRepository(db).usedByProject(5);
  assert.deepEqual(used.sort(), ['button:20', 'element:10', 'icon:30', 'screen:1']);
});
