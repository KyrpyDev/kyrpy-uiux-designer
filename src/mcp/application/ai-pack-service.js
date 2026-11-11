/**
 * AI pack + init use cases.
 *
 *  - render():  the project's agent/skill files for a client platform (templates from ai_artifacts)
 *  - init():    an install plan for an app repository: pack files with create/update/skip/conflict actions,
 *               .uiux/config.json, .gitignore lines, a bundle, the lockfile to write, and ordered steps
 *  - template overrides per project (owner/admin) and global edits (admin)
 *
 * Local edits are never overwritten silently: when the checksum of a file on disk differs from the checksum
 * recorded at install time, the new content goes to `<path>.uiux-new` and the human is told.
 */
import { createHash } from 'node:crypto';
import { ValidationError, ForbiddenError, NotFoundError } from '../../domain/errors.js';
import { AGENT_NAME, SKILL_NAME, PLATFORMS } from '../domain/ai-pack-templates.js';
import { renderTemplate, platformFiles, reversePackFiles, sectionBlock, SECTION_MARKER } from '../domain/ai-pack-render.js';
import { REVERSE_PACK, REVERSE_AGENT_NAME, REVERSE_SKILL_NAME, REVERSE_WORKDIR } from '../domain/reverse-pack-templates.js';
import { SCHEMA_VERSION } from './design-query-service.js';
import { initPromptMd, cleanAppInfo } from '../domain/init-prompt.js';
import { BUTTON_STYLES } from '../../domain/entities.js';

export const UIUX_ROOTS = ['uiux', 'themes'];
/** Optional packs a repository can add to the designer pack (uiux_init / uiux_check_update `packs`). */
export const EXTRA_PACKS = [REVERSE_PACK];
const KINDS = { agent: AGENT_NAME, skill: SKILL_NAME };
const MAX_TEMPLATE = 64 * 1024;
const sha = s => createHash('sha256').update(s).digest('hex');
export const LOCKFILE_PATH = '.uiux/uiux.lock.json';
export const CONFIG_PATH = '.uiux/config.json';
export const INIT_PROMPT_PATH = 'init-prompt.md';
export const GITIGNORE_LINES = ['.uiux/cache/', '*.uiux-new', 'connect-*.sh', 'connect-*.ps1', 'connect-*.cmd', 'connect-*.fish'];
/** Default MCP client recipe for a pack platform (see interfaces/web/client-setup.js CLIENTS). */
export const PLATFORM_CLIENT = { claude: 'claude-code', antigravity: 'antigravity', cursor: 'cursor', 'agents-md': 'codex', generic: 'generic' };

export class AiPackService {
  /** @param {{artifacts: import('../infrastructure/sqlite/ai-artifact-repository.js').AiArtifactRepository, query: any, bundles: any, projects: any, auth: any}} d */
  constructor(d) { Object.assign(this, d); }

  /* ---------- rendering ---------- */

