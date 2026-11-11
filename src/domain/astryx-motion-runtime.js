/**
 * Meta Astryx Motion & Physics Runtime Engine for kyrpy-uiux-designer.
 *
 * Implements pure closed-form Apple/UIKit/SwiftUI spring physics, UIScrollView momentum
 * coasting, iOS rubber-band resistance, and stateful multi-channel animators.
 *
 * Can be run in Node.js (pure math) or mounted in browser contexts (DOM & RAF) via
 * `uiux_element_script` adhering to the sandboxed runtime policy.
 */

// ============================================================================
// 1. Spring Physics (Damped Harmonic Oscillator m·x″ + c·x′ + k·x = 0)
// ============================================================================

export const SPRING_PRESETS = {
  default: { duration: 0.5, bounce: 0 },
  bouncy: { duration: 0.5, bounce: 0.3 },
  snappy: { duration: 0.35, bounce: 0.15 },
  smooth: { duration: 0.6, bounce: -0.1 },
  interactive: { duration: 0.25, bounce: 0 },
  gentle: { mass: 1, stiffness: 120, damping: 14 },
  wobbly: { mass: 1, stiffness: 180, damping: 12 },
  stiff: { mass: 1, stiffness: 210, damping: 20 },
  slow: { mass: 1, stiffness: 280, damping: 60 }
};

export function springFromWWDC(duration = 0.5, bounce = 0) {
  const d = Math.max(0.01, duration);
  const mass = 1;
  const stiffness = Math.pow((2 * Math.PI) / d, 2);
  const damping = bounce >= 0
    ? ((1 - bounce) * 4 * Math.PI) / d
    : (4 * Math.PI) / (d * (1 + bounce));
  return { mass, stiffness, damping };
}

export function solveSpring({
  from = 0,
  to = 1,
  initialVelocity = 0,
  mass = 1,
  stiffness = 100,
  damping = 10,
  epsilon = 0.001
} = {}) {
  const m = Math.max(0.001, mass);
  const k = Math.max(0.001, stiffness);
  const c = Math.max(0, damping);

  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  const x0 = from - to;
  const v0 = initialVelocity;

  let valueFn, velocityFn, settlingTime;

  if (zeta < 0.999) {
    // Under-damped (oscillates around target)
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const A = x0;
    const B = (v0 + zeta * omega0 * x0) / omegaD;

    valueFn = t => {
      const decay = Math.exp(-zeta * omega0 * t);
      return to + decay * (A * Math.cos(omegaD * t) + B * Math.sin(omegaD * t));
    };

    velocityFn = t => {
      const decay = Math.exp(-zeta * omega0 * t);
      const cos = Math.cos(omegaD * t);
      const sin = Math.sin(omegaD * t);
      return decay * ((B * omegaD - A * zeta * omega0) * cos - (A * omegaD + B * zeta * omega0) * sin);
    };

    const envelope = Math.sqrt(A * A + B * B);
    settlingTime = envelope > epsilon ? Math.log(envelope / epsilon) / (zeta * omega0) : 0;
  } else if (zeta > 1.001) {
    // Over-damped (slow return without oscillation)
    const gamma1 = -omega0 * (zeta - Math.sqrt(zeta * zeta - 1));
    const gamma2 = -omega0 * (zeta + Math.sqrt(zeta * zeta - 1));
    const c2 = (v0 - gamma1 * x0) / (gamma2 - gamma1);
    const c1 = x0 - c2;

    valueFn = t => to + c1 * Math.exp(gamma1 * t) + c2 * Math.exp(gamma2 * t);
    velocityFn = t => c1 * gamma1 * Math.exp(gamma1 * t) + c2 * gamma2 * Math.exp(gamma2 * t);
    settlingTime = Math.log(Math.max(epsilon, Math.abs(x0)) / epsilon) / Math.abs(gamma1);
  } else {
    // Critically damped (fastest return without overshoot)
    const A = x0;
    const B = v0 + omega0 * x0;

    valueFn = t => to + Math.exp(-omega0 * t) * (A + B * t);
    velocityFn = t => Math.exp(-omega0 * t) * (B - omega0 * (A + B * t));
    settlingTime = Math.log(Math.max(epsilon, Math.abs(x0) + Math.abs(B)) / epsilon) / omega0;
  }

  return {
    from,
    to,
    value: valueFn,
    velocity: velocityFn,
    settlingDuration: Math.max(0.05, Math.min(10, settlingTime))
  };
}

// ============================================================================
// 2. Rubber-band Bounds Resistance (UIScrollView behavior)
// ============================================================================

