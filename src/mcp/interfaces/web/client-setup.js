/**
 * Connection recipes for AI coding clients (pure, no DOM: also imported by node tests).
 *
 * buildClientSetup({ client, url, key, keyMode, shell, serverName, envVar, projectKey, keyKind })
 *   → { client, label, keyKind, steps: [{ title, lang, path?, text, secret? }], notes[], prompt, gitignore[] }
 *
 *  - keyKind 'project' (one key per project): the key is stored PER REPOSITORY — Claude Code local scope
 *    (run inside the repo), Gemini .gemini/.env, direnv .envrc for other shells' CLIs, VS Code input prompt —
 *    so several repositories on one laptop can each use their own project key under the same server name.
 *  - keyKind 'account' (user-wide key): stored ONCE at user level; each repository's .uiux/config.json
 *    names its project and the agent passes it as `project` on every call.
 *  - steps with `secret: true` hold the key: their `path` is returned in gitignore[] (never commit them).
 *
 *  - keyMode 'env'    (recommended): the key lives in an environment variable; configs reference it.
 *  - keyMode 'inline': the key is written into the command / user-level config (never a repo file).
 *    Without a plaintext key (keys are shown once) recipes always use 'env' with a placeholder value.
 *  - shell: 'posix' (bash / zsh), 'powershell', 'fish', 'cmd': only the env-var lines and the shell
 *    variable syntax inside commands change.
 *
 * Every client gets a remote Streamable-HTTP config where it supports one; the rest use the
 * `mcp-remote` stdio bridge (npx), which works with any MCP client.
 */

export const DEFAULT_SERVER_NAME = 'kyrpy-uiux';
export const DEFAULT_ENV_VAR = 'KYRPY_UIUX_API_KEY';
export const KEY_PLACEHOLDER = 'kud_live_<paste-your-key-here>';

export const SHELLS = [
  ['posix', 'bash / zsh (macOS, Linux, WSL)'],
  ['powershell', 'PowerShell (Windows)'],
  ['fish', 'fish'],
  ['cmd', 'Windows cmd']
];

/** id, label, group, short description. Order = order in the picker. */
export const CLIENTS = [
  ['claude-code', 'Claude Code', 'CLI', 'Anthropic’s terminal coding agent (claude)'],
  ['codex', 'Codex CLI', 'CLI', 'OpenAI Codex CLI / IDE extension (codex)'],
  ['gemini', 'Gemini CLI', 'CLI', 'Google Gemini CLI (gemini)'],
  ['antigravity', 'Antigravity (agy)', 'IDE', 'Google Antigravity agent IDE'],
  ['cursor', 'Cursor', 'IDE', 'Cursor editor agent'],
  ['vscode', 'VS Code · GitHub Copilot', 'IDE', 'Copilot agent mode in VS Code'],
  ['windsurf', 'Windsurf', 'IDE', 'Windsurf / Cascade'],
  ['cline', 'Cline / Roo Code', 'IDE', 'Cline and Roo Code VS Code extensions'],
  ['opencode', 'opencode', 'CLI', 'sst/opencode terminal agent'],
  ['zed', 'Zed', 'IDE', 'Zed editor agent panel'],
  ['claude-desktop', 'Claude Desktop', 'App', 'Claude desktop app (via mcp-remote bridge)'],
  ['bridge', 'Other (stdio bridge)', 'Any', 'Any MCP client that only runs local commands'],
  ['generic', 'Raw details', 'Any', 'Endpoint, transport and header for manual setup']
].map(([id, label, group, description]) => ({ id, label, group, description }));

/**
 * The command-line tool each client's terminal steps need. There is no kyrpy-uiux CLI to download or build:
 * the MCP server is this designer's /mcp endpoint, so a user only needs their own agent's CLI (and Node.js for
 * npm installs / the npx bridge). "Copy all steps" checks for `cmd` first and prints `install` when missing.
 */
