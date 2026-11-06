/**
 * Canonical, id-free serialization of a design item (pure). The sha256 of this text is the item's
 * `content_hash`: equal on every instance and every project for the same visible content, so it can be
 * used for sync change detection and duplicate detection.
 *
 * Differs from `domain/doc-fingerprint.js` (the editor's dirty-state check), which includes numeric row ids.
 *
 * Left out on purpose: ids, uid, timestamps, project/visibility/ownership/lineage, builtin, position,
 * editor-only state (`locked`), content_hash and mcp_context (AI notes are not content).
 * References to other rows are written as the referenced row's `uid`; references to nodes are written
 * as the node's tree path (for example "0.2.1").
 */

/** JSON with object keys sorted at every depth, so equal data always gives equal text. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** Sorts a list by the canonical text of its entries (order-independent collections). */
const sortCanonical = list => list.map(v => [canonicalJson(v), v]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, v]) => v);

const json = text => {
  if (text === null || text === undefined || text === '') return null;
  if (typeof text !== 'string') return text;
  try { return JSON.parse(text); } catch { return text; }
};
const bool = v => Boolean(Number(v));
const num = v => (v === null || v === undefined ? null : Number(v));

/** Builds the nested node tree and a map node id → tree path. */
export function nodeTree(nodes) {
  const ids = new Set(nodes.map(n => n.id));
  const children = new Map();
  for (const n of nodes) {
    // a node whose parent row is missing is treated as a root, so nothing is silently dropped
    const p = n.parent_id != null && ids.has(n.parent_id) ? n.parent_id : null;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(n);
  }
  for (const list of children.values()) list.sort((a, b) => a.ord - b.ord || a.id - b.id);
  const pathOf = new Map();
  const walk = (parentId, prefix) => (children.get(parentId) || []).map((n, i) => {
    const path = prefix ? `${prefix}.${i}` : String(i);
    pathOf.set(n.id, path);
    return { node: n, children: walk(n.id, path) };
  });
  return { roots: walk(null, ''), pathOf };
}

function canonicalAnimation(a) {
  return [a.name, a.type, json(a.params), num(a.duration_ms), num(a.delay_ms), a.easing, a.iterations,
    a.direction, a.fill_mode, a.trigger, bool(a.enabled)];
}

function canonicalNodes(nodes, animations, uidOf) {
  const animsByNode = new Map();
  for (const a of animations) {
    if (!animsByNode.has(a.node_id)) animsByNode.set(a.node_id, []);
    animsByNode.get(a.node_id).push(canonicalAnimation(a));
  }
  const { roots, pathOf } = nodeTree(nodes);
  const emit = ({ node: n, children }) => [
    n.kind, n.tag, n.name, n.role ?? null,
    n.ref_type ?? null, n.ref_type && n.ref_id != null ? uidOf(n.ref_type, n.ref_id) : null,
    num(n.rotation), bool(n.visible), n.text ?? '', json(n.attrs), n.description_dev ?? '',
    json(n.on_click), json(n.events),
    sortCanonical(animsByNode.get(n.id) || []),
    children.map(emit)
  ];
  return { tree: roots.map(emit), pathOf };
}

function canonicalMenu(menuItems, uidOf) {
  const kids = new Map();
  for (const m of menuItems) {
    const p = m.parent_id ?? null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(m);
  }
  for (const list of kids.values()) list.sort((a, b) => a.ord - b.ord || a.id - b.id);
  const emit = m => [
    m.name, m.label, m.action, bool(m.visible ?? 1), m.description_dev ?? '',
    m.icon_id != null ? uidOf('icon', m.icon_id) : null,
    m.target_screen_id != null ? uidOf('screen', m.target_screen_id) : null,
    m.target_element_id != null ? uidOf('element', m.target_element_id) : null,
    (kids.get(m.id) || []).map(emit)
  ];
  return (kids.get(null) || []).map(emit);
}

/**
 * Canonical text of a path / icon / button / element / screen.
 * @param {{record, nodes, animations, menuItems}} d raw SQLite rows
 * @param {(type: string, id: number) => string|null} uidOf resolves a referenced row to its uid
 */
export function canonicalDesign({ record: r, nodes = [], animations = [], menuItems = [] }, uidOf) {
  return canonicalJson({
    r: [r.key, r.name, r.label, r.description_dev, r.category, json(r.tags), num(r.width), num(r.height), json(r.meta)],
    n: canonicalNodes(nodes, animations, uidOf).tree,
    m: canonicalMenu(menuItems, uidOf)
  });
}

/**
 * Canonical text of a workflow.
 * @param {{record, screens, links, screenNodes}} w  `screenNodes`: Map screen id → that screen's node rows
 */
export function canonicalWorkflow({ record: r, screens = [], links = [], screenNodes = new Map() }, uidOf) {
  const nodePath = (screenId, nodeId) => {
    if (nodeId == null) return null;
    const { pathOf } = nodeTree(screenNodes.get(screenId) || []);
    return pathOf.get(nodeId) ?? null;
  };
  return canonicalJson({
    r: [r.key, r.name, r.label, r.description_dev],
    s: screens.map(s => [uidOf('screen', s.screen_id), num(s.x), num(s.y), bool(s.collapsed)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    l: sortCanonical(links.map(l => [uidOf('screen', l.from_screen_id), nodePath(l.from_screen_id, l.from_node_id),
      uidOf('screen', l.to_screen_id), l.name, l.description_dev, l.style, l.trigger]))
  });
}

/** Canonical text of a flat record (themes, template_buttons, template_devices): every column except the excluded ones. */
const FLAT_EXCLUDED = new Set(['id', 'uid', 'content_hash', 'mcp_context', 'builtin', 'position', 'created_by', 'created_at', 'updated_at', 'locked']);
export function canonicalRecord(record) {
  const out = {};
  for (const [k, v] of Object.entries(record)) if (!FLAT_EXCLUDED.has(k)) out[k] = json(v);
  return canonicalJson(out);
}
