/** App-level actions shared by menus, panels and the designers. Components call these instead of each other. */
import { api } from './api.js';
import { state, emit, currentTheme, renderContext, TYPE_LIST, PLURAL, findDesign } from './state.js';
import { renderSprite } from '/domain/svg.js';
import { h, toast, confirmBox, promptBox, modal } from './dom.js';
import { DEVICES, TYPES } from '/domain/entities.js';

export const LABEL = Object.fromEntries(TYPE_LIST.map(t => [t, TYPES[t].label.toLowerCase()]));

export async function reloadLibrary({ silent = false } = {}) {
  const libParams = {};
  if (state.activeProjectId) libParams.projectId = state.activeProjectId;
  if (state.visibilityFilter === 'public') {
    libParams.visibility = 'public';
  } else if (state.visibilityFilter === 'private') {
    libParams.visibility = 'private';
    libParams.includePublic = false;
  } else if (state.visibilityFilter === 'project') {
    libParams.visibility = 'project';
    libParams.includePublic = false;
  }
  const [lib, boot] = await Promise.all([api.library(libParams), api.bootstrap()]);
  state.library = lib;
  state.counts = boot.counts;
  if (boot.user) state.user = boot.user;
  if (boot.projects) state.projects = boot.projects;
  if (boot.templateDevices) state.templateDevices = boot.templateDevices;
  if (boot.templateButtons) state.templateButtons = boot.templateButtons;
  if (boot.devices) state.devices = boot.devices;
  state.pendingChangesCount = boot.pendingChangesCount ?? 0;
  state.trashCount = boot.trashCount ?? boot.counts?.trash ?? 0;
  if (boot.syncStatus) state.syncStatus = boot.syncStatus;
  refreshSprite();
  if (!silent) emit('library:changed');
  emit('trash:changed', state.trashCount);
}

export async function setActiveProject(projectId) {
  const pid = Number(projectId) || 1;
  state.activeProjectId = pid;
  api.setSession({ projectId: pid });
  await reloadLibrary();
  emit('project:changed', pid);
}

export async function setVisibilityFilter(filter) {
  state.visibilityFilter = filter || 'all';
  await reloadLibrary();
  emit('project:changed', state.activeProjectId);
}

export function refreshSprite() {
  const ctx = renderContext();
  document.getElementById('sprite-host').innerHTML = renderSprite({ iconIds: state.library.icons.map(i => i.id), ctx });
}

export function applyThemeChrome() {
  const t = currentTheme();
  if (t) document.documentElement.style.setProperty('--tb', String(t.tokens.bg));
}

export async function setTheme(key) {
  state.themeKey = key;
  applyThemeChrome();
  refreshSprite();
  api.settings({ theme: key }).catch(() => {});
  emit('theme:changed');
}

export async function updateSettings(patch) {
  Object.assign(state.settings, patch);
  await api.settings(patch);
  emit('settings:changed', patch);
}

/* ---------- designs ---------- */
export function downloadSvg(type, id, extra = {}) {
  const a = h('a', { href: api.svgUrl(type, id, { theme: state.themeKey, download: 1, ...extra }) });
  document.body.appendChild(a); a.click(); a.remove();
}

const BOX = (w, h2, extra = {}) => ({ tag: 'rect', role: 'card', name: 'surface', attrs: { x: 0, y: 0, width: w, height: h2, rx: 16 }, ...extra });

