import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import { createContext, renderDocument } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { isContainerNode } from '../domain/geometry.js';
import {
  REPEATER_LAYOUTS, REPEATER_KEY, isRepeaterNode, repeaterConfig, repeaterDefaultAttrs, repeaterTemplate,
  repeaterTemplateOps, repeaterMarkup, repeaterPlan, repeaterAdoptOps
} from '../domain/repeater.js';
import { HTML_ELEMENTS } from '../infrastructure/import/elements-catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = existsSync(resolve(here, '..', '..', 'v1')) ? resolve(here, '..', '..', 'v1') : resolve(here, '..', '..', '.archive', 'v1');
const theme = BUILTIN_THEMES[0];
const count = (s, re) => (s.match(re) || []).length;

/** A repeater shell (id 1) with one template rect (id 2). */
const repeaterNodes = (o = {}) => [
  { id: 1, parentId: null, ord: 1, tag: 'rect', kind: 'shape', role: 'repeater-container', name: 'list', attrs: { x: 10, y: 10, width: 300, height: 200, ...repeaterDefaultAttrs(o) } },
  { id: 2, parentId: 1, ord: 0, tag: 'rect', kind: 'shape', name: 'row', attrs: { x: 22, y: 22, width: 60, height: 40, fill: '#f00' } }
];
const render = (nodes, mode = 'animate', extra = {}) => renderDocument({ owner: { width: 320, height: 220 }, nodes, ctx: createContext({ theme, repeaterMode: mode, ...extra }) });

test('repeater: catalog preset is a public built-in container', { skip: !existsSync(legacyRoot) }, () => {
  const def = HTML_ELEMENTS.find(d => d.key === REPEATER_KEY);
  assert.ok(def, 'html-repeater is in the element catalog');
  assert.equal(def.category, 'containers');
  assert.equal(def.nodes[0].attrs['data-container'], 'repeater');

  const c = buildContainer({ dbFile: ':memory:' });
  try {
    c.importer.run({ legacyRoot });
    const pub = c.publicUserId();
    const row = c.db.prepare("SELECT id, creator_id, root_owner_id, visibility, builtin FROM elements WHERE key = 'html-repeater'").get();
    assert.ok(row, 'seeded');
    assert.equal(row.creator_id, pub); assert.equal(row.root_owner_id, pub); assert.equal(row.visibility, 'public');
    const el = c.element.get(row.id);
    assert.ok(isRepeaterNode(el.nodes[0]) && isContainerNode(el.nodes[0]));
    assert.equal(el.meta.containerType, 'repeater');
    assert.deepEqual(c.importer.ensurePresets([REPEATER_KEY]), [], 'idempotent');
  } finally { c.close(); }
});

