/**
 * "Connect an AI coder" panel: pick a client (Claude Code, Codex, Gemini CLI, Antigravity, Cursor,
 * VS Code Copilot, Windsurf, Cline, opencode, Zed, Claude Desktop, any stdio client) and a shell, and
 * get copy-ready commands / config files. Recipes come from client-setup.js (pure, unit tested).
 *
 * With a plaintext key (right after create / rotate) the recipes can write it inline or into an env
 * variable. Without one (keys are shown once) they use the env variable with a placeholder value.
 */
import { h, toast } from '/js/dom.js';
import { CLIENTS, SHELLS, DEFAULT_SERVER_NAME, DEFAULT_ENV_VAR, buildClientSetup, setupAsText, setupAsFile } from './client-setup.js';

const PREF = 'aik-connect-prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF) || '{}'); } catch { return {}; } };
const savePrefs = p => { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch { /* storage off */ } };
const onWindows = () => /win/i.test(navigator.userAgentData?.platform || navigator.platform || '');
const guessShell = () => (onWindows() ? 'any' : 'posix');

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
.aic-shells { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 12px; color: var(--muted); }
.aic-shells button { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel2); color: var(--text); font-size: 12px; }
.aic-shells button:hover { border-color: var(--accent); }
.aic-shells button.on { border-color: var(--accent); background: rgba(46,155,255,.16); box-shadow: 0 0 0 1px var(--accent) inset; }
.aic-step { border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.aic-step-head { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(255,255,255,.03); font-size: 12px; }
.aic-step-head .aic-path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.aic-step pre { margin: 0; padding: 8px 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre; overflow-x: auto; background: #060a13; color: var(--text); }
.aic-admin { padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(245,181,68,.45); background: rgba(245,181,68,.09); font-size: 12px; color: #f5d08a; line-height: 1.45; }
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
export function connectPanel({ key: givenKey = '', projects = [], projectId = null, keyKind: fixedKind = null } = {}) {
  injectStyles();
  let key = givenKey;
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
  // every script exists for bash / zsh, PowerShell, cmd and fish: one click switches the syntax of all steps
  const shells = h('div', { class: 'aic-shells', role: 'radiogroup', 'aria-label': 'Terminal the script is for' });
  const drawShells = () => shells.replaceChildren(h('span', {}, 'Script for:'), ...SHELLS.map(([v, l, short]) => h('button', {
    type: 'button', class: v === shell ? 'on' : '', role: 'radio', 'aria-checked': String(v === shell), title: l, dataset: { shell: v },
    onclick: () => { shell = v; remember(); drawShells(); draw(); }
  }, short)));
  const modeSel = h('select', { 'aria-label': 'Where the key goes', disabled: !key },
    h('option', { value: 'env', selected: keyMode === 'env' }, 'Environment variable (recommended)'),
    h('option', { value: 'inline', selected: keyMode === 'inline' }, 'Inline in the command / user config'));

  // keys are stored hashed: for a script made later the user pastes the key (it stays in this page only)
  const keyInput = givenKey ? null : h('input', { type: 'password', placeholder: 'kud_live_… (optional)', autocomplete: 'off', spellcheck: 'false',
    'aria-label': 'API key to write into the script', dataset: { act: 'paste-key' } });
  keyInput?.addEventListener('input', () => { key = keyInput.value.trim(); modeSel.disabled = !key; if (!key) { keyMode = 'env'; modeSel.value = 'env'; } draw(); });

  const grid = h('div', { class: 'aic-clients', role: 'radiogroup', 'aria-label': 'AI coding client' });
  const out = h('div', { class: 'aic' });
  const remember = () => savePrefs({ client, shell, keyMode, ...(fixedKind ? {} : { keyKind }) });

  const drawClients = () => grid.replaceChildren(...CLIENTS.map(c => h('button', {
    type: 'button', class: `aic-client${c.id === client ? ' on' : ''}`, role: 'radio', 'aria-checked': String(c.id === client),
    onclick: () => { client = c.id; remember(); drawClients(); draw(); }
  }, h('span', { class: 'aic-group' }, c.group), h('b', {}, c.label), h('small', {}, c.description))));

  const draw = () => {
    const setup = buildClientSetup({ client, url, key, keyMode, shell, serverName: serverName.value, envVar: envVar.value, projectKey: proj?.key || '', keyKind,
      fallbackShell: onWindows() ? 'powershell' : 'posix' });
    // one script file per terminal; the shell-neutral recipe has no single file, so every format is offered
    const args = { client, url, key, keyMode, serverName: serverName.value, envVar: envVar.value, projectKey: proj?.key || '', keyKind };
    const files = (setup.shell === 'any' ? SHELLS.map(([v]) => v).filter(v => v !== 'any') : [setup.shell])
      .map(sh => setupAsFile(buildClientSetup({ ...args, shell: sh }))).filter(Boolean);
    // "any shell" exists for Claude Code only: say which syntax the other clients are shown in
    const fellBack = shell === 'any' && setup.shell !== 'any'
      ? `No shell-neutral script for ${setup.label}: shown for ${SHELLS.find(([v]) => v === setup.shell)?.[2] || setup.shell}. Pick your terminal above for another one.` : '';
    const copyBtn = (text, what) => h('button', { type: 'button', class: 'btn sm', onclick: () => copy(text, what) }, 'Copy');
    const pr = setup.prereq;
    out.replaceChildren(
      h('div', { class: 'aic-admin', role: 'note' },
        h('strong', {}, '⚠ Run as Administrator: '),
        `${setup.adminHint || 'Run your terminal or setup script as Administrator (sudo on Linux/macOS/WSL, or "Run as Administrator" on Windows)'}. `,
        `The script copies your API key into the system environment variable (`,
        h('code', {}, setup.envVar || DEFAULT_ENV_VAR),
        `) and permanently removes itself from disk once all steps finish properly.`),
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
      setup.notes.length || fellBack ? h('ul', { class: 'aic-notes' }, [...(fellBack ? [fellBack] : []), ...setup.notes].map(n => h('li', {}, n))) : '',
      h('div', { class: 'row spread' },
        h('div', { class: 'aic-prompt' }, 'Then tell your agent: ', h('b', {}, `“${setup.prompt}”`)),
        h('div', { class: 'row', style: { gap: '6px' } },
          files.length > 1 ? h('span', { class: 'aic-prompt' }, 'Download script:') : '',
          ...files.map(file => h('button', { type: 'button', class: 'btn sm', title: `${file.adminHint} — save ${file.filename}, then run in the repository root: ${file.run} (saves key to system variable ${file.envVar} and deletes itself when finished)`, dataset: { act: 'download-script' },
            onclick: () => download(file) }, files.length > 1 ? `.${file.filename.split('.').pop()}` : `Download .${file.filename.split('.').pop()}`)),
          h('button', { type: 'button', class: 'btn sm primary', onclick: () => copy(setupAsText(setup), `${setup.label} setup`) }, 'Copy all steps')))
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
  modeSel.addEventListener('change', () => { keyMode = modeSel.value; remember(); draw(); });
  kindSel.addEventListener('change', () => { keyKind = kindSel.value; remember(); draw(); });
  serverName.addEventListener('input', draw);
  envVar.addEventListener('input', draw);

  drawClients(); drawShells(); draw();
  return h('div', { class: 'aic' },
    grid,
    shells,
    h('div', { class: 'aic-opts' },
      h('label', { class: 'field' }, h('span', {}, 'Key type'), kindSel),
      keyInput ? h('label', { class: 'field' }, h('span', {}, 'Your key (not stored — paste to fill the script)'), keyInput) : '',
      h('label', { class: 'field' }, h('span', {}, 'Key goes into'), modeSel),
      h('label', { class: 'field' }, h('span', {}, 'Server name'), serverName),
      h('label', { class: 'field' }, h('span', {}, 'Env variable'), envVar),
      proj ? h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', color: 'var(--muted)' } }, perProject, h('span', {}, `Name per project (${proj.key})`)) : ''),
    out);
}

/** Saves the script file; the hint says how to run it (it holds the key when one was just created). */
function download(file) {
  const a = h('a', { href: URL.createObjectURL(new Blob([file.text], { type: 'text/plain' })), download: file.filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`${file.filename} saved. ${file.adminHint || 'Run as Administrator'} in the repository root: ${file.run} — copies the API key to system variable ${file.envVar || DEFAULT_ENV_VAR} and permanently deletes itself when finished.`, 'ok', 8000);
}

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'ok'); }
  catch { toast('Copy failed — select the text and copy it by hand', 'error'); }
}
