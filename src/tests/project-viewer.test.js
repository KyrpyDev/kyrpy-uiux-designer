import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { ValidationError } from '../domain/errors.js';

function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' }).user;
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada });
  const mk = (name, key) => c.screen.create({ name, key, label: name, width: 200, height: 300, projectId: p.id, visibility: 'project', creatorId: ada.id },
    { nodes: [{ tag: 'rect', role: 'card', name: 'surface', attrs: { x: 10, y: 10, width: 100, height: 40, rx: 8 } }, { tag: 'text', name: 'title', text: `Hello </script><b>${name}`, attrs: { x: 20, y: 40 } }] });
  const home = mk('Home', 'home'), detail = mk('Detail', 'detail'), loose = mk('Loose', 'loose');
  const wf = c.workflows.create({ name: 'Main flow', key: 'main-flow', projectId: p.id, visibility: 'project', creatorId: ada.id }, { actor: ada });
  return { c, ada, p, home, detail, loose, wf };
}

test('buildProjectHtml: one self-contained file with workflows (left) and screens (right), no external references', () => {
  const w = world();
  try {
    w.c.workflows.placeScreen(w.wf.id, { screenId: w.detail.id, x: 300, y: 0 });
    w.c.workflows.placeScreen(w.wf.id, { screenId: w.home.id, x: 0, y: 0 });
    w.c.workflows.addLink(w.wf.id, { fromScreenId: w.home.id, toScreenId: w.detail.id, name: 'Open detail', trigger: 'tap' });
    const f = w.c.exporter.buildProjectHtml({ projectId: w.p.id, title: 'Ada App', projectKey: w.p.key });
    assert.match(f.filename, /-project\.html$/);
    assert.match(f.contentType, /text\/html/);
    const html = f.content;
    assert.match(html, /<aside class="pv-left"/); assert.match(html, /<main class="pv-right"/);
    assert.match(html, /\.pv-left \{ flex: 0 0 30%/); assert.match(html, /\.pv-right \{ flex: 1 1 70%/);
    for (const key of ['home', 'detail', 'loose']) assert.match(html, new RegExp(`<template id="t-${key}">`), `screen ${key} embedded`);
    assert.equal(f.summary.screens, 3);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\//, 'no network references');
    assert.doesNotMatch(html, /<link [^>]*stylesheet/, 'css is inlined');
    // data block cannot be closed early by item text
    assert.equal((html.match(/<\/script>/g) || []).length, 2, 'only the data block and the runtime close a script tag');
    const data = JSON.parse(/<script type="application\/json" id="pv-data">([\s\S]*?)<\/script>/.exec(html)[1]);
    assert.equal(data.screens.length, 3);
    assert.equal(data.workflows.length, 1);
    assert.deepEqual(data.workflows[0].screens, ['home', 'detail'], 'workflow screens in canvas order (left to right)');
    assert.deepEqual(data.screens.find(x => x.key === 'home').links.map(l => l.to), ['detail']);
    assert.ok(!data.workflows[0].screens.includes('loose'), 'the loose screen is listed outside workflows');
    // the runtime is valid javascript
    const runtime = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    assert.doesNotThrow(() => new Function(runtime));
    assert.match(runtime, /function bindMenus/); assert.match(runtime, /function bindRepeaters/);
  } finally { w.c.close(); }
});

test('buildProjectHtml: an empty project is refused', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' }).user;
    const p = c.projects.create({ name: 'Empty' }, { actor: ada });
    assert.throws(() => c.exporter.buildProjectHtml({ projectId: p.id }), ValidationError);
  } finally { c.close(); }
});
