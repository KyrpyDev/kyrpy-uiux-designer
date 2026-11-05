/**
 * Entity rules. The library hierarchy (each level is built from the previous ones):
 *
 *   path  ->  icon  ->  button  ->  element  ->  screen  ->  workflow
 *
 * - path    a reusable group of vector shapes (24x24 grid). Icons are made of paths.
 * - icon    24x24 composition of path groups (and own shapes).
 * - button  frame + icons (+ an optional popup / rotating menu of nested menu items).
 * - element UI building block (HTML elements, forms, cards ...) = shapes + icons + buttons + other elements.
 * - screen  a device-sized composition of icons, buttons and elements.
 *
 * Every design is tied to a project (`projectId`), can be set to `public` or `project` (`visibility`),
 * tracks its `creatorId` (default `kyrpy` = 1) and root owner lineage (`clonedFromId`, `rootItemId`, `rootOwnerId`),
 * and supports position locking (`locked`).
 * Every node supports multi-events (`events`: click, mouseover, release, drag, drop, dblclick, longpress, focus)
 * that can open an element, a popup, a small element toolbar, a drawer, route to a screen, go back, or trigger animations.
 */
import { ValidationError } from './errors.js';
import { isValidKey, slugify, labelFromKey } from './naming.js';

export const TYPES = {
  path: { plural: 'paths', label: 'Path', size: [24, 24], fixedSize: true, grid: 1, accepts: ['path'] },
  icon: { plural: 'icons', label: 'Icon', size: [24, 24], fixedSize: true, grid: 1, accepts: ['path'] },
  button: { plural: 'buttons', label: 'Button', size: [64, 64], grid: 4, accepts: ['icon', 'path'] },
  element: { plural: 'elements', label: 'Element', size: [240, 64], grid: 8, accepts: ['icon', 'button', 'element', 'path'] },
  screen: { plural: 'screens', label: 'Screen', size: [390, 844], grid: 24, accepts: ['icon', 'button', 'element'] }
};
export const OWNER_TYPES = Object.keys(TYPES);
export const PLURAL_TO_TYPE = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v.plural, k]));
export const NODE_TAGS = ['rect', 'circle', 'ellipse', 'path', 'line', 'polyline', 'polygon', 'text', 'g', 'use'];
export const NODE_KINDS = ['shape', 'text', 'group', 'instance'];

export const VISIBILITY_LEVELS = ['public', 'private', 'project'];
export const USER_ROLES = ['superadmin', 'admin', 'designer', 'reviewer', 'viewer'];
export const PROJECT_ROLES = ['owner', 'admin', 'editor', 'contributor', 'viewer'];

export const EVENT_TRIGGERS = ['click', 'dblclick', 'mouseover', 'mouseleave', 'mousedown', 'release', 'drag', 'drop', 'dragdrop', 'rightclick', 'contextmenu', 'longpress', 'focus'];

/**
 * What happens when an element event fires in the finished app or live designer preview:
 *   screen   route to another screen                 { type, targetId: <screen id> }
 *   element  open/show an element inline or overlay  { type, targetId: <element id> }
 *   popup    open an element in a dialog             { type, targetId: <element id> }
 *   toolbar  open a small element toolbar near node  { type, targetId?: <element id>, position?: 'top'|'bottom'|'left'|'right'|'floating', items?: [...] }
 *   drawer   slide an element in from a side         { type, targetId: <element id>, side }
 *   back     go back one page                        { type }
 *   animate  play/toggle animation on node           { type, animationType?: string, targetNodeId?: number }
 *   toggle   toggle flip / active state              { type, targetNodeId?: number }
 */
export const CLICK_ACTIONS = ['screen', 'popup', 'drawer', 'back', 'element', 'toolbar', 'animate', 'toggle'];
export const EVENT_ACTIONS = CLICK_ACTIONS;
export const DRAWER_SIDES = ['left', 'right', 'top', 'bottom'];
export const TOOLBAR_POSITIONS = ['top', 'bottom', 'left', 'right', 'floating'];
/** Library type each action needs as its target. */
export const CLICK_TARGET_TYPE = { screen: 'screen', popup: 'element', drawer: 'element', element: 'element', toolbar: 'element' };

