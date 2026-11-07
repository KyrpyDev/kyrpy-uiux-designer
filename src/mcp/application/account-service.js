/**
 * Account (user-wide) API keys: project resolution and the clone → build → push-as-new-project workflow.
 *
 * An account principal carries no project. Every project-bound tool call names one (`project`: key or id)
 * and is checked here before the tool runs with a project-bound principal:
 *   read            → projects the user can see (owned, accepted member, public; as in the designer UI)
 *   request/propose → projects the user OWNS (never someone else's project, admin or not)
 *   create          → new projects, always owned by the key's user, private by default
 * Unknown and invisible projects both answer NOT_FOUND, so a key cannot probe for private project keys.
 */
import { DomainError, NotFoundError, ForbiddenError, ValidationError } from '../../domain/errors.js';
import { isSystemUser } from '../../domain/system-users.js';

const NEEDS_OWNER = new Set(['request', 'propose']);

export class AccountService {
  /**
   * @param {{ projects, projectService, users, auth, limiter?, now? }} d
   *   projects: core ProjectRepository · projectService: core ProjectService (list / create / clone)
   */
  constructor(d) { Object.assign(this, { now: () => new Date() }, d); }

  #user(principal) {
    const u = this.users.get(Number(principal?.user?.id));
    if (!u || u.status !== 'active' || isSystemUser(u)) throw new DomainError('the key owner is not an active user', 'UNAUTHORIZED', 401);
    return u;
  }

  #role(p, user) {
    if (Number(p.ownerId) === Number(user.id)) return 'owner';
    const m = this.projects.getMember?.(p.id, user.id);
    if (m && m.status === 'accepted') return m.role || 'member';
    if (p.visibility === 'public') return 'public';
    if (this.auth.isAdmin(user)) return 'admin';
    return null;
  }

  /** Projects the key's user can see, newest first, with what the key may do on each. */
  listProjects(principal, { query = '', owned = false, limit = 100 } = {}) {
    const user = this.#user(principal);
    const q = String(query || '').trim().toLowerCase();
    const rows = this.projectService.list({ user })
      .map(p => ({ p, role: this.#role(p, user) }))
      .filter(({ p, role }) => role && (!owned || role === 'owner')
        && (!q || `${p.key} ${p.name} ${p.description || ''}`.toLowerCase().includes(q)))
      .sort((a, b) => String(b.p.updatedAt || b.p.createdAt || '').localeCompare(String(a.p.updatedAt || a.p.createdAt || '')) || b.p.id - a.p.id);
    const projects = rows.slice(0, Math.min(Math.max(1, Number(limit) || 100), 500)).map(({ p, role }) => ({
      key: p.key, name: p.name, description: p.description || '', visibility: p.visibility, role,
      owner: p.owner?.username || null, updatedAt: p.updatedAt || p.createdAt || null,
      canClone: true, canPropose: role === 'owner', canRequest: role === 'owner'
    }));
    return { total: rows.length, returned: projects.length, projects };
  }

  /**
   * The project of one call, checked for the scope the tool needs. Returns `{ id, key, name }`.
   * @param {'read'|'request'|'propose'|'create'} need
   */
  resolve(principal, ref, need = 'read') {
    const user = this.#user(principal);
    if (ref === undefined || ref === null || String(ref).trim() === '') {
      throw new ValidationError('this is an account key: pass "project" (a project key from uiux_list_projects)');
    }
    const raw = String(ref).trim();
    const p = /^\d+$/.test(raw) ? this.projects.get(Number(raw)) : (this.projects.getByKey?.(raw) || this.projects.list().find(x => x.key === raw));
    const role = p ? this.#role(p, user) : null;
    if (!p || !role) throw new NotFoundError('project', raw);
    if (NEEDS_OWNER.has(need) && role !== 'owner') {
      const e = new ForbiddenError(`"${p.key}" is not your project: an account key can ${need} only on projects you own. Clone it into a new project with uiux_create_project { fromProject: "${p.key}" }.`);
      e.code = 'SCOPE_DENIED';
      throw e;
    }
    return { id: p.id, key: p.key, name: p.name, role };
  }

  /** Principal bound to one project for the duration of a tool call. */
  bind(principal, project) { return { ...principal, project: { id: project.id, key: project.key, name: project.name }, accountRole: project.role }; }

  /**
   * Creates a project owned by the key's user. With `fromProject`, the new project starts as a full copy
   * of that design (items and their sub-items are copied into the new project's private library).
   */
  createProject(principal, { name, key, description = '', fromProject, visibility = 'private' } = {}) {
    const user = this.#user(principal);
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new ValidationError('name is required');
    if (!['private', 'public'].includes(visibility)) throw new ValidationError('visibility must be private or public');
    const rl = this.limiter?.hit('projects', principal.apiKeyId);
    if (rl && !rl.ok) throw Object.assign(new DomainError(`project limit reached; retry in ${rl.retryAfterSec}s`, 'RATE_LIMITED', 429), { retryAfterSec: rl.retryAfterSec });
    const input = { name: cleanName, ...(key ? { key: String(key).trim() } : {}), description: String(description).slice(0, 2000), visibility };
    let created, source = null, copied = 0;
    if (fromProject !== undefined && fromProject !== null && fromProject !== '') {
      source = this.resolve(principal, fromProject, 'read');
      const res = this.projectService.clone(source.id, input, user);
      created = res.project || res;
      copied = res.copiedCount || 0;
    } else {
      created = this.projectService.create(input, user);
    }
    const p = this.projects.get(created.id);
    return {
      project: { key: p.key, name: p.name, visibility: p.visibility, owner: user.username },
      source: source ? { key: source.key, name: source.name } : null,
      copiedItems: copied,
      next: [
        `Point the repository at the new project: set "project": "${p.key}" in .uiux/config.json (keep the clone as "origin").`,
        `Push what the app added or changed: uiux_begin_changeset { project: "${p.key}" } → uiux_stage_item … → uiux_submit_changeset.`,
        'The owner reviews and approves the changeset in the designer (Collaborate → Versions & AI Changesets).'
      ]
    };
  }
}
