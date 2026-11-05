import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildContainer } from '../composition-root.js';
import { openDatabase } from '../infrastructure/sqlite/database.js';
import { MIGRATIONS } from '../infrastructure/sqlite/migrations.js';
import { parsePath, serializePath, moveAnchor, insertPoint, deletePoint, convertSegment, toggleClosed, shapeToCommands, editPoints, arcToCubics } from '../domain/path-data.js';
import { nodeBBox } from '../domain/geometry.js';
import { layoutItems, buildMenuTree, renderMenu } from '../domain/menu.js';
import { createContext } from '../domain/svg.js';
import { BUILTIN_THEMES } from '../domain/theme.js';
import { ValidationError } from '../domain/errors.js';
import { bindMenus } from '../domain/menu-runtime.js';

const fresh = () => buildContainer({ dbFile: ':memory:' });
const inst = (refType, refId, attrs = {}) => ({ tag: 'use', kind: 'instance', refType, refId, attrs: { x: 0, y: 0, width: 24, height: 24, ...attrs } });

/* ---------------- vertex editing model ---------------- */
test('path data: parse every command form and round-trip', () => {
  const d = 'M4 4h10v6H4z M20 20c1 1 2 1 3 0s2-1 3 0q1 1 2 0t2 0 a2 2 0 0 1 2 2 l1-1V5';
  const cmds = parsePath(d);
  assert.deepEqual(cmds[0], { t: 'M', x: 4, y: 4 });
  assert.deepEqual(cmds[1], { t: 'L', x: 14, y: 4 });                 // relative h
  assert.equal(cmds[4].t, 'Z');
  const again = parsePath(serializePath(cmds));
  assert.equal(again.length, cmds.length);
  assert.deepEqual(again.map(c => c.t), cmds.map(c => c.t));
  assert.ok(cmds.some(c => c.t === 'C' && c.x1 !== undefined), 'S became an explicit cubic');
  assert.ok(cmds.some(c => c.t === 'A'));
});

test('path data: packed arc flags and implicit repeats', () => {
  const c = parsePath('M0 0a1 1 0 011 1 1 1 0 001 1');
  assert.equal(c.filter(x => x.t === 'A').length, 2);
  assert.equal(c[1].large, 0); assert.equal(c[1].sweep, 1);
  assert.equal(parsePath('M0 0 10 10 20 0').filter(x => x.t === 'L').length, 2);
  assert.throws(() => parsePath('M0 0 X'));
});

test('path data: edits (move, insert, delete, convert, close)', () => {
  const sq = parsePath('M0 0L10 0L10 10L0 10Z');
  const moved = moveAnchor(sq, 1, 12, -2);
  assert.deepEqual([moved[1].x, moved[1].y], [12, -2]);
  assert.deepEqual([sq[1].x, sq[1].y], [10, 0], 'input is not mutated');
  const ins = insertPoint(sq, 2, 0.5);
  assert.equal(ins.length, sq.length + 1); assert.deepEqual([ins[2].x, ins[2].y], [10, 5]);
  const del = deletePoint(sq, 2);
  assert.equal(del.filter(c => c.t !== 'Z').length, 3);
  assert.equal(deletePoint(parsePath('M0 0L1 1'), 1), null, 'keeps at least two vertices');
  const curve = convertSegment(sq, 1, 'curve');
  assert.equal(curve[1].t, 'C');
  const split = insertPoint(curve, 1, 0.5);
  assert.equal(split[1].t, 'C'); assert.equal(split[2].t, 'C'); assert.ok(Math.abs(split[1].x - 5) < 1e-9);
  assert.equal(convertSegment(curve, 1, 'line')[1].t, 'L');
  assert.equal(toggleClosed(parsePath('M0 0L1 1')).at(-1).t, 'Z');
  const { anchors, handles } = editPoints(curve);
  assert.equal(anchors.length, 4); assert.equal(handles.length, 2);
});

