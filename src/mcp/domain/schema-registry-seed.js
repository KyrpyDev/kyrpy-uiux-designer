/**
 * Seed for `schema_registry`: what every table and column means, written for AI agents (pure data).
 *
 * Rules (docs/project-definition/project-definition-mcp.md §7.1):
 *  - every table has a table-level entry (`columns` omitted → column_name = '')
 *  - every column has a column-level entry
 *  - adding a table or column without an entry fails `mcp/tests/mcp-m0.test.js`
 *
 * Bump `SEED_VERSION` when you change any text; rows edited by users (`source != 'seed'`) are never overwritten.
 */
export const SEED_VERSION = 11;

/* ---------- shared column descriptions ---------- */

const C = {
  id: 'Local integer primary key. Instance-specific: never use it across databases; use `uid` (or `key` inside a project) instead.',
  uid: 'Stable UUID of the row, the same on every instance and in every export. Use it to reference items across projects, sync and MCP calls.',
  content_hash: 'Cached sha256 of the canonical, id-free content (see src/mcp/domain/content-hash.js). NULL means "stale, recompute". Equal hash = equal visible content.',
  mcp_context: 'Row-level AI context (JSON object: purpose, usage, constraints[], codeHints{}, related[], source, updatedBy). Row-specific notes only; table meaning lives in schema_registry.',
  key: 'Variable name used in code: lowercase dashed words starting with a letter (`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`). Today unique across the whole table; becomes unique per project (`project_id`, `key`) in a later milestone.',
  name: 'Human-readable name shown in the designer lists.',
  label: 'Text shown to end users of the app (translatable through `translations`).',
  description_dev: 'Free-text instructions written by humans for developers and coding agents.',
  category: 'Free grouping used for library filtering (for example "navigation", "forms").',
  tags: 'JSON array of strings for search.',
  width: 'Design width in px of the item frame (paths and icons are fixed 24).',
  height: 'Design height in px of the item frame (paths and icons are fixed 24).',
  meta: 'JSON object with type-specific settings (htmlTag, device, source, container options …).',
  builtin: '1 = shipped with the designer. Builtin items are copy-only: clone them, never edit them in place.',
  position: 'Sort order in the library list.',
  created_at: 'Creation time, UTC text `YYYY-MM-DD HH:MM:SS`.',
  updated_at: 'Last update time, UTC text `YYYY-MM-DD HH:MM:SS`.',
  project_id: 'Owning project (`projects.id`). Project 1 holds the shared public library.',
  visibility: 'Who can see the item: `public` (everyone), `private` (the creator\'s own global library), `project` (members of `project_id`).',
  creator_id: 'User who created this row (`users.id`).',
  cloned_from_id: 'Row this one was cloned from (same table), NULL for originals.',
  root_item_id: 'First item of the clone chain (same table); equals `id` for originals.',
  root_owner_id: 'Creator of the first item of the clone chain (`users.id`).',
  locked: '1 = position/editing locked in the designer canvas (editor state, not content).'
};

const designColumns = extra => ({
  id: C.id, key: C.key, name: C.name, label: C.label, description_dev: C.description_dev, category: C.category, tags: C.tags,
  width: C.width, height: C.height, meta: C.meta, builtin: C.builtin, position: C.position, created_at: C.created_at,
  updated_at: C.updated_at, project_id: C.project_id, visibility: C.visibility, creator_id: C.creator_id,
  cloned_from_id: C.cloned_from_id, root_item_id: C.root_item_id, root_owner_id: C.root_owner_id, locked: C.locked,
  uid: C.uid, content_hash: C.content_hash, mcp_context: C.mcp_context, ...extra
});

const HIERARCHY = 'Hierarchy: path → icon → button → element → screen → workflow. An item may only contain items from lower levels (nodes.kind = "instance").';

/* ---------- tables ---------- */

