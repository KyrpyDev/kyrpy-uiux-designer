/**
 * Meta Astryx Component, Button, Screen & Workflow Catalog.
 *
 * Harvested and adapted from Meta Astryx (React 19 + StyleX + Spring Motion) into the
 * kyrpy-uiux-designer pure entity architecture.
 *
 * All items use theme tokens (`{{accent}}`, `{{bg}}`, `{{card}}`, `{{text}}`, `{{muted}}`, `{{line}}`, `{{stroke}}`),
 * surface roles (`card`, `button`, `field`, `shine`), SVG nodes (`rect`, `circle`, `line`, `path`, `text`),
 * and can attach Astryx spring physics via `uiux_element_script`.
 */

const base = (tag, kind, o, attrs) => ({
  tag,
  kind,
  role: o.role ?? null,
  name: o.name ?? '',
  descriptionDev: o.dev ?? '',
  attrs,
  ...(o.anim ? { animations: o.anim } : {})
});

const R = (x, y, w, h, o = {}) => base('rect', 'shape', o, {
  x, y, width: w, height: h, rx: o.rx ?? 0,
  ...(o.role ? {} : { fill: o.fill ?? 'none', stroke: o.stroke ?? 'none', 'stroke-width': o.sw ?? 1 }),
  ...(o.op ? { opacity: o.op } : {}),
  ...(o.dash ? { 'stroke-dasharray': o.dash } : {}),
  ...(o.fo ? { 'fill-opacity': o.fo } : {}),
  ...(o.extraAttrs || {})
});

const C = (cx, cy, r, o = {}) => base('circle', 'shape', o, {
  cx, cy, r,
  ...(o.role ? {} : { fill: o.fill ?? 'none', stroke: o.stroke ?? 'none', 'stroke-width': o.sw ?? 1 }),
  ...(o.fo ? { 'fill-opacity': o.fo } : {})
});

const L = (x1, y1, x2, y2, o = {}) => base('line', 'shape', o, {
  x1, y1, x2, y2, stroke: o.stroke ?? '{{line}}',
  'stroke-width': o.sw ?? 1, 'stroke-linecap': 'round',
  ...(o.dash ? { 'stroke-dasharray': o.dash } : {})
});

const P = (d, o = {}) => base('path', 'shape', o, {
  d, fill: o.fill ?? 'none', stroke: o.stroke ?? '{{accent}}',
  'stroke-width': o.sw ?? 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
});

const T = (x, y, s, o = {}) => ({
  ...base('text', 'text', o, {
    x, y, 'font-size': o.size ?? 14,
    'font-weight': o.weight ?? 400,
    'text-anchor': o.anchor ?? 'start',
    fill: o.fill ?? '{{text}}',
    ...(o.family ? { 'font-family': o.family } : {})
  }),
  text: s
});

const item = (key, name, category, htmlTag, w, h, nodes, extra = {}) => ({
  key, name, label: name, category, htmlTag, width: w, height: h, nodes, ...extra
});

// ============================================================================
// 1. ASTRYX BUTTONS
// ============================================================================

export const ASTRYX_BUTTONS = [
  item('astryx-button-primary', 'Astryx Button Primary', 'buttons', 'button', 160, 44, [
    R(0, 0, 160, 44, { fill: '{{accent}}', rx: 10, name: 'surface' }),
    T(80, 27, 'Continue', { size: 14, weight: 600, anchor: 'middle', fill: '{{onAccent}}', name: 'label' })
  ], { dev: 'Primary action button with high-contrast accent fill.' }),

  item('astryx-button-secondary', 'Astryx Button Secondary', 'buttons', 'button', 160, 44, [
    R(0, 0, 160, 44, { role: 'button', rx: 10, name: 'surface' }),
    T(80, 27, 'Cancel', { size: 14, weight: 600, anchor: 'middle', name: 'label' })
  ], { dev: 'Secondary button using theme surface role.' }),

  item('astryx-button-ghost', 'Astryx Button Ghost', 'buttons', 'button', 140, 40, [
    R(0, 0, 140, 40, { fill: 'transparent', rx: 8, name: 'surface' }),
    T(70, 25, 'Learn more', { size: 13, weight: 500, anchor: 'middle', fill: '{{accent}}', name: 'label' })
  ], { dev: 'Ghost button for low-emphasis actions.' }),

  item('astryx-button-destructive', 'Astryx Button Destructive', 'buttons', 'button', 160, 44, [
    R(0, 0, 160, 44, { fill: '{{danger}}', rx: 10, name: 'surface' }),
    T(80, 27, 'Delete Item', { size: 14, weight: 600, anchor: 'middle', fill: '#FFFFFF', name: 'label' })
  ], { dev: 'Destructive action button.' }),

  item('astryx-icon-button', 'Astryx Icon Button', 'buttons', 'button', 44, 44, [
    R(0, 0, 44, 44, { role: 'button', rx: 22, name: 'surface' }),
    P('M14 22h16M22 14v16', { stroke: '{{accent}}', sw: 2, name: 'icon' })
  ], { dev: 'Circular icon-only button.' })
];

// ============================================================================
// 2. ASTRYX UI ELEMENTS (AI, SURFACES, NAVIGATION, CONTROLS, FEEDBACK)
// ============================================================================

