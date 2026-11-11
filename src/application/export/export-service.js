import { ValidationError } from '../../domain/errors.js';
import { nodeBBox } from '../../domain/geometry.js';
import { suffixIds } from '../../domain/svg.js';
import { TYPES } from '../../domain/entities.js';
import { bindMenus } from '../../domain/menu-runtime.js';
import { isMenuItemShown } from '../../domain/menu.js';
import { repeaterPlan, repeaterMarkup, bindRepeaters, bindRepeaterScroll } from '../../domain/repeater.js';
import * as T from './templates.js';
import { projectViewerHtml } from './project-viewer.js';

const stripAnimations = svg => svg.replace(/<style>[\s\S]*?<\/style>/, '');
const stamp = () => new Date().toISOString();
const xml = svg => `<?xml version="1.0" encoding="UTF-8"?>\n${svg}\n`;

/**
 * Export use cases:
 *  - svgFile      one path / icon / button / element / screen as a standalone .svg (animations included)
 *  - buildBundle  selected screens (+ the icons, buttons and elements they use) as a working html/css/ts/js/svg project, in memory
 *  - exportToFolder  buildBundle + write to a folder through the writer port
 */
export class ExportService {
  constructor({ services, workflows, themes, menus, elementScripts = null, render, settings, templates, writer }) {
    Object.assign(this, { services, workflows, themes, menus, elementScripts, render, settings, templates, writer });
  }

  /** Standalone svg of one design. opts: theme, animated (default true), frame (icons), size (icons) */
  svgFile(type, idOrKey, { theme, animated = true, frame = false, size = 192 } = {}) {
    const svc = this.services[type];
    if (!svc) throw new ValidationError(`unknown type ${type}`);
    const d = svc.get(idOrKey);
    const themeKey = theme || this.settings.get().theme;
    // repeaters export their static first frame (the html bundle animates them through its runtime)
    let content = this.render.svg(type, d.id, themeKey, { size, frame, emitIds: true, repeaterMode: 'static' });
    if (!animated) content = stripAnimations(content);
    return { filename: `${d.key}${theme ? `-${theme}` : ''}.svg`, content: xml(content), contentType: 'image/svg+xml' };
  }

  #themes(keys) { return keys?.length ? keys.map(k => this.themes.get(k)) : [this.themes.get(this.settings.get().theme)]; }

