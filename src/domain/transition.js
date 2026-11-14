/**
 * Screen and element transitions: how a screen or an element comes and goes at runtime.
 *
 * Every screen and element keeps four transitions in `meta.transitions`, one per navigation event:
 *   goto  - a screen is opened with "go to screen" (the screen that comes in plays it)
 *   back  - "go back" leaves this screen (the screen shown again comes in with it)
 *   open  - an element is opened as the next element / popup / drawer (the element plays it)
 *   close - the screen or element is closed (it plays it on its way out)
 * Each is { effect, duration } with the duration in SECONDS (0 = no animation).
 *
 * The same settings drive the designer's test view, the single-file project viewer and the multi-file export: exports
 * carry them as one compact attribute (`data-ud-tr`, see transitionAttr) that the self-contained `udTransition` reads.
 */

export const TRANSITION_EFFECTS = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom', 'zoom-out', 'flip'];
export const TRANSITION_EFFECT_LABELS = {
  none: 'None', fade: 'Fade', 'slide-left': 'Slide from right (to left)', 'slide-right': 'Slide from left (to right)',
  'slide-up': 'Slide up', 'slide-down': 'Slide down', zoom: 'Zoom in', 'zoom-out': 'Zoom out', flip: 'Flip'
};
export const TRANSITION_EVENTS = ['goto', 'back', 'open', 'close'];
export const TRANSITION_EVENT_LABELS = { goto: 'Go to screen', back: 'Go back', open: 'Open next element', close: 'Close' };
export const MAX_TRANSITION_SECONDS = 10;

const SCREEN_DEFAULTS = {
  goto: { effect: 'slide-left', duration: 0.3 },
  back: { effect: 'slide-right', duration: 0.3 },
  open: { effect: 'zoom', duration: 0.25 },
  close: { effect: 'none', duration: 0 }
};
const ELEMENT_DEFAULTS = {
  goto: { effect: 'slide-left', duration: 0.3 },
  back: { effect: 'slide-right', duration: 0.3 },
  open: { effect: 'zoom', duration: 0.25 },
  close: { effect: 'fade', duration: 0.2 }
};

/** Default transitions of a design type (a screen leaves without an extra close effect: the next screen's own effect shows). */
export function defaultTransitions(type = 'screen') {
  const d = type === 'element' ? ELEMENT_DEFAULTS : SCREEN_DEFAULTS;
  return Object.fromEntries(TRANSITION_EVENTS.map(k => [k, { ...d[k] }]));
}

/** Duration in seconds: a number from 0 to 10, rounded to hundredths. */
export function transitionSeconds(v, fallback = 0) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0, Math.min(MAX_TRANSITION_SECONDS, n)) * 100) / 100;
}

/** Cleans stored transitions: every event present, a known effect, a duration in seconds (defaults for anything missing). */
export function normalizeTransitions(v, type = 'screen') {
  const out = defaultTransitions(type);
  if (!v || typeof v !== 'object') return out;
  for (const k of TRANSITION_EVENTS) {
    const t = v[k];
    if (!t || typeof t !== 'object') continue;
    if (TRANSITION_EFFECTS.includes(t.effect)) out[k].effect = t.effect;
    if (t.duration != null) out[k].duration = transitionSeconds(t.duration, out[k].duration);
  }
  return out;
}

/** The transitions of a design record (screen / element) from its meta. */
export function transitionsOf(design, type) {
  return normalizeTransitions(design?.meta?.transitions, type || (design?.type === 'element' ? 'element' : 'screen'));
}

/** Compact attribute value for exports: "goto=slide-left/0.3 back=slide-right/0.3 open=zoom/0.25 close=fade/0.2". */
export function transitionAttr(transitions) {
  return TRANSITION_EVENTS.map(k => `${k}=${transitions[k].effect}/${transitions[k].duration}`).join(' ');
}

/**
 * Runtime (self-contained, no imports: it is stringified into exported pages).
 * Plays one transition on `el` with the Web Animations API and resolves when it is over (at once when there is nothing to play,
 * the browser cannot animate or the user prefers reduced motion).
 * - `spec`: { effect, duration (s) }, or the `data-ud-tr` string of the design and `event` names the entry to use
 * - `phase`: 'in' (coming) or 'out' (going)
 */
export function udTransition(el, spec, event, phase) {
  var tr = spec;
  if (typeof spec === 'string') {
    tr = null;
    var parts = spec.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var m = /^([a-z]+)=([a-z-]+)\/([\d.]+)$/.exec(parts[i]);
      if (m && m[1] === event) tr = { effect: m[2], duration: Number(m[3]) };
    }
  }
  var ms = tr ? Math.round(Number(tr.duration) * 1000) : 0;
  var reduced = false;
  try { reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  if (!el || !el.animate || !tr || !tr.effect || tr.effect === 'none' || !(ms > 0) || reduced) return Promise.resolve();
  var F = {
    fade: [{ opacity: 0 }, { opacity: 1 }],
    'slide-left': [{ transform: 'translateX(100%)', opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }],
    'slide-right': [{ transform: 'translateX(-100%)', opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }],
    'slide-up': [{ transform: 'translateY(100%)', opacity: 0.4 }, { transform: 'translateY(0)', opacity: 1 }],
    'slide-down': [{ transform: 'translateY(-100%)', opacity: 0.4 }, { transform: 'translateY(0)', opacity: 1 }],
    zoom: [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    'zoom-out': [{ transform: 'scale(1.35)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    flip: [{ transform: 'perspective(900px) rotateY(90deg)', opacity: 0 }, { transform: 'perspective(900px) rotateY(0deg)', opacity: 1 }]
  };
  var frames = F[tr.effect];
  if (!frames) return Promise.resolve();
  // going out plays the coming-in frames backwards: a slide-left screen leaves to the right it came from
  if (phase === 'out') frames = frames.slice().reverse();
  try {
    var a = el.animate(frames, { duration: ms, easing: phase === 'out' ? 'ease-in' : 'cubic-bezier(.2,.8,.2,1)', fill: phase === 'out' ? 'forwards' : 'none' });
    return new Promise(function (res) {
      var done = false, fin = function () { if (done) return; done = true; res(a); };
      a.onfinish = fin; a.oncancel = fin;
      setTimeout(fin, ms + 80);   // never wait for longer than the animation (a hidden tab pauses it)
    });
  } catch (e) { return Promise.resolve(); }
}