export const ASTRYX_ELEMENTS = [
  /* ---- Modern AI & Chat ---- */
  item('astryx-chat-composer', 'Astryx Chat Composer', 'ai', 'div', 440, 110, [
    R(0, 0, 440, 110, { role: 'card', rx: 16, name: 'container' }),
    // Attachment chip
    R(14, 12, 160, 26, { role: 'field', rx: 13, name: 'token-chip' }),
    P('M24 25l6-6a2.8 2.8 0 014 4l-7 7a1.4 1.4 0 01-2-2l6-6', { stroke: '{{muted}}', sw: 1.2, name: 'clip-icon' }),
    T(38, 29, 'design-spec.pdf', { size: 11, weight: 500, fill: '{{text}}', name: 'chip-text' }),
    P('M160 21l6 6M166 21l-6 6', { stroke: '{{muted}}', sw: 1.2, name: 'chip-close' }),
    // Prompt input text
    T(16, 62, 'Ask AI anything... (Cmd + Enter to send)', { size: 13, fill: '{{muted}}', name: 'input-placeholder' }),
    // Bottom toolbar
    L(14, 76, 426, 76, { stroke: '{{line}}', name: 'divider' }),
    // Model selector
    R(14, 82, 120, 22, { role: 'button', rx: 11, name: 'model-selector' }),
    T(22, 97, 'Claude 3.5 Sonnet', { size: 10, weight: 600, name: 'model-name' }),
    P('M122 93l3 3 3-3', { stroke: '{{muted}}', sw: 1, name: 'model-chevron' }),
    // Mic button
    C(375, 93, 11, { role: 'button', name: 'mic-btn' }),
    P('M375 88v6M372 91a3 3 0 006 0M375 97v2', { stroke: '{{muted}}', sw: 1.2, name: 'mic-icon' }),
    // Send button
    C(410, 93, 14, { fill: '{{accent}}', name: 'send-btn' }),
    P('M406 93l4-4 4 4M410 89v8', { stroke: '{{onAccent}}', sw: 1.6, name: 'send-arrow' })
  ], { dev: 'Astryx full-featured ChatComposer with token attachments drawer and action toolbar.' }),

  item('astryx-chat-message-user', 'Astryx User Message Bubble', 'ai', 'div', 440, 60, [
    C(416, 24, 16, { fill: '{{accent1}}', name: 'avatar' }),
    T(416, 28, 'U', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'avatar-text' }),
    R(60, 4, 336, 44, { fill: '{{accent}}', rx: 14, name: 'bubble' }),
    T(76, 31, 'Generate the new Astryx navigation and dashboard.', { size: 13, weight: 500, fill: '{{onAccent}}', name: 'prompt-text' })
  ], { dev: 'User message turn in conversational transcript.' }),

  item('astryx-chat-message-assistant', 'Astryx Assistant Message Bubble', 'ai', 'div', 440, 160, [
    C(24, 24, 16, { role: 'button', name: 'avatar' }),
    P('M24 16l2 4 4 2-4 2-2 4-2-4-4-2 4-2z', { stroke: '{{accent}}', sw: 1.2, fill: '{{accent}}', fo: 0.3, name: 'sparkle-icon' }),
    R(52, 4, 372, 148, { role: 'card', rx: 14, name: 'bubble' }),
    T(68, 28, 'Astryx Agent', { size: 13, weight: 700, fill: '{{accent}}', name: 'agent-title' }),
    T(68, 52, 'I have analyzed the repo and imported 8 theme families,', { size: 12, fill: '{{text}}', name: 'line-1' }),
    T(68, 70, 'Apple spring physics equations, and 24 UI elements.', { size: 12, fill: '{{text}}', name: 'line-2' }),
    // Code snippet box
    R(68, 84, 340, 36, { role: 'field', rx: 8, name: 'code-snippet' }),
    T(80, 106, 'import { solveSpring } from "./astryx-motion";', { size: 11, family: 'monospace', fill: '{{accent}}', name: 'code-text' }),
    // Actions
    T(80, 138, 'Copy', { size: 11, weight: 600, fill: '{{muted}}', name: 'action-copy' }),
    T(130, 138, 'Retry', { size: 11, weight: 600, fill: '{{muted}}', name: 'action-retry' }),
    T(180, 138, 'Explain', { size: 11, weight: 600, fill: '{{muted}}', name: 'action-explain' })
  ], { dev: 'Assistant response turn with markdown, code snippet, and action buttons.' }),

  item('astryx-chat-tool-call', 'Astryx Tool Call Card', 'ai', 'div', 440, 72, [
    R(0, 0, 440, 72, { role: 'field', rx: 10, stroke: '{{stroke}}', sw: 1, name: 'container' }),
    P('M16 26h12v18H16z M20 22v4 M24 22v4', { stroke: '{{accent}}', sw: 1.4, name: 'tool-icon' }),
    T(36, 28, 'search_graph(query="Navigation")', { size: 12, weight: 600, fill: '{{text}}', name: 'call-signature' }),
    R(340, 16, 84, 20, { fill: '{{success}}', fo: 0.15, rx: 10, name: 'status-pill' }),
    T(382, 30, 'SUCCESS', { size: 10, weight: 700, anchor: 'middle', fill: '{{success}}', name: 'status-text' }),
    T(36, 52, 'Found 14 related nodes in 18ms. AST index verified.', { size: 11, fill: '{{muted}}', name: 'summary' })
  ], { dev: 'Collapsible execution card displaying agent tool calls.' }),

  item('astryx-command-palette', 'Astryx Command Palette', 'ai', 'div', 460, 260, [
    R(0, 0, 460, 260, { role: 'card', rx: 18, filter: 'url(#gShadow)', name: 'modal' }),
    // Search input
    P('M24 32a6 6 0 1012 0 6 6 0 00-12 0z M35 37l4 4', { stroke: '{{muted}}', sw: 1.5, name: 'search-icon' }),
    T(48, 36, 'Type a command or search items...', { size: 14, fill: '{{muted}}', name: 'search-input' }),
    R(400, 22, 38, 22, { role: 'field', rx: 6, name: 'esc-kbd' }),
    T(419, 37, 'ESC', { size: 10, weight: 700, anchor: 'middle', fill: '{{muted}}', name: 'esc-text' }),
    L(16, 54, 444, 54, { stroke: '{{line}}', name: 'divider' }),
    // Section 1
    T(20, 76, 'RECENT ACTIONS', { size: 10, weight: 700, fill: '{{muted}}', name: 'sec-1' }),
    R(16, 86, 428, 38, { fill: '{{accent}}', fo: 0.12, rx: 8, name: 'active-item' }),
    T(36, 110, 'Create new AI Chat Screen', { size: 13, weight: 600, fill: '{{accent}}', name: 'item-1' }),
    T(420, 110, '↵', { size: 14, weight: 700, anchor: 'end', fill: '{{accent}}', name: 'enter-hint' }),
    R(16, 128, 428, 36, { fill: 'transparent', rx: 8, name: 'item-row-2' }),
    T(36, 151, 'Switch Theme to Astryx Butter', { size: 13, fill: '{{text}}', name: 'item-2' }),
    // Section 2
    T(20, 186, 'NAVIGATION', { size: 10, weight: 700, fill: '{{muted}}', name: 'sec-2' }),
    R(16, 196, 428, 36, { fill: 'transparent', rx: 8, name: 'item-row-3' }),
    T(36, 219, 'Go to Analytics Dashboard', { size: 13, fill: '{{text}}', name: 'item-3' }),
    // Footer
    L(16, 238, 444, 238, { stroke: '{{line}}', name: 'divider-2' }),
    T(24, 252, 'Navigation: ↑ ↓  •  Select: ↵  •  Close: ESC', { size: 10, fill: '{{muted}}', name: 'footer-shortcuts' })
  ], { dev: 'Astryx spotlight command palette modal dialog.' }),

  item('astryx-token-chip', 'Astryx Token Chip', 'ai', 'span', 140, 32, [
    R(0, 0, 140, 32, { role: 'button', rx: 16, stroke: '{{stroke}}', sw: 1, name: 'surface' }),
    C(16, 16, 7, { fill: '{{accent}}', name: 'dot' }),
    T(32, 21, 'React 19', { size: 12, weight: 600, name: 'label' }),
    P('M120 12l8 8 M128 12l-8 8', { stroke: '{{muted}}', sw: 1.4, name: 'dismiss' })
  ], { dev: 'Token chip with status dot and dismiss action.' }),

  /* ---- Cards & Surfaces ---- */
  item('astryx-stat-card', 'Astryx Metric Stat Card', 'surfaces', 'div', 240, 120, [
    R(0, 0, 240, 120, { role: 'card', rx: 16, name: 'container' }),
    T(18, 30, 'ACTIVE USERS', { size: 11, weight: 700, fill: '{{muted}}', name: 'title' }),
    T(18, 68, '48,290', { size: 28, weight: 800, fill: '{{text}}', name: 'stat-value' }),
    R(140, 16, 82, 22, { fill: '{{success}}', fo: 0.16, rx: 11, name: 'trend-pill' }),
    P('M150 28l4-4 4 4M154 24v7', { stroke: '{{success}}', sw: 1.4, name: 'trend-arrow' }),
    T(164, 31, '+14.2%', { size: 11, weight: 700, fill: '{{success}}', name: 'trend-val' }),
    // Sparkline curve
    P('M18 100 Q 60 70, 100 85 T 180 75 T 222 92', { stroke: '{{accent}}', sw: 2, name: 'sparkline' })
  ], { dev: 'Astryx KPI analytics metric card with trend indicator and sparkline.' }),

  item('astryx-card-elevated', 'Astryx Elevated Card', 'surfaces', 'article', 320, 180, [
    R(0, 0, 320, 180, { role: 'card', rx: 18, filter: 'url(#gShadow)', name: 'surface' }),
    R(16, 16, 44, 44, { role: 'field', rx: 12, name: 'icon-box' }),
    P('M32 30l12 12M44 30l-12 12', { stroke: '{{accent}}', sw: 2, name: 'icon-shape' }),
    T(72, 36, 'Card Title Header', { size: 16, weight: 700, name: 'title' }),
    T(72, 54, 'Secondary subtitle text', { size: 12, fill: '{{muted}}', name: 'subtitle' }),
    T(20, 96, 'Rich card content describing a key product feature or', { size: 13, fill: '{{text}}', name: 'b1' }),
    T(20, 116, 'design system component with high legibility.', { size: 13, fill: '{{text}}', name: 'b2' }),
    L(16, 136, 304, 136, { stroke: '{{line}}', name: 'divider' }),
    T(20, 160, 'Read Documentation →', { size: 12, weight: 600, fill: '{{accent}}', name: 'action-link' })
  ], { dev: 'Astryx elevated content card with header, body, and action.' }),

  item('astryx-card-callout', 'Astryx Callout Card', 'surfaces', 'aside', 360, 72, [
    R(0, 0, 360, 72, { role: 'card', rx: 12, stroke: '{{accent}}', sw: 1.2, name: 'container' }),
    C(28, 36, 14, { fill: '{{accent}}', fo: 0.18, name: 'icon-bg' }),
    P('M28 28v8 M28 41v2', { stroke: '{{accent}}', sw: 2, name: 'info-glyph' }),
    T(52, 32, 'Note on Theme System', { size: 13, weight: 700, fill: '{{accent}}', name: 'callout-title' }),
    T(52, 52, 'Themes adapt surfaces dynamically using Clean Architecture tokens.', { size: 11, fill: '{{muted}}', name: 'callout-body' })
  ], { dev: 'Callout announcement / note box.' }),

  /* ---- Dialogs & Overlays ---- */
  item('astryx-alert-dialog', 'Astryx Alert Dialog', 'surfaces', 'dialog', 380, 180, [
    R(0, 0, 380, 180, { role: 'card', rx: 20, filter: 'url(#gShadow)', name: 'surface' }),
    C(36, 36, 18, { fill: '{{danger}}', fo: 0.16, name: 'warn-bg' }),
    P('M36 26v12 M36 43v2', { stroke: '{{danger}}', sw: 2.2, name: 'warn-icon' }),
    T(68, 36, 'Delete Project?', { size: 18, weight: 700, name: 'title' }),
    T(68, 56, 'This action is irreversible. All designs and versions will be purged.', { size: 12, fill: '{{muted}}', name: 'body' }),
    L(20, 120, 360, 120, { stroke: '{{line}}', name: 'divider' }),
    // Cancel button
    R(160, 132, 96, 36, { role: 'button', rx: 8, name: 'btn-cancel' }),
    T(208, 155, 'Cancel', { size: 13, weight: 600, anchor: 'middle', name: 'cancel-text' }),
    // Confirm delete button
    R(268, 132, 96, 36, { fill: '{{danger}}', rx: 8, name: 'btn-delete' }),
    T(316, 155, 'Delete', { size: 13, weight: 600, anchor: 'middle', fill: '#FFFFFF', name: 'delete-text' })
  ], { dev: 'Confirmation modal dialog with destructive action.' }),

  item('astryx-bottom-sheet', 'Astryx Bottom Sheet', 'surfaces', 'div', 360, 240, [
    R(0, 0, 360, 240, { role: 'card', rx: 24, name: 'sheet-bg' }),
    // Drag handle
    R(155, 12, 50, 5, { fill: '{{muted}}', fo: 0.5, rx: 2.5, name: 'drag-handle' }),
    T(24, 46, 'Share Design System', { size: 17, weight: 700, name: 'sheet-title' }),
    L(20, 62, 340, 62, { stroke: '{{line}}', name: 'divider' }),
    // Options list
    ...[0, 1, 2].flatMap(i => {
      const labels = ['Copy Public Link', 'Export Figma Tokens', 'Send via Email'];
      return [
        R(20, 74 + i * 48, 320, 40, { role: 'field', rx: 10, name: `opt-row-${i}` }),
        T(38, 99 + i * 48, labels[i], { size: 13, weight: 600, name: `opt-label-${i}` }),
        P(`M315 ${93 + i * 48}l5 5-5 5`, { stroke: '{{muted}}', sw: 1.4, name: `opt-arrow-${i}` })
      ];
    })
  ], { dev: 'Astryx mobile BottomSheet with gesture pull-handle and actions list.' }),

  /* ---- Controls & Navigation ---- */
  item('astryx-segmented-control', 'Astryx Segmented Control', 'inputs', 'div', 320, 42, [
    R(0, 0, 320, 42, { role: 'field', rx: 12, name: 'track' }),
    // Active pill segment
    R(4, 4, 76, 34, { fill: '{{accent}}', rx: 10, name: 'active-pill' }),
    T(42, 26, 'Day', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'seg-1' }),
    T(122, 26, 'Week', { size: 13, weight: 500, anchor: 'middle', fill: '{{muted}}', name: 'seg-2' }),
    T(202, 26, 'Month', { size: 13, weight: 500, anchor: 'middle', fill: '{{muted}}', name: 'seg-3' }),
    T(282, 26, 'Year', { size: 13, weight: 500, anchor: 'middle', fill: '{{muted}}', name: 'seg-4' })
  ], { dev: 'Sliding segmented control switcher.' }),

  item('astryx-stepper', 'Astryx Stepper', 'navigation', 'ol', 380, 52, [
    // Connecting line
    L(40, 24, 340, 24, { stroke: '{{line}}', sw: 2, name: 'step-line' }),
    // Step 1: completed
    C(40, 24, 14, { fill: '{{accent}}', name: 'step-1-bg' }),
    P('M35 24l3 3 6-6', { stroke: '{{onAccent}}', sw: 1.8, name: 'step-1-chk' }),
    T(40, 46, 'Details', { size: 10, weight: 600, anchor: 'middle', fill: '{{text}}', name: 'step-1-lbl' }),
    // Step 2: active
    C(140, 24, 14, { fill: '{{accent}}', name: 'step-2-bg' }),
    T(140, 29, '2', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'step-2-num' }),
    T(140, 46, 'Design', { size: 10, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'step-2-lbl' }),
    // Step 3: pending
    C(240, 24, 14, { role: 'field', stroke: '{{line}}', sw: 2, name: 'step-3-bg' }),
    T(240, 29, '3', { size: 12, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'step-3-num' }),
    T(240, 46, 'Review', { size: 10, weight: 500, anchor: 'middle', fill: '{{muted}}', name: 'step-3-lbl' }),
    // Step 4: pending
    C(340, 24, 14, { role: 'field', stroke: '{{line}}', sw: 2, name: 'step-4-bg' }),
    T(340, 29, '4', { size: 12, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'step-4-num' }),
    T(340, 46, 'Publish', { size: 10, weight: 500, anchor: 'middle', fill: '{{muted}}', name: 'step-4-lbl' })
  ], { dev: 'Multi-step process stepper progress bar.' }),

  item('astryx-top-nav', 'Astryx Top Navigation Bar', 'navigation', 'header', 960, 64, [
    R(0, 0, 960, 64, { role: 'card', name: 'navbar' }),
    // Logo
    R(24, 18, 28, 28, { fill: '{{accent}}', rx: 8, name: 'logo-mark' }),
    P('M32 32l6-6 6 6-6 6z', { stroke: '{{onAccent}}', sw: 1.6, fill: 'none', name: 'logo-glyph' }),
    T(62, 37, 'Astryx Studio', { size: 16, weight: 800, fill: '{{text}}', name: 'brand-title' }),
    // Nav links
    T(220, 37, 'Dashboard', { size: 13, weight: 600, fill: '{{accent}}', name: 'nav-1' }),
    T(320, 37, 'AI Playground', { size: 13, weight: 500, fill: '{{muted}}', name: 'nav-2' }),
    T(440, 37, 'Components', { size: 13, weight: 500, fill: '{{muted}}', name: 'nav-3' }),
    T(560, 37, 'Documentation', { size: 13, weight: 500, fill: '{{muted}}', name: 'nav-4' }),
    // Search trigger
    R(700, 16, 180, 32, { role: 'field', rx: 16, name: 'search-box' }),
    T(730, 36, 'Quick search (⌘K)', { size: 11, fill: '{{muted}}', name: 'search-placeholder' }),
    // Avatar
    C(920, 32, 16, { role: 'button', name: 'user-avatar' }),
    T(920, 36, 'K', { size: 12, weight: 700, anchor: 'middle', name: 'avatar-initial' })
  ], { dev: 'Application top navigation header with branding, links, search, and user profile.' }),

  item('astryx-side-nav', 'Astryx Side Navigation Bar', 'navigation', 'nav', 220, 500, [
    R(0, 0, 220, 500, { role: 'card', name: 'sidebar' }),
    // Workspace switcher
    R(16, 16, 188, 40, { role: 'field', rx: 10, name: 'workspace-btn' }),
    C(36, 36, 10, { fill: '{{accent}}', name: 'ws-badge' }),
    T(54, 40, 'Core Workspace', { size: 13, weight: 700, name: 'ws-name' }),
    P('M184 34l4 4 4-4', { stroke: '{{muted}}', sw: 1.2, name: 'ws-arrow' }),
    // Section 1
    T(20, 84, 'MAIN MENU', { size: 10, weight: 700, fill: '{{muted}}', name: 'sec-main' }),
    ...[
      ['Overview', true],
      ['AI Conversations', false],
      ['UI Components', false],
      ['Theme Styles', false],
      ['Settings', false]
    ].flatMap(([lbl, active], i) => [
      R(12, 96 + i * 40, 196, 34, { fill: active ? '{{accent}}' : 'transparent', fo: active ? 0.15 : 0, rx: 8, name: `item-bg-${i}` }),
      C(28, 113 + i * 40, 4, { fill: active ? '{{accent}}' : '{{muted}}', name: `item-dot-${i}` }),
      T(42, 118 + i * 40, lbl, { size: 13, weight: active ? 700 : 500, fill: active ? '{{accent}}' : '{{text}}', name: `item-lbl-${i}` })
    ]),
    // Bottom collapse button
    L(16, 440, 204, 440, { stroke: '{{line}}', name: 'divider' }),
    R(16, 452, 188, 36, { role: 'button', rx: 8, name: 'btn-collapse' }),
    T(110, 474, 'Collapse Sidebar', { size: 12, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'lbl-collapse' })
  ], { dev: 'Collapsible application side navigation bar.' }),

  /* ---- Data Display & Feedback ---- */
  item('astryx-data-table', 'Astryx Data Grid Table', 'surfaces', 'table', 640, 200, [
    R(0, 0, 640, 200, { role: 'card', rx: 14, name: 'container' }),
    // Table header
    R(1, 1, 638, 38, { fill: '{{accent}}', fo: 0.1, rx: 13, name: 'header-bg' }),
    T(20, 25, 'Component Name', { size: 12, weight: 700, name: 'th-1' }),
    T(240, 25, 'Category', { size: 12, weight: 700, name: 'th-2' }),
    T(380, 25, 'Status', { size: 12, weight: 700, name: 'th-3' }),
    T(520, 25, 'Version', { size: 12, weight: 700, name: 'th-4' }),
    // Rows
    ...[
      ['ChatComposer', 'AI Conversation', 'Verified', 'v2.4.0'],
      ['CommandPalette', 'Navigation', 'Ready', 'v1.8.2'],
      ['SpringAnimator', 'Motion Physics', 'Beta', 'v0.9.1']
    ].flatMap((row, r) => [
      L(16, 40 + r * 46, 624, 40 + r * 46, { stroke: '{{line}}', name: `row-div-${r}` }),
      T(20, 68 + r * 46, row[0], { size: 13, weight: 600, fill: '{{accent}}', name: `cell-name-${r}` }),
      T(240, 68 + r * 46, row[1], { size: 12, fill: '{{muted}}', name: `cell-cat-${r}` }),
      R(376, 53 + r * 46, 76, 22, { fill: '{{success}}', fo: 0.15, rx: 11, name: `badge-bg-${r}` }),
      T(414, 68 + r * 46, row[2], { size: 11, weight: 700, anchor: 'middle', fill: '{{success}}', name: `badge-txt-${r}` }),
      T(520, 68 + r * 46, row[3], { size: 12, family: 'monospace', fill: '{{text}}', name: `cell-ver-${r}` })
    ]),
    // Pagination footer
    L(16, 178, 624, 178, { stroke: '{{line}}', name: 'div-foot' }),
    T(20, 192, 'Showing 1-3 of 174 components', { size: 11, fill: '{{muted}}', name: 'foot-count' }),
    T(610, 192, 'Page 1 of 58  ›', { size: 11, weight: 600, anchor: 'end', fill: '{{accent}}', name: 'foot-page' })
  ], { dev: 'Astryx rich data table with sortable columns, status pills, and pagination.' }),

  item('astryx-toast', 'Astryx Feedback Toast', 'feedback', 'div', 320, 54, [
    R(0, 0, 320, 54, { role: 'card', rx: 14, filter: 'url(#gShadow)', name: 'surface' }),
    C(26, 27, 12, { fill: '{{success}}', fo: 0.2, name: 'check-bg' }),
    P('M21 27l3 3 7-7', { stroke: '{{success}}', sw: 2, name: 'check-glyph' }),
    T(48, 32, 'Changes saved successfully', { size: 13, weight: 600, name: 'toast-msg' }),
    P('M292 22l8 8 M300 22l-8 8', { stroke: '{{muted}}', sw: 1.4, name: 'toast-close' }),
    // Progress line at bottom
    R(12, 50, 296, 2, { fill: '{{line}}', name: 'prog-track' }),
    R(12, 50, 180, 2, { fill: '{{success}}', name: 'prog-fill' })
  ], { dev: 'Floating notification toast with auto-dismiss progress bar.' }),

  item('astryx-banner', 'Astryx Announcement Banner', 'feedback', 'div', 800, 48, [
    R(0, 0, 800, 48, { fill: '{{accent}}', fo: 0.12, stroke: '{{accent}}', sw: 1, rx: 12, name: 'bg' }),
    C(28, 24, 10, { fill: '{{accent}}', name: 'icon-bg' }),
    T(28, 28, '!', { size: 11, weight: 800, anchor: 'middle', fill: '{{onAccent}}', name: 'icon-glyph' }),
    T(52, 29, 'Meta Astryx Design System v1.0 is now open source. Explore all UI blocks and styles.', { size: 13, weight: 600, fill: '{{text}}', name: 'msg' }),
    R(640, 10, 110, 28, { fill: '{{accent}}', rx: 8, name: 'cta-btn' }),
    T(695, 28, 'Get Started', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'cta-lbl' }),
    P('M774 19l8 8 M782 19l-8 8', { stroke: '{{muted}}', sw: 1.4, name: 'close-btn' })
  ], { dev: 'Full-width top announcement banner with call to action.' })
];

