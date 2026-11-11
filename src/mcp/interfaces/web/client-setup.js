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
  ['any', 'Not sure / any shell (works in bash, zsh, PowerShell and cmd)', 'Any shell'],
  ['posix', 'bash / zsh (macOS, Linux, WSL)', 'bash / zsh'],
  ['powershell', 'PowerShell (Windows)', 'PowerShell'],
  ['cmd', 'Windows cmd', 'cmd'],
  ['fish', 'fish', 'fish']
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

/** Human-readable instruction telling the user how to run the terminal / script as Administrator. */
export function adminHintFor(shell = 'posix') {
  if (shell === 'powershell') return 'Open PowerShell as Administrator (right-click PowerShell → "Run as Administrator")';
  if (shell === 'cmd') return 'Open Command Prompt as Administrator (right-click Command Prompt → "Run as administrator")';
  if (shell === 'fish' || shell === 'posix') return 'Run your terminal or script with Administrator / root privileges (sudo)';
  return 'Run your terminal or script with Administrator privileges (sudo on Linux/macOS/WSL, or "Run as Administrator" on Windows)';
}

/** Shell reference to the env var, e.g. $KYRPY_UIUX_API_KEY / $env:KYRPY_UIUX_API_KEY / %KYRPY_UIUX_API_KEY%. */
export function shellVar(shell, name) {
  return shell === 'powershell' ? `$env:${name}` : shell === 'cmd' ? `%${name}%` : `$${name}`;
}

/** Lines that store the key in the current session AND persist it in a system-wide environment variable (requires admin / sudo). */
export function envLines(shell, name, value) {
  const envFileLine = `${name}="${String(value).replace(/([\\"])/g, '\\$1')}"`;
  const exportLine = `export ${name}=${sq(value)}`;
  switch (shell) {
    case 'powershell':
      return `# run PowerShell as Administrator; sets this session + Windows System environment variable\n$env:${name} = ${psq(value)}\n[Environment]::SetEnvironmentVariable(${psq(name)}, ${psq(value)}, 'Machine')`;
    case 'fish':
      return `# run with admin / sudo; sets fish universal variable + system /etc/environment\nset -Ux ${name} ${sq(value)}\nset _uiux_etc (test -n "$KYRPY_UIUX_ETC_DIR"; and echo "$KYRPY_UIUX_ETC_DIR"; or echo /etc)\nset _uiux_tmp (mktemp); and begin; grep -v '^${name}=' "$_uiux_etc/environment" 2>/dev/null; or true; printf '%s\\n' ${sq(envFileLine)}; end > "$_uiux_tmp"; and begin; if test (id -u) -eq 0 -o -w "$_uiux_etc"; install -m 0644 "$_uiux_tmp" "$_uiux_etc/environment"; else; sudo install -m 0644 "$_uiux_tmp" "$_uiux_etc/environment"; end; end; set _uiux_rc $status; rm -f "$_uiux_tmp"; test $_uiux_rc -eq 0`;
    case 'cmd':
      return `rem run Command Prompt as Administrator; sets this session + Windows System environment variable\nset "${name}=${value}"\nsetx ${name} "${value}" /M`;
    default:
      return `# run terminal/script as admin (sudo); sets this session + system environment variable (/etc/environment & /etc/profile.d)\n${exportLine}\n_uiux_etc="\${KYRPY_UIUX_ETC_DIR:-/etc}"\n_uiux_tmp="$(mktemp)" && { grep -v '^${name}=' "$_uiux_etc/environment" 2>/dev/null || true; printf '%s\\n' ${sq(envFileLine)}; } > "$_uiux_tmp" && { if [ "$(id -u)" -eq 0 ] || [ -w "$_uiux_etc" ]; then install -m 0644 "$_uiux_tmp" "$_uiux_etc/environment"; else sudo install -m 0644 "$_uiux_tmp" "$_uiux_etc/environment"; fi; _uiux_rc=$?; rm -f "$_uiux_tmp"; (exit $_uiux_rc); }\nif [ -d "$_uiux_etc/profile.d" ]; then _uiux_ptmp="$(mktemp)" && { grep -v '^export ${name}=' "$_uiux_etc/profile.d/kyrpy-uiux.sh" 2>/dev/null || true; printf '%s\\n' ${sq(exportLine)}; } > "$_uiux_ptmp" && { if [ "$(id -u)" -eq 0 ] || [ -w "$_uiux_etc/profile.d" ]; then install -m 0644 "$_uiux_ptmp" "$_uiux_etc/profile.d/kyrpy-uiux.sh"; else sudo install -m 0644 "$_uiux_ptmp" "$_uiux_etc/profile.d/kyrpy-uiux.sh"; fi; _uiux_rc=$?; rm -f "$_uiux_ptmp"; (exit $_uiux_rc); }; fi\nif [ "$(uname -s 2>/dev/null)" = "Darwin" ]; then launchctl setenv ${name} ${sq(value)} 2>/dev/null || true; fi`;
  }
}

