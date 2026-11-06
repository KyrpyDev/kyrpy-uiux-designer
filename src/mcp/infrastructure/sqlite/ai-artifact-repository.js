/** SQLite access for `ai_artifacts` (AI pack templates). */
import { createHash } from 'node:crypto';
import { UID_SQL_EXPR } from '../../domain/uid.js';

const toArtifact = r => r && ({
  id: r.id, uid: r.uid, scope: r.scope, projectId: r.project_id, kind: r.kind, platform: r.platform, name: r.name,
  template: r.template, version: r.version, checksum: r.checksum, source: r.source, updatedBy: r.updated_by, updatedAt: r.updated_at
});

const sha = s => createHash('sha256').update(s).digest('hex');

export class AiArtifactRepository {
  constructor(db) { this.db = db; }

  global(kind, name, platform = 'any') {
    return toArtifact(this.db.prepare("SELECT * FROM ai_artifacts WHERE scope = 'global' AND project_id = 0 AND kind = ? AND name = ? AND platform = ?").get(kind, name, platform));
  }

  override(projectId, kind, name, platform = 'any') {
    return toArtifact(this.db.prepare("SELECT * FROM ai_artifacts WHERE scope = 'project' AND project_id = ? AND kind = ? AND name = ? AND platform = ?").get(Number(projectId), kind, name, platform));
  }

  /** Project override when present, else the global row. */
  effective(projectId, kind, name, platform = 'any') {
    return this.override(projectId, kind, name, platform) || this.global(kind, name, platform);
  }

  listGlobal() { return this.db.prepare("SELECT * FROM ai_artifacts WHERE scope = 'global' ORDER BY kind, name").all().map(toArtifact); }

  upsertOverride({ projectId, kind, name, platform = 'any', template, userId }) {
    const cur = this.override(projectId, kind, name, platform);
    if (cur) {
      this.db.prepare("UPDATE ai_artifacts SET template = ?, version = version + 1, checksum = ?, source = 'user', updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
        .run(template, sha(template), userId ?? null, cur.id);
    } else {
      this.db.prepare(`INSERT INTO ai_artifacts (uid, scope, project_id, kind, platform, name, template, version, checksum, source, updated_by)
        VALUES (${UID_SQL_EXPR}, 'project', ?, ?, ?, ?, ?, 1, ?, 'user', ?)`).run(Number(projectId), kind, platform, name, template, sha(template), userId ?? null);
    }
    return this.override(projectId, kind, name, platform);
  }

  deleteOverride(projectId, kind, name, platform = 'any') {
    return this.db.prepare("DELETE FROM ai_artifacts WHERE scope = 'project' AND project_id = ? AND kind = ? AND name = ? AND platform = ?")
      .run(Number(projectId), kind, name, platform).changes > 0;
  }

  updateGlobal({ kind, name, platform = 'any', template, userId }) {
    this.db.prepare("UPDATE ai_artifacts SET template = ?, version = version + 1, checksum = ?, source = 'user', updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE scope = 'global' AND project_id = 0 AND kind = ? AND name = ? AND platform = ?")
      .run(template, sha(template), userId ?? null, kind, name, platform);
    return this.global(kind, name, platform);
  }
}
