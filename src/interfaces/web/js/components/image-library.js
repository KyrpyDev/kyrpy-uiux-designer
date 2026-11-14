/**
 * Image library UI: the Images tab of the library panel (search, upload, edit, delete, drag onto a design), the image picker
 * (inspector "Change image…") and the free stock photo search + import window (Openverse, Pexels, Pixabay).
 * Pictures are shown by image nodes ({ tag: 'image', attrs: { imageId, … } }); see domain/image.js.
 */
import { h, modal, toast, confirmBox, clear } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { ibtn } from '../icons.js';

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const MAX_SIDE = 2048, KEEP_BYTES = 1.5 * 1024 * 1024;

const sizeText = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const readAsDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/** A picked file as a data URI, downsized in the browser when it is larger than 2048 px or 1.5 MB (GIFs are kept as they are). */
export async function fileToDataUri(file) {
  if (!ACCEPT.split(',').includes(file.type)) throw new Error(`${file.name}: only PNG, JPEG, GIF or WebP pictures`);
  const original = await readAsDataUrl(file);
  if (file.type === 'image/gif') return original;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`${file.name}: cannot read the picture`)); i.src = original; });
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size <= KEEP_BYTES) return original;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/webp';   // PNG keeps its transparency
  let out = c.toDataURL(type, 0.86);
  if (type === 'image/png' && out.length > KEEP_BYTES * 1.37) out = c.toDataURL('image/webp', 0.86);
  return out;
}

/** Uploads files into the image library of the active project; returns the created records. */
export async function uploadImages(files, { projectId = state.activeProjectId, visibility = 'project' } = {}) {
  const done = [];
  for (const f of files) {
    try {
      const data = await fileToDataUri(f);
      const rec = await api.createImage({ data, name: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Image', projectId, visibility });
      done.push(rec);
      if (rec.duplicate) toast(`“${f.name}” is already in the library as “${rec.name}”`, 'info', 2200);
    } catch (e) { toast(e.message, 'error'); }
  }
  if (done.length) toast(`${done.length} image(s) added`, 'ok', 1600);
  return done;
}

function card(img, { onPick, onEdit, onDelete, draggable = true, selected = false } = {}) {
  const meta = [img.width && img.height ? `${img.width}×${img.height}` : null, sizeText(img.bytes), img.source !== 'upload' ? img.source : null].filter(Boolean).join(' · ');
  const credit = img.author ? `\n${img.author}${img.license ? ` · ${img.license}` : ''}` : '';
  return h('div', {
    class: `cell img-cell${selected ? ' sel' : ''}`, draggable: draggable ? 'true' : 'false', 'data-image-id': String(img.id),
    title: `${img.label || img.name} · ${img.key}\n${meta}${credit}\n${img.descriptionDev || ''}\n(drag onto the canvas, double-click to add)`.trim(),
    style: { position: 'relative', display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px', cursor: 'pointer' },
    ondragstart: e => { e.dataTransfer.setData('application/x-ud', JSON.stringify({ type: 'image', id: img.id })); e.dataTransfer.effectAllowed = 'copy'; },
    ondblclick: () => onPick?.(img),
    onclick: () => onPick && !draggable && onPick(img)
  },
  h('img', { src: img.fileUrl, alt: img.label || img.name, loading: 'lazy', style: { width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '6px', background: '#8884' } }),
  h('div', { style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, img.label || img.name),
  (onEdit || onDelete) ? h('div', { class: 'row', style: { position: 'absolute', top: '6px', right: '6px', gap: '2px' } },
    onEdit ? ibtn('pencil', 'Rename, tag, describe or share', e => { e?.stopPropagation?.(); onEdit(img); }, { size: 13, dataset: { act: 'img-edit' } }) : null,
    onDelete ? ibtn('trash', 'Delete from the library', e => { e?.stopPropagation?.(); onDelete(img); }, { size: 13, dataset: { act: 'img-delete' } }) : null) : null);
}

/** Edit window of one image: name, label, tags, description-dev, visibility. Resolves the saved record or null. */
export function editImageDialog(img) {
  return new Promise(resolve => {
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const name = h('input', { type: 'text', value: img.name }), label = h('input', { type: 'text', value: img.label || '' });
    const tags = h('input', { type: 'text', value: (img.tags || []).join(', '), placeholder: 'comma separated' });
    const dev = h('textarea', { rows: 4 }); dev.value = img.descriptionDev || '';
    const vis = h('select', {}, ...['project', 'private', 'public'].map(v => h('option', { value: v, selected: img.visibility === v }, v)));
    const info = [img.key, img.mime, img.width && img.height ? `${img.width}×${img.height}` : '', sizeText(img.bytes), img.author ? `by ${img.author}` : '', img.license || ''].filter(Boolean).join(' · ');
    modal({
      title: `Image “${img.label || img.name}”`, onClose: () => fin(null),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 'min(520px, 90vw)' } },
        h('img', { src: img.fileUrl, alt: '', style: { maxWidth: '100%', maxHeight: '260px', objectFit: 'contain', alignSelf: 'center', borderRadius: '6px' } }),
        h('div', { class: 'muted', style: { fontSize: '11px' } }, info, img.sourceUrl ? h('a', { href: img.sourceUrl, target: '_blank', rel: 'noopener noreferrer', style: { marginLeft: '6px' } }, 'source page') : null),
        h('div', { class: 'row wrap' }, h('label', { class: 'field grow' }, h('span', {}, 'Name'), name), h('label', { class: 'field grow' }, h('span', {}, 'Label'), label)),
        h('label', { class: 'field' }, h('span', {}, 'Tags'), tags),
        h('label', { class: 'field' }, h('span', {}, 'description-dev'), dev),
        h('label', { class: 'field' }, h('span', {}, 'Visibility'), vis)),
      actions: close => [
        h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: async () => {
          try {
            const rec = await api.updateImage(img.id, { name: name.value, label: label.value, tags: tags.value.split(',').map(t => t.trim()).filter(Boolean), descriptionDev: dev.value, visibility: vis.value });
            fin(rec); close();
          } catch (e) { toast(e.message, 'error'); }
        } }, 'Save')]
    });
  });
}

