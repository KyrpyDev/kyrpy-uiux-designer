/**
 * Pure domain model for Conceptual FlowChart Designer (Frontend, Backend, Full-Stack & Business Logic).
 * Shared between the Node.js backend, MCP tools, and the browser canvas (`/domain/flowchart.js`).
 * Zero external or Node-only imports.
 */
import { ValidationError } from './errors.js';
import { isValidKey, slugify, uniqueKey } from './naming.js';

export const FLOWCHART_DOMAINS = [
  { key: 'fullstack', label: 'Full-Stack (UI + Backend)', badge: 'Full-Stack' },
  { key: 'frontend', label: 'Frontend Screens & UX Flow', badge: 'Frontend' },
  { key: 'backend', label: 'Backend API & Services', badge: 'Backend' },
  { key: 'business-logic', label: 'Business Rules & Domain Logic', badge: 'Business Logic' },
  { key: 'auth-acl', label: 'Auth, Roles & Access Control', badge: 'Auth & ACL' }
];
const DOMAIN_SET = new Set(FLOWCHART_DOMAINS.map(d => d.key));

export const FLOWCHART_STATUSES = ['draft', 'in_review', 'approved'];
const STATUS_SET = new Set(FLOWCHART_STATUSES);

export const FLOWCHART_NODE_KINDS = [
  { key: 'screen', label: 'Screen / UI View', color: '#2e9bff', hasHomeInput: true, defaultWidth: 300 },
  { key: 'step', label: 'Step / Action / Logic', color: '#10b981', hasHomeInput: true, defaultWidth: 300 },
  { key: 'decision', label: 'Decision / Scenario Router', color: '#f59e0b', hasHomeInput: true, defaultWidth: 280 },
  { key: 'trigger', label: 'Trigger / Entry Point', color: '#8b5cf6', hasHomeInput: false, defaultWidth: 260 },
  { key: 'subflow', label: 'Sub-Flowchart Link', color: '#6366f1', hasHomeInput: true, defaultWidth: 280 },
  { key: 'end', label: 'End / Terminal Response', color: '#f43f5e', hasHomeInput: true, defaultWidth: 240 }
];
const KIND_MAP = new Map(FLOWCHART_NODE_KINDS.map(k => [k.key, k]));

export const FLOWCHART_SUBTYPES = {
  screen: ['ui-screen', 'modal-dialog', 'drawer-sheet', 'tab-view', 'onboarding', 'settings-page', 'admin-panel'],
  step: ['ui-action', 'api-endpoint', 'business-rule', 'db-operation', 'validation', 'state-mutation', 'background-job', 'webhook', 'external-service'],
  decision: ['condition', 'scenario-switch', 'auth-guard', 'role-gate', 'validation-branch', 'error-router', 'ab-variant'],
  trigger: ['app-start', 'route-visit', 'user-gesture', 'webhook-in', 'cron-schedule', 'event-bus', 'deep-link'],
  subflow: ['flowchart-call', 'async-pipeline', 'shared-auth-flow'],
  end: ['complete', 'http-response', 'redirect-external', 'abort-error']
};

export const PORT_KINDS = ['menu-item', 'button', 'action', 'submit', 'case', 'api-next', 'error', 'event'];
export const EDGE_STYLES = ['bezier', 'orthogonal', 'straight'];
export const DENIED_BEHAVIORS = ['hide', 'disable', 'redirect', '403-error', 'login-prompt', 'upsell-modal'];
export const HOME_PORT_KEY = 'home';

export const DEFAULT_ACCESS_LEVELS = [
  { key: 'guest', name: 'Guest (Public)', color: '#94a3b8', description: 'Unauthenticated visitor; sees public pages, sign-in/sign-up prompts, and read-only previews.' },
  { key: 'user', name: 'Standard User', color: '#2e9bff', description: 'Authenticated end-user; accesses core app screens, personal data, and standard workflows.' },
  { key: 'pro', name: 'Pro / Member', color: '#a855f7', description: 'Subscribed or verified member; unlocks premium actions, higher quotas, and advanced tools.' },
  { key: 'editor', name: 'Editor / Moderator', color: '#10b981', description: 'Collaborator or moderator; can review content, manage shared items, and run operational steps.' },
  { key: 'admin', name: 'Admin', color: '#f59e0b', description: 'Administrator; sees admin controls, user/ACL management, audit logs, and system overrides.' }
];

const str = (v, fb = '', max = 20000) => String(v ?? fb).slice(0, max);
const trim = (v, fb = '', max = 500) => String(v ?? fb).trim().slice(0, max);
const num = (v, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const posIntOrNull = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function parseJsonSafe(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return fallback; }
}

