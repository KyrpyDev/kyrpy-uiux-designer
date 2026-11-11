/**
 * Application service for sandboxed custom JavaScript & verified public JS dependencies on UI Elements.
 */
import { DomainError, NotFoundError, ValidationError } from '../domain/errors.js';
import {
  ALLOWED_PUBLIC_SCRIPT_ORIGINS,
  ELEMENT_SCRIPT_POLICY,
  SCRIPT_FETCH_MAX_BYTES,
  buildElementSandboxCsp,
  buildSandboxedElementHtml,
  computeSriHash,
  normalizeElementScriptSpec
} from '../domain/element-script.js';

const MAX_REDIRECTS = 4;

/** Portable view of an element script (safe for REST, MCP `itemJson`, bundles, and version snapshots). */
export function toPortableElementScript(script) {
  if (!script) return null;
  const cspPreview = buildElementSandboxCsp({
    nonce: 'previewNonce0000',
    imports: script.imports || [],
    capabilities: script.capabilities || {},
    reviewStatus: script.reviewStatus || 'verified'
  }).replace(/'nonce-previewNonce0000'/g, "'nonce-<per-render>'");
  return {
    uid: script.uid || null,
    enabled: Boolean(script.enabled),
    runtime: script.runtime || 'esm',
    entryExport: script.entryExport || 'mount',
    moduleCode: script.moduleCode || '',
    imports: script.imports || [],
    capabilities: script.capabilities || {},
    propsSchema: script.propsSchema || {},
    emits: script.emits || [],
    codeHash: script.codeHash || '',
    sriVerified: Boolean(script.sriVerified),
    reviewStatus: script.reviewStatus || 'verified',
    updatedAt: script.updatedAt || null,
    security: {
      iframeSandbox: 'allow-scripts',
      referrerPolicy: 'no-referrer',
      allowSameOrigin: false,
      cspTemplate: cspPreview
    }
  };
}

export class ElementScriptService {
  /**
   * @param {{
   *   scripts: import('../infrastructure/sqlite/repositories/element-script-repository.js').ElementScriptRepository,
   *   elements: any,
   *   themes: any,
   *   settings: any,
   *   exporter: any,
   *   fetchImpl?: typeof fetch
   * }} deps
   */
  constructor({ scripts, elements, themes, settings, exporter, fetchImpl = globalThis.fetch }) {
    this.scripts = scripts;
    this.elements = elements;
    this.themes = themes;
    this.settings = settings;
    this.exporter = exporter;
    this.fetchImpl = fetchImpl;
  }

  policy() {
    return ELEMENT_SCRIPT_POLICY;
  }

