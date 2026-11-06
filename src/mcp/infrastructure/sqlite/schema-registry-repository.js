/** Read / write access to `schema_registry`, merged with the live SQLite column definitions. */
import { NotFoundError, ValidationError } from '../../../domain/errors.js';
import { parseMcpContext, serializeMcpContext } from '../../domain/mcp-context.js';

const toEntry = r => ({
  tableName: r.table_name,
  columnName: r.column_name,
  context: parseMcpContext(r.mcp_context),
  version: r.version,
  source: r.source,
  updatedAt: r.updated_at
});

export class SchemaRegistryRepository {
  constructor(db) { this.db = db; }

  list() {
    return this.db.prepare('SELECT * FROM schema_registry ORDER BY table_name, column_name').all().map(toEntry);
  }

  /** Table description plus every column with its live SQL type, nullability and default. */
  describeTable(tableName) {
    const rows = this.db.prepare('SELECT * FROM schema_registry WHERE table_name = ?').all(tableName).map(toEntry);
    const table = rows.find(r => r.columnName === '');
    if (!table) throw new NotFoundError('schema_registry table', tableName);
    const byCol = new Map(rows.filter(r => r.columnName).map(r => [r.columnName, r]));
    const columns = this.db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all().map(c => ({
      name: c.name,
      type: c.type,
      notNull: Boolean(c.notnull),
      default: c.dflt_value,
      primaryKey: Boolean(c.pk),
      context: byCol.get(c.name)?.context ?? {}
    }));
    return { tableName, context: table.context, source: table.source, columns };
  }

  /** Every table description (columns included). */
  describeAll() {
    const tables = this.db.prepare("SELECT DISTINCT table_name FROM schema_registry WHERE column_name = '' ORDER BY table_name").all();
    const live = new Set(this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    return tables.map(t => t.table_name).filter(t => live.has(t)).map(t => this.describeTable(t));
  }

  /** Entries that still need a human/AI-written description. */
  undocumented() {
    return this.list().filter(e => e.source === 'system' || e.context.needsDescription || !e.context.purpose);
  }

  /** Writes a description. `source` is 'user' (designer UI) or 'ai' (MCP agent); seed rows become user-owned. */
  upsert({ tableName, columnName = '', context, source = 'user' }) {
    if (!['user', 'ai'].includes(source)) throw new ValidationError('source must be user or ai');
    if (!tableName) throw new ValidationError('tableName is required');
    const ctx = serializeMcpContext(context);
    this.db.prepare(`INSERT INTO schema_registry (table_name, column_name, mcp_context, version, source)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT (table_name, column_name) DO UPDATE SET mcp_context = excluded.mcp_context, source = excluded.source, updated_at = datetime('now')`)
      .run(tableName, columnName, ctx, source);
    return toEntry(this.db.prepare('SELECT * FROM schema_registry WHERE table_name = ? AND column_name = ?').get(tableName, columnName));
  }
}
