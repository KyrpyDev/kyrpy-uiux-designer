/**
 * AI changesets (milestone M4): an agent proposes creates / updates / deletes against a base version; a
 * human reviews them in the designer; nothing changes before approval.
 *
 *   begin → stage (validated + dry-run applied immediately) → diff → submit → human review → head moves
 *
 * Dry runs: every proposal is applied inside a transaction that is always rolled back. That gives the
 * exact core normalization, the hierarchy rule, reference resolution and the exact contentHash the item
 * will have, with no second implementation of the core rules.
 *
 * Conflicts: an update / delete records the contentHash the agent based it on (`baseHash`). If the live
 * item no longer has that hash at submit, the op conflicts. Ops on other items are independent, so
 * disjoint changes are "rebased" for free.
 */
import { DomainError, NotFoundError, ValidationError, ForbiddenError, ConflictError } from '../../domain/errors.js';
import { canonicalJson } from '../domain/content-hash.js';
import { mergeMcpContext, parseMcpContext } from '../domain/mcp-context.js';
import { validateItemStatic, itemRefs, ITEM_TYPES, LIMITS, contrastWarnings } from '../domain/item-validation.js';
import { parseColor } from '../domain/native-adapters.js';
import { TYPE_TO_TABLE } from '../domain/tables.js';
import { cleanFilePath } from './binding-service.js';
import { fromPortableAction } from '../domain/portable-actions.js';
import { normalizeClickAction, normalizeEventBinding } from '../../domain/entities.js';
import { isUid } from '../domain/uid.js';

const HIER = ITEM_TYPES;   // path → icon → button → element → screen → workflow
const OPEN = ['open', 'conflicted'];
const EXPIRY_MS = 24 * 3600 * 1000;
const RECORD_FIELDS = ['name', 'label', 'descriptionDev', 'category', 'tags', 'meta', 'width', 'height'];
const DIFF_FIELDS = [...RECORD_FIELDS, 'nodes', 'animations', 'menuItems', 'screens', 'links', 'mcpContext'];

export class ValidationFailed extends DomainError {
  constructor(message, details) { super(message, 'VALIDATION_FAILED', 422); this.details = details; }
}
const conflict = (message, details) => Object.assign(new ConflictError(message), { details });

export class ChangesetService {
  /**
   * @param {object} d repo, versions, query, reads, hashes, services, workflows, exporter, collaboration,
   *                   projects, auth, db, transaction, parseSvg, newUid, now
   */
  constructor(d) {
    Object.assign(this, { now: () => new Date(), ...d });
    this.shapeCache = new Map();   // contentHash → shape text (node tree without key/name)
  }

  /* ================= helpers ================= */