/** Cleans a click/event action: null for "nothing happens", else a validated object. Throws ValidationError on a malformed one. */
export function normalizeClickAction(input) {
  if (input === null || input === undefined || input === '' || input.type === 'none' || input.type === '') return null;
  if (typeof input !== 'object') throw new ValidationError('a click action is an object like { type, targetId }');
  const type = String(input.type);
  if (!CLICK_ACTIONS.includes(type)) throw new ValidationError(`click action must be one of none, ${CLICK_ACTIONS.join(', ')}`);
  if (type === 'back') return { type };
  if (type === 'animate') return { type, animationType: str(input.animationType, 'pulse'), ...(input.targetNodeId ? { targetNodeId: Number(input.targetNodeId) } : {}) };
  if (type === 'toggle') return { type, ...(input.targetNodeId ? { targetNodeId: Number(input.targetNodeId) } : {}) };
  if (type === 'toolbar') {
    const position = input.position === undefined || input.position === '' ? 'top' : String(input.position);
    if (!TOOLBAR_POSITIONS.includes(position)) throw new ValidationError(`toolbar position must be one of ${TOOLBAR_POSITIONS.join(', ')}`);
    const targetId = input.targetId != null && input.targetId !== '' ? Number(input.targetId) : null;
    const items = Array.isArray(input.items) ? input.items.map(it => ({ label: str(it.label, 'Action'), icon: str(it.icon, ''), action: str(it.action, '') })) : [];
    if ((targetId === null || !Number.isInteger(targetId) || targetId <= 0) && !items.length) {
      throw new ValidationError('a "toolbar" action needs a target element or toolbar items');
    }
    return { type, ...(targetId > 0 ? { targetId } : {}), position, ...(items.length ? { items } : {}) };
  }
  const targetId = Number(input.targetId);
  if (input.targetId === null || input.targetId === undefined || input.targetId === '' || !Number.isInteger(targetId) || targetId <= 0) {
    throw new ValidationError(`a "${type}" action needs a target ${CLICK_TARGET_TYPE[type]}`);
  }
  if (type === 'drawer') {
    const side = input.side === undefined || input.side === '' ? 'right' : String(input.side);
    if (!DRAWER_SIDES.includes(side)) throw new ValidationError(`drawer side must be one of ${DRAWER_SIDES.join(', ')}`);
    return { type, targetId, side };
  }
  return { type, targetId };
}

/** Normalizes a single event binding `{ trigger, ...action }` (e.g. `{ trigger: 'mouseover', type: 'toolbar', targetId: 5 }`). */
export function normalizeEventBinding(input) {
  if (!input || typeof input !== 'object') throw new ValidationError('event binding must be an object');
  const trigger = String(input.trigger || 'click');
  if (!EVENT_TRIGGERS.includes(trigger)) throw new ValidationError(`event trigger must be one of ${EVENT_TRIGGERS.join(', ')}`);
  const act = normalizeClickAction(input);
  if (!act) return null;
  return { trigger, ...act };
}

/** Normalizes an array of event bindings on a node. */
export function normalizeEvents(input) {
  if (input === null || input === undefined || input === '') return [];
  if (!Array.isArray(input)) throw new ValidationError('events must be an array');
  return input.map(normalizeEventBinding).filter(Boolean);
}

