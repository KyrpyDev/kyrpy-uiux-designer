/**
 * Preset elements: the basic HTML elements as designable elements, combined with the icon set and with buttons.
 * Every colour is a theme token, surfaces use roles (card / button / field) so they look right in all themes.
 * `refKey` on an instance is resolved by the importer (to an icon, or to a button when refType is 'button').
 */
import { repeaterDefaultAttrs } from '../../domain/repeater.js';

const base = (tag, kind, o, attrs) => ({ tag, kind, role: o.role ?? null, name: o.name ?? '', descriptionDev: o.dev ?? '', attrs, ...(o.anim ? { animations: o.anim } : {}) });

const R = (x, y, w, h, o = {}) => base('rect', 'shape', o, { x, y, width: w, height: h, rx: o.rx ?? 0,
  ...(o.role ? {} : { fill: o.fill ?? 'none', stroke: o.stroke ?? 'none', 'stroke-width': o.sw ?? 1 }), ...(o.op ? { opacity: o.op } : {}), ...(o.dash ? { 'stroke-dasharray': o.dash } : {}), ...(o.fo ? { 'fill-opacity': o.fo } : {}), ...(o.extraAttrs || {}) });
const C = (cx, cy, r, o = {}) => base('circle', 'shape', o, { cx, cy, r, ...(o.role ? {} : { fill: o.fill ?? 'none', stroke: o.stroke ?? 'none', 'stroke-width': o.sw ?? 1 }), ...(o.fo ? { 'fill-opacity': o.fo } : {}) });
const L = (x1, y1, x2, y2, o = {}) => base('line', 'shape', o, { x1, y1, x2, y2, stroke: o.stroke ?? '{{line}}', 'stroke-width': o.sw ?? 1, 'stroke-linecap': 'round', ...(o.dash ? { 'stroke-dasharray': o.dash } : {}) });
const P = (d, o = {}) => base('path', 'shape', o, { d, fill: o.fill ?? 'none', stroke: o.stroke ?? '{{accent}}', 'stroke-width': o.sw ?? 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
const T = (x, y, s, o = {}) => ({ ...base('text', 'text', o, { x, y, 'font-size': o.size ?? 14, 'font-weight': o.weight ?? 400, 'text-anchor': o.anchor ?? 'start', fill: o.fill ?? '{{text}}' }), text: s });
const I = (key, x, y, s = 24, o = {}) => ({ ...base('use', 'instance', o, { x, y, width: s, height: s, ...(o.stroke ? { stroke: o.stroke } : {}) }), refType: 'icon', refKey: key });

const B = (key, x, y, s = 48, o = {}) => ({ ...base('use', 'instance', o, { x, y, width: s, height: s }), refType: 'button', refKey: key });

const item = (key, name, category, htmlTag, w, h, nodes, extra = {}) => ({ key, name, label: name, category, htmlTag, width: w, height: h, nodes, ...extra });

const buttonLike = (key, name, label, o = {}) => item(key, name, 'buttons', 'button', 160, 48, [
  R(0, 0, 160, 48, { role: 'button', rx: 14, name: 'surface' }), ...(o.icon ? [I(o.icon, 16, 12, 24, { name: 'icon' })] : []),
  T(o.icon ? 92 : 80, 30, label, { size: 15, weight: 700, anchor: 'middle', name: 'label' })], { dev: o.dev });

const alertItem = (key, name, color, icon, msg) => item(key, name, 'feedback', 'div', 320, 64, [
  R(0, 0, 320, 64, { fill: `{{${color}}}`, fo: 0.14, stroke: `{{${color}}}`, sw: 1, rx: 14, name: 'surface' }),
  I(icon, 16, 20, 24, { stroke: `{{${color}}}`, name: 'icon' }), T(52, 28, name.replace(/ alert$/i, ''), { size: 14, weight: 700, name: 'title' }),
  T(52, 46, msg, { size: 12, fill: '{{muted}}', name: 'message' })], { dev: 'role="alert" element; announce to assistive tech. Variant colour comes from the semantic token.' });

const field = (w, h, name = 'surface') => R(0, 0, w, h, { role: 'field', rx: 12, name });

export const HTML_ELEMENTS = [
  /* ---- buttons & links ---- */
  item('html-button-primary', 'Button primary', 'buttons', 'button', 160, 48, [
    R(0, 0, 160, 48, { fill: '{{accent}}', rx: 14, name: 'surface' }), T(80, 30, 'Button', { size: 15, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'label' })]),
  buttonLike('html-button-secondary', 'Button secondary', 'Button'),
  item('html-button-outline', 'Button outline', 'buttons', 'button', 160, 48, [
    R(0.7, 0.7, 158.6, 46.6, { stroke: '{{accent}}', sw: 1.4, rx: 14, name: 'surface' }), T(80, 30, 'Button', { size: 15, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'label' })]),
  buttonLike('html-button-icon-label', 'Button with icon', 'Add item', { icon: 'add' }),
  item('html-button-icon', 'Icon button', 'buttons', 'button', 56, 56, [R(0, 0, 56, 56, { role: 'button', rx: 28, name: 'surface' }), R(5, 3, 46, 20, { role: 'shine', rx: 12, name: 'shine' }), I('add', 14, 14, 28, { name: 'icon' })],
    { dev: 'Icon-only button: always set an aria-label from the label field.' }),
  item('html-fab', 'Floating action button', 'buttons', 'button', 64, 64, [C(32, 32, 30, { role: 'button', name: 'surface' }), I('add', 16, 16, 32, { name: 'icon' })]),
  item('html-link', 'Link', 'buttons', 'a', 120, 24, [T(0, 17, 'Learn more', { size: 14, weight: 600, fill: '{{accent}}', name: 'label' }), L(0, 21, 78, 21, { stroke: '{{accent}}', name: 'underline' }), I('next', 90, 2, 20, { name: 'icon' })]),

  /* ---- inputs ---- */
  item('html-text-input', 'Text input', 'inputs', 'input', 280, 48, [field(280, 48), T(16, 30, 'Placeholder', { size: 14, fill: '{{muted}}', name: 'placeholder' })]),
  item('html-input-label', 'Input with label', 'inputs', 'input', 280, 76, [T(4, 12, 'LABEL', { size: 11, weight: 700, fill: '{{muted}}', name: 'label' }), R(0, 22, 280, 48, { role: 'field', rx: 12, name: 'surface' }), T(16, 52, 'Value', { size: 14, name: 'value' })],
    { dev: 'Render a real <label for> bound to the <input>.' }),
  item('html-search-input', 'Search input', 'inputs', 'input', 280, 48, [field(280, 48), I('search', 12, 12, 24, { name: 'icon' }), T(48, 30, 'Search', { size: 14, fill: '{{muted}}', name: 'placeholder' })], { dev: 'input type="search"; debounce typing 250 ms.' }),
  item('html-password-input', 'Password input', 'inputs', 'input', 280, 48, [field(280, 48), T(16, 32, '••••••••', { size: 14, name: 'value' }), I('eye', 244, 12, 24, { name: 'toggle-visibility' })], { dev: 'input type="password"; the eye icon toggles type text/password.' }),
  item('html-textarea', 'Textarea', 'inputs', 'textarea', 280, 120, [R(0, 0, 280, 120, { role: 'field', rx: 12, name: 'surface' }), T(16, 30, 'Write a comment...', { size: 14, fill: '{{muted}}', name: 'placeholder' }), L(250, 108, 264, 94, { name: 'resize-grip' })]),
  item('html-select', 'Select', 'inputs', 'select', 280, 48, [field(280, 48), T(16, 30, 'Choose an option', { size: 14, name: 'value' }), I('dropdown', 244, 12, 24, { name: 'icon' })], { dev: 'Native <select>; options come from data.' }),
  item('html-date-input', 'Date input', 'inputs', 'input', 280, 48, [field(280, 48), T(16, 30, '2026-11-03', { size: 14, name: 'value' }), I('timer', 244, 12, 24, { name: 'icon' })], { dev: 'input type="date".' }),
  item('html-file-upload', 'File upload', 'inputs', 'input', 320, 120, [R(1, 1, 318, 118, { stroke: '{{accent}}', sw: 1.2, rx: 16, dash: '6 5', name: 'drop-zone' }), I('import', 148, 22, 32, { name: 'icon' }), T(160, 76, 'Drop files here', { size: 14, weight: 600, anchor: 'middle', name: 'title' }), T(160, 96, 'or click to browse', { size: 12, anchor: 'middle', fill: '{{muted}}', name: 'hint' })], { dev: 'input type="file" with drag & drop zone.' }),
  item('html-checkbox', 'Checkbox', 'inputs', 'input', 200, 28, [R(2, 2, 24, 24, { role: 'field', rx: 7, name: 'box' }), T(38, 20, 'Checkbox label', { size: 14, name: 'label' })], { dev: 'input type="checkbox".' }),
  item('html-checkbox-checked', 'Checkbox checked', 'inputs', 'input', 200, 28, [I('checked', 2, 2, 24, { name: 'box' }), T(38, 20, 'Checkbox label', { size: 14, name: 'label' })], { dev: 'input type="checkbox" checked.' }),
  item('html-radio', 'Radio button', 'inputs', 'input', 200, 28, [I('radio-button', 2, 2, 24, { name: 'dot' }), T(38, 20, 'Radio option', { size: 14, name: 'label' })], { dev: 'input type="radio"; group by name.' }),
  item('html-toggle-switch', 'Toggle switch', 'inputs', 'input', 56, 32, [R(0, 0, 56, 32, { role: 'field', rx: 16, name: 'track' }), C(40, 16, 11, { fill: '{{accent}}', name: 'knob' })], { dev: 'role="switch" aria-checked.' }),
  item('html-slider', 'Slider', 'inputs', 'input', 240, 32, [R(0, 14, 240, 4, { fill: '{{line}}', rx: 2, name: 'track' }), R(0, 14, 150, 4, { fill: '{{accent}}', rx: 2, name: 'fill' }), C(150, 16, 10, { role: 'button', name: 'thumb' })], { dev: 'input type="range".' }),
  item('html-rating', 'Rating', 'inputs', 'div', 180, 28, [0, 1, 2, 3, 4].map(i => I('star', i * 34, 2, 24, { name: `star-${i + 1}`, stroke: i < 4 ? '{{accent}}' : '{{dim}}' })), { dev: 'role="radiogroup" of 5 stars.' }),
  item('html-stepper-input', 'Number stepper', 'inputs', 'input', 160, 48, [field(160, 48), T(80, 31, '1', { size: 16, weight: 700, anchor: 'middle', name: 'value' }), I('previous', 8, 10, 28, { name: 'decrement' }), I('next', 124, 10, 28, { name: 'increment' })], { dev: 'input type="number".' }),

  /* ---- text ---- */
  item('html-heading-1', 'Heading 1', 'text', 'h1', 320, 44, [T(0, 34, 'Heading one', { size: 32, weight: 800, name: 'text' })]),
  item('html-heading-2', 'Heading 2', 'text', 'h2', 320, 34, [T(0, 26, 'Heading two', { size: 24, weight: 700, name: 'text' })]),
  item('html-heading-3', 'Heading 3', 'text', 'h3', 320, 28, [T(0, 21, 'Heading three', { size: 18, weight: 700, name: 'text' })]),
  item('html-paragraph', 'Paragraph', 'text', 'p', 320, 72, ['First line of body text that wraps', 'across several lines in the design', 'and stays readable.'].map((s, i) => T(0, 16 + i * 22, s, { size: 14, fill: '{{muted}}', name: `line-${i + 1}` }))),
  item('html-label', 'Label', 'text', 'label', 120, 20, [T(0, 14, 'LABEL', { size: 11, weight: 700, fill: '{{muted}}', name: 'text' })]),
  item('html-divider', 'Divider', 'text', 'hr', 320, 2, [L(0, 1, 320, 1, { name: 'line' })]),
  item('html-list-unordered', 'Unordered list', 'text', 'ul', 280, 100, ['First item', 'Second item', 'Third item'].flatMap((s, i) => [C(6, 16 + i * 32, 3.5, { fill: '{{accent}}', name: `bullet-${i + 1}` }), T(22, 21 + i * 32, s, { size: 14, name: `item-${i + 1}` })])),
  item('html-list-ordered', 'Ordered list', 'text', 'ol', 280, 100, ['First step', 'Second step', 'Third step'].flatMap((s, i) => [T(0, 21 + i * 32, `${i + 1}.`, { size: 14, weight: 700, fill: '{{accent}}', name: `number-${i + 1}` }), T(26, 21 + i * 32, s, { size: 14, name: `item-${i + 1}` })])),
  item('html-table', 'Table', 'text', 'table', 320, 160, [
    R(0, 0, 320, 160, { role: 'card', rx: 14, name: 'surface' }), R(1, 1, 318, 36, { fill: '{{accent}}', fo: 0.18, rx: 13, name: 'header' }),
    ...['Name', 'Status', 'Score'].map((s, i) => T(16 + i * 104, 24, s, { size: 12, weight: 700, name: `th-${i + 1}` })),
    ...[0, 1, 2].flatMap(r => [L(12, 37 + r * 40, 308, 37 + r * 40, { name: `row-line-${r + 1}` }), ...['Item ' + (r + 1), 'Active', String(80 + r * 7)].map((s, i) => T(16 + i * 104, 62 + r * 40, s, { size: 13, fill: i ? '{{muted}}' : '{{text}}', name: `td-${r + 1}-${i + 1}` }))])]),

  /* ---- media & surfaces ---- */
  item('html-card', 'Card', 'surfaces', 'article', 320, 200, [
    R(0, 0, 320, 200, { role: 'card', rx: 20, name: 'surface' }), R(12, 12, 296, 90, { fill: '{{paper}}', rx: 12, name: 'media' }), I('gallery', 148, 38, 36, { name: 'media-icon', stroke: '{{dim}}' }),
    T(16, 128, 'Card title', { size: 16, weight: 700, name: 'title' }), T(16, 150, 'Short supporting description text.', { size: 12, fill: '{{muted}}', name: 'body' }),
    R(16, 160, 100, 28, { fill: '{{accent}}', rx: 10, name: 'action' }), T(66, 179, 'Open', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'action-label' })]),
  item('html-image', 'Image', 'surfaces', 'img', 200, 140, [R(0, 0, 200, 140, { fill: '{{paper}}', rx: 14, name: 'surface' }), I('gallery', 80, 52, 40, { name: 'placeholder', stroke: '{{dim}}' })], { dev: '<img> with alt text from the label field; keep 200:140 ratio.' }),
  item('html-avatar', 'Avatar', 'surfaces', 'img', 56, 56, [C(28, 28, 27, { role: 'button', name: 'surface' }), I('profile', 12, 12, 32, { name: 'icon' })]),
  item('html-badge', 'Badge', 'surfaces', 'span', 64, 24, [R(0, 0, 64, 24, { fill: '{{accent}}', fo: 0.2, stroke: '{{accent}}', rx: 12, name: 'surface' }), T(32, 16, 'New', { size: 11, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'label' })]),
  item('html-chip', 'Chip', 'surfaces', 'span', 110, 36, [R(0, 0, 110, 36, { role: 'button', rx: 18, name: 'surface' }), T(16, 23, 'Filter', { size: 13, weight: 600, name: 'label' }), I('close', 78, 8, 20, { name: 'remove' })]),
  item('html-notification-bell', 'Notification bell', 'surfaces', 'button', 56, 56, [R(0, 0, 52, 52, { role: 'button', rx: 26, name: 'surface' }), I('notifications', 12, 12, 28, { name: 'icon' }), C(44, 10, 8, { fill: '{{danger}}', name: 'badge' }), T(44, 14, '3', { size: 10, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'count' })]),
  item('html-skeleton', 'Skeleton loader', 'surfaces', 'div', 320, 80, [
    R(0, 0, 56, 56, { fill: '{{line}}', rx: 14, name: 'avatar' }), R(72, 6, 200, 14, { fill: '{{line}}', rx: 7, name: 'line-1' }), R(72, 30, 140, 12, { fill: '{{line}}', rx: 6, name: 'line-2' }), R(0, 68, 320, 10, { fill: '{{line}}', rx: 5, name: 'line-3' })].map((e, i) => i < 3 ? { ...e, animations: [{ name: 'shimmer', type: 'blink', params: { min: 0.35 }, durationMs: 1400, delayMs: i * 150, easing: 'ease-in-out', iterations: 'infinite', direction: 'normal', fillMode: 'both', trigger: 'load', enabled: true }] } : e),
    { dev: 'Show while data loads; replace with the real component.' }),
  item('html-progress', 'Progress bar', 'feedback', 'progress', 240, 12, [R(0, 0, 240, 12, { role: 'field', rx: 6, name: 'track' }), R(0, 0, 150, 12, { fill: '{{accent}}', rx: 6, name: 'bar' })], { dev: '<progress value max>.' }),
  item('html-spinner', 'Spinner', 'feedback', 'div', 48, 48, [I('refresh', 8, 8, 32, { name: 'icon', anim: [{ name: 'spin', type: 'rotate', params: { from: 0, to: 360 }, durationMs: 1000, delayMs: 0, easing: 'linear', iterations: 'infinite', direction: 'normal', fillMode: 'none', trigger: 'load', enabled: true }] })], { dev: 'role="status" aria-live="polite"; the rotation is the built-in animation.' }),
  alertItem('html-alert-info', 'Info alert', 'info', 'status', 'Information message goes here.'),
  alertItem('html-alert-success', 'Success alert', 'success', 'approve', 'The action completed successfully.'),
  alertItem('html-alert-warning', 'Warning alert', 'warning', 'announcement', 'Check this before you continue.'),
  alertItem('html-alert-error', 'Error alert', 'danger', 'reject', 'Something went wrong. Try again.'),
  item('html-toast', 'Toast', 'feedback', 'div', 300, 56, [R(0, 0, 300, 56, { role: 'card', rx: 16, name: 'surface' }), I('checked', 14, 16, 24, { name: 'icon' }), T(48, 33, 'Saved successfully', { size: 14, weight: 600, name: 'message' }), I('close', 262, 16, 24, { name: 'dismiss' })], { dev: 'role="status"; auto-dismiss after 4 s.' }),
  item('html-tooltip', 'Tooltip', 'feedback', 'div', 160, 52, [R(0, 0, 160, 40, { role: 'card', rx: 10, name: 'surface' }), T(80, 25, 'Helpful hint', { size: 12, weight: 600, anchor: 'middle', name: 'text' }), P('M72 40 L80 48 L88 40', { stroke: '{{line}}', sw: 1, name: 'arrow' })], { dev: 'role="tooltip"; show on hover and focus.' }),
  item('html-modal', 'Modal dialog', 'surfaces', 'dialog', 320, 220, [
    R(0, 0, 320, 220, { role: 'card', rx: 24, name: 'surface' }), T(20, 40, 'Dialog title', { size: 18, weight: 700, name: 'title' }), I('close', 276, 20, 24, { name: 'close' }),
    T(20, 76, 'Explain what will happen when the user', { size: 13, fill: '{{muted}}', name: 'body-1' }), T(20, 96, 'confirms this action.', { size: 13, fill: '{{muted}}', name: 'body-2' }),
    R(20, 164, 130, 40, { role: 'button', rx: 12, name: 'cancel' }), T(85, 189, 'Cancel', { size: 14, weight: 700, anchor: 'middle', name: 'cancel-label' }),
    R(170, 164, 130, 40, { fill: '{{accent}}', rx: 12, name: 'confirm' }), T(235, 189, 'Confirm', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'confirm-label' })], { dev: '<dialog> opened with showModal(); trap focus; Esc closes.' }),

  /* ---- navigation ---- */
  item('html-tabs', 'Tabs', 'navigation', 'nav', 320, 48, [R(0, 0, 320, 48, { role: 'field', rx: 14, name: 'surface' }), R(4, 4, 104, 40, { fill: '{{accent}}', rx: 11, name: 'active' }),
    T(56, 29, 'One', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'tab-1' }), T(160, 29, 'Two', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'tab-2' }), T(264, 29, 'Three', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'tab-3' })], { dev: 'role="tablist" with role="tab" buttons.' }),
  item('html-tabs-vertical', 'Tabs (vertical)', 'navigation', 'nav', 140, 176, [R(0, 0, 140, 176, { role: 'field', rx: 14, name: 'surface' }), R(4, 4, 132, 52, { fill: '{{accent}}', rx: 11, name: 'active' }),
    T(70, 36, 'One', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'tab-1' }), T(70, 94, 'Two', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'tab-2' }), T(70, 152, 'Three', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'tab-3' })], { dev: 'role="tablist" aria-orientation="vertical" with role="tab" buttons stacked top to bottom.' }),
  item('html-breadcrumb', 'Breadcrumb', 'navigation', 'nav', 320, 24, [I('home', 0, 2, 20, { name: 'home' }), T(28, 17, 'Home', { size: 13, fill: '{{muted}}', name: 'crumb-1' }), T(72, 17, '/', { size: 13, fill: '{{dim}}', name: 'sep-1' }), T(84, 17, 'Section', { size: 13, fill: '{{muted}}', name: 'crumb-2' }), T(146, 17, '/', { size: 13, fill: '{{dim}}', name: 'sep-2' }), T(158, 17, 'Page', { size: 13, weight: 700, name: 'crumb-3' })], { dev: 'nav aria-label="breadcrumb" with <ol>.' }),
  item('html-pagination', 'Pagination', 'navigation', 'nav', 280, 44, [I('previous', 0, 8, 28, { name: 'prev' }), ...[1, 2, 3].map((n, i) => [R(48 + i * 44, 4, 36, 36, n === 2 ? { fill: '{{accent}}', rx: 10, name: `page-${n}-bg` } : { role: 'button', rx: 10, name: `page-${n}-bg` }), T(66 + i * 44, 28, String(n), { size: 14, weight: 700, anchor: 'middle', fill: n === 2 ? '{{onAccent}}' : '{{text}}', name: `page-${n}` })]).flat(), I('next', 252, 8, 28, { name: 'next' })]),
  item('html-navbar', 'Navigation bar', 'navigation', 'header', 390, 64, [I('menu', 16, 20, 24, { name: 'menu' }), T(195, 38, 'Page title', { size: 17, weight: 700, anchor: 'middle', name: 'title' }), I('search', 350, 20, 24, { name: 'search' })], { dev: '<header><nav>; the menu icon opens the drawer.' }),
  item('html-bottom-nav', 'Bottom navigation', 'navigation', 'nav', 390, 72, [R(0, 0, 390, 72, { role: 'card', rx: 24, name: 'surface' }),
    ...['home', 'search', 'notifications', 'profile'].flatMap((k, i) => [I(k, 36 + i * 90, 14, 28, { name: `${k}-icon`, stroke: i === 0 ? '{{accent}}' : '{{dim}}' }), T(50 + i * 90, 58, k[0].toUpperCase() + k.slice(1), { size: 10, weight: 600, anchor: 'middle', fill: i === 0 ? '{{accent}}' : '{{dim}}', name: `${k}-label` })])], { dev: 'Fixed bottom <nav>; highlight the active route.' }),
  item('html-menu-list', 'Menu list', 'navigation', 'menu', 240, 200, [R(0, 0, 240, 200, { role: 'card', rx: 18, name: 'surface' }),
    ...[['home', 'Home'], ['profile', 'Profile'], ['settings', 'Settings'], ['logout', 'Log out']].flatMap(([k, s], i) => [I(k, 16, 14 + i * 44, 24, { name: `${k}-icon` }), T(52, 32 + i * 44, s, { size: 14, weight: 600, name: `${k}-label` })])]),
  item('html-accordion', 'Accordion', 'navigation', 'details', 320, 120, [R(0, 0, 320, 120, { role: 'card', rx: 16, name: 'surface' }), T(16, 32, 'Section heading', { size: 15, weight: 700, name: 'summary' }), I('dropdown', 280, 12, 24, { name: 'chevron' }), L(16, 48, 304, 48, { name: 'divider' }), T(16, 72, 'Collapsible content appears here when', { size: 13, fill: '{{muted}}', name: 'body-1' }), T(16, 92, 'the section is expanded.', { size: 13, fill: '{{muted}}', name: 'body-2' })], { dev: '<details><summary>; animate height 200 ms.' }),
  item('html-stepper', 'Step indicator', 'navigation', 'ol', 320, 56, [L(28, 20, 160, 20, { stroke: '{{accent}}', sw: 2, name: 'line-1' }), L(160, 20, 292, 20, { stroke: '{{line}}', sw: 2, name: 'line-2' }),
    C(28, 20, 14, { fill: '{{accent}}', name: 'step-1' }), C(160, 20, 14, { fill: '{{accent}}', name: 'step-2' }), C(292, 20, 14, { role: 'field', name: 'step-3' }),
    ...[1, 2, 3].map((n, i) => T(28 + i * 132, 25, String(n), { size: 13, weight: 700, anchor: 'middle', fill: i < 2 ? '{{onAccent}}' : '{{muted}}', name: `n-${n}` })),
    ...['Details', 'Review', 'Done'].map((s, i) => T(28 + i * 132, 52, s, { size: 11, anchor: 'middle', fill: '{{muted}}', name: `caption-${i + 1}` }))]),

  /* ---- composites ---- */
  item('html-form', 'Form', 'forms', 'form', 320, 330, [R(0, 0, 320, 330, { role: 'card', rx: 24, name: 'surface' }), T(20, 40, 'Sign in', { size: 20, weight: 800, name: 'title' }),
    T(20, 72, 'E-MAIL', { size: 11, weight: 700, fill: '{{muted}}', name: 'email-label' }), R(20, 80, 280, 44, { role: 'field', rx: 12, name: 'email' }), T(36, 108, 'name@example.com', { size: 14, fill: '{{muted}}', name: 'email-placeholder' }),
    T(20, 152, 'PASSWORD', { size: 11, weight: 700, fill: '{{muted}}', name: 'password-label' }), R(20, 160, 280, 44, { role: 'field', rx: 12, name: 'password' }), T(36, 188, '••••••••', { size: 14, name: 'password-value' }),
    I('checked', 18, 222, 24, { name: 'remember-box' }), T(50, 240, 'Remember me', { size: 13, name: 'remember-label' }),
    R(20, 266, 280, 48, { fill: '{{accent}}', rx: 14, name: 'submit' }), T(160, 296, 'Sign in', { size: 15, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'submit-label' })], { dev: '<form> with client validation; submit calls the sign-in API.' }),
  item('html-search-bar', 'Search bar with filter', 'forms', 'form', 340, 52, [R(0, 0, 340, 52, { role: 'field', rx: 26, name: 'surface' }), I('search', 14, 14, 24, { name: 'search-icon' }), T(50, 32, 'Search items', { size: 14, fill: '{{muted}}', name: 'placeholder' }), I('order-by', 302, 14, 24, { name: 'filter' })]),
  item('html-list-row', 'List row with icon', 'surfaces', 'li', 340, 64, [R(0, 0, 340, 64, { role: 'card', rx: 16, name: 'surface' }), R(12, 12, 40, 40, { role: 'button', rx: 12, name: 'icon-bg' }), I('folder', 20, 20, 24, { name: 'icon' }), T(66, 30, 'Row title', { size: 15, weight: 700, name: 'title' }), T(66, 48, 'Row description', { size: 12, fill: '{{muted}}', name: 'subtitle' }), I('next', 300, 20, 24, { name: 'chevron' })]),

  /* ---- interactive & advanced HTML elements ---- */
  item('html-flip-box', 'Flip Box (3D Card)', 'interactive', 'div', 300, 200, [
    R(0, 0, 300, 200, { role: 'card', rx: 22, name: 'front-surface', anim: [{ name: 'flip-3d', type: 'flip', params: { deg: 180 }, durationMs: 650, delayMs: 0, easing: 'ease-in-out', iterations: 1, direction: 'normal', fillMode: 'both', trigger: 'click', enabled: true }] }),
    R(14, 14, 272, 108, { fill: '{{accent}}', fo: 0.14, stroke: '{{accent}}', sw: 1, rx: 14, name: 'front-banner' }),
    I('refresh', 134, 46, 32, { name: 'flip-icon', stroke: '{{accent}}' }),
    T(150, 148, 'Flip Box — Front Side', { size: 16, weight: 700, anchor: 'middle', name: 'front-title' }),
    T(150, 170, 'Click or hover to flip to back details', { size: 12, fill: '{{muted}}', anchor: 'middle', name: 'front-subtitle' }),
    R(226, 18, 54, 22, { fill: '{{accent}}', rx: 11, name: 'flip-badge' }),
    T(253, 33, 'FLIP', { size: 10, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'flip-badge-text' })
  ], { dev: 'Interactive 3D flip-box component with .flip-box-inner, .flip-box-front, and .flip-box-back faces; toggles on click or mouseover.' }),

  item('html-carousel', 'Carousel Slider', 'interactive', 'section', 340, 210, [
    R(0, 0, 340, 210, { role: 'card', rx: 22, name: 'surface' }),
    R(14, 14, 312, 146, { fill: '{{paper}}', rx: 16, name: 'slide-viewport' }),
    I('gallery', 150, 62, 40, { name: 'slide-media', stroke: '{{accent}}' }),
    T(170, 128, 'Slide 1 of 4 — Featured Highlight', { size: 13, weight: 700, anchor: 'middle', name: 'slide-caption' }),
    C(34, 87, 16, { role: 'button', name: 'prev-btn' }), I('previous', 22, 75, 24, { name: 'prev-icon' }),
    C(306, 87, 16, { role: 'button', name: 'next-btn' }), I('next', 294, 75, 24, { name: 'next-icon' }),
    C(146, 184, 5, { fill: '{{accent}}', name: 'dot-1' }),
    C(162, 184, 4, { fill: '{{line}}', name: 'dot-2' }),
    C(178, 184, 4, { fill: '{{line}}', name: 'dot-3' }),
    C(194, 184, 4, { fill: '{{line}}', name: 'dot-4' })
  ], { dev: 'Interactive horizontal carousel with swipe gestures, prev/next buttons, and pagination dots.' }),

  item('html-floating-toolbar', 'Small Element Toolbar', 'interactive', 'div', 248, 48, [
    R(0, 0, 248, 48, { role: 'card', rx: 24, name: 'toolbar-surface' }),
    R(8, 6, 36, 36, { role: 'button', rx: 18, name: 'action-edit-bg' }), I('edit', 16, 14, 20, { name: 'action-edit' }),
    R(50, 6, 36, 36, { role: 'button', rx: 18, name: 'action-copy-bg' }), I('add', 58, 14, 20, { name: 'action-copy' }),
    R(92, 6, 36, 36, { role: 'button', rx: 18, name: 'action-share-bg' }), I('share', 100, 14, 20, { name: 'action-share' }),
    R(134, 6, 36, 36, { role: 'button', rx: 18, name: 'action-star-bg' }), I('star', 142, 14, 20, { name: 'action-star' }),
    L(180, 10, 180, 38, { stroke: '{{line}}', name: 'divider' }),
    R(190, 6, 50, 36, { fill: '{{accent}}', rx: 18, name: 'action-more-bg' }), T(215, 29, 'More', { size: 11, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'action-more-label' })
  ], { dev: 'Floating contextual mini-toolbar opened near an element on click, mouseover, or right-click.' }),

  item('html-record-viewer-list', 'Record Viewer (List)', 'interactive', 'section', 350, 240, [
    R(0, 0, 350, 240, { role: 'card', rx: 20, name: 'surface' }),
    T(18, 30, 'Records (24)', { size: 15, weight: 700, name: 'header-title' }),
    I('search', 274, 12, 22, { name: 'header-search' }), I('order-by', 310, 12, 22, { name: 'header-sort' }),
    L(14, 44, 336, 44, { name: 'header-line' }),
    ...[0, 1, 2].flatMap(i => [
      R(14, 54 + i * 56, 322, 48, { role: 'field', rx: 12, name: `row-${i + 1}` }),
      C(36, 78 + i * 56, 12, { fill: '{{accent}}', fo: 0.2, name: `badge-${i + 1}` }),
      T(36, 82 + i * 56, String(i + 1), { size: 11, weight: 700, anchor: 'middle', fill: '{{accent}}', name: `num-${i + 1}` }),
      T(58, 74 + i * 56, `Record Item #${101 + i}`, { size: 13, weight: 700, name: `title-${i + 1}` }),
      T(58, 91 + i * 56, 'Updated 5m ago · Verified', { size: 11, fill: '{{muted}}', name: `meta-${i + 1}` }),
      I('next', 304, 66 + i * 56, 22, { name: `open-${i + 1}` })
    ])
  ], { dev: 'Data-bound record list viewer with search, sort, and row click navigation.' }),

  item('html-record-viewer-grid', 'Record Viewer (Grid)', 'interactive', 'section', 350, 220, [
    R(0, 0, 350, 220, { role: 'card', rx: 20, name: 'surface' }),
    ...[0, 1].flatMap(col => [0, 1].flatMap(row => {
      const idx = row * 2 + col + 1;
      const x = 14 + col * 164;
      const y = 14 + row * 98;
      return [
        R(x, y, 158, 90, { role: 'field', rx: 14, name: `cell-${idx}` }),
        I('folder', x + 14, y + 14, 24, { name: `cell-icon-${idx}`, stroke: '{{accent}}' }),
        T(x + 14, y + 58, `Card #${idx}`, { size: 13, weight: 700, name: `cell-title-${idx}` }),
        T(x + 14, y + 76, '12 items', { size: 11, fill: '{{muted}}', name: `cell-meta-${idx}` })
      ];
    }))
  ], { dev: '2x2 responsive record grid viewer with selectable cards.' }),

  item('html-choice-chips', 'Choice Chips Bar', 'inputs', 'div', 340, 44, [
    R(0, 4, 86, 36, { fill: '{{accent}}', rx: 18, name: 'chip-active' }),
    T(43, 27, 'All Items', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'chip-active-label' }),
    R(96, 4, 78, 36, { role: 'button', rx: 18, name: 'chip-2' }),
    T(135, 27, 'Popular', { size: 12, weight: 600, anchor: 'middle', name: 'chip-2-label' }),
    R(184, 4, 74, 36, { role: 'button', rx: 18, name: 'chip-3' }),
    T(221, 27, 'Recent', { size: 12, weight: 600, anchor: 'middle', name: 'chip-3-label' }),
    R(268, 4, 70, 36, { role: 'button', rx: 18, name: 'chip-4' }),
    T(303, 27, 'Saved', { size: 12, weight: 600, anchor: 'middle', name: 'chip-4-label' })
  ], { dev: 'Single or multi-select filter chip bar with active state toggle.' }),

  item('html-multi-choice', 'Multi-Choice Question Card', 'inputs', 'fieldset', 320, 210, [
    R(0, 0, 320, 210, { role: 'card', rx: 20, name: 'surface' }),
    T(18, 32, 'Select applicable options:', { size: 15, weight: 700, name: 'prompt' }),
    ...['Option A — Fast sync', 'Option B — Offline cache', 'Option C — Auto backup'].flatMap((label, idx) => [
      R(16, 48 + idx * 48, 288, 40, { role: 'field', rx: 12, name: `opt-bg-${idx + 1}` }),
      I(idx < 2 ? 'checked' : 'radio-button', 26, 56 + idx * 48, 24, { name: `opt-icon-${idx + 1}` }),
      T(60, 73 + idx * 48, label, { size: 13, weight: 600, name: `opt-label-${idx + 1}` })
    ])
  ], { dev: 'Interactive multi-choice group allowing one or multiple selections.' }),

  item('html-dropdown-menu', 'Dropdown Menu Panel', 'navigation', 'div', 240, 188, [
    R(0, 0, 240, 44, { role: 'field', rx: 12, name: 'trigger' }),
    T(16, 27, 'Select action...', { size: 13, weight: 600, name: 'trigger-label' }),
    I('dropdown', 204, 10, 24, { name: 'trigger-chevron' }),
    R(0, 50, 240, 138, { role: 'card', rx: 14, name: 'menu-panel' }),
    R(8, 58, 224, 36, { fill: '{{accent}}', fo: 0.16, rx: 9, name: 'item-1-hover' }),
    I('edit', 18, 64, 22, { name: 'item-1-icon' }), T(50, 81, 'Edit properties', { size: 13, weight: 600, name: 'item-1-text' }),
    I('add', 18, 104, 22, { name: 'item-2-icon' }), T(50, 121, 'Duplicate item', { size: 13, name: 'item-2-text' }),
    L(12, 138, 228, 138, { name: 'menu-sep' }),
    I('delete-scan', 18, 148, 22, { name: 'item-3-icon', stroke: '{{danger}}' }), T(50, 165, 'Delete item', { size: 13, fill: '{{danger}}', name: 'item-3-text' })
  ], { dev: 'Expanded dropdown menu with keyboard navigation and item icons.' }),

  item('html-drag-drop-zone', 'Drag & Drop Canvas Zone', 'interactive', 'div', 320, 150, [
    R(2, 2, 316, 146, { role: 'card', rx: 20, name: 'surface' }),
    R(12, 12, 296, 126, { stroke: '{{accent}}', sw: 1.5, dash: '8 6', rx: 14, name: 'dashed-border' }),
    I('import', 144, 34, 32, { name: 'drag-icon', stroke: '{{accent}}' }),
    T(160, 92, 'Drag & Drop Elements Here', { size: 14, weight: 700, anchor: 'middle', name: 'title' }),
    T(160, 114, 'Supports drop, reorder, and snap events', { size: 12, fill: '{{muted}}', anchor: 'middle', name: 'subtitle' })
  ], { dev: 'Drop target container supporting dragenter, dragover, dragleave, and drop events.' }),

  item('html-bottom-sheet', 'Bottom Sheet Drawer', 'surfaces', 'dialog', 390, 240, [
    R(0, 0, 390, 240, { role: 'card', rx: 28, name: 'surface' }),
    R(171, 12, 48, 5, { fill: '{{muted}}', rx: 2.5, name: 'drag-handle' }),
    T(24, 48, 'Quick Actions Sheet', { size: 17, weight: 700, name: 'sheet-title' }),
    I('close', 344, 28, 24, { name: 'sheet-close' }),
    L(20, 64, 370, 64, { name: 'divider' }),
    ...['Share with collaborators', 'Export SVG / Bundle', 'Lock position on screen'].flatMap((txt, idx) => [
      R(20, 78 + idx * 48, 350, 40, { role: 'button', rx: 12, name: `sheet-row-${idx + 1}` }),
      T(40, 103 + idx * 48, txt, { size: 13, weight: 600, name: `sheet-label-${idx + 1}` })
    ])
  ], { dev: 'Slide-up bottom sheet overlay with swipe-down dismissal.' }),

  item('html-audio-player', 'Audio / Media Player', 'interactive', 'section', 340, 84, [
    R(0, 0, 340, 84, { role: 'card', rx: 20, name: 'surface' }),
    C(42, 42, 24, { fill: '{{accent}}', name: 'play-btn' }),
    P('M36 32 L52 42 L36 52 Z', { fill: '{{onAccent}}', stroke: '{{onAccent}}', sw: 1, name: 'play-triangle' }),
    T(80, 32, 'Voice Note — Design Review', { size: 13, weight: 700, name: 'track-title' }),
    T(80, 68, '01:14 / 03:45', { size: 11, fill: '{{muted}}', name: 'track-time' }),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => R(80 + i * 18, 42 - (i % 3) * 4, 6, 12 + (i % 3) * 8, { fill: i < 5 ? '{{accent}}' : '{{line}}', rx: 3, name: `wave-${i + 1}` }))
  ], { dev: 'HTML5 audio/media controller with waveform scrub bar.' }),

  item('html-calendar-picker', 'Calendar Date Picker', 'inputs', 'div', 300, 240, [
    R(0, 0, 300, 240, { role: 'card', rx: 20, name: 'surface' }),
    I('previous', 16, 14, 22, { name: 'prev-month' }),
    T(150, 31, 'November 2026', { size: 14, weight: 700, anchor: 'middle', name: 'month-label' }),
    I('next', 262, 14, 22, { name: 'next-month' }),
    ...['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d, i) => T(28 + i * 40, 62, d, { size: 11, weight: 700, anchor: 'middle', fill: '{{muted}}', name: `dow-${d}` })),
    ...Array.from({ length: 28 }, (_, idx) => {
      const col = idx % 7;
      const row = Math.floor(idx / 7);
      const day = idx + 1;
      const active = day === 14;
      return [
        ...(active ? [C(28 + col * 40, 88 + row * 34, 14, { fill: '{{accent}}', name: 'active-day-bg' })] : []),
        T(28 + col * 40, 93 + row * 34, String(day), { size: 12, weight: active ? 700 : 500, anchor: 'middle', fill: active ? '{{onAccent}}' : '{{text}}', name: `day-${day}` })
      ];
    }).flat()
  ], { dev: 'Interactive calendar date picker grid.' }),

  item('html-color-picker', 'Color Swatch Picker', 'inputs', 'div', 260, 56, [
    R(0, 0, 260, 56, { role: 'field', rx: 14, name: 'surface' }),
    ...['#2e9bff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'].map((col, i) => C(26 + i * 38, 28, 13, { fill: col, stroke: i === 0 ? '{{text}}' : 'none', sw: 2, name: `swatch-${i + 1}` }))
  ], { dev: 'Color swatch selector with active ring.' }),

  item('html-chat-bubble', 'Chat / Comment Bubble', 'surfaces', 'article', 320, 88, [
    C(26, 28, 18, { role: 'button', name: 'avatar-bg' }), I('profile', 14, 16, 24, { name: 'avatar' }),
    R(54, 6, 260, 74, { role: 'card', rx: 16, name: 'bubble' }),
    T(70, 28, 'Kyrpy (Owner)', { size: 12, weight: 700, fill: '{{accent}}', name: 'author' }),
    T(70, 48, 'Approved the new button layout and', { size: 12, name: 'line-1' }),
    T(70, 66, 'synced changes to PostgreSQL.', { size: 12, name: 'line-2' })
  ], { dev: 'Collaborative review comment or chat message bubble.' }),

  item('html-admob-banner', 'AdMob Smart Banner', 'surfaces', 'aside', 320, 54, [
    R(0, 0, 320, 54, { role: 'card', rx: 12, name: 'surface' }),
    R(10, 10, 30, 18, { fill: '{{warning}}', rx: 5, name: 'ad-badge' }),
    T(25, 23, 'Ad', { size: 10, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'ad-badge-text' }),
    T(50, 26, 'Sponsored Placement Banner', { size: 12, weight: 700, name: 'ad-title' }),
    T(50, 42, '320×50 Smart Banner Unit', { size: 10, fill: '{{muted}}', name: 'ad-sub' }),
    I('next', 288, 15, 24, { name: 'ad-cta' })
  ], { dev: 'AdMob 320x50 banner placeholder.' }),

  /* ---- containers & carousels ---- */
  item('html-container', 'Container (Shell Box)', 'containers', 'section', 358, 200, [
    R(0, 0, 358, 200, {
      role: 'container',
      rx: 18,
      name: 'container-shell',
      extraAttrs: {
        'data-container': 'container',
        'data-size-mode': 'responsive',
        'data-outer-margin': 16,
        'data-inner-margin': 12
      }
    }),
    R(12, 12, 334, 176, { stroke: '{{accent}}', sw: 1.2, dash: '6 4', rx: 12, op: 0.55, name: 'inner-margin-guide' }),
    T(24, 34, 'CONTAINER SHELL', { size: 11, weight: 700, fill: '{{accent}}', name: 'container-label' }),
    T(24, 52, 'Drop elements inside • Responsive / Fixed • Clamps child max size', { size: 11, fill: '{{muted}}', name: 'container-hint' })
  ], { dev: 'Outer shell container box with configurable inner/outer margins, fixed or responsive sizing, and automatic child max-size clamping.' }),

  item('html-carousel-container', 'Carousel Container (2D/3D Roll)', 'containers', 'section', 358, 220, [
    R(0, 0, 358, 220, {
      role: 'carousel-container',
      rx: 20,
      name: 'carousel-shell',
      extraAttrs: {
        'data-container': 'carousel',
        'data-size-mode': 'responsive',
        'data-outer-margin': 16,
        'data-inner-margin': 12,
        'data-carousel-dim': '3d',
        'data-carousel-dir': 'horizontal',
        'data-carousel-speed': 2600,
        'data-carousel-autoroll': 'true'
      }
    }),
    R(12, 12, 334, 196, { stroke: '{{accent}}', sw: 1.2, dash: '6 4', rx: 14, op: 0.5, name: 'inner-margin-guide' }),
    R(24, 46, 76, 124, { fill: '{{paper}}', stroke: '{{line}}', rx: 12, op: 0.6, name: 'slide-prev' }),
    R(258, 46, 76, 124, { fill: '{{paper}}', stroke: '{{line}}', rx: 12, op: 0.6, name: 'slide-next' }),
    R(92, 34, 174, 148, { role: 'card', rx: 14, name: 'slide-active' }),
    T(179, 98, 'Carousel Container', { size: 14, weight: 700, anchor: 'middle', name: 'carousel-title' }),
    T(179, 118, '3D / 2D • Horizontal & Vertical Roll', { size: 11, fill: '{{muted}}', anchor: 'middle', name: 'carousel-sub' }),
    I('previous', 28, 96, 22, { name: 'roll-prev' }),
    I('next', 308, 96, 22, { name: 'roll-next' }),
    C(163, 196, 4, { fill: '{{accent}}', name: 'dot-1' }),
    C(179, 196, 3.5, { fill: '{{line}}', name: 'dot-2' }),
    C(195, 196, 3.5, { fill: '{{line}}', name: 'dot-3' })
  ], { dev: 'Specialized Carousel Container in which sub-elements roll with 3D perspective or 2D flat horizontal/vertical animated roll effects.' }),

  // repeater: drop ONE item on it (its template) and set the item count; the copies are simulated at render time
  item('html-repeater', 'Repeater (Repeating Item List)', 'containers', 'div', 358, 220, [
    R(0, 0, 358, 220, {
      role: 'repeater-container',
      rx: 18,
      name: 'repeater-shell',
      extraAttrs: { ...repeaterDefaultAttrs() }
    })
  ], { dev: 'Repeating item list: the dropped item is the template, rendered itemCount times. Layouts: vertical, horizontal, carousel, roll, slide, scroll; 2D or 3D (perspective ring / picker-wheel cylinder). Export: the template once plus js/app.js (bindRepeaters) repeats it; map to a list (<ul>/v-for/map()) over your data.', meta: { containerType: 'repeater', isContainer: true } })
];

