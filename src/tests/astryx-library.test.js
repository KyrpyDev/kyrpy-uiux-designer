import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { ASTRYX_THEMES, ASTRYX_THEME_KEYS } from '../domain/astryx-theme-catalog.js';
import { buildThemeDefs, BUILTIN_THEMES } from '../domain/theme.js';
import {
  solveSpring,
  springFromWWDC,
  rubberBand,
  rubberBandClamp,
  solveDecay,
  createAnimator,
  mount,
  unmount
} from '../domain/astryx-motion-runtime.js';
import {
  ASTRYX_BUTTONS,
  ASTRYX_ELEMENTS,
  ASTRYX_SCREENS,
  ASTRYX_WORKFLOWS
} from '../infrastructure/import/astryx-catalog.js';
import { ASTRYX_EXTENDED_ELEMENTS } from '../infrastructure/import/astryx-catalog-extended.js';

test('Astryx extended catalog: at least 100 unique, valid public elements across the requested domains', () => {
  assert.ok(ASTRYX_EXTENDED_ELEMENTS.length >= 100, `expected >= 100 elements, got ${ASTRYX_EXTENDED_ELEMENTS.length}`);
  const keys = new Set(ASTRYX_EXTENDED_ELEMENTS.map(e => e.key));
  assert.equal(keys.size, ASTRYX_EXTENDED_ELEMENTS.length, 'element keys must be unique');
  const cats = new Set(ASTRYX_EXTENDED_ELEMENTS.map(e => e.category));
  for (const c of ['admin', 'users', 'credits', 'apikeys', 'reports', 'cards', 'auth', 'config', 'subscriptions', 'popups', 'files']) {
    assert.ok(cats.has(c), `missing category ${c}`);
  }
  for (const e of ASTRYX_EXTENDED_ELEMENTS) {
    assert.ok(e.nodes.length > 0, `${e.key} has no nodes`);
    assert.ok(e.nodes.every(n => n && n.tag && n.attrs), `${e.key} has an invalid node`);
  }
});

test('Astryx Themes: 8 families in dark & light pairs with matching SVG defs', () => {
  assert.equal(ASTRYX_THEMES.length, 16, 'Expected 16 themes (8 families x 2 modes)');

  const expectedFamilies = [
    'Astryx Neutral',
    'Astryx Butter',
    'Astryx Chocolate',
    'Astryx Gothic',
    'Astryx Matcha',
    'Astryx Probe',
    'Astryx Stone',
    'Astryx Y2K'
  ];

  for (const fam of expectedFamilies) {
    const dark = ASTRYX_THEMES.find(t => t.tokens.styleFamily === fam && t.tokens.mode === 'dark');
    const light = ASTRYX_THEMES.find(t => t.tokens.styleFamily === fam && t.tokens.mode === 'light');
    assert.ok(dark, `Dark mode theme for ${fam} must exist`);
    assert.ok(light, `Light mode theme for ${fam} must exist`);
    assert.equal(dark.tokens.pairKey, light.key, `Dark theme ${dark.key} must point to ${light.key}`);
    assert.equal(light.tokens.pairKey, dark.key, `Light theme ${light.key} must point to ${dark.key}`);
  }

  // All Astryx themes produce identical paint/filter IDs as the core themes
  const refIds = [...buildThemeDefs(BUILTIN_THEMES[0]).matchAll(/ id="([^"]+)"/g)].map(m => m[1]).sort().join(',');
  for (const th of ASTRYX_THEMES) {
    const ids = [...buildThemeDefs(th).matchAll(/ id="([^"]+)"/g)].map(m => m[1]).sort().join(',');
    assert.equal(ids, refIds, `Theme ${th.key} must define all standard filter and gradient IDs`);
  }
});

