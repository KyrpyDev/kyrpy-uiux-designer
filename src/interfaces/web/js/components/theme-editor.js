/** Theme editor: tokens (colours, global line size, button size/margin), kind and surface roles of any theme. */
import { h, modal, toast, promptBox, confirmBox } from '../dom.js';
import { api } from '../api.js';
import { state, emit } from '../state.js';
import { refreshSprite, applyThemeChrome, setTheme } from '../actions.js';

const KINDS = [['glass', 'Liquid glass'], ['glow', 'Glow lines'], ['neu', 'Neumorphic']];

export async function openThemeEditor() {
  let current = state.themes.find(t => t.key === state.themeKey) || state.themes[0];
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });

  const reload = async () => { state.themes = await api.themes(); applyThemeChrome(); refreshSprite(); emit('theme:changed'); };

  const render = () => {
    body.replaceChildren();
    const sel = h('select', {}, state.themes.map(t => h('option', { value: t.key, selected: t.key === current.key }, `${t.name}${t.builtin ? ' (built-in)' : ''}`)));
    sel.addEventListener('change', () => { current = state.themes.find(t => t.key === sel.value); render(); });
    const name = h('input', { type: 'text', value: current.name });
    const kind = h('select', {}, KINDS.map(([k, l]) => h('option', { value: k, selected: k === current.kind }, l)));
    const tokens = { ...current.tokens };
    const grid = h('div', { class: 'grid2' }, Object.entries(tokens).map(([k, v]) => {
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
      h('div', { class: 'row wrap' }, h('label', { class: 'field grow' }, h('span', {}, 'Theme'), sel),
        h('button', { class: 'btn small', onclick: async () => { const n = await promptBox('Clone theme', { value: `${current.name} copy`, okLabel: 'Clone' }); if (n?.trim()) { const t = await api.cloneTheme(current.id, n.trim()); await reload(); current = state.themes.find(x => x.id === t.id); render(); } } }, 'Clone'),
        h('button', { class: 'btn small', onclick: () => setTheme(current.key) }, 'Apply'),
        h('button', { class: 'btn small danger', disabled: current.builtin, title: current.builtin ? 'Built-in themes cannot be deleted' : '', onclick: async () => { if (await confirmBox(`Delete theme "${current.name}"?`)) { try { await api.deleteTheme(current.id); await reload(); if (state.themeKey === current.key) await setTheme(state.themes[0].key); current = state.themes[0]; render(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete')),
      h('div', { class: 'row wrap' }, h('label', { class: 'field grow' }, h('span', {}, 'Name'), name), h('label', { class: 'field grow' }, h('span', {}, 'Type'), kind)),
      h('div', { class: 'muted' }, 'Tokens are referenced from nodes as {{token}}; line sizes as {{sw*ratio}} so a single value restyles every icon.'),
      grid,
      h('label', { class: 'field' }, h('span', {}, 'Surface roles (attributes the theme applies to card / button / field / shine / bg-glow nodes)'), surfaces),
      h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', onclick: save }, 'Save theme')));
  };
  render();
  modal({ title: 'Themes', wide: true, content: body });
}
