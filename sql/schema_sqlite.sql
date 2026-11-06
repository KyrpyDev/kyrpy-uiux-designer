-- =============================================================================
-- Kyrpy UI/UX Designer — SQLite Schema (Auto-synced by scripts/export-public-db.js)
-- =============================================================================
PRAGMA foreign_keys = ON;

CREATE TABLE ai_artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  scope       TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id  INTEGER NOT NULL DEFAULT 0,          -- 0 for global templates
  kind        TEXT NOT NULL CHECK (kind IN ('agent','skill','rule','command','readme')),
  platform    TEXT NOT NULL DEFAULT 'any',
  name        TEXT NOT NULL,
  template    TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  checksum    TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user')),
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context TEXT NOT NULL DEFAULT '{}',
  UNIQUE (scope, project_id, kind, name, platform)
);

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
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE api_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT NOT NULL DEFAULT '["read"]',
  expires_at      TEXT,
  last_used_at    TEXT,
  last_used_ip    TEXT,
  revoked_at      TEXT,
  revoked_by      INTEGER,
  rotated_from_id INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  rotated_to_id   INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context     TEXT NOT NULL DEFAULT '{}'
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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

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
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE changeset_ops (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  changeset_id      INTEGER NOT NULL REFERENCES changesets(id) ON DELETE CASCADE,
  seq               INTEGER NOT NULL DEFAULT 0,
  op                TEXT NOT NULL CHECK (op IN ('create','update','delete')),
  item_type         TEXT NOT NULL,
  item_uid          TEXT NOT NULL,
  item_key          TEXT NOT NULL,
  base_hash         TEXT,
  proposed_hash     TEXT,
  payload           TEXT NOT NULL DEFAULT '{}',
  validation        TEXT NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged','applied','rejected','conflict','failed')),
  error             TEXT NOT NULL DEFAULT '',
  change_request_id INTEGER,
  mcp_context       TEXT NOT NULL DEFAULT '{}',
  UNIQUE (changeset_id, item_type, item_key)
);

CREATE TABLE changesets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  uid               TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_version_id   INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  result_version_id INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  api_key_id        INTEGER,
  user_id           INTEGER,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','rejected','conflicted','expired','discarded')),
  summary           TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  client_info       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  submitted_at      TEXT,
  expires_at        TEXT,
  reviewed_by       INTEGER,
  reviewed_at       TEXT,
  review_comment    TEXT NOT NULL DEFAULT '',
  mcp_context       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE code_bindings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                  TEXT NOT NULL UNIQUE,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_type            TEXT NOT NULL,
  item_uid             TEXT NOT NULL,
  repo_id              TEXT NOT NULL DEFAULT '',
  file_path            TEXT NOT NULL,
  symbol               TEXT NOT NULL DEFAULT '',
  framework            TEXT NOT NULL DEFAULT '',
  binding_hash         TEXT,
  last_seen_version_id INTEGER,
  created_by_key       INTEGER,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context          TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, item_uid, repo_id, file_path, symbol)
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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE TABLE item_requests (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_type           TEXT NOT NULL,
  intent              TEXT NOT NULL,
  constraints         TEXT NOT NULL DEFAULT '{}',
  context             TEXT NOT NULL DEFAULT '{}',
  candidates          TEXT NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','in-review','fulfilled','cancelled','rejected')),
  requested_by_user   INTEGER,
  requested_by_key    INTEGER,
  claimed_by_key      INTEGER,
  claimed_at          TEXT,
  fulfilled_item_type TEXT,
  fulfilled_item_uid  TEXT,
  fulfilled_item_key  TEXT,
  changeset_uid       TEXT,
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at         TEXT,
  mcp_context         TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE mcp_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id   INTEGER,
  user_id      INTEGER,
  project_id   INTEGER,
  event        TEXT NOT NULL,
  tool         TEXT NOT NULL DEFAULT '',
  args_digest  TEXT NOT NULL DEFAULT '',
  result       TEXT NOT NULL DEFAULT 'ok' CHECK (result IN ('ok','error','denied')),
  error_code   TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  ip           TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mcp_context  TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE mcp_migrations (
    id          TEXT PRIMARY KEY,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now')),
    mcp_context TEXT NOT NULL DEFAULT '{}'
  );

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
, target_element_id INTEGER REFERENCES elements(id) ON DELETE SET NULL, visible INTEGER NOT NULL DEFAULT 1, mcp_context TEXT NOT NULL DEFAULT '{}');

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
, on_click TEXT NOT NULL DEFAULT '', events TEXT NOT NULL DEFAULT '[]', mcp_context TEXT NOT NULL DEFAULT '{}');

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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE TABLE project_members (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by INTEGER,
  role       TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','admin','editor','contributor','viewer')),
  status     TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','pending','rejected','revoked')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), mcp_context TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, user_id)
);