export function normalizeAccessLevels(raw) {
  const arr = parseJsonSafe(raw, null);
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_ACCESS_LEVELS.map(r => ({ ...r }));
  const seen = new Set();
  const out = [];
  for (const item of arr.slice(0, 30)) {
    if (!item || typeof item !== 'object') continue;
    const key = slugify(item.key || item.name || 'role', 'role').slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      name: trim(item.name || key, key, 80),
      color: trim(item.color || '#2e9bff', '#2e9bff', 24),
      description: str(item.description, '', 2000),
      inheritsFrom: item.inheritsFrom ? slugify(item.inheritsFrom, 'role').slice(0, 40) : null
    });
  }
  return out.length ? out : DEFAULT_ACCESS_LEVELS.map(r => ({ ...r }));
}

export function defaultPortsForKind(kind = 'screen', subtype = '') {
  if (kind === 'end') return [];
  if (kind === 'trigger') {
    return [{ key: 'out', label: 'Start Flow', kind: 'event', description: 'Fires when the entry trigger occurs.', allowedRoles: [], deniedBehavior: 'hide' }];
  }
  if (kind === 'decision') {
    return [
      { key: 'case-true', label: 'Yes / Match', kind: 'case', description: 'When the condition or scenario matches.', allowedRoles: [], deniedBehavior: 'hide' },
      { key: 'case-false', label: 'No / Fallback', kind: 'case', description: 'When the condition does not match or falls back.', allowedRoles: [], deniedBehavior: 'hide' }
    ];
  }
  if (kind === 'step') {
    if (subtype === 'api-endpoint' || subtype === 'db-operation' || subtype === 'external-service') {
      return [
        { key: 'success', label: '200 OK / Success', kind: 'api-next', description: 'Operation succeeded and returned expected payload.', allowedRoles: [], deniedBehavior: 'hide' },
        { key: 'error', label: 'Error / Exception', kind: 'error', description: 'Validation error, network failure, or rejected request.', allowedRoles: [], deniedBehavior: 'hide' }
      ];
    }
    return [
      { key: 'next', label: 'Next Step', kind: 'action', description: 'Proceeds after completing this step.', allowedRoles: [], deniedBehavior: 'hide' }
    ];
  }
  if (kind === 'subflow') {
    return [
      { key: 'done', label: 'Sub-Flow Complete', kind: 'action', description: 'Continues when the linked sub-flowchart finishes.', allowedRoles: [], deniedBehavior: 'hide' },
      { key: 'cancelled', label: 'Cancelled / Error', kind: 'error', description: 'Handles sub-flow cancellation or failure.', allowedRoles: [], deniedBehavior: 'hide' }
    ];
  }
  // default: screen
  return [
    { key: 'primary-action', label: 'Primary Action', kind: 'button', description: 'Main CTA or primary submit action on this screen.', allowedRoles: [], deniedBehavior: 'hide' },
    { key: 'menu-nav', label: 'Menu / Navigation', kind: 'menu-item', description: 'Navigation menu item or secondary screen route.', allowedRoles: [], deniedBehavior: 'hide' }
  ];
}

export function normalizePort(raw, index = 0, existingKeys = new Set(), defaultKind = 'menu-item') {
  const obj = typeof raw === 'string' ? { label: raw } : (raw || {});
  const label = trim(obj.label || obj.name || `Option ${index + 1}`, `Option ${index + 1}`, 120);
  const baseKey = slugify(obj.key || label, `port-${index + 1}`).slice(0, 60);
  const key = existingKeys.has(baseKey) ? uniqueKey(baseKey, k => existingKeys.has(k)) : baseKey;
  existingKeys.add(key);
  const kind = PORT_KINDS.includes(obj.kind) ? obj.kind : defaultKind;
  const allowedRoles = Array.isArray(obj.allowedRoles)
    ? [...new Set(obj.allowedRoles.map(r => slugify(r, 'role')).filter(Boolean))]
    : [];
  const deniedBehavior = DENIED_BEHAVIORS.includes(obj.deniedBehavior) ? obj.deniedBehavior : 'hide';
  return {
    key,
    label,
    kind,
    description: str(obj.description, '', 4000),
    allowedRoles,
    deniedBehavior,
    payloadHint: str(obj.payloadHint, '', 1000),
    icon: trim(obj.icon || '', '', 60)
  };
}

export function normalizeRoleSettings(raw) {
  const obj = parseJsonSafe(raw, {}) || {};
  const allowedRoles = Array.isArray(obj.allowedRoles)
    ? [...new Set(obj.allowedRoles.map(r => slugify(r, 'role')).filter(Boolean))]
    : [];
  const deniedBehavior = DENIED_BEHAVIORS.includes(obj.deniedBehavior) ? obj.deniedBehavior : 'hide';
  const redirectNodeKey = trim(obj.redirectNodeKey || '', '', 80);
  const rawVariants = obj.variants && typeof obj.variants === 'object' && !Array.isArray(obj.variants) ? obj.variants : {};
  const variants = {};
  for (const [rk, rv] of Object.entries(rawVariants)) {
    if (!rv || typeof rv !== 'object') continue;
    const roleKey = slugify(rk, 'role').slice(0, 40);
    const summary = str(rv.summary ?? rv.description ?? '', '', 6000);
    const addedFeatures = str(rv.addedFeatures ?? '', '', 4000);
    const hiddenFeatures = str(rv.hiddenFeatures ?? '', '', 4000);
    const notes = str(rv.notes ?? '', '', 2000);
    if (summary || addedFeatures || hiddenFeatures || notes) {
      variants[roleKey] = { summary, addedFeatures, hiddenFeatures, notes };
    }
  }
  return { allowedRoles, deniedBehavior, redirectNodeKey, variants };
}