test('Astryx Motion Physics: Apple/WWDC springs, rubber-band & momentum decay', () => {
  // 1. WWDC spring conversion
  const physics = springFromWWDC(0.5, 0.2);
  assert.equal(physics.mass, 1);
  assert.ok(physics.stiffness > 0);
  assert.ok(physics.damping > 0);

  // 2. solveSpring closed-form solution
  const spring = solveSpring({ from: 0, to: 100, mass: 1, stiffness: 180, damping: 12 });
  assert.equal(spring.from, 0);
  assert.equal(spring.to, 100);
  assert.equal(Math.round(spring.value(0)), 0);
  assert.ok(spring.settlingDuration > 0 && spring.settlingDuration < 10);
  // Settle value should be within 0.1% of target
  assert.ok(Math.abs(spring.value(spring.settlingDuration) - 100) < 1.0);

  // 3. rubberBand resistance past edge
  const rb0 = rubberBand(0, 300);
  assert.equal(rb0, 0);
  const rb50 = rubberBand(50, 300);
  assert.ok(rb50 > 0 && rb50 < 50, 'Rubber-band must resist displacement past boundary');

  const clamped = rubberBandClamp(350, 0, 300, 300);
  assert.ok(clamped > 300 && clamped < 350);

  // 4. solveDecay momentum coast
  const decay = solveDecay({ from: 0, velocity: 1200 });
  assert.ok(decay.rest > 0);
  assert.equal(decay.value(0), 0);
  assert.ok(decay.value(0.5) > 0 && decay.value(0.5) < decay.rest);

  // 5. Mount & unmount lifecycle
  const fakeElement = { style: {} };
  const fakeContainer = {
    firstElementChild: fakeElement,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  mount(fakeContainer, { autoPlay: false });
  assert.ok(fakeContainer.__astryxMotion, '__astryxMotion handle must be attached on mount');
  unmount(fakeContainer);
  assert.equal(fakeContainer.__astryxMotion, undefined, '__astryxMotion must be cleaned up on unmount');
});

test('Astryx Ingestion Pipeline: Seeds themes, buttons, elements, screens & workflows into library', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  try {
    const stats1 = c.importer.ensureAstryxLibrary();
    assert.equal(stats1.themes, 16);
    assert.equal(stats1.buttons, ASTRYX_BUTTONS.length);
    assert.equal(stats1.elements, ASTRYX_ELEMENTS.length + ASTRYX_EXTENDED_ELEMENTS.length);
    assert.equal(stats1.screens, ASTRYX_SCREENS.length);
    assert.equal(stats1.workflows, ASTRYX_WORKFLOWS.length);

    // Verify idempotency
    const stats2 = c.importer.ensureAstryxLibrary();
    assert.equal(stats2.themes, 0);
    assert.equal(stats2.buttons, 0);
    assert.equal(stats2.elements, 0);
    assert.equal(stats2.screens, 0);
    assert.equal(stats2.workflows, 0);

    // Verify elements exist in service
    const elements = c.services.element.list();
    for (const def of ASTRYX_ELEMENTS) {
      const found = elements.find(e => e.key === def.key);
      assert.ok(found, `Element "${def.key}" must be stored in database`);
      assert.equal(found.category, def.category);
    }

    // Verify screens exist and can be rendered into valid SVG
    const screens = c.services.screen.list();
    for (const sdef of ASTRYX_SCREENS) {
      const found = screens.find(s => s.key === sdef.key);
      assert.ok(found, `Screen "${sdef.key}" must be stored in database`);

      // Render across multiple Astryx design styles
      const svgNeutral = c.render.screenSvg(found.id, 'astryx-neutral-dark');
      assert.ok(svgNeutral.includes('<svg'), `Screen ${found.key} must render to valid SVG in neutral dark`);

      const svgButter = c.render.screenSvg(found.id, 'astryx-butter-light');
      assert.ok(svgButter.includes('<svg'), `Screen ${found.key} must render to valid SVG in butter light`);

      const svgProbe = c.render.screenSvg(found.id, 'astryx-probe-dark');
      assert.ok(svgProbe.includes('<svg'), `Screen ${found.key} must render to valid SVG in probe dark`);
    }

    // Verify workflow
    const workflows = c.workflows.list();
    const wf = workflows.find(w => w.key === 'astryx-workflow-app');
    assert.ok(wf, 'Astryx master workflow must be created');
    const fullWf = c.workflows.get(wf.id);
    assert.equal(fullWf.nodes.length, 5, 'Workflow must place all 5 Astryx screens');
    assert.equal(fullWf.links.length, 5, 'Workflow must connect screens with 5 route links');
  } finally {
    c.close();
  }
});

test('Astryx HTTP API & Web Assets: motion runtime and themed SVG endpoints serve correctly', async () => {
  const { createHttpServer } = await import('../interfaces/http/server.js');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = dirname(fileURLToPath(import.meta.url));

  const c = buildContainer({ dbFile: ':memory:' });
  c.importer.ensureAstryxLibrary();

  const server = createHttpServer(c, {
    webRoot: join(here, '..', 'interfaces', 'web'),
    domainRoot: join(here, '..', 'domain')
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // 1. Static asset: /domain/astryx-motion-runtime.js
    const runtimeRes = await fetch(`${base}/domain/astryx-motion-runtime.js`);
    assert.equal(runtimeRes.status, 200);
    assert.match(runtimeRes.headers.get('content-type'), /javascript/);
    const runtimeJs = await runtimeRes.text();
    assert.ok(runtimeJs.includes('solveSpring'));

    // 2. Static asset: /js/astryx-motion.js
    const clientRes = await fetch(`${base}/js/astryx-motion.js`);
    assert.equal(clientRes.status, 200);
    const clientJs = await clientRes.text();
    assert.ok(clientJs.includes('/domain/astryx-motion-runtime.js'));

    // 3. API: /api/screens/:id/svg with Astryx themes
    const screens = c.services.screen.list();
    const chatScreen = screens.find(s => s.key === 'astryx-screen-ai-chat');
    assert.ok(chatScreen, 'astryx-screen-ai-chat must exist');

    const svgRes = await fetch(`${base}/api/screens/${chatScreen.id}/svg?theme=astryx-gothic-dark`);
    assert.equal(svgRes.status, 200);
    const svgText = await svgRes.text();
    assert.ok(svgText.includes('<svg'));
  } finally {
    server.close();
    c.close();
  }
});
