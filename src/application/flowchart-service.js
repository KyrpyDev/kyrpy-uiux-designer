import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../domain/errors.js';
import { uniqueKey, slugify, prefixedVariableName } from '../domain/naming.js';
import { stripOwnership } from '../domain/system-users.js';
import { assertItemAccess } from './access-policy.js';
import { fallbackOwnerId } from './default-owner.js';
import { collectScreenRoutes } from '../domain/screen-routes.js';
import {
  DEFAULT_ACCESS_LEVELS,
  HOME_PORT_KEY,
  normalizeAccessLevels,
  normalizeFlowchartRecord,
  normalizeFlowchartNode,
  normalizeFlowchartEdge,
  normalizePort,
  normalizeRoleSettings,
  normalizeTechSpec,
  resolveNodeForRole,
  splitEdgeWithDecision,
  autoLayoutFlowchart,
  validateFlowchart,
  flowchartToMermaid
} from '../domain/flowchart.js';

export class FlowchartService {
  constructor({
    flowcharts,
    services = {},
    workflows = null,
    nodes = null,
    menus = null,
    elementScripts = null,
    projects = null,
    themes = null,
    users = null,
    collaboration = null,
    trash = null,
    projectPrefix = null,
    transaction
  }) {
    Object.assign(this, {
      flowcharts,
      services,
      workflows,
      nodes,
      menus,
      elementScripts,
      projects,
      themes,
      users,
      collaboration,
      trash,
      projectPrefix,
      transaction
    });
  }

