/**
 * Theme engine (pure). A theme is data:
 *   { key, name, kind: 'glass'|'glow'|'neu', tokens: {...}, surfaces: { role: attrs } }
 * - tokens  : named colours / numbers referenced from element attributes as {{token}} or {{token*factor}}.
 *             `sw` is the global line size: per-element sizes are stored as ratios ({{sw*0.5}}), never fixed px.
 * - surfaces: attribute sets applied to nodes that carry a `role` (card, button, field, shine, bg-glow).
 *             This is what turns one stored design into liquid glass, glow lines or neumorphic output.
 */

export const THEME_KINDS = ['glass', 'glow', 'neu'];
export const SURFACE_ROLES = ['bg', 'bg-glow', 'card', 'container', 'carousel-container', 'button', 'field', 'shine'];

const SEMANTIC = { success: '#22C55E', warning: '#F59E0B', danger: '#EF4444', info: '#3B82F6', purple: '#A855F7', teal: '#14B8A6', onAccent: '#FFFFFF' };

export const BUILTIN_THEMES = [
  {
    key: 'liquid', name: 'Liquid glass', kind: 'glass',
    tokens: { ...SEMANTIC, bg: '#05070F', surface: 'rgba(0,8,22,.75)', text: '#EAF4FF', muted: '#9CC6EE', dim: '#5D7896',
      line: 'rgba(130,195,255,.18)', field: 'rgba(0,8,22,.6)', paper: '#DCE3EA', panel: '#0A101D', stroke: '#82C3FF', accent: '#2E9BFF',
      accent1: '#5cb4ff', accent2: '#1a7dff', hi: '#FFFFFF', lo: '#000000', sw: 1.4, button: 64, margin: 12 },
    surfaces: {
      card: { fill: 'url(#gFill)', stroke: '{{stroke}}', 'stroke-opacity': '.28', 'stroke-width': '1', filter: 'url(#gShadow)' },
      button: { fill: 'url(#gBtn)', stroke: '{{stroke}}', 'stroke-opacity': '.3', 'stroke-width': '1', filter: 'url(#gShadow)' },
      field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.22', 'stroke-width': '1', filter: null },
      shine: { fill: 'url(#gShine)' },
      'bg-glow': { fill: 'url(#bgGlow)' }
    }
  },
  {
    key: 'glow', name: 'Glow lines', kind: 'glow',
    tokens: { ...SEMANTIC, bg: '#03060C', surface: '#03060C', text: '#EAF4FF', muted: '#8EBDF0', dim: '#4D6B8E',
      line: 'rgba(92,180,255,.22)', field: 'rgba(4,10,20,.65)', paper: '#141C2B', panel: '#070D19', stroke: '#5CB4FF', accent: '#2E9BFF',
      accent1: '#5CB4FF', accent2: '#1A7DFF', hi: '#FFFFFF', lo: '#000000', sw: 0.8, button: 64, margin: 12 },
    surfaces: {
      card: { fill: '#050A14', 'fill-opacity': '.45', stroke: '{{stroke}}', 'stroke-opacity': '.45', 'stroke-width': '.8', filter: 'url(#lineGlow)' },
      button: { fill: '#040914', 'fill-opacity': '.38', stroke: '{{stroke}}', 'stroke-opacity': '.62', 'stroke-width': '.85', filter: 'url(#lineGlow)' },
      field: { fill: '{{field}}', stroke: '{{stroke}}', 'stroke-opacity': '.4', 'stroke-width': '.7', filter: null },
      shine: { display: 'none' },
      'bg-glow': { display: 'none' }
    }
  },
  {
    key: 'neu-light', name: 'Neumorphic light', kind: 'neu',
    tokens: { ...SEMANTIC, bg: '#E4E9F2', surface: '#E4E9F2', text: '#2B3445', muted: '#6B778C', dim: '#9AA5B8',
      line: 'rgba(120,135,160,.25)', field: '#E4E9F2', paper: '#F7F4EC', panel: '#EBEFF6', stroke: 'rgba(120,135,160,.25)', accent: '#4B5CF0',
      accent1: '#7C9BFF', accent2: '#4B5CF0', hi: '#FFFFFF', lo: '#A9B6CB', sw: 1.5, button: 64, margin: 12 },
    surfaces: neuSurfaces()
  },
  {
    key: 'neu-dark', name: 'Neumorphic dark', kind: 'neu',
    tokens: { ...SEMANTIC, bg: '#262B34', surface: '#262B34', text: '#E6EAF2', muted: '#98A2B5', dim: '#667085',
      line: 'rgba(255,255,255,.07)', field: '#262B34', paper: '#D9D5CB', panel: '#2C323C', stroke: 'rgba(255,255,255,.07)', accent: '#6A7BFF',
      accent1: '#9DB8FF', accent2: '#6A7BFF', hi: '#323844', lo: '#15181D', sw: 1.5, button: 64, margin: 12 },
    surfaces: neuSurfaces()
  }
];

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
  const effectiveRole = (role === 'container' || role === 'carousel-container') ? 'card' : role;
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
 * <defs> content for a theme. Every kind defines the same ids so a design never references a
 * missing paint: lgS gPri glow lineGlow halo blur gFill gBtn gShine gShadow bgGlow neuOut neuSm neuIn.
 */
