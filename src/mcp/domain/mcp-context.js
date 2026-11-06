/**
 * `mcp_context` — machine-readable AI context carried by every row of every table (pure, isomorphic).
 *
 * Two layers (see docs/project-definition/project-definition-mcp.md §7.1):
 *  - table / column level  → rows of `schema_registry` (their `mcp_context` holds the description)
 *  - row level             → the `mcp_context` column on the row itself (row-specific notes only)
 *
 * The object is open (unknown fields are kept) but the well-known fields are type-checked and the
 * serialized size is capped so a row can never be bloated by an agent.
 */
import { ValidationError } from '../../domain/errors.js';

export const MCP_CONTEXT_COLUMN = 'mcp_context';
export const MCP_CONTEXT_MAX_BYTES = 16 * 1024;
export const MCP_CONTEXT_SOURCES = ['designer', 'ai-push', 'import', 'seed', 'system', 'user'];

const LIMITS = { purpose: 500, usage: 4000, notes: 4000, units: 120, updatedBy: 120 };

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const byteLength = s => new TextEncoder().encode(s).length;

/** Parses a stored value (JSON text, object, null) into an object. Corrupt or non-object JSON becomes `{}`. */
export function parseMcpContext(value) {
  if (value === null || value === undefined || value === '') return {};
  if (isPlainObject(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Throws ValidationError when the object breaks a rule; returns the object unchanged otherwise. */
export function validateMcpContext(ctx) {
  if (!isPlainObject(ctx)) throw new ValidationError('mcp_context must be a JSON object');
  for (const [field, max] of Object.entries(LIMITS)) {
    if (ctx[field] === undefined) continue;
    if (typeof ctx[field] !== 'string') throw new ValidationError(`mcp_context.${field} must be a string`);
    if (ctx[field].length > max) throw new ValidationError(`mcp_context.${field} must be at most ${max} characters`);
  }
  if (ctx.constraints !== undefined) {
    if (!Array.isArray(ctx.constraints) || ctx.constraints.some(c => typeof c !== 'string')) {
      throw new ValidationError('mcp_context.constraints must be an array of strings');
    }
  }
  if (ctx.codeHints !== undefined) {
    if (!isPlainObject(ctx.codeHints) || Object.values(ctx.codeHints).some(v => typeof v !== 'string')) {
      throw new ValidationError('mcp_context.codeHints must be an object of strings');
    }
  }
  if (ctx.related !== undefined) {
    const ok = Array.isArray(ctx.related) && ctx.related.every(r =>
      isPlainObject(r) && typeof r.type === 'string' && (typeof r.key === 'string' || typeof r.uid === 'string'));
    if (!ok) throw new ValidationError('mcp_context.related must be an array of { type, key | uid }');
  }
  if (ctx.source !== undefined && !MCP_CONTEXT_SOURCES.includes(ctx.source)) {
    throw new ValidationError(`mcp_context.source must be one of ${MCP_CONTEXT_SOURCES.join(', ')}`);
  }
  const size = byteLength(JSON.stringify(ctx));
  if (size > MCP_CONTEXT_MAX_BYTES) {
    throw new ValidationError(`mcp_context is ${size} bytes; the limit is ${MCP_CONTEXT_MAX_BYTES}`);
  }
  return ctx;
}

/** Parse + validate + serialize, ready to store. */
export function serializeMcpContext(value) {
  return JSON.stringify(validateMcpContext(parseMcpContext(value)));
}

/**
 * Shallow merge of a patch onto a base context. `null` in the patch removes a field.
 * Arrays and nested objects are replaced, not merged, so the result is predictable for agents.
 */
export function mergeMcpContext(base, patch) {
  const out = { ...parseMcpContext(base) };
  for (const [k, v] of Object.entries(parseMcpContext(patch))) {
    if (v === null) delete out[k]; else out[k] = v;
  }
  return validateMcpContext(out);
}
