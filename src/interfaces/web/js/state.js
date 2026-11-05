/** Client state + a tiny event bus. Components read `state` and react to events; they never reach into each other. */
import { createContext } from '/domain/svg.js';
import { menuConfig } from '/domain/menu.js';

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
  user: { id: 1, username: 'kyrpy', displayName: 'Kyrpy (Admin)', role: 'admin', avatarColor: '#2e9bff' },
  projects: [],
  activeProjectId: 1,
  selectedProjectIds: new Set(),  // multi-selected project IDs in topbar dropdown (empty = activeProjectId or all)
  saveTargetProjectIds: new Set(), // multi-target project IDs selected next to "Save as…" in Designer
  saveToUserPrivateLibrary: false, // whether Save / Save as… also saves to user's Global Private Library
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

export const currentTheme = () => state.themes.find(t => t.key === state.themeKey) || state.themes[0];
export const libOf = type => state.library[PLURAL[type]];
export const findDesign = (type, id) => libOf(type)?.find(d => d.id === id);

/** Render context for the domain renderer built from the cached library. `animations` overrides the cached ones. */
export function renderContext({ animations, ...extra } = {}) {
  const one = d => [d.id, { key: d.key, width: d.width, height: d.height, nodes: d.nodes }];
  const lib = {
    path: new Map(state.library.paths.map(one)),
    icon: new Map(state.library.icons.map(one)),
    element: new Map(state.library.elements.map(one)),
    button: new Map(state.library.buttons.map(d => [d.id, { ...one(d)[1], menu: d.menuItems?.length ? { cfg: menuConfig(d.meta), items: d.menuItems.map(m => ({ ...m, targetKey: findDesign('screen', m.targetScreenId)?.key || '', targetElementKey: findDesign('element', m.targetElementId)?.key || '' })) } : null }]))
  };
  return createContext({ theme: currentTheme(), lib, animations: state.playAnimations ? (animations ?? state.library.animations) : [], ...extra });
}