export function rubberBand(overflow, dimension, coefficient = 0.55) {
  if (!(dimension > 0)) return 0;
  const x = Math.abs(overflow);
  const banded = (1 - 1 / ((x * coefficient) / dimension + 1)) * dimension;
  return overflow < 0 ? -banded : banded;
}

export function rubberBandClamp(value, min, max, dimension, coefficient = 0.55) {
  if (value < min) return min + rubberBand(value - min, dimension, coefficient);
  if (value > max) return max + rubberBand(value - max, dimension, coefficient);
  return value;
}

// ============================================================================
// 3. Momentum Deceleration Decay
// ============================================================================

export function solveDecay({ from = 0, velocity = 0, rate = 0.998 } = {}) {
  const r = Math.max(0.001, Math.min(0.999, rate));
  const lambda = -1000 * Math.log(r);
  const rest = from + velocity / lambda;
  return {
    from,
    initialVelocity: velocity,
    rate: r,
    rest,
    value: t => from + (velocity * -Math.expm1(-lambda * t)) / lambda,
    velocity: t => velocity * Math.exp(-lambda * t),
    settleTime: (threshold = 0.5) => {
      const remaining = Math.abs(velocity) / lambda;
      return remaining <= threshold ? 0 : Math.log(remaining / threshold) / lambda;
    }
  };
}

// ============================================================================
// 4. Multi-Channel Interactive Animator
// ============================================================================

export function createAnimator(element, options = {}) {
  const current = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, ...(options.initial || {}) };
  const target = { ...current };
  let rafId = null;
  let running = false;
  let activeSpring = null;
  let startTime = 0;

  function applyStyles() {
    if (!element?.style) return;
    const transform = `translate3d(${current.x.toFixed(2)}px, ${current.y.toFixed(2)}px, 0) scale(${current.scale.toFixed(4)}) rotate(${current.rotate.toFixed(2)}deg)`;
    element.style.transform = transform;
    element.style.opacity = current.opacity.toFixed(4);
  }

  function tick(timestamp) {
    if (!running) return;
    if (!startTime) startTime = timestamp;
    const t = (timestamp - startTime) / 1000;

    let allDone = true;
    for (const key of Object.keys(target)) {
      if (activeSpring && activeSpring[key]) {
        const s = activeSpring[key];
        current[key] = s.value(t);
        if (t < s.settlingDuration) allDone = false;
        else current[key] = target[key];
      }
    }

    applyStyles();

    if (allDone) {
      running = false;
      rafId = null;
      if (options.onComplete) options.onComplete(current);
    } else {
      rafId = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(tick) : null;
    }
  }

  return {
    get: () => ({ ...current }),
    animateTo: (nextTargets, springOptions = {}) => {
      Object.assign(target, nextTargets);
      const physics = springOptions.duration !== undefined
        ? springFromWWDC(springOptions.duration, springOptions.bounce ?? 0)
        : (springOptions.stiffness ? springOptions : SPRING_PRESETS.snappy);

      activeSpring = {};
      for (const [k, v] of Object.entries(nextTargets)) {
        activeSpring[k] = solveSpring({
          from: current[k],
          to: v,
          initialVelocity: 0,
          ...physics
        });
      }

      startTime = 0;
      running = true;
      if (!rafId && typeof requestAnimationFrame !== 'undefined') {
        rafId = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      running = false;
      if (rafId && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
  };
}

// ============================================================================
// 5. Standard `uiux_element_script` Mount / Unmount Interface
// ============================================================================

export function mount(container, props = {}, bridge = {}) {
  if (!container) return;
  const target = container.firstElementChild || container;
  const animator = createAnimator(target);

  const onEnter = () => animator.animateTo({ scale: 1.04, y: -3 }, { duration: 0.3, bounce: 0.2 });
  const onLeave = () => animator.animateTo({ scale: 1.0, y: 0 }, { duration: 0.35, bounce: 0 });
  const onDown = () => animator.animateTo({ scale: 0.97, y: 1 }, { duration: 0.15, bounce: 0 });

  container.addEventListener('mouseenter', onEnter);
  container.addEventListener('mouseleave', onLeave);
  container.addEventListener('mousedown', onDown);
  container.addEventListener('mouseup', onEnter);

  container.__astryxMotion = {
    animator,
    cleanup: () => {
      container.removeEventListener('mouseenter', onEnter);
      container.removeEventListener('mouseleave', onLeave);
      container.removeEventListener('mousedown', onDown);
      container.removeEventListener('mouseup', onEnter);
      animator.stop();
    }
  };

  if (bridge?.postMessage) {
    bridge.postMessage({ type: 'astryx:motion:mounted', props });
  }
}

export function unmount(container) {
  if (container?.__astryxMotion?.cleanup) {
    container.__astryxMotion.cleanup();
    delete container.__astryxMotion;
  }
}
