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
