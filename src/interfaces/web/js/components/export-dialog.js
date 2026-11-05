/** Export dialog: pick screens + themes, choose an export folder, write the working html/css/ts/js/svg project. */
import { h, modal, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';

async function writeToDirectory(dirHandle, files) {
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = dirHandle;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
    const fh = await dir.getFileHandle(parts.at(-1), { create: true });
    const w = await fh.createWritable();
    await w.write(f.content);
    await w.close();
  }
}

export async function openExportDialog({ screenIds = 'all' } = {}) {
  const screens = await api.list('screen');
  const chosen = new Set(screenIds === 'all' ? screens.map(s => s.id) : screenIds);
  const themeSel = new Set([state.themeKey]);
  let dirHandle = null;

  const count = h('b', {});
  const list = h('div', { class: 'el-list', style: { maxHeight: '220px' } });
  const syncCount = () => { count.textContent = `${chosen.size} of ${screens.length} screens`; list.querySelectorAll('input').forEach(i => { i.checked = chosen.has(Number(i.dataset.id)); }); };
  for (const s of screens) {
    list.append(h('label', { class: 'el-row' }, h('input', { type: 'checkbox', 'data-id': s.id, checked: chosen.has(s.id), onchange: e => { e.target.checked ? chosen.add(s.id) : chosen.delete(s.id); syncCount(); } }),
      h('span', { class: 'grow' }, s.name), h('span', { class: 'dim' }, s.category)));
  }
  const bulk = (label, fn) => h('button', { class: 'btn small', onclick: () => { fn(); syncCount(); } }, label);

  const themeBox = h('div', { class: 'row wrap' }, state.themes.map(t => h('label', { class: 'row', style: { gap: '4px' } },
    h('input', { type: 'checkbox', checked: themeSel.has(t.key), onchange: e => { e.target.checked ? themeSel.add(t.key) : themeSel.delete(t.key); } }), t.name)));
  const icons = h('select', {}, h('option', { value: 'used' }, 'only icons used by the screens'), h('option', { value: 'all' }, 'the whole icon library'), h('option', { value: 'none' }, 'no icons'));
  const title = h('input', { type: 'text', value: 'UI Export' });
  const folder = h('input', { type: 'text', placeholder: 'C:\\path\\to\\export-folder', value: state.settings.exportFolder || '', style: { width: '100%' } });
  const picked = h('span', { class: 'muted' });
  const browse = h('button', { class: 'btn small', title: 'Pick a folder with the browser (Chrome / Edge)', onclick: async () => {
    if (!window.showDirectoryPicker) return toast('This browser cannot pick folders; type a folder path instead.', 'error');
    try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); picked.textContent = `browser folder: ${dirHandle.name}`; } catch { /* cancelled */ }
  } }, 'Browse…');
  const status = h('div', { class: 'muted' });

  const run = async close => {
    if (!chosen.size) return toast('Select at least one screen', 'error');
    if (!themeSel.size) return toast('Select at least one theme', 'error');
    if (!dirHandle && !folder.value.trim()) return toast('Choose an export folder (Browse… or type an absolute path)', 'error');
    const body = { screenIds: [...chosen], themeKeys: state.themes.filter(t => themeSel.has(t.key)).map(t => t.key), includeIcons: icons.value, title: title.value.trim() || 'UI Export' };
    status.textContent = 'Exporting…';
    try {
      let summary, where;
      if (dirHandle) { const r = await api.exportBundle(body); await writeToDirectory(dirHandle, r.files); summary = r.summary; where = dirHandle.name; }
      else { const r = await api.exportFolder({ ...body, folder: folder.value.trim() }); summary = r; where = r.folder; state.settings.exportFolder = folder.value.trim(); }
      toast(`Exported ${summary.screens} screens, ${summary.icons} icons, ${summary.files} files → ${where}`, 'ok', 6000);
      close();
    } catch (e) { status.textContent = ''; toast(e.message, 'error', 6000); }
  };

  modal({ title: 'Export to HTML · CSS · TS · JS · SVG', wide: true,
    content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'row' }, count, h('span', { class: 'grow' }), bulk('Select all', () => screens.forEach(s => chosen.add(s.id))), bulk('None', () => chosen.clear()), bulk('Invert', () => screens.forEach(s => chosen.has(s.id) ? chosen.delete(s.id) : chosen.add(s.id)))),
      list,
      h('div', { class: 'field' }, h('span', {}, 'Themes included (the page can switch between them)'), themeBox),
      h('div', { class: 'row wrap' }, h('label', { class: 'field grow' }, h('span', {}, 'Icons / SVG files'), icons), h('label', { class: 'field grow' }, h('span', {}, 'Project title'), title)),
      h('div', { class: 'field' }, h('span', {}, 'Export folder'), h('div', { class: 'row' }, folder, browse), picked),
      h('div', { class: 'muted' }, 'Creates index.html, one working page per screen (inline SVG per theme, link hotspots, navigation), css/, js/, ts/, svg/ (screens, icons, buttons, elements, sprite), data/manifest.json and DEV-NOTES.md with every description-dev.'),
      status),
    actions: close => [h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => run(close) }, 'Export')] });
  syncCount();
}