CREATE TABLE project_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number          INTEGER,                          -- assigned on approval; NULL while pending / when rejected
  label           TEXT NOT NULL DEFAULT '',
  parent_id       INTEGER REFERENCES project_versions(id) ON DELETE SET NULL,
  source          TEXT NOT NULL CHECK (source IN ('designer','ai-push','import','restore')),
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','superseded')),
  manifest        TEXT NOT NULL DEFAULT '[]',
  manifest_hash   TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  changeset_id    INTEGER,
  created_by_user INTEGER,
  created_by_key  INTEGER,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  approved_by     INTEGER,
  approved_at     TEXT,
  mcp_context     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, number)
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
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE schema_registry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT '',          -- '' = the table itself
  mcp_context TEXT NOT NULL DEFAULT '{}',        -- the description (JSON)
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user','ai','system')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (table_name, column_name)
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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE TABLE sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE sync_outbox (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  operation  TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  synced     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at  TEXT
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
, mcp_context TEXT NOT NULL DEFAULT '{}');

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
, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

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
, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE TABLE "themes" (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  key       TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (length(kind) > 0),
  tokens    TEXT NOT NULL,
  surfaces  TEXT NOT NULL DEFAULT '{}',
  builtin   INTEGER NOT NULL DEFAULT 0,
  position  INTEGER NOT NULL DEFAULT 0
, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE TABLE translations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name      TEXT NOT NULL,
  record_id       INTEGER NOT NULL,
  field_name      TEXT NOT NULL,
  lang_code       TEXT NOT NULL,
  translated_text TEXT NOT NULL DEFAULT '',
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')), mcp_context TEXT NOT NULL DEFAULT '{}',
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
, mcp_context TEXT NOT NULL DEFAULT '{}');

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
, mcp_context TEXT NOT NULL DEFAULT '{}');

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
, mcp_context TEXT NOT NULL DEFAULT '{}');

CREATE TABLE workflow_screens (
  workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  screen_id   INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  x           REAL NOT NULL DEFAULT 0,
  y           REAL NOT NULL DEFAULT 0,
  collapsed   INTEGER NOT NULL DEFAULT 0, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}',
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
, project_id INTEGER NOT NULL DEFAULT 1, visibility TEXT NOT NULL DEFAULT 'public', creator_id INTEGER NOT NULL DEFAULT 1, cloned_from_id INTEGER, root_item_id INTEGER, root_owner_id INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, mcp_context TEXT NOT NULL DEFAULT '{}', uid TEXT, content_hash TEXT);

CREATE INDEX idx_animations_node ON animations(node_id);

CREATE INDEX idx_api_keys_prefix ON api_keys(prefix);

CREATE INDEX idx_api_keys_project ON api_keys(project_id, revoked_at);

CREATE INDEX idx_api_keys_user ON api_keys(user_id, revoked_at);

CREATE INDEX idx_buttons_category ON buttons(category);

CREATE INDEX idx_changes_owner ON change_requests(owner_id, status);

CREATE INDEX idx_changes_project ON change_requests(project_id, status);