const NODE_NOTE = 'npm needs Node.js 18+: https://nodejs.org';
const BRIDGE = { cmd: 'npx', name: 'Node.js (npx, for the mcp-remote bridge)', docs: 'https://nodejs.org', install: {}, note: 'Install Node.js 18+ from https://nodejs.org (it includes npx).' };
export const PREREQS = {
  'claude-code': { cmd: 'claude', name: 'Claude Code CLI', docs: 'https://docs.anthropic.com/en/docs/claude-code/setup',
    install: { posix: 'curl -fsSL https://claude.ai/install.sh | bash', fish: 'curl -fsSL https://claude.ai/install.sh | bash', powershell: 'irm https://claude.ai/install.ps1 | iex', any: 'npm install -g @anthropic-ai/claude-code' }, note: NODE_NOTE },
  codex: { cmd: 'codex', name: 'OpenAI Codex CLI', docs: 'https://github.com/openai/codex', install: { any: 'npm install -g @openai/codex' }, note: NODE_NOTE },
  gemini: { cmd: 'gemini', name: 'Gemini CLI', docs: 'https://github.com/google-gemini/gemini-cli', install: { any: 'npm install -g @google/gemini-cli' }, note: NODE_NOTE },
  opencode: { cmd: 'opencode', name: 'opencode', docs: 'https://opencode.ai/docs', install: { any: 'npm install -g opencode-ai' }, note: NODE_NOTE },
  vscode: { cmd: 'code', name: 'VS Code "code" command', docs: 'https://code.visualstudio.com/docs/setup/setup-overview', install: {}, note: 'macOS: VS Code → Command Palette → "Shell Command: Install \'code\' command in PATH". The Windows and Linux installers add it.' },
  bridge: BRIDGE, 'claude-desktop': BRIDGE, zed: BRIDGE
};

/** What a client needs on a shell: install commands (shell-specific first, then npm), a note and the docs. */
export function prereqFor(client, shell = 'posix') {
  const p = PREREQS[client];
  if (!p) return null;
  return { cmd: p.cmd, name: p.name, docs: p.docs, note: p.note || '', install: [p.install[shell], p.install.any].filter(Boolean) };
}

const json = v => JSON.stringify(v, null, 2);
const sq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;          // POSIX single quotes
const psq = s => `'${String(s).replace(/'/g, "''")}'`;             // PowerShell single quotes

/** Shell reference to the env var, e.g. $KYRPY_UIUX_API_KEY / $env:KYRPY_UIUX_API_KEY / %KYRPY_UIUX_API_KEY%. */
export function shellVar(shell, name) {
  return shell === 'powershell' ? `$env:${name}` : shell === 'cmd' ? `%${name}%` : `$${name}`;
}

/** Lines that store the key in an environment variable (session + persistent). */
export function envLines(shell, name, value) {
  switch (shell) {
    case 'powershell':
      return `# this session\n$env:${name} = ${psq(value)}\n# persist for new terminals (current user)\n[Environment]::SetEnvironmentVariable(${psq(name)}, ${psq(value)}, 'User')`;
    case 'fish':
      return `# universal variable, kept across sessions\nset -Ux ${name} ${sq(value)}`;
    case 'cmd':
      return `rem this session\nset "${name}=${value}"\nrem persist for new terminals\nsetx ${name} "${value}"`;
    default:
      return `# this session\nexport ${name}=${sq(value)}\n# persist: add the same line to ~/.zshrc or ~/.bashrc\necho "export ${name}=${sq(value)}" >> ~/.zshrc`;
  }
}

const shellLang = shell => (shell === 'powershell' ? 'powershell' : shell === 'cmd' ? 'bat' : 'bash');

