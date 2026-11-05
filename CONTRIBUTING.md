# Contributing to Kyrpy UI/UX App Designer

Thank you for your interest in contributing to **Kyrpy UI/UX App Designer**! We welcome contributors of all experience levels—from designers contributing new icon/button/element templates to engineers building new vector tools and framework exporters.

## 🧭 Core Architectural Principles

1. **Zero External Runtime Dependencies**:
   - The project runs natively on **Node.js 22+** using built-in modules (`node:sqlite`, `node:http`, `node:crypto`, `node:test`) and standard browser ES Modules. Do not add third-party `npm` runtime dependencies unless discussed in an issue first.
2. **Strict Clean Architecture**:
   - `src/domain/` contains pure, isomorphic functions (SVG rendering, geometry, Bezier path math, theme token resolution, menu layout) shared verbatim between the Node server and the browser client (`/domain/*`). Never import Node-only APIs inside `src/domain/`.
   - `src/application/` orchestrates domain rules through repository interfaces.
   - `src/infrastructure/` implements SQLite persistence (`src/infrastructure/sqlite/`), optional PostgreSQL sync (`src/infrastructure/postgres/`), and file/font importers.
   - `src/interfaces/` hosts the REST API (`src/interfaces/http/`) and the browser UI (`src/interfaces/web/`).
3. **Offline-First by Default**:
   - Every feature must work 100% locally with SQLite (`PG_SYNC_ENABLED=false`) and gracefully queue mutations in `sync_outbox` for optional PostgreSQL synchronization.
4. **Zero Secrets in Git**:
   - Never commit `.env`, `credentials.env`, real passwords, API keys, or private hostnames. Always use `.env.example` with placeholders.

## 🚀 Local Development Workflow

1. Run the one-click installer in local mode:
   ```bash
   ./install.sh --local-only
   ```
2. Open `http://127.0.0.1:5180` in your browser.
3. Run the automated test suite after making changes:
   ```bash
   cd src && npm test
   ```
4. Open a Pull Request with a clear summary of your changes and test coverage!