/**
 * The image browser: search box (every word in name / label / key / tags / description-dev / author), upload, stock photos,
 * and a grid of pictures. `mode`: 'library' (the tab: drag, edit, delete) or 'pick' (a click picks; `onPick(img)`).
 */
export function imageBrowser({ mode = 'library', onPick = null, onChange = null } = {}) {
  const root = h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1', gap: '6px' } });
  const search = h('input', { type: 'search', placeholder: 'Search images (name, tags, description-dev, author)…', 'aria-label': 'Search images', 'data-f': 'img-search' });
  const scope = h('select', { 'aria-label': 'Which images', 'data-f': 'img-scope', title: 'This project and the public images, or everything you can see' },
    h('option', { value: 'project' }, 'This project + public'), h('option', { value: 'all' }, 'Everything I can see'));
  const fileIn = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: async () => { await uploadImages([...fileIn.files]); fileIn.value = ''; load(); onChange?.(); } });
  const count = h('span', { class: 'muted', style: { fontSize: '11px' } });
  const grid = h('div', { class: 'grid-icons lib-scroll', 'data-f': 'img-grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(96px,1fr))', alignContent: 'start', overflow: 'auto', flex: '1', minHeight: '120px' } });
  let seq = 0, timer = null;
  const load = async () => {
    const my = ++seq;
    try {
      const r = await api.images({ q: search.value.trim(), projectId: scope.value === 'project' ? state.activeProjectId : null, limit: 300 });
      if (my !== seq) return;
      clear(grid);
      count.textContent = r.total > r.items.length ? `${r.items.length} of ${r.total}` : `${r.total} image(s)`;
      if (!r.items.length) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, search.value.trim() ? 'No image matches every word.' : 'No images yet: upload some or search free stock photos.'));
      for (const img of r.items) {
        grid.append(card(img, mode === 'pick'
          ? { draggable: false, onPick }
          : {
              onPick: img2 => window.__app?.addInstance?.('image', img2.id),
              onEdit: async img2 => { if (await editImageDialog(img2)) { load(); onChange?.(); } },
              onDelete: async img2 => {
                if (!(await confirmBox(`Delete “${img2.label || img2.name}” from the image library? Image nodes that show it become grey placeholders.`, { okLabel: 'Delete' }))) return;
                try { await api.deleteImage(img2.id); toast('Image deleted', 'ok', 1400); load(); onChange?.(); } catch (e) { toast(e.message, 'error'); }
              }
            }));
      }
    } catch (e) { if (my === seq) { clear(grid); grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, `Could not load images: ${e.message}`)); } }
  };
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 220); });
  scope.addEventListener('change', load);
  const tools = h('div', { class: 'lib-tools' }, search,
    h('div', { class: 'row wrap', style: { gap: '6px', alignItems: 'center' } },
      h('button', { class: 'btn sm', type: 'button', 'data-act': 'img-upload', title: 'Upload PNG, JPEG, GIF or WebP pictures (large ones are downsized to 2048 px)', onclick: () => fileIn.click() }, '⬆ Upload'),
      h('button', { class: 'btn sm', type: 'button', 'data-act': 'img-stock', title: 'Search free stock photos (Openverse, Pexels, Pixabay) and import them', onclick: async () => { const got = await stockImageDialog(); if (got?.length) { load(); onChange?.(); if (mode === 'pick' && got.length === 1) onPick?.(got[0]); } } }, '🔎 Free stock photos'),
      scope, count, fileIn));
  // drop files from the computer onto the browser to upload them
  root.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  root.addEventListener('drop', async e => { const files = [...(e.dataTransfer?.files || [])]; if (!files.length) return; e.preventDefault(); await uploadImages(files); load(); onChange?.(); });
  root.append(tools, grid);
  load();
  root.reload = load;
  return root;
}

