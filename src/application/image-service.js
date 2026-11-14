/**
 * The image library: upload, list / search, read the file, rename / tag / describe, delete.
 * Pictures are PNG, JPEG, GIF or WebP (no SVG), at most MAX_IMAGE_BYTES; they are checked by their header bytes, so a renamed
 * file is refused. Access follows the library rules (application/access-policy.js): public, project-only or private.
 */
import { createHash } from 'node:crypto';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { IMAGE_MIME, MAX_IMAGE_BYTES, parseImageDataUri, imageBytesMatch, imageSize } from '../domain/image.js';
import { assertItemAccess } from './access-policy.js';
import { slugify, uniqueKey, prefixedVariableName } from '../domain/naming.js';

const VISIBILITY = ['public', 'project', 'private'];
const cleanTags = t => (Array.isArray(t) ? t : String(t ?? '').split(',')).map(x => String(x).trim()).filter(Boolean).slice(0, 40);
const text = (v, max = 4000) => String(v ?? '').slice(0, max);

export class ImageService {
  /**
   * @param {{ images: import('../infrastructure/sqlite/repositories/image-repository.js').ImageRepository,
   *   projects?: { userRole: Function }, auth?: { isAdmin: Function }, projectPrefix?: (projectId:number) => string|null }} deps
   */
  constructor({ images, projects = null, auth = null, projectPrefix = null }) {
    this.images = images; this.projects = projects; this.auth = auth; this.projectPrefix = projectPrefix;
  }

  #isAdmin(actor) { return !!actor && (this.auth?.isAdmin?.(actor) ?? ['admin', 'superadmin'].includes(actor.role)); }

  #require(id, actor, mode = 'read') {
    const img = this.images.get(id);
    if (!img) throw new NotFoundError('image', id);
    assertItemAccess(img, actor, this.projects, mode, 'image');
    // a public image is changed or deleted by its creator or an admin only (images have no change-request flow)
    if (mode === 'edit' && actor && img.visibility === 'public' && !this.#isAdmin(actor) && Number(img.creatorId) !== Number(actor.id)) {
      throw new ForbiddenError('Only the owner of a public image or an admin can change it');
    }
    return img;
  }

  list(query = {}, { actor = null } = {}) {
    return this.images.list({ ...query, actorId: actor?.id ?? null, isAdmin: !actor || this.#isAdmin(actor) });
  }

  get(id, { actor = null } = {}) { return this.#require(id, actor, 'read'); }
  categories() { return this.images.categories(); }

  /** The picture itself: { raw: Buffer, contentType, etag } for the HTTP layer (cached by its content hash). */
  file(id, { actor = null } = {}) {
    this.#require(id, actor, 'read');
    const d = this.images.getData(id);
    return { raw: Buffer.from(d.data, 'base64'), contentType: d.mime, etag: `"${d.sha256.slice(0, 32)}"`, cacheControl: 'private, max-age=86400' };
  }

  /** A data URI of the picture (exports embed images so the exported pages work offline); null when missing. */
  dataUri(id) {
    const d = this.images.getData(id);
    return d ? `data:${d.mime};base64,${d.data}` : null;
  }

  /**
   * Adds a picture. `input.data`: a base64 data URI (data:image/png;base64,…) or { buffer, mime } from a server-side download.
   * The same picture added again to the same project returns the existing record (`duplicate: true`).
   */
  create(input = {}, { actor = null } = {}) {
    let mime, buf;
    if (input.buffer && input.mime) { mime = input.mime; buf = Buffer.isBuffer(input.buffer) ? input.buffer : Buffer.from(input.buffer); }
    else {
      const p = parseImageDataUri(input.data ?? input.dataUri);
      if (!p) throw new ValidationError('data must be a base64 data URI of a PNG, JPEG, GIF or WebP image (data:image/png;base64,…)');
      mime = p.mime; buf = Buffer.from(p.base64, 'base64');
    }
    if (!IMAGE_MIME[mime]) throw new ValidationError(`image type ${mime} is not supported (PNG, JPEG, GIF or WebP)`);
    if (!buf.length) throw new ValidationError('the image is empty');
    if (buf.length > MAX_IMAGE_BYTES) throw new ValidationError(`the image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB`);
    if (!imageBytesMatch(mime, buf)) throw new ValidationError(`the file is not a valid ${IMAGE_MIME[mime].toUpperCase()} image`);
    const projectId = Number(input.projectId) || 1;
    if (actor && this.projects?.userRole) {
      const role = this.projects.userRole(projectId, actor);
      if (!['owner', 'admin', 'editor', 'contributor'].includes(role)) throw new ValidationError('You cannot add images to this project');
    }
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const dup = this.images.findBySha(projectId, sha256);
    if (dup) return { ...dup, duplicate: true };
    const name = text(input.name || input.label || 'Image', 200).trim() || 'Image';
    const prefix = this.projectPrefix?.(projectId) || null;
    const base = input.key ? slugify(input.key, 'image') : prefixedVariableName(prefix, 'image', name);
    const key = uniqueKey(base, k => this.images.keyExists(projectId, k));
    const size = imageSize(mime, buf) || {};
    const visibility = VISIBILITY.includes(input.visibility) ? input.visibility : 'project';
    return this.images.create({
      key, name, label: text(input.label ?? name, 200), category: slugify(input.category || 'images', 'images'), tags: cleanTags(input.tags),
      descriptionDev: text(input.descriptionDev), mime, width: input.width ?? size.width ?? null, height: input.height ?? size.height ?? null,
      bytes: buf.length, sha256, data: buf.toString('base64'),
      source: slugify(input.source || 'upload', 'upload'), sourceId: input.sourceId == null ? null : text(input.sourceId, 200),
      sourceUrl: input.sourceUrl ? text(input.sourceUrl, 1000) : null, author: input.author ? text(input.author, 200) : null,
      authorUrl: input.authorUrl ? text(input.authorUrl, 1000) : null, license: input.license ? text(input.license, 200) : null,
      licenseUrl: input.licenseUrl ? text(input.licenseUrl, 1000) : null,
      projectId, visibility, creatorId: actor?.id ?? (Number(input.creatorId) || 1)
    });
  }

  /** Renames / re-tags / re-describes an image or changes its visibility (the picture itself never changes). */
  update(id, patch = {}, { actor = null } = {}) {
    this.#require(id, actor, 'edit');
    const out = {};
    if (patch.name !== undefined) { out.name = text(patch.name, 200).trim(); if (!out.name) throw new ValidationError('name is required'); }
    if (patch.label !== undefined) out.label = text(patch.label, 200);
    if (patch.category !== undefined) out.category = slugify(patch.category || 'images', 'images');
    if (patch.descriptionDev !== undefined) out.descriptionDev = text(patch.descriptionDev);
    if (patch.tags !== undefined) out.tags = cleanTags(patch.tags);
    if (patch.visibility !== undefined) {
      if (!VISIBILITY.includes(patch.visibility)) throw new ValidationError(`visibility must be one of ${VISIBILITY.join(', ')}`);
      out.visibility = patch.visibility;
    }
    return this.images.update(id, out);
  }

  remove(id, { actor = null } = {}) {
    this.#require(id, actor, 'edit');
    return { removed: this.images.remove(id) };
  }
}