export function normalizeTechSpec(raw) {
  const obj = parseJsonSafe(raw, {}) || {};
  return {
    method: trim(obj.method || '', '', 16).toUpperCase(),
    endpoint: trim(obj.endpoint || obj.route || '', '', 260),
    authRequired: obj.authRequired === undefined ? null : Boolean(obj.authRequired),
    requestSchema: str(obj.requestSchema || obj.inputs || '', '', 6000),
    responseSchema: str(obj.responseSchema || obj.outputs || '', '', 6000),
    dbTables: Array.isArray(obj.dbTables)
      ? obj.dbTables.map(t => trim(t, '', 80)).filter(Boolean)
      : trim(obj.dbTables || '', '', 400).split(',').map(s => s.trim()).filter(Boolean),
    stateReads: str(obj.stateReads || '', '', 2000),
    stateWrites: str(obj.stateWrites || '', '', 2000),
    eventsEmitted: str(obj.eventsEmitted || '', '', 2000),
    errorCases: str(obj.errorCases || '', '', 4000),
    acceptanceCriteria: str(obj.acceptanceCriteria || '', '', 6000),
    uiLayoutHint: str(obj.uiLayoutHint || '', '', 3000)
  };
}

export function normalizeFlowchartSpec(raw) {
  const obj = parseJsonSafe(raw, {}) || {};
  return {
    overview: str(obj.overview || '', '', 12000),
    architectureNotes: str(obj.architectureNotes || '', '', 12000),
    businessRules: str(obj.businessRules || '', '', 12000),
    dataModels: str(obj.dataModels || '', '', 12000),
    apiConventions: str(obj.apiConventions || '', '', 8000),
    globalConstraints: str(obj.globalConstraints || '', '', 8000)
  };
}

export function normalizeFlowchartRecord(input = {}, { partial = false } = {}) {
  const out = {};
  if (!partial || input.name !== undefined) {
    const name = trim(input.name, '', 140);
    if (!name) throw new ValidationError('flowchart name is required');
    out.name = name;
  }
  if (!partial || input.key !== undefined) {
    const rawKey = input.key ? trim(input.key, '', 140) : slugify(out.name || input.name || 'flowchart', 'flowchart');
    if (!isValidKey(rawKey)) throw new ValidationError(`invalid flowchart key "${rawKey}"`);
    out.key = rawKey;
  }
  if (!partial || input.label !== undefined) out.label = trim(input.label ?? out.name ?? input.name ?? '', '', 200);
  if (!partial || input.description !== undefined || input.descriptionDev !== undefined) {
    out.description = str(input.description ?? input.descriptionDev ?? '', '', 20000);
  }
  if (!partial || input.domain !== undefined) {
    const dom = trim(input.domain || 'fullstack', 'fullstack', 40);
    if (!DOMAIN_SET.has(dom)) throw new ValidationError(`domain must be one of: ${[...DOMAIN_SET].join(', ')}`);
    out.domain = dom;
  }
  if (!partial || input.status !== undefined) {
    const st = trim(input.status || 'draft', 'draft', 24);
    if (!STATUS_SET.has(st)) throw new ValidationError(`status must be one of: ${FLOWCHART_STATUSES.join(', ')}`);
    out.status = st;
  }
  if (!partial || input.approvalNote !== undefined) out.approvalNote = str(input.approvalNote ?? '', '', 4000);
  if (input.approvedBy !== undefined || !partial) out.approvedBy = posIntOrNull(input.approvedBy);
  if (input.approvedAt !== undefined || !partial) out.approvedAt = input.approvedAt ? String(input.approvedAt) : null;
  if (!partial || input.accessLevels !== undefined) out.accessLevels = normalizeAccessLevels(input.accessLevels);
  if (!partial || input.spec !== undefined) out.spec = normalizeFlowchartSpec(input.spec);
  if (!partial || input.startNodeKey !== undefined) out.startNodeKey = input.startNodeKey ? trim(input.startNodeKey, '', 80) : null;
  if (!partial || input.linkedWorkflowId !== undefined) out.linkedWorkflowId = posIntOrNull(input.linkedWorkflowId);
  if (!partial || input.projectId !== undefined) out.projectId = Math.max(1, Math.trunc(num(input.projectId, 1)));
  if (!partial || input.visibility !== undefined) {
    const vis = trim(input.visibility || 'project', 'project', 20);
    if (!['public', 'private', 'project'].includes(vis)) throw new ValidationError('visibility must be public, private, or project');
    out.visibility = vis;
  }
  if (!partial || input.locked !== undefined) out.locked = Boolean(input.locked);
  if (input.creatorId !== undefined || !partial) out.creatorId = Math.max(1, Math.trunc(num(input.creatorId, 1)));
  if (input.clonedFromId !== undefined || !partial) out.clonedFromId = posIntOrNull(input.clonedFromId);
  if (input.rootItemId !== undefined || !partial) out.rootItemId = posIntOrNull(input.rootItemId);
  if (input.rootOwnerId !== undefined || !partial) out.rootOwnerId = Math.max(1, Math.trunc(num(input.rootOwnerId, out.creatorId ?? 1)));
  return out;
}

