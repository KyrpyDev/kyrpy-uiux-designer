-- =============================================================================
-- Kyrpy UI/UX Designer — SQLite Sample Data Dump (public system user library only)
-- =============================================================================
PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;
-- Table: users (4 rows)
INSERT OR REPLACE INTO "users" ("id", "username", "email", "password_hash", "salt", "display_name", "role", "status", "permissions", "avatar_color", "created_at", "updated_at", "last_login_at", "mcp_context") VALUES (1, 'superadmin', 'superadmin@local.dev', '640551e5d63c811e0da2cba418b75902d28eb8a799693944cdc9bd4d07825f7b4c8c8867e2e838d05a2d4c1e4808e64ba5fd79490163d8a1a79eae2150e8860f', 'superadmin_salt_v1', 'Superadmin', 'superadmin', 'active', '["*"]', '#2e9bff', '2026-11-05 00:00:00', '2026-11-05 00:00:00', NULL, '{}');
INSERT OR REPLACE INTO "users" ("id", "username", "email", "password_hash", "salt", "display_name", "role", "status", "permissions", "avatar_color", "created_at", "updated_at", "last_login_at", "mcp_context") VALUES (2, 'admin', 'admin@local.dev', 'b33ffb8d32f70f4af58c44b26fa71349ff471d722d472252400f7f1cb57d59c08043bcf1483fc4e1b940c2cb2ceb2d55fe44a8eb695e7f434ab5e12ab5d8cd80', 'admin_salt_v1', 'Administrator', 'admin', 'active', '["*"]', '#10b981', '2026-11-05 00:00:00', '2026-11-05 00:00:00', NULL, '{}');
INSERT OR REPLACE INTO "users" ("id", "username", "email", "password_hash", "salt", "display_name", "role", "status", "permissions", "avatar_color", "created_at", "updated_at", "last_login_at", "mcp_context") VALUES (15, 'public', 'public@kyrpy.local', '', '', 'Public Library', 'viewer', 'suspended', '[]', '#8b949e', '2026-11-05 00:00:00', '2026-11-05 00:00:00', NULL, '{}');
INSERT OR REPLACE INTO "users" ("id", "username", "email", "password_hash", "salt", "display_name", "role", "status", "permissions", "avatar_color", "created_at", "updated_at", "last_login_at", "mcp_context") VALUES (16, 'user', 'user@local.dev', 'd49429628906d6190005bcc173a933553713056dc0bb924bb74df1607a11c8087b2eddf90bb17419e9be86272c870795e5b82d7e9184f8aac1bdbfad84bc4980', 'user_salt_v1', 'User', 'designer', 'active', '[]', '#f59e0b', '2026-11-05 00:00:00', '2026-11-05 00:00:00', NULL, '{}');
-- Table: projects (1 rows)
INSERT OR REPLACE INTO "projects" ("id", "key", "name", "label", "description", "owner_id", "visibility", "require_approval", "settings", "created_at", "updated_at", "mcp_context") VALUES (1, 'default-project', 'Default Public Project', 'Default Public Project', 'Default workspace project containing public and shared UI/UX designs.', 1, 'public', 1, '{"buttonStyle":"circle","buttonIconSizePct":95}', '2026-11-05 00:00:00', '2026-11-05 00:00:00', '{}');
-- Table: project_members (2 rows)
INSERT OR REPLACE INTO "project_members" ("id", "project_id", "user_id", "invited_by", "role", "status", "created_at", "updated_at", "mcp_context") VALUES (1, 1, 1, 1, 'owner', 'accepted', '2026-11-05 00:00:00', '2026-11-05 00:00:00', '{}');
INSERT OR REPLACE INTO "project_members" ("id", "project_id", "user_id", "invited_by", "role", "status", "created_at", "updated_at", "mcp_context") VALUES (2, 1, 2, 1, 'admin', 'accepted', '2026-11-05 00:00:00', '2026-11-05 00:00:00', '{}');
-- Table: themes (0 rows)
-- Table: paths (0 rows)
-- Table: icons (0 rows)
-- Table: buttons (0 rows)
-- Table: elements (0 rows)
-- Table: screens (0 rows)
-- Table: nodes (0 rows)
-- Table: animations (0 rows)
-- Table: menu_items (0 rows)
-- Table: workflows (0 rows)
-- Table: workflow_screens (0 rows)
-- Table: workflow_links (0 rows)
-- Table: change_requests (0 rows)
-- Table: template_devices (0 rows)
-- Table: template_buttons (0 rows)
-- Table: translations (0 rows)
-- Table: settings (0 rows)
-- Table: trash_items (0 rows)
COMMIT;
PRAGMA foreign_keys = ON;