export async function newDesign(type) {
  let name, device = state.settings.device, preset = null, buttonTemplate = null, visibility = 'public';
  const activeProj = state.projects.find(p => p.id === state.activeProjectId);
  if (activeProj?.visibility === 'project') visibility = 'project';

  if (type === 'screen') {
    const r = await screenDialog(visibility);
    if (!r) return null;
    ({ name, device, visibility } = r);
  } else if (type === 'element') {
    const r = await elementDialog(visibility);
    if (!r) return null;
    ({ name, preset, visibility } = r);
  } else if (type === 'button') {
    const r = await buttonDialog(visibility);
    if (!r) return null;
    ({ name, buttonTemplate, visibility } = r);
  } else {
    name = await promptBox(`New ${LABEL[type]}`, { label: 'Name', okLabel: 'Create' });
    if (!name?.trim()) return null;
  }
  try {
    let rec;
    if (preset) {
      rec = await api.cloneDesign('element', preset, { name: name.trim(), projectId: state.activeProjectId, visibility });
      rec = await api.updateDesign('element', rec.id, { meta: { ...rec.meta, preset: false }, category: 'custom', visibility, projectId: state.activeProjectId });
    } else if (buttonTemplate) {
      rec = await api.instantiateTemplateButton(buttonTemplate, { name: name.trim(), projectId: state.activeProjectId, visibility });
    } else {
      let body;
      const baseMeta = { projectId: state.activeProjectId, visibility };
      if (type === 'path') body = { ...baseMeta, name, category: 'custom', nodes: [{ tag: 'path', name: 'path', attrs: { d: 'M5 12h14M12 5v14' } }] };
      else if (type === 'icon') body = { ...baseMeta, name, category: 'custom', nodes: [] };
      else if (type === 'button') body = { ...baseMeta, name, category: 'custom', width: 64, height: 64, meta: { shape: 'circle' }, nodes: [
        { tag: 'rect', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: 64, height: 64, rx: 32 } }, { tag: 'rect', role: 'shine', name: 'shine', attrs: { x: 5, y: 3, width: 54, height: 26, rx: 16 } }] };
      else if (type === 'element') body = { ...baseMeta, name, category: 'custom', width: 240, height: 64, meta: { htmlTag: 'div' }, nodes: [BOX(240, 64)] };
      else {
        const devList = state.templateDevices?.length ? state.templateDevices : Object.entries(DEVICES).map(([k, d]) => ({ key: k, ...d }));
        const d = devList.find(x => x.key === device) || DEVICES[device] || DEVICES['iphone-15'];
        body = { ...baseMeta, name, category: 'general', width: d.width, height: d.height, meta: { device }, nodes: [{ tag: 'rect', role: 'bg', name: 'background', attrs: { x: 0, y: 0, width: d.width, height: d.height, fill: '{{bg}}' } }] };
      }
      rec = await api.createDesign(type, body);
    }
    await reloadLibrary();
    toast(`${LABEL[type]} "${rec.name}" created`, 'ok');
    return rec;
  } catch (e) { toast(e.message, 'error'); return null; }
}

function screenDialog(defaultVis = 'public') {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const name = h('input', { type: 'text', placeholder: 'e.g. Settings' });
    const devList = state.templateDevices?.length ? state.templateDevices : Object.entries(DEVICES).map(([k, d]) => ({ key: k, ...d }));
    const dev = h('select', {}, devList.map(d => h('option', { value: d.key, selected: d.key === state.settings.device }, `${d.name} (${d.width}×${d.height})`)));
    const vis = h('select', {}, [
      h('option', { value: 'public', selected: defaultVis === 'public' }, 'Public (all users)'),
      h('option', { value: 'private', selected: defaultVis === 'private' }, 'Private (all my projects — global library)'),
      h('option', { value: 'project', selected: defaultVis === 'project' }, 'Project-specific (active project only)')
    ]);
    modal({ title: 'New screen', onClose: () => fin(null),
      content: h('div', { class: 'row wrap' },
        h('label', { class: 'field grow' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field' }, h('span', {}, 'Template Device'), dev),
        h('label', { class: 'field' }, h('span', {}, 'Visibility'), vis)
      ),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { if (name.value.trim()) { fin({ name: name.value.trim(), device: dev.value, visibility: vis.value }); close(); } } }, 'Create')] });
    setTimeout(() => name.focus(), 30);
  });
}

