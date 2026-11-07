import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENTS, SHELLS, KEY_PLACEHOLDER, buildClientSetup, setupAsText, envLines, shellVar } from '../interfaces/web/client-setup.js';

const URL = 'http://127.0.0.1:5180/mcp';
const KEY = `kud_live_${'Ab3'.repeat(10)}xy`;
// files that usually get committed to the repository
const REPO_FILES = ['.mcp.json', '.vscode/mcp.json', '.cursor/mcp.json', 'opencode.json', '.gemini/settings.json'];

test('every client × shell × key mode gives steps; JSON blocks parse; nothing throws', () => {
  for (const c of CLIENTS) for (const [shell] of SHELLS) for (const keyMode of ['env', 'inline']) for (const key of ['', KEY]) {
    const s = buildClientSetup({ client: c.id, url: URL, key, keyMode, shell, projectKey: 'demo' });
    assert.equal(s.client, c.id);
    assert.ok(s.steps.length >= 1, `${c.id} has steps`);
    for (const st of s.steps) {
      assert.ok(st.title && st.text, `${c.id}: step has title and text`);
      if (st.lang === 'json') assert.doesNotThrow(() => JSON.parse(st.text), `${c.id}/${shell}: valid JSON`);
    }
    assert.ok(setupAsText(s).includes('uiux_init'));
  }
});

test('without a plaintext key: env mode is forced and the placeholder is used, never a fake key', () => {
  for (const c of CLIENTS) {
    const s = buildClientSetup({ client: c.id, url: URL, keyMode: 'inline' });
    assert.equal(s.keyMode, 'env');
    assert.ok(!/kud_live_[0-9A-Za-z]{32}/.test(setupAsText(s)));
  }
  assert.ok(setupAsText(buildClientSetup({ client: 'claude-code', url: URL })).includes(KEY_PLACEHOLDER));
});

test('env mode: the key never lands in a repository file; it is only in the env-variable step', () => {
  for (const c of CLIENTS) {
    const s = buildClientSetup({ client: c.id, url: URL, key: KEY, keyMode: 'env' });
    for (const st of s.steps) {
      if (REPO_FILES.includes(st.path)) assert.ok(!st.text.includes(KEY), `${c.id}: ${st.path} has no key`);
    }
  }
  // committed files reference the variable instead
  const cc = buildClientSetup({ client: 'claude-code', url: URL, key: KEY, keyMode: 'inline' });
  assert.ok(cc.steps.find(s => s.path === '.mcp.json').text.includes('${KYRPY_UIUX_API_KEY}'));
  const vs = buildClientSetup({ client: 'vscode', url: URL, key: KEY, keyMode: 'inline' });
  assert.ok(!vs.steps.find(s => s.path === '.vscode/mcp.json').text.includes(KEY), 'VS Code workspace file prompts for the key');
});

test('client specifics: header formats, CLI commands, TOML', () => {
  // project key: one repository (local scope); account key: user scope
  const cc = buildClientSetup({ client: 'claude-code', url: URL, shell: 'posix' });
  assert.match(cc.steps[0].text, /claude mcp add --transport http --scope local kyrpy-uiux http:\/\/127\.0\.0\.1:5180\/mcp --header "Authorization: Bearer kud_live_<paste-your-key-here>"$/);
  const ccAcc = buildClientSetup({ client: 'claude-code', url: URL, keyKind: 'account' });
  assert.match(ccAcc.steps[0].text, /--scope user kyrpy-uiux/);
  assert.equal(ccAcc.keyKind, 'account');
  const ccEnv = buildClientSetup({ client: 'claude-code', url: URL, key: KEY, keyMode: 'env', shell: 'powershell' });
  assert.ok(ccEnv.steps.some(st => st.text.includes('"Authorization: Bearer $env:KYRPY_UIUX_API_KEY"')));
  const ccInline = buildClientSetup({ client: 'claude-code', url: URL, key: KEY, keyMode: 'inline' });
  assert.ok(ccInline.steps[0].text.includes(`"Authorization: Bearer ${KEY}"`), 'inline: key in the local-scope command');

  const codex = buildClientSetup({ client: 'codex', url: URL, key: KEY, keyMode: 'inline' });
  assert.equal(codex.steps[0].title.startsWith('1.'), true);
  assert.ok(codex.steps[0].text.includes(KEY), 'codex always needs the env variable');
  assert.ok(codex.steps.some(s => s.text === `codex mcp add kyrpy-uiux --url ${URL} --bearer-token-env-var KYRPY_UIUX_API_KEY`));
  assert.ok(codex.steps.some(s => s.lang === 'toml' && s.text.includes('[mcp_servers.kyrpy-uiux]') && s.text.includes('bearer_token_env_var = "KYRPY_UIUX_API_KEY"')));
  assert.deepEqual(codex.steps.map(s => s.title.split('.')[0]), ['1', '2', '3', '4'], 'steps numbered in order');

  const gem = buildClientSetup({ client: 'gemini', url: URL });
  assert.equal(JSON.parse(gem.steps.find(s => s.lang === 'json').text).mcpServers['kyrpy-uiux'].httpUrl, URL);
  const agy = buildClientSetup({ client: 'antigravity', url: URL });
  assert.equal(JSON.parse(agy.steps.find(st => st.lang === 'json').text).mcpServers['kyrpy-uiux'].serverUrl, URL);
  const cur = buildClientSetup({ client: 'cursor', url: URL });
  assert.equal(JSON.parse(cur.steps.find(st => st.lang === 'json').text).mcpServers['kyrpy-uiux'].headers.Authorization, 'Bearer ${env:KYRPY_UIUX_API_KEY}');
  const oc = buildClientSetup({ client: 'opencode', url: URL });
  assert.equal(JSON.parse(oc.steps.find(st => st.lang === 'json').text).mcp['kyrpy-uiux'].type, 'remote');
  const br = buildClientSetup({ client: 'bridge', url: URL });
  assert.ok(br.steps.find(st => st.text.startsWith('npx')).text.startsWith(`npx -y mcp-remote ${URL} --header "Authorization: Bearer $KYRPY_UIUX_API_KEY"`));
});