export function normalizeFlowchartNode(raw = {}, existingKeys = new Set(), index = 0) {
  const kind = KIND_MAP.has(raw.kind) ? raw.kind : 'screen';
  const meta = KIND_MAP.get(kind);
  const subtypes = FLOWCHART_SUBTYPES[kind] || [];
  const subtype = raw.subtype && subtypes.includes(raw.subtype) ? raw.subtype : (subtypes[0] || '');
  const title = trim(raw.title || raw.name || `${meta.label.split('/')[0].trim()} ${index + 1}`, `Node ${index + 1}`, 160);
  const baseKey = slugify(raw.nodeKey || raw.key || title, `${kind}-${index + 1}`).slice(0, 72);
  const nodeKey = existingKeys.has(baseKey) ? uniqueKey(baseKey, k => existingKeys.has(k)) : baseKey;
  existingKeys.add(nodeKey);

  const portKeys = new Set();
  const defaultPortKind = kind === 'decision' ? 'case' : kind === 'screen' ? 'menu-item' : 'action';
  const rawPorts = raw.ports !== undefined ? parseJsonSafe(raw.ports, []) : defaultPortsForKind(kind, subtype);
  const ports = Array.isArray(rawPorts)
    ? rawPorts.slice(0, 40).map((p, idx) => normalizePort(p, idx, portKeys, defaultPortKind))
    : [];

  return {
    nodeKey,
    kind,
    subtype,
    title,
    description: str(raw.description ?? raw.text ?? raw.descriptionDev ?? '', '', 20000),
    x: Math.round(num(raw.x, 80 + (index % 4) * 380)),
    y: Math.round(num(raw.y, 80 + Math.floor(index / 4) * 280)),
    width: Math.max(220, Math.min(640, Math.round(num(raw.width, meta.defaultWidth)))),
    collapsed: Boolean(raw.collapsed),
    locked: Boolean(raw.locked),
    hasHomeInput: meta.hasHomeInput,
    ports,
    roleSettings: normalizeRoleSettings(raw.roleSettings),
    techSpec: normalizeTechSpec(raw.techSpec),
    linkedScreenId: posIntOrNull(raw.linkedScreenId),
    linkedFlowchartId: posIntOrNull(raw.linkedFlowchartId),
    ord: Math.trunc(num(raw.ord, index))
  };
}

export function normalizeFlowchartEdge(raw = {}, existingKeys = new Set(), index = 0) {
  const fromNodeKey = trim(raw.fromNodeKey || raw.from || '', '', 80);
  const toNodeKey = trim(raw.toNodeKey || raw.to || '', '', 80);
  if (!fromNodeKey || !toNodeKey) throw new ValidationError('edge requires fromNodeKey and toNodeKey');
  const fromPortKey = trim(raw.fromPortKey || raw.fromPort || 'out', 'out', 80);
  const toPortKey = trim(raw.toPortKey || raw.toPort || HOME_PORT_KEY, HOME_PORT_KEY, 80);
  const baseKey = slugify(raw.edgeKey || raw.key || `${fromNodeKey}-${fromPortKey}-to-${toNodeKey}`, `edge-${index + 1}`).slice(0, 96);
  const edgeKey = existingKeys.has(baseKey) ? uniqueKey(baseKey, k => existingKeys.has(k)) : baseKey;
  existingKeys.add(edgeKey);
  const style = EDGE_STYLES.includes(raw.style) ? raw.style : 'bezier';
  const waypointsRaw = parseJsonSafe(raw.waypoints, []);
  const waypoints = Array.isArray(waypointsRaw)
    ? waypointsRaw.slice(0, 24).map(pt => ({ x: Math.round(num(pt?.x, 0)), y: Math.round(num(pt?.y, 0)) }))
    : [];

  return {
    edgeKey,
    fromNodeKey,
    fromPortKey,
    toNodeKey,
    toPortKey,
    label: trim(raw.label ?? raw.name ?? '', '', 160),
    transitionText: str(raw.transitionText ?? raw.description ?? raw.descriptionDev ?? '', '', 12000),
    conditionExpr: trim(raw.conditionExpr ?? raw.condition ?? '', '', 500),
    style,
    roleSettings: normalizeRoleSettings(raw.roleSettings),
    techSpec: normalizeTechSpec(raw.techSpec),
    waypoints,
    ord: Math.trunc(num(raw.ord, index))
  };
}

