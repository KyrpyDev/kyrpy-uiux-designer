/**
 * Converts v1 literal colours into theme tokens so one stored design renders in every theme.
 * The v1 screens were generated per theme; we take the liquid-glass set as the canonical source and
 * classify its glass surfaces into roles (card / button / field / shine / bg-glow) that each theme restyles.
 */
const COLOR_TOKENS = {
  '#05070f': '{{bg}}', '#eaf4ff': '{{text}}', '#9cc6ee': '{{muted}}', '#5d7896': '{{dim}}',
  'rgba(0,8,22,.6)': '{{field}}', 'rgba(130,195,255,.18)': '{{line}}', 'rgba(130,195,255,.22)': '{{line}}',
  '#82c3ff': '{{stroke}}', '#2e9bff': '{{accent}}', '#dce3ea': '{{paper}}',
  '#0a101d': '{{panel}}', '#0b1222': '{{panel}}', '#070b14': '{{panel}}'
};
const ITEM_VARS = { '--el-bg': '{{surface}}', '--el-fg': '{{text}}', '--el-mut': '{{muted}}', '--el-acc': '{{accent}}', '--el-line': '{{line}}' };
const ICON_DEFAULT = { fill: 'none', stroke: 'url(#lgS)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#glow)' };

const stripSuffix = v => v.replace(/url\(#(\w+?)[QGLD]\)/g, 'url(#$1)');

export function tokenizeColor(v) {
  if (typeof v !== 'string') return v;
  const key = v.replace(/\s+/g, '').toLowerCase();
  if (COLOR_TOKENS[key]) return COLOR_TOKENS[key];
  return stripSuffix(v);
}

const STYLE_ATTRS = ['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'filter'];
const SURFACE_ROLES = { 'url(#gBtn)': 'button', 'url(#gFill)': 'card', 'url(#gShine)': 'shine', 'url(#bgGlow)': 'bg-glow' };

/** Mapper for liquid screen nodes: tokenizes colours, detects roles, normalizes icon instances. */
export function liquidScreenMapper(screenSize) {
  return (tag, attrs) => {
    const out = {};
    for (const [k, v] of Object.entries(attrs)) out[k] = tokenizeColor(v);
    let role = null;

    if (tag === 'rect') {
      const fill = out.fill;
      if (SURFACE_ROLES[fill]) role = SURFACE_ROLES[fill];
      else if (out.x === undefined && out.y === undefined && Number(out.width) === screenSize.w && Number(out.height) === screenSize.h && fill === '{{bg}}') role = 'bg';
      else if (fill === '{{field}}' && out.stroke === '{{line}}') role = 'field';
      else if (fill === '' && out.stroke === 'none') out.fill = '{{accent}}';   // unpainted primary button
      else if (fill === '' && (out.stroke === '' || out.stroke === undefined)) role = 'field';   // v1 left these input boxes unpainted (rendered black)
      if (role === 'card' || role === 'button' || role === 'field') for (const k of STYLE_ATTRS) delete out[k];
      else if (role === 'shine' || role === 'bg-glow') delete out.fill;
      if (out.x === undefined) out.x = '0';
      if (out.y === undefined) out.y = '0';
    }

    if (tag === 'use') {
      for (const [k, v] of Object.entries(ICON_DEFAULT)) if (out[k] === v) delete out[k];
      if (out['stroke-width'] !== undefined) {
        const w = parseFloat(out['stroke-width']);
        if (Number.isFinite(w)) { const r = Math.round((w / 1.4) * 1000) / 1000; out['stroke-width'] = r === 1 ? '{{sw}}' : `{{sw*${r}}}`; }
      }
    }
    // globally themed line size: any stroke-width that equals the liquid base on icon-like use is already tokenized
    return { attrs: out, role };
  };
}

/** Legacy items style their parts with var(--el-*); map those to tokens. */
export function legacyItemMapper() {
  return (tag, attrs) => {
    const out = {};
    for (const [k, v] of Object.entries(attrs)) {
      out[k] = typeof v === 'string' ? v.replace(/var\((--el-[a-z]+)\)/g, (_, n) => ITEM_VARS[n] ?? '{{text}}') : v;
      if (typeof out[k] === 'string') out[k] = stripSuffix(out[k]);
    }
    if (tag === 'use') for (const [k, v] of Object.entries(ICON_DEFAULT)) if (out[k] === v) delete out[k];
    return { attrs: out, role: null };
  };
}

/** Icon child nodes: keep geometry and paint, drop v1 helper classes (converted to names / animations). */
const ANIM_CLASSES = {
  'anim-bar': { name: 'loading', type: 'scale', params: { from: 0.08, to: 1, axis: 'x', origin: 'left' }, durationMs: 1200, direction: 'normal', delayMs: 0, easing: 'ease-in-out' },
  'anim-dot-a': { name: 'dot-a', type: 'bounce', params: { amount: 2.5 }, durationMs: 1200, direction: 'normal', delayMs: 0, easing: 'ease-in-out' },
  'anim-dot-b': { name: 'dot-b', type: 'bounce', params: { amount: 2.5 }, durationMs: 1200, direction: 'normal', delayMs: 192, easing: 'ease-in-out' },
  'anim-dot-c': { name: 'dot-c', type: 'bounce', params: { amount: 2.5 }, durationMs: 1200, direction: 'normal', delayMs: 384, easing: 'ease-in-out' },
  'anim-focus': { name: 'focus', type: 'keyframes', params: { frames: [{ offset: 0, transform: 'scale(1.08)', opacity: 0.9 }, { offset: 50, transform: 'scale(.8)', opacity: 1 }, { offset: 100, transform: 'scale(1.08)', opacity: 0.9 }] }, durationMs: 1200, direction: 'normal', delayMs: 0, easing: 'ease-in-out' },
  'anim-scan': { name: 'scan', type: 'keyframes', params: { frames: [{ offset: 0, transform: 'translateY(-3px)' }, { offset: 50, transform: 'translateY(3px)' }, { offset: 100, transform: 'translateY(-3px)' }] }, durationMs: 1200, direction: 'normal', delayMs: 0, easing: 'ease-in-out' }
};

export function iconElementMapper() {
  return (tag, attrs) => {
    const out = { ...attrs };
    const classes = String(out.class || '').split(/\s+/).filter(Boolean);
    delete out.class;
    const anim = classes.find(c => ANIM_CLASSES[c]);
    const name = classes.find(c => !c.startsWith('anim-')) || (anim ? ANIM_CLASSES[anim].name : '');
    return { attrs: out, role: null, name, animation: anim ? { ...ANIM_CLASSES[anim], iterations: 'infinite', fillMode: 'both', trigger: 'load', enabled: true } : null };
  };
}

/** Icon categories from the v1 naming scheme. */
const CATEGORY_RULES = [
  [/^sample-logo|^v[1-4]$/, 'brand'],
  [/^folder/, 'folder'],
  [/^page-|^item$|^item-/, 'page'],
  [/report|generate-reports|export-to-pdf|import-pdf|show-statistics|show-results/, 'report'],
  [/(^|-)ai(-|$)|chat-with|thinking|analyz|send-to-ai|focusing|my-ai/, 'ai'],
  [/scan|crop|rotate|camera|flash|gallery|import|save-image|delete-image|timer|document-scan|inspect|add-file|continue/, 'scan'],
  [/^(back|forward|backward|next|previous|home|menu|start|stop|pause|dropdown|close|rotating-menu|add-marker-menu)$/, 'navigation'],
  [/profile|user|^my-|login|logout|register|invite|family|kids|admin|permissions|privacy|policy|request-to-attend/, 'user'],
  [/approve|reject|decline|allow|validate|cancel|check|checked|mark-|radio|select|textbox|multi-select|vote|like|dislike|status|loading-bar|to-be-approved/, 'status'],
  [/settings|manage|plugins|extensions|modules|features|api-keys|performance|update|sync|refresh|retry|process|sub-apps|subscription|pro$|notifications|announcement|feedback|contact|survey/, 'system'],
  [/add|new|delete|edit|rename|undo|redo|reset|save|archive|share|send|publish|receive|order-by|search|star|watch|listen|eye/, 'actions']
];
export function iconCategory(key) {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(key)) return cat;
  return 'general';
}

const ELEMENT_CATEGORY = {
  'button-primary': 'buttons', 'icon-button': 'buttons', 'main-button': 'buttons', 'home-button': 'buttons', 'home-screen-3-button': 'buttons',
  'text-field': 'inputs', 'toggle': 'inputs', 'option-select': 'forms', 'config-form': 'forms', 'register-form': 'forms',
  'drawer-menu': 'navigation', 'burger-menu': 'navigation', 'left-drawer-menu': 'navigation', 'options-menu': 'navigation',
  'bottom-menu-bar-item': 'navigation', 'tab-bar': 'navigation', 'header-bar': 'navigation', 'brand-header': 'navigation', 'home-header': 'navigation', 'item-header': 'navigation',
  'status-bar': 'navigation', 'details-popup': 'surfaces', 'stats-popup': 'surfaces', 'comment-box': 'surfaces', 'card': 'surfaces', 'article-card': 'surfaces',
  'item-row': 'surfaces', 'list-row': 'surfaces', 'page-preview': 'surfaces', 'image-preview': 'surfaces', 'info-bar': 'surfaces', 'brand-background': 'surfaces', 'ad-banner': 'ads'
};
export const elementCategory = key => ELEMENT_CATEGORY[key] || 'general';

const SCREEN_CATEGORY = {
  'splash': 'auth', 'sign-in': 'auth', 'sign-up': 'auth', 'google-sign-in': 'auth',
  'item-list': 'home', 'side-menu': 'home', 'item-actions': 'home',
  'collection-complete': 'booklet', 'collection-new-items': 'booklet', 'collection-gallery': 'booklet',
  'item-detail': 'question', 'item-menu': 'question', 'item-menu-scrolled': 'question', 'item-properties': 'question',
  'item-stats': 'question', 'refresh-item-sheet': 'question', 'edit-item-settings': 'question',
  'all-comments': 'comments', 'item-comments': 'comments'
};
export const screenCategory = key => SCREEN_CATEGORY[key] || (key.startsWith('detail-') ? 'document' : 'general');

/** The v1 prototype folder still uses its original screen / element keys; the library uses the generic ones below. */
const V1_SCREEN_KEYS = {
  'ai-model-metrics': 'item-stats',
  'edit-model-config': 'edit-item-settings',
  'page-comments': 'item-comments',
  'project-comments': 'all-comments',
  'scan-list': 'item-list',
  'scan-actions': 'item-actions',
  'document-analyze': 'detail-main',
  'document-radial-actions': 'detail-radial-actions',
  'document-bottom-actions': 'detail-bottom-actions',
  'document-share-ring': 'detail-share-ring',
  'booklet-analyzed': 'collection-complete',
  'booklet-new-pages': 'collection-new-items',
  'analyzed-images': 'collection-gallery',
  're-analyze-page': 'refresh-item-sheet',
  'question-detail': 'item-detail',
  'question-menu': 'item-menu',
  'question-menu-scrolled': 'item-menu-scrolled',
  'question-parameters': 'item-properties'
};
const V1_ELEMENT_KEYS = {
  'analysis-menu': 'options-menu',
  'folder-header': 'item-header',
  'folder-row': 'item-row',
  'header-logo': 'brand-header',
  'logo-background': 'brand-background',
  'metrics-popup': 'stats-popup',
  'model-form': 'config-form',
  'model-select': 'option-select',
  'params-popup': 'details-popup',
  'question-card': 'article-card',
  'scan-preview': 'image-preview'
};
export const libraryScreenKey = key => V1_SCREEN_KEYS[key] || key;
export const libraryElementKey = key => V1_ELEMENT_KEYS[key] || key;