export function buildClientSetup({
  client = 'claude-code', url, key = '', keyMode = 'env', shell = 'posix',
  serverName = DEFAULT_SERVER_NAME, envVar = DEFAULT_ENV_VAR, projectKey = '', keyKind = 'project'
} = {}) {
  const perRepo = keyKind !== 'account';
  if (!url) throw new Error('url is required');
  const hasKey = /^kud_(live|test)_[0-9A-Za-z]{32}$/.test(String(key));
  const mode = hasKey && keyMode === 'inline' ? 'inline' : 'env';
  const value = hasKey ? key : KEY_PLACEHOLDER;
  const name = String(serverName || DEFAULT_SERVER_NAME).trim().replace(/[^A-Za-z0-9_.-]/g, '-') || DEFAULT_SERVER_NAME;
  const ev = String(envVar || DEFAULT_ENV_VAR).trim().replace(/[^A-Za-z0-9_]/g, '_') || DEFAULT_ENV_VAR;
  const info = CLIENTS.find(c => c.id === client) || CLIENTS[0];
  const lang = shellLang(shell);
  const isWin = shell === 'powershell' || shell === 'cmd';

  // what goes into a header value inside a shell command / a config file
  const cmdBearer = mode === 'inline' ? `Bearer ${value}` : `Bearer ${shellVar(shell, ev)}`;
  const steps = [];
  const notes = [];
  // project key on a POSIX / fish shell: per-repository variable through direnv (.envrc, git-ignored);
  // account key or Windows shells: one user-level variable
  const direnv = perRepo && (shell === 'posix' || shell === 'fish');
  const envStep = (force = false) => {
    if (mode !== 'env' && !force) return;
    if (direnv) {
      steps.push({ title: `1. Store this project's key for this repository only (direnv: https://direnv.net — loads it when you cd into the repo)`, lang: 'bash', path: '.envrc', secret: true,
        text: `# .envrc in the repository root (git-ignored)\nexport ${ev}=${sq(value)}` });
      steps.push({ title: `${steps.length + 1}. Allow it once`, lang, text: shell === 'fish'
        ? 'if command -q direnv; direnv allow; else; echo "direnv is not installed: https://direnv.net/docs/installation.html (or use an account key)"; end'
        : 'if command -v direnv >/dev/null 2>&1; then direnv allow; else echo "direnv is not installed: https://direnv.net/docs/installation.html (or use an account key)"; fi' });
    } else {
      steps.push({ title: `1. Store the key in ${ev}${perRepo ? ' (one value at a time: switch it when you change projects, or use an account key)' : ''}`, lang, text: envLines(shell, ev, value) });
    }
  };
  const n = () => `${steps.length + 1}.`;
  // double quotes keep $VAR / $env:VAR / %VAR% expandable in every supported shell
  const argExpand = s => `"${s}"`;
  const bridgeArgs = (headerEnv = 'AUTH_HEADER') => ['-y', 'mcp-remote', url, '--header', `Authorization:\${${headerEnv}}`];
  const bridgeEnv = mode === 'inline' ? { AUTH_HEADER: `Bearer ${value}` } : { AUTH_HEADER: `Bearer \${${ev}}` };

  switch (info.id) {
    case 'claude-code': {
      // project keys: local scope = this repository only (stored per path in ~/.claude.json, never in the repo);
      // account keys: user scope = every repository on this machine
      const scope = perRepo ? 'local' : 'user';
      const literal = `Authorization: Bearer ${value}`;
      // an older entry with the same name (an expired key) in a narrower scope wins over the new one:
      // local > project > user, so remove it first ("not found" is fine)
      const nul = shell === 'powershell' ? '$null' : shell === 'cmd' ? 'nul' : '/dev/null';
      const ok = shell === 'posix' || shell === 'fish' ? ' || true' : '';
      const staleRemoval = scopes => scopes.map(sc => `claude mcp remove ${name} -s ${sc} 2>${nul}${ok}\n`).join('');
      steps.push({ title: perRepo
        ? `1. In the repository root, add the server for this repository only (local scope: stored in ~/.claude.json under this folder, never in the repo)`
        : `1. Add the server once for every repository (user scope; each repo's .uiux/config.json names its project)`, lang,
        text: `${perRepo ? '# run this inside your repository root\n' : ''}${staleRemoval(perRepo ? ['local'] : ['local', 'user'])}claude mcp add --transport http --scope ${scope} ${name} ${url} --header ${argExpand(mode === 'inline' || !hasKey ? literal : `Authorization: ${cmdBearer}`)}` });
      if (mode === 'env' && hasKey) steps.unshift({ title: `0. Make the key available to the command (only while adding it)`, lang, text: envLines(shell, ev, value).split('\n').slice(0, 2).join('\n') });
      steps.push({ title: `${n()} Or share it with the team in .mcp.json (the key stays in each person’s ${ev})`, lang: 'json', path: '.mcp.json',
        text: json({ mcpServers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer \${${ev}}` } } } }) });
      steps.push({ title: `${n()} Check the connection${perRepo ? ' (inside the repository)' : ''}`, lang, text: `claude mcp get ${name}` });
      if (perRepo) notes.push('Run the add command once in each repository with that project\'s key: the same server name can hold a different key per folder.');
      notes.push(`claude mcp get ${name} shows the entry that wins (local > project > user scope). "invalid, expired or revoked API key" there means an old key: create a new one and run the add step again.`);
      break;
    }
    case 'codex': {
      // Codex reads bearer tokens only from an environment variable, in both key modes
      steps.push({ title: `1. Store the key in ${ev}`, lang, text: envLines(shell, ev, value) });
      steps.push({ title: `${n()} Add the server (stored in ~/.codex/config.toml; Codex reads the key from ${ev} at run time)`, lang,
        text: `codex mcp add ${name} --url ${url} --bearer-token-env-var ${ev}` });
      steps.push({ title: `${n()} Or edit ~/.codex/config.toml by hand`, lang: 'toml', path: isWin ? '%USERPROFILE%\\.codex\\config.toml' : '~/.codex/config.toml',
        text: `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : `"${name}"`}]\nurl = "${url}"\nbearer_token_env_var = "${ev}"` });
      steps.push({ title: `${n()} Check the connection`, lang, text: 'codex mcp list' });
      if (mode === 'inline') notes.push('Codex only takes bearer tokens from an environment variable, so the key goes into the variable above.');
      break;
    }
    case 'gemini': {
      if (perRepo) {
        // per repository: Gemini CLI loads .gemini/.env of the project and expands $VARS in settings.json
        steps.push({ title: '1. Key for this repository only (git-ignored; Gemini CLI loads it automatically)', lang: 'bash', path: '.gemini/.env', secret: true, text: `${ev}=${value}` });
        steps.push({ title: `${n()} Project settings (safe to commit: only the variable name)`, lang: 'json', path: '.gemini/settings.json',
          text: json({ mcpServers: { [name]: { httpUrl: url, headers: { Authorization: `Bearer $${ev}` } } } }) });
        steps.push({ title: `${n()} Check the connection (start gemini inside the repository)`, lang: 'text', text: '/mcp' });
        break;
      }
      envStep();
      steps.push({ title: `${n()} Add the server (user scope: ~/.gemini/settings.json)`, lang,
        text: `gemini mcp add --scope user --transport http ${name} ${url} --header ${argExpand(`Authorization: ${cmdBearer}`)}` });
      steps.push({ title: `${n()} Or edit settings.json (project: .gemini/settings.json — keep the key in ${ev})`, lang: 'json', path: '~/.gemini/settings.json',
        text: json({ mcpServers: { [name]: { httpUrl: url, headers: { Authorization: mode === 'inline' ? `Bearer ${value}` : `Bearer $${ev}` } } } }) });
      steps.push({ title: `${n()} Check the connection (inside gemini)`, lang: 'text', text: '/mcp' });
      break;
    }
    case 'antigravity': {
      envStep();
      steps.push({ title: `${n()} Antigravity → Agent panel ⋯ → MCP Servers → Manage MCP Servers → View raw config, then merge:`, lang: 'json',
        path: isWin ? '%USERPROFILE%\\.gemini\\antigravity\\mcp_config.json' : '~/.gemini/antigravity/mcp_config.json',
        text: json({ mcpServers: { [name]: { serverUrl: url, headers: { Authorization: mode === 'inline' ? `Bearer ${value}` : `Bearer \${${ev}}` } } } }) });
      steps.push({ title: `${n()} If your Antigravity build does not expand \${${ev}}: use the stdio bridge instead`, lang: 'json',
        text: json({ mcpServers: { [name]: { command: 'npx', args: bridgeArgs(), env: bridgeEnv } } }) });
      notes.push('Restart the agent session (or press Refresh in Manage MCP Servers) after saving.');
      break;
    }
    case 'cursor': {
      envStep();
      steps.push({ title: `${n()} Project: .cursor/mcp.json (or global: ~/.cursor/mcp.json)`, lang: 'json', path: '.cursor/mcp.json',
        text: json({ mcpServers: { [name]: { url, headers: { Authorization: mode === 'inline' ? `Bearer ${value}` : `Bearer \${env:${ev}}` } } } }) });
      steps.push({ title: `${n()} Cursor → Settings → MCP: the server should show a green dot`, lang: 'text', text: 'Settings → Tools & Integrations → MCP' });
      if (mode === 'inline') notes.push('With the key written inline, use the global ~/.cursor/mcp.json, not the project file.');
      break;
    }
    case 'vscode': {
      const auth = `Bearer ${mode === 'inline' ? value : `\${input:${name}-key}`}`;
      const addJson = JSON.stringify({ name, type: 'http', url, headers: { Authorization: auth } });
      steps.push({ title: `${n()} Workspace: .vscode/mcp.json (VS Code asks for the key once and stores it securely)`, lang: 'json', path: '.vscode/mcp.json',
        text: json({
          servers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer \${input:${name}-key}` } } },
          inputs: [{ type: 'promptString', id: `${name}-key`, description: `Kyrpy UI/UX API key${projectKey ? ` (${projectKey})` : ''}`, password: true }]
        }) });
      steps.push({ title: `${n()} Or add it to your user profile from the terminal`, lang,
        text: `code --add-mcp ${shell === 'powershell' ? psq(addJson) : shell === 'cmd' ? `"${addJson.replace(/"/g, '\\"')}"` : sq(addJson)}` });
      steps.push({ title: `${n()} Open Copilot Chat → Agent mode → Tools: enable “${name}”`, lang: 'text', text: 'MCP: List Servers (command palette) → Start' });
      break;
    }
    case 'windsurf': {
      envStep();
      steps.push({ title: `${n()} Windsurf → Settings → Cascade → MCP Servers → View raw config, then merge:`, lang: 'json',
        path: isWin ? '%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json' : '~/.codeium/windsurf/mcp_config.json',
        text: json({ mcpServers: { [name]: { serverUrl: url, headers: { Authorization: mode === 'inline' ? `Bearer ${value}` : `Bearer \${env:${ev}}` } } } }) });
      notes.push('Press Refresh in the MCP Servers panel after saving.');
      break;
    }
    case 'cline': {
      envStep();
      steps.push({ title: `${n()} Cline → MCP Servers → Configure → “Configure MCP Servers”, then merge into cline_mcp_settings.json:`, lang: 'json', path: 'cline_mcp_settings.json',
        text: json({ mcpServers: { [name]: { type: 'streamableHttp', url, headers: { Authorization: `Bearer ${value}` }, disabled: false } } }) });
      notes.push('Cline does not expand environment variables in this file, so it holds the key itself. The file is in your VS Code user data folder, not in the repository. Roo Code uses the same block in its mcp_settings.json.');
      if (!hasKey) notes.push(`Replace ${KEY_PLACEHOLDER} with your key.`);
      break;
    }
    case 'opencode': {
      envStep();
      steps.push({ title: `${n()} Project: opencode.json (or global: ~/.config/opencode/opencode.json)`, lang: 'json', path: 'opencode.json',
        text: json({ $schema: 'https://opencode.ai/config.json', mcp: { [name]: { type: 'remote', url, enabled: true, headers: { Authorization: mode === 'inline' ? `Bearer ${value}` : `Bearer {env:${ev}}` } } } }) });
      steps.push({ title: `${n()} Check the connection`, lang, text: 'opencode mcp list' });
      break;
    }
    case 'zed': {
      envStep();
      steps.push({ title: `${n()} Zed → Agent panel → Settings → Add Custom Server, or merge into settings.json:`, lang: 'json', path: isWin ? '%APPDATA%\\Zed\\settings.json' : '~/.config/zed/settings.json',
        text: json({ context_servers: { [name]: { command: 'npx', args: bridgeArgs(), env: mode === 'inline' ? bridgeEnv : { AUTH_HEADER: `Bearer ${value}` } } } }) });
      notes.push('Zed runs the server through the mcp-remote stdio bridge (needs Node.js 18+). Zed does not expand variables in settings.json, so replace the placeholder with your key.');
      break;
    }
    case 'claude-desktop': {
      steps.push({ title: `${n()} Claude Desktop → Settings → Developer → Edit Config, then merge:`, lang: 'json',
        path: isWin ? '%APPDATA%\\Claude\\claude_desktop_config.json' : '~/Library/Application Support/Claude/claude_desktop_config.json',
        text: json({ mcpServers: { [name]: { command: 'npx', args: bridgeArgs(), env: { AUTH_HEADER: `Bearer ${value}` } } } }) });
      notes.push('Claude Desktop starts local commands only, so it uses the mcp-remote bridge (Node.js 18+). Restart Claude Desktop after saving.');
      if (!hasKey) notes.push(`Replace ${KEY_PLACEHOLDER} with your key.`);
      break;
    }
    case 'bridge': {
      envStep();
      steps.push({ title: `${n()} Command your client should start (stdio)`, lang, manual: true,
        text: `npx -y mcp-remote ${url} --header ${argExpand(`Authorization: ${cmdBearer}`)}` });
      steps.push({ title: `${n()} Typical JSON form (mcpServers block)`, lang: 'json',
        text: json({ mcpServers: { [name]: { command: 'npx', args: bridgeArgs(), env: { AUTH_HEADER: `Bearer ${value}` } } } }) });
      notes.push('mcp-remote turns this remote MCP server into a local stdio one, for clients without HTTP support. Needs Node.js 18+.');
      break;
    }
    default: {
      steps.push({ title: '1. Connection details', lang: 'text',
        text: `Server name:  ${name}\nMCP endpoint: ${url}\nTransport:    Streamable HTTP (JSON-RPC 2.0; protocol 2025-06-18, 2025-03-26, 2024-11-05)\nHeader:       Authorization: Bearer ${mode === 'inline' ? value : `<value of ${ev}>`}\nProject:      ${projectKey || '(bound to the key)'}` });
      steps.push({ title: '2. Quick test with curl (bash / zsh)', lang: 'bash',
        text: `curl -s ${url} -H "Authorization: Bearer ${mode === 'inline' ? value : `$${ev}`}" \\\n  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"uiux_whoami","arguments":{}}}'` });
      break;
    }
  }
  if (steps.some(st => st.path === '.envrc') && info.group === 'IDE') {
    notes.push(`${info.label} sees .envrc only when started from the repository terminal (for example "cursor ." / "code .") or with a direnv extension.`);
  }
  if (!url.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) {
    notes.push('This server is reached over plain HTTP. Use HTTPS for anything but a local machine: the key travels in a header.');
  }
  // steps are numbered while they are built and step 0 may be inserted first: number them 1..n once here
  steps.forEach((st, i) => { st.title = st.title.replace(/^\d+\.\s*/, `${i + 1}. `); });
  return {
    client: info.id, label: info.label, keyMode: mode, keyKind: perRepo ? 'project' : 'account', shell, prereq: prereqFor(info.id, shell), steps, notes,
    gitignore: [...new Set(steps.filter(st => st.secret && st.path).map(st => st.path))],
    prompt: perRepo
      ? 'Run uiux_init for this project, then follow its steps.'
      : 'Run uiux_init. It lists my projects with their versions: ask me whether to clone one into a new project or edit one of mine (and which version), then follow its steps.'
  };
}

