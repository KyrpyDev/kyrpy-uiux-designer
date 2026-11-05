/** Theme editor: tokens (colours, global line size, button size/margin), kind, Dark/Light mode, and surface roles of any theme. */
import { h, modal, toast, promptBox, confirmBox } from '../dom.js';
import { api } from '../api.js';
import { state, emit } from '../state.js';
import { refreshSprite, applyThemeChrome, setTheme } from '../actions.js';
import { THEME_KINDS, THEME_KIND_LABELS, pairThemeKey } from '/domain/theme.js';

const KINDS = THEME_KINDS.map(k => [k, THEME_KIND_LABELS[k] || k]);

export async function openThemeEditor() {
  let current = state.themes.find(t => t.key === state.themeKey) || state.themes[0];
  let modeFilter = 'all'; // 'all' | 'dark' | 'light'
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  const reload = async () => { state.themes = await api.themes(); applyThemeChrome(); refreshSprite(); emit('theme:changed'); };

  const render = () => {
    body.replaceChildren();
    const filteredThemes = state.themes.filter(t => {
      if (modeFilter === 'all') return true;
      const m = t.tokens?.mode || (t.key.endsWith('-light') ? 'light' : 'dark');
      return m === modeFilter;
    });
    if (!filteredThemes.find(t => t.key === current.key) && filteredThemes.length) {
      current = filteredThemes[0];
    }

    const sel = h('select', {}, filteredThemes.map(t => {
      const m = t.tokens?.mode || (t.key.endsWith('-light') ? 'light' : 'dark');
      const badge = m === 'light' ? '☀️ ' : '🌙 ';
      return h('option', { value: t.key, selected: t.key === current.key }, `${badge}${t.name}${t.builtin ? ' (built-in)' : ''}`);
    }));
    sel.addEventListener('change', () => { current = state.themes.find(t => t.key === sel.value) || current; render(); });

    const curMode = current.tokens?.mode || (current.key.endsWith('-light') ? 'light' : 'dark');
    const counterpartKey = pairThemeKey(current.key, state.themes);
    const counterpart = state.themes.find(t => t.key === counterpartKey && t.key !== current.key);

    const name = h('input', { type: 'text', value: current.name });
    const kind = h('select', {}, KINDS.map(([k, l]) => h('option', { value: k, selected: k === current.kind }, l)));
    const modeSel = h('select', {}, [
      h('option', { value: 'dark', selected: curMode === 'dark' }, '🌙 Dark Mode'),
      h('option', { value: 'light', selected: curMode === 'light' }, '☀️ Light Mode')
    ]);
    const tokens = { ...current.tokens, mode: curMode };
    modeSel.addEventListener('change', () => { tokens.mode = modeSel.value; });

    const grid = h('div', { class: 'grid2' }, Object.entries(tokens).filter(([k]) => !['mode', 'pairKey', 'styleFamily'].includes(k)).map(([k, v]) => {
      const isColor = /^#[0-9a-f]{6}$/i.test(String(v));
      const txt = h('input', { type: 'text', value: String(v), 'data-token': k });
      const pick = isColor ? h('input', { type: 'color', value: String(v) }) : null;
      txt.addEventListener('input', () => { tokens[k] = isNaN(Number(txt.value)) || txt.value === '' ? txt.value : Number(txt.value); if (pick && /^#[0-9a-f]{6}$/i.test(txt.value)) pick.value = txt.value; });
      pick?.addEventListener('input', () => { txt.value = pick.value; tokens[k] = pick.value; });
      return h('label', { class: 'field' }, h('span', {}, `${k}${k === 'sw' ? ' (global line size)' : k === 'button' ? ' (button size)' : k === 'margin' ? ' (button margin)' : ''}`), h('div', { class: 'row' }, txt, pick));
    }));
    const surfaces = h('textarea', { rows: 9, style: { fontFamily: 'Consolas, monospace' } }); surfaces.value = JSON.stringify(current.surfaces, null, 1);
    const save = async () => {
      let surf; try { surf = JSON.parse(surfaces.value); } catch { return toast('Surfaces must be valid JSON', 'error'); }
      try {
        await api.saveTheme(current.id, { name: name.value.trim() || current.name, kind: kind.value, tokens, surfaces: surf });
        await reload(); current = state.themes.find(t => t.id === current.id); toast('theme saved', 'ok'); render();
      } catch (e) { toast(e.message, 'error'); }
    };
    body.append(
      h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'center' } },
        h('div', { class: 'seg' },
          h('button', { class: modeFilter === 'all' ? 'on' : '', onclick: () => { modeFilter = 'all'; render(); } }, `All (${state.themes.length})`),
          h('button', { class: modeFilter === 'dark' ? 'on' : '', onclick: () => { modeFilter = 'dark'; render(); } }, '🌙 Dark'),
          h('button', { class: modeFilter === 'light' ? 'on' : '', onclick: () => { modeFilter = 'light'; render(); } }, '☀️ Light')
        ),
        h('label', { class: 'field grow' }, h('span', {}, 'Design Style & Mode'), sel),
        counterpart ? h('button', {
          class: 'btn small',
          title: `Switch to ${counterpart.name}`,
          onclick: async () => {
            current = counterpart;
            await setTheme(counterpart.key);
            render();
          }
        }, curMode === 'dark' ? '☀️ Light Variant' : '🌙 Dark Variant') : null,
        h('button', { class: 'btn small', onclick: async () => { const n = await promptBox('Clone theme', { value: `${current.name} copy`, okLabel: 'Clone' }); if (n?.trim()) { const t = await api.cloneTheme(current.id, n.trim()); await reload(); current = state.themes.find(x => x.id === t.id); render(); } } }, 'Clone'),
        h('button', { class: 'btn small primary', onclick: () => setTheme(current.key) }, 'Apply'),
        h('button', { class: 'btn small danger', disabled: current.builtin, title: current.builtin ? 'Built-in themes cannot be deleted' : '', onclick: async () => { if (await confirmBox(`Delete theme "${current.name}"?`)) { try { await api.deleteTheme(current.id); await reload(); if (state.themeKey === current.key) await setTheme(state.themes[0].key); current = state.themes[0]; render(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete')),
      h('div', { class: 'row wrap' },
        h('label', { class: 'field grow' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field grow' }, h('span', {}, 'Design Style Family'), kind),
        h('label', { class: 'field' }, h('span', {}, 'Color Mode'), modeSel)
      ),
      h('div', { class: 'muted' }, 'Tokens are referenced from nodes as {{token}}; line sizes as {{sw*ratio}} so a single value restyles every icon across all 15 design style families (in Dark & Light modes).'),
      grid,
      h('label', { class: 'field' }, h('span', {}, 'Surface roles (attributes the theme applies to card / button / field / shine / bg-glow nodes)'), surfaces),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: save }, 'Save theme')));
  };
  render();
  modal({ title: 'Design Styles & Themes (Dark & Light Modes)', wide: true, content: body });
}
