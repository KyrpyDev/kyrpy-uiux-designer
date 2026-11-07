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
      steps.push({ title: `${steps.length + 1}. Allow it once`, lang, text: 'direnv allow' });
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
      steps.push({ title: perRepo
        ? `1. In the repository root, add the server for this repository only (local scope: stored in ~/.claude.json under this folder, never in the repo)`
        : `1. Add the server once for every repository (user scope; each repo's .uiux/config.json names its project)`, lang,
        text: `${perRepo ? 'cd <your-repository>\n' : ''}claude mcp add --transport http --scope ${scope} ${name} ${url} --header ${argExpand(mode === 'inline' || !hasKey ? literal : `Authorization: ${cmdBearer}`)}` });
      if (mode === 'env' && hasKey) steps.unshift({ title: `0. Make the key available to the command (only while adding it)`, lang, text: envLines(shell, ev, value).split('\n').slice(0, 2).join('\n') });
      steps.push({ title: `${n()} Or share it with the team in .mcp.json (the key stays in each person’s ${ev})`, lang: 'json', path: '.mcp.json',
        text: json({ mcpServers: { [name]: { type: 'http', url, headers: { Authorization: `Bearer \${${ev}}` } } } }) });
      steps.push({ title: `${n()} Check the connection${perRepo ? ' (inside the repository)' : ''}`, lang, text: `claude mcp get ${name}` });
      if (perRepo) notes.push('Run the add command once in each repository with that project\'s key: the same server name can hold a different key per folder.');
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
      steps.push({ title: `${n()} Command your client should start (stdio)`, lang,
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
  return {
    client: info.id, label: info.label, keyMode: mode, keyKind: perRepo ? 'project' : 'account', steps, notes,
    gitignore: [...new Set(steps.filter(st => st.secret && st.path).map(st => st.path))],
    prompt: perRepo
      ? 'Run uiux_init for this project, then follow its steps.'
      : 'Run uiux_init. It lists my projects with their versions: ask me whether to clone one into a new project or edit one of mine (and which version), then follow its steps.'
  };
}

/** All steps as one copyable text block (comments mark the steps). */
export function setupAsText(setup) {
  const c = setup.steps.map(s => `# ${s.title}${s.path ? `\n# file: ${s.path}` : ''}\n${s.text}`).join('\n\n');
  return `${c}${setup.notes.length ? `\n\n# Notes:\n${setup.notes.map(x => `# - ${x}`).join('\n')}` : ''}\n\n# Then tell your agent: "${setup.prompt}"\n`;
}