test('path data: any basic shape becomes editable, arcs convert to cubics keeping their end points', () => {
  const rr = shapeToCommands('rect', { x: 0, y: 0, width: 20, height: 10, rx: 3 });
  assert.ok(rr.some(c => c.t === 'A'));
  const cubic = convertSegment(rr, rr.findIndex(c => c.t === 'A'), 'curve');
  assert.ok(cubic.some(c => c.t === 'C'));
  const circle = shapeToCommands('circle', { cx: 10, cy: 10, r: 5 });
  const cs = arcToCubics({ x: 5, y: 10 }, circle[1]);
  assert.ok(cs.length >= 2); assert.ok(Math.abs(cs.at(-1).x - 15) < 1e-9);
  assert.deepEqual(nodeBBox({ tag: 'path', attrs: { d: serializePath(circle) } }).w >= 9, true);
  assert.equal(shapeToCommands('text', {}), null);
});

/* ---------------- hierarchy ---------------- */
test('hierarchy: paths -> icons -> buttons -> elements -> screens, nothing skips or loops', () => {
  const c = fresh();
  const p = c.path.create({ name: 'Bar' }, { nodes: [{ tag: 'path', attrs: { d: 'M4 12h16' } }] });
  const p2 = c.path.create({ name: 'Wrapper' }, { nodes: [inst('path', p.id)] });                 // path groups can nest
  const ic = c.icon.create({ name: 'Bar icon' }, { nodes: [inst('path', p2.id)] });
  assert.throws(() => c.icon.create({ name: 'Bad' }, { nodes: [inst('button', 1)] }), ValidationError, 'icons cannot contain buttons');
  const btn = c.button.create({ name: 'Bar button' }, { nodes: [{ tag: 'rect', role: 'button', attrs: { x: 0, y: 0, width: 64, height: 64, rx: 32 } }, inst('icon', ic.id, { x: 12, y: 12, width: 40, height: 40 })] });
  assert.throws(() => c.button.addNode(btn.id, inst('element', 1)), ValidationError, 'buttons cannot contain elements');
  const el = c.element.create({ name: 'Bar el', width: 100, height: 100 }, { nodes: [inst('button', btn.id, { width: 64, height: 64 })] });
  const el2 = c.element.create({ name: 'Outer el', width: 200, height: 200 }, { nodes: [inst('element', el.id, { width: 100, height: 100 })] });
  assert.throws(() => c.element.addNode(el.id, inst('element', el2.id)), ValidationError, 'no cycles');
  assert.throws(() => c.element.addNode(el.id, inst('element', el.id)), ValidationError, 'no self containment');
  assert.throws(() => c.screen.create({ name: 'S' }, { nodes: [inst('path', p.id)] }), ValidationError, 'screens take icons/buttons/elements only');
  const s = c.screen.create({ name: 'S' }, { nodes: [inst('element', el2.id, { width: 200, height: 200 })] });
  const svg = c.render.screenSvg(s.id, 'liquid');
  assert.match(svg, /<symbol id="i-bar-icon"/);                       // icon symbol reached through element -> button -> icon
  assert.ok(svg.includes('M4 12h16'), 'and the path group two levels below it');
  assert.equal(c.path.get(p.id).usage, 1);
  c.close();
});

test('resizing the bounding box scales every sub node (elements and buttons)', () => {
  const c = fresh();
  const el = c.element.create({ name: 'Box', width: 100, height: 50 }, { nodes: [
    { tag: 'rect', attrs: { x: 10, y: 10, width: 20, height: 10 } },
    { tag: 'text', kind: 'text', text: 'Hi', attrs: { x: 50, y: 40, 'font-size': 10 } },
    { tag: 'path', attrs: { d: 'M0 0L10 10' } }] });
  const big = c.element.update(el.id, { width: 200, height: 100 });
  const rect = big.nodes.find(n => n.tag === 'rect').attrs;
  assert.deepEqual([rect.x, rect.y, rect.width, rect.height], [20, 20, 40, 20]);
  assert.equal(big.nodes.find(n => n.tag === 'text').attrs['font-size'], 20);
  assert.match(big.nodes.find(n => n.tag === 'path').attrs.transform, /scale\(2 2\)/);
  const plain = c.element.update(el.id, { width: 400, height: 100, scaleContent: false });
  assert.equal(plain.nodes.find(n => n.tag === 'rect').attrs.width, 40);
  c.close();
});

