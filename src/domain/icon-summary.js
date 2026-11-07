/**
 * Icon summaries (pure, isomorphic): the node-less icon rows the library list ships when it holds thousands of
 * pack icons, plus a compact wire form that drops default values (`expandIconSummary` restores them).
 */

/** Pack of an icon: `meta.pack` (set by scripts/import-icon-packs.js) or a `pack-<name>` category; '' = built-in/user icon. */
export const iconPack = d => String(d?.meta?.pack || (String(d?.category || '').startsWith('pack-') ? String(d.category).slice(5) : '') || '');

/** Lightweight icon row: everything the UI filters and labels with, no nodes. */
export function iconSummary(d) {
  const pack = iconPack(d);
  return {
    id: d.id, key: d.key, name: d.name, label: d.label, category: d.category, tags: d.tags || [],
    width: d.width, height: d.height, visibility: d.visibility, creatorId: d.creatorId, rootOwnerId: d.rootOwnerId,
    projectId: d.projectId, builtin: !!d.builtin, locked: !!d.locked, meta: pack ? { pack } : {}
  };
}

/** Compact wire form of a summary (defaults omitted; `nodes` kept when present). */
export function compactIconSummary(s) {
  const pack = s.meta?.pack || '';
  const o = { id: s.id, key: s.key };
  if (s.name !== s.label) o.name = s.name;
  o.label = s.label;
  if (s.category) o.category = s.category;
  const tags = (s.tags || []).filter(t => t !== pack);
  if (tags.length) o.tags = tags;
  if (s.width !== 24) o.width = s.width;
  if (s.height !== 24) o.height = s.height;
  if (s.visibility !== 'public') o.visibility = s.visibility;
  o.creatorId = s.creatorId;
  if (s.rootOwnerId !== s.creatorId) o.rootOwnerId = s.rootOwnerId;
  if (s.projectId !== 1) o.projectId = s.projectId;
  if (s.builtin) o.builtin = 1;
  if (s.locked) o.locked = 1;
  if (pack && s.category !== `pack-${pack}`) o.pack = pack;
  if (s.nodes) o.nodes = s.nodes;
  return o;
}

/** Inverse of compactIconSummary; idempotent on an already expanded summary. */
export function expandIconSummary(o) {
  const pack = o.pack || o.meta?.pack || (String(o.category || '').startsWith('pack-') ? String(o.category).slice(5) : '');
  const tags = Array.isArray(o.tags) ? o.tags : [];
  const s = {
    id: o.id, key: o.key, name: o.name ?? o.label, label: o.label ?? o.name, category: o.category || '',
    tags: pack && !tags.includes(pack) ? [...tags, pack] : tags,
    width: o.width ?? 24, height: o.height ?? 24, visibility: o.visibility || 'public',
    creatorId: o.creatorId ?? 1, rootOwnerId: o.rootOwnerId ?? o.creatorId ?? 1, projectId: o.projectId ?? 1,
    builtin: !!o.builtin, locked: !!o.locked, meta: pack ? { pack } : {}
  };
  if (o.nodes) s.nodes = o.nodes;
  return s;
}
