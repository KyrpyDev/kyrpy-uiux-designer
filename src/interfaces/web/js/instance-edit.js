/**
 * Editing ONE placed copy of a library button / element in its designer (✎ on the placed item of a screen).
 *
 * While a session is open, the designer works on an in-memory copy of the library item: every design call for that
 * item (nodes, size, meta, menu settings) is answered here, and the result is written into the placed node of the
 * host screen (attr data-own-design, menu settings in data-menu-config). The library item is never written and no new
 * library item is created. Calls that would change the library item's identity or its menu item rows are refused:
 * those belong to the library item's own designer.
 */
import { api, ApiError } from './api.js';
import { normalizeNode } from '/domain/entities.js';
import { translateAttrs, scaleNodeSet } from '/domain/geometry.js';
import { ownDesignOf, ownDesignAttr, OWN_DESIGN_ATTR } from '/domain/instance-design.js';
import { menuConfig, nodeMenuOverride, nodeMenuAttr, NODE_MENU_ATTR } from '/domain/menu.js';

let session = null;   // { type, id, host: { type, id, nodeId, name }, hostNode, lib, doc }
const raw = {};       // the real api methods
const deep = o => JSON.parse(JSON.stringify(o));
const LIB_ONLY = 'This is a placed copy: open the library item itself (“Edit the library item”) to change that.';

export function instanceSession() { return session; }
export function isInstanceDoc(type, id) { return !!session && session.type === type && Number(session.id) === Number(id); }

/** Opens a session for `node` (an instance placed on host { type, id, name }); resolves the copy's design record. */
export async function startInstanceEdit(host, node) {
  install();
  const lib = await raw.getDesign(node.refType, node.refId);
  const doc = deep(lib), own = ownDesignOf(node);
  if (own) {
    doc.nodes = deep(own.nodes);
    if (own.width) doc.width = own.width;
    if (own.height) doc.height = own.height;
    doc.meta = { ...(doc.meta || {}), ...own.meta };
  }
  const ids = new Set(doc.nodes.map(n => n.id));
  doc.animations = (doc.animations || []).filter(a => ids.has(a.nodeId));   // the library item's animations, shown, not edited here
  session = { pending: true, type: node.refType, id: Number(node.refId), host: { type: host.type, id: Number(host.id), nodeId: node.id, name: host.name || '' }, hostNode: deep(node), lib, doc };
  if (node.refType === 'button') applyMenu();
  return deep(doc);
}

export function endInstanceEdit() { session = null; }

/** A designer is loading (type, id): true when that opens the placed copy just started; any other load ends the session. */
export function claimInstanceLoad(type, id) {
  if (!session) return false;
  const ok = session.pending && isInstanceDoc(type, id);
  if (ok) session.pending = false; else session = null;
  return ok;
}

/** Drops the copy's own design: the placed item follows the library item again. */
export async function dropOwnDesign(hostType, hostId, node) {
  const attrs = { ...(node.attrs || {}) };
  delete attrs[OWN_DESIGN_ATTR];
  return api.patchNode(hostType, hostId, node.id, { attrs });
}

/* ---------- internals ---------- */

function applyMenu() {
  const s = session, o = nodeMenuOverride(s.hostNode);
  s.doc.meta = { ...(s.doc.meta || {}), menu: { ...menuConfig(s.lib.meta), ...o.cfg } };
  s.doc.menuItems = (s.lib.menuItems || []).map(it => (o.items[String(it.id)] ? { ...it, visible: o.items[String(it.id)].visible } : { ...it }));
}

async function writeHost(attrs) {
  const s = session;
  const saved = await raw.patchNode(s.host.type, s.host.id, s.host.nodeId, { attrs });
  if (session === s) s.hostNode = saved || { ...s.hostNode, attrs };
}

async function persist() {
  const s = session, d = s.doc;
  const { menu, ...meta } = d.meta || {};   // the menu settings are kept in their own attribute
  await writeHost({ ...(s.hostNode.attrs || {}), [OWN_DESIGN_ATTR]: ownDesignAttr({ nodes: d.nodes, width: d.width, height: d.height, meta }) });
  return deep(d);
}

