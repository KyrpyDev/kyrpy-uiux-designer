import { ForbiddenError } from '../domain/errors.js';

const ADMIN_ROLES = new Set(['admin', 'superadmin']);
const EDIT_ROLES = new Set(['owner', 'admin', 'editor', 'contributor']);

/**
 * Who may read / edit a library item (design or workflow).
 * - no actor: an internal caller (import, MCP changeset, tests) — allowed
 * - admins and the creator: everything
 * - `private`: the creator only
 * - `project`: accepted project members (viewers read only)
 * - `public`: everyone reads; edits are applied and recorded as a change request for the owner (CollaborationService)
 * @param {{creatorId?:number, visibility?:string, projectId?:number}} doc
 * @param {{id:number, role:string}|null} actor
 * @param {{userRole:(projectId:number, user:object)=>string|null}|null} projects
 */
export function itemAccess(doc, actor, projects = null) {
  if (!actor || ADMIN_ROLES.has(actor.role) || Number(doc.creatorId) === Number(actor.id)) return { read: true, edit: true };
  const visibility = doc.visibility || 'public';
  if (visibility === 'public') return { read: true, edit: true };
  if (visibility === 'private') return { read: false, edit: false };
  if (!projects?.userRole) return { read: true, edit: true };
  const role = projects.userRole(doc.projectId ?? 1, actor);
  return { read: role != null, edit: EDIT_ROLES.has(role) };
}

export function assertItemAccess(doc, actor, projects, mode = 'edit', label = 'item') {
  if (itemAccess(doc, actor, projects)[mode]) return;
  throw new ForbiddenError(mode === 'read'
    ? `This ${label} is private to its owner or project`
    : `Only the owner or an editor of its project can change this ${label}`);
}