export const SCHEMA_REGISTRY_SEED = {
  paths: {
    purpose: 'Reusable vector path groups on a 24×24 grid; the lowest level of the design hierarchy.',
    usage: 'Compose icons from paths. Each path\'s shapes live in `nodes` (owner_type = "path").',
    constraints: [HIERARCHY, 'viewBox is always 0 0 24 24.', 'Stroke widths are ratios of the global stroke token, not fixed px.', 'Colors reference theme tokens ({{token}}) or currentColor.'],
    columns: designColumns()
  },
  icons: {
    purpose: '24×24 icons composed of paths and own shapes.',
    usage: 'Used inside buttons, elements, screens and menu items. Shapes in `nodes` (owner_type = "icon").',
    constraints: [HIERARCHY, 'viewBox is always 0 0 24 24.', 'May contain path instances and shapes only.', 'Search existing icons before creating a new one.'],
    columns: designColumns()
  },
  buttons: {
    purpose: 'Interactive buttons: a frame plus icons, with optional popup / radial / drawer / slider / carousel menu.',
    usage: 'Shapes in `nodes` (owner_type = "button"); menu entries in `menu_items`. The frame shape and icon size follow the project button settings (projects.settings.buttonStyle, buttonIconSizePct 50–100, default 95).',
    constraints: [HIERARCHY, 'May contain icon and path instances.', 'Needs an accessible `label`.'],
    columns: designColumns()
  },
  elements: {
    purpose: 'Reusable UI building blocks: cards, forms, inputs, containers, carousels, flip boxes, notification boxes.',
    usage: 'Shapes and instances in `nodes` (owner_type = "element"). Can be opened by events as popup, drawer, toolbar or inline element.',
    constraints: [HIERARCHY, 'May contain icons, buttons, paths and other elements (no cycles).'],
    columns: designColumns()
  },
  screens: {
    purpose: 'Device-sized compositions (one app screen / route).',
    usage: 'Width/height match a template device. Content in `nodes` (owner_type = "screen"). Linked to other screens by workflows.',
    constraints: [HIERARCHY, 'May contain icons, buttons and elements.'],
    columns: designColumns()
  },
  nodes: {
    purpose: 'The scene graph of every design: one row per SVG shape, text, group or instance of another item.',
    usage: 'Rows belong to one owner (owner_type + owner_id). Tree order is parent_id + ord. Instances point to another item with ref_type + ref_id.',
    constraints: ['owner_type is one of path, icon, button, element, screen.', 'An instance may only reference a lower hierarchy level than its owner.', 'attrs colors may be theme tokens like {{accent}}.'],
    columns: {
      id: C.id,
      owner_type: 'Type of the owning design: path, icon, button, element or screen.',
      owner_id: 'id of the owning row in the table for owner_type.',
      parent_id: 'Parent node (group) inside the same owner; NULL for root nodes.',
      ord: 'Z-order among siblings (lower is drawn first).',
      kind: 'shape | text | group | instance.',
      tag: 'SVG tag: rect, circle, ellipse, path, line, polyline, polygon, text, g, use.',
      name: 'Variable name of the node in generated code.',
      role: 'Theme surface role (card, button, field, shine, bg, bg-glow) that pulls fill/stroke from themes.surfaces.',
      ref_type: 'For kind = instance: the referenced item type.',
      ref_id: 'For kind = instance: the referenced item id.',
      rotation: 'Rotation in degrees around the node center.',
      visible: '1 = rendered, 0 = hidden.',
      locked: '1 = locked on the canvas (editor state).',
      text: 'Text content for kind = text.',
      attrs: 'JSON object of SVG attributes. Colors may be {{token}} placeholders resolved per theme.',
      description_dev: C.description_dev,
      on_click: 'Legacy single click action (JSON). Prefer `events`.',
      events: 'JSON array of { trigger, action } — triggers like click, longpress, focus; actions like screen, popup, drawer, back, show-element, animate, toggle, radial-menu.',
      mcp_context: C.mcp_context
    }
  },
  animations: {
    purpose: 'CSS-keyframe style animations attached to a node.',
    usage: 'Rendered into the exported SVG/CSS. trigger decides when it plays (load, hover, click …).',
    columns: {
      id: C.id,
      node_id: 'Animated node (`nodes.id`).',
      name: 'Animation name used in generated CSS.',
      type: 'Animation preset (move, rotate, scale, fade, visible, …).',
      params: 'JSON parameters of the preset (from/to values, angle, …).',
      duration_ms: 'Duration in milliseconds.',
      delay_ms: 'Start delay in milliseconds.',
      easing: 'CSS easing function.',
      iterations: 'Iteration count or "infinite".',
      direction: 'CSS animation-direction.',
      fill_mode: 'CSS animation-fill-mode.',
      trigger: 'When the animation runs: load, hover, click, …',
      enabled: '1 = active.',
      mcp_context: C.mcp_context
    }
  },
  menu_items: {
    purpose: 'Entries of a button\'s menu (radial, drawer, slider, carousel, popup), nested by parent_id.',
    usage: 'Each item can show an icon, run an action, route to a screen or open an element.',
    columns: {
      id: C.id,
      button_id: 'Button that owns the menu (`buttons.id`).',
      parent_id: 'Parent menu item for sub-menus; NULL for top level.',
      ord: 'Order among siblings.',
      name: 'Variable name, unique among siblings.',
      label: C.label,
      icon_id: 'Icon shown for the item (`icons.id`).',
      action: 'What the item does (screen, element, back, custom …).',
      target_screen_id: 'Screen to route to (`screens.id`).',
      description_dev: C.description_dev,
      target_element_id: 'Element to open as popup/inline (`elements.id`).',
      ref_button_id: 'Library button drawn as this item (`buttons.id`): its shape/style; an item icon replaces the button\'s own icon.',
      visible: '1 = shown.',
      mcp_context: C.mcp_context
    }
  },
  workflows: {
    purpose: 'Screen-routing graphs: which screens exist in a flow and how users navigate between them.',
    usage: 'Screens placed via workflow_screens, navigation edges in workflow_links. Reverse-engineered from an app\'s router/navigation.',
    constraints: ['A workflow is a navigation graph, not a developer/CI process.'],
    columns: {
      id: C.id, key: C.key, name: C.name, label: C.label, description_dev: C.description_dev,
      created_at: C.created_at, updated_at: C.updated_at, project_id: C.project_id, visibility: C.visibility,
      creator_id: C.creator_id, cloned_from_id: C.cloned_from_id, root_item_id: C.root_item_id,
      root_owner_id: C.root_owner_id, locked: C.locked, uid: C.uid, content_hash: C.content_hash, mcp_context: C.mcp_context
    }
  },
  workflow_screens: {
    purpose: 'Placement of a screen on a workflow canvas.',
    columns: {
      workflow_id: 'Workflow (`workflows.id`).',
      screen_id: 'Placed screen (`screens.id`).',
      x: 'Canvas x position.',
      y: 'Canvas y position.',
      collapsed: '1 = shown collapsed on the canvas.',
      locked: '1 = position locked (editor state).',
      mcp_context: C.mcp_context
    }
  },
  workflow_links: {
    purpose: 'Navigation edges between screens of a workflow.',
    usage: 'from_node_id is the hotspot (button/element node) that triggers the navigation.',
    columns: {
      id: C.id,
      workflow_id: 'Workflow (`workflows.id`).',
      from_screen_id: 'Source screen (`screens.id`).',
      from_node_id: 'Triggering node on the source screen (`nodes.id`), NULL for screen-level links.',
      to_screen_id: 'Target screen (`screens.id`).',
      name: 'Name of the transition.',
      description_dev: C.description_dev,
      style: 'Drawn line style: curved | cornered.',
      trigger: 'User gesture that follows the link (tap, swipe, …).',
      mcp_context: C.mcp_context
    }
  },
  themes: {
    purpose: 'Design styles: 15 style families × dark/light mode (Liquid Glass, Neumorphic, Brutalism, …).',
    usage: 'tokens = color/typography/stroke variables used as {{token}} in node attrs; surfaces = fill/stroke/filter recipes per node role.',
    constraints: ['Generated code should map tokens to CSS variables / theme constants, never hard-code the hex values.'],
    columns: {
      id: C.id, key: 'Style key, for example liquid or liquid-light; used in folder names like uiux/<style-key>/.',
      name: C.name,
      kind: 'Style family (glass, glow, neu, brutalism, …).',
      tokens: 'JSON object of design tokens (colors, mode, pairKey for the dark/light twin, styleFamily, …).',
      surfaces: 'JSON object role → SVG attribute recipe (fill, stroke, filter) applied to nodes with that role.',
      builtin: C.builtin, position: C.position, uid: C.uid, content_hash: C.content_hash, mcp_context: C.mcp_context
    }
  },
  template_buttons: {
    purpose: 'Button frame templates (shape, size, ratios, hover and indicator effects) used to create buttons.',
    constraints: ['rx/margin/stroke are ratios of the button size or global stroke, never px.'],
    columns: {
      id: C.id, key: C.key, name: C.name, category: C.category,
      shape: 'Frame shape: circle, pill, rounded, squircle, square, sharp, …',
      width: 'Default width in px.', height: 'Default height in px.',
      rx_ratio: 'Corner radius as a ratio of the smaller side.',
      margin_ratio: 'Inner margin as a ratio of the size.',
      stroke_ratio: 'Stroke width as a ratio of the global stroke width.',
      role: 'Theme surface role of the frame.',
      hover_effect: 'Hover effect: glow, fill, shine, …',
      indicator_effect: 'Attention indicator: none, blink, outline-blink, …',
      nodes_template: 'JSON array of node definitions instantiated for a new button.',
      meta: C.meta, builtin: C.builtin, created_by: 'User who created the template (`users.id`).', created_at: C.created_at,
      uid: C.uid, content_hash: C.content_hash, mcp_context: C.mcp_context
    }
  },
  template_devices: {
    purpose: 'Device frames (phones, tablets, web) that set screen sizes and grids.',
    columns: {
      id: C.id, key: C.key, name: C.name,
      category: 'mobile | tablet | desktop | web | watch …',
      width: 'Viewport width in px.', height: 'Viewport height in px.',
      corner_radius: 'Device corner radius in px.', grid: 'Snap grid size in px.',
      locked: C.locked, meta: C.meta, builtin: C.builtin,
      created_by: 'User who created the template (`users.id`).', created_at: C.created_at,
      uid: C.uid, content_hash: C.content_hash, mcp_context: C.mcp_context
    }
  },
  projects: {
    purpose: 'Workspaces that own design items, members and settings.',
    usage: 'settings JSON holds project-wide options such as buttonStyle and buttonIconSizePct (50–100, default 95).',
    columns: {
      id: C.id, key: 'Project key (dashed words), unique.', name: C.name, label: C.label,
      description: 'Project description for humans.',
      owner_id: 'Owner (`users.id`); the only user who may approve changes and (later) create API keys.',
      visibility: 'public | private.',
      require_approval: '1 = edits by collaborators become change_requests that the owner must approve.',
      settings: 'JSON project settings (buttonStyle, buttonIconSizePct, …).',
      created_at: C.created_at, updated_at: C.updated_at, mcp_context: C.mcp_context
    }
  },
  project_members: {
    purpose: 'Membership and role of users in projects.',
    columns: {
      id: C.id, project_id: 'Project (`projects.id`).', user_id: 'Member (`users.id`).',
      invited_by: 'Inviting user (`users.id`).',
      role: 'owner | admin | editor | contributor | viewer.',
      status: 'accepted | pending | rejected | revoked.',
      created_at: C.created_at, updated_at: C.updated_at, mcp_context: C.mcp_context
    }
  },
  users: {
    purpose: 'User accounts.',
    constraints: ['Never expose password_hash or salt to AI agents or exports.'],
    columns: {
      id: C.id, username: 'Unique login name.', email: 'Unique e-mail address (personal data).',
      password_hash: 'scrypt hash. Secret.', salt: 'Password salt. Secret.',
      display_name: 'Name shown in the UI.',
      role: 'superadmin | admin | designer | reviewer | viewer.',
      status: 'active | suspended | pending.',
      permissions: 'JSON array of extra permission strings.',
      avatar_color: 'Avatar color (hex).',
      created_at: C.created_at, updated_at: C.updated_at, last_login_at: 'Last successful login time.',
      mcp_context: C.mcp_context
    }
  },
  sessions: {
    purpose: 'Login sessions of the web designer.',
    constraints: ['Tokens are secrets; never return them through MCP.'],
    columns: {
      token: 'Session token (secret, `ud_…`).', user_id: 'Session user (`users.id`).',
      expires_at: 'Expiry time.', created_at: C.created_at, mcp_context: C.mcp_context
    }
  },
  change_requests: {
    purpose: 'Edits waiting for owner approval, with before/after snapshots (also used for AI pushes later).',
    columns: {
      id: C.id, project_id: 'Project (`projects.id`).',
      target_type: 'Changed item type (path, icon, button, element, screen, workflow).',
      target_id: 'Changed item id.', target_key: 'Changed item key at request time.', target_name: 'Changed item name at request time.',
      author_id: 'User who made the change.', owner_id: 'Project owner who must review.',
      action: 'create | update | delete …', summary: 'Short human summary.',
      before_snapshot: 'JSON snapshot before the change.', after_snapshot: 'JSON snapshot after the change.',
      diff_summary: 'JSON summary of changed fields.',
      status: 'pending | approved | rejected.', reviewer_id: 'User who reviewed.', review_comment: 'Reviewer comment.',
      created_at: C.created_at, reviewed_at: 'Review time.', mcp_context: C.mcp_context
    }
  },
  trash_items: {
    purpose: 'Soft-deleted items that can be restored or purged.',
    columns: {
      id: C.id, item_type: 'Deleted item type.', original_id: 'id the item had before deletion.',
      item_key: 'Key at deletion.', item_name: 'Name at deletion.', label: C.label, category: C.category,
      project_id: C.project_id, visibility: C.visibility, builtin: C.builtin, creator_id: C.creator_id,
      root_owner_id: C.root_owner_id, deleted_by: 'User who deleted it.', deleted_at: 'Deletion time.',
      snapshot: 'JSON snapshot used for restore.', mcp_context: C.mcp_context
    }
  },
  translations: {
    purpose: 'Translations of any text field of any table (table_name + record_id + field_name + lang_code).',
    usage: 'Base language is English (the column value itself). Use for label and other user-facing text.',
    columns: {
      id: C.id, table_name: 'Table of the translated row.', record_id: 'id of the translated row.',
      field_name: 'Translated column.', lang_code: 'Language code (for example tr, de).',
      translated_text: 'The translation.', updated_at: C.updated_at, mcp_context: C.mcp_context
    }
  },
  settings: {
    purpose: 'Global designer settings as key/value pairs (theme, grid, snapToGrid, snapToAnchors, device, …).',
    columns: { key: 'Setting name.', value: 'JSON-encoded value.', mcp_context: C.mcp_context }
  },
  sync_outbox: {
    purpose: 'Offline-first queue of local mutations waiting to be pushed to PostgreSQL.',
    constraints: ['Infrastructure table; agents should not read or write it.'],
    columns: {
      id: C.id, table_name: 'Mutated table.', record_id: 'Mutated row id (text).', operation: 'insert | update | delete.',
      payload: 'JSON payload of the change.', synced: '1 = pushed.', created_at: C.created_at, synced_at: 'Push time.',
      mcp_context: C.mcp_context
    }
  },
  sync_state: {
    purpose: 'Key/value state of the PostgreSQL sync (last sync times and counts).',
    constraints: ['Infrastructure table; agents should not read or write it.'],
    columns: { key: 'State name.', value: 'JSON-encoded value.', mcp_context: C.mcp_context }
  },
  login_failures: {
    purpose: 'Failed sign-ins per account and address, used to limit password guessing. Local to this database, never synced.',
    constraints: ['Infrastructure table; agents should not read or write it.'],
    columns: {
      bucket: 'SHA-256 of "<typed name>|<address>".', count: 'Failures in the current window.',
      started_at: 'Start of the window (epoch milliseconds).', mcp_context: C.mcp_context
    }
  },
  schema_registry: {
    purpose: 'Describes every table and column for AI agents (this table). Table-level rows have column_name = "".',
    usage: 'Served to MCP clients as the design-system schema. Read it before creating or editing rows.',
    constraints: ['Every table and every column must have a row; enforced by tests.', 'Rows with source = "seed" are refreshed from src/mcp/domain/schema-registry-seed.js.'],
    columns: {
      id: C.id, table_name: 'Described table.', column_name: 'Described column, or "" for the table itself.',
      mcp_context: 'The description (JSON: purpose, usage, constraints[], …).',
      version: 'Seed version that wrote the row.',
      source: 'seed (from code) | user (edited in the designer) | ai (written by an agent) | system (auto placeholder, needs a description).',
      updated_at: C.updated_at
    }
  },
  api_keys: {
    purpose: 'Secret API keys that let an AI coding agent act for one user through MCP: on one project (kind project) or on every project the user can see / owns (kind account).',
    usage: 'Created by the project owner from Profile → AI Access Keys. The plaintext is shown once; only an HMAC is stored.',
    constraints: ['Never return key_hash or any plaintext key through MCP or exports.', 'Local to this instance: not synced to PostgreSQL (the HMAC pepper is per instance).', 'An API key can never approve its own changes.'],
    columns: {
      id: C.id, uid: C.uid,
      user_id: 'User the key acts for (`users.id`); must still own the project for the key to work.',
      project_id: 'The single project a project key is bound to (`projects.id`); NULL for account keys.',
      kind: 'project (bound to one owned project) or account (user-wide: each call names its project; read = projects the user can see, propose/request = owned projects, create = new projects).',
      name: 'Human name of the key, for example "Claude Code — laptop".',
      prefix: 'First 13 characters of the key (kud_live_xxxx), stored in clear for display and lookup.',
      key_hash: 'HMAC-SHA256(pepper, key) as hex. Secret.',
      scopes: 'JSON array of granted scopes: read (always), request (create item requests), propose (stage changesets), create (account keys: create projects).',
      expires_at: 'ISO expiry time, NULL = never expires.',
      last_used_at: 'ISO time of the last successful authentication.',
      last_used_ip: 'Client IP of the last successful authentication.',
      revoked_at: 'ISO revocation time, NULL while the key is valid.',
      revoked_by: 'User who revoked the key (`users.id`).',
      rotated_from_id: 'Key this one replaced through rotation.',
      rotated_to_id: 'Key that replaced this one; this key stays valid until its (shortened) expiry.',
      created_at: 'ISO creation time.',
      mcp_context: C.mcp_context
    }
  },
  mcp_audit_log: {
    purpose: 'Audit trail of API key lifecycle events and MCP calls (kept 90 days).',
    constraints: ['Store argument digests only, never raw payloads or keys.', 'Infrastructure table; agents should not write it.'],
    columns: {
      id: C.id,
      api_key_id: 'Key involved (`api_keys.id`), NULL for unknown keys.',
      user_id: 'User involved (`users.id`).',
      project_id: 'Project involved (`projects.id`).',
      event: 'key.create | key.rotate | key.revoke | key.revoke_all | auth.ok | auth.fail | tool.call | ai_settings.update',
      tool: 'MCP tool name for tool.call events.',
      args_digest: 'sha256 of the canonical tool arguments.',
      result: 'ok | error | denied.',
      error_code: 'Stable error code when result is not ok.',
      duration_ms: 'Call duration in milliseconds.',
      ip: 'Client IP.',
      created_at: 'ISO event time.',
      mcp_context: C.mcp_context
    }
  },
  ai_artifacts: {
    purpose: 'Templates of the AI pack (agent, skill, rules) installed into app repositories by uiux_init.',
    usage: 'Global rows (scope = global, project_id = 0) are the built-in templates; a project row with the same kind + name + platform overrides it for that project.',
    constraints: ['Rows with source = seed are refreshed from src/mcp/domain/ai-pack-templates.js; user rows are never overwritten.', 'Templates use {{var}}, {{#if}}, {{#each}}; unknown {{names}} stay literal.'],
    columns: {
      id: C.id, uid: C.uid,
      scope: 'global (built-in, all projects) | project (override for one project).',
      project_id: 'Project of an override (`projects.id`), 0 for global rows.',
      kind: 'agent | skill | rule | command | readme.',
      platform: 'any (body shared by every platform) or a specific client platform.',
      name: 'Artifact name, for example kyrpy-uiux-designer or kyrpy-skill-uiux-designer.',
      template: 'Template body (Markdown with template placeholders).',
      version: 'Version of the body; installed packs update when it grows.',
      checksum: 'sha256 of the template body.',
      source: 'seed (from code) | user (edited by an owner or admin).',
      updated_by: 'User who last edited the row (`users.id`).',
      updated_at: 'ISO time of the last change.',
      mcp_context: C.mcp_context
    }
  },
  project_versions: {
    purpose: 'Numbered, immutable snapshots of a project (manifest of item uid + contentHash). The approved row is the head; an AI push first creates a pending row.',
    usage: 'Read with uiux_list_versions; pull deltas with uiux_get_manifest { sinceVersion }. The head is advanced automatically when designers change the project (source designer) and when a changeset is approved (source ai-push).',
    constraints: ['Exactly one approved (head) row per project; older heads become superseded.', 'number is monotonic per project and set on approval only.', 'Agents never write this table directly.'],
    columns: {
      id: C.id, uid: C.uid, project_id: C.project_id,
      number: 'Version number (1, 2, 3 …) assigned when the version is approved; NULL while pending and for rejected versions.',
      label: 'Optional semver-style label, for example "1.4.0".',
      parent_id: 'Version this one was built on (`project_versions.id`).',
      source: 'designer (captured from designer edits) | ai-push (approved changeset) | import (first baseline) | restore.',
      status: 'pending (waiting for review) | approved (the head) | rejected | superseded (an older head).',
      manifest: 'JSON array of {type, uid, key, contentHash, origin} for every item of the version.',
      manifest_hash: 'sha256 of the manifest (same value as uiux_get_manifest → manifestHash).',
      message: 'Commit-style message (for AI pushes: the submit message).',
      changeset_id: 'Changeset that produced this version (`changesets.id`), NULL for designer versions.',
      created_by_user: 'User who created the row (`users.id`).',
      created_by_key: 'API key that pushed it (`api_keys.id`), NULL for human versions.',
      created_at: 'ISO creation time.',
      approved_by: 'Human reviewer (`users.id`); NULL for automatic designer versions and auto-approved pushes.',
      approved_at: 'ISO approval time.',
      mcp_context: C.mcp_context
    }
  },
  changesets: {
    purpose: 'A group of create / update / delete proposals made by an AI agent against a base version, reviewed by a human before anything changes.',
    usage: 'uiux_begin_changeset → uiux_stage_item / uiux_stage_delete → uiux_diff_changeset → uiux_submit_changeset; the owner approves in the designer (Versions).',
    constraints: ['Open changesets expire after 24 h.', 'An API key can never approve a changeset.', 'At most 500 operations per changeset.'],
    columns: {
      id: C.id, uid: C.uid, project_id: C.project_id,
      base_version_id: 'Version the agent worked from (`project_versions.id`).',
      result_version_id: 'Pending / approved version created on submit (`project_versions.id`).',
      api_key_id: 'API key that opened it (`api_keys.id`).',
      user_id: 'User the key acts for (`users.id`).',
      status: 'open | submitted | approved | rejected | conflicted (submit found items changed since base) | expired | discarded.',
      summary: 'Short description given when the changeset was opened.',
      message: 'Message given on submit.',
      client_info: 'JSON describing the client (agent, repository, framework).',
      created_at: 'ISO creation time.',
      updated_at: 'ISO time of the last change.',
      submitted_at: 'ISO submit time.',
      expires_at: 'ISO time after which an open changeset expires.',
      reviewed_by: 'Human reviewer (`users.id`).',
      reviewed_at: 'ISO review time.',
      review_comment: 'Reviewer note shown to the agent by uiux_get_changeset.',
      mcp_context: C.mcp_context
    }
  },
  changeset_ops: {
    purpose: 'One proposed operation of a changeset: create, update or delete of one item.',
    constraints: ['One operation per item per changeset (restaging replaces it).', 'Nothing is applied before a human approves it.'],
    columns: {
      id: C.id, uid: C.uid,
      changeset_id: 'Owning changeset (`changesets.id`).',
      seq: 'Staging order.',
      op: 'create | update | delete.',
      item_type: 'path | icon | button | element | screen | workflow.',
      item_uid: 'uid of the item (for creates: the uid the new item will get).',
      item_key: 'key of the item.',
      base_hash: 'contentHash the agent based the change on; a different hash at submit means the item changed meanwhile (CONFLICT).',
      proposed_hash: 'contentHash the item will have after applying the operation (NULL for deletes).',
      payload: 'Proposed item JSON in the uiux_get_item format (references by uid/key).',
      validation: 'JSON {errors, warnings} from staging.',
      status: 'staged | applied | rejected | conflict | failed.',
      error: 'Error text when applying failed.',
      change_request_id: 'Review row in change_requests created on submit (`change_requests.id`).',
      mcp_context: C.mcp_context
    }
  },
  item_requests: {
    purpose: 'Requests for a UI item that does not exist yet, raised by a coding agent and fulfilled by the designer agent (or a human).',
    usage: 'uiux_request_item → (designer agent) uiux_claim_request → stage the item → uiux_fulfill_request → approval → fulfilled.',
    constraints: ['The server searches first and returns candidates; reuse one when it fits and cancel the request.', 'Fulfilment through a changeset only completes when the item is approved.'],
    columns: {
      id: C.id, uid: C.uid, project_id: C.project_id,
      item_type: 'path | icon | button | element | screen | workflow.',
      intent: 'What the item is for, in plain words (also the search text).',
      constraints: 'JSON object of requirements (size, style, states, accessibility …).',
      context: 'JSON object describing where it is needed (file, screen, framework).',
      candidates: 'JSON array of the closest existing items found when the request was made.',
      status: 'open | claimed | in-review (staged in a submitted changeset) | fulfilled | cancelled | rejected.',
      requested_by_user: 'User the requesting key acts for (`users.id`).',
      requested_by_key: 'API key that raised it (`api_keys.id`).',
      claimed_by_key: 'API key of the designer agent working on it (`api_keys.id`).',
      claimed_at: 'ISO claim time.',
      fulfilled_item_type: 'Type of the item that fulfils the request.',
      fulfilled_item_uid: 'uid of that item.',
      fulfilled_item_key: 'key of that item.',
      changeset_uid: 'Changeset that carries the new item while it is in review.',
      note: 'Free text from the agent or reviewer (cancel / reject reason).',
      created_at: 'ISO creation time.',
      updated_at: 'ISO time of the last change.',
      resolved_at: 'ISO time it was fulfilled, cancelled or rejected.',
      mcp_context: C.mcp_context
    }
  },
  code_bindings: {
    purpose: 'Links between design items and the code that implements them (file + symbol), used by reverse sync and "where is this used".',
    usage: 'Recorded with uiux_bind_code (or the binding of uiux_stage_item); read with uiux_list_bindings and uiux_get_item → bindings.',
    constraints: ['file_path is repository-relative, without "..".', 'Code wins for bindings: they change without review.'],
    columns: {
      id: C.id, uid: C.uid, project_id: C.project_id,
      item_type: 'Type of the bound item.',
      item_uid: 'uid of the bound item.',
      repo_id: 'Repository identifier chosen by the agent (for example the git remote), "" for the default repository.',
      file_path: 'Repository-relative path of the implementing file.',
      symbol: 'Component, class, function or CSS selector in that file ("" = the whole file).',
      framework: 'react | vue | svelte | flutter | compose | swiftui | web | …',
      binding_hash: 'contentHash of the item when the code was last synced with it; a different current hash means the code is behind.',
      last_seen_version_id: 'Head version when the binding was recorded (`project_versions.id`).',
      created_by_key: 'API key that recorded it (`api_keys.id`).',
      created_at: 'ISO creation time.',
      updated_at: 'ISO time of the last change.',
      mcp_context: C.mcp_context
    }
  },
  version_items: {
    purpose: 'Content-addressed item JSON of every (item uid, contentHash) a project version contained; lets a version be restored.',
    constraints: ['Written when a version is recorded; never edited.', 'Agents never write this table.'],
    columns: {
      item_uid: 'uid of the item.',
      content_hash: 'contentHash of this content.',
      item_type: 'path | icon | button | element | screen | workflow.',
      project_id: 'Project the version belongs to (`projects.id`).',
      item_json: 'The item in the uiux_get_item JSON format at that content.',
      created_at: 'ISO time it was stored.',
      mcp_context: C.mcp_context
    }
  },
  design_focus: {
    purpose: 'AI-assisted design: the project an account key with the "design" scope currently works on (its focus).',
    usage: 'Set by uiux_edit_project / uiux_create_project / uiux_clone_project / uiux_save_as; cleared by uiux_close_project. Local session state: never synced, never published.',
    constraints: ['One row per API key.', 'Always a project owned by the key\'s user; re-checked on every call.', 'Agents never write this table directly.'],
    columns: {
      api_key_id: 'The account API key (`api_keys.id`).',
      project_id: 'The focused project (`projects.id`).',
      updated_at: 'ISO time the focus was set.',
      mcp_context: C.mcp_context
    }
  },
  element_scripts: {
    purpose: 'Sandboxed custom ES module JavaScript and verified public JS library dependencies attached to UI elements.',
    usage: 'Read and written through uiux_element_script (or uiux_get_item / uiux_create_item / uiux_update_item / uiux_stage_item on elements); executed strictly inside <iframe sandbox="allow-scripts" referrerpolicy="no-referrer"> with nonce CSP and connect-src "none".',
    constraints: [
      'One script row per element (`element_id` is unique).',
      'Custom JS never runs on the Designer origin; previews use an opaque-origin iframe without allow-same-origin.',
      'Public JS imports must use allowlisted HTTPS CDNs (cdn.jsdelivr.net, esm.sh, unpkg.com) with exact semver and sha384/sha512 SRI.'
    ],
    columns: {
      id: C.id,
      uid: C.uid,
      element_id: 'Element this script belongs to (`elements.id`, unique).',
      enabled: '1 = execute inside sandboxed previews and HTML exports; 0 = render SVG fallback only.',
      runtime: 'Execution model: `esm` (ES module exporting entry_export) or `declarative`.',
      entry_export: 'Exported function name invoked as `fn(container, props, bridge)` (default `mount`).',
      module_code: 'Validated ES module source (up to 64 KB; eval, new Function, cookie/storage/parent DOM access forbidden).',
      imports_json: 'JSON array of pinned public JS dependencies (`{ specifier, package, version, subpath?, url, origin, integrity }`).',
      capabilities_json: 'JSON capability manifest (`{ domOnly, allowNetwork, allowCanvas, allowWebGL, allowTimers, allowedConnectOrigins }`).',
      props_schema_json: 'JSON object describing typed runtime props passed to `mount(container, props, bridge)`.',
      emits_json: 'JSON array of declared events emitted via `bridge.emit(event, detail)` over postMessage.',
      code_hash: 'sha256 hex digest of `module_code`.',
      sri_verified: '1 when every entry in `imports_json` carries a verified cryptographic Subresource Integrity hash.',
      review_status: 'Security review state: `verified`, `needs-sri`, `needs-human-review`, or `approved`.',
      created_by: 'User who created the script (`users.id`).',
      updated_by: 'User who last updated the script (`users.id`).',
      created_at: 'ISO creation time.',
      updated_at: 'ISO time of the last change.',
      mcp_context: C.mcp_context
    }
  },
  mcp_migrations: {
    purpose: 'Ledger of applied MCP-layer migrations (separate from the core PRAGMA user_version).',
    constraints: ['Infrastructure table; agents should not read or write it.'],
    columns: { id: 'Migration id, for example "m0-001-schema-registry".', applied_at: 'Apply time.', mcp_context: C.mcp_context }
  }
};

/** Flattens the seed into registry rows: { tableName, columnName, context }. */
export function seedRows(seed = SCHEMA_REGISTRY_SEED) {
  const rows = [];
  for (const [tableName, t] of Object.entries(seed)) {
    const { columns = {}, ...table } = t;
    rows.push({ tableName, columnName: '', context: { ...table, source: 'seed' } });
    for (const [columnName, purpose] of Object.entries(columns)) {
      rows.push({ tableName, columnName, context: { purpose, source: 'seed' } });
    }
  }
  return rows;
}