export function buildThemeDefs(theme) {
  const t = theme.tokens, kind = theme.kind;
  const grad = (id, stops, extra = 'x1="0" y1="0" x2="1" y2="1"') =>
    `<linearGradient id="${id}" ${extra}>${stops.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ''}/>`).join('')}</linearGradient>`;
  const neu = (id, o, b) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="${b}" result="b"/><feOffset in="b" dx="${o}" dy="${o}" result="o1"/><feFlood flood-color="${t.lo}"/><feComposite in2="o1" operator="in" result="s1"/><feOffset in="b" dx="-${o}" dy="-${o}" result="o2"/><feFlood flood-color="${t.hi}"/><feComposite in2="o2" operator="in" result="s2"/><feMerge><feMergeNode in="s1"/><feMergeNode in="s2"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const neuIn = `<filter id="neuIn" x="-10%" y="-10%" width="120%" height="120%"><feComponentTransfer in="SourceAlpha" result="inv"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="inv" stdDeviation="3" result="b"/><feOffset in="b" dx="3" dy="3" result="o1"/><feFlood flood-color="${t.lo}"/><feComposite in2="o1" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="s1"/><feOffset in="b" dx="-3" dy="-3" result="o2"/><feFlood flood-color="${t.hi}"/><feComposite in2="o2" operator="in"/><feComposite in2="SourceAlpha" operator="in" result="s2"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="s1"/><feMergeNode in="s2"/></feMerge></filter>`;
  const shadow = (dy, sd, a, glowA) => `<filter id="gShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#000" flood-opacity="${a}"/><feDropShadow dx="0" dy="0" stdDeviation="${sd}" flood-color="${t.accent}" flood-opacity="${glowA}"/></filter>`;
  const flat = (id, color) => grad(id, [[0, color], [1, color]], 'x1="0" y1="0" x2="0" y2="1"');
  const glowFilter = (sd, color, op) => `<filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceAlpha" stdDeviation="${sd}" result="b"/><feFlood flood-color="${color}" flood-opacity="${op}"/><feComposite in2="b" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  const d = [];
  if (kind === 'glass') {
    d.push(grad('lgS', [[0, '#D4EEFF'], [0.5, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(glowFilter(1.2, t.accent, 0.9));
    d.push(`<radialGradient id="gFill" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="#5AAFFF" stop-opacity=".30"/><stop offset=".46" stop-color="#0A3C8C" stop-opacity=".16"/><stop offset="1" stop-color="#00101A" stop-opacity=".72"/></radialGradient>`);
    d.push(`<radialGradient id="gBtn" cx=".28" cy=".12" r="1.2"><stop offset="0" stop-color="#5AAFFF" stop-opacity=".45"/><stop offset=".46" stop-color="#0A3C8C" stop-opacity=".3"/><stop offset="1" stop-color="#00101A" stop-opacity=".8"/></radialGradient>`);
    d.push(grad('gShine', [[0, '#fff', 0.28], [1, '#fff', 0]], 'x1="0" y1="0" x2="0" y2="1"'));
    d.push(shadow(8, 9, 0.65, 0.22));
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="10"/></filter>`);
    d.push(grad('gPri', [[0, '#7C5CFF'], [1, t.accent]]));
    d.push(`<radialGradient id="bgGlow" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#2A1A6E" stop-opacity=".85"/><stop offset=".55" stop-color="#0B1030" stop-opacity=".6"/><stop offset="1" stop-color="${t.bg}" stop-opacity="0"/></radialGradient>`);
    d.push(`<filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="${t.accent}" flood-opacity=".4"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
  } else if (kind === 'glow') {
    d.push(grad('lgS', [[0, '#E8F6FF'], [0.5, t.accent1], [1, t.accent2]], 'gradientUnits="userSpaceOnUse" x1="4" y1="3" x2="20" y2="21"'));
    d.push(grad('gPri', [[0, t.accent1], [1, t.accent2]]));
    d.push(glowFilter(1.3, '#3BA6FF', 0.95));
    d.push(`<filter id="lineGlow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="${t.accent}" flood-opacity=".55"/></filter>`);
    d.push(`<filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>`);
    d.push(flat('gFill', '#050A14'), flat('gBtn', '#040914'), grad('gShine', [[0, '#fff', 0], [1, '#fff', 0]]), flat('bgGlow', t.bg));
    d.push(`<filter id="gShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="0" stdDeviation="2.2" flood-color="${t.accent}" flood-opacity=".55"/></filter>`);
    d.push(neu('neuOut', 6, 6), neu('neuSm', 3, 3), neuIn);
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
