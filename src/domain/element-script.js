/**
 * Sandboxed custom JavaScript & verified public JS dependency domain model for UI Elements.
 *
 * Security invariants:
 *  1. Canvas Isolation: Designer canvas always renders static/animated SVG (`nodes`); custom JS NEVER executes
 *     on the Designer's authenticated origin (`design.kyrpy.kyrpy.com`).
 *  2. Opaque-Origin Sandbox: Live previews and HTML viewers execute element scripts strictly inside
 *     `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` (NEVER `allow-same-origin`), so
 *     `window.origin === "null"` and cookies / CSRF tokens / localStorage / `/api/*` are unreachable.
 *  3. Tight Content-Security-Policy (CSP): Per-frame cryptographic nonce, `default-src 'none'`,
 *     `connect-src 'none'` by default (blocking network exfiltration), and `script-src` restricted solely
 *     to `'nonce-<nonce>'` plus the exact allowlisted CDN origins referenced by pinned `imports`.
 *  4. Supply-Chain Controls for Public JS:
 *     - Allowlisted HTTPS ESM CDNs only (`cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`).
 *     - Exact semver required (`x.y.z`; `latest`, `*`, `^`, `~`, ranges, and git refs are rejected).
 *     - URL path must contain `<package>@<version>` (prevents package/URL mismatch).
 *     - Subresource Integrity (`sha384-...` / `sha512-...`) emitted in both `<link rel="modulepreload">`
 *       and standard HTML `<script type="importmap">` `integrity` maps.
 *     - Optional target-repo lockfile allowlist (`lockfilePackages`) for reverse-engineering workflows.
 */
import { createHash, randomBytes } from 'node:crypto';
import { ValidationError } from './errors.js';

export const ALLOWED_PUBLIC_SCRIPT_ORIGINS = Object.freeze([
  'https://cdn.jsdelivr.net',
  'https://esm.sh',
  'https://unpkg.com'
]);

export const SCRIPT_RUNTIMES = Object.freeze(['esm', 'declarative']);
export const SCRIPT_REVIEW_STATUSES = Object.freeze(['verified', 'needs-sri', 'needs-human-review', 'approved']);

export const SCRIPT_MAX_BYTES = 64 * 1024;
export const SCRIPT_MAX_IMPORTS = 16;
export const SCRIPT_MAX_PROPS = 50;
export const SCRIPT_MAX_EMITS = 30;
export const SCRIPT_FETCH_MAX_BYTES = 2 * 1024 * 1024;

export const EXACT_SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const NPM_PKG_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
export const SRI_HASH_RE = /^sha(256|384|512)-[A-Za-z0-9+/]{43,}={0,2}$/;
export const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const BLOCKED_CODE_RULES = Object.freeze([
  { code: 'DYNAMIC_EVAL', re: /\beval\s*\(/, message: 'eval() is forbidden in element scripts; use pure ES module functions.' },
  { code: 'DYNAMIC_FUNCTION', re: /\bnew\s+Function\s*\(/, message: 'new Function() is forbidden in element scripts.' },
  { code: 'STRING_TIMER', re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/, message: 'setTimeout/setInterval with a string argument acts like eval() and is forbidden.' },
  { code: 'COOKIE_ACCESS', re: /\bdocument\s*\.\s*cookie\b/, message: 'Accessing document.cookie is forbidden; element scripts run in an opaque sandbox.' },
  { code: 'PARENT_DOM', re: /\b(?:parent|top|opener)\s*\.\s*(?:document|location|localStorage|sessionStorage|eval|Function)\b/, message: 'Accessing parent/top window DOM or storage is forbidden; use bridge.emit(event, detail) to communicate.' },
  { code: 'HOST_STORAGE', re: /\b(?:localStorage|sessionStorage|indexedDB)\b/, message: 'Browser persistent storage (localStorage/sessionStorage/indexedDB) is unavailable in opaque sandboxes; pass state through props and bridge.emit().' },
  { code: 'SCRIPT_URL', re: /\b(?:javascript|vbscript)\s*:/i, message: 'javascript:/vbscript: URLs are forbidden.' },
  { code: 'DATA_HTML_URL', re: /\bdata\s*:\s*text\/html/i, message: 'data:text/html URLs are forbidden inside element scripts.' },
  { code: 'DOCUMENT_WRITE', re: /\bdocument\s*\.\s*writeln?\s*\(/, message: 'document.write() is forbidden; mount into the provided container element.' }
]);

const PRIVATE_HOST_RE = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|\[?::1\]?|\[?fe80:[^\]]*\]?|\[?fc00:[^\]]*\]?|\[?fd[0-9a-f]{2}:[^\]]*\]?)$/i;