/**
 * Evaluates how a node behaves under a specific access level (`roleKey`).
 * When `roleKey` is falsy or `'all'`, returns unrestricted master view.
 */
export function resolveNodeForRole(node, roleKey) {
  if (!roleKey || roleKey === 'all') {
    return {
      accessible: true,
      restricted: Boolean(node.roleSettings?.allowedRoles?.length),
      deniedBehavior: node.roleSettings?.deniedBehavior || 'hide',
      effectiveDescription: node.description || '',
      variant: null,
      visiblePorts: node.ports || [],
      restrictedPorts: []
    };
  }
  const rs = node.roleSettings || { allowedRoles: [], deniedBehavior: 'hide', variants: {} };
  const accessible = !rs.allowedRoles?.length || rs.allowedRoles.includes(roleKey);
  const variant = rs.variants?.[roleKey] || null;
  const visiblePorts = [];
  const restrictedPorts = [];
  for (const p of node.ports || []) {
    const portAllowed = accessible && (!p.allowedRoles?.length || p.allowedRoles.includes(roleKey));
    if (portAllowed) visiblePorts.push(p);
    else restrictedPorts.push(p);
  }
  let effectiveDescription = node.description || '';
  if (variant) {
    const parts = [];
    if (variant.summary) parts.push(variant.summary);
    else if (node.description) parts.push(node.description);
    if (variant.addedFeatures) parts.push(`+ Role features: ${variant.addedFeatures}`);
    if (variant.hiddenFeatures) parts.push(`- Hidden for ${roleKey}: ${variant.hiddenFeatures}`);
    effectiveDescription = parts.join('\n');
  }
  return {
    accessible,
    restricted: Boolean(rs.allowedRoles?.length),
    deniedBehavior: rs.deniedBehavior || 'hide',
    effectiveDescription,
    variant,
    visiblePorts,
    restrictedPorts
  };
}

/**
 * Evaluates whether an edge is active for a specific access level.
 */
export function isEdgeAllowedForRole(edge, roleKey, nodesByKey = null) {
  if (!roleKey || roleKey === 'all') return true;
  const allowed = edge.roleSettings?.allowedRoles || [];
  if (allowed.length && !allowed.includes(roleKey)) return false;
  if (nodesByKey) {
    const src = nodesByKey.get(edge.fromNodeKey);
    const dst = nodesByKey.get(edge.toNodeKey);
    if (src) {
      const sr = resolveNodeForRole(src, roleKey);
      if (!sr.accessible) return false;
      const port = (src.ports || []).find(p => p.key === edge.fromPortKey);
      if (port?.allowedRoles?.length && !port.allowedRoles.includes(roleKey)) return false;
    }
    if (dst && !resolveNodeForRole(dst, roleKey).accessible) return false;
  }
  return true;
}

/**
 * Splits an existing connection edge by inserting a Decision node at its midpoint:
 *   `fromNode[fromPort] ──► Decision[home]`
 *   `Decision[case-1]   ──► originalTarget[home]`
 *   `Decision[case-2..N] ──► optional extra scenario targets`
 */