CREATE INDEX idx_changes_target ON change_requests(target_type, target_id);

CREATE INDEX idx_changeset_ops_cr ON changeset_ops(change_request_id);

CREATE INDEX idx_changesets_project ON changesets(project_id, status);

CREATE INDEX idx_code_bindings_file ON code_bindings(project_id, file_path);

CREATE INDEX idx_icons_category ON icons(category);

CREATE INDEX idx_item_requests_project ON item_requests(project_id, status);

CREATE INDEX idx_items_category ON "elements"(category);

CREATE INDEX idx_links_workflow ON workflow_links(workflow_id);

CREATE INDEX idx_mcp_audit_key ON mcp_audit_log(api_key_id, created_at);

CREATE INDEX idx_mcp_audit_project ON mcp_audit_log(project_id, created_at);

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

CREATE UNIQUE INDEX ux_buttons_project_key ON "buttons"(project_id, key);

CREATE UNIQUE INDEX ux_buttons_uid ON "buttons"(uid);

CREATE UNIQUE INDEX ux_elements_project_key ON "elements"(project_id, key);

CREATE UNIQUE INDEX ux_elements_uid ON "elements"(uid);

CREATE UNIQUE INDEX ux_icons_project_key ON "icons"(project_id, key);

CREATE UNIQUE INDEX ux_icons_uid ON "icons"(uid);

CREATE UNIQUE INDEX ux_paths_project_key ON "paths"(project_id, key);

CREATE UNIQUE INDEX ux_paths_uid ON "paths"(uid);

CREATE UNIQUE INDEX ux_project_versions_head ON project_versions(project_id) WHERE status = 'approved';

CREATE UNIQUE INDEX ux_screens_project_key ON "screens"(project_id, key);

CREATE UNIQUE INDEX ux_screens_uid ON "screens"(uid);

CREATE UNIQUE INDEX ux_template_buttons_uid ON "template_buttons"(uid);

CREATE UNIQUE INDEX ux_template_devices_uid ON "template_devices"(uid);

CREATE UNIQUE INDEX ux_themes_uid ON "themes"(uid);

CREATE UNIQUE INDEX ux_workflows_project_key ON "workflows"(project_id, key);

CREATE UNIQUE INDEX ux_workflows_uid ON "workflows"(uid);

CREATE TRIGGER trg_mcp_animations_hash_del AFTER DELETE ON animations BEGIN
  UPDATE paths SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'path');
  UPDATE icons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'icon');
  UPDATE buttons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'button');
  UPDATE elements SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'element');
  UPDATE screens SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'screen');
END;

CREATE TRIGGER trg_mcp_animations_hash_ins AFTER INSERT ON animations BEGIN
  UPDATE paths SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'path');
  UPDATE icons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'icon');
  UPDATE buttons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'button');
  UPDATE elements SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'element');
  UPDATE screens SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'screen');
END;

CREATE TRIGGER trg_mcp_animations_hash_upd AFTER UPDATE ON animations BEGIN
  UPDATE paths SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'path');
  UPDATE icons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'icon');
  UPDATE buttons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'button');
  UPDATE elements SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'element');
  UPDATE screens SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = OLD.node_id AND owner_type = 'screen');
  UPDATE paths SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'path');
  UPDATE icons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'icon');
  UPDATE buttons SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'button');
  UPDATE elements SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'element');
  UPDATE screens SET content_hash = NULL WHERE id = (SELECT owner_id FROM nodes WHERE id = NEW.node_id AND owner_type = 'screen');
END;

