/**
 * Online icon sources panel (library > Icons > "Online"): browse / search the free Iconify API sets (Tabler, Lucide, Line MD,
 * SVG Spinners, Meteocons, Devicon, brands...) and import SVG icons, a selection, or a whole set (capped at 10 000).
 * Results are PAGED: only the current page is drawn, and the 2 previous and the 1 next page are pre-cached.
 */
import { h, clear, debounce, toast, confirmBox } from '../dom.js';
import { api } from '../api.js';
import { reloadLibrary } from '../actions.js';

const PAGE = 60, PREV = 2, NEXT = 1, SET_CAP = 10000;
const svgSrc = (prefix, name) => `/api/online/svg?prefix=${encodeURIComponent(prefix)}&name=${encodeURIComponent(name)}&color=79C8FF`;

export function buildOnlinePanel({ onImported = () => {}, onUnavailable = () => {} } = {}) {
  let sets = [], prefix = '', q = '', page = 0, total = 0, seq = 0;
  const cache = new Map();                  // page -> Promise<{icons,total}> ; pruned to [page-PREV, page+NEXT]
  const picked = new Set();                 // "prefix:name"
  const root = h('div', { class: 'online-panel' });
  const setSel = h('select', { 'aria-label': 'Icon set', style: { maxWidth: '100%' } });
  const search = h('input', { type: 'search', placeholder: 'Search icons online (e.g. home, spinner, docker)…', 'aria-label': 'Search online icons', class: 'grow' });
  const info = h('div', { class: 'dim', style: { fontSize: '11px' } });
  const grid = h('div', { class: 'grid-icons online-grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))' } });
  const pager = h('div', { class: 'row', style: { alignItems: 'center', gap: '6px' } });
  const status = h('span', { class: 'dim', style: { fontSize: '11px' } });

  const fetchPage = p => {
    if (!cache.has(p)) cache.set(p, api.get(`/api/online/search?${new URLSearchParams({ q, prefix, start: p * PAGE, limit: PAGE })}`).catch(e => { cache.delete(p); throw e; }));
    return cache.get(p);
  };
  const prune = () => { for (const k of [...cache.keys()]) if (k < page - PREV || k > page + NEXT) cache.delete(k); };
  const prefetch = () => {
    const last = Math.max(0, Math.ceil(total / PAGE) - 1);
    for (let p = Math.max(0, page - PREV); p <= Math.min(last, page + NEXT); p++) if (p !== page) fetchPage(p).catch(() => {});
  };

  const paintPager = () => {
    clear(pager);
    const pages = Math.max(1, Math.ceil(total / PAGE));
    pager.append(
      h('button', { class: 'btn small', disabled: page <= 0, onclick: () => go(page - 1), 'aria-label': 'Previous page' }, '‹'),
      h('span', { class: 'dim' }, `page ${page + 1} / ${pages} · ${total} icons`),
      h('button', { class: 'btn small', disabled: page + 1 >= pages, onclick: () => go(page + 1), 'aria-label': 'Next page' }, '›'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn small', disabled: !picked.size, onclick: importPicked }, `Import selected (${picked.size})`)
    );
  };

  const paintGrid = icons => {
    clear(grid);
    if (!icons.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, q || prefix ? 'No icons match.' : 'Pick a set or type a search.'));
    for (const ic of icons) {
      const on = picked.has(ic.id);
      grid.append(h('div', {
        class: `cell${on ? ' sel' : ''}`, title: `${ic.id}\n(click to select, double-click to import now)`,
        onclick: e => { if (picked.has(ic.id)) picked.delete(ic.id); else picked.add(ic.id); e.currentTarget.classList.toggle('sel'); paintPager(); },
        ondblclick: () => importList([ic.id])
      }, h('img', { src: svgSrc(ic.prefix, ic.name), alt: ic.name, loading: 'lazy', style: { width: '36px', height: '36px', objectFit: 'contain' } }),
      h('span', { class: 'lbl', style: { fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' } }, ic.name)));
    }
  };

  async function go(p) {
    const my = ++seq;
    page = Math.max(0, p);
    prune();
    status.textContent = 'loading…';
    try {
      if (!q && !prefix) { total = 0; paintGrid([]); paintPager(); status.textContent = ''; return; }
      const r = await fetchPage(page);
      if (my !== seq) return;
      total = r.total; paintGrid(r.icons); paintPager(); status.textContent = ''; grid.parentElement && (grid.parentElement.scrollTop = 0);
      prefetch();
    } catch (e) { if (my === seq) { status.textContent = ''; paintGrid([]); toast(e.message || 'online source unreachable', 'error'); } }
  }
  const reset = () => { cache.clear(); go(0); };

  async function importList(ids) {
    const by = new Map();
    for (const id of ids) { const [p, n] = id.split(':'); (by.get(p) || by.set(p, []).get(p)).push(n); }
    status.textContent = 'importing…';
    try {
      let imp = 0, skip = 0, fail = 0;
      for (const [p, names] of by) { const r = await api.post('/api/online/import', { prefix: p, names }); imp += r.imported; skip += r.skipped; fail += r.failed; }
      toast(`Imported ${imp} icon(s)${skip ? `, ${skip} already in the library` : ''}${fail ? `, ${fail} failed` : ''}`, fail && !imp ? 'error' : 'ok', 2600);
      picked.clear(); paintPager(); await reloadLibrary(); onImported();
    } catch (e) { toast(e.message || 'import failed', 'error'); } finally { status.textContent = ''; }
  }
  const importPicked = () => importList([...picked]);

  async function importWholeSet() {
    if (!prefix) return toast('Pick a set first', 'info');
    const s = sets.find(x => x.prefix === prefix);
    const n = s?.total || 0;
    const ok = await confirmBox(`Import "${s?.title || prefix}"? ${n} icons${n > SET_CAP ? ` — only the first ${SET_CAP} are imported` : ''}. Licence: ${s?.license || 'see source'}. This can take a while.`, { okLabel: 'Import', danger: false });
    if (!ok) return;
    status.textContent = `importing ${Math.min(n, SET_CAP)} icons…`;
    try {
      const r = await api.post('/api/online/import-set', { prefix, max: SET_CAP });
      toast(`${s?.title || prefix}: ${r.imported} imported, ${r.skipped} existing${r.failed ? `, ${r.failed} failed` : ''}${r.truncated ? ` (capped at ${SET_CAP})` : ''}`, r.failed && !r.imported ? 'error' : 'ok', 4000);
      await reloadLibrary(); onImported();
    } catch (e) { toast(e.message || 'import failed', 'error'); } finally { status.textContent = ''; }
  }

  const paintSets = () => {
    clear(setSel);
    setSel.append(h('option', { value: '' }, 'All sets (search only)'));
    const feat = sets.filter(s => s.featured), rest = sets.filter(s => !s.featured);
    const opt = s => h('option', { value: s.prefix }, `${s.title} · ${s.total}${s.palette ? ' · colour' : ''}`);
    setSel.append(h('optgroup', { label: 'Featured' }, ...feat.map(opt)), h('optgroup', { label: `All sets (${rest.length})` }, ...rest.map(opt)));
    setSel.value = prefix;
  };
  const paintInfo = () => {
    const s = sets.find(x => x.prefix === prefix);
    info.textContent = s ? `${s.title} · ${s.total} icons · ${s.license || 'licence: see source'}${s.author ? ` · ${s.author}` : ''} — only SVG vectors; animated sets import as static geometry.` : 'Free Iconify API: 150+ open icon sets (SVG only).';
  };
  setSel.addEventListener('change', () => { prefix = setSel.value; picked.clear(); paintInfo(); reset(); });
  search.addEventListener('input', debounce(() => { q = search.value.trim(); picked.clear(); reset(); }, 300));

  root.append(
    h('div', { class: 'row', style: { gap: '6px' } }, setSel),
    h('div', { class: 'row', style: { gap: '6px' } }, search, h('button', { class: 'btn small', title: 'Import every icon of the chosen set (max 10 000)', onclick: importWholeSet }, 'Import whole set')),
    info, pager, status, h('div', { class: 'lib-scroll' }, grid)
  );
  paintInfo(); paintPager(); paintGrid([]);
  api.get('/api/online/collections').then(r => { sets = r.collections || []; paintSets(); paintInfo(); }).catch(() => { toast('Online icon source is unavailable: it was removed from the library', 'info', 3000); onUnavailable(); });
  return root;
}
