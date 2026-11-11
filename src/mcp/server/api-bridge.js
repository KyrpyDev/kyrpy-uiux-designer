/**
 * In-process MCP ↔ Backend API Bridge (`uiux_api_docs` + `uiux_api_call` + `uiux://api/docs`).
 *
 * Exposes the Designer's complete documented backend API (`interfaces/http/api-catalog.js` and every allowed
 * `interfaces/web/js/api.js` function) to MCP agents for reverse engineering and full-featured design automation,
 * without opening HTTP `/api/*` to `kud_…` keys and while working identically in standalone MCP mode.
 */
import { createHash } from 'node:crypto';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../../domain/errors.js';
import { PLURAL_TO_TYPE } from '../../domain/entities.js';
import { isSystemUser } from '../../domain/system-users.js';
import { buildApiRouter, API_OPERATIONS, OPERATION_BY_ACTION, OPERATION_BY_ROUTE } from '../../interfaces/http/api-catalog.js';
import { checkQuery, checkBody, intId } from '../../interfaces/http/input.js';
import { checkBodyShape } from '../../interfaces/http/body-schemas.js';

const TYPE_TO_PLURAL = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens' };
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ITEM_TYPES = new Set(['path', 'icon', 'button', 'element', 'screen', 'workflow']);

function deny(message, code = 'SCOPE_DENIED') {
  const err = new ForbiddenError(message);
  err.code = code;
  return err;
}

function normalizePluralTypes(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (TYPE_TO_PLURAL[s]) return TYPE_TO_PLURAL[s];
  if (PLURAL_TO_TYPE[s]) return s;
  throw new ValidationError(`Invalid design type "${raw}"; expected path, icon, button, element, or screen`);
}

function normalizeSingularType(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (ITEM_TYPES.has(s)) return s;
  if (PLURAL_TO_TYPE[s]) return PLURAL_TO_TYPE[s];
  if (s === 'workflows') return 'workflow';
  throw new ValidationError(`Invalid item type "${raw}"; expected path, icon, button, element, screen, or workflow`);
}

export class ApiBridge {
  #router = null;

  /**
   * @param {{ getContainer: () => any, apiKeys: any, accounts?: any, design?: any, versions?: any, onMutate?: (projectId: number, path: string, method: string) => void }} deps
   */
  constructor(deps) {
    Object.assign(this, deps);
  }

