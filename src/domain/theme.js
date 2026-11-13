/**
 * Theme engine (pure). A theme is data:
 *   { key, name, kind, tokens: {...}, surfaces: { role: attrs } }
 * - tokens  : named colours / numbers referenced from element attributes as {{token}} or {{token*factor}}.
 *             `sw` is the global line size: per-element sizes are stored as ratios ({{sw*0.5}}), never fixed px.
 *             `mode` ('dark' | 'light') and `pairKey` link every design style's dark and light counterparts.
 * - surfaces: attribute sets applied to nodes that carry a `role` (card, button, field, shine, bg-glow).
 *             This is what turns one stored design into any of the 15 design style families (in Dark or Light mode).
 */

export const THEME_KINDS = [
  'glass',
  'glow',
  'neu',
  'glassmorphism',
  'brutalism',
  'minimalist',
  'skeuomorphism',
  'aurora',
  'claymorphism',
  'cyberpunk',
  'synthwave',
  'pastel',
  'cosmic',
  'flat',
  'retro'
];

export const THEME_KIND_LABELS = {
  glass: 'Liquid Glass',
  glow: 'Glow Lines',
  neu: 'Neumorphism',
  glassmorphism: 'Glassmorphism',
  brutalism: 'Brutalism / Neo-Brutalism',
  minimalist: 'Minimalist',
  skeuomorphism: 'Skeuomorphism',
  aurora: 'Aurora',
  claymorphism: 'Gradient 3D Claymorphism',
  cyberpunk: 'Cyberpunk',
  synthwave: 'Synthwave',
  pastel: 'Pastel Minimal / Cozy UI',
  cosmic: 'Cosmic / Space Adventure UI',
  flat: 'Flat Playful',
  retro: 'Pop & Neon Retro UI'
};

export const SURFACE_ROLES = ['bg', 'bg-glow', 'card', 'container', 'carousel-container', 'repeater-container', 'button', 'field', 'shine', 'popup'];

/**
 * Seconds after which an element shown as a popup closes by itself: the largest `data-autoclose` of its nodes with the
 * surface role "popup" (0 = stays open).
 */
export function popupAutoCloseSecs(nodes) {
  let s = 0;
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (n?.role !== 'popup') continue;
    const v = Number(n.attrs?.['data-autoclose']);
    if (Number.isFinite(v) && v > s) s = v;
  }
  return s;
}

const SEMANTIC = {
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  purple: '#A855F7',
  teal: '#14B8A6',
  onAccent: '#FFFFFF'
};

function neuSurfaces() {
  const none = { stroke: 'none', 'stroke-opacity': null, 'stroke-width': null, 'fill-opacity': null };
  return {
    card: { ...none, fill: '{{bg}}', filter: 'url(#neuOut)' },
    button: { ...none, fill: '{{bg}}', filter: 'url(#neuSm)' },
    field: { ...none, fill: '{{bg}}', filter: 'url(#neuIn)' },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
  };
}

function glassSurfaces(cardOp = '.28', btnOp = '.32', fieldOp = '.24') {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': cardOp, 'stroke-width': '1.1', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': btnOp, 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': fieldOp, 'stroke-width': '1', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function brutalSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.6', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.6', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2.2', filter: null },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
  };
}

function minimalSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.45', 'stroke-width': '1', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.55', 'stroke-width': '1', filter: null },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.5', 'stroke-width': '1', filter: null },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
  };
}

function skeuoSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.65', 'stroke-width': '1.4', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.8', 'stroke-width': '1.5', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.55', 'stroke-width': '1.2', filter: 'url(#neuIn)' },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function auroraSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.38', 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.5', 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.32', 'stroke-width': '1', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function claySurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.35', 'stroke-width': '1.5', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.45', 'stroke-width': '1.5', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.3', 'stroke-width': '1.2', filter: 'url(#neuIn)' },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function neonHudSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.82', 'stroke-width': '1.5', filter: 'url(#lineGlow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.92', 'stroke-width': '1.6', filter: 'url(#lineGlow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.7', 'stroke-width': '1.2', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function cozyPastelSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.55', 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.65', 'stroke-width': '1.2', filter: 'url(#gShadow)' },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.5', 'stroke-width': '1.1', filter: null },
    shine: { fill: 'url(#gShine)' },
    'bg-glow': { fill: 'url(#bgGlow)' }
  };
}

