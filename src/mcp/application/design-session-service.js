/**
 * AI-assisted design: a coding agent (CLI) designs inside ONE focused project of its user instead of a human clicking
 * through the designer. Everything here is only reachable with an account key that has the `design` scope ("strict" keys).
 *
 *   focus      uiux_create_project / uiux_edit_project / uiux_clone_project put one OWNED project in focus; every project
 *              tool then acts on it (the `project` argument is optional and, when given, must be the focused project)
 *   edit       the agent's edits are staged operations of one open changeset (the "edit session") of the focused project
 *   save       applies the staged edits directly to the project (the owner's own design key = the owner's decision)
 *   save-as    puts the current state (+ unsaved edits) into a NEW project `<master>-v001`, `-v002` … and focuses it
 *   versions   `-vNNN` projects are linked to their master in `settings.ai.versionOf`; list / open / delete one /
 *              purge all (the latest becomes the master, every other version is removed)
 *
 * Isolation (also enforced in AccountService, the query service and the changeset service via `principal.strict`):
 * owned projects only, never public / shared / foreign data, private projects only, no way to delete a project other
 * than a `-vNNN` copy of the focused master, no SQL, no designer REST routes.
 */
import { DomainError, NotFoundError, ValidationError, ConflictError } from '../../domain/errors.js';
import { ITEM_TYPES, LIMITS } from '../domain/item-validation.js';
import { TYPE_TO_TABLE } from '../domain/tables.js';
import { versionIdentity, parseVersionRef, pad3 } from '../domain/version-naming.js';

const OPEN = ['open', 'conflicted'];

/** Drops the uids that name items of the source project (they would resolve to foreign rows in the target); keeps keys. */
function rekey(value, uidToKey) {
  if (Array.isArray(value)) return value.map(v => rekey(v, uidToKey));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = rekey(v, uidToKey);
  if (typeof out.uid === 'string' && uidToKey.has(out.uid)) {
    if (out.key === undefined) out.key = uidToKey.get(out.uid);
    delete out.uid;
  }
  return out;
}

export class DesignSessionService {
  /**
   * @param {{ focus, accounts, projectService, projects, users, versions, changesets, query, versionRepo, services, workflows, db, transaction, now? }} d
   */
  constructor(d) { Object.assign(this, { now: () => new Date() }, d); }

  /* ================= helpers ================= */

