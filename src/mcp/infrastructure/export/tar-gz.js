/**
 * Minimal POSIX ustar writer + gzip (node:zlib), no dependencies. Regular files only; directories are
 * implied by the paths, which every tar implementation (GNU tar, bsdtar, Windows tar.exe) accepts.
 */
import { gzipSync } from 'node:zlib';

const BLOCK = 512;
const enc = new TextEncoder();

function octal(n, width) { return n.toString(8).padStart(width - 1, '0') + '\0'; }

function writeStr(buf, offset, width, str) {
  const bytes = enc.encode(str);
  if (bytes.length > width) throw new Error(`tar field too long: ${str}`);
  buf.set(bytes, offset);
}

/** Splits a path into ustar name (≤100 bytes) and prefix (≤155 bytes). */
function splitPath(path) {
  if (enc.encode(path).length <= 100) return { name: path, prefix: '' };
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    const prefix = path.slice(0, i), name = path.slice(i + 1);
    if (enc.encode(name).length <= 100 && enc.encode(prefix).length <= 155) return { name, prefix };
  }
  throw new Error(`path too long for ustar: ${path}`);
}

function header(path, size, mtime) {
  const h = new Uint8Array(BLOCK);
  const { name, prefix } = splitPath(path);
  writeStr(h, 0, 100, name);
  writeStr(h, 100, 8, '0000644\0');
  writeStr(h, 108, 8, '0000000\0');
  writeStr(h, 116, 8, '0000000\0');
  writeStr(h, 124, 12, octal(size, 12));
  writeStr(h, 136, 12, octal(mtime, 12));
  writeStr(h, 148, 8, '        ');           // checksum placeholder (spaces)
  h[156] = '0'.charCodeAt(0);                 // regular file
  writeStr(h, 257, 6, 'ustar\0');
  writeStr(h, 263, 2, '00');
  writeStr(h, 265, 32, 'kyrpy');
  writeStr(h, 297, 32, 'kyrpy');
  writeStr(h, 345, 155, prefix);
  const sum = h.reduce((a, b) => a + b, 0);
  writeStr(h, 148, 8, `${sum.toString(8).padStart(6, '0')}\0 `);
  return h;
}

/** Normalizes and validates an archive path: relative, forward slashes, no '..' or empty segments. */
export function safeArchivePath(p) {
  const s = String(p).replace(/\\/g, '/');
  if (!s || s.startsWith('/') || s.split('/').some(seg => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`unsafe archive path: ${p}`);
  }
  return s;
}

/**
 * @param {{path: string, content: string|Uint8Array}[]} files
 * @returns {Buffer} gzip-compressed tar
 */
export function tarGz(files, { mtime = Math.floor(Date.now() / 1000) } = {}) {
  const parts = [];
  const seen = new Set();
  for (const f of files) {
    const path = safeArchivePath(f.path);
    if (seen.has(path)) throw new Error(`duplicate archive path: ${path}`);
    seen.add(path);
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
    parts.push(header(path, data.length, mtime), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return gzipSync(Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength))), { level: 9 });
}