export const DEVICES = {
  'iphone-15': { name: 'iPhone 15', width: 390, height: 844, category: 'mobile', cornerRadius: 44, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'liquid', lightTheme: 'liquid-light' } },
  'iphone-16-pro-max': { name: 'iPhone 16 Pro Max', width: 440, height: 956, category: 'mobile', cornerRadius: 48, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'glassmorphism-dark', lightTheme: 'glassmorphism-light' } },
  'android': { name: 'Android phone', width: 360, height: 800, category: 'mobile', cornerRadius: 36, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'aurora-dark', lightTheme: 'aurora-light' } },
  'pixel-8': { name: 'Google Pixel 8', width: 412, height: 915, category: 'mobile', cornerRadius: 40, meta: { modes: ['dark', 'light'], defaultMode: 'light', darkTheme: 'pastel-dark', lightTheme: 'pastel-light' } },
  'galaxy-s24': { name: 'Galaxy S24', width: 384, height: 854, category: 'mobile', cornerRadius: 38, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'cosmic-dark', lightTheme: 'cosmic-light' } },
  'tablet': { name: 'Tablet', width: 768, height: 1024, category: 'tablet', cornerRadius: 28, meta: { modes: ['dark', 'light'], defaultMode: 'light', darkTheme: 'minimalist-dark', lightTheme: 'minimalist-light' } },
  'ipad-pro-13': { name: 'iPad Pro 13"', width: 1024, height: 1366, category: 'tablet', cornerRadius: 32, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'claymorphism-dark', lightTheme: 'claymorphism-light' } },
  'foldable-open': { name: 'Foldable (Unfolded)', width: 673, height: 841, category: 'tablet', cornerRadius: 28, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'synthwave-dark', lightTheme: 'synthwave-light' } },
  'web': { name: 'Web desktop', width: 1280, height: 800, category: 'desktop', cornerRadius: 8, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'brutalism-dark', lightTheme: 'brutalism-light' } },
  'web-1080p': { name: 'Desktop Full HD', width: 1920, height: 1080, category: 'desktop', cornerRadius: 8, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'cyberpunk-dark', lightTheme: 'cyberpunk-light' } },
  'kiosk-touch': { name: 'Touch Kiosk Portrait', width: 1080, height: 1920, category: 'kiosk', cornerRadius: 12, meta: { modes: ['dark', 'light'], defaultMode: 'light', darkTheme: 'flat-dark', lightTheme: 'flat-light' } },
  'watch': { name: 'Watch', width: 200, height: 240, category: 'wearable', cornerRadius: 48, meta: { modes: ['dark', 'light'], defaultMode: 'dark', darkTheme: 'retro-dark', lightTheme: 'retro-light' } }
};

