/**
 * SQLite access for design_focus: the project each AI-assisted-design key currently works on. No business rules.
 */
export class FocusRepository {
  constructor(db) { this.db = db; }

  get(apiKeyId) {
    const r = this.db.prepare('SELECT api_key_id, project_id, updated_at FROM design_focus WHERE api_key_id = ?').get(Number(apiKeyId));
    return r ? { apiKeyId: r.api_key_id, projectId: r.project_id, updatedAt: r.updated_at } : null;
  }

  set(apiKeyId, projectId) {
    this.db.prepare(`INSERT INTO design_focus (api_key_id, project_id, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ON CONFLICT (api_key_id) DO UPDATE SET project_id = excluded.project_id, updated_at = excluded.updated_at`).run(Number(apiKeyId), Number(projectId));
  }

  /** Every key focused on this project loses its focus (the project was deleted). */
  clearProject(projectId) { this.db.prepare('DELETE FROM design_focus WHERE project_id = ?').run(Number(projectId)); }

  clear(apiKeyId) { this.db.prepare('DELETE FROM design_focus WHERE api_key_id = ?').run(Number(apiKeyId)); }
}