const shellLang = shell => (shell === 'powershell' ? 'powershell' : shell === 'cmd' ? 'bat' : 'bash');
/** Shell-neutral recipes exist for Claude Code only (plain `claude mcp` commands with the key inline); other clients fall back to bash / zsh syntax. */
const ANY_SHELL_CLIENTS = new Set(['claude-code']);

export function buildClientSetup({
  client = 'claude-code', url, key = '', keyMode = 'env', shell = 'posix',
  serverName = DEFAULT_SERVER_NAME, envVar = DEFAULT_ENV_VAR, projectKey = '', keyKind = 'project', fallbackShell = 'posix'
} = {}) {
  const perRepo = keyKind !== 'account';
  if (!url) throw new Error('url is required');
  const wantedAny = shell === 'any';
  // no neutral recipe: fall back to the caller's platform shell (PowerShell on Windows, else bash / zsh)
  if (wantedAny && !ANY_SHELL_CLIENTS.has(client)) shell = ['powershell', 'cmd', 'fish'].includes(fallbackShell) ? fallbackShell : 'posix';
  const anyShell = shell === 'any';
  const hasKey = /^kud_(live|test)_[0-9A-Za-z]{32}$/.test(String(key));
  const mode = hasKey && (keyMode === 'inline' || anyShell) ? 'inline' : 'env';   // no portable env-var syntax: the neutral recipe writes the key into the command
  const value = hasKey ? key : KEY_PLACEHOLDER;
  const name = String(serverName || DEFAULT_SERVER_NAME).trim().replace(/[^A-Za-z0-9_.-]/g, '-') || DEFAULT_SERVER_NAME;
  const ev = String(envVar || DEFAULT_ENV_VAR).trim().replace(/[^A-Za-z0-9_]/g, '_') || DEFAULT_ENV_VAR;
  const info = CLIENTS.find(c => c.id === client) || CLIENTS[0];
  const lang = shellLang(shell);
  const isWin = shell === 'powershell' || shell === 'cmd';   // 'any' keeps the file-path hints in posix style

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
      steps.push({ title: `1. Run terminal as admin and copy the key into system variable ${ev}${perRepo ? ' (one value at a time: switch it when you change projects, or use an account key)' : ''}`, lang, text: envLines(shell, ev, value) });
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
      const ok = shell === 'posix' || shell === 'fish' ? ' || true' : shell === 'powershell' ? '; $global:LASTEXITCODE = 0' : '';
      // neutral recipe: no redirect / `|| true` (they differ per shell); "No MCP server found" for a missing entry is harmless
      const staleRemoval = scopes => scopes.map(sc => (anyShell ? `claude mcp remove ${name} -s ${sc}\n` : `claude mcp remove ${name} -s ${sc} 2>${nul}${ok}\n`)).join('');
      steps.push({ title: perRepo
        ? `1. In the repository root, add the server for this repository only (local scope: stored in ~/.claude.json under this folder, never in the repo)`
        : `1. Add the server once for every repository (user scope; each repo's .uiux/config.json names its project)`, lang,
        text: `${perRepo ? '# run this inside your repository root\n' : ''}${staleRemoval(perRepo ? ['local'] : ['local', 'user'])}claude mcp add --transport http --scope ${scope} ${name} ${url} --header ${argExpand(mode === 'inline' || !hasKey ? literal : `Authorization: ${cmdBearer}`)}` });
      if (anyShell) notes.push('Shell-neutral recipe: the same lines run in bash, zsh, PowerShell and cmd. "No MCP server found" from the remove lines just means there was no older entry.');
      if (mode === 'env' && hasKey) steps.unshift({ title: `0. Run terminal as admin and copy the key into system variable ${ev}`, lang, text: envLines(shell, ev, value) });
      steps.push({ title: `${n()} Or share it with the team in .mcp.json (the key stays in each person’s ${ev})`, lang: 'json', path: '.mcp.json',
        text: json({ mcpServers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer \${${ev}}` } } } }) });
      steps.push({ title: `${n()} Check the connection${perRepo ? ' (inside the repository)' : ''}`, lang, text: `claude mcp get ${name}` });
      if (perRepo) notes.push('Run the add command once in each repository with that project\'s key: the same server name can hold a different key per folder.');
      notes.push(`claude mcp get ${name} shows the entry that wins (local > project > user scope). "invalid, expired or revoked API key" there means an old key: create a new one and run the add step again.`);
      break;
    }
    case 'codex': {
      // Codex reads bearer tokens only from an environment variable, in both key modes
      steps.push({ title: `1. Run terminal as admin and copy the key into system variable ${ev}`, lang, text: envLines(shell, ev, value) });
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
      const bearer = mode === 'inline' ? value : shellVar(shell, ev);
      const body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"uiux_whoami","arguments":{}}}';
      if (shell === 'powershell') {
        // Invoke-WebRequest, not curl.exe: Windows PowerShell 5.1 strips the double quotes of a JSON argument to a native program
        steps.push({ title: '2. Quick test (PowerShell)', lang,
          text: `(Invoke-WebRequest -UseBasicParsing -Method Post -Uri ${psq(url)} \`\n  -Headers @{ Authorization = "Bearer ${bearer}"; Accept = 'application/json, text/event-stream' } \`\n  -ContentType 'application/json' -Body ${psq(body)}).Content` });
      } else if (shell === 'cmd') {
        // curl.exe ships with Windows 10 (1803) and later
        steps.push({ title: '2. Quick test with curl (cmd)', lang,
          text: `curl -s ${url} -H "Authorization: Bearer ${bearer}" -H "content-type: application/json" -H "accept: application/json, text/event-stream" -d "${body.replace(/"/g, '\\"')}"` });
      } else {
        steps.push({ title: '2. Quick test with curl (bash / zsh / fish)', lang: 'bash',
          text: `curl -s ${url} -H "Authorization: Bearer ${bearer}" \\\n  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \\\n  -d '${body}'` });
      }
      break;
    }
  }
  const adminHint = adminHintFor(shell);
  notes.unshift(`${adminHint} so the API key is copied into the system environment variable (${ev}). Downloaded setup scripts permanently remove themselves after all steps finish properly.`);
  if (steps.some(st => st.path === '.envrc') && info.group === 'IDE') {
    notes.push(`${info.label} sees .envrc only when started from the repository terminal (for example "cursor ." / "code .") or with a direnv extension.`);
  }
  if (!url.startsWith('https://') && !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url)) {
    notes.push('This server is reached over plain HTTP. Use HTTPS for anything but a local machine: the key travels in a header.');
  }
  // steps are numbered while they are built and step 0 may be inserted first: number them 1..n once here
  steps.forEach((st, i) => { st.title = st.title.replace(/^\d+\.\s*/, `${i + 1}. `); });
  return {
    client: info.id, label: info.label, keyMode: mode, keyKind: perRepo ? 'project' : 'account', shell,
    envVar: ev, keyValue: value, hasKey, adminHint,
    prereq: prereqFor(info.id, shell), steps, notes,
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
export function setupAsText(setup, { file = false } = {}) {
  const shell = setup.shell || 'posix';
  const ev = setup.envVar || DEFAULT_ENV_VAR;
  const val = setup.keyValue || KEY_PLACEHOLDER;
  const cm = shell === 'cmd' ? 'rem ' : '# ';
  const comment = t => String(t).split('\n').map(l => `${cm}${l}`.trimEnd()).join('\n');
  const runLang = shellLang(shell);
  const stepGuard = !file ? ''
    : shell === 'cmd' ? '\nif errorlevel 1 exit /b 1'
    : shell === 'powershell' ? '\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }'
    : shell === 'fish' ? '\nset _uiux_step_rc $status; if test $_uiux_step_rc -ne 0; exit $_uiux_step_rc; end'
    : '';
  const stepInit = file && shell === 'powershell' ? '$global:LASTEXITCODE = 0\n' : '';
  const blocks = [];
  if (file) {
    const hasSystemEnvStep = setup.steps.some(st => !st.manual && !st.path && st.lang === runLang
      && (st.text.includes('/etc/environment') || st.text.includes("'Machine'") || /setx\s+\S+\s+.*\s+\/M\b/i.test(st.text)));
    if (!hasSystemEnvStep) {
      blocks.push(`${comment(`0. Run terminal as admin and copy the API key into system variable ${ev}`)}\n${stepInit}${envLines(shell, ev, val)}${stepGuard}`);
    }
  }
  for (const st of setup.steps) {
    const head = comment(`${st.title}${st.path ? `\nfile: ${st.path}` : ''}`);
    if (st.path && KEY_FILES.has(st.path)) {
      blocks.push(`${head}\n${stepInit}${writeKeyLine(shell, st.path, st.text.split('\n').filter(l => l && !l.startsWith('#')).pop())}${stepGuard}`);
    } else if (st.manual || st.path || st.lang !== runLang) {
      blocks.push(`${head}\n${comment(`(manual step — not run by this script${st.path ? `; save or merge into ${st.path}` : ''}):`)}\n${comment(st.text)}`);
    } else {
      blocks.push(`${head}\n${stepInit}${st.text}${stepGuard}`);
    }
  }
  const notes = setup.notes.length ? `\n\n${comment(`Notes:\n${setup.notes.map(x => `- ${x}`).join('\n')}`)}` : '';
  const tail = `\n\n${comment(`Then tell your agent: "${setup.prompt}"`)}\n`;
  return `${wrapPrereq(shell, setup.prereq, blocks.join('\n\n'), file, ev)}${notes}${tail}`;
}

/** Script file per shell: extension, line ending, how to run it as Administrator from the repository root. */
const SCRIPT_FILES = {
  posix: { ext: 'sh', eol: '\n', head: '#!/usr/bin/env bash', run: f => `sudo bash ./${f}`, adminRun: 'Run your terminal or this script as Administrator / root (sudo)' },
  fish: { ext: 'fish', eol: '\n', head: '#!/usr/bin/env fish', run: f => `sudo fish ./${f}`, adminRun: 'Run your terminal or this script as Administrator / root (sudo)' },
  powershell: { ext: 'ps1', eol: '\r\n', head: '', run: f => `powershell -ExecutionPolicy Bypass -File .\\${f}`, adminRun: 'Open PowerShell as Administrator ("Run as Administrator")' },
  cmd: { ext: 'cmd', eol: '\r\n', head: '@echo off', run: f => f, adminRun: 'Open Command Prompt as Administrator ("Run as administrator")' }
};

/**
 * The same steps as a self-deleting script FILE for the chosen shell: connect-<client>.sh (bash / zsh), .fish,
 * .ps1 (PowerShell) or .cmd (Windows cmd, CRLF line ends).
 *  1. Informs the user and verifies Administrator / root privileges.
 *  2. Copies the API key into the system environment variable (`envVar`).
 *  3. Runs all setup steps and verifies every command succeeded.
 *  4. Permanently removes itself from disk once all steps finish properly (never commit it).
 * Returns { filename, text, run, adminHint, envVar } or null for the shell-neutral recipe.
 */
export function setupAsFile(setup) {
  const shell = setup.shell || 'posix';
  const f = SCRIPT_FILES[shell];
  if (!f) return null;
  const ev = setup.envVar || DEFAULT_ENV_VAR;
  const filename = `connect-${setup.client}.${f.ext}`;
  const runCmd = f.run(filename);
  const cm = shell === 'cmd' ? 'rem ' : '# ';
  const intro = [
    `${setup.label}: connect to the Kyrpy UI/UX MCP server.`,
    `IMPORTANT — ${f.adminRun}, then run in the repository root:  ${runCmd}`,
    `1. Verifies Administrator / root privileges.`,
    `2. Copies your API key into the system environment variable (${ev}).`,
    `3. Runs all setup commands and permanently deletes ${filename} after everything finishes properly.`
  ].map(l => `${cm}${l}`).join('\n');

  const core = setupAsText(setup, { file: true }).trimEnd();
  let body;
  if (shell === 'powershell') {
    body = [
      `$ErrorActionPreference = 'Stop'`,
      `$global:LASTEXITCODE = 0`,
      `if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -and $env:KYRPY_UIUX_ASSUME_ADMIN -ne '1') {`,
      `  Write-Host 'ERROR: Administrator privileges are required so the API key can be stored in a Windows System environment variable (${ev}).' -ForegroundColor Red`,
      `  Write-Host 'Right-click PowerShell -> "Run as Administrator", then run:  ${runCmd.replace(/'/g, "''")}' -ForegroundColor Yellow`,
      `  exit 1`,
      `}`,
      `if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath) -and ((Get-Content -LiteralPath $PSCommandPath -Raw) -like ('*kud_live_' + '<paste-your-key-here>*'))) {`,
      `  Write-Host 'ERROR: Replace the kud_live_ placeholder in this script with your real API key before running.' -ForegroundColor Red`,
      `  exit 1`,
      `}`,
      ``,
      core,
      ``,
      `if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) {`,
      `  Write-Host "Setup did not finish properly (exit $LASTEXITCODE). Keeping $PSCommandPath so you can resolve the issue and re-run." -ForegroundColor Red`,
      `  exit $LASTEXITCODE`,
      `}`,
      `if ($PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath) -and ([IO.Path]::GetFileName($PSCommandPath) -eq '${filename}')) {`,
      `  [IO.File]::WriteAllBytes($PSCommandPath, [byte[]]@())`,
      `  Remove-Item -LiteralPath $PSCommandPath -Force`,
      `  Write-Host 'Setup finished properly. API key saved in system variable ${ev}; ${filename} permanently removed.'`,
      `}`
    ].join('\n');
  } else if (shell === 'cmd') {
    body = [
      `if not "%KYRPY_UIUX_ASSUME_ADMIN%"=="1" net session >nul 2>nul || (echo ERROR: Administrator privileges are required so the API key can be stored in a Windows System environment variable ^(${ev}^). Right-click Command Prompt -^> "Run as administrator" and run ${filename} again. & exit /b 1)`,
      `findstr /r /c:"kud_live_<paste-your-key[-]here>" "%~f0" >nul 2>nul && (echo ERROR: Replace the placeholder API key in %~nx0 with your real key before running. & exit /b 1)`,
      ``,
      core,
      ``,
      `if errorlevel 1 (echo Setup did not finish properly. Keeping %~nx0 so you can resolve the issue and re-run. & exit /b 1)`,
      `echo Setup finished properly. API key saved in system variable ${ev}; permanently removing %~nx0.`,
      `if /i "%~nx0"=="${filename}" start /b "" cmd /c del /f /q "%~f0" & exit /b 0`
    ].join('\n');
  } else if (shell === 'fish') {
    body = [
      `set _uiux_script (status filename)`,
      `if test (id -u) -ne 0; and test "$KYRPY_UIUX_ASSUME_ADMIN" != "1"`,
      `  echo 'ERROR: Administrator (root / sudo) privileges are required so the API key can be stored in a system environment variable (${ev}).' >&2`,
      `  echo 'Run your terminal or this script as admin:  ${runCmd.replace(/'/g, `'\\''`)}' >&2`,
      `  exit 1`,
      `end`,
      `if test -n "$_uiux_script"; and test -f "$_uiux_script"; and grep -q 'kud_live_''<paste-your-key-here>' "$_uiux_script" 2>/dev/null`,
      `  echo 'ERROR: Replace the kud_live_ placeholder in this script with your real API key before running.' >&2`,
      `  exit 1`,
      `end`,
      ``,
      core,
      ``,
      `set _uiux_status $status`,
      `if test $_uiux_status -ne 0`,
      `  echo "Setup did not finish properly (exit $_uiux_status). Keeping $_uiux_script so you can resolve the issue and re-run." >&2`,
      `  exit $_uiux_status`,
      `end`,
      `if test -n "$_uiux_script"; and test -f "$_uiux_script"; and test (basename "$_uiux_script") = '${filename}'`,
      `  if command -q shred`,
      `    shred -u -z "$_uiux_script" 2>/dev/null; or rm -f "$_uiux_script"`,
      `  else`,
      `    rm -f "$_uiux_script"`,
      `  end`,
      `  echo 'Setup finished properly. API key saved in system variable ${ev}; ${filename} permanently removed.'`,
      `end`
    ].join('\n');
  } else {
    body = [
      `_uiux_script="\${BASH_SOURCE[0]:-}"`,
      `if [ -z "$_uiux_script" ] && [ -n "\${ZSH_VERSION:-}" ]; then eval '_uiux_script="\${(%):-%x}"'; fi`,
      `if [ -z "$_uiux_script" ]; then _uiux_script="$0"; fi`,
      `_uiux_script_abs="$(cd "$(dirname "$_uiux_script")" 2>/dev/null && pwd)/$(basename "$_uiux_script")"`,
      `(`,
      `set -e`,
      `if [ "$(id -u)" -ne 0 ] && [ "\${KYRPY_UIUX_ASSUME_ADMIN:-0}" != "1" ]; then`,
      `  echo 'ERROR: Administrator (root / sudo) privileges are required so the API key can be stored in a system environment variable (${ev}).' >&2`,
      `  echo 'Run your terminal or this script as admin:  ${runCmd.replace(/'/g, `'\\''`)}' >&2`,
      `  exit 1`,
      `fi`,
      `if [ -f "$_uiux_script_abs" ] && grep -q 'kud_live_''<paste-your-key-here>' "$_uiux_script_abs" 2>/dev/null; then`,
      `  echo 'ERROR: Replace the kud_live_ placeholder in this script with your real API key before running.' >&2`,
      `  exit 1`,
      `fi`,
      ``,
      core,
      `)`,
      `_uiux_status=$?`,
      `if [ "$_uiux_status" -ne 0 ]; then`,
      `  echo "Setup did not finish properly (exit $_uiux_status). Keeping $_uiux_script_abs so you can resolve the issue and re-run." >&2`,
      `  return "$_uiux_status" 2>/dev/null || exit "$_uiux_status"`,
      `fi`,
      `if [ -f "$_uiux_script_abs" ] && [ "$(basename "$_uiux_script_abs")" = "${filename}" ]; then`,
      `  if command -v shred >/dev/null 2>&1; then`,
      `    shred -u -z "$_uiux_script_abs" 2>/dev/null || rm -f "$_uiux_script_abs"`,
      `  else`,
      `    rm -P "$_uiux_script_abs" 2>/dev/null || rm -f "$_uiux_script_abs"`,
      `  fi`,
      `  echo 'Setup finished properly. API key saved in system variable ${ev}; ${filename} permanently removed.'`,
      `fi`
    ].join('\n');
  }
  const text = `${f.head ? `${f.head}\n` : ''}${intro}\n\n${body}\n`;
  // Windows PowerShell 5.1 reads a script without a byte-order mark as ANSI: the mark keeps the comments readable
  return { filename, run: runCmd, adminHint: f.adminRun, envVar: ev, text: (shell === 'powershell' ? '\uFEFF' : '') + text.replace(/\r?\n/g, f.eol) };
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
  if (shell === 'cmd') {
    // findstr keeps every other line; ^ escapes what cmd would read as an operator (the placeholder has < and >)
    const win = path.replace(/\//g, '\\'), wdir = dir.replace(/\//g, '\\');
    const esc = line.replace(/([&|<>^()%!"])/g, '^$1');
    return `${dir ? `if not exist ${wdir} mkdir ${wdir}\n` : ''}(findstr /v /b /c:"${name}=" /c:"export ${name}=" ${win} 2>nul & echo ${esc})> ${win}.tmp\nmove /y ${win}.tmp ${win} >nul`;
  }
  if (shell === 'fish') {
    return `${dir ? `mkdir -p ${dir}\n` : ''}begin; grep -v '^\\(export \\)\\{0,1\\}${name}=' ${path} 2>/dev/null; printf '%s\\n' ${lit}; end > ${path}.tmp; and mv ${path}.tmp ${path}${dir ? `; if test -n "$SUDO_USER" -a "$SUDO_USER" != "root"; chown -R "$SUDO_USER" ${dir} 2>/dev/null; or true; end` : `; if test -n "$SUDO_USER" -a "$SUDO_USER" != "root"; chown "$SUDO_USER" ${path} 2>/dev/null; or true; end`}`;
  }
  const chownTarget = dir || path;
  return `${dir ? `mkdir -p ${dir}\n` : ''}{ grep -v '^\\(export \\)\\{0,1\\}${name}=' ${path} 2>/dev/null || true; printf '%s\\n' ${lit}; } > ${path}.tmp && mv ${path}.tmp ${path} && { if [ -n "\${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then chown -R "$SUDO_USER" ${chownTarget} 2>/dev/null || true; fi; }`;
}

/** Runs `body` only when the client CLI exists; otherwise prints how to install it (and exits non-zero in script files). */
function wrapPrereq(shell, prereq, body, file = false, ev = DEFAULT_ENV_VAR) {
  if (!prereq) return body;
  // an if-block must hold at least one command (e.g. Claude Desktop: every step is manual)
  const runnable = body.split('\n').some(l => l.trim() && !/^(#|rem )/.test(l.trim()));
  if (!runnable) body += `\n${shell === 'cmd' ? 'rem' : '#'} nothing to run in the terminal: follow the manual steps above\n${shell === 'powershell' ? '$null = $true' : shell === 'cmd' ? '' : 'true'}`;
  const msg = [`${prereq.name} ("${prereq.cmd}") is not installed. Install it, open a new terminal and ${file ? 'run this script' : 'paste these steps'} again:`,
    ...prereq.install.map(l => `  ${l}`), ...(prereq.note ? [`  ${prereq.note}`] : []), `  docs: ${prereq.docs}`];
  const title = `Requires ${prereq.name} ("${prereq.cmd}")`;
  if (shell === 'any') return `# ${title}. Not installed? ${[...new Set(prereq.install)].join('  or  ')}  (docs: ${prereq.docs})\n\n${body}`;
  if (shell === 'powershell') {
    const say = msg.map(l => `  Write-Host '${l.replace(/'/g, "''")}'`).join('\n');
    return `# ${title}\nif (-not (Get-Command ${prereq.cmd} -ErrorAction SilentlyContinue)) {\n${say}${file ? '\n  exit 1' : ''}\n} else {\n\n${body}\n\n}`;
  }
  if (shell === 'cmd') {
    // cmd cannot wrap a multi-line block: stop at the first line instead (the rest then fails loudly)
    // (a .cmd file can stop for real: exit /b leaves the script, not the terminal)
    return `rem ${title}\nwhere ${prereq.cmd} >nul 2>nul || (${msg.map(l => `echo ${l.replace(/([&|<>^()])/g, '^$1')}`).join(' & ')}${file ? ' & exit /b 1' : ''})\n\n${body}`;
  }
  const say = msg.map(l => `  echo '${l.replace(/'/g, `'\\''`)}'`).join('\n');
  if (shell === 'fish') {
    const fishPathInit = file
      ? `if test -n "$SUDO_USER" -a "$SUDO_USER" != "root"; set _uiux_uhome (eval echo "~$SUDO_USER"); set -gx PATH "$_uiux_uhome/.local/bin" "$_uiux_uhome/.npm-global/bin" /usr/local/bin $PATH; end\n`
      : '';
    return `# ${title}\n${fishPathInit}if not command -q ${prereq.cmd}\n${say}${file ? '\n  exit 1' : ''}\nelse\n\n${body}\n\nend`;
  }
  const sudoPathInit = file
    ? `if [ -n "\${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then _uiux_uhome="$(eval echo "~$SUDO_USER")"; _uiux_upath="$(sudo -u "$SUDO_USER" -H sh -lc 'printf "%s" "$PATH"' 2>/dev/null || true)"; export PATH="\${_uiux_upath:+$_uiux_upath:}$_uiux_uhome/.local/bin:$_uiux_uhome/.npm-global/bin:/usr/local/bin:$PATH"; fi\n`
    : '';
  const sudoCliWrap = file
    ? `if [ -n "\${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then _uiux_cli_bin="$(command -v ${prereq.cmd})"; ${prereq.cmd}() { sudo -u "$SUDO_USER" -H env "PATH=$PATH" "${ev}=\${${ev}:-}" "$_uiux_cli_bin" "$@"; }; fi\n\n`
    : '';
  return `# ${title}\n${sudoPathInit}if ! command -v ${prereq.cmd} >/dev/null 2>&1; then\n${say}${file ? '\n  exit 1' : ''}\nelse\n\n${sudoCliWrap}${body}\n\nfi`;
}