  #enrichUsernames(fc) {
    if (!fc) return fc;
    const creator = this.users ? this.users.get(fc.creatorId || fallbackOwnerId(this)) : null;
    const rootOwner = this.users ? this.users.get(fc.rootOwnerId || fc.creatorId || fallbackOwnerId(this)) : null;
    const approver = fc.approvedBy && this.users ? this.users.get(fc.approvedBy) : null;
    return {
      ...fc,
      creatorUsername: creator?.username || 'superadmin',
      rootOwnerUsername: rootOwner?.username || 'superadmin',
      approvedByUsername: approver?.username || null
    };
  }

  #publicUserId() { return this.users?.publicUserId?.() ?? null; }

  #isSuperadminId(actorId, actor = null) {
    const u = actor?.role ? actor : (actorId != null && this.users ? this.users.get(Number(actorId)) : null);
    if (!u) return false;
    return this.collaboration?.auth ? this.collaboration.auth.isSuperadmin(u) : u.role === 'superadmin';
  }

  #assertStaysPublic(fc, visibility, projectId) {
    const pub = this.#publicUserId();
    if (pub == null || Number(fc.creatorId) !== Number(pub) || (fc.visibility || 'public') !== 'public') return;
    if (visibility !== undefined && visibility !== 'public') {
      throw new ValidationError(`flowchart "${fc.name || fc.key}" belongs to the immutable public library and must stay public; clone it instead`);
    }
    const target = Number(projectId);
    if (projectId !== undefined && (Number.isFinite(target) && target > 0 ? target : 1) !== Number(fc.projectId ?? 1)) {
      throw new ConflictError(`flowchart "${fc.name || fc.key}" belongs to the public library of the default project and cannot be moved to another project; clone it instead`);
    }
  }

  #publicOwnership(data, actorId, actor) {
    const pub = this.#publicUserId();
    if (pub == null || data.visibility !== 'public' || Number(data.projectId ?? 1) !== 1 || !this.#isSuperadminId(actorId, actor)) return null;
    return Number(pub);
  }

  #projectService() { return this.projects || this.collaboration?.projects || null; }

  assertCanEdit(fc, actor) { assertItemAccess(fc, actor, this.#projectService(), 'edit', 'flowchart'); return fc; }
  assertCanRead(fc, actor) { assertItemAccess(fc, actor, this.#projectService(), 'read', 'flowchart'); return fc; }

  #require(idOrKey, projectId = null) {
    const fc = this.flowcharts.find(idOrKey, projectId);
    if (!fc) throw new NotFoundError('flowchart', idOrKey);
    return fc;
  }

  list(query = {}) {
    return this.flowcharts.list(query).map(fc => this.#enrichUsernames(fc));
  }

  get(idOrKey, { projectId = null, includeMermaid = false, includeValidation = false } = {}) {
    const base = this.#require(idOrKey, projectId);
    const nodes = this.flowcharts.nodes(base.id);
    const edges = this.flowcharts.edges(base.id);
    const full = this.#enrichUsernames({
      ...base,
      nodes,
      edges,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roleCount: (base.accessLevels || []).length
    });
    if (includeValidation) full.validation = validateFlowchart(full);
    if (includeMermaid) full.mermaid = flowchartToMermaid(full);
    return full;
  }

  lineage(idOrKey) {
    const fc = this.get(idOrKey);
    const rootItem = fc.rootItemId && fc.rootItemId !== fc.id ? this.flowcharts.get(fc.rootItemId) : fc;
    const clonedFrom = fc.clonedFromId ? this.flowcharts.get(fc.clonedFromId) : null;
    const creator = this.users ? this.users.get(fc.creatorId || fallbackOwnerId(this)) : { id: 1, username: 'superadmin' };
    const rootOwner = this.users ? this.users.get(fc.rootOwnerId || fallbackOwnerId(this)) : { id: 1, username: 'superadmin' };
    const chain = [];
    const seen = new Set();
    let cur = fc;
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const u = this.users ? this.users.get(cur.creatorId || fallbackOwnerId(this)) : null;
      chain.push({
        id: cur.id,
        key: cur.key,
        name: cur.name,
        creatorId: cur.creatorId || fallbackOwnerId(this),
        creatorUsername: u?.username || 'superadmin',
        clonedFromId: cur.clonedFromId || null,
        rootItemId: cur.rootItemId || cur.id,
        rootOwnerId: cur.rootOwnerId || fallbackOwnerId(this)
      });
      cur = cur.clonedFromId ? this.flowcharts.get(cur.clonedFromId) : null;
    }
    return {
      item: { id: fc.id, key: fc.key, name: fc.name, visibility: fc.visibility, projectId: fc.projectId },
      itemName: fc.name,
      itemKey: fc.key,
      visibility: fc.visibility,
      projectId: fc.projectId,
      creator: creator ? { id: creator.id, username: creator.username } : { id: 1, username: 'superadmin' },
      rootOwner: rootOwner ? { id: rootOwner.id, username: rootOwner.username } : { id: 1, username: 'superadmin' },
      rootItem: rootItem ? { id: rootItem.id, key: rootItem.key, name: rootItem.name } : { id: fc.id, key: fc.key, name: fc.name },
      clonedFrom: clonedFrom ? { id: clonedFrom.id, key: clonedFrom.key, name: clonedFrom.name } : null,
      chain
    };
  }

  getLineage(idOrKey) { return this.lineage(idOrKey); }

  #normalizeGraph(rawNodes = [], rawEdges = [], { autoLayout = false, layoutDirection = 'LR', startNodeKey = null } = {}) {
    const nodeKeys = new Set();
    let nodes = (Array.isArray(rawNodes) ? rawNodes : []).map((n, idx) => normalizeFlowchartNode(n, nodeKeys, idx));
    const edgeKeys = new Set();
    const edges = [];
    for (let i = 0; i < (Array.isArray(rawEdges) ? rawEdges.length : 0); i++) {
      const e = normalizeFlowchartEdge(rawEdges[i], edgeKeys, i);
      const src = nodes.find(n => n.nodeKey === e.fromNodeKey);
      const dst = nodes.find(n => n.nodeKey === e.toNodeKey);
      if (!src) throw new ValidationError(`edge "${e.edgeKey}" references unknown fromNodeKey "${e.fromNodeKey}"`);
      if (!dst) throw new ValidationError(`edge "${e.edgeKey}" references unknown toNodeKey "${e.toNodeKey}"`);
      // If a caller connects from a port key not yet listed on the source node, register that port automatically so AI/UI calls never lose ports
      if (!(src.ports || []).some(p => p.key === e.fromPortKey)) {
        const pKeys = new Set((src.ports || []).map(p => p.key));
        src.ports.push(normalizePort({
          key: e.fromPortKey,
          label: rawEdges[i]?.fromPortLabel || e.label || e.fromPortKey,
          kind: src.kind === 'decision' ? 'case' : src.kind === 'screen' ? 'menu-item' : 'action'
        }, src.ports.length, pKeys));
      }
      edges.push(e);
    }
    if (autoLayout && nodes.length) {
      nodes = autoLayoutFlowchart(nodes, edges, { direction: layoutDirection, startNodeKey });
    }
    return { nodes, edges };
  }

  create(input = {}, { actor = null, actorId = null } = {}) {
    const creatorId = actorId ?? actor?.id ?? input.creatorId ?? fallbackOwnerId(this);
    const data = normalizeFlowchartRecord({
      visibility: input.visibility ?? 'project',
      ...input,
      creatorId,
      rootOwnerId: input.rootOwnerId ?? creatorId
    });
    const pubOwner = this.#publicOwnership(data, actorId ?? actor?.id ?? null, actor);
    if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    if (input.key && this.flowcharts.keyExists(data.key, data.projectId)) {
      throw new ConflictError(`flowchart key "${data.key}" exists in this project`);
    }
    if (!input.key) {
      const prefix = this.projectPrefix ? this.projectPrefix(data.projectId) : null;
      data.key = uniqueKey(
        prefix ? prefixedVariableName(prefix, 'flowchart', data.name) : data.name,
        k => this.flowcharts.keyExists(k, data.projectId)
      );
    }
    if (data.status === 'approved' && !data.approvedAt) {
      data.approvedBy = actorId ?? actor?.id ?? creatorId;
      data.approvedAt = new Date().toISOString();
    }

    const hasStarterNodes = Array.isArray(input.nodes);
    const starterNodes = hasStarterNodes
      ? input.nodes
      : (input.seedStarter === false ? [] : [
          {
            nodeKey: 'entry-screen',
            kind: data.domain === 'backend' ? 'trigger' : 'screen',
            subtype: data.domain === 'backend' ? 'webhook-in' : 'ui-screen',
            title: data.domain === 'backend' ? 'API Request Trigger' : 'Home / Entry Screen',
            description: data.domain === 'backend'
              ? 'Describe the incoming request payload, headers, authentication check, and rate limits.'
              : 'Describe what the user sees on this screen, key UI sections, data loaded, and role-specific features.',
            x: 100,
            y: 120
          }
        ]);
    const graph = this.#normalizeGraph(starterNodes, input.edges || [], {
      autoLayout: Boolean(input.autoLayout),
      layoutDirection: input.layoutDirection || 'LR',
      startNodeKey: data.startNodeKey || starterNodes[0]?.nodeKey || null
    });
    if (!data.startNodeKey && graph.nodes[0]) data.startNodeKey = graph.nodes[0].nodeKey;

    return this.transaction(() => {
      const created = this.flowcharts.create(data);
      if (graph.nodes.length || graph.edges.length) {
        this.flowcharts.replaceGraph(created.id, graph);
      }
      return this.get(created.id, { includeValidation: true });
    });
  }

  update(idOrKey, patch = {}, { actor = null, actorId = null, projectId = null, recordChange = false } = {}) {
    const effActorId = actorId ?? actor?.id ?? null;
    const fc = this.assertCanEdit(this.#require(idOrKey, projectId), actor);
    const beforeDoc = (effActorId || recordChange) ? this.get(fc.id) : null;
    const clean = stripOwnership(patch);
    this.#assertStaysPublic(fc, clean.visibility, clean.projectId);
    const data = normalizeFlowchartRecord(clean, { partial: true });

    const becomesLibrary = (data.visibility === 'public' && (fc.visibility || 'project') !== 'public')
      || (data.projectId !== undefined && Number(data.projectId) === 1 && Number(fc.projectId ?? 1) !== 1);
    if (becomesLibrary) {
      const pubOwner = this.#publicOwnership({
        visibility: data.visibility ?? fc.visibility ?? 'project',
        projectId: data.projectId ?? fc.projectId ?? 1
      }, effActorId, actor);
      if (pubOwner != null) { data.creatorId = pubOwner; data.rootOwnerId = pubOwner; }
    }
    if (data.key && data.key !== fc.key && this.flowcharts.keyExists(data.key, data.projectId ?? fc.projectId)) {
      throw new ConflictError(`flowchart key "${data.key}" exists in this project`);
    }
    if (data.status === 'approved' && fc.status !== 'approved') {
      data.approvedBy = effActorId ?? fc.creatorId ?? 1;
      data.approvedAt = new Date().toISOString();
    } else if (data.status && data.status !== 'approved') {
      data.approvedBy = null;
      data.approvedAt = null;
    }

    const replaceGraph = patch.nodes !== undefined || patch.edges !== undefined;
    const graph = replaceGraph
      ? this.#normalizeGraph(
          patch.nodes !== undefined ? patch.nodes : this.flowcharts.nodes(fc.id),
          patch.edges !== undefined ? patch.edges : this.flowcharts.edges(fc.id),
          {
            autoLayout: Boolean(patch.autoLayout),
            layoutDirection: patch.layoutDirection || 'LR',
            startNodeKey: data.startNodeKey !== undefined ? data.startNodeKey : fc.startNodeKey
          }
        )
      : null;

    const afterDoc = this.transaction(() => {
      this.flowcharts.update(fc.id, data);
      if (graph) this.flowcharts.replaceGraph(fc.id, graph);
      return this.get(fc.id, { includeValidation: true });
    });

    if (beforeDoc && this.collaboration) {
      const review = this.collaboration.changeReviewer
        ? this.collaboration.changeReviewer(beforeDoc, effActorId, { force: recordChange })
        : ((recordChange || (effActorId && Number(effActorId) !== Number(fc.creatorId || fallbackOwnerId(this)))) ? { ownerId: fc.creatorId || fallbackOwnerId(this) } : null);
      if (review) {
        this.collaboration.recordEdit({
          projectId: afterDoc.projectId || 1,
          targetType: 'flowchart',
          targetId: afterDoc.id,
          targetKey: afterDoc.key,
          targetName: afterDoc.name,
          authorId: effActorId ?? fallbackOwnerId(this),
          ownerId: review.ownerId,
          action: 'update',
          beforeDoc,
          afterDoc
        });
      }
    }
    return afterDoc;
  }

  setStatus(idOrKey, { status, approvalNote } = {}, { actor = null, projectId = null } = {}) {
    return this.update(idOrKey, {
      status,
      ...(approvalNote !== undefined ? { approvalNote } : {})
    }, { actor, projectId });
  }

  remove(idOrKey, { actor = null, projectId = null, permanent = false } = {}) {
    const fc = this.assertCanEdit(this.#require(idOrKey, projectId), actor);
    if (fc.locked) throw new ConflictError(`flowchart "${fc.name || fc.key}" is locked; unlock it before deleting`);
    const isPublic = (fc.visibility || 'project') === 'public';
    const pub = this.#publicUserId();
    const inLibrary = pub != null && Number(fc.creatorId) === Number(pub) && isPublic;
    if (actor && ((isPublic && !['admin', 'superadmin'].includes(actor.role)) || (inLibrary && actor.role !== 'superadmin'))) {
      throw new ForbiddenError('Only admin or superadmin can trash or purge public items (public-library items: superadmin only)');
    }
    let trashRec = null;
    if (!permanent && this.trash) {
      const snapshot = {
        uid: this.flowcharts.uidOf(fc.id),
        record: fc,
        nodes: this.flowcharts.nodes(fc.id),
        edges: this.flowcharts.edges(fc.id)
      };
      trashRec = this.trash.put({
        itemType: 'flowchart',
        originalId: fc.id,
        itemKey: fc.key,
        itemName: fc.name,
        label: fc.label || '',
        category: fc.domain || 'flowchart',
        projectId: fc.projectId ?? 1,
        visibility: fc.visibility || 'project',
        builtin: false,
        creatorId: fc.creatorId ?? fallbackOwnerId(this),
        rootOwnerId: fc.rootOwnerId ?? fallbackOwnerId(this),
        deletedBy: actor?.id ?? fallbackOwnerId(this),
        snapshot
      });
    }
    this.flowcharts.delete(fc.id);
    return { deleted: true, trashed: !permanent && Boolean(trashRec), id: fc.id, trashId: trashRec?.id ?? null };
  }

  clone(idOrKey, opts = {}, { actor = null, actorId = null, projectId = null } = {}) {
    const name = typeof opts === 'string' ? opts : opts?.name;
    const src = this.assertCanRead(this.get(idOrKey, { projectId }), actor);
    const newCreator = actorId ?? actor?.id ?? opts?.creatorId ?? src.creatorId ?? fallbackOwnerId(this);
    const rootOwnerId = src.rootOwnerId || src.creatorId || fallbackOwnerId(this);
    const rootItemId = src.rootItemId || src.id;
    const targetProjectId = opts?.projectId !== undefined ? Number(opts.projectId) : src.projectId;
    if (opts?.projectId !== undefined && actor) {
      assertItemAccess({ projectId: targetProjectId, visibility: 'project', creatorId: newCreator }, actor, this.#projectService(), 'edit', 'flowchart');
    }
    const nm = name || `${src.name} copy`;
    const prefix = this.projectPrefix ? this.projectPrefix(targetProjectId) : null;
    const key = opts?.key && !this.flowcharts.keyExists(opts.key, targetProjectId)
      ? opts.key
      : uniqueKey(prefix ? prefixedVariableName(prefix, 'flowchart', nm) : nm, k => this.flowcharts.keyExists(k, targetProjectId));

    return this.transaction(() => {
      const dst = this.flowcharts.create({
        key,
        name: nm,
        label: opts?.label ?? src.label ?? nm,
        description: opts?.description ?? src.description ?? '',
        domain: opts?.domain ?? src.domain ?? 'fullstack',
        status: opts?.keepApproval ? src.status : 'draft',
        approvedBy: opts?.keepApproval ? src.approvedBy : null,
        approvedAt: opts?.keepApproval ? src.approvedAt : null,
        approvalNote: opts?.keepApproval ? src.approvalNote : '',
        accessLevels: src.accessLevels,
        spec: src.spec,
        startNodeKey: src.startNodeKey,
        linkedWorkflowId: targetProjectId === src.projectId ? src.linkedWorkflowId : null,
        projectId: targetProjectId,
        visibility: opts?.visibility || (opts?.projectId !== undefined ? 'project' : 'private'),
        creatorId: newCreator,
        clonedFromId: src.id,
        rootItemId,
        rootOwnerId,
        locked: false
      });
      this.flowcharts.replaceGraph(dst.id, {
        nodes: src.nodes.map(n => ({
          ...n,
          linkedScreenId: targetProjectId === src.projectId ? n.linkedScreenId : null,
          linkedFlowchartId: targetProjectId === src.projectId ? n.linkedFlowchartId : null
        })),
        edges: src.edges
      });
      return this.get(dst.id, { includeValidation: true });
    });
  }

  restore(idOrKey, snap = {}, { actor = null, projectId = null } = {}) {
    const fc = this.assertCanEdit(this.#require(idOrKey, projectId), actor);
    const graph = this.#normalizeGraph(snap.nodes || [], snap.edges || []);
    return this.transaction(() => {
      const patch = {};
      for (const k of ['name', 'label', 'description', 'domain', 'status', 'approvalNote', 'startNodeKey', 'linkedWorkflowId', 'accessLevels', 'spec']) {
        if (snap[k] !== undefined) patch[k] = snap[k];
      }
      if (Object.keys(patch).length) {
        this.flowcharts.update(fc.id, normalizeFlowchartRecord(patch, { partial: true }));
      }
      this.flowcharts.replaceGraph(fc.id, graph);
      return this.get(fc.id, { includeValidation: true });
    });
  }

  /**
   * Executes one or more interactive graph operations atomically on a flowchart.
   * Used both by the ComfyUI web designer and by AI agents via `uiux_flowchart_op`.
   */
  applyOps(idOrKey, opsInput, { actor = null, projectId = null } = {}) {
    const fc = this.assertCanEdit(this.get(idOrKey, { projectId }), actor);
    const ops = Array.isArray(opsInput) ? opsInput : [opsInput];
    if (!ops.length) throw new ValidationError('at least one flowchart operation is required');

    let nodes = fc.nodes.map(n => ({ ...n, ports: (n.ports || []).map(p => ({ ...p })) }));
    let edges = fc.edges.map(e => ({ ...e }));
    const recordPatch = {};
    const results = [];

    for (const rawOp of ops) {
      if (!rawOp || typeof rawOp !== 'object') throw new ValidationError('each operation must be an object');
      const op = String(rawOp.op || rawOp.action || '').trim();
      const nodeKeys = new Set(nodes.map(n => n.nodeKey));
      const edgeKeys = new Set(edges.map(e => e.edgeKey));

      if (op === 'add_node') {
        const created = normalizeFlowchartNode(rawOp.node || rawOp, nodeKeys, nodes.length);
        nodes.push(created);
        if (!fc.startNodeKey && recordPatch.startNodeKey === undefined && nodes.length === 1) {
          recordPatch.startNodeKey = created.nodeKey;
        }
        let connectedEdge = null;
        if (rawOp.connectFrom?.nodeKey) {
          const src = nodes.find(n => n.nodeKey === rawOp.connectFrom.nodeKey);
          if (!src) throw new ValidationError(`connectFrom node "${rawOp.connectFrom.nodeKey}" not found`);
          const fromPortKey = rawOp.connectFrom.portKey || src.ports?.[0]?.key || 'out';
          if (!src.ports.some(p => p.key === fromPortKey)) {
            const pk = new Set(src.ports.map(p => p.key));
            src.ports.push(normalizePort({ key: fromPortKey, label: rawOp.connectFrom.portLabel || fromPortKey }, src.ports.length, pk));
          }
          connectedEdge = normalizeFlowchartEdge({
            fromNodeKey: src.nodeKey,
            fromPortKey,
            toNodeKey: created.nodeKey,
            toPortKey: HOME_PORT_KEY,
            label: rawOp.connectFrom.label || '',
            transitionText: rawOp.connectFrom.transitionText || ''
          }, edgeKeys, edges.length);
          edges.push(connectedEdge);
        }
        results.push({ op, nodeKey: created.nodeKey, ...(connectedEdge ? { edgeKey: connectedEdge.edgeKey } : {}) });
      } else if (op === 'update_node') {
        const key = String(rawOp.nodeKey || rawOp.key || '');
        const idx = nodes.findIndex(n => n.nodeKey === key);
        if (idx < 0) throw new NotFoundError('flowchart_node', key);
        const cur = nodes[idx];
        const patch = rawOp.patch || rawOp;
        const otherKeys = new Set(nodes.filter((_, i) => i !== idx).map(n => n.nodeKey));
        const updated = normalizeFlowchartNode({
          ...cur,
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.subtype !== undefined ? { subtype: patch.subtype } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.x !== undefined ? { x: patch.x } : {}),
          ...(patch.y !== undefined ? { y: patch.y } : {}),
          ...(patch.width !== undefined ? { width: patch.width } : {}),
          ...(patch.collapsed !== undefined ? { collapsed: patch.collapsed } : {}),
          ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
          ...(patch.ports !== undefined ? { ports: patch.ports } : {}),
          ...(patch.roleSettings !== undefined ? { roleSettings: patch.roleSettings } : {}),
          ...(patch.techSpec !== undefined ? { techSpec: { ...cur.techSpec, ...patch.techSpec } } : {}),
          ...(patch.linkedScreenId !== undefined ? { linkedScreenId: patch.linkedScreenId } : {}),
          ...(patch.linkedFlowchartId !== undefined ? { linkedFlowchartId: patch.linkedFlowchartId } : {}),
          nodeKey: patch.newNodeKey || cur.nodeKey
        }, otherKeys, idx);
        if (updated.nodeKey !== cur.nodeKey) {
          edges = edges.map(e => ({
            ...e,
            fromNodeKey: e.fromNodeKey === cur.nodeKey ? updated.nodeKey : e.fromNodeKey,
            toNodeKey: e.toNodeKey === cur.nodeKey ? updated.nodeKey : e.toNodeKey
          }));
          if ((recordPatch.startNodeKey ?? fc.startNodeKey) === cur.nodeKey) recordPatch.startNodeKey = updated.nodeKey;
        }
        nodes[idx] = updated;
        results.push({ op, nodeKey: updated.nodeKey });
      } else if (op === 'remove_node') {
        const key = String(rawOp.nodeKey || rawOp.key || '');
        if (!nodes.some(n => n.nodeKey === key)) throw new NotFoundError('flowchart_node', key);
        nodes = nodes.filter(n => n.nodeKey !== key);
        edges = edges.filter(e => e.fromNodeKey !== key && e.toNodeKey !== key);
        if ((recordPatch.startNodeKey ?? fc.startNodeKey) === key) {
          recordPatch.startNodeKey = nodes[0]?.nodeKey || null;
        }
        results.push({ op, removedNodeKey: key });
      } else if (op === 'add_port') {
        const node = nodes.find(n => n.nodeKey === String(rawOp.nodeKey || ''));
        if (!node) throw new NotFoundError('flowchart_node', rawOp.nodeKey);
        const pKeys = new Set(node.ports.map(p => p.key));
        const defaultKind = node.kind === 'decision' ? 'case' : node.kind === 'screen' ? 'menu-item' : 'action';
        const port = normalizePort(rawOp.port || rawOp, node.ports.length, pKeys, defaultKind);
        node.ports.push(port);
        results.push({ op, nodeKey: node.nodeKey, portKey: port.key });
      } else if (op === 'update_port') {
        const node = nodes.find(n => n.nodeKey === String(rawOp.nodeKey || ''));
        if (!node) throw new NotFoundError('flowchart_node', rawOp.nodeKey);
        const pIdx = node.ports.findIndex(p => p.key === String(rawOp.portKey || ''));
        if (pIdx < 0) throw new NotFoundError('flowchart_port', rawOp.portKey);
        const curPort = node.ports[pIdx];
        const patch = rawOp.patch || rawOp;
        const otherPKeys = new Set(node.ports.filter((_, i) => i !== pIdx).map(p => p.key));
        const updatedPort = normalizePort({
          ...curPort,
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.allowedRoles !== undefined ? { allowedRoles: patch.allowedRoles } : {}),
          ...(patch.deniedBehavior !== undefined ? { deniedBehavior: patch.deniedBehavior } : {}),
          ...(patch.payloadHint !== undefined ? { payloadHint: patch.payloadHint } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          key: patch.newPortKey || curPort.key
        }, pIdx, otherPKeys, curPort.kind);
        if (updatedPort.key !== curPort.key) {
          edges = edges.map(e => (e.fromNodeKey === node.nodeKey && e.fromPortKey === curPort.key ? { ...e, fromPortKey: updatedPort.key } : e));
        }
        node.ports[pIdx] = updatedPort;
        results.push({ op, nodeKey: node.nodeKey, portKey: updatedPort.key });
      } else if (op === 'remove_port') {
        const node = nodes.find(n => n.nodeKey === String(rawOp.nodeKey || ''));
        if (!node) throw new NotFoundError('flowchart_node', rawOp.nodeKey);
        const portKey = String(rawOp.portKey || '');
        node.ports = node.ports.filter(p => p.key !== portKey);
        edges = edges.filter(e => !(e.fromNodeKey === node.nodeKey && e.fromPortKey === portKey));
        results.push({ op, nodeKey: node.nodeKey, removedPortKey: portKey });
      } else if (op === 'reorder_ports') {
        const node = nodes.find(n => n.nodeKey === String(rawOp.nodeKey || ''));
        if (!node) throw new NotFoundError('flowchart_node', rawOp.nodeKey);
        const order = Array.isArray(rawOp.portKeys) ? rawOp.portKeys.map(String) : [];
        const byK = new Map(node.ports.map(p => [p.key, p]));
        const nextPorts = [];
        for (const k of order) if (byK.has(k)) { nextPorts.push(byK.get(k)); byK.delete(k); }
        for (const rest of byK.values()) nextPorts.push(rest);
        node.ports = nextPorts;
        results.push({ op, nodeKey: node.nodeKey });
      } else if (op === 'connect') {
        const edgeInput = rawOp.edge || rawOp;
        const src = nodes.find(n => n.nodeKey === String(edgeInput.fromNodeKey || edgeInput.from || ''));
        const dst = nodes.find(n => n.nodeKey === String(edgeInput.toNodeKey || edgeInput.to || ''));
        if (!src) throw new NotFoundError('flowchart_node', edgeInput.fromNodeKey || edgeInput.from);
        if (!dst) throw new NotFoundError('flowchart_node', edgeInput.toNodeKey || edgeInput.to);
        if (dst.kind === 'trigger') throw new ValidationError(`cannot connect into trigger node "${dst.title}"`);
        const fromPortKey = String(edgeInput.fromPortKey || edgeInput.fromPort || src.ports?.[0]?.key || 'out');
        if (!src.ports.some(p => p.key === fromPortKey)) {
          const pk = new Set(src.ports.map(p => p.key));
          src.ports.push(normalizePort({
            key: fromPortKey,
            label: edgeInput.portLabel || edgeInput.label || fromPortKey,
            kind: src.kind === 'decision' ? 'case' : src.kind === 'screen' ? 'menu-item' : 'action'
          }, src.ports.length, pk));
        }
        const edge = normalizeFlowchartEdge({ ...edgeInput, fromNodeKey: src.nodeKey, fromPortKey, toNodeKey: dst.nodeKey }, edgeKeys, edges.length);
        edges.push(edge);
        results.push({ op, edgeKey: edge.edgeKey });
      } else if (op === 'update_edge') {
        const key = String(rawOp.edgeKey || rawOp.key || '');
        const idx = edges.findIndex(e => e.edgeKey === key);
        if (idx < 0) throw new NotFoundError('flowchart_edge', key);
        const cur = edges[idx];
        const patch = rawOp.patch || rawOp;
        const otherEKeys = new Set(edges.filter((_, i) => i !== idx).map(e => e.edgeKey));
        const updated = normalizeFlowchartEdge({
          ...cur,
          ...(patch.fromNodeKey !== undefined ? { fromNodeKey: patch.fromNodeKey } : {}),
          ...(patch.fromPortKey !== undefined ? { fromPortKey: patch.fromPortKey } : {}),
          ...(patch.toNodeKey !== undefined ? { toNodeKey: patch.toNodeKey } : {}),
          ...(patch.toPortKey !== undefined ? { toPortKey: patch.toPortKey } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.transitionText !== undefined ? { transitionText: patch.transitionText } : {}),
          ...(patch.conditionExpr !== undefined ? { conditionExpr: patch.conditionExpr } : {}),
          ...(patch.style !== undefined ? { style: patch.style } : {}),
          ...(patch.roleSettings !== undefined ? { roleSettings: patch.roleSettings } : {}),
          ...(patch.techSpec !== undefined ? { techSpec: { ...cur.techSpec, ...patch.techSpec } } : {}),
          ...(patch.waypoints !== undefined ? { waypoints: patch.waypoints } : {}),
          edgeKey: cur.edgeKey
        }, otherEKeys, idx);
        edges[idx] = updated;
        results.push({ op, edgeKey: updated.edgeKey });
      } else if (op === 'disconnect') {
        const key = rawOp.edgeKey || rawOp.key;
        const beforeLen = edges.length;
        if (key) {
          edges = edges.filter(e => e.edgeKey !== String(key));
        } else if (rawOp.fromNodeKey && rawOp.toNodeKey) {
          edges = edges.filter(e => !(
            e.fromNodeKey === rawOp.fromNodeKey &&
            e.toNodeKey === rawOp.toNodeKey &&
            (!rawOp.fromPortKey || e.fromPortKey === rawOp.fromPortKey)
          ));
        } else {
          throw new ValidationError('disconnect requires edgeKey or (fromNodeKey + toNodeKey)');
        }
        results.push({ op, removed: beforeLen - edges.length });
      } else if (op === 'insert_decision_on_edge') {
        const split = splitEdgeWithDecision(nodes, edges, String(rawOp.edgeKey || ''), {
          decisionTitle: rawOp.decisionTitle || rawOp.title,
          decisionDescription: rawOp.decisionDescription || rawOp.description,
          conditionExpr: rawOp.conditionExpr || '',
          cases: rawOp.cases || null
        });
        nodes = split.nodes;
        edges = split.edges;
        results.push({
          op,
          decisionNodeKey: split.decisionNode.nodeKey,
          incomingEdgeKey: split.incomingEdge.edgeKey,
          outgoingEdgeKeys: split.outgoingEdges.map(e => e.edgeKey)
        });
      } else if (op === 'set_role_variant') {
        const targetKind = rawOp.targetKind || (rawOp.edgeKey ? 'edge' : rawOp.portKey ? 'port' : 'node');
        if (targetKind === 'edge') {
          const edge = edges.find(e => e.edgeKey === String(rawOp.edgeKey || ''));
          if (!edge) throw new NotFoundError('flowchart_edge', rawOp.edgeKey);
          edge.roleSettings = normalizeRoleSettings({
            ...edge.roleSettings,
            ...(rawOp.allowedRoles !== undefined ? { allowedRoles: rawOp.allowedRoles } : {}),
            ...(rawOp.deniedBehavior !== undefined ? { deniedBehavior: rawOp.deniedBehavior } : {})
          });
          results.push({ op, edgeKey: edge.edgeKey });
        } else {
          const node = nodes.find(n => n.nodeKey === String(rawOp.nodeKey || ''));
          if (!node) throw new NotFoundError('flowchart_node', rawOp.nodeKey);
          if (targetKind === 'port') {
            const port = node.ports.find(p => p.key === String(rawOp.portKey || ''));
            if (!port) throw new NotFoundError('flowchart_port', rawOp.portKey);
            if (rawOp.allowedRoles !== undefined) port.allowedRoles = normalizeRoleSettings({ allowedRoles: rawOp.allowedRoles }).allowedRoles;
            if (rawOp.deniedBehavior !== undefined) port.deniedBehavior = normalizeRoleSettings({ deniedBehavior: rawOp.deniedBehavior }).deniedBehavior;
            results.push({ op, nodeKey: node.nodeKey, portKey: port.key });
          } else {
            const curRs = node.roleSettings || { allowedRoles: [], deniedBehavior: 'hide', variants: {} };
            const nextVariants = { ...(curRs.variants || {}) };
            if (rawOp.roleKey) {
              const rk = slugify(rawOp.roleKey, 'role');
              if (rawOp.clear) delete nextVariants[rk];
              else {
                nextVariants[rk] = {
                  summary: rawOp.summary ?? nextVariants[rk]?.summary ?? '',
                  addedFeatures: rawOp.addedFeatures ?? nextVariants[rk]?.addedFeatures ?? '',
                  hiddenFeatures: rawOp.hiddenFeatures ?? nextVariants[rk]?.hiddenFeatures ?? '',
                  notes: rawOp.notes ?? nextVariants[rk]?.notes ?? ''
                };
              }
            }
            if (rawOp.variants && typeof rawOp.variants === 'object') Object.assign(nextVariants, rawOp.variants);
            node.roleSettings = normalizeRoleSettings({
              ...curRs,
              ...(rawOp.allowedRoles !== undefined ? { allowedRoles: rawOp.allowedRoles } : {}),
              ...(rawOp.deniedBehavior !== undefined ? { deniedBehavior: rawOp.deniedBehavior } : {}),
              ...(rawOp.redirectNodeKey !== undefined ? { redirectNodeKey: rawOp.redirectNodeKey } : {}),
              variants: nextVariants
            });
            results.push({ op, nodeKey: node.nodeKey });
          }
        }
      } else if (op === 'set_access_levels') {
        recordPatch.accessLevels = normalizeAccessLevels(rawOp.accessLevels);
        results.push({ op, count: recordPatch.accessLevels.length });
      } else if (op === 'set_start_node') {
        const key = rawOp.nodeKey ? String(rawOp.nodeKey) : null;
        if (key && !nodes.some(n => n.nodeKey === key)) throw new NotFoundError('flowchart_node', key);
        recordPatch.startNodeKey = key;
        results.push({ op, startNodeKey: key });
      } else if (op === 'auto_layout') {
        nodes = autoLayoutFlowchart(nodes, edges, {
          direction: rawOp.direction || 'LR',
          startNodeKey: recordPatch.startNodeKey ?? fc.startNodeKey,
          gapX: rawOp.gapX || 400,
          gapY: rawOp.gapY || 290
        });
        results.push({ op, laidOut: nodes.length });
      } else if (op === 'approve' || op === 'set_status') {
        recordPatch.status = op === 'approve' ? 'approved' : (rawOp.status || 'approved');
        if (rawOp.approvalNote !== undefined) recordPatch.approvalNote = rawOp.approvalNote;
        results.push({ op, status: recordPatch.status });
      } else if (op === 'validate') {
        results.push({ op, validation: validateFlowchart({ ...fc, ...recordPatch, nodes, edges }) });
      } else {
        throw new ValidationError(`unknown flowchart operation "${op}"`);
      }
    }

    // Persist if any mutating op ran
    const mutated = ops.some(o => (o?.op || o?.action) !== 'validate');
    const updated = mutated
      ? this.update(fc.id, { ...recordPatch, nodes, edges }, { actor, projectId: fc.projectId })
      : this.get(fc.id, { includeValidation: true });
    return { flowchart: updated, results };
  }

  /**
   * Materializes conceptual `screen` nodes of an approved flowchart into real visual `Screen` designs
   * and optionally creates/updates a linked visual `Workflow` so AI coders or designers can immediately
   * assemble UI components using the public/project design libraries.
   */
  materializeToScreens(idOrKey, {
    allowUnapproved = false,
    syncDescriptions = true,
    syncWorkflow = true,
    deviceWidth = 390,
    deviceHeight = 844,
    projectId = null
  } = {}, { actor = null } = {}) {
    const fc = this.assertCanEdit(this.get(idOrKey, { projectId }), actor);
    if (fc.status !== 'approved' && !allowUnapproved) {
      throw new ConflictError(`Flowchart "${fc.name}" is currently "${fc.status}". Approve the flowchart first (or pass allowUnapproved: true) before materializing UI screens.`);
    }
    if (!this.services?.screen) throw new ValidationError('Screen service is not available in this container');

    const screenNodes = fc.nodes.filter(n => n.kind === 'screen');
    if (!screenNodes.length) {
      throw new ValidationError(`Flowchart "${fc.name}" contains no conceptual screen nodes to materialize`);
    }

    return this.transaction(() => {
      const createdScreens = [];
      const updatedScreens = [];
      const nodeKeyToScreenId = new Map();

      const buildScreenDevSpec = node => {
        const lines = [
          `[FlowChart: ${fc.name} (${fc.key}) · Node: ${node.nodeKey}]`,
          node.description ? `Screen Behavior:\n${node.description}` : ''
        ].filter(Boolean);
        if (node.ports?.length) {
          lines.push(`Interactive Actions / Menu Items:\n${node.ports.map(p => `- [${p.kind}] ${p.label} (${p.key})${p.description ? `: ${p.description}` : ''}${p.allowedRoles?.length ? ` [Roles: ${p.allowedRoles.join(', ')}]` : ''}`).join('\n')}`);
        }
        const variants = node.roleSettings?.variants || {};
        if (Object.keys(variants).length) {
          lines.push(`Access-Level Variants:\n${Object.entries(variants).map(([rk, rv]) => `- @${rk}: ${[rv.summary, rv.addedFeatures ? `(+ ${rv.addedFeatures})` : '', rv.hiddenFeatures ? `(- ${rv.hiddenFeatures})` : ''].filter(Boolean).join(' ')}`).join('\n')}`);
        }
        if (node.techSpec?.uiLayoutHint) lines.push(`UI Layout Hint: ${node.techSpec.uiLayoutHint}`);
        return lines.join('\n\n');
      };

      const nextNodes = fc.nodes.map(n => {
        if (n.kind !== 'screen') return n;
        const devDesc = buildScreenDevSpec(n);
        let existing = null;
        if (n.linkedScreenId) {
          try { existing = this.services.screen.get(n.linkedScreenId); } catch { existing = null; }
        }
        if (existing && Number(existing.projectId) === Number(fc.projectId)) {
          if (syncDescriptions) {
            this.services.screen.update(existing.id, { descriptionDev: devDesc }, { actor });
          }
          nodeKeyToScreenId.set(n.nodeKey, existing.id);
          updatedScreens.push({ nodeKey: n.nodeKey, screenId: existing.id, key: existing.key, name: existing.name });
          return { ...n, linkedScreenId: existing.id };
        }
        const made = this.services.screen.create({
          name: n.title,
          label: n.title,
          descriptionDev: devDesc,
          category: 'flowchart',
          width: deviceWidth,
          height: deviceHeight,
          projectId: fc.projectId,
          visibility: fc.visibility === 'public' ? 'public' : 'project',
          meta: { flowchartKey: fc.key, flowchartNodeKey: n.nodeKey, subtype: n.subtype }
        }, { actor });
        nodeKeyToScreenId.set(n.nodeKey, made.id);
        createdScreens.push({ nodeKey: n.nodeKey, screenId: made.id, key: made.key, name: made.name });
        return { ...n, linkedScreenId: made.id };
      });

      let linkedWorkflowId = fc.linkedWorkflowId;
      let workflowSummary = null;
      if (syncWorkflow && this.workflows && nodeKeyToScreenId.size > 0) {
        let wf = null;
        if (linkedWorkflowId) {
          try { wf = this.workflows.get(linkedWorkflowId); } catch { wf = null; }
        }
        if (!wf) {
          wf = this.workflows.create({
            name: `${fc.name} Screens`,
            label: `${fc.name} Screens`,
            descriptionDev: `Synchronized visual screen workflow from conceptual FlowChart "${fc.name}" (${fc.key}).`,
            projectId: fc.projectId,
            visibility: fc.visibility === 'public' ? 'public' : 'project'
          }, { actor });
          linkedWorkflowId = wf.id;
        }
        // Place every materialized screen onto the visual workflow
        for (const sn of nextNodes.filter(x => x.kind === 'screen' && x.linkedScreenId)) {
          this.workflows.placeScreen(wf.id, {
            screenId: sn.linkedScreenId,
            x: Math.round(sn.x * 1.4),
            y: Math.round(sn.y * 2.2)
          }, { actor });
        }
        // Derive screen-to-screen transitions (direct or traversing intermediate step/decision nodes up to 4 hops)
        const existingLinks = this.workflows.get(wf.id).links || [];
        const seenPairs = new Set(existingLinks.map(l => `${l.fromScreenId}->${l.toScreenId}:${l.name}`));
        const outAdj = new Map();
        for (const e of fc.edges) {
          if (!outAdj.has(e.fromNodeKey)) outAdj.set(e.fromNodeKey, []);
          outAdj.get(e.fromNodeKey).push(e);
        }
        const byKey = new Map(nextNodes.map(n => [n.nodeKey, n]));
        for (const sn of nextNodes.filter(x => x.kind === 'screen' && x.linkedScreenId)) {
          const fromSid = sn.linkedScreenId;
          // BFS through non-screen nodes (steps/decisions) to find reachable downstream screens
          const stack = (outAdj.get(sn.nodeKey) || []).map(e => ({ edge: e, curKey: e.toNodeKey, hops: 0, trail: [e] }));
          const visited = new Set();
          while (stack.length) {
            const { edge: firstEdge, curKey, hops, trail } = stack.shift();
            const targetNode = byKey.get(curKey);
            if (!targetNode || hops > 5) continue;
            if (targetNode.kind === 'screen' && targetNode.linkedScreenId && targetNode.linkedScreenId !== fromSid) {
              const port = (sn.ports || []).find(p => p.key === firstEdge.fromPortKey);
              const linkName = firstEdge.label || port?.label || trail.at(-1)?.label || 'Navigate';
              const pairKey = `${fromSid}->${targetNode.linkedScreenId}:${linkName}`;
              if (!seenPairs.has(pairKey)) {
                seenPairs.add(pairKey);
                const desc = trail.map(t => t.transitionText || t.label).filter(Boolean).join(' -> ');
                this.workflows.addLink(wf.id, {
                  fromScreenId: fromSid,
                  toScreenId: targetNode.linkedScreenId,
                  name: linkName.slice(0, 120),
                  descriptionDev: desc.slice(0, 2000),
                  style: 'curved',
                  trigger: 'tap'
                }, { actor });
              }
              continue;
            }
            if (targetNode.kind !== 'screen' && !visited.has(`${firstEdge.edgeKey}:${curKey}`)) {
              visited.add(`${firstEdge.edgeKey}:${curKey}`);
              for (const ne of outAdj.get(curKey) || []) {
                stack.push({ edge: firstEdge, curKey: ne.toNodeKey, hops: hops + 1, trail: [...trail, ne] });
              }
            }
          }
        }
        const startScreenId = fc.startNodeKey && nodeKeyToScreenId.get(fc.startNodeKey)
          ? nodeKeyToScreenId.get(fc.startNodeKey)
          : [...nodeKeyToScreenId.values()][0] || null;
        if (startScreenId) {
          try { this.workflows.update(wf.id, { startScreenId }, { actor }); } catch { /* ignore */ }
        }
        const refreshedWf = this.workflows.get(wf.id);
        workflowSummary = { id: refreshedWf.id, key: refreshedWf.key, name: refreshedWf.name, screenCount: refreshedWf.nodes.length, linkCount: refreshedWf.links.length };
      }

      this.flowcharts.update(fc.id, { linkedWorkflowId });
      this.flowcharts.replaceGraph(fc.id, { nodes: nextNodes, edges: fc.edges });
      return {
        createdScreens,
        updatedScreens,
        workflow: workflowSummary,
        flowchart: this.get(fc.id, { includeValidation: true })
      };
    });
  }

  /**
   * Reverse-engineers existing visual Screens, Buttons/Menus, Elements/Scripts, and Workflows of a project
   * into a rich conceptual FlowChart.
   */
  reverseEngineerFromProject({
    projectId = 1,
    workflowId = null,
    screenIds = null,
    name = '',
    description = '',
    includeBackendSteps = true,
    visibility = 'project'
  } = {}, { actor = null } = {}) {
    const pid = Number(projectId) || 1;
    const proj = this.#projectService()?.get?.(pid) || { id: pid, name: `Project #${pid}`, key: `project-${pid}` };
    const wf = workflowId && this.workflows ? this.workflows.get(workflowId) : null;

    let screens = [];
    if (Array.isArray(screenIds) && screenIds.length) {
      screens = screenIds.map(id => { try { return this.services.screen.get(id); } catch { return null; } }).filter(Boolean);
    } else if (wf?.nodes?.length) {
      screens = wf.nodes.map(n => { try { return this.services.screen.get(n.screenId); } catch { return null; } }).filter(Boolean);
    } else if (this.services?.screen) {
      const list = this.services.screen.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false });
      const chosen = list.length ? list : this.services.screen.list({ projectId: pid, includePublic: true }).slice(0, 25);
      screens = chosen.map(s => this.services.screen.get(s.id));
    }

    if (!screens.length) {
      throw new ValidationError('No screens found in the target project to reverse-engineer into a flowchart');
    }

    const screenIdSet = new Set(screens.map(s => Number(s.id)));
    const nodesOf = (type, id) => (this.nodes ? this.nodes.listByOwner(type, Number(id)) : []);
    const menuOf = buttonId => (this.menus ? (this.menus.list?.(Number(buttonId)) || []) : []);

    const rawNodes = [];
    const rawEdges = [];
    const screenNodeKeyById = new Map();

    // 1. Build conceptual Screen nodes from each visual screen's scene graph
    for (const s of screens) {
      const sNodeKey = slugify(`screen-${s.name || s.key}`, `screen-${s.id}`);
      screenNodeKeyById.set(Number(s.id), sNodeKey);
      const sNodes = s.nodes || nodesOf('screen', s.id) || [];
      const texts = sNodes.filter(n => n.tag === 'text' && n.text).map(n => String(n.text).trim()).filter(Boolean).slice(0, 8);
      const fields = sNodes.filter(n => n.role === 'field' || n.attrs?.['data-input-type']);
      const placedButtons = sNodes.filter(n => (n.kind === 'instance' && n.refType === 'button') || n.role === 'button');
      const placedElements = sNodes.filter(n => n.kind === 'instance' && n.refType === 'element');

      const summaryParts = [];
      if (s.descriptionDev) summaryParts.push(s.descriptionDev);
      if (texts.length) summaryParts.push(`Visible headings/copy: ${texts.map(t => `"${t}"`).join(', ')}.`);
      if (fields.length) {
        summaryParts.push(`Form inputs (${fields.length}): ${fields.map(f => `${f.name || 'field'} (${f.attrs?.['data-input-type'] || 'text'}${f.attrs?.['data-required'] ? ', required' : ''})`).join(', ')}.`);
      }
      if (placedElements.length) {
        const elNames = placedElements.map(pe => {
          try { return this.services.element?.get(pe.refId)?.name || pe.name; } catch { return pe.name; }
        }).filter(Boolean);
        if (elNames.length) summaryParts.push(`Embedded UI elements: ${[...new Set(elNames)].join(', ')}.`);
      }

      const routes = collectScreenRoutes(s.id, { nodesOf, menuOf }).filter(r => screenIdSet.has(Number(r.toScreenId)));
      const ports = [];
      const usedPortKeys = new Set();
      for (const r of routes) {
        const dstScreen = screens.find(x => Number(x.id) === Number(r.toScreenId));
        const pLabel = r.name || (dstScreen ? `Go to ${dstScreen.name}` : 'Navigate');
        const pKey = uniqueKey(slugify(pLabel, 'nav'), k => usedPortKeys.has(k));
        usedPortKeys.add(pKey);
        ports.push({
          key: pKey,
          label: pLabel,
          kind: 'menu-item',
          description: `Routes user via ${r.trigger || 'tap'} to "${dstScreen?.name || r.toScreenId}".`
        });
        rawEdges.push({
          fromNodeKey: sNodeKey,
          fromPortKey: pKey,
          toNodeKey: slugify(`screen-${dstScreen?.name || dstScreen?.key || r.toScreenId}`, `screen-${r.toScreenId}`),
          toPortKey: HOME_PORT_KEY,
          label: pLabel,
          transitionText: `User triggers "${pLabel}" (${r.trigger || 'tap'}) on "${s.name}" and transitions to "${dstScreen?.name || r.toScreenId}".`
        });
      }

      // If screen has form fields + submit button and includeBackendSteps is enabled, synthesize a Validation Decision + API Step
      if (includeBackendSteps && fields.length > 0) {
        const submitPortKey = uniqueKey('submit-form', k => usedPortKeys.has(k));
        usedPortKeys.add(submitPortKey);
        ports.push({
          key: submitPortKey,
          label: 'Submit Form',
          kind: 'submit',
          description: `Submits ${fields.length} input field(s) for validation and backend processing.`
        });
        const stepKey = `${sNodeKey}-api-step`;
        const decKey = `${sNodeKey}-validation-check`;
        rawNodes.push({
          nodeKey: decKey,
          kind: 'decision',
          subtype: 'validation-branch',
          title: `Validate ${s.name} Inputs`,
          description: `Validates ${fields.map(f => f.name || 'input').join(', ')} before calling backend handler.`,
          ports: [
            { key: 'valid', label: 'Valid Payload', kind: 'case', description: 'All required fields pass client & schema validation.' },
            { key: 'invalid', label: 'Validation Error', kind: 'case', description: 'Shows inline field errors on the screen.' }
          ]
        });
        rawNodes.push({
          nodeKey: stepKey,
          kind: 'step',
          subtype: 'api-endpoint',
          title: `Process ${s.name} Submission`,
          description: `Backend endpoint handling submitted data from "${s.name}", persisting state and returning result.`,
          techSpec: {
            method: 'POST',
            endpoint: `/api/${slugify(s.name, 'submit')}`,
            requestSchema: fields.map(f => `${f.name || 'field'}: ${f.attrs?.['data-input-type'] || 'string'}`).join(', ')
          },
          ports: [
            { key: 'ok', label: '200 OK', kind: 'api-next', description: 'Submission succeeded.' },
            { key: 'err', label: '4xx / 5xx Error', kind: 'error', description: 'Returns error toast/banner to screen.' }
          ]
        });
        rawEdges.push(
          {
            fromNodeKey: sNodeKey,
            fromPortKey: submitPortKey,
            toNodeKey: decKey,
            label: 'Submit',
            transitionText: 'Collects form field values and runs client-side validation.'
          },
          {
            fromNodeKey: decKey,
            fromPortKey: 'valid',
            toNodeKey: stepKey,
            label: 'Valid',
            transitionText: 'Sends validated JSON payload to backend API endpoint.'
          },
          {
            fromNodeKey: decKey,
            fromPortKey: 'invalid',
            toNodeKey: sNodeKey,
            label: 'Invalid',
            transitionText: 'Highlights invalid fields and focuses first error.'
          }
        );
      }

      if (!ports.length && placedButtons.length) {
        ports.push({
          key: 'action-1',
          label: placedButtons[0].text || placedButtons[0].name || 'User Action',
          kind: 'button',
          description: 'Interactive button placed on this screen.'
        });
      }

      rawNodes.unshift({
        nodeKey: sNodeKey,
        kind: 'screen',
        subtype: 'ui-screen',
        title: s.name,
        description: summaryParts.join('\n\n') || `Conceptual view reverse-engineered from screen "${s.name}" (${s.width}x${s.height}).`,
        linkedScreenId: s.id,
        ports
      });
    }

    // 2. Also incorporate explicit workflow links that weren't already covered by node routes
    const wfLinks = wf ? (wf.links || []) : (this.workflows ? this.workflows.linksFromScreens([...screenIdSet]) : []);
    for (const l of wfLinks) {
      const fromKey = screenNodeKeyById.get(Number(l.fromScreenId));
      const toKey = screenNodeKeyById.get(Number(l.toScreenId));
      if (!fromKey || !toKey) continue;
      const already = rawEdges.some(e => e.fromNodeKey === fromKey && e.toNodeKey === toKey);
      if (already) continue;
      const srcNode = rawNodes.find(n => n.nodeKey === fromKey);
      if (!srcNode) continue;
      const pKey = slugify(l.name || `to-${toKey}`, 'route');
      if (!srcNode.ports.some(p => p.key === pKey)) {
        srcNode.ports.push({ key: pKey, label: l.name || 'Navigate', kind: 'menu-item', description: l.descriptionDev || '' });
      }
      rawEdges.push({
        fromNodeKey: fromKey,
        fromPortKey: pKey,
        toNodeKey: toKey,
        label: l.name || '',
        transitionText: l.descriptionDev || `Navigates via workflow link (${l.trigger || 'tap'}).`
      });
    }

    const startKey = wf?.startScreenId && screenNodeKeyById.get(Number(wf.startScreenId))
      ? screenNodeKeyById.get(Number(wf.startScreenId))
      : rawNodes[0]?.nodeKey || null;

    return this.create({
      name: name || (wf ? `${wf.name} (Reverse-Engineered FlowChart)` : `${proj.name} App FlowChart`),
      description: description || `Reverse-engineered conceptual flowchart from ${screens.length} screen(s)${wf ? ` and workflow "${wf.name}"` : ''} in "${proj.name}".`,
      domain: includeBackendSteps ? 'fullstack' : 'frontend',
      projectId: pid,
      visibility,
      linkedWorkflowId: wf?.id ?? null,
      startNodeKey: startKey,
      nodes: rawNodes,
      edges: rawEdges,
      autoLayout: true
    }, { actor });
  }

  /**
   * Reverse-engineers an external app descriptor (structured JSON or plain-text route/architecture summary)
   * into a conceptual FlowChart. Allows AI coding agents or developers to import existing codebases into FlowCharts.
   */
  reverseEngineerFromAppSpec(input = {}, { actor = null } = {}) {
    const pid = Number(input.projectId) || 1;
    const rawNodes = [];
    const rawEdges = [];

    // Structured arrays (`screens`, `steps`, `endpoints`, `decisions`, `triggers`, `transitions`)
    for (const t of input.triggers || []) {
      rawNodes.push({
        nodeKey: t.key || t.nodeKey || slugify(t.title || t.name || 'trigger', 'trigger'),
        kind: 'trigger',
        subtype: t.subtype || 'app-start',
        title: t.title || t.name || 'App Entry',
        description: t.description || ''
      });
    }
    for (const s of input.screens || []) {
      rawNodes.push({
        nodeKey: s.key || s.nodeKey || slugify(s.title || s.name || 'screen', 'screen'),
        kind: 'screen',
        subtype: s.subtype || 'ui-screen',
        title: s.title || s.name || 'Screen',
        description: s.description || [s.route ? `Route: ${s.route}` : '', s.components ? `Components: ${Array.isArray(s.components) ? s.components.join(', ') : s.components}` : ''].filter(Boolean).join('\n'),
        ports: (s.menuItems || s.actions || s.ports || []).map(a => (typeof a === 'string' ? { label: a, kind: 'menu-item' } : a)),
        roleSettings: s.roleSettings || (s.roles ? { allowedRoles: s.roles, variants: s.roleVariants || {} } : undefined),
        techSpec: { endpoint: s.route || '', uiLayoutHint: s.layoutHint || '' }
      });
    }
    for (const ep of [...(input.endpoints || []), ...(input.steps || [])]) {
      const method = (ep.method || '').toUpperCase();
      rawNodes.push({
        nodeKey: ep.key || ep.nodeKey || slugify(ep.title || ep.name || `${method}-${ep.path || ep.endpoint || 'step'}`, 'step'),
        kind: 'step',
        subtype: ep.subtype || (ep.path || ep.endpoint || method ? 'api-endpoint' : 'business-rule'),
        title: ep.title || ep.name || `${method || 'STEP'} ${ep.path || ep.endpoint || ''}`.trim(),
        description: ep.description || ep.logic || '',
        ports: ep.ports || undefined,
        roleSettings: ep.roleSettings || (ep.roles ? { allowedRoles: ep.roles } : undefined),
        techSpec: {
          method,
          endpoint: ep.path || ep.endpoint || '',
          authRequired: ep.authRequired,
          requestSchema: ep.requestSchema || ep.request || '',
          responseSchema: ep.responseSchema || ep.response || '',
          dbTables: ep.dbTables || []
        }
      });
    }
    for (const d of input.decisions || []) {
      rawNodes.push({
        nodeKey: d.key || d.nodeKey || slugify(d.title || d.name || 'decision', 'decision'),
        kind: 'decision',
        subtype: d.subtype || 'scenario-switch',
        title: d.title || d.name || 'Decision',
        description: d.description || '',
        ports: (d.cases || d.ports || []).map(c => (typeof c === 'string' ? { label: c, kind: 'case' } : { ...c, kind: 'case' }))
      });
    }
    for (const tr of input.transitions || input.edges || input.flows || []) {
      rawEdges.push({
        fromNodeKey: slugify(tr.fromNodeKey || tr.from || '', 'node'),
        fromPortKey: slugify(tr.fromPortKey || tr.port || tr.action || 'out', 'out'),
        fromPortLabel: tr.port || tr.action || tr.label || '',
        toNodeKey: slugify(tr.toNodeKey || tr.to || '', 'node'),
        label: tr.label || tr.action || '',
        transitionText: tr.transitionText || tr.description || '',
        conditionExpr: tr.condition || tr.conditionExpr || '',
        roleSettings: tr.roles ? { allowedRoles: tr.roles } : tr.roleSettings
      });
    }

    // Also parse plain-text / Markdown route or flow lines if `rawText` is provided!
    // Supports lines like:
    //   Screen: Login (/login) - User enters email & password [roles: guest]
    //   API: POST /api/auth/login - Verifies credentials & issues session cookie
    //   Decision: Auth Valid? - Checks credentials
    //   Login --[Submit Credentials]--> POST /api/auth/login : Validates form and sends JSON
    if (typeof input.rawText === 'string' && input.rawText.trim()) {
      const nodeByLooseName = new Map(rawNodes.map(n => [slugify(n.title, 'node'), n.nodeKey]));
      const ensureLooseNode = (rawLabel, defaultKind = 'screen') => {
        const clean = rawLabel.trim();
        const loose = slugify(clean, defaultKind);
        if (nodeByLooseName.has(loose)) return nodeByLooseName.get(loose);
        const isApi = /^(GET|POST|PUT|PATCH|DELETE)\s+\//i.test(clean) || /^api:/i.test(clean) || /^step:/i.test(clean);
        const isDec = /\?$/.test(clean) || /^decision:/i.test(clean);
        const kind = isDec ? 'decision' : isApi ? 'step' : defaultKind;
        const title = clean.replace(/^(screen|step|api|decision):\s*/i, '').trim();
        const key = slugify(title, kind);
        rawNodes.push({
          nodeKey: key,
          kind,
          subtype: isApi ? 'api-endpoint' : isDec ? 'condition' : 'ui-screen',
          title,
          description: `Extracted from app specification: ${title}.`
        });
        nodeByLooseName.set(loose, key);
        nodeByLooseName.set(key, key);
        return key;
      };

      for (const rawLine of input.rawText.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/^[-*]\s+/, '');
        if (!line || line.startsWith('#')) continue;
        // Arrow line: A --[Port]--> B : transition text   OR   A -> B : transition text
        const arrowMatch = /^(.+?)\s*(?:--\[(.+?)\]-->|-->|->)\s*([^:]+?)(?:\s*:\s*(.+))?$/.exec(line);
        if (arrowMatch) {
          const [, lhs, portLbl, rhs, transTxt] = arrowMatch;
          const fromKey = ensureLooseNode(lhs);
          const toKey = ensureLooseNode(rhs);
          const pLabel = (portLbl || 'Next').trim();
          rawEdges.push({
            fromNodeKey: fromKey,
            fromPortKey: slugify(pLabel, 'next'),
            fromPortLabel: pLabel,
            toNodeKey: toKey,
            label: pLabel,
            transitionText: (transTxt || '').trim()
          });
          continue;
        }
        // Declaration line: Screen: Dashboard - Shows analytics
        const declMatch = /^(Screen|Page|Step|Action|API|Endpoint|Decision|Trigger)\s*:\s*([^-–—]+?)(?:\s+[-–—]\s+(.+))?$/i.exec(line);
        if (declMatch) {
          const [, kindWord, titlePart, descPart] = declMatch;
          const kw = kindWord.toLowerCase();
          const kind = kw === 'decision' ? 'decision' : kw === 'trigger' ? 'trigger' : (kw === 'screen' || kw === 'page') ? 'screen' : 'step';
          const title = titlePart.trim();
          const key = slugify(title, kind);
          if (!rawNodes.some(n => n.nodeKey === key)) {
            rawNodes.push({
              nodeKey: key,
              kind,
              subtype: (kw === 'api' || kw === 'endpoint') ? 'api-endpoint' : kind === 'screen' ? 'ui-screen' : 'business-rule',
              title,
              description: (descPart || '').trim()
            });
            nodeByLooseName.set(key, key);
          }
        }
      }
    }

    if (!rawNodes.length) {
      throw new ValidationError('reverseEngineerFromAppSpec requires screens, steps/endpoints, decisions, transitions, or non-empty rawText');
    }

    return this.create({
      name: input.name || 'Reverse-Engineered App FlowChart',
      description: input.description || 'Conceptual flowchart reverse-engineered from application architecture and route specifications.',
      domain: input.domain || 'fullstack',
      accessLevels: input.accessLevels || DEFAULT_ACCESS_LEVELS,
      spec: input.spec || {},
      projectId: pid,
      visibility: input.visibility || 'project',
      nodes: rawNodes,
      edges: rawEdges,
      autoLayout: input.autoLayout !== false
    }, { actor });
  }

  /**
   * Compiles the complete Project-Definition documentation (`project-definition.md` + structured JSON)
   * covering Frontend UI screens, Backend & Business Logic steps, Decision matrices, Access-Level/Role matrices,
   * Transition flow contracts, and Linked Visual Library assets so any AI coding tool can recreate or implement the project.
   */
  buildProjectDefinition({
    projectId = 1,
    flowchartIds = null,
    onlyApproved = false,
    format = 'both'
  } = {}, { actor = null } = {}) {
    const pid = Number(projectId) || 1;
    const proj = this.#projectService()?.get?.(pid) || { id: pid, key: `project-${pid}`, name: `Project #${pid}`, description: '' };
    if (actor && this.#projectService()) {
      assertItemAccess({ projectId: pid, visibility: proj.visibility || 'project', creatorId: proj.ownerId || 1 }, actor, this.#projectService(), 'read', 'project');
    }

    let list = this.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false });
    if (Array.isArray(flowchartIds) && flowchartIds.length) {
      const want = new Set(flowchartIds.map(String));
      list = list.filter(f => want.has(String(f.id)) || want.has(f.key) || want.has(f.uid));
    }
    if (onlyApproved) list = list.filter(f => f.status === 'approved');
    const fullFlowcharts = list.map(f => this.get(f.id, { includeMermaid: true, includeValidation: true }));

    // Aggregate unified project-wide Access Levels
    const roleMap = new Map();
    for (const fc of fullFlowcharts) {
      for (const r of fc.accessLevels || []) {
        if (!roleMap.has(r.key)) roleMap.set(r.key, r);
      }
    }
    if (!roleMap.size) for (const r of DEFAULT_ACCESS_LEVELS) roleMap.set(r.key, r);
    const accessLevels = [...roleMap.values()];

    // Visual project assets inventory
    const screens = this.services?.screen ? this.services.screen.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false }) : [];
    const elements = this.services?.element ? this.services.element.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false }) : [];
    const buttons = this.services?.button ? this.services.button.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false }) : [];
    const workflows = this.workflows ? this.workflows.list({ projectId: pid, visibility: 'project', includePublic: false, includePrivate: false }) : [];

    const generatedAt = new Date().toISOString();
    const structured = {
      schemaVersion: '1.0.0',
      generatedAt,
      project: {
        id: proj.id,
        key: proj.key,
        name: proj.name,
        prefix: proj.settings?.prefix || null,
        description: proj.description || '',
        buttonStyle: proj.settings?.buttonStyle || 'circle',
        buttonIconSizePct: proj.settings?.buttonIconSizePct ?? 95
      },
      accessLevels,
      summary: {
        totalFlowcharts: fullFlowcharts.length,
        approvedFlowcharts: fullFlowcharts.filter(f => f.status === 'approved').length,
        conceptualScreens: fullFlowcharts.reduce((n, f) => n + f.nodes.filter(x => x.kind === 'screen').length, 0),
        backendAndLogicSteps: fullFlowcharts.reduce((n, f) => n + f.nodes.filter(x => x.kind === 'step').length, 0),
        decisionRouters: fullFlowcharts.reduce((n, f) => n + f.nodes.filter(x => x.kind === 'decision').length, 0),
        visualScreens: screens.length,
        visualElements: elements.length,
        visualButtons: buttons.length,
        visualWorkflows: workflows.length
      },
      flowcharts: fullFlowcharts.map(fc => ({
        uid: fc.uid,
        key: fc.key,
        name: fc.name,
        domain: fc.domain,
        status: fc.status,
        approvedAt: fc.approvedAt,
        approvalNote: fc.approvalNote,
        description: fc.description,
        spec: fc.spec,
        startNodeKey: fc.startNodeKey,
        linkedWorkflowId: fc.linkedWorkflowId,
        accessLevels: fc.accessLevels,
        mermaid: fc.mermaid,
        validation: fc.validation,
        nodes: fc.nodes,
        edges: fc.edges
      })),
      visualInventory: {
        screens: screens.map(s => ({ id: s.id, key: s.key, name: s.name, width: s.width, height: s.height, descriptionDev: s.descriptionDev })),
        elements: elements.map(e => ({ id: e.id, key: e.key, name: e.name, width: e.width, height: e.height, descriptionDev: e.descriptionDev })),
        buttons: buttons.map(b => ({ id: b.id, key: b.key, name: b.name, descriptionDev: b.descriptionDev })),
        workflows: workflows.map(w => ({ id: w.id, key: w.key, name: w.name, screenCount: w.screenCount, linkCount: w.linkCount }))
      }
    };

    // Build comprehensive Markdown blueprint (`project-definition.md`)
    const md = [];
    md.push(`# Project Definition: ${proj.name} (\`${proj.key}\`)`);
    md.push('');
    md.push(`> Generated by **Kyrpy UI/UX & FlowChart Designer** on \`${generatedAt}\`.`);
    md.push('> This document is the authoritative conceptual, UI/UX, access-control, and backend business-logic specification for AI coding agents and engineering teams.');
    md.push('');
    if (proj.description) {
      md.push('## 1. Project Overview');
      md.push('');
      md.push(proj.description);
      md.push('');
    } else {
      md.push('## 1. Project Overview');
      md.push('');
      md.push(`- **Project Key**: \`${proj.key}\`${proj.settings?.prefix ? ` · **Item Prefix**: \`${proj.settings.prefix}-\`` : ''}`);
      md.push(`- **FlowCharts**: ${structured.summary.totalFlowcharts} (${structured.summary.approvedFlowcharts} approved)`);
      md.push(`- **Conceptual Nodes**: ${structured.summary.conceptualScreens} Screen(s), ${structured.summary.backendAndLogicSteps} Backend/Logic Step(s), ${structured.summary.decisionRouters} Decision Router(s)`);
      md.push(`- **Visual UI Library**: ${screens.length} Screen(s), ${elements.length} Element(s), ${buttons.length} Button(s), ${workflows.length} Workflow(s)`);
      md.push('');
    }

    md.push('## 2. Access Levels & Role Matrix');
    md.push('');
    md.push('| Role Key | Display Name | Behavioral Scope & Permissions |');
    md.push('|---|---|---|');
    for (const r of accessLevels) {
      md.push(`| \`${r.key}\` | **${r.name}** | ${(r.description || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')} |`);
    }
    md.push('');

    md.push('## 3. Conceptual FlowCharts (Frontend, Backend & Business Logic)');
    md.push('');
    if (!fullFlowcharts.length) {
      md.push('_No conceptual flowcharts have been defined in this project yet._');
      md.push('');
    }

    fullFlowcharts.forEach((fc, idx) => {
      const numStr = `3.${idx + 1}`;
      const statusBadge = fc.status === 'approved' ? 'APPROVED' : fc.status === 'in_review' ? 'IN REVIEW' : 'DRAFT';
      md.push(`### ${numStr} ${fc.name} (\`${fc.key}\`) — [${statusBadge}] · Domain: \`${fc.domain}\``);
      md.push('');
      if (fc.description) {
        md.push(fc.description);
        md.push('');
      }
      if (fc.approvalNote) {
        md.push(`> **Approval Sign-Off Note**: ${fc.approvalNote}`);
        md.push('');
      }
      for (const [field, heading] of [
        ['overview', 'Architecture & Flow Overview'],
        ['businessRules', 'Domain & Business Rules'],
        ['dataModels', 'Data Models & Entities'],
        ['apiConventions', 'API & Event Contracts'],
        ['globalConstraints', 'Security & Invariant Constraints']
      ]) {
        if (fc.spec?.[field]) {
          md.push(`#### ${heading}`);
          md.push('');
          md.push(fc.spec[field]);
          md.push('');
        }
      }

      md.push('#### Flow Diagram');
      md.push('');
      md.push('```mermaid');
      md.push(fc.mermaid);
      md.push('```');
      md.push('');

      md.push('#### Nodes (Screens, Backend Steps & Decisions)');
      md.push('');
      const byKey = new Map(fc.nodes.map(n => [n.nodeKey, n]));
      const outEdgesByNode = new Map();
      for (const e of fc.edges) {
        if (!outEdgesByNode.has(e.fromNodeKey)) outEdgesByNode.set(e.fromNodeKey, []);
        outEdgesByNode.get(e.fromNodeKey).push(e);
      }

      for (const n of fc.nodes) {
        const isStart = fc.startNodeKey === n.nodeKey;
        const linkedScreen = n.linkedScreenId ? screens.find(s => Number(s.id) === Number(n.linkedScreenId)) : null;
        md.push(`##### [${n.kind.toUpperCase()}${n.subtype ? ` / ${n.subtype}` : ''}] ${n.title} (\`${n.nodeKey}\`)${isStart ? ' ★ START' : ''}`);
        md.push('');
        md.push(`- **Input Socket**: ${n.hasHomeInput ? `\`${HOME_PORT_KEY}\` (Home entry node)` : '_None (Entry Trigger)_'}`);
        if (linkedScreen) {
          md.push(`- **Linked Visual UI Screen**: \`${linkedScreen.key}\` ("${linkedScreen.name}", ${linkedScreen.width}×${linkedScreen.height})`);
        }
        if (n.roleSettings?.allowedRoles?.length) {
          md.push(`- **Allowed Access Levels**: \`${n.roleSettings.allowedRoles.join('`, `')}\` (when denied: \`${n.roleSettings.deniedBehavior}\`${n.roleSettings.redirectNodeKey ? ` -> \`${n.roleSettings.redirectNodeKey}\`` : ''})`);
        } else {
          md.push('- **Allowed Access Levels**: All roles');
        }
        md.push('');
        if (n.description) {
          md.push('**Specification**:');
          md.push('');
          md.push(n.description);
          md.push('');
        }

        // Technical contract if present
        const ts = n.techSpec || {};
        const techLines = [];
        if (ts.method || ts.endpoint) techLines.push(`- **Endpoint / Route**: \`${[ts.method, ts.endpoint].filter(Boolean).join(' ')}\``);
        if (ts.authRequired !== null && ts.authRequired !== undefined) techLines.push(`- **Auth Required**: \`${ts.authRequired}\``);
        if (ts.dbTables?.length) techLines.push(`- **Database Tables**: \`${ts.dbTables.join('`, `')}\``);
        if (ts.requestSchema) techLines.push(`- **Input / Request Payload**: ${ts.requestSchema}`);
        if (ts.responseSchema) techLines.push(`- **Output / Response Payload**: ${ts.responseSchema}`);
        if (ts.stateReads) techLines.push(`- **State Reads**: ${ts.stateReads}`);
        if (ts.stateWrites) techLines.push(`- **State Mutations**: ${ts.stateWrites}`);
        if (ts.eventsEmitted) techLines.push(`- **Events Emitted**: ${ts.eventsEmitted}`);
        if (ts.errorCases) techLines.push(`- **Error Handling**: ${ts.errorCases}`);
        if (ts.acceptanceCriteria) techLines.push(`- **Acceptance Criteria**: ${ts.acceptanceCriteria}`);
        if (techLines.length) {
          md.push('**Technical & Backend Contract**:');
          md.push('');
          md.push(...techLines);
          md.push('');
        }

        // Role-specific feature matrix on this screen/step
        const variants = n.roleSettings?.variants || {};
        if (Object.keys(variants).length) {
          md.push('**Role-Specific Feature Variations**:');
          md.push('');
          md.push('| Access Level | Screen / Step Behavior & Feature Differences |');
          md.push('|---|---|');
          for (const [rk, rv] of Object.entries(variants)) {
            const detail = [
              rv.summary,
              rv.addedFeatures ? `**Included**: ${rv.addedFeatures}` : '',
              rv.hiddenFeatures ? `**Excluded/Hidden**: ${rv.hiddenFeatures}` : '',
              rv.notes ? `_Note_: ${rv.notes}` : ''
            ].filter(Boolean).join(' · ').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
            md.push(`| \`${rk}\` | ${detail} |`);
          }
          md.push('');
        }

        // Output ports & outgoing transitions
        if (n.ports?.length) {
          md.push('**Output Nodes (Menu Items / Sub-Actions / Scenarios) & Transitions**:');
          md.push('');
          const nodeOutEdges = outEdgesByNode.get(n.nodeKey) || [];
          for (const p of n.ports) {
            const portEdges = nodeOutEdges.filter(e => e.fromPortKey === p.key);
            const roleNote = p.allowedRoles?.length ? ` _(Roles: ${p.allowedRoles.join(', ')}; denied: ${p.deniedBehavior})_` : '';
            md.push(`- **Port \`${p.key}\` — "${p.label}"** [\`${p.kind}\`]${roleNote}${p.description ? `: ${p.description}` : ''}`);
            for (const pe of portEdges) {
              const target = byKey.get(pe.toNodeKey);
              const cond = pe.conditionExpr ? ` [Condition: \`${pe.conditionExpr}\`]` : '';
              md.push(`  - **→ Transitions to \`${pe.toNodeKey}\` ("${target?.title || pe.toNodeKey}") Home**${cond}: ${pe.transitionText || pe.label || '_Direct transition_'}`);
            }
          }
          md.push('');
        }
      }
    });

    md.push('## 4. Visual UI Assets & Implementation Guidelines for AI Coders');
    md.push('');
    md.push('1. **Connect via MCP**: Call `uiux_list_flowcharts` and `uiux_get_flowchart` to inspect live conceptual workflows, role variants, and transition contracts.');
    md.push('2. **Materialize & Design UIs**: Once a flowchart is marked `approved`, call `uiux_materialize_flowchart` to create/sync visual `Screen` items and `Workflow` routes, then compose screens using `uiux_public_library`, `uiux_use_public_element`, `uiux_create_item`, and `uiux_update_item`.');
    md.push('3. **Implement Backend & Business Logic**: Implement every `step` (`api-endpoint`, `business-rule`, `db-operation`, `background-job`) and `decision` node faithfully according to its **Technical & Backend Contract** and **Transition Text** definitions.');
    md.push('4. **Enforce Access Levels**: Apply every node, port, and transition `allowedRoles` guard and per-role feature variation on both the UI layer and the backend API layer.');
    if (screens.length) {
      md.push('');
      md.push('### Linked Visual Screens in Project');
      md.push('');
      for (const s of screens) {
        md.push(`- \`${s.key}\` — **${s.name}** (${s.width}×${s.height})`);
      }
    }
    md.push('');

    const markdown = md.join('\n');
    const filenameBase = `${proj.key || 'project'}-project-definition`;
    if (format === 'markdown' || format === 'md') {
      return { filename: `${filenameBase}.md`, contentType: 'text/markdown; charset=utf-8', markdown };
    }
    if (format === 'json') {
      return { filename: `${filenameBase}.json`, contentType: 'application/json; charset=utf-8', definition: structured };
    }
    return {
      filename: `${filenameBase}.md`,
      jsonFilename: `${filenameBase}.json`,
      markdown,
      definition: structured
    };
  }
}