  #screenList(ids) {
    const s = this.services.screen;
    if (ids === 'all' || ids === undefined) return s.list().map(x => s.get(x.id));
    if (!Array.isArray(ids) || !ids.length) throw new ValidationError('select at least one screen to export');
    return ids.map(i => s.get(i));
  }

  buildBundle({ screenIds = 'all', themeKeys, includeIcons = 'used', title = 'UI Export' } = {}, internal = null) {
    const themes = this.#themes(themeKeys);
    const primary = themes[0];
    const S = this.services;
    const screenFulls = this.#screenList(screenIds);
    const keyById = new Map(S.screen.list().map(s => [s.id, s.key]));
    const files = [];
    const add = (path, content) => files.push({ path, content });

    const linkRows = this.workflows.linksFromScreens(screenFulls.map(s => s.id));
    const used = { icon: new Set(), button: new Set(), element: new Set() };
    const screenInfos = [];
    const elementById = new Map(S.element.list().map(e => [e.id, e]));

    for (const s of screenFulls) {
      const probe = this.render.context(primary, s.nodes);
      for (const t of Object.keys(used)) probe.lib[t].forEach((_, id) => used[t].add(id));

      const svg = {}, inline = [];
      for (const th of themes) {
        const path = `svg/screens/${th.key}/${s.key}.svg`;
        add(path, xml(this.render.screenSvg(s.id, th.key, { emitIds: true, repeaterMode: 'static' })));
        svg[th.key] = path;
        inline.push(suffixIds(this.render.screenSvg(s.id, th.key, { emitIds: true, standalone: false, repeaterMode: 'runtime' }), th.key).replace('<svg', `<svg data-theme="${th.key}"`));
      }

      const links = linkRows.filter(l => l.fromScreenId === s.id && keyById.has(l.toScreenId)).map(l => {
        const el = l.fromNodeId ? s.nodes.find(e => e.id === l.fromNodeId) : null;
        let hotspot = null;
        if (el) {
          const b = nodeBBox(el, s.nodes), pad = el.tag === 'text' ? 8 : 2;
          hotspot = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: b.w + pad * 2, h: b.h + pad * 2 };
        }
        return { name: l.name, descriptionDev: l.descriptionDev, to: keyById.get(l.toScreenId), trigger: l.trigger, style: l.style, hotspot };
      });

      const components = s.nodes.filter(e => e.kind === 'instance' && ['element', 'button'].includes(e.refType)).map(e => {
        const it = S[e.refType].get(e.refId), a = e.attrs;
        return { name: e.name || it.key, item: it.key, kind: e.refType, htmlTag: e.refType === 'button' ? 'button' : (it.meta?.htmlTag || 'div'), descriptionDev: it.descriptionDev,
          box: { x: Number(a.x) || 0, y: Number(a.y) || 0, w: Number(a.width) || it.width, h: Number(a.height) || it.height } };
      });
      const notes = s.nodes.filter(e => e.name && e.descriptionDev).map(e => ({ name: e.name, descriptionDev: e.descriptionDev }));

      // events & click actions of the screen's elements: route to a screen, open an element/popup/drawer/toolbar, animate/toggle, or go back
      const overlays = new Map(), actions = [];
      for (const n of s.nodes) {
        if (n.visible === false) continue;
        const evList = [];
        if (n.onClick) evList.push({ trigger: 'click', ...n.onClick });
        if (Array.isArray(n.events)) {
          for (const ev of n.events) {
            if (!ev || !ev.type) continue;
            const isDupClick = ev.trigger === 'click' && n.onClick && ev.type === n.onClick.type && (ev.targetId ?? null) === (n.onClick.targetId ?? null);
            if (!isDupClick) evList.push(ev);
          }
        }
        if (!evList.length) continue;
        const b = nodeBBox(n, s.nodes), pad = n.tag === 'text' ? 8 : 2;
        const hotspot = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: b.w + pad * 2, h: b.h + pad * 2 };
        const nodeName = n.name || (n.kind === 'instance' ? S[n.refType]?.get(n.refId)?.key : '') || n.tag;

        for (const c of evList) {
          const triggerMeta = c.trigger && c.trigger !== 'click' ? { trigger: c.trigger } : {};
          const base = { name: nodeName, type: c.type, ...triggerMeta, descriptionDev: n.descriptionDev, hotspot };
          if (c.type === 'screen') {
            const to = keyById.get(c.targetId);
            if (to) actions.push({ ...base, to });
          } else if (c.type === 'popup' || c.type === 'drawer' || c.type === 'element' || c.type === 'toolbar') {
            const el = c.targetId ? elementById.get(c.targetId) : null;
            if (!el && c.type !== 'toolbar') continue; // deleted target element: skip
            if (el) {
              const side = c.type === 'drawer' ? c.side : (c.type === 'toolbar' ? (c.position || 'top') : null);
              const id = `ud-${c.type}-${side ? side + '-' : ''}${el.key}`;
              if (!overlays.has(id)) {
                const full = S.element.get(el.id);
                this.render.context(primary, full.nodes).lib.icon.forEach((_, i) => used.icon.add(i));
                for (const t of ['button', 'element']) this.render.context(primary, full.nodes).lib[t].forEach((_, i) => used[t].add(i));
                used.element.add(el.id);
                overlays.set(id, { id, kind: c.type, side, key: el.key, label: el.label || el.name, width: el.width, height: el.height,
                  svgs: themes.map(th => suffixIds(this.render.boxSvg('element', el.id, th.key, { emitIds: true, standalone: false, repeaterMode: 'runtime' }), `${th.key}-${id}`).replace('<svg', `<svg data-theme="${th.key}"`)) });
              }
              actions.push({ ...base, element: el.key, ...(side ? { side } : {}), overlay: id });
            } else if (c.type === 'toolbar') {
              const side = c.position || 'top';
              actions.push({ ...base, side });
            }
          } else {
            actions.push(base);
          }
        }
      }

      const info = { key: s.key, name: s.name, label: s.label, descriptionDev: s.descriptionDev, width: s.width, height: s.height, category: s.category, device: s.meta?.device || null,
        file: `screens/${s.key}.html`, svg, links, components, actions: actions.map(({ overlay, ...a }) => a) };
      screenInfos.push({ ...info, notes, inline, overlays: [...overlays.values()], actionRows: actions });
    }

    // libraries used by the screens
    const iconIds = includeIcons === 'all' ? S.icon.list().map(i => i.id) : includeIcons === 'none' ? [] : [...used.icon];
    const iconInfos = iconIds.map(id => {
      const ic = S.icon.get(id), file = `svg/icons/${ic.key}.svg`;
      add(file, xml(this.render.glyphSvg('icon', ic.id, primary.key, { size: 96 })));
      return { key: ic.key, label: ic.label, descriptionDev: ic.descriptionDev, file };
    });
    const buttonInfos = [...used.button].map(id => {
      const b = S.button.get(id), file = `svg/buttons/${b.key}.svg`;
      add(file, xml(this.render.boxSvg('button', b.id, primary.key, { emitIds: true })));
      const menu = this.menus.get(b.id);
      const iconKey = iid => (iid != null ? S.icon.get(iid).key : null);
      return { key: b.key, label: b.label, descriptionDev: b.descriptionDev, file,
        menu: menu.items.length ? { config: menu.config, items: menu.items.map(m => ({ path: pathOf(menu.items, m), name: m.name, label: m.label, icon: iconKey(m.iconId), action: m.action,
          target: m.targetScreenId != null ? keyById.get(m.targetScreenId) ?? null : null,
          targetElement: m.targetElementId != null ? elementById.get(m.targetElementId)?.key ?? null : null,
          button: m.refButtonId != null ? (S.button.get(m.refButtonId)?.key ?? null) : null,
          visible: isMenuItemShown(menu.items, m),
          descriptionDev: m.descriptionDev })) } : null };
    });
    const elementInfos = [...used.element].map(id => {
      const e = S.element.get(id), file = `svg/elements/${e.key}.svg`;
      add(file, xml(this.render.boxSvg('element', e.id, primary.key, { emitIds: true, repeaterMode: 'static' })));
      const sc = this.elementScripts?.getByElementId?.(e.id) || null;
      let scriptInfo = null;
      if (sc && sc.enabled && sc.moduleCode) {
        const modFile = `js/elements/${e.key}.mjs`;
        const depsBanner = sc.imports?.length
          ? ` * Public JS dependencies (install locally with exact versions: npm install ${sc.imports.map(im => `${im.package}@${im.version}`).join(' ')}):\n` +
            sc.imports.map(im => ` *   - ${im.specifier} -> ${im.url}${im.integrity ? ` (${im.integrity})` : ''}`).join('\n') + '\n'
          : '';
        add(modFile, `/**\n * Sandboxed element module for "${e.key}" (${sc.runtime}, entry: ${sc.entryExport})\n${depsBanner} */\n${sc.moduleCode}\n`);
        scriptInfo = {
          runtime: sc.runtime,
          entryExport: sc.entryExport,
          moduleFile: modFile,
          codeHash: sc.codeHash,
          imports: sc.imports,
          capabilities: sc.capabilities,
          propsSchema: sc.propsSchema,
          emits: sc.emits,
          reviewStatus: sc.reviewStatus
        };
      }
      return { key: e.key, label: e.label, htmlTag: e.meta?.htmlTag || 'div', descriptionDev: e.descriptionDev, file, ...(scriptInfo ? { script: scriptInfo } : {}) };
    });
    if (iconIds.length) add('svg/sprite.svg', xml(this.render.sprite(primary.key, iconIds)));

    // pages
    for (const s of screenInfos) {
      const { inline, notes, overlays, actionRows, ...info } = s;
      add(info.file, T.screenHtml({ screen: { ...info, key: info.key }, themes, inlineSvgs: inline, links: info.links, components: info.components, actions: actionRows, overlays, primary, title }));
    }
    const thumbs = Object.fromEntries(screenInfos.map(s => [s.key, s.svg[primary.key]]));
    const manifest = {
      generatedAt: stamp(), title,
      themes: themes.map(t => ({ key: t.key, name: t.name, kind: t.kind, tokens: t.tokens })),
      screens: screenInfos.map(({ inline, notes, overlays, actionRows, ...s }) => s), icons: iconInfos, buttons: buttonInfos, elements: elementInfos
    };
    const runtime = bindMenus.toString();
    // repeater containers: the page holds each template once; this runtime repeats it itemCount times with the chosen effect
    const repeaterRuntime = [repeaterPlan, repeaterMarkup, bindRepeaters, bindRepeaterScroll].map(f => f.toString()).join('\n');
    add('index.html', T.indexHtml({ screens: manifest.screens, icons: iconInfos, themes, primary, title, thumbs }));
    add('css/themes.css', T.themesCss(themes));
    add('css/app.css', T.APP_CSS);
    add('js/app.js', T.appJs(runtime, repeaterRuntime));
    add('js/screens.js', T.screensJs(manifest));
    add('ts/app.ts', T.appTs());
    add('ts/menu.ts', T.menuTs(runtime));
    add('ts/repeater.ts', T.repeaterTs(repeaterRuntime));
    add('ts/types.ts', T.TYPES_TS);
    add('ts/screens.ts', T.screensTs(manifest));
    add('tsconfig.json', T.TSCONFIG);
    add('data/manifest.json', JSON.stringify(manifest, null, 2));
    add('DEV-NOTES.md', T.devNotes({ title, screens: screenInfos, icons: iconInfos, buttons: buttonInfos, elements: elementInfos }));
    add('README.md', T.readmeMd(title));

    if (internal) Object.assign(internal, { screenInfos, themes, primary });
    return { files, summary: { screens: screenInfos.length, themes: themes.map(t => t.key), icons: iconInfos.length, buttons: buttonInfos.length, elements: elementInfos.length, files: files.length } };
  }

  /**
   * "Export all project": every workflow of the project and every screen they (and the project) contain, as ONE html file
   * (left 30%: workflows and their screens, right 70%: the interactive screen; css, js, svg, menus and animations inlined).
   * @returns {{filename: string, content: string, contentType: string, summary: object}}
   */
  buildProjectHtml({ projectId, themeKeys, title = 'Project', projectKey = 'project' } = {}) {
    const S = this.services;
    const pid = Number(projectId) || 1;
    const wfRows = this.workflows.list({ projectId: pid, includePublic: pid === 1 }).filter(w => Number(w.projectId ?? pid) === pid);
    const screenIds = [];
    const addScreen = id => { if (id != null && !screenIds.includes(id) && (() => { try { return S.screen.get(id); } catch { return null; } })()) screenIds.push(id); };
    const workflows = wfRows.map(w => {
      const full = this.workflows.get(w.id);
      const ids = [...(full.nodes || [])].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0)).map(n => n.screenId);
      ids.forEach(addScreen);
      return { key: full.key, name: full.name, label: full.label, descriptionDev: full.descriptionDev, ids };
    });
    S.screen.list({ projectId: pid, includePublic: pid === 1, includePrivate: false }).forEach(s => addScreen(s.id));
    if (!screenIds.length) throw new ValidationError('this project has no screens to export');
    // design style switch: the active theme plus its light/dark counterpart (every theme would multiply the file size)
    if (!themeKeys?.length) {
      const cur = this.settings.get().theme, all = new Set(this.themes.list().map(t => t.key));
      const alt = /-dark$/.test(cur) ? cur.replace(/-dark$/, '-light') : /-light$/.test(cur) ? cur.replace(/-light$/, '-dark') : `${cur}-light`;
      themeKeys = all.has(alt) && alt !== cur ? [cur, alt] : [cur];
    } else if (themeKeys.length === 1 && themeKeys[0] === 'all') themeKeys = this.themes.list().map(t => t.key);
    const internal = {};
    this.buildBundle({ screenIds, themeKeys, includeIcons: 'none', title }, internal);
    const keyById = new Map(internal.screenInfos.map((info, i) => [screenIds[i], info.key]));
    const screens = internal.screenInfos.map(info => ({
      key: info.key, name: info.name, label: info.label, descriptionDev: info.descriptionDev, width: info.width, height: info.height, device: info.device, links: info.links,
      parts: T.screenParts({ screen: info, inlineSvgs: info.inline, links: info.links, components: info.components, actions: info.actionRows, overlays: info.overlays })
    }));
    // every device template (built-in + custom) so the screens can be inspected on each of them
    let devices;
    try { devices = this.templates?.devicesMap?.(); } catch { devices = undefined; }
    const content = projectViewerHtml({
      devices, title, themes: internal.themes, primary: internal.primary, screens,
      workflows: workflows.map(w => ({ ...w, screens: w.ids.map(id => keyById.get(id)).filter(Boolean) })).filter(w => w.screens.length),
      menuRuntime: bindMenus.toString(), repeaterRuntime: [repeaterPlan, repeaterMarkup, bindRepeaters, bindRepeaterScroll].map(f => f.toString()).join('\n')
    });
    return { filename: `${projectKey}-project.html`, content, contentType: 'text/html; charset=utf-8', summary: { workflows: workflows.length, screens: screens.length, bytes: Buffer.byteLength(content) } };
  }

  /** Builds the bundle and writes it into `folder` (created if needed). */
  exportToFolder(options, folder) {
    if (!folder || typeof folder !== 'string') throw new ValidationError('an export folder is required');
    const { files, summary } = this.buildBundle(options);
    const written = this.writer.write(files, folder);
    return { ...summary, folder: written.folder };
  }
}

function pathOf(items, m) {
  const parts = [m.name];
  for (let p = m.parentId; p != null; p = items.find(i => i.id === p)?.parentId) parts.unshift(items.find(i => i.id === p).name);
  return parts.join('/');
}

export { TYPES };