function flatPlayfulSurfaces() {
  return {
    card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.9', 'stroke-width': '2', filter: null },
    button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '1', 'stroke-width': '2', filter: null },
    field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.85', 'stroke-width': '1.8', filter: null },
    shine: { display: 'none' },
    'bg-glow': { display: 'none' }
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

export const BUILTIN_THEMES = [
  /* ============================================================================
   * Existing Core Themes (Updated with Dark & Light Mode Counterparts)
   * ========================================================================== */
  {
    key: 'liquid',
    name: 'Liquid glass (Dark)',
    kind: 'glass',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'liquid-light', styleFamily: 'Liquid Glass',
      bg: '#05070F', surface: 'rgba(0,8,22,.75)', text: '#EAF4FF', muted: '#9CC6EE', dim: '#5D7896',
      line: 'rgba(130,195,255,.18)', field: 'rgba(0,8,22,.6)', paper: '#DCE3EA', panel: '#0A101D',
      stroke: '#82C3FF', accent: '#2E9BFF', accent1: '#5cb4ff', accent2: '#1a7dff',
      hi: '#FFFFFF', lo: '#000000', sw: 1.4, button: 64, margin: 12
    },
    surfaces: {
      card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.28', 'stroke-width': '1', filter: 'url(#gShadow)' },
      button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.3', 'stroke-width': '1', filter: 'url(#gShadow)' },
      field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.22', 'stroke-width': '1', filter: null },
      shine: { fill: 'url(#gShine)' },
      'bg-glow': { fill: 'url(#bgGlow)' }
    }
  },
  {
    key: 'glow',
    name: 'Glow lines (Dark)',
    kind: 'glow',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'glow-light', styleFamily: 'Glow Lines',
      bg: '#03060C', surface: '#03060C', text: '#EAF4FF', muted: '#8EBDF0', dim: '#4D6B8E',
      line: 'rgba(92,180,255,.22)', field: 'rgba(4,10,20,.65)', paper: '#141C2B', panel: '#070D19',
      stroke: '#5CB4FF', accent: '#2E9BFF', accent1: '#5CB4FF', accent2: '#1A7DFF',
      hi: '#FFFFFF', lo: '#000000', sw: 0.8, button: 64, margin: 12
    },
    surfaces: {
      card: { fill: '#050A14', 'fill-opacity': '.45', stroke: '{{stroke}}', 'stroke-opacity': '.45', 'stroke-width': '.8', filter: 'url(#lineGlow)' },
      button: { fill: '#040914', 'fill-opacity': '.38', stroke: '{{stroke}}', 'stroke-opacity': '.62', 'stroke-width': '.85', filter: 'url(#lineGlow)' },
      field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.4', 'stroke-width': '.7', filter: null },
      shine: { display: 'none' },
      'bg-glow': { display: 'none' }
    }
  },
  {
    key: 'neu-light',
    name: 'Neumorphic (Light)',
    kind: 'neu',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'neu-dark', styleFamily: 'Neumorphism',
      bg: '#E4E9F2', surface: '#E4E9F2', text: '#2B3445', muted: '#6B778C', dim: '#9AA5B8',
      line: 'rgba(120,135,160,.25)', field: '#E4E9F2', paper: '#F7F4EC', panel: '#EBEFF6',
      stroke: 'rgba(120,135,160,.25)', accent: '#4B5CF0', accent1: '#7C9BFF', accent2: '#4B5CF0',
      hi: '#FFFFFF', lo: '#A9B6CB', sw: 1.5, button: 64, margin: 12
    },
    surfaces: neuSurfaces()
  },
  {
    key: 'neu-dark',
    name: 'Neumorphic (Dark)',
    kind: 'neu',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'neu-light', styleFamily: 'Neumorphism',
      bg: '#262B34', surface: '#262B34', text: '#E6EAF2', muted: '#98A2B5', dim: '#667085',
      line: 'rgba(255,255,255,.07)', field: '#262B34', paper: '#D9D5CB', panel: '#2C323C',
      stroke: 'rgba(255,255,255,.07)', accent: '#6A7BFF', accent1: '#9DB8FF', accent2: '#6A7BFF',
      hi: '#323844', lo: '#15181D', sw: 1.5, button: 64, margin: 12
    },
    surfaces: neuSurfaces()
  },
  {
    key: 'liquid-light',
    name: 'Liquid glass (Light)',
    kind: 'glass',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'liquid', styleFamily: 'Liquid Glass',
      bg: '#EAF3FF', surface: 'rgba(255,255,255,.78)', text: '#0B192C', muted: '#3B5B84', dim: '#6C8CB5',
      line: 'rgba(30,115,220,.22)', field: 'rgba(255,255,255,.82)', paper: '#FFFFFF', panel: '#DCEBFA',
      stroke: '#3B82F6', accent: '#1D6FF2', accent1: '#3B9EFF', accent2: '#1554C0',
      hi: '#FFFFFF', lo: '#94B8E0', sw: 1.4, button: 64, margin: 12
    },
    surfaces: glassSurfaces('.36', '.42', '.3')
  },
  {
    key: 'glow-light',
    name: 'Glow lines (Light)',
    kind: 'glow',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'glow', styleFamily: 'Glow Lines',
      bg: '#F2F7FF', surface: '#FFFFFF', text: '#0A192F', muted: '#335C85', dim: '#6487AD',
      line: 'rgba(14,116,244,.28)', field: 'rgba(255,255,255,.9)', paper: '#FFFFFF', panel: '#E6F0FA',
      stroke: '#0E74F4', accent: '#0284C7', accent1: '#38BDF8', accent2: '#0369A1',
      hi: '#FFFFFF', lo: '#CBD5E1', sw: 1.0, button: 64, margin: 12
    },
    surfaces: {
      card: { fill: '#FFFFFF', 'fill-opacity': '.85', stroke: '{{stroke}}', 'stroke-opacity': '.65', 'stroke-width': '1', filter: 'url(#lineGlow)' },
      button: { fill: '#E8F3FF', 'fill-opacity': '.9', stroke: '{{stroke}}', 'stroke-opacity': '.82', 'stroke-width': '1.1', filter: 'url(#lineGlow)' },
      field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.55', 'stroke-width': '.9', filter: null },
      shine: { display: 'none' },
      'bg-glow': { display: 'none' }
    }
  },

  /* ============================================================================
   * 1. Glassmorphism (Dark & Light)
   * ========================================================================== */
  {
    key: 'glassmorphism-dark',
    name: 'Glassmorphism (Dark)',
    kind: 'glassmorphism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'glassmorphism-light', styleFamily: 'Glassmorphism',
      bg: '#0B0F24', surface: 'rgba(25,33,68,.55)', text: '#F4F7FF', muted: '#A5B4FC', dim: '#6366F1',
      line: 'rgba(255,255,255,.22)', field: 'rgba(15,23,42,.55)', paper: '#1E293B', panel: '#111836',
      stroke: '#A5B4FC', accent: '#6366F1', accent1: '#818CF8', accent2: '#38BDF8',
      hi: '#FFFFFF', lo: '#030712', sw: 1.3, button: 64, margin: 12
    },
    surfaces: glassSurfaces('.38', '.48', '.32')
  },
  {
    key: 'glassmorphism-light',
    name: 'Glassmorphism (Light)',
    kind: 'glassmorphism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'glassmorphism-dark', styleFamily: 'Glassmorphism',
      bg: '#EEF2FF', surface: 'rgba(255,255,255,.68)', text: '#1E1B4B', muted: '#4338CA', dim: '#6366F1',
      line: 'rgba(99,102,241,.24)', field: 'rgba(255,255,255,.78)', paper: '#FFFFFF', panel: '#E0E7FF',
      stroke: '#6366F1', accent: '#4F46E5', accent1: '#6366F1', accent2: '#0EA5E9',
      hi: '#FFFFFF', lo: '#C7D2FE', sw: 1.3, button: 64, margin: 12
    },
    surfaces: glassSurfaces('.42', '.52', '.36')
  },

  /* ============================================================================
   * 2. Brutalism / Neo-Brutalism (Dark & Light)
   * ========================================================================== */
  {
    key: 'brutalism-dark',
    name: 'Brutalism / Neo-Brutalism (Dark)',
    kind: 'brutalism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'brutalism-light', styleFamily: 'Brutalism / Neo-Brutalism',
      bg: '#121212', surface: '#1E1E24', text: '#FFFDF5', muted: '#FFE600', dim: '#A1A1AA',
      line: '#FFFFFF', field: '#18181B', paper: '#27272A', panel: '#18181B',
      stroke: '#FFFFFF', accent: '#FFE600', accent1: '#FF3366', accent2: '#00F5D4',
      hi: '#FFFFFF', lo: '#FFE600', sw: 2.4, button: 64, margin: 12
    },
    surfaces: brutalSurfaces()
  },
  {
    key: 'brutalism-light',
    name: 'Brutalism / Neo-Brutalism (Light)',
    kind: 'brutalism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'brutalism-dark', styleFamily: 'Brutalism / Neo-Brutalism',
      bg: '#FFFDF0', surface: '#FFFFFF', text: '#09090B', muted: '#27272A', dim: '#52525B',
      line: '#000000', field: '#FFFFFF', paper: '#FEF08A', panel: '#FDE047',
      stroke: '#000000', accent: '#FF3366', accent1: '#A3E635', accent2: '#3B82F6',
      hi: '#FFFFFF', lo: '#000000', sw: 2.4, button: 64, margin: 12
    },
    surfaces: brutalSurfaces()
  },

  /* ============================================================================
   * 3. Minimalist (Dark & Light)
   * ========================================================================== */
  {
    key: 'minimalist-dark',
    name: 'Minimalist (Dark)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'minimalist-light', styleFamily: 'Minimalist',
      bg: '#09090B', surface: '#121215', text: '#FAFAFA', muted: '#A1A1AA', dim: '#52525B',
      line: '#27272A', field: '#141418', paper: '#18181B', panel: '#0F0F12',
      stroke: '#3F3F46', accent: '#E4E4E7', accent1: '#FAFAFA', accent2: '#71717A',
      hi: '#27272A', lo: '#000000', sw: 1.1, button: 64, margin: 12
    },
    surfaces: minimalSurfaces()
  },
  {
    key: 'minimalist-light',
    name: 'Minimalist (Light)',
    kind: 'minimalist',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'minimalist-dark', styleFamily: 'Minimalist',
      bg: '#FAFAFA', surface: '#FFFFFF', text: '#09090B', muted: '#52525B', dim: '#A1A1AA',
      line: '#E4E4E7', field: '#FFFFFF', paper: '#F4F4F5', panel: '#F4F4F5',
      stroke: '#D4D4D8', accent: '#18181B', accent1: '#27272A', accent2: '#52525B',
      hi: '#FFFFFF', lo: '#E4E4E7', sw: 1.1, button: 64, margin: 12
    },
    surfaces: minimalSurfaces()
  },

  /* ============================================================================
   * 4. Skeuomorphism (Dark & Light)
   * ========================================================================== */
  {
    key: 'skeuomorphism-dark',
    name: 'Skeuomorphism (Dark)',
    kind: 'skeuomorphism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'skeuomorphism-light', styleFamily: 'Skeuomorphism',
      bg: '#1A1D24', surface: '#252A34', text: '#F3EEEA', muted: '#B8B2A6', dim: '#7D776F',
      line: '#3A404D', field: '#14171D', paper: '#2E3440', panel: '#20242D',
      stroke: '#4A5262', accent: '#D97706', accent1: '#F59E0B', accent2: '#B45309',
      hi: '#3E4656', lo: '#0B0D11', sw: 1.6, button: 64, margin: 12
    },
    surfaces: skeuoSurfaces()
  },
  {
    key: 'skeuomorphism-light',
    name: 'Skeuomorphism (Light)',
    kind: 'skeuomorphism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'skeuomorphism-dark', styleFamily: 'Skeuomorphism',
      bg: '#E6E1D6', surface: '#F4F1EA', text: '#2C2621', muted: '#665E57', dim: '#968D84',
      line: '#C7BFB3', field: '#DCD6C8', paper: '#FAF8F5', panel: '#EDE8DF',
      stroke: '#B5ACA0', accent: '#B45309', accent1: '#D97706', accent2: '#92400E',
      hi: '#FFFFFF', lo: '#B0A79B', sw: 1.6, button: 64, margin: 12
    },
    surfaces: skeuoSurfaces()
  },

  /* ============================================================================
   * 5. Aurora (Dark & Light)
   * ========================================================================== */
  {
    key: 'aurora-dark',
    name: 'Aurora (Dark)',
    kind: 'aurora',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'aurora-light', styleFamily: 'Aurora',
      bg: '#04091A', surface: 'rgba(12,24,52,.68)', text: '#ECFEFF', muted: '#67E8F9', dim: '#38BDF8',
      line: 'rgba(52,211,153,.28)', field: 'rgba(7,16,38,.7)', paper: '#0F172A', panel: '#081229',
      stroke: '#34D399', accent: '#10B981', accent1: '#06B6D4', accent2: '#A855F7',
      hi: '#A7F3D0', lo: '#020617', sw: 1.4, button: 64, margin: 12
    },
    surfaces: auroraSurfaces()
  },
  {
    key: 'aurora-light',
    name: 'Aurora (Light)',
    kind: 'aurora',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'aurora-dark', styleFamily: 'Aurora',
      bg: '#F0FDFA', surface: 'rgba(255,255,255,.78)', text: '#0F172A', muted: '#0D9488', dim: '#0284C7',
      line: 'rgba(20,184,166,.26)', field: 'rgba(255,255,255,.88)', paper: '#FFFFFF', panel: '#CCFBF1',
      stroke: '#14B8A6', accent: '#0D9488', accent1: '#06B6D4', accent2: '#8B5CF6',
      hi: '#FFFFFF', lo: '#99F6E4', sw: 1.4, button: 64, margin: 12
    },
    surfaces: auroraSurfaces()
  },

  /* ============================================================================
   * 6. Gradient 3D Claymorphism (Dark & Light)
   * ========================================================================== */
  {
    key: 'claymorphism-dark',
    name: 'Gradient 3D Claymorphism (Dark)',
    kind: 'claymorphism',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'claymorphism-light', styleFamily: 'Gradient 3D Claymorphism',
      bg: '#171329', surface: '#251E42', text: '#F5F3FF', muted: '#C4B5FD', dim: '#8B5CF6',
      line: 'rgba(196,181,253,.24)', field: '#1D1736', paper: '#2E2552', panel: '#211A3A',
      stroke: '#A78BFA', accent: '#8B5CF6', accent1: '#EC4899', accent2: '#6366F1',
      hi: '#4C3D85', lo: '#0C0918', sw: 1.6, button: 64, margin: 12
    },
    surfaces: claySurfaces()
  },
  {
    key: 'claymorphism-light',
    name: 'Gradient 3D Claymorphism (Light)',
    kind: 'claymorphism',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'claymorphism-dark', styleFamily: 'Gradient 3D Claymorphism',
      bg: '#F3EEFF', surface: '#FFFFFF', text: '#2E1065', muted: '#6D28D9', dim: '#8B5CF6',
      line: 'rgba(139,92,246,.24)', field: '#EDE9FE', paper: '#FFFFFF', panel: '#E9D5FF',
      stroke: '#A78BFA', accent: '#7C3AED', accent1: '#EC4899', accent2: '#6366F1',
      hi: '#FFFFFF', lo: '#C4B5FD', sw: 1.6, button: 64, margin: 12
    },
    surfaces: claySurfaces()
  },

  /* ============================================================================
   * 7. Cyberpunk (Dark & Light)
   * ========================================================================== */
  {
    key: 'cyberpunk-dark',
    name: 'Cyberpunk (Dark)',
    kind: 'cyberpunk',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'cyberpunk-light', styleFamily: 'Cyberpunk',
      bg: '#070510', surface: '#110D22', text: '#FCEE09', muted: '#00F0FF', dim: '#FF0055',
      line: 'rgba(0,240,255,.45)', field: '#0D0A1A', paper: '#181230', panel: '#0E0B1D',
      stroke: '#00F0FF', accent: '#FF0055', accent1: '#FCEE09', accent2: '#00F0FF',
      hi: '#FCEE09', lo: '#020106', sw: 1.5, button: 64, margin: 12
    },
    surfaces: neonHudSurfaces()
  },
  {
    key: 'cyberpunk-light',
    name: 'Cyberpunk (Light)',
    kind: 'cyberpunk',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'cyberpunk-dark', styleFamily: 'Cyberpunk',
      bg: '#F4F5F0', surface: '#FFFFFF', text: '#0B0C10', muted: '#008B99', dim: '#D90452',
      line: 'rgba(255,0,85,.4)', field: '#FFFDF0', paper: '#FCEE09', panel: '#E5E7EB',
      stroke: '#FF0055', accent: '#FF0055', accent1: '#00B4D8', accent2: '#EAB308',
      hi: '#FFFFFF', lo: '#111318', sw: 1.5, button: 64, margin: 12
    },
    surfaces: neonHudSurfaces()
  },

  /* ============================================================================
   * 8. Synthwave (Dark & Light)
   * ========================================================================== */
  {
    key: 'synthwave-dark',
    name: 'Synthwave (Dark)',
    kind: 'synthwave',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'synthwave-light', styleFamily: 'Synthwave',
      bg: '#120428', surface: '#1E093E', text: '#FFF0F8', muted: '#FF70A6', dim: '#9D4EDD',
      line: 'rgba(255,42,133,.42)', field: '#170632', paper: '#290C52', panel: '#190736',
      stroke: '#FF2A85', accent: '#FF2A85', accent1: '#FF9E00', accent2: '#00F5D4',
      hi: '#FF9E00', lo: '#080114', sw: 1.4, button: 64, margin: 12
    },
    surfaces: neonHudSurfaces()
  },
  {
    key: 'synthwave-light',
    name: 'Synthwave (Light)',
    kind: 'synthwave',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'synthwave-dark', styleFamily: 'Synthwave',
      bg: '#FFF0F7', surface: '#FFFFFF', text: '#240046', muted: '#9D4EDD', dim: '#FF4D8D',
      line: 'rgba(255,42,133,.32)', field: '#FFF8FC', paper: '#FCE7F3', panel: '#F3E8FF',
      stroke: '#EC4899', accent: '#DB2777', accent1: '#F97316', accent2: '#7C3AED',
      hi: '#FFFFFF', lo: '#FBCFE8', sw: 1.4, button: 64, margin: 12
    },
    surfaces: neonHudSurfaces()
  },

  /* ============================================================================
   * 9. Pastel Minimal / Cozy UI (Dark & Light)
   * ========================================================================== */
  {
    key: 'pastel-dark',
    name: 'Pastel Minimal / Cozy UI (Dark)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'pastel-light', styleFamily: 'Pastel Minimal / Cozy UI',
      bg: '#1E1B24', surface: '#282430', text: '#F5E6D3', muted: '#D8B4C8', dim: '#9E8FB2',
      line: 'rgba(244,162,184,.25)', field: '#231F2B', paper: '#322D3D', panel: '#24202C',
      stroke: '#F4A2B8', accent: '#F4A2B8', accent1: '#A3D9C9', accent2: '#F6BD60',
      hi: '#383244', lo: '#120F16', sw: 1.3, button: 64, margin: 12
    },
    surfaces: cozyPastelSurfaces()
  },
  {
    key: 'pastel-light',
    name: 'Pastel Minimal / Cozy UI (Light)',
    kind: 'pastel',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'pastel-dark', styleFamily: 'Pastel Minimal / Cozy UI',
      bg: '#FAF6F0', surface: '#FFFDF9', text: '#3D352E', muted: '#7A6C61', dim: '#A8998C',
      line: 'rgba(229,152,155,.35)', field: '#FFFFFF', paper: '#F7EDE2', panel: '#F5EBE0',
      stroke: '#E5989B', accent: '#E5989B', accent1: '#84A59D', accent2: '#F6BD60',
      hi: '#FFFFFF', lo: '#E6DDD3', sw: 1.3, button: 64, margin: 12
    },
    surfaces: cozyPastelSurfaces()
  },

  /* ============================================================================
   * 10. Cosmic / Space Adventure UI (Dark & Light)
   * ========================================================================== */
  {
    key: 'cosmic-dark',
    name: 'Cosmic / Space Adventure UI (Dark)',
    kind: 'cosmic',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'cosmic-light', styleFamily: 'Cosmic / Space Adventure UI',
      bg: '#050514', surface: 'rgba(16,18,48,.76)', text: '#F8FAFC', muted: '#93C5FD', dim: '#6366F1',
      line: 'rgba(124,58,237,.35)', field: 'rgba(10,12,34,.75)', paper: '#111536', panel: '#090B24',
      stroke: '#818CF8', accent: '#7C3AED', accent1: '#38BDF8', accent2: '#FBBF24',
      hi: '#FDE68A', lo: '#02020A', sw: 1.4, button: 64, margin: 12
    },
    surfaces: auroraSurfaces()
  },
  {
    key: 'cosmic-light',
    name: 'Cosmic / Space Adventure UI (Light)',
    kind: 'cosmic',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'cosmic-dark', styleFamily: 'Cosmic / Space Adventure UI',
      bg: '#EEF2FF', surface: 'rgba(255,255,255,.85)', text: '#1E1B4B', muted: '#4338CA', dim: '#6366F1',
      line: 'rgba(79,70,229,.25)', field: '#FFFFFF', paper: '#E0E7FF', panel: '#E0E7FF',
      stroke: '#6366F1', accent: '#4F46E5', accent1: '#0284C7', accent2: '#D97706',
      hi: '#FFFFFF', lo: '#C7D2FE', sw: 1.4, button: 64, margin: 12
    },
    surfaces: auroraSurfaces()
  },

  /* ============================================================================
   * 11. Flat Playful (Dark & Light)
   * ========================================================================== */
  {
    key: 'flat-dark',
    name: 'Flat Playful (Dark)',
    kind: 'flat',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'flat-light', styleFamily: 'Flat Playful',
      bg: '#181824', surface: '#242436', text: '#FFFFFF', muted: '#FFD166', dim: '#8E9AAF',
      line: '#383854', field: '#202030', paper: '#2D2D44', panel: '#1F1F30',
      stroke: '#06D6A0', accent: '#FF6B6B', accent1: '#FFD166', accent2: '#06D6A0',
      hi: '#383854', lo: '#101018', sw: 1.8, button: 64, margin: 12
    },
    surfaces: flatPlayfulSurfaces()
  },
  {
    key: 'flat-light',
    name: 'Flat Playful (Light)',
    kind: 'flat',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'flat-dark', styleFamily: 'Flat Playful',
      bg: '#FFFDF7', surface: '#FFFFFF', text: '#1D1E2C', muted: '#4A4E69', dim: '#8E9AAF',
      line: '#1D1E2C', field: '#FFF8E8', paper: '#F4F1DE', panel: '#FDF0D5',
      stroke: '#1D1E2C', accent: '#FF595E', accent1: '#FFCA3A', accent2: '#1982C4',
      hi: '#FFFFFF', lo: '#E5E5E5', sw: 1.8, button: 64, margin: 12
    },
    surfaces: flatPlayfulSurfaces()
  },

  /* ============================================================================
   * 12. Pop & Neon Retro UI (Dark & Light)
   * ========================================================================== */
  {
    key: 'retro-dark',
    name: 'Pop & Neon Retro UI (Dark)',
    kind: 'retro',
    tokens: {
      ...SEMANTIC, mode: 'dark', pairKey: 'retro-light', styleFamily: 'Pop & Neon Retro UI',
      bg: '#140D26', surface: '#21153B', text: '#FFFDF7', muted: '#CCFF00', dim: '#00E5FF',
      line: '#FF2E93', field: '#1A1030', paper: '#2B1B4D', panel: '#1C1233',
      stroke: '#CCFF00', accent: '#FF2E93', accent1: '#CCFF00', accent2: '#00E5FF',
      hi: '#CCFF00', lo: '#FF2E93', sw: 2.0, button: 64, margin: 12
    },
    surfaces: popRetroSurfaces()
  },
  {
    key: 'retro-light',
    name: 'Pop & Neon Retro UI (Light)',
    kind: 'retro',
    tokens: {
      ...SEMANTIC, mode: 'light', pairKey: 'retro-dark', styleFamily: 'Pop & Neon Retro UI',
      bg: '#FFF8E7', surface: '#FFFFFF', text: '#160F29', muted: '#6B21A8', dim: '#DB2777',
      line: '#160F29', field: '#FFFDF7', paper: '#FEF08A', panel: '#FCE7F3',
      stroke: '#160F29', accent: '#FF1E8A', accent1: '#FFE600', accent2: '#00D2FF',
      hi: '#FFFFFF', lo: '#160F29', sw: 2.0, button: 64, margin: 12
    },
    surfaces: popRetroSurfaces()
  }
];

