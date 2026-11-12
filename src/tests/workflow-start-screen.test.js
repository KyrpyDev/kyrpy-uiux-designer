import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContainer } from '../composition-root.js';
import { workflowStartScreen } from '../domain/screen-routes.js';
import { workflowFingerprint, workflowRestoreBody } from '../domain/doc-fingerprint.js';

const src = p => readFileSync(new URL(p, import.meta.url), 'utf8');

test('workflowStartScreen: stored start screen, else an entry screen, else the left-most top-most screen', () => {
  const nodes = [{ screenId: 3, x: 500, y: 0 }, { screenId: 1, x: 0, y: 200 }, { screenId: 2, x: 0, y: 0 }];
  const hub = [{ fromScreenId: 2, toScreenId: 1 }, { fromScreenId: 2, toScreenId: 3 }, { fromScreenId: 1, toScreenId: 2 }, { fromScreenId: 3, toScreenId: 2 }];
  assert.equal(workflowStartScreen({ startScreenId: 3, nodes, links: hub }), 3, 'the stored one wins');
  assert.equal(workflowStartScreen({ startScreenId: 99, nodes, links: hub }), 2, 'a stored screen that left the workflow is ignored');
  assert.equal(workflowStartScreen({ nodes, links: hub }), 2, 'every screen links back to the hub: the left-most, top-most one');
  assert.equal(workflowStartScreen({ nodes, links: [{ fromScreenId: 3, toScreenId: 1 }, { fromScreenId: 3, toScreenId: 2 }] }), 3, 'the screen no link points to');
  assert.equal(workflowStartScreen({ nodes, links: [{ fromScreenId: 3, toScreenId: 3 }] }), 2, 'a link to itself does not count; several entries: left-most, top-most');
  assert.equal(workflowStartScreen({ nodes: [], links: [] }), null);
  assert.equal(workflowStartScreen(null), null);
});

test('a workflow generated from a screen remembers that screen as its start, also when other screens link back to it', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const own = { projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub };
    const go = to => ({ tag: 'rect', name: `to ${to.name}`, attrs: { x: 0, y: 0, width: 40, height: 40 }, onClick: { type: 'screen', targetId: to.id } });
    const mk = (name, nodes = []) => c.screen.create({ name, key: name, width: 390, height: 844, ...own }, { nodes });
    const leaf = mk('st-leaf'), other = mk('st-other');
    const sub = mk('st-sub', [go(leaf)]);
    const home = mk('st-home', [go(sub)]);
    // every sub screen leads back to home, and an unrelated screen leads into sub
    for (const s of [sub, leaf]) c.nodes.create('screen', s.id, { ...go(home), attrs: { x: 50, y: 0, width: 10, height: 10 } });
    c.nodes.create('screen', other.id, go(sub));

    // generated from the middle of the app: that screen is the start and only what lies below it is brought in
    const wfSub = c.workflows.generateFromScreen({ screenId: sub.id, name: 'From sub', ...own });
    assert.equal(wfSub.startScreenId, sub.id);
    assert.equal(c.workflows.get(wfSub.id).startScreenId, sub.id, 'stored');
    assert.ok(!wfSub.nodes.some(n => n.screenId === other.id), 'a screen that only leads INTO the start is not part of it');
    assert.equal(workflowStartScreen(wfSub), sub.id);
    const at = id => wfSub.nodes.find(n => n.screenId === id);
    assert.ok(wfSub.nodes.every(n => n.screenId === sub.id || n.x > at(sub.id).x), 'the start screen is the left-most: its sub screens follow');

    const wf = c.workflows.generateFromScreen({ screenId: home.id, name: 'From home', ...own });
    assert.equal(wf.startScreenId, home.id);
    assert.ok(wf.links.some(l => l.toScreenId === home.id), 'sub screens link back to the start');
    assert.equal(workflowStartScreen(c.workflows.get(wf.id)), home.id);

    // the start can be moved to another screen of the workflow, never to a foreign one
    assert.equal(c.workflows.update(wf.id, { startScreenId: sub.id }).startScreenId, sub.id);
    assert.throws(() => c.workflows.update(wf.id, { startScreenId: other.id }), /start screen must be a screen of this workflow/);
    assert.equal(c.workflows.update(wf.id, { name: 'Renamed' }).startScreenId, sub.id, 'other edits keep it');
    // a copy keeps it, removing the screen clears it, a restore puts it back
    assert.equal(c.workflows.clone(wf.id, { name: 'Copy' }).startScreenId, sub.id);
    const saved = c.workflows.get(wf.id);
    c.workflows.removeScreen(wf.id, sub.id);
    assert.equal(c.workflows.get(wf.id).startScreenId, null);
    assert.equal(c.workflows.restore(wf.id, workflowRestoreBody(saved)).startScreenId, sub.id);
    assert.notEqual(workflowFingerprint(saved), workflowFingerprint({ ...saved, startScreenId: home.id }), 'changing the start is an unsaved change');
    // a plain workflow has none
    assert.equal(c.workflows.create({ name: 'Plain', ...own }).startScreenId, null);
  } finally { c.close?.(); }
});

test('existing databases: the migration adds the column and recovers the start screen of generated workflows', () => {
  const mig = src('../infrastructure/sqlite/migrations.js'), pg = src('../infrastructure/postgres/pg-sync-service.js');
  assert.match(mig, /ALTER TABLE workflows ADD COLUMN start_screen_id INTEGER;/);
  assert.match(mig, /description_dev = 'Generated from the routes of screen "' \|\| s\.name \|\| '"\.'/);
  assert.match(pg, /ALTER TABLE workflows ADD COLUMN IF NOT EXISTS start_screen_id INTEGER;/);
  assert.match(pg, /\['workflows', 'start_screen_id'\]/, 'screen ids are remapped in this column too');
  assert.match(src('../application/workflow-service.js'), /Generated from the routes of screen "\$\{s\.name\}"\./, 'the text the migration matches');
});

test('client: the test starts on the selected screen, else on the start screen; the canvas marks and sets it', () => {
  const tr = src('../interfaces/web/js/components/test-runner.js'), wd = src('../interfaces/web/js/components/workflow-designer.js');
  assert.match(tr, /export function workflowStart\(wf\) \{ return workflowStartScreen\(wf\); \}/);
  assert.match(tr, /startId = target\.startScreenId \?\? workflowStart\(wf\)/);
  assert.match(wd, /startScreenId: this\.testStartScreenId\(\)/);
  assert.match(wd, /\(this\.sel\?\.kind === 'node' && this\.sel\.id\) \|\| workflowStartScreen\(this\.wf\)/, 'canvas test mode too');
  assert.match(wd, /api\.updateWorkflow\(this\.wf\.id, \{ startScreenId: screenId \}\)/);
  assert.match(wd, /const queue = stored != null \? \[stored\]/, 'auto layout grows from the start screen');
});