export function splitEdgeWithDecision(nodes = [], edges = [], edgeKey, {
  decisionTitle = 'Decision / Scenario Check',
  decisionDescription = 'Evaluates scenario or condition and routes the flow accordingly.',
  conditionExpr = '',
  cases = null
} = {}) {
  const targetEdge = edges.find(e => e.edgeKey === edgeKey);
  if (!targetEdge) throw new ValidationError(`edge "${edgeKey}" not found`);
  const srcNode = nodes.find(n => n.nodeKey === targetEdge.fromNodeKey);
  const dstNode = nodes.find(n => n.nodeKey === targetEdge.toNodeKey);
  const midX = Math.round(((srcNode?.x ?? 100) + (dstNode?.x ?? 500)) / 2);
  const midY = Math.round(((srcNode?.y ?? 100) + (dstNode?.y ?? 100)) / 2);

  const nodeKeys = new Set(nodes.map(n => n.nodeKey));
  const rawCases = Array.isArray(cases) && cases.length >= 2
    ? cases
    : [
        { key: 'case-1', label: targetEdge.label || 'Primary Scenario (Match)', description: targetEdge.transitionText || 'Proceeds to the primary target.', toNodeKey: targetEdge.toNodeKey },
        { key: 'case-2', label: 'Alternate Scenario / Fallback', description: 'Handles alternate case, validation failure, or branch.' }
      ];

  const decisionNode = normalizeFlowchartNode({
    kind: 'decision',
    subtype: 'scenario-switch',
    title: decisionTitle,
    description: decisionDescription,
    x: midX,
    y: midY,
    ports: rawCases.map((c, idx) => ({
      key: c.key || `case-${idx + 1}`,
      label: c.label || `Case ${idx + 1}`,
      kind: 'case',
      description: c.description || '',
      allowedRoles: c.allowedRoles || []
    })),
    techSpec: conditionExpr ? { acceptanceCriteria: `Condition: ${conditionExpr}` } : {}
  }, nodeKeys, nodes.length);

  const remainingEdges = edges.filter(e => e.edgeKey !== edgeKey);
  const edgeKeys = new Set(remainingEdges.map(e => e.edgeKey));

  // Incoming wire from original source port to Decision Home
  const incomingEdge = normalizeFlowchartEdge({
    fromNodeKey: targetEdge.fromNodeKey,
    fromPortKey: targetEdge.fromPortKey,
    toNodeKey: decisionNode.nodeKey,
    toPortKey: HOME_PORT_KEY,
    label: targetEdge.label ? `Check: ${targetEdge.label}` : '',
    transitionText: targetEdge.transitionText || 'Passes execution into decision router.',
    conditionExpr,
    style: targetEdge.style,
    roleSettings: targetEdge.roleSettings
  }, edgeKeys, remainingEdges.length);

  const outgoingEdges = [];
  rawCases.forEach((c, idx) => {
    const port = decisionNode.ports[idx];
    const destKey = idx === 0 ? (c.toNodeKey || targetEdge.toNodeKey) : c.toNodeKey;
    if (!destKey || !port) return;
    outgoingEdges.push(normalizeFlowchartEdge({
      fromNodeKey: decisionNode.nodeKey,
      fromPortKey: port.key,
      toNodeKey: destKey,
      toPortKey: c.toPortKey || HOME_PORT_KEY,
      label: port.label,
      transitionText: c.transitionText || c.description || (idx === 0 ? targetEdge.transitionText : ''),
      conditionExpr: c.conditionExpr || '',
      style: targetEdge.style,
      roleSettings: c.allowedRoles?.length ? { allowedRoles: c.allowedRoles } : undefined
    }, edgeKeys, remainingEdges.length + 1 + outgoingEdges.length));
  });

  // Nudge downstream target right if too close to the newly inserted decision node
  const nextNodes = nodes.map(n => {
    if (n.nodeKey === targetEdge.toNodeKey && n.x < midX + 310) {
      return { ...n, x: midX + 340 };
    }
    return n;
  });
  nextNodes.push(decisionNode);

  return {
    decisionNode,
    incomingEdge,
    outgoingEdges,
    nodes: nextNodes,
    edges: [...remainingEdges, incomingEdge, ...outgoingEdges]
  };
}

/**
 * Clean layered DAG layout (Left -> Right or Top -> Bottom), cycle-safe.
 */
export function autoLayoutFlowchart(nodes = [], edges = [], {
  direction = 'LR',
  startNodeKey = null,
  gapX = 400,
  gapY = 290,
  originX = 80,
  originY = 80,
  maxPerRank = 5
} = {}) {
  if (!nodes.length) return [];
  const byKey = new Map(nodes.map(n => [n.nodeKey, n]));
  const inDeg = new Map(nodes.map(n => [n.nodeKey, 0]));
  const adj = new Map(nodes.map(n => [n.nodeKey, []]));
  for (const e of edges) {
    if (!byKey.has(e.fromNodeKey) || !byKey.has(e.toNodeKey) || e.fromNodeKey === e.toNodeKey) continue;
    adj.get(e.fromNodeKey).push(e.toNodeKey);
    inDeg.set(e.toNodeKey, (inDeg.get(e.toNodeKey) || 0) + 1);
  }

  const level = new Map();
  const queue = [];
  if (startNodeKey && byKey.has(startNodeKey)) {
    level.set(startNodeKey, 0);
    queue.push(startNodeKey);
  }
  for (const n of nodes) {
    if (!level.has(n.nodeKey) && (n.kind === 'trigger' || (inDeg.get(n.nodeKey) || 0) === 0)) {
      level.set(n.nodeKey, 0);
      queue.push(n.nodeKey);
    }
  }
  if (!queue.length) {
    level.set(nodes[0].nodeKey, 0);
    queue.push(nodes[0].nodeKey);
  }

  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const curLv = level.get(cur) || 0;
    for (const nxt of adj.get(cur) || []) {
      if (!level.has(nxt)) {
        level.set(nxt, curLv + 1);
        queue.push(nxt);
      }
    }
  }
  // Any disconnected cycle components
  let maxLv = Math.max(0, ...level.values());
  for (const n of nodes) {
    if (!level.has(n.nodeKey)) {
      level.set(n.nodeKey, maxLv + 1);
    }
  }

  const groups = new Map();
  for (const n of nodes) {
    const lv = level.get(n.nodeKey) || 0;
    if (!groups.has(lv)) groups.set(lv, []);
    groups.get(lv).push(n);
  }

  const columns = [];
  for (const lv of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(lv);
    const colCount = Math.max(1, Math.ceil(list.length / maxPerRank));
    const perCol = Math.ceil(list.length / colCount);
    for (let c = 0; c < colCount; c++) {
      columns.push(list.slice(c * perCol, (c + 1) * perCol));
    }
  }
  const tallest = Math.max(1, ...columns.map(c => c.length));
  const coords = new Map();
  columns.forEach((col, colIdx) => {
    const offset = (tallest - col.length) / 2;
    col.forEach((n, rowIdx) => {
      if (direction === 'TB') {
        coords.set(n.nodeKey, {
          x: Math.round(originX + (rowIdx + offset) * gapX),
          y: Math.round(originY + colIdx * gapY)
        });
      } else {
        coords.set(n.nodeKey, {
          x: Math.round(originX + colIdx * gapX),
          y: Math.round(originY + (rowIdx + offset) * gapY)
        });
      }
    });
  });

  return nodes.map(n => {
    const pt = coords.get(n.nodeKey);
    return pt ? { ...n, x: pt.x, y: pt.y } : n;
  });
}