/** Elements that contain buttons (and therefore icons): they show the whole hierarchy in use. */
export const BUTTON_ELEMENTS = [
  item('html-toolbar', 'Toolbar', 'navigation', 'div', 340, 72, [R(0, 0, 340, 72, { role: 'card', rx: 36, name: 'surface' }),
    ...['home', 'search', 'notifications', 'profile'].map((k, i) => B(`${k}-button`, 12 + i * 80, 8, 56, { name: `${k}-button` }))], { dev: 'Row of icon buttons; each button is a <button> with an aria-label.' }),
  item('html-header-actions', 'Header with actions', 'navigation', 'header', 390, 72, [B('menu-button', 12, 12, 48, { name: 'menu-button' }), T(195, 43, 'Page title', { size: 18, weight: 700, anchor: 'middle', name: 'title' }),
    B('search-button', 330, 12, 48, { name: 'search-button' })], { dev: '<header> with a menu button on the left and a search button on the right.' }),
  item('html-card-actions', 'Card with action buttons', 'surfaces', 'article', 320, 150, [R(0, 0, 320, 150, { role: 'card', rx: 20, name: 'surface' }), T(20, 40, 'Card title', { size: 17, weight: 700, name: 'title' }),
    T(20, 64, 'Short supporting text goes here.', { size: 13, fill: '{{muted}}', name: 'body' }),
    ...['share', 'edit', 'delete-scan'].map((k, i) => B(`${k}-button`, 20 + i * 64, 84, 52, { name: `${k}-button` }))], { dev: 'Card whose actions are icon buttons.' }),
  item('html-radial-actions', 'Radial action button', 'navigation', 'nav', 96, 96, [B('item-radial-menu', 16, 16, 64, { name: 'radial-menu' })],
    { dev: 'Rotating menu button: click opens the actions on an arc, click an item with sub items to go deeper, click the centre to go back.' }),
  item('html-hub-menu', 'Hub menu bar', 'navigation', 'nav', 260, 130, [B('hub-menu', 102, 37, 56, { name: 'hub-menu' })],
    { dev: 'Scrolling hub menu: small side buttons and a centre button four times as big over a ring of 3+ items (switchable between horizontal and vertical orientation in menu settings). Click a side button to swap it with the centre; items with sub items fan out around the centre; click the centre again or outside to go back. Mouse wheel scrolls the ring.' }),
  item('html-popup-actions', 'Popup menu button', 'navigation', 'nav', 96, 96, [B('more-popup-button', 16, 16, 64, { name: 'popup-menu' })],
    { dev: 'Popup menu button: opens a list above the button; nested items expand in place.' })
];

