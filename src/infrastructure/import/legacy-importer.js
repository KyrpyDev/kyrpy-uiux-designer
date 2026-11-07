import { parseXml } from './xml-parser.js';
import { xmlToNodes } from './svg-to-nodes.js';
import { loadLegacy, iconBodyMarkup } from './legacy-loader.js';
import { iconElementMapper, legacyItemMapper, liquidScreenMapper, iconCategory, elementCategory, screenCategory, libraryScreenKey, libraryElementKey } from './tokenizer.js';
import { HTML_ELEMENTS, BUTTON_ELEMENTS } from './elements-catalog.js';
import { SAMPLE_MENUS } from './sample-menus.js';
import { WORKFLOWS } from './default-workflows.js';
import { labelFromKey } from '../../domain/naming.js';
import { DEFAULT_MENU as menuDefaults, BUTTON_STYLES, DEFAULT_PROJECT_BUTTON_SETTINGS, DEFAULT_BUTTON_TEMPLATES, buttonStyleFrameKey, buttonStyleFrameNodes, buttonStyleFrameSize, isButtonStyleFrame, isDesignButtonTemplate, designButtonTemplateNodes } from '../../domain/entities.js';
import { pathDevDescription, iconDevDescription, buttonDevDescription, menuItemDevDescription, elementDevDescription, screenDevDescription, workflowDevDescription } from '../../domain/dev-description.js';

const SHARED_MIN_USES = 2;

/**
 * Seeds the database from the v1 prototype folder plus the built-in element presets, following the library hierarchy:
 *   path groups (one per v1 icon + shared parts)  ->  icons  ->  buttons (one per icon + sample menus)  ->  elements  ->  screens
 * Idempotent: existing keys are skipped, `reset` first removes everything built-in and re-imports.
 */
export class LegacyImporter {
  constructor({ themes, services, menus, workflows, log = () => {}, publicOwnerId = null }) { Object.assign(this, { themes, services, menus, workflows, log, publicOwnerId }); }

