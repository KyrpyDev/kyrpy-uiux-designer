/**
 * Shared HTTP Router builder and complete API documentation catalog.
 *
 * Single source of truth for:
 *  - `buildApiRouter(container)`: registers every backend route (used by both the HTTP server and the in-process MCP API bridge).
 *  - `API_OPERATIONS`: structured documentation for every backend route and `interfaces/web/js/api.js` function
 *    (action, aliases, group, method, pattern, scope, mcpAllowed, params, query, body, summary).
 */
import { Router } from './router.js';
import { healthRoutes } from './controllers/health-routes.js';
import { designRoutes } from './controllers/design-routes.js';
import { miscRoutes } from './controllers/misc-routes.js';
import { collabRoutes } from './controllers/collab-routes.js';
import { profileRoutes } from './controllers/profile-routes.js';
import { mcpRoutes } from '../../mcp/interfaces/http/mcp-routes.js';

const T = ':types(paths|icons|buttons|elements|screens)';
const TYPE_PARAM = 'path | icon | button | element | screen (or plural paths | icons | buttons | elements | screens)';
const ID_OR_KEY = 'Numeric id, key, or uid of the item in the project';

/** Registers the full backend `/api/*` route table onto a fresh `Router`. */
export function buildApiRouter(container) {
  const router = new Router();
  healthRoutes(router, container);
  designRoutes(router, container);
  miscRoutes(router, container);
  collabRoutes(router, container);
  if (container.profile) profileRoutes(router, container);
  if (container.mcp) mcpRoutes(router, container);
  return router;
}

/**
 * Structured API catalog covering every backend route and `web/js/api.js` method.
 * `mcpAllowed: true` operations can be called over MCP via `uiux_api_call` within the API key's scope and project/tenant boundary.
 */
