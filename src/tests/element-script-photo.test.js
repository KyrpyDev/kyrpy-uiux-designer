import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainer } from '../composition-root.js';
import { scriptPhotoUri, isPhotoPlaceholder } from '../domain/image.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEUlEQVR42mP8z8DAwMDAwAAAD/AB/0fN8VEAAAAASUVORK5CYII=';

test('script photo: one literal, split literals (+ / array join), no SVG, no remote URL', () => {
  assert.equal(scriptPhotoUri(`const P = "data:image/png;base64,${PNG}";`), `data:image/png;base64,${PNG}`);
  const split = `const PHOTO = "data:image/png;base64," + [\n  "${PNG.slice(0, 30)}",\n  "${PNG.slice(30)}"\n].join("");`;
  assert.equal(scriptPhotoUri(split), `data:image/png;base64,${PNG}`);
  assert.equal(scriptPhotoUri('const P = "data:image/svg+xml;base64,PHN2Zz4=";'), null);
  assert.equal(scriptPhotoUri('const P = "https://randomuser.me/api/portraits/women/1.jpg";'), null);
  assert.equal(scriptPhotoUri(''), null);
  assert.ok(isPhotoPlaceholder({ tag: 'circle', name: 'photo-placeholder' }));
  assert.ok(isPhotoPlaceholder({ tag: 'rect', name: 'avatar' }));
  assert.ok(!isPhotoPlaceholder({ tag: 'rect', name: 'card' }));
  assert.ok(!isPhotoPlaceholder({ tag: 'text', name: 'photo' }));
});

test('an element whose script carries a photo shows it clipped inside its photo placeholder (alone and placed on a screen)', () => {
  const c = buildContainer({ dbFile: ':memory:' });
  const el = c.services.element.create({ key: 'contact-row', name: 'Contact row', width: 342, height: 76 }, {
    nodes: [
      { kind: 'shape', tag: 'rect', name: 'card', attrs: { x: 0, y: 0, width: 342, height: 76, rx: 20 } },
      { kind: 'shape', tag: 'circle', name: 'photo-placeholder', attrs: { cx: 38, cy: 38, r: 28, fill: '#ccc' } }
    ]
  });
  const theme = c.settings.get().theme;
  assert.doesNotMatch(c.render.svg('element', el.id, theme, {}), /<image/, 'no script: the plain placeholder');
  c.elementScripts.setSync(el.id, { moduleCode: `const PHOTO = "data:image/png;base64," + ["${PNG}"].join("");\nexport function mount(c) {}` });
  const out = c.render.svg('element', el.id, theme, {});
  assert.match(out, /<clipPath id="udphoto-clip-\d+" clipPathUnits="objectBoundingBox"><ellipse/);
  assert.match(out, /<image[^>]*x="10" y="10" width="56" height="56"[^>]*href="data:image\/png;base64,/);
  assert.equal(c.services.element.get(el.id).photo, `data:image/png;base64,${PNG}`);
  assert.ok(c.services.element.listFull().find(d => d.id === el.id).photo);

  const sc = c.services.screen.create({ key: 'contacts', name: 'Contacts', width: 360, height: 640 }, {
    nodes: [{ kind: 'instance', tag: 'use', refType: 'element', refId: el.id, attrs: { x: 8, y: 8, width: 342, height: 76 } }]
  });
  assert.match(c.render.screenSvg(sc.id, theme), /<image[^>]*href="data:image\/png;base64,/);

  c.elementScripts.setSync(el.id, { enabled: false, moduleCode: `const PHOTO = "data:image/png;base64,${PNG}";\nexport function mount(c) {}` });
  assert.doesNotMatch(c.render.svg('element', el.id, theme, {}), /<image/, 'a disabled script shows no photo');
});