const sha256Hex = text => createHash('sha256').update(String(text || ''), 'utf8').digest('hex');

export function computeSriHash(bufferOrString, algorithm = 'sha384') {
  if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) {
    throw new ValidationError('SRI hash algorithm must be sha256, sha384, or sha512');
  }
  const buf = Buffer.isBuffer(bufferOrString) ? bufferOrString : Buffer.from(String(bufferOrString), 'utf8');
  return `${algorithm}-${createHash(algorithm).update(buf).digest('base64')}`;
}

/** Policy reference exposed via MCP (`uiux_element_script { action: "policy" }`) and schema docs. */
export const ELEMENT_SCRIPT_POLICY = Object.freeze({
  sandbox: {
    iframeSandbox: 'allow-scripts',
    referrerPolicy: 'no-referrer',
    allowSameOrigin: false,
    communication: 'window.postMessage via bridge.emit(event, detail) only (validated against declared emits[])'
  },
  cspDefaults: {
    defaultSrc: "'none'",
    scriptSrc: "'nonce-<per-render>' + exact allowlisted CDN origins referenced in imports[]",
    connectSrc: "'none' (network exfiltration blocked by default)",
    styleSrc: "'unsafe-inline'",
    imgSrc: 'data: blob:',
    objectSrc: "'none'",
    frameSrc: "'none'",
    formAction: "'none'"
  },
  publicJsRules: {
    allowedOrigins: ALLOWED_PUBLIC_SCRIPT_ORIGINS,
    versioning: 'Exact semver (x.y.z) required; floating tags ("latest", "*", "^", "~") are rejected',
    urlBinding: 'CDN URL must be HTTPS on an allowlisted origin and include <package>@<version> in its path',
    subresourceIntegrity: 'sha384-... (or sha512-...) SRI hash verified and emitted in importmap integrity + modulepreload',
    lockfileSupport: 'Pass lockfilePackages ({ "pkg": "x.y.z" }) during reverse engineering to restrict imports to packages already trusted by the target repository'
  },
  limits: {
    maxCodeBytes: SCRIPT_MAX_BYTES,
    maxImports: SCRIPT_MAX_IMPORTS,
    maxProps: SCRIPT_MAX_PROPS,
    maxEmits: SCRIPT_MAX_EMITS
  },
  moduleTemplate: [
    '// Export mount(container, props, bridge) — runs inside <iframe sandbox="allow-scripts">',
    'export function mount(container, props, bridge) {',
    '  const btn = document.createElement("button");',
    '  btn.className = "uiux-custom-btn";',
    '  btn.textContent = props.label || "Interact";',
    '  btn.addEventListener("click", () => bridge.emit("select", { value: props.value ?? 1 }));',
    '  container.replaceChildren(btn);',
    '  return () => btn.remove();',
    '}'
  ].join('\n')
});

/** Extracts static and dynamic module import specifiers from JS module text for policy auditing. */
export function extractModuleSpecifiers(code) {
  const src = String(code || '');
  const found = new Set();
  const staticRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicRe = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  let m;
  while ((m = staticRe.exec(src)) !== null) found.add(m[1].trim());
  while ((m = dynamicRe.exec(src)) !== null) found.add(m[1].trim());
  return [...found].filter(Boolean);
}

/**
 * Static security & contract audit of custom element ES module code.
 * Does not execute the code; returns `{ ok, bytes, codeHash, errors, warnings, detectedImports }`.
 */