export const DEFAULT_BUTTON_TEMPLATES = [
  // Existing 8 core button templates (updated with Dark & Light mode pairs)
  { key: 'glass-pill', name: 'Liquid Glass Pill (Dark)', category: 'glass', shape: 'pill', width: 160, height: 48, rxRatio: 0.5, marginRatio: 0.15, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'glass-pill-light', themeKey: 'liquid', styleFamily: 'Liquid Glass' } },
  { key: 'glass-pill-light', name: 'Liquid Glass Pill (Light)', category: 'glass', shape: 'pill', width: 160, height: 48, rxRatio: 0.5, marginRatio: 0.15, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'glass-pill', themeKey: 'liquid-light', styleFamily: 'Liquid Glass' } },
  { key: 'glow-outline', name: 'Neon Glow Outline (Dark)', category: 'glow', shape: 'rounded', width: 160, height: 48, rxRatio: 0.28, marginRatio: 0.15, strokeRatio: 1.4, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'dark', pairKey: 'glow-outline-light', themeKey: 'glow', styleFamily: 'Glow Lines' } },
  { key: 'glow-outline-light', name: 'Neon Glow Outline (Light)', category: 'glow', shape: 'rounded', width: 160, height: 48, rxRatio: 0.28, marginRatio: 0.15, strokeRatio: 1.4, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'light', pairKey: 'glow-outline', themeKey: 'glow-light', styleFamily: 'Glow Lines' } },
  { key: 'neu-soft', name: 'Neumorphic Soft Rect (Light)', category: 'neu', shape: 'rounded', width: 160, height: 52, rxRatio: 0.3, marginRatio: 0.18, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'neu-soft-dark', themeKey: 'neu-light', styleFamily: 'Neumorphism' } },
  { key: 'neu-soft-dark', name: 'Neumorphic Soft Rect (Dark)', category: 'neu', shape: 'rounded', width: 160, height: 52, rxRatio: 0.3, marginRatio: 0.18, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'neu-soft', themeKey: 'neu-dark', styleFamily: 'Neumorphism' } },
  { key: 'fab-circle', name: 'Floating Action Circle (Dark)', category: 'icon', shape: 'circle', width: 64, height: 64, rxRatio: 0.5, marginRatio: 0.2, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'dark', pairKey: 'fab-circle-light', themeKey: 'liquid', styleFamily: 'Floating Action' } },
  { key: 'fab-circle-light', name: 'Floating Action Circle (Light)', category: 'icon', shape: 'circle', width: 64, height: 64, rxRatio: 0.5, marginRatio: 0.2, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'light', pairKey: 'fab-circle', themeKey: 'liquid-light', styleFamily: 'Floating Action' } },
  { key: 'icon-square', name: 'Compact Icon Tile (Dark)', category: 'icon', shape: 'rounded', width: 52, height: 52, rxRatio: 0.25, marginRatio: 0.2, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'icon-square-light', themeKey: 'liquid', styleFamily: 'Icon Tile' } },
  { key: 'icon-square-light', name: 'Compact Icon Tile (Light)', category: 'icon', shape: 'rounded', width: 52, height: 52, rxRatio: 0.25, marginRatio: 0.2, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'icon-square', themeKey: 'liquid-light', styleFamily: 'Icon Tile' } },
  { key: 'rotating-radial', name: 'Rotating Radial Hub (Dark)', category: 'menu', shape: 'circle', width: 64, height: 64, rxRatio: 0.5, marginRatio: 0.18, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'rotating-radial-light', themeKey: 'liquid', styleFamily: 'Radial Hub' } },
  { key: 'rotating-radial-light', name: 'Rotating Radial Hub (Light)', category: 'menu', shape: 'circle', width: 64, height: 64, rxRatio: 0.5, marginRatio: 0.18, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'rotating-radial', themeKey: 'liquid-light', styleFamily: 'Radial Hub' } },
  { key: 'split-action', name: 'Split Dropdown Button (Dark)', category: 'composite', shape: 'rounded', width: 180, height: 48, rxRatio: 0.25, marginRatio: 0.14, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'split-action-light', themeKey: 'liquid', styleFamily: 'Split Action' } },
  { key: 'split-action-light', name: 'Split Dropdown Button (Light)', category: 'composite', shape: 'rounded', width: 180, height: 48, rxRatio: 0.25, marginRatio: 0.14, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'split-action', themeKey: 'liquid-light', styleFamily: 'Split Action' } },
  { key: 'toolbar-chip', name: 'Mini Toolbar Action Chip (Dark)', category: 'toolbar', shape: 'pill', width: 108, height: 36, rxRatio: 0.5, marginRatio: 0.12, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'toolbar-chip-light', themeKey: 'liquid', styleFamily: 'Toolbar Chip' } },
  { key: 'toolbar-chip-light', name: 'Mini Toolbar Action Chip (Light)', category: 'toolbar', shape: 'pill', width: 108, height: 36, rxRatio: 0.5, marginRatio: 0.12, strokeRatio: 1.0, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'toolbar-chip', themeKey: 'liquid-light', styleFamily: 'Toolbar Chip' } },

  // 12 New Design Styles — Dark & Light Mode Button Templates
  { key: 'glassmorphism-dark-btn', name: 'Glassmorphism Frosted Button (Dark)', category: 'glassmorphism', shape: 'pill', width: 168, height: 48, rxRatio: 0.45, marginRatio: 0.15, strokeRatio: 1.1, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'glassmorphism-light-btn', themeKey: 'glassmorphism-dark', styleFamily: 'Glassmorphism' } },
  { key: 'glassmorphism-light-btn', name: 'Glassmorphism Frosted Button (Light)', category: 'glassmorphism', shape: 'pill', width: 168, height: 48, rxRatio: 0.45, marginRatio: 0.15, strokeRatio: 1.1, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'glassmorphism-dark-btn', themeKey: 'glassmorphism-light', styleFamily: 'Glassmorphism' } },
  { key: 'brutalism-dark-btn', name: 'Brutalism / Neo-Brutalism Block (Dark)', category: 'brutalism', shape: 'square', width: 168, height: 48, rxRatio: 0.08, marginRatio: 0.14, strokeRatio: 2.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'brutalism-light-btn', themeKey: 'brutalism-dark', styleFamily: 'Brutalism / Neo-Brutalism' } },
  { key: 'brutalism-light-btn', name: 'Brutalism / Neo-Brutalism Block (Light)', category: 'brutalism', shape: 'square', width: 168, height: 48, rxRatio: 0.08, marginRatio: 0.14, strokeRatio: 2.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'brutalism-dark-btn', themeKey: 'brutalism-light', styleFamily: 'Brutalism / Neo-Brutalism' } },
  { key: 'minimalist-dark-btn', name: 'Minimalist Hairline Button (Dark)', category: 'minimalist', shape: 'rounded', width: 160, height: 44, rxRatio: 0.18, marginRatio: 0.14, strokeRatio: 0.8, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'minimalist-light-btn', themeKey: 'minimalist-dark', styleFamily: 'Minimalist' } },
  { key: 'minimalist-light-btn', name: 'Minimalist Hairline Button (Light)', category: 'minimalist', shape: 'rounded', width: 160, height: 44, rxRatio: 0.18, marginRatio: 0.14, strokeRatio: 0.8, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'minimalist-dark-btn', themeKey: 'minimalist-light', styleFamily: 'Minimalist' } },
  { key: 'skeuomorphism-dark-btn', name: 'Skeuomorphic Bevel Button (Dark)', category: 'skeuomorphism', shape: 'rounded', width: 168, height: 50, rxRatio: 0.24, marginRatio: 0.16, strokeRatio: 1.3, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'skeuomorphism-light-btn', themeKey: 'skeuomorphism-dark', styleFamily: 'Skeuomorphism' } },
  { key: 'skeuomorphism-light-btn', name: 'Skeuomorphic Bevel Button (Light)', category: 'skeuomorphism', shape: 'rounded', width: 168, height: 50, rxRatio: 0.24, marginRatio: 0.16, strokeRatio: 1.3, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'skeuomorphism-dark-btn', themeKey: 'skeuomorphism-light', styleFamily: 'Skeuomorphism' } },
  { key: 'aurora-dark-btn', name: 'Aurora Shimmer Pill (Dark)', category: 'aurora', shape: 'pill', width: 168, height: 48, rxRatio: 0.5, marginRatio: 0.15, strokeRatio: 1.1, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'dark', pairKey: 'aurora-light-btn', themeKey: 'aurora-dark', styleFamily: 'Aurora' } },
  { key: 'aurora-light-btn', name: 'Aurora Shimmer Pill (Light)', category: 'aurora', shape: 'pill', width: 168, height: 48, rxRatio: 0.5, marginRatio: 0.15, strokeRatio: 1.1, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'light', pairKey: 'aurora-dark-btn', themeKey: 'aurora-light', styleFamily: 'Aurora' } },
  { key: 'claymorphism-dark-btn', name: 'Gradient 3D Clay Button (Dark)', category: 'claymorphism', shape: 'pill', width: 172, height: 54, rxRatio: 0.46, marginRatio: 0.18, strokeRatio: 1.2, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'claymorphism-light-btn', themeKey: 'claymorphism-dark', styleFamily: 'Gradient 3D Claymorphism' } },
  { key: 'claymorphism-light-btn', name: 'Gradient 3D Clay Button (Light)', category: 'claymorphism', shape: 'pill', width: 172, height: 54, rxRatio: 0.46, marginRatio: 0.18, strokeRatio: 1.2, role: 'button', hoverEffect: 'shine', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'claymorphism-dark-btn', themeKey: 'claymorphism-light', styleFamily: 'Gradient 3D Claymorphism' } },
  { key: 'cyberpunk-dark-btn', name: 'Cyberpunk HUD Trigger (Dark)', category: 'cyberpunk', shape: 'square', width: 172, height: 48, rxRatio: 0.1, marginRatio: 0.15, strokeRatio: 1.5, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'dark', pairKey: 'cyberpunk-light-btn', themeKey: 'cyberpunk-dark', styleFamily: 'Cyberpunk' } },
  { key: 'cyberpunk-light-btn', name: 'Cyberpunk HUD Trigger (Light)', category: 'cyberpunk', shape: 'square', width: 172, height: 48, rxRatio: 0.1, marginRatio: 0.15, strokeRatio: 1.5, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'light', pairKey: 'cyberpunk-dark-btn', themeKey: 'cyberpunk-light', styleFamily: 'Cyberpunk' } },
  { key: 'synthwave-dark-btn', name: 'Synthwave Outrun Button (Dark)', category: 'synthwave', shape: 'rounded', width: 172, height: 48, rxRatio: 0.28, marginRatio: 0.15, strokeRatio: 1.4, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'dark', pairKey: 'synthwave-light-btn', themeKey: 'synthwave-dark', styleFamily: 'Synthwave' } },
  { key: 'synthwave-light-btn', name: 'Synthwave Outrun Button (Light)', category: 'synthwave', shape: 'rounded', width: 172, height: 48, rxRatio: 0.28, marginRatio: 0.15, strokeRatio: 1.4, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'light', pairKey: 'synthwave-dark-btn', themeKey: 'synthwave-light', styleFamily: 'Synthwave' } },
  { key: 'pastel-dark-btn', name: 'Pastel Cozy Cushion (Dark)', category: 'pastel', shape: 'pill', width: 164, height: 48, rxRatio: 0.44, marginRatio: 0.16, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'pastel-light-btn', themeKey: 'pastel-dark', styleFamily: 'Pastel Minimal / Cozy UI' } },
  { key: 'pastel-light-btn', name: 'Pastel Cozy Cushion (Light)', category: 'pastel', shape: 'pill', width: 164, height: 48, rxRatio: 0.44, marginRatio: 0.16, strokeRatio: 1.0, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'pastel-dark-btn', themeKey: 'pastel-light', styleFamily: 'Pastel Minimal / Cozy UI' } },
  { key: 'cosmic-dark-btn', name: 'Cosmic Nebula Capsule (Dark)', category: 'cosmic', shape: 'pill', width: 172, height: 48, rxRatio: 0.5, marginRatio: 0.16, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'dark', pairKey: 'cosmic-light-btn', themeKey: 'cosmic-dark', styleFamily: 'Cosmic / Space Adventure UI' } },
  { key: 'cosmic-light-btn', name: 'Cosmic Nebula Capsule (Light)', category: 'cosmic', shape: 'pill', width: 172, height: 48, rxRatio: 0.5, marginRatio: 0.16, strokeRatio: 1.2, role: 'button', hoverEffect: 'glow', indicatorEffect: 'pulse', meta: { mode: 'light', pairKey: 'cosmic-dark-btn', themeKey: 'cosmic-light', styleFamily: 'Cosmic / Space Adventure UI' } },
  { key: 'flat-dark-btn', name: 'Flat Playful Badge Button (Dark)', category: 'flat', shape: 'rounded', width: 164, height: 48, rxRatio: 0.32, marginRatio: 0.15, strokeRatio: 1.6, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'dark', pairKey: 'flat-light-btn', themeKey: 'flat-dark', styleFamily: 'Flat Playful' } },
  { key: 'flat-light-btn', name: 'Flat Playful Badge Button (Light)', category: 'flat', shape: 'rounded', width: 164, height: 48, rxRatio: 0.32, marginRatio: 0.15, strokeRatio: 1.6, role: 'button', hoverEffect: 'fill', indicatorEffect: 'none', meta: { mode: 'light', pairKey: 'flat-dark-btn', themeKey: 'flat-light', styleFamily: 'Flat Playful' } },
  { key: 'retro-dark-btn', name: 'Pop & Neon Retro Arcade Button (Dark)', category: 'retro', shape: 'rounded', width: 172, height: 48, rxRatio: 0.22, marginRatio: 0.15, strokeRatio: 1.8, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'dark', pairKey: 'retro-light-btn', themeKey: 'retro-dark', styleFamily: 'Pop & Neon Retro UI' } },
  { key: 'retro-light-btn', name: 'Pop & Neon Retro Arcade Button (Light)', category: 'retro', shape: 'rounded', width: 172, height: 48, rxRatio: 0.22, marginRatio: 0.15, strokeRatio: 1.8, role: 'button', hoverEffect: 'glow', indicatorEffect: 'contour-blink', meta: { mode: 'light', pairKey: 'retro-dark-btn', themeKey: 'retro-light', styleFamily: 'Pop & Neon Retro UI' } }
];

