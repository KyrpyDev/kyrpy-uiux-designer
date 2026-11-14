/** Design style picker: every design style as a card that shows a sample design rendered in that style. */
import { matchesSearch, searchTerms, itemSearchFields } from '/domain/search.js';
import { h, modal } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { setTheme } from '../actions.js';
import { openThemeEditor } from './theme-editor.js';

const modeOf = t => t.tokens?.mode || (String(t.key).endsWith('-light') ? 'light' : 'dark');
const SAMPLE_LABEL = { screen: 'Screen', element: 'Element', button: 'Button', icon: 'Icon' };

/** The designs the cards can show: the open item first, then the first screen / element / button / icon of the library. */
export function themeSamples(current, library = state.library) {
  const out = [];
  if (current?.id && SAMPLE_LABEL[current.type]) out.push({ type: current.type, id: current.id, label: `Open ${SAMPLE_LABEL[current.type].toLowerCase()}: ${current.name || `#${current.id}`}` });
  for (const [type, list] of [['screen', library?.screens], ['element', library?.elements], ['button', library?.buttons], ['icon', library?.icons]]) {
    const it = (list || []).find(x => !(current?.type === type && Number(current.id) === Number(x.id)));
    if (it) out.push({ type, id: it.id, label: `${SAMPLE_LABEL[type]}: ${it.name || it.key || `#${it.id}`}` });
  }
  return out;
}

/** current: { type, id, name } of the open design (optional). Picking a card applies the style at once; Revert goes back. */
export function openThemePicker({ current = null } = {}) {
  const startKey = state.themeKey;
  const samples = themeSamples(current);
  let sample = samples[0] || null, mode = 'all', query = '';

  const grid = h('div', { class: 'tp-grid', role: 'listbox', 'aria-label': 'Design styles' });
  const count = h('span', { class: 'muted tp-count' });
  const sampleSel = h('select', { 'aria-label': 'Sample design' }, samples.map((s, i) => h('option', { value: String(i) }, s.label)));
  sampleSel.addEventListener('change', () => { sample = samples[Number(sampleSel.value)] || null; render(); });
  const search = h('input', { type: 'search', placeholder: 'Search design styles…', 'aria-label': 'Search design styles' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  const modeBtns = [['all', 'All'], ['dark', 'Dark'], ['light', 'Light']].map(([k, l]) =>
    h('button', { class: 'btn small', dataset: { mode: k }, onclick: () => { mode = k; render(); } }, l));
  const revertBtn = h('button', { class: 'btn', onclick: () => { setTheme(startKey); render(); } }, 'Revert');

  const card = t => {
    const on = t.key === state.themeKey, tk = t.tokens || {};
    const preview = h('div', { class: 'tp-preview', style: { background: String(tk.bg || '#05070f') } },
      sample
        ? h('img', { loading: 'lazy', alt: `${t.name} sample`, src: api.svgUrl(sample.type, sample.id, { theme: t.key }) })
        : h('span', { class: 'tp-empty', style: { color: String(tk.text || tk.accent || '#fff') } }, 'Aa'));
    const swatches = ['bg', 'surface', 'accent', 'text'].filter(k => /^#/.test(String(tk[k] || '')))
      .map(k => h('i', { class: 'tp-swatch', title: `${k}: ${tk[k]}`, style: { background: String(tk[k]) } }));
    return h('button', {
      class: `tp-card${on ? ' on' : ''}`, role: 'option', 'aria-selected': String(on), dataset: { theme: t.key },
      title: `${t.name} — click to use this design style`,
      onclick: () => { if (t.key !== state.themeKey) setTheme(t.key); render(); }
    }, preview, h('div', { class: 'tp-meta' },
      h('span', { class: 'tp-name' }, `${on ? '✓ ' : ''}${t.name}`),
      h('span', { class: 'tp-swatches' }, swatches)));
  };

  function render() {
    const list = (state.themes || []).filter(t => (mode === 'all' || modeOf(t) === mode) && matchesSearch(query, t.name, t.key, t.label, t.kind, t.descriptionDev, t.description));
    grid.replaceChildren(...list.map(card));
    if (!list.length) grid.append(h('p', { class: 'muted' }, 'No design style matches.'));
    count.textContent = `${list.length} of ${(state.themes || []).length} styles`;
    modeBtns.forEach(b => b.classList.toggle('primary', b.dataset.mode === mode));
    revertBtn.disabled = state.themeKey === startKey;
  }
  render();

  const m = modal({
    title: 'Design style',
    w90: true,
    content: h('div', { class: 'tp' },
      h('div', { class: 'tp-tools' },
        samples.length ? h('label', { class: 'tp-sample' }, h('span', { class: 'muted' }, 'Sample'), sampleSel) : null,
        h('div', { class: 'row', style: { gap: '4px' } }, modeBtns), search, count),
      grid),
    actions: close => [
      h('button', { class: 'btn', onclick: () => { close(); openThemeEditor(); } }, 'Edit themes…'),
      h('span', { class: 'grow' }),
      revertBtn,
      h('button', { class: 'btn primary', onclick: close }, 'Close')
    ]
  });
  requestAnimationFrame(() => grid.querySelector('.tp-card.on')?.scrollIntoView({ block: 'center' }));
  return m;
}
