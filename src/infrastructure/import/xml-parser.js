/**
 * Tiny, dependency-free XML/SVG parser: enough for well-formed SVG (elements, attributes, text, comments, CDATA,
 * the five predefined entities and numeric references). Returns { tag, attrs, children, text } nodes.
 */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});

export function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { addText(stack, src.slice(i)); break; }
    if (lt > i) addText(stack, src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const e = src.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const e = src.indexOf(']]>', lt); const body = src.slice(lt + 9, e < 0 ? n : e); addText(stack, body, true); i = e < 0 ? n : e + 3; continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { const e = src.indexOf('>', lt); i = e < 0 ? n : e + 1; continue; }
    const gt = findTagEnd(src, lt);
    if (gt < 0) throw new Error('unterminated tag at ' + lt);
    const raw = src.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)([\s\S]*)$/.exec(body.trim());
    if (!m) continue;
    const node = { tag: m[1].replace(/^\w+:/, ''), attrs: parseAttrs(m[2]), children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  const svg = root.children.find(c => c.tag === 'svg');
  if (!svg) throw new Error('no <svg> root element found');
  return svg;
}

function addText(stack, text, raw = false) {
  const t = raw ? text : decode(text);
  stack[stack.length - 1].text += t;
}

function findTagEnd(src, from) {
  let q = null;
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '>') return i;
  }
  return -1;
}

function parseAttrs(s) {
  const out = {};
  const re = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s))) out[m[1].replace(/^xlink:/, '')] = decode(m[2] ?? m[3] ?? '');
  return out;
}
