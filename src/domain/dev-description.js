/**
 * description-dev generators. The text is an instruction for the dev team's coding agents:
 * what to build, with exact names, sizes and behaviour. Authors can edit it; these are the seeded defaults.
 */
const list = a => a.filter(Boolean).join(', ');

export function pathDevDescription(path, nodes) {
  const shapes = nodes.filter(e => e.parentId == null).length;
  return [
    `Path group "${path.key}" (${path.label}) - reusable set of ${shapes} vector shape(s) on the 24x24 grid.`,
    'It is a building block of icons: place it inside an icon, scale/rotate it there; editing it updates every icon that uses it.',
    `Export: svg/paths/${path.key}.svg. Variable name in code: "${path.key}".`
  ].join('\n');
}

export function iconDevDescription(icon, nodes, paths = []) {
  const shapes = nodes.filter(e => e.parentId == null).length;
  const animated = nodes.some(e => /anim-/.test(e.attrs?.class || ''));
  return [
    `Icon "${icon.key}" (${icon.label}) - 24x24 stroke icon made of ${paths.length ? paths.length + ' path group(s) (' + list(paths) + ')' : shapes + ' shape(s)'}.`,
    `Use it through the shared SVG sprite: <svg class="icon"><use href="svg/sprite.svg#i-${icon.key}"/></svg>.`,
    'Never hard-code stroke width or colour: size and colour come from the active theme (--ud-sw, --ud-accent).',
    animated ? 'This icon carries a built-in animation (see animations); keep it running while the related state is active (loading, scanning, thinking).' : '',
    `Variable name in code: "${icon.key}".`
  ].filter(Boolean).join('\n');
}

export function buttonDevDescription(button, nodes, icons = [], menu = null) {
  return [
    `Button "${button.key}" (${button.label}) - ${button.width}x${button.height} px themed frame with ${icons.length ? 'icon ' + list(icons) : 'a label'}.`,
    'Render it as a <button type="button"> with an aria-label from the label; the frame (fill, border, shadow) comes from the theme, the size and margin from the theme button tokens.',
    menu?.items?.length ? `It owns a ${menu.config.kind} menu (${menu.config.layout}) with ${menu.items.length} item(s) nested up to ${menu.depth} level(s). Behaviour: click opens the items, click again closes; an item with sub items shows them (the centre takes that item's icon when rotating); click the centre to go one level back; a leaf item runs its action/target.` : ''
  ].filter(Boolean).join('\n');
}

export function menuItemDevDescription(item, parentPath = '') {
  return `Menu item "${parentPath ? parentPath + '/' : ''}${item.name}" (${item.label || 'no label'}): ${item.hasChildren ? 'opens its sub items.' : 'leaf item - run its action or navigate to its target screen, then close the menu.'}`;
}

export function elementDevDescription(item, nodes, icons = []) {
  const tag = item.meta?.htmlTag ? `Semantic HTML element: <${item.meta.htmlTag}>. ` : '';
  const texts = nodes.filter(e => e.tag === 'text' && e.text).slice(0, 6).map(e => `"${e.text}"`);
  return [
    `Element "${item.key}" (${item.label}) - ${item.width}x${item.height} px, category ${item.category}. Everything inside is placed in this bounding box and scales with it.`,
    `${tag}Build it as a reusable component; every colour must come from theme tokens (bg, surface, text, muted, accent, line) so all four themes work.`,
    icons.length ? `Icons used: ${list(icons)}.` : '',
    texts.length ? `Sample text in the design: ${list(texts)}. Replace with real data/props; do not hard-code.` : '',
    'Expose props for label/value/state; support disabled and focus states.'
  ].filter(Boolean).join('\n');
}

const SCREEN_PURPOSE = {
  'splash': 'Launch screen shown while the app boots and restores the session. Auto-advance to Sign in (no session) or Scan list (session).',
  'scan-list': 'Home. Lists scan folders with status frame colour (red = scanning/unapproved, orange = all approved, yellow = partly analyzed, green = analyzed). Search and menu buttons in the header.',
  'side-menu': 'Slide-in main menu opened from Scan list. Entries navigate to profile, reports, models, settings, logout.',
  'scan-actions': 'Scan list with the radial/bottom action menu open for the selected folder (rename, move, share, delete, analyze).',
  'booklet-analyzed': 'Booklet (folder) detail after AI analysis: page thumbnails with per-page analysis/review status and summary counts.',
  'booklet-new-pages': 'Booklet detail while new pages are being added; shows unanalyzed pages and the analyze action.',
  'question-detail': 'Single question view with detected answer, AI notes and footer actions (previous, next, re-analyze).',
  'question-menu': 'Question view with the settings menu open (analysis options, comments, parameters).',
  'question-menu-scrolled': 'Same menu scrolled to its lower options. Keep scroll position when reopening.',
  'analyzed-images': 'Gallery of analyzed page images with overlay results; tap an image to open page review.',
  'question-parameters': 'Bottom sheet to edit parameters of one question analysis (model, thresholds, options).',
  'ai-model-metrics': 'Bottom sheet showing performance metrics of the selected AI model (accuracy, latency, cost).',
  're-analyze-page': 'Sheet to re-run AI analysis on one page, choosing model and scope.',
  'project-comments': 'Bottom sheet listing comments of the whole project; supports add comment. Shows loading and empty states.',
  'page-comments': 'Bottom sheet listing comments of one page; supports add comment. Shows loading and empty states.',
  'edit-model-config': 'Form to edit an AI model configuration (identifier, label, provider, fallback order, capability flags).',
  'sign-up': 'Registration form (name, e-mail/phone, password) with tabs Sign in / Sign up / Google.',
  'sign-in': 'Login form (user name, e-mail or phone + password), forgot-password link and switch to sign up.',
  'google-sign-in': 'Google account sign-in tab; triggers the OAuth flow and returns to Scan list.',
  'document-analyze': 'Document screen with the analyze/folder main button. Tapping opens the radial menu.',
  'document-radial-actions': 'Document screen with the radial action ring open (add, rename, move, delete, share).',
  'document-bottom-actions': 'Document screen with the bottom action bar (report, save, back, inspect, template).',
  'document-share-ring': 'Document screen with the share ring (sync, analyze, view, share, back).'
};

export function screenDevDescription(screen, nodes, { icons = [], links = [] } = {}) {
  const purpose = SCREEN_PURPOSE[screen.key] || `Screen "${screen.label}".`;
  const texts = nodes.filter(e => e.tag === 'text' && e.text).map(e => e.text);
  const headline = texts.slice(0, 5).map(t => `"${t}"`);
  return [
    `Screen "${screen.key}" - ${screen.width}x${screen.height} px (${screen.meta?.device || 'custom device'}).`,
    purpose,
    headline.length ? `Visible copy: ${list(headline)}${texts.length > 5 ? ` and ${texts.length - 5} more` : ''}.` : '',
    icons.length ? `Icons: ${list(icons)}.` : '',
    links.length ? `Navigation: ${links.map(l => `${l.name || 'link'} -> ${l.toKey}`).join('; ')}.` : '',
    `Implement with the exported HTML/CSS/TS: keep element names as ids, use theme tokens for every colour, respect safe areas, and wire each link in the workflow.`
  ].filter(Boolean).join('\n');
}

export function workflowDevDescription(wf, screens) {
  return [
    `Workflow "${wf.key}" (${wf.label}) connects ${screens.length} screen(s).`,
    `Implement the router so every link in this workflow navigates source screen -> target screen on its trigger. Preserve back-stack behaviour: the back button returns to the previous screen.`
  ].join('\n');
}