export function auditElementScriptCode(code, { entryExport = 'mount', declaredImports = [] } = {}) {
  const errors = [];
  const warnings = [];
  if (typeof code !== 'string') {
    return {
      ok: false,
      bytes: 0,
      codeHash: sha256Hex(''),
      errors: [{ code: 'TYPE', message: 'moduleCode must be a string' }],
      warnings,
      detectedImports: []
    };
  }
  const bytes = Buffer.byteLength(code, 'utf8');
  if (bytes > SCRIPT_MAX_BYTES) {
    errors.push({ code: 'SIZE', message: `moduleCode is ${bytes} bytes; maximum allowed is ${SCRIPT_MAX_BYTES} bytes` });
  }
  if (!IDENT_RE.test(String(entryExport || ''))) {
    errors.push({ code: 'ENTRY_EXPORT', message: `entryExport "${entryExport}" must be a valid JavaScript identifier (default "mount")` });
  }

  for (const rule of BLOCKED_CODE_RULES) {
    if (rule.re.test(code)) {
      errors.push({ code: rule.code, message: rule.message });
    }
  }

  const detectedImports = extractModuleSpecifiers(code);
  const declaredSpecifiers = new Set(
    (Array.isArray(declaredImports) ? declaredImports : [])
      .flatMap(imp => [imp?.specifier, imp?.package, imp?.url])
      .filter(Boolean)
  );

  for (const spec of detectedImports) {
    if (/^https?:\/\//i.test(spec)) {
      let parsed = null;
      try { parsed = new URL(spec); } catch { parsed = null; }
      if (!parsed || parsed.protocol !== 'https:' || !ALLOWED_PUBLIC_SCRIPT_ORIGINS.includes(parsed.origin)) {
        errors.push({
          code: 'UNTRUSTED_IMPORT_URL',
          message: `Direct URL import "${spec}" is not on an allowlisted HTTPS CDN (${ALLOWED_PUBLIC_SCRIPT_ORIGINS.join(', ')}); declare pinned packages in imports[] instead.`
        });
      } else if (!declaredSpecifiers.has(spec)) {
        errors.push({
          code: 'UNDECLARED_URL_IMPORT',
          message: `Direct CDN import "${spec}" must be declared in imports[] with exact package@version and SRI integrity.`
        });
      }
    } else if (!spec.startsWith('./') && !spec.startsWith('../')) {
      if (spec.startsWith('/')) {
        errors.push({
          code: 'HOST_PATH_IMPORT',
          message: `Root-relative import "${spec}" is forbidden in sandboxed element scripts.`
        });
      } else if (declaredSpecifiers.size > 0 && !declaredSpecifiers.has(spec)) {
        errors.push({
          code: 'UNDECLARED_BARE_IMPORT',
          message: `Bare module specifier "${spec}" is imported in moduleCode but missing from imports[].`
        });
      } else if (declaredSpecifiers.size === 0) {
        errors.push({
          code: 'UNDECLARED_BARE_IMPORT',
          message: `Bare module specifier "${spec}" requires a matching entry in imports[] with exact semver.`
        });
      }
    } else {
      errors.push({
        code: 'RELATIVE_IMPORT',
        message: `Relative file import "${spec}" cannot resolve inside a standalone sandboxed element; inline helper functions or declare a public package in imports[].`
      });
    }
  }

  if (code.trim()) {
    const exportRe = new RegExp(
      `\\bexport\\s+(?:async\\s+)?(?:function|const|let|class)\\s+${entryExport}\\b|\\bexport\\s*\\{[^}]*\\b${entryExport}\\b|\\bexport\\s+default\\b`
    );
    if (!exportRe.test(code)) {
      warnings.push({
        code: 'MISSING_ENTRY_EXPORT',
        message: `moduleCode does not appear to export "${entryExport}(container, props, bridge)"; ensure it exports ${entryExport} or default.`
      });
    }
  }

  return {
    ok: errors.length === 0,
    bytes,
    codeHash: sha256Hex(code),
    errors,
    warnings,
    detectedImports
  };
}

