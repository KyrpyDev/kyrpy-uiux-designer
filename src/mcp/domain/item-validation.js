/**
 * Static checks of a proposed item (generation standards, doc §14) — pure, no I/O.
 * The database checks (references resolve, hierarchy, key free, duplicates) run in ChangesetService
 * through a rolled-back dry run, so both use exactly the core's own normalization.
 *
 * Item format = the uiux_get_item JSON format (references by uid/key, nodes with index/parentIndex).
 */
import { canonicalJson } from './content-hash.js';

export const ITEM_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
export const KEY_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const LIMITS = { itemBytes: 256 * 1024, nodes: 2000, opsPerChangeset: 500 };
const USER_FACING = ['button', 'element', 'screen'];
const SAFE_DATA_URL = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i;
const URL_ATTRS = new Set(['href', 'xlink:href', 'src']);
const BAD_TEXT = /<\s*(script|foreignobject|iframe|object|embed)\b/i;

const issue = (code, path, message) => ({ code, path, message });

/** Every `{type, uid|key}` reference in an item (node instances, menu targets, workflow screens). */
export function itemRefs(item) {
  const out = [];
  const add = (r, path) => { if (r && typeof r === 'object' && (r.uid || r.key)) out.push({ type: r.type, uid: r.uid || null, key: r.key || null, path }); };
  (item.nodes || []).forEach((n, i) => { if (n?.ref) add(n.ref, `nodes[${i}].ref`); });
  (item.menuItems || []).forEach((m, i) => {
    if (m?.icon) add({ type: 'icon', ...m.icon }, `menuItems[${i}].icon`);
    if (m?.targetScreen) add({ type: 'screen', ...m.targetScreen }, `menuItems[${i}].targetScreen`);
    if (m?.targetElement) add({ type: 'element', ...m.targetElement }, `menuItems[${i}].targetElement`);
  });
  (item.screens || []).forEach((s, i) => add({ type: 'screen', ...(s?.screen || {}) }, `screens[${i}].screen`));
  (item.links || []).forEach((l, i) => {
    add({ type: 'screen', ...(l?.from || {}) }, `links[${i}].from`);
    add({ type: 'screen', ...(l?.to || {}) }, `links[${i}].to`);
  });
  return out;
}

