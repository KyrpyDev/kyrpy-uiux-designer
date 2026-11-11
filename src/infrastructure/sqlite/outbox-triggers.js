/**
 * Change tracking for the PostgreSQL sync: one trigger set per synced table records every insert, update and
 * delete in `sync_outbox` as `(table, record id, operation)` — no row copy. Triggers see every write path
 * (repositories, raw SQL, cascaded deletes), so the "unpushed changes" count cannot miss one.
 *
 * A record that is already waiting (synced = 0) with the same operation is not recorded twice, so the outbox is
 * bounded by the number of changed records, not by the number of writes.
 */
const PREFIX = 'sync_ob_';

const has = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

/** SQL of the outbox insert for row alias `ref` (NEW / OLD) of `table`. */
function recordSql(table, pk, ref, op) {
  const id = pk.map(c => `CAST(${ref}."${c}" AS TEXT)`).join(" || ':' || ");
  return `INSERT INTO sync_outbox (table_name, record_id, operation, payload, synced)
    SELECT '${table}', ${id}, '${op}', '{}', 0
    WHERE NOT EXISTS (SELECT 1 FROM sync_outbox WHERE synced = 0 AND table_name = '${table}' AND record_id = ${id} AND operation = '${op}');`;
}

/** Creates the missing triggers for `tables` (`[{ name, pk: [...] }]`); tables that do not exist are skipped. Returns how many tables are tracked. */
export function installOutboxTriggers(db, tables) {
  if (!has(db, 'sync_outbox')) return 0;
  let n = 0;
  for (const { name, pk } of tables) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name) || !has(db, name)) continue;
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ${PREFIX}${name}_ins AFTER INSERT ON "${name}" BEGIN ${recordSql(name, pk, 'NEW', 'upsert')} END;
      CREATE TRIGGER IF NOT EXISTS ${PREFIX}${name}_upd AFTER UPDATE ON "${name}" BEGIN ${recordSql(name, pk, 'NEW', 'upsert')} END;
      CREATE TRIGGER IF NOT EXISTS ${PREFIX}${name}_del AFTER DELETE ON "${name}" BEGIN ${recordSql(name, pk, 'OLD', 'delete')} END;`);
    n += 1;
  }
  return n;
}

/** Removes every change-tracking trigger (before schema migrations and when a database is prepared for publishing). Returns how many. */
export function dropOutboxTriggers(db) {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?").all(`${PREFIX.replace(/_/g, '\\_')}%`.replace(/\\_/g, '_'));
  const mine = rows.filter(r => r.name.startsWith(PREFIX));
  for (const r of mine) db.exec(`DROP TRIGGER IF EXISTS "${r.name}";`);
  return mine.length;
}
