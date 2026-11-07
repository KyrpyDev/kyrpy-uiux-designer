import { markEdited } from './edited.js';
/**
 * HTTP client for the designer API with:
 *  - Session token & active user/project headers (`Authorization: Bearer`, `x-user-id`, `x-project-id`)
 *  - Offline-first browser `localStorage` read cache & mutation outbox replay
 *  - Full endpoints for Auth, User/ACL management, Projects, Collaborators, Change Requests,
 *    Lineage, Editable Templates (Devices & Buttons), Translations, and PostgreSQL Sync.
 */
/**
 * Hook run before every design write (create / edit / delete of paths, icons, buttons, elements, screens,
 * workflows; clone and copy stay free). It may await a dialog and throws an ApiError to cancel the request.
 * main.js uses it to make a user without a project of their own create one before the first edit.
 */
let writeGuard = null;
export function setWriteGuard(fn) { writeGuard = typeof fn === 'function' ? fn : null; }
const DESIGN_WRITE = /^\/api\/(paths|icons|buttons|elements|screens|workflows)(\/|\?|$)/;
const DESIGN_FREE = /\/(clone|copy|move|export|import|usage|lineage)(\/|\?|$)/;

export class ApiError extends Error {
  constructor(message, info, status = 0) {
    super(message);
    this.info = info;
    this.status = status;
  }
}

/**
 * Human-readable message for a failed response. A proxy answers 502/503/504 with no JSON body while the
 * server is restarting or down; say so instead of showing a bare "Bad Gateway".
 */
export function httpErrorMessage(r, data) {
  if (data?.error?.message) return data.error.message;
  if ([502, 503, 504].includes(r.status)) return `The designer server is not reachable right now (HTTP ${r.status}); it may be restarting. Try again in a few seconds.`;
  return r.statusText || `HTTP ${r.status}`;
}

const STORAGE_TOKEN = 'ud_auth_token';
const STORAGE_USER_ID = 'ud_user_id';
const STORAGE_PROJECT_ID = 'ud_active_project_id';
const STORAGE_CACHE_PREFIX = 'ud_cache_v2:';
const STORAGE_OUTBOX = 'ud_offline_outbox_v2';

function safeStorageGet(key) {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeStorageSet(key, val) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (val === null || val === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {
    // quota or storage disabled
  }
}

// read-cache key of a GET: the icon version a client echoes back (`iconsSince`) does not change what the response
// means, so it is left out (one entry per library query instead of one per icon version)
export function cacheKeyFor(url) {
  return STORAGE_CACHE_PREFIX + String(url).replace(/([?&])iconsSince=[^&]*(&|$)/, (m, a, b) => (b ? a : '')).replace(/[?&]$/, '');
}

// drop entries written under the old per-version keys
(function pruneVersionedLibraryCache() {
  try {
    if (typeof localStorage === 'undefined') return;
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_CACHE_PREFIX) && k.includes('iconsSince=')) stale.push(k);
    }
    stale.forEach(k => localStorage.removeItem(k));
  } catch {
    // storage disabled
  }
})();

export function getAuthSession() {
  return {
    token: safeStorageGet(STORAGE_TOKEN),
    userId: Number(safeStorageGet(STORAGE_USER_ID)) || 1,
    projectId: Number(safeStorageGet(STORAGE_PROJECT_ID)) || 1
  };
}

export function setAuthSession({ token, userId, projectId } = {}) {
  if (token !== undefined) safeStorageSet(STORAGE_TOKEN, token || null);
  if (userId !== undefined) safeStorageSet(STORAGE_USER_ID, userId ? String(userId) : '1');
  if (projectId !== undefined) safeStorageSet(STORAGE_PROJECT_ID, projectId ? String(projectId) : '1');
}

