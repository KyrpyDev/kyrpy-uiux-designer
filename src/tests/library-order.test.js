import test from 'node:test';
import assert from 'node:assert/strict';
import { privateFirst } from '../domain/entities.js';

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
