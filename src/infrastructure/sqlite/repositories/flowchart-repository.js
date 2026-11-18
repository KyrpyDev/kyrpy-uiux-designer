import { randomUUID } from 'node:crypto';
import { sqlSearch } from '../../../domain/search.js';
import { defaultOwnerId } from '../../../domain/system-users.js';
import {
  DEFAULT_ACCESS_LEVELS,
  FLOWCHART_NODE_KINDS,
  parseJsonSafe,
  normalizeAccessLevels,
  normalizeFlowchartSpec,
  normalizeRoleSettings,
  normalizeTechSpec
} from '../../../domain/flowchart.js';

const KIND_META = new Map(FLOWCHART_NODE_KINDS.map(k => [k.key, k]));

const toFlowchart = r => {
  if (!r) return null;
  const accessLevels = normalizeAccessLevels(r.access_levels_json);
  return {
    id: Number(r.id),
    uid: r.uid,
    key: r.key,
    name: r.name,
    label: r.label || '',
    description: r.description_dev || '',
    descriptionDev: r.description_dev || '',
    domain: r.domain || 'fullstack',
    status: r.status || 'draft',
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    approvalNote: r.approval_note || '',
    accessLevels,
    spec: normalizeFlowchartSpec(r.spec_json),
    startNodeKey: r.start_node_key ?? null,
    linkedWorkflowId: r.linked_workflow_id ?? null,
    projectId: r.project_id ?? 1,
    visibility: r.visibility || 'project',
    creatorId: r.creator_id ?? 1,
    clonedFromId: r.cloned_from_id ?? null,
    rootItemId: r.root_item_id ?? Number(r.id),
    rootOwnerId: r.root_owner_id ?? r.creator_id ?? 1,
    locked: Boolean(r.locked),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
};

const toFlowchartNode = r => {
  if (!r) return null;
  const kind = r.kind || 'screen';
  const meta = KIND_META.get(kind) || KIND_META.get('screen');
  const ports = parseJsonSafe(r.ports_json, []);
  return {
    id: Number(r.id),
    flowchartId: Number(r.flowchart_id),
    nodeKey: r.node_key,
    kind,
    subtype: r.subtype || '',
    title: r.title,
    description: r.description || '',
    x: Number(r.x ?? 80),
    y: Number(r.y ?? 80),
    width: Number(r.width ?? meta.defaultWidth),
    collapsed: Boolean(r.collapsed),
    locked: Boolean(r.locked),
    hasHomeInput: Boolean(meta.hasHomeInput),
    ports: Array.isArray(ports) ? ports : [],
    roleSettings: normalizeRoleSettings(r.role_settings_json),
    techSpec: normalizeTechSpec(r.tech_spec_json),
    linkedScreenId: r.linked_screen_id ?? null,
    linkedFlowchartId: r.linked_flowchart_id ?? null,
    ord: Number(r.ord ?? 0)
  };
};

const toFlowchartEdge = r => {
  if (!r) return null;
  const waypoints = parseJsonSafe(r.waypoints_json, []);
  return {
    id: Number(r.id),
    flowchartId: Number(r.flowchart_id),
    edgeKey: r.edge_key,
    fromNodeKey: r.from_node_key,
    fromPortKey: r.from_port_key || 'out',
    toNodeKey: r.to_node_key,
    toPortKey: r.to_port_key || 'home',
    label: r.label || '',
    transitionText: r.transition_text || '',
    conditionExpr: r.condition_expr || '',
    style: r.style || 'bezier',
    roleSettings: normalizeRoleSettings(r.role_settings_json),
    techSpec: normalizeTechSpec(r.tech_spec_json),
    waypoints: Array.isArray(waypoints) ? waypoints : [],
    ord: Number(r.ord ?? 0)
  };
};

export class FlowchartRepository {
  constructor(db, sync = null) {
    this.db = db;
    this.sync = sync;
  }

  count() {
    return Number(this.db.prepare('SELECT COUNT(*) AS n FROM flowcharts').get()?.n || 0);
  }

  uidOf(id) {
    try { return this.db.prepare('SELECT uid FROM flowcharts WHERE id = ?').get(Number(id))?.uid ?? null; }
    catch { return null; }
  }

  restoreUid(id, uid) {
    if (!uid) return false;
    try {
      return this.db.prepare('UPDATE flowcharts SET uid = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM flowcharts WHERE uid = ?)').run(uid, Number(id), uid).changes > 0;
    } catch { return false; }
  }

  idsOfProject(projectId, { projectOnly = false } = {}) {
    return this.db.prepare(`SELECT id FROM flowcharts WHERE project_id = ?${projectOnly ? " AND visibility = 'project'" : ''}`).all(Number(projectId)).map(r => r.id);
  }

  countPublicOf(projectId, creatorId) {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM flowcharts WHERE project_id = ? AND creator_id = ? AND visibility = 'public'").get(Number(projectId), Number(creatorId))?.n || 0);
  }

  setProjectVisibility(projectId, visibility) {
    return Number(this.db.prepare("UPDATE flowcharts SET visibility = ?, updated_at = datetime('now') WHERE project_id = ?").run(visibility, Number(projectId)).changes || 0);
  }

  list({
    q = '',
    domain = '',
    status = '',
    projectId = null,
    projectIds = null,
    visibility = '',
    creatorId = null,
    actorId = null,
    includePublic = true,
    includePrivate = true
  } = {}) {
    const where = [], args = [];
    const pIds = Array.isArray(projectIds) && projectIds.length
      ? projectIds.map(Number).filter(n => n > 0)
      : typeof projectIds === 'string' && projectIds.trim()
        ? projectIds.split(',').map(Number).filter(n => n > 0)
        : projectId != null && projectId !== ''
          ? [Number(projectId)]
          : [];
    const effUserId = creatorId != null && creatorId !== ''
      ? Number(creatorId)
      : (actorId != null && actorId !== '' ? Number(actorId) : null);

    if (q) {
      const m = sqlSearch(q, ['f.key', 'f.name', 'f.label', 'f.description_dev', 'f.domain']);
      if (m.sql) { where.push(m.sql); args.push(...m.args); }
    }
    if (domain && domain !== 'all') { where.push('f.domain = ?'); args.push(String(domain)); }
    if (status && status !== 'all') { where.push('f.status = ?'); args.push(String(status)); }

    const vis = visibility === 'all' ? '' : visibility;
    if (vis) {
      where.push('f.visibility = ?'); args.push(vis);
      if (vis === 'project' && pIds.length) {
        where.push(`f.project_id IN (${pIds.map(() => '?').join(',')})`);
        args.push(...pIds);
      } else if (vis === 'private' && effUserId) {
        where.push('f.creator_id = ?');
        args.push(effUserId);
      }
    } else if (pIds.length) {
      const ph = pIds.map(() => '?').join(',');
      const clauses = [`(f.visibility = 'project' AND f.project_id IN (${ph}))`];
      args.push(...pIds);
      if (includePublic !== false) clauses.push("f.visibility = 'public'");
      if (includePrivate !== false) {
        if (effUserId) { clauses.push("(f.visibility = 'private' AND f.creator_id = ?)"); args.push(effUserId); }
        else clauses.push("f.visibility = 'private'");
      }
      where.push(`(${clauses.join(' OR ')})`);
    } else if (actorId != null && actorId !== '' && (creatorId == null || creatorId === '')) {
      where.push("(f.visibility != 'private' OR f.creator_id = ?)");
      args.push(Number(actorId));
    }
    if (creatorId != null && creatorId !== '' && vis !== 'private') {
      where.push('f.creator_id = ?');
      args.push(Number(creatorId));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return this.db.prepare(`
      SELECT f.*,
        (SELECT COUNT(*) FROM flowchart_nodes n WHERE n.flowchart_id = f.id) AS node_count,
        (SELECT COUNT(*) FROM flowchart_edges e WHERE e.flowchart_id = f.id) AS edge_count
      FROM flowcharts f ${whereSql}
      ORDER BY f.updated_at DESC, f.name ASC
    `).all(...args).map(r => {
      const fc = toFlowchart(r);
      return {
        ...fc,
        nodeCount: Number(r.node_count || 0),
        edgeCount: Number(r.edge_count || 0),
        roleCount: fc.accessLevels.length
      };
    });
  }

  get(id) {
    return toFlowchart(this.db.prepare('SELECT * FROM flowcharts WHERE id = ?').get(Number(id)));
  }

  getByUid(uid) {
    return toFlowchart(this.db.prepare('SELECT * FROM flowcharts WHERE uid = ?').get(String(uid)));
  }

  getByKey(key, projectId = null) {
    return toFlowchart(
      this.db.prepare("SELECT * FROM flowcharts WHERE key = ? ORDER BY (project_id = ?) DESC, (visibility = 'public') DESC, id LIMIT 1")
        .get(String(key), projectId == null ? -1 : Number(projectId))
    );
  }

  find(ref, projectId = null) {
    if (ref === null || ref === undefined || ref === '') return null;
    const s = String(ref).trim();
    if (/^\d+$/.test(s)) return this.get(Number(s));
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return this.getByUid(s) || this.getByKey(s, projectId);
    return this.getByKey(s, projectId);
  }

  keyExists(key, projectId = null) {
    return projectId == null
      ? Boolean(this.db.prepare('SELECT 1 FROM flowcharts WHERE key = ?').get(String(key)))
      : Boolean(this.db.prepare('SELECT 1 FROM flowcharts WHERE key = ? AND project_id = ?').get(String(key), Number(projectId)));
  }

  create(fc, { id: explicitId = null, uid: explicitUid = null } = {}) {
    const creatorId = fc.creatorId ?? defaultOwnerId(this.db);
    const rootOwnerId = fc.rootOwnerId ?? creatorId;
    const useId = explicitId && !this.get(explicitId) ? Number(explicitId) : null;
    const uid = explicitUid && !this.getByUid(explicitUid) ? String(explicitUid) : randomUUID();
    const cols = [
      'uid', 'key', 'name', 'label', 'description_dev', 'domain', 'status',
      'approved_by', 'approved_at', 'approval_note',
      'access_levels_json', 'spec_json', 'start_node_key', 'linked_workflow_id',
      'project_id', 'visibility', 'creator_id', 'cloned_from_id', 'root_item_id', 'root_owner_id', 'locked'
    ];
    const vals = [
      uid,
      fc.key,
      fc.name,
      fc.label ?? '',
      fc.description ?? fc.descriptionDev ?? '',
      fc.domain || 'fullstack',
      fc.status || 'draft',
      fc.approvedBy ?? null,
      fc.approvedAt ?? null,
      fc.approvalNote ?? '',
      JSON.stringify(fc.accessLevels || DEFAULT_ACCESS_LEVELS),
      JSON.stringify(fc.spec || {}),
      fc.startNodeKey ?? null,
      fc.linkedWorkflowId ?? null,
      fc.projectId ?? 1,
      fc.visibility ?? 'project',
      creatorId,
      fc.clonedFromId ?? null,
      fc.rootItemId ?? null,
      rootOwnerId,
      fc.locked ? 1 : 0
    ];
    if (useId) { cols.unshift('id'); vals.unshift(useId); }
    const res = this.db.prepare(`INSERT INTO flowcharts (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
    const id = useId || Number(res.lastInsertRowid);
    if (fc.rootItemId == null) {
      this.db.prepare('UPDATE flowcharts SET root_item_id = ? WHERE id = ?').run(id, id);
    }
    const saved = this.get(id);
    this.sync?.enqueue('flowcharts', id, 'upsert', saved);
    return saved;
  }

  update(id, patch) {
    const scalarMap = {
      key: 'key',
      name: 'name',
      label: 'label',
      domain: 'domain',
      status: 'status',
      approvedBy: 'approved_by',
      approvedAt: 'approved_at',
      approvalNote: 'approval_note',
      startNodeKey: 'start_node_key',
      linkedWorkflowId: 'linked_workflow_id',
      projectId: 'project_id',
      visibility: 'visibility',
      creatorId: 'creator_id',
      clonedFromId: 'cloned_from_id',
      rootItemId: 'root_item_id',
      rootOwnerId: 'root_owner_id'
    };
    const sets = [], args = [];
    for (const [k, col] of Object.entries(scalarMap)) {
      if (patch[k] !== undefined) { sets.push(`${col} = ?`); args.push(patch[k]); }
    }
    if (patch.description !== undefined || patch.descriptionDev !== undefined) {
      sets.push('description_dev = ?');
      args.push(patch.description ?? patch.descriptionDev ?? '');
    }
    if (patch.accessLevels !== undefined) {
      sets.push('access_levels_json = ?');
      args.push(JSON.stringify(patch.accessLevels));
    }
    if (patch.spec !== undefined) {
      sets.push('spec_json = ?');
      args.push(JSON.stringify(patch.spec));
    }
    if (patch.locked !== undefined) {
      sets.push('locked = ?');
      args.push(patch.locked ? 1 : 0);
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      this.db.prepare(`UPDATE flowcharts SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    }
    const saved = this.get(id);
    this.sync?.enqueue('flowcharts', Number(id), 'upsert', saved);
    return saved;
  }

  touch(id) {
    this.db.prepare("UPDATE flowcharts SET updated_at = datetime('now') WHERE id = ?").run(Number(id));
    this.sync?.enqueue('flowcharts', Number(id), 'upsert');
  }

  delete(id) {
    const ok = this.db.prepare('DELETE FROM flowcharts WHERE id = ?').run(Number(id)).changes > 0;
    if (ok) this.sync?.enqueue('flowcharts', Number(id), 'delete', { id: Number(id) });
    return ok;
  }

  nodes(flowchartId) {
    return this.db.prepare('SELECT * FROM flowchart_nodes WHERE flowchart_id = ? ORDER BY ord ASC, id ASC')
      .all(Number(flowchartId))
      .map(toFlowchartNode);
  }

  edges(flowchartId) {
    return this.db.prepare('SELECT * FROM flowchart_edges WHERE flowchart_id = ? ORDER BY ord ASC, id ASC')
      .all(Number(flowchartId))
      .map(toFlowchartEdge);
  }

  replaceGraph(flowchartId, { nodes = [], edges = [] } = {}) {
    const fid = Number(flowchartId);
    this.db.prepare('DELETE FROM flowchart_edges WHERE flowchart_id = ?').run(fid);
    this.db.prepare('DELETE FROM flowchart_nodes WHERE flowchart_id = ?').run(fid);

    const insNode = this.db.prepare(`
      INSERT INTO flowchart_nodes (
        flowchart_id, node_key, kind, subtype, title, description,
        x, y, width, collapsed, locked, ports_json, role_settings_json, tech_spec_json,
        linked_screen_id, linked_flowchart_id, ord
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    nodes.forEach((n, idx) => {
      insNode.run(
        fid,
        n.nodeKey,
        n.kind || 'screen',
        n.subtype || '',
        n.title,
        n.description || '',
        Number(n.x ?? 80),
        Number(n.y ?? 80),
        Number(n.width ?? 300),
        n.collapsed ? 1 : 0,
        n.locked ? 1 : 0,
        JSON.stringify(n.ports || []),
        JSON.stringify(n.roleSettings || {}),
        JSON.stringify(n.techSpec || {}),
        n.linkedScreenId ?? null,
        n.linkedFlowchartId ?? null,
        Number(n.ord ?? idx)
      );
    });

    const insEdge = this.db.prepare(`
      INSERT INTO flowchart_edges (
        flowchart_id, edge_key, from_node_key, from_port_key, to_node_key, to_port_key,
        label, transition_text, condition_expr, style, role_settings_json, tech_spec_json, waypoints_json, ord
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    edges.forEach((e, idx) => {
      insEdge.run(
        fid,
        e.edgeKey,
        e.fromNodeKey,
        e.fromPortKey || 'out',
        e.toNodeKey,
        e.toPortKey || 'home',
        e.label || '',
        e.transitionText || '',
        e.conditionExpr || '',
        e.style || 'bezier',
        JSON.stringify(e.roleSettings || {}),
        JSON.stringify(e.techSpec || {}),
        JSON.stringify(e.waypoints || []),
        Number(e.ord ?? idx)
      );
    });
    this.touch(fid);
  }
}
