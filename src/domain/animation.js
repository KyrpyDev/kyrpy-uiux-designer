/**
 * Animation model (pure). An animation targets one element (or a whole owner) and compiles to CSS keyframes,
 * which work inside standalone .svg files and inline <svg> in HTML alike.
 */
export const ANIMATION_TYPES = [
  'move', 'rotate', 'scale', 'fade', 'visible', 'blink', 'pulse', 'bounce', 'draw', 'glow',
  'flip', 'shake', 'swing', 'float', 'shine', 'contour-blink', 'slide-in', 'keyframes'
];
export const TRIGGERS = ['load', 'hover', 'click', 'mouseover', 'release', 'drag', 'focus'];
export const EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'steps(1)', 'cubic-bezier(.2,.8,.2,1)'];

/** Defaults shown by the editor when a type is chosen. */
export const ANIMATION_DEFAULTS = {
  move: { fromX: 0, fromY: 0, toX: 8, toY: 0 },
  rotate: { from: 0, to: 360 },
  scale: { from: 1, to: 1.2, axis: 'both', origin: 'center' },
  fade: { from: 0, to: 1 },
  visible: { from: 1, to: 0 },
  blink: { min: 0.2 },
  pulse: { amount: 0.12 },
  bounce: { amount: 3 },
  draw: { length: 100 },
  glow: { blur: 6, color: '#2E9BFF' },
  flip: { axis: 'y', deg: 180 },
  shake: { amount: 6 },
  swing: { deg: 12 },
  float: { amount: 6 },
  shine: { color: '#79C8FF' },
  'contour-blink': { color: '#FFB020', width: 3 },
  'slide-in': { fromX: -24, fromY: 0 },
  keyframes: { frames: [{ offset: 0, opacity: 1 }, { offset: 100, opacity: 0.3 }] }
};

export function defaultAnimation(type = 'pulse') {
  return { name: type, type, params: { ...(ANIMATION_DEFAULTS[type] || {}) }, durationMs: 1200, delayMs: 0, easing: 'ease-in-out',
    iterations: 'infinite', direction: 'alternate', fillMode: 'both', trigger: 'load', enabled: true };
}

const px = v => `${Number(v) || 0}px`;

/** Compiles one animation into [{offset, props}] keyframes (props are CSS declarations). */
export function compileKeyframes(a) {
  const p = a.params || {};
  switch (a.type) {
    case 'move': return [
      { offset: 0, props: { transform: `translate(${px(p.fromX)}, ${px(p.fromY)})` } },
      { offset: 100, props: { transform: `translate(${px(p.toX)}, ${px(p.toY)})` } }];
    case 'rotate': return [
      { offset: 0, props: { transform: `rotate(${Number(p.from) || 0}deg)` } },
      { offset: 100, props: { transform: `rotate(${Number(p.to) || 0}deg)` } }];
    case 'scale': {
      const f = v => p.axis === 'x' ? `scale(${v}, 1)` : p.axis === 'y' ? `scale(1, ${v})` : `scale(${v})`;
      return [{ offset: 0, props: { transform: f(p.from ?? 1) } }, { offset: 100, props: { transform: f(p.to ?? 1) } }];
    }
    case 'fade': return [{ offset: 0, props: { opacity: p.from ?? 0 } }, { offset: 100, props: { opacity: p.to ?? 1 } }];
    case 'visible': return [{ offset: 0, props: { opacity: p.from ?? 1 } }, { offset: 100, props: { opacity: p.to ?? 0 } }];
    case 'blink': return [{ offset: 0, props: { opacity: 1 } }, { offset: 50, props: { opacity: p.min ?? 0.2 } }, { offset: 100, props: { opacity: 1 } }];
    case 'pulse': return [
      { offset: 0, props: { transform: 'scale(1)', opacity: 1 } },
      { offset: 50, props: { transform: `scale(${1 + (Number(p.amount) || 0.12)})`, opacity: 0.85 } },
      { offset: 100, props: { transform: 'scale(1)', opacity: 1 } }];
    case 'bounce': return [
      { offset: 0, props: { transform: 'translateY(0)', opacity: 0.35 } },
      { offset: 20, props: { transform: `translateY(-${px(p.amount ?? 3)})`, opacity: 1 } },
      { offset: 40, props: { transform: 'translateY(0)', opacity: 0.35 } },
      { offset: 100, props: { transform: 'translateY(0)', opacity: 0.35 } }];
    case 'draw': return [{ offset: 0, props: { 'stroke-dashoffset': p.length ?? 100 } }, { offset: 100, props: { 'stroke-dashoffset': 0 } }];
    case 'glow': return [
      { offset: 0, props: { filter: `drop-shadow(0 0 1px ${p.color || '#2E9BFF'})` } },
      { offset: 50, props: { filter: `drop-shadow(0 0 ${px(p.blur ?? 6)} ${p.color || '#2E9BFF'})` } },
      { offset: 100, props: { filter: `drop-shadow(0 0 1px ${p.color || '#2E9BFF'})` } }];
    case 'flip': {
      const fn = p.axis === 'x' ? 'rotateX' : 'rotateY';
      const deg = Number(p.deg) || 180;
      return [
        { offset: 0, props: { transform: `${fn}(0deg)` } },
        { offset: 50, props: { transform: `${fn}(${deg / 2}deg) scale(0.95)` } },
        { offset: 100, props: { transform: `${fn}(${deg}deg)` } }];
    }
    case 'shake': {
      const d = Number(p.amount) || 6;
      return [
        { offset: 0, props: { transform: 'translateX(0)' } },
        { offset: 25, props: { transform: `translateX(-${px(d)})` } },
        { offset: 50, props: { transform: `translateX(${px(d)})` } },
        { offset: 75, props: { transform: `translateX(-${px(d / 2)})` } },
        { offset: 100, props: { transform: 'translateX(0)' } }];
    }
    case 'swing': {
      const deg = Number(p.deg) || 12;
      return [
        { offset: 0, props: { transform: 'rotate(0deg)' } },
        { offset: 25, props: { transform: `rotate(${deg}deg)` } },
        { offset: 75, props: { transform: `rotate(-${deg}deg)` } },
        { offset: 100, props: { transform: 'rotate(0deg)' } }];
    }
    case 'float': {
      const amt = Number(p.amount) || 6;
      return [
        { offset: 0, props: { transform: 'translateY(0)' } },
        { offset: 50, props: { transform: `translateY(-${px(amt)})` } },
        { offset: 100, props: { transform: 'translateY(0)' } }];
    }
    case 'shine': return [
      { offset: 0, props: { filter: 'brightness(1)' } },
      { offset: 50, props: { filter: `brightness(1.38) drop-shadow(0 0 8px ${p.color || '#79C8FF'})` } },
      { offset: 100, props: { filter: 'brightness(1)' } }];
    case 'contour-blink': return [
      { offset: 0, props: { filter: `drop-shadow(0 0 0px ${p.color || '#FFB020'})` } },
      { offset: 50, props: { filter: `drop-shadow(0 0 ${px(p.width ?? 3)} ${p.color || '#FFB020'}) drop-shadow(0 0 ${px((p.width ?? 3) * 2)} ${p.color || '#FFB020'})` } },
      { offset: 100, props: { filter: `drop-shadow(0 0 0px ${p.color || '#FFB020'})` } }];
    case 'slide-in': return [
      { offset: 0, props: { transform: `translate(${px(p.fromX ?? -24)}, ${px(p.fromY ?? 0)})`, opacity: 0 } },
      { offset: 100, props: { transform: 'translate(0px, 0px)', opacity: 1 } }];
    case 'keyframes': return (p.frames || []).map(f => {
      const { offset, ...props } = f; return { offset: Number(offset) || 0, props };
    });
    default: return [];
  }
}