const nextId = () => Math.max(0, ...session.doc.nodes.map(n => Number(n.id) || 0)) + 1;
const nextOrd = parentId => Math.max(-1, ...session.doc.nodes.filter(n => (n.parentId ?? null) === (parentId ?? null)).map(n => Number(n.ord) || 0)) + 1;

function makeNode(input, extra = {}) {
  const n = normalizeNode({ ...input }, { partial: false });
  return { ...n, ...extra, id: extra.id ?? nextId(), ownerType: session.type, ownerId: session.id, parentId: extra.parentId !== undefined ? extra.parentId : (n.parentId ?? null),
    ord: extra.ord ?? (input.ord != null ? Number(input.ord) : nextOrd(n.parentId ?? null)) };
}

function subtree(id) {
  const out = new Set([id]);
  for (let grew = true; grew;) { grew = false; for (const n of session.doc.nodes) if (n.parentId != null && out.has(n.parentId) && !out.has(n.id)) { out.add(n.id); grew = true; } }
  return out;
}

const mine = (type, id) => isInstanceDoc(type, id);
const refuse = () => { throw new ApiError(LIB_ONLY, { code: 'INSTANCE_COPY' }, 409); };

function install() {
  if (raw.getDesign) return;
  const wrap = (name, fn) => { raw[name] = api[name]; api[name] = fn; };

  wrap('getDesign', (type, id) => (mine(type, id) ? Promise.resolve(deep(session.doc)) : raw.getDesign(type, id)));

  wrap('updateDesign', async (type, id, body = {}) => {
    if (!mine(type, id)) return raw.updateDesign(type, id, body);
    const d = session.doc;
    for (const k of Object.keys(body)) if (!['width', 'height', 'meta', 'scaleContent'].includes(k)) refuse();   // name, key, visibility ... are the library item's
    const w = Number(body.width) > 0 ? Number(body.width) : d.width, hh = Number(body.height) > 0 ? Number(body.height) : d.height;
    if (body.scaleContent && (w !== d.width || hh !== d.height)) {
      const scaled = new Map(scaleNodeSet(d.nodes, w / d.width, hh / d.height).map(n => [n.id, n.attrs]));
      d.nodes = d.nodes.map(n => (scaled.has(n.id) ? { ...n, attrs: scaled.get(n.id) } : n));
    }
    d.width = w; d.height = hh;
    if (body.meta) { const { menu, ...m } = body.meta; d.meta = { ...m, menu: d.meta?.menu }; }
    return persist();
  });

  wrap('addNode', async (type, id, el) => {
    if (!mine(type, id)) return raw.addNode(type, id, el);
    const n = makeNode(el);
    session.doc.nodes.push(n);
    await persist();
    return deep(n);
  });

  wrap('patchNode', async (type, id, eid, patch) => {
    if (!mine(type, id)) return raw.patchNode(type, id, eid, patch);
    const d = session.doc, i = d.nodes.findIndex(n => n.id === Number(eid));
    if (i < 0) throw new ApiError('Element not found in this placed copy', null, 404);
    const p = normalizeNode({ ...patch }, { partial: true });
    d.nodes[i] = { ...d.nodes[i], ...p, ...(p.attrs ? { attrs: { ...p.attrs } } : {}) };
    await persist();
    return deep(d.nodes[i]);
  });

  wrap('deleteNode', async (type, id, eid) => {
    if (!mine(type, id)) return raw.deleteNode(type, id, eid);
    const gone = subtree(Number(eid)), d = session.doc;
    d.nodes = d.nodes.filter(n => !gone.has(n.id));
    d.animations = (d.animations || []).filter(a => !gone.has(a.nodeId));
    await persist();
    return { ok: true };
  });

  wrap('duplicateNode', async (type, id, eid) => {
    if (!mine(type, id)) return raw.duplicateNode(type, id, eid);
    const d = session.doc, src = d.nodes.find(n => n.id === Number(eid));
    if (!src) throw new ApiError('Element not found in this placed copy', null, 404);
    const copyTree = (n, parentId, top) => {
      const made = { ...deep(n), id: nextId(), parentId, ord: nextOrd(parentId), name: top && n.name ? `${n.name}-copy` : n.name, attrs: top ? translateAttrs(n, 12, 12) : deep(n.attrs || {}) };
      d.nodes.push(made);
      for (const k of d.nodes.filter(c => c.parentId === n.id && c.id !== made.id)) copyTree(k, made.id, false);
      return made;
    };
    const made = copyTree(src, src.parentId ?? null, true);
    await persist();
    return deep(made);
  });

  wrap('replaceNodes', async (type, id, nodes) => {
    if (!mine(type, id)) return raw.replaceNodes(type, id, nodes);
    session.doc.nodes = [];
    for (const n of nodes || []) { const { animations, ...rest } = n; session.doc.nodes.push(makeNode(rest, { id: n.id ?? undefined, parentId: n.parentId ?? null, ord: n.ord })); }
    await persist();
    return deep(session.doc);
  });

  wrap('restoreDesign', async (type, id, snap) => {
    if (!mine(type, id)) return raw.restoreDesign(type, id, snap);
    const d = session.doc, r = snap?.record || {};
    if (r.width > 0) d.width = Number(r.width);
    if (r.height > 0) d.height = Number(r.height);
    if (r.meta) { const { menu, ...m } = r.meta; d.meta = { ...m, menu: d.meta?.menu }; }
    if (Array.isArray(snap?.nodes)) d.nodes = snap.nodes.map(({ animations, ...n }) => deep(n));
    await persist();
    return deep(d);
  });

  for (const name of ['addAnimation', 'updateAnimation', 'deleteAnimation']) {
    wrap(name, (type, id, ...rest) => (mine(type, id)
      ? Promise.reject(new ApiError('Animations of a placed copy are set on the screen: select the placed item there and use its Animations section.', null, 409))
      : raw[name](type, id, ...rest)));
  }
  for (const name of ['saveToTargets', 'cloneDesign', 'publishToPublic']) {
    wrap(name, (...args) => {
      const [a, b] = args, type = typeof a === 'object' ? a?.type : a, id = typeof a === 'object' ? a?.id : b;
      return mine(type, id) ? Promise.reject(new ApiError(LIB_ONLY, null, 409)) : raw[name](...args);
    });
  }

  // menu: the settings and the shown / hidden items of this placed copy (the item rows stay the library button's)
  wrap('menu', id => (mine('button', id) ? Promise.resolve({ buttonId: Number(id), config: deep(session.doc.meta.menu), items: deep(session.doc.menuItems || []) }) : raw.menu(id)));
  wrap('menuConfig', async (id, patch) => {
    if (!mine('button', id)) return raw.menuConfig(id, patch);
    const o = nodeMenuOverride(session.hostNode);
    const attrs = { ...(session.hostNode.attrs || {}) }, v = nodeMenuAttr({ ...o, cfg: { ...o.cfg, ...patch } });
    if (v) attrs[NODE_MENU_ATTR] = v; else delete attrs[NODE_MENU_ATTR];
    await writeHost(attrs);
    applyMenu();
    return deep(session.doc.meta.menu);
  });
  wrap('updateMenuItem', async (id, iid, patch = {}) => {
    if (!mine('button', id)) return raw.updateMenuItem(id, iid, patch);
    if (Object.keys(patch).some(k => k !== 'visible')) refuse();
    const o = nodeMenuOverride(session.hostNode), base = (session.lib.menuItems || []).find(r => r.id === Number(iid));
    const items = { ...o.items };
    if (!!patch.visible === (base?.visible !== false)) delete items[String(iid)]; else items[String(iid)] = { visible: !!patch.visible };
    const attrs = { ...(session.hostNode.attrs || {}) }, v = nodeMenuAttr({ ...o, items });
    if (v) attrs[NODE_MENU_ATTR] = v; else delete attrs[NODE_MENU_ATTR];
    await writeHost(attrs);
    applyMenu();
    return deep(session.doc.menuItems.find(r => r.id === Number(iid)));
  });
  for (const name of ['addMenuItem', 'moveMenuItem', 'deleteMenuItem']) {
    wrap(name, (id, ...rest) => (mine('button', id) ? Promise.reject(new ApiError(LIB_ONLY, null, 409)) : raw[name](id, ...rest)));
  }
}
