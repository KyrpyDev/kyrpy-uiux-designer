# UI/UX App Designer — SQLite edition

Design app screens from the ground up, with everything stored in a **SQLite database** and every design exportable to
**SVG with animation** and to **working HTML / CSS / TS / JS**.

```
npm start            # http://127.0.0.1:5180  (first run imports ../v1 automatically)
npm run import      # seed / refresh from ../v1 + the element presets (idempotent)
npm run reset       # wipe the built-in content and re-import (your own designs are kept)
npm run export -- --out C:\path\to\folder --themes liquid,glow --screens all
npm run guide -- --out usage-and-guide.html   # the standalone usage guide (also: Help → Download, Export menu)
npm test            # 51 tests: domain, use cases + sqlite, hierarchy, menus, vertex + pathfinder maths, migration, export, http, save/reset/save-as, click actions
```

Node ≥ 22.13 (built-in `node:sqlite`): **no npm install, no dependencies**. Options: `--db <file>`, `--port <n>`, `--legacy <v1 folder>`.

> Upgrading an existing `data/designer.db`: it migrates automatically (items → elements, nothing is lost). Run `npm run reset`
> once to also get the new path groups, buttons and sample menus for the built-in icons.

## The hierarchy

```
path  →  icon  →  button  →  element  →  screen  →  workflow
```

| Level | Is | Built from | Designer |
|---|---|---|---|
| **Path** | reusable group of vector shapes (24 grid); can nest other path groups | shapes | Path designer — **vertex editing, pen, cut out, crop, group** |
| **Icon** | 24×24 composition | path groups (+ own shapes) | Icon designer |
| **Button** | themed frame, optional **popup / rotating menu** with nested items | icons | Button designer (+ menu editor) |
| **Element** | UI building block: HTML elements, forms, cards, navbars… | shapes, icons, buttons, other elements | Element designer (presets) |
| **Screen** | device-sized composition | icons, buttons, elements | Screen designer |
| **Workflow** | screens + named links | screens | Workflow designer |

The rules are enforced in the domain (a button cannot hold an element, nothing can contain itself) and by the UI (drop is refused with a hint).
Every level has a variable **name** (dashed words, unique), a **label**, a **description-dev** for the dev team and its own category/search.
**Open editor** (inspector button, first entry of the right-click menu, double-click) works on every element of a design: a placed icon/button/element/path jumps into its own
designer, text edits the words, a group selects what is inside, a shape starts vertex editing.

### Click actions (screens)
Any element of a screen can have a **click action** (`nodes.on_click`, JSON; inspector → *Click action*): **route to a screen**, **open an element as a popup**,
**open an element as a drawer** (left / right / top / bottom) or **go back**. The export draws a hotspot over the element and, for popups and drawers, a hidden overlay
containing the element's SVG for every exported theme (closes with ✕, backdrop or Esc). *Test actions* in the screen designer's toolbar previews them on the canvas.
Actions are listed in `data/manifest.json` (`screens[].actions`), `ts/types.ts` (`ActionInfo`) and `DEV-NOTES.md`. A route action replaces the workflow-link hotspot on the same element;
an action whose target was deleted is left out of the export. Actions sit on the screen's own elements (a group, or a placed icon/button/element as a whole).

### Bounding box
Every path, icon, button and element starts as a bounding box; everything inside lives within it. Resize the box (drag the box handles when nothing is
selected, or type W/H in the inspector) and **all sub items are scaled with it** (switch “Scale contents” off to resize the frame only). Placed instances scale the same way.

### Save, Save as, Reset, Back
The **document bar** at the top of every designer (path, icon, button, element, screen, workflow) has **← Back · 💾 Save · Save as… · ↺ Reset**.
**Save blinks while the design has unsaved changes** (and a line next to it says so).

Edits are written to SQLite immediately (so a crash loses nothing); *Save* is a bookmark on top of that:

