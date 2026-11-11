import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildContainer } from '../composition-root.js';
import { MENU_ORIENTATIONS, MENU_LABEL_POSITIONS, DEFAULT_MENU } from '../domain/entities.js';
import {
  menuConfig,
  menuOrientation,
  menuOrientationPatch,
  resolveMenuLabelPlacement,
  renderMenu,
  buildMenuTree,
  menuExtent,
  layoutItems,
  HUB_FAN
} from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { bindMenus } from '../domain/menu-runtime.js';

const sampleTree = () => buildMenuTree([
  { id: 1, parentId: null, ord: 0, name: 'home', label: 'Home', iconId: null, visible: true },
  { id: 2, parentId: null, ord: 1, name: 'search', label: 'Search', iconId: null, visible: true },
  { id: 3, parentId: null, ord: 2, name: 'profile', label: 'Profile', iconId: null, visible: true },
  { id: 4, parentId: 1, ord: 0, name: 'sub-one', label: 'Sub One', iconId: null, visible: true },
  { id: 5, parentId: 1, ord: 1, name: 'sub-two', label: 'Sub Two', iconId: null, visible: true },
  { id: 6, parentId: 1, ord: 2, name: 'sub-three', label: 'Sub Three', iconId: null, visible: true }
]);

test('unifyHubMenus: merges legacy hub-menu-horizontal + hub-menu-vertical and html-hub-menu-vertical without breaking references', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const ic = c.icon.create({ name: 'sample-logo-basic', key: 'sample-logo-basic', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
    const hBtn = c.button.create({ name: 'Hub menu (horizontal)', key: 'hub-menu-horizontal', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true, width: 64, height: 64, meta: { icon: 'sample-logo-basic', menu: { kind: 'hub', layout: 'fan', direction: 'horizontal', startAngle: -160, sweep: 140 } } }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: ic.id, attrs: { x: 12, y: 12, width: 40, height: 40 } }] });
    c.menus.addItem(hBtn.id, { name: 'home', label: 'Home' });
    const vBtn = c.button.create({ name: 'Hub menu (vertical)', key: 'hub-menu-vertical', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true, width: 64, height: 64, meta: { icon: 'sample-logo-basic', menu: { kind: 'hub', layout: 'fan', direction: 'vertical', startAngle: -70, sweep: 140 } } }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'icon', refId: ic.id, attrs: { x: 12, y: 12, width: 40, height: 40 } }] });
    const hEl = c.element.create({ name: 'Hub menu bar (horizontal)', key: 'html-hub-menu', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true, width: 260, height: 130 }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'button', refId: hBtn.id, attrs: { x: 102, y: 37, width: 56, height: 56 } }] });
    const vEl = c.element.create({ name: 'Hub menu bar (vertical)', key: 'html-hub-menu-vertical', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, builtin: true, width: 130, height: 260 }, { nodes: [{ tag: 'use', kind: 'instance', refType: 'button', refId: vBtn.id, attrs: { x: 37, y: 102, width: 56, height: 56 } }] });

    // A screen referencing both legacy vertical items:
    const scr = c.screen.create({ name: 'Home Screen', key: 'home-scr', projectId: 1, visibility: 'project', creatorId: pub, rootOwnerId: pub, width: 390, height: 844 }, {
      nodes: [
        { tag: 'use', kind: 'instance', refType: 'button', refId: vBtn.id, name: 'legacy-vert-btn', attrs: { x: 20, y: 20, width: 56, height: 56 } },
        { tag: 'use', kind: 'instance', refType: 'element', refId: vEl.id, name: 'legacy-vert-el', attrs: { x: 20, y: 120, width: 130, height: 260 } }
      ]
    });

    const changed = c.importer.unifyHubMenus();
    assert.ok(changed.includes('hub-menu'));
    assert.ok(changed.includes('-hub-menu-vertical'));
    assert.ok(changed.includes('-html-hub-menu-vertical'));

    const pubBtns = c.button.list().filter(b => b.visibility === 'public');
    assert.deepEqual(pubBtns.map(b => b.key), ['hub-menu']);
    assert.equal(pubBtns[0].id, hBtn.id, 'preserves canonical horizontal button id & uid');
    assert.equal(pubBtns[0].name, 'Hub menu');
    assert.equal(pubBtns[0].meta.menu.orientation, 'horizontal');

    const pubEls = c.element.list().filter(e => e.visibility === 'public');
    assert.deepEqual(pubEls.map(e => e.key), ['html-hub-menu']);
    assert.equal(pubEls[0].id, hEl.id);
    assert.equal(pubEls[0].name, 'Hub menu bar');

    // Verify screen references were re-pointed, NOT deleted!
    const scrAfter = c.screen.get(scr.id);
    assert.equal(scrAfter.nodes.length, 2);
    assert.equal(scrAfter.nodes.find(n => n.name === 'legacy-vert-btn').refId, hBtn.id);
    assert.equal(scrAfter.nodes.find(n => n.name === 'legacy-vert-el').refId, hEl.id);
    assert.equal(c.trash.list().length, 0, 'merged duplicates do not pollute Trash');
    assert.deepEqual(c.importer.unifyHubMenus(), [], 'idempotent on second run');
  } finally { c.close(); }
});

