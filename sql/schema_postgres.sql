-- Kyrpy UI/UX Designer — PostgreSQL Schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'designer',
  status TEXT NOT NULL DEFAULT 'active',
  permissions TEXT NOT NULL DEFAULT '[]',
  avatar_color TEXT NOT NULL DEFAULT '#2e9bff',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  last_login_at TEXT
);
-- exactly one superadmin (created only when the remote has at most one, so an old copy never blocks the schema script)
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM users WHERE role = 'superadmin') <= 1 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ux_users_single_superadmin ON users(role) WHERE role = 'superadmin';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  require_approval INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_members (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  invited_by INTEGER,
  role TEXT NOT NULL DEFAULT 'editor',
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  tokens TEXT NOT NULL,
  surfaces TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS paths (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 24,
  height REAL NOT NULL DEFAULT 24,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS icons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 24,
  height REAL NOT NULL DEFAULT 24,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS buttons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 64,
  height REAL NOT NULL DEFAULT 64,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS elements (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 240,
  height REAL NOT NULL DEFAULT 64,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS screens (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  tags TEXT NOT NULL DEFAULT '[]',
  width REAL NOT NULL DEFAULT 390,
  height REAL NOT NULL DEFAULT 844,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nodes (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  parent_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'shape',
  tag TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT,
  ref_type TEXT,
  ref_id INTEGER,
  rotation REAL NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL DEFAULT '',
  attrs TEXT NOT NULL DEFAULT '{}',
  description_dev TEXT NOT NULL DEFAULT '',
  on_click TEXT NOT NULL DEFAULT '',
  events TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS animations (
  id INTEGER PRIMARY KEY,
  node_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER NOT NULL DEFAULT 1000,
  delay_ms INTEGER NOT NULL DEFAULT 0,
  easing TEXT NOT NULL DEFAULT 'ease-in-out',
  iterations TEXT NOT NULL DEFAULT 'infinite',
  direction TEXT NOT NULL DEFAULT 'alternate',
  fill_mode TEXT NOT NULL DEFAULT 'both',
  trigger TEXT NOT NULL DEFAULT 'load',
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY,
  button_id INTEGER NOT NULL,
  parent_id INTEGER,
  ord INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  icon_id INTEGER,
  action TEXT NOT NULL DEFAULT '',
  target_screen_id INTEGER,
  target_element_id INTEGER,
  visible INTEGER NOT NULL DEFAULT 1,
  description_dev TEXT NOT NULL DEFAULT ''
);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS target_element_id INTEGER;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS ref_button_id INTEGER;

CREATE TABLE IF NOT EXISTS workflows (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  creator_id INTEGER NOT NULL DEFAULT 1,
  cloned_from_id INTEGER,
  root_item_id INTEGER,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS workflow_screens (
  workflow_id INTEGER NOT NULL,
  screen_id INTEGER NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  collapsed INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (workflow_id, screen_id)
);

CREATE TABLE IF NOT EXISTS workflow_links (
  id INTEGER PRIMARY KEY,
  workflow_id INTEGER NOT NULL,
  from_screen_id INTEGER NOT NULL,
  from_node_id INTEGER,
  to_screen_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  description_dev TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'curved',
  trigger TEXT NOT NULL DEFAULT 'tap'
);

CREATE TABLE IF NOT EXISTS change_requests (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL DEFAULT 1,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  target_key TEXT NOT NULL DEFAULT '',
  target_name TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL DEFAULT 1,
  owner_id INTEGER NOT NULL DEFAULT 1,
  action TEXT NOT NULL DEFAULT 'update',
  summary TEXT NOT NULL DEFAULT '',
  before_snapshot TEXT NOT NULL DEFAULT '{}',
  after_snapshot TEXT NOT NULL DEFAULT '{}',
  diff_summary TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_id INTEGER,
  review_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS template_devices (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'mobile',
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  corner_radius INTEGER NOT NULL DEFAULT 44,
  grid INTEGER NOT NULL DEFAULT 24,
  locked INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS template_buttons (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'standard',
  shape TEXT NOT NULL DEFAULT 'pill',
  width INTEGER NOT NULL DEFAULT 160,
  height INTEGER NOT NULL DEFAULT 48,
  rx_ratio REAL NOT NULL DEFAULT 0.3,
  margin_ratio REAL NOT NULL DEFAULT 0.15,
  stroke_ratio REAL NOT NULL DEFAULT 1.0,
  role TEXT NOT NULL DEFAULT 'button',
  hover_effect TEXT NOT NULL DEFAULT 'glow',
  indicator_effect TEXT NOT NULL DEFAULT 'none',
  nodes_template TEXT NOT NULL DEFAULT '[]',
  meta TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  lang_code TEXT NOT NULL,
  translated_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  UNIQUE (table_name, record_id, field_name, lang_code)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trash_items (
  id INTEGER PRIMARY KEY,
  item_type TEXT NOT NULL,
  original_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  item_name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  project_id INTEGER NOT NULL DEFAULT 1,
  visibility TEXT NOT NULL DEFAULT 'public',
  builtin INTEGER NOT NULL DEFAULT 0,
  creator_id INTEGER NOT NULL DEFAULT 1,
  root_owner_id INTEGER NOT NULL DEFAULT 1,
  deleted_by INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '{}'
);

-- ===== kyrpy-uiux-mcp (M0): schema_registry, mcp_context on every table, uid + content_hash =====
CREATE TABLE IF NOT EXISTS schema_registry (
  id          INTEGER PRIMARY KEY,
  table_name  TEXT NOT NULL,
  column_name TEXT NOT NULL DEFAULT '',
  mcp_context TEXT NOT NULL DEFAULT '{}',
  version     INTEGER NOT NULL DEFAULT 1,
  source      TEXT NOT NULL DEFAULT 'seed',
  updated_at  TEXT NOT NULL DEFAULT '',
  UNIQUE (table_name, column_name)
);
ALTER TABLE IF EXISTS "users" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "projects" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "project_members" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "themes" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "paths" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "icons" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "buttons" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "elements" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "screens" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "nodes" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "animations" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "menu_items" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "workflows" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "workflow_screens" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "workflow_links" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "change_requests" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "template_devices" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "template_buttons" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "translations" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "settings" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "trash_items" ADD COLUMN IF NOT EXISTS mcp_context TEXT NOT NULL DEFAULT '{}';
ALTER TABLE IF EXISTS "paths" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "paths" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_paths_uid ON "paths"(uid);
ALTER TABLE IF EXISTS "icons" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "icons" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_icons_uid ON "icons"(uid);
ALTER TABLE IF EXISTS "buttons" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "buttons" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_buttons_uid ON "buttons"(uid);
ALTER TABLE IF EXISTS "elements" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "elements" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_elements_uid ON "elements"(uid);
ALTER TABLE IF EXISTS "screens" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "screens" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_screens_uid ON "screens"(uid);
ALTER TABLE IF EXISTS "workflows" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "workflows" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflows_uid ON "workflows"(uid);
ALTER TABLE IF EXISTS "themes" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "themes" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_themes_uid ON "themes"(uid);
ALTER TABLE IF EXISTS "template_buttons" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "template_buttons" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_template_buttons_uid ON "template_buttons"(uid);
ALTER TABLE IF EXISTS "template_devices" ADD COLUMN IF NOT EXISTS uid TEXT;
ALTER TABLE IF EXISTS "template_devices" ADD COLUMN IF NOT EXISTS content_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_template_devices_uid ON "template_devices"(uid);
-- ===== per-project keys: drop the global UNIQUE(key), keys are unique per (project_id, key) =====
ALTER TABLE IF EXISTS "paths" DROP CONSTRAINT IF EXISTS "paths_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_paths_project_key ON "paths"(project_id, key);
ALTER TABLE IF EXISTS "icons" DROP CONSTRAINT IF EXISTS "icons_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_icons_project_key ON "icons"(project_id, key);
ALTER TABLE IF EXISTS "buttons" DROP CONSTRAINT IF EXISTS "buttons_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_buttons_project_key ON "buttons"(project_id, key);
ALTER TABLE IF EXISTS "elements" DROP CONSTRAINT IF EXISTS "elements_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_elements_project_key ON "elements"(project_id, key);
ALTER TABLE IF EXISTS "screens" DROP CONSTRAINT IF EXISTS "screens_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_screens_project_key ON "screens"(project_id, key);
ALTER TABLE IF EXISTS "workflows" DROP CONSTRAINT IF EXISTS "workflows_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS ux_workflows_project_key ON "workflows"(project_id, key);
-- ===== kyrpy-uiux-mcp (M1–M6): keys, audit, AI pack, versions, changesets, requests, bindings =====

CREATE TABLE IF NOT EXISTS api_keys (
  id              INTEGER PRIMARY KEY,
  uid             TEXT NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL,
  project_id      INTEGER NOT NULL,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE,
  scopes          TEXT NOT NULL DEFAULT '["read"]',
  expires_at      TEXT,
  last_used_at    TEXT,
  last_used_ip    TEXT,
  revoked_at      TEXT,
  revoked_by      INTEGER,
  rotated_from_id INTEGER,
  rotated_to_id   INTEGER,
  created_at      TEXT NOT NULL DEFAULT '',
  mcp_context     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id, revoked_at);

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id           INTEGER PRIMARY KEY,
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
  created_at   TEXT NOT NULL DEFAULT '',
  mcp_context  TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_key ON mcp_audit_log(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_project ON mcp_audit_log(project_id, created_at);

CREATE TABLE IF NOT EXISTS ai_artifacts (
  id          INTEGER PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,
  scope       TEXT NOT NULL CHECK (scope IN ('global','project')),
  project_id  INTEGER NOT NULL DEFAULT 0,          
  kind        TEXT NOT NULL CHECK (kind IN ('agent','skill','rule','command','readme')),
  platform    TEXT NOT NULL DEFAULT 'any',
  name        TEXT NOT NULL,
  template    TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  checksum    TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'seed' CHECK (source IN ('seed','user')),
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT '',
  mcp_context TEXT NOT NULL DEFAULT '{}',
  UNIQUE (scope, project_id, kind, name, platform)
);

CREATE TABLE IF NOT EXISTS project_versions (
  id              INTEGER PRIMARY KEY,
  uid             TEXT NOT NULL UNIQUE,
  project_id      INTEGER NOT NULL,
  number          INTEGER,                          
  label           TEXT NOT NULL DEFAULT '',
  parent_id       INTEGER,
  source          TEXT NOT NULL CHECK (source IN ('designer','ai-push','import','restore')),
  status          TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','superseded')),
  manifest        TEXT NOT NULL DEFAULT '[]',
  manifest_hash   TEXT NOT NULL DEFAULT '',
  message         TEXT NOT NULL DEFAULT '',
  changeset_id    INTEGER,
  created_by_user INTEGER,
  created_by_key  INTEGER,
  created_at      TEXT NOT NULL DEFAULT '',
  approved_by     INTEGER,
  approved_at     TEXT,
  mcp_context     TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_project_versions_head ON project_versions(project_id) WHERE status = 'approved';
CREATE TABLE IF NOT EXISTS changesets (
  id                INTEGER PRIMARY KEY,
  uid               TEXT NOT NULL UNIQUE,
  project_id        INTEGER NOT NULL,
  base_version_id   INTEGER,
  result_version_id INTEGER,
  api_key_id        INTEGER,
  user_id           INTEGER,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','approved','rejected','conflicted','expired','discarded')),
  summary           TEXT NOT NULL DEFAULT '',
  message           TEXT NOT NULL DEFAULT '',
  client_info       TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL DEFAULT '',
  updated_at        TEXT NOT NULL DEFAULT '',
  submitted_at      TEXT,
  expires_at        TEXT,
  reviewed_by       INTEGER,
  reviewed_at       TEXT,
  review_comment    TEXT NOT NULL DEFAULT '',
  mcp_context       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_changesets_project ON changesets(project_id, status);
CREATE TABLE IF NOT EXISTS changeset_ops (
  id                INTEGER PRIMARY KEY,
  uid               TEXT NOT NULL UNIQUE,
  changeset_id      INTEGER NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_changeset_ops_cr ON changeset_ops(change_request_id);

CREATE TABLE IF NOT EXISTS item_requests (
  id                  INTEGER PRIMARY KEY,
  uid                 TEXT NOT NULL UNIQUE,
  project_id          INTEGER NOT NULL,
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
  created_at          TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL DEFAULT '',
  resolved_at         TEXT,
  mcp_context         TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_item_requests_project ON item_requests(project_id, status);

CREATE TABLE IF NOT EXISTS code_bindings (
  id                   INTEGER PRIMARY KEY,
  uid                  TEXT NOT NULL UNIQUE,
  project_id           INTEGER NOT NULL,
  item_type            TEXT NOT NULL,
  item_uid             TEXT NOT NULL,
  repo_id              TEXT NOT NULL DEFAULT '',
  file_path            TEXT NOT NULL,
  symbol               TEXT NOT NULL DEFAULT '',
  framework            TEXT NOT NULL DEFAULT '',
  binding_hash         TEXT,
  last_seen_version_id INTEGER,
  created_by_key       INTEGER,
  created_at           TEXT NOT NULL DEFAULT '',
  updated_at           TEXT NOT NULL DEFAULT '',
  mcp_context          TEXT NOT NULL DEFAULT '{}',
  UNIQUE (project_id, item_uid, repo_id, file_path, symbol)
);
CREATE INDEX IF NOT EXISTS idx_code_bindings_file ON code_bindings(project_id, file_path);

CREATE TABLE IF NOT EXISTS version_items (
  item_uid     TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  item_type    TEXT NOT NULL,
  project_id   INTEGER NOT NULL,
  item_json    TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT '',
  mcp_context  TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (item_uid, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_version_items_project ON version_items(project_id);
-- ===== account (user-wide) API keys (m11): kind + project_id nullable for kind = 'account' =====
ALTER TABLE IF EXISTS api_keys ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'project';
ALTER TABLE IF EXISTS api_keys ALTER COLUMN project_id DROP NOT NULL;