| | |
|---|---|
| **Save** (Ctrl+S) | the current version becomes the saved one |
| **Reset** | put the design back to the saved version (`POST /api/<type>/:id/restore`, `POST /api/workflows/:id/restore`) |
| **Save as…** | clone the current state under a new name, put the original back to its saved version, open the copy |
| **Back** (Alt+←) | previous page; every opened design/workflow is a `history.pushState` entry, so the browser's Back works too |

Whether a design is "edited" is decided by comparing a fingerprint of the saved version with the current one
(`domain/doc-fingerprint.js`), so undoing or hand-reverting a change stops the blinking. Leaving (opening another design, Back, closing a dialog designer,
closing the tab) with unsaved changes asks *Save / Discard / Cancel*. The saved version lives in the browser tab: after a page reload the stored state counts as saved.

### Path editing tools
Available in every designer (they sit in the **Path tools** bar, the **Path** menu and the right-click menu).

| Tool | How |
|---|---|
| **Vertex editing** | select a path (rectangles, circles, lines… are converted to a path) → **Enter**, **N**, double-click or “Edit vertices”. Drag vertices and bezier handles (grid-snapped, Ctrl = free). Smooth vertices keep their opposite handle collinear; **Alt** breaks it, **Shift** mirrors its length. |
| **Add vertex** | **right-click the line** (or double-click it) |
| **Remove vertex** | **right-click the vertex** (or Delete / Alt+click) |
| **Pen (bezier curves)** | **B** — click = corner, click-drag = smooth curve, click the first point = close, Enter or right-click = finish, Backspace = undo last point, Esc = cancel |
| **Vertex tools** | Line ⇄ Curve (C) · Smooth (S) · Corner (K) · Round corner (radius) · Split segment · Cut here (opens a path at a vertex) · Close / open · Reverse · Simplify |
| **Cut out** | select the shape to cut out (on top) and the shape(s) behind it → *Cut out*: the top shape is subtracted (a bite or a hole) |
| **Crop** | *Crop tool* **X**: drag a rectangle, every selected shape keeps only what is inside · *Crop to box* trims to the design's bounding box · *∩ Crop* keeps only where the selected shapes overlap |
| **Union / Exclude** | merge into one outline · everything except the overlap |
| **Combine / Break apart / Join** | make one compound path (holes via even-odd) · split it again · join two open paths end to end |
| **Group / Ungroup** | **Ctrl+G** / **Ctrl+Shift+G** — groups move, resize and flip as one; ungrouping folds the group's transform into its children |
| **Align / Distribute** | to the selection (or to the bounding box for a single item); distribute needs 3+ items |
| **Flip / Rotate 90°** | paths are flipped/rotated point by point, groups through their transform, other shapes via position / rotation; *Apply transform* bakes a path's transform into its points |

Cut out / crop / union work on paths, rectangles, circles, ellipses, lines and polygons (curves are flattened to polylines in the result, at a tolerance relative to the design size).
Line size stays a ratio of the theme's global value; every edit is one undo step and saved to SQLite.

### Buttons, popup menus and the rotating button
A button owns a tree of **menu items** (label, variable name, icon, action/event or target screen, description-dev), nested up to 6 levels.
* **popup** menu: opens a list (up/down/left/right) or a fan. **rotating** menu: the same fan, but the clicked item's icon replaces the centre.
* Behaviour (identical in the designer, in the exported pages and in `DEV-NOTES.md`): click opens the items · click again closes · click an item with sub items →
  its icon takes the centre and its sub items are shown · click the centre → one level back · a leaf item fires its action/target and closes. The centre icon can turn (45° by default).
* In the Button designer the menu is shown open. **Hover the button or any item** for the toolbar: ＋ sub item · ✎ edit · ← → order · 🗑 delete. “Test menu” switches to click-through mode.
* Settings (type, layout, radius, start angle, sweep, item size, gap, rotate-on-open) are ratios of the button size, so the menu scales with the button.
* Samples: `item-radial-menu` (3 levels), `page-check-menu`, `more-popup-button`.