export const MENU_LAYOUTS = ['fan', 'list'];
export const MENU_KINDS = ['popup', 'rotating'];
/** Default menu settings of a button. Sizes are ratios of the button size so the menu scales with the button. */
export const DEFAULT_MENU = {
  kind: 'popup',        // popup = opens in place; rotating = replaces the centre icon with the clicked item and shows its sub items
  layout: 'list',       // fan | list
  direction: 'up',      // list: up | down | left | right
  radius: 1.7,          // fan radius / button size
  startAngle: -160,     // fan: angle of the first item, degrees (0 = right, -90 = up)
  sweep: 140,           // fan: angle covered by the items
  itemScale: 0.75,      // item size / button size
  gap: 0.2,             // list gap / button size
  rotateOnOpen: 45      // degrees the centre icon turns while the menu is open (0 = off)
};

const str = (v, d = '') => (v === undefined || v === null ? d : String(v));
const posNum = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Normalizes a design record of any library type. `partial` keeps only the provided fields (for updates). */
export function normalizeDesign(ownerType, input, { partial = false } = {}) {
  const T = TYPES[ownerType];
  if (!T) throw new ValidationError(`unknown owner type ${ownerType}`);
  const out = {};
  const has = k => input[k] !== undefined;
  if (!partial || has('name')) out.name = str(input.name).trim();
  if (!partial || has('key')) out.key = str(input.key || slugify(input.name)).trim();
  if (!partial || has('label')) out.label = str(input.label || (out.name ?? input.name));
  if (!partial || has('descriptionDev')) out.descriptionDev = str(input.descriptionDev);
  if (!partial || has('category')) out.category = str(input.category, 'general');
  if (!partial || has('tags')) out.tags = Array.isArray(input.tags) ? input.tags.map(String) : str(input.tags).split(',').map(s => s.trim()).filter(Boolean);
  if (!partial || has('meta')) out.meta = input.meta && typeof input.meta === 'object' ? input.meta : {};
  if (!partial || has('width') || has('height')) {
    if (T.fixedSize) { out.width = T.size[0]; out.height = T.size[1]; }
    else {
      const dev = ownerType === 'screen' ? DEVICES[input.meta?.device] : null;
      out.width = posNum(input.width, dev?.width ?? T.size[0]);
      out.height = posNum(input.height, dev?.height ?? T.size[1]);
    }
  }
  if (has('position')) out.position = Number(input.position) || 0;
  if (!partial || has('projectId')) out.projectId = posNum(input.projectId, 1);
  if (!partial || has('visibility')) {
    const vis = str(input.visibility, 'public');
    if (!VISIBILITY_LEVELS.includes(vis)) throw new ValidationError(`visibility must be one of ${VISIBILITY_LEVELS.join(', ')}`);
    out.visibility = vis;
  }
  if (!partial || has('creatorId')) out.creatorId = posNum(input.creatorId, 1);
  if (has('clonedFromId')) out.clonedFromId = input.clonedFromId == null ? null : Number(input.clonedFromId);
  if (has('rootItemId')) out.rootItemId = input.rootItemId == null ? null : Number(input.rootItemId);
  if (!partial || has('rootOwnerId')) out.rootOwnerId = posNum(input.rootOwnerId, out.creatorId ?? 1);
  if (!partial || has('locked')) out.locked = !!input.locked;

  const errors = [];
  if ((!partial || has('name')) && !out.name) errors.push('name is required');
  if ((!partial || has('key')) && !isValidKey(out.key)) errors.push(`key "${out.key}" must be dashed lowercase words (a-z, 0-9, -)`);
  if (errors.length) throw new ValidationError(errors.join('; '), errors);
  return out;
}