export function getOfflineOutbox() {
  try {
    const raw = safeStorageGet(STORAGE_OUTBOX);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveOfflineOutbox(items) {
  safeStorageSet(STORAGE_OUTBOX, JSON.stringify(items.slice(-200)));
}

async function req(method, url, body) {
  const { token, userId, projectId } = getAuthSession();
  const headers = {
    'x-user-id': String(userId || 1),
    'x-project-id': String(projectId || 1)
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  if (writeGuard && method !== 'GET' && DESIGN_WRITE.test(url) && !DESIGN_FREE.test(url)) await writeGuard({ method, url, body });
  try {
    let r = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (r.status === 401 && token && !url.startsWith('/api/auth/login')) {
      setAuthSession({ token: '' });
      const retryHeaders = { ...headers };
      delete retryHeaders.authorization;
      r = await fetch(url, {
        method,
        headers: retryHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new ApiError(httpErrorMessage(r, data), data?.error, r.status);

    // an `icons: null` answer ("your list is current") must not replace the cached full list
    if (method === 'GET' && ct.includes('json') && !(data && data.iconSummary && data.icons === null)) {
      safeStorageSet(cacheKeyFor(url), JSON.stringify(data));
    }
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Network / offline fallback
    if (method === 'GET') {
      const cached = safeStorageGet(cacheKeyFor(url));
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          // ignore
        }
      }
    } else if (!url.startsWith('/api/auth/')) {
      // never queue sign-in / profile / password requests: they would sit in localStorage in plain text
      const box = getOfflineOutbox();
      box.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), method, url, body, queuedAt: new Date().toISOString() });
      saveOfflineOutbox(box);
    }
    throw err;
  }
}

const PLURAL = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens' };

/** GET without the offline localStorage cache (icon catalog pages, sprites). `text` returns the body as text. */
async function iconGet(url, text = false) {
  const { token, userId, projectId } = getAuthSession();
  const headers = { 'x-user-id': String(userId || 1), 'x-project-id': String(projectId || 1) };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(url, { headers });
  if (!r.ok) {
    const data = await r.json().catch(() => null);
    throw new ApiError(httpErrorMessage(r, data), data?.error, r.status);
  }
  return text ? r.text() : r.json();
}

export const api = {
  get: u => req('GET', u),
  post: (u, b = {}) => req('POST', u, b),
  put: (u, b = {}) => req('PUT', u, b),
  patch: (u, b = {}) => req('PATCH', u, b),
  del: u => req('DELETE', u),

  getSession: getAuthSession,
  setSession: setAuthSession,
  outbox: getOfflineOutbox,
  flushOutbox: async () => {
    const queue = getOfflineOutbox();
    if (!queue.length) return { flushed: 0, remaining: 0 };
    const remaining = [];
    let flushed = 0;
    for (const item of queue) {
      try {
        await req(item.method, item.url, item.body);
        flushed++;
      } catch {
        remaining.push(item);
      }
    }
    saveOfflineOutbox(remaining);
    return { flushed, remaining: remaining.length };
  },

  bootstrap: () => api.get('/api/bootstrap'),
  library: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.projectId) qs.set('projectId', String(params.projectId));
    if (params.projectIds && params.projectIds.length) qs.set('projectIds', Array.isArray(params.projectIds) ? params.projectIds.join(',') : String(params.projectIds));
    if (params.visibility) qs.set('visibility', params.visibility);
    if (params.includePublic !== undefined) qs.set('includePublic', params.includePublic ? '1' : '0');
    if (params.iconSummary) qs.set('iconSummary', '1');
    if (params.iconsSince) qs.set('iconsSince', String(params.iconsSince));
    const s = qs.toString();
    return api.get(`/api/library${s ? `?${s}` : ''}`);
  },
  /* icon catalog (large libraries): uncached GETs so thousands of icon pages never land in localStorage */
  iconSearch: (params = {}) => iconGet(`/api/icons/search?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''))}`),
  iconsFull: ids => iconGet(`/api/icons/full?ids=${ids.join(',')}`),
  iconSprite: (ids, theme) => iconGet(`/api/icons/sprite?${new URLSearchParams({ ids: ids.join(','), ...(theme ? { theme } : {}) })}`, true),
  settings: patch => api.put('/api/settings', patch),

  list: (type, q = '', opts = {}) => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (opts.projectId) qs.set('projectId', String(opts.projectId));
    if (opts.projectIds && opts.projectIds.length) qs.set('projectIds', Array.isArray(opts.projectIds) ? opts.projectIds.join(',') : String(opts.projectIds));
    if (opts.visibility) qs.set('visibility', opts.visibility);
    if (opts.includePublic !== undefined) qs.set('includePublic', opts.includePublic ? '1' : '0');
    const s = qs.toString();
    return api.get(`/api/${PLURAL[type]}${s ? `?${s}` : ''}`);
  },
  getDesign: (type, id) => api.get(`/api/${PLURAL[type]}/${id}`),
  getLineage: (type, id) => api.get(type === 'workflow' ? `/api/workflows/${id}/lineage` : `/api/${PLURAL[type]}/${id}/lineage`),
  createDesign: (type, body) => api.post(`/api/${PLURAL[type]}`, body),
  updateDesign: (type, id, body) => api.put(`/api/${PLURAL[type]}/${id}`, body).then(r => { markEdited(type, id); return r; }),
  /** Display order in the library: mode = front | back | forward | backward. */
  reorderDesign: (type, id, mode) => api.post(`/api/${PLURAL[type]}/${id}/order`, { mode }),
  deleteDesign: (type, id) => api.del(`/api/${PLURAL[type]}/${id}`),
  cloneDesign: (type, id, nameOrBody) =>
    api.post(
      `/api/${PLURAL[type]}/${id}/clone`,
      typeof nameOrBody === 'string' ? { name: nameOrBody } : nameOrBody || {}
    ),
  restoreDesign: (type, id, snap) => api.post(`/api/${PLURAL[type]}/${id}/restore`, snap),
  restoreWorkflow: (id, snap) => api.post(`/api/workflows/${id}/restore`, snap),
  replaceNodes: (type, id, nodes) => api.put(`/api/${PLURAL[type]}/${id}/nodes`, { nodes }).then(r => { markEdited(type, id); return r; }),
  addNode: (type, id, el) => api.post(`/api/${PLURAL[type]}/${id}/nodes`, el).then(r => { markEdited(type, id); return r; }),
  patchNode: (type, id, eid, patch) => api.patch(`/api/${PLURAL[type]}/${id}/nodes/${eid}`, patch).then(r => { markEdited(type, id); return r; }),
  deleteNode: (type, id, eid) => api.del(`/api/${PLURAL[type]}/${id}/nodes/${eid}`).then(r => { markEdited(type, id); return r; }),
  duplicateNode: (type, id, eid) => api.post(`/api/${PLURAL[type]}/${id}/nodes/${eid}/duplicate`, {}).then(r => { markEdited(type, id); return r; }),
  addAnimation: (type, id, eid, a) => api.post(`/api/${PLURAL[type]}/${id}/nodes/${eid}/animations`, a).then(r => { markEdited(type, id); return r; }),
  updateAnimation: (type, id, aid, a) => api.put(`/api/${PLURAL[type]}/${id}/animations/${aid}`, a).then(r => { markEdited(type, id); return r; }),
  deleteAnimation: (type, id, aid) => api.del(`/api/${PLURAL[type]}/${id}/animations/${aid}`).then(r => { markEdited(type, id); return r; }),
  svgUrl: (type, id, params = {}) => `/api/${PLURAL[type]}/${id}/svg?${new URLSearchParams(params)}`,
  importSvg: body => api.post('/api/import/svg', body),
  importFolders: () => api.get('/api/import/folders'),
  importFolder: body => api.post('/api/import/folder', body),
  importFont: body => api.post('/api/import/font', body),

  // button menus (popup / rotating): nested items + settings
  menu: id => api.get(`/api/buttons/${id}/menu`),
  menuConfig: (id, cfg) => api.put(`/api/buttons/${id}/menu/config`, cfg),
  addMenuItem: (id, item) => api.post(`/api/buttons/${id}/menu/items`, item).then(r => { markEdited('button', id); return r; }),
  updateMenuItem: (id, iid, patch) => api.put(`/api/buttons/${id}/menu/items/${iid}`, patch).then(r => { markEdited('button', id); return r; }),
  deleteMenuItem: (id, iid) => api.del(`/api/buttons/${id}/menu/items/${iid}`).then(r => { markEdited('button', id); return r; }),

  themes: () => api.get('/api/themes'),
  saveTheme: (id, body) => api.put(`/api/themes/${id}`, body),
  createTheme: body => api.post('/api/themes', body),
  cloneTheme: (id, name) => api.post(`/api/themes/${id}/clone`, { name }),
  deleteTheme: id => api.del(`/api/themes/${id}`),

  workflows: (opts = {}) => {
    const qs = new URLSearchParams();
    if (opts.q) qs.set('q', opts.q);
    if (opts.projectId) qs.set('projectId', String(opts.projectId));
    if (opts.projectIds && opts.projectIds.length) qs.set('projectIds', Array.isArray(opts.projectIds) ? opts.projectIds.join(',') : String(opts.projectIds));
    if (opts.visibility) qs.set('visibility', opts.visibility);
    if (opts.includePublic !== undefined) qs.set('includePublic', opts.includePublic ? '1' : '0');
    const s = qs.toString();
    return api.get(`/api/workflows${s ? `?${s}` : ''}`);
  },
  workflow: id => api.get(`/api/workflows/${id}`),
  createWorkflow: b => api.post('/api/workflows', b),
  updateWorkflow: (id, b) => api.put(`/api/workflows/${id}`, b),
  deleteWorkflow: id => api.del(`/api/workflows/${id}`),
  cloneWorkflow: (id, nameOrBody) =>
    api.post(`/api/workflows/${id}/clone`, typeof nameOrBody === 'string' ? { name: nameOrBody } : nameOrBody || {}),
  placeScreen: (id, b) => api.put(`/api/workflows/${id}/screens`, b),
  removeWfScreen: (id, sid) => api.del(`/api/workflows/${id}/screens/${sid}`),
  addLink: (id, b) => api.post(`/api/workflows/${id}/links`, b),
  updateLink: (id, lid, b) => api.put(`/api/workflows/${id}/links/${lid}`, b),
  deleteLink: (id, lid) => api.del(`/api/workflows/${id}/links/${lid}`),

  exportBundle: b => api.post('/api/export/bundle', b),
  exportFolder: b => api.post('/api/export/folder', b),

  // ---- Auth & Users ----
  authConfig: () => api.get('/api/auth/config'),
  devBypassLogin: () => api.post('/api/auth/dev-bypass', {}),
  login: body => api.post('/api/auth/login', body),
  register: body => api.post('/api/auth/register', body),
  logout: () => api.post('/api/auth/logout', {}),
  me: () => api.get('/api/auth/me'),
  profile: () => api.get('/api/auth/profile'),
  updateProfile: body => api.put('/api/auth/profile', body),
  changePassword: body => api.post('/api/auth/profile/password', body),
  profileSessions: () => api.get('/api/auth/profile/sessions'),
  revokeSession: sid => api.del(`/api/auth/profile/sessions/${encodeURIComponent(sid)}`),
  revokeOtherSessions: () => api.post('/api/auth/profile/sessions/revoke-others', {}),
  users: () => api.get('/api/users'),
  createUser: body => api.post('/api/users', body),
  updateUser: (id, body) => api.put(`/api/users/${id}`, body),
  deleteUser: id => api.del(`/api/users/${id}`),
  transferSuperadmin: (id, body) => api.post(`/api/users/${id}/transfer-superadmin`, body),
  aclMatrix: () => api.get('/api/acl/matrix'),

  // ---- Projects & Collaborators ----
  projects: (q = '') => api.get(`/api/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  project: id => api.get(`/api/projects/${id}`),
  createProject: body => api.post('/api/projects', body),
  updateProject: (id, body) => api.put(`/api/projects/${id}`, body),
  saveProject: (id, body = {}) => api.post(`/api/projects/${id}/save`, body),
  cloneProject: (id, body = {}) => api.post(`/api/projects/${id}/clone`, body),
  projectButtonSettings: id => api.get(`/api/projects/${id}/button-settings`),
  applyProjectButtonSettings: (id, body = {}) => api.post(`/api/projects/${id}/button-settings`, body),
  deleteProject: id => api.del(`/api/projects/${id}`),
  setProjectItemsVisibility: (id, visibility) => api.post(`/api/projects/${id}/visibility`, { visibility }),
  inviteProjectMember: (id, body) => api.post(`/api/projects/${id}/members`, body),
  updateProjectMember: (id, uid, role) => api.put(`/api/projects/${id}/members/${uid}`, { role }),
  removeProjectMember: (id, uid) => api.del(`/api/projects/${id}/members/${uid}`),

  // ---- Collaborative Change List (Approve / Reject) ----
  changes: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api.get(`/api/changes${s ? `?${s}` : ''}`);
  },
  change: id => api.get(`/api/changes/${id}`),
  createChange: body => api.post('/api/changes', body),
  approveChange: (id, comment = '') => api.post(`/api/changes/${id}/approve`, { comment }),
  rejectChange: (id, comment = '') => api.post(`/api/changes/${id}/reject`, { comment }),
  changeCounts: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api.get(`/api/changes/counts${s ? `?${s}` : ''}`);
  },
  /** body: { ids, action: 'approve'|'reject', comment } or { filter: { targetType, authorId, q }, action } */
  bulkReviewChanges: body => api.post('/api/changes/bulk', body),

  // ---- Editable Templates (Devices & Buttons) ----
  templateDevices: (projectId = null) =>
    api.get(`/api/templates/devices${projectId ? `?projectId=${projectId}` : ''}`),
  saveTemplateDevice: body => (body.id ? api.put(`/api/templates/devices/${body.id}`, body) : api.post('/api/templates/devices', body)),
  deleteTemplateDevice: id => api.del(`/api/templates/devices/${id}`),

  templateButtons: (projectId = null) =>
    api.get(`/api/templates/buttons${projectId ? `?projectId=${projectId}` : ''}`),
  saveTemplateButton: body => (body.id ? api.put(`/api/templates/buttons/${body.id}`, body) : api.post('/api/templates/buttons', body)),
  deleteTemplateButton: id => api.del(`/api/templates/buttons/${id}`),
  instantiateTemplateButton: (id, body = {}) => api.post(`/api/templates/buttons/${id}/instantiate`, body),

  // ---- Translations ----
  translations: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api.get(`/api/translations${s ? `?${s}` : ''}`);
  },
  saveTranslation: body => api.post('/api/translations', body),
  deleteTranslation: id => api.del(`/api/translations/${id}`),
  languages: () => api.get('/api/translations/languages'),

  // ---- PostgreSQL Sync ----
  syncStatus: () => api.get('/api/sync/status'),
  syncNow: (body = {}) => api.post('/api/sync/now', body),
  syncPush: (body = {}) => api.post('/api/sync/push', body),
  syncPull: () => api.post('/api/sync/pull', {}),

  // ---- Trash Management ----
  trashList: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api.get(`/api/trash${s ? `?${s}` : ''}`);
  },
  trashRestore: id => api.post(`/api/trash/${id}/restore`, {}),
  trashPurge: id => api.del(`/api/trash/${id}`),
  trashEmpty: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    return api.del(`/api/trash${s ? `?${s}` : ''}`);
  },

  // ---- Copy / Move / Multi-Target Save to Projects & Empty Private Library ----
  copyToProjects: body => api.post('/api/library/copy-to-projects', body),
  moveToProjects: body => api.post('/api/library/move-to-projects', body),
  saveToTargets: body => api.post('/api/library/save-to-targets', body),
  emptyProjectLibrary: (projectId, body = {}) =>
    projectId
      ? api.post(`/api/projects/${projectId}/empty-library`, body)
      : api.post('/api/library/empty', body),
  exportLibraryItems: body => api.post('/api/library/export-items', body),
  importLibraryItems: body => api.post('/api/library/import-items', body)
};
