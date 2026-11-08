/**
 * "Connect an AI coder" panel: pick a client (Claude Code, Codex, Gemini CLI, Antigravity, Cursor,
 * VS Code Copilot, Windsurf, Cline, opencode, Zed, Claude Desktop, any stdio client) and a shell, and
 * get copy-ready commands / config files. Recipes come from client-setup.js (pure, unit tested).
 *
 * With a plaintext key (right after create / rotate) the recipes can write it inline or into an env
 * variable. Without one (keys are shown once) they use the env variable with a placeholder value.
 */
import { h, toast } from '/js/dom.js';
import { CLIENTS, SHELLS, DEFAULT_SERVER_NAME, DEFAULT_ENV_VAR, buildClientSetup, setupAsText } from './client-setup.js';

const PREF = 'aik-connect-prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePrefs = p => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage off */ } };
const guessShell = () => (/win/i.test(navigator.userAgentData?.platform || navigator.platform || '') ? 'any' : 'posix');

let stylesDone = false;
function injectStyles() {
  if (stylesDone || document.getElementById('aik-connect-styles')) return;
  stylesDone = true;
  document.head.append(h('style', { id: 'aik-connect-styles' }, `
.aic { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.aic-clients { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
.aic-client { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 7px 9px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel2); color: var(--text); text-align: left; min-width: 0; }
.aic-client small { color: var(--muted); font-size: 10.5px; line-height: 1.3; }
.aic-client .aic-group { font-size: 9.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
.aic-client:hover { border-color: var(--accent); }
.aic-client.on { border-color: var(--accent); background: rgba(46,155,255,.16); box-shadow: 0 0 0 1px var(--accent) inset; }
.aic-opts { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.aic-opts .field { min-width: 0; }
.aic-step { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.aic-step-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(255,255,255,.03); font-size: 12px; }
.aic-step-head .aic-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.aic-step pre { margin: 0; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre; overflow-x: auto; background: #060a13; color: var(--text); }
.aic-notes { margin: 0; padding-left: 18px; font-size: 12px; color: #f5d08a; }
.aic-prompt { font-size: 12px; color: var(--muted); }
.aic-prompt b { color: var(--text); }
`));
}

/**
 * @param {{ key?: string, projects?: Array<{id,key,name}>, projectId?: number, compact?: boolean }} opts
 *   key: plaintext key (only right after create / rotate). projects: owned projects, used for the
 *   server-name suggestion when one machine talks to several projects.
 */
