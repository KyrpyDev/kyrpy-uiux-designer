-- =============================================================================
-- Kyrpy UI/UX Designer — SQLite Schema (Auto-synced by scripts/export-public-db.js)
-- =============================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE "animations" (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL,
  params      TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 1000,
  delay_ms    INTEGER NOT NULL DEFAULT 0,
  easing      TEXT NOT NULL DEFAULT 'ease-in-out',
  iterations  TEXT NOT NULL DEFAULT 'infinite',
  direction   TEXT NOT NULL DEFAULT 'alternate',
  fill_mode   TEXT NOT NULL DEFAULT 'both',
  trigger     TEXT NOT NULL DEFAULT 'load',
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE buttons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,          -- variable name used in code (dashed words)
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',      -- text shown to users
  description_dev TEXT NOT NULL DEFAULT '',      -- instructions for the dev team / coding agents
  category        TEXT NOT NULL DEFAULT 'general',
  tags            TEXT NOT NULL DEFAULT '[]',
  width           REAL NOT NULL DEFAULT 24,
  height          REAL NOT NULL DEFAULT 24,
  meta            TEXT NOT NULL DEFAULT '{}',    -- type specific json (htmlTag, device, source ...)
  builtin         INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE change_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL DEFAULT 1,
  target_type     TEXT NOT NULL,
  target_id       INTEGER NOT NULL,
  target_key      TEXT NOT NULL DEFAULT '',
  target_name     TEXT NOT NULL DEFAULT '',
  author_id       INTEGER NOT NULL DEFAULT 1,
  owner_id        INTEGER NOT NULL DEFAULT 1,
  action          TEXT NOT NULL DEFAULT 'update',
  summary         TEXT NOT NULL DEFAULT '',
  before_snapshot TEXT NOT NULL DEFAULT '{}',
  after_snapshot  TEXT NOT NULL DEFAULT '{}',
  diff_summary    TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id     INTEGER,
  review_comment  TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at     TEXT
);

CREATE TABLE "elements" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,          -- variable name used in code (dashed words)
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',      -- text shown to users
  description_dev TEXT NOT NULL DEFAULT '',      -- instructions for the dev team / coding agents
  category        TEXT NOT NULL DEFAULT 'general',
  tags            TEXT NOT NULL DEFAULT '[]',
  width           REAL NOT NULL DEFAULT 24,
  height          REAL NOT NULL DEFAULT 24,
  meta            TEXT NOT NULL DEFAULT '{}',    -- type specific json (htmlTag, device, source ...)
  builtin         INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE icons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,          -- variable name used in code (dashed words)
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',      -- text shown to users
  description_dev TEXT NOT NULL DEFAULT '',      -- instructions for the dev team / coding agents
  category        TEXT NOT NULL DEFAULT 'general',
  tags            TEXT NOT NULL DEFAULT '[]',
  width           REAL NOT NULL DEFAULT 24,
  height          REAL NOT NULL DEFAULT 24,
  meta            TEXT NOT NULL DEFAULT '{}',    -- type specific json (htmlTag, device, source ...)
  builtin         INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE menu_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  button_id        INTEGER NOT NULL REFERENCES buttons(id) ON DELETE CASCADE,
  parent_id        INTEGER REFERENCES menu_items(id) ON DELETE CASCADE,
  ord              INTEGER NOT NULL DEFAULT 0,
  name             TEXT NOT NULL DEFAULT '',
  label            TEXT NOT NULL DEFAULT '',
  icon_id          INTEGER REFERENCES icons(id) ON DELETE SET NULL,
  action           TEXT NOT NULL DEFAULT '',
  target_screen_id INTEGER REFERENCES screens(id) ON DELETE SET NULL,
  description_dev  TEXT NOT NULL DEFAULT ''
, target_element_id INTEGER REFERENCES elements(id) ON DELETE SET NULL, visible INTEGER NOT NULL DEFAULT 1);

CREATE TABLE nodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type      TEXT NOT NULL CHECK (owner_type IN ('path','icon','button','element','screen')),
  owner_id        INTEGER NOT NULL,
  parent_id       INTEGER REFERENCES nodes(id) ON DELETE CASCADE,
  ord             INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL DEFAULT 'shape' CHECK (kind IN ('shape','text','group','instance')),
  tag             TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  role            TEXT,
  ref_type        TEXT,
  ref_id          INTEGER,
  rotation        REAL NOT NULL DEFAULT 0,
  visible         INTEGER NOT NULL DEFAULT 1,
  locked          INTEGER NOT NULL DEFAULT 0,
  text            TEXT NOT NULL DEFAULT '',
  attrs           TEXT NOT NULL DEFAULT '{}',
  description_dev TEXT NOT NULL DEFAULT ''
, on_click TEXT NOT NULL DEFAULT '', events TEXT NOT NULL DEFAULT '[]');

CREATE TABLE paths (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,          -- variable name used in code (dashed words)
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',      -- text shown to users
  description_dev TEXT NOT NULL DEFAULT '',      -- instructions for the dev team / coding agents
  category        TEXT NOT NULL DEFAULT 'general',
  tags            TEXT NOT NULL DEFAULT '[]',
  width           REAL NOT NULL DEFAULT 24,
  height          REAL NOT NULL DEFAULT 24,
  meta            TEXT NOT NULL DEFAULT '{}',    -- type specific json (htmlTag, device, source ...)
  builtin         INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE project_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by INTEGER,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','admin','editor','contributor','viewer')),
  status     TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','pending','rejected','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, user_id)
);