/** Returns the dark/light counterpart key for a given theme key, if one exists. */
export function pairThemeKey(key, themes = BUILTIN_THEMES) {
  const found = themes.find(t => t.key === key);
  if (found?.tokens?.pairKey) return found.tokens.pairKey;
  if (key.endsWith('-dark')) return key.replace(/-dark$/, '-light');
  if (key.endsWith('-light')) return key.replace(/-light$/, '-dark');
  if (key === 'liquid') return 'liquid-light';
  if (key === 'glow') return 'glow-light';
  return key;
}

/** Replaces {{token}} / {{token*factor}} in a string with the theme value. Unknown tokens are left empty. */
export function resolveTokens(value, tokens) {
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  return value.replace(/\{\{\s*([a-zA-Z0-9]+)\s*(?:\*\s*(-?[\d.]+))?\s*\}\}/g, (_, name, factor) => {
    const v = tokens?.[name];
    if (v === undefined) return '';
    if (factor !== undefined && Number.isFinite(parseFloat(v))) return String(Math.round(parseFloat(v) * parseFloat(factor) * 1000) / 1000);
    return String(v);
  });
}

/** Attributes contributed by the theme for a surface role (already token-resolved). */
export function roleAttrs(theme, role) {
  const effectiveRole = (role === 'container' || role === 'carousel-container' || role === 'repeater-container' || role === 'popup') ? 'card' : role;
  const s = effectiveRole && theme?.surfaces?.[effectiveRole];
  if (!s) return {};
  const out = {};
  for (const [k, v] of Object.entries(s)) out[k] = v === null ? null : resolveTokens(v, theme.tokens);
  return out;
}