export function normalizeNode(input, { partial = false } = {}) {
  const out = {};
  const has = k => input[k] !== undefined;
  if (!partial || has('tag')) {
    out.tag = str(input.tag);
    if (!NODE_TAGS.includes(out.tag)) throw new ValidationError(`tag must be one of ${NODE_TAGS.join(', ')}`);
  }
  if (!partial || has('kind') || has('tag')) {
    out.kind = input.kind || (out.tag === 'text' ? 'text' : out.tag === 'g' ? 'group' : input.refType ? 'instance' : 'shape');
    if (!NODE_KINDS.includes(out.kind)) throw new ValidationError(`kind must be one of ${NODE_KINDS.join(', ')}`);
  }
  if (!partial || has('name')) out.name = str(input.name);
  if (!partial || has('role')) out.role = input.role ? str(input.role) : null;
  if (!partial || has('parentId')) out.parentId = input.parentId ?? null;
  if (!partial || has('ord')) out.ord = Number(input.ord) || 0;
  if (!partial || has('refType')) {
    out.refType = input.refType ? str(input.refType) : null;
    if (out.refType && !OWNER_TYPES.includes(out.refType)) throw new ValidationError(`refType must be one of ${OWNER_TYPES.join(', ')}`);
  }
  if (!partial || has('refId')) out.refId = input.refId ?? null;
  if (!partial || has('rotation')) out.rotation = Number(input.rotation) || 0;
  if (!partial || has('visible')) out.visible = input.visible === false || input.visible === 0 ? false : true;
  if (!partial || has('locked')) out.locked = !!input.locked;
  if (!partial || has('text')) out.text = str(input.text);
  if (!partial || has('descriptionDev')) out.descriptionDev = str(input.descriptionDev);
  if (!partial || has('onClick')) out.onClick = normalizeClickAction(input.onClick);
  if (!partial || has('events')) out.events = normalizeEvents(input.events);
  if (!partial || has('attrs')) out.attrs = input.attrs && typeof input.attrs === 'object' ? { ...input.attrs } : {};
  if (out.kind === 'instance' && (!out.refType || out.refId == null) && !partial) throw new ValidationError('instance nodes need refType and refId');
  return out;
}