  #styles(styles) {
    const schema = this.query.schema();
    const all = schema.styles.map(s => s.key);
    if (Array.isArray(styles) && styles.length) {
      const bad = styles.filter(s => !all.includes(s));
      if (bad.length) throw new ValidationError(`unknown style(s): ${bad.join(', ')}`);
      return styles;
    }
    const pair = schema.styles.find(s => s.key === schema.defaultStyle)?.pairKey;
    return [schema.defaultStyle, ...(pair && all.includes(pair) ? [pair] : [])];
  }

  #options({ platform = 'claude', framework = '', uiuxRoot = 'uiux', styles, packs } = {}) {
    if (!PLATFORMS.includes(platform)) throw new ValidationError(`platform must be one of ${PLATFORMS.join(', ')}`);
    if (!UIUX_ROOTS.includes(uiuxRoot)) throw new ValidationError(`uiuxRoot must be one of ${UIUX_ROOTS.join(', ')}`);
    const fw = String(framework || '').trim();
    if (fw.length > 40 || /[<>`{}]/.test(fw)) throw new ValidationError('framework must be a short plain name (for example "react", "flutter")');
    const extra = [...new Set(Array.isArray(packs) ? packs : [])];
    const bad = extra.filter(p => !EXTRA_PACKS.includes(p));
    if (bad.length) throw new ValidationError(`unknown pack(s): ${bad.join(', ')}; available: ${EXTRA_PACKS.join(', ')}`);
    return { platform, framework: fw, uiuxRoot, styles: this.#styles(styles), packs: extra };
  }

  #bodies(projectId) {
    const agent = this.artifacts.effective(projectId, 'agent', AGENT_NAME);
    const skill = this.artifacts.effective(projectId, 'skill', SKILL_NAME);
    if (!agent || !skill) throw new NotFoundError('ai pack template', 'agent/skill');
    const g = Math.max(this.artifacts.global('agent', AGENT_NAME)?.version || 0, this.artifacts.global('skill', SKILL_NAME)?.version || 0);
    const overrides = [agent, skill].filter(a => a.scope === 'project');
    const packVersion = overrides.length ? `${g}.p${overrides.map(a => a.version).reduce((a, b) => a + b, 0)}` : String(g);
    // optional reverse-engineer pack: seeded like the designer pack; absent on a database seeded before it existed → null
    const reverse = {
      agent: this.artifacts.effective(projectId, 'agent', REVERSE_AGENT_NAME),
      skill: this.artifacts.effective(projectId, 'skill', REVERSE_SKILL_NAME)
    };
    return { agent, skill, packVersion, reverse };
  }

  /** Rendered pack files for one platform, each with a sha256 checksum of its exact content. */
  render(principal, opts = {}, { baseUrl }) {
    const o = this.#options(opts);
    const { agent, skill, packVersion, reverse } = this.#bodies(principal.project.id);
    const schema = this.query.schema();
    const vars = {
      agentName: AGENT_NAME, skillName: SKILL_NAME, projectKey: principal.project.key, projectName: principal.project.name,
      serverUrl: baseUrl, mcpUrl: `${baseUrl}/mcp`, styles: o.styles, defaultStyle: o.styles[0] || schema.defaultStyle,
      uiuxRoot: o.uiuxRoot, framework: o.framework, schemaVersion: SCHEMA_VERSION, packVersion,
      reverseAgentName: REVERSE_AGENT_NAME, reverseSkillName: REVERSE_SKILL_NAME, reverseWorkdir: REVERSE_WORKDIR
    };
    // each body shows its own version, so overriding one file does not change the other
    const label = a => (a.scope === 'project' ? `${this.artifacts.global(a.kind, a.name)?.version || 0}.p${a.version}` : String(a.version));
    const laid = platformFiles(o.platform, {
      agent: renderTemplate(agent.template, { ...vars, packVersion: label(agent) }),
      skill: renderTemplate(skill.template, { ...vars, packVersion: label(skill) })
    });
    if (o.packs.includes(REVERSE_PACK)) {
      if (!reverse.agent || !reverse.skill) throw new NotFoundError('ai pack template', REVERSE_PACK);
      laid.push(...reversePackFiles(o.platform, {
        agent: renderTemplate(reverse.agent.template, { ...vars, packVersion: label(reverse.agent) }),
        skill: renderTemplate(reverse.skill.template, { ...vars, packVersion: label(reverse.skill) })
      }).map(f => ({ ...f, pack: REVERSE_PACK })));
    }
    const files = laid
      .map(f => {
        const content = f.mode === 'section' ? sectionBlock(f.marker, f.content) : f.content;
        return { path: f.path, mode: f.mode, ...(f.marker ? { marker: f.marker } : {}), ...(f.pack ? { pack: f.pack } : {}), content, checksum: sha(content) };
      });
    return { platform: o.platform, packVersion, schemaVersion: SCHEMA_VERSION, options: o, files };
  }

  /* ---------- init ---------- */

  /**
   * @param {object} args { platform, framework, uiuxRoot, styles, installed: [{path, recordedChecksum, currentChecksum}],
   *                       manifestHash, includeBundle,
   *                       client, shell, serverName, envVar   (MCP client configuration of this repository),
   *                       origin  (true, or { project, name, version }: the repository is a clone of that design),
   *                       selection ({ mode: 'download'|'clone'|'edit'|'create'|'reverse', baseVersion, headVersion }: account-key init choice),
   *                       packs   (optional packs, e.g. ['reverse-engineer']),
   *                       app     ({ source, platform }: the app to reverse-engineer; never login details) }
   */
  init(principal, args = {}, { baseUrl, createBundle }) {
    const pack = this.render(principal, args, { baseUrl });
    const o = pack.options;
    const installed = new Map((args.installed || []).map(i => [i.path, i]));

    // how this repository talks to the server: the agent (and the next one) reads it from .uiux/config.json
    const keyKind = principal.kind === 'account' ? 'account' : 'project';
    const serverName = String(args.serverName || 'kyrpy-uiux').replace(/[^A-Za-z0-9_.-]/g, '-');
    const envVar = String(args.envVar || 'KYRPY_UIUX_API_KEY').replace(/[^A-Za-z0-9_]/g, '_');
    const client = args.client || PLATFORM_CLIENT[o.platform] || 'generic';
    const mcpSetup = this.clientSetup
      ? this.clientSetup({ client, url: `${baseUrl}/mcp`, shell: args.shell || 'posix', serverName, envVar, projectKey: principal.project.key, keyKind })
      : null;
    const config = {
      server: baseUrl, mcp: `${baseUrl}/mcp`, project: principal.project.key, projectName: principal.project.name,
      styles: o.styles, defaultStyle: o.styles[0], uiuxRoot: o.uiuxRoot, adapters: ['web'], platform: o.platform,
      ...(o.framework ? { framework: o.framework } : {}), apiKeyEnv: envVar,
      mcpClient: { client, serverName, keyKind, keyStorage: keyKind === 'account' ? 'user' : 'repository' },
      ...(args.origin ? { origin: typeof args.origin === 'object' ? args.origin : { project: principal.project.key, name: principal.project.name } } : {}),
      // account-key init: what the human chose (clone → new project, or edit an owned project at a version)
      ...(args.selection ? { selection: args.selection } : {}),
      ...(o.packs.length ? { packs: o.packs } : {})
    };
    const configContent = `${JSON.stringify(config, null, 2)}\n`;
    // init-prompt.md orders the coding assistant to build the standalone prototype; written once, never overwritten
    const sel = args.selection || {};
    const mode = sel.mode || (args.origin ? 'download' : 'project');
    const initPrompt = initPromptMd({
      mode, projectKey: principal.project.key, projectName: principal.project.name,
      sourceKey: sel.source || args.origin?.project, sourceName: args.origin?.name, sourceVersion: sel.sourceVersion ?? args.origin?.version,
      version: sel.headVersion ?? sel.baseVersion, framework: o.framework, root: o.uiuxRoot, app: cleanAppInfo(args.app),
      reverse: { agentName: REVERSE_AGENT_NAME, skillName: REVERSE_SKILL_NAME, workdir: REVERSE_WORKDIR },
      styles: this.query.schema().styles.map(st => st.key), defaultStyle: o.styles[0], buttonStyles: BUTTON_STYLES.map(b => b.key)
    });
    const candidates = [...pack.files, { path: CONFIG_PATH, mode: 'file', content: configContent, checksum: sha(configContent) },
      { path: INIT_PROMPT_PATH, mode: 'file', content: initPrompt, checksum: sha(initPrompt), once: true }];

    const files = candidates.map(f => {
      const inst = installed.get(f.path);
      const base = { path: f.path, mode: f.mode, ...(f.marker ? { marker: f.marker } : {}), ...(f.pack ? { pack: f.pack } : {}), checksum: f.checksum };
      if (!inst || !inst.currentChecksum) return { ...base, action: 'create', content: f.content };
      if (f.once) return { ...base, action: 'skip', reason: 'written once at init' };
      const locallyEdited = inst.recordedChecksum && inst.currentChecksum !== inst.recordedChecksum;
      if (locallyEdited) {
        if (inst.currentChecksum === f.checksum) return { ...base, action: 'skip', reason: 'local file already matches' };
        return { ...base, action: 'conflict', writeTo: `${f.path}.uiux-new`, content: f.content, reason: 'the local file was edited after install; review the .uiux-new version and merge by hand' };
      }
      if (inst.currentChecksum === f.checksum) return { ...base, action: 'skip', reason: 'up to date' };
      return { ...base, action: 'update', content: f.content };
    });

    const manifest = this.query.manifestPage(principal, { limit: 1 });
    const wantBundle = args.includeBundle !== false && args.manifestHash !== manifest.manifestHash;
    const bundle = wantBundle ? createBundle({ styles: o.styles, adapters: ['web'], root: o.uiuxRoot, switchable: true }) : null;
    const prev = Object.fromEntries((args.installed || []).map(i => [i.path, i.recordedChecksum]));
    const lockfile = {
      lockfileVersion: 1,
      server: { url: baseUrl, mcp: `${baseUrl}/mcp` },
      project: { key: principal.project.key, name: principal.project.name },
      schemaVersion: SCHEMA_VERSION,
      manifestHash: bundle ? bundle.manifestHash : (args.manifestHash || manifest.manifestHash),
      styles: o.styles, allStyles: bundle ? true : undefined, uiuxRoot: o.uiuxRoot, adapters: ['web'],
      pack: {
        platform: o.platform, version: pack.packVersion, ...(o.packs.length ? { packs: o.packs } : {}),
        files: Object.fromEntries(files.map(f => [f.path, f.action === 'conflict' ? (prev[f.path] || null) : f.checksum]))
      },
      ...(bundle ? { bundle: { sha256: bundle.sha256, filename: bundle.filename } } : {}),
      installedAt: new Date().toISOString()
    };

    const root = o.uiuxRoot;
    const steps = [
      `Write every entry of files[] whose action is "create" or "update" to its path with exactly the given content (create folders as needed). For mode "section", replace the text between "<!-- ${SECTION_MARKER}:start -->" and "<!-- ${SECTION_MARKER}:end -->" in that file, or append the block (create the file if it does not exist). Skip "skip" entries.`,
      'For every "conflict" entry write the content to writeTo instead, do not touch the original file, and tell the human which files need a manual merge.',
      `Add the lines of gitignore[] to .gitignore if they are missing.`,
      ...(o.packs.includes(REVERSE_PACK) ? [`The reverse-engineering agent "${REVERSE_AGENT_NAME}" and skill "${REVERSE_SKILL_NAME}" are in files[] (pack "${REVERSE_PACK}"). After writing them, READ both files now and follow them in THIS session — do not wait for a restart of the client to load them. Pass packs: ["${REVERSE_PACK}"] on later uiux_init / uiux_check_update calls so they stay up to date.`] : []),
      ...(mcpSetup ? [keyKind === 'account'
        ? `This is an ACCOUNT key (one key for all of the user's projects). Pass "project": "${principal.project.key}" (from .uiux/config.json → project) on every uiux_* call made for this repository.`
        : `MCP client for this repository: mcpSetup.steps show how the human keeps THIS project's key per repository (${mcpSetup.keyKind === 'project' ? 'local scope / .envrc / .gemini/.env' : 'user scope'}). You never see or write the key: show the steps to the human if the connection must be set up for teammates or another client.`] : []),
      ...(bundle ? [
        `Download and unpack the design bundle by running bundle.install in order (it replaces ${root}/source/). On macOS use "shasum -a 256 -c" instead of "sha256sum -c". On Windows run bundle.installByShell.powershell (PowerShell) or bundle.installByShell.cmd (cmd) instead: the same steps with curl.exe, tar.exe and Get-FileHash / certutil.`,
        `ALL design styles and button styles were downloaded. Copy every style folder so the developer can switch: for each directory in ${root}/source/adapters/web/ run mkdir -p ${root}/<style> && cp -R ${root}/source/adapters/web/<style>/. ${root}/<style>/ (PowerShell: New-Item -ItemType Directory -Force ${root}/<style>; Copy-Item -Recurse -Force ${root}/source/adapters/web/<style>/* ${root}/<style>/ — cmd: xcopy /e /i /y ${root}\\source\\adapters\\web\\<style> ${root}\\<style>) (default styles: ${JSON.stringify(o.styles)}). Then activate the default: node ${root}/source/switch-style.mjs ${o.styles[0]} (writes ${root}/active/). Switch later with: node ${root}/source/switch-style.mjs --list | <design-style> [<button-style>] | --button <button-style>. Per-item SVG files exist only for ${JSON.stringify(o.styles)}; the web sprites of all styles are included. For non-web stacks follow the skill's "convert for this app" procedure instead.`
      ] : ['The design is already up to date (manifestHash unchanged): no download needed.']),
      `Write lockfile as JSON to ${LOCKFILE_PATH}.`,
      'Check that no API key was written anywhere: `grep -rn "kud_live_\\|kud_test_" . --exclude-dir=node_modules --exclude-dir=.git` must print nothing.',
      'Report to the human: files created/updated/conflicting, styles installed, item counts, and that they can now ask for "pull design updates".'
    ];

    return {
      project: principal.project, platform: o.platform, packVersion: pack.packVersion, schemaVersion: SCHEMA_VERSION,
      summary: {
        create: files.filter(f => f.action === 'create').length, update: files.filter(f => f.action === 'update').length,
        skip: files.filter(f => f.action === 'skip').length, conflict: files.filter(f => f.action === 'conflict').length,
        bundle: bundle ? `${bundle.files} files, ${bundle.bytes} bytes` : 'not needed'
      },
      files, gitignore: [...new Set([...GITIGNORE_LINES, ...(mcpSetup?.gitignore || [])])], bundle, lockfile, steps,
      ...(mcpSetup ? { mcpSetup: { client: mcpSetup.client, label: mcpSetup.label, keyKind, serverName, envVar, steps: mcpSetup.steps.map(({ title, path, lang, text }) => ({ title, path, lang, text })), notes: mcpSetup.notes } } : {}),
      notes: [
        'Keep the API key out of the repository: it belongs in the MCP client configuration or the KYRPY_UIUX_API_KEY environment variable.',
        'Run uiux_init again at any time; it only returns what changed and never overwrites files you edited.'
      ]
    };
  }

  /**
   * Cheap start-of-session check (uiux_check_update): is the pack, the design or the server's tool set newer than this repository?
   * `toolsHash` is supplied by the caller (tools.js) and compared with the lockfile's.
   */
  checkUpdate(principal, args = {}, { baseUrl, toolsHash }) {
    const plan = this.init(principal, { ...args, includeBundle: false }, { baseUrl, createBundle: () => null });
    const manifest = this.query.manifestPage(principal, { limit: 1 });
    const packChanged = plan.files.filter(f => f.action === 'create' || f.action === 'update').map(f => ({ path: f.path, action: f.action }));
    const conflicts = plan.files.filter(f => f.action === 'conflict').map(f => f.path);
    const designChanged = Boolean(args.manifestHash) && args.manifestHash !== manifest.manifestHash;
    const toolsChanged = Boolean(args.toolsHash) && args.toolsHash !== toolsHash;
    const updateAvailable = packChanged.length > 0 || conflicts.length > 0 || designChanged || toolsChanged || !args.toolsHash;
    return {
      updateAvailable, packVersion: plan.packVersion, schemaVersion: plan.schemaVersion, toolsHash, manifestHash: manifest.manifestHash,
      packChanged, conflicts, designChanged, toolsChanged,
      next: updateAvailable
        ? 'Call uiux_init with the same installed list, apply its steps (pack files, config, bundle), then write the returned lockfile (it records toolsHash).'
        : 'Up to date: continue with the task.'
    };
  }

  /* ---------- template management (designer REST) ---------- */

  #project(id) { const p = this.projects.get(Number(id)); if (!p) throw new NotFoundError('project', id); return p; }

  #assertOwnerOrAdmin(project, actor) {
    if (!actor?.id) throw new ForbiddenError('sign in first');
    if (Number(project.ownerId) !== Number(actor.id) && !this.auth.isAdmin(actor)) throw new ForbiddenError('only the project owner or an administrator can do this');
  }

  #kind(kind) { if (!KINDS[kind]) throw new ValidationError(`kind must be one of ${Object.keys(KINDS).join(', ')}`); return KINDS[kind]; }

  #template(t) {
    const s = String(t ?? '');
    if (!s.trim()) throw new ValidationError('template must not be empty');
    if (s.length > MAX_TEMPLATE) throw new ValidationError(`template must be at most ${MAX_TEMPLATE} characters`);
    return s;
  }

  listTemplates(projectId, actor) {
    const p = this.#project(projectId);
    this.#assertOwnerOrAdmin(p, actor);
    return Object.entries(KINDS).map(([kind, name]) => {
      const eff = this.artifacts.effective(p.id, kind, name);
      const global = this.artifacts.global(kind, name);
      return { kind, name, scope: eff.scope, source: eff.source, version: eff.version, updatedAt: eff.updatedAt, template: eff.template, globalVersion: global?.version };
    });
  }

  setOverride(projectId, kind, template, actor) {
    const p = this.#project(projectId);
    this.#assertOwnerOrAdmin(p, actor);
    const a = this.artifacts.upsertOverride({ projectId: p.id, kind, name: this.#kind(kind), template: this.#template(template), userId: actor.id });
    return { kind, name: a.name, scope: a.scope, version: a.version, checksum: a.checksum };
  }

  clearOverride(projectId, kind, actor) {
    const p = this.#project(projectId);
    this.#assertOwnerOrAdmin(p, actor);
    return { kind, removed: this.artifacts.deleteOverride(p.id, kind, this.#kind(kind)) };
  }

  setGlobal(kind, template, actor) {
    if (!this.auth.isAdmin(actor)) throw new ForbiddenError('Administrator privileges required');
    const a = this.artifacts.updateGlobal({ kind, name: this.#kind(kind), template: this.#template(template), userId: actor.id });
    return { kind, name: a.name, scope: a.scope, version: a.version, source: a.source };
  }

  /** Session-side preview of the rendered pack (owner/admin). */
  preview(projectId, platform, actor, { baseUrl }) {
    const p = this.#project(projectId);
    this.#assertOwnerOrAdmin(p, actor);
    return this.render({ user: actor, project: { id: p.id, key: p.key, name: p.name } }, { platform }, { baseUrl });
  }
}