/* ---------------- menus ---------------- */
test('menu items: nested add/edit/delete, unique sibling names, depth limit, icons', () => {
  const c = fresh();
  const ic = c.icon.create({ name: 'Dot' }, { nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 3 } }] });
  const b = c.button.create({ name: 'Menu btn', width: 64, height: 64 });
  const a = c.menus.addItem(b.id, { label: 'Share', iconId: ic.id });
  const sub = c.menus.addItem(b.id, { label: 'Mail', parentId: a.id, iconId: ic.id });
  assert.equal(c.menus.get(b.id).tree[0].children[0].path, 'share/mail');
  assert.equal(c.menus.addItem(b.id, { label: 'Share' }).name, 'share-2', 'auto-unique among siblings');
  assert.throws(() => c.menus.addItem(b.id, { label: 'x', name: 'share' }), ValidationError, 'explicit duplicate name');
  assert.throws(() => c.menus.updateItem(a.id, { parentId: sub.id }), ValidationError, 'no move into own child');
  assert.equal(c.menus.updateItem(sub.id, { label: 'E-mail' }).label, 'E-mail');
  assert.throws(() => c.menus.addItem(b.id, { label: 'Bad', iconId: 99999 }), ValidationError);
  let parent = a.id;
  assert.throws(() => { for (let i = 0; i < 10; i++) parent = c.menus.addItem(b.id, { label: `deep ${i}`, parentId: parent }).id; }, ValidationError, 'depth limit');
  c.menus.removeItem(a.id);
  assert.equal(c.menus.get(b.id).items.some(i => i.id === sub.id), false, 'children are deleted with their parent');
  assert.throws(() => c.menus.setConfig(b.id, { layout: 'spiral' }), ValidationError);
  assert.equal(c.menus.setConfig(b.id, { kind: 'rotating', layout: 'fan' }).kind, 'rotating');
  const copy = c.button.clone(b.id, { name: 'Menu copy' });
  assert.equal(copy.menuItems.length, c.menus.get(b.id).items.length, 'clone copies the menu');
  c.close();
});

test('menu layout and markup: every level is pre-rendered, items sit on the fan', () => {
  const cfg = { kind: 'rotating', layout: 'fan', radius: 2, startAngle: -180, sweep: 180, itemScale: 0.5, gap: 0.2, direction: 'up', rotateOnOpen: 45 };
  const pos = layoutItems(cfg, 3, 64);
  assert.ok(Math.abs(pos[0].x + 128) < 1e-6 && Math.abs(pos[1].y + 128) < 1e-6 && Math.abs(pos[2].x - 128) < 1e-6);
  const up = layoutItems({ ...cfg, layout: 'list', direction: 'up' }, 2, 64);
  assert.ok(up[1].y < up[0].y && up[0].y < 0);
  const rows = [{ id: 1, parentId: null, ord: 1, name: 'a', label: 'A', iconId: null }, { id: 2, parentId: 1, ord: 1, name: 'b', label: 'B', iconId: null }, { id: 3, parentId: null, ord: 2, name: 'c', label: 'C', iconId: null }];
  const ctx = createContext({ theme: BUILTIN_THEMES[0] });
  const svg = renderMenu({ button: { key: 'k', width: 64, height: 64 }, cfg, tree: buildMenuTree(rows), ctx, iconKey: () => null });
  assert.equal((svg.match(/class="rm-level"/g) || []).length, 2);     // root + children of "a"
  assert.match(svg, /data-item="a\/b"/); assert.match(svg, /class="rm-center" data-for="a"/); assert.match(svg, /data-rm="center"/);
});