test('per-repository key storage: direnv / .gemini/.env are git-ignored; account keys need none', () => {
  const cur = buildClientSetup({ client: 'cursor', url: URL, key: KEY, shell: 'posix' });
  assert.deepEqual(cur.gitignore, ['.envrc']);
  assert.ok(cur.steps.find(st => st.path === '.envrc').text.includes(KEY));
  assert.ok(cur.notes.some(n => /\.envrc/.test(n)), 'GUI IDE hint');
  const gem = buildClientSetup({ client: 'gemini', url: URL, key: KEY });
  assert.deepEqual(gem.gitignore, ['.gemini/.env']);
  assert.ok(!gem.steps.find(st => st.path === '.gemini/settings.json').text.includes(KEY));
  assert.deepEqual(buildClientSetup({ client: 'cursor', url: URL, keyKind: 'account' }).gitignore, []);
  assert.deepEqual(buildClientSetup({ client: 'cursor', url: URL, shell: 'powershell' }).gitignore, [], 'no direnv on Windows shells');
});

test('server name / env var are sanitised; per-project names flow into every recipe', () => {
  const s = buildClientSetup({ client: 'claude-code', url: URL, serverName: 'kyrpy uiux;rm -rf', envVar: 'MY-KEY $(x)' });
  const text = setupAsText(s);
  assert.ok(!/[;$()]\s*rm|\$\(x\)/.test(text.replace(/\$MY_KEY___X_/g, '')));
  assert.ok(text.includes('kyrpy-uiux-rm--rf'));
  assert.ok(text.includes('MY_KEY___x_'));
});

test('shell helpers', () => {
  assert.equal(shellVar('posix', 'K'), '$K');
  assert.equal(shellVar('powershell', 'K'), '$env:K');
  assert.equal(shellVar('cmd', 'K'), '%K%');
  assert.match(envLines('posix', 'K', "a'b"), /export K='a'\\''b'/);
  assert.match(envLines('powershell', 'K', "a'b"), /\$env:K = 'a''b'/);
  assert.match(envLines('fish', 'K', 'v'), /set -Ux K 'v'/);
  assert.match(envLines('cmd', 'K', 'v'), /setx K "v"/);
});

test('plain HTTP to a non-local host gets a warning', () => {
  assert.ok(buildClientSetup({ client: 'cursor', url: 'http://10.0.0.5:5180/mcp' }).notes.some(n => /HTTPS/.test(n)));
  assert.ok(!buildClientSetup({ client: 'cursor', url: 'https://design.example.com/mcp' }).notes.some(n => /HTTPS/.test(n)));
  assert.ok(!buildClientSetup({ client: 'cursor', url: URL }).notes.some(n => /HTTPS/.test(n)));
});

test('"Copy all steps" is a pasteable script: CLI check first, config files and in-app steps commented, bash parses it', async () => {
  const { spawnSync } = await import('node:child_process');
  const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
  for (const c of CLIENTS) for (const [shell] of SHELLS) for (const keyKind of ['project', 'account']) for (const key of ['', KEY]) {
    const s = buildClientSetup({ client: c.id, url: URL, key, shell, keyKind, projectKey: 'demo' });
    const text = setupAsText(s);
    const cm = shell === 'cmd' ? /^\s*(rem\b|$)/ : /^\s*(#|$)/;
    const live = text.split('\n').filter(l => !cm.test(l) && !/^\}( else \{)?$/.test(l));   // PowerShell's own if / else braces
    // a JSON / TOML block pasted into a shell runs "mcpServers:" as a command (the reported bug)
    assert.ok(!live.some(l => /^\s*("|\{$|\}[,\]]*$)|^\s*mcpServers|^\s*\[mcp_servers|^\/mcp$/.test(l)), `${c.id}/${shell}: config text left runnable:\n${live.join('\n')}`);
    assert.ok(!live.some(l => /<your-repository>/.test(l)), `${c.id}/${shell}: placeholder cd`);
    s.steps.forEach((st, i) => assert.ok(st.title.startsWith(`${i + 1}. `), `${c.id}: step ${i + 1} numbered "${st.title}"`));
    if (s.prereq) assert.ok(text.includes(s.prereq.cmd) && text.includes(s.prereq.docs), `${c.id}/${shell}: prerequisite check`);
    if (shell === 'posix' && hasBash) {
      const r = spawnSync('bash', ['-n'], { input: text });
      assert.equal(r.status, 0, `${c.id}/${keyKind}: bash -n\n${r.stderr}`);
    }
  }
  const cc = setupAsText(buildClientSetup({ client: 'claude-code', url: URL, key: KEY, keyKind: 'account' }));
  assert.match(cc, /^# Requires Claude Code CLI[\s\S]*if ! command -v claude /);
  // a stale entry with the same name in a narrower scope would shadow the new key
  assert.ok(cc.indexOf('claude mcp remove kyrpy-uiux -s local') < cc.indexOf('claude mcp add'));
  assert.ok(cc.includes('claude mcp remove kyrpy-uiux -s user'));
});
