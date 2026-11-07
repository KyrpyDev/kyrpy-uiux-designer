/**
 * M8 sensors: init-prompt.md, update check (uiux_check_update, toolsHash), style import (uiux_import_styles), prototype Options menu.
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


test('M8: init writes init-prompt.md once; the lockfile records toolsHash', async () => {
  const w = await world();
  try {
    const plan = (await w.call('uiux_init', { framework: 'react', includeBundle: false })).structuredContent;
    const ip = plan.files.find(f => f.path === 'init-prompt.md');
    assert.equal(ip.action, 'create');
    assert.match(ip.content, /Options button/i);
    assert.match(ip.content, /no database, no backend/i);
    assert.match(ip.content, /uiux_check_update/);
    assert.match(ip.content, /uiux_import_styles/);
    assert.match(plan.files[0].content, /uiux_check_update/);               // the agent checks for updates first
    assert.match(plan.files[1].content, /Build the standalone prototype/);
    assert.match(plan.lockfile.toolsHash, /^[0-9a-f]{16}$/);
    // already installed (even edited by the human): never overwritten
    const again = (await w.call('uiux_init', { framework: 'react', includeBundle: false, installed: [{ path: 'init-prompt.md', recordedChecksum: ip.checksum, currentChecksum: sha('edited') }] })).structuredContent;
    assert.equal(again.files.find(f => f.path === 'init-prompt.md').action, 'skip');
  } finally { w.close(); }
});

test('M8: uiux_check_update reports pack, design and tool-set changes', async () => {
  const w = await world();
  try {
    const first = (await w.call('uiux_check_update', {})).structuredContent;
    assert.equal(first.updateAvailable, true);                               // nothing installed yet
    const plan = (await w.call('uiux_init', { includeBundle: false })).structuredContent;
    const repo = mkdtempSync(join(tmpdir(), 'uiux-m8-'));
    try {
      applyPlan(repo, plan);
      const args = { ...installedFrom(repo), toolsHash: plan.lockfile.toolsHash };
      const ok = (await w.call('uiux_check_update', args)).structuredContent;
      assert.equal(ok.updateAvailable, false, JSON.stringify(ok));
      assert.deepEqual(ok.packChanged, []);
      const newer = (await w.call('uiux_check_update', { ...args, toolsHash: '0000000000000000' })).structuredContent;
      assert.equal(newer.updateAvailable, true); assert.equal(newer.toolsChanged, true);
      const oldRepo = (await w.call('uiux_check_update', { ...args, toolsHash: undefined })).structuredContent;
      assert.equal(oldRepo.updateAvailable, true, 'a lockfile without toolsHash predates this feature');
      const design = (await w.call('uiux_check_update', { ...args, manifestHash: 'stale' })).structuredContent;
      assert.equal(design.designChanged, true);
      writeFileSync(join(repo, '.claude/agents/kyrpy-uiux-designer.md'), 'my edit');
      const edited = (await w.call('uiux_check_update', installedFrom(repo))).structuredContent;
      assert.deepEqual(edited.conflicts, ['.claude/agents/kyrpy-uiux-designer.md']);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  } finally { w.close(); }
});

test('M8: uiux_import_styles lists the catalog and merges new styles locally', async () => {
  const w = await world();
  const repo = mkdtempSync(join(tmpdir(), 'uiux-m8s-'));
  try {
    const cat = (await w.call('uiux_import_styles', { installed: [] })).structuredContent;
    assert.ok(cat.designStyles.length >= 15 && cat.buttonStyles.length >= 3);
    const keys = cat.designStyles.map(s => s.key);
    const one = keys[0], two = keys[1];
    const partial = (await w.call('uiux_import_styles', { installed: [one] })).structuredContent;
    assert.ok(!partial.designStyles.find(s => s.key === one).isNew && partial.designStyles.find(s => s.key === one).installed);
    assert.ok(partial.newStyles.includes(two) && !partial.newStyles.includes(one));

    const bad = await w.call('uiux_import_styles', { styles: ['nope'] });
    assert.equal(bad.isError, true);

    // a repository that already has `one`; importing `two` must merge, not replace
    mkdirSync(join(repo, 'uiux', 'source'), { recursive: true });
    writeFileSync(join(repo, 'uiux', 'source', 'keep.txt'), 'existing');
    const r = (await w.call('uiux_import_styles', { styles: [two], installed: [one] })).structuredContent;
    assert.equal(r.merge, true);
    await runInstall(repo, r.install);
    assert.equal(readFileSync(join(repo, 'uiux', 'source', 'keep.txt'), 'utf8'), 'existing', 'nothing removed');
    assert.match(readFileSync(join(repo, 'uiux', two, 'tokens.css'), 'utf8'), /--uiux-accent:/);
    assert.match(readFileSync(join(repo, 'uiux', two, 'icons.sprite.svg'), 'utf8'), /<symbol id="icon-star"/);
    const styles = JSON.parse(readFileSync(join(repo, 'uiux', 'source', 'styles.json'), 'utf8'));
    assert.ok(styles.designStyles.length >= 15 && styles.spriteStyles.includes(one) && styles.spriteStyles.includes(two));
    // switch locally to the imported style
    await execAsync(`node uiux/source/switch-style.mjs ${two}`, { cwd: repo });
    assert.equal(JSON.parse(readFileSync(join(repo, 'uiux', 'active', 'active.json'), 'utf8')).designStyle, two);
    // the Options menu ships with the bundle and offers device / style / button type
    const menu = readFileSync(join(repo, 'uiux', 'source', 'prototype', 'options-menu.js'), 'utf8');
    assert.match(menu, /Device view/); assert.match(menu, /Style view/); assert.match(menu, /Button type/);
    assert.match(menu, new RegExp(`"key":"${two}"`));
    const chk = spawnSync(process.execPath, ['--check', join(repo, 'uiux', 'source', 'prototype', 'options-menu.js')]);
    assert.equal(chk.status, 0, String(chk.stderr));
  } finally { rmSync(repo, { recursive: true, force: true }); w.close(); }
});