/** CSS custom properties for a theme (used in exported css and in the designer chrome). */
export function themeCssVars(theme) {
  return Object.entries(theme.tokens).map(([k, v]) => `  --ud-${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v};`).join('\n');
}

/**
 * <defs> content for a theme. Every kind defines the exact same 14 ids so a design never references a
 * missing paint: lgS gPri glow lineGlow halo blur gFill gBtn gShine gShadow bgGlow neuOut neuSm neuIn.
 */
export function buildThemeDefs(theme) {
  const t = theme.tokens || {};
  const kind = theme.kind;
  const isLight = t.mode === 'light';
  const grad = (id, stops, extra = 'x1="0" y1="0" x2="1" y2="1"') =>
    `<linearGradient id="${id}" ${extra}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ''}/>`).join('')}</linearGradient>`;
  const neu = (id, o, b) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="${b}" result="b"/><feOffset in="b" dx="${o}" dy="${o}" result="o1"/><feFlood flood-color="${t.lo || '#000'}"/><feComposite in2="o1" operator="in" result="s1"/><feOffset in="b" dx="-${o}" dy="-${o}" result="o2"/><feFlood flood-color="${t.hi || '#fff'}"/><feComposite in2="o2" operator="in" result="s2"/><feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const neuIn = `<filter id="neuIn" x="-10%" y="-10%" width="120%" height="120%"><feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="inv" stdDeviation="3" result="b"/><feOffset in="b" dx="3" dy="3" result="o1"/><feFlood flood-color="${t.lo || '#000'}"/><feComposite in2="o1" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="s1"/><feOffset in="b" dx="-3" dy="-3" result="o2"/><feFlood flood-color="${t.hi || '#fff'}"/><feComposite in2="o2" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="s2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s1"/><feMergeNode in="s2"/></feMerge></filter>`;
  const shadow = (dy, sd, a, glowA) => `<filter id="gShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#000" flood-opacity="${a}"/><feDropShadow dx="0" dy="0" stdDeviation="${sd}" flood-color="${t.accent}" flood-opacity="${glowA}"/></filter>`;
  const hardOffsetShadow = (dx, dy, color) => `<filter id="gShadow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="${dx}" dy="${dy}" stdDeviation="0" flood-color="${color}" flood-opacity="1"/></filter>`;
  const flat = (id, color) => grad(id, [[0, color], [1, color]], 'x1="0" y1="0" x2="0" y2="1"');
  const glowFilter = (sd, color, op) => `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="${sd}" result="b"/><feFlood flood-color="${color}" flood-opacity="${op}"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const d = [];

  if (kind === 'glass' || kind === 'glassmorphism') {
    d.push(grad('lgS', [[0, isLight ? t.accent : '#D4EEFF'], [0.5, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(glowFilter(1.2, t.accent, isLight ? 0.55 : 0.9));
    if (isLight) {
      d.push(`<radialGradient id="gFill" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".92"/><stop offset=".55" stop-color="#E0F2FE" stop-opacity=".76"/><stop offset="1" stop-color="#DBEAFE" stop-opacity=".86"/></radialGradient>`);
      d.push(`<radialGradient id="gBtn" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".95"/><stop offset=".5" stop-color="${t.accent1}" stop-opacity=".28"/><stop offset="1" stop-color="${t.accent}" stop-opacity=".38"/></radialGradient>`);
    } else {
      d.push(`<radialGradient id="gFill" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="${t.accent1}" stop-opacity=".30"/><stop offset=".46" stop-color="#0A3C8C" stop-opacity=".18"/><stop offset="1" stop-color="#00101A" stop-opacity=".74"/></radialGradient>`);
      d.push(`<radialGradient id="gBtn" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="${t.accent1}" stop-opacity=".46"/><stop offset=".46" stop-color="#0A3C8C" stop-opacity=".32"/><stop offset="1" stop-color="#00101A" stop-opacity=".82"/></radialGradient>`);
    }
    d.push(grad('gShine', [[0, '#fff', isLight ? 0.65 : 0.32], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'));
    d.push(shadow(8, 9, isLight ? 0.14 : 0.65, isLight ? 0.16 : 0.22));
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter>`);
    d.push(grad('gPri', [[0, t.accent1], [1, t.accent]]));
    d.push(`<radialGradient id="bgGlow" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="${t.accent1}" stop-opacity="${isLight ? '.35' : '.75'}"/><stop offset=".55" stop-color="${t.accent2}" stop-opacity="${isLight ? '.15' : '.45'}"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`);
    d.push(`<filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="${t.accent}" flood-opacity=".4"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
  } else if (kind === 'glow' || kind === 'cyberpunk' || kind === 'synthwave') {
    d.push(grad('lgS', [[0, isLight ? t.accent : '#FFF8FF'], [0.5, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent1], [1, t.accent2]]));
    d.push(glowFilter(1.5, t.accent, isLight ? 0.65 : 0.95));
    d.push(`<filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.4" flood-color="${t.accent}" flood-opacity="${isLight ? '.45' : '.7'}"/></filter>`);
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>`);
    d.push(
      grad('gFill', [[0, isLight ? '#FFFFFF' : (t.panel || '#0A0618')], [1, isLight ? (t.panel || '#F3E8FF') : (t.bg || '#050A14')]]),
      grad('gBtn', [[0, t.accent], [1, t.accent2]]),
      grad('gShine', [[0, '#fff', isLight ? 0.35 : 0.18], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'),
      `<radialGradient id="bgGlow" cx=".5" cy=".38" r=".72"><stop offset="0" stop-color="${t.accent}" stop-opacity="${isLight ? '.24' : '.55'}"/><stop offset=".55" stop-color="${t.accent2}" stop-opacity="${isLight ? '.12' : '.3'}"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`
    );
    d.push(`<filter id="gShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.6" flood-color="${t.accent}" flood-opacity=".6"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
  } else if (kind === 'brutalism' || kind === 'retro') {
    d.push(grad('lgS', [[0, t.accent], [0.5, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent], [1, t.accent1]]));
    d.push(glowFilter(0.6, t.accent, 0.75));
    d.push(`<filter id="lineGlow" x="-20%" y="-20%" width="150%" height="150%"><feDropShadow dx="3" dy="3" stdDeviation="0" flood-color="${t.lo || '#000'}" flood-opacity="1"/></filter>`);
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4"/></filter>`);
    d.push(
      flat('gFill', isLight ? '#FFFFFF' : (t.panel || '#1E1E24')),
      grad('gBtn', [[0, t.accent], [1, t.accent1]]),
      grad('gShine', [[0, '#fff', 0.22], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'),
      flat('bgGlow', t.bg)
    );
    d.push(hardOffsetShadow(4, 4, t.lo || '#000000'));
    d.push(neu('neuOut', 4, 0.5), neu('neuSm', 2, 0.5), neuIn);
  } else if (kind === 'aurora' || kind === 'cosmic') {
    d.push(grad('lgS', [[0, t.accent1], [0.5, t.accent], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent1], [0.5, t.accent], [1, t.accent2]]));
    d.push(glowFilter(1.4, t.accent1, isLight ? 0.55 : 0.88));
    d.push(
      `<linearGradient id="gFill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent1}" stop-opacity="${isLight ? '.22' : '.32'}"/><stop offset=".5" stop-color="${t.accent}" stop-opacity="${isLight ? '.16' : '.24'}"/><stop offset="1" stop-color="${t.accent2}" stop-opacity="${isLight ? '.24' : '.38'}"/></linearGradient>`,
      `<linearGradient id="gBtn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.accent1}" stop-opacity="${isLight ? '.82' : '.68'}"/><stop offset=".5" stop-color="${t.accent}" stop-opacity="${isLight ? '.78' : '.62'}"/><stop offset="1" stop-color="${t.accent2}" stop-opacity="${isLight ? '.85' : '.72'}"/></linearGradient>`,
      grad('gShine', [[0, '#fff', isLight ? 0.55 : 0.28], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'),
      `<radialGradient id="bgGlow" cx=".5" cy=".35" r=".75"><stop offset="0" stop-color="${t.accent1}" stop-opacity="${isLight ? '.38' : '.65'}"/><stop offset=".5" stop-color="${t.accent2}" stop-opacity="${isLight ? '.22' : '.42'}"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`
    );
    d.push(shadow(7, 10, isLight ? 0.14 : 0.6, 0.28));
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="11"/></filter>`);
    d.push(`<filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="${t.accent1}" flood-opacity=".5"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
  } else if (kind === 'claymorphism' || kind === 'skeuomorphism') {
    d.push(grad('lgS', [[0, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent1], [1, t.accent2]]));
    d.push(glowFilter(0.9, t.accent, 0.5));
    d.push(
      grad('gFill', [[0, isLight ? '#FFFFFF' : t.hi], [0.55, isLight ? t.panel : t.surface], [1, isLight ? t.lo : t.bg]], 'x1="0" y1="0" x2="0" y2="1"'),
      grad('gBtn', [[0, t.accent1], [0.5, t.accent], [1, t.accent2]], 'x1="0" y1="0" x2="0" y2="1"'),
      grad('gShine', [[0, '#fff', isLight ? 0.68 : 0.36], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'),
      `<radialGradient id="bgGlow" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="${t.accent1}" stop-opacity=".28"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`
    );
    d.push(`<filter id="gShadow" x="-35%" y="-35%" width="170%" height="170%"><feDropShadow dx="0" dy="8" stdDeviation="7" flood-color="${t.lo || '#000'}" flood-opacity="${isLight ? '.38' : '.68'}"/><feDropShadow dx="0" dy="-2" stdDeviation="2" flood-color="${t.hi || '#fff'}" flood-opacity=".35"/></filter>`);
    d.push(`<filter id="lineGlow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="${t.lo || '#000'}" flood-opacity=".4"/></filter>`);
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
  } else if (kind === 'minimalist' || kind === 'flat' || kind === 'pastel') {
    d.push(grad('lgS', [[0, t.accent], [1, t.accent1]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent], [1, t.accent1]]));
    d.push(glowFilter(0.5, t.accent, 0.35));
    d.push(
      flat('gFill', isLight ? '#FFFFFF' : (t.surface || t.panel || '#181824')),
      grad('gBtn', [[0, t.accent], [1, t.accent1]]),
      grad('gShine', [[0, '#fff', kind === 'pastel' ? 0.25 : 0], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'),
      `<radialGradient id="bgGlow" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="${t.accent1}" stop-opacity="${kind === 'pastel' ? '.22' : '0'}"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`
    );
    d.push(shadow(4, 6, isLight ? 0.08 : 0.32, 0.08));
    d.push(`<filter id="lineGlow"><feGaussianBlur stdDeviation="0"/></filter>`);
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="6"/></filter>`);
    d.push(neu('neuOut', 4, 4), neu('neuSm', 2, 2), neuIn);
  } else {
    d.push(grad('lgS', [[0, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent1], [1, t.accent2]]));
    d.push(`<filter id="glow"><feDropShadow dx="0" dy=".4" stdDeviation=".3" flood-color="${t.accent2}" flood-opacity=".35"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
    d.push(`<filter id="gShadow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/><feOffset in="b" dx="6" dy="6" result="o1"/><feFlood flood-color="${t.lo}"/><feComposite in2="o1" operator="in" result="s1"/><feOffset in="b" dx="-6" dy="-6" result="o2"/><feFlood flood-color="${t.hi}"/><feComposite in2="o2" operator="in" result="s2"/><feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`);
    d.push(flat('gFill', t.bg), flat('gBtn', t.bg), grad('gShine', [[0, '#fff', 0], [1, '#fff', 0]]), flat('bgGlow', t.bg));
    d.push(`<filter id="lineGlow"><feGaussianBlur stdDeviation="0"/></filter>`, `<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>`);
  }
  d.push(`<filter id="blur"><feGaussianBlur stdDeviation="6"/></filter>`);
  return d.join('');
}

/** Minimal validation used by the theme use cases. */
export function validateTheme(theme) {
  const errors = [];
  if (!theme.key) errors.push('key is required');
  if (!theme.name) errors.push('name is required');
  if (!THEME_KINDS.includes(theme.kind)) errors.push(`kind must be one of ${THEME_KINDS.join(', ')}`);
  for (const k of ['bg', 'text', 'accent', 'sw']) if (theme.tokens?.[k] === undefined) errors.push(`token "${k}" is required`);
  return errors;
}