// ============================================================================
// 3. ASTRYX FLAGSHIP SCREEN TEMPLATES
// ============================================================================

export const ASTRYX_SCREENS = [
  /* --------------------------------------------------------------------------
   * 1. Astryx AI Chat Screen (1280x800)
   * ------------------------------------------------------------------------ */
  {
    key: 'astryx-screen-ai-chat',
    name: 'Astryx AI Chat Studio',
    label: 'AI Chat Studio',
    category: 'ai',
    width: 1280,
    height: 800,
    meta: { device: 'desktop-1280', template: 'ai-chat', source: 'astryx/templates/pages/ai-chat' },
    descriptionDev: 'Flagship conversational coding & assistant layout with thread sidebar, streaming transcript, and composer.',
    nodes: [
      // Background canvas
      R(0, 0, 1280, 800, { fill: '{{bg}}', name: 'page-bg' }),
      // Top Nav
      R(0, 0, 1280, 60, { role: 'card', name: 'top-nav' }),
      T(28, 36, 'Astryx AI Assistant', { size: 16, weight: 800, fill: '{{text}}', name: 'brand' }),
      R(200, 14, 180, 32, { role: 'field', rx: 16, name: 'search' }),
      T(220, 34, 'Search chats...', { size: 12, fill: '{{muted}}', name: 'search-text' }),
      // Left Sidebar (History & Prompts)
      R(0, 60, 260, 740, { role: 'card', name: 'sidebar' }),
      T(20, 96, 'RECENT CHATS', { size: 11, weight: 700, fill: '{{muted}}', name: 'hist-title' }),
      ...['Design system architecture', 'Optimize spring physics', 'Port Astryx to Kyrpy', 'Database schema migrations'].map((c, i) =>
        T(20, 130 + i * 36, c, { size: 13, weight: i === 0 ? 700 : 500, fill: i === 0 ? '{{accent}}' : '{{text}}', name: `chat-${i}` })
      ),
      // Main Chat Transcript
      R(260, 60, 680, 740, { fill: '{{bg}}', name: 'transcript-container' }),
      // Assistant Welcome Message
      R(290, 90, 620, 80, { role: 'card', rx: 14, name: 'welcome-card' }),
      T(310, 120, 'Welcome to Astryx Studio', { size: 16, weight: 700, fill: '{{accent}}', name: 'welcome-title' }),
      T(310, 146, 'Select a design style, explore UI components, or generate screen layouts.', { size: 13, fill: '{{muted}}', name: 'welcome-desc' }),
      // User Turn
      R(450, 190, 460, 54, { fill: '{{accent}}', rx: 14, name: 'user-bubble' }),
      T(470, 222, 'Can you import the Astryx design tokens and components?', { size: 13, weight: 500, fill: '{{onAccent}}', name: 'user-txt' }),
      // Assistant Turn with tool call
      R(290, 260, 620, 200, { role: 'card', rx: 14, name: 'assistant-bubble' }),
      T(310, 290, 'Astryx Core Agent', { size: 14, weight: 700, fill: '{{accent}}', name: 'agent-lbl' }),
      T(310, 314, 'Importing completed. All 8 theme families and 24 UI elements are available:', { size: 13, fill: '{{text}}', name: 'agent-body' }),
      // Tool Call execution card
      R(310, 332, 580, 64, { role: 'field', rx: 10, stroke: '{{stroke}}', sw: 1, name: 'tool-card' }),
      T(330, 356, 'Executed: seedAstryxThemes() -> 16 themes registered', { size: 12, weight: 600, fill: '{{accent}}', name: 'tool-sig' }),
      T(330, 380, 'Status: Verified. Zero warnings. Clean architecture compliant.', { size: 11, fill: '{{muted}}', name: 'tool-out' }),
      T(310, 432, 'You can preview any element or switch to any of the 8 design styles.', { size: 13, fill: '{{text}}', name: 'agent-foot' }),
      // Chat Composer at bottom
      R(290, 660, 620, 110, { role: 'card', rx: 16, name: 'composer-box' }),
      T(314, 700, 'Reply to Astryx Assistant... (Cmd + Enter)', { size: 13, fill: '{{muted}}', name: 'composer-ph' }),
      L(304, 726, 896, 726, { stroke: '{{line}}', name: 'composer-line' }),
      T(314, 750, 'Model: Claude 3.5 Sonnet', { size: 11, weight: 600, fill: '{{accent}}', name: 'model-pill' }),
      C(880, 746, 14, { fill: '{{accent}}', name: 'send-btn' }),
      P('M876 746l4-4 4 4M880 742v8', { stroke: '{{onAccent}}', sw: 1.6, name: 'send-ico' }),
      // Right Inspector / Artifact Panel (340px)
      R(940, 60, 340, 740, { role: 'card', name: 'artifact-panel' }),
      T(964, 96, 'ARTIFACT INSPECTOR', { size: 11, weight: 700, fill: '{{muted}}', name: 'art-title' }),
      R(960, 114, 300, 160, { role: 'field', rx: 12, name: 'preview-box' }),
      T(980, 146, 'astryx-theme-catalog.js', { size: 13, weight: 700, fill: '{{accent}}', name: 'art-file' }),
      T(980, 172, '16 themes: Neutral, Butter,', { size: 12, fill: '{{text}}', name: 'art-l1' }),
      T(980, 192, 'Chocolate, Gothic, Matcha,', { size: 12, fill: '{{text}}', name: 'art-l2' }),
      T(980, 212, 'Probe, Stone, Y2K', { size: 12, fill: '{{text}}', name: 'art-l3' }),
      T(980, 246, 'Checksum: sha256:verified', { size: 11, family: 'monospace', fill: '{{muted}}', name: 'art-ck' })
    ]
  },

  /* --------------------------------------------------------------------------
   * 2. Astryx Analytics Dashboard Screen (1280x800)
   * ------------------------------------------------------------------------ */
  {
    key: 'astryx-screen-dashboard',
    name: 'Astryx Analytics Dashboard',
    label: 'Analytics Dashboard',
    category: 'dashboard',
    width: 1280,
    height: 800,
    meta: { device: 'desktop-1280', template: 'dashboard', source: 'astryx/templates/pages/dashboard' },
    descriptionDev: 'Three-band analytics overview with headline tiles, charts, and data grid table.',
    nodes: [
      R(0, 0, 1280, 800, { fill: '{{bg}}', name: 'bg' }),
      // Top Navigation
      R(0, 0, 1280, 64, { role: 'card', name: 'nav' }),
      T(32, 38, 'Astryx Analytics Console', { size: 18, weight: 800, fill: '{{text}}', name: 'title' }),
      T(320, 38, 'Overview', { size: 13, weight: 700, fill: '{{accent}}', name: 'nav-1' }),
      T(420, 38, 'Reports', { size: 13, weight: 500, fill: '{{muted}}', name: 'nav-2' }),
      T(520, 38, 'Realtime', { size: 13, weight: 500, fill: '{{muted}}', name: 'nav-3' }),
      // Filter bar
      R(32, 84, 1216, 44, { role: 'card', rx: 10, name: 'filter-bar' }),
      T(52, 110, 'Timeframe: Last 30 Days  ▾', { size: 12, weight: 600, fill: '{{text}}', name: 'f1' }),
      T(240, 110, 'Segment: All Traffic  ▾', { size: 12, weight: 600, fill: '{{text}}', name: 'f2' }),
      T(420, 110, 'Region: Global  ▾', { size: 12, weight: 600, fill: '{{text}}', name: 'f3' }),
      // Band 1: 4 Metric Cards
      ...[
        ['TOTAL REVENUE', '$184,240', '+18.4%'],
        ['ACTIVE SESSIONS', '34,920', '+9.2%'],
        ['CONVERSION RATE', '3.42%', '+0.8%'],
        ['AVERAGE ORDER', '$82.50', '+4.1%']
      ].flatMap(([ttl, val, trnd], i) => [
        R(32 + i * 312, 148, 290, 110, { role: 'card', rx: 14, name: `kpi-${i}` }),
        T(52 + i * 312, 178, ttl, { size: 11, weight: 700, fill: '{{muted}}', name: `kpi-ttl-${i}` }),
        T(52 + i * 312, 218, val, { size: 26, weight: 800, fill: '{{text}}', name: `kpi-val-${i}` }),
        T(240 + i * 312, 178, trnd, { size: 11, weight: 700, fill: '{{success}}', name: `kpi-trnd-${i}` })
      ]),
      // Band 2: Charts & Graphs
      R(32, 280, 800, 260, { role: 'card', rx: 16, name: 'chart-card' }),
      T(56, 314, 'Revenue & Conversion Trajectory', { size: 16, weight: 700, name: 'chart-title' }),
      P('M56 480 Q 200 380, 360 420 T 600 340 T 780 390', { stroke: '{{accent}}', sw: 3, name: 'chart-line' }),
      // Breakdown Chart Card
      R(856, 280, 392, 260, { role: 'card', rx: 16, name: 'breakdown-card' }),
      T(880, 314, 'Channel Distribution', { size: 16, weight: 700, name: 'breakdown-title' }),
      C(1052, 420, 60, { stroke: '{{accent}}', sw: 16, name: 'donut-chart' }),
      // Band 3: Data Table
      R(32, 560, 1216, 210, { role: 'card', rx: 16, name: 'table-card' }),
      T(56, 594, 'Recent High-Value Transactions', { size: 15, weight: 700, name: 'table-title' }),
      ...[
        ['Order #8921', 'Enterprise Team License', '$4,800', 'Completed'],
        ['Order #8922', 'Studio Pro Cloud Tier', '$1,200', 'Completed'],
        ['Order #8923', 'Custom Design Extension', '$650', 'Processing']
      ].flatMap(([ord, desc, amt, st], r) => [
        L(56, 610 + r * 44, 1200, 610 + r * 44, { stroke: '{{line}}', name: `t-line-${r}` }),
        T(56, 638 + r * 44, ord, { size: 13, weight: 600, fill: '{{accent}}', name: `t-ord-${r}` }),
        T(300, 638 + r * 44, desc, { size: 13, fill: '{{text}}', name: `t-desc-${r}` }),
        T(700, 638 + r * 44, amt, { size: 13, weight: 700, fill: '{{text}}', name: `t-amt-${r}` }),
        T(1080, 638 + r * 44, st, { size: 12, weight: 600, fill: '{{success}}', name: `t-st-${r}` })
      ])
    ]
  },

  /* --------------------------------------------------------------------------
   * 3. Astryx Canvas Editor Screen (1280x800)
   * ------------------------------------------------------------------------ */
  {
    key: 'astryx-screen-canvas-editor',
    name: 'Astryx Canvas Design Studio',
    label: 'Canvas Design Studio',
    category: 'editor',
    width: 1280,
    height: 800,
    meta: { device: 'desktop-1280', template: 'canvas-editor', source: 'astryx/templates/pages/canvas-editor' },
    descriptionDev: 'Creative canvas studio with top toolbar, left layer hierarchy, infinite canvas, and inspector.',
    nodes: [
      R(0, 0, 1280, 800, { fill: '{{bg}}', name: 'bg' }),
      // Top Toolbar
      R(0, 0, 1280, 52, { role: 'card', name: 'toolbar' }),
      T(24, 32, 'Astryx Vector Canvas', { size: 15, weight: 800, fill: '{{text}}', name: 'tool-title' }),
      R(240, 10, 240, 32, { role: 'field', rx: 8, name: 'tool-group' }),
      T(260, 31, 'Select  │  Pen  │  Rect  │  Text  │  Icon', { size: 12, weight: 600, fill: '{{accent}}', name: 'tools' }),
      // Zoom & Export Actions
      T(1120, 31, '100% ▾', { size: 12, weight: 600, fill: '{{muted}}', name: 'zoom' }),
      R(1180, 10, 80, 32, { fill: '{{accent}}', rx: 8, name: 'btn-export' }),
      T(1220, 30, 'Export', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'lbl-exp' }),
      // Left Layers & Tree Panel
      R(0, 52, 240, 748, { role: 'card', name: 'left-panel' }),
      T(20, 80, 'LAYERS & ASSETS', { size: 11, weight: 700, fill: '{{muted}}', name: 'layers-title' }),
      ...['Frame: Artboard 1', 'Group: Navigation Bar', 'Shape: Primary Button', 'Text: Headline', 'Vector: Brand Logo'].map((l, i) =>
        T(20, 114 + i * 36, l, { size: 12, weight: i === 0 ? 700 : 500, fill: i === 0 ? '{{accent}}' : '{{text}}', name: `layer-${i}` })
      ),
      // Canvas Work Area with Grid Artboard
      R(340, 120, 540, 580, { role: 'card', rx: 16, filter: 'url(#gShadow)', name: 'artboard' }),
      T(360, 150, 'Desktop Artboard (1440 × 900)', { size: 14, weight: 700, fill: '{{muted}}', name: 'artboard-lbl' }),
      R(370, 180, 480, 80, { role: 'field', rx: 12, name: 'mock-hero' }),
      T(420, 226, 'Hero Container with Spring Motion', { size: 15, weight: 700, fill: '{{accent}}', name: 'hero-txt' }),
      // Right Properties Inspector Panel
      R(1000, 52, 280, 748, { role: 'card', name: 'inspector' }),
      T(1024, 80, 'PROPERTIES', { size: 11, weight: 700, fill: '{{muted}}', name: 'insp-title' }),
      T(1024, 114, 'Width: 540 px    Height: 580 px', { size: 12, fill: '{{text}}', name: 'insp-dim' }),
      T(1024, 144, 'Fill: url(#gFill)', { size: 12, fill: '{{accent}}', name: 'insp-fill' }),
      T(1024, 174, 'Corner Radius: 16 px', { size: 12, fill: '{{text}}', name: 'insp-rx' }),
      T(1024, 204, 'Motion: Bouncy Spring (0.5s / 0.3)', { size: 12, weight: 600, fill: '{{success}}', name: 'insp-motion' })
    ]
  },

  /* --------------------------------------------------------------------------
   * 4. Astryx Form Wizard Screen (1280x800)
   * ------------------------------------------------------------------------ */
  {
    key: 'astryx-screen-form-wizard',
    name: 'Astryx Multi-Step Form Wizard',
    label: 'Form Wizard Flow',
    category: 'forms',
    width: 1280,
    height: 800,
    meta: { device: 'desktop-1280', template: 'form-wizard', source: 'astryx/templates/pages/form-wizard' },
    descriptionDev: 'Multi-step transactional onboarding & checkout form with validation and progress tracking.',
    nodes: [
      R(0, 0, 1280, 800, { fill: '{{bg}}', name: 'bg' }),
      // Centered Card Container
      R(340, 80, 600, 640, { role: 'card', rx: 20, filter: 'url(#gShadow)', name: 'wizard-card' }),
      T(640, 130, 'Account Setup Wizard', { size: 22, weight: 800, anchor: 'middle', fill: '{{text}}', name: 'title' }),
      T(640, 156, 'Complete your organization details in 3 quick steps.', { size: 13, anchor: 'middle', fill: '{{muted}}', name: 'desc' }),
      // Stepper in Card
      L(420, 200, 860, 200, { stroke: '{{line}}', sw: 2, name: 'step-line' }),
      C(420, 200, 14, { fill: '{{accent}}', name: 's1-c' }),
      T(420, 205, '1', { size: 11, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 's1-n' }),
      C(640, 200, 14, { fill: '{{accent}}', name: 's2-c' }),
      T(640, 205, '2', { size: 11, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 's2-n' }),
      C(860, 200, 14, { role: 'field', stroke: '{{line}}', sw: 2, name: 's3-c' }),
      T(860, 205, '3', { size: 11, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 's3-n' }),
      // Form Fields
      T(400, 260, 'Organization Name', { size: 12, weight: 700, fill: '{{text}}', name: 'lbl-1' }),
      R(400, 274, 480, 44, { role: 'field', rx: 10, name: 'field-1' }),
      T(418, 301, 'Acme Innovations Corp', { size: 13, fill: '{{text}}', name: 'val-1' }),
      T(400, 344, 'Primary Work Domain', { size: 12, weight: 700, fill: '{{text}}', name: 'lbl-2' }),
      R(400, 358, 480, 44, { role: 'field', rx: 10, name: 'field-2' }),
      T(418, 385, 'acme.design.internal', { size: 13, fill: '{{text}}', name: 'val-2' }),
      T(400, 428, 'Selected Design Theme', { size: 12, weight: 700, fill: '{{text}}', name: 'lbl-3' }),
      R(400, 442, 480, 44, { role: 'field', rx: 10, name: 'field-3' }),
      T(418, 469, 'Astryx Neutral (Dark & Light Pair)', { size: 13, weight: 600, fill: '{{accent}}', name: 'val-3' }),
      P('M856 460l4 4 4-4', { stroke: '{{muted}}', sw: 1.2, name: 'dropdown-arrow' }),
      // Action Buttons at bottom
      L(380, 590, 900, 590, { stroke: '{{line}}', name: 'divider' }),
      R(400, 610, 120, 42, { role: 'button', rx: 10, name: 'btn-back' }),
      T(460, 636, 'Back', { size: 13, weight: 600, anchor: 'middle', name: 'lbl-back' }),
      R(740, 610, 140, 42, { fill: '{{accent}}', rx: 10, name: 'btn-next' }),
      T(810, 636, 'Next Step →', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'lbl-next' })
    ]
  },

  /* --------------------------------------------------------------------------
   * 5. Astryx Kanban Project Board Screen (1280x800)
   * ------------------------------------------------------------------------ */
  {
    key: 'astryx-screen-kanban',
    name: 'Astryx Agile Kanban Board',
    label: 'Agile Kanban Board',
    category: 'dashboard',
    width: 1280,
    height: 800,
    meta: { device: 'desktop-1280', template: 'kanban-board', source: 'astryx/templates/pages/kanban-board' },
    descriptionDev: 'Multi-column task and issue tracking board with draggable status lanes.',
    nodes: [
      R(0, 0, 1280, 800, { fill: '{{bg}}', name: 'bg' }),
      // Top Navigation
      R(0, 0, 1280, 60, { role: 'card', name: 'nav' }),
      T(32, 36, 'Project Sprint Board — Release v2.0', { size: 16, weight: 800, fill: '{{text}}', name: 'title' }),
      R(1120, 14, 130, 32, { fill: '{{accent}}', rx: 8, name: 'btn-add-task' }),
      T(1185, 34, '+ New Task', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'lbl-task' }),
      // 3 Columns: To Do (400px), In Progress (400px), Done (400px)
      ...[
        ['TO DO (3)', 32, ['AST-101: Spring physics integration', 'AST-102: Lucide icon mappings', 'AST-103: Screen routing workflows']],
        ['IN PROGRESS (2)', 448, ['AST-098: Theme surface role audit', 'AST-099: Sandboxed script runner']],
        ['DONE (3)', 864, ['AST-091: Repo architecture reverse-eng', 'AST-092: OKLCH color token extraction', 'AST-093: Unit test validation suite']]
      ].flatMap(([laneTitle, colX, cards], c) => [
        R(colX, 80, 384, 690, { role: 'card', rx: 14, name: `lane-${c}` }),
        T(colX + 20, 112, laneTitle, { size: 12, weight: 800, fill: '{{muted}}', name: `lane-title-${c}` }),
        ...cards.flatMap((task, t) => [
          R(colX + 16, 132 + t * 96, 352, 80, { role: 'field', rx: 10, stroke: '{{stroke}}', sw: 1, name: `card-${c}-${t}` }),
          T(colX + 32, 162 + t * 96, task, { size: 13, weight: 600, fill: '{{text}}', name: `task-ttl-${c}-${t}` }),
          R(colX + 32, 180 + t * 96, 60, 20, { fill: '{{accent}}', fo: 0.15, rx: 6, name: `tag-bg-${c}-${t}` }),
          T(colX + 62, 194 + t * 96, 'Design', { size: 10, weight: 700, anchor: 'middle', fill: '{{accent}}', name: `tag-txt-${c}-${t}` }),
          T(colX + 340, 194 + t * 96, '● High', { size: 10, weight: 700, anchor: 'end', fill: '{{danger}}', name: `pri-${c}-${t}` })
        ])
      ])
    ]
  }
];

