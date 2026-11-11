/**
 * Meta Astryx Theme Family Catalog for kyrpy-uiux-designer.
 *
 * Implements all 8 Astryx design style families with paired Dark and Light mode themes:
 *   1. Astryx Neutral     (Minimalist, quiet, content-first warm grays)
 *   2. Astryx Butter      (Creamy buttery yellows with friendly blue accents)
 *   3. Astryx Chocolate   (Rich warm browns, espresso tones & earthy luxury)
 *   4. Astryx Gothic      (Deep blue-grays, dramatic high-contrast editorial)
 *   5. Astryx Matcha      (Earthy tranquil greens, calm organic botanical)
 *   6. Astryx Probe       (Technical cyan/indigo HUD cyber terminal)
 *   7. Astryx Stone       (Warm mineral slate and architectural stone neutrals)
 *   8. Astryx Y2K         (Playful neon hot pinks, cyber lime & retro bubbly)
 *
 * Every theme has 100% token coverage, valid `kind`, surface roles, and produces
 * identical filter/gradient IDs via `buildThemeDefs()`.
 */

const SEMANTIC = {
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  purple: '#A855F7',
  teal: '#14B8A6',
  onAccent: '#FFFFFF'
};

function minimalSurfaces(cardOp = '.45', btnOp = '.55', fieldOp = '.5') {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': cardOp, 'stroke-width': '1', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': btnOp, 'stroke-width': '1', filter: null },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': fieldOp, 'stroke-width': '1', filter: null },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
  };
}

function pastelSurfaces(cardOp = '.55', btnOp = '.65', fieldOp = '.5') {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': cardOp, 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': btnOp, 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': fieldOp, 'stroke-width': '1.1', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function skeuoSurfaces(cardOp = '.65', btnOp = '.8', fieldOp = '.55') {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': cardOp, 'stroke-width': '1.4', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': btnOp, 'stroke-width': '1.5', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': fieldOp, 'stroke-width': '1.2', filter: 'url(#neuIn)' },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function brutalSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.4', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.4', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.0', filter: null },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
  };
}