/**
 * Validates a flowchart graph for completeness, dangling references, decision branching, and AI-readiness.
 */
export function validateFlowchart(fc = {}) {
  const nodes = fc.nodes || [];
  const edges = fc.edges || [];
  const errors = [];
  const warnings = [];
  const byKey = new Map(nodes.map(n => [n.nodeKey, n]));
  const incomingCount = new Map(nodes.map(n => [n.nodeKey, 0]));
  const outgoingByNodePort = new Map();

  if (!nodes.length) {
    warnings.push({ code: 'EMPTY_FLOWCHART', message: 'Flowchart has no nodes yet.' });
  }

  for (const e of edges) {
    const src = byKey.get(e.fromNodeKey);
    const dst = byKey.get(e.toNodeKey);
    if (!src) {
      errors.push({ code: 'MISSING_SOURCE_NODE', edgeKey: e.edgeKey, message: `Connection "${e.edgeKey}" references missing source node "${e.fromNodeKey}".` });
      continue;
    }
    if (!dst) {
      errors.push({ code: 'MISSING_TARGET_NODE', edgeKey: e.edgeKey, message: `Connection "${e.edgeKey}" references missing target node "${e.toNodeKey}".` });
      continue;
    }
    if (dst.kind === 'trigger') {
      errors.push({ code: 'TRIGGER_HAS_INPUT', edgeKey: e.edgeKey, nodeKey: dst.nodeKey, message: `Trigger node "${dst.title}" cannot receive incoming Home connections.` });
    }
    const hasPort = (src.ports || []).some(p => p.key === e.fromPortKey);
    if (!hasPort) {
      errors.push({ code: 'MISSING_SOURCE_PORT', edgeKey: e.edgeKey, nodeKey: src.nodeKey, message: `Connection "${e.edgeKey}" references missing port "${e.fromPortKey}" on "${src.title}".` });
    }
    incomingCount.set(dst.nodeKey, (incomingCount.get(dst.nodeKey) || 0) + 1);
    const pk = `${src.nodeKey}:${e.fromPortKey}`;
    outgoingByNodePort.set(pk, (outgoingByNodePort.get(pk) || 0) + 1);
    if (!String(e.transitionText || '').trim()) {
      warnings.push({ code: 'EMPTY_TRANSITION_TEXT', edgeKey: e.edgeKey, message: `Transition from "${src.title}" -> "${dst.title}" has no textual flow description.` });
    }
  }

  for (const n of nodes) {
    if (!String(n.description || '').trim()) {
      warnings.push({ code: 'EMPTY_NODE_SPEC', nodeKey: n.nodeKey, message: `${n.kind} "${n.title}" has no textual definition.` });
    }
    const inc = incomingCount.get(n.nodeKey) || 0;
    const isStart = fc.startNodeKey ? fc.startNodeKey === n.nodeKey : false;
    if (n.kind !== 'trigger' && !isStart && nodes.length > 1 && inc === 0) {
      warnings.push({ code: 'ORPHAN_INPUT', nodeKey: n.nodeKey, message: `"${n.title}" has no incoming connection to its Home node (mark as Start node or connect an upstream output).` });
    }
    if (n.kind === 'decision') {
      const connectedCases = (n.ports || []).filter(p => (outgoingByNodePort.get(`${n.nodeKey}:${p.key}`) || 0) > 0);
      if ((n.ports || []).length < 2) {
        warnings.push({ code: 'DECISION_SINGLE_CASE', nodeKey: n.nodeKey, message: `Decision node "${n.title}" has fewer than 2 scenario ports.` });
      } else if (connectedCases.length < 2) {
        warnings.push({ code: 'DECISION_UNCONNECTED_BRANCH', nodeKey: n.nodeKey, message: `Decision node "${n.title}" has unconnected scenario branches (${connectedCases.length}/${n.ports.length} wired).` });
      }
    }
  }

  const valid = errors.length === 0;
  const readyForApproval = valid && nodes.length > 0;
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    screens: nodes.filter(n => n.kind === 'screen').length,
    steps: nodes.filter(n => n.kind === 'step').length,
    decisions: nodes.filter(n => n.kind === 'decision').length,
    triggers: nodes.filter(n => n.kind === 'trigger').length,
    subflows: nodes.filter(n => n.kind === 'subflow').length,
    ends: nodes.filter(n => n.kind === 'end').length,
    rolesConfigured: (fc.accessLevels || []).length
  };
  return { valid, readyForApproval, errors, warnings, stats };
}