test('menu orientation: horizontal / vertical switching across all menu mechanisms', () => {
  assert.deepEqual(MENU_ORIENTATIONS, ['horizontal', 'vertical']);
  assert.equal(DEFAULT_MENU.orientation, null);

  // 1. Popup / list
  const listV = menuConfig({ menu: { kind: 'popup', layout: 'list', direction: 'up' } });
  assert.equal(menuOrientation(listV), 'vertical');
  const listH = menuConfig({ menu: { ...listV, ...menuOrientationPatch(listV, 'horizontal') } });
  assert.equal(menuOrientation(listH), 'horizontal');
  assert.equal(listH.direction, 'right');
  assert.ok(layoutItems(listH, 2, 64)[0].x > 0 && layoutItems(listH, 2, 64)[0].y === 0);

  // 2. Slider
  const sliderH = menuConfig({ menu: { kind: 'slider-horizontal', layout: 'slider-horizontal' } });
  assert.equal(menuOrientation(sliderH), 'horizontal');
  const sliderV = menuConfig({ menu: { ...sliderH, ...menuOrientationPatch(sliderH, 'vertical') } });
  assert.equal(menuOrientation(sliderV), 'vertical');
  assert.equal(sliderV.kind, 'slider-vertical');
  assert.equal(sliderV.layout, 'slider-vertical');
  assert.ok(layoutItems(sliderV, 2, 64)[0].x === 0 && Math.abs(layoutItems(sliderV, 2, 64)[0].y) > 0);

  // 3. Carousel
  const carH = menuConfig({ menu: { kind: 'carousel', layout: 'carousel', direction: 'horizontal' } });
  assert.equal(menuOrientation(carH), 'horizontal');
  const carV = menuConfig({ menu: { ...carH, ...menuOrientationPatch(carH, 'vertical') } });
  assert.equal(menuOrientation(carV), 'vertical');
  assert.equal(carV.direction, 'vertical');
  assert.ok(layoutItems(carV, 2, 64)[0].x === 0 && layoutItems(carV, 2, 64)[0].y > 0);

  // 4. Drawer
  const drwH = menuConfig({ menu: { kind: 'drawer', layout: 'drawer', side: 'right' } });
  assert.equal(menuOrientation(drwH), 'horizontal');
  const drwV = menuConfig({ menu: { ...drwH, ...menuOrientationPatch(drwH, 'vertical') } });
  assert.equal(menuOrientation(drwV), 'vertical');
  assert.equal(drwV.side, 'bottom');

  // 5. Radial / Rotating / Fan
  const radH = menuConfig({ menu: { kind: 'radial', layout: 'fan', startAngle: -160, sweep: 140 } });
  assert.equal(menuOrientation(radH), 'horizontal');
  const radV = menuConfig({ menu: { ...radH, ...menuOrientationPatch(radH, 'vertical') } });
  assert.equal(menuOrientation(radV), 'vertical');
  assert.deepEqual({ startAngle: radV.startAngle, sweep: radV.sweep }, HUB_FAN.vertical);

  // 6. Hub via MenuService.setConfig (validation + persistence)
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'Hub', key: 'hub-t', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 56, height: 56 }, { nodes: [] });
    const cfgH = c.menus.setConfig(b.id, { kind: 'hub', layout: 'fan', orientation: 'horizontal' });
    assert.equal(cfgH.orientation, 'horizontal');
    assert.equal(cfgH.direction, 'horizontal');
    const cfgV = c.menus.setConfig(b.id, { orientation: 'vertical' });
    assert.equal(cfgV.orientation, 'vertical');
    assert.equal(cfgV.direction, 'vertical');
    assert.equal(cfgV.startAngle, HUB_FAN.vertical.startAngle);
    assert.throws(() => c.menus.setConfig(b.id, { orientation: 'diagonal' }), /orientation must be one of horizontal, vertical/);
  } finally { c.close(); }
});

