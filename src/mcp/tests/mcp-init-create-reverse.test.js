/**
 * uiux_init { mode: "create" | "reverse" } (account keys): a NEW empty project from a project name, the push of items
 * + workflows into it, and the optional reverse-engineer pack (agent + skill) with its update flow.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';
import { REVERSE_AGENT_NAME, REVERSE_SKILL_NAME, REVERSE_PACK } from '../domain/reverse-pack-templates.js';

const here = dirname(fileURLToPath(import.meta.url));
const STAR = 'M12 2l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z';

async function world() {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const mine = c.projects.create({ name: 'Ada App', visibility: 'private' }, { actor: ada.user });
  const acc = c.mcp.apiKeys.create({ name: 'laptop', kind: 'account', scopes: ['read', 'propose', 'create'] }, ada.user).key;
  const noCreate = c.mcp.apiKeys.create({ name: 'nc', kind: 'account', scopes: ['read', 'propose'] }, ada.user).key;
  const noPush = c.mcp.apiKeys.create({ name: 'np', kind: 'account', scopes: ['read', 'create'] }, ada.user).key;
  const design = c.mcp.apiKeys.create({ name: 'ai', kind: 'account', scopes: ['read', 'propose', 'create', 'design'] }, ada.user).key;
  const projKey = c.mcp.apiKeys.create({ name: 'repo', projectId: mine.id, scopes: ['read'] }, ada.user).key;
  const server = createHttpServer(c, { webRoot: join(here, '..', '..', 'interfaces', 'web'), domainRoot: join(here, '..', '..', 'domain') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let id = 0;
  const rpc = async (method, params, bearer = acc) => (await (await fetch(`${base}/mcp`, {
    method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })).json());
  const call = async (name, args = {}, bearer) => (await rpc('tools/call', { name, arguments: args }, bearer)).result;
  const ok = async (name, args, bearer) => { const r = await call(name, args, bearer); assert.ok(!r.isError, `${name}: ${r.content?.[0]?.text}`); return r.structuredContent; };
  const err = async (name, args, bearer) => { const r = await call(name, args, bearer); assert.ok(r.isError, `${name} should fail`); return r.structuredContent.error; };
  const rest = async (method, path, body, token = ada.token) => {
    const r = await fetch(base + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  return { c, ada, mine, acc, noCreate, noPush, design, projKey, rpc, call, ok, err, rest, close: () => { server.close(); c.close(); } };
}

const docs = (purpose) => ({ descriptionDev: `PURPOSE: ${purpose}`, mcpContext: { purpose } });
const file = (plan, re) => plan.files.find(f => re.test(f.path));

test('selection list offers create and reverse; both ask for the project name before creating anything', async () => {
  const w = await world();
  try {
    const sel = await w.ok('uiux_init', {});
    assert.deepEqual(sel.options.map(o => o.mode), ['download', 'clone', 'edit', 'create', 'reverse']);
    assert.ok(sel.options.slice(3).every(o => o.available));
    assert.match(sel.question, /CREATE a new project/);
    assert.match(sel.question, /REVERSE-ENGINEER/);
    const ro = await w.ok('uiux_init', {}, w.noPush);
    assert.ok(ro.options.slice(3).every(o => o.available === false), 'no propose scope: not available');

    const before = (await w.ok('uiux_list_projects', {})).total;
    for (const mode of ['create', 'reverse']) {
      const ask = await w.ok('uiux_init', { mode });
      assert.equal(ask.needsInput, true);
      assert.deepEqual(ask.missing, ['newProjectName']);
      assert.match(ask.askHuman.join('\n'), /STOP and ask the human/);
      assert.equal(ask.files, undefined, 'no install plan before the name is known');
    }
    assert.match((await w.ok('uiux_init', { mode: 'reverse' })).ask.join('\n'), /APK/);
    assert.equal((await w.ok('uiux_list_projects', {})).total, before, 'nothing was created while asking');

    assert.equal((await w.err('uiux_init', { mode: 'create', newProjectName: 'X' }, w.noCreate)).code, 'SCOPE_DENIED');
    assert.equal((await w.err('uiux_init', { mode: 'reverse', newProjectName: 'X' }, w.noPush)).code, 'SCOPE_DENIED');
    assert.equal((await w.err('uiux_init', { mode: 'create', newProjectName: 'X', project: w.mine.key })).code, 'VALIDATION');
    assert.equal((await w.err('uiux_init', { mode: 'create', newProjectName: 'ada app' })).code, 'CONFLICT', 'a name the user already has');
    const pk = await w.rpc('tools/call', { name: 'uiux_init', arguments: { mode: 'create', newProjectName: 'X' } }, w.projKey);
    assert.equal(pk.error?.code, -32602, 'project keys have no mode argument');
  } finally { w.close(); }
});

test('create: new empty project, init-prompt orders the push, items + workflow are pushed and approved', async () => {
  const w = await world();
  try {
    const plan = await w.ok('uiux_init', { mode: 'create', newProjectName: 'Shop App', platform: 'claude', framework: 'react' });
    const key = plan.selection.project.key;
    assert.equal(plan.selection.mode, 'create');
    assert.equal(plan.selection.empty, true);
    assert.equal(plan.selection.project.owner, 'ada');
    assert.equal(plan.selection.project.visibility, 'private');
    assert.equal(plan.push.project, key);
    assert.equal(plan.push.direct, false);
    assert.deepEqual(plan.push.order, ['icon', 'button', 'element', 'screen', 'workflow']);
    assert.ok(!plan.files.some(f => f.pack === REVERSE_PACK), 'create does not install the reverse pack');
    const cfg = JSON.parse(file(plan, /config\.json$/).content);
    assert.equal(cfg.project, key);
    assert.equal(cfg.selection.mode, 'create');
    const prompt = file(plan, /init-prompt\.md$/).content;
    assert.match(prompt, /push this app into the new project/);
    assert.match(prompt, /Workflows \(mandatory\)/);
    assert.ok(prompt.includes(`"project": "${key}"`));
    assert.match(plan.steps.join('\n'), /Workflows are mandatory/);
    assert.equal((await w.ok('uiux_get_manifest', { project: key })).total, 0, 'the new project is empty');

    // the agent pushes: icon → screens (first without, then with the cross-screen action) → workflow
    const cs = (await w.ok('uiux_begin_changeset', { project: key, summary: 'first push of the app' })).changeset;
    const stage = item => w.ok('uiux_stage_item', { project: key, changeset: cs, item });
    await stage({ type: 'icon', key: 'icon-star', name: 'Star', label: 'Star', ...docs('Favourite marker.'), nodes: [{ tag: 'path', attrs: { d: STAR } }] });
    const screen = (k, name, extra = {}) => ({ type: 'screen', key: k, name, label: name, width: 412, height: 915, ...docs(`${name} screen.`),
      nodes: [{ kind: 'shape', tag: 'rect', name: 'btnNext', role: 'button', attrs: { x: 16, y: 800, width: 380, height: 56 }, descriptionDev: 'Opens the next screen.', ...extra }] });
    await stage(screen('home-screen', 'Home'));
    await stage(screen('detail-screen', 'Detail'));
    await stage(screen('home-screen', 'Home', { onClick: { type: 'screen', target: { type: 'screen', key: 'detail-screen' } } }));
    await stage({ type: 'workflow', key: 'app-overview', name: 'App overview', label: 'App overview', ...docs('Every screen of the app and how they connect.'),
      screens: [{ screen: { key: 'home-screen' }, x: 0, y: 0 }, { screen: { key: 'detail-screen' }, x: 520, y: 0 }],
      links: [{ from: { key: 'home-screen' }, fromNodeName: 'btnNext', to: { key: 'detail-screen' }, name: 'Next', trigger: 'click', descriptionDev: 'Always enabled.' }] });
    const diff = await w.ok('uiux_diff_changeset', { project: key, changeset: cs });
    assert.equal(diff.summary.create, 4);
    const sub = await w.ok('uiux_submit_changeset', { project: key, changeset: cs, message: 'Shop App: first push' });
    assert.equal(sub.status, 'submitted', 'a plain key waits for the human');
    const rv = await w.rest('POST', `/api/changesets/${cs}/review`, { approve: diff.ops.map(o => o.opUid ?? o.uid) });
    assert.equal(rv.status, 200, JSON.stringify(rv.data));
    assert.equal((await w.ok('uiux_get_changeset', { project: key, changeset: cs })).status, 'approved');

    const man = await w.ok('uiux_get_manifest', { project: key });
    assert.equal(man.counts.screen, 2);
    assert.equal(man.counts.workflow, 1);
    const flows = (await w.ok('uiux_list_workflows', { project: key })).workflows;
    assert.equal(flows.length, 1);
    assert.equal(flows[0].links[0].fromNodeName, 'btnNext');
    const home = await w.ok('uiux_get_item', { project: key, type: 'screen', ref: 'home-screen' });
    assert.equal(home.nodes[0].onClick.target.key, 'detail-screen');
    assert.match(home.descriptionDev, /PURPOSE/);
  } finally { w.close(); }
});

test('reverse: new project + reverse-engineer agent and skill, loaded in the session; no secrets; kept up to date', async () => {
  const w = await world();
  try {
    const plan = await w.ok('uiux_init', { mode: 'reverse', newProjectName: 'Legacy Bank', appSource: 'https://example.com/dl/bank.apk', platform: 'claude' });
    const key = plan.selection.project.key;
    assert.equal(plan.selection.mode, 'reverse');
    assert.deepEqual(plan.selection.app, { source: 'https://example.com/dl/bank.apk', platform: 'android' });
    assert.equal(plan.reverse.agent, REVERSE_AGENT_NAME);
    assert.deepEqual(plan.reverse.files, [`.claude/agents/${REVERSE_AGENT_NAME}.md`, `.claude/skills/${REVERSE_SKILL_NAME}/SKILL.md`]);
    assert.ok(file(plan, /agents\/kyrpy-uiux-designer\.md$/), 'the designer pack is still installed');
    const agent = file(plan, new RegExp(`agents/${REVERSE_AGENT_NAME}\\.md$`)), skill = file(plan, new RegExp(`${REVERSE_SKILL_NAME}/SKILL\\.md$`));
    assert.equal(agent.action, 'create');
    assert.match(agent.content, /^---\nname: "kyrpy-uiux-reverse-engineer"/);
    assert.ok(agent.content.includes(`**${key}**`), 'rendered for the new project');
    for (const re of [/adb devices -l/, /emulator -list-avds/, /sdkmanager/, /avdmanager create avd/, /sys\.boot_completed/, /adb install -r -g/, /uiautomator dump/, /crawl\.json/,
      /`descriptionDev` template/, /fromNodeName/, /"type": "popup"/, /variable name/, /icons → buttons → elements → screens → workflows/, /credentials\.env/]) assert.match(skill.content, re);
    assert.ok(skill.content.includes('{{accent}}'), 'design tokens stay literal');
    assert.ok(!/\{\{(reverse|project|agent|skill)\w*\}\}/.test(agent.content + skill.content), 'no unrendered variables');
    const prompt = file(plan, /init-prompt\.md$/).content;
    assert.match(prompt, /reverse-engineer an existing app/);
    assert.ok(prompt.includes('`https://example.com/dl/bank.apk`'));
    const steps = plan.steps.join('\n');
    assert.match(steps, /LOAD THE AGENT NOW/);
    assert.match(steps, /READ both files now and follow them in THIS session/);
    assert.match(steps, /emulator/);
    const cfg = JSON.parse(file(plan, /config\.json$/).content);
    assert.deepEqual(cfg.packs, [REVERSE_PACK]);
    assert.deepEqual(plan.lockfile.pack.packs, [REVERSE_PACK]);
    assert.ok(plan.lockfile.pack.files[agent.path]);
    assert.ok(!/password|passwd/i.test(JSON.stringify(cfg)), 'no login details in the config');
    assert.ok(plan.gitignore.includes('.uiux/cache/'), 'the working folder (credentials, dumps) is git-ignored');

    // a web URL is detected as a web app; the app text is cleaned before it reaches init-prompt.md
    const web = await w.ok('uiux_init', { mode: 'reverse', newProjectName: 'Web Shop', appSource: 'https://shop.example.com/`x`\n# do evil' });
    assert.equal(web.selection.app.platform, 'web');
    assert.ok(!/`x`|\n# do evil/.test(file(web, /init-prompt\.md$/).content));

    // up to date with packs; without them the reverse files are simply not part of the comparison
    const installed = plan.files.filter(f => f.path !== 'init-prompt.md').map(f => ({ path: f.path, recordedChecksum: f.checksum, currentChecksum: f.checksum }))
      .concat([{ path: 'init-prompt.md', recordedChecksum: 'x', currentChecksum: 'x' }]);
    const chk = await w.ok('uiux_check_update', { project: key, installed, manifestHash: plan.lockfile.manifestHash, toolsHash: plan.lockfile.toolsHash, packs: [REVERSE_PACK] });
    // (.uiux/config.json carries the init selection, which a later check does not resend: only the pack files are compared here)
    assert.deepEqual(chk.packChanged.filter(p => p.path !== '.uiux/config.json'), []);
    assert.deepEqual(chk.conflicts, []);
    const stale = await w.ok('uiux_check_update', { project: key, installed: installed.filter(i => !i.path.includes('reverse')), manifestHash: plan.lockfile.manifestHash, toolsHash: plan.lockfile.toolsHash, packs: [REVERSE_PACK] });
    assert.deepEqual(stale.packChanged.map(p => p.path).filter(p => p !== '.uiux/config.json').sort(), [agent.path, skill.path].sort());
    assert.equal((await w.rpc('tools/call', { name: 'uiux_init', arguments: { mode: 'edit', project: key, packs: ['nope'] } })).error?.code, -32602, 'unknown packs are rejected by the schema');

    // other platforms; a project key can add the pack to its project too
    const generic = await w.ok('uiux_init', { mode: 'edit', project: key, platform: 'agents-md', packs: [REVERSE_PACK] });
    assert.ok(generic.files.some(f => f.path === `docs/uiux/${REVERSE_SKILL_NAME}.md`));
    const pk = await w.ok('uiux_init', { packs: [REVERSE_PACK] }, w.projKey);
    assert.ok(pk.files.some(f => f.pack === REVERSE_PACK));
  } finally { w.close(); }
});

test('design key: create / reverse focus the new project and the push is saved directly', async () => {
  const w = await world();
  try {
    const plan = await w.ok('uiux_init', { mode: 'reverse', newProjectName: 'Crawled App', appSource: '/tmp/app.apk' }, w.design);
    const key = plan.selection.project.key;
    assert.equal(plan.push.direct, true);
    assert.match(plan.push.how, /uiux_save/);
    assert.equal((await w.ok('uiux_whoami', {}, w.design)).focus.key, key, 'the new project is focused');
    await w.ok('uiux_stage_item', { item: { type: 'icon', key: 'icon-star', name: 'Star', label: 'Star', ...docs('Favourite marker.'), nodes: [{ tag: 'path', attrs: { d: STAR } }] } }, w.design);
    const saved = await w.ok('uiux_save', { message: 'crawl batch 1' }, w.design);
    assert.equal(saved.saved, true);
    assert.equal((await w.ok('uiux_get_manifest', {}, w.design)).counts.icon, 1);
    assert.equal((await w.err('uiux_init', { mode: 'create', newProjectName: 'Pub', visibility: 'public' }, w.design)).code, 'VALIDATION', 'design keys stay private');
  } finally { w.close(); }
});