/** Files that hold the key and are written by the copied script (one `NAME=value` / `export NAME=value` line). */
const KEY_FILES = new Set(['.envrc', '.gemini/.env']);

/**
 * All steps as ONE script that can be pasted into the chosen shell:
 *  - first checks that the client's CLI is installed; when it is not, it only prints where to get it;
 *  - runs the terminal commands; key files (.envrc, .gemini/.env) are written by replacing that one line;
 *  - config-file contents (JSON / TOML), in-app steps and commands the client starts itself are COMMENTED
 *    (pasting a JSON block into a shell runs "mcpServers:" as a command).
 */
export function setupAsText(setup) {
  const shell = setup.shell || 'posix';
  const cm = shell === 'cmd' ? 'rem ' : '# ';
  const comment = t => String(t).split('\n').map(l => `${cm}${l}`.trimEnd()).join('\n');
  const runLang = shellLang(shell);
  const blocks = [];
  for (const st of setup.steps) {
    const head = comment(`${st.title}${st.path ? `\nfile: ${st.path}` : ''}`);
    if (st.path && KEY_FILES.has(st.path) && shell !== 'cmd') {
      blocks.push(`${head}\n${writeKeyLine(shell, st.path, st.text.split('\n').filter(l => l && !l.startsWith('#')).pop())}`);
    } else if (st.manual || st.path || st.lang !== runLang) {
      blocks.push(`${head}\n${comment(`(manual step — not run by this script${st.path ? `; save or merge into ${st.path}` : ''}):`)}\n${comment(st.text)}`);
    } else {
      blocks.push(`${head}\n${st.text}`);
    }
  }
  const notes = setup.notes.length ? `\n\n${comment(`Notes:\n${setup.notes.map(x => `- ${x}`).join('\n')}`)}` : '';
  const tail = `\n\n${comment(`Then tell your agent: "${setup.prompt}"`)}\n`;
  return `${wrapPrereq(shell, setup.prereq, blocks.join('\n\n'))}${notes}${tail}`;
}