  #dryRun(fn) {
    const own = !this.db.isTransaction;
    const sp = `mcp_dry_${Math.random().toString(36).slice(2)}`;
    this.db.exec(own ? 'BEGIN' : `SAVEPOINT ${sp}`);
    try { return fn(); } finally { this.db.exec(own ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`); }
  }

  #project(projectId) {
    const p = this.projects.get(Number(projectId));
    if (!p) throw new NotFoundError('project', projectId);
    return p;
  }

  #mayCreatePublic(projectId) { return this.projects.get(Number(projectId))?.settings?.ai?.mayCreatePublicItems === true; }

  #readable(principal, row) {
    return row.project_id === principal.project.id || row.visibility === 'public'
      || (row.visibility === 'private' && row.creator_id === principal.user.id);
  }

  #scopeOf(principal, row) { return row.project_id === principal.project.id ? 'project' : row.visibility === 'private' ? 'private' : 'public'; }

  #ownerPrincipal(cs) {
    const p = this.#project(cs.projectId);
    return { project: { id: p.id, key: p.key, name: p.name }, user: { id: cs.userId ?? p.ownerId }, apiKeyId: cs.apiKeyId };
  }

  /** The project item an op targets, or null. Throws when the uid names an item of another library. */
  #target(principal, type, item) {
    let row = null, keyTaken = null;
    if (item.uid) {
      row = this.reads.find(type, item.uid);
      if (row && row.project_id !== principal.project.id) {
        throw new ValidationFailed(`${type} ${item.uid} belongs to another library; to change it, stage a copy under a new key without uid`, { errors: [{ code: 'FORBIDDEN', path: 'uid', message: 'not a project item' }] });
      }
    }
    if (!row && item.key) {
      row = this.reads.findInProject(type, item.key, principal.project.id);   // keys are unique per project
    }
    return { row, keyTaken };
  }

  #freeKey(key, projectId) {
    for (let i = 2; i < 1000; i++) {
      const k = `${key}-${i}`;
      if (!ITEM_TYPES.some(t => this.reads.findInProject(t, k, projectId))) return k;
    }
    return `${key}-${Date.now()}`;
  }

  #resolveRef(principal, ref, path) {
    const type = ref.type;
    if (!ITEM_TYPES.includes(type)) throw new ValidationError(`${path}: unknown type "${type}"`);
    const row = (ref.uid && this.reads.find(type, ref.uid)) || (ref.key && this.reads.find(type, ref.key, principal.project.id));
    if (!row) throw new DomainError(`${path}: ${type} "${ref.uid || ref.key}" not found; search for it first or stage it in the same changeset`, 'REF', 422);
    if (!this.#readable(principal, row)) throw new DomainError(`${path}: ${type} "${row.key}" is not visible to this project`, 'REF', 422);
    // project scope: a used item from another library is cloned into the project and referenced there
    return row.project_id === principal.project.id || !this.library ? row.id : this.library.adopt(principal.project.id, type, row.id);
  }

  /* ---------- payload → core ---------- */

  #coreNodes(principal, item, svg) {
    if (svg !== undefined) {
      let parsed;
      try { parsed = this.parseSvg(svg, {}); } catch (e) { throw new ValidationError(`cannot read svg: ${e.message}`); }
      if (!parsed.nodes.length) throw new ValidationError('the svg contains no supported shapes');
      const ids = new Map(parsed.nodes.map((n, i) => [n.id, -(i + 1)]));
      const nodes = parsed.nodes.filter(n => n.kind !== 'instance').map(n => ({ ...n, id: ids.get(n.id), parentId: n.parentId == null ? null : ids.get(n.parentId) ?? null }));
      return { nodes, size: { width: parsed.width, height: parsed.height } };
    }
    if (!Array.isArray(item.nodes)) return null;
    const anims = new Map();
    for (const a of item.animations || []) {
      if (!Number.isInteger(a?.nodeIndex)) continue;
      if (!anims.has(a.nodeIndex)) anims.set(a.nodeIndex, []);
      const { nodeIndex, ...rest } = a;
      anims.get(a.nodeIndex).push(rest);
    }
    return {
      nodes: item.nodes.map((n, i) => {
        const { index, parentIndex, ref, ord, ...rest } = n;
        // action targets are soft references: a target that does not exist yet (for example a screen staged after
        // the button that opens it, or a screen that contains that very button) is patched in after all ops applied
        const port = (a, p, slot) => {
          try { return fromPortableAction(a, (t, path) => this.#resolveRef(principal, t, path), idx => -(idx + 1), p); } catch (e) {
            if (this.fixups && e.code === 'REF' && a?.target) { this.fixups.push({ ...slot, action: a, path: p }); return undefined; }
            throw e;
          }
        };
        if (rest.onClick) rest.onClick = port(rest.onClick, `nodes[${i}].onClick`, { nodeIndex: i, field: 'onClick' }) ?? null;
        if (Array.isArray(rest.events)) rest.events = rest.events.map((e, j) => port(e, `nodes[${i}].events[${j}]`, { nodeIndex: i, field: 'events', eventIndex: j })).filter(e => e !== undefined);
        return {
          ...rest, id: -(i + 1), parentId: Number.isInteger(parentIndex) ? -(parentIndex + 1) : null,
          ...(ref ? { kind: rest.kind || 'instance', refType: ref.type, refId: this.#resolveRef(principal, ref, `nodes[${i}].ref`) } : {}),
          animations: anims.get(i) || []
        };
      })
    };
  }

  #insertMenu(principal, buttonId, menuItems) {
    const menus = this.services.button.menus;
    const idByName = new Map();
    const ref = (r, t, p) => (r && (r.uid || r.key) ? this.#resolveRef(principal, { type: t, ...r }, p) : null);
    menuItems.forEach((m, i) => {
      const made = menus.create(buttonId, {
        name: m.name || `item-${i + 1}`, label: m.label || '', action: m.action || '', ord: Number.isFinite(m.ord) ? m.ord : i,
        parentId: m.parent ? idByName.get(m.parent) ?? null : null,
        iconId: ref(m.icon, 'icon', `menuItems[${i}].icon`), targetScreenId: ref(m.targetScreen, 'screen', `menuItems[${i}].targetScreen`),
        targetElementId: ref(m.targetElement, 'element', `menuItems[${i}].targetElement`),
        refButtonId: m.button ? ref(m.button, 'button', `menuItems[${i}].button`) : null,
        visible: m.visible !== false, descriptionDev: m.descriptionDev || ''
      });
      idByName.set(m.name || `item-${i + 1}`, made.id);
    });
  }

  #screenNodeByName(screenId, name) {
    if (!name) return null;
    return this.db.prepare("SELECT id FROM nodes WHERE owner_type = 'screen' AND owner_id = ? AND name = ? ORDER BY id LIMIT 1").get(screenId, String(name))?.id ?? null;
  }

  #setColumns(type, id, { uid, mcpContext }) {
    const table = TYPE_TO_TABLE[type];
    if (uid) this.db.prepare(`UPDATE ${table} SET uid = ? WHERE id = ?`).run(uid, id);
    if (mcpContext !== undefined) {
      const cur = this.db.prepare(`SELECT mcp_context FROM ${table} WHERE id = ?`).get(id)?.mcp_context;
      const { source, updatedBy, ...patch } = parseMcpContext(mcpContext);
      if (canonicalJson(mergeMcpContext(cur, patch)) === canonicalJson(parseMcpContext(cur))) return;   // nothing new
      const merged = mergeMcpContext(cur, { ...patch, source: 'ai-push', updatedBy: 'kyrpy-agent-designer' });
      this.db.prepare(`UPDATE ${table} SET mcp_context = ? WHERE id = ?`).run(JSON.stringify(merged), id);
    }
  }

  /**
   * Runs fn while collecting deferred action targets, then patches them in. strict: an action whose target
   * still does not exist fails (submit); otherwise it is reported (staging, preview, review).
   */
  #withFixups(principal, fn, { strict = false } = {}) {
    const prev = this.fixups;
    this.fixups = [];
    try {
      const result = fn();
      const unresolved = this.#resolveFixups(principal, this.fixups, { strict });
      return { result, unresolved };
    } finally { this.fixups = prev; }
  }

  #resolveFixups(principal, fixups, { strict }) {
    const unresolved = [];
    for (const f of fixups) {
      const owner = f.ownerUid ? this.reads.find(f.ownerType, f.ownerUid) : null;
      if (!owner) { unresolved.push(f); continue; }
      const nodes = this.db.prepare('SELECT id, ord, on_click, events FROM nodes WHERE owner_type = ? AND owner_id = ? ORDER BY ord, id').all(f.ownerType, owner.id);
      const byOrd = new Map(nodes.map(r => [r.ord, r.id]));
      const node = nodes.find(r => r.ord === f.nodeIndex);
      if (!node) { unresolved.push(f); continue; }
      let act;
      try { act = fromPortableAction(f.action, (t, path) => this.#resolveRef(principal, t, path), idx => byOrd.get(idx) ?? null, f.path); } catch (e) {
        if (e.code === 'REF' && !strict) { unresolved.push(f); continue; }
        throw e;
      }
      if (f.field === 'onClick') {
        this.db.prepare('UPDATE nodes SET on_click = ? WHERE id = ?').run(JSON.stringify(normalizeClickAction(act)), node.id);
      } else {
        const ev = (() => { try { return JSON.parse(node.events || '[]'); } catch { return []; } })();
        ev.splice(Math.min(f.eventIndex, ev.length), 0, normalizeEventBinding(act));
        this.db.prepare('UPDATE nodes SET events = ? WHERE id = ?').run(JSON.stringify(ev), node.id);
      }
    }
    return unresolved;
  }

  /** Staged actions point at nodes by temporary id -(index+1); after insert, point them at the real node ids. */
  #fixNodeTargets(type, ownerId) {
    const rows = this.db.prepare('SELECT id, ord, on_click, events FROM nodes WHERE owner_type = ? AND owner_id = ? ORDER BY ord, id').all(type, ownerId);
    const byIndex = new Map(rows.map(r => [r.ord, r.id]));
    const fix = a => (a && Number(a.targetNodeId) < 0 ? { ...a, targetNodeId: byIndex.get(-Number(a.targetNodeId) - 1) ?? null } : a);
    for (const r of rows) {
      if (!/"targetNodeId":-/.test(`${r.on_click}${r.events}`)) continue;
      const oc = r.on_click ? JSON.parse(r.on_click) : null, ev = r.events ? JSON.parse(r.events) : [];
      this.db.prepare('UPDATE nodes SET on_click = ?, events = ? WHERE id = ?').run(oc ? JSON.stringify(fix(oc)) : r.on_click, JSON.stringify(Array.isArray(ev) ? ev.map(fix) : ev), r.id);
    }
  }

  /** Applies one op to the live tables (inside the caller's transaction). Returns the item id (null for deletes). */
  #applyOne(principal, { op, type, itemUid, key, payload }) {
    const item = payload.item || {};
    const row = op === 'create' ? null : this.reads.find(type, itemUid) || this.reads.findInProject(type, key, principal.project.id);
    if (op !== 'create' && (!row || row.project_id !== principal.project.id)) throw new NotFoundError(type, key);
    if (op === 'delete') {
      (type === 'workflow' ? this.workflows : this.services[type]).remove(row.id, {});
      return null;
    }
    const rec = { key };
    for (const f of RECORD_FIELDS) if (item[f] !== undefined) rec[f] = item[f];
    if (op === 'create' && !rec.name) rec.name = item.label || key;

    if (type === 'workflow') {
      let id = row?.id;
      if (op === 'create') id = this.workflows.create({ ...rec, projectId: principal.project.id, visibility: 'project', creatorId: this.agentUserId?.() ?? principal.user.id }).id;
      else this.workflows.update(id, rec);
      if (op === 'create' || item.screens !== undefined || item.links !== undefined) {
        const cur = op === 'create' ? { nodes: [], links: [] } : this.workflows.get(id);
        const nodes = item.screens !== undefined
          ? item.screens.map((s, i) => ({ screenId: this.#resolveRef(principal, { type: 'screen', ...s.screen }, `screens[${i}].screen`), x: Number(s.x) || 0, y: Number(s.y) || 0, collapsed: !!s.collapsed }))
          : cur.nodes;
        const links = item.links !== undefined
          ? item.links.map((l, i) => {
            const fromScreenId = this.#resolveRef(principal, { type: 'screen', ...l.from }, `links[${i}].from`);
            return { fromScreenId, toScreenId: this.#resolveRef(principal, { type: 'screen', ...l.to }, `links[${i}].to`), fromNodeId: this.#screenNodeByName(fromScreenId, l.fromNodeName),
              name: l.name || '', descriptionDev: l.descriptionDev || '', style: l.style, trigger: l.trigger };
          })
          : cur.links;
        this.workflows.restore(id, { record: {}, nodes, links });
      }
      this.#setColumns(type, id, { uid: op === 'create' ? itemUid : null, mcpContext: item.mcpContext });
      return id;
    }

    const svc = this.services[type];
    const fixStart = this.fixups?.length ?? 0;
    const conv = this.#coreNodes(principal, item, payload.svg);
    const ownerUid = op === 'create' ? itemUid : row.uid;
    for (const f of this.fixups?.slice(fixStart) || []) Object.assign(f, { ownerType: type, ownerUid });
    if (conv?.size && ['button', 'element'].includes(type)) { rec.width ??= conv.size.width; rec.height ??= conv.size.height; }
    let id;
    if (op === 'create') {
      const visibility = item.visibility === 'public' && this.#mayCreatePublic(principal.project.id) ? 'public' : 'project';
      id = svc.create({ ...rec, projectId: principal.project.id, visibility, creatorId: this.agentUserId?.() ?? principal.user.id }, { nodes: conv?.nodes || [] }).id;
    } else {
      id = row.id;
      const d = svc.get(id);
      let nodes = conv?.nodes;
      if (!nodes) {
        const anims = new Map();
        for (const a of d.animations || []) { if (!anims.has(a.nodeId)) anims.set(a.nodeId, []); anims.get(a.nodeId).push(a); }
        nodes = d.nodes.map(n => ({ ...n, animations: anims.get(n.id) || [] }));
      }
      svc.restore(id, { record: rec, nodes, menuItems: item.menuItems !== undefined ? [] : d.menuItems || [] });
    }
    if (conv && !payload.svg) this.#fixNodeTargets(type, id);
    if (type === 'button' && Array.isArray(item.menuItems) && item.menuItems.length) this.#insertMenu(principal, id, item.menuItems);
    this.#setColumns(type, id, { uid: op === 'create' ? itemUid : null, mcpContext: item.mcpContext });
    return id;
  }

  /** Staged creates this item references (transitively), in apply order. */
  #depOps(item, ops, seen = new Set()) {
    const out = [];
    for (const r of itemRefs(item)) {
      const dep = ops.find(o => o.op === 'create' && o.type === r.type && (o.itemUid === r.uid || o.key === r.key));
      if (!dep || seen.has(dep.uid)) continue;
      seen.add(dep.uid);
      out.push(...this.#depOps(dep.payload.item || {}, ops, seen), dep);
    }
    return out;
  }

  #ordered(ops) {
    const live = ops.filter(o => o.op !== 'delete').sort((a, b) => HIER.indexOf(a.type) - HIER.indexOf(b.type) || a.seq - b.seq);
    const dels = ops.filter(o => o.op === 'delete').sort((a, b) => HIER.indexOf(b.type) - HIER.indexOf(a.type) || a.seq - b.seq);
    return [...live, ...dels];
  }

  #shape(type, id, hash) {
    if (hash && this.shapeCache.has(hash)) return this.shapeCache.get(hash);
    const c = JSON.parse(this.hashes.canonical(type, id));
    const shape = canonicalJson({ n: c.n, m: c.m, w: c.r?.[6], h: c.r?.[7] });
    if (hash) this.shapeCache.set(hash, shape);
    return shape;
  }

  #duplicateOf(principal, type, shape, exceptKey) {
    if (type === 'workflow') return null;
    for (const r of this.reads.list(type, { projectId: principal.project.id, userId: principal.user.id, scopes: ['project', 'private', 'public'] })) {
      if (r.key === exceptKey) continue;
      if (this.#shape(type, r.id, this.hashes.get(type, r.id)) === shape) return { type, uid: r.uid, key: r.key, scope: this.#scopeOf(principal, r) };
    }
    return null;
  }

  /**
   * Validates a proposal without storing it: static rules, target, dry-run apply, hash, duplicate check.
   * @returns {{op, type, key, itemUid, row, errors, warnings, fixes, proposedHash, liveHash, unchanged, duplicate}}
   */
  #evaluate(principal, cs, { item, svg, allowDuplicate = false, restore = false }) {
    const type = item?.type;
    const pre = ITEM_TYPES.includes(type) && item.key ? this.#target(principal, type, item) : { row: null, keyTaken: null };
    const op = pre.row ? 'update' : 'create';
    const { errors, warnings, fixes } = validateItemStatic(item, { op: restore ? 'update' : op, svg });   // restored items keep their old docs
    const out = { op, type, key: item?.key, row: pre.row, errors, warnings, fixes, proposedHash: null, liveHash: null, unchanged: false, duplicate: null };
    // D6: AI-created items are project items unless the owner allows public ones
    if (op === 'create' && item?.visibility !== undefined && item.visibility !== 'project') {
      if (item.visibility !== 'public') errors.push({ code: 'VISIBILITY', path: 'visibility', message: 'AI-created items are "project" (or "public" when the project allows it)' });
      else if (!this.#mayCreatePublic(principal.project.id)) {
        errors.push({ code: 'VISIBILITY', path: 'visibility', message: 'this project does not allow AI-created public items (Project AI settings: mayCreatePublicItems)' });
        fixes.push('drop "visibility" (the item becomes a project item)');
      }
    }
    // §14.7: text / background contrast in the default style (warning)
    try { warnings.push(...contrastWarnings(item, this.query.tokens(principal, {}).tokens || {}, parseColor)); } catch { /* no styles */ }
    if (pre.keyTaken) {
      const free = this.#freeKey(item.key, principal.project.id);
      errors.push({ code: 'KEY_TAKEN', path: 'key', message: `key "${item.key}" is already used by a ${this.#scopeOf(principal, pre.keyTaken)} ${type} (${pre.keyTaken.uid}); reference that item instead, or use another key such as "${free}"` });
      fixes.push(`use key "${free}"`);
    }
    if (errors.length) return out;

    const ops = cs ? this.repo.ops(cs.id) : [];
    const staged = cs ? ops.find(o => o.type === type && o.key === item.key) : null;
    // a create keeps a caller-given uid when no row has it (restores and lockfile-stable agents keep identity)
    out.itemUid = pre.row ? pre.row.uid : staged?.op === 'create' ? staged.itemUid
      : (isUid(item.uid) && !this.reads.findByUid(item.uid) ? item.uid : this.newUid());
    try {
      const res = this.#dryRun(() => {
        const { result: id, unresolved } = this.#withFixups(principal, () => {
          for (const dep of this.#depOps(item, ops.filter(o => o.key !== item.key || o.type !== type))) this.#applyOne(principal, dep);
          return this.#applyOne(principal, { op, type, itemUid: out.itemUid, key: item.key, payload: { item, svg } });
        });
        for (const f of unresolved) {
          warnings.push({ code: 'ACTION_TARGET', path: f.path, message: `${f.action.target.type || 'item'} "${f.action.target.uid || f.action.target.key}" does not exist yet; stage it in this changeset before submitting (proposedHash excludes this action)` });
        }
        const hash = this.hashes.get(type, id);
        const ctx = this.db.prepare(`SELECT mcp_context FROM ${TYPE_TO_TABLE[type]} WHERE id = ?`).get(id).mcp_context;
        return { hash, ctx, shape: op === 'create' && !allowDuplicate && type !== 'workflow' ? this.#shape(type, id) : null };
      });
      out.proposedHash = res.hash;
      if (pre.row) {
        out.liveHash = this.hashes.get(type, pre.row.id);
        const curCtx = this.db.prepare(`SELECT mcp_context FROM ${TYPE_TO_TABLE[type]} WHERE id = ?`).get(pre.row.id).mcp_context;
        const ctxSame = item.mcpContext === undefined || canonicalJson(parseMcpContext(curCtx)) === canonicalJson(parseMcpContext(res.ctx));
        out.unchanged = res.hash === out.liveHash && ctxSame;
      }
      if (res.shape) {
        out.duplicate = this.#duplicateOf(principal, type, res.shape, item.key);
        if (out.duplicate) errors.push({ code: 'DUPLICATE', path: 'nodes', message: `an identical ${type} already exists: "${out.duplicate.key}" (${out.duplicate.uid}, ${out.duplicate.scope}); use it instead, or pass allowDuplicate` });
      }
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      errors.push({ code: e.code === 'CONFLICT' ? 'KEY_TAKEN' : ['NOT_FOUND', 'REF'].includes(e.code) ? 'REF' : 'INVALID', path: 'item', message: e.message });
    }
    return out;
  }

  #failed(ev) {
    const first = ev.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ');
    return new ValidationFailed(`${ev.errors.length} validation error(s): ${first}`, { errors: ev.errors, warnings: ev.warnings, fixes: ev.fixes });
  }

  /* ================= changesets (API key side) ================= */

  #changeset(principal, ref) {
    this.repo.expireStale(this.now().toISOString());
    const cs = this.repo.changeset(String(ref || ''));
    if (!cs || cs.projectId !== principal.project.id) throw new NotFoundError('changeset', ref);
    return cs;
  }

  #open(principal, ref) {
    const cs = this.#changeset(principal, ref);
    if (!OPEN.includes(cs.status)) throw conflict(`changeset is ${cs.status}; begin a new one`, { status: cs.status });
    return cs;
  }

  begin(principal, { baseVersion, summary = '', clientInfo = {} } = {}) {
    this.repo.expireStale(this.now().toISOString());
    const head = this.versions.ensureHead(principal.project.id, { userId: principal.user.id });
    let base = head;
    if (baseVersion !== undefined && baseVersion !== null) {
      base = this.repo.byNumber(principal.project.id, baseVersion);
      if (!base) throw new NotFoundError('version', baseVersion);
    }
    const cs = this.repo.insertChangeset({
      uid: this.newUid(), projectId: principal.project.id, baseVersionId: base.id, apiKeyId: principal.apiKeyId, userId: principal.user.id,
      summary: String(summary).slice(0, 500), clientInfo, expiresAt: new Date(this.now().getTime() + EXPIRY_MS).toISOString()
    });
    return { ...this.view(cs), headVersion: head.number, behindHead: base.id !== head.id };
  }

  validate(principal, { item, svg, changeset, allowDuplicate } = {}) {
    const cs = changeset ? this.#changeset(principal, changeset) : null;
    const ev = this.#evaluate(principal, cs, { item, svg, allowDuplicate });
    return { valid: ev.errors.length === 0, op: ev.op, type: ev.type, key: ev.key, uid: ev.itemUid ?? ev.row?.uid ?? null,
      proposedHash: ev.proposedHash, currentHash: ev.liveHash, unchanged: ev.unchanged, errors: ev.errors, warnings: ev.warnings, fixes: ev.fixes };
  }

  stage(principal, { changeset, item, svg, baseHash, allowDuplicate, binding, restore = false } = {}) {
    const cs = this.#open(principal, changeset);
    const existing = item?.type && item?.key ? this.repo.findOp(cs.id, item.type, item.key) : null;
    if (!existing && this.repo.countOps(cs.id) >= LIMITS.opsPerChangeset) throw new ValidationFailed(`a changeset holds at most ${LIMITS.opsPerChangeset} operations; submit this one and begin another`);
    const ev = this.#evaluate(principal, cs, { item, svg, allowDuplicate, restore });
    if (binding !== undefined) {
      if (!binding || typeof binding !== 'object' || !binding.file) ev.errors.push({ code: 'SCHEMA', path: 'binding', message: 'binding needs {file, symbol?, framework?, repo?}' });
      else { try { cleanFilePath(binding.file); } catch (e) { ev.errors.push({ code: 'SCHEMA', path: 'binding.file', message: e.message }); } }
    }
    if (ev.errors.length) throw this.#failed(ev);
    if (ev.unchanged) {
      if (existing) this.repo.deleteOp(existing.id);
      if (binding && this.bindings) {   // code wins for bindings: record it even when the design is unchanged
        this.bindings.upsert(principal.project.id, { type: ev.type, itemUid: ev.row.uid, repo: binding.repo || '', file: binding.file, symbol: binding.symbol || '', framework: binding.framework || '', hash: ev.liveHash, apiKeyId: principal.apiKeyId });
      }
      return { changeset: cs.uid, unchanged: true, op: null, type: ev.type, key: ev.key, uid: ev.row.uid, contentHash: ev.liveHash, warnings: ev.warnings };
    }
    const base = this.repo.version(cs.baseVersionId);
    const baseHash0 = ev.op === 'create' ? null
      : baseHash || base?.manifest.find(e => e.uid === ev.row.uid)?.contentHash || ev.liveHash;
    const saved = this.repo.upsertOp({
      uid: existing?.uid || this.newUid(), changesetId: cs.id, op: ev.op, type: ev.type, itemUid: ev.itemUid, key: ev.key,
      baseHash: baseHash0, proposedHash: ev.proposedHash, payload: { item, ...(svg !== undefined ? { svg } : {}), ...(binding ? { binding } : {}) },
      validation: { warnings: ev.warnings }
    });
    if (cs.status === 'conflicted') this.repo.updateChangeset(cs.id, { status: 'open' }); else this.repo.updateChangeset(cs.id, {});
    return { changeset: cs.uid, unchanged: false, opUid: saved.uid, op: saved.op, type: saved.type, key: saved.key, uid: saved.itemUid,
      baseHash: saved.baseHash, proposedHash: saved.proposedHash, warnings: ev.warnings, staged: this.repo.countOps(cs.id) };
  }

  stageDelete(principal, { changeset, type, ref, baseHash } = {}) {
    const cs = this.#open(principal, changeset);
    if (!ITEM_TYPES.includes(type)) throw new ValidationError(`type must be one of ${ITEM_TYPES.join(', ')}`);
    const stagedCreate = this.repo.ops(cs.id).find(o => o.op === 'create' && o.type === type && (o.key === ref || o.itemUid === ref));
    if (stagedCreate) {
      this.repo.deleteOp(stagedCreate.id);
      return { changeset: cs.uid, unstaged: true, type, key: stagedCreate.key, staged: this.repo.countOps(cs.id) };
    }
    const row = this.reads.find(type, ref, principal.project.id);
    if (!row || row.project_id !== principal.project.id) throw new NotFoundError(`project ${type}`, ref);
    const live = this.hashes.get(type, row.id);
    const base = this.repo.version(cs.baseVersionId);
    const existing = this.repo.findOp(cs.id, type, row.key);
    const saved = this.repo.upsertOp({
      uid: existing?.uid || this.newUid(), changesetId: cs.id, op: 'delete', type, itemUid: row.uid, key: row.key,
      baseHash: baseHash || base?.manifest.find(e => e.uid === row.uid)?.contentHash || live, proposedHash: null, payload: {}, validation: {}
    });
    return { changeset: cs.uid, opUid: saved.uid, op: 'delete', type, key: row.key, uid: row.uid, baseHash: saved.baseHash, staged: this.repo.countOps(cs.id),
      note: 'Approved deletes go to the designer trash (restorable).' };
  }

  discard(principal, { changeset } = {}) {
    const cs = this.#open(principal, changeset);
    return this.view(this.repo.updateChangeset(cs.id, { status: 'discarded' }));
  }

  /** Per-op comparison with the base the agent used and with the live head. */
  #diffOps(principal, cs) {
    return this.repo.ops(cs.id).map(o => {
      const row = this.reads.find(o.type, o.itemUid) || (o.op === 'create' ? this.reads.findInProject(o.type, o.key, principal.project.id) : null);
      const liveRow = row && row.project_id === principal.project.id ? row : null;
      const headHash = liveRow ? this.hashes.get(o.type, liveRow.id) : null;
      let conflictReason = null;
      if (o.status === 'staged' || o.status === 'conflict') {
        if (o.op === 'create' && row) conflictReason = `key "${o.key}" was taken after staging`;
        else if (o.op !== 'create' && !liveRow) conflictReason = 'the item was deleted after the base version';
        else if (o.op !== 'create' && o.baseHash && headHash !== o.baseHash) conflictReason = 'the item changed after the base version';
      }
      let changedFields = [];
      if (o.op === 'update' && liveRow) {
        const cur = this.query.itemJson(principal, liveRow);
        changedFields = DIFF_FIELDS.filter(f => o.payload.item?.[f] !== undefined && canonicalJson(o.payload.item[f]) !== canonicalJson(cur[f]));
        if (o.payload.svg !== undefined) changedFields.push('nodes');
      }
      return {
        opUid: o.uid, op: o.op, type: o.type, key: o.key, uid: o.itemUid, status: o.status,
        baseHash: o.baseHash, headHash, proposedHash: o.proposedHash, changedFields, conflict: !!conflictReason, conflictReason,
        warnings: o.validation?.warnings || [], error: o.error || undefined, itemId: liveRow?.id ?? null
      };
    });
  }

  diff(principal, { changeset } = {}) {
    const cs = this.#changeset(principal, changeset);
    const ops = this.#diffOps(principal, cs);
    const head = this.versions.ensureHead(principal.project.id);
    const base = this.repo.version(cs.baseVersionId);
    const count = op => ops.filter(o => o.op === op).length;
    return { changeset: cs.uid, status: cs.status, baseVersion: base?.number ?? null, headVersion: head.number,
      summary: { create: count('create'), update: count('update'), delete: count('delete'), conflicts: ops.filter(o => o.conflict).length },
      ops: ops.map(({ itemId, ...o }) => o) };
  }

  submit(principal, { changeset, message = '', label = '' } = {}) {
    const cs = this.#open(principal, changeset);
    const ops = this.repo.ops(cs.id);
    if (!ops.length) throw new ValidationFailed('nothing is staged: the app already matches the design. Call uiux_discard_changeset.');
    if (label && !/^[0-9A-Za-z.+-]{1,40}$/.test(label)) throw new ValidationError('label: up to 40 characters of letters, digits, ".", "+" or "-"');
    const diffed = this.#diffOps(principal, cs);
    const conflicts = diffed.filter(o => o.conflict);
    if (conflicts.length) {
      this.transaction(() => {
        for (const c of conflicts) this.repo.updateOp(ops.find(o => o.uid === c.opUid).id, { status: 'conflict' });
        this.repo.updateChangeset(cs.id, { status: 'conflicted' });
      });
      throw conflict(`${conflicts.length} item(s) changed in the designer after your base version. For each: uiux_get_item, merge (design wins for visual attributes), restage with baseHash = headHash, then submit again.`,
        { conflicts: conflicts.map(c => ({ opUid: c.opUid, op: c.op, type: c.type, key: c.key, uid: c.uid, baseHash: c.baseHash, headHash: c.headHash, proposedHash: c.proposedHash, reason: c.conflictReason })) });
    }
    // the whole changeset must apply cleanly (references between ops, hierarchy …)
    try { this.#dryRun(() => this.#withFixups(principal, () => { for (const o of this.#ordered(ops)) this.#applyOne(principal, o); }, { strict: true })); } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      throw new ValidationFailed(`the changeset does not apply: ${e.message}`, { errors: [{ code: 'APPLY', path: 'changeset', message: e.message }] });
    }
    const project = this.#project(cs.projectId);
    const byUid = new Map(diffed.map(d => [d.opUid, d]));
    const done = this.transaction(() => {
      const head = this.versions.ensureHead(cs.projectId);
      const v = this.versions.createPending({ projectId: cs.projectId, parentId: head.id, changesetId: cs.id, source: cs.clientInfo?.restoreOf ? 'restore' : 'ai-push', message: String(message).slice(0, 2000), label, userId: principal.user.id, apiKeyId: principal.apiKeyId });
      for (const o of ops) {
        const d = byUid.get(o.uid);
        const row = d.itemId ? this.reads.find(o.type, d.itemId) : null;
        const cr = this.collaboration.changes.create({
          projectId: cs.projectId, targetType: o.type, targetId: row?.id ?? 0, targetKey: o.key, targetName: o.payload.item?.name || row?.name || o.key,
          authorId: this.agentUserId?.() ?? principal.user.id, ownerId: project.ownerId, action: `ai-${o.op}`,
          summary: `AI ${o.op} of ${o.type} "${o.key}"${d.changedFields.length ? ` (fields: ${d.changedFields.join(', ')})` : ''} — changeset ${cs.uid.slice(0, 8)}`,
          beforeSnapshot: row ? { item: this.query.itemJson(principal, row) } : {},
          afterSnapshot: { mcp: { changesetUid: cs.uid, opUid: o.uid }, item: o.payload.item || null },
          diffSummary: { changedFields: d.changedFields, op: o.op, baseHash: o.baseHash, proposedHash: o.proposedHash }, status: 'pending'
        });
        this.repo.updateOp(o.id, { changeRequestId: cr.id });
      }
      return this.repo.updateChangeset(cs.id, { status: 'submitted', message: String(message).slice(0, 2000), resultVersionId: v.id, submittedAt: this.now().toISOString() });
    });
    if (project.settings?.ai?.pushRequiresReview === false) {
      this.review(done.uid, { approve: ops.map(o => o.uid), comment: 'auto-approved (project setting pushRequiresReview = off)' }, null, { auto: true });
    }
    return this.view(this.repo.changeset(done.id));
  }

  get(principal, { changeset } = {}) { return this.view(this.#changeset(principal, changeset)); }

  /**
   * Restore: a changeset that brings the project back to version N (re-creates removed items with their
   * original uid, rolls changed items back to their stored JSON, deletes items added since). It goes
   * through the normal review; on approval the new head has source "restore".
   */
  restoreVersion(principal, { version, message = '', submit = true } = {}) {
    const P = principal.project.id;
    const head = this.versions.ensureHead(P);
    const target = this.repo.byNumber(P, version);
    if (!target || target.number == null) throw new NotFoundError('version', version);
    if (target.id === head.id) throw new ValidationFailed(`version ${version} is already the head`);
    const cs = this.begin(principal, { summary: `Restore version ${version}`, clientInfo: { restoreOf: target.number } });
    const skipped = [];
    const wanted = new Set(target.manifest.map(e => e.uid));
    const order = [...target.manifest].sort((a, b) => HIER.indexOf(a.type) - HIER.indexOf(b.type));
    for (const e of order) {
      const live = this.reads.find(e.type, e.uid);
      if (live && live.project_id === P && this.hashes.get(e.type, live.id) === e.contentHash) continue;
      const item = this.versions.storedItem(e.uid, e.contentHash);
      if (!item) { skipped.push({ type: e.type, key: e.key, reason: 'content of this version was not stored' }); continue; }
      try { this.stage(principal, { changeset: cs.changeset, item: { ...item, uid: e.uid }, allowDuplicate: true, restore: true }); } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        skipped.push({ type: e.type, key: e.key, reason: err.message });
      }
    }
    for (const e of head.manifest) {
      if (wanted.has(e.uid)) continue;
      try { this.stageDelete(principal, { changeset: cs.changeset, type: e.type, ref: e.uid }); } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        skipped.push({ type: e.type, key: e.key, reason: err.message });
      }
    }
    const row = this.repo.changeset(cs.changeset);
    if (!this.repo.countOps(row.id)) { this.repo.updateChangeset(row.id, { status: 'discarded' }); return { ...this.view(this.repo.changeset(row.id)), restoredFrom: target.number, unchanged: true, skipped }; }
    const out = submit ? this.submit(principal, { changeset: cs.changeset, message: message || `Restore version ${target.number}` }) : this.view(this.repo.changeset(row.id));
    return { ...out, restoredFrom: target.number, skipped };
  }

  /** Designer side: the owner (or an admin) asks for a restore; the result is reviewed like any changeset. */
  restoreForActor(projectId, number, actor, { message } = {}) {
    const p = this.#project(projectId);
    if (!actor || (p.ownerId !== actor.id && !this.auth.isAdmin(actor))) throw new ForbiddenError('only the project owner or an admin can restore a version');
    return this.restoreVersion({ project: { id: p.id, key: p.key, name: p.name }, user: { id: actor.id }, apiKeyId: null }, { version: Number(number), message });
  }

  list(principal, { status } = {}) {
    this.repo.expireStale(this.now().toISOString());
    return { changesets: this.repo.listChangesets(principal.project.id, { status, limit: 50 }).map(c => this.view(c, { ops: false })) };
  }

  view(cs, { ops = true } = {}) {
    const base = cs.baseVersionId ? this.repo.version(cs.baseVersionId) : null;
    const result = cs.resultVersionId ? this.repo.version(cs.resultVersionId) : null;
    const list = this.repo.ops(cs.id);
    const reviewer = cs.reviewedBy ? this.collaboration.users?.get?.(cs.reviewedBy) : null;
    const counts = {};
    for (const o of list) counts[o.status] = (counts[o.status] || 0) + 1;
    return {
      changeset: cs.uid, status: cs.status, summary: cs.summary, message: cs.message, baseVersion: base?.number ?? null,
      resultVersion: result ? { status: result.status, number: result.number } : null,
      createdAt: cs.createdAt, expiresAt: cs.expiresAt, submittedAt: cs.submittedAt,
      reviewedAt: cs.reviewedAt, reviewedBy: reviewer?.username || null, reviewComment: cs.reviewComment,
      opCount: list.length, opStatus: counts,
      ...(ops ? { ops: list.map(o => ({ opUid: o.uid, op: o.op, type: o.type, key: o.key, uid: o.itemUid, status: o.status, baseHash: o.baseHash, proposedHash: o.proposedHash, error: o.error || undefined, changeRequestId: o.changeRequestId })) } : {})
    };
  }

  /* ================= review (human session side) ================= */

  #assertReviewer(cs, actor) {
    if (!actor) throw new ForbiddenError('approval needs a signed-in designer session');
    const p = this.#project(cs.projectId);
    if (p.ownerId !== actor.id && !this.auth.isAdmin(actor)) throw new ForbiddenError('only the project owner or an admin can review AI changesets');
  }

  #assertMember(projectId, actor) {
    if (!actor) throw new ForbiddenError('sign in first');
    const p = this.#project(projectId);
    const m = this.projects.getMember?.(p.id, actor.id);
    if (p.ownerId !== actor.id && !this.auth.isAdmin(actor) && !(m && (m.status || 'accepted') === 'accepted')) throw new ForbiddenError('not a member of this project');
    return p;
  }

  listForActor(projectId, actor, { status } = {}) {
    this.#assertMember(projectId, actor);
    this.repo.expireStale(this.now().toISOString());
    return this.repo.listChangesets(projectId, { status }).map(c => this.view(c, { ops: false }));
  }

  getForActor(uid, actor) {
    const cs = this.repo.changeset(String(uid));
    if (!cs) throw new NotFoundError('changeset', uid);
    const p = this.#assertMember(cs.projectId, actor);
    const principal = this.#ownerPrincipal(cs);
    const diff = new Map(this.#diffOps(principal, cs).map(d => [d.opUid, d]));
    const v = this.view(cs);
    return { ...v, projectId: p.id, canReview: p.ownerId === actor.id || this.auth.isAdmin(actor),
      ops: v.ops.map(o => { const d = diff.get(o.opUid) || {}; return { ...o, changedFields: d.changedFields || [], headHash: d.headHash ?? null, changedSinceBase: !!d.conflict, name: this.repo.op(o.opUid).payload.item?.name || o.key }; }) };
  }

  /**
   * Applies the approved ops and rejects the others. When no staged op remains, the changeset is final:
   * its pending version becomes the head (at least one op applied) or is rejected.
   */
  review(uid, { approve = [], reject = [], comment = '' } = {}, actor, { auto = false } = {}) {
    const cs = this.repo.changeset(String(uid));
    if (!cs) throw new NotFoundError('changeset', uid);
    if (!auto) this.#assertReviewer(cs, actor);
    if (cs.status !== 'submitted') throw new ConflictError(`changeset is ${cs.status}, not waiting for review`);
    const principal = this.#ownerPrincipal(cs);
    const reviewerId = actor?.id ?? null;
    const note = String(comment || '').slice(0, 1000);
    const ops = this.repo.ops(cs.id);
    const known = new Set(ops.map(o => o.uid));
    for (const u of [...approve, ...reject]) if (!known.has(u)) throw new NotFoundError('changeset op', u);
    const setCr = (o, status, why = note) => { if (o.changeRequestId) this.collaboration.changes.updateStatus(o.changeRequestId, { status, reviewerId, reviewComment: why }); };

    this.transaction(() => {
      this.versions.ensureHead(cs.projectId);   // record designer edits made meanwhile as their own version first
      const prevFix = this.fixups;
      this.fixups = [];
      for (const o of this.#ordered(ops.filter(x => x.status === 'staged' && approve.includes(x.uid)))) {
        try {
          this.transaction(() => {
            const id = this.#applyOne(principal, o);
            const b = o.payload.binding;
            if (b && id && this.bindings) {
              this.bindings.upsert(cs.projectId, { type: o.type, itemUid: o.itemUid, repo: b.repo || '', file: b.file, symbol: b.symbol || '', framework: b.framework || '',
                hash: this.hashes.get(o.type, id), apiKeyId: cs.apiKeyId });
            }
          });
          this.repo.updateOp(o.id, { status: 'applied' });
          setCr(o, 'approved');
          this.requests?.onOpReviewed(cs.uid, o, 'applied');
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          this.repo.updateOp(o.id, { status: 'failed', error: e.message });
          setCr(o, 'rejected', `could not apply: ${e.message}`);
          this.requests?.onOpReviewed(cs.uid, o, 'failed', e.message);
        }
      }
      // actions whose target op was applied later in the loop (or never, when it was rejected)
      const unresolved = this.#resolveFixups(principal, this.fixups, { strict: false });
      this.fixups = prevFix;
      for (const f of unresolved) {
        const o = ops.find(x => x.itemUid === f.ownerUid);
        if (o) this.repo.updateOp(o.id, { error: `${f.path}: target "${f.action.target.uid || f.action.target.key}" was not applied, so this action was left out` });
      }
      for (const o of ops.filter(x => x.status === 'staged' && reject.includes(x.uid))) {
        this.repo.updateOp(o.id, { status: 'rejected' });
        setCr(o, 'rejected');
        this.requests?.onOpReviewed(cs.uid, o, 'rejected', note);
      }
      const now = this.repo.ops(cs.id);
      if (now.some(o => o.status === 'staged')) {
        this.repo.updateChangeset(cs.id, { reviewComment: note || cs.reviewComment });
        return;
      }
      const applied = now.some(o => o.status === 'applied');
      if (applied) this.versions.approvePending(cs.resultVersionId, { reviewerId });
      else this.versions.reject(cs.resultVersionId);
      this.repo.updateChangeset(cs.id, { status: applied ? 'approved' : 'rejected', reviewedBy: reviewerId, reviewedAt: this.now().toISOString(), reviewComment: note });
    });
    return actor ? this.getForActor(cs.uid, actor) : this.view(this.repo.changeset(cs.id));
  }

  /** Hook for the core change list: approving / rejecting one AI change request reviews its op. */
  reviewChangeRequest(changeRequest, decision, { actor, comment = '' } = {}) {
    const op = this.repo.opByChangeRequest(changeRequest.id);
    if (!op) throw new NotFoundError('changeset op for change', changeRequest.id);
    const cs = this.repo.changeset(op.changesetId);
    this.review(cs.uid, decision === 'approve' ? { approve: [op.uid], comment } : { reject: [op.uid], comment }, actor);
    return this.collaboration.changes.get(changeRequest.id);
  }

  /** Before / after SVG of one op for the review screen (after = rendered from a rolled-back dry run). */
  preview(uid, opUid, actor, { style } = {}) {
    const cs = this.repo.changeset(String(uid));
    if (!cs) throw new NotFoundError('changeset', uid);
    this.#assertMember(cs.projectId, actor);
    const ops = this.repo.ops(cs.id);
    const o = ops.find(x => x.uid === opUid);
    if (!o) throw new NotFoundError('changeset op', opUid);
    if (o.type === 'workflow') return { type: o.type, before: null, after: null, note: 'workflows have no picture; see changed fields' };
    const principal = this.#ownerPrincipal(cs);
    const svg = id => this.exporter.svgFile(o.type, id, { theme: style || undefined, animated: false }).content;
    const row = this.reads.find(o.type, o.itemUid);
    const before = row && row.project_id === cs.projectId && o.status !== 'applied' ? svg(row.id) : null;
    let after = null;
    if (o.op !== 'delete') {
      if (o.status === 'applied' && row) after = svg(row.id);
      else {
        try {
          after = this.#dryRun(() => svg(this.#withFixups(principal, () => {
            for (const dep of this.#depOps(o.payload.item || {}, ops.filter(x => x.uid !== o.uid))) this.#applyOne(principal, dep);
            return this.#applyOne(principal, o);
          }).result));
        } catch (e) { if (!(e instanceof DomainError)) throw e; after = null; }
      }
    }
    return { type: o.type, key: o.key, op: o.op, before, after };
  }
}