function parseLockfileMap(lockfilePackages) {
  if (!lockfilePackages) return null;
  const map = new Map();
  if (Array.isArray(lockfilePackages)) {
    for (const item of lockfilePackages) {
      const s = String(item || '').trim();
      const at = s.lastIndexOf('@');
      if (at > 0) map.set(s.slice(0, at), s.slice(at + 1));
    }
    return map;
  }
  if (typeof lockfilePackages === 'object') {
    for (const [pkg, ver] of Object.entries(lockfilePackages)) {
      if (typeof ver === 'string' && ver.trim()) map.set(pkg.trim(), ver.trim().replace(/^[=v]/, ''));
    }
    return map;
  }
  return null;
}

function cleanSubpath(subpath) {
  if (subpath === undefined || subpath === null || subpath === '') return '';
  const s = String(subpath).trim().replace(/^\/+/, '');
  if (!s) return '';
  if (s.includes('..') || s.includes('\\') || /^[a-z]+:/i.test(s) || /[\u0000-\u001f\s?#]/.test(s)) {
    throw new ValidationError(`Invalid import subpath "${subpath}"`);
  }
  return s;
}

/**
 * Validates and canonicalizes public JS package imports.
 * Enforces allowlisted HTTPS CDNs, exact semver, `<package>@<version>` URL binding, optional lockfile matching, and SRI format.
 */
export function normalizePublicScriptImports(imports = [], { requireIntegrity = false, lockfilePackages = null } = {}) {
  if (imports === undefined || imports === null) return [];
  if (!Array.isArray(imports)) throw new ValidationError('imports must be an array of public package descriptors');
  if (imports.length > SCRIPT_MAX_IMPORTS) {
    throw new ValidationError(`At most ${SCRIPT_MAX_IMPORTS} public JS imports may be attached to one element`);
  }
  const lockMap = parseLockfileMap(lockfilePackages);
  const seenSpecifiers = new Set();

  return imports.map((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new ValidationError(`imports[${idx}] must be an object ({ package, version, specifier?, subpath?, url?, integrity? })`);
    }
    const pkg = String(raw.package ?? raw.name ?? '').trim();
    if (!NPM_PKG_NAME_RE.test(pkg)) {
      throw new ValidationError(`imports[${idx}].package "${pkg}" is not a valid npm package name`);
    }
    const version = String(raw.version ?? '').trim();
    if (!EXACT_SEMVER_RE.test(version)) {
      throw new ValidationError(`imports[${idx}].version "${version}" for "${pkg}" must be an exact semver (for example "4.4.6"); floating tags like "latest" or "^" ranges are forbidden`);
    }
    if (lockMap) {
      if (!lockMap.has(pkg)) {
        throw new ValidationError(`imports[${idx}] package "${pkg}" is not present in the provided lockfilePackages allowlist`);
      }
      const lockedVer = lockMap.get(pkg);
      if (lockedVer !== version) {
        throw new ValidationError(`imports[${idx}] "${pkg}@${version}" does not match lockfile version "${lockedVer}"`);
      }
    }

    const subpath = cleanSubpath(raw.subpath);
    const specifier = String(raw.specifier || (subpath ? `${pkg}/${subpath}` : pkg)).trim();
    if (!specifier || specifier.startsWith('/') || specifier.startsWith('.') || /^https?:/i.test(specifier) || /\s/.test(specifier)) {
      throw new ValidationError(`imports[${idx}].specifier "${specifier}" must be a bare module specifier (for example "${pkg}")`);
    }
    if (seenSpecifiers.has(specifier)) {
      throw new ValidationError(`Duplicate import specifier "${specifier}" in imports[]`);
    }
    seenSpecifiers.add(specifier);

    const defaultUrl = subpath
      ? `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${subpath}`
      : `https://cdn.jsdelivr.net/npm/${pkg}@${version}/+esm`;
    const urlText = String(raw.url || defaultUrl).trim();
    let parsed;
    try { parsed = new URL(urlText); } catch {
      throw new ValidationError(`imports[${idx}].url "${urlText}" is not a valid URL`);
    }
    if (parsed.protocol !== 'https:') {
      throw new ValidationError(`imports[${idx}].url must use https:`);
    }
    if (parsed.username || parsed.password) {
      throw new ValidationError(`imports[${idx}].url must not contain credentials`);
    }
    if (!ALLOWED_PUBLIC_SCRIPT_ORIGINS.includes(parsed.origin)) {
      throw new ValidationError(`imports[${idx}].url origin "${parsed.origin}" is not allowed; allowed public CDNs: ${ALLOWED_PUBLIC_SCRIPT_ORIGINS.join(', ')}`);
    }
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (decodedPath.includes('..') || decodedPath.includes('\\')) {
      throw new ValidationError(`imports[${idx}].url contains forbidden path traversal`);
    }
    const expectedToken = `${pkg}@${version}`;
    if (!decodedPath.includes(expectedToken)) {
      throw new ValidationError(`imports[${idx}].url path must include exact "${expectedToken}" to prevent package/version spoofing`);
    }

    const integrity = raw.integrity !== undefined && raw.integrity !== null && String(raw.integrity).trim() !== ''
      ? String(raw.integrity).trim()
      : null;
    if (integrity && !SRI_HASH_RE.test(integrity)) {
      throw new ValidationError(`imports[${idx}].integrity "${integrity}" must be a valid Subresource Integrity hash (sha384-..., sha512-..., or sha256-...)`);
    }
    if (requireIntegrity && !integrity) {
      throw new ValidationError(`imports[${idx}] ("${pkg}@${version}") requires a cryptographic integrity hash (sha384-...) or verifyIntegrity: true`);
    }

    const out = {
      specifier,
      package: pkg,
      version,
      ...(subpath ? { subpath } : {}),
      url: parsed.toString(),
      origin: parsed.origin,
      integrity,
      ...(lockMap ? { lockfileVerified: true } : raw.lockfileVerified ? { lockfileVerified: true } : {}),
      ...(typeof raw.license === 'string' && raw.license.trim() ? { license: raw.license.trim().slice(0, 60) } : {})
    };
    return out;
  });
}