CREATE TABLE projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  key              TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  label            TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  owner_id         INTEGER NOT NULL DEFAULT 1,
  visibility       TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  require_approval INTEGER NOT NULL DEFAULT 1,
  settings         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE screens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,          -- variable name used in code (dashed words)
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',      -- text shown to users
  description_dev TEXT NOT NULL DEFAULT '',      -- instructions for the dev team / coding agents
  category        TEXT NOT NULL DEFAULT 'general',
  tags            TEXT NOT NULL DEFAULT '[]',
  width           REAL NOT NULL DEFAULT 24,
  height          REAL NOT NULL DEFAULT 24,
  meta            TEXT NOT NULL DEFAULT '{}',    -- type specific json (htmlTag, device, source ...)
  builtin         INTEGER NOT NULL DEFAULT 0,
  position        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  operation  TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  synced     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at  TEXT
);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE template_buttons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  key              TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL DEFAULT 'standard',
  shape            TEXT NOT NULL DEFAULT 'pill',
  width            INTEGER NOT NULL DEFAULT 160,
  height           INTEGER NOT NULL DEFAULT 48,
  rx_ratio         REAL NOT NULL DEFAULT 0.3,
  margin_ratio     REAL NOT NULL DEFAULT 0.15,
  stroke_ratio     REAL NOT NULL DEFAULT 1.0,
  role             TEXT NOT NULL DEFAULT 'button',
  hover_effect     TEXT NOT NULL DEFAULT 'glow',
  indicator_effect TEXT NOT NULL DEFAULT 'none',
  nodes_template   TEXT NOT NULL DEFAULT '[]',
  meta             TEXT NOT NULL DEFAULT '{}',
  builtin          INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE template_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key           TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'mobile',
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  corner_radius INTEGER NOT NULL DEFAULT 44,
  grid          INTEGER NOT NULL DEFAULT 24,
  locked        INTEGER NOT NULL DEFAULT 0,
  meta          TEXT NOT NULL DEFAULT '{}',
  builtin       INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE themes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  key       TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('glass','glow','neu')),
  tokens    TEXT NOT NULL,
  surfaces  TEXT NOT NULL DEFAULT '{}',
  builtin   INTEGER NOT NULL DEFAULT 0,
  position  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE translations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name      TEXT NOT NULL,
  record_id       INTEGER NOT NULL,
  field_name      TEXT NOT NULL,
  lang_code       TEXT NOT NULL,
  translated_text TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (table_name, record_id, field_name, lang_code)
);

CREATE TABLE trash_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type       TEXT NOT NULL CHECK (item_type IN ('path','icon','button','element','screen','workflow')),
  original_id     INTEGER NOT NULL,
  item_key        TEXT NOT NULL,
  item_name       TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  category        TEXT NOT NULL DEFAULT 'general',
  project_id      INTEGER NOT NULL DEFAULT 1,
  visibility      TEXT NOT NULL DEFAULT 'public',
  builtin         INTEGER NOT NULL DEFAULT 0,
  creator_id      INTEGER NOT NULL DEFAULT 1,
  root_owner_id   INTEGER NOT NULL DEFAULT 1,
  deleted_by      INTEGER NOT NULL DEFAULT 1,
  deleted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  snapshot        TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  salt          TEXT NOT NULL DEFAULT '',
  display_name  TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'designer' CHECK (role IN ('superadmin','admin','designer','reviewer','viewer')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending')),
  permissions   TEXT NOT NULL DEFAULT '[]',
  avatar_color  TEXT NOT NULL DEFAULT '#2e9bff',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE "workflow_links" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id     INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_screen_id  INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  from_node_id    INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
  to_screen_id    INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  name            TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  style           TEXT NOT NULL DEFAULT 'curved' CHECK (style IN ('curved','cornered')),
  trigger         TEXT NOT NULL DEFAULT 'tap'
);

CREATE TABLE workflow_screens (
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  screen_id   INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, screen_id)
);

CREATE TABLE workflows (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  label           TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0);

CREATE INDEX idx_animations_node ON animations(node_id);

CREATE INDEX idx_buttons_category ON buttons(category);

CREATE INDEX idx_changes_owner ON change_requests(owner_id, status);

CREATE INDEX idx_changes_project ON change_requests(project_id, status);

CREATE INDEX idx_changes_target ON change_requests(target_type, target_id);

CREATE INDEX idx_icons_category ON icons(category);

CREATE INDEX idx_items_category ON "elements"(category);

CREATE INDEX idx_links_workflow ON workflow_links(workflow_id);

CREATE INDEX idx_menu_items_button ON menu_items(button_id, parent_id, ord);

CREATE INDEX idx_nodes_owner ON nodes(owner_type, owner_id, ord);

CREATE INDEX idx_nodes_ref ON nodes(ref_type, ref_id);

CREATE INDEX idx_paths_category ON paths(category);

CREATE INDEX idx_project_members_proj ON project_members(project_id, status);

CREATE INDEX idx_project_members_user ON project_members(user_id, status);

CREATE INDEX idx_screens_category ON screens(category);

CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE INDEX idx_sync_outbox_pending ON sync_outbox(synced, id);

CREATE INDEX idx_translations_lookup ON translations(table_name, record_id, lang_code);

CREATE INDEX idx_trash_type_proj ON trash_items(item_type, project_id, visibility);
