/**
 * Composition root: the only place that knows every concrete class. Wires infrastructure into use cases.
 * Dependency rule: domain <- application <- (infrastructure, interfaces). Nothing in the inner layers imports outward.
 */
import { openDatabase, inTransaction } from './infrastructure/sqlite/database.js';
import { DesignRepository } from './infrastructure/sqlite/repositories/design-repository.js';
import { NodeRepository, AnimationRepository } from './infrastructure/sqlite/repositories/node-repository.js';
import { MenuRepository } from './infrastructure/sqlite/repositories/menu-repository.js';
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
import { svgTextToNodes } from './infrastructure/import/svg-to-nodes.js';
import { FsBundleWriter } from './infrastructure/export/fs-bundle-writer.js';
import { LegacyImporter } from './infrastructure/import/legacy-importer.js';

export function buildContainer({ dbFile, dbPath, syncEnabled, log = () => {} } = {}) {
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
  const designs = Object.fromEntries(OWNER_TYPES.map(t => [t, new DesignRepository(db, t, pgSync)]));
  const themeRepo = new ThemeRepository(db, pgSync);
  const workflowRepo = new WorkflowRepository(db, pgSync);
  const settingsRepo = new SettingsRepository(db, pgSync);

  const auth = new AuthService({ users: userRepo, transaction });
  const projects = new ProjectService({ projects: projectRepo, users: userRepo, auth, changes: changeRepo, db, designs, nodes, workflows: workflowRepo, transaction });
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
    users: userRepo,
    collaboration,
    trash: trashRepo,
    transaction
  });
  collaboration.services = services;
  collaboration.workflows = workflows;

  const trash = new TrashService({
    trash: trashRepo,
    services,
    workflows,
    designs,
    nodes,
    animations,
    menus,
    auth,
    transaction
  });
  const templates = new TemplateService({ templates: templateRepo, services, transaction });
  const translations = new TranslationService({ translations: translationRepo });
  const settings = new SettingsService({ settings: settingsRepo });
  const menuService = new MenuService({ buttons: designs.button, icons: designs.icon, screens: designs.screen, elements: designs.element, menus });
  const render = new RenderService({ designs, nodes, animations, themes: themeRepo, menus });
  const libraryTransfer = new LibraryTransferService({
    services,
    workflows,
    menus,
    projects,
    auth,
    render,
    parseSvg: svgTextToNodes,
    transaction
  });
  projects.services = services;
  projects.libraryTransfer = libraryTransfer;
  const exporter = new ExportService({ services, workflows, themes, menus: menuService, render, settings, writer: new FsBundleWriter() });
  const svgImport = new SvgImportService({ services, parseSvg: svgTextToNodes, transaction });
  const importer = new LegacyImporter({ themes, services, menus: menuService, workflows, log });

  // Ensure all built-in themes (all 15 design style families in dark & light modes) exist and are up to date
  themes.seedBuiltins();

  return {
    db,
    pgSync,
    auth,
    users: userRepo,
    projects,
    collaboration,
    collab: collaboration,
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
    render,
    exporter,
    svgImport,
    importer,
    close: () => db.close()
  };
}