function buttonDialog(defaultVis = 'public') {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const name = h('input', { type: 'text', placeholder: 'e.g. Action Button' });
    const tplList = state.templateButtons || [];
    const tpl = h('select', {}, [
      h('option', { value: '' }, 'Circle 64×64 (Default)'),
      ...tplList.map(t => h('option', { value: t.key }, `${t.name} (${t.width}×${t.height} · ${t.shape})`))
    ]);
    const vis = h('select', {}, [
      h('option', { value: 'public', selected: defaultVis === 'public' }, 'Public (all users)'),
      h('option', { value: 'private', selected: defaultVis === 'private' }, 'Private (all my projects — global library)'),
      h('option', { value: 'project', selected: defaultVis === 'project' }, 'Project-specific')
    ]);
    modal({ title: 'New button from template', onClose: () => fin(null),
      content: h('div', { class: 'row wrap' },
        h('label', { class: 'field grow' }, h('span', {}, 'Button Name'), name),
        h('label', { class: 'field grow' }, h('span', {}, 'Button Template Type'), tpl),
        h('label', { class: 'field' }, h('span', {}, 'Visibility'), vis)
      ),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { if (name.value.trim()) { fin({ name: name.value.trim(), buttonTemplate: tpl.value || null, visibility: vis.value }); close(); } } }, 'Create')] });
    setTimeout(() => name.focus(), 30);
  });
}

/** New element: start blank or from one of the presets (basic HTML elements, forms, cards, menus ...). */
function elementDialog(defaultVis = 'public') {
  return new Promise(resolve => {
    let done = false, chosen = null;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const name = h('input', { type: 'text', placeholder: 'Name of the new element' });
    const vis = h('select', {}, [
      h('option', { value: 'public', selected: defaultVis === 'public' }, 'Public (all users)'),
      h('option', { value: 'private', selected: defaultVis === 'private' }, 'Private (all my projects)'),
      h('option', { value: 'project', selected: defaultVis === 'project' }, 'Project-specific')
    ]);
    const presets = state.library.elements.filter(e => e.meta?.preset);
    const cats = [...new Set(presets.map(p => p.category))].sort();
    const grid = h('div', { class: 'grid-items', style: { maxHeight: '340px', overflow: 'auto' } });
    let cat = '';
    const fill = () => {
      grid.replaceChildren();
      const blank = h('div', { class: `cell${chosen === null ? ' sel' : ''}`, onclick: () => { chosen = null; fill(); } }, h('div', { style: { padding: '26px 0', color: '#8fa8c8' } }, 'Blank'), h('div', { class: 'lbl' }, 'empty bounding box'));
      grid.append(blank);
      for (const p of presets.filter(x => !cat || x.category === cat)) {
        grid.append(h('div', { class: `cell${chosen === p.id ? ' sel' : ''}`, title: p.descriptionDev, onclick: () => { chosen = p.id; if (!name.value) name.value = p.name; fill(); } },
          h('img', { class: 'thumb', loading: 'lazy', alt: p.label, src: api.svgUrl('element', p.id, { theme: state.themeKey, animated: 1 }) }), h('div', { class: 'lbl' }, `${p.meta?.htmlTag ? `<${p.meta.htmlTag}> ` : ''}${p.name}`)));
      }
    };
    const chips = h('div', { class: 'cats' }, [h('button', { class: 'cat on', onclick: e => { cat = ''; setOn(e.target); fill(); } }, 'all'), ...cats.map(c => h('button', { class: 'cat', onclick: e => { cat = c; setOn(e.target); fill(); } }, c))]);
    const setOn = el => { chips.querySelectorAll('.cat').forEach(b => b.classList.toggle('on', b === el)); };
    modal({ title: 'New element', wide: true, onClose: () => fin(null),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'row' }, h('label', { class: 'field grow' }, h('span', {}, 'Name'), name), h('label', { class: 'field' }, h('span', {}, 'Visibility'), vis)),
        h('div', { class: 'muted' }, 'Start from a preset (every kind of basic & interactive HTML element is here) or from a blank bounding box. Everything you add stays inside the box and scales with it.'), chips, grid),
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { if (!name.value.trim()) return toast('Give the element a name', 'error'); fin({ name: name.value.trim(), preset: chosen, visibility: vis.value }); close(); } }, 'Create')] });
    fill();
    setTimeout(() => name.focus(), 30);
  });
}

