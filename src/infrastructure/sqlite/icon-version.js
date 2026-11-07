import { randomBytes } from 'node:crypto';

/**
 * In-memory change counter for the icon library: TEMP triggers (connection-local, no schema change) bump a
 * counter on every insert/update/delete of an icon or an icon node made through this connection. Writes from
 * other connections / processes (import-icon-packs.js, a separate MCP process) never fire TEMP triggers, so
 * `PRAGMA data_version` (changes only when another connection commits) gates a cheap fingerprint of the icon
 * tables (row counts, max ids, max updated_at); a changed fingerprint bumps an external counter.
 * Returns `() => '<boot>.<n>.<x>'`; the boot prefix changes on every process start so clients never trust a
 * counter from an earlier run.
 */
export function installIconVersion(db) {
  const boot = randomBytes(4).toString('hex');
  // MCP lazily caches a content hash on the row (NULL -> hash): that is not a content change, so it is ignored
  const hasHash = db.prepare('PRAGMA main.table_info(icons)').all().some(c => c.name === 'content_hash');
  const updWhen = hasHash ? 'WHEN NOT (OLD.content_hash IS NULL AND NEW.content_hash IS NOT NULL)' : '';
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS icon_lib_version (v INTEGER NOT NULL);
    INSERT INTO icon_lib_version (v) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM icon_lib_version);
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_ins AFTER INSERT ON main.icons BEGIN UPDATE icon_lib_version SET v = v + 1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_upd AFTER UPDATE ON main.icons ${updWhen} BEGIN UPDATE icon_lib_version SET v = v + 1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_del AFTER DELETE ON main.icons BEGIN UPDATE icon_lib_version SET v = v + 1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_nins AFTER INSERT ON main.nodes WHEN NEW.owner_type = 'icon' BEGIN UPDATE icon_lib_version SET v = v + 1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_nupd AFTER UPDATE ON main.nodes WHEN NEW.owner_type = 'icon' OR OLD.owner_type = 'icon' BEGIN UPDATE icon_lib_version SET v = v + 1; END;
    CREATE TEMP TRIGGER IF NOT EXISTS icon_ver_ndel AFTER DELETE ON main.nodes WHEN OLD.owner_type = 'icon' BEGIN UPDATE icon_lib_version SET v = v + 1; END;
  `);
  const stmt = db.prepare('SELECT v FROM temp.icon_lib_version LIMIT 1');
  const dataVersion = db.prepare('PRAGMA main.data_version');
  const fingerprintStmt = db.prepare(`SELECT
      (SELECT count(*) FROM main.icons) AS ic, (SELECT max(id) FROM main.icons) AS im, (SELECT max(updated_at) FROM main.icons) AS iu,
      (SELECT count(*) FROM main.nodes WHERE owner_type = 'icon') AS nc, (SELECT max(id) FROM main.nodes WHERE owner_type = 'icon') AS nm`);
  const fingerprint = () => { const r = fingerprintStmt.get(); return `${r.ic}|${r.im}|${r.iu}|${r.nc}|${r.nm}`; };
  let lastDataVersion = dataVersion.get()?.data_version, lastPrint = fingerprint(), lastLocal = stmt.get()?.v ?? 0, external = 0;
  return () => {
    const dv = dataVersion.get()?.data_version, local = stmt.get()?.v ?? 0;
    if (dv !== lastDataVersion) {
      lastDataVersion = dv;
      const fp = fingerprint();
      if (fp !== lastPrint) { lastPrint = fp; external++; }
    } else if (local !== lastLocal) {
      lastPrint = fingerprint(); // own writes are already counted: re-baseline so they do not look external later
    }
    lastLocal = local;
    return `${boot}.${local}.${external}`;
  };
}
