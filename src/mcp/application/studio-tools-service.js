/**
 * MCP Studio Tools Service (`StudioToolsService`):
 *  1. Public Elements & Public Library Discovery + Use (`publicLibrary`, `usePublicElement`)
 *  2. Search & Copy Any Readable Item into an Existing Project to Edit (`copyItemToProject`)
 *  3. First-Class Direct CRUD across ALL 6 Item Types (`listProjectItems`, `createItem`, `updateItem`, `deleteItem`)
 *  4. Pure-Domain Graphical Canvas & Vector Editing Engine (`graphicTool`)
 *
 * Clean Architecture boundary: imports only from `domain/` and `mcp/domain/`; receives repositories/services via DI.
 */
import { DomainError, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '../../domain/errors.js';
import { TYPES, OWNER_TYPES, PLURAL_TO_TYPE, canContain } from '../../domain/entities.js';
import { slugify, uniqueKey } from '../../domain/naming.js';
import { isSystemUser } from '../../domain/system-users.js';
import {
  ANCHORS, placeAtAnchor, nodeBBox, parseTransform, translateAttrs, resizeAttrs, fitNodesToScreen,
  isContainerNode, clampNodeToContainer
} from '../../domain/geometry.js';
import { parsePath, serializePath, mapCommands } from '../../domain/path-data.js';
import { pathfind, cropNode, worldCommands, styleAttrs } from '../../domain/path-ops.js';
import {
  reversePath, simplifyPath, joinPaths, combinePaths, breakApart,
  makeSmooth, makeCorner, roundCorner, cutAt, penToCommands
} from '../../domain/path-tools.js';
import {
  groupNodes, ungroupNodes, alignPatches, distributePatches, flipPatches,
  bakePatch, rotatePatch, reorderLayer, stepLayer, unionBox, extractNodes
} from '../../domain/node-ops.js';
import { parseMcpContext, serializeMcpContext, mergeMcpContext } from '../domain/mcp-context.js';
import { DESIGN_TABLES, TYPE_TO_TABLE } from '../domain/tables.js';

export const ALL_ITEM_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
export const GRAPHIC_OPERATIONS = [
  'add_shape',
  'add_pen_path',
  'place_instance',
  'import_svg_nodes',
  'union',
  'subtract',
  'intersect',
  'exclude',
  'crop',
  'crop_to_canvas',
  'convert_to_path',
  'combine_paths',
  'break_apart',
  'join_paths',
  'reverse_path',
  'simplify_path',
  'bake_transform',
  'round_corners',
  'smooth_vertices',
  'sharp_vertices',
  'cut_path',
  'edit_vertices',
  'explode_icon',
  'extract_paths_to_library',
  'extract_as_element',
  'align',
  'distribute',
  'move',
  'resize',
  'fit_to_screen',
  'flip',
  'rotate',
  'group',
  'ungroup',
  'reorder_layer',
  'duplicate_nodes',
  'style_nodes',
  'delete_nodes'
];

function deny(message, code = 'SCOPE_DENIED') {
  const err = new ForbiddenError(message);
  err.code = code;
  return err;
}

function normalizeType(raw, { allowWorkflow = true } = {}) {
  const s = String(raw || '').trim().toLowerCase();
  const mapped = PLURAL_TO_TYPE[s] || (s === 'workflows' ? 'workflow' : s);
  const allowed = allowWorkflow ? ALL_ITEM_TYPES : OWNER_TYPES;
  if (!allowed.includes(mapped)) {
    throw new ValidationError(`Invalid item type "${raw}"; expected one of ${allowed.join(', ')}`);
  }
  return mapped;
}

function normalizeTypesList(types, type, { allowWorkflow = true, defaultTypes = null } = {}) {
  if (type) return [normalizeType(type, { allowWorkflow })];
  if (Array.isArray(types) && types.length) return [...new Set(types.map(t => normalizeType(t, { allowWorkflow })))];
  return defaultTypes || (allowWorkflow ? ALL_ITEM_TYPES : OWNER_TYPES);
}

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (v, d = 2) => { const f = 10 ** d; return Math.round(num(v) * f) / f; };

export class StudioToolsService {
  /**
   * @param {{
   *   getContainer: () => any,
   *   db: any,
   *   query: any,
   *   reads: any,
   *   hashes: any,
   *   library: any,
   *   versions?: any,
   *   parseSvg?: Function,
   *   transaction: Function,
   *   publicUserId: () => number | null,
   *   onMutate?: (projectId: number) => void
   * }} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
  }

  #container() {
    const c = this.getContainer?.();
    if (!c) throw new DomainError('Designer container is not available', 'INTERNAL', 500);
    return c;
  }

  /** Active non-system user, downgraded from instance-admin so core services enforce strict project ownership. */
  #actor(principal) {
    const c = this.#container();
    const u = c.users.get(Number(principal?.user?.id));
    if (!u || u.status !== 'active' || isSystemUser(u)) {
      throw new DomainError('the key owner is not an active user', 'UNAUTHORIZED', 401);
    }
    return { ...u, role: u.role === 'viewer' ? 'viewer' : 'designer', strict: Boolean(principal?.strict), viaMcp: true };
  }

  #requireBoundProject(principal, { requireEdit = false } = {}) {
    const c = this.#container();
    const actor = this.#actor(principal);
    const projectId = principal?.project?.id;
    if (!projectId) {
      throw new ValidationError('A target project is required (pass "project" with an account key, or focus a project first).');
    }
    const proj = c.projects.get(Number(projectId));
    if (requireEdit) {
      const role = c.projects.userRole(proj.id, actor);
      if (role !== 'owner') {
        throw deny(`Write operations require owning project "${proj.key}" (current role: ${role || 'none'})`, 'FORBIDDEN');
      }
      if (Number(proj.id) === 1 && Number(proj.ownerId) !== Number(actor.id)) {
        throw deny('Cannot mutate the default public library project over MCP; clone or create your own project.', 'FORBIDDEN');
      }
    } else {
      const role = c.projects.userRole(proj.id, actor);
      if (!role && proj.visibility !== 'public') {
        throw new NotFoundError('project', proj.key || proj.id);
      }
    }
    return { c, actor, proj, projectId: Number(proj.id) };
  }

  #isImmutablePublicRow(row) {
    const pub = this.publicUserId?.() ?? null;
    return Boolean(row?.builtin) || (pub != null && Number(row?.creator_id ?? row?.creatorId) === Number(pub) && (row?.visibility || 'public') === 'public');
  }

  /** True if `actor` may read `row` across public library, own private library, or projects visible to `actor` (strict keys: own projects only for non-public items). */
  #canReadRow(c, actor, row) {
    if (!row) return false;
    if (row.visibility === 'public') return true;
    if (row.visibility === 'private' && Number(row.creator_id) === Number(actor.id)) return true;
    const role = c.projects?.userRole?.(Number(row.project_id ?? 1), actor);
    if (actor.strict) return role === 'owner';
    return role != null;
  }

  #notify(projectId) {
    this.hashes?.refreshStale?.();
    if (projectId != null) this.onMutate?.(Number(projectId));
  }

  /** Serializes a row using `DesignQueryService.itemJson` bound to a synthetic principal so public/project items render identically. */
  #itemJsonFor(principal, row, fallbackProjectId = null) {
    const effProjectId = principal?.project?.id ?? fallbackProjectId ?? row.project_id ?? 1;
    const boundPrincipal = principal?.project ? principal : { ...principal, project: { id: effProjectId, key: this.#container().projects.get(effProjectId)?.key || 'default' } };
    return this.query.itemJson(boundPrincipal, row);
  }

  #writeMcpContext(type, id, mcpContext, { merge = false } = {}) {
    if (mcpContext === undefined) return;
    const table = TYPE_TO_TABLE[type];
    const current = merge ? this.db.prepare(`SELECT mcp_context FROM ${table} WHERE id = ?`).get(Number(id))?.mcp_context : null;
    const next = merge ? serializeMcpContext(mergeMcpContext(current, mcpContext)) : serializeMcpContext(mcpContext);
    this.db.prepare(`UPDATE ${table} SET mcp_context = ?, content_hash = NULL WHERE id = ?`).run(next, Number(id));
  }

  /* ============================================================================
   * 1. PUBLIC ELEMENTS & PUBLIC LIBRARY DISCOVERY (`uiux_public_library`)
   * ============================================================================ */

  publicLibrary(principal, {
    type,
    types,
    onlyElements = false,
    query = '',
    category = '',
    ref = '',
    detail = 'summary',
    format = 'json',
    style,
    includeCategories = true,
    limit = 40
  } = {}) {
    this.#actor(principal); // ensures active authenticated user

    // Single public item lookup when `ref` is supplied
    if (ref && String(ref).trim()) {
      const cleanRef = String(ref).trim();
      const searchTypes = type
        ? [normalizeType(type)]
        : ['element', 'button', 'icon', 'path', 'screen', 'workflow'];
      let found = null;
      for (const t of searchTypes) {
        const candidates = this.reads.list(t, { projectId: -1, userId: -1, scopes: ['public'] });
        found = candidates.find(r => r.uid === cleanRef || r.key === cleanRef || String(r.id) === cleanRef) || null;
        if (found) break;
      }
      if (!found || found.visibility !== 'public') {
        throw new NotFoundError(type || 'public_item', cleanRef);
      }
      if (format === 'svg') {
        if (found.type === 'workflow') throw new ValidationError('workflows have no svg; use format "json"');
        const c = this.#container();
        const styleKey = style || c.settings.get().theme || 'liquid';
        const f = c.exporter.svgFile(found.type, found.id, { theme: styleKey, animated: true });
        return {
          mode: 'item',
          type: found.type,
          uid: found.uid,
          key: found.key,
          name: found.name,
          style: styleKey,
          format: 'svg',
          svg: f.content,
          dependencies: this.reads.dependencies(found.type, found.id).map(d => ({
            type: d.type,
            uid: this.reads.uidOf(d.type, d.id),
            key: this.reads.keyOf(d.type, d.id)
          }))
        };
      }
      return {
        mode: 'item',
        item: this.#itemJsonFor(principal, found),
        dependencies: this.reads.dependencies(found.type, found.id).map(d => ({
          type: d.type,
          uid: this.reads.uidOf(d.type, d.id),
          key: this.reads.keyOf(d.type, d.id)
        })),
        usageHint: 'Call uiux_use_public_element or uiux_copy_item_to_project to copy this public item (and its sub-items) into your project to edit or place on a screen.'
      };
    }

    const wantedTypes = onlyElements
      ? ['element']
      : normalizeTypesList(types, type);
    const terms = String(query || '').toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    const catFilter = String(category || '').trim().toLowerCase();
    const max = Math.min(Math.max(1, Number(limit) || 40), 200);

    const countsByType = {};
    const categoryMap = new Map();
    for (const t of ALL_ITEM_TYPES) {
      const allPub = this.reads.list(t, { projectId: -1, userId: -1, scopes: ['public'] });
      countsByType[t] = allPub.length;
      if (includeCategories && wantedTypes.includes(t)) {
        for (const r of allPub) {
          const cat = r.category || 'general';
          const k = `${t}:${cat}`;
          categoryMap.set(k, { type: t, category: cat, count: (categoryMap.get(k)?.count || 0) + 1 });
        }
      }
    }

    const q = terms.join(' ');
    const rank = r => {
      const key = r.key.toLowerCase(), name = String(r.name || '').toLowerCase();
      let s = r.type === 'element' ? 12 : 0;
      if (r.builtin) s += 5;
      if (q) {
        if (key === q.replace(/\s+/g, '-')) s += 100;
        else if (key.startsWith(terms[0] || '\u0000')) s += 40;
        if (name === q) s += 60;
        for (const term of terms) {
          if (key.includes(term)) s += 15;
          if (name.includes(term)) s += 10;
          if (String(r.label || '').toLowerCase().includes(term)) s += 6;
          if (String(r.tags || '').toLowerCase().includes(term)) s += 5;
          if (String(r.category || '').toLowerCase().includes(term)) s += 4;
        }
      }
      return s;
    };

    const matched = wantedTypes.flatMap(t => {
      const list = terms.length
        ? this.reads.search(t, terms, { projectId: -1, userId: -1, scopes: ['public'], limit: 500 })
        : this.reads.list(t, { projectId: -1, userId: -1, scopes: ['public'] });
      return list.filter(r => !catFilter || String(r.category || '').toLowerCase() === catFilter);
    });

    const ranked = matched
      .map(r => ({ r, s: rank(r) }))
      .sort((a, b) => b.s - a.s || ALL_ITEM_TYPES.indexOf(a.r.type) - ALL_ITEM_TYPES.indexOf(b.r.type) || a.r.key.localeCompare(b.r.key))
      .slice(0, max);

    const items = ranked.map(({ r, s }) => {
      if (detail === 'full') return this.#itemJsonFor(principal, r);
      let parsedTags = [];
      try { parsedTags = Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]'); } catch { parsedTags = []; }
      return {
        type: r.type,
        uid: r.uid,
        key: r.key,
        name: r.name,
        label: r.label,
        category: r.category,
        tags: parsedTags,
        builtin: Boolean(r.builtin),
        size: r.type === 'workflow' ? null : [r.width, r.height],
        purpose: parseMcpContext(r.mcp_context).purpose || '',
        descriptionDev: String(r.description_dev || '').slice(0, 280),
        score: s
      };
    });

    return {
      mode: 'search',
      query,
      types: wantedTypes,
      category: category || null,
      total: matched.length,
      returned: items.length,
      countsByType,
      ...(includeCategories ? { categories: [...categoryMap.values()].sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count || a.category.localeCompare(b.category)) } : {}),
      items
    };
  }

  /* ============================================================================
   * 2. USE PUBLIC ELEMENT / ITEM IN EXISTING PROJECT (`uiux_use_public_element`)
   * ============================================================================ */

  usePublicElement(principal, {
    ref,
    type = 'element',
    copyAsNew = false,
    newName,
    newKey,
    label,
    descriptionDev,
    mcpContext,
    width,
    height,
    placeOn = null
  } = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: true });
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) throw new ValidationError('`ref` (public element/item key, uid, or id) is required');

    // Resolve public item (defaulting to element, or searching public types if auto)
    const candidateTypes = type ? [normalizeType(type)] : ['element', 'button', 'icon', 'path', 'screen', 'workflow'];
    let pubRow = null;
    for (const t of candidateTypes) {
      const pubList = this.reads.list(t, { projectId: -1, userId: -1, scopes: ['public'] });
      pubRow = pubList.find(r => r.uid === cleanRef || r.key === cleanRef || String(r.id) === cleanRef) || null;
      if (pubRow) break;
    }
    if (!pubRow || pubRow.visibility !== 'public') {
      throw new NotFoundError(type || 'element', cleanRef);
    }

    const itemType = pubRow.type;
    const wantsCustomCopy = Boolean(copyAsNew || newName || newKey || label !== undefined || descriptionDev !== undefined || mcpContext !== undefined || width !== undefined || height !== undefined);

    return this.transaction(() => {
      let projectCopyId = null;
      let subItemsCopied = [];
      let reusedExistingClone = false;

      if (!wantsCustomCopy) {
        const existing = this.db.prepare(`SELECT id FROM ${TYPE_TO_TABLE[itemType]} WHERE project_id = ? AND cloned_from_id = ? ORDER BY id LIMIT 1`).get(projectId, pubRow.id);
        if (existing?.id) {
          projectCopyId = Number(existing.id);
          reusedExistingClone = true;
        }
      }

      if (!projectCopyId) {
        const res = c.libraryTransfer.copyToProjects({
          items: [{ type: itemType, id: pubRow.id }],
          projectIds: [projectId],
          visibility: 'project',
          overrideName: newName || null,
          actor
        });
        const entry = res.copied[0];
        projectCopyId = Number(entry.id);
        subItemsCopied = (res.subItems || []).map(s => ({ type: s.type, key: s.key, id: s.id, sourceId: s.sourceId }));

        // Apply optional custom key / metadata overrides on the fresh project copy
        if (itemType === 'workflow') {
          const patch = {};
          if (newKey) {
            const desired = slugify(newKey);
            patch.key = desired === entry.key ? desired : uniqueKey(desired, k => c.workflows.workflows.keyExists(k, projectId));
          }
          if (label !== undefined) patch.label = label;
          if (descriptionDev !== undefined) patch.descriptionDev = descriptionDev;
          if (Object.keys(patch).length) c.workflows.update(projectCopyId, patch, { actor });
        } else {
          const svc = c.services[itemType];
          const patch = {};
          if (newKey) {
            const desired = slugify(newKey);
            patch.key = desired === entry.key ? desired : uniqueKey(desired, k => svc.designs.keyExists(k, projectId));
          }
          if (label !== undefined) patch.label = label;
          if (descriptionDev !== undefined) patch.descriptionDev = descriptionDev;
          if (width !== undefined) patch.width = Number(width);
          if (height !== undefined) patch.height = Number(height);
          if (Object.keys(patch).length) svc.update(projectCopyId, patch, { actor });
        }
        if (mcpContext !== undefined) this.#writeMcpContext(itemType, projectCopyId, mcpContext, { merge: true });
      }

      let placedNode = null;
      let targetSummary = null;
      if (placeOn && typeof placeOn === 'object') {
        const targetType = normalizeType(placeOn.type || 'screen', { allowWorkflow: false });
        const targetRow = this.#requireEditableDesignRow(c, targetType, placeOn.ref, projectId);
        if (!canContain(targetType, itemType)) {
          throw new ValidationError(`Cannot place a "${itemType}" directly onto a "${targetType}" (allowed child types: ${(TYPES[targetType]?.accepts || []).join(', ')})`);
        }
        const copyRec = c.services[itemType].get(projectCopyId);
        placedNode = this.#placeInstanceNode(c, actor, targetType, targetRow.id, itemType, copyRec, placeOn);
        targetSummary = { type: targetType, uid: targetRow.uid, key: targetRow.key, id: targetRow.id };
      }

      this.#notify(projectId);
      const copyRow = this.reads.find(itemType, projectCopyId, projectId);
      return {
        project: { id: proj.id, key: proj.key, name: proj.name },
        sourcePublicItem: { type: itemType, uid: pubRow.uid, key: pubRow.key, name: pubRow.name },
        reusedExistingClone,
        subItemsCopied,
        item: this.#itemJsonFor(principal, copyRow, projectId),
        ...(placedNode ? { placedNode, placedOn: targetSummary } : {})
      };
    });
  }

  /* ============================================================================
   * 3. SEARCH & COPY ANY ITEM INTO AN EXISTING PROJECT TO EDIT (`uiux_copy_item_to_project`)
   * ============================================================================ */

  copyItemToProject(principal, {
    type,
    types,
    ref,
    query = '',
    sourceScope = 'all',
    sourceProject = '',
    category = '',
    searchOnly = false,
    autoPickBest = false,
    newName,
    newKey,
    label,
    descriptionDev,
    mcpContext,
    limit = 30
  } = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: !searchOnly });

    let sourceProjectId = null;
    if (sourceProject && String(sourceProject).trim()) {
      const spKey = String(sourceProject).trim();
      const sp = /^\d+$/.test(spKey) ? c.projects.get(Number(spKey)) : c.projects.projects.getByKey(spKey);
      if (!sp) throw new NotFoundError('project', spKey);
      const role = c.projects.userRole(sp.id, actor);
      if (principal.strict && role !== 'owner' && Number(sp.id) !== 1) throw new NotFoundError('project', spKey);
      if (!role && sp.visibility !== 'public') throw new NotFoundError('project', spKey);
      sourceProjectId = Number(sp.id);
    }

    const collectVisibleCandidates = () => {
      const wantedTypes = normalizeTypesList(types, type);
      const terms = String(query || '').toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
      const catFilter = String(category || '').trim().toLowerCase();
      const out = [];

      for (const t of wantedTypes) {
        const table = TYPE_TO_TABLE[t];
        const cols = t === 'workflow'
          ? "id, uid, key, name, label, 'workflow' AS category, '[]' AS tags, description_dev, mcp_context, visibility, project_id, creator_id, 0 AS builtin, width, height"
          : 'id, uid, key, name, label, category, tags, description_dev, mcp_context, visibility, project_id, creator_id, builtin, width, height';
        // Read rows matching optional text filter
        const sql = t === 'workflow'
          ? `SELECT id, uid, key, name, label, 'workflow' AS category, '[]' AS tags, description_dev, mcp_context, visibility, project_id, creator_id, 0 AS builtin, 0 AS width, 0 AS height FROM ${table} ORDER BY id`
          : `SELECT ${cols} FROM ${table} ORDER BY id`;
        const rows = this.db.prepare(sql).all().map(r => ({ ...r, type: t }));
        for (const r of rows) {
          if (!this.#canReadRow(c, actor, r)) continue;
          if (sourceProjectId != null && Number(r.project_id) !== sourceProjectId) continue;
          const rowScope = Number(r.project_id) === projectId
            ? 'current_project'
            : r.visibility === 'public'
              ? 'public'
              : (r.visibility === 'private' && Number(r.creator_id) === Number(actor.id))
                ? 'private'
                : 'other_project';
          if (sourceScope === 'public' && r.visibility !== 'public') continue;
          if (sourceScope === 'private' && !(r.visibility === 'private' && Number(r.creator_id) === Number(actor.id))) continue;
          if (sourceScope === 'current_project' && Number(r.project_id) !== projectId) continue;
          if (sourceScope === 'other_projects' && (Number(r.project_id) === projectId || r.visibility === 'public')) continue;
          if (catFilter && String(r.category || '').toLowerCase() !== catFilter) continue;
          if (terms.length) {
            const hay = `${r.key} ${r.name} ${r.label} ${r.category} ${r.tags} ${r.description_dev} ${r.mcp_context}`.toLowerCase();
            if (!terms.every(term => hay.includes(term))) continue;
          }
          out.push({ ...r, sourceScope: rowScope });
        }
      }

      const q = terms.join(' ');
      const scoreOf = r => {
        let s = 0;
        if (q) {
          const key = r.key.toLowerCase(), name = String(r.name || '').toLowerCase();
          if (key === q.replace(/\s+/g, '-')) s += 100;
          else if (key.startsWith(terms[0] || '\u0000')) s += 40;
          if (name === q) s += 60;
          for (const term of terms) {
            if (key.includes(term)) s += 15;
            if (name.includes(term)) s += 10;
            if (String(r.label || '').toLowerCase().includes(term)) s += 6;
          }
        }
        if (r.sourceScope === 'public') s += 15;
        if (r.sourceScope === 'private') s += 20;
        if (r.sourceScope === 'other_project') s += 18;
        return s;
      };

      return out
        .map(r => ({ r, score: scoreOf(r) }))
        .sort((a, b) => b.score - a.score || a.r.key.localeCompare(b.r.key));
    };

    const hasRef = Boolean(ref && String(ref).trim());
    if (searchOnly || (!hasRef && !autoPickBest)) {
      const ranked = collectVisibleCandidates();
      const max = Math.min(Math.max(1, Number(limit) || 30), 150);
      const projCache = new Map();
      const projKeyOf = pid => {
        if (pid == null) return null;
        if (!projCache.has(pid)) {
          try { projCache.set(pid, c.projects.get(Number(pid))?.key || null); } catch { projCache.set(pid, null); }
        }
        return projCache.get(pid);
      };
      return {
        mode: 'search',
        targetProject: { id: proj.id, key: proj.key, name: proj.name },
        query,
        sourceScope,
        total: ranked.length,
        returned: Math.min(ranked.length, max),
        candidates: ranked.slice(0, max).map(({ r, score }) => ({
          type: r.type,
          uid: r.uid,
          key: r.key,
          name: r.name,
          label: r.label,
          category: r.category,
          sourceScope: r.sourceScope,
          sourceProject: projKeyOf(r.project_id),
          visibility: r.visibility,
          builtin: Boolean(r.builtin),
          size: r.type === 'workflow' ? null : [r.width, r.height],
          dependencyCount: this.reads.dependencies(r.type, r.id).length,
          purpose: parseMcpContext(r.mcp_context).purpose || '',
          score
        })),
        next: 'Call uiux_copy_item_to_project with { type, ref, newName?, newKey? } to copy any candidate (and all its sub-items) into this project to edit.'
      };
    }

    // Resolve target source row to copy
    let srcRow = null;
    if (hasRef) {
      const cleanRef = String(ref).trim();
      const tryTypes = type ? [normalizeType(type)] : ALL_ITEM_TYPES;
      for (const t of tryTypes) {
        const table = TYPE_TO_TABLE[t];
        const cols = t === 'workflow'
          ? "id, uid, key, name, label, 'workflow' AS category, '[]' AS tags, description_dev, mcp_context, visibility, project_id, creator_id, 0 AS builtin, 0 AS width, 0 AS height"
          : 'id, uid, key, name, label, category, tags, description_dev, mcp_context, visibility, project_id, creator_id, builtin, width, height';
        let r = null;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(cleanRef)) {
          r = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE uid = ?`).get(cleanRef);
        } else if (/^\d+$/.test(cleanRef)) {
          r = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE id = ?`).get(Number(cleanRef));
        } else if (sourceProjectId != null) {
          r = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE key = ? AND project_id = ?`).get(cleanRef, sourceProjectId);
        } else {
          // Prefer source outside target project if copying from public/other project, else fallback to current project (duplicating)
          const matches = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE key = ? ORDER BY (visibility = 'public') DESC, (project_id != ?) DESC, id`).all(cleanRef, projectId);
          r = matches.find(m => this.#canReadRow(c, actor, m)) || null;
        }
        if (r && this.#canReadRow(c, actor, r)) {
          srcRow = { ...r, type: t };
          break;
        }
      }
      if (!srcRow) throw new NotFoundError(type || 'item', cleanRef);
    } else {
      const ranked = collectVisibleCandidates();
      if (!ranked.length) throw new NotFoundError(type || 'item', query || 'matching query');
      srcRow = ranked[0].r;
    }

    const itemType = srcRow.type;
    const sameProject = Number(srcRow.project_id) === projectId;
    const effectiveOverrideName = newName || (sameProject ? `${srcRow.name} copy` : null);

    return this.transaction(() => {
      const res = c.libraryTransfer.copyToProjects({
        items: [{ type: itemType, id: srcRow.id }],
        projectIds: [projectId],
        visibility: 'project',
        overrideName: effectiveOverrideName,
        actor
      });
      const copiedEntry = res.copied[0];
      const copyId = Number(copiedEntry.id);

      if (itemType === 'workflow') {
        const patch = {};
        if (newKey) {
          const desired = slugify(newKey);
          patch.key = desired === copiedEntry.key ? desired : uniqueKey(desired, k => c.workflows.workflows.keyExists(k, projectId));
        }
        if (label !== undefined) patch.label = label;
        if (descriptionDev !== undefined) patch.descriptionDev = descriptionDev;
        if (Object.keys(patch).length) c.workflows.update(copyId, patch, { actor });
      } else {
        const svc = c.services[itemType];
        const patch = {};
        if (newKey) {
          const desired = slugify(newKey);
          patch.key = desired === copiedEntry.key ? desired : uniqueKey(desired, k => svc.designs.keyExists(k, projectId));
        }
        if (label !== undefined) patch.label = label;
        if (category !== undefined) patch.category = category;
        if (descriptionDev !== undefined) patch.descriptionDev = descriptionDev;
        if (Object.keys(patch).length) svc.update(copyId, patch, { actor });
      }
      if (srcRow.mcp_context) this.#writeMcpContext(itemType, copyId, parseMcpContext(srcRow.mcp_context));
      if (mcpContext !== undefined) this.#writeMcpContext(itemType, copyId, mcpContext, { merge: true });

      this.#notify(projectId);
      const copyRow = this.reads.find(itemType, copyId, projectId);
      let srcProjKey = null;
      try { srcProjKey = c.projects.get(Number(srcRow.project_id))?.key || null; } catch { srcProjKey = null; }
      return {
        mode: 'copied',
        targetProject: { id: proj.id, key: proj.key, name: proj.name },
        source: {
          type: itemType,
          uid: srcRow.uid,
          key: srcRow.key,
          name: srcRow.name,
          visibility: srcRow.visibility,
          sourceProject: srcProjKey
        },
        subItemsCopied: (res.subItems || []).map(s => ({ type: s.type, key: s.key, id: s.id, sourceId: s.sourceId })),
        item: this.#itemJsonFor(principal, copyRow, projectId)
      };
    });
  }

  /* ============================================================================
   * 4. FULL CRUD FOR ALL 6 ITEM KINDS (`path`, `icon`, `button`, `element`, `screen`, `workflow`)
   * ============================================================================ */

  listProjectItems(principal, {
    type,
    types,
    query = '',
    category = '',
    detail = 'summary',
    includeTrash = false,
    limit = 100
  } = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: false });
    const wantedTypes = normalizeTypesList(types, type);
    const terms = String(query || '').toLowerCase().split(/\s+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    const catFilter = String(category || '').trim().toLowerCase();
    const max = Math.min(Math.max(1, Number(limit) || 100), 500);

    const countsByType = {};
    for (const t of ALL_ITEM_TYPES) {
      countsByType[t] = this.reads.list(t, { projectId, userId: actor.id, scopes: ['project'] }).length;
    }

    const rows = wantedTypes.flatMap(t => {
      const list = terms.length
        ? this.reads.search(t, terms, { projectId, userId: actor.id, scopes: ['project'], limit: 500 })
        : this.reads.list(t, { projectId, userId: actor.id, scopes: ['project'] });
      return list.filter(r => !catFilter || String(r.category || '').toLowerCase() === catFilter);
    });

    const items = rows.slice(0, max).map(r => {
      if (detail === 'full') return this.#itemJsonFor(principal, r, projectId);
      return {
        type: r.type,
        uid: r.uid,
        key: r.key,
        name: r.name,
        label: r.label,
        category: r.category,
        visibility: r.visibility,
        size: r.type === 'workflow' ? null : [r.width, r.height],
        contentHash: this.hashes.get(r.type, r.id),
        purpose: parseMcpContext(r.mcp_context).purpose || '',
        updatedAt: r.updated_at
      };
    });

    const out = {
      project: { id: proj.id, key: proj.key, name: proj.name },
      countsByType,
      total: rows.length,
      returned: items.length,
      items
    };
    if (includeTrash && c.trash) {
      const trashed = c.trash.list({ projectId }, { actor }).filter(t => wantedTypes.includes(t.itemType));
      out.trash = trashed.map(t => ({
        trashId: t.id,
        type: t.itemType,
        key: t.key ?? t.itemKey,
        name: t.name ?? t.itemName,
        deletedAt: t.deletedAt
      }));
    }
    return out;
  }

  /** Resolves an item reference (uid, key, or id) for sub-item links, auto-copying public/foreign readable items into `projectId`. */
  #resolveOrAdoptProjectItemId(c, actor, projectId, type, ref) {
    if (ref === undefined || ref === null || ref === '') return null;
    const cleanType = normalizeType(type);
    const raw = typeof ref === 'object' ? String(ref.uid || ref.key || ref.id || '').trim() : String(ref).trim();
    if (!raw) return null;

    // 1. Check in target project first
    const inProj = this.reads.findInProject(cleanType, raw, projectId)
      || (this.reads.find(cleanType, raw, projectId)?.project_id === projectId ? this.reads.find(cleanType, raw, projectId) : null);
    if (inProj && Number(inProj.project_id) === Number(projectId)) return Number(inProj.id);

    // 2. Otherwise find readable public/private/shared item and copy/adopt into project
    const table = TYPE_TO_TABLE[cleanType];
    const cols = cleanType === 'workflow'
      ? "id, uid, key, name, visibility, project_id, creator_id, 0 AS builtin"
      : 'id, uid, key, name, visibility, project_id, creator_id, builtin';
    let candidate = null;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
      candidate = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE uid = ?`).get(raw);
    } else if (/^\d+$/.test(raw)) {
      candidate = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE id = ?`).get(Number(raw));
    } else {
      const list = this.db.prepare(`SELECT ${cols} FROM ${table} WHERE key = ? ORDER BY (visibility = 'public') DESC, id`).all(raw);
      candidate = list.find(m => this.#canReadRow(c, actor, m)) || null;
    }
    if (!candidate || !this.#canReadRow(c, actor, candidate)) {
      throw new NotFoundError(cleanType, raw);
    }
    if (Number(candidate.project_id) === Number(projectId)) return Number(candidate.id);

    // Reuse existing clone in project if already adopted, otherwise cascade copy
    const existingClone = this.db.prepare(`SELECT id FROM ${table} WHERE project_id = ? AND cloned_from_id = ? ORDER BY id LIMIT 1`).get(projectId, candidate.id);
    if (existingClone?.id) return Number(existingClone.id);

    const copied = c.libraryTransfer.copyToProjects({
      items: [{ type: cleanType, id: candidate.id }],
      projectIds: [projectId],
      visibility: 'project',
      actor
    });
    return Number(copied.copied[0].id);
  }

  #normalizeActionRefs(c, actor, projectId, action) {
    if (!action || typeof action !== 'object') return action;
    const out = { ...action };
    const targetRef = out.target ?? out.targetKey ?? out.targetUid ?? out.targetId;
    const actionKind = out.type;
    const targetType = actionKind === 'screen' || actionKind === 'navigate'
      ? 'screen'
      : ['element', 'popup', 'drawer', 'toolbar'].includes(actionKind)
        ? 'element'
        : (typeof out.target === 'object' && out.target?.type ? out.target.type : null);
    if (targetType && targetRef != null) {
      out.targetId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, targetType, targetRef);
      delete out.target;
      delete out.targetKey;
      delete out.targetUid;
    }
    if (out.elementRef != null || out.elementId != null) {
      out.elementId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'element', out.elementRef ?? out.elementId);
      delete out.elementRef;
    }
    return out;
  }

  #materializeInputNodes(c, actor, projectId, ownerType, rawNodes = []) {
    // Support both flat `parentId` and `index`/`parentIndex` portable node lists
    const indexCreatedIds = new Map();
    const createdNodes = [];
    const svc = c.services[ownerType];

    for (let idx = 0; idx < rawNodes.length; idx++) {
      const raw = rawNodes[idx];
      const n = { ...raw };
      const logicalIdx = Number.isInteger(n.index) ? n.index : idx;
      let parentId = n.parentId ?? null;
      if (parentId == null && Number.isInteger(n.parentIndex) && indexCreatedIds.has(n.parentIndex)) {
        parentId = indexCreatedIds.get(n.parentIndex);
      }

      let refType = n.refType || n.ref?.type || null;
      let refId = n.refId ?? null;
      if ((n.kind === 'instance' || n.ref) && refType) {
        refType = normalizeType(refType, { allowWorkflow: false });
        if (!canContain(ownerType, refType)) {
          throw new ValidationError(`"${ownerType}" cannot contain instance of "${refType}" (allowed: ${(TYPES[ownerType]?.accepts || []).join(', ')})`);
        }
        const refVal = n.ref?.uid ?? n.ref?.key ?? n.ref?.id ?? n.refKey ?? n.refUid ?? n.refId;
        refId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, refType, refVal);
      }

      const onClick = n.onClick ? this.#normalizeActionRefs(c, actor, projectId, n.onClick) : null;
      const events = Array.isArray(n.events) ? n.events.map(ev => this.#normalizeActionRefs(c, actor, projectId, ev)) : [];

      const made = svc.addNode(n.__ownerId, {
        kind: n.kind || (refType ? 'instance' : n.tag === 'text' ? 'text' : n.tag === 'g' ? 'group' : 'shape'),
        tag: n.tag || (refType ? 'use' : 'rect'),
        name: n.name || '',
        role: n.role || (refType ? 'instance' : 'shape'),
        parentId,
        ord: n.ord ?? idx,
        refType,
        refId,
        rotation: n.rotation ?? 0,
        locked: Boolean(n.locked),
        visible: n.visible !== false,
        text: n.text || '',
        attrs: n.attrs || {},
        onClick,
        events,
        descriptionDev: n.descriptionDev || ''
      }, { actor });
      indexCreatedIds.set(logicalIdx, made.id);
      createdNodes.push(made);
    }
    return { createdNodes, indexCreatedIds };
  }

  createItem(principal, args = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: true });
    const itemType = normalizeType(args.type);
    const name = String(args.name || '').trim();
    if (!name) throw new ValidationError('`name` is required to create an item');

    return this.transaction(() => {
      if (itemType === 'workflow') {
        let wf;
        if (args.fromScreen) {
          const startScreenId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', args.fromScreen);
          wf = c.workflows.generateFromScreen({
            screenId: startScreenId,
            name,
            key: args.key ? slugify(args.key) : undefined,
            label: args.label ?? name,
            descriptionDev: args.descriptionDev ?? '',
            projectId,
            visibility: 'project'
          }, { actor });
        } else {
          wf = c.workflows.create({
            name,
            key: args.key ? slugify(args.key) : undefined,
            label: args.label ?? name,
            descriptionDev: args.descriptionDev ?? '',
            projectId,
            visibility: 'project'
          }, { actor });
        }

        if (Array.isArray(args.screens)) {
          for (let i = 0; i < args.screens.length; i++) {
            const sc = args.screens[i];
            const sid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', sc.screen ?? sc.screenKey ?? sc.screenUid ?? sc.screenId);
            c.workflows.placeScreen(wf.id, {
              screenId: sid,
              x: sc.x ?? i * 560,
              y: sc.y ?? 0,
              collapsed: Boolean(sc.collapsed),
              locked: Boolean(sc.locked)
            }, { actor });
          }
        }
        if (Array.isArray(args.links)) {
          for (const lk of args.links) {
            const fromSid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', lk.from ?? lk.fromScreen ?? lk.fromScreenId);
            const toSid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', lk.to ?? lk.toScreen ?? lk.toScreenId);
            let fromNodeId = lk.fromNodeId ?? null;
            if (fromNodeId == null && lk.fromNodeName) {
              const sNodes = c.services.screen.get(fromSid).nodes || [];
              fromNodeId = sNodes.find(n => n.name === lk.fromNodeName)?.id ?? null;
            }
            c.workflows.addLink(wf.id, {
              fromScreenId: fromSid,
              toScreenId: toSid,
              fromNodeId,
              name: lk.name ?? '',
              descriptionDev: lk.descriptionDev ?? '',
              style: lk.style ?? 'curved',
              trigger: lk.trigger ?? 'tap'
            }, { actor });
          }
        }
        if (args.mcpContext !== undefined) this.#writeMcpContext('workflow', wf.id, args.mcpContext);
        this.#notify(projectId);
        return {
          created: true,
          project: { id: proj.id, key: proj.key, name: proj.name },
          item: this.#itemJsonFor(principal, this.reads.find('workflow', wf.id, projectId), projectId)
        };
      }

      // Design item (`path`, `icon`, `button`, `element`, `screen`)
      const svc = c.services[itemType];
      const defSize = TYPES[itemType].size;
      let width = args.width ?? defSize[0];
      let height = args.height ?? defSize[1];
      const meta = { ...(args.meta || {}) };

      if (itemType === 'screen' && args.deviceKey) {
        const dev = this.reads.devices().find(d => d.key === args.deviceKey);
        if (!dev) throw new ValidationError(`Unknown deviceKey "${args.deviceKey}"; call uiux_get_schema to see available devices.`);
        width = args.width ?? dev.width;
        height = args.height ?? dev.height;
        meta.deviceKey = dev.key;
        meta.cornerRadius = meta.cornerRadius ?? dev.corner_radius;
        meta.grid = meta.grid ?? dev.grid;
      }

      if (itemType === 'element' && (args.isContainer || args.containerType)) {
        meta.isContainer = true;
        if (args.containerType === 'carousel') meta.containerType = 'carousel';
      }

      if (itemType === 'button' && args.menuConfig) {
        meta.menu = { ...(meta.menu || {}), ...args.menuConfig };
      }

      let created;
      if (args.svg && String(args.svg).trim()) {
        if (itemType === 'screen') {
          if (!this.parseSvg) throw new ValidationError('SVG parser is unavailable');
          const parsed = this.parseSvg(String(args.svg), {});
          created = svc.create({
            name,
            key: args.key ? slugify(args.key) : undefined,
            label: args.label ?? name,
            category: args.category || 'general',
            tags: Array.isArray(args.tags) ? args.tags : [],
            width,
            height,
            descriptionDev: args.descriptionDev || '',
            meta,
            projectId,
            visibility: 'project'
          }, { actor, nodes: parsed.nodes || [] });
        } else {
          if (!c.svgImport) throw new ValidationError('SVG import service is unavailable');
          created = c.svgImport.import({
            svg: String(args.svg),
            as: itemType,
            name,
            key: args.key ? slugify(args.key) : undefined,
            category: args.category || 'general',
            projectId,
            visibility: 'project'
          }, { actor });
          const postPatch = {};
          if (args.label !== undefined) postPatch.label = args.label;
          if (args.descriptionDev !== undefined) postPatch.descriptionDev = args.descriptionDev;
          if (args.width !== undefined && !TYPES[itemType].fixedSize) postPatch.width = width;
          if (args.height !== undefined && !TYPES[itemType].fixedSize) postPatch.height = height;
          if (Array.isArray(args.tags)) postPatch.tags = args.tags;
          if (Object.keys(meta).length) postPatch.meta = { ...(created.meta || {}), ...meta };
          if (Object.keys(postPatch).length) created = svc.update(created.id, postPatch, { actor });
        }
      } else {
        created = svc.create({
          name,
          key: args.key ? slugify(args.key) : undefined,
          label: args.label ?? name,
          category: args.category || (itemType === 'element' && meta.isContainer ? 'containers' : 'general'),
          tags: Array.isArray(args.tags) ? args.tags : [],
          width,
          height,
          descriptionDev: args.descriptionDev || '',
          meta,
          projectId,
          visibility: 'project'
        }, { actor });
      }

      // Optional button icon shortcut (`iconRef`)
      if (itemType === 'button' && args.iconRef && !args.nodes?.length && !args.svg) {
        const iconId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'icon', args.iconRef);
        const iconSz = Math.round(Math.min(width, height) * 0.5);
        // Add button surface rect + centered icon instance
        svc.addNode(created.id, {
          kind: 'shape',
          tag: 'rect',
          name: 'btn-bg',
          role: 'surface',
          ord: 0,
          attrs: { x: 2, y: 2, width: Math.max(4, width - 4), height: Math.max(4, height - 4), rx: Math.round(Math.min(width, height) * 0.22), fill: '{{surface}}', stroke: '{{accent}}', 'stroke-width': '{{sw}}' }
        }, { actor });
        svc.addNode(created.id, {
          kind: 'instance',
          tag: 'use',
          name: 'btn-icon',
          role: 'glyph',
          refType: 'icon',
          refId: iconId,
          ord: 1,
          attrs: { x: Math.round((width - iconSz) / 2), y: Math.round((height - iconSz) / 2), width: iconSz, height: iconSz }
        }, { actor });
      }

      let indexCreatedIds = new Map();
      if (Array.isArray(args.nodes) && args.nodes.length) {
        const tagged = args.nodes.map(n => ({ ...n, __ownerId: created.id }));
        ({ indexCreatedIds } = this.#materializeInputNodes(c, actor, projectId, itemType, tagged));
      }

      if (Array.isArray(args.animations) && args.animations.length) {
        const currentNodes = svc.get(created.id).nodes || [];
        for (const anim of args.animations) {
          const targetNodeId = anim.nodeId
            ?? (Number.isInteger(anim.nodeIndex) ? (indexCreatedIds.get(anim.nodeIndex) ?? currentNodes[anim.nodeIndex]?.id) : null)
            ?? (anim.nodeName ? currentNodes.find(n => n.name === anim.nodeName)?.id : null);
          if (!targetNodeId) throw new ValidationError(`Animation "${anim.name || anim.type}" could not resolve target node`);
          svc.addAnimation(targetNodeId, anim, { actor });
        }
      }

      if (itemType === 'button' && Array.isArray(args.menuItems) && c.menus) {
        this.#replaceButtonMenuItems(c, actor, projectId, created.id, args.menuItems);
      }
      if (itemType === 'button' && args.menuConfig && c.menus) {
        c.menus.setConfig(created.id, args.menuConfig);
      }

      if (args.script !== undefined && args.script !== null) {
        if (itemType !== 'element') throw new ValidationError('`script` is only supported on items of type "element"');
        if (!c.elementScripts) throw new DomainError('Element script service is unavailable', 'INTERNAL', 500);
        c.elementScripts.setSync(created.id, args.script, {
          actor,
          actorId: actor.id,
          requireIntegrity: Boolean(args.script.requireIntegrity),
          lockfilePackages: args.script.lockfilePackages || null
        });
      }

      if (args.mcpContext !== undefined) this.#writeMcpContext(itemType, created.id, args.mcpContext);
      this.#notify(projectId);
      return {
        created: true,
        project: { id: proj.id, key: proj.key, name: proj.name },
        item: this.#itemJsonFor(principal, this.reads.find(itemType, created.id, projectId), projectId)
      };
    });
  }

  #replaceButtonMenuItems(c, actor, projectId, buttonId, menuItems) {
    const existing = c.menus.get(buttonId)?.items || [];
    for (const old of existing) {
      if (!c.menus.menus || c.menus.menus.get(old.id)) {
        c.menus.removeItem(old.id, { buttonId });
      }
    }
    const byNameId = new Map();
    for (let i = 0; i < menuItems.length; i++) {
      const mi = menuItems[i];
      const iconId = mi.icon || mi.iconRef || mi.iconId
        ? this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'icon', mi.icon ?? mi.iconRef ?? mi.iconId)
        : null;
      const targetScreenId = mi.targetScreen || mi.targetScreenId
        ? this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', mi.targetScreen ?? mi.targetScreenId)
        : null;
      const targetElementId = mi.targetElement || mi.targetElementId
        ? this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'element', mi.targetElement ?? mi.targetElementId)
        : null;
      const refButtonId = mi.button || mi.refButtonId
        ? this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'button', mi.button ?? mi.refButtonId)
        : null;
      const parentId = mi.parentId ?? (mi.parent ? byNameId.get(mi.parent) ?? null : null);
      const createdMi = c.menus.addItem(buttonId, {
        name: slugify(mi.name || mi.label || `item-${i + 1}`),
        label: mi.label ?? mi.name ?? `Item ${i + 1}`,
        action: mi.action || (targetScreenId ? 'screen' : targetElementId ? 'element' : 'emit'),
        ord: mi.ord ?? i,
        parentId,
        iconId,
        targetScreenId,
        targetElementId,
        refButtonId,
        visible: mi.visible !== false,
        descriptionDev: mi.descriptionDev || ''
      });
      byNameId.set(createdMi.name, createdMi.id);
      if (mi.name) byNameId.set(mi.name, createdMi.id);
    }
  }

  /** Resolves an editable row in `projectId`, optionally copying a foreign/public item into `projectId` first if `copyIfForeign` is true. */
  #resolveEditableTarget(principal, c, actor, projectId, type, ref, { copyIfForeign = false } = {}) {
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) throw new ValidationError(`Missing ${type} reference (\`ref\`)`);

    const inProj = this.reads.findInProject(type, cleanRef, projectId)
      || (() => {
        const r = this.reads.find(type, cleanRef, projectId);
        return r && Number(r.project_id) === Number(projectId) ? r : null;
      })();

    if (inProj) {
      if (this.#isImmutablePublicRow(inProj)) {
        if (!copyIfForeign) {
          throw deny(`Public/built-in ${type} "${inProj.key}" is immutable; call uiux_copy_item_to_project or pass copyIfForeign: true.`);
        }
      } else {
        return { row: inProj, copiedFromForeign: false };
      }
    }

    // Look for a readable foreign/public item
    const anyRow = this.reads.find(type, cleanRef, projectId);
    if (!anyRow || !this.#canReadRow(c, actor, anyRow)) {
      throw new NotFoundError(type, cleanRef);
    }
    if (!copyIfForeign) {
      throw deny(`${type} "${anyRow.key}" belongs to ${anyRow.visibility === 'public' ? 'the public library' : `another project (#${anyRow.project_id})`}; call uiux_copy_item_to_project first or pass copyIfForeign: true.`);
    }
    const copyRes = this.copyItemToProject(principal, { type, ref: anyRow.uid || anyRow.id });
    const newRow = this.reads.find(type, copyRes.item.uid, projectId);
    return { row: newRow, copiedFromForeign: true };
  }

  updateItem(principal, args = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: true });
    const itemType = normalizeType(args.type);

    return this.transaction(() => {
      const { row, copiedFromForeign } = this.#resolveEditableTarget(principal, c, actor, projectId, itemType, args.ref, {
        copyIfForeign: Boolean(args.copyIfForeign)
      });

      if (itemType === 'workflow') {
        const patch = {};
        for (const k of ['name', 'label', 'descriptionDev', 'locked']) {
          if (args[k] !== undefined) patch[k] = args[k];
        }
        if (args.newKey || args.key) patch.key = slugify(args.newKey || args.key);
        if (Object.keys(patch).length) c.workflows.update(row.id, patch, { actor });

        if (args.replaceWorkflowGraph || Array.isArray(args.screens) || Array.isArray(args.links)) {
          if (args.replaceWorkflowGraph !== false && (Array.isArray(args.screens) || Array.isArray(args.links))) {
            c.workflows.workflows.clearContent(row.id);
          }
          if (Array.isArray(args.screens)) {
            for (let i = 0; i < args.screens.length; i++) {
              const sc = args.screens[i];
              const sid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', sc.screen ?? sc.screenKey ?? sc.screenUid ?? sc.screenId);
              c.workflows.placeScreen(row.id, {
                screenId: sid,
                x: sc.x ?? i * 560,
                y: sc.y ?? 0,
                collapsed: Boolean(sc.collapsed),
                locked: Boolean(sc.locked)
              }, { actor });
            }
          }
          if (Array.isArray(args.links)) {
            for (const lk of args.links) {
              const fromSid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', lk.from ?? lk.fromScreen ?? lk.fromScreenId);
              const toSid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', lk.to ?? lk.toScreen ?? lk.toScreenId);
              let fromNodeId = lk.fromNodeId ?? null;
              if (fromNodeId == null && lk.fromNodeName) {
                const sNodes = c.services.screen.get(fromSid).nodes || [];
                fromNodeId = sNodes.find(n => n.name === lk.fromNodeName)?.id ?? null;
              }
              c.workflows.addLink(row.id, {
                fromScreenId: fromSid,
                toScreenId: toSid,
                fromNodeId,
                name: lk.name ?? '',
                descriptionDev: lk.descriptionDev ?? '',
                style: lk.style ?? 'curved',
                trigger: lk.trigger ?? 'tap'
              }, { actor });
            }
          }
        }
        if (args.importRoutesFromScreen) {
          const startSid = this.#resolveOrAdoptProjectItemId(c, actor, projectId, 'screen', args.importRoutesFromScreen);
          c.workflows.importRoutes(row.id, { screenId: startSid, x: 0, y: 0 }, { actor });
        }
        if (args.mcpContext !== undefined) this.#writeMcpContext('workflow', row.id, args.mcpContext, { merge: true });
        this.#notify(projectId);
        return {
          updated: true,
          copiedFromForeign,
          project: { id: proj.id, key: proj.key, name: proj.name },
          item: this.#itemJsonFor(principal, this.reads.find('workflow', row.id, projectId), projectId)
        };
      }

      const svc = c.services[itemType];
      const current = svc.get(row.id);
      const patch = {};
      for (const k of ['name', 'label', 'category', 'tags', 'width', 'height', 'locked', 'descriptionDev']) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      if (args.newKey || (args.key && args.key !== current.key)) {
        patch.key = slugify(args.newKey || args.key);
      }
      if (args.meta !== undefined || args.menuConfig !== undefined) {
        patch.meta = {
          ...(current.meta || {}),
          ...(args.meta || {}),
          ...(args.menuConfig ? { menu: { ...(current.meta?.menu || {}), ...args.menuConfig } } : {})
        };
      }
      if (Object.keys(patch).length) {
        svc.update(row.id, patch, { actor, scaleContent: args.scaleContent });
      }

      if (args.svg && String(args.svg).trim()) {
        if (!this.parseSvg) throw new ValidationError('SVG parser is unavailable');
        const parsed = this.parseSvg(String(args.svg), { targetSize: [patch.width ?? current.width, patch.height ?? current.height] });
        svc.replaceNodes(row.id, parsed.nodes || [], { actor });
      } else if (Array.isArray(args.nodes)) {
        svc.replaceNodes(row.id, [], { actor });
        const tagged = args.nodes.map(n => ({ ...n, __ownerId: row.id }));
        this.#materializeInputNodes(c, actor, projectId, itemType, tagged);
      } else if (Array.isArray(args.appendNodes) && args.appendNodes.length) {
        const baseOrd = (svc.get(row.id).nodes || []).length;
        const tagged = args.appendNodes.map((n, i) => ({ ...n, ord: n.ord ?? (baseOrd + i), __ownerId: row.id }));
        this.#materializeInputNodes(c, actor, projectId, itemType, tagged);
      }

      if (Array.isArray(args.animations)) {
        const fresh = svc.get(row.id);
        for (const oldA of fresh.animations || []) svc.removeAnimation(oldA.id, { actor, ownerId: row.id });
        const freshNodes = fresh.nodes || [];
        for (const anim of args.animations) {
          const targetNodeId = anim.nodeId
            ?? (Number.isInteger(anim.nodeIndex) ? freshNodes[anim.nodeIndex]?.id : null)
            ?? (anim.nodeName ? freshNodes.find(n => n.name === anim.nodeName)?.id : null);
          if (!targetNodeId) throw new ValidationError(`Animation "${anim.name || anim.type}" could not resolve target node`);
          svc.addAnimation(targetNodeId, anim, { actor });
        }
      }

      if (itemType === 'button' && Array.isArray(args.menuItems) && c.menus) {
        this.#replaceButtonMenuItems(c, actor, projectId, row.id, args.menuItems);
      }
      if (itemType === 'button' && args.menuConfig && c.menus) {
        c.menus.setConfig(row.id, args.menuConfig);
      }

      if (args.script !== undefined) {
        if (itemType !== 'element') throw new ValidationError('`script` is only supported on items of type "element"');
        if (!c.elementScripts) throw new DomainError('Element script service is unavailable', 'INTERNAL', 500);
        if (args.script === null) {
          c.elementScripts.remove(row.id, { actor, checkEditable: false });
        } else {
          c.elementScripts.setSync(row.id, args.script, {
            actor,
            actorId: actor.id,
            requireIntegrity: Boolean(args.script.requireIntegrity),
            lockfilePackages: args.script.lockfilePackages || null
          });
        }
      }

      if (args.mcpContext !== undefined) this.#writeMcpContext(itemType, row.id, args.mcpContext, { merge: true });
      this.#notify(projectId);
      return {
        updated: true,
        copiedFromForeign,
        project: { id: proj.id, key: proj.key, name: proj.name },
        item: this.#itemJsonFor(principal, this.reads.find(itemType, row.id, projectId), projectId)
      };
    });
  }

  deleteItem(principal, {
    type,
    ref,
    trashId,
    restore = false,
    force = false
  } = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: true });

    if (restore) {
      if (!c.trash) throw new ValidationError('Trash service is unavailable');
      let targetTrashId = trashId ? Number(trashId) : null;
      if (!targetTrashId) {
        const wantedType = type ? normalizeType(type) : null;
        const cleanRef = String(ref || '').trim();
        const trashed = c.trash.list({ projectId }, { actor });
        const match = trashed.find(t =>
          (!wantedType || t.itemType === wantedType)
          && (!cleanRef || (t.key ?? t.itemKey) === cleanRef || t.snapshot?.uid === cleanRef || String(t.originalId) === cleanRef || String(t.id) === cleanRef)
        );
        if (!match) throw new NotFoundError('trash_item', cleanRef || wantedType || 'latest');
        targetTrashId = match.id;
      }
      const res = c.trash.restore(targetTrashId, { actor });
      this.#notify(projectId);
      const restoredRow = this.reads.find(res.itemType, res.item.id, projectId);
      return {
        restored: true,
        trashId: targetTrashId,
        project: { id: proj.id, key: proj.key, name: proj.name },
        item: restoredRow ? this.#itemJsonFor(principal, restoredRow, projectId) : res.item
      };
    }

    const itemType = normalizeType(type);
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) throw new ValidationError('`ref` (item key, uid, or id) is required');
    const row = this.reads.findInProject(itemType, cleanRef, projectId)
      || (() => {
        const r = this.reads.find(itemType, cleanRef, projectId);
        return r && Number(r.project_id) === Number(projectId) ? r : null;
      })();
    if (!row) {
      const foreign = this.reads.find(itemType, cleanRef, projectId);
      if (foreign && this.#canReadRow(c, actor, foreign)) {
        throw deny(`Cannot delete ${itemType} "${foreign.key}" because it does not belong to project "${proj.key}".`);
      }
      throw new NotFoundError(itemType, cleanRef);
    }
    if (this.#isImmutablePublicRow(row)) {
      throw deny(`Public/built-in ${itemType} "${row.key}" cannot be deleted over MCP.`);
    }

    const del = itemType === 'workflow'
      ? c.workflows.remove(row.id, { actor, permanent: false })
      : c.services[itemType].remove(row.id, { actor, permanent: false, confirmUsage: !force, force: Boolean(force) });

    this.#notify(projectId);
    return {
      deleted: true,
      trashed: Boolean(del.trashed),
      trashId: del.trashId ?? null,
      type: itemType,
      uid: row.uid,
      key: row.key,
      project: { id: proj.id, key: proj.key, name: proj.name }
    };
  }

  /* ============================================================================
   * 5. GRAPHICAL CANVAS & VECTOR EDITING TOOLS (`uiux_graphic_tool`)
   * ============================================================================ */

  #requireEditableDesignRow(c, type, ref, projectId) {
    const cleanRef = String(ref || '').trim();
    if (!cleanRef) throw new ValidationError(`Missing target ${type} reference (\`ref\`)`);
    const row = this.reads.findInProject(type, cleanRef, projectId)
      || (() => {
        const r = this.reads.find(type, cleanRef, projectId);
        return r && Number(r.project_id) === Number(projectId) ? r : null;
      })();
    if (!row) throw new NotFoundError(type, cleanRef);
    if (this.#isImmutablePublicRow(row)) {
      throw deny(`Public/built-in ${type} "${row.key}" cannot be modified in place; copy it into your project first.`);
    }
    return row;
  }

  #placeInstanceNode(c, actor, ownerType, ownerId, refType, refDoc, opts = {}) {
    const svc = c.services[ownerType];
    const doc = svc.get(ownerId);
    const defaultW = opts.width ?? refDoc.width ?? TYPES[refType]?.size?.[0] ?? 48;
    const defaultH = opts.height ?? refDoc.height ?? TYPES[refType]?.size?.[1] ?? 48;
    let x = opts.x ?? 0;
    let y = opts.y ?? 0;
    if (opts.anchor && ANCHORS.includes(opts.anchor)) {
      const containerW = doc.width || 390;
      const containerH = doc.height || 844;
      const pos = placeAtAnchor({ w: defaultW, h: defaultH }, { w: containerW, h: containerH }, opts.anchor, num(opts.margin, 16));
      x = opts.x !== undefined ? num(opts.x) : round(pos.x);
      y = opts.y !== undefined ? num(opts.y) : round(pos.y);
    }
    let parentId = opts.parentId ?? null;
    if (parentId == null && opts.parentName) {
      parentId = (doc.nodes || []).find(n => n.name === opts.parentName)?.id ?? null;
    }
    const onClick = opts.onClick ? this.#normalizeActionRefs(c, actor, doc.projectId, opts.onClick) : null;
    const events = Array.isArray(opts.events) ? opts.events.map(ev => this.#normalizeActionRefs(c, actor, doc.projectId, ev)) : [];
    return svc.addNode(ownerId, {
      kind: 'instance',
      tag: 'use',
      name: opts.name || refDoc.key || `${refType}-instance`,
      role: opts.role || 'instance',
      parentId,
      refType,
      refId: refDoc.id,
      attrs: { x: round(x), y: round(y), width: round(defaultW), height: round(defaultH), ...(opts.attrs || {}) },
      onClick,
      events,
      descriptionDev: opts.descriptionDev || ''
    }, { actor });
  }

  #selectNodes(allNodes, step, { defaultAllVector = false, defaultAllRoot = false } = {}) {
    const byId = new Map(allNodes.map(n => [n.id, n]));
    const selected = [];
    const seen = new Set();
    const push = n => { if (n && !seen.has(n.id)) { seen.add(n.id); selected.push(n); } };

    if (Array.isArray(step.nodeIds)) {
      for (const id of step.nodeIds) push(byId.get(Number(id)));
    }
    if (step.nodeId !== undefined) push(byId.get(Number(step.nodeId)));
    if (Array.isArray(step.nodeIndices)) {
      for (const i of step.nodeIndices) push(allNodes[Number(i)]);
    }
    if (Number.isInteger(step.nodeIndex)) push(allNodes[step.nodeIndex]);
    if (Array.isArray(step.nodeNames)) {
      for (const nm of step.nodeNames) {
        for (const n of allNodes) if (n.name === nm) push(n);
      }
    }
    if (step.nodeName) {
      for (const n of allNodes) if (n.name === step.nodeName) push(n);
    }

    if (!selected.length) {
      if (defaultAllVector) {
        for (const n of allNodes) if (worldCommands(n, allNodes)) push(n);
      } else if (defaultAllRoot) {
        for (const n of allNodes) if (n.parentId == null) push(n);
      }
    }
    return selected;
  }

  #applyNodePatches(svc, actor, ownerId, patches) {
    const updated = [];
    for (const p of patches) {
      const body = {};
      if (p.attrs !== undefined) body.attrs = p.attrs;
      if (p.rotation !== undefined) body.rotation = p.rotation;
      if (p.tag !== undefined) body.tag = p.tag;
      if (p.kind !== undefined) body.kind = p.kind;
      if (p.role !== undefined) body.role = p.role;
      if (p.name !== undefined) body.name = p.name;
      if (p.locked !== undefined) body.locked = p.locked;
      if (p.visible !== undefined) body.visible = p.visible;
      if (p.text !== undefined) body.text = p.text;
      if (p.onClick !== undefined) body.onClick = p.onClick;
      if (p.events !== undefined) body.events = p.events;
      if (p.descriptionDev !== undefined) body.descriptionDev = p.descriptionDev;
      updated.push(svc.updateNode(p.id, body, { actor }));
    }
    return updated;
  }

  /** Preserves node animations across structural node-list replacements (`group`, `ungroup`, `pathfinder`, `break_apart`, `explode_icon`). */
  #replaceNodeListWithAnimations(svc, actor, ownerId, nextNodes) {
    const current = svc.get(ownerId);
    const animsByNode = new Map();
    for (const a of current.animations || []) {
      if (!animsByNode.has(a.nodeId)) animsByNode.set(a.nodeId, []);
      animsByNode.get(a.nodeId).push(a);
    }
    const enriched = nextNodes.map((n, i) => ({
      ...n,
      ord: n.ord ?? i,
      animations: n.animations ?? animsByNode.get(n.id) ?? []
    }));
    return svc.replaceNodes(ownerId, enriched, { actor });
  }

  graphicTool(principal, args = {}) {
    const { c, actor, proj, projectId } = this.#requireBoundProject(principal, { requireEdit: true });
    const ownerType = normalizeType(args.type, { allowWorkflow: false });

    const steps = Array.isArray(args.operations) && args.operations.length
      ? args.operations
      : [{ ...args, operation: args.operation }];

    for (const st of steps) {
      if (!GRAPHIC_OPERATIONS.includes(st.operation)) {
        throw new ValidationError(`Unsupported graphical operation "${st.operation}"; expected one of: ${GRAPHIC_OPERATIONS.join(', ')}`);
      }
    }

    return this.transaction(() => {
      const { row, copiedFromForeign } = this.#resolveEditableTarget(principal, c, actor, projectId, ownerType, args.ref, {
        copyIfForeign: Boolean(args.copyIfForeign)
      });
      const svc = c.services[ownerType];
      const stepResults = [];
      const createdLibraryItems = [];

      for (const step of steps) {
        const op = step.operation;
        const doc = svc.get(row.id);
        const allNodes = [...(doc.nodes || [])].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id);

        switch (op) {
          case 'add_shape': {
            const shape = String(step.shape || 'rect').toLowerCase();
            const isGlyph = ownerType === 'path' || ownerType === 'icon';
            const fill = step.fill ?? (isGlyph ? 'none' : shape === 'text' ? '{{text}}' : '{{surface}}');
            const stroke = step.stroke ?? (shape === 'text' ? 'none' : isGlyph ? '{{text}}' : '{{accent}}');
            const sw = step.strokeWidth ?? (shape === 'text' ? undefined : '{{sw}}');
            let tag = shape;
            let kind = 'shape';
            let role = step.role || (isGlyph ? 'glyph' : 'shape');
            const attrs = { ...(step.attrs || {}) };

            let w = num(step.width, isGlyph ? 16 : 160);
            let h = num(step.height, isGlyph ? 16 : 64);
            let x = num(step.x, isGlyph ? 4 : 16);
            let y = num(step.y, isGlyph ? 4 : 16);
            if (step.anchor && ANCHORS.includes(step.anchor)) {
              const pos = placeAtAnchor({ w, h }, { w: doc.width || 390, h: doc.height || 844 }, step.anchor, num(step.margin, isGlyph ? 2 : 16));
              x = step.x !== undefined ? num(step.x) : round(pos.x);
              y = step.y !== undefined ? num(step.y) : round(pos.y);
            }

            if (shape === 'container' || shape === 'carousel') {
              tag = 'rect';
              role = shape === 'carousel' ? 'carousel-container' : 'container';
              Object.assign(attrs, {
                x, y, width: w, height: h,
                rx: step.rx ?? 16,
                fill: step.fill ?? '{{surface}}',
                stroke: step.stroke ?? '{{border}}',
                'stroke-width': sw ?? '{{sw}}',
                'data-container': shape === 'carousel' ? 'carousel' : 'container',
                'data-inner-margin': String(step.innerMargin ?? 12),
                'data-outer-margin': String(step.outerMargin ?? 16),
                'data-size-mode': step.sizeMode || 'responsive',
                'data-fit-screen': step.fitScreen || 'width',
                ...(shape === 'carousel' ? {
                  'data-carousel-dim': step.carouselDim || '3d',
                  'data-carousel-dir': step.carouselDir || 'horizontal',
                  'data-carousel-speed': String(step.carouselSpeed ?? 2600)
                } : {})
              });
            } else if (shape === 'rect') {
              Object.assign(attrs, { x, y, width: w, height: h, ...(step.rx !== undefined ? { rx: step.rx } : {}), ...(step.ry !== undefined ? { ry: step.ry } : {}), fill, stroke, ...(sw !== undefined ? { 'stroke-width': sw } : {}) });
            } else if (shape === 'circle') {
              const r = num(step.r, Math.min(w, h) / 2);
              Object.assign(attrs, { cx: step.cx ?? round(x + r), cy: step.cy ?? round(y + r), r, fill, stroke, ...(sw !== undefined ? { 'stroke-width': sw } : {}) });
            } else if (shape === 'ellipse') {
              const rx = num(step.rx, w / 2), ry = num(step.ry, h / 2);
              Object.assign(attrs, { cx: step.cx ?? round(x + rx), cy: step.cy ?? round(y + ry), rx, ry, fill, stroke, ...(sw !== undefined ? { 'stroke-width': sw } : {}) });
            } else if (shape === 'line') {
              Object.assign(attrs, { x1: step.x1 ?? x, y1: step.y1 ?? y, x2: step.x2 ?? (x + w), y2: step.y2 ?? (y + h), stroke: step.stroke ?? (isGlyph ? '{{text}}' : '{{accent}}'), 'stroke-width': sw ?? '{{sw}}', 'stroke-linecap': step.strokeLinecap || 'round' });
            } else if (shape === 'polygon' || shape === 'polyline') {
              const pts = Array.isArray(step.points)
                ? step.points.map(p => Array.isArray(p) ? `${p[0]},${p[1]}` : `${p.x},${p.y}`).join(' ')
                : String(step.points || `${x},${y + h} ${x + w / 2},${y} ${x + w},${y + h}`);
              Object.assign(attrs, { points: pts, fill: shape === 'polyline' ? (step.fill ?? 'none') : fill, stroke, ...(sw !== undefined ? { 'stroke-width': sw } : {}) });
            } else if (shape === 'path') {
              if (!step.d) throw new ValidationError('`add_shape` with shape="path" requires `d` (SVG path data)');
              Object.assign(attrs, { d: String(step.d), fill, stroke, ...(sw !== undefined ? { 'stroke-width': sw } : {}), 'stroke-linecap': step.strokeLinecap || 'round', 'stroke-linejoin': step.strokeLinejoin || 'round' });
            } else if (shape === 'text') {
              kind = 'text';
              role = step.role || 'label';
              Object.assign(attrs, {
                x, y: step.y ?? round(y + num(step.fontSize, 16)),
                fill: step.fill ?? '{{text}}',
                'font-size': step.fontSize ?? 16,
                ...(step.fontWeight ? { 'font-weight': step.fontWeight } : {}),
                ...(step.textAnchor ? { 'text-anchor': step.textAnchor } : {})
              });
            } else {
              throw new ValidationError(`Unsupported shape "${shape}"; expected rect, circle, ellipse, line, polygon, polyline, path, text, container, or carousel`);
            }
            if (step.opacity !== undefined) attrs.opacity = step.opacity;

            let parentId = step.parentId ?? null;
            if (parentId == null && step.parentName) {
              parentId = allNodes.find(n => n.name === step.parentName)?.id ?? null;
            }
            const onClick = step.onClick ? this.#normalizeActionRefs(c, actor, projectId, step.onClick) : null;
            const events = Array.isArray(step.events) ? step.events.map(ev => this.#normalizeActionRefs(c, actor, projectId, ev)) : [];

            const createdNode = svc.addNode(row.id, {
              kind,
              tag,
              name: step.name || `${shape}-${allNodes.length + 1}`,
              role,
              parentId,
              text: shape === 'text' ? String(step.text ?? 'Label') : '',
              attrs,
              onClick,
              events,
              descriptionDev: step.descriptionDev || ''
            }, { actor });
            stepResults.push({ operation: op, nodeId: createdNode.id, name: createdNode.name, tag: createdNode.tag });
            break;
          }

          case 'add_pen_path': {
            if (!Array.isArray(step.points) || step.points.length < 2) {
              throw new ValidationError('`add_pen_path` requires `points` with at least 2 anchor points [{ x, y, in?, out?, smooth? }]');
            }
            const pts = step.points.map(p => ({
              x: num(p.x),
              y: num(p.y),
              ...(p.in ? { in: { x: num(p.in.x), y: num(p.in.y) } } : p.cx1 !== undefined ? { in: { x: num(p.cx1), y: num(p.cy1) } } : {}),
              ...(p.out ? { out: { x: num(p.out.x), y: num(p.out.y) } } : p.cx2 !== undefined ? { out: { x: num(p.cx2), y: num(p.cy2) } } : {})
            }));
            let cmds = penToCommands(pts, Boolean(step.closed));
            for (let i = 0; i < step.points.length; i++) {
              if (step.points[i]?.smooth) {
                const sm = makeSmooth(cmds, i);
                if (sm) cmds = sm;
              }
            }
            const isGlyph = ownerType === 'path' || ownerType === 'icon';
            const d = serializePath(cmds, 3);
            const createdNode = svc.addNode(row.id, {
              kind: 'shape',
              tag: 'path',
              name: step.name || `pen-path-${allNodes.length + 1}`,
              role: step.role || (isGlyph ? 'glyph' : 'shape'),
              parentId: step.parentId ?? null,
              attrs: {
                d,
                fill: step.fill ?? (step.closed && !isGlyph ? '{{surface}}' : 'none'),
                stroke: step.stroke ?? (isGlyph ? '{{text}}' : '{{accent}}'),
                'stroke-width': step.strokeWidth ?? '{{sw}}',
                'stroke-linecap': 'round',
                'stroke-linejoin': 'round',
                ...(step.opacity !== undefined ? { opacity: step.opacity } : {})
              },
              descriptionDev: step.descriptionDev || ''
            }, { actor });
            stepResults.push({ operation: op, nodeId: createdNode.id, name: createdNode.name, d });
            break;
          }

          case 'place_instance': {
            const itemType = normalizeType(step.itemType || (ownerType === 'screen' ? 'element' : 'icon'), { allowWorkflow: false });
            if (!canContain(ownerType, itemType)) {
              throw new ValidationError(`"${ownerType}" cannot contain an instance of "${itemType}" (allowed: ${(TYPES[ownerType]?.accepts || []).join(', ')})`);
            }
            const refId = this.#resolveOrAdoptProjectItemId(c, actor, projectId, itemType, step.itemRef ?? step.refId ?? step.itemKey);
            if (!refId) throw new ValidationError('`place_instance` requires `itemRef` (key, uid, or id of the path/icon/button/element to place)');
            const refDoc = c.services[itemType].get(refId);
            const made = this.#placeInstanceNode(c, actor, ownerType, row.id, itemType, refDoc, step);
            stepResults.push({ operation: op, nodeId: made.id, name: made.name, refType: itemType, refKey: refDoc.key });
            break;
          }

          case 'import_svg_nodes': {
            if (!step.svg || !this.parseSvg) throw new ValidationError('`import_svg_nodes` requires `svg`');
            const parsed = this.parseSvg(String(step.svg), { targetSize: [doc.width, doc.height] });
            const addedIds = [];
            for (const pn of parsed.nodes || []) {
              const made = svc.addNode(row.id, pn, { actor });
              addedIds.push(made.id);
            }
            stepResults.push({ operation: op, addedCount: addedIds.length, nodeIds: addedIds });
            break;
          }

          case 'union':
          case 'subtract':
          case 'intersect':
          case 'exclude': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (sel.length < 2) throw new ValidationError(`Pathfinder "${op}" requires at least 2 vector shape/path nodes`);
            const res = pathfind(op, sel, allNodes);
            if (!res) throw new ValidationError(`Pathfinder "${op}" left an empty shape (shapes do not overlap or cancel out)`);
            const ordered = [...sel].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id);
            const styleFrom = op === 'subtract' ? ordered[0] : ordered.at(-1);
            const keepId = ordered[0].id;
            const dropIds = new Set(ordered.slice(1).map(n => n.id));
            const merged = {
              ...styleFrom,
              id: keepId,
              parentId: null,
              ord: ordered[0].ord,
              tag: 'path',
              kind: 'shape',
              rotation: 0,
              name: step.name || styleFrom.name || `${op}-shape`,
              attrs: { ...styleAttrs(styleFrom), d: res.d, 'fill-rule': 'evenodd' }
            };
            const nextList = allNodes.filter(n => !dropIds.has(n.id)).map(n => (n.id === keepId ? merged : n));
            this.#replaceNodeListWithAnimations(svc, actor, row.id, nextList);
            stepResults.push({ operation: op, nodeId: keepId, d: res.d, ringCount: res.rings.length });
            break;
          }

          case 'crop':
          case 'crop_to_canvas': {
            const rect = op === 'crop_to_canvas'
              ? { x: 0, y: 0, w: doc.width || 24, h: doc.height || 24 }
              : { x: num(step.x, 0), y: num(step.y, 0), w: num(step.width ?? step.w, doc.width || 24), h: num(step.height ?? step.h, doc.height || 24) };
            if (rect.w <= 0 || rect.h <= 0) throw new ValidationError('Crop rectangle width and height must be positive');
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (!sel.length) throw new ValidationError('Select at least 1 vector shape/path node to crop');
            const cropped = new Map();
            const dropIds = new Set();
            for (const n of sel) {
              const r = cropNode(n, allNodes, rect);
              if (r) {
                cropped.set(n.id, { ...n, parentId: null, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(n), d: r.d, 'fill-rule': 'evenodd' } });
              } else {
                dropIds.add(n.id);
              }
            }
            const nextList = allNodes.filter(n => !dropIds.has(n.id)).map(n => cropped.get(n.id) || n);
            this.#replaceNodeListWithAnimations(svc, actor, row.id, nextList);
            stepResults.push({ operation: op, croppedCount: cropped.size, removedOutsideCount: dropIds.size });
            break;
          }

          case 'convert_to_path': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (!sel.length) throw new ValidationError('Select at least 1 shape node to convert to path');
            const patches = sel.map(n => {
              const cmds = worldCommands(n, allNodes);
              if (!cmds) throw new ValidationError(`Node "${n.name || n.id}" (${n.tag}) cannot be converted to a vector path`);
              return { id: n.id, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(n), d: serializePath(cmds, 3) } };
            });
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, convertedCount: patches.length });
            break;
          }

          case 'combine_paths': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (sel.length < 2) throw new ValidationError('`combine_paths` requires at least 2 vector shape/path nodes');
            const ordered = [...sel].sort((a, b) => (a.ord ?? 0) - (b.ord ?? 0) || a.id - b.id);
            const combinedD = serializePath(combinePaths(ordered.map(n => worldCommands(n, allNodes))), 3);
            const keep = ordered[0];
            const drop = new Set(ordered.slice(1).map(n => n.id));
            const merged = { ...keep, parentId: null, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(keep), d: combinedD, 'fill-rule': 'evenodd' } };
            const nextList = allNodes.filter(n => !drop.has(n.id)).map(n => (n.id === keep.id ? merged : n));
            this.#replaceNodeListWithAnimations(svc, actor, row.id, nextList);
            stepResults.push({ operation: op, nodeId: keep.id, d: combinedD });
            break;
          }

          case 'break_apart': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true }).filter(n => n.tag === 'path');
            if (!sel.length) throw new ValidationError('Select at least 1 compound path node to break apart');
            const selIds = new Set(sel.map(n => n.id));
            let splitTotal = 0;
            const nextList = [];
            for (const n of allNodes) {
              if (!selIds.has(n.id)) { nextList.push(n); continue; }
              const parts = breakApart(parsePath(n.attrs?.d || ''));
              if (parts.length <= 1) { nextList.push(n); continue; }
              splitTotal += parts.length;
              parts.forEach((cmds, idx) => {
                nextList.push({
                  ...n,
                  id: idx === 0 ? n.id : undefined,
                  name: `${n.name || 'path'}-${idx + 1}`,
                  attrs: { ...n.attrs, d: serializePath(cmds, 3) }
                });
              });
            }
            const refreshed = this.#replaceNodeListWithAnimations(svc, actor, row.id, nextList);
            stepResults.push({ operation: op, subPathsCount: splitTotal, totalNodes: refreshed.nodes.length });
            break;
          }

          case 'join_paths': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (sel.length !== 2) throw new ValidationError('`join_paths` requires selecting exactly 2 open paths');
            const [a, b] = sel.map(n => worldCommands(n, allNodes));
            if ([a, b].some(cmds => !cmds || cmds.at(-1)?.t === 'Z')) {
              throw new ValidationError('Only open paths can be joined (use `cut_path` on closed paths first)');
            }
            const d = serializePath(joinPaths(a, b), 3);
            const merged = { ...sel[0], parentId: null, tag: 'path', kind: 'shape', rotation: 0, attrs: { ...styleAttrs(sel[0]), d } };
            const nextList = allNodes.filter(n => n.id !== sel[1].id).map(n => (n.id === sel[0].id ? merged : n));
            this.#replaceNodeListWithAnimations(svc, actor, row.id, nextList);
            stepResults.push({ operation: op, nodeId: sel[0].id, d });
            break;
          }

          case 'reverse_path': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true }).filter(n => n.tag === 'path');
            if (!sel.length) throw new ValidationError('Select at least 1 path node to reverse');
            const patches = sel.map(n => ({ id: n.id, attrs: { ...n.attrs, d: serializePath(reversePath(parsePath(n.attrs?.d || '')), 3) } }));
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, updatedCount: patches.length });
            break;
          }

          case 'simplify_path': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true }).filter(n => n.tag === 'path');
            if (!sel.length) throw new ValidationError('Select at least 1 path node to simplify');
            const tol = step.tolerance !== undefined ? Math.max(0.001, num(step.tolerance)) : (ownerType === 'path' || ownerType === 'icon' ? 0.05 : 0.4);
            const patches = sel.map(n => ({ id: n.id, attrs: { ...n.attrs, d: serializePath(simplifyPath(parsePath(n.attrs?.d || ''), tol), 3) } }));
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, tolerance: tol, updatedCount: patches.length });
            break;
          }

          case 'bake_transform': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true }).filter(n => n.tag === 'path');
            const patches = sel.filter(n => n.attrs?.transform || n.rotation).map(n => bakePatch(n, allNodes));
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, bakedCount: patches.length });
            break;
          }

          case 'round_corners': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (!sel.length) throw new ValidationError('Select at least 1 shape/path node for `round_corners`');
            const radius = Math.max(0.1, num(step.radius, ownerType === 'icon' || ownerType === 'path' ? 2 : 8));
            const patches = [];
            for (const n of sel) {
              let cmds = n.tag === 'path' ? parsePath(n.attrs?.d || '') : worldCommands(n, allNodes);
              if (!cmds?.length) continue;
              const indices = Array.isArray(step.vertexIndices) && step.vertexIndices.length
                ? [...step.vertexIndices].sort((a, b) => b - a)
                : cmds.map((_, i) => i).reverse();
              for (const vi of indices) {
                const rounded = roundCorner(cmds, vi, radius);
                if (rounded) cmds = rounded;
              }
              patches.push({
                id: n.id,
                tag: 'path',
                kind: 'shape',
                rotation: n.tag === 'path' ? n.rotation : 0,
                attrs: { ...(n.tag === 'path' ? n.attrs : styleAttrs(n)), d: serializePath(cmds, 3) }
              });
            }
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, radius, updatedCount: patches.length });
            break;
          }

          case 'smooth_vertices':
          case 'sharp_vertices': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true }).filter(n => n.tag === 'path');
            if (!sel.length) throw new ValidationError(`Select at least 1 path node for \`${op}\``);
            const fn = op === 'smooth_vertices' ? makeSmooth : makeCorner;
            const patches = [];
            for (const n of sel) {
              let cmds = parsePath(n.attrs?.d || '');
              const indices = Array.isArray(step.vertexIndices) && step.vertexIndices.length
                ? step.vertexIndices
                : cmds.map((_, i) => i).filter(i => cmds[i]?.t !== 'Z');
              for (const vi of indices) {
                const next = fn(cmds, vi);
                if (next) cmds = next;
              }
              patches.push({ id: n.id, attrs: { ...n.attrs, d: serializePath(cmds, 3) } });
            }
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, updatedCount: patches.length });
            break;
          }

          case 'cut_path': {
            const sel = this.#selectNodes(allNodes, step);
            const target = sel.find(n => n.tag === 'path') || allNodes.find(n => n.tag === 'path');
            if (!target) throw new ValidationError('Select a path node for `cut_path`');
            const vi = num(step.vertexIndex, 1);
            const cut = cutAt(parsePath(target.attrs?.d || ''), vi);
            if (!cut) throw new ValidationError(`Cannot cut path "${target.name || target.id}" at vertexIndex ${vi}`);
            const d = serializePath(cut, 3);
            this.#applyNodePatches(svc, actor, row.id, [{ id: target.id, attrs: { ...target.attrs, d } }]);
            stepResults.push({ operation: op, nodeId: target.id, d });
            break;
          }

          case 'edit_vertices': {
            const sel = this.#selectNodes(allNodes, step);
            const target = sel.find(n => n.tag === 'path') || allNodes.find(n => n.tag === 'path');
            if (!target) throw new ValidationError('Select a path node for `edit_vertices`');
            if (!Array.isArray(step.edits) || !step.edits.length) {
              throw new ValidationError('`edit_vertices` requires `edits: [{ index, x?, y?, x1?, y1?, x2?, y2?, delete?: boolean }]`');
            }
            const cmds = parsePath(target.attrs?.d || '');
            const toDelete = new Set();
            for (const ed of step.edits) {
              const idx = Number(ed.index);
              if (!Number.isInteger(idx) || idx < 0 || idx >= cmds.length) continue;
              if (ed.delete) { toDelete.add(idx); continue; }
              const cmd = { ...cmds[idx] };
              for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
                if (ed[k] !== undefined && k in cmd) cmd[k] = num(ed[k]);
              }
              cmds[idx] = cmd;
            }
            const nextCmds = cmds.filter((_, idx) => !toDelete.has(idx));
            const d = serializePath(nextCmds, 3);
            this.#applyNodePatches(svc, actor, row.id, [{ id: target.id, attrs: { ...target.attrs, d } }]);
            stepResults.push({ operation: op, nodeId: target.id, vertexCount: nextCmds.length, d });
            break;
          }

          case 'explode_icon': {
            const sel = this.#selectNodes(allNodes, step);
            const targetSet = sel.length ? new Set(sel.map(n => n.id)) : null;
            const exploded = [];
            for (const n of allNodes) {
              if (targetSet && !targetSet.has(n.id) && !targetSet.has(n.parentId)) {
                if (n.tag !== 'g') exploded.push(n);
                continue;
              }
              if (n.tag === 'g') continue;
              if (n.kind === 'instance' && n.refType === 'path' && n.refId) {
                const pathDoc = c.services.path.get(n.refId);
                const instBox = nodeBBox(n, allNodes);
                const sx = (instBox.w || 24) / (pathDoc.width || 24);
                const sy = (instBox.h || 24) / (pathDoc.height || 24);
                for (const pn of pathDoc.nodes || []) {
                  const pCmds = worldCommands(pn, pathDoc.nodes);
                  if (!pCmds) continue;
                  const mapped = mapCommands(pCmds, px => px * sx + instBox.x, py => py * sy + instBox.y);
                  for (const part of breakApart(mapped)) {
                    exploded.push({
                      kind: 'shape',
                      tag: 'path',
                      name: `${pathDoc.key}-part-${exploded.length + 1}`,
                      role: 'glyph',
                      parentId: null,
                      rotation: 0,
                      visible: true,
                      attrs: { ...styleAttrs(pn), d: serializePath(part, 3) }
                    });
                  }
                }
                continue;
              }
              const cmds = worldCommands(n, allNodes);
              if (!cmds) { exploded.push({ ...n, parentId: null }); continue; }
              const parts = breakApart(cmds);
              parts.forEach((part, idx) => {
                exploded.push({
                  kind: 'shape',
                  tag: 'path',
                  name: `${n.name || 'path'}-${idx + 1}`,
                  role: n.role || 'glyph',
                  parentId: null,
                  rotation: 0,
                  visible: n.visible !== false,
                  attrs: { ...styleAttrs(n), d: serializePath(part, 3) }
                });
              });
            }
            const refreshed = this.#replaceNodeListWithAnimations(svc, actor, row.id, exploded);
            stepResults.push({ operation: op, pathCount: refreshed.nodes.length });
            break;
          }

          case 'extract_paths_to_library': {
            const sel = this.#selectNodes(allNodes, step, { defaultAllVector: true });
            if (!sel.length) throw new ValidationError('No vector paths/shapes found to extract into the project path library');
            const savedPaths = [];
            let idx = 1;
            for (const n of sel) {
              const cmds = worldCommands(n, allNodes);
              if (!cmds) continue;
              const d = serializePath(cmds, 3);
              const baseName = `${doc.name || doc.key}-${idx++}`;
              const createdPath = c.services.path.create({
                name: baseName,
                key: uniqueKey(slugify(`${doc.key}-path-${idx - 1}`), k => c.services.path.designs.keyExists(k, projectId)),
                label: baseName,
                category: doc.category || 'general',
                width: doc.width || 24,
                height: doc.height || 24,
                projectId,
                visibility: 'project',
                descriptionDev: `Extracted from ${ownerType} "${doc.key}".`
              }, { actor });
              c.services.path.addNode(createdPath.id, {
                kind: 'shape',
                tag: 'path',
                name: 'glyph',
                role: 'glyph',
                attrs: { ...styleAttrs(n), d }
              }, { actor });
              this.#writeMcpContext('path', createdPath.id, { purpose: `Reusable vector path extracted from ${ownerType} "${doc.key}".` });
              savedPaths.push({ type: 'path', id: createdPath.id, key: createdPath.key, uid: this.reads.uidOf('path', createdPath.id) });
              createdLibraryItems.push({ type: 'path', key: createdPath.key, uid: this.reads.uidOf('path', createdPath.id) });
            }
            stepResults.push({ operation: op, extractedCount: savedPaths.length, paths: savedPaths });
            break;
          }

          case 'extract_as_element': {
            const sel = this.#selectNodes(allNodes, step);
            const rootNode = sel[0];
            if (!rootNode) throw new ValidationError('Select a root node (`nodeId`, `nodeIndex`, or `nodeName`) for `extract_as_element`');
            const extracted = extractNodes(allNodes, rootNode.id, n => nodeBBox(n, allNodes));
            if (!extracted) throw new ValidationError(`Could not extract node "${rootNode.name || rootNode.id}" as an element`);

            const elName = step.elementName || step.name || `${rootNode.name || doc.name} element`;
            const elKeyDesired = slugify(step.elementKey || elName);
            const createdEl = c.services.element.create({
              name: elName,
              key: uniqueKey(elKeyDesired, k => c.services.element.designs.keyExists(k, projectId)),
              label: elName,
              category: step.category || 'components',
              width: extracted.box.w,
              height: extracted.box.h,
              projectId,
              visibility: 'project',
              descriptionDev: step.descriptionDev || `Reusable element extracted from ${ownerType} "${doc.key}".`
            }, { actor });

            // Materialize extracted nodes into the new element, baking the origin shift for top-level wrapper
            const idMap = new Map();
            for (let i = 0; i < extracted.nodes.length; i++) {
              const en = extracted.nodes[i];
              const mappedParent = en.parentId == null ? null : (idMap.get(en.parentId) ?? null);
              const made = c.services.element.addNode(createdEl.id, {
                kind: en.tag === 'g' ? 'group' : (en.kind || 'shape'),
                tag: en.tag,
                name: en.name || `node-${i + 1}`,
                role: en.role || 'shape',
                parentId: mappedParent,
                ord: i,
                refType: en.refType || null,
                refId: en.refId ?? null,
                rotation: en.rotation ?? 0,
                visible: en.visible !== false,
                text: en.text || '',
                attrs: en.attrs || {},
                onClick: en.onClick || null,
                events: en.events || [],
                descriptionDev: en.descriptionDev || ''
              }, { actor });
              idMap.set(en.id, made.id);
            }
            this.#writeMcpContext('element', createdEl.id, { purpose: `Extracted from ${ownerType} "${doc.key}".` });
            const elUid = this.reads.uidOf('element', createdEl.id);
            createdLibraryItems.push({ type: 'element', key: createdEl.key, uid: elUid });

            let replacedNodeId = null;
            if (step.replaceWithInstance !== false && canContain(ownerType, 'element')) {
              const extractedIds = new Set(extracted.nodes.filter(x => x.id !== -1).map(x => x.id));
              const kept = allNodes.filter(n => !extractedIds.has(n.id));
              this.#replaceNodeListWithAnimations(svc, actor, row.id, kept);
              const inst = this.#placeInstanceNode(c, actor, ownerType, row.id, 'element', createdEl, {
                name: createdEl.key,
                x: extracted.box.x,
                y: extracted.box.y,
                width: extracted.box.w,
                height: extracted.box.h
              });
              replacedNodeId = inst.id;
            }
            stepResults.push({ operation: op, elementKey: createdEl.key, elementUid: elUid, replacedWithInstanceNodeId: replacedNodeId });
            break;
          }

          case 'align': {
            const mode = String(step.mode || 'hcenter').toLowerCase();
            if (!['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom'].includes(mode)) {
              throw new ValidationError('`align` requires `mode` in: left, hcenter, right, top, vmiddle, bottom');
            }
            const sel = this.#selectNodes(allNodes, step, { defaultAllRoot: true });
            if (!sel.length) throw new ValidationError('Select at least 1 node to align');
            const canvasBox = { x: 0, y: 0, w: doc.width || 390, h: doc.height || 844 };
            const patches = step.toCanvas
              ? sel.flatMap(n => alignPatches(allNodes, [n.id], mode, canvasBox))
              : alignPatches(allNodes, sel.map(n => n.id), mode, canvasBox);
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, mode, alignedCount: patches.length });
            break;
          }

          case 'distribute': {
            const axis = String(step.axis || 'h').toLowerCase().startsWith('v') ? 'v' : 'h';
            const sel = this.#selectNodes(allNodes, step, { defaultAllRoot: true });
            if (sel.length < 3) throw new ValidationError('`distribute` requires at least 3 nodes');
            const patches = distributePatches(allNodes, sel.map(n => n.id), axis);
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, axis, distributedCount: patches.length });
            break;
          }

          case 'move': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node to move');
            let dx = num(step.dx, 0);
            let dy = num(step.dy, 0);
            const box = unionBox(sel.map(n => nodeBBox(n, allNodes)));
            if (step.anchor && ANCHORS.includes(step.anchor)) {
              const targetPos = placeAtAnchor({ w: box.w, h: box.h }, { w: doc.width || 390, h: doc.height || 844 }, step.anchor, num(step.margin, 16));
              dx = targetPos.x - box.x;
              dy = targetPos.y - box.y;
            } else if (step.x !== undefined || step.y !== undefined) {
              dx = (step.x !== undefined ? num(step.x) : box.x) - box.x;
              dy = (step.y !== undefined ? num(step.y) : box.y) - box.y;
            }
            const patches = sel.map(n => ({ id: n.id, attrs: translateAttrs(n, dx, dy) }));
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, dx: round(dx), dy: round(dy), movedCount: patches.length });
            break;
          }

          case 'resize': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node to resize');
            const patches = sel.map(n => {
              const from = nodeBBox(n, allNodes);
              const to = {
                x: step.x !== undefined ? num(step.x) : from.x,
                y: step.y !== undefined ? num(step.y) : from.y,
                w: step.width !== undefined ? Math.max(1, num(step.width)) : (step.scaleX ? from.w * num(step.scaleX, 1) : from.w),
                h: step.height !== undefined ? Math.max(1, num(step.height)) : (step.scaleY ? from.h * num(step.scaleY, 1) : from.h)
              };
              return { id: n.id, attrs: resizeAttrs(n, from, to) };
            });
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, resizedCount: patches.length });
            break;
          }

          case 'fit_to_screen': {
            const nextW = Math.max(1, num(step.width, doc.width || 390));
            const nextH = Math.max(1, num(step.height, doc.height || 844));
            const patches = fitNodesToScreen(allNodes, { w: doc.width || nextW, h: doc.height || nextH }, { w: nextW, h: nextH });
            svc.update(row.id, { width: nextW, height: nextH }, { actor, scaleContent: false });
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, width: nextW, height: nextH, fittedCount: patches.length });
            break;
          }

          case 'flip': {
            const axis = String(step.axis || 'h').toLowerCase().startsWith('v') ? 'v' : 'h';
            const sel = this.#selectNodes(allNodes, step, { defaultAllRoot: true });
            if (!sel.length) throw new ValidationError('Select at least 1 node to flip');
            const patches = flipPatches(allNodes, sel.map(n => n.id), axis);
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, axis, flippedCount: patches.length });
            break;
          }

          case 'rotate': {
            const deg = num(step.degrees ?? step.angle, 90);
            const sel = this.#selectNodes(allNodes, step, { defaultAllRoot: true });
            if (!sel.length) throw new ValidationError('Select at least 1 node to rotate');
            const box = unionBox(sel.map(n => nodeBBox(n, allNodes)));
            const cx = step.cx !== undefined ? num(step.cx) : box.x + box.w / 2;
            const cy = step.cy !== undefined ? num(step.cy) : box.y + box.h / 2;
            const patches = sel.map(n => (
              n.tag === 'path' && n.parentId == null
                ? rotatePatch(n, allNodes, deg, cx, cy)
                : { id: n.id, attrs: n.attrs, rotation: ((n.rotation || 0) + deg) % 360 }
            ));
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, degrees: deg, rotatedCount: patches.length });
            break;
          }

          case 'group': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node to group');
            const { nodes: grouped } = groupNodes(allNodes, sel.map(n => n.id), step.name || 'group');
            const refreshed = this.#replaceNodeListWithAnimations(svc, actor, row.id, grouped);
            const groupNode = refreshed.nodes.find(n => n.tag === 'g' && n.name === (step.name || 'group')) || refreshed.nodes.find(n => n.tag === 'g');
            stepResults.push({ operation: op, groupId: groupNode?.id ?? null, groupName: groupNode?.name ?? 'group' });
            break;
          }

          case 'ungroup': {
            const sel = this.#selectNodes(allNodes, step).filter(n => n.tag === 'g');
            if (!sel.length) throw new ValidationError('Select at least 1 group (`g`) node to ungroup');
            let list = [...allNodes];
            const childIds = [];
            for (const g of sel) {
              const r = ungroupNodes(list, g.id);
              list = r.nodes;
              childIds.push(...r.childIds);
            }
            this.#replaceNodeListWithAnimations(svc, actor, row.id, list);
            stepResults.push({ operation: op, ungroupedCount: sel.length, releasedChildCount: childIds.length });
            break;
          }

          case 'reorder_layer': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select a node for `reorder_layer`');
            const mover = sel[0];
            const pos = String(step.position || 'front').toLowerCase();
            let patches = null;
            if (pos === 'forward' || pos === 'backward') {
              patches = stepLayer(allNodes, mover.id, pos === 'forward' ? 1 : -1);
            } else if (pos === 'front' || pos === 'back') {
              const sibs = allNodes.filter(n => (n.parentId ?? null) === (mover.parentId ?? null) && n.id !== mover.id);
              if (sibs.length) {
                const target = pos === 'front' ? sibs.at(-1) : sibs[0];
                patches = reorderLayer(allNodes, mover.id, target.id, pos === 'front' ? 'above' : 'below');
              }
            } else if (pos === 'above' || pos === 'below') {
              const target = step.targetNodeId
                ? allNodes.find(n => n.id === Number(step.targetNodeId))
                : allNodes.find(n => n.name === step.targetNodeName);
              if (!target) throw new ValidationError(`\`reorder_layer\` with position="${pos}" requires \`targetNodeId\` or \`targetNodeName\``);
              patches = reorderLayer(allNodes, mover.id, target.id, pos);
            } else {
              throw new ValidationError('`reorder_layer` `position` must be one of: front, back, forward, backward, above, below');
            }
            if (patches) {
              for (const p of patches) svc.updateNode(p.id, { ord: p.ord, parentId: p.parentId }, { actor });
            }
            stepResults.push({ operation: op, position: pos, reordered: Boolean(patches?.length) });
            break;
          }

          case 'duplicate_nodes': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node for `duplicate_nodes`');
            const rows = Math.max(1, Math.min(20, Math.floor(num(step.rows, 1))));
            const cols = Math.max(1, Math.min(20, Math.floor(num(step.cols, 1))));
            const createdIds = [];
            if (rows > 1 || cols > 1) {
              const base = sel[0];
              const b = nodeBBox(base, allNodes);
              const gapX = num(step.gapX, 16);
              const gapY = num(step.gapY, 16);
              for (let r = 0; r < rows; r++) {
                for (let col = 0; col < cols; col++) {
                  if (r === 0 && col === 0) continue;
                  const dup = svc.duplicateNode(base.id, { dx: col * (b.w + gapX), dy: r * (b.h + gapY) }, { actor });
                  createdIds.push(dup.id);
                }
              }
            } else {
              const dx = num(step.dx, 12);
              const dy = num(step.dy, 12);
              for (const n of sel) {
                const dup = svc.duplicateNode(n.id, { dx, dy }, { actor });
                createdIds.push(dup.id);
              }
            }
            stepResults.push({ operation: op, duplicatedCount: createdIds.length, nodeIds: createdIds });
            break;
          }

          case 'style_nodes': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node for `style_nodes`');
            const copiedFrom = step.copyStyleFromNodeId
              ? allNodes.find(n => n.id === Number(step.copyStyleFromNodeId))
              : step.copyStyleFromNodeName
                ? allNodes.find(n => n.name === step.copyStyleFromNodeName)
                : null;
            const patches = sel.map(n => {
              const attrs = { ...(n.attrs || {}) };
              if (copiedFrom) {
                for (const k of ['fill', 'stroke', 'stroke-width', 'opacity', 'rx', 'ry', 'font-size', 'font-weight']) {
                  if (copiedFrom.attrs?.[k] !== undefined) attrs[k] = copiedFrom.attrs[k];
                }
              }
              if (step.fill !== undefined) attrs.fill = step.fill;
              if (step.stroke !== undefined) attrs.stroke = step.stroke;
              if (step.strokeWidth !== undefined) attrs['stroke-width'] = step.strokeWidth;
              if (step.opacity !== undefined) attrs.opacity = step.opacity;
              if (step.rx !== undefined) attrs.rx = step.rx;
              if (step.ry !== undefined) attrs.ry = step.ry;
              if (step.fontSize !== undefined) attrs['font-size'] = step.fontSize;
              if (step.fontWeight !== undefined) attrs['font-weight'] = step.fontWeight;
              if (step.attrs && typeof step.attrs === 'object') Object.assign(attrs, step.attrs);
              return {
                id: n.id,
                attrs,
                ...(copiedFrom?.role && step.role === undefined ? { role: copiedFrom.role } : {}),
                ...(step.role !== undefined ? { role: step.role } : {}),
                ...(step.name !== undefined && sel.length === 1 ? { name: step.name } : {}),
                ...(step.locked !== undefined ? { locked: Boolean(step.locked) } : {}),
                ...(step.visible !== undefined ? { visible: Boolean(step.visible) } : {}),
                ...(step.text !== undefined ? { text: String(step.text) } : {}),
                ...(step.onClick !== undefined ? { onClick: step.onClick ? this.#normalizeActionRefs(c, actor, projectId, step.onClick) : null } : {}),
                ...(step.events !== undefined ? { events: step.events.map(ev => this.#normalizeActionRefs(c, actor, projectId, ev)) } : {}),
                ...(step.descriptionDev !== undefined ? { descriptionDev: step.descriptionDev } : {})
              };
            });
            this.#applyNodePatches(svc, actor, row.id, patches);
            stepResults.push({ operation: op, styledCount: patches.length });
            break;
          }

          case 'delete_nodes': {
            const sel = this.#selectNodes(allNodes, step);
            if (!sel.length) throw new ValidationError('Select at least 1 node for `delete_nodes`');
            for (const n of sel) svc.removeNode(n.id, { actor });
            stepResults.push({ operation: op, deletedCount: sel.length });
            break;
          }
        }
      }

      this.#notify(projectId);
      const updatedRow = this.reads.find(ownerType, row.id, projectId);
      const result = {
        project: { id: proj.id, key: proj.key, name: proj.name },
        copiedFromForeign,
        steps: stepResults,
        ...(createdLibraryItems.length ? { createdLibraryItems } : {}),
        item: this.#itemJsonFor(principal, updatedRow, projectId)
      };
      if (args.includeSvg) {
        const styleKey = args.style || c.settings.get().theme || 'liquid';
        result.svg = c.exporter.svgFile(ownerType, row.id, { theme: styleKey, animated: true }).content;
      }
      return result;
    });
  }

  /* ============================================================================
   * 6. SANDBOXED ELEMENT SCRIPTS & VERIFIED PUBLIC JS (`uiux_element_script`)
   * ============================================================================ */

  #bindAccountPrincipal(principal, projectRef, neededScope) {
    if (principal?.kind !== 'account') return principal;
    if (!this.accounts) throw new DomainError('account keys are not enabled on this server', 'NOT_FOUND', 404);
    if (principal.strict) {
      if (neededScope === 'read' && !projectRef) {
        const cur = this.design?.current?.(principal);
        if (!cur) return principal;
      }
      const resolved = this.design.resolveFocused(principal, projectRef, neededScope);
      return this.accounts.bind(principal, resolved);
    }
    if (neededScope === 'read' && !projectRef) return principal;
    const resolved = this.accounts.resolve(principal, projectRef, neededScope);
    return this.accounts.bind(principal, resolved);
  }

  async elementScript(principal, args = {}) {
    const c = this.#container();
    if (!c.elementScripts) throw new DomainError('Element script service is unavailable', 'INTERNAL', 500);
    const action = String(args.action || 'get').trim().toLowerCase();
    if (!['policy', 'verify', 'get', 'set', 'verify_sri', 'remove'].includes(action)) {
      throw new ValidationError('action must be one of "policy", "verify", "get", "set", "verify_sri", or "remove"');
    }

    if (action === 'policy') {
      return { action: 'policy', policy: c.elementScripts.policy() };
    }

    const buildSpecFromArgs = () => {
      if (args.script && typeof args.script === 'object' && !Array.isArray(args.script)) return args.script;
      return {
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
        ...(args.entryExport !== undefined ? { entryExport: args.entryExport } : {}),
        ...(args.moduleCode !== undefined ? { moduleCode: args.moduleCode } : {}),
        ...(args.imports !== undefined ? { imports: args.imports } : {}),
        ...(args.capabilities !== undefined ? { capabilities: args.capabilities } : {}),
        ...(args.propsSchema !== undefined ? { propsSchema: args.propsSchema } : {}),
        ...(args.emits !== undefined ? { emits: args.emits } : {})
      };
    };

    if (action === 'verify') {
      const verified = await c.elementScripts.verify(buildSpecFromArgs(), {
        lockfilePackages: args.lockfilePackages || null,
        verifyIntegrity: Boolean(args.verifyIntegrity),
        requireIntegrity: Boolean(args.requireIntegrity)
      });
      return { action: 'verify', ...verified };
    }

    if (action === 'get') {
      const bound = this.#bindAccountPrincipal(principal, args.project, 'read');
      const actor = this.#actor(bound);
      const cleanRef = String(args.ref || '').trim();
      if (!cleanRef) throw new ValidationError('`ref` (element key, uid, or id) is required for action "get"');
      const row = this.reads.find('element', cleanRef, bound.project?.id ?? null);
      if (!row || !this.#canReadRow(c, actor, row)) {
        throw new NotFoundError('element', cleanRef);
      }
      const script = c.elementScripts.get(row.id);
      const sandbox = script && args.includeSandbox
        ? c.elementScripts.buildSandbox(row.id, { style: args.style, props: args.props || {} })
        : null;
      return {
        action: 'get',
        element: { uid: row.uid, key: row.key, name: row.name, visibility: row.visibility, width: row.width, height: row.height },
        attached: Boolean(script),
        script,
        ...(sandbox ? { sandbox: { html: sandbox.html, csp: sandbox.csp, iframeAttributes: sandbox.iframeAttributes, style: sandbox.style } } : {})
      };
    }

    // Mutating actions: set, verify_sri, remove -> require `propose` scope and an owned bound project
    this.apiKeys?.assertScope?.(principal, 'propose');
    const bound = this.#bindAccountPrincipal(principal, args.project, 'propose');
    const { actor, proj, projectId } = this.#requireBoundProject(bound, { requireEdit: true });
    const cleanRef = String(args.ref || '').trim();
    if (!cleanRef) throw new ValidationError(`\`ref\` (element key, uid, or id) is required for action "${action}"`);

    const { row, copiedFromForeign } = this.transaction(() =>
      this.#resolveEditableTarget(bound, c, actor, projectId, 'element', cleanRef, {
        copyIfForeign: Boolean(args.copyIfForeign)
      })
    );

    if (action === 'remove') {
      const res = c.elementScripts.remove(row.id, { actor, checkEditable: false });
      this.#notify(projectId);
      return {
        action: 'remove',
        project: { id: proj.id, key: proj.key, name: proj.name },
        element: { uid: row.uid, key: row.key, name: row.name },
        removed: res.removed
      };
    }

    if (action === 'verify_sri') {
      const script = await c.elementScripts.verifyStoredSri(row.id, {
        actor,
        checkEditable: false,
        lockfilePackages: args.lockfilePackages || null
      });
      this.#notify(projectId);
      return {
        action: 'verify_sri',
        project: { id: proj.id, key: proj.key, name: proj.name },
        copiedFromForeign,
        element: { uid: row.uid, key: row.key, name: row.name },
        script
      };
    }

    // action === 'set'
    const script = await c.elementScripts.set(row.id, buildSpecFromArgs(), {
      actor,
      actorId: actor.id,
      checkEditable: false,
      verifyIntegrity: Boolean(args.verifyIntegrity),
      requireIntegrity: Boolean(args.requireIntegrity),
      lockfilePackages: args.lockfilePackages || null,
      humanApproved: false
    });
    this.#notify(projectId);
    const updatedRow = this.reads.find('element', row.id, projectId);
    const sandbox = args.includeSandbox
      ? c.elementScripts.buildSandbox(row.id, { style: args.style, props: args.props || {} })
      : null;

    return {
      action: 'set',
      project: { id: proj.id, key: proj.key, name: proj.name },
      copiedFromForeign,
      script,
      item: this.#itemJsonFor(bound, updatedRow, projectId),
      ...(sandbox ? { sandbox: { html: sandbox.html, csp: sandbox.csp, iframeAttributes: sandbox.iframeAttributes, style: sandbox.style } } : {})
    };
  }
}