export function connectPanel({ key = '', projects = [], projectId = null, keyKind: fixedKind = null } = {}) {
  injectStyles();
  const url = `${location.origin}/mcp`;
  const prefs = loadPrefs();
  let client = CLIENTS.some(c => c.id === prefs.client) ? prefs.client : 'claude-code';
  let shell = SHELLS.some(([s]) => s === prefs.shell) ? prefs.shell : guessShell();
  let keyMode = key ? (prefs.keyMode === 'inline' ? 'inline' : 'env') : 'env';
  const proj = projects.find(p => p.id === projectId) || projects[0] || null;
  let keyKind = fixedKind || (prefs.keyKind === 'account' ? 'account' : 'project');
  const kindSel = h('select', { 'aria-label': 'Key type', disabled: !!fixedKind },
    h('option', { value: 'project', selected: keyKind === 'project' }, 'Project key (stored per repository)'),
    h('option', { value: 'account', selected: keyKind === 'account' }, 'Account key (all my projects, user level)'));

  const serverName = h('input', { type: 'text', value: DEFAULT_SERVER_NAME, maxlength: '60', 'aria-label': 'MCP server name' });
  const envVar = h('input', { type: 'text', value: DEFAULT_ENV_VAR, maxlength: '60', 'aria-label': 'Environment variable' });
  const perProject = h('input', { type: 'checkbox' });
  const shellSel = h('select', { 'aria-label': 'Shell' }, SHELLS.map(([v, l]) => h('option', { value: v, selected: v === shell }, l)));
  const modeSel = h('select', { 'aria-label': 'Where the key goes', disabled: !key },
    h('option', { value: 'env', selected: keyMode === 'env' }, 'Environment variable (recommended)'),
    h('option', { value: 'inline', selected: keyMode === 'inline' }, 'Inline in the command / user config'));

  const grid = h('div', { class: 'aic-clients', role: 'radiogroup', 'aria-label': 'AI coding client' });
  const out = h('div', { class: 'aic' });
  const remember = () => savePrefs({ client, shell, keyMode, ...(fixedKind ? {} : { keyKind }) });

  const drawClients = () => grid.replaceChildren(...CLIENTS.map(c => h('button', {
    type: 'button', class: `aic-client${c.id === client ? ' on' : ''}`, role: 'radio', 'aria-checked': String(c.id === client),
    onclick: () => { client = c.id; remember(); drawClients(); draw(); }
  }, h('span', { class: 'aic-group' }, c.group), h('b', {}, c.label), h('small', {}, c.description))));

  const draw = () => {
    const setup = buildClientSetup({ client, url, key, keyMode, shell, serverName: serverName.value, envVar: envVar.value, projectKey: proj?.key || '', keyKind });
    const copyBtn = (text, what) => h('button', { type: 'button', class: 'btn sm', onclick: () => copy(text, what) }, 'Copy');
    const pr = setup.prereq;
    out.replaceChildren(
      pr ? h('div', { class: 'aic-step aic-prereq' },
        h('div', { class: 'aic-step-head' },
          h('div', {}, h('div', {}, `Needs ${pr.name} — check with: `, h('code', {}, `${pr.cmd} --version`)),
            h('div', { class: 'aic-path' }, 'Not installed? Run one of these, then open a new terminal. "Copy all steps" checks it for you and stops with this hint.')),
          pr.install.length ? copyBtn(pr.install[0], 'Install command') : ''),
        h('pre', {}, [...pr.install, ...(pr.note ? [`# ${pr.note}`] : []), `# docs: ${pr.docs}`].join('\n'))) : '',
      ...setup.steps.map(s => h('div', { class: 'aic-step' },
        h('div', { class: 'aic-step-head' },
          h('div', {}, h('div', {}, s.title), s.path ? h('div', { class: 'aic-path' }, s.path) : null),
          copyBtn(s.text, s.path ? s.path : 'Command')),
        h('pre', {}, s.text))),
      setup.notes.length ? h('ul', { class: 'aic-notes' }, setup.notes.map(n => h('li', {}, n))) : '',
      h('div', { class: 'row spread' },
        h('div', { class: 'aic-prompt' }, 'Then tell your agent: ', h('b', {}, `“${setup.prompt}”`)),
        h('button', { type: 'button', class: 'btn sm primary', onclick: () => copy(setupAsText(setup), `${setup.label} setup`) }, 'Copy all steps'))
    );
  };

  const syncPerProject = () => {
    if (perProject.checked && proj) {
      const slug = String(proj.key).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
      serverName.value = `${DEFAULT_SERVER_NAME}-${slug}`;
      envVar.value = `${DEFAULT_ENV_VAR}_${slug.replace(/-/g, '_').toUpperCase()}`;
    } else { serverName.value = DEFAULT_SERVER_NAME; envVar.value = DEFAULT_ENV_VAR; }
    draw();
  };
  perProject.addEventListener('change', syncPerProject);
  shellSel.addEventListener('change', () => { shell = shellSel.value; remember(); draw(); });
  modeSel.addEventListener('change', () => { keyMode = modeSel.value; remember(); draw(); });
  kindSel.addEventListener('change', () => { keyKind = kindSel.value; remember(); draw(); });
  serverName.addEventListener('input', draw);
  envVar.addEventListener('input', draw);

  drawClients(); draw();
  return h('div', { class: 'aic' },
    grid,
    h('div', { class: 'aic-opts' },
      h('label', { class: 'field' }, h('span', {}, 'Key type'), kindSel),
      h('label', { class: 'field' }, h('span', {}, 'Shell'), shellSel),
      h('label', { class: 'field' }, h('span', {}, key ? 'Key goes into' : 'Key goes into (key not shown again)'), modeSel),
      h('label', { class: 'field' }, h('span', {}, 'Server name'), serverName),
      h('label', { class: 'field' }, h('span', {}, 'Env variable'), envVar),
      proj ? h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', color: 'var(--muted)' } }, perProject, h('span', {}, `Name per project (${proj.key})`)) : ''),
    out);
}

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'ok'); }
  catch { toast('Copy failed — select the text and copy it by hand', 'error'); }
}