CREATE TRIGGER trg_mcp_buttons_hash_row AFTER UPDATE ON "buttons"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "buttons" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_buttons_uid_insert AFTER INSERT ON "buttons"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "buttons" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_buttons_uid_keep AFTER UPDATE OF uid ON "buttons"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "buttons" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_elements_hash_row AFTER UPDATE ON "elements"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "elements" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_elements_uid_insert AFTER INSERT ON "elements"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "elements" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_elements_uid_keep AFTER UPDATE OF uid ON "elements"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "elements" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_icons_hash_row AFTER UPDATE ON "icons"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "icons" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_icons_uid_insert AFTER INSERT ON "icons"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "icons" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_icons_uid_keep AFTER UPDATE OF uid ON "icons"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "icons" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_menu_items_hash_del AFTER DELETE ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id = OLD.button_id; END;

CREATE TRIGGER trg_mcp_menu_items_hash_ins AFTER INSERT ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id = NEW.button_id; END;

CREATE TRIGGER trg_mcp_menu_items_hash_upd AFTER UPDATE ON menu_items BEGIN UPDATE buttons SET content_hash = NULL WHERE id IN (OLD.button_id, NEW.button_id); END;

CREATE TRIGGER trg_mcp_nodes_hash_del AFTER DELETE ON nodes BEGIN
  UPDATE paths SET content_hash = NULL WHERE OLD.owner_type = 'path' AND id = OLD.owner_id;
  UPDATE icons SET content_hash = NULL WHERE OLD.owner_type = 'icon' AND id = OLD.owner_id;
  UPDATE buttons SET content_hash = NULL WHERE OLD.owner_type = 'button' AND id = OLD.owner_id;
  UPDATE elements SET content_hash = NULL WHERE OLD.owner_type = 'element' AND id = OLD.owner_id;
  UPDATE screens SET content_hash = NULL WHERE OLD.owner_type = 'screen' AND id = OLD.owner_id;
  UPDATE workflows SET content_hash = NULL WHERE OLD.owner_type = 'screen'
    AND id IN (SELECT workflow_id FROM workflow_links WHERE from_screen_id = OLD.owner_id AND from_node_id IS NOT NULL);
END;

CREATE TRIGGER trg_mcp_nodes_hash_ins AFTER INSERT ON nodes BEGIN
  UPDATE paths SET content_hash = NULL WHERE NEW.owner_type = 'path' AND id = NEW.owner_id;
  UPDATE icons SET content_hash = NULL WHERE NEW.owner_type = 'icon' AND id = NEW.owner_id;
  UPDATE buttons SET content_hash = NULL WHERE NEW.owner_type = 'button' AND id = NEW.owner_id;
  UPDATE elements SET content_hash = NULL WHERE NEW.owner_type = 'element' AND id = NEW.owner_id;
  UPDATE screens SET content_hash = NULL WHERE NEW.owner_type = 'screen' AND id = NEW.owner_id;
  UPDATE workflows SET content_hash = NULL WHERE NEW.owner_type = 'screen'
    AND id IN (SELECT workflow_id FROM workflow_links WHERE from_screen_id = NEW.owner_id AND from_node_id IS NOT NULL);
END;

CREATE TRIGGER trg_mcp_nodes_hash_upd AFTER UPDATE ON nodes BEGIN
  UPDATE paths SET content_hash = NULL WHERE OLD.owner_type = 'path' AND id = OLD.owner_id;
  UPDATE icons SET content_hash = NULL WHERE OLD.owner_type = 'icon' AND id = OLD.owner_id;
  UPDATE buttons SET content_hash = NULL WHERE OLD.owner_type = 'button' AND id = OLD.owner_id;
  UPDATE elements SET content_hash = NULL WHERE OLD.owner_type = 'element' AND id = OLD.owner_id;
  UPDATE screens SET content_hash = NULL WHERE OLD.owner_type = 'screen' AND id = OLD.owner_id;
  UPDATE paths SET content_hash = NULL WHERE NEW.owner_type = 'path' AND id = NEW.owner_id;
  UPDATE icons SET content_hash = NULL WHERE NEW.owner_type = 'icon' AND id = NEW.owner_id;
  UPDATE buttons SET content_hash = NULL WHERE NEW.owner_type = 'button' AND id = NEW.owner_id;
  UPDATE elements SET content_hash = NULL WHERE NEW.owner_type = 'element' AND id = NEW.owner_id;
  UPDATE screens SET content_hash = NULL WHERE NEW.owner_type = 'screen' AND id = NEW.owner_id;
  UPDATE workflows SET content_hash = NULL WHERE NEW.owner_type = 'screen'
    AND id IN (SELECT workflow_id FROM workflow_links WHERE from_screen_id = NEW.owner_id AND from_node_id IS NOT NULL);