/** Replace (or add) the single key line of a key file, creating its folder. */
function writeKeyLine(shell, path, line) {
  const name = line.replace(/^export\s+/, '').split('=')[0];
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const lit = `"${line.replace(/(["\\$`])/g, '\\$1')}"`;    // double-quoted: the line itself only has single quotes
  if (shell === 'powershell') {
    const ps = `'${line.replace(/'/g, "''")}'`;
    return `${dir ? `New-Item -ItemType Directory -Force -Path '${dir}' | Out-Null\n` : ''}$lines = @(Get-Content '${path}' -ErrorAction SilentlyContinue | Where-Object { $_ -notmatch '^(export\\s+)?${name}=' }) + ${ps}\nSet-Content -Path '${path}' -Value $lines`;
  }
  if (shell === 'fish') {
    return `${dir ? `mkdir -p ${dir}\n` : ''}begin; grep -v '^\\(export \\)\\{0,1\\}${name}=' ${path} 2>/dev/null; printf '%s\\n' ${lit}; end > ${path}.tmp; and mv ${path}.tmp ${path}`;
  }
  return `${dir ? `mkdir -p ${dir}\n` : ''}{ grep -v '^\\(export \\)\\{0,1\\}${name}=' ${path} 2>/dev/null; printf '%s\\n' ${lit}; } > ${path}.tmp && mv ${path}.tmp ${path}`;
}