function validateConnectOrigin(rawOrigin) {
  const s = String(rawOrigin || '').trim();
  if (!s || s === '*') throw new ValidationError('Wildcard "*" connect origins are forbidden');
  let u;
  try { u = new URL(s); } catch { throw new ValidationError(`Invalid allowedConnectOrigins entry "${s}"`); }
  if (u.protocol !== 'https:') throw new ValidationError(`allowedConnectOrigins "${s}" must use https:`);
  if (u.username || u.password || (u.pathname && u.pathname !== '/') || u.search || u.hash) {
    throw new ValidationError(`allowedConnectOrigins "${s}" must be a bare HTTPS origin (for example "https://api.example.com")`);
  }
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOST_RE.test(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new ValidationError(`allowedConnectOrigins "${s}" targets a private, loopback, or internal host and is blocked (SSRF protection)`);
  }
  return u.origin;
}

export function normalizeScriptCapabilities(caps = {}) {
  if (caps === null || caps === undefined) caps = {};
  if (typeof caps !== 'object' || Array.isArray(caps)) {
    throw new ValidationError('capabilities must be an object');
  }
  const allowNetwork = Boolean(caps.allowNetwork ?? false);
  const rawOrigins = Array.isArray(caps.allowedConnectOrigins) ? caps.allowedConnectOrigins : [];
  if (rawOrigins.length > 8) throw new ValidationError('At most 8 allowedConnectOrigins may be declared');
  const allowedConnectOrigins = allowNetwork ? [...new Set(rawOrigins.map(validateConnectOrigin))] : [];
  if (allowNetwork && allowedConnectOrigins.length === 0) {
    throw new ValidationError('capabilities.allowNetwork = true requires at least one explicit HTTPS origin in capabilities.allowedConnectOrigins');
  }
  return {
    domOnly: !allowNetwork,
    allowNetwork,
    allowCanvas: caps.allowCanvas !== undefined ? Boolean(caps.allowCanvas) : true,
    allowWebGL: Boolean(caps.allowWebGL ?? false),
    allowTimers: caps.allowTimers !== undefined ? Boolean(caps.allowTimers) : true,
    allowedConnectOrigins
  };
}