/** Which library types may be placed inside a design of `ownerType` (the hierarchy rule). */
export const canContain = (ownerType, refType) => TYPES[ownerType]?.accepts.includes(refType) ?? false;

export function normalizeMenuItem(input, { partial = false } = {}) {
  const out = {};
  const has = k => input[k] !== undefined;
  if (!partial || has('label')) out.label = str(input.label);
  if (!partial || has('name')) out.name = str(input.name || slugify(input.label || 'item'));
  if (!partial || has('iconId')) out.iconId = input.iconId == null || input.iconId === '' ? null : Number(input.iconId);
  if (!partial || has('parentId')) out.parentId = input.parentId == null ? null : Number(input.parentId);
  if (!partial || has('ord')) out.ord = Number(input.ord) || 0;
  if (!partial || has('action')) out.action = str(input.action);
  if (!partial || has('targetScreenId')) out.targetScreenId = input.targetScreenId == null || input.targetScreenId === '' ? null : Number(input.targetScreenId);
  if (!partial || has('targetElementId')) out.targetElementId = input.targetElementId == null || input.targetElementId === '' ? null : Number(input.targetElementId);
  if (!partial || has('visible')) out.visible = input.visible === false || input.visible === 0 ? false : true;
  if (!partial || has('descriptionDev')) out.descriptionDev = str(input.descriptionDev);
  if (out.name !== undefined && out.name && !isValidKey(out.name)) throw new ValidationError(`menu item name "${out.name}" must be dashed lowercase words`);
  return out;
}