/**
 * Generates a clean GitHub-Flavored Markdown Mermaid `flowchart LR` diagram from a flowchart.
 */
export function flowchartToMermaid(fc = {}, { roleKey = null } = {}) {
  const nodes = fc.nodes || [];
  const edges = fc.edges || [];
  const byKey = new Map(nodes.map(n => [n.nodeKey, n]));
  const safeId = k => `N_${String(k).replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const esc = s => String(s ?? '').replace(/"/g, "'").replace(/\r?\n/g, ' ').trim();

  const lines = ['flowchart LR'];
  for (const n of nodes) {
    const rv = resolveNodeForRole(n, roleKey);
    if (roleKey && roleKey !== 'all' && !rv.accessible && rv.deniedBehavior === 'hide') continue;
    const id = safeId(n.nodeKey);
    const lockTag = !rv.accessible ? ` [LOCKED: ${rv.deniedBehavior}]` : '';
    const label = esc(`${n.title}${lockTag}`);
    if (n.kind === 'decision') lines.push(`  ${id}{"${label}"}`);
    else if (n.kind === 'trigger' || n.kind === 'end') lines.push(`  ${id}(["${label}"])`);
    else if (n.kind === 'subflow') lines.push(`  ${id}[["${label}"]]`);
    else if (n.kind === 'step') lines.push(`  ${id}["[Step] ${label}"]`);
    else lines.push(`  ${id}["[Screen] ${label}"]`);
  }

  for (const e of edges) {
    if (!byKey.has(e.fromNodeKey) || !byKey.has(e.toNodeKey)) continue;
    if (!isEdgeAllowedForRole(e, roleKey, byKey)) continue;
    const src = byKey.get(e.fromNodeKey);
    const port = (src?.ports || []).find(p => p.key === e.fromPortKey);
    const edgeLabelParts = [];
    if (port?.label) edgeLabelParts.push(port.label);
    if (e.label && e.label !== port?.label) edgeLabelParts.push(e.label);
    if (e.transitionText) {
      const brief = e.transitionText.trim().split(/\r?\n/)[0].slice(0, 56);
      if (brief && !edgeLabelParts.includes(brief)) edgeLabelParts.push(brief);
    }
    const edgeLabel = esc(edgeLabelParts.join(' · '));
    if (edgeLabel) lines.push(`  ${safeId(e.fromNodeKey)} -->|"${edgeLabel}"| ${safeId(e.toNodeKey)}`);
    else lines.push(`  ${safeId(e.fromNodeKey)} --> ${safeId(e.toNodeKey)}`);
  }
  return lines.join('\n');
}

/**
 * Deterministic fingerprint for client dirty-state & undo/redo comparison.
 */
export function flowchartFingerprint(fc) {
  if (!fc) return '';
  return JSON.stringify({
    name: fc.name || '',
    label: fc.label || '',
    description: fc.description || '',
    domain: fc.domain || 'fullstack',
    status: fc.status || 'draft',
    approvalNote: fc.approvalNote || '',
    startNodeKey: fc.startNodeKey || null,
    linkedWorkflowId: fc.linkedWorkflowId || null,
    visibility: fc.visibility || 'project',
    accessLevels: fc.accessLevels || [],
    spec: fc.spec || {},
    nodes: (fc.nodes || []).map(n => ({
      nodeKey: n.nodeKey, kind: n.kind, subtype: n.subtype, title: n.title, description: n.description,
      x: Math.round(n.x || 0), y: Math.round(n.y || 0), width: Math.round(n.width || 300),
      collapsed: Boolean(n.collapsed), locked: Boolean(n.locked),
      ports: n.ports || [], roleSettings: n.roleSettings || {}, techSpec: n.techSpec || {},
      linkedScreenId: n.linkedScreenId || null, linkedFlowchartId: n.linkedFlowchartId || null
    })),
    edges: (fc.edges || []).map(e => ({
      edgeKey: e.edgeKey, fromNodeKey: e.fromNodeKey, fromPortKey: e.fromPortKey,
      toNodeKey: e.toNodeKey, toPortKey: e.toPortKey || HOME_PORT_KEY,
      label: e.label || '', transitionText: e.transitionText || '', conditionExpr: e.conditionExpr || '',
      style: e.style || 'bezier', roleSettings: e.roleSettings || {}, techSpec: e.techSpec || {},
      waypoints: e.waypoints || []
    }))
  });
}
