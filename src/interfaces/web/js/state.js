/** Client state + a tiny event bus. Components read `state` and react to events; they never reach into each other. */
import { createContext } from '/domain/svg.js';
import { menuConfig } from '/domain/menu.js';
import { cachedIcon, requestIconNodes } from './icon-store.js';

export const TYPE_LIST = ['path', 'icon', 'button', 'element', 'screen'];
export const ALL_ITEM_TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
export const PLURAL = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens', workflow: 'workflows' };

const screenSelSet = new Set();

export const state = {
  settings: {}, themes: [], devices: {}, counts: {}, types: {}, menuMeta: {},
  themeKey: 'liquid',
  library: { paths: [], icons: [], buttons: [], elements: [], animations: [] },
  mode: 'screen',                 // 'screen' (the designers) | 'workflow' | 'browser'
  tab: 'screen',                  // left panel tab (path | icon | button | element | screen | workflow)
  catalogSel: screenSelSet,       // multi-selected screen ids in the screen catalog
  libSel: {
    path: new Set(),
    icon: new Set(),
    button: new Set(),
    element: new Set(),
    screen: screenSelSet,
    workflow: new Set()
  },
  playAnimations: true,
  workflowId: null,
  // New project, user, collaboration, templates & sync state
  user: { id: 1, username: 'superadmin', displayName: 'Superadmin', role: 'superadmin', avatarColor: '#2e9bff' },
  publicUserId: null,             // id of the immutable `public` system user (owner of the public library), from /api/bootstrap
  projects: [],
  activeProjectId: 1,
  selectedProjectIds: new Set(),  // multi-selected project IDs in topbar dropdown (empty = activeProjectId or all)
  saveTargetProjectIds: new Set(), // multi-target project IDs selected next to "Save as…" in Designer
  // No default Private (All Projects) save target any more: the default target is the active project (see syncSaveTarget)
  get saveToUserPrivateLibrary() { return false; },
  set saveToUserPrivateLibrary(_) { /* no private target */ },
  visibilityFilter: 'all',        // 'all' | 'public' | 'private' | 'project'
  trashCount: 0,
  templateDevices: [],
  templateButtons: [],
  pendingChangesCount: 0,
  syncStatus: { enabled: true, pendingCount: 0 },
  userRoles: {},
  projectRoles: {},
  visibilityLevels: ['public', 'private', 'project'],
  eventTriggers: [],
  eventActions: [],
  toolbarPositions: ['top', 'bottom', 'left', 'right', 'center'],
  copiedStyle: null,
  copiedNode: null
};

const handlers = new Map();
export function on(evt, fn) { if (!handlers.has(evt)) handlers.set(evt, new Set()); handlers.get(evt).add(fn); return () => handlers.get(evt).delete(fn); }
export function emit(evt, data) { for (const fn of handlers.get(evt) || []) { try { fn(data); } catch (e) { console.error(`handler for ${evt} failed`, e); } } }

/* ---------- public library (immutable `public` system user) ---------- */
export const isAdminUser = (u = state.user) => !!u && (['admin', 'superadmin'].includes(u.role) || (u.permissions || []).includes('*'));
/** The single superadmin: the only user who edits the public library in place (everyone else uses Save as… / change requests). */
export const isSuperadminUser = (u = state.user) => !!u && u.role === 'superadmin';
/** True when the record belongs to the public library (owned by the `public` system user). */
export const isPublicLibraryItem = rec => !!rec && state.publicUserId != null && Number(rec.creatorId || rec.rootOwnerId || 0) === Number(state.publicUserId);
/** Save rights: the owner, or the superadmin curating a public-library item. */
export const canEditOwned = rec => {
  if (!rec) return true;
  const ownerId = Number(rec.creatorId || rec.rootOwnerId || 1);
  if (ownerId === Number(state.user?.id || 1)) return true;
  return isPublicLibraryItem(rec) && isSuperadminUser();
};
/** Display label of an owner: `@public · Public library` for the system user, `@name` otherwise. */
export const ownerLabel = (username, id = null) => (username === 'public' || (id != null && state.publicUserId != null && Number(id) === Number(state.publicUserId))
  ? '@public · Public library'
  : `@${username || 'another user'}`);