test('menu labels: auto mechanism-based beside vs over across all menu systems + explicit overrides + extent + runtime fit', () => {
  assert.deepEqual(MENU_LABEL_POSITIONS, ['auto', 'beside', 'over']);
  assert.equal(DEFAULT_MENU.showLabels, false);
  assert.equal(DEFAULT_MENU.labelPosition, 'auto');

  const tree = sampleTree();
  const draw = cfg => renderMenu({
    button: { key: 'btn', width: 64, height: 64 },
    cfg: menuConfig({ menu: cfg }),
    tree,
    ctx: createContext({ theme: BUILTIN_THEMES[0] }),
    iconKey: () => null
  });

  // Off by default: no .rm-label nodes
  assert.doesNotMatch(draw({ kind: 'popup', layout: 'list', direction: 'up' }), /class="rm-label"/);

  // Vertical mechanisms -> 'beside'
  for (const cfg of [
    { kind: 'popup', layout: 'list', direction: 'up', showLabels: true },
    { kind: 'slider-vertical', layout: 'slider-vertical', showLabels: true },
    { kind: 'carousel', layout: 'carousel', orientation: 'vertical', showLabels: true },
    { kind: 'drawer', layout: 'drawer', side: 'bottom', showLabels: true },
    { kind: 'radial', layout: 'fan', startAngle: -60, sweep: 120, showLabels: true }
  ]) {
    const svg = draw(cfg);
    assert.match(svg, /class="rm-label" data-label-pos="beside"/, `${cfg.kind}/${cfg.layout} vertical should place labels beside`);
    assert.match(svg, />Home<\/text>/);
  }

  // Horizontal mechanisms -> 'over'
  for (const cfg of [
    { kind: 'popup', layout: 'list', direction: 'right', showLabels: true },
    { kind: 'slider-horizontal', layout: 'slider-horizontal', showLabels: true },
    { kind: 'carousel', layout: 'carousel', orientation: 'horizontal', showLabels: true },
    { kind: 'drawer', layout: 'drawer', side: 'right', showLabels: true },
    { kind: 'rotating', layout: 'fan', startAngle: -160, sweep: 140, showLabels: true }
  ]) {
    const svg = draw(cfg);
    assert.match(svg, /class="rm-label" data-label-pos="over"/, `${cfg.kind}/${cfg.layout} horizontal should place labels over`);
  }

  // Hub root bar: horizontal -> 'over', vertical -> 'beside'; sub-fan follows its arc!
  const hubHorizSvg = draw({ kind: 'hub', layout: 'fan', orientation: 'horizontal', showLabels: true });
  const [hubHorizRoot, hubHorizSub] = hubHorizSvg.split('data-level="home"');
  assert.match(hubHorizRoot, /data-label-pos="over"/, 'horizontal hub bar places labels over the bar buttons');
  assert.match(hubHorizSub, /data-label-pos="over"/, 'horizontal hub top fan places labels over the fan items');

  const hubVertSvg = draw({ kind: 'hub', layout: 'fan', orientation: 'vertical', startAngle: -40, sweep: 80, showLabels: true });
  const [hubVertRoot, hubVertSub] = hubVertSvg.split('data-level="home"');
  assert.match(hubVertRoot, /data-label-pos="beside"/, 'vertical hub bar places labels beside the stacked bar buttons');
  assert.match(hubVertSub, /data-label-pos="beside"/, 'vertical hub right-side fan places labels beside the fan items');
  assert.doesNotMatch(hubVertSub, /data-label-pos="over"/);

  // Full 360° radial circle: top/bottom items get 'over', left/right items get 'beside'
  assert.equal(resolveMenuLabelPlacement({ kind: 'radial', layout: 'radial' }, { dx: 0, dy: -80 }).pos, 'over');
  assert.deepEqual(resolveMenuLabelPlacement({ kind: 'radial', layout: 'radial' }, { dx: 0, dy: 80 }), { pos: 'over', side: 'bottom' });
  assert.deepEqual(resolveMenuLabelPlacement({ kind: 'radial', layout: 'radial' }, { dx: 80, dy: 0 }), { pos: 'beside', side: 'right' });
  assert.deepEqual(resolveMenuLabelPlacement({ kind: 'radial', layout: 'radial' }, { dx: -80, dy: 0 }), { pos: 'beside', side: 'left' });

  // Explicit overrides ('beside' on horizontal list, 'over' on vertical list)
  assert.match(draw({ kind: 'popup', layout: 'list', direction: 'right', showLabels: true, labelPosition: 'beside' }), /data-label-pos="beside"/);
  assert.match(draw({ kind: 'popup', layout: 'list', direction: 'up', showLabels: true, labelPosition: 'over' }), /data-label-pos="over"/);

  // menuExtent grows to accommodate labels so exported SVGs never clip them
  const extNoLbl = menuExtent({ width: 64, height: 64 }, menuConfig({ menu: { kind: 'popup', layout: 'list', direction: 'up', showLabels: false } }), tree);
  const extWithLbl = menuExtent({ width: 64, height: 64 }, menuConfig({ menu: { kind: 'popup', layout: 'list', direction: 'up', showLabels: true } }), tree);
  assert.ok(extWithLbl.w > extNoLbl.w + 25, `expected label width expansion (${extWithLbl.w} vs ${extNoLbl.w})`);

  // Service validation + shorthand showLabels='beside'
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const pub = c.publicUserId();
    const b = c.button.create({ name: 'Lbl', key: 'lbl-b', projectId: 1, visibility: 'public', creatorId: pub, rootOwnerId: pub, width: 56, height: 56 }, { nodes: [] });
    const saved = c.menus.setConfig(b.id, { showLabels: 'beside' });
    assert.equal(saved.showLabels, true);
    assert.equal(saved.labelPosition, 'beside');
    assert.equal(c.menus.setConfig(b.id, { showLabels: 'off' }).showLabels, false);
    assert.throws(() => c.menus.setConfig(b.id, { labelPosition: 'diagonal' }), /labelPosition must be one of auto, beside, over/);
  } finally { c.close(); }

  // Runtime fit() keeps label pill inside screen bounds via data-lbox
  const mk = (attrs = {}) => {
    const el = {
      attrs: { ...attrs }, vars: {},
      style: { setProperty: (k, v) => { el.vars[k] = String(v); }, getPropertyValue: k => el.vars[k] ?? '' },
      getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); },
      hasAttribute: k => k in el.attrs, classList: { toggle() {} },
      querySelector: () => null, querySelectorAll: () => []
    };
    return el;
  };
  const item = mk({ 'data-r': '20', 'data-lbox': '24,-9,94,9' }); // label extends +94px to the right of item centre
  item.vars['--x'] = '310px'; item.vars['--y'] = '200px';         // item body [290..330] fits 360px screen, but label [334..404] sticks out!
  const menu = mk({ 'data-kind': 'popup', 'data-keep': '1', 'data-show-labels': '1', 'data-label-pos': 'auto' });
  const pt = () => { const p = { x: 0, y: 0, matrixTransform: () => ({ x: p.x, y: p.y }) }; return p; };
  const btn = mk({});
  btn.ownerSVGElement = { createSVGPoint: pt, getBoundingClientRect: () => ({ left: 0, top: 0, right: 360, bottom: 640, width: 360 }) };
  btn.getScreenCTM = () => ({ a: 1, inverse() { return this; } });
  btn.getBoundingClientRect = () => ({ width: 48 });
  btn.querySelector = s => (s === '.ud-menu' ? menu : null);
  btn.querySelectorAll = s => (s === '.rm-level.is-active .rm-item' ? [item] : []);
  bindMenus({ addEventListener() {}, querySelectorAll: () => [] }, {}).apply(btn, { open: true, path: [] });
  assert.ok(parseFloat(menu.vars['--sx']) <= -48, `menu shifted left so label stays inside 360px screen (--sx=${menu.vars['--sx']})`);

  // Inspector exposes both mc-*-orientation and mc-*-labels controls
  const insp = readFileSync(new URL('../interfaces/web/js/components/inspector.js', import.meta.url), 'utf8');
  assert.match(insp, /mc-\$\{bid\}-orientation/);
  assert.match(insp, /mc-\$\{bid\}-labels/);
});
