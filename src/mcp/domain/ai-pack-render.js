/**
 * AI pack rendering (pure): a minimal template engine and the per-platform file layout.
 *
 * Template syntax:
 *   {{name}}                     value of vars[name]; UNKNOWN names are left untouched (so design tokens
 *                                like {{accent}} can be written literally in templates)
 *   {{#if name}}…{{/if}}         kept when vars[name] is truthy (non-empty for arrays)
 *   {{#each name}}…{{this}}…{{/each}}   repeated for every element of the array vars[name]
 */
import { AGENT_NAME, SKILL_NAME, PLATFORMS } from './ai-pack-templates.js';
import { ValidationError } from '../../domain/errors.js';

export const SECTION_MARKER = 'kyrpy-uiux';

const truthy = v => (Array.isArray(v) ? v.length > 0 : Boolean(v));

export function renderTemplate(template, vars) {
  let out = String(template);
  out = out.replace(/\{\{#each ([a-zA-Z]\w*)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, name, body) =>
    (Array.isArray(vars[name]) ? vars[name] : []).map(item => body.replace(/\{\{this\}\}/g, String(item))).join(''));
  out = out.replace(/\{\{#if ([a-zA-Z]\w*)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, name, body) => (truthy(vars[name]) ? body : ''));
  out = out.replace(/\{\{([a-zA-Z]\w*)\}\}/g, (m, name) => (Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name] ?? '') : m));
  return out;
}

const frontmatter = fields => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${typeof v === 'string' ? JSON.stringify(v) : v}`).join('\n')}\n---\n\n`;

const AGENT_DESC = 'UI/UX designer for this app: pulls the Kyrpy UI/UX Designer design system (tokens, icons, buttons, elements, screens, workflows) into the repo, finds existing items before anything new is made, and proposes new or changed items back for review.';
const SKILL_DESC = 'Design sync with Kyrpy UI/UX Designer over MCP (kyrpy-uiux): pull/convert design updates, find-before-make, design standards, and safety rules. Use for any UI asset, icon, token, theme or screen work.';

/**
 * Lays rendered bodies out as files for a client platform.
 * @returns {{path: string, content: string, mode: 'file'|'section', marker?: string}[]}
 */
export function platformFiles(platform, { agent, skill }) {
  if (!PLATFORMS.includes(platform)) throw new ValidationError(`platform must be one of ${PLATFORMS.join(', ')}`);
  switch (platform) {
    case 'claude':
      return [
        { path: `.claude/agents/${AGENT_NAME}.md`, mode: 'file', content: frontmatter({ name: AGENT_NAME, description: AGENT_DESC }) + agent },
        { path: `.claude/skills/${SKILL_NAME}/SKILL.md`, mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill }
      ];
    case 'antigravity':
      return [
        { path: `.agents/agents/${AGENT_NAME}/agent.md`, mode: 'file', content: frontmatter({ name: AGENT_NAME, description: AGENT_DESC }) + agent },
        { path: `.agents/skills/${SKILL_NAME}/SKILL.md`, mode: 'file', content: frontmatter({ name: SKILL_NAME, description: SKILL_DESC }) + skill }
      ];
    case 'cursor':
      return [{ path: `.cursor/rules/${AGENT_NAME}.mdc`, mode: 'file', content: `---\ndescription: ${SKILL_DESC}\nglobs:\nalwaysApply: false\n---\n\n${agent}\n\n${skill}` }];
    case 'agents-md':
      return [{ path: 'AGENTS.md', mode: 'section', marker: SECTION_MARKER, content: `${agent}\n\n${skill}` }];
    case 'generic':
    default:
      return [
        { path: `docs/uiux/${AGENT_NAME}.md`, mode: 'file', content: agent },
        { path: `docs/uiux/${SKILL_NAME}.md`, mode: 'file', content: skill }
      ];
  }
}

/** Wraps section content in start/end markers (for AGENTS.md and similar shared files). */
export const sectionBlock = (marker, content) => `<!-- ${marker}:start -->\n${content.trim()}\n<!-- ${marker}:end -->`;
