/**
 * Composition root: the only place that knows every concrete class. Wires infrastructure into use cases.
 * Dependency rule: domain <- application <- (infrastructure, interfaces). Nothing in the inner layers imports outward.
 */
import { openDatabase, inTransaction } from './infrastructure/sqlite/database.js';
import { DesignRepository } from './infrastructure/sqlite/repositories/design-repository.js';
import { NodeRepository, AnimationRepository } from './infrastructure/sqlite/repositories/node-repository.js';
import { MenuRepository } from './infrastructure/sqlite/repositories/menu-repository.js';
import { ElementScriptRepository } from './infrastructure/sqlite/repositories/element-script-repository.js';
import { ThemeRepository, WorkflowRepository, SettingsRepository } from './infrastructure/sqlite/repositories/theme-workflow-settings-repositories.js';
import {
  UserRepository,
  ProjectRepository,
  ChangeRequestRepository,
  TemplateRepository,
  TranslationRepository,
  TrashRepository
} from './infrastructure/sqlite/repositories/user-project-collab-repositories.js';
import { PostgresSyncService } from './infrastructure/postgres/pg-sync-service.js';
import { OWNER_TYPES } from './domain/entities.js';
import { DesignService } from './application/design-service.js';
import { RenderService } from './application/render-service.js';
import { ThemeService } from './application/theme-service.js';
import { WorkflowService } from './application/workflow-service.js';
import { SettingsService } from './application/settings-service.js';
import { MenuService } from './application/menu-service.js';
import { ElementScriptService } from './application/element-script-service.js';
import { ProfileService } from './application/profile-service.js';
import { ProfileRepository } from './infrastructure/sqlite/repositories/profile-repository.js';
import { IconCatalogService } from './application/icon-catalog-service.js';
import { installIconVersion } from './infrastructure/sqlite/icon-version.js';
import {
  AuthService,
  ProjectService,
  CollaborationService,
  TemplateService,
  TranslationService,
  TrashService,
  LibraryTransferService
} from './application/user-project-collab-service.js';
import { ExportService } from './application/export/export-service.js';
import { SvgImportService } from './application/svg-import-service.js';
import { OnlineIconService } from './application/online-icon-service.js';
import { svgTextToNodes } from './infrastructure/import/svg-to-nodes.js';
import { FsBundleWriter } from './infrastructure/export/fs-bundle-writer.js';
import { LegacyImporter } from './infrastructure/import/legacy-importer.js';
import { PAGE_BUILDER_ELEMENTS } from './infrastructure/import/elements-catalog.js';
import { buildMcpModule } from './mcp/composition.js';
import { publicUserId } from './domain/system-users.js';

/**
 * Built-in presets added after a database was first seeded reach it once (ledger row in the local `mcp_migrations`
 * table, so a preset the user later deletes is not re-added). Fresh, empty databases get them from the full import.
 */
const NEW_PRESETS = [
  { id: 'preset-001-html-repeater', keys: ['html-repeater'] },
  // one public `button-frame-<style>` template per BUTTON_STYLES entry (circle / square already existed)
  { id: 'preset-002-button-style-frames', run: importer => importer.ensureButtonStyleFrames() },
  // the 40 design-style DEFAULT_BUTTON_TEMPLATES as public `templates` buttons, right below the frames
  { id: 'preset-003-design-button-templates', run: importer => importer.ensureDesignButtonTemplates() },
  // hub menu buttons (3-button scrolling bar, horizontal + vertical) and their element presets
  { id: 'preset-004-hub-menus', run: importer => importer.ensureHubMenus() },
  // vertical tabs (the horizontal html-tabs already exists)
  { id: 'preset-005-tabs-vertical', keys: ['html-tabs-vertical'] },
  // page-builder blocks (hero, CTA, pricing, testimonial, countdown, gallery, video, map, social ...)
  { id: 'preset-006-page-builder-blocks', keys: PAGE_BUILDER_ELEMENTS.map(e => e.key) },
  // merge legacy split horizontal + vertical hub menus into unified `hub-menu` + `html-hub-menu`
  { id: 'preset-007-unified-hub-menu', run: importer => importer.ensureHubMenus() }
];
function seedNewPresets(db, services, importer) {
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mcp_migrations'").get()) return;
    if (!services.element.list().length) return;
    const done = new Set(db.prepare('SELECT id FROM mcp_migrations').all().map(r => r.id));
    for (const p of NEW_PRESETS) {
      if (done.has(p.id)) continue;
      if (p.run) p.run(importer); else importer.ensurePresets(p.keys);
      db.prepare('INSERT OR IGNORE INTO mcp_migrations (id) VALUES (?)').run(p.id);
    }
  } catch (e) { console.warn('preset seeding skipped:', e.message); }
}