  #user(principal) {
    const u = this.users.get(Number(principal?.user?.id));
    if (!u || u.status !== 'active') throw new DomainError('the key owner is not an active user', 'UNAUTHORIZED', 401);
    return u;
  }

  #owned(principal) {
    const uid = Number(principal.user.id);
    return this.projects.list().filter(p => Number(p.ownerId) === uid);
  }

  #lineage(p) { return p?.settings?.ai?.versionOf || null; }

  #setLineage(projectId, versionOf, user) {
    const p = this.projectService.get(projectId);
    const ai = { ...(p.settings?.ai || {}) };
    if (versionOf) ai.versionOf = versionOf; else delete ai.versionOf;
    this.projectService.update(projectId, { settings: { ai } }, { actor: user });
  }

  /** The master of a project: its `versionOf.master` when that project still exists and is the user's, else itself. */
  #masterOf(principal, p) {
    const l = this.#lineage(p);
    if (!l) return p;
    const m = this.projects.getByKey?.(l.master) || this.projects.list().find(x => x.key === l.master);
    return m && Number(m.ownerId) === Number(principal.user.id) ? m : p;
  }

  /** The versions (separate `-vNNN` projects) of a master, oldest first. */
  #versionsOf(principal, master) {
    return this.#owned(principal)
      .filter(p => p.id !== master.id && this.#lineage(p)?.master === master.key)
      .map(p => ({ p, number: Number(this.#lineage(p).number) || 0 }))
      .sort((a, b) => a.number - b.number || a.p.id - b.p.id);
  }

  /**
   * Hard-deletes a version project: its items first (the design tables have no cascade from projects, so a plain project
   * delete would leave orphaned rows), then its history and bindings, then the project itself. Never goes to the trash.
   */
  #destroyProject(projectId, user) {
    this.transaction(() => {
      for (const type of [...ITEM_TYPES].reverse()) {
        const table = TYPE_TO_TABLE[type];
        try { this.db.prepare(`UPDATE ${table} SET locked = 0 WHERE project_id = ?`).run(projectId); } catch { /* no lock column */ }
        for (const r of this.db.prepare(`SELECT id FROM ${table} WHERE project_id = ?`).all(projectId)) {
          (type === 'workflow' ? this.workflows : this.services[type]).remove(r.id, { permanent: true });
        }
      }
      this.versionRepo.purgeHistory(projectId);
      for (const t of ['code_bindings', 'item_requests']) { try { this.db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId); } catch { /* table absent */ } }
      this.focus.clearProject(projectId);
      this.projectService.remove(projectId, { actor: user });
    });
  }

  #info(p, extra = {}) { return { key: p.key, name: p.name, visibility: p.visibility, ...extra }; }

  /** The agent's open edit session (changeset) on a project, or null. */
  #session(principal, projectId) {
    this.versionRepo.expireStale(this.now().toISOString());
    return this.versionRepo.listChangesets(projectId, { limit: 50 }).find(c => c.apiKeyId === principal.apiKeyId && OPEN.includes(c.status)) || null;
  }

  #bound(principal, p) { return this.accounts.bind(principal, { id: p.id, key: p.key, name: p.name, role: 'owner' }); }

  /* ================= focus ================= */

  /** Called by the protocol before a project tool runs: the focused project (re-checked: still the user's own). */
  resolveFocused(principal, ref, need = 'propose') {
    const f = this.focus.get(principal.apiKeyId);
    const p = f ? this.projects.get(f.projectId) : null;
    if (!p) {
      if (f) this.focus.clear(principal.apiKeyId);
      throw new DomainError('no project is focused: call uiux_edit_project (pick one of your projects), uiux_create_project or uiux_clone_project first', 'NO_FOCUS', 409);
    }
    if (ref !== undefined && ref !== null && String(ref).trim() !== '' && String(ref).trim() !== p.key && String(ref).trim() !== String(p.id)) {
      throw Object.assign(new DomainError(`this key works on the focused project "${p.key}" only; call uiux_edit_project to switch to "${String(ref).trim()}"`, 'SCOPE_DENIED', 403));
    }
    return this.accounts.resolve(principal, p.id, need);
  }

  /** uiux_init (edit / clone) of a design key: the chosen project becomes the focus. */
  setFocus(principal, project) {
    if (!principal.strict) return;
    this.focus.set(principal.apiKeyId, project.id);
  }

  current(principal) {
    const f = this.focus.get(principal.apiKeyId);
    const p = f ? this.projects.get(f.projectId) : null;
    if (!p || Number(p.ownerId) !== Number(principal.user.id)) return null;
    const s = this.#session(principal, p.id);
    return { ...this.#info(p), versionOf: this.#lineage(p), edits: s ? { changeset: s.uid, staged: this.versionRepo.countOps(s.id) } : { changeset: null, staged: 0 } };
  }

  #state(principal, resolved, extra = {}) {
    const p = this.projects.get(resolved.id);
    const head = this.versions.ensureHead(p.id, { userId: principal.user.id });
    const s = this.#session(principal, p.id);
    const master = this.#masterOf(principal, p);
    const vs = this.#versionsOf(principal, master);
    return {
      project: this.#info(p, { owner: principal.user.username }),
      focused: true,
      head: { number: head.number, items: head.manifest.length },
      edits: { changeset: s?.uid || null, staged: s ? this.versionRepo.countOps(s.id) : 0 },
      versioning: {
        master: master.key, isMaster: master.id === p.id, versionOf: this.#lineage(p),
        versions: vs.map(v => v.p.key), latest: vs.length ? vs[vs.length - 1].p.key : null
      },
      ...extra
    };
  }

  /* ================= projects ================= */

  list(principal) {
    const f = this.focus.get(principal.apiKeyId);
    const rows = this.accounts.listProjects(principal, { owned: true, limit: 500 });
    const byKey = new Map(this.#owned(principal).map(p => [p.key, p]));
    const projects = rows.projects.map(r => {
      const p = byKey.get(r.key);
      return { key: r.key, name: r.name, description: r.description, visibility: r.visibility, updatedAt: r.updatedAt, focused: !!(f && p && p.id === f.projectId), versionOf: this.#lineage(p) };
    });
    return { total: rows.total, projects, focused: projects.find(p => p.focused)?.key || null };
  }

  /** uiux_edit_project: without `project` the list to choose from; with it, that project becomes the focus. */
  edit(principal, { project } = {}) {
    if (project === undefined || project === null || String(project).trim() === '') {
      const data = this.list(principal);
      const lines = data.projects.slice(0, 40).map(p => `- ${p.key} — ${p.name}${p.focused ? '  [focused]' : ''}${p.versionOf ? `  (version ${pad3(p.versionOf.number)} of ${p.versionOf.master})` : ''}`);
      return {
        needsSelection: true, ...data,
        question: `Which of your projects should be edited?\n${lines.join('\n') || '(no projects yet — call uiux_create_project)'}`,
        askHuman: ['Show the list to the human and ask which project to edit (or whether to create / clone a new one).', 'Then call uiux_edit_project again with { project: "<key>" }.']
      };
    }
    const resolved = this.accounts.resolve(principal, project, 'propose');
    this.focus.set(principal.apiKeyId, resolved.id);
    return this.#state(principal, resolved, {
      next: ['Read the design: uiux_get_manifest, uiux_search_items, uiux_get_item.', 'Edit: uiux_stage_item / uiux_stage_delete (no changeset argument needed).', 'Review: uiux_list_edit_ops; undo: uiux_delete_edit_ops; keep: uiux_save, or uiux_save_as for a new -vNNN project.']
    });
  }

  /** uiux_create_project: create (private) and focus. */
  create(principal, args) {
    const data = this.accounts.createProject(principal, args);
    const p = this.projects.getByKey?.(data.project.key) || this.projects.list().find(x => x.key === data.project.key);
    if (args.fromProject) this.#setLineage(p.id, null, this.#user(principal));
    this.focus.set(principal.apiKeyId, p.id);
    return { ...data, ...this.#state(principal, { id: p.id, key: p.key, name: p.name }), next: ['The new project is focused. Design with uiux_stage_item; keep it with uiux_save.'] };
  }

  /** uiux_clone_project: a copy under a NEW name (always required), focused. */
  clone(principal, { source, name, description, key } = {}) {
    const newName = String(name ?? '').trim();
    if (!newName) throw new ValidationError('name is required: a clone always gets a new name');
    let src;
    if (source !== undefined && source !== null && String(source).trim() !== '') src = this.accounts.resolve(principal, source, 'read');
    else src = this.resolveFocused(principal, undefined, 'read');
    if (newName.toLowerCase() === String(src.name).toLowerCase()) throw new ValidationError(`the clone needs a name different from "${src.name}"`);
    if (this.#owned(principal).some(p => String(p.name).toLowerCase() === newName.toLowerCase())) throw new ConflictError(`you already have a project named "${newName}"; choose another name`);
    const user = this.#user(principal);
    const created = this.accounts.createProject(principal, { name: newName, key, description: description ?? `Clone of "${src.key}".`, fromProject: src.key, visibility: 'private' });
    const p = this.projects.getByKey?.(created.project.key) || this.projects.list().find(x => x.key === created.project.key);
    this.#setLineage(p.id, null, user);   // a clone is its own master, even when its source was a -vNNN version
    this.focus.set(principal.apiKeyId, p.id);
    return { ...created, ...this.#state(principal, { id: p.id, key: p.key, name: p.name }), clonedFrom: { key: src.key, name: src.name }, next: ['The clone is focused. Design with uiux_stage_item; keep it with uiux_save.'] };
  }

  /** uiux_close_project: stop working on the project (edits stay in the session unless discardEdits). */
  close(principal, { discardEdits = false } = {}) {
    const f = this.focus.get(principal.apiKeyId);
    const p = f ? this.projects.get(f.projectId) : null;
    let discarded = 0;
    if (p && discardEdits) {
      const s = this.#session(principal, p.id);
      if (s) { discarded = this.versionRepo.countOps(s.id); this.versionRepo.updateChangeset(s.id, { status: 'discarded' }); }
    }
    this.focus.clear(principal.apiKeyId);
    return { closed: p ? p.key : null, discardedEdits: discarded };
  }

  /* ================= edit session (staged operations) ================= */

  /** The changeset uid the stage / diff / submit tools use when the agent passes none. */
  sessionFor(principal, changeset, { create = false } = {}) {
    if (changeset) return changeset;
    const s = this.#session(principal, principal.project.id);
    if (s) return s.uid;
    if (!create) throw new ValidationError('there are no unsaved edits: stage an item first (uiux_stage_item)');
    return this.changesets.begin(principal, { summary: 'AI-assisted design edit session', clientInfo: { agent: 'design-session' } }).changeset;
  }

  beginSession(principal, args = {}) {
    const s = this.#session(principal, principal.project.id);
    if (s) return { ...this.changesets.get(principal, { changeset: s.uid }), resumed: true, headVersion: this.versions.ensureHead(principal.project.id).number };
    return this.changesets.begin(principal, args);
  }

  listEdits(principal) {
    const s = this.#session(principal, principal.project.id);
    if (!s) return { changeset: null, staged: 0, ops: [], summary: { create: 0, update: 0, delete: 0, conflicts: 0 } };
    const d = this.changesets.diff(principal, { changeset: s.uid });
    return { ...d, staged: d.ops.length };
  }

  deleteEdits(principal, { ops = [], all = false } = {}) {
    if (!all && !ops.length) throw new ValidationError('pass ops (op uids or item keys, see uiux_list_edit_ops) or all: true');
    const s = this.#session(principal, principal.project.id);
    if (!s) return { changeset: null, removed: [], staged: 0 };
    return this.changesets.unstage(principal, { changeset: s.uid, ops, all });
  }

  /** uiux_save: applies the staged edits to the focused project and records the new version. */
  save(principal, { message = '', label = '' } = {}) {
    const s = this.#session(principal, principal.project.id);
    const n = s ? this.versionRepo.countOps(s.id) : 0;
    if (!s || !n) {
      const head = this.versions.ensureHead(principal.project.id, { userId: principal.user.id });
      return { saved: false, nothingToSave: true, project: principal.project.key, version: head.number };
    }
    const view = this.changesets.submit(principal, { changeset: s.uid, message: message || 'Saved from AI-assisted design', label, autoApprove: true });
    const applied = view.status === 'approved';
    return {
      saved: applied, project: principal.project.key, changeset: view.changeset, status: view.status,
      version: view.resultVersion?.number ?? null, applied: view.opStatus?.applied || 0, opStatus: view.opStatus, ops: view.ops
    };
  }

  /* ================= versions (separate -vNNN projects) ================= */

  /** uiux_save_as: the current state plus unsaved edits become a new project `<master>-v001` (focused). */
  saveAs(principal, { message = '' } = {}) {
    const user = this.#user(principal);
    const cur = this.projects.get(principal.project.id);
    const master = this.#masterOf(principal, cur);
    const existing = this.#versionsOf(principal, master);
    let number = existing.reduce((m, v) => Math.max(m, v.number), 0) + 1;
    let ident = versionIdentity(master, number);
    while (this.projects.keyExists?.(ident.key)) { number += 1; ident = versionIdentity(master, number); }

    const session = this.#session(principal, cur.id);
    const fops = session ? this.versionRepo.ops(session.id).filter(o => o.status === 'staged') : [];
    // make the saved state current (adopted dependencies, designer edits) before it is copied
    this.versions.ensureHead(cur.id, { userId: user.id });
    const created = this.accounts.createProject(principal, { name: ident.name, key: ident.key, description: `Version ${pad3(number)} of "${master.name}".`, fromProject: cur.key, visibility: 'private' });
    const c = this.projects.getByKey?.(created.project.key) || this.projects.list().find(x => x.key === created.project.key);
    try {
      this.#setLineage(c.id, { master: master.key, number }, user);
      let carried = 0;
      if (fops.length) carried = this.#replayEdits(principal, cur, c, fops, message || `Saved as ${c.key}`);
      if (session && fops.length) this.versionRepo.updateChangeset(session.id, { status: 'discarded' });   // the edits live in the new version now
      this.focus.set(principal.apiKeyId, c.id);
      return { ...this.#state(principal, { id: c.id, key: c.key, name: c.name }), savedAs: c.key, number, master: master.key, from: cur.key, carriedEdits: carried, next: [`Focus is now "${c.key}". Keep editing it, or purge older versions when done (uiux_purge_versions).`] };
    } catch (e) {
      try { this.#destroyProject(c.id, user); } catch { /* best effort */ }
      throw e;
    }
  }

  /** Stages the unsaved ops of `from` into a fresh changeset of `to` (keys instead of uids) and saves it there. */
  #replayEdits(principal, from, to, fops, message) {
    const Tp = this.#bound(principal, to);
    const uidToKey = new Map();
    for (const t of ITEM_TYPES) for (const r of this.query.reads.list(t, { projectId: from.id, userId: principal.user.id, scopes: ['project'] })) uidToKey.set(r.uid, r.key);
    for (const o of fops) if (o.itemUid) uidToKey.set(o.itemUid, o.key);
    const cs = this.changesets.begin(Tp, { summary: `Unsaved edits of ${from.key}`, clientInfo: { agent: 'design-session', savedAs: to.key } });
    for (const o of fops) {
      if (o.op === 'delete') { this.changesets.stageDelete(Tp, { changeset: cs.changeset, type: o.type, ref: o.key }); continue; }
      const { uid, ...item } = rekey(o.payload.item || {}, uidToKey);
      this.changesets.stage(Tp, { changeset: cs.changeset, item, svg: o.payload.svg, binding: o.payload.binding, allowDuplicate: true });
    }
    const view = this.changesets.submit(Tp, { changeset: cs.changeset, message, autoApprove: true });
    if (view.status !== 'approved') throw new DomainError(`the unsaved edits could not be applied to the new version (${view.status})`, 'VALIDATION_FAILED', 422);
    return fops.length;
  }

  #versionRow(principal, v, { focusId, latestNumber }) {
    const head = this.versionRepo.head(v.p.id);
    return { number: v.number, key: v.p.key, name: v.p.name, items: head ? head.manifest.length : null, updatedAt: v.p.updatedAt || v.p.createdAt || null, focused: v.p.id === focusId, latest: v.number === latestNumber };
  }

  /** uiux_manage_versions: the master with its versions; `open` focuses one of them (or "master"). */
  manageVersions(principal, { open } = {}) {
    const cur = this.projects.get(principal.project.id);
    const master = this.#masterOf(principal, cur);
    const vs = this.#versionsOf(principal, master);
    if (open !== undefined && open !== null && open !== '') {
      let target;
      if (String(open).toLowerCase() === 'master') target = master;
      else {
        const n = parseVersionRef(open, master.key);
        target = n ? vs.find(v => v.number === n)?.p : null;
        if (!target) throw new NotFoundError('version', open);
      }
      this.focus.set(principal.apiKeyId, target.id);
      return { ...this.manageVersions({ ...principal, project: { id: target.id, key: target.key, name: target.name } }), opened: target.key };
    }
    const latestNumber = vs.length ? vs[vs.length - 1].number : null;
    const focusId = cur.id;
    const mHead = this.versionRepo.head(master.id);
    return {
      master: { key: master.key, name: master.name, items: mHead ? mHead.manifest.length : null, focused: master.id === focusId },
      versions: vs.map(v => this.#versionRow(principal, v, { focusId, latestNumber })),
      latest: latestNumber != null ? versionIdentity(master, latestNumber).key : null,
      total: vs.length
    };
  }

  /** uiux_delete_version: removes one `-vNNN` project of the focused master. */
  deleteVersion(principal, { version } = {}) {
    const user = this.#user(principal);
    const cur = this.projects.get(principal.project.id);
    const master = this.#masterOf(principal, cur);
    const n = parseVersionRef(version, master.key);
    const target = n ? this.#versionsOf(principal, master).find(v => v.number === n)?.p : null;
    if (!target) throw new NotFoundError('version', version);
    let refocused = null;
    if (target.id === cur.id) { this.focus.set(principal.apiKeyId, master.id); refocused = master.key; }
    this.#destroyProject(target.id, user);
    return { deleted: target.key, number: n, master: master.key, focusedNow: refocused || cur.key, remaining: this.#versionsOf(principal, master).map(v => v.p.key) };
  }

  /**
   * uiux_purge_versions: the latest version (or `from`) becomes the master — its design replaces the master's — and every
   * version project is deleted; the master's history restarts as a clean single version. Destructive: needs confirm.
   */
  purgeVersions(principal, { confirm = false, from } = {}) {
    const user = this.#user(principal);
    const cur = this.projects.get(principal.project.id);
    const master = this.#masterOf(principal, cur);
    const vs = this.#versionsOf(principal, master);
    if (!vs.length) throw new ValidationError(`"${master.key}" has no versions to purge`);
    let source = vs[vs.length - 1];
    if (from !== undefined && from !== null && from !== '') {
      const n = parseVersionRef(from, master.key);
      source = n ? vs.find(v => v.number === n) : null;
      if (!source) throw new NotFoundError('version', from);
    }
    const pending = [master, ...vs.map(v => v.p)].reduce((n, p) => { const s = this.#session(principal, p.id); return n + (s ? this.versionRepo.countOps(s.id) : 0); }, 0);
    const plan = {
      master: master.key, becomesMaster: source.p.key, deleteVersions: vs.map(v => v.p.key), unsavedEditsDropped: pending,
      effect: `"${master.key}" takes over the design of "${source.p.key}"; ${vs.length} version project(s) are deleted; the history of "${master.key}" restarts at version 1.`
    };
    if (!confirm) return { needsConfirm: true, plan, hint: 'Ask the human, then call uiux_purge_versions again with confirm: true. Save or delete unsaved edits first if they matter.' };

    const Mp = this.#bound(principal, master);
    for (const p of [master, ...vs.map(v => v.p)]) { const s = this.#session(principal, p.id); if (s) this.versionRepo.updateChangeset(s.id, { status: 'discarded' }); }
    const replaced = this.#replaceFrom(Mp, source.p, user);
    for (const v of vs) this.#destroyProject(v.p.id, user);
    this.versionRepo.purgeHistory(master.id);
    const head = this.versions.ensureHead(master.id, { userId: user.id });
    this.focus.set(principal.apiKeyId, master.id);
    return { purged: true, master: master.key, becameMaster: source.p.key, deletedVersions: vs.map(v => v.p.key), replaced, head: head.number, focused: master.key };
  }

  /** Makes the master's items equal to the source project's items (by key) through one changeset applied directly. */
  #replaceFrom(Mp, source, user) {
    const reads = this.query.reads;
    const ctx = (projectId) => ({ projectId, userId: user.id, scopes: ['project'] });
    const srcRows = ITEM_TYPES.flatMap(t => reads.list(t, ctx(source.id)));
    const curRows = ITEM_TYPES.flatMap(t => reads.list(t, ctx(Mp.project.id)));
    const srcKeys = new Set(srcRows.map(r => `${r.type}:${r.key}`));
    const dels = curRows.filter(r => !srcKeys.has(`${r.type}:${r.key}`));
    if (srcRows.length + dels.length > LIMITS.opsPerChangeset) {
      throw new ValidationError(`too many items to replace in one step (${srcRows.length + dels.length} > ${LIMITS.opsPerChangeset}); delete some versions manually`);
    }
    const uidToKey = new Map(srcRows.map(r => [r.uid, r.key]));
    const srcPrincipal = this.versions.projectPrincipal(source.id);
    const cs = this.changesets.begin(Mp, { summary: `Replace with ${source.key}`, clientInfo: { agent: 'design-session', purgeFrom: source.key } });
    const order = [...srcRows].sort((a, b) => ITEM_TYPES.indexOf(a.type) - ITEM_TYPES.indexOf(b.type));
    for (const row of order) {
      const { contentHash, scope, untrusted, builtin, visibility, uid, ...item } = this.query.itemJson(srcPrincipal, row);
      this.changesets.stage(Mp, { changeset: cs.changeset, item: rekey(item, uidToKey), allowDuplicate: true, restore: true });
    }
    for (const r of dels) this.changesets.stageDelete(Mp, { changeset: cs.changeset, type: r.type, ref: r.key });
    if (!this.versionRepo.countOps(this.versionRepo.changeset(cs.changeset).id)) {
      this.changesets.discard(Mp, { changeset: cs.changeset });
      return { unchanged: true, items: srcRows.length, removed: 0 };
    }
    const view = this.changesets.submit(Mp, { changeset: cs.changeset, message: `Replaced with ${source.key}`, autoApprove: true });
    if (view.status !== 'approved') throw new DomainError(`the master could not take over "${source.key}" (${view.status}); nothing was deleted`, 'VALIDATION_FAILED', 422);
    return { unchanged: false, items: srcRows.length, removed: dels.length, version: view.resultVersion?.number ?? null };
  }
}