  #resolveElement(idOrKey) {
    const rec = this.elements.get(idOrKey);
    if (!rec) throw new NotFoundError('element', idOrKey);
    return rec;
  }

  /** Reads the portable script spec attached to an element, or `null` if none exists. */
  get(idOrKey, { actor = null, checkAccess = false } = {}) {
    const el = this.#resolveElement(idOrKey);
    if (checkAccess) this.elements.assertCanRead(el, actor);
    const row = this.scripts.getByElementId(el.id);
    return toPortableElementScript(row);
  }

  /** Batch read for export / list enrichment (`Map<elementId, portableScript>`). */
  mapByElementIds(elementIds = []) {
    const rawMap = this.scripts.listByElementIds(elementIds);
    const out = new Map();
    for (const [id, row] of rawMap.entries()) out.set(id, toPortableElementScript(row));
    return out;
  }

  /**
   * Fetches a pinned public CDN module over HTTPS, checking every redirect hop against `ALLOWED_PUBLIC_SCRIPT_ORIGINS`,
   * enforcing a strict byte ceiling, and computing/verifying its cryptographic `sha384-...` SRI hash.
   */
  async #fetchAndComputeSri(imp) {
    if (typeof this.fetchImpl !== 'function') {
      throw new DomainError('Fetch implementation is unavailable on this runtime to compute SRI hashes', 'UNAVAILABLE', 503);
    }
    let currentUrl = imp.url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(currentUrl);
      if (parsed.protocol !== 'https:' || !ALLOWED_PUBLIC_SCRIPT_ORIGINS.includes(parsed.origin)) {
        throw new ValidationError(`CDN redirect for "${imp.package}@${imp.version}" left allowlisted origins ("${parsed.origin}") and was blocked`);
      }
      const res = await this.fetchImpl(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
        headers: { accept: 'application/javascript, text/javascript, */*;q=0.8' }
      });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers?.get?.('location');
        if (!loc) throw new ValidationError(`CDN redirect for "${imp.package}@${imp.version}" had no Location header`);
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      if (!res.ok) {
        throw new ValidationError(`Failed to fetch public package "${imp.package}@${imp.version}" from ${currentUrl} (HTTP ${res.status})`);
      }
      const chunks = [];
      let total = 0;
      if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
        for await (const chunk of res.body) {
          const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += b.length;
          if (total > SCRIPT_FETCH_MAX_BYTES) {
            throw new ValidationError(`Public package "${imp.package}@${imp.version}" exceeds maximum allowed size (${SCRIPT_FETCH_MAX_BYTES} bytes)`);
          }
          chunks.push(b);
        }
      } else {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > SCRIPT_FETCH_MAX_BYTES) {
          throw new ValidationError(`Public package "${imp.package}@${imp.version}" exceeds maximum allowed size (${SCRIPT_FETCH_MAX_BYTES} bytes)`);
        }
        chunks.push(Buffer.from(ab));
      }
      const bytes = Buffer.concat(chunks);
      const algo = imp.integrity ? imp.integrity.split('-')[0] : 'sha384';
      const computed = computeSriHash(bytes, algo);
      if (imp.integrity && imp.integrity !== computed) {
        const err = new ValidationError(
          `Subresource Integrity mismatch for "${imp.package}@${imp.version}": expected ${imp.integrity}, downloaded ${computed}`
        );
        err.code = 'SRI_MISMATCH';
        throw err;
      }
      return { ...imp, integrity: computed };
    }
    throw new ValidationError(`Too many redirects while resolving "${imp.package}@${imp.version}"`);
  }

  /** Dry-run validation + optional live CDN SRI hash computation/verification. */
  async verify(spec, { lockfilePackages = null, verifyIntegrity = false, requireIntegrity = false, humanApproved = false } = {}) {
    let normalized = normalizeElementScriptSpec(spec, {
      requireIntegrity: requireIntegrity && !verifyIntegrity,
      lockfilePackages,
      humanApproved
    });
    if (verifyIntegrity && normalized.imports.length > 0) {
      const verifiedImports = [];
      for (const imp of normalized.imports) {
        verifiedImports.push(await this.#fetchAndComputeSri(imp));
      }
      normalized = normalizeElementScriptSpec({ ...spec, imports: verifiedImports }, {
        requireIntegrity: true,
        lockfilePackages,
        humanApproved
      });
    }
    return {
      valid: true,
      script: toPortableElementScript(normalized),
      audit: normalized.audit
    };
  }

  /** Synchronous validation + save (safe inside SQLite transactions such as changesets and item CRUD). */
  setSync(idOrKey, spec, { actor = null, actorId = null, checkEditable = false, requireIntegrity = false, lockfilePackages = null, humanApproved = false } = {}) {
    const el = checkEditable ? this.elements.requireEditable(idOrKey, actor) : this.#resolveElement(idOrKey);
    const normalized = normalizeElementScriptSpec(spec, { requireIntegrity, lockfilePackages, humanApproved });
    const saved = this.scripts.upsert(el.id, normalized, { actorId: actorId ?? actor?.id ?? null });
    return toPortableElementScript(saved);
  }

  /** Async validation + optional CDN SRI computation/verification, then atomic persistence outside network I/O. */
  async set(idOrKey, spec, { actor = null, actorId = null, checkEditable = true, verifyIntegrity = false, requireIntegrity = false, lockfilePackages = null, humanApproved = false } = {}) {
    const el = checkEditable ? this.elements.requireEditable(idOrKey, actor) : this.#resolveElement(idOrKey);
    let finalSpec = spec;
    if (verifyIntegrity) {
      const preliminary = normalizeElementScriptSpec(spec, { requireIntegrity: false, lockfilePackages, humanApproved });
      if (preliminary.imports.length > 0) {
        const verifiedImports = [];
        for (const imp of preliminary.imports) {
          verifiedImports.push(await this.#fetchAndComputeSri(imp));
        }
        finalSpec = { ...spec, imports: verifiedImports };
      }
    }
    const normalized = normalizeElementScriptSpec(finalSpec, {
      requireIntegrity: requireIntegrity || verifyIntegrity,
      lockfilePackages,
      humanApproved
    });
    const saved = this.scripts.upsert(el.id, normalized, { actorId: actorId ?? actor?.id ?? null });
    return toPortableElementScript(saved);
  }

  /** Verifies/computes SRI hashes for all public imports of an already-saved element script and persists them. */
  async verifyStoredSri(idOrKey, { actor = null, checkEditable = true, lockfilePackages = null } = {}) {
    const el = checkEditable ? this.elements.requireEditable(idOrKey, actor) : this.#resolveElement(idOrKey);
    const cur = this.scripts.getByElementId(el.id);
    if (!cur) throw new NotFoundError('element_script', el.key || el.id);
    const humanApproved = cur.reviewStatus === 'approved';
    return this.set(el.id, cur, {
      actor,
      checkEditable: false,
      verifyIntegrity: true,
      requireIntegrity: true,
      lockfilePackages,
      humanApproved
    });
  }

  remove(idOrKey, { actor = null, checkEditable = true } = {}) {
    const el = checkEditable ? this.elements.requireEditable(idOrKey, actor) : this.#resolveElement(idOrKey);
    const removed = this.scripts.removeByElementId(el.id);
    return { removed, elementId: el.id, key: el.key };
  }

  copy(fromElementId, toElementId, { actorId = null } = {}) {
    const copied = this.scripts.copy(fromElementId, toElementId, { actorId });
    return toPortableElementScript(copied);
  }

  /** Builds the ready-to-render sandboxed iframe HTML (`srcdoc`), CSP, and `iframeAttributes` for an element. */
  buildSandbox(idOrKey, { style, animated = true, props = {}, actor = null, checkAccess = false, nonce } = {}) {
    const el = this.#resolveElement(idOrKey);
    if (checkAccess) this.elements.assertCanRead(el, actor);
    const row = this.scripts.getByElementId(el.id);
    if (!row) throw new NotFoundError('element_script', el.key || el.id);

    const styleKey = style || this.settings?.get?.()?.theme || 'liquid';
    const themeObj = this.themes?.list?.()?.find?.(t => t.key === styleKey) || this.themes?.list?.()?.[0] || { key: styleKey, tokens: {} };
    const tokens = typeof themeObj.tokens === 'string' ? (() => { try { return JSON.parse(themeObj.tokens); } catch { return {}; } })() : (themeObj.tokens || {});
    const svgMarkup = this.exporter ? this.exporter.svgFile('element', el.id, { theme: themeObj.key || styleKey, animated }).content : '';

    return {
      element: { id: el.id, uid: el.uid || null, key: el.key, name: el.name, width: el.width, height: el.height },
      style: themeObj.key || styleKey,
      ...buildSandboxedElementHtml({
        element: el,
        script: row,
        styleKey: themeObj.key || styleKey,
        tokens,
        svgMarkup,
        props,
        ...(nonce ? { nonce } : {})
      })
    };
  }
}
