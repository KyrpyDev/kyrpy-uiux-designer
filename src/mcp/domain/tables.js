/** Table groups the MCP layer works with (pure constants). */

/** Library design tables that own a node tree, keyed by `nodes.owner_type`. */
export const DESIGN_TABLES = { path: 'paths', icon: 'icons', button: 'buttons', element: 'elements', screen: 'screens' };

/** Tables whose rows carry a project-scoped `key` (`project_id` + `key`). */
export const PROJECT_KEY_TABLES = [...Object.values(DESIGN_TABLES), 'workflows'];

/** Tables whose rows get a stable `uid` and a cached `content_hash`. */
export const IDENTITY_TABLES = [...PROJECT_KEY_TABLES, 'themes', 'template_buttons', 'template_devices'];

/** Item type → table, for every identity table. */
export const TYPE_TO_TABLE = {
  ...DESIGN_TABLES,
  workflow: 'workflows',
  theme: 'themes',
  template_button: 'template_buttons',
  template_device: 'template_devices'
};
export const TABLE_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_TABLE).map(([t, tbl]) => [tbl, t]));

/** Tables created by the MCP layer itself. */
export const MCP_TABLES = ['schema_registry', 'mcp_migrations', 'api_keys', 'mcp_audit_log', 'ai_artifacts', 'project_versions', 'changesets', 'changeset_ops', 'item_requests', 'code_bindings'];