export const API_OPERATIONS = [
  // ---- Health ----
  {
    action: 'health', group: 'health', method: 'GET', pattern: '/api/health',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Server health: version, uptime, database probe (no auth).'
  },
  {
    action: 'mcpHealth', group: 'health', method: 'GET', pattern: '/api/health/mcp',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'MCP layer health: enabled, protocol version, tool / resource / prompt counts, active sessions (no auth).'
  },

  // ---- Icon Catalog ----
  {
    action: 'iconSearch', group: 'icons', method: 'GET', pattern: '/api/icons/search',
    scope: 'read', mcpAllowed: true,
    summary: 'Paged search across the icon catalog.',
    query: { q: 'Search query', category: 'Icon category', pack: 'Icon pack prefix', projectId: 'Project id', includePublic: '1 | 0', offset: 'Offset (default 0)', limit: 'Page size (default 200)' }
  },
  {
    action: 'iconsFull', group: 'icons', method: 'GET', pattern: '/api/icons/full',
    scope: 'read', mcpAllowed: true,
    summary: 'Fetches full icon records (with nodes) for comma-separated icon ids.',
    query: { ids: 'Comma-separated icon ids (or array via params)' }
  },
  {
    action: 'iconSprite', group: 'icons', method: 'GET', pattern: '/api/icons/sprite',
    scope: 'read', mcpAllowed: true,
    summary: 'Builds an SVG symbol sprite for selected icon ids in a style.',
    query: { ids: 'Comma-separated icon ids', theme: 'Style key (e.g. liquid)' }
  },
  {
    action: 'iconSpriteBatch', group: 'icons', method: 'POST', pattern: '/api/icons/sprite',
    scope: 'read', mcpAllowed: true,
    summary: 'Builds an SVG symbol sprite from a larger list of icon ids in the request body.',
    body: { ids: 'number[] | string (comma-separated)', theme: 'Optional style key' }
  },

  // ---- Designs (paths, icons, buttons, elements, screens) ----
  {
    action: 'list', aliases: ['listDesigns'], group: 'designs', method: 'GET', pattern: `/api/${T}`,
    scope: 'read', mcpAllowed: true,
    summary: 'Lists designs of one type (paths, icons, buttons, elements, or screens) visible to the project.',
    params: { types: TYPE_PARAM },
    query: { q: 'Search filter', category: 'Category filter', projectId: 'Project id', visibility: 'project | private | public', includePublic: '1 | 0' }
  },
  {
    action: 'designCategories', group: 'designs', method: 'GET', pattern: `/api/${T}/categories`,
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Lists distinct categories for a design type.',
    params: { types: TYPE_PARAM }
  },
  {
    action: 'createDesign', group: 'designs', method: 'POST', pattern: `/api/${T}`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates a path, icon, button, element, or screen in the active project (with optional initial nodes[]).',
    params: { types: TYPE_PARAM },
    body: { name: 'Display name (required)', key: 'Variable-style slug (optional)', label: 'Visible/accessible label', category: 'Category', tags: 'string[]', width: 'Width in dp/px (icons/paths: 24)', height: 'Height in dp/px (icons/paths: 24)', descriptionDev: 'Detailed developer specification', mcpContext: '{ purpose, usage, notes, constraints, related }', meta: 'Metadata object (e.g. device, source)', nodes: 'Optional initial child nodes[]' }
  },
  {
    action: 'getDesign', aliases: ['get'], group: 'designs', method: 'GET', pattern: `/api/${T}/:id`,
    scope: 'read', mcpAllowed: true,
    summary: 'Reads one design record with its full node tree, animations, menuItems (buttons), and outgoing links (screens).',
    params: { types: TYPE_PARAM, id: ID_OR_KEY }
  },
  {
    action: 'getLineage', aliases: ['getDesignLineage'], group: 'designs', method: 'GET', pattern: `/api/${T}/:id/lineage`,
    scope: 'read', mcpAllowed: true,
    summary: 'Returns clone/origin lineage and usage references for a design item (or workflow when type="workflow").',
    params: { types: TYPE_PARAM, id: ID_OR_KEY }
  },
  {
    action: 'updateDesign', group: 'designs', method: 'PUT', pattern: `/api/${T}/:id`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates metadata, dimensions, developer notes, mcpContext, or settings of an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { name: 'Display name', key: 'Item key', label: 'Visible/accessible label', category: 'Category', tags: 'string[]', width: 'Width', height: 'Height', descriptionDev: 'Developer specification', mcpContext: 'AI context object', meta: 'Metadata patch' }
  },
  {
    action: 'reorderDesign', group: 'designs', method: 'POST', pattern: `/api/${T}/:id/order`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Reorders a design in the project library.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { mode: 'front | back | forward | backward' }
  },
  {
    action: 'deleteDesign', group: 'designs', method: 'DELETE', pattern: `/api/${T}/:id`,
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Moves a project design to Trash (pass query force=1 to also remove referring instances).',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    query: { force: '1 to delete even when referenced by higher-level items' }
  },
  {
    action: 'restoreDesign', group: 'designs', method: 'POST', pattern: `/api/${T}/:id/restore`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Restores an owned project design to a provided snapshot.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { record: 'Design record fields', nodes: 'Snapshot nodes[]', animations: 'Snapshot animations[]', menuItems: 'Button menuItems[]' }
  },
  {
    action: 'cloneDesign', group: 'designs', method: 'POST', pattern: `/api/${T}/:id/clone`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Clones a readable design item into the active project under a new name/key.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { name: 'Name for the clone', key: 'Optional key for the clone' }
  },

  // ---- Nodes ----
  {
    action: 'replaceNodes', group: 'nodes', method: 'PUT', pattern: `/api/${T}/:id/nodes`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Replaces the entire node tree of an owned project design in one atomic write.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { nodes: 'Full ordered array of node objects ({ tag, kind, name, role, text, refType, refId, attrs, onClick, events, descriptionDev, parentId, ... })' }
  },
  {
    action: 'addNode', group: 'nodes', method: 'POST', pattern: `/api/${T}/:id/nodes`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Appends a shape, text, group, or sub-item instance node to an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    body: { tag: 'rect | circle | path | text | g | use | ...', kind: 'shape | text | group | instance', name: 'Node variable name (e.g. btnSave)', role: 'Semantic role', text: 'Text content', refType: 'path | icon | button | element (for kind="instance")', refId: 'Referenced sub-item id (or refKey)', attrs: 'SVG/layout attributes ({ x, y, width, height, rx, fill, stroke, ... })', onClick: 'Tap action ({ type, targetId, side, ... })', events: 'Additional trigger actions[]', descriptionDev: 'Control behavior & state specification' }
  },
  {
    action: 'patchNode', group: 'nodes', method: 'PATCH', pattern: `/api/${T}/:id/nodes/:eid`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Patches one node (attributes, position, text, onClick, events, or developer notes) inside a design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, eid: 'Numeric node id' },
    body: { name: 'Node variable name', text: 'Text content', role: 'Semantic role', attrs: 'Attributes patch', onClick: 'Tap action', events: 'Event list', descriptionDev: 'Developer notes', hidden: 'boolean', locked: 'boolean' }
  },
  {
    action: 'deleteNode', group: 'nodes', method: 'DELETE', pattern: `/api/${T}/:id/nodes/:eid`,
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Removes one node from an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, eid: 'Numeric node id' }
  },
  {
    action: 'duplicateNode', group: 'nodes', method: 'POST', pattern: `/api/${T}/:id/nodes/:eid/duplicate`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Duplicates an existing node (and its animations) inside a design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, eid: 'Numeric node id' },
    body: { dx: 'Optional x offset', dy: 'Optional y offset', name: 'Optional name for copy' }
  },

  // ---- Animations ----
  {
    action: 'addAnimation', group: 'animations', method: 'POST', pattern: `/api/${T}/:id/nodes/:eid/animations`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Attaches a CSS/SVG keyframe animation to a node in an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, eid: 'Numeric node id' },
    body: { type: 'move | rotate | scale | fade | visible | blink | pulse | bounce | draw | glow | flip | shake | swing | float | shine | contour-blink | slide-in | keyframes | move-up | move-down | move-left | move-right', trigger: 'always | hover | click | load', duration: 'Seconds or ms', delay: 'Delay', easing: 'Easing function', repeat: 'Iteration count or infinite', params: 'Animation parameters object' }
  },
  {
    action: 'updateAnimation', group: 'animations', method: 'PUT', pattern: `/api/${T}/:id/animations/:aid`,
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates an animation on an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, aid: 'Numeric animation id' },
    body: { type: 'Animation type', trigger: 'Trigger', duration: 'Duration', delay: 'Delay', easing: 'Easing', repeat: 'Repeat', params: 'Parameters object' }
  },
  {
    action: 'deleteAnimation', group: 'animations', method: 'DELETE', pattern: `/api/${T}/:id/animations/:aid`,
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Deletes an animation from an owned project design.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY, aid: 'Numeric animation id' }
  },

  // ---- SVG Render ----
  {
    action: 'designSvg', aliases: ['svgUrl'], group: 'designs', method: 'GET', pattern: `/api/${T}/:id/svg`,
    scope: 'read', mcpAllowed: true,
    summary: 'Renders one design item as standalone SVG in the chosen theme/style.',
    params: { types: TYPE_PARAM, id: ID_OR_KEY },
    query: { theme: 'Style key (e.g. liquid)', animated: '1 | 0', frame: '1 | 0', size: 'Pixel size (default 192)', download: '1 | 0' }
  },

  // ---- Button Menus ----
  {
    action: 'menu', group: 'menus', method: 'GET', pattern: '/api/buttons/:id/menu',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads a button\'s popup / rotating / drawer menu configuration and nested menu items.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'menuConfig', group: 'menus', method: 'PUT', pattern: '/api/buttons/:id/menu/config',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates a button\'s menu layout and configuration (popup, rotating radial, list, drawer, slider, carousel).',
    params: { id: ID_OR_KEY },
    body: { enabled: 'boolean', kind: 'popup | rotating | drawer', layout: 'fan | radial | list | drawer | slider-vertical | slider-horizontal | carousel', trigger: 'click | hover | longpress', radius: 'Radial distance', startAngle: 'Degrees', sweepAngle: 'Degrees' }
  },
  {
    action: 'addMenuItem', group: 'menus', method: 'POST', pattern: '/api/buttons/:id/menu/items',
    scope: 'propose', mcpAllowed: true,
    summary: 'Adds a menu choice (with optional icon, submenu parentId, targetScreenId, or targetElementId) to a button.',
    params: { id: ID_OR_KEY },
    body: { name: 'Dashed lowercase slug (e.g. go-checkout)', label: 'Visible choice text', parentId: 'Optional parent menu item id for nested submenus', iconId: 'Optional icon id (or iconKey)', action: 'screen | popup | drawer | toggle | custom', targetScreenId: 'Target screen id (or targetScreenKey)', targetElementId: 'Target popup/drawer element id (or targetElementKey)', descriptionDev: 'Developer notes for this choice' }
  },
  {
    action: 'updateMenuItem', group: 'menus', method: 'PUT', pattern: '/api/buttons/:id/menu/items/:iid',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates a button menu item.',
    params: { id: ID_OR_KEY, iid: 'Numeric menu item id' },
    body: { name: 'Variable name', label: 'Visible label', iconId: 'Icon id', action: 'Action kind', targetScreenId: 'Target screen id', targetElementId: 'Target element id', descriptionDev: 'Developer notes' }
  },
  {
    action: 'moveMenuItem', group: 'menus', method: 'POST', pattern: '/api/buttons/:id/menu/items/:iid/move',
    scope: 'propose', mcpAllowed: true,
    summary: 'Reorders or reparents a button menu item.',
    params: { id: ID_OR_KEY, iid: 'Numeric menu item id' },
    body: { parentId: 'New parent menu item id (or null for root)', ord: 'Target 0-based order index', direction: 'Optional up | down' }
  },
  {
    action: 'deleteMenuItem', group: 'menus', method: 'DELETE', pattern: '/api/buttons/:id/menu/items/:iid',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Deletes a menu item (and nested children) from an owned project button.',
    params: { id: ID_OR_KEY, iid: 'Numeric menu item id' }
  },

  // ---- Sandboxed Element Scripts & Public JS Dependencies ----
  {
    action: 'elementScriptPolicy', group: 'scripts', method: 'GET', pattern: '/api/elements/script-policy',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Returns the sandboxed element JS security policy, allowlisted public CDN origins, semver/SRI rules, and ES module template.'
  },
  {
    action: 'elementScript', aliases: ['getElementScript'], group: 'scripts', method: 'GET', pattern: '/api/elements/:id/script',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads the sandboxed custom JS module and verified public JS imports attached to an element.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'setElementScript', group: 'scripts', method: 'PUT', pattern: '/api/elements/:id/script',
    scope: 'propose', mcpAllowed: true,
    summary: 'Validates and attaches/updates sandboxed ES module JS and pinned public JS imports (exact semver + CDN allowlist + optional SRI verification) on an owned project element.',
    params: { id: ID_OR_KEY },
    body: {
      enabled: 'boolean (default true)',
      runtime: 'esm | declarative',
      entryExport: 'Exported function name (default "mount")',
      moduleCode: 'ES module source exporting mount(container, props, bridge) (max 64 KB)',
      imports: 'Array of { package, version (exact x.y.z), specifier?, subpath?, url?, integrity? (sha384-...) }',
      capabilities: '{ allowNetwork?: boolean, allowedConnectOrigins?: string[], allowCanvas?: boolean, allowWebGL?: boolean }',
      propsSchema: 'Object of typed prop descriptors',
      emits: 'Array of event names or { name, action?, description? }',
      verifyIntegrity: 'If true, fetches each pinned CDN URL over HTTPS and computes/verifies its sha384 SRI hash',
      requireIntegrity: 'If true, requires every import to carry a cryptographic SRI hash',
      lockfilePackages: 'Optional { [pkg]: "x.y.z" } allowlist from the target repository lockfile'
    }
  },
  {
    action: 'deleteElementScript', group: 'scripts', method: 'DELETE', pattern: '/api/elements/:id/script',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Removes the custom JS script from an owned project element.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'verifyElementScriptSri', group: 'scripts', method: 'POST', pattern: '/api/elements/:id/script/verify-sri',
    scope: 'propose', mcpAllowed: true,
    summary: 'Fetches pinned public CDN imports for an element script over HTTPS, computes/verifies sha384 Subresource Integrity hashes, and saves them.',
    params: { id: ID_OR_KEY },
    body: { lockfilePackages: 'Optional { [pkg]: "x.y.z" } lockfile allowlist' }
  },
  {
    action: 'elementScriptSandbox', aliases: ['getElementScriptSandbox'], group: 'scripts', method: 'GET', pattern: '/api/elements/:id/script/sandbox',
    scope: 'read', mcpAllowed: true,
    summary: 'Builds the isolated opaque-origin iframe srcdoc HTML, nonce CSP, and importmap with SRI hashes for a scripted element.',
    params: { id: ID_OR_KEY },
    query: { theme: 'Optional style key (e.g. liquid)', animated: '1 | 0' }
  },

  // ---- Library & Online / SVG Import ----
  {
    action: 'library', group: 'library', method: 'GET', pattern: '/api/library',
    scope: 'read', mcpAllowed: true,
    summary: 'Library lists (paths, icons, buttons, elements, animations) of the project.',
    query: { projectId: 'Project id', visibility: 'project | private | public', includePublic: '1 | 0', iconSummary: '1 for compact icon summaries' }
  },
  {
    action: 'sprite', group: 'icons', method: 'GET', pattern: '/api/sprite',
    scope: 'read', mcpAllowed: true,
    summary: 'Full SVG symbol sprite for the active style.',
    query: { theme: 'Style key' }
  },
  {
    action: 'onlineSources', group: 'import', method: 'GET', pattern: '/api/online/sources',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Lists configured online icon catalog providers (Iconify).'
  },
  {
    action: 'onlineCollections', group: 'import', method: 'GET', pattern: '/api/online/collections',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Lists available online icon sets/collections with icon counts and licenses.'
  },
  {
    action: 'onlineSearch', group: 'import', method: 'GET', pattern: '/api/online/search',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Searches online icon sets by keyword and optional collection prefix.',
    query: { q: 'Search keywords', prefix: 'Collection prefix (e.g. lucide, mdi, tabler)', start: 'Offset', limit: 'Max results' }
  },
  {
    action: 'onlineSvg', group: 'import', method: 'GET', pattern: '/api/online/svg',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Previews the raw SVG of an online icon by collection prefix and icon name.',
    query: { prefix: 'Collection prefix (required)', name: 'Icon name (required)', color: 'Optional stroke/fill color' }
  },
  {
    action: 'onlineImport', group: 'import', method: 'POST', pattern: '/api/online/import',
    scope: 'propose', mcpAllowed: true,
    summary: 'Imports one or more online icons into the active project\'s icon library.',
    body: { icons: 'Array of "prefix:name" strings or { prefix, name } objects', category: 'Target category', visibility: 'project | private' }
  },
  {
    action: 'onlineImportSet', group: 'import', method: 'POST', pattern: '/api/online/import-set',
    scope: 'propose', mcpAllowed: true,
    summary: 'Imports an online icon collection (or subset) into the active project.',
    body: { prefix: 'Collection prefix (required)', limit: 'Max icons to import', category: 'Target category', visibility: 'project | private' }
  },
  // ---- Image library (pictures for image nodes) and free stock photos ----
  {
    action: 'images', group: 'images', method: 'GET', pattern: '/api/images',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists / searches the image library (every word of q in name, label, key, tags, description-dev, author). No file data; each item has fileUrl.',
    query: { q: 'Search words', projectId: 'This project\'s images plus the public ones', visibility: 'public | project | private', category: 'Category', source: 'upload | openverse | pexels | pixabay', limit: 'Max items (500)', offset: 'Offset' }
  },
  {
    action: 'imageCategories', group: 'images', method: 'GET', pattern: '/api/images/categories',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Categories used in the image library.'
  },
  {
    action: 'createImage', group: 'images', method: 'POST', pattern: '/api/images',
    scope: 'propose', mcpAllowed: true,
    summary: 'Adds a picture to the image library. Place it with an image node: { tag: "image", attrs: { x, y, width, height, imageId, preserveAspectRatio?: "xMidYMid slice" | "xMidYMid meet" | "none", "data-clip"?: "circle" | "rounded", "data-radius"? } }.',
    body: { data: 'Base64 data URI of a PNG, JPEG, GIF or WebP picture (max 6 MB; no SVG)', name: 'Name', label: 'Label', tags: 'Array of tags', descriptionDev: 'description-dev', category: 'Category', visibility: 'public | project | private' }
  },
  {
    action: 'image', group: 'images', method: 'GET', pattern: '/api/images/:id',
    scope: 'read', mcpAllowed: true,
    summary: 'One image record (size, type, source, author, license, fileUrl).'
  },
  {
    action: 'imageFile', group: 'images', method: 'GET', pattern: '/api/images/:id/file',
    scope: 'read', mcpAllowed: false,
    summary: 'The picture file itself (binary; sent with its own content type). Image nodes in the app load it from here.'
  },
  {
    action: 'updateImage', group: 'images', method: 'PATCH', pattern: '/api/images/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Renames, re-tags, re-describes or re-categorises an image, or changes its visibility (the picture itself stays).',
    body: { name: 'Name', label: 'Label', tags: 'Array of tags', descriptionDev: 'description-dev', category: 'Category', visibility: 'public | project | private' }
  },
  {
    action: 'replaceImageMeta', group: 'images', method: 'PUT', pattern: '/api/images/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Same as PATCH /api/images/:id.'
  },
  {
    action: 'deleteImage', group: 'images', method: 'DELETE', pattern: '/api/images/:id',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Deletes an image from the library (image nodes that show it fall back to a grey placeholder).'
  },
  {
    action: 'stockImageSources', group: 'images', method: 'GET', pattern: '/api/stock-images/sources',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Free stock photo providers: openverse (no key), pexels (PEXELS_API_KEY), pixabay (PIXABAY_API_KEY), and which are ready.'
  },
  {
    action: 'stockImageSearch', group: 'images', method: 'GET', pattern: '/api/stock-images/search',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Searches free stock photos of one provider; results carry id, title, thumbUrl, size, author and license.',
    query: { provider: 'openverse | pexels | pixabay', q: 'Search words', page: 'Page (1-50)', perPage: 'Results per page (max 40)' }
  },
  {
    action: 'stockImageImport', group: 'images', method: 'POST', pattern: '/api/stock-images/import',
    scope: 'propose', mcpAllowed: true,
    summary: 'Downloads stock photos into the image library (author, source page and license are kept).',
    body: { items: 'Array of { provider, id, name?, tags?, descriptionDev? } (max 20)', visibility: 'public | project | private', category: 'Category (default stock)' }
  },
  {
    action: 'importFolders', group: 'import', method: 'GET', pattern: '/api/import/folders',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists suggested server-side SVG folders (admin session only).',
    blockedReason: 'Server filesystem path discovery is blocked for MCP keys; pass inline SVG payloads to importSvg or importFolder.'
  },
  {
    action: 'importSvg', group: 'import', method: 'POST', pattern: '/api/import/svg',
    scope: 'propose', mcpAllowed: true,
    summary: 'Parses and imports an inline SVG string as a path, icon, button, or element in the active project.',
    body: { svg: 'SVG markup string (required)', as: 'icon | path | button | element (default icon)', name: 'Display name', key: 'Optional item key', category: 'Category', visibility: 'project | private' }
  },
  {
    action: 'importFolder', group: 'import', method: 'POST', pattern: '/api/import/folder',
    scope: 'propose', mcpAllowed: true,
    summary: 'Batch-imports uploaded SVG files ({ files: [{ name, content }] }) into the active project (server disk folderPath is blocked).',
    body: { files: 'Array of { name, content } SVG payloads (required over MCP)', targetType: 'icon | path | element', category: 'Category', visibility: 'project | private' }
  },
  {
    action: 'importFont', group: 'import', method: 'POST', pattern: '/api/import/font',
    scope: 'propose', mcpAllowed: true,
    summary: 'Imports glyphs from an uploaded SVG font payload ({ svgText | content }) into the active project (server disk fontPath is blocked).',
    body: { svgText: 'Inline SVG font XML content', category: 'Category', limit: 'Max glyphs', visibility: 'project | private' }
  },
  {
    action: 'catalogSearch', group: 'library', method: 'GET', pattern: '/api/catalog/search',
    scope: 'read', mcpAllowed: true,
    summary: 'Search across the item catalog (paths, icons, buttons, elements, screens).',
    query: { q: 'Search text', projectId: 'Project id' }
  },
  {
    action: 'bootstrap', group: 'system', method: 'GET', pattern: '/api/bootstrap',
    scope: 'read', mcpAllowed: true,
    summary: 'Everything the web client needs at start-up (settings, themes, devices, templates, enums, counts).'
  },

  // ---- Settings & Themes ----
  {
    action: 'settingsGet', group: 'settings', method: 'GET', pattern: '/api/settings',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Designer settings (active theme, grid, defaults).'
  },
  {
    action: 'settings', group: 'settings', method: 'PUT', pattern: '/api/settings',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates global designer settings (admin session only).',
    blockedReason: 'Global designer settings are admin-only via human session.'
  },
  {
    action: 'themes', group: 'themes', method: 'GET', pattern: '/api/themes',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Design styles (themes) with tokens and surface recipes.'
  },
  {
    action: 'createTheme', group: 'themes', method: 'POST', pattern: '/api/themes',
    scope: 'propose', mcpAllowed: false,
    summary: 'Creates a global design style/theme (admin session only).',
    blockedReason: 'Global theme mutations are admin-only via human session.'
  },
  {
    action: 'getTheme', group: 'themes', method: 'GET', pattern: '/api/themes/:id',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Reads one design style (theme) by id or key.',
    params: { id: 'Theme id or style key (e.g. liquid)' }
  },
  {
    action: 'saveTheme', group: 'themes', method: 'PUT', pattern: '/api/themes/:id',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates a global design style/theme (admin session only).',
    blockedReason: 'Global theme mutations are admin-only via human session.'
  },
  {
    action: 'deleteTheme', group: 'themes', method: 'DELETE', pattern: '/api/themes/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Deletes a custom global theme (admin session only).',
    blockedReason: 'Global theme deletion is admin-only via human session.'
  },
  {
    action: 'cloneTheme', group: 'themes', method: 'POST', pattern: '/api/themes/:id/clone',
    scope: 'propose', mcpAllowed: false,
    summary: 'Clones a global theme (admin session only).',
    blockedReason: 'Global theme mutations are admin-only via human session.'
  },

  // ---- Workflows ----
  {
    action: 'workflows', group: 'workflows', method: 'GET', pattern: '/api/workflows',
    scope: 'read', mcpAllowed: true,
    summary: 'Workflow list (filters: q, projectId, visibility, creatorId).',
    query: { q: 'Search text', projectId: 'Project id', visibility: 'project | private | public', includePublic: '1 | 0' }
  },
  {
    action: 'createWorkflow', group: 'workflows', method: 'POST', pattern: '/api/workflows',
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates a screen-navigation workflow in the active project.',
    body: { name: 'Workflow display name (required)', key: 'Optional workflow key', label: 'Label', description: 'Summary', descriptionDev: 'Developer flow notes', mcpContext: 'AI context object' }
  },
  {
    action: 'workflowFromScreen', group: 'workflows', method: 'POST', pattern: '/api/workflows/from-screen',
    scope: 'propose', mcpAllowed: true,
    summary: 'New workflow from a screen: places the screen and every screen its menu items / click actions route to, recursively ({ screenId, name }).',
    body: { screenId: 'Start screen numeric id (or screenKey)', name: 'Optional workflow name' }
  },
  {
    action: 'importScreenRoutes', group: 'workflows', method: 'POST', pattern: '/api/workflows/:id/import-routes',
    scope: 'propose', mcpAllowed: true,
    summary: 'Adds a screen and every screen its routes reach to the workflow, linked ({ screenId, x, y }).',
    params: { id: ID_OR_KEY },
    body: { screenId: 'Start screen numeric id (or screenKey)', x: 'Canvas x coordinate', y: 'Canvas y coordinate' }
  },
  {
    action: 'workflow', group: 'workflows', method: 'GET', pattern: '/api/workflows/:id',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads one workflow with all placed screen nodes and navigation links.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'workflowLineage', group: 'workflows', method: 'GET', pattern: '/api/workflows/:id/lineage',
    scope: 'read', mcpAllowed: true,
    summary: 'Returns clone/origin lineage of a workflow.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'updateWorkflow', group: 'workflows', method: 'PUT', pattern: '/api/workflows/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates workflow name, key, description, or developer notes.',
    params: { id: ID_OR_KEY },
    body: { name: 'Display name', key: 'Workflow key', label: 'Label', description: 'Description', descriptionDev: 'Developer notes', mcpContext: 'AI context object' }
  },
  {
    action: 'deleteWorkflow', group: 'workflows', method: 'DELETE', pattern: '/api/workflows/:id',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Moves an owned project workflow to Trash.',
    params: { id: ID_OR_KEY }
  },
  {
    action: 'restoreWorkflow', group: 'workflows', method: 'POST', pattern: '/api/workflows/:id/restore',
    scope: 'propose', mcpAllowed: true,
    summary: 'Restores an owned project workflow to a snapshot.',
    params: { id: ID_OR_KEY },
    body: { record: 'Workflow metadata', nodes: 'Placed screens[]', links: 'Workflow links[]' }
  },
  {
    action: 'cloneWorkflow', group: 'workflows', method: 'POST', pattern: '/api/workflows/:id/clone',
    scope: 'propose', mcpAllowed: true,
    summary: 'Clones a readable workflow into the active project.',
    params: { id: ID_OR_KEY },
    body: { name: 'Name for the cloned workflow' }
  },
  {
    action: 'placeScreen', group: 'workflows', method: 'PUT', pattern: '/api/workflows/:id/screens',
    scope: 'propose', mcpAllowed: true,
    summary: 'Places or moves a screen node on a workflow canvas.',
    params: { id: ID_OR_KEY },
    body: { screenId: 'Screen numeric id (or screenKey)', x: 'Canvas x position', y: 'Canvas y position', zoom: 'Optional zoom factor', collapsed: 'boolean' }
  },
  {
    action: 'removeWfScreen', group: 'workflows', method: 'DELETE', pattern: '/api/workflows/:id/screens/:sid',
    scope: 'propose', mcpAllowed: true,
    summary: 'Removes a placed screen (and its incident links) from a workflow.',
    params: { id: ID_OR_KEY, sid: 'Screen numeric id' }
  },
  {
    action: 'addLink', group: 'workflows', method: 'POST', pattern: '/api/workflows/:id/links',
    scope: 'propose', mcpAllowed: true,
    summary: 'Adds a navigation transition link between two screens in a workflow.',
    params: { id: ID_OR_KEY },
    body: { fromScreenId: 'Source screen id (or fromScreenKey)', toScreenId: 'Target screen id (or toScreenKey)', fromNodeId: 'Optional hotspot node id', triggerNodeId: 'Optional hotspot node id', name: 'Transition label', trigger: 'click | tap | submit | longpress | swipe', descriptionDev: 'Preconditions / guard notes', waypoints: 'Optional [{x,y}]' }
  },
  {
    action: 'updateLink', group: 'workflows', method: 'PUT', pattern: '/api/workflows/:id/links/:lid',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates a workflow transition link.',
    params: { id: ID_OR_KEY, lid: 'Numeric link id' },
    body: { name: 'Transition label', trigger: 'Trigger kind', fromNodeId: 'Hotspot node id', descriptionDev: 'Developer notes', color: 'Line color', waypoints: '[{x,y}]' }
  },
  {
    action: 'deleteLink', group: 'workflows', method: 'DELETE', pattern: '/api/workflows/:id/links/:lid',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Deletes a transition link from a workflow.',
    params: { id: ID_OR_KEY, lid: 'Numeric link id' }
  },

  // ---- Export ----
  {
    action: 'exportBundle', group: 'export', method: 'POST', pattern: '/api/export/bundle',
    scope: 'read', mcpAllowed: true,
    summary: 'Builds an export bundle (files returned in JSON for the active project).',
    body: { projectId: 'Project id (forced to active project)', themeKeys: 'Optional style keys[]', includeHtml: 'boolean', includeSvg: 'boolean' }
  },
  {
    action: 'exportProjectHtml', group: 'export', method: 'GET', pattern: '/api/export/project.html',
    scope: 'read', mcpAllowed: true,
    summary: 'Exports the active project as one self-contained browsable HTML file.',
    query: { projectId: 'Project id', theme: 'Optional style key', download: '1 | 0' }
  },
  {
    action: 'exportFolder', aliases: ['exportToFolder'], group: 'export', method: 'POST', pattern: '/api/export/folder',
    scope: 'propose', mcpAllowed: false,
    summary: 'Writes an export bundle directly to a server-side folder (admin session only).',
    blockedReason: 'Server filesystem writes are blocked for MCP keys; use exportBundle, exportProjectHtml, uiux_create_bundle, or uiux_export_app.'
  },

  // ---- Auth & Users (session-only) ----
  {
    action: 'authConfig', group: 'auth', method: 'GET', pattern: '/api/auth/config',
    scope: 'read', mcpAllowed: false,
    summary: 'Login configuration (whether sign-in is required, registration open).',
    blockedReason: 'Authentication endpoints are for human browser sessions only.'
  },
  {
    action: 'devBypassLogin', group: 'auth', method: 'POST', pattern: '/api/auth/dev-bypass',
    scope: 'propose', mcpAllowed: false,
    summary: 'Local dev-mode session login.',
    blockedReason: 'Authentication endpoints are for human browser sessions only.'
  },
  {
    action: 'login', group: 'auth', method: 'POST', pattern: '/api/auth/login',
    scope: 'propose', mcpAllowed: false,
    summary: 'Sign in; returns a session token.',
    blockedReason: 'Authentication endpoints are for human browser sessions only.'
  },
  {
    action: 'register', group: 'auth', method: 'POST', pattern: '/api/auth/register',
    scope: 'propose', mcpAllowed: false,
    summary: 'Creates a user account.',
    blockedReason: 'User registration is for human browser sessions only.'
  },
  {
    action: 'logout', group: 'auth', method: 'POST', pattern: '/api/auth/logout',
    scope: 'propose', mcpAllowed: false,
    summary: 'Ends the current session.',
    blockedReason: 'Authentication endpoints are for human browser sessions only.'
  },
  {
    action: 'me', group: 'auth', method: 'GET', pattern: '/api/auth/me',
    scope: 'read', mcpAllowed: false,
    summary: 'The user behind the current token (use uiux_whoami over MCP).',
    blockedReason: 'Session identity route; call uiux_whoami over MCP instead.'
  },
  {
    action: 'users', group: 'users', method: 'GET', pattern: '/api/users',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists user accounts (session only).',
    blockedReason: 'User directory and administration are blocked for MCP keys.'
  },
  {
    action: 'createUser', group: 'users', method: 'POST', pattern: '/api/users',
    scope: 'propose', mcpAllowed: false,
    summary: 'Creates a user account as admin (session only).',
    blockedReason: 'User administration is blocked for MCP keys.'
  },
  {
    action: 'updateUser', group: 'users', method: 'PUT', pattern: '/api/users/:id',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates a user account or role (session only).',
    blockedReason: 'User administration is blocked for MCP keys.'
  },
  {
    action: 'deleteUser', group: 'users', method: 'DELETE', pattern: '/api/users/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Deletes a user account (session only).',
    blockedReason: 'User administration is blocked for MCP keys.'
  },
  {
    action: 'transferSuperadmin', group: 'users', method: 'POST', pattern: '/api/users/:id/transfer-superadmin',
    scope: 'propose', mcpAllowed: false,
    summary: 'Transfers the superadmin role (session only).',
    blockedReason: 'Superadmin transfer is blocked for MCP keys.'
  },
  {
    action: 'aclMatrix', group: 'system', method: 'GET', pattern: '/api/acl/matrix',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Returns role definitions, visibility levels, event triggers, click actions, and toolbar positions.'
  },

  // ---- Projects ----
  {
    action: 'projects', group: 'projects', method: 'GET', pattern: '/api/projects',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Projects visible to the actor.',
    query: { q: 'Search filter', includePublic: '1 | 0' }
  },
  {
    action: 'createProject', group: 'projects', method: 'POST', pattern: '/api/projects',
    scope: 'create', mcpAllowed: true, accountOnly: true, needsProject: false,
    summary: 'Creates a new project owned by the API key\'s user (account keys with "create" scope).',
    body: { name: 'Project name (required)', key: 'Optional project key', description: 'Project description', visibility: 'private | public (design keys: private only)', buttonStyle: 'Default button style', buttonIconSizePct: '50-100' }
  },
  {
    action: 'project', group: 'projects', method: 'GET', pattern: '/api/projects/:id',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads metadata and button settings of the project.',
    params: { id: 'Project id or key (defaults to active project)' }
  },
  {
    action: 'updateProject', group: 'projects', method: 'PUT', pattern: '/api/projects/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates name, label, description, or button settings of an owned project (AI review & visibility publishing stay human-controlled).',
    params: { id: 'Project id (defaults to active project)' },
    body: { name: 'Project name', label: 'Project label', description: 'Description', buttonStyle: 'Button style key', buttonIconSizePct: '50-100' }
  },
  {
    action: 'saveProject', group: 'projects', method: 'POST', pattern: '/api/projects/:id/save',
    scope: 'propose', mcpAllowed: true,
    summary: 'Saves owned project metadata/settings and optionally applies button style settings across project buttons.',
    params: { id: 'Project id (defaults to active project)' },
    body: { name: 'Project name', description: 'Description', buttonStyle: 'Button style key', buttonIconSizePct: '50-100', applyButtonSettings: 'boolean' }
  },
  {
    action: 'cloneProject', group: 'projects', method: 'POST', pattern: '/api/projects/:id/clone',
    scope: 'create', mcpAllowed: true, accountOnly: true, needsProject: false,
    summary: 'Clones a visible project into a new private project owned by the key\'s user (account keys with "create" scope).',
    params: { id: 'Source project id or key' },
    body: { name: 'New project name (required)', key: 'Optional new project key', description: 'Description' }
  },
  {
    action: 'projectButtonSettings', group: 'projects', method: 'GET', pattern: '/api/projects/:id/button-settings',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads the project\'s buttonStyle, buttonIconSizePct, and available BUTTON_STYLES.',
    params: { id: 'Project id (defaults to active project)' }
  },
  {
    action: 'applyProjectButtonSettings', group: 'projects', method: 'POST', pattern: '/api/projects/:id/button-settings',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates buttonStyle and buttonIconSizePct on the owned project and restyles its project buttons.',
    params: { id: 'Project id (defaults to active project)' },
    body: { buttonStyle: 'circle | square | pill | soft | outline | ghost | glass | brutal | ...', buttonIconSizePct: 'Icon size percentage (50-100)' }
  },
  {
    action: 'deleteProject', group: 'projects', method: 'DELETE', pattern: '/api/projects/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Deletes a project (human session only).',
    blockedReason: 'Project deletion is blocked for MCP keys (design keys may only delete -vNNN versions via uiux_delete_version).'
  },
  {
    action: 'setProjectItemsVisibility', group: 'projects', method: 'POST', pattern: '/api/projects/:id/visibility',
    scope: 'propose', mcpAllowed: false,
    summary: 'Bulk-changes visibility of every item in a project (human session only).',
    blockedReason: 'Bulk project visibility publishing is a human decision in the designer.'
  },
  {
    action: 'inviteProjectMember', aliases: ['addProjectMember'], group: 'projects', method: 'POST', pattern: '/api/projects/:id/members',
    scope: 'propose', mcpAllowed: false,
    summary: 'Invites a collaborator to a project (human session only).',
    blockedReason: 'Project member management is human-only.'
  },
  {
    action: 'updateProjectMember', group: 'projects', method: 'PUT', pattern: '/api/projects/:id/members/:uid',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates a project member\'s role (human session only).',
    blockedReason: 'Project member management is human-only.'
  },
  {
    action: 'removeProjectMember', group: 'projects', method: 'DELETE', pattern: '/api/projects/:id/members/:uid',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Removes a collaborator from a project (human session only).',
    blockedReason: 'Project member management is human-only.'
  },

  // ---- Collaborative Change List ----
  {
    action: 'changes', group: 'changes', method: 'GET', pattern: '/api/changes',
    scope: 'read', mcpAllowed: true,
    summary: 'Collaborative change requests.',
    query: { projectId: 'Project id', status: 'pending | approved | rejected', targetType: 'Item type', targetId: 'Item id', lite: '1 to omit snapshots', q: 'Search filter' }
  },
  {
    action: 'changeCounts', group: 'changes', method: 'GET', pattern: '/api/changes/counts',
    scope: 'read', mcpAllowed: true,
    summary: 'Counts of change requests by status ({ pending, approved, rejected, all }) for the project.',
    query: { projectId: 'Project id', targetType: 'Item type', q: 'Search filter' }
  },
  {
    action: 'bulkReviewChanges', group: 'changes', method: 'POST', pattern: '/api/changes/bulk',
    scope: 'propose', mcpAllowed: false,
    summary: 'Bulk-approves or rejects collaborative change requests (human reviewer only).',
    blockedReason: 'Approving or rejecting change requests is human-only in the designer.'
  },
  {
    action: 'change', group: 'changes', method: 'GET', pattern: '/api/changes/:id',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads one collaborative change request (with before/after snapshots).',
    params: { id: 'Numeric change request id' }
  },
  {
    action: 'createChange', group: 'changes', method: 'POST', pattern: '/api/changes',
    scope: 'propose', mcpAllowed: true,
    summary: 'Records a collaborative change request on the active project.',
    body: { targetType: 'path | icon | button | element | screen | workflow', targetId: 'Numeric item id', action: 'create | update | delete', summary: 'Change summary', beforeSnapshot: 'Snapshot object', afterSnapshot: 'Snapshot object' }
  },
  {
    action: 'approveChange', group: 'changes', method: 'POST', pattern: '/api/changes/:id/approve',
    scope: 'propose', mcpAllowed: false,
    summary: 'Approves a change request (human reviewer only).',
    blockedReason: 'Approving change requests is human-only in the designer.'
  },
  {
    action: 'rejectChange', group: 'changes', method: 'POST', pattern: '/api/changes/:id/reject',
    scope: 'propose', mcpAllowed: false,
    summary: 'Rejects a change request (human reviewer only).',
    blockedReason: 'Rejecting change requests is human-only in the designer.'
  },

  // ---- Editable Templates (Devices & Buttons) ----
  {
    action: 'templateDevices', group: 'templates', method: 'GET', pattern: '/api/templates/devices',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists built-in and custom device viewport templates (width, height, cornerRadius, grid).',
    query: { projectId: 'Optional project id' }
  },
  {
    action: 'saveTemplateDevice', group: 'templates', method: 'POST', pattern: '/api/templates/devices',
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates or updates a custom device viewport template (for example an emulator screen size captured during reverse engineering).',
    body: { id: 'Optional template id to update', name: 'Device name (required on create)', key: 'Dashed lowercase key (e.g. pixel-7-pro)', category: 'mobile | tablet | desktop | web | custom', width: 'Width in dp/px', height: 'Height in dp/px', cornerRadius: 'Corner radius', grid: 'Grid unit (default 24)', meta: 'Optional metadata' }
  },
  {
    action: 'updateTemplateDevice', group: 'templates', method: 'PUT', pattern: '/api/templates/devices/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates a custom device template owned by the user (built-in templates cannot be overwritten over MCP).',
    params: { id: 'Numeric device template id' },
    body: { name: 'Device name', width: 'Width in dp/px', height: 'Height in dp/px', cornerRadius: 'Corner radius', grid: 'Grid size', meta: 'Metadata object' }
  },
  {
    action: 'deleteTemplateDevice', group: 'templates', method: 'DELETE', pattern: '/api/templates/devices/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Deletes a custom device template (admin session only).',
    blockedReason: 'Global device template deletion is admin-only via human session.'
  },
  {
    action: 'templateButtons', group: 'templates', method: 'GET', pattern: '/api/templates/buttons',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists built-in and custom button templates.',
    query: { projectId: 'Optional project id' }
  },
  {
    action: 'saveTemplateButton', group: 'templates', method: 'POST', pattern: '/api/templates/buttons',
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates or updates a custom button template owned by the user.',
    body: { id: 'Optional button template id to update', name: 'Template name (required on create)', key: 'Dashed lowercase key', category: 'Category', shape: 'pill | circle | square | rect', width: 'Width', height: 'Height', rxRatio: 'Corner ratio', marginRatio: 'Margin ratio', strokeRatio: 'Stroke ratio', nodesTemplate: 'Optional template nodes[]' }
  },
  {
    action: 'updateTemplateButton', group: 'templates', method: 'PUT', pattern: '/api/templates/buttons/:id',
    scope: 'propose', mcpAllowed: true,
    summary: 'Updates a custom button template owned by the user.',
    params: { id: 'Numeric button template id' },
    body: { name: 'Template name', shape: 'Shape', width: 'Width', height: 'Height', nodesTemplate: 'Template nodes[]' }
  },
  {
    action: 'deleteTemplateButton', group: 'templates', method: 'DELETE', pattern: '/api/templates/buttons/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Deletes a custom button template (admin session only).',
    blockedReason: 'Global button template deletion is admin-only via human session.'
  },
  {
    action: 'instantiateTemplateButton', group: 'templates', method: 'POST', pattern: '/api/templates/buttons/:id/instantiate',
    scope: 'propose', mcpAllowed: true,
    summary: 'Instantiates a button template as a concrete button item in the active project.',
    params: { id: 'Button template numeric id or key' },
    body: { name: 'Button name', iconId: 'Optional icon id to embed', visibility: 'project | private' }
  },

  // ---- Translations ----
  {
    action: 'translations', group: 'translations', method: 'GET', pattern: '/api/translations',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists localized field translations for items in the active project.',
    query: { lang: 'Language code (e.g. tr, de, es)', itemType: 'screen | element | button | icon | path | workflow', itemId: 'Numeric item id' }
  },
  {
    action: 'saveTranslation', group: 'translations', method: 'POST', pattern: '/api/translations',
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates or updates a localized text translation for an item in the active project.',
    body: { itemType: 'screen | element | button | icon | path | workflow', itemId: 'Numeric item id (or itemKey)', field: 'Field name (default "label")', lang: 'BCP-47 language code (e.g. "tr", "de")', value: 'Translated text' }
  },
  {
    action: 'upsertTranslation', group: 'translations', method: 'PUT', pattern: '/api/translations',
    scope: 'propose', mcpAllowed: true,
    summary: 'Upserts a localized text translation for an item in the active project.',
    body: { itemType: 'screen | element | button | icon | path | workflow', itemId: 'Numeric item id (or itemKey)', field: 'Field name', lang: 'Language code', value: 'Translated text' }
  },
  {
    action: 'deleteTranslation', group: 'translations', method: 'DELETE', pattern: '/api/translations/:id',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Deletes a translation entry belonging to an item in the active project.',
    params: { id: 'Numeric translation id' }
  },
  {
    action: 'languages', group: 'translations', method: 'GET', pattern: '/api/translations/languages',
    scope: 'read', mcpAllowed: true, needsProject: false,
    summary: 'Lists active language codes and translation counts.'
  },

  // ---- PostgreSQL Sync (admin session only) ----
  {
    action: 'syncStatus', group: 'sync', method: 'GET', pattern: '/api/sync/status',
    scope: 'read', mcpAllowed: false,
    summary: 'PostgreSQL sync status.',
    blockedReason: 'Database synchronization endpoints are admin-only via human session.'
  },
  {
    action: 'syncNow', group: 'sync', method: 'POST', pattern: '/api/sync/now',
    scope: 'propose', mcpAllowed: false,
    summary: 'Runs bidirectional PostgreSQL sync (admin session only).',
    blockedReason: 'Database synchronization endpoints are admin-only via human session.'
  },
  {
    action: 'syncPush', group: 'sync', method: 'POST', pattern: '/api/sync/push',
    scope: 'propose', mcpAllowed: false,
    summary: 'Pushes local SQLite state to PostgreSQL (admin session only).',
    blockedReason: 'Database synchronization endpoints are admin-only via human session.'
  },
  {
    action: 'syncPull', group: 'sync', method: 'POST', pattern: '/api/sync/pull',
    scope: 'propose', mcpAllowed: false,
    summary: 'Pulls PostgreSQL state into local SQLite (admin session only).',
    blockedReason: 'Database synchronization endpoints are admin-only via human session.'
  },

  // ---- Trash ----
  {
    action: 'trashList', group: 'trash', method: 'GET', pattern: '/api/trash',
    scope: 'read', mcpAllowed: true,
    summary: 'Deleted items waiting for restore or purge.',
    query: { itemType: 'path | icon | button | element | screen | workflow', projectId: 'Project id', q: 'Search filter' }
  },
  {
    action: 'trashRestore', group: 'trash', method: 'POST', pattern: '/api/trash/:id/restore',
    scope: 'propose', mcpAllowed: true,
    summary: 'Restores a deleted item from the user\'s project trash (preserving uid and references when free).',
    params: { id: 'Numeric trash entry id' }
  },
  {
    action: 'trashPurge', group: 'trash', method: 'DELETE', pattern: '/api/trash/:id',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Permanently purges one deleted item from the user\'s project trash.',
    params: { id: 'Numeric trash entry id' }
  },
  {
    action: 'trashEmpty', group: 'trash', method: 'DELETE', pattern: '/api/trash',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Empties deleted items of the active project from the user\'s trash.',
    query: { itemType: 'Optional item type filter', projectId: 'Project id (forced to active project)' }
  },

  // ---- Library Transfer & Multi-Project Operations ----
  {
    action: 'copyToProjects', group: 'library', method: 'POST', pattern: '/api/library/copy-to-projects',
    scope: 'propose', mcpAllowed: true,
    summary: 'Copies items (and all cascading sub-items) into owned target project(s).',
    body: { items: 'Array of { type, id }', projectIds: 'Target owned project ids[] (defaults to active project)', visibility: 'project | private', overrideName: 'Optional name override' }
  },
  {
    action: 'moveToProjects', group: 'library', method: 'POST', pattern: '/api/library/move-to-projects',
    scope: 'propose', mcpAllowed: true,
    summary: 'Copies owned project items (with cascading sub-items) into owned target project(s) and removes the source.',
    body: { items: 'Array of { type, id } from the active project', projectIds: 'Target owned project ids[]' }
  },
  {
    action: 'publishToPublic', group: 'library', method: 'POST', pattern: '/api/library/publish',
    scope: 'propose', mcpAllowed: true,
    summary: 'Submits a publish change request asking an admin to publish a project item to the public library (not available to strict design keys).',
    body: { type: 'path | icon | button | element | screen | workflow', id: 'Numeric item id' }
  },
  {
    action: 'saveToTargets', group: 'library', method: 'POST', pattern: '/api/library/save-to-targets',
    scope: 'propose', mcpAllowed: true,
    summary: 'Saves/clones an item (with cascading sub-items) into owned target project(s) or private library.',
    body: { type: 'Item type', id: 'Numeric item id', name: 'Optional override name', projectIds: 'Owned target project ids[]', includeUserPrivate: 'boolean' }
  },
  {
    action: 'emptyProjectLibrary', group: 'library', method: 'POST', pattern: '/api/projects/:id/empty-library',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Moves all non-builtin project-scoped items (or one itemType) of the owned project to Trash.',
    params: { id: 'Project id (defaults to active project)' },
    body: { itemType: 'all | path | icon | button | element | screen | workflow' }
  },
  {
    action: 'emptyLibrary', group: 'library', method: 'POST', pattern: '/api/library/empty',
    scope: 'propose', mcpAllowed: true, destructive: true,
    summary: 'Moves all non-builtin project-scoped items (or one itemType) of the active project to Trash.',
    body: { itemType: 'all | path | icon | button | element | screen | workflow' }
  },
  {
    action: 'exportLibraryItems', group: 'library', method: 'POST', pattern: '/api/library/export-items',
    scope: 'read', mcpAllowed: true,
    summary: 'Exports selected project items (and sub-items) as JSON, SVG, or HTML.',
    body: { items: 'Optional [{ type, id }]', types: 'Optional item types[]', format: 'json | svg | html', includeSubItems: 'boolean (default true)' }
  },
  {
    action: 'importLibraryItems', group: 'library', method: 'POST', pattern: '/api/library/import-items',
    scope: 'propose', mcpAllowed: true,
    summary: 'Imports library items from JSON, SVG, or HTML content into the active project.',
    body: { format: 'auto | json | svg | html', content: 'Serialized JSON/SVG/HTML content (required)', targetType: 'auto | path | icon | button | element | screen | workflow', category: 'Category', name: 'Optional name', visibility: 'project | private' }
  },

  // ---- Profile (session-only) ----
  {
    action: 'profile', group: 'auth', method: 'GET', pattern: '/api/auth/profile',
    scope: 'read', mcpAllowed: false,
    summary: 'Reads the signed-in user\'s profile.',
    blockedReason: 'Profile management requires a human browser session.'
  },
  {
    action: 'updateProfile', group: 'auth', method: 'PUT', pattern: '/api/auth/profile',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates the signed-in user\'s display name, email, or avatar.',
    blockedReason: 'Profile management requires a human browser session.'
  },
  {
    action: 'changePassword', group: 'auth', method: 'POST', pattern: '/api/auth/profile/password',
    scope: 'propose', mcpAllowed: false,
    summary: 'Changes the signed-in user\'s password.',
    blockedReason: 'Password changes require a human browser session.'
  },
  {
    action: 'profileSessions', group: 'auth', method: 'GET', pattern: '/api/auth/profile/sessions',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists active browser sessions of the signed-in user.',
    blockedReason: 'Session management requires a human browser session.'
  },
  {
    action: 'revokeOtherSessions', group: 'auth', method: 'POST', pattern: '/api/auth/profile/sessions/revoke-others',
    scope: 'propose', mcpAllowed: false,
    summary: 'Revokes all other browser sessions of the signed-in user.',
    blockedReason: 'Session management requires a human browser session.'
  },
  {
    action: 'revokeSession', group: 'auth', method: 'DELETE', pattern: '/api/auth/profile/sessions/:sid',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Revokes one browser session by id.',
    blockedReason: 'Session management requires a human browser session.'
  },

  // ---- MCP Designer REST Routes (API keys, AI artifacts, versions, changesets, item requests) ----
  {
    action: 'myApiKeys', group: 'api-keys', method: 'GET', pattern: '/api/me/api-keys',
    scope: 'read', mcpAllowed: false,
    summary: 'Your AI access keys (metadata only; the secret is shown once on creation).',
    blockedReason: 'API key management is human-only in the designer.'
  },
  {
    action: 'createApiKey', group: 'api-keys', method: 'POST', pattern: '/api/me/api-keys',
    scope: 'propose', mcpAllowed: false,
    summary: 'Creates an AI access key (kud_…) for MCP clients.',
    blockedReason: 'API key creation is human-only in the designer.'
  },
  {
    action: 'rotateApiKey', group: 'api-keys', method: 'POST', pattern: '/api/me/api-keys/:id/rotate',
    scope: 'propose', mcpAllowed: false,
    summary: 'Rotates an AI access key with a 24 h grace window.',
    blockedReason: 'API key rotation is human-only in the designer.'
  },
  {
    action: 'revokeApiKey', group: 'api-keys', method: 'DELETE', pattern: '/api/me/api-keys/:id',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Revokes an AI access key immediately.',
    blockedReason: 'API key revocation is human-only in the designer.'
  },
  {
    action: 'myApiKeyAudit', group: 'api-keys', method: 'GET', pattern: '/api/me/api-keys/:id/audit',
    scope: 'read', mcpAllowed: false,
    summary: 'Reads audit log entries for one of your AI access keys.',
    blockedReason: 'API key audit logs are human-only in the designer.'
  },
  {
    action: 'projectApiKeys', group: 'api-keys', method: 'GET', pattern: '/api/projects/:id/api-keys',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists AI access keys bound to a project (owner/admin).',
    blockedReason: 'API key management is human-only in the designer.'
  },
  {
    action: 'revokeAllProjectApiKeys', group: 'api-keys', method: 'POST', pattern: '/api/projects/:id/api-keys/revoke-all',
    scope: 'propose', mcpAllowed: false, destructive: true,
    summary: 'Revokes every AI access key bound to a project.',
    blockedReason: 'API key revocation is human-only in the designer.'
  },
  {
    action: 'projectAiSettings', group: 'api-keys', method: 'GET', pattern: '/api/projects/:id/ai-settings',
    scope: 'read', mcpAllowed: false,
    summary: 'Reads project AI review/publishing settings.',
    blockedReason: 'Project AI governance settings are human-only in the designer.'
  },
  {
    action: 'updateProjectAiSettings', group: 'api-keys', method: 'PUT', pattern: '/api/projects/:id/ai-settings',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates project AI review/publishing settings (pushRequiresReview, mayCreatePublicItems).',
    blockedReason: 'Project AI governance settings are human-only in the designer.'
  },
  {
    action: 'projectAiAudit', group: 'api-keys', method: 'GET', pattern: '/api/projects/:id/ai-audit',
    scope: 'read', mcpAllowed: false,
    summary: 'Reads MCP audit log entries for a project.',
    blockedReason: 'Project AI audit logs are human-only in the designer.'
  },
  {
    action: 'adminApiKeys', group: 'api-keys', method: 'GET', pattern: '/api/admin/api-keys',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists all AI access keys in the instance (admin session only).',
    blockedReason: 'Admin API key listing is human-only.'
  },
  {
    action: 'projectAiPack', group: 'ai-pack', method: 'GET', pattern: '/api/projects/:id/ai-pack',
    scope: 'read', mcpAllowed: true,
    summary: 'Previews rendered AI pack files (agent + skill) for the project and platform.',
    params: { id: 'Project id (defaults to active project)' },
    query: { platform: 'claude | antigravity | agents-md | cursor | generic' }
  },
  {
    action: 'projectAiArtifacts', group: 'ai-pack', method: 'GET', pattern: '/api/projects/:id/ai-artifacts',
    scope: 'read', mcpAllowed: false,
    summary: 'Lists AI pack templates and per-project overrides (owner/admin session only).',
    blockedReason: 'AI template overrides are managed by the human owner in the designer.'
  },
  {
    action: 'setProjectAiArtifact', group: 'ai-pack', method: 'PUT', pattern: '/api/projects/:id/ai-artifacts/:kind',
    scope: 'propose', mcpAllowed: false,
    summary: 'Sets a per-project AI agent/skill template override (owner/admin session only).',
    blockedReason: 'AI template overrides are managed by the human owner in the designer; agents must never rewrite their own prompt templates.'
  },
  {
    action: 'clearProjectAiArtifact', group: 'ai-pack', method: 'DELETE', pattern: '/api/projects/:id/ai-artifacts/:kind',
    scope: 'propose', mcpAllowed: false,
    summary: 'Clears a per-project AI template override.',
    blockedReason: 'AI template overrides are managed by the human owner in the designer.'
  },
  {
    action: 'setGlobalAiArtifact', group: 'ai-pack', method: 'PUT', pattern: '/api/admin/ai-artifacts/:kind',
    scope: 'propose', mcpAllowed: false,
    summary: 'Updates a global AI pack template (admin session only).',
    blockedReason: 'Global AI templates are admin-only via human session.'
  },
  {
    action: 'projectVersions', group: 'versions', method: 'GET', pattern: '/api/projects/:id/versions',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists numbered versions of the project (head first).',
    params: { id: 'Project id (defaults to active project)' }
  },
  {
    action: 'snapshotProjectVersion', group: 'versions', method: 'POST', pattern: '/api/projects/:id/versions',
    scope: 'propose', mcpAllowed: true,
    summary: 'Records a numbered version snapshot of the current owned project state.',
    params: { id: 'Project id (defaults to active project)' },
    body: { label: 'Optional version label (e.g. "1.0.0")', message: 'Snapshot commit message' }
  },
  {
    action: 'getProjectVersion', group: 'versions', method: 'GET', pattern: '/api/projects/:id/versions/:number',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads one numbered version snapshot of the project.',
    params: { id: 'Project id (defaults to active project)', number: 'Version number' }
  },
  {
    action: 'restoreProjectVersion', group: 'versions', method: 'POST', pattern: '/api/projects/:id/versions/:number/restore',
    scope: 'propose', mcpAllowed: true,
    summary: 'Creates a restore changeset rolling the project back to an earlier numbered version.',
    params: { id: 'Project id (defaults to active project)', number: 'Version number to restore' },
    body: { message: 'Optional restore message' }
  },
  {
    action: 'projectChangesets', group: 'versions', method: 'GET', pattern: '/api/projects/:id/changesets',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists AI changesets of the project.',
    params: { id: 'Project id (defaults to active project)' },
    query: { status: 'Optional status filter (open | submitted | approved | rejected | ...)' }
  },
  {
    action: 'getChangeset', group: 'versions', method: 'GET', pattern: '/api/changesets/:uid',
    scope: 'read', mcpAllowed: true,
    summary: 'Reads one AI changeset of the project by uid.',
    params: { uid: 'Changeset UUID' }
  },
  {
    action: 'previewChangesetOp', group: 'versions', method: 'GET', pattern: '/api/changesets/:uid/ops/:op/preview',
    scope: 'read', mcpAllowed: true,
    summary: 'Renders before/after SVG previews for one operation in a project changeset.',
    params: { uid: 'Changeset UUID', op: 'Operation uid' },
    query: { style: 'Optional style key' }
  },
  {
    action: 'reviewChangeset', group: 'versions', method: 'POST', pattern: '/api/changesets/:uid/review',
    scope: 'propose', mcpAllowed: false,
    summary: 'Approves or rejects operations of a submitted AI changeset (owner/admin session only).',
    blockedReason: 'Changeset approval/rejection is human-only in the designer.'
  },
  {
    action: 'appExport', group: 'export', method: 'GET', pattern: '/api/projects/:id/app-export',
    scope: 'read', mcpAllowed: true,
    summary: 'Exports the project as a working HTML app + interactions.json archive (.tar.gz).',
    params: { id: 'Project id (defaults to active project)' },
    query: { styles: 'Optional comma-separated style keys' }
  },
  {
    action: 'projectItemRequests', group: 'requests', method: 'GET', pattern: '/api/projects/:id/item-requests',
    scope: 'read', mcpAllowed: true,
    summary: 'Lists AI item requests of the project.',
    params: { id: 'Project id (defaults to active project)' },
    query: { status: 'Optional status filter' }
  },
  {
    action: 'fulfillItemRequestByHand', aliases: ['fulfillItemRequest'], group: 'requests', method: 'POST', pattern: '/api/item-requests/:uid/fulfill',
    scope: 'propose', mcpAllowed: false,
    summary: 'Fulfils an item request manually from a designer session.',
    blockedReason: 'Use uiux_fulfill_request over MCP to fulfil an item request.'
  },
  {
    action: 'rejectItemRequestByHand', aliases: ['rejectItemRequest'], group: 'requests', method: 'POST', pattern: '/api/item-requests/:uid/reject',
    scope: 'propose', mcpAllowed: false,
    summary: 'Rejects an item request from a designer session.',
    blockedReason: 'Rejecting item requests is human-only in the designer.'
  },
  {
    action: 'adoptProjectDependencies', group: 'projects', method: 'POST', pattern: '/api/projects/:id/adopt-dependencies',
    scope: 'propose', mcpAllowed: true,
    summary: 'Clones every foreign/public sub-item referenced by the owned project into the project\'s own library.',
    params: { id: 'Project id (defaults to active project)' }
  }
];

export const OPERATION_BY_ACTION = new Map();
export const OPERATION_BY_ROUTE = new Map();

for (const op of API_OPERATIONS) {
  OPERATION_BY_ACTION.set(op.action, op);
  for (const alias of op.aliases || []) OPERATION_BY_ACTION.set(alias, op);
  OPERATION_BY_ROUTE.set(`${op.method} ${op.pattern}`, op);
}

/** One-line route notes for `/docs/api`, enriched with action names and MCP scope. */
export function buildRouteNotes() {
  const out = {};
  for (const op of API_OPERATIONS) {
    const mcpTag = op.mcpAllowed
      ? `MCP uiux_api_call: "${op.action}" (scope: ${op.scope}${op.accountOnly ? ', account key' : ''})`
      : 'Session only (blocked over MCP)';
    out[`${op.method} ${op.pattern}`] = `${op.summary} [${mcpTag}]`;
  }
  return out;
}