test('repeater: an existing database gets the preset once at startup', { skip: !existsSync(legacyRoot) }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ud-rpt-'));
  const dbFile = join(dir, 'rpt.db');
  try {
    let c = buildContainer({ dbFile });
    c.importer.run({ legacyRoot });
    const id = c.element.get(REPEATER_KEY).id;
    c.element.remove(id, { permanent: true });
    c.db.prepare("DELETE FROM mcp_migrations WHERE id = 'preset-001-html-repeater'").run();
    assert.equal(c.element.list().some(e => e.key === REPEATER_KEY), false);
    c.close();
    c = buildContainer({ dbFile });          // an "older" database: the preset is missing and not yet seeded
    const again = c.element.list().find(e => e.key === REPEATER_KEY);
    assert.ok(again, 're-seeded');
    assert.equal(c.db.prepare('SELECT creator_id FROM elements WHERE id = ?').get(again.id).creator_id, c.publicUserId());
    c.element.remove(again.id, { permanent: true });
    c.close();
    c = buildContainer({ dbFile });          // the ledger keeps a deleted preset deleted
    assert.equal(c.element.list().some(e => e.key === REPEATER_KEY), false);
    c.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('repeater: config is normalized and clamped', () => {
  const cfg = repeaterConfig({ attrs: { 'data-repeater-layout': 'bogus', 'data-repeater-count': 999, 'data-repeater-dim': '3d', 'data-repeater-autoplay': 'false' } });
  assert.equal(cfg.layout, 'vertical'); assert.equal(cfg.itemCount, 50); assert.equal(cfg.dimension, '3d'); assert.equal(cfg.autoplay, false);
  assert.equal(repeaterConfig({ attrs: { 'data-repeater-count': 0 } }).itemCount, 1);
  assert.equal(repeaterConfig({ attrs: {} }).itemCount, 5);
});

test('repeater: renders itemCount copies of the template for every layout, 2D and 3D', () => {
  for (const layout of REPEATER_LAYOUTS) for (const dimension of ['2d', '3d']) for (const mode of ['animate', 'static']) {
    const svg = render(repeaterNodes({ layout, dimension, itemCount: 7 }), mode);
    assert.equal(count(svg, /data-rpt-index="/g), 7, `${layout}/${dimension}/${mode}: 7 copies`);
    for (let i = 0; i < 7; i++) assert.ok(svg.includes(`data-rpt-index="${i}"`));
    assert.equal(count(svg, /fill="#f00"/g), 7 + count(svg, /data-rpt-clone="/g), 'template drawn once per copy (and loop clone)');
    if (mode === 'static') assert.ok(!/@keyframes ud-rpt/.test(svg), 'static frame has no keyframes');
  }
  // the copies are never stored: the node list is unchanged
  const nodes = repeaterNodes({ itemCount: 9 });
  render(nodes);
  assert.equal(nodes.length, 2);
});

test('repeater: layouts place copies along their axis and animate per effect', () => {
  const pos = svg => [...svg.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\)"><g class="ud-rpt-copy[^"]*" data-rpt-index/g)].map(m => [+m[1], +m[2]]);
  const v = pos(render(repeaterNodes({ layout: 'vertical', itemCount: 3, gap: 10 })));
  assert.deepEqual(v.map(p => p[0]), [22, 22, 22]); assert.deepEqual(v.map(p => p[1]), [22, 72, 122]);
  const hz = pos(render(repeaterNodes({ layout: 'horizontal', itemCount: 3, gap: 10 })));
  assert.deepEqual(hz.map(p => p[0]), [22, 92, 162]); assert.deepEqual(hz.map(p => p[1]), [22, 22, 22]);

  const car2 = render(repeaterNodes({ layout: 'carousel', dimension: '2d', itemCount: 4 }));
  assert.equal(count(car2, /data-rpt-clone="/g), 4, '2d carousel loops with a second set');
  assert.match(car2, /@keyframes ud-rpt-1-track\{0%\{transform:translateX\(0\)\}100%\{transform:translateX\(-288px\)\}/);
  const roll2 = render(repeaterNodes({ layout: 'roll', dimension: '2d', itemCount: 4 }));
  assert.match(roll2, /translateY\(-208px\)/, '2d roll is a vertical ticker');
  const slide = render(repeaterNodes({ layout: 'slide', itemCount: 3, direction: 'horizontal' }));
  assert.match(slide, /translateX\(-72px\)/); assert.match(slide, /translateX\(-144px\)/);
  const scroll = render(repeaterNodes({ layout: 'scroll', itemCount: 6 }));
  assert.match(scroll, /ud-rpt-1-track \d+ms ease-in-out infinite alternate/, 'overflowing list scrolls');
  assert.match(scroll, /clip-path="url\(#ud-clip-rpt-1\)"/);
  assert.ok(!/@keyframes/.test(render(repeaterNodes({ layout: 'scroll', itemCount: 2 }))), 'a list that fits does not scroll');
  assert.ok(!/@keyframes/.test(render(repeaterNodes({ layout: 'carousel', autoplay: false }))), 'autoplay off = no animation');
});

test('repeater: 3D adds perspective transforms (ring for carousel, cylinder for roll)', () => {
  const car3 = render(repeaterNodes({ layout: 'carousel', dimension: '3d', itemCount: 6 }));
  assert.match(car3, /perspective\(800px\) rotateY\(/);
  assert.equal(count(car3, /animation-delay:-?\d+ms/g), 6, 'each copy is phase-shifted on the ring');
  assert.match(car3, /data-rpt-index="3"[^>]*transform="translate\([^)]*\) scale\(/, 'static frame projects the ring');
  const roll3 = render(repeaterNodes({ layout: 'roll', dimension: '3d', itemCount: 6, perspective: 600 }));
  assert.match(roll3, /perspective\(600px\) rotateX\(/);
  const v3 = render(repeaterNodes({ layout: 'vertical', dimension: '3d' }));
  assert.match(v3, /transform:perspective\(800px\) rotateX\(18deg\)/);
  const v2 = render(repeaterNodes({ layout: 'vertical', dimension: '2d' }));
  assert.ok(!/perspective\(/.test(v2) && !/rotate[XY]\(/.test(v2), '2d stays flat');
  assert.ok(!/rotateY\(/.test(render(repeaterNodes({ layout: 'carousel', dimension: '2d' }))));
});

test('repeater: editor shows empty slots; nothing is drawn without a template outside the editor', () => {
  const shell = [repeaterNodes({ itemCount: 4 })[0]];
  assert.equal(count(render(shell, 'animate', { editor: true }), /data-rpt-index="/g), 4);
  assert.equal(count(render(shell), /data-rpt-index="/g), 0);
});

test('repeater: dropping an item sets / replaces the template (service level)', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const icA = c.icon.create({ name: 'Glyph A', key: 'glyph-a' }, { nodes: [{ tag: 'path', attrs: { d: 'M4 4h16v16H4z' } }] });
    const icB = c.icon.create({ name: 'Glyph B', key: 'glyph-b' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8 } }] });
    const el = c.element.create({ name: 'List', key: 'my-list', width: 320, height: 400 }, {
      nodes: [{ id: 1, tag: 'rect', role: 'repeater-container', attrs: { x: 0, y: 0, width: 320, height: 400, ...repeaterDefaultAttrs({ itemCount: 6 }) } }]
    });
    const rep = c.element.get(el.id).nodes[0];
    const drop = refId => {
      const nodes = c.element.get(el.id).nodes;
      const { removeIds, node } = repeaterTemplateOps(nodes, rep, { tag: 'use', kind: 'instance', refType: 'icon', refId, attrs: { width: 48, height: 48 } }, { x: 12, y: 12, w: 48, h: 48 });
      for (const id of removeIds) c.element.removeNode(id);
      return c.element.addNode(el.id, node);
    };
    drop(icA.id);
    let nodes = c.element.get(el.id).nodes;
    assert.equal(nodes.filter(n => n.parentId === rep.id).length, 1);
    assert.equal(repeaterTemplate(nodes, rep.id).refId, icA.id);
    drop(icB.id);
    nodes = c.element.get(el.id).nodes;
    assert.equal(nodes.filter(n => n.parentId === rep.id).length, 1, 'the second drop replaced the template');
    assert.equal(repeaterTemplate(nodes, rep.id).refId, icB.id);
    const svg = c.render.boxSvg('element', el.id, theme.key);
    assert.equal(count(svg, /data-rpt-index="/g), 6, 'rendered 6 copies of the dropped icon');
    assert.equal(count(svg, /href="#i-glyph-b"/g), 6);
  } finally { c.close(); }
});

test('repeater: export emits the template once plus the repeat runtime; svg files hold the static first frame', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const ic = c.icon.create({ name: 'Dot', key: 'dot' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 6 } }] });
    const repEl = c.element.create({ name: 'Repeater', key: REPEATER_KEY, width: 358, height: 220, category: 'containers', meta: { htmlTag: 'div', containerType: 'repeater' } },
      { nodes: [{ tag: 'rect', role: 'repeater-container', attrs: { x: 0, y: 0, width: 358, height: 220, ...repeaterDefaultAttrs() } }] });
    const sc = c.screen.create({ name: 'Feed', key: 'feed', width: 390, height: 844 }, { nodes: [
      { id: 1, tag: 'use', kind: 'instance', refType: 'element', refId: repEl.id, role: 'repeater-container', name: 'feed-list',
        attrs: { x: 16, y: 100, width: 358, height: 300, ...repeaterDefaultAttrs({ layout: 'carousel', dimension: '3d', itemCount: 8 }) } },
      { id: 2, parentId: 1, tag: 'use', kind: 'instance', refType: 'icon', refId: ic.id, name: 'feed-item', attrs: { x: 28, y: 112, width: 64, height: 64 } }
    ] });
    const { files } = c.exporter.buildBundle({ screenIds: [sc.id], title: 'T' });
    const file = p => files.find(f => f.path === p)?.content;
    const page = file('screens/feed.html');
    assert.ok(page.includes('class="ud-container-children ud-repeater"') && page.includes('data-rpt="'), 'repeater container with its settings');
    assert.equal(count(page, /class="ud-rpt-tpl"/g) / count(page, /<svg[\s>]/g), 1, 'the template once per svg');
    assert.equal(count(page, /data-rpt-index="/g), 0, 'copies are made by the runtime, not baked in');
    assert.ok(page.includes('&quot;itemCount&quot;:8') && page.includes('&quot;layout&quot;:&quot;carousel&quot;'));
    const js = file('js/app.js');
    assert.ok(js.includes('function repeaterPlan(') && js.includes('function repeaterMarkup(') && js.includes('bindRepeaters(document);'));
    assert.ok(file('ts/repeater.ts').includes('export function bindRepeaters('));
    assert.ok(file('ts/app.ts').includes("import { bindRepeaters } from './repeater';"));
    const svgFile = file(files.find(f => /^svg\/screens\/.+\/feed\.svg$/.test(f.path)).path);
    assert.equal(count(svgFile, /data-rpt-index="/g), 8, 'svg export: static first frame with every copy');
    assert.ok(!/@keyframes ud-rpt/.test(svgFile));
    assert.equal(count(c.exporter.svgFile('screen', sc.id).content, /data-rpt-index="/g), 8);

    // the embedded runtime is self-contained and produces the same markup as the renderer
    const rt = js.slice(js.indexOf('function repeaterPlan('), js.indexOf('bindRepeaters(document);'));
    const fns = new Function(`${rt}\nreturn { repeaterMarkup, bindRepeaters };`)();
    const cfg = repeaterConfig({ attrs: repeaterDefaultAttrs({ layout: 'roll', dimension: '3d', itemCount: 5 }) });
    const args = ['k', cfg, { x: 0, y: 0, w: 300, h: 200 }, { w: 60, h: 40 }, '<rect width="60" height="40"/>', 'animate'];
    assert.deepEqual(fns.repeaterMarkup(...args), repeaterMarkup(...args));
  } finally { c.close(); }
});

test('repeater: 3D ring projection stays finite and positive for extreme sizes, counts and perspective', () => {
  const scales = s => [...s.matchAll(/scale\(([-\d.e+]+)(?: ([-\d.e+]+))?\)/g)].flatMap(m => [m[1], m[2]].filter(Boolean).map(Number));
  for (const layout of ['carousel', 'roll']) for (const itemCount of [1, 2, 7, 50]) for (const perspective of [100, 800, 5000])
    for (const [iw, ih, W, H] of [[60, 40, 300, 200], [2000, 1500, 4000, 3000], [5, 5, 6000, 6000], [900, 900, 300, 300]]) {
      const cfg = repeaterConfig({ attrs: repeaterDefaultAttrs({ layout, dimension: '3d', itemCount, perspective, gap: 400 }) });
      const inner = { x: 0, y: 0, w: W, h: H }, item = { w: iw, h: ih };
      const plan = repeaterPlan(cfg, inner, item);
      const tag = `${layout} n=${itemCount} P=${perspective} item=${iw}x${ih} view=${W}x${H}`;
      assert.ok(plan.ring.perspective >= 2.5 * plan.ring.radius - 0.01, `${tag}: perspective clears the radius`);
      assert.ok(plan.ring.perspective >= perspective, `${tag}: never lowers the configured perspective`);
      const out = repeaterMarkup('x', cfg, inner, item, '<rect/>', 'animate');
      const all = [...scales(out.markup), ...scales(out.css)];
      assert.ok(all.length >= itemCount * 2, `${tag}: scales found`);
      for (const k of all) assert.ok(Number.isFinite(k) && k > 0 && k <= 1.68, `${tag}: scale ${k} finite, positive, bounded`);
      const persp = [...out.css.matchAll(/perspective\((\d+)px\)/g)].map(m => +m[1]);
      assert.ok(persp.length && persp.every(p => p === plan.ring.perspective), `${tag}: keyframes use the clamped perspective`);
    }
  // ordinary rings keep the configured perspective
  assert.equal(repeaterPlan(repeaterConfig({ attrs: repeaterDefaultAttrs({ layout: 'carousel', dimension: '3d', itemCount: 6 }) }), { x: 0, y: 0, w: 276, h: 176 }, { w: 60, h: 40 }).ring.perspective, 800);
});

test('repeater: 2D carousel / roll loops cover the whole view at every point of the shift', () => {
  for (const layout of ['carousel', 'roll']) for (const [n, size, gap, view] of [[1, 40, 12, 600], [2, 30, 0, 900], [4, 60, 12, 276], [3, 10, 5, 2000], [50, 60, 12, 300]]) {
    const cfg = repeaterConfig({ attrs: repeaterDefaultAttrs({ layout, dimension: '2d', itemCount: n, gap }) });
    const inner = { x: 0, y: 0, w: view, h: view };
    const plan = repeaterPlan(cfg, inner, { w: size, h: size });
    const ax = layout === 'carousel' ? 'x' : 'y';
    const L = plan.track.distance;
    const end = Math.max(...plan.copies.map(c => c[ax])) + size;
    assert.ok(end >= L + view - 0.01, `${layout} n=${n} size=${size} view=${view}: content end ${end} covers shift ${L} + view`);
    assert.equal(plan.copies.length % n, 0);
    assert.equal(plan.copies.filter(c => !c.clone).length, n, 'one real set, the rest clones');
    assert.ok(plan.copies.length >= 2 * n);
  }
  // a set that already overflows the view keeps exactly one clone set
  const big = repeaterPlan(repeaterConfig({ attrs: repeaterDefaultAttrs({ layout: 'carousel', itemCount: 10 }) }), { x: 0, y: 0, w: 300, h: 100 }, { w: 60, h: 40 });
  assert.equal(big.copies.length, 20);
});

test('repeater: render ignores extra children deterministically (first by ord is the template)', () => {
  const nodes = repeaterNodes({ itemCount: 3 });
  nodes.push({ id: 3, parentId: 1, ord: 5, tag: 'rect', kind: 'shape', name: 'stray', attrs: { x: 30, y: 30, width: 20, height: 20, fill: '#00f' } });
  const svg = render(nodes);
  assert.equal(count(svg, /fill="#f00"/g), 3); assert.equal(count(svg, /fill="#00f"/g), 0);
  const swapped = nodes.map(n => n.id === 3 ? { ...n, ord: -1 } : n);
  const svg2 = render(swapped);
  assert.equal(count(svg2, /fill="#00f"/g), 3); assert.equal(count(svg2, /fill="#f00"/g), 0);
  assert.equal(repeaterTemplate(swapped, 1).id, 3);
});

test('repeater: moving an existing node onto a repeater makes it the template and parks the old one beside it', () => {
  const nodes = [...repeaterNodes({ itemCount: 4 }), { id: 9, parentId: null, ord: 3, tag: 'rect', kind: 'shape', name: 'card', attrs: { x: 400, y: 50, width: 500, height: 80, fill: '#0f0' } }];
  const rep = nodes[0], inner = { x: 22, y: 22, w: 276, h: 176 };
  const { patches, parkedIds } = repeaterAdoptOps(nodes, rep, nodes[2], inner);
  assert.deepEqual(parkedIds, [2]);
  assert.deepEqual(patches.map(p => p.id), [2, 9], 'old template is moved out first, then the new one adopted');
  const park = patches[0].patch, adopt = patches[1].patch;
  assert.equal(park.parentId, null, 'old template goes to the repeater\'s parent (top level)');
  assert.ok(park.attrs.x >= 10 + 300, 'parked to the right of the repeater'); assert.equal(park.attrs.width, 60);
  assert.ok(park.ord > 3);
  assert.equal(adopt.parentId, 1); assert.equal(adopt.ord, 0);
  assert.ok(adopt.attrs.width <= inner.w && adopt.attrs.height <= inner.h, 'fitted inside the content box');
  assert.ok(adopt.attrs.x >= inner.x && adopt.attrs.y >= inner.y);
  // applying the ops renders the moved node as the repeated template, nothing lost
  const applied = nodes.map(n => { const p = patches.find(q => q.id === n.id); return p ? { ...n, ...p.patch } : n; });
  assert.equal(applied.length, 3);
  assert.equal(repeaterTemplate(applied, 1).id, 9);
  assert.equal(applied.filter(n => n.parentId === 1).length, 1);
  const svg = render(applied);
  assert.equal(count(svg, /fill="#0f0"/g), 4); assert.equal(count(svg, /fill="#f00"/g), 1, 'the parked old template is still drawn once');
  // an empty repeater: nothing to park
  assert.deepEqual(repeaterAdoptOps([rep, nodes[2]], rep, nodes[2], inner).parkedIds, []);
});