function normalizePropsSchema(propsSchema = {}) {
  if (propsSchema === null || propsSchema === undefined) return {};
  if (typeof propsSchema !== 'object' || Array.isArray(propsSchema)) {
    throw new ValidationError('propsSchema must be an object mapping prop names to descriptors');
  }
  const entries = Object.entries(propsSchema);
  if (entries.length > SCRIPT_MAX_PROPS) throw new ValidationError(`propsSchema supports at most ${SCRIPT_MAX_PROPS} properties`);
  const out = {};
  for (const [k, v] of entries) {
    if (!IDENT_RE.test(k)) throw new ValidationError(`propsSchema key "${k}" must be a valid identifier`);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const type = ['string', 'number', 'boolean', 'object', 'array'].includes(v.type) ? v.type : 'string';
      out[k] = {
        type,
        ...(v.default !== undefined ? { default: v.default } : {}),
        ...(typeof v.description === 'string' ? { description: v.description.slice(0, 300) } : {})
      };
    } else {
      out[k] = { type: typeof v === 'string' && ['string', 'number', 'boolean', 'object', 'array'].includes(v) ? v : 'string' };
    }
  }
  return out;
}

function normalizeEmits(emits = []) {
  if (emits === null || emits === undefined) return [];
  if (!Array.isArray(emits)) throw new ValidationError('emits must be an array of event names or descriptors');
  if (emits.length > SCRIPT_MAX_EMITS) throw new ValidationError(`emits supports at most ${SCRIPT_MAX_EMITS} events`);
  const seen = new Set();
  const out = [];
  for (const item of emits) {
    const name = typeof item === 'string' ? item.trim() : String(item?.name || item?.event || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9:_-]{0,63}$/.test(name)) {
      throw new ValidationError(`Invalid emitted event name "${name}"`);
    }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      ...(typeof item === 'object' && item?.action ? { action: String(item.action).slice(0, 40) } : {}),
      ...(typeof item === 'object' && item?.description ? { description: String(item.description).slice(0, 300) } : {})
    });
  }
  return out;
}

/**
 * Full validation & normalization of an element script specification.
 * Throws `ValidationError` if any security, semver, CDN origin, SSRF, or static code check fails.
 */
export function normalizeElementScriptSpec(input = {}, { requireIntegrity = false, lockfilePackages = null, humanApproved = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Element script spec must be an object');
  }
  const runtime = input.runtime ? String(input.runtime).trim() : 'esm';
  if (!SCRIPT_RUNTIMES.includes(runtime)) {
    throw new ValidationError(`script.runtime must be one of ${SCRIPT_RUNTIMES.join(', ')}`);
  }
  const enabled = input.enabled !== undefined ? Boolean(input.enabled) : true;
  const entryExport = input.entryExport ? String(input.entryExport).trim() : 'mount';
  const moduleCode = input.moduleCode !== undefined ? String(input.moduleCode) : String(input.code ?? '');
  const imports = normalizePublicScriptImports(input.imports || [], { requireIntegrity, lockfilePackages });
  const capabilities = normalizeScriptCapabilities(input.capabilities || {});
  const propsSchema = normalizePropsSchema(input.propsSchema || {});
  const emits = normalizeEmits(input.emits || []);

  if (!moduleCode.trim() && imports.length === 0) {
    throw new ValidationError('Element script must provide moduleCode or at least one pinned entry in imports[]');
  }

  const audit = auditElementScriptCode(moduleCode, { entryExport, declaredImports: imports });
  if (!audit.ok) {
    throw new ValidationError(`Element script security check failed: ${audit.errors.map(e => `[${e.code}] ${e.message}`).join('; ')}`);
  }

  const sriVerified = imports.every(imp => Boolean(imp.integrity));
  let reviewStatus = 'verified';
  if (capabilities.allowNetwork) {
    reviewStatus = humanApproved ? 'approved' : 'needs-human-review';
  } else if (!sriVerified) {
    reviewStatus = 'needs-sri';
  }

  return {
    enabled,
    runtime,
    entryExport,
    moduleCode,
    imports,
    capabilities,
    propsSchema,
    emits,
    codeHash: audit.codeHash,
    sriVerified,
    reviewStatus,
    audit: {
      bytes: audit.bytes,
      warnings: audit.warnings,
      detectedImports: audit.detectedImports
    }
  };
}