  #container() {
    const c = this.getContainer?.();
    if (!c) throw new DomainError('API container is not available', 'INTERNAL', 500);
    return c;
  }

  #getRouter() {
    if (!this.#router) this.#router = buildApiRouter(this.#container());
    return this.#router;
  }

  #callableBy(principal, op) {
    if (!op.mcpAllowed) return false;
    if (op.accountOnly && (principal?.kind !== 'account' || !this.accounts)) return false;
    if (principal?.strict && op.action === 'publishToPublic') return false;
    return this.apiKeys.hasScope(principal, op.scope);
  }

  /**
   * Structured API documentation from `API_OPERATIONS`, cross-checked with the live `Router`.
   */
  docs(principal, { group = '', action = '', method = '', query = '', includeBlocked = false, limit = 200 } = {}) {
    const liveRoutes = new Set(this.#getRouter().list().map(r => `${r.method} ${r.pattern}`));
    const gFilter = String(group || '').trim().toLowerCase();
    const aFilter = String(action || '').trim();
    const mFilter = String(method || '').trim().toUpperCase();
    const qFilter = String(query || '').trim().toLowerCase();
    const max = Math.min(Math.max(1, Number(limit) || 200), 300);

    const groupsCount = new Map();
    for (const op of API_OPERATIONS) {
      if (!includeBlocked && !op.mcpAllowed) continue;
      if (!includeBlocked && op.accountOnly && principal?.kind !== 'account') continue;
      groupsCount.set(op.group, (groupsCount.get(op.group) || 0) + 1);
    }

    const matched = API_OPERATIONS.filter(op => {
      if (!includeBlocked) {
        if (!op.mcpAllowed) return false;
        if (op.accountOnly && principal?.kind !== 'account') return false;
        if (principal?.strict && op.action === 'publishToPublic') return false;
      }
      if (gFilter && op.group.toLowerCase() !== gFilter) return false;
      if (aFilter && op.action !== aFilter && !(op.aliases || []).includes(aFilter)) return false;
      if (mFilter && op.method !== mFilter) return false;
      if (qFilter) {
        const hay = [
          op.action, ...(op.aliases || []), op.group, op.method, op.pattern, op.summary,
          ...Object.keys(op.params || {}), ...Object.keys(op.query || {}), ...Object.keys(op.body || {})
        ].join(' ').toLowerCase();
        if (!hay.includes(qFilter)) return false;
      }
      return true;
    });

    const operations = matched.slice(0, max).map(op => ({
      action: op.action,
      ...(op.aliases?.length ? { aliases: op.aliases } : {}),
      group: op.group,
      method: op.method,
      pattern: op.pattern,
      live: liveRoutes.has(`${op.method} ${op.pattern}`),
      scope: op.scope,
      mcpAllowed: op.mcpAllowed,
      callableNow: this.#callableBy(principal, op),
      ...(op.accountOnly ? { accountOnly: true } : {}),
      ...(op.needsProject === false ? { needsProject: false } : {}),
      ...(op.destructive ? { destructive: true } : {}),
      summary: op.summary,
      ...(op.params ? { params: op.params } : {}),
      ...(op.query ? { query: op.query } : {}),
      ...(op.body ? { body: op.body } : {}),
      ...(op.blockedReason ? { blockedReason: op.blockedReason } : {})
    }));

    return {
      total: matched.length,
      returned: operations.length,
      groups: [...groupsCount.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ group: name, count })),
      usage: {
        byAction: { action: 'createDesign', params: { type: 'screen' }, body: { name: 'Home', key: 'home-screen', width: 412, height: 915, descriptionDev: 'PURPOSE: ...', mcpContext: { purpose: 'Main home screen.' } } },
        byRoute: { method: 'POST', path: '/api/workflows/from-screen', body: { screenId: 'home-screen', name: 'Main Flow' } },
        notes: [
          'Pass either `action` (matching interfaces/web/js/api.js, e.g. "createDesign", "addNode", "menuConfig", "workflowFromScreen") or `{ method, path }`.',
          'For design routes, `params.type` accepts singular ("path" | "icon" | "button" | "element" | "screen") or `params.types` plural.',
          'Item `id` (and `screenId`, `fromScreenId`, `toScreenId`, `refId`, `iconId`, `targetScreenId`, `targetElementId`, `itemId`) accepts a numeric id, item key, or item uid.',
          'Account keys pass `project` (project key from uiux_list_projects) on project-scoped actions; design keys use their focused project automatically.'
        ]
      },
      operations
    };
  }

  /** Resolves an active non-system user record, downgraded from instance-admin so core services enforce strict project ownership. */
  #resolveActor(c, principal) {
    const u = c.users.get(Number(principal?.user?.id));
    if (!u || u.status !== 'active' || isSystemUser(u)) {
      throw new DomainError('the key owner is not an active user', 'UNAUTHORIZED', 401);
    }
    return {
      ...u,
      role: u.role === 'viewer' ? 'viewer' : 'designer'
    };
  }

  /** Resolves a numeric id, key, or uid to an item record, checking project/tenant visibility. */
  #findItem(c, type, ref, projectId) {
    const cleanType = normalizeSingularType(type);
    const raw = String(ref ?? '').trim();
    if (!raw) throw new ValidationError(`Missing ${cleanType} reference`);
    const repo = cleanType === 'workflow' ? c.workflows.workflows : c.services[cleanType]?.designs;
    if (!repo) throw new ValidationError(`Unsupported item type "${cleanType}"`);
    if (/^\d+$/.test(raw)) {
      const rec = repo.get(intId(raw, 'id'));
      if (!rec) throw new NotFoundError(cleanType, raw);
      return rec;
    }
    // Check uid first when UUID-shaped, then project-aware key
    const table = cleanType === 'workflow' ? 'workflows' : TYPE_TO_PLURAL[cleanType];
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw)) {
      const row = c.db.prepare(`SELECT id FROM ${table} WHERE uid = ?`).get(raw);
      if (row?.id) {
        const rec = repo.get(Number(row.id));
        if (rec) return rec;
      }
    }
    const byKey = repo.getByKey(raw, projectId || undefined);
    if (!byKey) throw new NotFoundError(cleanType, raw);
    return byKey;
  }

  #assertItemReadable(c, rec, type, principal, actor, boundProjectId) {
    if (!rec) throw new NotFoundError(type, '');
    const inProject = boundProjectId != null && Number(rec.projectId) === Number(boundProjectId);
    const ownPrivate = rec.visibility === 'private' && Number(rec.creatorId) === Number(actor.id);
    if (inProject || ownPrivate || rec.visibility === 'public') return rec;
    if (principal.strict) throw new NotFoundError(type, rec.key || rec.id);
    const role = c.projects?.userRole?.(rec.projectId ?? 1, actor);
    if (role != null) return rec;
    throw new NotFoundError(type, rec.key || rec.id);
  }

  #assertItemEditableInProject(c, rec, type, boundProjectId) {
    if (!rec) throw new NotFoundError(type, '');
    if (boundProjectId == null || Number(rec.projectId) !== Number(boundProjectId)) {
      throw deny(`${type} "${rec.key || rec.id}" does not belong to project #${boundProjectId}; clone it into this project before modifying it.`);
    }
    const pubId = typeof c.publicUserId === 'function' ? c.publicUserId() : (c.auth?.publicUserId?.() ?? null);
    if (rec.builtin || (pubId != null && Number(rec.creatorId) === Number(pubId))) {
      throw deny(`Built-in / public-library ${type} "${rec.key || rec.id}" is immutable over MCP; clone it into your project first.`);
    }
    return rec;
  }

  /** Resolves `{ action, params, body }` into `{ method, path, body }` matching `interfaces/web/js/api.js`. */
  #resolveTarget(args, boundProjectId) {
    const rawParams = { ...(args.params || {}) };
    const body = args.body !== undefined && args.body !== null ? structuredClone(args.body) : undefined;

    if (args.action) {
      const op = OPERATION_BY_ACTION.get(String(args.action).trim());
      if (!op) throw new ValidationError(`Unknown API action "${args.action}". Call uiux_api_docs to inspect available actions.`);

      // Smart routing aliases matching web/js/api.js
      let method = op.method;
      let pattern = op.pattern;
      if (op.action === 'getLineage') {
        const t = String(rawParams.type || rawParams.types || body?.type || '').toLowerCase();
        if (t === 'workflow' || t === 'workflows') pattern = '/api/workflows/:id/lineage';
      } else if (op.action === 'saveTemplateDevice') {
        const devId = rawParams.id ?? body?.id;
        if (devId !== undefined && devId !== null && String(devId).trim() !== '') {
          method = 'PUT';
          pattern = '/api/templates/devices/:id';
          rawParams.id = devId;
        }
      } else if (op.action === 'saveTemplateButton') {
        const btnId = rawParams.id ?? body?.id;
        if (btnId !== undefined && btnId !== null && String(btnId).trim() !== '') {
          method = 'PUT';
          pattern = '/api/templates/buttons/:id';
          rawParams.id = btnId;
        }
      }

      if (pattern.includes(':types(')) {
        const rawT = rawParams.types ?? rawParams.type ?? body?.type;
        if (!rawT) throw new ValidationError(`Action "${op.action}" requires params.type ("path" | "icon" | "button" | "element" | "screen")`);
        rawParams.types = normalizePluralTypes(rawT);
      }
      if (pattern.startsWith('/api/projects/:id') && (rawParams.id === undefined || rawParams.id === null || String(rawParams.id).trim() === '')) {
        if (boundProjectId != null) rawParams.id = String(boundProjectId);
      }

      const path = pattern.replace(/\/:(\w+)(?:\([^)]+\))?/g, (_, name) => {
        const val = rawParams[name];
        if (val === undefined || val === null || String(val).trim() === '') {
          throw new ValidationError(`Action "${op.action}" requires params.${name}`);
        }
        return `/${encodeURIComponent(String(val).trim())}`;
      });
      return { method, path, body, opHint: op };
    }

    const method = String(args.method || 'GET').trim().toUpperCase();
    const rawPath = String(args.path || '').trim();
    if (!rawPath) throw new ValidationError('Pass either `action` (e.g. "createDesign") or `path` (e.g. "/api/screens")');
    return { method, path: rawPath, body, opHint: null };
  }

  /** Resolves string keys/uids inside body references (`screenId`, `refId`, `iconId`, `targetScreenId`, `targetElementId`, `itemId`). */
  #resolveBodyRefs(c, body, principal, actor, boundProjectId) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const resolveField = (idField, keyField, fixedType) => {
      const val = body[idField] ?? (keyField ? body[keyField] : undefined);
      if (val === undefined || val === null || val === '') return;
      if (typeof val === 'number' || /^\d+$/.test(String(val))) {
        const rec = this.#findItem(c, fixedType, val, boundProjectId);
        this.#assertItemReadable(c, rec, fixedType, principal, actor, boundProjectId);
        body[idField] = rec.id;
      } else {
        const rec = this.#findItem(c, fixedType, val, boundProjectId);
        this.#assertItemReadable(c, rec, fixedType, principal, actor, boundProjectId);
        body[idField] = rec.id;
      }
      if (keyField && keyField in body) delete body[keyField];
    };

    resolveField('screenId', 'screenKey', 'screen');
    resolveField('fromScreenId', 'fromScreenKey', 'screen');
    resolveField('toScreenId', 'toScreenKey', 'screen');
    resolveField('iconId', 'iconKey', 'icon');
    resolveField('targetScreenId', 'targetScreenKey', 'screen');
    resolveField('targetElementId', 'targetElementKey', 'element');

    if ((body.refType || body.kind === 'instance') && (body.refId !== undefined || body.refKey !== undefined)) {
      const rt = body.refType ? normalizeSingularType(body.refType) : null;
      if (rt) {
        body.refType = rt;
        resolveField('refId', 'refKey', rt);
      }
    }
    const resolveActionObj = act => {
      if (!act || typeof act !== 'object') return;
      const actionTargetType = act.type === 'screen'
        ? 'screen'
        : (['popup', 'drawer', 'element', 'show-element', 'toolbar'].includes(act.type)
          ? 'element'
          : (['radial-menu', 'drawer-menu', 'slider-vertical', 'slider-horizontal', 'carousel-menu'].includes(act.type) ? 'button' : null));
      if (!actionTargetType) return;
      const rawRef = act.targetId ?? act.targetKey ?? act.target?.uid ?? act.target?.key ?? act.target?.id;
      if (rawRef !== undefined && rawRef !== null && rawRef !== '') {
        const rec = this.#findItem(c, actionTargetType, rawRef, boundProjectId);
        this.#assertItemReadable(c, rec, actionTargetType, principal, actor, boundProjectId);
        act.targetId = rec.id;
        delete act.targetKey;
      }
    };
    if (body.onClick && typeof body.onClick === 'object') resolveActionObj(body.onClick);
    if (Array.isArray(body.events)) {
      for (const ev of body.events) resolveActionObj(ev);
    }
    if (Array.isArray(body.nodes)) {
      for (const n of body.nodes) {
        if (n && typeof n === 'object') this.#resolveBodyRefs(c, n, principal, actor, boundProjectId);
      }
    }
    return body;
  }

  /**
   * Executes a backend API operation in-process with full MCP scope, project, and tenant isolation.
   */
  async call(principal, args = {}, { ip = '', baseUrl = 'http://localhost:5180' } = {}) {
    const c = this.#container();
    const router = this.#getRouter();
    const actor = this.#resolveActor(c, principal);

    // 1. Pre-check action or path to determine required scope and whether a bound project is needed
    let preOp = null;
    if (args.action) {
      preOp = OPERATION_BY_ACTION.get(String(args.action).trim());
      if (!preOp) throw new ValidationError(`Unknown API action "${args.action}". Call uiux_api_docs to inspect available actions.`);
    } else if (args.path) {
      const u = new URL(String(args.path), 'http://localhost');
      if (!u.pathname.startsWith('/api/')) throw new ValidationError('`path` must start with "/api/"');
      const m = String(args.method || 'GET').trim().toUpperCase();
      const preHit = router.match(m, u.pathname);
      if (!preHit) throw new DomainError(`no route ${m} ${u.pathname}`, 'NO_ROUTE', 404);
      preOp = OPERATION_BY_ROUTE.get(`${m} ${preHit.pattern}`) || null;
    } else {
      throw new ValidationError('Pass either `action` (for example "createDesign") or `{ method, path }`');
    }

    if (!preOp || !preOp.mcpAllowed) {
      throw deny(preOp?.blockedReason || 'This backend route is session-only and blocked over MCP.', 'FORBIDDEN');
    }
    if (preOp.accountOnly && principal.kind !== 'account') {
      throw deny(`"${preOp.action}" requires an account API key.`, 'SCOPE_DENIED');
    }
    if (principal.strict && preOp.action === 'publishToPublic') {
      throw deny('An AI-assisted design key works on private projects only; publishing is a human decision in the designer.', 'SCOPE_DENIED');
    }
    this.apiKeys.assertScope(principal, preOp.scope);

    // 2. Bind account keys to the target project when needed
    let bound = principal;
    if (principal.kind === 'account' && preOp.needsProject !== false) {
      if (!this.accounts) throw new DomainError('account keys are not enabled on this server', 'NOT_FOUND', 404);
      const projRef = args.project;
      const need = preOp.scope === 'read' ? 'read' : 'propose';
      const resolved = principal.strict
        ? this.design.resolveFocused(principal, projRef, need)
        : this.accounts.resolve(principal, projRef, need);
      bound = this.accounts.bind(principal, resolved);
    }
    const boundProjectId = bound.project?.id ?? null;

    // 3. Handle account-only project creation / cloning through AccountService / DesignSessionService so rate limits & focus apply
    if (preOp.action === 'createProject') {
      const b = checkBodyShape('POST', '/api/projects', checkBody(args.body || {}));
      const data = bound.strict
        ? this.design.create(bound, b)
        : this.accounts.createProject(bound, b);
      c.notifySync?.('/api/projects', 'POST');
      return { action: 'createProject', method: 'POST', path: '/api/projects', result: data };
    }
    if (preOp.action === 'cloneProject') {
      const srcRef = args.params?.id ?? args.body?.source ?? args.project;
      const b = checkBody(args.body || {});
      if (bound.strict) {
        const data = this.design.clone(bound, { source: srcRef, name: b.name, key: b.key, description: b.description });
        c.notifySync?.(`/api/projects/${encodeURIComponent(String(srcRef || ''))}/clone`, 'POST');
        return { action: 'cloneProject', method: 'POST', path: `/api/projects/${encodeURIComponent(String(srcRef || ''))}/clone`, result: data };
      }
      if (!srcRef) throw new ValidationError('cloneProject requires params.id (source project key or id)');
      const src = this.accounts.resolve(bound, srcRef, 'read');
      const data = this.accounts.createProject(bound, {
        name: b.name || `${src.name} copy`,
        key: b.key,
        description: b.description,
        fromProject: src.key,
        visibility: b.visibility || 'private'
      });
      c.notifySync?.(`/api/projects/${src.id}/clone`, 'POST');
      return { action: 'cloneProject', method: 'POST', path: `/api/projects/${src.id}/clone`, result: data };
    }

    // 4. Resolve concrete method + path + query + body
    const target = this.#resolveTarget(args, boundProjectId);
    const parsedUrl = new URL(target.path, 'http://localhost');
    if (args.query && typeof args.query === 'object') {
      for (const [k, v] of Object.entries(args.query)) {
        if (v === undefined || v === null || v === '') continue;
        parsedUrl.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
      }
    }

    const hit = router.match(target.method, parsedUrl.pathname);
    if (!hit) throw new DomainError(`no route ${target.method} ${parsedUrl.pathname}`, 'NO_ROUTE', 404);
    const op = OPERATION_BY_ROUTE.get(`${target.method} ${hit.pattern}`);
    if (!op || !op.mcpAllowed) {
      throw deny(op?.blockedReason || 'This backend route is blocked over MCP.', 'FORBIDDEN');
    }
    this.apiKeys.assertScope(bound, op.scope);

    const isMutation = MUTATION_METHODS.has(target.method) && op.scope !== 'read';
    let body = MUTATION_METHODS.has(target.method)
      ? checkBodyShape(target.method, hit.pattern, checkBody(target.body))
      : {};

    // 5. Argument-level security & isolation checks
    if (body?.folderPath || body?.fontPath) {
      throw deny('Server filesystem paths (folderPath, fontPath) are blocked over MCP; pass inline content instead.', 'FORBIDDEN');
    }
    if (target.method === 'DELETE' && parsedUrl.searchParams.get('permanent') === '1') {
      throw deny('Direct permanent=1 deletion is blocked over MCP; delete moves items to Trash, and trashPurge removes from Trash.', 'FORBIDDEN');
    }

    // Strict keys: only own projects on GET /api/projects, never public items on queries
    if (op.action === 'projects') {
      const q = String(parsedUrl.searchParams.get('q') || '');
      const list = c.projects.list({ user: actor, includePublic: !bound.strict, q })
        .filter(p => !bound.strict || Number(p.ownerId) === Number(actor.id));
      return { action: op.action, method: target.method, path: parsedUrl.pathname, result: list };
    }

    // Force projectId in query & path for project-scoped operations
    if (boundProjectId != null) {
      if (parsedUrl.searchParams.has('projectId') && Number(parsedUrl.searchParams.get('projectId')) !== Number(boundProjectId)) {
        throw deny(`Query projectId must match the bound project (${boundProjectId}).`);
      }
      if (parsedUrl.searchParams.has('projectIds')) {
        const ids = String(parsedUrl.searchParams.get('projectIds')).split(',').map(s => Number(s.trim())).filter(Boolean);
        if (ids.some(id => id !== Number(boundProjectId))) {
          throw deny(`Query projectIds must only contain the bound project (${boundProjectId}).`);
        }
      }
      if (['library', 'list', 'iconSearch', 'catalogSearch', 'workflows', 'changes', 'changeCounts', 'trashList', 'trashEmpty', 'exportProjectHtml', 'translations', 'templateDevices', 'templateButtons'].includes(op.action)) {
        parsedUrl.searchParams.set('projectId', String(boundProjectId));
      }
    }

    // Enforce `/api/projects/:id*` path parameter matches boundProjectId
    if (hit.pattern.startsWith('/api/projects/:id')) {
      const rawPid = hit.params.id;
      const proj = /^\d+$/.test(String(rawPid)) ? c.projects.get(intId(rawPid, 'id')) : c.projects.get(String(rawPid));
      if (boundProjectId != null && Number(proj.id) !== Number(boundProjectId)) {
        throw deny(`Path project "${rawPid}" does not match the bound project "${bound.project.key}".`);
      }
      hit.params.id = String(proj.id);

      if (op.action === 'updateProject' || op.action === 'saveProject') {
        if (body.visibility === 'public') {
          throw deny('Publishing a project to public visibility is a human decision in the designer.');
        }
        delete body.requireApproval;
        if (body.settings && typeof body.settings === 'object') {
          const curAi = proj.settings?.ai;
          body.settings = { ...body.settings };
          if (curAi !== undefined) body.settings.ai = curAi;
          else delete body.settings.ai;
        }
        body.scope = 'project';
      }
      if (op.action === 'applyProjectButtonSettings') {
        body = { ...body, scope: 'project' };
      }
    }

    // Enforce item-level read/write isolation for designs, nodes, animations, menus, workflows
    if (hit.params.types && hit.params.id !== undefined) {
      const singular = PLURAL_TO_TYPE[hit.params.types];
      const rec = this.#findItem(c, singular, hit.params.id, boundProjectId);
      if (op.action === 'cloneDesign' || !isMutation) {
        this.#assertItemReadable(c, rec, singular, bound, actor, boundProjectId);
      } else {
        this.#assertItemEditableInProject(c, rec, singular, boundProjectId);
      }
      hit.params.id = String(rec.id);
    } else if (hit.pattern.startsWith('/api/buttons/:id/menu')) {
      const rec = this.#findItem(c, 'button', hit.params.id, boundProjectId);
      if (!isMutation) this.#assertItemReadable(c, rec, 'button', bound, actor, boundProjectId);
      else this.#assertItemEditableInProject(c, rec, 'button', boundProjectId);
      hit.params.id = String(rec.id);
    } else if (hit.pattern.startsWith('/api/workflows/:id')) {
      const rec = this.#findItem(c, 'workflow', hit.params.id, boundProjectId);
      if (op.action === 'cloneWorkflow' || !isMutation) {
        this.#assertItemReadable(c, rec, 'workflow', bound, actor, boundProjectId);
      } else {
        this.#assertItemEditableInProject(c, rec, 'workflow', boundProjectId);
      }
      hit.params.id = String(rec.id);
      if (hit.params.sid !== undefined) {
        const sRec = this.#findItem(c, 'screen', hit.params.sid, boundProjectId);
        this.#assertItemReadable(c, sRec, 'screen', bound, actor, boundProjectId);
        hit.params.sid = String(sRec.id);
      }
    }

    // Create / import item isolation: bind to boundProjectId, enforce visibility rules, resolve body key refs
    if (isMutation && boundProjectId != null) {
      if (body.projectId !== undefined && body.projectId !== null && Number(body.projectId) !== Number(boundProjectId)) {
        throw deny(`Body projectId (${body.projectId}) must match the bound project (${boundProjectId}).`);
      }
      body.projectId = boundProjectId;

      if (['createDesign', 'cloneDesign', 'createWorkflow', 'cloneWorkflow', 'workflowFromScreen', 'onlineImport', 'onlineImportSet', 'importSvg', 'importFolder', 'importFont', 'importLibraryItems', 'instantiateTemplateButton'].includes(op.action)) {
        if (op.action === 'importSvg') {
          if (!body.svg && typeof body.svgText === 'string') body.svg = body.svgText;
          if (!body.as && typeof body.targetType === 'string') body.as = body.targetType;
        }
        if (body.visibility === 'public') {
          if (bound.strict) throw new ValidationError('AI-assisted design keys cannot create public items');
          const proj = c.projects.get(boundProjectId);
          if (!proj?.settings?.ai?.mayCreatePublicItems) {
            throw Object.assign(new ValidationError('Creating public items via MCP is disabled for this project (settings.ai.mayCreatePublicItems = false)'), { code: 'VISIBILITY' });
          }
        } else if (!body.visibility) {
          body.visibility = 'project';
        }
      }
      body = this.#resolveBodyRefs(c, body, bound, actor, boundProjectId);
    }

    // Export isolation: force active projectId
    if (op.action === 'exportBundle' || op.action === 'exportLibraryItems') {
      body = { ...(body || {}), projectId: boundProjectId };
      if (bound.strict && body.visibility === 'public') body.visibility = 'project';
    }

    // Template device / button write guards: custom user-owned templates only (never overwrite built-in or foreign templates)
    if (op.action === 'saveTemplateDevice' || op.action === 'updateTemplateDevice') {
      const devId = hit.params.id ? intId(hit.params.id, 'id') : (body.id ? Number(body.id) : null);
      const ex = devId ? c.templates.templates.getDevice(devId) : (body.key ? c.templates.templates.getDeviceByKey(String(body.key)) : null);
      if (ex && (ex.builtin || Number(ex.createdBy) !== Number(actor.id))) {
        throw deny(`Device template "${ex.key}" is built-in or owned by another user; choose a new custom key.`);
      }
      body = { ...body, createdBy: actor.id };
    }
    if (op.action === 'saveTemplateButton' || op.action === 'updateTemplateButton') {
      const btnId = hit.params.id ? intId(hit.params.id, 'id') : (body.id ? Number(body.id) : null);
      const ex = btnId ? c.templates.templates.getButton(btnId) : (body.key ? c.templates.templates.getButtonByKey(String(body.key)) : null);
      if (ex && (ex.builtin || Number(ex.createdBy) !== Number(actor.id))) {
        throw deny(`Button template "${ex.key}" is built-in or owned by another user; choose a new custom key.`);
      }
      body = { ...body, createdBy: actor.id };
    }

    // Translations isolation: translations table has no project_id column, so verify item ownership explicitly
    if (op.action === 'saveTranslation' || op.action === 'upsertTranslation') {
      const rawType = body.tableName || body.itemType;
      if (!rawType) throw new ValidationError('itemType (screen | element | button | icon | path | workflow) is required');
      const cleanType = normalizeSingularType(rawType);
      const rawRef = body.recordId ?? body.itemId ?? body.itemKey;
      const rec = this.#findItem(c, cleanType, rawRef, boundProjectId);
      this.#assertItemEditableInProject(c, rec, cleanType, boundProjectId);
      body = { ...body, tableName: cleanType, itemType: cleanType, recordId: rec.id, itemId: rec.id };
    } else if (op.action === 'deleteTranslation') {
      const tid = intId(hit.params.id, 'id');
      const row = c.db.prepare('SELECT * FROM translations WHERE id = ?').get(tid);
      if (!row) throw new NotFoundError('translation', tid);
      const rec = this.#findItem(c, row.table_name, row.record_id, boundProjectId);
      this.#assertItemEditableInProject(c, rec, row.table_name, boundProjectId);
    }

    // Trash item isolation
    if (op.action === 'trashRestore' || op.action === 'trashPurge') {
      const tItem = c.trash.get(intId(hit.params.id, 'id'), actor);
      if (boundProjectId != null && Number(tItem.projectId) !== Number(boundProjectId)) {
        throw new NotFoundError('trash_item', hit.params.id);
      }
    }

    // Change / changeset read & create isolation
    if (op.action === 'change') {
      const ch = c.collaboration.get(intId(hit.params.id, 'id'));
      if (boundProjectId != null && Number(ch.projectId) !== Number(boundProjectId)) {
        throw new NotFoundError('change_request', hit.params.id);
      }
    } else if (op.action === 'createChange') {
      const tType = normalizeSingularType(body.targetType);
      const rec = this.#findItem(c, tType, body.targetId, boundProjectId);
      this.#assertItemEditableInProject(c, rec, tType, boundProjectId);
      body = { ...body, projectId: boundProjectId, targetType: tType, targetId: rec.id };
    } else if (op.action === 'getChangeset' || op.action === 'previewChangesetOp') {
      const cs = c.mcp?.versions?.repo?.changeset(hit.params.uid);
      if (!cs || (boundProjectId != null && Number(cs.projectId) !== Number(boundProjectId))) {
        throw new NotFoundError('changeset', hit.params.uid);
      }
    }

    // Library transfer isolation (copyToProjects, moveToProjects, saveToTargets, publishToPublic, emptyLibrary)
    if (op.action === 'copyToProjects' || op.action === 'moveToProjects') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) throw new ValidationError('items[] is required');
      body.items = items.map(it => {
        const t = normalizeSingularType(it.type || it.itemType);
        const rec = this.#findItem(c, t, it.id ?? it.itemId ?? it.key, boundProjectId);
        if (op.action === 'moveToProjects') this.#assertItemEditableInProject(c, rec, t, boundProjectId);
        else this.#assertItemReadable(c, rec, t, bound, actor, boundProjectId);
        return { type: t, id: rec.id };
      });
      const rawTargets = body.projectIds !== undefined ? body.projectIds : [boundProjectId];
      const targetList = (Array.isArray(rawTargets) ? rawTargets : String(rawTargets).split(',')).map(x => String(x).trim()).filter(Boolean);
      const resolvedPids = targetList.map(ref => {
        const p = /^\d+$/.test(ref) ? c.projects.get(intId(ref, 'projectId')) : c.projects.get(ref);
        if (Number(p.ownerId) !== Number(actor.id)) throw deny(`Target project "${p.key}" is not owned by you.`);
        if ((bound.kind !== 'account' || bound.strict) && Number(p.id) !== Number(boundProjectId)) {
          throw deny(`This key may only target project "${bound.project.key}".`);
        }
        return p.id;
      });
      body.projectIds = resolvedPids;
      if (body.visibility === 'public') throw deny('Cannot copy/move directly to public visibility over MCP.');
    } else if (op.action === 'saveToTargets') {
      const t = normalizeSingularType(body.type);
      const rec = this.#findItem(c, t, body.id ?? body.key, boundProjectId);
      this.#assertItemReadable(c, rec, t, bound, actor, boundProjectId);
      const rawTargets = body.projectIds !== undefined ? body.projectIds : [boundProjectId];
      const targetList = (Array.isArray(rawTargets) ? rawTargets : String(rawTargets).split(',')).map(x => String(x).trim()).filter(Boolean);
      body.projectIds = targetList.map(ref => {
        const p = /^\d+$/.test(ref) ? c.projects.get(intId(ref, 'projectId')) : c.projects.get(ref);
        if (Number(p.ownerId) !== Number(actor.id)) throw deny(`Target project "${p.key}" is not owned by you.`);
        if ((bound.kind !== 'account' || bound.strict) && Number(p.id) !== Number(boundProjectId)) {
          throw deny(`This key may only target project "${bound.project.key}".`);
        }
        return p.id;
      });
      body.type = t;
      body.id = rec.id;
      if (body.visibility === 'public') throw deny('Cannot save directly to public visibility over MCP.');
    } else if (op.action === 'publishToPublic') {
      const t = normalizeSingularType(body.type);
      const rec = this.#findItem(c, t, body.id ?? body.key, boundProjectId);
      this.#assertItemEditableInProject(c, rec, t, boundProjectId);
      body = { type: t, id: rec.id };
    } else if (op.action === 'emptyProjectLibrary' || op.action === 'emptyLibrary') {
      body = { ...(body || {}), projectId: boundProjectId, scope: 'project', includePublic: false };
    }

    // 6. Validate query & execute route handler in-process
    checkQuery(parsedUrl.searchParams);
    const out = await hit.handler({
      params: hit.params,
      query: parsedUrl.searchParams,
      body,
      token: null,
      actor,
      projectId: boundProjectId ?? 1,
      ip,
      baseUrl
    });

    // Post-filter translations list to items in boundProjectId (since translations table has no project_id column)
    let result = out;
    if (op.action === 'translations' && Array.isArray(out) && boundProjectId != null) {
      result = out.filter(row => {
        try {
          const rec = this.#findItem(c, row.tableName || row.itemType, row.recordId ?? row.itemId, boundProjectId);
          return Number(rec.projectId) === Number(boundProjectId);
        } catch {
          return false;
        }
      });
    } else if (out && out.raw !== undefined) {
      if (Buffer.isBuffer(out.raw) || out.raw instanceof Uint8Array) {
        const buf = Buffer.from(out.raw);
        result = {
          contentType: out.contentType || 'application/octet-stream',
          filename: out.filename || null,
          bytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
          base64: buf.toString('base64')
        };
      } else {
        result = {
          contentType: out.contentType || 'text/plain',
          filename: out.filename || null,
          ...(out.etag ? { etag: out.etag } : {}),
          text: String(out.raw)
        };
      }
    }

    // 7. Notify Designer SSE clients and MCP resource subscribers on mutations
    if (isMutation) {
      c.notifySync?.(parsedUrl.pathname, target.method);
      if (boundProjectId != null) this.onMutate?.(boundProjectId, parsedUrl.pathname, target.method);
    }

    return {
      action: op.action,
      group: op.group,
      method: target.method,
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      ...(bound.project ? { project: bound.project.key } : {}),
      result
    };
  }
}