END;

CREATE TRIGGER trg_mcp_paths_hash_row AFTER UPDATE ON "paths"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "paths" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_paths_uid_insert AFTER INSERT ON "paths"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "paths" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_paths_uid_keep AFTER UPDATE OF uid ON "paths"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "paths" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_screens_hash_row AFTER UPDATE ON "screens"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "screens" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_screens_uid_insert AFTER INSERT ON "screens"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "screens" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_screens_uid_keep AFTER UPDATE OF uid ON "screens"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "screens" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_buttons_hash_row AFTER UPDATE ON "template_buttons"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "template_buttons" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_buttons_uid_insert AFTER INSERT ON "template_buttons"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "template_buttons" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_buttons_uid_keep AFTER UPDATE OF uid ON "template_buttons"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "template_buttons" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_devices_hash_row AFTER UPDATE ON "template_devices"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "template_devices" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_devices_uid_insert AFTER INSERT ON "template_devices"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "template_devices" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_template_devices_uid_keep AFTER UPDATE OF uid ON "template_devices"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "template_devices" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_themes_hash_row AFTER UPDATE ON "themes"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "themes" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_themes_uid_insert AFTER INSERT ON "themes"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "themes" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_themes_uid_keep AFTER UPDATE OF uid ON "themes"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "themes" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_workflow_links_hash_del AFTER DELETE ON workflow_links BEGIN UPDATE workflows SET content_hash = NULL WHERE id = OLD.workflow_id; END;

CREATE TRIGGER trg_mcp_workflow_links_hash_ins AFTER INSERT ON workflow_links BEGIN UPDATE workflows SET content_hash = NULL WHERE id = NEW.workflow_id; END;

CREATE TRIGGER trg_mcp_workflow_links_hash_upd AFTER UPDATE ON workflow_links BEGIN UPDATE workflows SET content_hash = NULL WHERE id IN (OLD.workflow_id, NEW.workflow_id); END;

CREATE TRIGGER trg_mcp_workflow_screens_hash_del AFTER DELETE ON workflow_screens BEGIN UPDATE workflows SET content_hash = NULL WHERE id = OLD.workflow_id; END;

CREATE TRIGGER trg_mcp_workflow_screens_hash_ins AFTER INSERT ON workflow_screens BEGIN UPDATE workflows SET content_hash = NULL WHERE id = NEW.workflow_id; END;

CREATE TRIGGER trg_mcp_workflow_screens_hash_upd AFTER UPDATE ON workflow_screens BEGIN UPDATE workflows SET content_hash = NULL WHERE id IN (OLD.workflow_id, NEW.workflow_id); END;

CREATE TRIGGER trg_mcp_workflows_hash_row AFTER UPDATE ON "workflows"
WHEN NEW.content_hash IS NOT NULL AND NEW.content_hash IS OLD.content_hash
BEGIN UPDATE "workflows" SET content_hash = NULL WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_workflows_uid_insert AFTER INSERT ON "workflows"
WHEN NEW.uid IS NULL OR NEW.uid = ''
BEGIN UPDATE "workflows" SET uid = lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
) WHERE rowid = NEW.rowid; END;

CREATE TRIGGER trg_mcp_workflows_uid_keep AFTER UPDATE OF uid ON "workflows"
WHEN (NEW.uid IS NULL OR NEW.uid = '') AND OLD.uid IS NOT NULL AND OLD.uid <> ''
BEGIN UPDATE "workflows" SET uid = OLD.uid WHERE rowid = NEW.rowid; END;