export async function cloneDesign(type, rec) {
  const name = await promptBox(`Clone ${LABEL[type]}`, { value: `${rec.name} copy`, okLabel: 'Clone' });
  if (!name?.trim()) return null;
  try {
    const c = await api.cloneDesign(type, rec.id, { name: name.trim(), projectId: state.activeProjectId });
    await reloadLibrary();
    toast(`cloned as "${c.name}" (root owner: ${c.rootOwnerUsername || 'kyrpy'})`, 'ok');
    return c;
  } catch (e) { toast(e.message, 'error'); return null; }
}

export async function deleteDesign(type, rec) {
  const use = rec.usage ? ` It is used ${rec.usage} time(s); those instances will be archived in Trash and restored if you restore this item.` : '';
  if (!await confirmBox(`Move ${LABEL[type]} "${rec.name}" to Trash?${use}`, { okLabel: 'Move to Trash' })) return false;
  try {
    await api.deleteDesign(type, rec.id);
    await reloadLibrary();
    emit('design:deleted', { type, id: rec.id });
    toast(`Moved "${rec.name}" to Trash`, 'ok');
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

export async function importSvgDialog(asType = 'icon') {
  const defaultType = ['path', 'icon', 'button', 'element'].includes(asType) ? asType : 'icon';
  const file = h('input', { type: 'file', accept: '.svg,image/svg+xml' });
  const text = h('textarea', { rows: 7, placeholder: 'or paste <svg>…</svg> markup here' });
  const kind = h('select', {}, [
    ['path', 'Path group (24 grid)'],
    ['icon', 'Icon (scaled to the 24 grid)'],
    ['button', 'Button (64×64 wrapping icon)'],
    ['element', 'Element (keeps its size)']
  ].map(([v, l]) => h('option', { value: v, selected: v === defaultType }, l)));
  const name = h('input', { type: 'text', placeholder: 'name (default: file name)' });
  const category = h('input', { type: 'text', value: 'imported', placeholder: 'category' });
  const vis = h('select', {}, [
    h('option', { value: 'public' }, 'Public (all users)'),
    h('option', { value: 'private' }, 'Private (all my projects)'),
    h('option', { value: 'project' }, 'Project-specific')
  ]);
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (f) {
      text.value = await f.text();
      if (!name.value) name.value = f.name.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ');
    }
  });
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    modal({
      title: 'Import vector graphic (SVG)',
      onClose: () => fin(null),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
          h('span', { class: 'muted' }, 'Import a single SVG file or switch to batch SVG Folder / Font import:'),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm', onclick: async () => { document.querySelector('.modal-overlay')?.remove(); fin(await importFolderOrFontDialog(kind.value, 'folder')); } }, '📁 SVG Folder…'),
            h('button', { class: 'btn sm', onclick: async () => { document.querySelector('.modal-overlay')?.remove(); fin(await importFolderOrFontDialog(kind.value, 'font')); } }, '🔤 Font Glyphs…')
          )
        ),
        h('label', { class: 'field' }, h('span', {}, 'SVG file'), file),
        text,
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Target Library'), kind),
          h('label', { class: 'field grow' }, h('span', {}, 'Name'), name),
          h('label', { class: 'field' }, h('span', {}, 'Category'), category),
          h('label', { class: 'field' }, h('span', {}, 'Visibility'), vis)
        ),
        h('div', { class: 'muted' }, 'Shapes (path, rect, circle, ellipse, line, polyline, polygon, text, g) become editable nodes; the name and variable name are generated automatically.')
      ),
      actions: close => [
        h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const rec = await api.importSvg({
                svg: text.value,
                as: kind.value,
                name: name.value.trim() || undefined,
                category: category.value.trim() || 'imported',
                projectId: state.activeProjectId || 1,
                visibility: vis.value
              });
              await reloadLibrary();
              toast(`Imported "${rec.name}" into ${kind.value}s`, 'ok');
              fin({ type: kind.value, rec });
              close();
            } catch (e) {
              toast(e.message, 'error');
            }
          }
        }, 'Import')
      ]
    });
  });
}