/** Builds the strict Content-Security-Policy string for a sandboxed element iframe. */
export function buildElementSandboxCsp({ nonce, imports = [], capabilities = {}, reviewStatus = 'verified' } = {}) {
  if (!nonce || !/^[A-Za-z0-9_-]{12,64}$/.test(String(nonce))) {
    throw new ValidationError('A cryptographic nonce is required to build the sandbox CSP');
  }
  const importOrigins = [...new Set(
    (imports || [])
      .map(i => { try { return new URL(i.url).origin; } catch { return null; } })
      .filter(o => o && ALLOWED_PUBLIC_SCRIPT_ORIGINS.includes(o))
  )];
  const scriptSrc = [`'nonce-${nonce}'`, ...importOrigins].join(' ');
  const connectAllowed = capabilities?.allowNetwork && reviewStatus === 'approved' && Array.isArray(capabilities.allowedConnectOrigins) && capabilities.allowedConnectOrigins.length
    ? capabilities.allowedConnectOrigins.map(validateConnectOrigin).join(' ')
    : "'none'";

  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    `connect-src ${connectAllowed}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ');
}

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeJsonForScript = value => JSON.stringify(value ?? null)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
const safeJsForInlineModule = code => String(code || '').replace(/<\/(script)/gi, '<\\/$1');

/**
 * Generates an isolated, CSP-locked HTML document for `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">`.
 * Never grants `allow-same-origin`.
 */
export function buildSandboxedElementHtml({
  element = {},
  script,
  styleKey = 'liquid',
  tokens = {},
  svgMarkup = '',
  props = {},
  nonce = randomBytes(16).toString('base64url')
} = {}) {
  const normalized = script?.codeHash && Array.isArray(script?.imports)
    ? script
    : normalizeElementScriptSpec(script || {});
  const csp = buildElementSandboxCsp({
    nonce,
    imports: normalized.imports,
    capabilities: normalized.capabilities,
    reviewStatus: normalized.reviewStatus
  });

  const flatTokens = Object.entries(tokens || {}).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
  const cssVars = flatTokens
    .map(([k, v]) => `--uiux-${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}:${String(v).replace(/[;<>{}]/g, '')};`)
    .join('');

  const defaultProps = {};
  for (const [k, spec] of Object.entries(normalized.propsSchema || {})) {
    if (spec?.default !== undefined) defaultProps[k] = spec.default;
  }
  const mergedProps = { ...defaultProps, ...(props && typeof props === 'object' ? props : {}) };
  const allowedEmits = (normalized.emits || []).map(e => (typeof e === 'string' ? e : e.name)).filter(Boolean);

  const importMapObj = { imports: {}, integrity: {} };
  for (const imp of normalized.imports || []) {
    importMapObj.imports[imp.specifier] = imp.url;
    if (imp.integrity) importMapObj.integrity[imp.url] = imp.integrity;
  }
  if (!Object.keys(importMapObj.integrity).length) delete importMapObj.integrity;

  const preloads = (normalized.imports || [])
    .filter(imp => imp.integrity)
    .map(imp => `<link rel="modulepreload" href="${escHtml(imp.url)}" integrity="${escHtml(imp.integrity)}" crossorigin="anonymous">`)
    .join('\n');

  const cleanSvg = String(svgMarkup || '')
    .replace(/^<\?xml[^>]*>\s*/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  const width = Number(element.width) || 240;
  const height = Number(element.height) || 64;
  const elementKey = String(element.key || 'element');
  const elementUid = String(element.uid || '');

  const html = `<!doctype html>
<html lang="en" data-style="${escHtml(styleKey)}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escHtml(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(element.name || elementKey)} · sandbox</title>
${preloads}
<style>
:root{${cssVars}color-scheme:dark light;}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;color:var(--uiux-text,#e6edf3);font:14px/1.4 system-ui,-apple-system,sans-serif;overflow:hidden}
#uiux-stage{position:relative;width:100%;height:100%;min-width:${width}px;min-height:${height}px;display:flex;align-items:center;justify-content:center}
#uiux-svg-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0.22;transition:opacity .15s}
#uiux-svg-fallback.only{opacity:1;pointer-events:auto}
#uiux-widget-root{position:relative;z-index:1;width:100%;height:100%}
#uiux-error{display:none;position:absolute;inset:4px;z-index:2;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.14);border:1px solid rgba(220,38,38,.55);color:#fca5a5;font:12px/1.35 ui-monospace,monospace;overflow:auto;white-space:pre-wrap}
</style>
${Object.keys(importMapObj.imports).length ? `<script type="importmap" nonce="${escHtml(nonce)}">${safeJsonForScript(importMapObj)}</script>` : ''}
</head>
<body>
<div id="uiux-stage" data-element-key="${escHtml(elementKey)}">
  <div id="uiux-svg-fallback"${normalized.enabled ? '' : ' class="only"'}>${cleanSvg}</div>
  <div id="uiux-widget-root"></div>
  <pre id="uiux-error" role="alert"></pre>
</div>
<script type="application/json" id="uiux-boot-data">${safeJsonForScript({
    elementKey,
    elementUid,
    styleKey,
    width,
    height,
    enabled: Boolean(normalized.enabled),
    entryExport: normalized.entryExport || 'mount',
    props: mergedProps,
    tokens: Object.freeze({ ...(tokens || {}) }),
    allowedEmits
  })}</script>
${normalized.enabled && normalized.moduleCode.trim() ? `<script type="module" nonce="${escHtml(nonce)}">
${safeJsForInlineModule(normalized.moduleCode)}
;const __boot = JSON.parse(document.getElementById('uiux-boot-data').textContent);
const __root = document.getElementById('uiux-widget-root');
const __svg = document.getElementById('uiux-svg-fallback');
const __err = document.getElementById('uiux-error');
const __allowed = new Set(__boot.allowedEmits || []);
const __bridge = Object.freeze({
  elementKey: __boot.elementKey,
  elementUid: __boot.elementUid,
  style: __boot.styleKey,
  size: Object.freeze({ width: __boot.width, height: __boot.height }),
  theme: Object.freeze(__boot.tokens || {}),
  svgFallback: __svg,
  hideSvgFallback() { if (__svg) __svg.style.display = 'none'; },
  emit(event, detail = null) {
    const name = String(event || '').trim();
    if (!name) return false;
    if (__allowed.size > 0 && !__allowed.has(name)) return false;
    let safeDetail = null;
    try { safeDetail = detail === undefined ? null : JSON.parse(JSON.stringify(detail)); } catch { safeDetail = String(detail); }
    window.parent?.postMessage({ __uiuxSandbox: 1, elementKey: __boot.elementKey, elementUid: __boot.elementUid, event: name, detail: safeDetail }, '*');
    return true;
  }
});
(async () => {
  try {
    const __entry = typeof ${normalized.entryExport} === 'function' ? ${normalized.entryExport} : null;
    if (!__entry) throw new Error('Exported function "' + __boot.entryExport + '(container, props, bridge)" not found');
    await __entry(__root, Object.freeze(__boot.props || {}), __bridge);
    if (__root.childNodes.length > 0 && __svg) __svg.style.display = 'none';
    window.parent?.postMessage({ __uiuxSandbox: 1, elementKey: __boot.elementKey, elementUid: __boot.elementUid, event: '__ready', detail: { ok: true } }, '*');
  } catch (err) {
    if (__svg) __svg.classList.add('only');
    if (__err) { __err.style.display = 'block'; __err.textContent = String(err?.message || err); }
    window.parent?.postMessage({ __uiuxSandbox: 1, elementKey: __boot.elementKey, elementUid: __boot.elementUid, event: '__error', detail: { message: String(err?.message || err) } }, '*');
  }
})();
</script>` : ''}
</body>
</html>
`;

  return {
    html,
    csp,
    nonce,
    sriVerified: normalized.sriVerified,
    reviewStatus: normalized.reviewStatus,
    iframeAttributes: {
      sandbox: 'allow-scripts',
      referrerpolicy: 'no-referrer'
    }
  };
}