function hudSurfaces(cardOp = '.82', btnOp = '.92', fieldOp = '.7') {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': cardOp, 'stroke-width': '1.5', filter: 'url(#lineGlow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': btnOp, 'stroke-width': '1.6', filter: 'url(#lineGlow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': fieldOp, 'stroke-width': '1.2', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function popRetroSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.2', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.2', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.95', 'stroke-width': '2', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

export const ASTRYX_THEMES = [
  /* ============================================================================
   * 1. Astryx Neutral (Restrained warm grays. Minimal and quiet)
   * ========================================================================== */
  {
    key: 'astryx-neutral-dark',
    name: 'Astryx Neutral (Dark)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-neutral-light', styleFamily: 'Astryx Neutral',
      bg: '#111111', surface: '#1B1B1B', text: '#FFFFFF', muted: '#B9B9B9', dim: '#919191',
      line: 'rgba(255,255,255,.08)', field: '#1B1B1B', paper: '#262626', panel: '#0D0D0D',
      stroke: 'rgba(255,255,255,.14)', accent: '#F1F1F1', accent1: '#E2E2E2', accent2: '#FFFFFF',
      hi: '#262626', lo: '#000000', sw: 1.0, button: 48, margin: 12
    },
    surfaces: minimalSurfaces('.35', '.45', '.35')
  },
  {
    key: 'astryx-neutral-light',
    name: 'Astryx Neutral (Light)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-neutral-dark', styleFamily: 'Astryx Neutral',
      bg: '#F5F5F5', surface: '#FFFFFF', text: '#0A0A0A', muted: '#525252', dim: '#737373',
      line: 'rgba(0,0,0,.08)', field: '#FFFFFF', paper: '#FFFFFF', panel: '#E5E5E5',
      stroke: 'rgba(0,0,0,.12)', accent: '#171717', accent1: '#404040', accent2: '#000000',
      hi: '#FFFFFF', lo: '#D4D4D4', sw: 1.0, button: 48, margin: 12
    },
    surfaces: minimalSurfaces('.3', '.4', '.25')
  },

  /* ============================================================================
   * 2. Astryx Butter (Warm creamy yellows with friendly blue accent)
   * ========================================================================== */
  {
    key: 'astryx-butter-dark',
    name: 'Astryx Butter (Dark)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-butter-light', styleFamily: 'Astryx Butter',
      bg: '#19150E', surface: '#241E15', text: '#FDF9EE', muted: '#C4B598', dim: '#8C7D60',
      line: 'rgba(253,230,138,.12)', field: '#1F1912', paper: '#382E20', panel: '#14100B',
      stroke: 'rgba(253,230,138,.20)', accent: '#60A5FA', accent1: '#93C5FD', accent2: '#3B82F6',
      hi: '#2D261C', lo: '#0D0B07', sw: 1.2, button: 48, margin: 12
    },
    surfaces: pastelSurfaces('.45', '.55', '.4')
  },
  {
    key: 'astryx-butter-light',
    name: 'Astryx Butter (Light)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-butter-dark', styleFamily: 'Astryx Butter',
      bg: '#FFFDF7', surface: '#FFF9E6', text: '#1F1A14', muted: '#736752', dim: '#A19379',
      line: 'rgba(180,140,50,.14)', field: '#FFFDF7', paper: '#FFF3D1', panel: '#F5E8C4',
      stroke: '#EAD7A1', accent: '#2563EB', accent1: '#3B82F6', accent2: '#1D4ED8',
      hi: '#FFFFFF', lo: '#E6D29A', sw: 1.2, button: 48, margin: 12
    },
    surfaces: pastelSurfaces('.4', '.5', '.35')
  },

  /* ============================================================================
   * 3. Astryx Chocolate (Warm rich brown espresso palette & luxury serif)
   * ========================================================================== */
  {
    key: 'astryx-chocolate-dark',
    name: 'Astryx Chocolate (Dark)',
    kind: 'skeuomorphism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-chocolate-light', styleFamily: 'Astryx Chocolate',
      bg: '#160E0B', surface: '#231712', text: '#F8F3EE', muted: '#C4AEA2', dim: '#8F776A',
      line: 'rgba(245,235,225,.08)', field: '#1B120E', paper: '#3B2820', panel: '#0F0A08',
      stroke: 'rgba(216,198,182,.18)', accent: '#D97706', accent1: '#F59E0B', accent2: '#B45309',
      hi: '#2E1E18', lo: '#0A0605', sw: 1.4, button: 52, margin: 12
    },
    surfaces: skeuoSurfaces('.55', '.7', '.45')
  },
  {
    key: 'astryx-chocolate-light',
    name: 'Astryx Chocolate (Light)',
    kind: 'skeuomorphism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-chocolate-dark', styleFamily: 'Astryx Chocolate',
      bg: '#FAF6F0', surface: '#F3ECE2', text: '#2A1810', muted: '#7B5F51', dim: '#A88C7E',
      line: 'rgba(100,50,20,.12)', field: '#FAF6F0', paper: '#EDE2D4', panel: '#E4D5C4',
      stroke: '#D8C6B6', accent: '#78350F', accent1: '#92400E', accent2: '#451A03',
      hi: '#FFFFFF', lo: '#CBB4A1', sw: 1.4, button: 52, margin: 12
    },
    surfaces: skeuoSurfaces('.5', '.65', '.4')
  },

  /* ============================================================================
   * 4. Astryx Gothic (Deep blue-grays, dramatic high-contrast editorial)
   * ========================================================================== */
  {
    key: 'astryx-gothic-dark',
    name: 'Astryx Gothic (Dark)',
    kind: 'brutalism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-gothic-light', styleFamily: 'Astryx Gothic',
      bg: '#07090E', surface: '#0E121B', text: '#F1F5F9', muted: '#94A3B8', dim: '#64748B',
      line: 'rgba(148,163,184,.14)', field: '#0B0E16', paper: '#1E2538', panel: '#05060A',
      stroke: 'rgba(148,163,184,.26)', accent: '#818CF8', accent1: '#A5B4FC', accent2: '#6366F1',
      hi: '#1A2130', lo: '#030406', sw: 2.0, button: 48, margin: 14
    },
    surfaces: brutalSurfaces()
  },
  {
    key: 'astryx-gothic-light',
    name: 'Astryx Gothic (Light)',
    kind: 'brutalism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-gothic-dark', styleFamily: 'Astryx Gothic',
      bg: '#F1F3F5', surface: '#FFFFFF', text: '#0A0D14', muted: '#4B5565', dim: '#697586',
      line: 'rgba(15,23,42,.14)', field: '#F8FAFC', paper: '#E2E8F0', panel: '#E2E8F0',
      stroke: '#0F172A', accent: '#0F172A', accent1: '#1E293B', accent2: '#020617',
      hi: '#FFFFFF', lo: '#94A3B8', sw: 2.0, button: 48, margin: 14
    },
    surfaces: brutalSurfaces()
  },

  /* ============================================================================
   * 5. Astryx Matcha (Earthy tranquil greens, calm organic botanical)
   * ========================================================================== */
  {
    key: 'astryx-matcha-dark',
    name: 'Astryx Matcha (Dark)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-matcha-light', styleFamily: 'Astryx Matcha',
      bg: '#0C140E', surface: '#142017', text: '#EFF7F0', muted: '#9EBF9F', dim: '#6B8B6C',
      line: 'rgba(163,207,178,.12)', field: '#101A12', paper: '#24382A', panel: '#080D09',
      stroke: 'rgba(163,207,178,.22)', accent: '#52B76A', accent1: '#72CB87', accent2: '#3A9650',
      hi: '#1C2E20', lo: '#050A06', sw: 1.1, button: 48, margin: 12
    },
    surfaces: pastelSurfaces('.45', '.55', '.4')
  },
  {
    key: 'astryx-matcha-light',
    name: 'Astryx Matcha (Light)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-matcha-dark', styleFamily: 'Astryx Matcha',
      bg: '#F4F8F4', surface: '#EBF3EB', text: '#142316', muted: '#4E6B52', dim: '#79997E',
      line: 'rgba(45,90,39,.12)', field: '#F4F8F4', paper: '#E1EFE1', panel: '#D5E7D6',
      stroke: '#C3D9C4', accent: '#2D5A27', accent1: '#3F7A38', accent2: '#1E3F1A',
      hi: '#FFFFFF', lo: '#B0C9B1', sw: 1.1, button: 48, margin: 12
    },
    surfaces: pastelSurfaces('.4', '.5', '.35')
  },

  /* ============================================================================
   * 6. Astryx Probe (Technical cyan/indigo HUD cyber terminal)
   * ========================================================================== */
  {
    key: 'astryx-probe-dark',
    name: 'Astryx Probe (Dark)',
    kind: 'cyberpunk',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-probe-light', styleFamily: 'Astryx Probe',
      bg: '#030712', surface: '#08101E', text: '#E0F2FE', muted: '#7DD3FC', dim: '#38BDF8',
      line: 'rgba(56,189,248,.18)', field: '#050D1A', paper: '#132644', panel: '#02040A',
      stroke: '#0284C7', accent: '#00F0FF', accent1: '#38BDF8', accent2: '#6366F1',
      hi: '#0F2444', lo: '#010206', sw: 1.4, button: 50, margin: 12
    },
    surfaces: hudSurfaces('.75', '.85', '.65')
  },
  {
    key: 'astryx-probe-light',
    name: 'Astryx Probe (Light)',
    kind: 'cyberpunk',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-probe-dark', styleFamily: 'Astryx Probe',
      bg: '#EDF2F7', surface: '#FFFFFF', text: '#0A192F', muted: '#4A607A', dim: '#728BA8',
      line: 'rgba(14,165,233,.16)', field: '#F0F6FA', paper: '#E0F2FE', panel: '#D0E4F5',
      stroke: '#BAE6FD', accent: '#0284C7', accent1: '#0EA5E9', accent2: '#0369A1',
      hi: '#FFFFFF', lo: '#A2CBE8', sw: 1.4, button: 50, margin: 12
    },
    surfaces: hudSurfaces('.65', '.75', '.55')
  },

  /* ============================================================================
   * 7. Astryx Stone (Warm mineral slate and architectural stone neutrals)
   * ========================================================================== */
  {
    key: 'astryx-stone-dark',
    name: 'Astryx Stone (Dark)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-stone-light', styleFamily: 'Astryx Stone',
      bg: '#141211', surface: '#1F1D1B', text: '#F5F5F4', muted: '#A8A29E', dim: '#78716C',
      line: 'rgba(214,211,209,.10)', field: '#191716', paper: '#383431', panel: '#0D0C0B',
      stroke: 'rgba(214,211,209,.20)', accent: '#D6D3D1', accent1: '#E7E5E4', accent2: '#A8A29E',
      hi: '#2A2624', lo: '#0A0908', sw: 1.0, button: 48, margin: 12
    },
    surfaces: minimalSurfaces('.35', '.45', '.35')
  },
  {
    key: 'astryx-stone-light',
    name: 'Astryx Stone (Light)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-stone-dark', styleFamily: 'Astryx Stone',
      bg: '#F5F5F4', surface: '#EBEAE7', text: '#1C1917', muted: '#57534E', dim: '#78716C',
      line: 'rgba(68,64,60,.12)', field: '#F5F5F4', paper: '#E7E5E4', panel: '#DDD9D5',
      stroke: '#D6D3D1', accent: '#44403C', accent1: '#57534E', accent2: '#292524',
      hi: '#FFFFFF', lo: '#C7C2BE', sw: 1.0, button: 48, margin: 12
    },
    surfaces: minimalSurfaces('.3', '.4', '.25')
  },

  /* ============================================================================
   * 8. Astryx Y2K (Playful neon hot pinks, cyber lime & retro bubbly)
   * ========================================================================== */
  {
    key: 'astryx-y2k-dark',
    name: 'Astryx Y2K (Dark)',
    kind: 'retro',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'astryx-y2k-light', styleFamily: 'Astryx Y2K',
      bg: '#130310', surface: '#20081B', text: '#FDF2F8', muted: '#F472B6', dim: '#BE185D',
      line: 'rgba(244,114,182,.18)', field: '#190615', paper: '#3F1436', panel: '#0C020A',
      stroke: '#DB2777', accent: '#FF007F', accent1: '#FF5CA8', accent2: '#A3E635',
      hi: '#2D0D27', lo: '#080106', sw: 2.0, button: 52, margin: 14
    },
    surfaces: popRetroSurfaces()
  },
  {
    key: 'astryx-y2k-light',
    name: 'Astryx Y2K (Light)',
    kind: 'retro',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'astryx-y2k-dark', styleFamily: 'Astryx Y2K',
      bg: '#FFF0F6', surface: '#FFE4F1', text: '#1F0A18', muted: '#8A4072', dim: '#B8699E',
      line: 'rgba(236,72,153,.16)', field: '#FFF0F6', paper: '#FCE7F3', panel: '#F9CEE7',
      stroke: '#FBCFE8', accent: '#EC4899', accent1: '#F472B6', accent2: '#DB2777',
      hi: '#FFFFFF', lo: '#F3A4D3', sw: 2.0, button: 52, margin: 14
    },
    surfaces: popRetroSurfaces()
  }
];

export const ASTRYX_THEME_KEYS = ASTRYX_THEMES.map(t => t.key);

/**
 * Seeds the Astryx theme catalog into a ThemeService instance idempotently.
 */
export function seedAstryxThemes(themeService) {
  const existing = new Set(themeService.list().map(t => t.key));
  let count = 0;
  for (const th of ASTRYX_THEMES) {
    if (!existing.has(th.key)) {
      themeService.create(th);
      count++;
    }
  }
  return count;
}