## Using it

* **Left panel** — tabs Paths · Icons · Buttons · Elements · Screens · Workflows: search, categories, hover toolbar (edit · clone · export SVG · delete),
  drag onto the open designer or double-click to add. Screens: thumbnails, **Select all / None / Invert**, export selected / all.
  *New element* offers every preset (all basic HTML elements combined with icons and buttons) or a blank bounding box.
* **Right panel** — Screen/Element/Button/Icon/Path designer: infinite pan/zoom, move/resize/marquee, rect/circle/line/text/path tools, **grid + 9-point snap**, undo/redo,
  z-order, inspector (names, **description-dev**, geometry, colours, line size × global, **animations**, menu). Saved to SQLite on every change.
  Workflow designer: link tool (a form asks for the name and description-dev of each new link; double-click a link to edit it), curved/cornered links (cornered lines hop over each other), edit a screen in a modal.
* **Themes** — Liquid glass, Glow lines, Neumorphic light/dark (editable, clonable). One stored design renders in all of them.

### Export
* **Any design as SVG** (animations included): ⤓ in the library, or *Export → Export open design as SVG*. Buttons export with their menu.
* **Project export** (*Export selected screens…*): screens + themes + folder (typed path or Browse… in Chrome/Edge):

```
index.html            catalog of screens and icons
screens/<key>.html    working page: inline SVG per theme, link hotspots, click actions (route, popup, drawer, back), navigation, working button menus, description-dev
css/ themes.css app.css     js/ app.js (+ the menu runtime) screens.js     ts/ app.ts menu.ts screens.ts types.ts + tsconfig.json
svg/ screens/<theme>/ · icons/ · buttons/ · elements/ · sprite.svg       data/manifest.json
DEV-NOTES.md          every description-dev: screens, links, elements, buttons with their menu trees, icons
```

## Data model (`infrastructure/sqlite/migrations.js`)

`paths`, `icons`, `buttons`, `elements`, `screens` share one shape (`key` variable name, `name`, `label`, `description_dev`, `category`, `tags`, size, `meta`).
`nodes` holds **every shape/text/group/instance of every design** (`owner_type`, `owner_id`, `tag`, `attrs` JSON, `role`, `ref_type/ref_id` for instances of a lower-level
design, `description_dev`). Colours are tokens (`{{accent}}`), line sizes are ratios (`{{sw*0.5}}`). `animations` (per node: move, rotate, scale, fade, visible, blink, pulse,
bounce, draw, glow, keyframes · duration, delay, easing, repeat, direction, trigger), `menu_items` (nested, per button), `themes`, `workflows`, `workflow_screens`,
`workflow_links`, `settings`.

## Clean architecture (dependencies point inwards)

```
domain/            pure, runs in node AND the browser: hierarchy rules (entities), theme engine, svg renderer, menu layout + runtime, path-data + path-tools (vertex model), path-ops (pathfinder), node-ops (group / align / flip), geometry, animation
application/       use cases: DesignService (one per level), MenuService, RenderService, ThemeService, WorkflowService, SvgImportService, export/
infrastructure/    sqlite/ (database, migrations, repositories) · import/ (v1 importer, xml parser, tokenizer, element presets, sample menus) · export/ (fs writer)
interfaces/        http/ (router, controllers, server) · web/ (browser app: ES modules, no build step)
composition-root.js  the only place that wires concrete classes
```

## What was transferred from `../v1`

206 icons → **206 path groups** (one per icon, plus shared parts such as the folder outline extracted once and reused) and 206 icons composed of them, **206 buttons** (one per icon,
the v1 button views), 33 v1 items → elements, **63 new presets** (basic HTML elements combined with icons and buttons), 23 screens, 3 workflows with 42 links.
Every path, icon, button, menu item, element, screen and workflow has a generated `description-dev` meant to be edited.
Screens were generated per theme in v1; the liquid set is the canonical source and its glass surfaces carry roles (card / button / field / shine) that each theme restyles.