/** Static style an animated element needs besides the animation property (e.g. dash array for `draw`). */
export function baseStyle(a) {
  const p = a.params || {};
  const origin = a.type === 'scale' && p.origin ? p.origin : 'center';
  const s = [`transform-box:fill-box`, `transform-origin:${origin === 'left' ? 'left center' : origin}`];
  if (a.type === 'draw') s.push(`stroke-dasharray:${p.length ?? 100}`);
  return s.join(';');
}

const cssName = id => `ud-k${id}`;
export const nodeClass = id => `ud-e${id}`;

/**
 * CSS for a set of animations.
 * @param anims  [{id, nodeId, ...}] (disabled ones are skipped)
 * @param opts   {selectorFor(nodeId) -> css selector (default .ud-e<id>)}
 */
export function animationsToCss(anims, opts = {}) {
  const selectorFor = opts.selectorFor || (id => `.${nodeClass(id)}`);
  const byEl = new Map();
  let css = '';
  for (const a of anims) {
    if (a.enabled === false || a.nodeId == null) continue;
    const frames = compileKeyframes(a);
    if (!frames.length) continue;
    css += `@keyframes ${cssName(a.id)}{${frames.map(f => `${f.offset}%{${Object.entries(f.props).map(([k, v]) => `${k}:${v}`).join(';')}}`).join('')}}\n`;
    const it = a.iterations === 'infinite' || a.iterations === 0 ? 'infinite' : (Number(a.iterations) || 1);
    const decl = `${cssName(a.id)} ${Math.max(50, a.durationMs || 1000)}ms ${a.easing || 'ease'} ${Math.max(0, a.delayMs || 0)}ms ${it} ${a.direction || 'normal'} ${a.fillMode || 'both'}`;
    const key = `${a.nodeId}|${a.trigger || 'load'}`;
    if (!byEl.has(key)) byEl.set(key, { nodeId: a.nodeId, trigger: a.trigger || 'load', decls: [], base: [] });
    byEl.get(key).decls.push(decl); byEl.get(key).base.push(baseStyle(a));
  }
  for (const { nodeId, trigger, decls, base } of byEl.values()) {
    const sel = selectorFor(nodeId);
    const sels = (trigger === 'hover' || trigger === 'mouseover') ? `${sel}:hover`
      : (trigger === 'click' || trigger === 'release' || trigger === 'drag') ? `${sel}.ud-on`
      : trigger === 'focus' ? `${sel}:focus, ${sel}:hover`
      : sel;
    css += `${sel}{${[...new Set(base.join(';').split(';'))].join(';')}}\n${sels}{animation:${decls.join(',')}}\n`;
  }
  return css;
}

export function validateAnimation(a) {
  const errors = [];
  if (!ANIMATION_TYPES.includes(a.type)) errors.push(`type must be one of ${ANIMATION_TYPES.join(', ')}`);
  if (a.trigger && !TRIGGERS.includes(a.trigger)) errors.push(`trigger must be one of ${TRIGGERS.join(', ')}`);
  if (a.durationMs !== undefined && !(a.durationMs > 0)) errors.push('durationMs must be > 0');
  return errors;
}
