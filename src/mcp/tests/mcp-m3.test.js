/**
 * Milestone M3 sensors: AI pack templates, platform layouts, uiux_init install plans (create / skip /
 * update / conflict), web adapter output, prompts, template overrides — and an end-to-end run that plays
 * the agent: follow the plan in an empty repository, then re-run init.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { renderTemplate, platformFiles, sectionBlock } from '../domain/ai-pack-render.js';
import { svgToSymbol, spriteSvg } from '../domain/web-adapter.js';
import { PLATFORMS } from '../domain/ai-pack-templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const sha = s => createHash('sha256').update(s).digest('hex');

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const p = c.projects.create({ name: 'Ada App' }, { actor: ada.user });
  c.icon.create({ name: 'Star', key: 'star', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'path', attrs: { d: 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z', fill: '{{accent}}' } }] });
  c.icon.create({ name: 'Dot', key: 'dot', projectId: p.id, visibility: 'project' }, { actor: ada.user, nodes: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } }] });
  const key = c.mcp.apiKeys.create({ name: 'agent', projectId: p.id }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const rpc = async (method, params) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  const rest = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${ada.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { c, p, ada, base, rpc, call, rest, close: () => { server.close(); c.close(); } };
}

/** Plays the agent: applies an init plan to a repository folder exactly as steps[] describe. */
function applyPlan(repo, plan) {
  for (const f of plan.files) {
    if (f.action === 'skip') continue;
    const target = join(repo, f.action === 'conflict' ? f.writeTo : f.path);
    mkdirSync(dirname(target), { recursive: true });
    if (f.mode === 'section' && f.action !== 'conflict') {
      const old = existsSync(target) ? readFileSync(target, 'utf8') : '';
      const re = new RegExp(`<!-- ${f.marker}:start -->[\\s\\S]*?<!-- ${f.marker}:end -->`);
      writeFileSync(target, re.test(old) ? old.replace(re, f.content) : `${old}${old ? '\n\n' : ''}${f.content}\n`);
    } else writeFileSync(target, f.content);
  }
  const gi = join(repo, '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  writeFileSync(gi, cur + plan.gitignore.filter(l => !cur.split('\n').includes(l)).map(l => `${l}\n`).join(''));
  writeFileSync(join(repo, '.uiux', 'uiux.lock.json'), JSON.stringify(plan.lockfile, null, 2));
}

/**
 * Runs the bundle install shell steps (curl/sha256sum/tar) inside the repository. Async on purpose: the
 * test server lives in this process, so a blocking spawnSync(curl) would deadlock the event loop.
 */
async function runInstall(repo, install) {
  for (const cmd of install) await execAsync(cmd, { cwd: repo, shell: '/bin/bash', timeout: 30000 });
}

/** What the agent sends back on a re-run: recorded checksum (lockfile) + checksum of the file on disk now. */
function installedFrom(repo) {
  const lock = JSON.parse(readFileSync(join(repo, '.uiux', 'uiux.lock.json'), 'utf8'));
  const installed = Object.entries(lock.pack.files).map(([path, recordedChecksum]) => {
    const file = join(repo, path);
    if (!existsSync(file)) return { path, recordedChecksum };
    let text = readFileSync(file, 'utf8');
    if (path === 'AGENTS.md') text = /<!-- kyrpy-uiux:start -->[\s\S]*?<!-- kyrpy-uiux:end -->/.exec(text)?.[0] ?? '';
    return { path, recordedChecksum, currentChecksum: sha(text) };
  });
  return { installed, manifestHash: lock.manifestHash };
}

test('M3: template engine and platform layouts', () => {
  const out = renderTemplate('Hi {{name}}{{#if fw}} ({{fw}}){{/if}}: {{#each list}}[{{this}}]{{/each}} keep {{accent}}', { name: 'Ada', fw: '', list: ['a', 'b'] });
  assert.equal(out, 'Hi Ada: [a][b] keep {{accent}}', 'unknown placeholders stay literal');
  for (const p of PLATFORMS) {
    const files = platformFiles(p, { agent: 'A', skill: 'S' });
    assert.ok(files.length >= 1, p);
    assert.ok(files.every(f => !f.path.startsWith('/') && !f.path.includes('..')), p);
  }
  assert.deepEqual(platformFiles('claude', { agent: 'A', skill: 'S' }).map(f => f.path),
    ['.claude/agents/kyrpy-uiux-designer.md', '.claude/skills/kyrpy-skill-uiux-designer/SKILL.md']);
  assert.match(platformFiles('claude', { agent: 'A', skill: 'S' })[0].content, /^---\nname: "kyrpy-uiux-designer"\ndescription: /);
  assert.equal(platformFiles('agents-md', { agent: 'A', skill: 'S' })[0].mode, 'section');
  assert.equal(sectionBlock('m', ' x '), '<!-- m:start -->\nx\n<!-- m:end -->');
  assert.throws(() => platformFiles('vim', { agent: 'A', skill: 'S' }));
});

test('M3: web adapter symbols get unique ids, also inside <style>', () => {
  const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-label="Star"><defs><linearGradient id="g"/></defs><style>#n1{animation:spin 1s}</style><path id="n1" fill="url(#g)"/><use href="#n1"/></svg>';
  const sym = svgToSymbol(svg, 'star');
  assert.match(sym, /^<symbol id="icon-star" viewBox="0 0 24 24" aria-label="Star">/);
  assert.match(sym, /id="g-star"/); assert.match(sym, /url\(#g-star\)/);
  assert.match(sym, /id="n1-star"/); assert.match(sym, /href="#n1-star"/);
  assert.match(sym, /<style>#n1-star\{/);
  assert.ok(!sym.includes('<?xml') && !sym.includes('<svg'));
  // the theme <defs> shared by all icons is emitted once and keeps its global ids
  const doc = k => `<svg viewBox="0 0 24 24"><defs><linearGradient id="lgS"/></defs><path id="p" fill="url(#lgS)" d="M${k}"/></svg>`;
  const sprite = spriteSvg([{ key: 'a', svg: doc(1) }, { key: 'b', svg: doc(2) }]);
  assert.equal(sprite.match(/<linearGradient id="lgS"\/>/g).length, 1);
  assert.equal((sprite.match(/url\(#lgS\)/g) || []).length, 2, 'references to shared defs are not suffixed');
  assert.match(sprite, /id="p-a"/); assert.match(sprite, /id="p-b"/);
});

test('M3: init plan for Claude Code renders the project into the agent and skill', async () => {
  const w = await world();
  try {
    const r = await w.call('uiux_init', { framework: 'react', includeBundle: false });
    assert.ok(!r.isError, JSON.stringify(r));
    const plan = r.structuredContent;
    assert.deepEqual(plan.files.map(f => `${f.action}:${f.path}`), [
      'create:.claude/agents/kyrpy-uiux-designer.md', 'create:.claude/skills/kyrpy-skill-uiux-designer/SKILL.md', 'create:.uiux/config.json', 'create:init-prompt.md']);
    const [agent, skill, config] = plan.files;
    assert.match(agent.content, new RegExp(`project\\s+\\*\\*${w.p.key}\\*\\*`));
    assert.match(agent.content, /\(react\)/);
    assert.match(skill.content, new RegExp(`${w.base.replace(/[.]/g, '\\.')}/mcp`));
    assert.match(skill.content, /\{\{accent\}\}/, 'token example survives rendering');
    assert.ok(!/\{\{(projectKey|serverUrl|mcpUrl|uiuxRoot|#each|#if)/.test(agent.content + skill.content), 'no unrendered variables');
    assert.equal(agent.checksum, sha(agent.content));
    const cfg = JSON.parse(config.content);
    assert.equal(cfg.project, w.p.key); assert.equal(cfg.apiKeyEnv, 'KYRPY_UIUX_API_KEY');
    assert.ok(!(agent.content + skill.content + config.content).includes('kud_live_'), 'the key is never in the pack');
    assert.equal(plan.bundle, null);
    assert.equal(plan.lockfile.pack.files['.uiux/config.json'], config.checksum);
    assert.ok(plan.steps.length >= 5);
    const again = (await w.call('uiux_init', { framework: 'react', includeBundle: false })).structuredContent;
    assert.deepEqual(again.files.map(f => f.checksum), plan.files.map(f => f.checksum), 'rendering is deterministic');
    const md = (await w.call('uiux_get_ai_pack', { platform: 'agents-md' })).structuredContent.files[0];
    assert.match(md.content, /^<!-- kyrpy-uiux:start -->/);
    assert.equal((await w.call('uiux_init', { platform: 'emacs' })), undefined, 'invalid enum is a protocol error (no result)');
  } finally { w.close(); }
});

test('M3: end to end — empty repo → init → bundle → adapters → re-run is a no-op; edits become conflicts', async () => {
  const w = await world();
  const repo = mkdtempSync(join(tmpdir(), 'uiux-repo-'));
  try {
    const plan = (await w.call('uiux_init', { platform: 'agents-md', framework: 'vue' })).structuredContent;
    assert.ok(plan.bundle, 'first init includes a bundle');
    applyPlan(repo, plan);
    await runInstall(repo, plan.bundle.install);
    for (const st of plan.lockfile.styles) cpSync(join(repo, 'uiux', 'source', 'adapters', 'web', st), join(repo, 'uiux', st), { recursive: true });

    const st = plan.lockfile.styles[0];
    assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /kyrpy-skill-uiux-designer/);
    assert.match(readFileSync(join(repo, 'uiux', st, 'tokens.css'), 'utf8'), /--uiux-accent:/);
    const sprite = readFileSync(join(repo, 'uiux', st, 'icons.sprite.svg'), 'utf8');
    assert.match(sprite, /<symbol id="icon-star"/); assert.match(sprite, /<symbol id="icon-dot"/);
    assert.match(readFileSync(join(repo, 'uiux', st, 'index.ts'), 'utf8'), /"star": \{ id: "icon-star"/);
    assert.ok(existsSync(join(repo, 'uiux', 'source', 'manifest.json')));
    assert.ok(existsSync(join(repo, 'uiux', 'source', 'prototype', 'options-menu.js')), 'bundle ships the prototype Options menu');
    assert.match(readFileSync(join(repo, 'init-prompt.md'), 'utf8'), /init-prompt/);
    assert.match(readFileSync(join(repo, '.gitignore'), 'utf8'), /\.uiux\/cache\//);
    const grep = spawnSync('bash', ['-c', 'grep -rln "kud_live_" . || true'], { cwd: repo, encoding: 'utf8' });
    assert.equal(grep.stdout.trim(), '', 'no API key anywhere in the repo');

    // re-run with nothing changed: every file skipped, no bundle
    const again = (await w.call('uiux_init', { platform: 'agents-md', framework: 'vue', ...installedFrom(repo) })).structuredContent;
    assert.deepEqual(again.summary, { create: 0, update: 0, skip: 3, conflict: 0, bundle: 'not needed' });
    assert.ok(again.files.every(f => f.content === undefined), 'skipped files carry no content');

    // a design change → bundle again; a local edit of the config → conflict, original untouched
    w.c.icon.update(w.c.icon.list().find(i => i.key === 'dot').id, { label: 'Dot!' });
    const cfgPath = join(repo, '.uiux', 'config.json');
    writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').replace('"vue"', '"vue3"'));
    const third = (await w.call('uiux_init', { platform: 'agents-md', framework: 'vue', ...installedFrom(repo) })).structuredContent;
    assert.ok(third.bundle, 'changed design → new bundle');
    const conflict = third.files.find(f => f.path === '.uiux/config.json');
    assert.equal(conflict.action, 'conflict');
    assert.equal(conflict.writeTo, '.uiux/config.json.uiux-new');
    assert.equal(third.lockfile.pack.files['.uiux/config.json'], JSON.parse(readFileSync(join(repo, '.uiux', 'uiux.lock.json'), 'utf8')).pack.files['.uiux/config.json'], 'lock keeps the old checksum until merged');
    applyPlan(repo, third);
    assert.match(readFileSync(cfgPath, 'utf8'), /"vue3"/, 'local edit preserved');
    assert.ok(existsSync(`${cfgPath}.uiux-new`));
  } finally { rmSync(repo, { recursive: true, force: true }); w.close(); }
});

test('M3: project template override changes the pack version and content; clearing reverts', async () => {
  const w = await world();
  try {
    const before = (await w.call('uiux_get_ai_pack', {})).structuredContent;
    const list = await w.rest('GET', `/api/projects/${w.p.id}/ai-artifacts`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.map(a => `${a.kind}:${a.scope}:${a.source}`), ['agent:global:seed', 'skill:global:seed']);
    const put = await w.rest('PUT', `/api/projects/${w.p.id}/ai-artifacts/skill`, { template: '# Custom skill for {{projectName}}\nUse {{mcpUrl}}.' });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const after = (await w.call('uiux_get_ai_pack', {})).structuredContent;
    assert.notEqual(after.packVersion, before.packVersion);
    assert.match(after.files[1].content, /# Custom skill for Ada App\nUse http:\/\/127\.0\.0\.1:\d+\/mcp\./);
    assert.equal(after.files[0].checksum, before.files[0].checksum, 'agent unchanged');
    assert.equal((await w.rest('PUT', `/api/projects/${w.p.id}/ai-artifacts/skill`, { template: '  ' })).status, 422);
    assert.equal((await w.rest('PUT', `/api/projects/${w.p.id}/ai-artifacts/nope`, { template: 'x' })).status, 422);
    const preview = await w.rest('GET', `/api/projects/${w.p.id}/ai-pack?platform=cursor`);
    assert.equal(preview.data.files[0].path, '.cursor/rules/kyrpy-uiux-designer.mdc');
    const other = w.c.auth.register({ username: 'eve', email: 'eve@example.com', password: 'secret123' });
    const r = await fetch(`${w.base}/api/projects/${w.p.id}/ai-artifacts/skill`, { method: 'PUT', headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ template: 'evil' }) });
    assert.equal(r.status, 403, 'non-owners cannot change the pack');
    await w.rest('DELETE', `/api/projects/${w.p.id}/ai-artifacts/skill`);
    assert.equal((await w.call('uiux_get_ai_pack', {})).structuredContent.files[1].checksum, before.files[1].checksum, 'cleared override restores the built-in');
  } finally { w.close(); }
});

test('M3: prompts and server instructions', async () => {
  const w = await world();
  try {
    const init = (await w.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })).result;
    assert.match(init.instructions, /uiux_init/);
    assert.ok(init.capabilities.prompts);
    const prompts = (await w.rpc('prompts/list')).result.prompts;
    assert.deepEqual(prompts.map(p => p.name), ['init-uiux', 'pull-design', 'need-ui-item', 'create-project-from-app', 'reverse-engineer-app', 'push-app-version']);
    assert.ok(prompts.every(p => p.text === undefined));
    const got = (await w.rpc('prompts/get', { name: 'init-uiux', arguments: { platform: 'cursor', framework: 'react' } })).result;
    assert.match(got.messages[0].content.text, /uiux_init with platform "cursor", framework "react"/);
    assert.equal((await w.rpc('prompts/get', { name: 'init-uiux', arguments: { framework: '"; rm -rf /' } })).error.code, -32602);
    assert.equal((await w.rpc('prompts/get', { name: 'nope' })).error.code, -32602);
  } finally { w.close(); }
});
