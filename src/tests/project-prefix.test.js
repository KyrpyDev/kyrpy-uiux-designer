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

test('new items of a project with a prefix are named prefix-[itemtype]-name; explicit keys, the shared default project and other projects are untouched', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const proj = c.projects.create({ name: 'Untrap', prefix: 'untrap', visibility: 'private' });
    const other = c.projects.create({ name: 'Plain', visibility: 'private' });          // no prefix set (legacy / internal)
    const made = (type, name, extra = {}) => c.services[type].create({ name, projectId: proj.id, visibility: 'private', ...extra }).key;
    assert.equal(made('element', 'Scan Button'), 'untrap-element-scan-button');
    assert.equal(made('screen', 'Home Screen'), 'untrap-screen-home-screen');
    assert.equal(made('button', 'Go'), 'untrap-button-go');
    assert.equal(made('icon', 'Arrow'), 'untrap-icon-arrow');
    assert.equal(made('path', 'Curve'), 'untrap-path-curve');
    assert.equal(made('element', 'Scan Button'), 'untrap-element-scan-button-2', 'unique within the project');
    assert.equal(made('element', 'untrap-element-already'), 'untrap-element-already', 'a name that already carries the prefix is not doubled');
    assert.equal(made('element', 'Imported', { key: 'my-own-key' }), 'my-own-key', 'an explicit key stays as given');
    assert.equal(c.services.element.create({ name: 'Plain Item', projectId: other.id, visibility: 'private' }).key, 'plain-item');
    assert.equal(c.services.element.create({ name: 'Shared Item', projectId: 1 }).key, 'shared-item', 'the shared default project has no prefix scope');
    const wf = c.workflows.create({ name: 'Onboarding', projectId: proj.id, visibility: 'private' });
    assert.equal(wf.key, 'untrap-workflow-onboarding');
  } finally { c.close(); }
});

test('one create-project window everywhere: title, variable (used by MCP), description, prefix', async () => {
  const { readFileSync } = await import('node:fs');
  const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const dlg = read('interfaces/web/js/components/project-prefix.js');
  for (const f of ['np-name', 'np-key', 'np-desc', 'np-prefix']) assert.match(dlg, new RegExp(`'data-f': '${f}'`));
  assert.match(dlg, /api\.createProject\(\{\s*name: nameIn\.value\.trim\(\), key: keyIn\.value\.trim\(\), description: descIn\.value\.trim\(\),\s*prefix:/);
  assert.match(dlg, /Used by MCP tools/);
  for (const f of ['interfaces/web/js/main.js', 'interfaces/web/js/components/collab-modals.js', 'interfaces/web/js/components/item-browser.js']) {
    assert.match(read(f), /openCreateProjectDialog\(/, f);
    assert.doesNotMatch(read(f), /api\.createProject\(\{ name(, prefix)?, visibility/, `${f}: no project created without its fields`);
  }
});
