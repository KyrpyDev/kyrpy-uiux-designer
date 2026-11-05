import { parseXml } from './xml-parser.js';
import { xmlToNodes } from './svg-to-nodes.js';
import { loadLegacy, iconBodyMarkup } from './legacy-loader.js';
import { iconElementMapper, legacyItemMapper, liquidScreenMapper, iconCategory, elementCategory, screenCategory } from './tokenizer.js';
import { HTML_ELEMENTS, BUTTON_ELEMENTS } from './elements-catalog.js';
import { SAMPLE_MENUS } from './sample-menus.js';
import { WORKFLOWS } from './default-workflows.js';
import { labelFromKey } from '../../domain/naming.js';
import { DEFAULT_MENU as menuDefaults } from '../../domain/entities.js';
import { pathDevDescription, iconDevDescription, buttonDevDescription, menuItemDevDescription, elementDevDescription, screenDevDescription, workflowDevDescription } from '../../domain/dev-description.js';

const SHARED_MIN_USES = 2;

/**
 * Seeds the database from the v1 prototype folder plus the built-in element presets, following the library hierarchy:
 *   path groups (one per v1 icon + shared parts)  ->  icons  ->  buttons (one per icon + sample menus)  ->  elements  ->  screens
 * Idempotent: existing keys are skipped, `reset` first removes everything built-in and re-imports.
 */
export class LegacyImporter {
  constructor({ themes, services, menus, workflows, log = () => {} }) { Object.assign(this, { themes, services, menus, workflows, log }); }

  run({ legacyRoot, reset = false } = {}) {
    const stats = { themes: 0, paths: 0, sharedPaths: 0, icons: 0, buttons: 0, menuItems: 0, elements: 0, presets: 0, screens: 0, workflows: 0, links: 0, skipped: 0 };
    this.themes.seedBuiltins();
    stats.themes = this.themes.list().length;
    if (reset) this.#reset();

    const legacy = legacyRoot ? loadLegacy(legacyRoot) : { icons: [], items: [], screens: [], labels: new Map() };
    const iconIds = this.#importGlyphs(legacy, stats);
    const buttonIds = this.#importButtons(iconIds, stats);
    this.#importElements(legacy, iconIds, buttonIds, stats);
    const screenIds = this.#importScreens(legacy, iconIds, stats);
    this.#importWorkflows(screenIds, stats);
    this.#describeScreens(screenIds);
    return stats;
  }