test('menu runtime behaves as specified: open, close, enter, go back, leaf action', () => {
  // tiny DOM stub, enough for bindMenus
  const mk = (attrs = {}) => { const el = { attrs: { ...attrs }, cls: new Set(), kids: [], getAttribute: k => el.attrs[k] ?? null, setAttribute: (k, v) => { el.attrs[k] = String(v); },
    classList: { toggle: (c, on) => (on ? el.cls.add(c) : el.cls.delete(c)) }, querySelector: s => el.querySelectorAll(s)[0] || null, closest: s => (s === '.ud-btn' ? btn : s === el.sel ? el : null) };
    el.querySelectorAll = s => el.kids.filter(k => k.sel === s); return el; };
  const btn = mk({ 'data-menu': 'm' }); btn.sel = '.ud-btn';
  const menu = mk({ 'data-kind': 'rotating' }); menu.sel = '.ud-menu';
  const root = mk(), root1 = mk({ 'data-level': '' }), root2 = mk({ 'data-level': 'a' }), cen = mk({ 'data-for': 'a' });
  root1.sel = root2.sel = '.rm-level'; cen.sel = '.rm-center';
  btn.kids = [menu, root1, root2, cen];
  const centre = mk({ 'data-rm': 'center' }); centre.closest = s => (s === '[data-rm="center"], .rm-item' ? centre : s === '.ud-btn' ? btn : null);
  const itemA = mk({ 'data-item': 'a', 'data-children': '1' }); itemA.closest = s => (s === '[data-rm="center"], .rm-item' ? itemA : s === '.ud-btn' ? btn : null);
  const leaf = mk({ 'data-item': 'a/b', 'data-children': '0', 'data-target': 'home' }); leaf.closest = s => (s === '[data-rm="center"], .rm-item' ? leaf : s === '.ud-btn' ? btn : null);
  let handler; root.addEventListener = (_, fn) => { handler = fn; };
  const actions = [];
  const ctl = bindMenus(root, { onAction: a => actions.push(a) });
  const click = t => handler({ target: t, stopPropagation() {} });
  const level = () => [root1.cls.has('is-active'), root2.cls.has('is-active'), cen.cls.has('is-active')];
  click(centre);   assert.deepEqual(level(), [true, false, false]);     // 1st click opens the root items
  click(itemA);    assert.deepEqual(level(), [false, true, true]);      // item with sub items: its children show, its icon takes the centre
  click(centre);   assert.deepEqual(level(), [true, false, false]);     // centre click goes one level back
  click(centre);   assert.deepEqual(level(), [false, false, false]);    // at the root the next click closes
  assert.equal(btn.attrs['data-open'], '0');
  click(centre); click(itemA); click(leaf);
  assert.equal(actions.length, 1); assert.equal(actions[0].target, 'home'); assert.equal(actions[0].item, 'a/b');
  assert.deepEqual(level(), [false, false, false], 'leaf closes the menu');
  assert.deepEqual(ctl.get(btn), { open: false, path: [] });
});

/* ---------------- migration ---------------- */
test('migration 2 keeps the data of a v1 database (items become elements, elements become nodes)', () => {
  const file = `${process.env.TEMP || '/tmp'}/ud-mig-${process.pid}.db`;
  const old = new DatabaseSync(file);
  old.exec(MIGRATIONS[0]);
  old.exec(`PRAGMA user_version = 1`);
  old.prepare(`INSERT INTO items (key,name,width,height) VALUES ('legacy-item','Legacy',50,50)`).run();
  old.prepare(`INSERT INTO screens (key,name,width,height) VALUES ('s','S',390,844)`).run();
  old.prepare(`INSERT INTO elements (owner_type,owner_id,tag,kind,attrs) VALUES ('item',1,'rect','shape','{"x":1}')`).run();
  old.prepare(`INSERT INTO elements (owner_type,owner_id,tag,kind,ref_type,ref_id,attrs) VALUES ('screen',1,'use','instance','item',1,'{}')`).run();
  old.prepare(`INSERT INTO animations (element_id,type) VALUES (1,'pulse')`).run();
  old.close();
  const db = openDatabase(file);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM elements').get().n, 1, 'library table keeps the item');
  const nodes = db.prepare('SELECT owner_type, ref_type FROM nodes ORDER BY id').all();
  assert.deepEqual(nodes.map(n => [n.owner_type, n.ref_type]), [['element', null], ['screen', 'element']]);
  assert.equal(db.prepare('SELECT node_id FROM animations').get().node_id, 1);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('paths','buttons','menu_items')").all().length === 3);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  db.close();
});
