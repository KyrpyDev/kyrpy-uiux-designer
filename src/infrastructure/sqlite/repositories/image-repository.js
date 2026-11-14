/**
 * SQLite repository of the image library (`images`). Lists never read the file column (`data`, base64): only `getData` does.
 */
import { sqlSearch } from '../../../domain/search.js';

const META_COLS = `id, key, name, label, category, tags, description_dev, mime, width, height, bytes, sha256, source, source_id,
  source_url, author, author_url, license, license_url, project_id, visibility, creator_id, created_at, updated_at`;

const parseTags = v => { try { const t = JSON.parse(v || '[]'); return Array.isArray(t) ? t : []; } catch { return []; } };

export function mapImageRow(r) {
  if (!r) return null;
  return {
    id: Number(r.id), key: r.key, name: r.name, label: r.label || '', category: r.category || 'images', tags: parseTags(r.tags),
    descriptionDev: r.description_dev || '', mime: r.mime, width: r.width == null ? null : Number(r.width), height: r.height == null ? null : Number(r.height),
    bytes: Number(r.bytes) || 0, sha256: r.sha256, source: r.source || 'upload', sourceId: r.source_id || null, sourceUrl: r.source_url || null,
    author: r.author || null, authorUrl: r.author_url || null, license: r.license || null, licenseUrl: r.license_url || null,
    projectId: Number(r.project_id), visibility: r.visibility, creatorId: Number(r.creator_id), createdAt: r.created_at, updatedAt: r.updated_at,
    fileUrl: `/api/images/${Number(r.id)}/file`
  };
}

export class ImageRepository {
  constructor(db) { this.db = db; }

  get(id) { return mapImageRow(this.db.prepare(`SELECT ${META_COLS} FROM images WHERE id = ?`).get(Number(id))); }
  getData(id) { return this.db.prepare('SELECT mime, data, sha256 FROM images WHERE id = ?').get(Number(id)) || null; }
  keyExists(projectId, key) { return !!this.db.prepare('SELECT 1 FROM images WHERE project_id = ? AND key = ?').get(Number(projectId), key); }
  findBySha(projectId, sha256) { return mapImageRow(this.db.prepare(`SELECT ${META_COLS} FROM images WHERE project_id = ? AND sha256 = ? ORDER BY id LIMIT 1`).get(Number(projectId), sha256)); }
  categories() { return this.db.prepare('SELECT DISTINCT category FROM images ORDER BY category').all().map(r => r.category); }

  /**
   * Images `actorId` may see (admin: all): public ones, project-only ones of the projects they own or belong to, and their own
   * private ones. Filters: q (every word in name / label / key / tags / description-dev / author / source), projectId (that
   * project's images plus the public ones), visibility, category, source. Returns { items, total }.
   */
  list({ q = '', projectId = null, visibility = '', category = '', source = '', actorId = null, isAdmin = false, limit = 200, offset = 0 } = {}) {
    const where = [], args = [];
    if (!isAdmin && actorId != null) {
      where.push(`(visibility = 'public' OR creator_id = ? OR (visibility = 'project' AND project_id IN (
        SELECT id FROM projects WHERE owner_id = ? UNION SELECT project_id FROM project_members WHERE user_id = ? AND status = 'accepted')))`);
      args.push(Number(actorId), Number(actorId), Number(actorId));
    }
    if (projectId != null && projectId !== '') { where.push(`(project_id = ? OR visibility = 'public')`); args.push(Number(projectId)); }
    if (visibility) { where.push('visibility = ?'); args.push(visibility); }
    if (category) { where.push('category = ?'); args.push(category); }
    if (source) { where.push('source = ?'); args.push(source); }
    const m = sqlSearch(q, ['key', 'name', 'label', 'tags', 'description_dev', 'category', 'author', 'source']);
    if (m.sql) { where.push(m.sql); args.push(...m.args); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM images ${w}`).get(...args).n;
    const lim = Math.max(1, Math.min(500, Number(limit) || 200)), off = Math.max(0, Number(offset) || 0);
    const items = this.db.prepare(`SELECT ${META_COLS} FROM images ${w} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`).all(...args, lim, off).map(mapImageRow);
    return { items, total };
  }

  create(r) {
    const info = this.db.prepare(`INSERT INTO images (key, name, label, category, tags, description_dev, mime, width, height, bytes, sha256, data,
      source, source_id, source_url, author, author_url, license, license_url, project_id, visibility, creator_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      r.key, r.name, r.label || '', r.category || 'images', JSON.stringify(r.tags || []), r.descriptionDev || '', r.mime, r.width ?? null, r.height ?? null,
      r.bytes || 0, r.sha256, r.data, r.source || 'upload', r.sourceId ?? null, r.sourceUrl ?? null, r.author ?? null, r.authorUrl ?? null,
      r.license ?? null, r.licenseUrl ?? null, Number(r.projectId) || 1, r.visibility || 'project', Number(r.creatorId) || 1);
    return this.get(Number(info.lastInsertRowid));
  }

  update(id, patch) {
    const cols = { name: 'name', label: 'label', category: 'category', descriptionDev: 'description_dev', visibility: 'visibility', key: 'key' };
    const sets = [], args = [];
    for (const [k, c] of Object.entries(cols)) if (patch[k] !== undefined) { sets.push(`${c} = ?`); args.push(patch[k]); }
    if (patch.tags !== undefined) { sets.push('tags = ?'); args.push(JSON.stringify(patch.tags)); }
    if (!sets.length) return this.get(id);
    sets.push(`updated_at = datetime('now')`);
    this.db.prepare(`UPDATE images SET ${sets.join(', ')} WHERE id = ?`).run(...args, Number(id));
    return this.get(id);
  }

  remove(id) { return this.db.prepare('DELETE FROM images WHERE id = ?').run(Number(id)).changes > 0; }
}