  /** Built-ins are public-library items, owned by the immutable `public` system user when it exists. */
  #own() {
    const id = typeof this.publicOwnerId === 'function' ? this.publicOwnerId() : this.publicOwnerId;
    return id ? { creatorId: id, rootOwnerId: id, visibility: 'public', projectId: 1 } : {};
  }

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
      const made = S.path.create({ ...draft, ...this.#own(), category: 'shared', builtin: true, meta: { source: 'v1/svg', shared: true }, descriptionDev: pathDevDescription(draft, nodes) }, { nodes });
      shared.set(sg, made.id); pathIds.set(key, made.id); stats.sharedPaths++;
    }

    // 3. one path group per icon (shared parts replaced by instances), and the icon that places it
    const inst = (id, refId, name) => ({ id, parentId: null, tag: 'use', kind: 'instance', refType: 'path', refId, name, attrs: { x: '0', y: '0', width: '24', height: '24' } });
    for (const p of parsed) {
      const nodes = p.nodes.map(n => (n.parentId == null && shared.has(sig(n))) ? inst(n.id, shared.get(sig(n)), n.name) : n);
      const draft = { key: p.key, name: p.label, label: p.label };
      const category = iconCategory(p.key);
      const group = S.path.create({ ...draft, ...this.#own(), category, builtin: true, meta: { source: 'v1/svg' }, descriptionDev: pathDevDescription(draft, nodes) }, { nodes });
      pathIds.set(p.key, group.id); stats.paths++;
      const iconNodes = [inst(1, group.id, 'paths')];
      const icon = S.icon.create({ ...draft, ...this.#own(), category, builtin: true, meta: { source: 'v1/svg' }, descriptionDev: iconDevDescription(draft, iconNodes, [p.key]) }, { nodes: iconNodes });
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
      const b = S.button.create({ ...draft, ...this.#own(), category, builtin: true, meta: { shape, icon: iconKey || null, ...extra.meta }, descriptionDev: buttonDevDescription(draft, nodes, iconKey ? [iconKey] : []) }, { nodes });
      ids.set(key, b.id); stats.buttons++;
      return b.id;
    };
    for (const style of BUTTON_STYLES) {
      const key = buttonStyleFrameKey(style.key);
      if (ids.has(key)) { stats.skipped++; continue; }
      ids.set(key, this.#createStyleFrame(style).id); stats.buttons++;
    }
    const tplPos = this.#designTemplatePosition();
    for (const tpl of DEFAULT_BUTTON_TEMPLATES) {
      if (ids.has(tpl.key)) { stats.skipped++; continue; }
      ids.set(tpl.key, this.#createDesignTemplate(tpl, tplPos).id); stats.buttons++;
    }
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

  /**
   * One empty public frame template per button style (`button-frame-<style>`, 64x64 or wide for pill), shaped like
   * "Apply All" shapes it. Placed at the position of `button-frame-circle` (or 1) so all frames sort together at the top.
   */
  #createStyleFrame(style) {
    const key = buttonStyleFrameKey(style.key);
    const { width, height } = buttonStyleFrameSize(style.key);
    const nodes = buttonStyleFrameNodes(style.key, { width, height });
    const label = `Button frame ${style.key}`;
    const draft = { key, name: label, label, width, height };
    const circle = this.services.button.list().find(b => b.key === buttonStyleFrameKey('circle') && Number(b.projectId ?? 1) === 1);
    return this.services.button.create({ ...draft, ...this.#own(), category: 'frames', builtin: true, position: circle?.position ?? 1,
      meta: { shape: style.shape, icon: null, buttonStyle: style.key, buttonIconSizePct: DEFAULT_PROJECT_BUTTON_SETTINGS.buttonIconSizePct },
      descriptionDev: buttonDevDescription(draft, nodes, []) }, { nodes });
  }

  /**
   * Adds the missing per-style frame templates to an existing library (idempotent: matched by key in the
   * public library project 1). An existing built-in frame owned by the public user whose meta.buttonStyle is not its
   * own style (left re-styled by an earlier "Apply All") is reshaped back to its style; other frames are never changed.
   * Returns the keys added or repaired.
   */
  ensureButtonStyleFrames() {
    const own = this.#own();
    const have = new Map(this.services.button.list().filter(b => Number(b.projectId ?? 1) === 1).map(b => [b.key, b]));
    const changed = [];
    for (const style of BUTTON_STYLES) {
      const key = buttonStyleFrameKey(style.key);
      const b = have.get(key);
      if (!b) { this.#createStyleFrame(style); changed.push(key); continue; }
      const isPublicBuiltin = !!b.builtin && own.creatorId != null && Number(b.creatorId) === Number(own.creatorId);
      if (!isPublicBuiltin || b.meta?.buttonStyle === style.key) continue;
      const { width, height } = buttonStyleFrameSize(style.key);
      this.services.button.update(b.id, { width, height, scaleContent: false, meta: { ...(b.meta || {}), shape: style.shape, buttonStyle: style.key } });
      this.services.button.replaceNodes(b.id, buttonStyleFrameNodes(style.key, { width, height }).map(({ id, ...n }) => n));   // fresh node ids
      changed.push(key);
    }
    return changed;
  }

  /**
   * The public library button of a design-style template (`DEFAULT_BUTTON_TEMPLATES` entry, category `templates`),
   * sized and built like the template_buttons row (same nodes as `TemplateService`), keeping its own style in meta.
   * The label is a short sample text that fits the box (the long template name stays the button name).
   */
  #createDesignTemplate(tpl, position) {
    const nodes = designButtonTemplateNodes(tpl, { label: tpl.width >= 100 ? 'Button' : 'OK' });
    const draft = { key: tpl.key, name: tpl.name, label: tpl.name, width: tpl.width, height: tpl.height };
    return this.services.button.create({ ...draft, ...this.#own(), category: 'templates', builtin: true, position,
      meta: { ...(tpl.meta || {}), templateKey: tpl.key, templateCategory: tpl.category, shape: tpl.shape, icon: null, rxRatio: tpl.rxRatio, marginRatio: tpl.marginRatio,
        strokeRatio: tpl.strokeRatio, hoverEffect: tpl.hoverEffect, indicatorEffect: tpl.indicatorEffect },
      descriptionDev: buttonDevDescription(draft, nodes, []) }, { nodes });
  }

  /**
   * Position of the design-style templates: the slot right after the frames (`button-frame-circle` position + 1), so they
   * sort just below them. A built-in frame left in that slot by an older database (`button-frame-square`) moves up to
   * the other frames; when another button holds the slot the templates share the frames' position instead.
   */
  #designTemplatePosition() {
    const S = this.services.button;
    const all = S.list();
    const framePos = all.find(b => b.key === buttonStyleFrameKey('circle') && Number(b.projectId ?? 1) === 1)?.position ?? 1;
    const slot = framePos + 1;
    const own = this.#own();
    for (const b of all) {
      if (b.position !== slot || !isButtonStyleFrame(b) || Number(b.projectId ?? 1) !== 1) continue;
      if (own.creatorId != null && Number(b.creatorId) !== Number(own.creatorId)) continue;
      S.update(b.id, { position: framePos }); b.position = framePos;
    }
    return all.some(b => b.position === slot && !isDesignButtonTemplate(b)) ? framePos : slot;
  }

  /**
   * Adds the missing design-style templates to the public library (idempotent: matched by key in project 1; an
   * existing button with a template key is never changed or duplicated). Returns the keys added.
   */
  ensureDesignButtonTemplates() {
    const have = new Set(this.services.button.list().filter(b => Number(b.projectId ?? 1) === 1).map(b => b.key));
    const missing = DEFAULT_BUTTON_TEMPLATES.filter(t => !have.has(t.key));
    if (!missing.length) return [];
    const position = this.#designTemplatePosition();
    for (const tpl of missing) this.#createDesignTemplate(tpl, position);
    return missing.map(t => t.key);
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

    for (const it0 of legacy.items) {
      const it = { ...it0, id: libraryElementKey(it0.id) };
      if (have.has(it.id)) { stats.skipped++; continue; }
      const nodes = xmlToNodes(parseXml(`<svg>${it.svg}</svg>`).children, { mapAttrs: legacyItemMapper(), resolveUse });
      const draft = { key: it.id, name: it.name, label: it.name, width: it.w, height: it.h, category: elementCategory(it.id), meta: { htmlTag: 'div' } };
      S.element.create({ ...draft, ...this.#own(), builtin: true, meta: { ...draft.meta, source: 'v1/items' }, descriptionDev: elementDevDescription(draft, nodes, iconKeysOf(nodes)) }, { nodes });
      have.add(it.id); stats.elements++;
    }

    for (const def of [...HTML_ELEMENTS, ...BUTTON_ELEMENTS]) {
      if (have.has(def.key)) { stats.skipped++; continue; }
      this.#createPreset(def, iconIds, buttonIds, iconKeysOf);
      have.add(def.key); stats.presets++;
    }
  }

  #createPreset(def, iconIds, buttonIds, iconKeysOf) {
    const nodes = def.nodes.map(n => {
      const { refKey, ...rest } = n;
      if (n.kind !== 'instance') return rest;
      const map = n.refType === 'button' ? buttonIds : iconIds;
      const id = map.get(refKey);
      if (!id) throw new Error(`preset ${def.key}: unknown ${n.refType} "${refKey}"`);
      return { ...rest, refId: id };
    });
    const draft = { key: def.key, name: def.name, label: def.label, width: def.width, height: def.height, category: def.category, meta: { htmlTag: def.htmlTag } };
    return this.services.element.create({ ...draft, ...this.#own(), builtin: true, meta: { ...draft.meta, source: 'preset', preset: true, ...(def.meta || {}) },
      descriptionDev: [elementDevDescription(draft, nodes, iconKeysOf(nodes)), def.dev].filter(Boolean).join('\n') }, { nodes });
  }

  /**
   * Adds the given built-in presets to an existing library when missing (idempotent; new presets reach older databases).
   * Presets whose icons / buttons are not in the library are skipped. Returns the keys added.
   */
  ensurePresets(keys) {
    const S = this.services;
    const have = new Set(S.element.list().map(e => e.key));
    const iconIds = new Map(S.icon.list().map(i => [i.key, i.id]));
    const buttonIds = new Map(S.button.list().map(b => [b.key, b.id]));
    const keyOf = id => [...iconIds].find(([, v]) => v === id)?.[0];
    const iconKeysOf = ns => [...new Set(ns.filter(n => n.refType === 'icon').map(n => keyOf(n.refId)).filter(Boolean))];
    const added = [];
    for (const def of [...HTML_ELEMENTS, ...BUTTON_ELEMENTS]) {
      if (!keys.includes(def.key) || have.has(def.key)) continue;
      const refsOk = def.nodes.every(n => n.kind !== 'instance' || (n.refType === 'button' ? buttonIds : iconIds).has(n.refKey));
      if (!refsOk) { this.log(`preset ${def.key}: missing icon/button references, skipped`); continue; }
      this.#createPreset(def, iconIds, buttonIds, iconKeysOf);
      added.push(def.key);
    }
    return added;
  }

  /* ---------- screens, workflows ---------- */
  #importScreens(legacy, iconIds, stats) {
    const S = this.services;
    const ids = new Map(S.screen.list().map(s => [s.key, s.id]));
    const resolveUse = this.#resolver(iconIds);
    // the liquid-glass family is the canonical source; the other themes are produced by the theme engine
    const source = legacy.screens.filter(s => s.family === 'liquid' && s.kind !== 'empty' && !/^Empty device/.test(s.caption || '')).sort((a, b) => a.index - b.index);
    for (const s of source) {
      const key = libraryScreenKey(s.folder.replace(/^\d+-/, ''));
      if (ids.has(key)) { stats.skipped++; continue; }
      const root = parseXml(s.svg);
      const w = parseFloat(root.attrs.width) || 390, h = parseFloat(root.attrs.height) || 844;
      const nodes = xmlToNodes(root.children, { mapAttrs: liquidScreenMapper({ w, h }), resolveUse });
      const created = S.screen.create({ ...this.#own(), key, name: s.caption, label: s.caption, width: w, height: h, category: screenCategory(key), builtin: true,
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
        wf = this.workflows.create({ ...this.#own(), key: def.key, name: def.name, label: def.label, descriptionDev: '' });
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
      const links = def.links === 'subset-of:sample-main-flow' ? main.links.filter(l => placed.has(l[0]) && placed.has(l[1])) : def.links;
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
    for (const wf of this.workflows.list()) if (wf.key === 'sample-main-flow') links.push(...this.workflows.get(wf.id).links);
    for (const [, id] of screenIds) {
      const full = S.screen.get(id);
      if (!full.builtin) continue;
      const icons = [...new Set(full.nodes.filter(e => e.refType === 'icon').map(e => iconKeyById.get(e.refId)).filter(Boolean))];
      const own = links.filter(l => l.fromScreenId === id).map(l => ({ name: l.name, toKey: keyById.get(l.toScreenId) }));
      S.screen.update(id, { descriptionDev: screenDevDescription(full, full.nodes, { icons, links: own }) });
    }
  }
}