// ============================================================================
// 4. ASTRYX WORKFLOW (Connecting screens with interactive route links)
// ============================================================================

export const ASTRYX_WORKFLOWS = [
  {
    key: 'astryx-workflow-app',
    name: 'Astryx Studio Application Flow',
    label: 'Astryx App Flow',
    description: 'Master application workflow connecting the Dashboard, AI Chat Studio, Canvas Editor, Form Wizard, and Kanban Board.',
    category: 'apps',
    layout: [
      ['astryx-screen-dashboard', 'astryx-screen-form-wizard'],
      ['astryx-screen-ai-chat', 'astryx-screen-kanban'],
      ['astryx-screen-canvas-editor']
    ],
    links: [
      ['astryx-screen-dashboard', 'astryx-screen-ai-chat', 'Open AI Assistant', 'Navigates to AI conversation'],
      ['astryx-screen-dashboard', 'astryx-screen-canvas-editor', 'Launch Canvas Studio', 'Opens design canvas editor'],
      ['astryx-screen-dashboard', 'astryx-screen-form-wizard', 'Configure Project', 'Opens setup wizard'],
      ['astryx-screen-dashboard', 'astryx-screen-kanban', 'View Sprint Board', 'Opens agile kanban board'],
      ['astryx-screen-ai-chat', 'astryx-screen-canvas-editor', 'Inspect Artifact', 'Pushes generated UI to canvas']
    ]
  }
];