export const currentTheme = () => state.themes.find(t => t.key === state.themeKey) || state.themes[0];
export const libOf = type => state.library[PLURAL[type]];
/*
 * Items an open design refers to that are not in the loaded library (they belong to another project, or the library
 * filter hides them). Without them a placed button / element / path draws as an empty placeholder and its menu is gone
 * (seen in the workflow test window). `ensureDesignDeps` (actions.js) fills this store; renderContext and findDesign read it.
 */
const extraLib = { path: new Map(), button: new Map(), element: new Map() };
export const extraDesign = (type, id) => extraLib[type]?.get(Number(id));
export function addExtraDesign(type, rec) { if (extraLib[type] && rec?.id != null) extraLib[type].set(Number(rec.id), rec); }
export const findDesign = (type, id) => libOf(type)?.find(d => d.id === id) || extraDesign(type, id);

/**
 * Icon index of the render context. Library icons are summaries (no nodes) when the library is large: `get`
 * fills geometry from the lazy icon cache, or queues a fetch (icon-store emits `icons:loaded` when it lands).
 * Rebuilt only when the icon list changes.
 */
class LazyIconMap extends Map {
  has(id) { return super.has(id) || this.get(id) !== undefined; }
  get(id) {
    const v = super.get(id);
    if (!v) {
      // an icon outside the loaded library (another project / filtered out): served from the lazy cache
      const c = id ? cachedIcon(id) : null;
      if (!c && id) requestIconNodes([id]);
      return c || undefined;
    }
    if (!v.nodes) {
      const c = cachedIcon(id);
      if (c) v.nodes = c.nodes;
      else requestIconNodes([id]);
    }
    return v;
  }
}
let iconIndexOf = null, iconIndexMap = null;
function iconIndex() {
  if (iconIndexOf !== state.library.icons) {
    iconIndexOf = state.library.icons;
    iconIndexMap = new LazyIconMap((state.library.icons || []).map(d => [d.id, { key: d.key, width: d.width, height: d.height, nodes: d.nodes }]));
  }
  return iconIndexMap;
}

/** Render context for the domain renderer built from the cached library. `animations` overrides the cached ones. */
export function renderContext({ animations, ...extra } = {}) {
  const one = d => [d.id, { key: d.key, width: d.width, height: d.height, nodes: d.nodes, ...(d.photo ? { photo: d.photo } : {}) }];
  const btn = d => ({ ...one(d)[1], menu: d.menuItems?.length ? { cfg: menuConfig(d.meta), items: d.menuItems.map(m => ({ ...m, targetKey: findDesign('screen', m.targetScreenId)?.key || '', targetElementKey: findDesign('element', m.targetElementId)?.key || '' })) } : null });
  const lib = {
    path: new Map(state.library.paths.map(one)),
    icon: iconIndex(),
    element: new Map(state.library.elements.map(one)),
    button: new Map(state.library.buttons.map(d => [d.id, btn(d)]))
  };
  for (const t of ['path', 'element', 'button']) for (const [id, d] of extraLib[t]) if (!lib[t].has(id)) lib[t].set(id, t === 'button' ? btn(d) : one(d)[1]);
  return createContext({ theme: currentTheme(), lib, animations: state.playAnimations ? (animations ?? state.library.animations) : [], ...extra });
}

/** Display name of a project; never "undefined" (falls back to label, then the id). */
export const projectLabel = p => (p && (p.name || p.label)) || `Project #${p?.id ?? '?'}`;

/** Drops duplicate rows (same id), keeping the first occurrence. */
export const uniqueById = rows => [...new Map((rows || []).filter(Boolean).map(r => [r.id, r])).values()];

// a saved item that lives in the extra store keeps its copy current
on('item:saved', ({ type, doc } = {}) => { if (doc && extraLib[type]?.has(Number(doc.id))) extraLib[type].set(Number(doc.id), doc); });
