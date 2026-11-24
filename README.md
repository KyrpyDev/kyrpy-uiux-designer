# ◈ Kyrpy UI/UX App Designer

[![License: MIT](https://img.shields.io/badge/License-MIT-2e9bff.svg)](./LICENSE)
[![Runtime: Node.js 22+](https://img.shields.io/badge/Node.js-22%2B%20(Zero%20NPM%20Deps)-3fb950.svg)](https://nodejs.org)
[![Database: Offline-First SQLite + PostgreSQL](https://img.shields.io/badge/Database-SQLite%20%2B%20PostgreSQL%20Sync-8a5cf6.svg)](./sql/)
[![Tests: 527 Passing](https://img.shields.io/badge/Tests-527%2F527%20Passing-brightgreen.svg)](./src/tests/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](./CONTRIBUTING.md)

**Kyrpy UI/UX App Designer** is a zero-dependency, offline-first, collaborative vector, interactive UI/UX, and conceptual full-stack architecture studio built for **developers, product designers, and AI coding agents**.

Unlike traditional design tools that trap your layouts in opaque proprietary blobs or export brittle absolute-positioned divs, **Kyrpy UI/UX Designer** models every design as a composable, strictly typed hierarchy—**`Path → Icon → Button → Element → Screen → Workflow ⇄ Conceptual FlowChart`**—backed by an isomorphic SVG/HTML/CSS/TypeScript rendering engine, a **Client-Side Browser AI Studio (`✨ AI Studio`)**, live interactive runtime testing, multi-project access control, root-owner clone lineage tracking, and bi-directional **SQLite ↔ PostgreSQL** synchronization.

---

## ✨ Why Kyrpy UI/UX Designer?

- **⚡ Zero External Dependencies**: Runs out-of-the-box on **Node.js 22+** using built-in `node:sqlite`, `node:http`, `node:crypto`, and `node:test`. No `node_modules` bloat, no native compilation headaches, instant startup (`<150ms`).
- **🔌 True Offline-First Architecture**: Every action saves with `0ms` local latency to SQLite (`src/data/designer.db`). Work 100% offline on a plane or local machine, or connect a remote **PostgreSQL** server via `.env` for atomic multi-user synchronization.
- **🧱 Strict Composable Design Hierarchy**:
  - **Paths (`24×24`)**: Reusable vector path primitives with Bezier vertex editing, Boolean pathfinder ops (`unite`, `subtract`, `intersect`, `exclude`), pen tool, crop, and simplify.
  - **Icons (`24×24`)**: Composed from reusable Path groups + custom vector shapes.
  - **Buttons**: Interactive frames + icons with **per-project Button Style** (`circle` [Default], `pill`, `rounded`, `squircle`, `square`, `sharp`, `outline`, `ghost`), **per-project Button Icon Size Slider (`50–100%`, default `95%`)**, **Press & Slide Joystick actions** (4/8-direction edge paths, customizable `0.5–1.6×` arrow size, scroll repeater targets, and continuous red focus-frame stepping), plus **Radial / Rotating Hub**, **Drawer**, **Vertical/Horizontal Slider**, **2D/3D Carousel Animated Roll**, and **Show Element** menus.
  - **Elements, Scrollable Containers, Fixed-Size Repeaters & Sandboxed Custom JS**: Reusable UI building blocks, **Container** shells (nested mouse-wheel/drag scroll chaining, responsive `fitNodesToScreen`, inner/outer margins, child max-size clamping), **Carousel Containers** (2D/3D horizontal & vertical animated roll), **Multi-Item Repeaters** (fixed Inspector size, drag-to-reorder items, every sub-item shown at least once + seeded random fill), **Image Nodes & Free Stock Photo Library** (Openverse, Pexels, Pixabay), and **Sandboxed Custom ES Module JS + Verified Public JS Libraries** (`element_scripts` with exact `x.y.z` semver, `sha384` Subresource Integrity, and `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">`).
  - **Screens, Per-Instance Customization & 15 Design Style Families (30 Dark & Light Themes)**: Device-framed compositions across **15 design style families** in both **Dark and Light modes**, with **in-place per-instance customization (`✎`)** so editing a placed icon, button, or element modifies only that copy while leaving the library master untouched (`Edit the original` edits the shared item), plus configurable **screen/element transition timings** and auto-closing **`popup`** surfaces.
  - **Workflows**: Versioned (`v1`, `v2`…) and approvable screen-to-screen routing graphs with start-screen tracking, multi-column DAG auto-layout (`distributeLevels`), and live routing simulation.
  - **Conceptual FlowCharts (ComfyUI-Style Frontend, Backend & Business Logic Architect)**: Interactive node-and-wire canvas for conceptual **Screen**, **Step / API / DB**, **Decision / Scenario Router**, **Trigger**, **Subflow**, and **End** nodes—complete with `Home` (`◉`) inputs, diverging action/case sockets, inline **`📝` transition descriptions** and **`◇` decision splitters** over every wire, **per-role / access-level feature variants**, **Reverse Engineering** (`App / Screens → FlowChart`), **1-click Screen Materialization**, and full **`project-definition.md`** export for AI coders.
- **✨ Built-in Client-Side AI Studio & Runtime Generator (`✨ AI Studio`)**: Generate or refine UI `Screens`, `Elements`, `Buttons`, `Icons`, `Paths`, and Conceptual `FlowCharts` at runtime right inside your browser via **4 pathways**: **(1) Google Gemini API BYOK** (`x-goog-api-key` direct from browser, never sent to `/api/*`), **(2) Chrome Built-in Gemini Nano** (`window.LanguageModel`, zero key), **(3) Local Ollama / LM Studio / OpenAI-Compatible & In-Browser WebGPU** (`@mlc-ai/web-llm`), and **(4) Official Subscription MCP Bridge** (live `/mcp` + SSE sync for Gemini CLI, Antigravity, Claude Code, and Cursor).
- **🟢 Live "Test Actions" Simulation Mode**: Flip on **`▶ Test actions`** in any Button, Element, Screen, or Workflow designer to test real text inputs, checkboxes, toggles, sliders, CSS keyframe animations, radial/drawer/slider/carousel menus, modal popups, drawers, and multi-screen navigation live on the canvas.
- **👥 Multi-Project Workspaces (`New`, `Save`, `Clone`, `Browse`, `Delete`), 3-Tier Scopes & Collaborative Change Review**:
  - Manage projects directly from the **Project** menu (`New Project`, `Save Project`, `Clone Project`, `Browse Projects`, `Delete Project`).
  - Three-tier visibility scopes: **🌐 Public (`public`)**, **🔒 My Global Library (`private`)**, and **📁 Project (`project`)**, plus multi-target **`Save as…`** across multiple projects at once.
  - Copy or Move items across multiple projects in one click—automatically cascading all referenced sub-items (`screen → element → button → icon → path`).
  - Full **Root-Owner Lineage Tree** across multi-hop clones.
  - **Owner Approval / Rejection Workflow**: Edits by collaborators generate diff snapshots (`change_requests`) that project owners can approve or roll back in one click.

---

## 🏗 Architecture & Composable Hierarchy

```mermaid
flowchart LR
  subgraph Hierarchy["Composable Design & Architecture Hierarchy"]
    FC["🔀 Conceptual FlowChart\n(Screens, API Steps, Decisions, Roles)"]
    P["✒️ Path (24×24)"] --> I["🔷 Icon (24×24)"]
    I --> B["🔘 Button (+ Hub / Press & Slide)"]
    P --> B
    I --> E["🧩 Element (Containers, Repeaters, JS)"]
    B --> E
    E --> S["📱 Screen (Device Viewports)"]
    B --> S
    I --> S
    S --> W["🗺️ Workflow (Versioned Screen Graph)"]
    FC <-->|"Materialize UIs /\nReverse Engineer"| S
    FC -->|"Sync Routes"| W
  end

  subgraph AI["Client-Side AI & Live MCP"]
    Studio["✨ Browser AI Studio\n(Gemini BYOK · Nano · Ollama · WebGPU)"]
    MCP["🔌 /mcp Server\n(Claude · Gemini CLI · Antigravity · Cursor)"]
  end

  subgraph Persistence["Offline-First Dual Storage"]
    SQLite[("⚡ Local SQLite\nsrc/data/designer.db")]
    Outbox[("📦 Sync Outbox")]
    PG[("🐘 PostgreSQL\nkyrpy-uiux-designer-db")]
    SQLite --> Outbox
    Outbox <-->|"Push / Pull Sync\n(Optional .env)"| PG
  end

  Studio --> Hierarchy
  MCP <--> Hierarchy
  Hierarchy --> SQLite
```

---

## 🚀 One-Click Installer & Runner (`installer.sh` / `installer.ps1` & `runner.sh` / `runner.ps1`)

### Prerequisites
- **Node.js v22.5+** (uses Node's built-in `node:sqlite` — **zero** external `npm install` packages required!)
- Optional: PostgreSQL server if you want multi-device cloud synchronization.

### 🔑 Default Accounts (published credentials)
Every fresh install and every published snapshot (`src/data/designer.db`, `sql/`) ships exactly these three accounts:

| Username | Password | Role |
|---|---|---|
| `superadmin` | `superadmin` | `superadmin` — the one account that edits / imports / updates the public library |
| `admin` | `admin` | `admin` — manages users, projects and the trash bin |
| `user` | `user` | `designer` — regular user |

> ⚠️ **These passwords are public. Change all three immediately after you clone the repository and start your own server** (profile icon → *My Profile → Password*; minimum 8 characters with a letter and a digit). While an account still has its default password, the app prompts you to change it at sign-in. Never expose a server that still uses them. (Upgrading? An old `kyrpy` account is renamed to `superadmin`; a password you set yourself is kept.)

---

### 1. Run the One-Click Installer

**Linux & macOS (`installer.sh`)**:
```bash
git clone https://github.com/KyrpyDev/kyrpy-uiux-designer.git
cd kyrpy-uiux-designer
./installer.sh
```

**Windows PowerShell (`installer.ps1`)**:
```powershell
git clone https://github.com/KyrpyDev/kyrpy-uiux-designer.git
cd kyrpy-uiux-designer
.\installer.ps1
```

#### What the One-Click Installer Does Automatically:
1. **Verifies Node.js v22+**.
2. **Prompts for Runtime Mode (`dev` vs `release`)**:
   - **`dev` mode (`APP_MODE=dev`, `BYPASS_AUTH=true`)**: Bypasses the Login/Register gate so you land directly inside the studio canvas for rapid local development.
   - **`release` mode (`APP_MODE=release`, `BYPASS_AUTH=false`)**: Protects the studio page with a full-screen **Login / Register** gate requiring authentication (e.g. `superadmin` / `superadmin`, `admin` / `admin`, `user` / `user` — change them first — or a newly registered account).
3. **Prompts for Optional `.env` PostgreSQL Credentials**:
   - Asks for your preferred local HTTP port (default: `5180`).
   - Asks if you want to configure a server-side PostgreSQL connection (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGADMINDB`).
   - **Automatic Local-Only Fallback**: If you skip PostgreSQL or if the server is unreachable, it automatically sets `PG_SYNC_ENABLED=false` and `LOCAL_ONLY=true` so the studio runs **100% locally on SQLite (`src/data/designer.db`)**.
4. **Seeds Default `admin` / `admin` Account & Sample Data**: Ensures `src/data/designer.db` is loaded with the sample design system (`211 paths`, `206 icons`, `211 buttons`, `114 elements`, `24 screens`, `3 workflows`, `30 themes`, `12 device templates`, `40 button templates`) and the `admin` / `admin` account.
5. **Runs Automated Verification Tests & Starts the Server** at **`http://127.0.0.1:5180`**.

> **Non-Interactive Install**:
> - Linux/macOS: `./installer.sh --non-interactive`
> - Windows PowerShell: `.\installer.ps1 -NonInteractive`

---

### 2. Using the One-Click Runner (`runner.sh` & `runner.ps1`)

After installation, use `runner.sh` (Linux/macOS) or `runner.ps1` (Windows PowerShell) to start, stop, or switch between **Dev Mode** (login bypass) and **Release Mode** (login/register protected):

**Linux & macOS (`./runner.sh`)**:
```bash
./runner.sh start     # Start studio server using mode from .env
./runner.sh dev       # Start in Dev Mode (bypasses Login/Register page)
./runner.sh release   # Start in Release Mode (protects studio with Login/Register page)
./runner.sh stop      # Stop background server
./runner.sh restart   # Restart server
./runner.sh status    # Check running PID, port, and mode
./runner.sh logs      # Stream server logs
```

**Windows PowerShell (`.\runner.ps1`)**:
```powershell
.\runner.ps1 start    # Start studio server using mode from .env
.\runner.ps1 dev      # Start in Dev Mode (bypasses Login/Register page)
.\runner.ps1 release  # Start in Release Mode (protects studio with Login/Register page)
.\runner.ps1 stop     # Stop background server
.\runner.ps1 restart  # Restart server
.\runner.ps1 status   # Check running PID and port
```

---

## 🗄 Sample Database & SQL Dumps (`sql/` & `src/data/designer.db`)

This repository ships with a rich, production-grade sample UI/UX library ready to explore, remix, or use as a foundation for your own apps:

| Asset / Dump File | Description |
| :--- | :--- |
| [`src/data/designer.db`](./src/data/designer.db) | Pre-populated local SQLite database used immediately on startup (`211` paths, `206` icons, `211` buttons, `114` elements, `24` screens, `3` workflows, `30` themes across 15 Dark/Light style families, `12` device templates, `40` button templates). |
| [`sql/schema_postgres.sql`](./sql/schema_postgres.sql) | Standalone PostgreSQL DDL schema for all 21 tables (`users`, `projects`, `paths`, `icons`, `buttons`, `elements`, `screens`, `nodes`, `animations`, `menu_items`, `workflows`, `trash_items`, etc.). |
| [`sql/sample_data_postgres.sql`](./sql/sample_data_postgres.sql) | Full PostgreSQL dump (`CREATE TABLE IF NOT EXISTS` + idempotent `INSERT ... ON CONFLICT DO NOTHING`) to seed any PostgreSQL database. |
| [`sql/sample_data_sqlite.sql`](./sql/sample_data_sqlite.sql) | Full SQLite SQL dump used by `./installer.sh` to reconstruct `src/data/designer.db` from scratch if deleted. |
| [`sql/schema_sqlite.sql`](./sql/schema_sqlite.sql) | Synchronized SQLite DDL schema for all tables and indexes. |

### Publishing the Sample Database (PostgreSQL is primary)
The files above are produced from a clone of the PostgreSQL database, never from a live SQLite file, and contain only the immutable `public` user's data:
```bash
npm --prefix src run db:publish -- --push-first --apply   # push SQLite -> PG, clone PG into publish/, leak-check, copy to src/data/designer.db and sql/
npm --prefix src run db:publish                           # dry run: only prepares the git-ignored publish/ folder
```

### Importing the Sample Dump into PostgreSQL Manually
```bash
psql -h <YOUR_PGHOST> -p 5432 -U <YOUR_PGUSER> -d kyrpy-uiux-designer-db -f sql/sample_data_postgres.sql
```
Or simply configure your `.env` and click **`⇅ PG Sync → ⬆ Push Local SQLite to PostgreSQL`** inside the web UI!

---

## ⚙️ Environment Variables (`.env`)

Copy [`.env.example`](./.env.example) to `.env` (or let `./install.sh` generate it for you). **Never commit `.env` or `credentials.env`**—both are strictly protected by [`.gitignore`](./.gitignore).

```ini
# HTTP Server Port
PORT=5180

# Set PG_SYNC_ENABLED=false for 100% Local-Only SQLite mode,
# or PG_SYNC_ENABLED=true when connecting to a PostgreSQL server.
PG_SYNC_ENABLED=false
LOCAL_ONLY=true

# Optional Server-Side PostgreSQL Connection Settings (Placeholders)
PGHOST=your-postgres-host.example.com
PGPORT=5432
PGUSER=postgres
PGPASSWORD=your-postgres-password-placeholder
PGDATABASE=kyrpy-uiux-designer-db
PGADMINDB=postgres

# Optional free stock photo providers for the Images library (Openverse works without a key)
PEXELS_API_KEY=your-pexels-api-key          # https://www.pexels.com/api/
PIXABAY_API_KEY=your-pixabay-api-key        # https://pixabay.com/api/docs/
```

### Default Local Accounts
See **Default Accounts** above: `superadmin` / `superadmin`, `admin` / `admin`, `user` / `user`. Change the passwords right after your first start.

---

## 🛠 Key Features in Detail

### 1. Vector, Path & Graphical Editing Studio (Web Canvas + MCP `uiux_graphic_tool`)
- **Pen & Bezier Node Tool (`B` / `N`)**: Convert any shape (`rect`, `circle`, `ellipse`, `line`, `polygon`, `polyline`) to an editable Bezier `<path>`, drag control handles, edit/insert/delete vertices, toggle smooth/sharp vertices (`S`/`K`), cut paths at `(t, segment)`, join open endpoints, combine or break apart compound subpaths, reverse winding, round corners, simplify curves, and bake SVG `transform` matrices into coordinates.
- **Boolean Pathfinder & Crop Operations**: Exact polygon/curve Boolean **Union (`unite`)**, **Subtract (`minus front`)**, **Intersect**, **Exclude (`XOR`)**, **Crop to Box (`X`)**, and **Crop to Canvas**.
- **Component Explode & Reusable Extraction**: Explode placed icon instances into editable vector paths (`explode_icon`), extract `<path>` shapes into reusable `24×24` Path library items (`extract_paths_to_library`), or extract any node selection on a Screen into a reusable `Element` (`extract_as_element`).
- **9-Point Anchor Placement, Layout & Grouping**: Place child instances at any 9-point reference anchor (`top-left` … `bottom-right`), align (`left`/`center`/`right`/`top`/`middle`/`bottom`), distribute (`horizontal`/`vertical`), move, resize, proportional `fit_to_screen` (responsive container clamping), flip (`h`/`v`), rotate, group/ungroup (`<g>`), reorder layer z-order (`front`/`back`/`forward`/`backward`), duplicate in a `2×2` grid, and copy/apply fill, stroke & opacity styles.
- **SVG, Folder, Font & Online Iconify Importers**: Import inline SVG markup, entire `.svg` folders, `.svg`/`.ttf` font glyphs, or search & import open-source icon packs (Tabler, Lucide, Heroicons, Line MD, Meteocons, Devicon, Simple Icons) with preserved license attribution.

### 2. Curated Public Elements Library & Cascade Copy-to-Project
- **Rich Public Elements & Design Catalog**: Built-in public library (owned by the immutable `public` system user) shipping **114+ reusable Elements** (cards, forms, navbars, modals/popups, drawers, toolbars, responsive `container` shells, 2D/3D `carousel` containers, page-builder blocks), **211 Buttons**, **206 Icons**, **211 Paths**, **24 Screens**, **3 Workflows**, **30 Themes** across 15 Dark/Light style families, **12 Device Templates**, and **40 Button Style Templates**.
- **Use Public Elements Anywhere**: Browse, filter by category/tags, preview in any of the 30 themes, and adopt/place any public element directly onto a project Screen or Container (`uiux_public_library` + `uiux_use_public_element` in MCP, or drag/insert in the Web Studio).
- **Search & Cascade-Copy Any Item to Edit**: Search across public, private, and shared project libraries and deep-copy any `path`, `icon`, `button`, `element`, `screen`, or `workflow` into your active project (`Copy to Projects` in Web Studio or `uiux_copy_item_to_project` in MCP). Copying a Screen, Element, Button, or Workflow automatically cascades all referenced sub-items (`workflow → screen → element → button → icon → path`) into the target project with root-owner lineage preserved, so you can freely edit your project copy without mutating the source.

### 3. Interactive Events, Animations, Menus & Responsive Containers
- **Multi-Event Bindings**: Attach `click`, `dblclick`, `mouseover`, `mouseleave`, `release`, `drag`, `drop`, `rightclick`, `longpress`, or `focus` triggers to any node.
- **Rich Event Actions, Press & Slide Joysticks & Transitions**: Route to a Screen (`{ type: 'screen', target }`), Open an Element inline, Open an Auto-Closing Popup/Modal dialog (`role: 'popup'`), Open a Floating Element Toolbar, Slide in a Drawer (`left`/`right`/`top`/`bottom`), Trigger CSS Keyframe Animations (`pulse`, `bounce`, `flip`, `shake`, `swing`, `glow`, `float`, `shine`, `slide-in`, `fade`, `spin`), configure **4/8-direction Press & Slide joystick gestures** (scroll repeaters, step hub focus frames, or trigger directional routes/popups), set transition durations (seconds) for screen navigation & element open/close, or Navigate Back (one-click bulk `Go back` wiring across screen Cancel/Back/Close buttons).
- **Per-Instance Overrides (`✎` Placed Copy vs `Edit Original`) & Project Prefixes**: Every project defines a title, MCP variable name, description, and **prefix** (`prefix-*` automatically applied to new designs, menu items, and AI-created items, with prefix-first library sorting). Clicking a placed library instance edits **only that placed copy's** label, colors, role settings, menu items, and click/press-slide actions in place—while `Edit the original` opens the shared library item.
- **Button Popup, Radial, Hub, Drawer, Slider & 2D/3D Carousel Menus**: Configure fan, list, rotating hub (`hubCount`, `hubSubInside`, `hubIconSize`, per-item long-press & double-tap actions), drawer, vertical/horizontal slider, or 2D/3D animated carousel menus on any button, with nested sub-menus up to 6 levels deep.
- **Nested Scrollable Containers & Fixed-Size Multi-Item Repeaters**: `Container` and `Carousel` elements enforce inner/outer margins, responsive `fitNodesToScreen` scaling, child max-size clamping, and chained wheel/drag scrolling across nested overflowing containers. `Repeater` containers maintain fixed Inspector dimensions, support drag-to-reorder in the Inspector, render every sub-item at least once, and fill remaining slots via deterministic seeded random selection.

### 4. Multi-Project Library Management, Full Item CRUD & Trash Bin
- **Full CRUD Across All 6 Item Types**: Create, Read/List, Update, Soft-Delete to Trash, and Restore from Trash for `path`, `icon`, `button`, `element`, `screen`, and `workflow`—both in the Web Studio (Center-Canvas & 90%-Wide Modal Item Browser) and directly over MCP (`uiux_create_item`, `uiux_list_project_items`, `uiux_update_item`, `uiux_delete_item`).
- **Project-Scoped Keys & Per-User Trash Bin**: Keys are unique per project (`(project_id, key)`), so multiple projects can cleanly use canonical keys (`home`, `primary-btn`, `hero-card`). Deleted items are archived in a per-user **Trash Bin (`🗑 Trash`)** with full JSON + `uid` snapshots and can be restored losslessly (`restore: true`).
- **Single-Superadmin Public Governance**: Only `superadmin` mutates the public library directly; collaborator edits create reviewable `change_requests` with visual before/after diffs.

### 5. Self-Hosted Live API & MCP Documentation (`/docs/api` & `/docs/mcp`)
- **`GET /docs/api`**: Live dark/light reference generated from the canonical 180+-route backend catalog (`src/interfaces/http/api-catalog.js`), showing every HTTP endpoint, `api.<action>` client method, parameters, and MCP scope eligibility, plus a live `/api/health` probe.
- **`GET /docs/mcp`**: Live reference for all 64+ registered MCP tools (including Conceptual FlowCharts & Project Definition), resource URIs, prompts, and copy-paste bearer-key setup, plus `/api/health/mcp`.

### 6. Multi-Format Library Export & Import (`HTML`, `SVG`, `JSON`)
Export and import **Paths**, **Icons**, **Buttons**, **Elements**, **Screens**, and **Workflows** directly into either **Project-Specific (`visibility: 'project'`)** or **Public (`visibility: 'public'`)** libraries in three interchangeable formats:
- **`JSON` (`.json`)**: Structured `kyrpy-uiux-library-v2` bundle with cascading sub-items (`screen → element → button → icon → path` + menu items + workflow screen bindings).
- **`SVG` (`.svg`)**: Standalone vector artwork or multi-item SVG sheet with embedded lossless library metadata (`<!-- KYRPY_UIUX_LIBRARY_PAYLOAD:... -->`) and raw `<svg>` shape parser fallback.
- **`HTML` (`.html`)**: Self-contained interactive HTML catalog previewing every exported item with inline SVGs plus an embedded `#ud-library-payload` script for lossless round-trip re-import.

### 6b. Image Library & Free Stock Photos
The **Images** tab of the library holds raster pictures (PNG, JPEG, GIF, WebP; max 6 MB, large uploads are downsized to 2048 px in the browser). Search by every word of the name, tags, description-dev or author; upload (button or drop files); or search **free stock photos** from **Openverse** (no key), **Pexels** and **Pixabay** (with `PEXELS_API_KEY` / `PIXABAY_API_KEY`) and import them with their author, source page and license. Drag a picture onto a design to place an **image node** (`{ tag: 'image', attrs: { x, y, width, height, imageId, preserveAspectRatio, 'data-clip': 'circle' | 'rounded', 'data-radius' } }`): the inspector changes the picture, the fit (cover / contain / stretch) and the shape (rectangle, rounded, circle). SVG imports keep embedded `<image>` pictures (moved into the library); exports embed pictures as data URIs. API: `/api/images`, `/api/stock-images/*` (also over MCP `uiux_api_call`).

### 7. Production Bundle Exporter, Native Adapters & Standalone Prototype Shell
- Export any project into a clean, self-contained **HTML + CSS + TypeScript + JavaScript + SVG Sprite** bundle (`DEV-NOTES.md`, `manifest.json`, `screens/*.html`, `svg/sprite.svg`, `ts/app.ts`, `app/interactions.json`), plus deterministic adapters for **Web**, **React TSX (`<Icon name="…"/>`)**, **Flutter (Dart)**, **Jetpack Compose (Kotlin)**, and **SwiftUI (Swift)**.
- Every exported prototype includes the dependency-free **Options Menu (`uiux/source/prototype/options-menu.js`)** to live-switch **Device viewport** (responsive / phone / tablet / laptop / desktop), **Design style** (all 30 dark/light themes), and **Button type** (`circle`, `pill`, `rounded`, `squircle`, `square`, `sharp`, `outline`, `ghost`) at runtime, plus CLI style switching via `node uiux/source/switch-style.mjs`.

---

### 8. User Profile, Sessions & Security
The profile icon (top right) opens **My Profile**: edit display name and email, change your password (minimum 8 characters with a letter and a digit; signs out other sessions), manage active sessions, and create/rotate/revoke **AI Access Keys (MCP)**. System users (`public`, `kyrpy-agent-designer`) cannot sign in or be edited.

### 9. Conceptual FlowChart Designer & Full `project-definition.md` Blueprint
Open **FlowChart** from the top menu bar, designer switcher dropdown, or left **FlowCharts** browser tab (with inline `+`, `✎`, `⧉`, `📄`, `🗑` CRUD toolbar) to architect Frontend, Backend, Business Logic, and Auth/ACL workflows visually and textually on a ComfyUI-style node canvas:
- **ComfyUI-Style Nodes & Ports**: Place **Screen**, **Step** (`api-endpoint`, `db-query`, `validation`, `service-logic`, `background-job`, `webhook-out`, `notification`), **Decision** (multi-scenario routers), **Trigger**, **Subflow**, and **End** nodes. Every connectable node exposes a **`Home` (`◉`) input socket** and unlimited **diverging output sockets** (menu items, buttons, form submits, API outcomes, decision cases).
- **Interactive Wire Badges (`📝` & `◇`)**: Click **`📝`** directly over any connection wire to author textual transition behavior (validation, HTTP call, state mutation, animation, error handling) or click **`◇`** to split a connection into a multi-branch **Decision** node.
- **Per-Access-Level / Role Feature Matrix**: Define project roles (`guest`, `user`, `pro`, `editor`, `admin`, or custom roles), restrict nodes/ports/edges by role, specify how the **same Screen** adapts across roles (`addedFeatures`, `hiddenFeatures`, `summary`), and live-preview the graph as any role.
- **Approval Gate, Screen Materialization, Reverse Engineering & `project-definition.md`**: Validate graphs for orphan nodes or missing transitions, sign off as **Approved**, **Materialize** conceptual `Screen` nodes into linked visual `Screen` designs + `Workflow` routes, **Reverse Engineer** existing visual screens/workflows or external app route specs into FlowCharts, and export a comprehensive **`project-definition.md` + JSON** blueprint so any AI coder can build or recreate the entire application.

### 10. Unified Client-Side AI Studio & Runtime Generator (`✨ AI Studio`)
Click **`✨`** in the top bar (or **`AI` menu**, Designer **`AI Studio`** button, FlowChart **`✨ AI Studio`** button, or **`✨ AI UI`** directly on any FlowChart Screen node) to generate or refine UI `Screens`, `Elements`, `Buttons`, `Icons`, `Paths`, and Conceptual `FlowCharts` at runtime in your browser across **4 sanctioned pathways**:
1. **Google Gemini API (BYOK — AI Studio)**: Direct browser `fetch` to `generativelanguage.googleapis.com` (`gemini-4-carbon`, `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-3.8-flash`, `gemini-3.1-pro-preview`, `gemini-3.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash`, plus **1-click Account Model Sync** & custom preview model IDs) using `x-goog-api-key` and structured JSON `responseSchema`. Keys stay in browser `sessionStorage` (or opt-in `localStorage`) and **never touch `/api/*`**.
2. **Chrome Built-in AI (`window.LanguageModel` — Gemini Nano)**: Zero-key, zero-cost on-device inference inside Chrome 138+ with automatic availability detection and download progress monitoring.
3. **Local Ollama / LM Studio / OpenAI-Compatible & In-Browser WebGPU**: Direct calls to `http://127.0.0.1:11434/v1` (with `/api/tags` & `/v1/models` auto-discovery), LM Studio (`:1234`), OpenRouter, Groq, or OpenAI—plus lazy in-tab WebGPU inference via `@mlc-ai/web-llm` (`Qwen2.5-3B`, `Llama-3.2-3B`, `Qwen2.5-1.5B`).
4. **Official Subscription MCP Bridge**: One-click **AI Access Keys** launcher + context-aware copyable prompts so **Gemini CLI, Antigravity, Claude Code, and Cursor** subscriptions drive live SSE canvas updates over `/mcp`.

## 🔌 MCP Server — Design ↔ Code Sync for AI Coding Agents

The designer ships an **MCP server** (Streamable HTTP, protocol 2025-06-18) so coding agents such as Claude Code, Antigravity and Cursor can use a project's design system, propose changes to it, and push the app's current UI back for human review. The implementation and developer notes are in [`src/mcp/README.md`](src/mcp/README.md).

### Connect your AI coding agent

**There is no `kyrpy-uiux` program to download or compile.** `kyrpy-uiux` is only the *name* your agent gives to this designer's MCP endpoint (`https://<your-designer-host>/mcp`, or `http://127.0.0.1:5180/mcp` locally). On your machine you need just two things:

1. **Your agent's own CLI** (only for the terminal-based clients; IDE clients such as Cursor, Windsurf, Cline or Claude Desktop are configured in their settings):

   | Client | Command | Install | Docs |
   |---|---|---|---|
   | Claude Code | `claude` | `curl -fsSL https://claude.ai/install.sh \| bash` (macOS / Linux / WSL) · `irm https://claude.ai/install.ps1 \| iex` (PowerShell) · or `npm install -g @anthropic-ai/claude-code` | [setup](https://docs.anthropic.com/en/docs/claude-code/setup) |
   | Codex CLI | `codex` | `npm install -g @openai/codex` | [openai/codex](https://github.com/openai/codex) |
   | Gemini CLI | `gemini` | `npm install -g @google/gemini-cli` | [gemini-cli](https://github.com/google-gemini/gemini-cli) |
   | opencode | `opencode` | `npm install -g opencode-ai` | [opencode.ai](https://opencode.ai/docs) |
   | VS Code (Copilot) | `code` | macOS: Command Palette ▸ *Shell Command: Install 'code' command in PATH* | [VS Code setup](https://code.visualstudio.com/docs/setup/setup-overview) |
   | Claude Desktop, Zed, any stdio client | `npx` | [Node.js 18+](https://nodejs.org) (the `mcp-remote` bridge runs through `npx`) | — |

   `npm install -g …` needs [Node.js 18+](https://nodejs.org). Check with `claude --version` (or `codex --version`, …), and open a new terminal after installing.
2. **An API key** from the designer: **Profile ▸ *AI Access Keys (MCP)…*** creates a **project key** (one project, stored per repository) or an **account key** (all your projects, stored once per user). The key is shown only once.

The *AI Access Keys* window then shows a **Connect an AI coder** panel: pick your client and shell and press **Download `.sh` / `.ps1` / `.cmd` / `.fish`** (or **Copy all steps**). Run your terminal or downloaded script **as Administrator** (`sudo bash ./connect-claude-code.sh` on Linux / macOS / WSL, or **Run as Administrator** in Windows PowerShell / Command Prompt). The script:

- **verifies Administrator / root privileges** first and **checks that your agent's CLI is installed** (if either is missing, it stops cleanly without deleting itself).
- **copies the API key into a system environment variable** (`KYRPY_UIUX_API_KEY`, stored in `/etc/environment` & `/etc/profile.d/kyrpy-uiux.sh` on Linux/WSL, `launchctl` on macOS, or Windows `Machine` / `setx /M` system variables).
- removes an older `kyrpy-uiux` entry that would shadow the new key (Claude Code: `local` beats `project` beats `user` scope), then adds the server and checks the connection.
- keeps config-file contents (`.mcp.json`, `settings.json`, `config.toml`) and in-app steps such as `/mcp` as **comments**. Save or merge those by hand if you want them.
- **permanently removes itself from disk** (`shred -u -z` / `rm -f`, `Remove-Item -Force`, `del /f /q`) after all steps run and finish properly so no plaintext API key file remains in the repository.

What it runs for Claude Code with an account key (bash / zsh):

```bash
export KYRPY_UIUX_API_KEY='kud_live_…'            # the key from AI Access Keys
claude mcp remove kyrpy-uiux -s local 2>/dev/null || true
claude mcp remove kyrpy-uiux -s user  2>/dev/null || true
claude mcp add --transport http --scope user kyrpy-uiux https://<your-designer-host>/mcp --header "Authorization: Bearer $KYRPY_UIUX_API_KEY"
claude mcp get kyrpy-uiux                        # should say: ✔ Connected
# project key instead: run inside the repository with --scope local (and remove only the local entry)
```

Then, in the app repository, tell your agent: *"Run uiux_init …"* (the panel shows the exact sentence), or later *"pull design updates"* · *"push the existing app version"*.

**Troubleshooting**

| Symptom | Cause and fix |
|---|---|
| `mcpServers:: command not found`, `syntax error near unexpected token '}'` | A JSON config block was pasted into the shell (older copy text). Copy the steps again: config files are now comments. |
| `claude: command not found` | The Claude Code CLI is not installed. See the table above. |
| `claude mcp get` → `✘ Failed to connect … HTTP 401 … invalid, expired or revoked API key` | The entry that wins holds an old key. `claude mcp get` shows its scope. Create a new key and run the copied steps again; they remove the stale entry first. By hand: `claude mcp remove kyrpy-uiux -s local` (or `-s project` / `-s user`). |
| `direnv is not installed` | On bash / zsh / fish, project keys for opencode, Antigravity, Cursor, Windsurf, Cline, Zed and the stdio bridge use [direnv](https://direnv.net/docs/installation.html) to load the key per repository. Install it, or use an account key. |

| Area | What you get |
|---|---|
| **API keys** | Per user × project, scopes `read` / `request` / `propose`, expiry, 24 h rotation grace, instant revoke, audit log. Only an HMAC digest is stored. |
| **Account & Design keys** | User-wide **Account keys** (`read`, `request`, `propose`, `create`, plus strict `design` scope for AI-assisted design sessions with `uiux_edit_project`, `uiux_save`, `uiux_save_as` `-vNNN` milestones, `uiux_manage_versions`, `uiux_purge_versions`). On `uiux_init`, choose **download**, **clone**, **edit**, **create** (from an existing repo), or **reverse** (reverse-engineer a live Android APK / emulator or web app into hierarchical UI items & workflows). |
| **Connect any AI coder** | *AI Access Keys* generates setup for Claude Code, Codex, Gemini CLI, Antigravity, Cursor, VS Code, Windsurf, Cline, opencode, Zed, Claude Desktop and stdio bridges (bash / PowerShell / fish / cmd). Project keys stay per repository (Claude `--scope local`, `.gemini/.env`, direnv `.envrc`, VS Code input prompt), so several repos on one laptop never share a key. |
| **Public Elements & Copy-to-Project** | **`uiux_public_library`** browses/searches curated public elements, buttons, icons, paths, screens & workflows with category facets and JSON/SVG inspection; **`uiux_use_public_element`** adopts a public element (with all sub-items) into your project and optionally places it onto a Screen/Element at a 9-point anchor; **`uiux_copy_item_to_project`** searches across public, private & visible projects and cascade-copies any item into your project to edit without modifying the source. |
| **Full Direct Item CRUD & Trash** | First-class Create, Read/List, Update, Soft-Delete & Trash Restore across **all 6 item types** (`path`, `icon`, `button`, `element`, `screen`, `workflow`) via **`uiux_create_item`**, **`uiux_list_project_items`**, **`uiux_update_item`** (with `copyIfForeign: true`), and **`uiux_delete_item`** (`restore: true` restores from Trash with original `uid`). |
| **Graphical Editing Tools** | **`uiux_graphic_tool`** runs **38 pure-domain graphical & vector operations** (single step or atomic batch): primitives/containers/carousels (`add_shape`, `add_pen_path`, `place_instance`, `import_svg_nodes`), Boolean Pathfinder (`union`, `subtract`, `intersect`, `exclude`, `crop`, `crop_to_canvas`), Bezier/path ops (`convert_to_path`, `combine_paths`, `break_apart`, `join_paths`, `reverse_path`, `simplify_path`, `bake_transform`, `round_corners`, `smooth_vertices`, `sharp_vertices`, `cut_path`, `edit_vertices`), component extraction (`explode_icon`, `extract_paths_to_library`, `extract_as_element`), and layout/transform (`align`, `distribute`, `move`, `resize`, `fit_to_screen`, `flip`, `rotate`, `group`, `ungroup`, `reorder_layer`, `duplicate_nodes`, `style_nodes`, `delete_nodes`). |
| **Sandboxed Element JS & Public Libs** | **`uiux_element_script`** (`policy`, `verify`, `get`, `set`, `verify_sri`, `remove`, plus `item.script` on `uiux_create_item` / `uiux_update_item` / `uiux_stage_item`) lets reverse-engineering and coding agents attach custom ES module logic (`mount(container, props, bridge)`) and pinned public JS imports (`cdn.jsdelivr.net`, `esm.sh`, `unpkg.com`) with exact `x.y.z` semver, `sha384` Subresource Integrity (`verifyIntegrity: true`), optional `lockfilePackages` matching, static code audit, and zero-trust execution strictly inside `<iframe sandbox="allow-scripts" referrerpolicy="no-referrer">` (`connect-src 'none'`). |
| **Conceptual FlowCharts & `project-definition.md`** | **9 first-class FlowChart tools** (`uiux_list_flowcharts`, `uiux_get_flowchart`, `uiux_create_flowchart`, `uiux_update_flowchart`, `uiux_flowchart_op` [13 graph ops], `uiux_delete_flowchart`, `uiux_materialize_flowchart`, `uiux_reverse_engineer_flowchart`, `uiux_export_project_definition`) + resources `uiux://project/flowcharts`, `uiux://project/definition`, and `uiux://flowchart/{ref}` so AI coding agents can read/design conceptual Frontend+Backend+Decision+Role workflows, materialize approved screens, reverse-engineer existing apps, and export full `project-definition.md` blueprints. |
| **Full Backend API Bridge** | **`uiux_api_docs`** (`uiux://api/docs`, `uiux://api/docs/{group}`) and **`uiux_api_call`** expose all allowed Designer backend API functions (`api.*` actions & `/api/*` routes) in-process—device/button templates, SVG/font/Iconify/stock-photo imports, nodes, animations, menus, element scripts, flowcharts, route-crawled workflows, translations, library transfer, version snapshots, and HTML/SVG exports—even in standalone MCP mode. |
| **Read, styles & download** | Schema, manifest, ranked search, single items (JSON/SVG/HTML), tokens (JSON/CSS/TS), `uiux_import_styles` + `switch-style.mjs` + live `options-menu.js`, workflows, `uiux_check_update` / `uiux_refresh_info`, and single-use `.tar.gz` bundles with `curl → sha256sum → tar` steps. |
| **AI & Reverse-Engineer packs** | `uiux_init` installs `kyrpy-uiux-designer` + `kyrpy-skill-uiux-designer` (and optional `kyrpy-uiux-reverse-engineer` + `kyrpy-skill-uiux-reverse-engineer`) for Claude Code, Antigravity, AGENTS.md, Cursor or plain docs, plus `init-prompt.md`, `.uiux/config.json` and lockfile. Local edits are never overwritten. |
| **Adapters & Working HTML app** | `web` (tokens.css/ts, hoisted icon sprite, typed index), `react-tsx` (typed `<Icon name="…"/>`), `flutter` / `compose` / `swiftui`, and `uiux_export_app` (working HTML app + `app/interactions.json` describing every interaction, menu, workflow and developer note). |
| **Versions, Changesets & Review** | Numbered project versions (`uiux_get_manifest { sinceVersion }`, `uiux_restore_version`), live `GET /mcp` SSE notifications, reviewed changesets (`begin → stage → diff → submit`) with `baseHash` conflict detection in *Collaborate ▸ Versions & AI Changesets*, item-request queue (`uiux_request_item`), and code bindings (`uiux_bind_code`). |
| **Project scope & portable actions** | Self-contained per-project keys (`(project_id, key)`), automatic clone-on-reference for foreign/public dependencies, portable `{type, uid, key}` click/event targets, and `kyrpy-agent-designer` attribution. |
| **Security & PostgreSQL** | Origin check, 1 MB bodies, 120 calls/min and 10 bundles/h per key, 500 ops per changeset, strict tenant & public-library isolation, STRIDE review ([`src/mcp/SECURITY.md`](src/mcp/SECURITY.md)), and full MCP table parity in PostgreSQL sync. |

Full MCP user guide: [`readme-mcp.md`](./readme-mcp.md) · Architecture & milestone internals: [`src/mcp/README.md`](./src/mcp/README.md).

Run modes: embedded in `serve` at `/mcp` (disable with `MCP_MODE=off`), or standalone with `node src/main.js mcp --port 5181`.

---

## 🤖 AI Agent Skill for GitHub Actions, Push, Pull, Fix & Issues

This repository ships with a built-in AI Agent Skill at [`skills/github-workflow-agent/SKILL.md`](./skills/github-workflow-agent/SKILL.md) alongside our automated GitHub Actions pipeline ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).
AI coding assistants (Antigravity, Claude Code, Cursor, GitHub Copilot Workspace, OpenHands) can load `skills/github-workflow-agent/SKILL.md` to autonomously execute:
- **`pull`**: `git fetch origin && git pull --rebase origin main && (cd src && npm test)`
- **`push`**: Pre-push test gate (`npm test`), zero-secret audit, Conventional Commits, and `git push origin main`
- **`fix`**: Issue reproduction, regression test authoring in `src/tests/`, branch creation, and PR linking
- **`issue`**: Triage, creation, commenting, and closing via `gh issue`
- **`actions`**: Inspecting workflow runs (`gh run list`, `gh run view --log-failed`), triggering `ci.yml`, and re-running failed jobs

---

## 🗺️ Future Tasks & AI Roadmap

We are actively evolving **Kyrpy UI/UX Designer** into an AI-native collaborative design platform. Upcoming roadmap milestones include:

1. **🤝 Integrate with AI Collaboration**
   - Real-time human + multi-agent collaborative sessions on the shared canvas and workflow graph.
   - AI design co-pilots that propose layout refinements, accessibility (WCAG AAA) fixes, theme token harmonization, and interactive state wiring directly through the **Collaborative Change Request (`pending` → `approved` / `rejected`)** review pipeline.
   - Automated multi-persona UX evaluation agents that simulate user journeys across workflows and attach structured UX feedback to screens.

2. **🔌 MCP Server — ✅ shipped** (see *MCP Server — Design ↔ Code Sync* above): versions and restore, changesets, item requests, code bindings, project/account/design keys, public elements & cascade copy-to-project, direct CRUD across all 6 item types + Trash restore, 38-operation graphical vector editing (`uiux_graphic_tool`), Conceptual FlowCharts + `project-definition.md` blueprint (`uiux_*_flowchart`, `uiux_export_project_definition`), in-process backend API bridge (`uiux_api_docs` + `uiux_api_call`), reverse-engineering pack (`mode: "reverse"`), web/React/Flutter/Compose/SwiftUI adapters, working HTML app export, live SSE subscriptions and PostgreSQL sync for AI coding agents.

3. **🔑 Client-Side BYOK, On-Device Browser AI & Runtime Item/FlowChart Generator (`✨ AI Studio`) — ✅ shipped**
   - Unified browser-side **AI Studio** supporting **Google Gemini API BYOK** (`x-goog-api-key` kept strictly in browser storage, never sent to `/api/*`), **Chrome Built-in Gemini Nano** (`window.LanguageModel`), **Local Ollama / LM Studio / OpenAI-Compatible**, **In-Browser WebGPU** (`@mlc-ai/web-llm`), and the **Official Subscription MCP Bridge**.
   - Runtime generation, refinement, and node appending across **Paths, Icons, Buttons, Elements, Screens, Conceptual FlowCharts, and Materialized FlowChart Screen UIs** using theme-adaptive tokens and automatic project/public library instance reuse.

---

## 🧪 Running Tests & Server Management

```bash
# Run the full automated suite (527 tests): core (unit + integration + adversarial personas + FlowCharts + AI Studio) + MCP milestones M0–M13
# (the PostgreSQL round-trip test uses an isolated test database and is skipped when PG is unreachable)
cd src && npm test

# Service management via runner.sh (Linux/macOS) or runner.ps1 (Windows PowerShell)
./runner.sh start     # Start server in background on port 5180
./runner.sh dev       # Start in Dev Mode (bypasses Login/Register page)
./runner.sh release   # Start in Release Mode (protects page with Login/Register)
./runner.sh stop      # Stop server
./runner.sh restart   # Restart server
./runner.sh status    # Check PID and listening port
./runner.sh logs      # Stream server logs
```

---

## 🤝 Contributing — Join Us & Build the Future of Open-Source UI/UX Tooling!

We are building **Kyrpy UI/UX Designer** in the open because designers and developers deserve a fast, local-first, git-friendly, and AI-native design tool that owns its data in plain SQLite and SQL.

**Whether you love vector math, SVG rendering, UI/UX ergonomics, design tokens, or clean zero-dependency JavaScript, we would love your contributions!**

### 🌟 High-Impact Ways You Can Contribute Right Now
1. **🎨 New Built-In Themes & Surface Tokens**: Add new glassmorphic, brutalist, e-ink, or cyber-neon themes in `src/domain/theme.js`.
2. **🧩 Interactive HTML Element Templates**: Expand our library of interactive widgets (charts, data tables, date pickers, kanban cards, command palettes).
3. **📱 Device & Button Presets**: Contribute new mobile, foldable, automotive, or spatial/VR viewport templates.
4. **📦 Framework Exporters**: Help us add direct code exporters for **React / Next.js**, **Vue / Nuxt**, **Svelte**, **Flutter**, and **Dioxus (Rust)** alongside our existing HTML/TS/SVG bundle exporter in `src/application/export/`.
5. **🔌 Real-Time WebSocket / CRDT Presence**: Enhance our collaborative change-request workflow with live multi-cursor canvas presence.

### How to Submit a Pull Request
1. **Fork** the repository and create your feature branch:
   ```bash
   git checkout -b feat/amazing-ui-feature
   ```
2. **Make your changes** following our Clean Architecture boundaries:
   - `src/domain/` — Pure isomorphic domain logic (zero I/O, runs in both Node and browser).
   - `src/application/` — Use-case services & ports.
   - `src/infrastructure/` — SQLite repositories, PostgreSQL sync, SVG/Font importers, filesystem exporter.
   - `src/interfaces/` — HTTP controllers (`http/`) and vanilla ES module web studio (`web/`).
3. **Run the test suite** and make sure all tests pass:
   ```bash
   cd src && npm test
   ```
4. **Commit and open a Pull Request!** See [CONTRIBUTING.md](./CONTRIBUTING.md) for full details.

If you find this project useful, please **⭐ Star this repository** on GitHub and share it with fellow builders!

---

## 🙏 Acknowledgements — Open-Source Icon Sources

The library's online icon import and the bundled icon packs stand on the work of these open-source projects. Thank you to every author and contributor — please respect each set's license when you reuse its icons.

| Source | License |
|---|---|
| [Iconify API](https://iconify.design) and its [icon-set JSON](https://github.com/iconify/icon-sets) (served via jsDelivr) | MIT (API / tooling) |
| [Tabler Icons](https://github.com/tabler/tabler-icons) | MIT |
| [Lucide](https://lucide.dev) / [Lucide Animated](https://lucide-animated.com) | ISC |
| [Line MD](https://github.com/cyberalien/line-md) (Material Design line icons by Vjacheslav Trushkin) | MIT |
| [SVG Spinners](https://github.com/n3r4zzurr0/svg-spinners) | MIT |
| [Meteocons](https://meteocons.com) (Bas Milius) | MIT |
| [Devicon](https://devicon.dev) | MIT |
| [Heroicons](https://heroicons.com) / [Heroicons Animated](https://www.heroicons-animated.com) (Tailwind Labs) | MIT |
| [Simple Icons](https://simpleicons.org) | CC0 1.0 |
| [itshover](https://github.com/itshover/itshover), [Hamburger React](https://hamburger-react.netlify.app), [Moving Icons](https://www.movingicons.dev), [Animate Icons](https://animateicons.in), [AllSVGIcons](https://allsvgicons.com) | inspiration / reference sources |

Imported icons keep their per-set license in the icon metadata (`source: online/iconify`).

---

## 📄 License

Released under the [MIT License](./LICENSE).