export function normalizeWorkflow(input, { partial = false } = {}) {
  const out = {};
  const has = k => input[k] !== undefined;
  if (!partial || has('name')) out.name = str(input.name).trim();
  if (!partial || has('key')) out.key = str(input.key || slugify(input.name));
  if (!partial || has('label')) out.label = str(input.label || out.name);
  if (!partial || has('descriptionDev')) out.descriptionDev = str(input.descriptionDev);
  if (!partial || has('projectId')) out.projectId = posNum(input.projectId, 1);
  if (!partial || has('visibility')) {
    const vis = str(input.visibility, 'public');
    if (!VISIBILITY_LEVELS.includes(vis)) throw new ValidationError(`visibility must be one of ${VISIBILITY_LEVELS.join(', ')}`);
    out.visibility = vis;
  }
  if (!partial || has('creatorId')) out.creatorId = posNum(input.creatorId, 1);
  if (has('clonedFromId')) out.clonedFromId = input.clonedFromId == null ? null : Number(input.clonedFromId);
  if (has('rootItemId')) out.rootItemId = input.rootItemId == null ? null : Number(input.rootItemId);
  if (!partial || has('rootOwnerId')) out.rootOwnerId = posNum(input.rootOwnerId, out.creatorId ?? 1);
  if (!partial || has('locked')) out.locked = !!input.locked;
  const errors = [];
  if ((!partial || has('name')) && !out.name) errors.push('name is required');
  if ((!partial || has('key')) && !isValidKey(out.key)) errors.push(`key "${out.key}" must be dashed lowercase words`);
  if (errors.length) throw new ValidationError(errors.join('; '), errors);
  return out;
}

export function normalizeLink(input, { partial = false } = {}) {
  const out = {};
  const has = k => input[k] !== undefined;
  if (!partial || has('fromScreenId')) out.fromScreenId = Number(input.fromScreenId);
  if (!partial || has('toScreenId')) out.toScreenId = Number(input.toScreenId);
  if (!partial || has('fromNodeId')) out.fromNodeId = input.fromNodeId == null ? null : Number(input.fromNodeId);
  if (!partial || has('name')) out.name = str(input.name);
  if (!partial || has('descriptionDev')) out.descriptionDev = str(input.descriptionDev);
  if (!partial || has('style')) out.style = ['curved', 'cornered'].includes(input.style) ? input.style : 'curved';
  if (!partial || has('trigger')) out.trigger = str(input.trigger, 'tap');
  if (!partial && (!Number.isInteger(out.fromScreenId) || !Number.isInteger(out.toScreenId))) throw new ValidationError('fromScreenId and toScreenId are required');
  return out;
}

export { labelFromKey };