/** Picks a picture of the image library (inspector "Change image…"); resolves the image record or null. */
export function pickImage() {
  return new Promise(resolve => {
    let done = false, m;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const browser = imageBrowser({ mode: 'pick', onPick: img => { fin(img); m.close(); } });
    browser.style.height = '62vh';
    m = modal({ title: 'Choose an image', wide: true, onClose: () => fin(null), content: browser,
      actions: close => [h('button', { class: 'btn', onclick: () => { fin(null); close(); } }, 'Cancel')] });
  });
}

/** Free stock photo search and import (several at once). Resolves the imported image records ([] when none). */
export function stockImageDialog() {
  return new Promise(resolve => {
    let done = false, m, sources = [], page = 1, last = null;
    const picked = new Map();
    const fin = v => { if (!done) { done = true; resolve(v); } };
    const prov = h('select', { 'data-f': 'stock-provider', 'aria-label': 'Provider' });
    const q = h('input', { type: 'search', placeholder: 'Search free photos (e.g. smiling woman portrait, office desk)…', 'data-f': 'stock-q', class: 'grow' });
    const vis = h('select', { 'aria-label': 'Visibility of the imported images' }, ...['project', 'private', 'public'].map(v => h('option', { value: v }, `Import as ${v}`)));
    const status = h('span', { class: 'muted', style: { fontSize: '11px' } });
    const licence = h('div', { class: 'muted', style: { fontSize: '11px' } });
    const grid = h('div', { class: 'grid-icons', 'data-f': 'stock-grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', alignContent: 'start', overflow: 'auto', height: '52vh' } });
    const more = h('button', { class: 'btn sm', type: 'button', hidden: true, onclick: () => run(page + 1) }, 'More results');
    const importBtn = h('button', { class: 'btn primary', 'data-act': 'stock-import', disabled: true }, 'Import selected');
    const paintPicked = () => { importBtn.disabled = !picked.size; importBtn.textContent = picked.size ? `Import ${picked.size} photo(s)` : 'Import selected'; };
    const run = async (pg = 1) => {
      const text = q.value.trim();
      if (!text) return;
      page = pg; status.textContent = 'Searching…';
      try {
        const r = await api.stockImageSearch(prov.value, text, pg);
        if (pg === 1) clear(grid);
        last = r;
        status.textContent = `${r.total.toLocaleString()} result(s) on ${sources.find(s => s.id === prov.value)?.label || prov.value}`;
        for (const it of r.items) {
          const key = `${it.provider}:${it.id}`;
          const cell = h('div', { class: `cell${picked.has(key) ? ' sel' : ''}`, style: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '4px', cursor: 'pointer' },
            title: `${it.title}\n${it.author ? `by ${it.author} · ` : ''}${it.license || ''}\n(click to select, double-click to import this one)`,
            onclick: () => { if (picked.has(key)) picked.delete(key); else picked.set(key, it); cell.classList.toggle('sel', picked.has(key)); paintPicked(); },
            ondblclick: () => { picked.set(key, it); doImport(); } },
          h('img', { src: it.thumbUrl, alt: it.title, loading: 'lazy', referrerpolicy: 'no-referrer', style: { width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: '6px', background: '#8884' } }),
          h('div', { style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.title),
          h('div', { class: 'muted', style: { fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, [it.author, it.license].filter(Boolean).join(' · ')));
          grid.append(cell);
        }
        if (!r.items.length && pg === 1) grid.append(h('div', { class: 'empty', style: { gridColumn: '1/-1' } }, 'No photos found.'));
        more.hidden = !(r.items.length && r.total > pg * r.items.length);
      } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
    };
    const doImport = async () => {
      if (!picked.size) return;
      importBtn.disabled = true; status.textContent = `Importing ${picked.size} photo(s)…`;
      try {
        const r = await api.stockImageImport({ items: [...picked.values()].map(it => ({ provider: it.provider, id: it.id })), visibility: vis.value, projectId: state.activeProjectId });
        for (const f of r.failed || []) toast(`${f.provider} ${f.id}: ${f.error}`, 'error');
        if (r.imported?.length) toast(`${r.imported.length} photo(s) imported into the image library`, 'ok', 2000);
        fin(r.imported || []); m.close();
      } catch (e) { toast(e.message, 'error'); paintPicked(); status.textContent = ''; }
    };
    importBtn.addEventListener('click', doImport);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') run(1); });
    prov.addEventListener('change', () => { const s = sources.find(x => x.id === prov.value); licence.textContent = s ? `${s.label}: ${s.license}` : ''; picked.clear(); paintPicked(); if (q.value.trim()) run(1); });
    api.stockImageSources().then(r => {
      sources = r.sources || [];
      for (const s of sources) prov.append(h('option', { value: s.id, disabled: !s.ready, title: s.ready ? s.license : `Needs ${s.needsKey} in the server environment` }, s.ready ? s.label : `${s.label} (needs ${s.needsKey})`));
      licence.textContent = sources[0] ? `${sources[0].label}: ${sources[0].license}. The author, source page and license are saved with each photo.` : '';
    }).catch(e => toast(e.message, 'error'));
    m = modal({
      title: 'Free stock photos', wide: true, onClose: () => fin([]),
      content: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 'min(860px, 92vw)' } },
        h('div', { class: 'row', style: { gap: '6px' } }, prov, q, h('button', { class: 'btn', onclick: () => run(1) }, 'Search')),
        licence, status, grid, more),
      actions: close => [vis, h('button', { class: 'btn', onclick: () => { fin([]); close(); } }, 'Cancel'), importBtn]
    });
    setTimeout(() => q.focus(), 30);
  });
}