/** Runs `body` only when the client CLI exists; otherwise prints how to install it. */
function wrapPrereq(shell, prereq, body) {
  if (!prereq) return body;
  // an if-block must hold at least one command (e.g. Claude Desktop: every step is manual)
  const runnable = body.split('\n').some(l => l.trim() && !/^(#|rem )/.test(l.trim()));
  if (!runnable) body += `\n${shell === 'cmd' ? 'rem' : '#'} nothing to run in the terminal: follow the manual steps above\n${shell === 'powershell' ? '$null = $true' : shell === 'cmd' ? '' : 'true'}`;
  const msg = [`${prereq.name} ("${prereq.cmd}") is not installed. Install it, open a new terminal and paste these steps again:`,
    ...prereq.install.map(l => `  ${l}`), ...(prereq.note ? [`  ${prereq.note}`] : []), `  docs: ${prereq.docs}`];
  const title = `Requires ${prereq.name} ("${prereq.cmd}")`;
  if (shell === 'powershell') {
    const say = msg.map(l => `  Write-Host '${l.replace(/'/g, "''")}'`).join('\n');
    return `# ${title}\nif (-not (Get-Command ${prereq.cmd} -ErrorAction SilentlyContinue)) {\n${say}\n} else {\n\n${body}\n\n}`;
  }
  if (shell === 'cmd') {
    // cmd cannot wrap a multi-line block: stop at the first line instead (the rest then fails loudly)
    return `rem ${title}\nwhere ${prereq.cmd} >nul 2>nul || (${msg.map(l => `echo ${l.replace(/([&|<>^()])/g, '^$1')}`).join(' & ')})\n\n${body}`;
  }
  const say = msg.map(l => `  echo '${l.replace(/'/g, `'\\''`)}'`).join('\n');
  if (shell === 'fish') return `# ${title}\nif not command -q ${prereq.cmd}\n${say}\nelse\n\n${body}\n\nend`;
  return `# ${title}\nif ! command -v ${prereq.cmd} >/dev/null 2>&1; then\n${say}\nelse\n\n${body}\n\nfi`;
}