  #reset() {
    for (const w of this.workflows.list()) this.workflows.remove(w.id);
    for (const t of ['screen', 'element', 'button', 'icon', 'path']) for (const d of this.services[t].list()) if (d.builtin) this.services[t].remove(d.id);
  }

  /* ---------- paths and icons ---------- */
  #importGlyphs(legacy, stats) {
    const S = this.services;
    const iconIds = new Map(S.icon.list().map(i => [i.key, i.id]));
    const pathIds = new Map(S.path.list().map(p => [p.key, p.id]));

    // 1. parse every v1 icon into nodes
    const parsed = [];
    for (const ic of legacy.icons) {
      if (ic.template || iconIds.has(ic.key)) { if (iconIds.has(ic.key)) stats.skipped++; continue; }
      const body = iconBodyMarkup(ic.svg);
      if (!body) { this.log(`icon ${ic.key}: unexpected layout, skipped`); stats.skipped++; continue; }
      const nodes = xmlToNodes(parseXml(`<svg>${body}</svg>`).children, { mapAttrs: iconElementMapper() });
      parsed.push({ key: ic.key, label: legacy.labels.get(ic.key) || labelFromKey(ic.key), nodes });
    }

    // 2. shared parts: identical named shapes used by several icons (folder outline, document outline, eye ...) become path groups of their own
    const sig = n => JSON.stringify([n.tag, n.attrs, n.name]);
    const uses = new Map();
    for (const p of parsed) for (const n of p.nodes) if (n.parentId == null && n.name && n.tag !== 'g' && !n.animations) uses.set(sig(n), (uses.get(sig(n)) || 0) + 1);
    const shared = new Map();           // signature -> path id
    const usedKeys = new Set(pathIds.keys());
    for (const [sg, count] of uses) {
      if (count < SHARED_MIN_USES) continue;
      const [tag, attrs, name] = JSON.parse(sg);
      let key = name, n = 2;
      while (usedKeys.has(key) || iconIds.has(key)) key = `${name}-${n++}`;
      usedKeys.add(key);
      const draft = { key, name: labelFromKey(key), label: labelFromKey(key) };
      const nodes = [{ id: 1, parentId: null, tag, kind: 'shape', attrs, name }];
      const made = S.path.create({ ...draft, category: 'shared', builtin: true, meta: { source: 'v1/svg', shared: true }, descriptionDev: pathDevDescription(draft, nodes) }, { nodes });
      shared.set(sg, made.id); pathIds.set(key, made.id); stats.sharedPaths++;
    }

    // 3. one path group per icon (shared parts replaced by instances), and the icon that places it
    const inst = (id, refId, name) => ({ id, parentId: null, tag: 'use', kind: 'instance', refType: 'path', refId, name, attrs: { x: '0', y: '0', width: '24', height: '24' } });
    for (const p of parsed) {
      const nodes = p.nodes.map(n => (n.parentId == null && shared.has(sig(n))) ? inst(n.id, shared.get(sig(n)), n.name) : n);
      const draft = { key: p.key, name: p.label, label: p.label };
      const category = iconCategory(p.key);
      const group = S.path.create({ ...draft, category, builtin: true, meta: { source: 'v1/svg' }, descriptionDev: pathDevDescription(draft, nodes) }, { nodes });
      pathIds.set(p.key, group.id); stats.paths++;
      const iconNodes = [inst(1, group.id, 'paths')];
      const icon = S.icon.create({ ...draft, category, builtin: true, meta: { source: 'v1/svg' }, descriptionDev: iconDevDescription(draft, iconNodes, [p.key]) }, { nodes: iconNodes });
      iconIds.set(p.key, icon.id); stats.icons++;
    }
    return iconIds;
  }

  /* ---------- buttons and their menus ---------- */
  #importButtons(iconIds, stats) {
    const S = this.services;
    const ids = new Map(S.button.list().map(b => [b.key, b.id]));
    const frame = (shape, iconId) => [
      { id: 1, parentId: null, tag: 'rect', kind: 'shape', role: 'button', name: 'surface', attrs: { x: '0', y: '0', width: '64', height: '64', rx: shape === 'square' ? '20' : '32' } },
      { id: 2, parentId: null, tag: 'rect', kind: 'shape', role: 'shine', name: 'shine', attrs: { x: '5', y: '3', width: '54', height: '26', rx: shape === 'square' ? '12' : '16' } },
      ...(iconId ? [{ id: 3, parentId: null, tag: 'use', kind: 'instance', refType: 'icon', refId: iconId, name: 'icon', attrs: { x: '12', y: '12', width: '40', height: '40' } }] : [])
    ];
    const make = (key, label, category, shape, iconKey, extra = {}) => {
      if (ids.has(key)) { stats.skipped++; return ids.get(key); }
      const nodes = frame(shape, iconKey ? iconIds.get(iconKey) : null);
      const draft = { key, name: label, label, width: 64, height: 64 };
      const b = S.button.create({ ...draft, category, builtin: true, meta: { shape, icon: iconKey || null, ...extra.meta }, descriptionDev: buttonDevDescription(draft, nodes, iconKey ? [iconKey] : []) }, { nodes });
      ids.set(key, b.id); stats.buttons++;
      return b.id;
    };
    make('button-frame-circle', 'Button frame circle', 'frames', 'circle', null);
    make('button-frame-square', 'Button frame square', 'frames', 'square', null);
    for (const [key, id] of iconIds) {
      const ic = S.icon.get(id);
      make(`${key}-button`, `${ic.label} button`, ic.category, 'circle', key);
    }

    // sample menus: popup and rotating buttons with nested items (taken from the v1 radial / ring menus)
    for (const def of SAMPLE_MENUS) {
      if (ids.has(def.key)) { stats.skipped++; continue; }
      const bid = make(def.key, def.name, 'menus', 'circle', def.icon, { meta: { menu: def.config } });
      const walk = (items, parentId, parentPath) => {
        for (const it of items) {
          const row = this.menus.addItem(bid, { name: it.name, label: it.label, iconId: iconIds.get(it.icon) ?? null, parentId, action: it.action || it.name,
            descriptionDev: menuItemDevDescription({ ...it, hasChildren: !!it.children?.length }, parentPath) });
          stats.menuItems++;
          if (it.children?.length) walk(it.children, row.id, parentPath ? `${parentPath}/${it.name}` : it.name);
        }
      };
      walk(def.items, null, '');
      const full = S.button.get(bid);
      const depth = (parent = null) => { const kids = full.menuItems.filter(m => (m.parentId ?? null) === parent); return kids.length ? 1 + Math.max(...kids.map(k => depth(k.id))) : 0; };
      S.button.update(bid, { descriptionDev: buttonDevDescription(full, full.nodes, [def.icon], { config: { ...menuDefaults, ...def.config }, items: full.menuItems, depth: depth() }) });
    }
    return ids;
  }

  /* ---------- elements ---------- */
  #resolver(iconIds) {
    return href => { const m = /^#i-(.+)$/.exec(href); const id = m && iconIds.get(m[1]); return id ? { refType: 'icon', refId: id } : null; };
  }

  #importElements(legacy, iconIds, buttonIds, stats) {
    const S = this.services;
    const have = new Set(S.element.list().map(e => e.key));
    const resolveUse = this.#resolver(iconIds);
    const keyOf = (map, id) => [...map].find(([, v]) => v === id)?.[0];
    const iconKeysOf = ns => [...new Set(ns.filter(n => n.refType === 'icon').map(n => keyOf(iconIds, n.refId)).filter(Boolean))];

    for (const it of legacy.items) {
      if (have.has(it.id)) { stats.skipped++; continue; }
      const nodes = xmlToNodes(parseXml(`<svg>${it.svg}</svg>`).children, { mapAttrs: legacyItemMapper(), resolveUse });
      const draft = { key: it.id, name: it.name, label: it.name, width: it.w, height: it.h, category: elementCategory(it.id), meta: { htmlTag: 'div' } };
      S.element.create({ ...draft, builtin: true, meta: { ...draft.meta, source: 'v1/items' }, descriptionDev: elementDevDescription(draft, nodes, iconKeysOf(nodes)) }, { nodes });
      have.add(it.id); stats.elements++;
    }

    for (const def of [...HTML_ELEMENTS, ...BUTTON_ELEMENTS]) {
      if (have.has(def.key)) { stats.skipped++; continue; }
      const nodes = def.nodes.map(n => {
        const { refKey, ...rest } = n;
        if (n.kind !== 'instance') return rest;
        const map = n.refType === 'button' ? buttonIds : iconIds;
        const id = map.get(refKey);
        if (!id) throw new Error(`preset ${def.key}: unknown ${n.refType} "${refKey}"`);
        return { ...rest, refId: id };
      });
      const draft = { key: def.key, name: def.name, label: def.label, width: def.width, height: def.height, category: def.category, meta: { htmlTag: def.htmlTag } };
      S.element.create({ ...draft, builtin: true, meta: { ...draft.meta, source: 'preset', preset: true },
        descriptionDev: [elementDevDescription(draft, nodes, iconKeysOf(nodes)), def.dev].filter(Boolean).join('\n') }, { nodes });
      have.add(def.key); stats.presets++;
    }
  }

  /* ---------- screens, workflows ---------- */
  #importScreens(legacy, iconIds, stats) {
    const S = this.services;
    const ids = new Map(S.screen.list().map(s => [s.key, s.id]));
    const resolveUse = this.#resolver(iconIds);
    // the liquid-glass family is the canonical source; the other themes are produced by the theme engine
    const source = legacy.screens.filter(s => s.family === 'liquid' && s.kind !== 'empty' && !/^Empty device/.test(s.caption || '')).sort((a, b) => a.index - b.index);
    for (const s of source) {
      const key = s.folder.replace(/^\d+-/, '');
      if (ids.has(key)) { stats.skipped++; continue; }
      const root = parseXml(s.svg);
      const w = parseFloat(root.attrs.width) || 390, h = parseFloat(root.attrs.height) || 844;
      const nodes = xmlToNodes(root.children, { mapAttrs: liquidScreenMapper({ w, h }), resolveUse });
      const created = S.screen.create({ key, name: s.caption, label: s.caption, width: w, height: h, category: screenCategory(key), builtin: true,
        position: s.index, visibility: 'public', projectId: 1,
        meta: { device: 'iphone-15', source: 'v1/screens/liquid', legacyIndex: s.index }, descriptionDev: `Screen "${key}".` }, { nodes });
      ids.set(key, created.id); stats.screens++;
    }
    return ids;
  }

  #importWorkflows(screenIds, stats) {
    const existingByKey = new Map(this.workflows.list().map(w => [w.key, w]));
    const main = WORKFLOWS[0];
    for (const def of WORKFLOWS) {
      let wf = existingByKey.get(def.key);
      const isNew = !wf;
      if (isNew) {
        wf = this.workflows.create({ key: def.key, name: def.name, label: def.label, descriptionDev: '' });
        stats.workflows++;
      } else {
        stats.skipped++;
      }
      const fullWf = this.workflows.get(wf.id);
      const haveScreenIds = new Set((fullWf.nodes || []).map(n => n.screenId));
      const placed = new Set();
      def.layout.forEach((col, ci) => col.forEach((skey, ri) => {
        const id = screenIds.get(skey);
        if (!id) return;
        if (!haveScreenIds.has(id)) {
          this.workflows.placeScreen(wf.id, { screenId: id, x: ci * 560, y: ri * 980 });
        }
        placed.add(skey);
      }));
      const haveLinkSigs = new Set((fullWf.links || []).map(l => `${l.fromScreenId}:${l.toScreenId}:${l.name}`));
      const links = def.links === 'subset-of:untrap-main-flow' ? main.links.filter(l => placed.has(l[0]) && placed.has(l[1])) : def.links;
      for (const [from, to, name, dev, opts = {}] of links) {
        const f = screenIds.get(from), t = screenIds.get(to);
        if (!f || !t) continue;
        if (haveLinkSigs.has(`${f}:${t}:${name}`)) continue;
        const fromNodeId = this.#findTrigger(f, opts);
        this.workflows.addLink(wf.id, { fromScreenId: f, toScreenId: t, fromNodeId, name, descriptionDev: dev, style: ['splash'].includes(from) ? 'cornered' : 'curved', trigger: opts.trigger || 'tap' });
        haveLinkSigs.add(`${f}:${t}:${name}`);
        stats.links++;
      }
      if (isNew) {
        this.workflows.update(wf.id, { descriptionDev: `${def.intro}\n${workflowDevDescription(wf, [...placed])}` });
      }
    }
  }

  /** Finds the node on a screen that visually triggers a link (by its text or by an icon key). */
  #findTrigger(screenId, { fromText, fromIcon }) {
    if (!fromText && !fromIcon) return null;
    const full = this.services.screen.get(screenId);
    if (fromText) { const t = full.nodes.find(e => e.tag === 'text' && e.text === fromText); if (t) return t.id; }
    if (fromIcon) {
      const icon = this.services.icon.get(fromIcon);
      const hit = icon && full.nodes.find(e => e.kind === 'instance' && e.refType === 'icon' && e.refId === icon.id);
      if (hit) return hit.id;
    }
    return null;
  }

  /** Second pass: now that links exist, write the dev descriptions of screens. */
  #describeScreens(screenIds) {
    const S = this.services;
    const keyById = new Map([...screenIds].map(([k, id]) => [id, k]));
    const iconKeyById = new Map(S.icon.list().map(i => [i.id, i.key]));
    const links = [];
    for (const wf of this.workflows.list()) if (wf.key === 'untrap-main-flow') links.push(...this.workflows.get(wf.id).links);
    for (const [, id] of screenIds) {
      const full = S.screen.get(id);
      if (!full.builtin) continue;
      const icons = [...new Set(full.nodes.filter(e => e.refType === 'icon').map(e => iconKeyById.get(e.refId)).filter(Boolean))];
      const own = links.filter(l => l.fromScreenId === id).map(l => ({ name: l.name, toKey: keyById.get(l.toScreenId) }));
      S.screen.update(id, { descriptionDev: screenDevDescription(full, full.nodes, { icons, links: own }) });
    }
  }
}
