/**
 * Press & slide ("joystick") buttons. A button with `meta.pressSlide.on` reacts to a press held for `holdMs` (1 s by default)
 * followed by a slide up / down / left / right: each direction runs its own action, and the button moves a little towards
 * the slide. Every enabled direction draws its public path (press-and-slide-u / -d / -l / -r) over the button's icon.
 *
 * meta.pressSlide = { on: boolean, holdMs: number, u|d|l|r: { on: boolean, action: string } }
 * Pure and isomorphic: used by the renderer (overlay + data attributes), the inspector and the tests.
 */

export const PRESS_SLIDE_DIRS = ['u', 'd', 'l', 'r'];
export const PRESS_SLIDE_DIR_LABELS = { u: 'Up', d: 'Down', l: 'Left', r: 'Right' };
/** [value, label] of every action a direction can run. */
export const PRESS_SLIDE_ACTIONS = [
  ['scroll-up', 'Scroll up'],
  ['scroll-down', 'Scroll down'],
  ['scroll-left', 'Scroll left'],
  ['scroll-right', 'Scroll right'],
  ['back', 'Back'],
  ['enter', 'Enter the item'],
  ['click', 'Press the button'],
  ['none', 'Nothing']
];
export const PRESS_SLIDE_DEFAULT_ACTIONS = { u: 'scroll-up', d: 'scroll-down', l: 'back', r: 'enter' };
/** The public library paths drawn over the icon, one per enabled direction. */
export const PRESS_SLIDE_PATH_KEYS = { u: 'press-and-slide-u', d: 'press-and-slide-d', l: 'press-and-slide-l', r: 'press-and-slide-r' };
export const PRESS_SLIDE_HOLD_MS = 1000;
/** Other keys / names the direction paths may carry (a renamed path still draws): first match wins. */
export const PRESS_SLIDE_PATH_ALIASES = {
  u: ['press-and-slide-u', 'press-and-slide-up', 'press-and-slide-indicator-u', 'press-and-slide-indicator-up'],
  d: ['press-and-slide-d', 'press-and-slide-down', 'press-and-slide-indicator-d', 'press-and-slide-indicator-down'],
  l: ['press-and-slide-l', 'press-and-slide-left', 'press-and-slide-indicator-l', 'press-and-slide-indicator-left'],
  r: ['press-and-slide-r', 'press-and-slide-right', 'press-and-slide-indicator-r', 'press-and-slide-indicator-right']
};
const DIR_NAME = { u: 'u', d: 'd', l: 'l', r: 'r' };
/** The direction's path among `paths` (records with key / name): by key alias, else by the name "Press and Slide U" etc. */
export function findPressSlidePath(paths, dir) {
  const list = Array.from(paths || []).filter(Boolean);
  for (const k of PRESS_SLIDE_PATH_ALIASES[dir] || []) { const hit = list.find(p => p.key === k); if (hit) return hit; }
  const want = `press and slide ${DIR_NAME[dir]}`;
  return list.find(p => String(p.name || '').trim().toLowerCase() === want) || null;
}

const ACTION_SET = new Set(PRESS_SLIDE_ACTIONS.map(a => a[0]));

/**
 * The normalised press & slide settings of a button (defaults filled in), or null when the button has none.
 * `{ all: true }` returns the settings even when switched off (for the inspector).
 */
export function pressSlideConfig(meta, { all = false } = {}) {
  const raw = meta && typeof meta === 'object' ? meta.pressSlide : null;
  if (!raw || typeof raw !== 'object') return all ? defaultPressSlide(false) : null;
  const on = raw.on === true || raw.on === 1 || raw.on === '1';
  if (!on && !all) return null;
  const hold = Number(raw.holdMs);
  const out = { on, holdMs: Number.isFinite(hold) && hold >= 0 ? Math.min(5000, Math.round(hold)) : PRESS_SLIDE_HOLD_MS };
  for (const k of PRESS_SLIDE_DIRS) {
    const d = raw[k] && typeof raw[k] === 'object' ? raw[k] : {};
    out[k] = { on: d.on === undefined ? true : !!d.on, action: ACTION_SET.has(d.action) ? d.action : PRESS_SLIDE_DEFAULT_ACTIONS[k] };
  }
  return out;
}

/** Fresh settings: every direction on with its default action. */
export function defaultPressSlide(on = true) {
  const out = { on, holdMs: PRESS_SLIDE_HOLD_MS };
  for (const k of PRESS_SLIDE_DIRS) out[k] = { on: true, action: PRESS_SLIDE_DEFAULT_ACTIONS[k] };
  return out;
}

/** The directions that are on (and do something). */
export function pressSlideDirs(cfg) {
  if (!cfg || !cfg.on) return [];
  return PRESS_SLIDE_DIRS.filter(k => cfg[k] && cfg[k].on && cfg[k].action !== 'none');
}

/** Runtime contract: data-press-slide="u:scroll-up;d:scroll-down;l:back;r:enter" (enabled directions only). */
export function pressSlideSpec(cfg) {
  return pressSlideDirs(cfg).map(k => `${k}:${cfg[k].action}`).join(';');
}

/** Fallback chevrons (24 grid) when a direction's public path is not in the render library. */
export const PRESS_SLIDE_FALLBACK = {
  u: 'M6 3 L12 1 L18 3',
  d: 'M6 21 L12 23 L18 21',
  l: 'M3 6 L1 12 L3 18',
  r: 'M21 6 L23 12 L21 18'
};

/** Visual effect: a ring fills while the press is held, the chevrons light up once armed, the slid one glows. */
export const PRESS_SLIDE_CSS = [
  '.ud-ps{touch-action:none;-webkit-user-select:none;user-select:none}',
  '.ud-ps-body{transition:transform .16s cubic-bezier(.3,1.4,.5,1)}',
  '.ud-ps-dir{opacity:.55;transition:opacity .15s,stroke-width .15s}',
  '.ud-ps-ring{opacity:0;fill:none;pointer-events:none}',
  '.ud-ps[data-ps-state="hold"] .ud-ps-ring{opacity:.65;animation:ud-ps-fill var(--ps-hold,1000ms) linear forwards}',
  '.ud-ps[data-ps-state="armed"] .ud-ps-ring{opacity:.9;stroke-dashoffset:0;animation:ud-ps-pulse 1.1s ease-in-out infinite}',
  '.ud-ps[data-ps-state="armed"] .ud-ps-dir{opacity:1}',
  '.ud-ps[data-ps-dir="u"] .ud-ps-dir[data-dir="u"],.ud-ps[data-ps-dir="d"] .ud-ps-dir[data-dir="d"],.ud-ps[data-ps-dir="l"] .ud-ps-dir[data-dir="l"],.ud-ps[data-ps-dir="r"] .ud-ps-dir[data-dir="r"]{opacity:1;stroke-width:calc(var(--ps-sw,2) * 1.7)}',
  '@keyframes ud-ps-fill{from{stroke-dashoffset:100px}to{stroke-dashoffset:0px}}',
  '@keyframes ud-ps-pulse{0%,100%{opacity:.9}50%{opacity:.35}}',
  '@media (prefers-reduced-motion:reduce){.ud-ps-body{transition:none}.ud-ps-ring{animation:none!important}}'
].join('');