/*
 * Page-builder blocks: the content / section / media addons that page builder packages (SP Page Builder, Elementor,
 * WPBakery ...) ship and the basic HTML presets above lack. Generic sample content, theme tokens and base icons only.
 */
const lines = (x, y0, step, texts, o = {}) => texts.map((s, i) => T(x, y0 + i * step, s, { ...o, name: `${o.name || 'line'}-${i + 1}` }));
const field2 = (x, y, w, h, label, placeholder, key) => [T(x, y - 8, label, { size: 11, weight: 700, fill: '{{muted}}', name: `${key}-label` }),
  R(x, y, w, h, { role: 'field', rx: 12, name: key }), T(x + 14, y + 27, placeholder, { size: 13, fill: '{{muted}}', name: `${key}-placeholder` })];

export const PAGE_BUILDER_ELEMENTS = [
  /* ---- content blocks ---- */
  item('html-blockquote', 'Blockquote', 'content', 'blockquote', 320, 110, [R(0, 0, 320, 110, { role: 'card', rx: 16, name: 'surface' }), R(0, 0, 5, 110, { fill: '{{accent}}', rx: 2, name: 'accent-bar' }),
    T(22, 46, '“', { size: 40, weight: 800, fill: '{{accent}}', name: 'quote-mark' }),
    ...lines(52, 38, 22, ['Good design is obvious.', 'Great design is transparent.'], { size: 15, weight: 600, name: 'quote' }),
    T(52, 90, '— Author Name, Company', { size: 12, fill: '{{muted}}', name: 'cite' })], { dev: '<blockquote> with a <cite>; the accent bar is a border-left.' }),
  item('html-dropcap-text', 'Text block with drop cap', 'content', 'p', 320, 88, [T(0, 56, 'L', { size: 60, weight: 800, fill: '{{accent}}', name: 'dropcap' }),
    ...lines(48, 20, 20, ['orem ipsum dolor sit amet, consec-', 'tetur adipiscing elit, sed do eiusmod', 'tempor incididunt ut labore et dolore'], { size: 13, fill: '{{muted}}', name: 'text' }),
    T(0, 80, 'magna aliqua. Ut enim ad minim veniam.', { size: 13, fill: '{{muted}}', name: 'text-4' })], { dev: '<p> whose ::first-letter is floated and enlarged (drop cap).' }),
  item('html-icon-list', 'Icon list', 'content', 'ul', 280, 128, ['Unlimited projects', 'Responsive layouts', 'Theme tokens', 'Priority support'].flatMap((s, i) => [
    I('check', 0, 4 + i * 32, 22, { name: `icon-${i + 1}`, stroke: '{{success}}' }), T(34, 20 + i * 32, s, { size: 14, name: `item-${i + 1}` })]), { dev: '<ul> with an icon per <li>; the icon is decorative (aria-hidden).' }),
  item('html-animated-heading', 'Animated heading', 'content', 'h2', 340, 48, [T(0, 34, 'We build', { size: 26, weight: 800, name: 'static-text' }),
    R(124, 4, 150, 40, { fill: '{{accent}}', fo: 0.14, rx: 10, name: 'highlight' }), T(136, 34, 'websites', { size: 26, weight: 800, fill: '{{accent}}', name: 'rotating-word' }),
    L(136, 42, 262, 42, { stroke: '{{accent}}', sw: 3, name: 'underline' })], { dev: 'Heading whose highlighted word rotates / types through a list every 2.5 s; keep the full sentence for screen readers and respect prefers-reduced-motion.' }),
  item('html-text-marquee', 'Text scroller (marquee)', 'content', 'div', 340, 40, [R(0, 0, 340, 40, { role: 'card', rx: 20, name: 'surface' }),
    T(170, 25, 'New release  •  Free shipping  •  24/7 support', { size: 12, weight: 600, anchor: 'middle', name: 'scroll-text' })], { dev: 'Continuously scrolling ticker (CSS translateX loop); pause on hover and with prefers-reduced-motion.' }),
  item('html-code-block', 'Code block', 'content', 'pre', 320, 140, [R(0, 0, 320, 140, { fill: '{{paper}}', stroke: '{{line}}', rx: 14, name: 'surface' }),
    C(18, 18, 5, { fill: '{{danger}}', name: 'dot-1' }), C(34, 18, 5, { fill: '{{warning}}', name: 'dot-2' }), C(50, 18, 5, { fill: '{{success}}', name: 'dot-3' }),
    T(304, 22, 'JS', { size: 11, weight: 700, anchor: 'end', fill: '{{muted}}', name: 'language' }), L(0, 34, 320, 34, { name: 'divider' }),
    T(16, 58, 'const greet = (name) => {', { size: 12, fill: '{{accent}}', name: 'code-1' }), T(32, 80, 'return `Hello, ${name}!`;', { size: 12, name: 'code-2' }),
    T(16, 102, '};', { size: 12, fill: '{{accent}}', name: 'code-3' }), T(16, 124, "greet('world');", { size: 12, fill: '{{muted}}', name: 'code-4' })], { dev: '<pre><code> with syntax highlighting and a copy-to-clipboard button.' }),
  item('html-table-of-contents', 'Table of contents', 'content', 'nav', 240, 168, [R(0, 0, 240, 168, { role: 'card', rx: 16, name: 'surface' }), T(16, 30, 'On this page', { size: 13, weight: 700, name: 'title' }), L(16, 42, 224, 42, { name: 'divider' }),
    ...[['1. Introduction', 0], ['2. Getting started', 0], ['2.1 Install', 1], ['2.2 Configure', 1], ['3. Next steps', 0]].map(([s, d], i) => T(16 + d * 14, 66 + i * 22, s, { size: 13, weight: i === 0 ? 700 : 400, fill: i === 0 ? '{{accent}}' : '{{muted}}', name: `entry-${i + 1}` }))],
  { dev: 'nav aria-label="Table of contents" built from the page h2/h3; highlight the section in view (IntersectionObserver).' }),
  item('html-spacer', 'Empty space (spacer)', 'content', 'div', 320, 40, [R(0.5, 0.5, 319, 39, { stroke: '{{line}}', dash: '4 4', rx: 8, name: 'space-guide' }), L(160, 6, 160, 34, { stroke: '{{dim}}', dash: '3 3', name: 'height-marker' }),
    T(170, 24, '40 px spacing', { size: 11, fill: '{{dim}}', name: 'hint' })], { dev: 'Empty <div> with a fixed (responsive) height; the guide is design-time only and is not rendered.' }),
  item('html-embed', 'Custom HTML / embed', 'content', 'div', 320, 120, [R(1, 1, 318, 118, { stroke: '{{line}}', sw: 1.2, dash: '6 5', rx: 14, name: 'surface' }),
    T(160, 58, '</>', { size: 26, weight: 800, anchor: 'middle', fill: '{{accent}}', name: 'glyph' }), T(160, 86, 'Custom HTML / embed', { size: 13, weight: 600, anchor: 'middle', name: 'title' }),
    T(160, 104, 'iframe, widget or script', { size: 11, anchor: 'middle', fill: '{{muted}}', name: 'hint' })], { dev: 'Raw HTML / third-party embed slot: sanitize the markup and sandbox iframes.' }),

  /* ---- page sections ---- */
  item('html-announcement-bar', 'Announcement bar', 'sections', 'div', 390, 40, [R(0, 0, 390, 40, { fill: '{{accent}}', name: 'surface' }),
    T(195, 25, 'Limited offer: 20% off all plans  →', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'message' }), I('close', 360, 10, 20, { stroke: '{{onAccent}}', name: 'dismiss' })],
  { dev: 'Top-of-page promo bar; the close button hides it and remembers the choice.' }),
  item('html-hero-section', 'Hero section', 'sections', 'section', 390, 260, [R(0, 0, 390, 260, { role: 'card', rx: 24, name: 'surface' }), R(0, 0, 390, 260, { fill: '{{accent}}', fo: 0.1, rx: 24, name: 'tint' }),
    T(195, 56, 'WELCOME', { size: 11, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'eyebrow' }), T(195, 96, 'Build pages faster', { size: 28, weight: 800, anchor: 'middle', name: 'headline' }),
    ...lines(195, 126, 20, ['Drag, drop and publish responsive', 'sections without writing code.'], { size: 14, anchor: 'middle', fill: '{{muted}}', name: 'lead' }),
    R(83, 174, 108, 44, { fill: '{{accent}}', rx: 12, name: 'cta-primary' }), T(137, 201, 'Get started', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'cta-primary-label' }),
    R(199, 174, 108, 44, { role: 'button', rx: 12, name: 'cta-secondary' }), T(253, 201, 'Learn more', { size: 14, weight: 700, anchor: 'middle', name: 'cta-secondary-label' })],
  { dev: '<section> hero: <h1> headline, lead paragraph, primary + secondary CTA links; optional background image or video.' }),
  item('html-call-to-action', 'Call to action', 'sections', 'section', 340, 150, [R(0, 0, 340, 150, { fill: '{{accent}}', rx: 22, name: 'surface' }),
    T(24, 44, 'Ready to get started?', { size: 20, weight: 800, fill: '{{onAccent}}', name: 'title' }), T(24, 70, 'Join thousands of teams building today.', { size: 13, fill: '{{onAccent}}', name: 'text' }),
    R(24, 90, 140, 40, { fill: '{{onAccent}}', rx: 12, name: 'cta' }), T(94, 115, 'Start free trial', { size: 14, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'cta-label' })],
  { dev: 'CTA band: heading, one sentence and one prominent link-button.' }),
  item('html-feature-box', 'Feature box (icon box)', 'sections', 'article', 220, 200, [R(0, 0, 220, 200, { role: 'card', rx: 20, name: 'surface' }), C(110, 52, 28, { fill: '{{accent}}', fo: 0.14, name: 'icon-bg' }),
    I('features', 94, 36, 32, { stroke: '{{accent}}', name: 'icon' }), T(110, 112, 'Fast performance', { size: 16, weight: 700, anchor: 'middle', name: 'title' }),
    ...lines(110, 138, 18, ['Optimised assets and', 'lazy-loaded media.'], { size: 12, anchor: 'middle', fill: '{{muted}}', name: 'text' }),
    T(110, 184, 'Learn more →', { size: 12, weight: 700, anchor: 'middle', fill: '{{accent}}', name: 'link' })], { dev: 'Icon + title + text card; use in a 3- or 4-column feature grid.' }),
  item('html-pricing-table', 'Pricing table', 'sections', 'article', 260, 340, [R(0, 0, 260, 340, { role: 'card', rx: 22, name: 'surface' }),
    R(170, 16, 74, 22, { fill: '{{accent}}', rx: 11, name: 'badge' }), T(207, 31, 'POPULAR', { size: 10, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'badge-text' }),
    T(24, 40, 'Pro', { size: 18, weight: 800, name: 'plan' }), T(24, 86, '$29', { size: 40, weight: 800, name: 'price' }), T(102, 86, '/ month', { size: 13, fill: '{{muted}}', name: 'period' }), L(24, 106, 236, 106, { name: 'divider' }),
    ...['10 projects', 'Unlimited pages', 'Custom domain', 'Email support'].flatMap((s, i) => [I('check', 24, 120 + i * 32, 20, { stroke: '{{success}}', name: `feature-${i + 1}-icon` }), T(54, 135 + i * 32, s, { size: 13, name: `feature-${i + 1}` })]),
    R(24, 268, 212, 48, { fill: '{{accent}}', rx: 14, name: 'cta' }), T(130, 297, 'Choose plan', { size: 15, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'cta-label' })],
  { dev: 'Pricing plan card; place 2–4 side by side, the featured one highlighted. Prices come from data.' }),
  item('html-testimonial', 'Testimonial', 'sections', 'figure', 320, 180, [R(0, 0, 320, 180, { role: 'card', rx: 20, name: 'surface' }),
    ...[0, 1, 2, 3, 4].map(i => I('star', 20 + i * 22, 18, 18, { stroke: '{{warning}}', name: `star-${i + 1}` })),
    ...lines(20, 70, 22, ['“This builder cut our launch time', 'in half. Highly recommended.”'], { size: 14, weight: 600, name: 'quote' }),
    C(40, 140, 20, { role: 'button', name: 'avatar' }), I('user-placeholder', 28, 128, 24, { name: 'avatar-icon' }),
    T(72, 136, 'Jane Doe', { size: 14, weight: 700, name: 'author' }), T(72, 154, 'Marketing lead, Acme', { size: 12, fill: '{{muted}}', name: 'role' })],
  { dev: '<figure> with <blockquote> and <figcaption> (author, role, avatar, rating); several of them form a testimonial carousel.' }),
  item('html-team-member', 'Team member (person)', 'sections', 'article', 220, 260, [R(0, 0, 220, 260, { role: 'card', rx: 20, name: 'surface' }), C(110, 70, 46, { role: 'button', name: 'photo' }),
    I('user-placeholder', 82, 42, 56, { name: 'photo-icon' }), T(110, 148, 'Alex Morgan', { size: 16, weight: 700, anchor: 'middle', name: 'name' }),
    T(110, 168, 'Product Designer', { size: 12, anchor: 'middle', fill: '{{accent}}', name: 'role' }), T(110, 192, 'Designs systems & flows.', { size: 12, anchor: 'middle', fill: '{{muted}}', name: 'bio' }),
    ...['share', 'contact', 'send'].flatMap((k, i) => [C(74 + i * 36, 226, 14, { role: 'button', name: `${k}-bg` }), I(k, 65 + i * 36, 217, 18, { name: `${k}-icon` })])],
  { dev: 'Person card: photo, name, role, short bio and profile links.' }),
  item('html-process-steps', 'Process steps', 'sections', 'ol', 340, 120, [L(84, 36, 142, 36, { stroke: '{{line}}', sw: 2, dash: '4 4', name: 'connector-1' }), L(198, 36, 256, 36, { stroke: '{{line}}', sw: 2, dash: '4 4', name: 'connector-2' }),
    ...[['Plan', 'Define goals'], ['Build', 'Design pages'], ['Launch', 'Go live']].flatMap(([t, s], i) => [C(56 + i * 114, 36, 24, { fill: '{{accent}}', name: `step-${i + 1}` }),
      T(56 + i * 114, 43, String(i + 1), { size: 18, weight: 800, anchor: 'middle', fill: '{{onAccent}}', name: `step-${i + 1}-number` }),
      T(56 + i * 114, 84, t, { size: 14, weight: 700, anchor: 'middle', name: `step-${i + 1}-title` }), T(56 + i * 114, 104, s, { size: 11, anchor: 'middle', fill: '{{muted}}', name: `step-${i + 1}-text` })])],
  { dev: '<ol> of numbered how-it-works steps; stacks vertically on narrow screens.' }),
  item('html-timeline', 'Timeline', 'sections', 'ol', 300, 220, [L(16, 10, 16, 210, { stroke: '{{line}}', sw: 2, name: 'axis' }),
    ...[['2024', 'Company founded'], ['2025', 'First 1,000 users'], ['2026', 'Global launch']].flatMap(([y, t], i) => [
      C(16, 26 + i * 68, 7, i === 0 ? { fill: '{{accent}}', name: `dot-${i + 1}` } : { role: 'field', name: `dot-${i + 1}` }),
      T(40, 24 + i * 68, y, { size: 11, weight: 700, fill: '{{accent}}', name: `date-${i + 1}` }), T(40, 44 + i * 68, t, { size: 14, weight: 700, name: `title-${i + 1}` }),
      T(40, 62 + i * 68, 'Short milestone description.', { size: 12, fill: '{{muted}}', name: `text-${i + 1}` })])],
  { dev: '<ol> of dated milestones on a vertical axis; alternate sides on wide screens.' }),
  item('html-logo-strip', 'Clients logo strip', 'sections', 'section', 340, 72, [R(0, 0, 340, 72, { role: 'card', rx: 18, name: 'surface' }),
    ...[0, 1, 2, 3].flatMap(i => [R(16 + i * 80, 20, 68, 32, { fill: '{{muted}}', fo: 0.18, rx: 8, name: `logo-${i + 1}` }), T(50 + i * 80, 41, 'LOGO', { size: 11, weight: 800, anchor: 'middle', fill: '{{dim}}', name: `logo-${i + 1}-text` })])],
  { dev: 'Clients / partners row: greyscale logos (colour on hover) with alt text; becomes a carousel when it overflows.' }),
  item('html-image-content', 'Image with content', 'sections', 'article', 340, 160, [R(0, 0, 340, 160, { role: 'card', rx: 20, name: 'surface' }), R(12, 12, 140, 136, { fill: '{{paper}}', rx: 14, name: 'image' }),
    I('gallery', 66, 64, 32, { stroke: '{{accent}}', name: 'image-icon' }), T(168, 44, 'Image with text', { size: 16, weight: 700, name: 'title' }),
    ...lines(168, 68, 18, ['Pair a picture with a', 'short story or feature.'], { size: 12, fill: '{{muted}}', name: 'text' }),
    R(168, 106, 100, 32, { fill: '{{accent}}', rx: 10, name: 'cta' }), T(218, 127, 'Read more', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'cta-label' })],
  { dev: 'Media + text split; the image side can be left or right and stacks on top on mobile.' }),
  item('html-article-list', 'Articles list (blog)', 'sections', 'section', 340, 230, [R(0, 0, 340, 230, { role: 'card', rx: 20, name: 'surface' }), T(16, 30, 'Latest articles', { size: 15, weight: 700, name: 'title' }),
    ...[['NEWS', 'How to design a landing page'], ['GUIDE', 'Ten layout tips for mobile']].flatMap(([c, t], i) => [R(16, 48 + i * 88, 84, 72, { fill: '{{paper}}', rx: 10, name: `thumb-${i + 1}` }),
      I('gallery', 46, 72 + i * 88, 24, { stroke: '{{dim}}', name: `thumb-${i + 1}-icon` }), T(112, 62 + i * 88, c, { size: 10, weight: 700, fill: '{{accent}}', name: `category-${i + 1}` }),
      T(112, 82 + i * 88, t, { size: 13, weight: 700, name: `headline-${i + 1}` }), T(112, 102 + i * 88, 'Nov 10, 2026 · 5 min read', { size: 11, fill: '{{muted}}', name: `meta-${i + 1}` })])],
  { dev: 'List of the latest posts (thumbnail, category, title, date); each row links to the article. Data-driven.' }),
  item('html-price-list', 'Price list (menu)', 'sections', 'ul', 320, 150, [R(0, 0, 320, 150, { role: 'card', rx: 18, name: 'surface' }),
    ...[['Margherita', '$12', 'Tomato, mozzarella, basil'], ['Caesar salad', '$9', 'Romaine, parmesan, croutons'], ['Espresso', '$3', 'Double shot']].flatMap(([n, p, d], i) => [
      T(20, 36 + i * 42, n, { size: 14, weight: 700, name: `item-${i + 1}` }), T(300, 36 + i * 42, p, { size: 14, weight: 700, anchor: 'end', fill: '{{accent}}', name: `price-${i + 1}` }),
      T(20, 52 + i * 42, d, { size: 11, fill: '{{muted}}', name: `description-${i + 1}` })])], { dev: 'Name / description / price rows (restaurant menu, service list).' }),
  item('html-footer', 'Footer', 'sections', 'footer', 390, 170, [R(0, 0, 390, 170, { role: 'card', rx: 20, name: 'surface' }), I('home', 20, 20, 24, { stroke: '{{accent}}', name: 'logo' }),
    T(52, 38, 'Brand', { size: 16, weight: 800, name: 'brand' }), T(20, 64, 'Short company tagline here.', { size: 12, fill: '{{muted}}', name: 'tagline' }),
    ...[['Product', ['Features', 'Pricing', 'Updates']], ['Company', ['About', 'Careers', 'Contact']]].flatMap(([h, ls], c) => [T(220 + c * 90, 38, h, { size: 12, weight: 700, name: `column-${c + 1}-title` }),
      ...ls.map((s, i) => T(220 + c * 90, 62 + i * 22, s, { size: 12, fill: '{{muted}}', name: `column-${c + 1}-link-${i + 1}` }))]),
    L(20, 128, 370, 128, { name: 'divider' }), T(20, 154, '© 2026 Brand. All rights reserved.', { size: 11, fill: '{{dim}}', name: 'copyright' }), I('share', 350, 138, 20, { name: 'social' })],
  { dev: '<footer> with brand, link columns, copyright and social links.' }),

  /* ---- forms ---- */
  item('html-newsletter-optin', 'Newsletter opt-in', 'forms', 'form', 340, 130, [R(0, 0, 340, 130, { role: 'card', rx: 20, name: 'surface' }), T(20, 36, 'Subscribe to our newsletter', { size: 16, weight: 700, name: 'title' }),
    T(20, 58, 'Monthly tips, no spam.', { size: 12, fill: '{{muted}}', name: 'text' }), R(20, 74, 200, 40, { role: 'field', rx: 12, name: 'email' }), T(34, 99, 'Your e-mail', { size: 13, fill: '{{muted}}', name: 'email-placeholder' }),
    R(228, 74, 92, 40, { fill: '{{accent}}', rx: 12, name: 'submit' }), T(274, 99, 'Subscribe', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'submit-label' })],
  { dev: '<form> with input type="email" and a submit; double opt-in, show a success message inline.' }),
  item('html-contact-form', 'Contact form', 'forms', 'form', 320, 400, [R(0, 0, 320, 400, { role: 'card', rx: 24, name: 'surface' }), T(20, 40, 'Contact us', { size: 20, weight: 800, name: 'title' }),
    ...field2(20, 80, 280, 44, 'NAME', 'Your name', 'name'), ...field2(20, 156, 280, 44, 'E-MAIL', 'name@example.com', 'email'), ...field2(20, 232, 280, 80, 'MESSAGE', 'How can we help?', 'message'),
    R(20, 332, 280, 48, { fill: '{{accent}}', rx: 14, name: 'submit' }), T(160, 362, 'Send message', { size: 15, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'submit-label' })],
  { dev: '<form> name / email / message with labels, validation, spam protection and a success state.' }),

  /* ---- data & counters ---- */
  item('html-countdown', 'Countdown timer', 'data', 'div', 320, 100, [R(0, 0, 320, 100, { role: 'card', rx: 18, name: 'surface' }),
    ...[['12', 'DAYS'], ['08', 'HOURS'], ['45', 'MINUTES'], ['30', 'SECONDS']].flatMap(([v, u], i) => [R(14 + i * 76, 14, 64, 52, { role: 'field', rx: 12, name: `${u.toLowerCase()}-box` }),
      T(46 + i * 76, 50, v, { size: 24, weight: 800, anchor: 'middle', name: `${u.toLowerCase()}-value` }), T(46 + i * 76, 86, u, { size: 10, weight: 700, anchor: 'middle', fill: '{{muted}}', name: `${u.toLowerCase()}-unit` })])],
  { dev: 'Counts down to a target date (updates every second, aria-live="off"); shows a message when it reaches zero.' }),
  item('html-animated-number', 'Animated number (counter)', 'data', 'div', 160, 100, [R(0, 0, 160, 100, { role: 'card', rx: 18, name: 'surface' }),
    T(80, 52, '12,500+', { size: 30, weight: 800, anchor: 'middle', fill: '{{accent}}', name: 'value' }), T(80, 78, 'Happy customers', { size: 12, anchor: 'middle', fill: '{{muted}}', name: 'caption' })],
  { dev: 'Number counts up from 0 when it scrolls into view (1.5 s ease-out); the final value is in the DOM for SEO.' }),
  item('html-circular-progress', 'Circular progress (pie)', 'data', 'div', 120, 120, [C(60, 60, 48, { stroke: '{{line}}', sw: 10, name: 'track' }),
    P('M60 12 A48 48 0 1 1 12.85 69', { stroke: '{{accent}}', sw: 10, name: 'progress-arc' }), T(60, 68, '72%', { size: 22, weight: 800, anchor: 'middle', name: 'value' })],
  { dev: 'role="progressbar" aria-valuenow; SVG circle with stroke-dashoffset, animated when in view.' }),
  item('html-progress-bars', 'Skill / progress bars', 'data', 'div', 300, 96, [
    ...[['Design', 85], ['Development', 70]].flatMap(([s, v], i) => [T(0, 16 + i * 52, s, { size: 13, weight: 700, name: `label-${i + 1}` }), T(300, 16 + i * 52, `${v}%`, { size: 13, weight: 700, anchor: 'end', fill: '{{accent}}', name: `value-${i + 1}` }),
      R(0, 28 + i * 52, 300, 10, { fill: '{{line}}', rx: 5, name: `track-${i + 1}` }), R(0, 28 + i * 52, v * 3, 10, { fill: '{{accent}}', rx: 5, name: `fill-${i + 1}` })])],
  { dev: 'Labelled bars (role="progressbar"); fill animates to the value when in view.' }),
  item('html-bar-chart', 'Bar chart', 'data', 'figure', 300, 190, [R(0, 0, 300, 190, { role: 'card', rx: 18, name: 'surface' }), T(16, 28, 'Monthly visits', { size: 13, weight: 700, name: 'title' }),
    L(16, 160, 284, 160, { name: 'baseline' }),
    ...[60, 90, 70, 110, 85, 120].flatMap((h, i) => [R(24 + i * 44, 160 - h, 28, h, { fill: '{{accent}}', rx: 6, op: i === 5 ? 1 : 0.55, name: `bar-${i + 1}` }),
      T(38 + i * 44, 178, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][i], { size: 10, anchor: 'middle', fill: '{{muted}}', name: `month-${i + 1}` })])],
  { dev: 'Chart block: render with a chart library from data; provide a table fallback for screen readers.' }),

  /* ---- media ---- */
  item('html-video-player', 'Video player', 'media', 'video', 340, 200, [R(0, 0, 340, 200, { role: 'card', rx: 18, name: 'surface' }), R(8, 8, 324, 148, { fill: '{{paper}}', rx: 12, name: 'video-frame' }),
    C(170, 82, 28, { fill: '{{accent}}', name: 'play-bg' }), P('M162 70 L182 82 L162 94 Z', { fill: '{{onAccent}}', stroke: '{{onAccent}}', name: 'play-icon' }),
    I('pause', 14, 166, 24, { name: 'play-pause' }), R(48, 176, 200, 4, { fill: '{{line}}', rx: 2, name: 'track' }), R(48, 176, 80, 4, { fill: '{{accent}}', rx: 2, name: 'played' }),
    C(128, 178, 6, { fill: '{{accent}}', name: 'scrubber' }), T(326, 183, '1:24 / 4:05', { size: 10, anchor: 'end', fill: '{{muted}}', name: 'time' })],
  { dev: '<video> (or YouTube / Vimeo embed) with a poster, captions track and keyboard-accessible controls; no autoplay with sound.' }),
  item('html-image-gallery', 'Image gallery (grid)', 'media', 'div', 320, 216, [R(0, 0, 320, 216, { role: 'card', rx: 16, name: 'surface' }),
    ...[0, 1, 2, 3, 4, 5].flatMap(i => { const x = 8 + (i % 3) * 104, y = 8 + Math.floor(i / 3) * 104;
      return [R(x, y, 96, 96, { fill: '{{paper}}', rx: 12, name: `image-${i + 1}` }), I('gallery', x + 36, y + 36, 24, { stroke: '{{dim}}', name: `image-${i + 1}-icon` })]; })],
  { dev: 'Responsive image grid (masonry optional); clicking an image opens a lightbox with prev / next. Lazy-load, alt text per image.' }),
  item('html-image-comparison', 'Before / after image', 'media', 'div', 320, 200, [R(0, 0, 320, 200, { fill: '{{paper}}', rx: 16, name: 'before-image' }),
    R(160, 0, 160, 200, { fill: '{{accent}}', fo: 0.18, name: 'after-image' }),
    R(12, 12, 64, 22, { role: 'card', rx: 11, name: 'before-tag' }), T(44, 27, 'BEFORE', { size: 10, weight: 700, anchor: 'middle', name: 'before-label' }),
    R(244, 12, 64, 22, { role: 'card', rx: 11, name: 'after-tag' }), T(276, 27, 'AFTER', { size: 10, weight: 700, anchor: 'middle', name: 'after-label' }),
    L(160, 0, 160, 200, { stroke: '{{onAccent}}', sw: 3, name: 'divider' }), C(160, 100, 18, { role: 'button', name: 'handle' }),
    I('previous', 143, 92, 16, { name: 'handle-left' }), I('next', 161, 92, 16, { name: 'handle-right' })],
  { dev: 'Two stacked images; dragging the handle (or arrow keys, role="slider") reveals the after image via clip-path.' }),
  item('html-image-overlay', 'Image with overlay', 'media', 'figure', 300, 200, [R(0, 0, 300, 200, { fill: '{{paper}}', rx: 18, name: 'image' }), I('gallery', 134, 40, 32, { stroke: '{{dim}}', name: 'image-icon' }),
    R(0, 110, 300, 90, { fill: '{{accent}}', fo: 0.85, rx: 18, name: 'overlay' }), T(20, 148, 'Mountain retreat', { size: 17, weight: 800, fill: '{{onAccent}}', name: 'title' }),
    T(20, 172, 'Hover to reveal details', { size: 12, fill: '{{onAccent}}', name: 'caption' })], { dev: '<figure> with a caption overlay that slides up on hover / focus.' }),
  item('html-map-embed', 'Map', 'media', 'div', 320, 200, [R(0, 0, 320, 200, { fill: '{{paper}}', rx: 16, name: 'map' }),
    L(0, 70, 320, 90, { stroke: '{{line}}', sw: 6, name: 'road-1' }), L(110, 0, 140, 200, { stroke: '{{line}}', sw: 6, name: 'road-2' }), L(220, 0, 200, 200, { stroke: '{{line}}', sw: 3, name: 'road-3' }),
    P('M170 64 C170 48 194 48 194 64 C194 78 182 88 182 96 C182 88 170 78 170 64 Z', { fill: '{{danger}}', stroke: '{{danger}}', name: 'marker' }), C(182, 64, 5, { fill: '{{onAccent}}', name: 'marker-dot' }),
    R(12, 12, 150, 40, { role: 'card', rx: 10, name: 'info-card' }), T(24, 30, 'Our office', { size: 12, weight: 700, name: 'place' }), T(24, 44, '123 Main Street', { size: 10, fill: '{{muted}}', name: 'address' }),
    R(280, 140, 28, 48, { role: 'card', rx: 8, name: 'zoom' }), T(294, 159, '+', { size: 16, weight: 700, anchor: 'middle', name: 'zoom-in' }), T(294, 181, '−', { size: 16, weight: 700, anchor: 'middle', name: 'zoom-out' })],
  { dev: 'Map embed (OpenStreetMap / Google Maps) with a marker and address; lazy-load the iframe, link to directions.' }),

  /* ---- social ---- */
  item('html-social-icons', 'Social icons', 'social', 'nav', 216, 48, [...['f', 'X', 'in', '▶'].flatMap((s, i) => [C(24 + i * 56, 24, 22, { role: 'button', name: `network-${i + 1}` }),
    T(24 + i * 56, 29, s, { size: 15, weight: 800, anchor: 'middle', fill: '{{accent}}', name: `network-${i + 1}-glyph` })])],
  { dev: 'Links to the brand profiles; swap the glyphs for the networks\' official icons, aria-label per link, rel="noopener".' }),
  item('html-social-share', 'Social share buttons', 'social', 'div', 300, 40, [T(0, 25, 'Share:', { size: 13, weight: 700, name: 'label' }),
    ...['Post', 'Mail', 'Link', 'More'].flatMap((s, i) => [R(56 + i * 60, 4, 52, 32, { role: 'button', rx: 16, name: `${s.toLowerCase()}-bg` }), T(82 + i * 60, 25, s, { size: 12, weight: 700, anchor: 'middle', name: `${s.toLowerCase()}-label` })])],
  { dev: 'Share the current URL; use the Web Share API when available, "Link" copies to the clipboard.' }),

  /* ---- buttons ---- */
  item('html-button-group', 'Button group (segmented)', 'buttons', 'div', 300, 48, [R(0, 0, 300, 48, { role: 'field', rx: 14, name: 'surface' }), R(4, 4, 96, 40, { fill: '{{accent}}', rx: 11, name: 'active' }),
    T(52, 29, 'Day', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'option-1' }), T(150, 29, 'Week', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'option-2' }),
    L(200, 14, 200, 34, { name: 'separator' }), T(248, 29, 'Month', { size: 14, weight: 600, anchor: 'middle', fill: '{{muted}}', name: 'option-3' })],
  { dev: 'role="group" of buttons with aria-pressed (segmented control); exactly one is active.' }),
  item('html-back-to-top', 'Back to top button', 'buttons', 'button', 56, 56, [C(28, 28, 26, { role: 'button', name: 'surface' }), P('M18 32 L28 22 L38 32', { stroke: '{{accent}}', sw: 3, name: 'arrow' })],
  { dev: 'Fixed bottom-right button shown after scrolling one screen; smooth-scrolls to the top, aria-label="Back to top".' }),
  item('html-cookie-consent', 'Cookie consent banner', 'feedback', 'div', 360, 120, [R(0, 0, 360, 120, { role: 'card', rx: 18, name: 'surface' }), I('policy', 16, 16, 24, { stroke: '{{accent}}', name: 'icon' }),
    T(50, 34, 'We use cookies', { size: 15, weight: 700, name: 'title' }), T(16, 60, 'Cookies help us improve your experience.', { size: 12, fill: '{{muted}}', name: 'text' }),
    R(16, 74, 120, 34, { role: 'button', rx: 10, name: 'preferences' }), T(76, 96, 'Preferences', { size: 12, weight: 700, anchor: 'middle', name: 'preferences-label' }),
    R(224, 74, 120, 34, { fill: '{{accent}}', rx: 10, name: 'accept' }), T(284, 96, 'Accept all', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'accept-label' })],
  { dev: 'Fixed bottom consent banner; no non-essential cookies before consent, store the choice, "Preferences" opens the category settings.' })
];