export function buildContainer({ dbFile, dbPath, syncEnabled, log = () => {}, seed = true } = {}) {
  const resolvedDbFile = dbFile || dbPath || './data/designer.db';
  const db = openDatabase(resolvedDbFile);
  const transaction = fn => inTransaction(db, fn);
  const isMemory = resolvedDbFile === ':memory:';
  const pgSync = new PostgresSyncService({
    db,
    log,
    enabled: syncEnabled !== undefined ? Boolean(syncEnabled) : !isMemory
  });

  const userRepo = new UserRepository(db, pgSync);
  const projectRepo = new ProjectRepository(db, pgSync);
  const changeRepo = new ChangeRequestRepository(db, pgSync);
  const templateRepo = new TemplateRepository(db, pgSync);
  const translationRepo = new TranslationRepository(db, pgSync);
  const trashRepo = new TrashRepository(db, pgSync);

  const nodes = new NodeRepository(db, pgSync);
  const animations = new AnimationRepository(db, pgSync);
  const menus = new MenuRepository(db);
  const elementScriptRepo = new ElementScriptRepository(db);
  const designs = Object.fromEntries(OWNER_TYPES.map(t => [t, new DesignRepository(db, t, pgSync)]));
  const themeRepo = new ThemeRepository(db, pgSync);
  const workflowRepo = new WorkflowRepository(db, pgSync);
  const settingsRepo = new SettingsRepository(db, pgSync);

  // `seed: false` builds the services without the start-up writes (default accounts, default project, templates,
  // presets, themes). Migrations and the MCP schema still run when the database is opened.
  const auth = new AuthService({ users: userRepo, transaction });
  if (seed) auth.seed();
  const projects = new ProjectService({ projects: projectRepo, users: userRepo, auth, changes: changeRepo, designs, nodes, workflows: workflowRepo, transaction });
  if (seed) projects.seed();
  const collaboration = new CollaborationService({
    changes: changeRepo,
    projects,
    users: userRepo,
    auth,
    services: {},
    workflows: null,
    transaction
  });

  /** One DesignService per library type: services.path / icon / button / element / screen. */
  const services = Object.fromEntries(
    OWNER_TYPES.map(t => [
      t,
      new DesignService({
        ownerType: t,
        designs: designs[t],
        nodes,
        animations,
        menus,
        elementScripts: t === 'element' ? elementScriptRepo : null,
        users: userRepo,
        collaboration,
        trash: trashRepo,
        workflows: workflowRepo,
        transaction
      })
    ])
  );
  const themes = new ThemeService({ themes: themeRepo });
  const workflows = new WorkflowService({
    workflows: workflowRepo,
    screens: designs.screen,
    nodes,
    menus,
    users: userRepo,
    collaboration,
    trash: trashRepo,
    transaction
  });
  collaboration.bind({ services, workflows });

  const trash = new TrashService({
    trash: trashRepo,
    services,
    workflows,
    designs,
    nodes,
    animations,
    menus,
    elementScripts: elementScriptRepo,
    auth,
    transaction
  });
  const templates = new TemplateService({ templates: templateRepo, services, transaction });
  if (seed) templates.seed();
  const translations = new TranslationService({ translations: translationRepo });
  const settings = new SettingsService({ settings: settingsRepo });
  const menuService = new MenuService({ buttons: designs.button, icons: designs.icon, screens: designs.screen, elements: designs.element, menus });
  const render = new RenderService({ designs, nodes, animations, themes: themeRepo, menus });
  const libraryTransfer = new LibraryTransferService({
    services,
    workflows,
    menus,
    elementScripts: elementScriptRepo,
    projects,
    auth,
    render,
    parseSvg: svgTextToNodes,
    transaction
  });
  projects.bind({ services, libraryTransfer });
  collaboration.bind({ libraryTransfer });
  const exporter = new ExportService({ services, workflows, themes, menus: menuService, elementScripts: elementScriptRepo, render, settings, templates, writer: new FsBundleWriter() });
  const elementScripts = new ElementScriptService({
    scripts: elementScriptRepo,
    elements: services.element,
    themes,
    settings,
    exporter
  });
  const svgImport = new SvgImportService({ services, parseSvg: svgTextToNodes, transaction });
  const onlineIcons = new OnlineIconService({ services, transaction });
  // built-in items are public-library items: owned by the immutable `public` system user (created by applyMcpSchema)
  const importer = new LegacyImporter({ db, themes, services, menus: menuService, workflows, log, publicOwnerId: () => publicUserId(db) });
  if (seed) seedNewPresets(db, services, importer);
  // MCP layer (src/mcp): API keys, schema registry, content hashes, and in-process backend API bridge
  let container = null;
  const mcp = buildMcpModule({
    getContainer: () => container,
    projectService: projects,
    db, dbFile: resolvedDbFile, projects: projectRepo, users: userRepo, auth, transaction,
    services, workflows, exporter, settings, collaboration, elementScripts, parseSvg: svgTextToNodes,
    allowedOrigins: [process.env.MCP_ALLOWED_ORIGINS, process.env.ALLOWED_ORIGINS, process.env.PUBLIC_BASE_URL].flatMap(v => String(v || '').split(',')).map(s => s.trim()).filter(Boolean)
  });

  // Ensure all built-in themes (all 15 design style families in dark & light modes) exist and are up to date
  if (seed) themes.seedBuiltins();

  const profile = new ProfileService({ users: userRepo, profiles: new ProfileRepository(db), auth, transaction });
  // large icon libraries (pack imports): summary lists, paged search, sprites by id; version bumps on icon changes
  const iconCatalog = new IconCatalogService({ designs: designs.icon, nodes, render, version: installIconVersion(db) });

  container = {
    db,
    pgSync,
    nodes,
    auth,
    profile,
    users: userRepo,
    projects,
    collaboration,
    trash,
    libraryTransfer,
    templates,
    translations,
    animationList: () => animations.listAll(),
    services,
    ...services,
    themes,
    workflows,
    settings,
    menus: menuService,
    elementScripts,
    render,
    iconCatalog,
    exporter,
    svgImport,
    onlineIcons,
    importer,
    mcp,
    /** Id of the immutable `public` system user that owns the public library. */
    publicUserId: () => publicUserId(db),
    close: () => db.close()
  };
  return container;
}
