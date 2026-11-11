/**
 * Computes and caches `content_hash` for identity tables. The cache is cleared by the triggers from
 * mcp-schema.js whenever the row or one of its child rows changes; `get()` recomputes lazily.
 */
import { createHash } from 'node:crypto';
import { NotFoundError, ValidationError } from '../../../domain/errors.js';
import { DESIGN_TABLES, TYPE_TO_TABLE, TABLE_TO_TYPE } from '../../domain/tables.js';
import { canonicalDesign, canonicalWorkflow, canonicalRecord } from '../../domain/content-hash.js';

const sha256 = text => createHash('sha256').update(text).digest('hex');

export class ContentHashStore {
  constructor(db) { this.db = db; }

  #table(type) {
    const t = TYPE_TO_TABLE[type];
    if (!t) throw new ValidationError(`unknown item type ${type}`);
    return t;
  }

  /** Resolver handed to the pure canonicalizers: (type, id) → uid, memoized per computation. */
  #uidResolver() {
    const cache = new Map();
    return (type, id) => {
      const table = TYPE_TO_TABLE[type];
      if (!table || id == null) return null;
      const k = `${table}:${id}`;
      if (!cache.has(k)) cache.set(k, this.db.prepare(`SELECT uid FROM ${table} WHERE id = ?`).get(id)?.uid ?? null);
      return cache.get(k);
    };
  }

  /** Canonical text of one item (useful for debugging hash differences). */
  canonical(type, id) {
    const table = this.#table(type);
    const record = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!record) throw new NotFoundError(type, id);
    const uidOf = this.#uidResolver();

    if (DESIGN_TABLES[type]) {
      const nodes = this.db.prepare('SELECT * FROM nodes WHERE owner_type = ? AND owner_id = ?').all(type, id);
      const animations = nodes.length
        ? this.db.prepare(`SELECT * FROM animations WHERE node_id IN (SELECT id FROM nodes WHERE owner_type = ? AND owner_id = ?)`).all(type, id)
        : [];
      const menuItems = type === 'button' ? this.db.prepare('SELECT * FROM menu_items WHERE button_id = ?').all(id) : [];
      const elementScript = type === 'element' ? this.db.prepare('SELECT * FROM element_scripts WHERE element_id = ?').get(id) ?? null : null;
      return canonicalDesign({ record, nodes, animations, menuItems, elementScript }, uidOf);
    }
    if (type === 'workflow') {
      const screens = this.db.prepare('SELECT * FROM workflow_screens WHERE workflow_id = ?').all(id);
      const links = this.db.prepare('SELECT * FROM workflow_links WHERE workflow_id = ?').all(id);
      const screenNodes = new Map();
      for (const sid of new Set(links.filter(l => l.from_node_id != null).map(l => l.from_screen_id))) {
        screenNodes.set(sid, this.db.prepare("SELECT * FROM nodes WHERE owner_type = 'screen' AND owner_id = ?").all(sid));
      }
      return canonicalWorkflow({ record, screens, links, screenNodes }, uidOf);
    }
    return canonicalRecord(record);
  }

  /** Recomputes and stores the hash. */
  compute(type, id) {
    const hash = sha256(this.canonical(type, id));
    // writing an unchanged hash would look like a plain row update to the invalidation trigger, so skip it
    this.db.prepare(`UPDATE ${this.#table(type)} SET content_hash = ? WHERE id = ? AND content_hash IS NOT ?`).run(hash, id, hash);
    return hash;
  }

  /** Cached hash, recomputed when stale. */
  get(type, id) {
    const row = this.db.prepare(`SELECT content_hash FROM ${this.#table(type)} WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError(type, id);
    return row.content_hash || this.compute(type, id);
  }

  /** Recomputes every stale hash of the given tables (default: all identity tables). Returns the count per table. */
  refreshStale(tables = Object.keys(TABLE_TO_TYPE)) {
    const counts = {};
    for (const table of tables) {
      const type = TABLE_TO_TYPE[table];
      const ids = this.db.prepare(`SELECT id FROM ${table} WHERE content_hash IS NULL`).all().map(r => r.id);
      for (const id of ids) this.compute(type, id);
      counts[table] = ids.length;
    }
    return counts;
  }
}
