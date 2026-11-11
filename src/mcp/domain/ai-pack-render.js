/**
 * AI pack rendering (pure): a minimal template engine and the per-platform file layout.
 *
 * Template syntax:
 *   {{name}}                     value of vars[name]; UNKNOWN names are left untouched (so design tokens
 *                                like {{accent}} can be written literally in templates)
 *   {{#if name}}…{{/if}}         kept when vars[name] is truthy (non-empty for arrays)
 *   {{#each name}}…{{this}}…{{/each}}   repeated for every element of the array vars[name]
 */
import {
  AGENT_NAME,
  SKILL_NAME,
  PLATFORMS,
  TOOL_PLAYBOOK_TEMPLATE,
  RULE_TEMPLATE,
  SYNC_WORKFLOW_TEMPLATE
} from './ai-pack-templates.js';
import { REVERSE_AGENT_NAME, REVERSE_SKILL_NAME, REVERSE_AGENT_DESC, REVERSE_SKILL_DESC } from './reverse-pack-templates.js';
import { ValidationError } from '../../domain/errors.js';

export const SECTION_MARKER = 'kyrpy-uiux';

const truthy = v => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function renderTemplate(template, vars = {}) {
  let out = String(template);
  out = out.replace(/\{\{#each ([a-zA-Z]\w*)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, name, body) =>
    (Array.isArray(vars[name]) ? vars[name] : []).map(item => body.replace(/\{\{this\}\}/g, String(item))).join(''));
  out = out.replace(/\{\{#if ([a-zA-Z]\w*)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, name, body) => (truthy(vars[name]) ? body : ''));
  out = out.replace(/\{\{([a-zA-Z]\w*)\}\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : m));
  return out;
}

const yamlVal = v => {
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(x => JSON.stringify(x)).join(', ')}]`;
  return String(v);
};

const frontmatter = fields => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${yamlVal(v)}`).join('\n')}\n---\n\n`;

export const AGENT_DESC = 'Design-system owner for this repository over MCP (kyrpy-uiux): syncs Kyrpy UI/UX Designer tokens, icons, buttons, menus, elements, screens and workflows, searches public/project libraries before creating items, authors vector graphics and sandboxed element scripts, and builds standalone prototypes.';
export const SKILL_DESC = 'Syncs, searches, authors and converts Kyrpy UI/UX Designer items over MCP (kyrpy-uiux). Activate when working on UI components, icons, buttons, menus (hub-menu, radial, dock, burger, horizontal/vertical orientation, beside/over labels), screens, navigation workflows, design tokens, themes/styles, vector/pathfinder tools, custom element scripts, standalone prototypes, or reverse-syncing UI.';
const RULE_DESC = 'Kyrpy UI/UX Designer workspace rules: start-of-session uiux_check_update, reuse-before-create, canonical source folder protection, and API key safety.';
const SYNC_DESC = 'Check Kyrpy UI/UX Designer for pack, tool, or design updates and sync this repository.';

const DEFAULT_VARS = {
  agentName: AGENT_NAME,
  skillName: SKILL_NAME,
  projectKey: 'project',
  projectName: 'Project',
  serverUrl: '',
  mcpUrl: '',
  uiuxRoot: 'uiux',
  defaultStyle: 'liquid',
  schemaVersion: '1.0'
};

/** Metadata describing the native agentic directory hierarchy for each supported platform. */
export const PLATFORM_LAYOUTS = {
  claude: {
    rootDir: '.claude',
    directories: ['.claude/agents', `.claude/skills/${SKILL_NAME}/references`, '.claude/rules', '.claude/commands', '.uiux']
  },
  antigravity: {
    rootDir: '.agents',
    directories: [`.agents/agents/${AGENT_NAME}`, `.agents/skills/${SKILL_NAME}/references`, '.agents/rules', '.agents/workflows', '.uiux']
  },
  gemini: {
    rootDir: '.gemini',
    directories: ['.gemini', `.agents/skills/${SKILL_NAME}/references`, '.agents/rules', '.uiux']
  },
  cursor: {
    rootDir: '.cursor',
    directories: ['.cursor/rules', '.uiux']
  },
  vscode: {
    rootDir: '.github',
    directories: ['.vscode', '.github/agents', '.github/instructions', '.github/prompts', `.agents/skills/${SKILL_NAME}/references`, '.uiux']
  },
  windsurf: {
    rootDir: '.windsurf',
    directories: ['.windsurf/rules', '.windsurf/workflows', '.uiux']
  },
  cline: {
    rootDir: '.clinerules',
    directories: ['.clinerules', '.uiux']
  },
  'agents-md': {
    rootDir: 'AGENTS.md',
    directories: ['.uiux']
  },
  generic: {
    rootDir: 'docs/uiux',
    directories: ['docs/uiux', '.uiux']
  }
};

export function platformLayoutInfo(platform) {
  if (!PLATFORMS.includes(platform)) throw new ValidationError(`platform must be one of ${PLATFORMS.join(', ')}`);
  return { platform, ...(PLATFORM_LAYOUTS[platform] || PLATFORM_LAYOUTS.generic) };
}

/**
 * Lays rendered bodies out as files for a client platform.
 * @returns {{path: string, content: string, mode: 'file'|'section', marker?: string, role?: string}[]}
 */
export function platformFiles(platform, { agent, skill, playbook, rule, workflow, vars = {} }) {
  if (!PLATFORMS.includes(platform)) throw new ValidationError(`platform must be one of ${PLATFORMS.join(', ')}`);
  const v = { ...DEFAULT_VARS, ...vars };
  const pb = playbook ?? renderTemplate(TOOL_PLAYBOOK_TEMPLATE, v);
  const rl = rule ?? renderTemplate(RULE_TEMPLATE, v);
  const wf = workflow ?? renderTemplate(SYNC_WORKFLOW_TEMPLATE, v);

  switch (platform) {
    case 'claude':
      return [
        { path: `.claude/agents/${AGENT_NAME}.md`, role: 'agent', mode: 'file', content: frontmatter({ name: AGENT_NAME, description: AGENT_DESC }) + agent },
        { path: `.claude/skills/${SKILL_NAME}/SKILL.md`, role: 'skill', mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill },
        { path: `.claude/skills/${SKILL_NAME}/references/tool-playbook.md`, role: 'playbook', mode: 'file', content: pb },
        { path: '.claude/rules/kyrpy-uiux.md', role: 'rule', mode: 'file', content: rl },
        { path: '.claude/commands/uiux-sync.md', role: 'workflow', mode: 'file', content: frontmatter({ description: SYNC_DESC }) + wf }
      ];
    case 'antigravity':
      return [
        { path: `.agents/agents/${AGENT_NAME}/agent.md`, role: 'agent', mode: 'file', content: frontmatter({ name: AGENT_NAME, description: AGENT_DESC, skills: [SKILL_NAME], inheritMcp: true }) + agent },
        { path: `.agents/skills/${SKILL_NAME}/SKILL.md`, role: 'skill', mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill },
        { path: `.agents/skills/${SKILL_NAME}/references/tool-playbook.md`, role: 'playbook', mode: 'file', content: pb },
        { path: '.agents/rules/kyrpy-uiux.md', role: 'rule', mode: 'file', content: frontmatter({ name: 'kyrpy-uiux', description: RULE_DESC }) + rl },
        { path: '.agents/workflows/uiux-sync.md', role: 'workflow', mode: 'file', content: frontmatter({ description: SYNC_DESC }) + wf }
      ];
    case 'gemini':
      return [
        { path: 'GEMINI.md', role: 'agent', mode: 'section', marker: SECTION_MARKER, content: `${agent}\n\n${rl}` },
        { path: `.agents/skills/${SKILL_NAME}/SKILL.md`, role: 'skill', mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill },
        { path: `.agents/skills/${SKILL_NAME}/references/tool-playbook.md`, role: 'playbook', mode: 'file', content: pb }
      ];
    case 'cursor':
      return [
        { path: `.cursor/rules/${AGENT_NAME}.mdc`, role: 'agent', mode: 'file', content: `---\ndescription: ${SKILL_DESC}\nglobs:\nalwaysApply: false\n---\n\n${agent}\n\n${skill}` },
        { path: '.cursor/rules/kyrpy-uiux-rules.mdc', role: 'rule', mode: 'file', content: `---\ndescription: ${RULE_DESC}\nglobs:\nalwaysApply: true\n---\n\n${rl}` },
        { path: '.cursor/rules/kyrpy-uiux-playbook.mdc', role: 'playbook', mode: 'file', content: `---\ndescription: Kyrpy UI/UX Designer deep JSON schemas, menu mechanisms, graphic tools and sandboxed element scripts\nglobs:\nalwaysApply: false\n---\n\n${pb}` }
      ];
    case 'vscode':
      return [
        { path: `.github/agents/${AGENT_NAME}.agent.md`, role: 'agent', mode: 'file', content: frontmatter({ name: AGENT_NAME, description: AGENT_DESC }) + agent },
        { path: `.agents/skills/${SKILL_NAME}/SKILL.md`, role: 'skill', mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill },
        { path: `.agents/skills/${SKILL_NAME}/references/tool-playbook.md`, role: 'playbook', mode: 'file', content: pb },
        { path: '.github/instructions/kyrpy-uiux.instructions.md', role: 'rule', mode: 'file', content: frontmatter({ applyTo: '**' }) + rl },
        { path: '.github/prompts/uiux-sync.prompt.md', role: 'workflow', mode: 'file', content: frontmatter({ mode: 'agent', description: SYNC_DESC }) + wf }
      ];
    case 'windsurf':
      return [
        { path: `.windsurf/rules/${AGENT_NAME}.md`, role: 'agent', mode: 'file', content: frontmatter({ trigger: 'model_decision', description: AGENT_DESC }) + agent },
        { path: `.windsurf/rules/${SKILL_NAME}.md`, role: 'skill', mode: 'file', content: frontmatter({ trigger: 'model_decision', description: SKILL_DESC }) + `${skill}\n\n${pb}` },
        { path: '.windsurf/rules/kyrpy-uiux-rules.md', role: 'rule', mode: 'file', content: frontmatter({ trigger: 'always_on', description: RULE_DESC }) + rl },
        { path: '.windsurf/workflows/uiux-sync.md', role: 'workflow', mode: 'file', content: frontmatter({ description: SYNC_DESC }) + wf }
      ];
    case 'cline':
      return [
        { path: `.clinerules/01-${AGENT_NAME}.md`, role: 'agent', mode: 'file', content: `${rl}\n\n${agent}` },
        { path: `.clinerules/02-${SKILL_NAME}.md`, role: 'skill', mode: 'file', content: skill },
        { path: '.clinerules/03-kyrpy-uiux-playbook.md', role: 'playbook', mode: 'file', content: pb }
      ];
    case 'agents-md':
      return [{ path: 'AGENTS.md', role: 'agent', mode: 'section', marker: SECTION_MARKER, content: `${agent}\n\n${skill}` }];
    case 'generic':
    default:
      return [
        { path: `docs/uiux/${AGENT_NAME}.md`, role: 'agent', mode: 'file', content: agent },
        { path: `docs/uiux/${SKILL_NAME}.md`, role: 'skill', mode: 'file', content: skill },
        { path: 'docs/uiux/tool-playbook.md', role: 'playbook', mode: 'file', content: pb }
      ];
  }
}

/**
 * Files of the optional "reverse-engineer" pack (its own agent + skill) for a client platform. Always whole files with
 * their own paths (agents-md gets docs/uiux/ files, not a second AGENTS.md block: pack files are tracked by path).
 */
export function reversePackFiles(platform, { agent, skill }) {
  if (!PLATFORMS.includes(platform)) throw new ValidationError(`platform must be one of ${PLATFORMS.join(', ')}`);
  const a = REVERSE_AGENT_NAME, s = REVERSE_SKILL_NAME;
  switch (platform) {
    case 'claude':
      return [
        { path: `.claude/agents/${a}.md`, role: 'reverse-agent', mode: 'file', content: frontmatter({ name: a, description: REVERSE_AGENT_DESC }) + agent },
        { path: `.claude/skills/${s}/SKILL.md`, role: 'reverse-skill', mode: 'file', content: frontmatter({ name: s, description: REVERSE_SKILL_DESC }) + skill }
      ];
    case 'antigravity':
    case 'gemini':
      return [
        { path: `.agents/agents/${a}/agent.md`, role: 'reverse-agent', mode: 'file', content: frontmatter({ name: a, description: REVERSE_AGENT_DESC, skills: [s], inheritMcp: true }) + agent },
        { path: `.agents/skills/${s}/SKILL.md`, role: 'reverse-skill', mode: 'file', content: frontmatter({ name: s, description: REVERSE_SKILL_DESC }) + skill }
      ];
    case 'vscode':
      return [
        { path: `.github/agents/${a}.agent.md`, role: 'reverse-agent', mode: 'file', content: frontmatter({ name: a, description: REVERSE_AGENT_DESC }) + agent },
        { path: `.agents/skills/${s}/SKILL.md`, role: 'reverse-skill', mode: 'file', content: frontmatter({ name: s, description: REVERSE_SKILL_DESC }) + skill }
      ];
    case 'cursor':
      return [{ path: `.cursor/rules/${a}.mdc`, role: 'reverse-agent', mode: 'file', content: `---\ndescription: ${REVERSE_SKILL_DESC}\nglobs:\nalwaysApply: false\n---\n\n${agent}\n\n${skill}` }];
    case 'windsurf':
      return [
        { path: `.windsurf/rules/${a}.md`, role: 'reverse-agent', mode: 'file', content: frontmatter({ trigger: 'model_decision', description: REVERSE_AGENT_DESC }) + agent },
        { path: `.windsurf/rules/${s}.md`, role: 'reverse-skill', mode: 'file', content: frontmatter({ trigger: 'model_decision', description: REVERSE_SKILL_DESC }) + skill }
      ];
    case 'cline':
      return [
        { path: `.clinerules/04-${a}.md`, role: 'reverse-agent', mode: 'file', content: agent },
        { path: `.clinerules/05-${s}.md`, role: 'reverse-skill', mode: 'file', content: skill }
      ];
    case 'agents-md':
    case 'generic':
    default:
      return [
        { path: `docs/uiux/${a}.md`, role: 'reverse-agent', mode: 'file', content: agent },
        { path: `docs/uiux/${s}.md`, role: 'reverse-skill', mode: 'file', content: skill }
      ];
  }
}

/** Wraps section content in start/end markers (for AGENTS.md and similar shared files). */
export const sectionBlock = (marker, content) => `<!-- ${marker}:start -->\n${content.trim()}\n<!-- ${marker}:end -->`;