/**
 * Batch Import from an SVG Folder (browser directory picker, multi-file upload, or server folder path)
 * OR from Fonts (SVG Font `<font>/<glyph>`, binary `.ttf`/`.otf`/`.woff`, or Symbol/Character Glyph sets)
 * directly into the current library (`path`, `icon`, `button`, or `element`).
 */
export async function importFolderOrFontDialog(asType = null, initialTab = 'folder') {
  const curTab = ['path', 'icon', 'button', 'element'].includes(asType || state.tab) ? (asType || state.tab) : 'icon';
  let mode = initialTab === 'font' ? 'font' : 'folder';
  let suggestedFolders = [];
  try { suggestedFolders = await api.importFolders(); } catch { suggestedFolders = []; }

  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '340px' } });
  const targetSel = h('select', {}, [
    ['path', 'Paths Library (24×24 vector path groups)'],
    ['icon', 'Icons Library (24×24 scaled icons)'],
    ['button', 'Buttons Library (64×64 interactive buttons)'],
    ['element', 'Elements Library (UI components)']
  ].map(([v, l]) => h('option', { value: v, selected: v === curTab }, l)));
  const categoryInput = h('input', { type: 'text', value: mode === 'font' ? 'font-icons' : 'folder-import', placeholder: 'Category' });
  const visSel = h('select', {}, [
    h('option', { value: 'public' }, 'Public (all users)'),
    h('option', { value: 'private' }, 'Private (all my projects — global library)'),
    h('option', { value: 'project' }, 'Project-specific (active project only)')
  ]);
  const limitInput = h('input', { type: 'number', value: '60', min: '1', max: '500', style: { width: '80px' } });

  // Folder mode inputs
  const dirPicker = h('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: true });
  dirPicker.setAttribute('webkitdirectory', '');
  dirPicker.setAttribute('directory', '');
  const multiSvgPicker = h('input', { type: 'file', accept: '.svg,image/svg+xml', multiple: true });
  const serverFolderInput = h('input', { type: 'text', placeholder: 'e.g. assets/Liquid-glow-iconsset-generator/svg' });
  const pickedFilesStatus = h('div', { class: 'muted' }, 'No browser files selected yet (or specify a workspace folder path below).');
  let uploadedSvgFiles = [];

  const handleSvgFilesSelected = async fileList => {
    const svgFiles = Array.from(fileList || []).filter(f => f.name.toLowerCase().endsWith('.svg'));
    uploadedSvgFiles = [];
    for (const f of svgFiles.slice(0, Number(limitInput.value) || 120)) {
      const svg = await f.text();
      uploadedSvgFiles.push({ name: f.name.replace(/\.svg$/i, ''), path: f.webkitRelativePath || f.name, svg });
    }
    pickedFilesStatus.textContent = uploadedSvgFiles.length
      ? `✓ Ready to import ${uploadedSvgFiles.length} SVG file(s): ${uploadedSvgFiles.slice(0, 6).map(x => x.name).join(', ')}${uploadedSvgFiles.length > 6 ? '…' : ''}`
      : 'No .svg files found in the selected folder.';
  };
  dirPicker.addEventListener('change', () => handleSvgFilesSelected(dirPicker.files));
  multiSvgPicker.addEventListener('change', () => handleSvgFilesSelected(multiSvgPicker.files));

  // Font mode inputs
  const fontFilePicker = h('input', { type: 'file', accept: '.svg,.ttf,.otf,.woff,font/*,image/svg+xml' });
  const fontServerPathInput = h('input', { type: 'text', placeholder: 'Optional server font file path (.svg, .ttf, .otf, .woff)' });
  const fontNameInput = h('input', { type: 'text', value: 'font', placeholder: 'Font prefix name (e.g. lucide, material)' });
  const fontPresetSel = h('select', {}, [
    h('option', { value: '' }, '— Choose a built-in Font Glyph Preset (or upload a font file) —'),
    h('option', { value: 'ui-symbols' }, 'UI & Action Symbols (★ ♥ ⚡ ✓ ✕ ✦ 🛡 🔖)'),
    h('option', { value: 'arrows-math' }, 'Arrows & Math Symbols (→ ← ↑ ↓ + − ∞ Δ)'),
    h('option', { value: 'geometric-shapes' }, 'Geometric & Badge Shapes (◆ ⬡ ⯃ ▲ ◎ ♛)')
  ]);
  const fontCharsInput = h('input', { type: 'text', placeholder: 'Or enter custom characters / glyphs (e.g. ★ ♥ ⚡ A B C 1 2 3)' });
  const fontFileStatus = h('div', { class: 'muted' }, 'Upload an SVG Font (<font>/<glyph>), a binary .ttf / .otf / .woff font file, or pick a glyph preset.');
  let uploadedFontSvg = '';
  let uploadedFontBase64 = '';

  fontFilePicker.addEventListener('change', async () => {
    const f = fontFilePicker.files?.[0];
    if (!f) return;
    const baseName = f.name.replace(/\.(svg|ttf|otf|woff)$/i, '');
    fontNameInput.value = baseName;
    if (f.name.toLowerCase().endsWith('.svg')) {
      uploadedFontSvg = await f.text();
      uploadedFontBase64 = '';
      fontFileStatus.textContent = `✓ Loaded SVG Font "${f.name}" (${uploadedFontSvg.length.toLocaleString()} bytes)`;
    } else {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      uploadedFontBase64 = btoa(binary);
      uploadedFontSvg = '';
      fontFileStatus.textContent = `✓ Loaded Binary Font "${f.name}" (${bytes.length.toLocaleString()} bytes)`;
    }
  });

  const renderBody = () => {
    host.replaceChildren();
    host.append(
      h('div', { class: 'row' },
        h('button', {
          class: `btn sm${mode === 'folder' ? ' primary' : ''}`,
          onclick: () => { mode = 'folder'; if (categoryInput.value === 'font-icons') categoryInput.value = 'folder-import'; renderBody(); }
        }, '📁 Import from SVG Folder'),
        h('button', {
          class: `btn sm${mode === 'font' ? ' primary' : ''}`,
          onclick: () => { mode = 'font'; if (categoryInput.value === 'folder-import') categoryInput.value = 'font-icons'; renderBody(); }
        }, '🔤 Import from Fonts (.svg / .ttf / .woff / Glyphs)')
      ),
      h('div', { class: 'row wrap', style: { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px', background: 'rgba(46,155,255,0.06)' } },
        h('label', { class: 'field grow' }, h('span', {}, 'Import into Current Library'), targetSel),
        h('label', { class: 'field' }, h('span', {}, 'Category'), categoryInput),
        h('label', { class: 'field' }, h('span', {}, 'Visibility'), visSel),
        h('label', { class: 'field' }, h('span', {}, 'Max Items'), limitInput)
      )
    );

    if (mode === 'folder') {
      host.append(
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Option 1 — Pick a Local Folder or Multiple SVG Files from Your Computer'),
          h('div', { class: 'row wrap' },
            h('label', { class: 'field grow' }, h('span', {}, 'Select Folder of SVGs'), dirPicker),
            h('label', { class: 'field grow' }, h('span', {}, 'Or Select Multiple .svg Files'), multiSvgPicker)
          ),
          pickedFilesStatus
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Option 2 — Import from a Server / Workspace SVG Folder Path'),
          h('label', { class: 'field' }, h('span', {}, 'Server / Workspace Folder Path'), serverFolderInput),
          suggestedFolders.filter(f => f.svgCount > 0).length
            ? h('div', { class: 'row wrap' },
                h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Discovered folders:'),
                ...suggestedFolders.filter(f => f.svgCount > 0).map(f =>
                  h('button', {
                    class: 'btn sm',
                    onclick: () => { serverFolderInput.value = f.path; }
                  }, `${f.label} (${f.svgCount} SVGs)`)
                )
              )
            : null
        )
      );
    } else {
      host.append(
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Option 1 — Upload Font File (.svg Font, .ttf, .otf, .woff) or Server Font Path'),
          h('div', { class: 'row wrap' },
            h('label', { class: 'field grow' }, h('span', {}, 'Font File (.svg, .ttf, .otf, .woff)'), fontFilePicker),
            h('label', { class: 'field' }, h('span', {}, 'Glyph Name Prefix'), fontNameInput)
          ),
          h('label', { class: 'field' }, h('span', {}, 'Or Server Font File Path'), fontServerPathInput),
          fontFileStatus
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Option 2 — Import from Built-in Vector Font Presets or Custom Characters'),
          h('div', { class: 'row wrap' },
            h('label', { class: 'field grow' }, h('span', {}, 'Font Symbol Preset'), fontPresetSel),
            h('label', { class: 'field grow' }, h('span', {}, 'Or Custom Characters / Symbols'), fontCharsInput)
          ),
          h('div', { class: 'muted' }, 'All imported font glyphs are normalized to the 24×24 coordinate grid as editable vector nodes in your chosen library.')
        )
      );
    }
  };

  renderBody();

  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    modal({
      title: 'Import from SVG Folder or Fonts to Current Library',
      wide: true,
      onClose: () => fin(null),
      content: host,
      actions: close => [
        h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const as = targetSel.value;
              const category = categoryInput.value.trim() || (mode === 'font' ? 'font-icons' : 'folder-import');
              const visibility = visSel.value;
              const limit = Number(limitInput.value) || 60;
              let res;
              if (mode === 'folder') {
                res = await api.importFolder({
                  files: uploadedSvgFiles,
                  folderPath: serverFolderInput.value.trim(),
                  as,
                  category,
                  projectId: state.activeProjectId || 1,
                  visibility,
                  limit
                });
              } else {
                res = await api.importFont({
                  fontSvg: uploadedFontSvg,
                  fontData: uploadedFontBase64,
                  fontPath: fontServerPathInput.value.trim(),
                  fontName: fontNameInput.value.trim() || 'font',
                  preset: fontPresetSel.value,
                  chars: fontCharsInput.value.trim(),
                  as,
                  category,
                  projectId: state.activeProjectId || 1,
                  visibility,
                  limit
                });
              }
              state.tab = as;
              await reloadLibrary();
              toast(`Imported ${res.importedCount} item(s) into ${as}s library`, 'ok');
              fin({ type: as, count: res.importedCount, items: res.items, rec: res.items?.[0] });
              close();
            } catch (e) {
              toast(e.message, 'error');
            }
          }
        }, 'Import to Library')
      ]
    });
  });
}

