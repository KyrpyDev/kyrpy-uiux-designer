/**
 * The global unique prefix of a new project: asked once when the project is created (2-16 lowercase letters or digits).
 * Every public item dropped onto one of its screens is then named `prefix-[itemtype]-itemname`.
 */
import { promptBox, modal, h } from '../dom.js';
import { isValidProjectPrefix, isValidKey, slugify } from '/domain/naming.js';
import { api } from '../api.js';
import { state } from '../state.js';

export function suggestProjectPrefix(projectName = '') {
  const s = String(projectName).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^[^a-z]+/, '').slice(0, 16);
  return s.length >= 2 ? s : 'project';
}

/** Asks for the prefix; resolves to the prefix, or null when the user cancels. Re-asks until it is valid. */
export async function askProjectPrefix(projectName = '') {
  let value = suggestProjectPrefix(projectName);
  for (;;) {
    const answer = await promptBox('Project prefix', {
      value, okLabel: 'Set prefix',
      label: 'Global unique prefix of this project: 2-16 lowercase letters or digits, starting with a letter. It is set once and cannot be changed later.'
    });
    if (answer == null) return null;
    const p = String(answer).trim().toLowerCase();
    if (isValidProjectPrefix(p)) return p;
    value = p;
  }
}

/**
 * The one "create project" window: project title, project variable (the project's key: MCP tools and exports address the
 * project by it), description and the global prefix (set once). The variable and the prefix follow the title until they are
 * edited by hand. Server errors (a variable or prefix already taken) show in the window, which stays open.
 * Resolves to the created project, or null when cancelled.
 * @param {{ title?: string, name?: string, description?: string, visibility?: 'private'|'public'|'project', askVisibility?: boolean, intro?: string }} opts
 */
export function openCreateProjectDialog({ title = 'New project', name = '', description = '', visibility = 'private', askVisibility = false, intro = '' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    const keyOf = t => slugify(t || 'project', 'project');
    let keyEdited = false, prefixEdited = false;
    const err = h('div', { class: 'field-error', role: 'alert', style: { color: 'var(--danger, #EF4444)', fontSize: '12px', minHeight: '16px' } });
    const hint = (el, text) => h('small', { class: 'muted', style: { fontSize: '11px' } }, text);
    const nameIn = h('input', { type: 'text', value: name, 'data-f': 'np-name', placeholder: 'e.g. Mobile Banking Redesign', maxlength: 120 });
    const keyIn = h('input', { type: 'text', value: keyOf(name), 'data-f': 'np-key', placeholder: 'mobile-banking-redesign', spellcheck: false, style: { fontFamily: 'Consolas, monospace' } });
    const descIn = h('textarea', { rows: 3, 'data-f': 'np-desc', placeholder: 'What this project is for (shown to collaborators and to AI agents over MCP)' });
    descIn.value = description;
    const prefixIn = h('input', { type: 'text', value: suggestProjectPrefix(name), 'data-f': 'np-prefix', maxlength: 16, spellcheck: false, style: { fontFamily: 'Consolas, monospace' } });
    const visSel = askVisibility ? h('select', { 'data-f': 'np-vis' },
      h('option', { value: 'private', selected: visibility !== 'public' }, 'Private (project members only)'),
      h('option', { value: 'public', selected: visibility === 'public' }, 'Public (items visible to all projects)')) : null;
    const keyNote = h('small', { class: 'muted', 'data-f': 'np-key-note', style: { fontSize: '11px' } });
    const prefixNote = h('small', { class: 'muted', 'data-f': 'np-prefix-note', style: { fontSize: '11px' } });
    const taken = (field, v) => (state.projects || []).some(p => field === 'key' ? p.key === v : p.settings?.prefix === v);
    const check = () => {
      const k = keyIn.value.trim(), p = prefixIn.value.trim().toLowerCase();
      const keyBad = !isValidKey(k) ? 'Dashed lowercase words (a-z, 0-9, -), starting with a letter' : taken('key', k) ? `"${k}" is already used by another project` : '';
      const prefixBad = !isValidProjectPrefix(p) ? '2-16 lowercase letters or digits, starting with a letter' : taken('prefix', p) ? `"${p}" is already used by another project` : '';
      keyNote.textContent = keyBad || 'Used by MCP tools (uiux_init, uiux_edit_project…), the API and exports to address this project.';
      keyNote.style.color = keyBad ? 'var(--danger, #EF4444)' : '';
      prefixNote.textContent = prefixBad || `Set once, cannot be changed: public items dropped here are named ${p || 'prefix'}-[itemtype]-name.`;
      prefixNote.style.color = prefixBad ? 'var(--danger, #EF4444)' : '';
      return !nameIn.value.trim() ? 'Enter a project title' : keyBad ? `Project variable: ${keyBad}` : prefixBad ? `Project prefix: ${prefixBad}` : '';
    };
    nameIn.addEventListener('input', () => {
      if (!keyEdited) keyIn.value = keyOf(nameIn.value);
      if (!prefixEdited) prefixIn.value = suggestProjectPrefix(nameIn.value);
      err.textContent = ''; check();
    });
    keyIn.addEventListener('input', () => { keyEdited = true; keyIn.value = keyIn.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); err.textContent = ''; check(); });
    prefixIn.addEventListener('input', () => { prefixEdited = true; prefixIn.value = prefixIn.value.toLowerCase().replace(/[^a-z0-9]/g, ''); err.textContent = ''; check(); });
    check();
    let busy = false;
    const submit = async close => {
      if (busy) return;
      const bad = check();
      if (bad) { err.textContent = bad; return; }
      busy = true;
      try {
        const created = await api.createProject({
          name: nameIn.value.trim(), key: keyIn.value.trim(), description: descIn.value.trim(),
          prefix: prefixIn.value.trim().toLowerCase(), visibility: visSel ? visSel.value : visibility
        });
        finish(created); close();
      } catch (e) {
        err.textContent = e.message || 'The project could not be created';
      } finally { busy = false; }
    };
    let closeRef = null;
    const form = h('form', { class: 'np-form', 'data-f': 'np-form', onsubmit: e => { e.preventDefault(); if (closeRef) submit(closeRef); } },
      intro ? h('p', { class: 'muted', style: { marginTop: 0 } }, intro) : null,
      h('label', { class: 'field' }, h('span', {}, 'Project title'), nameIn, hint(nameIn, 'Shown to people.')),
      h('label', { class: 'field' }, h('span', {}, 'Project variable'), keyIn, keyNote),
      h('label', { class: 'field' }, h('span', {}, 'Project description'), descIn),
      h('label', { class: 'field' }, h('span', {}, 'Project prefix'), prefixIn, prefixNote),
      visSel ? h('label', { class: 'field' }, h('span', {}, 'Default visibility'), visSel) : null,
      err,
      h('button', { type: 'submit', hidden: true }));
    modal({ title, content: form, onClose: () => finish(null),
      actions: close => { closeRef = close; return [
        h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Cancel'),
        h('button', { class: 'btn primary', type: 'button', 'data-f': 'np-create', onclick: () => submit(close) }, 'Create project')]; } });
    setTimeout(() => { nameIn.focus(); nameIn.select(); }, 0);
  });
}