function checkAttrs(attrs, path, errors) {
  if (attrs === undefined || attrs === null) return;
  if (typeof attrs !== 'object' || Array.isArray(attrs)) { errors.push(issue('SCHEMA', path, 'attrs must be an object')); return; }
  for (const [k, v] of Object.entries(attrs)) {
    const val = String(v ?? '');
    if (/^on/i.test(k)) errors.push(issue('UNSAFE_SVG', `${path}.${k}`, 'event handler attributes (on*) are not allowed'));
    if (/javascript:/i.test(val) || /vbscript:/i.test(val)) errors.push(issue('UNSAFE_SVG', `${path}.${k}`, 'script URLs are not allowed'));
    if (URL_ATTRS.has(k.toLowerCase()) && val && !val.startsWith('#') && !SAFE_DATA_URL.test(val)) {
      errors.push(issue('UNSAFE_SVG', `${path}.${k}`, 'only local (#id) references or data:image URLs are allowed'));
    }
    if (k === 'style' && /(url\(\s*['"]?(https?:|\/\/))|expression\(/i.test(val)) errors.push(issue('UNSAFE_SVG', `${path}.style`, 'external url() and expression() are not allowed in style'));
    if (BAD_TEXT.test(val)) errors.push(issue('UNSAFE_SVG', `${path}.${k}`, 'markup is not allowed inside attribute values'));
  }
}

/**
 * @param {object} item proposed item
 * @param {{op: 'create'|'update', svg?: string}} opts
 * @returns {{errors: object[], warnings: object[], fixes: string[]}}
 */
export function validateItemStatic(item, { op = 'create', svg } = {}) {
  const errors = [], warnings = [], fixes = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return { errors: [issue('SCHEMA', 'item', 'item must be an object')], warnings, fixes };
  const strict = op === 'create' ? errors : warnings;

  if (!ITEM_TYPES.includes(item.type)) errors.push(issue('SCHEMA', 'type', `type must be one of ${ITEM_TYPES.join(', ')}`));
  if (typeof item.key !== 'string' || !KEY_RE.test(item.key)) {
    errors.push(issue('KEY', 'key', 'key must be dashed lowercase words starting with a letter, for example "back-arrow"'));
    if (typeof item.key === 'string') fixes.push(`use key "${item.key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '') || 'item'}"`);
  } else if (item.key.length > 80) errors.push(issue('KEY', 'key', 'key must be at most 80 characters'));

  const bytes = new TextEncoder().encode(canonicalJson(item)).length + (svg ? svg.length : 0);
  if (bytes > LIMITS.itemBytes) errors.push(issue('SIZE', 'item', `item is ${bytes} bytes; the limit is ${LIMITS.itemBytes}`));

  if (!String(item.descriptionDev || '').trim()) {
    strict.push(issue('DOCS', 'descriptionDev', 'descriptionDev is required: say what the item is and where it is used, for the next developer'));
  }
  const ctx = item.mcpContext;
  if (ctx !== undefined && (typeof ctx !== 'object' || ctx === null || Array.isArray(ctx))) errors.push(issue('SCHEMA', 'mcpContext', 'mcpContext must be an object'));
  else if (!String(ctx?.purpose || '').trim()) strict.push(issue('DOCS', 'mcpContext.purpose', 'mcpContext.purpose is required: one sentence that makes the item findable by the next agent'));

  if (USER_FACING.includes(item.type) && !String(item.label || item.name || '').trim()) {
    (item.type === 'button' ? strict : warnings).push(issue('A11Y', 'label', 'user-facing items need a label (the accessible name)'));
  }
  if (item.type === 'button' && Number(item.height) && Number(item.height) < 44) {
    warnings.push(issue('A11Y', 'height', 'touch targets should be at least 44 px high on mobile devices'));
  }
  if (['path', 'icon'].includes(item.type)) {
    for (const d of ['width', 'height']) {
      if (item[d] !== undefined && Number(item[d]) !== 24) errors.push(issue('GRID', d, `${item.type}s use the 24×24 grid (viewBox 0 0 24 24)`));
    }
  }

  if (svg !== undefined) {
    if (item.type === 'workflow' || item.type === 'screen') errors.push(issue('SCHEMA', 'svg', 'svg import is for paths, icons, buttons and elements'));
    if (typeof svg !== 'string' || !/<svg[\s>]/i.test(svg)) errors.push(issue('SCHEMA', 'svg', 'svg must be an <svg> document'));
    else {
      if (BAD_TEXT.test(svg)) errors.push(issue('UNSAFE_SVG', 'svg', '<script>, <foreignObject>, <iframe>, <object> and <embed> are not allowed'));
      if (/\son[a-z]+\s*=/i.test(svg)) errors.push(issue('UNSAFE_SVG', 'svg', 'event handler attributes (on*) are not allowed'));
      if (/javascript:/i.test(svg)) errors.push(issue('UNSAFE_SVG', 'svg', 'script URLs are not allowed'));
      if (/(xlink:)?href\s*=\s*["'](?!#|data:image\/)/i.test(svg)) errors.push(issue('UNSAFE_SVG', 'svg', 'only local (#id) references or data:image URLs are allowed'));
      if (['path', 'icon'].includes(item.type) && !/viewBox\s*=\s*["']\s*0[\s,]+0[\s,]+24[\s,]+24\s*["']/i.test(svg)) {
        errors.push(issue('GRID', 'svg', 'icons and paths must use viewBox="0 0 24 24"'));
        fixes.push('scale the drawing onto a 24×24 viewBox before staging');
      }
    }
    if (item.nodes !== undefined) errors.push(issue('SCHEMA', 'nodes', 'send either svg or nodes, not both'));
  }

  if (item.nodes !== undefined) {
    if (!Array.isArray(item.nodes)) errors.push(issue('SCHEMA', 'nodes', 'nodes must be an array'));
    else {
      if (item.type === 'workflow') errors.push(issue('SCHEMA', 'nodes', 'workflows have screens and links, not nodes'));
      if (item.nodes.length > LIMITS.nodes) errors.push(issue('SIZE', 'nodes', `at most ${LIMITS.nodes} nodes`));
      const n = item.nodes.length;
      item.nodes.forEach((node, i) => {
        const p = `nodes[${i}]`;
        if (!node || typeof node !== 'object') { errors.push(issue('SCHEMA', p, 'node must be an object')); return; }
        if (node.parentIndex !== undefined && node.parentIndex !== null) {
          if (!Number.isInteger(node.parentIndex) || node.parentIndex < 0 || node.parentIndex >= n || node.parentIndex === i) {
            errors.push(issue('SCHEMA', `${p}.parentIndex`, 'parentIndex must be the array position of another node'));
          }
        }
        if (node.kind === 'instance' && !(node.ref && (node.ref.uid || node.ref.key) && node.ref.type)) {
          errors.push(issue('REF', `${p}.ref`, 'instance nodes need ref {type, uid | key}'));
        }
        checkAttrs(node.attrs, `${p}.attrs`, errors);
        if (BAD_TEXT.test(String(node.text || ''))) errors.push(issue('UNSAFE_SVG', `${p}.text`, 'markup is not allowed in text'));
      });
    }
  }
  if (item.animations !== undefined && !Array.isArray(item.animations)) errors.push(issue('SCHEMA', 'animations', 'animations must be an array'));
  if (item.menuItems !== undefined && (!Array.isArray(item.menuItems) || item.type !== 'button')) errors.push(issue('SCHEMA', 'menuItems', 'menuItems is an array and only for buttons'));
  if (item.type === 'workflow') {
    if (item.screens !== undefined && !Array.isArray(item.screens)) errors.push(issue('SCHEMA', 'screens', 'screens must be an array'));
    if (item.links !== undefined && !Array.isArray(item.links)) errors.push(issue('SCHEMA', 'links', 'links must be an array'));
  }
  return { errors, warnings, fixes };
}
