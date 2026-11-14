import test from 'node:test';
import assert from 'node:assert/strict';
import { prefixedVariableName, isValidProjectPrefix } from '../domain/naming.js';
import { planPrefixes } from '../scripts/set-project-prefixes.js';

test('prefix rule: 2-16 lowercase letters or digits, starting with a letter', () => {
  assert.equal(isValidProjectPrefix('untrap'), true);
  assert.equal(isValidProjectPrefix('untraprev'), true);
  assert.equal(isValidProjectPrefix('a'), false);
  assert.equal(isValidProjectPrefix('1abc'), false);
  assert.equal(isValidProjectPrefix('untrap-core'), false);
  assert.equal(isValidProjectPrefix('a'.repeat(17)), false);
});

test('dropped public item name: projectprefix-[itemtype]-itemname; no prefix keeps the plain name', () => {
  assert.equal(prefixedVariableName('untrap', 'element', 'Scan Button'), 'untrap-element-scan-button');
  assert.equal(prefixedVariableName('untraprev', 'button', 'home'), 'untraprev-button-home');
  assert.equal(prefixedVariableName(null, 'element', 'Scan Button'), 'scan-button');
});

test('backfill: maps the named projects, never changes a set prefix, keeps prefixes unique', () => {
  const rows = [
    { id: 1, key: 'default-project', settings: '{}' },
    { id: 4, key: 'kyrpy-untrap-app', settings: '{}' },
    { id: 5, key: 'untrap-reverse-engineered', settings: '{}' },
    { id: 6, key: 'untrap', settings: '{}' },
    { id: 9, key: 'other', settings: '{}' },
    { id: 10, key: 'untrap-custom', settings: '{"prefix":"keepme"}' }
  ];
  const plan = planPrefixes(rows);
  const by = Object.fromEntries(plan.map(p => [p.key, p]));
  assert.equal(by['kyrpy-untrap-app'].prefix, 'untrap');
  assert.equal(by['untrap-reverse-engineered'].prefix, 'untraprev');
  assert.equal(by['default-project'].prefix, 'public');
  assert.equal(by.untrap.prefix, 'untrapcore');
  assert.ok(by.other.error);
  assert.equal(by['untrap-custom'], undefined);
});

import { buildContainer } from '../composition-root.js';

test('project prefix: unique across all projects (public and private), immutable on every update route, never inherited by a clone', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const P = c.projects;
    const a = P.create({ name: 'Alpha', prefix: 'alpha', visibility: 'private' });
    assert.equal(a.settings.prefix, 'alpha');
    // unique across public and private projects alike
    assert.throws(() => P.create({ name: 'Other', prefix: 'alpha', visibility: 'public' }), /already used/);
    assert.throws(() => P.create({ name: 'Other', prefix: 'ALPHA', visibility: 'private' }), /already used/);
    assert.throws(() => P.create({ name: 'Bad', prefix: 'a' }), /Project prefix is required/);
    assert.throws(() => P.create({ name: 'Bad', prefix: 'with-dash' }), /Project prefix is required/);
    // immutable through update, saveProject and an explicit null / empty value
    for (const settings of [{ prefix: 'changed' }, { prefix: null }, { prefix: '' }]) {
      assert.throws(() => P.update(a.id, { settings }), /cannot be changed/);
      assert.throws(() => P.saveProject(a.id, { settings }), /cannot be changed/);
    }
    assert.equal(P.update(a.id, { name: 'Alpha 2', settings: { buttonStyle: 'circle' } }).settings.prefix, 'alpha');   // other settings still save, prefix stays
    assert.equal(P.update(a.id, { settings: { prefix: 'alpha' } }).settings.prefix, 'alpha');                            // same value is not a change
    // a clone gets its own prefix, never the source's
    const clone = P.clone(a.id, { name: 'Alpha clone', prefix: 'alphacopy' });
    assert.equal(clone.project.settings.prefix, 'alphacopy');
    assert.throws(() => P.clone(a.id, { name: 'Dup', prefix: 'alpha' }), /already used/);
  } finally { c.close(); }
});