export { PLURAL, findDesign };

/* ---------- usage and guide ---------- */
export const GUIDE_URL = '/guide/usage-and-guide.html';

/** Pops up the guide in a modal box, on the topic of a designer: path | icon | button | element | screen | workflow | start ... */
export function openGuide(tab = 'start') {
  const frame = h('iframe', { src: `${GUIDE_URL}?embed=1&tab=${encodeURIComponent(tab)}`, title: 'Usage and guide', style: { flex: '1', width: '100%', border: '0', background: '#0b1424' } });
  const onMsg = e => { if (e.origin === location.origin && e.data?.udGuide === 'close') m.close(); };
  window.addEventListener('message', onMsg);
  const m = modal({ title: 'Usage and guide', full: true, content: frame, onClose: () => window.removeEventListener('message', onMsg),
    actions: close => [h('a', { class: 'btn', href: GUIDE_URL, download: 'usage-and-guide.html', title: 'Save the whole guide as one HTML file' }, 'Download usage-and-guide.html'),
      h('a', { class: 'btn', href: `${GUIDE_URL}#${tab}`, target: '_blank', rel: 'noopener' }, 'Open in a new tab'), h('button', { class: 'btn primary', onclick: close }, 'Close')] });
  return m;
}

/** Saves usage-and-guide.html (a standalone file that pops the guide up in a modal box). */
export function downloadGuide() {
  const a = h('a', { href: GUIDE_URL, download: 'usage-and-guide.html' });
  document.body.appendChild(a); a.click(); a.remove();
  toast('usage-and-guide.html saved', 'ok');
}
