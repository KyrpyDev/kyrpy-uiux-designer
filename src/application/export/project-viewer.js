/**
 * Single-file project viewer ("Export all project"): every workflow and every screen of a project in ONE html file.
 * Left panel (30%): workflows with their screens. Right panel (70%): the selected screen, interactive: workflow links,
 * click/event actions, popups and drawers, button menus (hub / radial / popup / drawer / slider / carousel) with their
 * animations, repeaters. All css and js are inlined; no network, no server, no other files.
 */
import { themesCss, APP_CSS, screenParts } from './templates.js';
import { resolveTokens } from '../../domain/theme.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** JSON for a <script type="application/json"> block: "<" is escaped so the data can never close the tag. */
const jsonForScript = v => JSON.stringify(v).replace(/</g, String.fromCharCode(92) + 'u003c').split(String.fromCharCode(0x2028)).join(String.fromCharCode(92) + 'u2028').split(String.fromCharCode(0x2029)).join(String.fromCharCode(92) + 'u2029');

export const VIEWER_CSS = `
html, body { height: 100%; }
body { overflow: hidden; }
.pv { display: flex; height: 100vh; }
.pv-left { flex: 0 0 30%; max-width: 30%; min-width: 220px; display: flex; flex-direction: column; border-right: 1px solid var(--ud-line); background: var(--ud-panel); }
.pv-right { flex: 1 1 70%; min-width: 0; display: flex; flex-direction: column; }
.pv-head { padding: 12px 14px; border-bottom: 1px solid var(--ud-line); display: flex; flex-direction: column; gap: 8px; }
.pv-head h1 { font-size: 15px; margin: 0; }
.pv-head small { color: var(--ud-muted); }
.pv-head input, .pv-head select, .pv-bar select { font: inherit; color: var(--ud-text); background: var(--ud-field); border: 1px solid var(--ud-line); border-radius: 8px; padding: 6px 10px; width: 100%; }
.pv-tree { overflow: auto; flex: 1; padding: 6px 8px 24px; }
.pv-wf { margin: 4px 0; border: 1px solid var(--ud-line); border-radius: 12px; background: var(--ud-field); }
.pv-wf > summary { cursor: pointer; padding: 9px 12px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 8px; }
.pv-wf > summary::-webkit-details-marker { display: none; }
.pv-wf > summary::before { content: '▸'; color: var(--ud-muted); transition: transform .15s; }
.pv-wf[open] > summary::before { transform: rotate(90deg); }
.pv-wf > summary small { margin-left: auto; color: var(--ud-muted); font-weight: 400; }
.pv-screens { display: flex; flex-direction: column; padding: 0 6px 8px; gap: 2px; }
.pv-screen { text-align: left; font: inherit; color: var(--ud-text); background: transparent; border: 1px solid transparent; border-radius: 8px; padding: 6px 10px; cursor: pointer; display: flex; gap: 8px; align-items: baseline; }
.pv-screen:hover { background: var(--ud-panel); }
.pv-screen.on { border-color: var(--ud-accent); background: var(--ud-panel); }
.pv-screen small { color: var(--ud-muted); margin-left: auto; white-space: nowrap; }
.pv-bar { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--ud-line); background: var(--ud-panel); }
.pv-bar b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-bar button { font: inherit; color: var(--ud-text); background: var(--ud-field); border: 1px solid var(--ud-line); border-radius: 8px; padding: 5px 12px; cursor: pointer; }
.pv-bar button:disabled { opacity: .4; cursor: default; }
.pv-bar select { width: auto; }
.pv-canvas { flex: 1; min-height: 0; overflow: auto; display: flex; justify-content: center; align-items: flex-start; padding: 18px; background: radial-gradient(circle at 1px 1px, var(--ud-line) 1px, transparent 0) 0 0 / 22px 22px; }
.pv-stage { display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap; justify-content: center; }
.pv-stage .ud-device { flex: none; }
.pv-info { max-height: 34%; overflow: auto; border-top: 1px solid var(--ud-line); background: var(--ud-panel); padding: 8px 14px 12px; display: none; }
.pv-info.open { display: block; }
.pv-info h2 { font-size: 12px; margin: 8px 0 6px; color: var(--ud-muted); text-transform: uppercase; letter-spacing: .05em; }
.pv-links { display: flex; flex-wrap: wrap; gap: 8px; }
.pv-links button { font: inherit; color: var(--ud-text); background: var(--ud-field); border: 1px solid var(--ud-line); border-radius: 10px; padding: 6px 12px; cursor: pointer; text-align: left; }
.pv-links small { display: block; color: var(--ud-muted); }
.pv-toast { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); background: var(--ud-panel); color: var(--ud-text); border: 1px solid var(--ud-accent); border-radius: 10px; padding: 8px 14px; font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 80; }
.pv-toast.show { opacity: 1; }
.pv-empty { color: var(--ud-muted); padding: 40px; text-align: center; }
@media (max-width: 760px) { .pv { flex-direction: column; } .pv-left { flex: 0 0 38%; max-width: none; width: 100%; border-right: 0; border-bottom: 1px solid var(--ud-line); } }
`;

/** The viewer's runtime, plain ES5 (no template literals): navigation, overlays, menu + repeater runtimes injected by the exporter. */
export function viewerJs(menuRuntime, repeaterRuntime) {
  return `(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('pv-data').textContent);
  var themes = DATA.themes, screens = DATA.screens, byKey = {};
  screens.forEach(function (s) { byKey[s.key] = s; });
  var root = document.documentElement, stage = document.getElementById('pv-stage'), canvas = document.getElementById('pv-canvas');
  var title = document.getElementById('pv-title'), info = document.getElementById('pv-info'), linksBox = document.getElementById('pv-links'), devBox = document.getElementById('pv-dev');
  var prevBtn = document.getElementById('pv-prev'), nextBtn = document.getElementById('pv-next'), wfSel = null;
  var cur = { screen: null, wf: null }, history = [], toastTimer = null;

  function toast(msg) {
    var t = document.getElementById('pv-toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  // theme
  var themeSel = document.getElementById('pv-theme');
  var saved = null; try { saved = localStorage.getItem('ud-theme'); } catch (e) {}
  if (saved && themes.some(function (t) { return t.key === saved; })) root.setAttribute('data-theme', saved);
  if (themeSel) {
    if (themes.length < 2) themeSel.parentNode.style.display = 'none';
    themes.forEach(function (t) { var o = document.createElement('option'); o.value = t.key; o.textContent = t.name; themeSel.appendChild(o); });
    themeSel.value = root.getAttribute('data-theme');
    themeSel.addEventListener('change', function () { root.setAttribute('data-theme', themeSel.value); try { localStorage.setItem('ud-theme', themeSel.value); } catch (e) {} fit(); });
  }

  // runtimes shared with the designer preview and the multi-file export
  var bindMenus = ${menuRuntime};
  ${repeaterRuntime}
  var menus = bindMenus(stage, { onAction: function (a) {
    if (a.target && byKey[a.target]) { go(a.target); return; }
    toast('Menu action: ' + (a.action || a.item || 'item'));
  } });

  function fit() {
    var dev = stage.querySelector('.ud-device'); var s = byKey[cur.screen];
    if (!dev || !s) return;
    var availW = canvas.clientWidth - 36, availH = canvas.clientHeight - 36;
    var w = Math.max(160, Math.min(s.width, availW, availH * s.width / s.height));
    stage.style.setProperty('--ud-device-w', w + 'px');
    stage.querySelectorAll('.ud-device').forEach(function (d) { if (d === dev) d.style.setProperty('--ud-device-w', w + 'px'); });
  }
  window.addEventListener('resize', fit);

  function wfOf(key) { for (var i = 0; i < DATA.workflows.length; i++) if (DATA.workflows[i].screens.indexOf(key) >= 0) return DATA.workflows[i]; return null; }
  function order() { var w = cur.wf ? DATA.workflows.filter(function (x) { return x.key === cur.wf; })[0] : null; return w ? w.screens : screens.map(function (s) { return s.key; }); }

  function go(key, opts) {
    opts = opts || {};
    var s = byKey[key], tpl = document.getElementById('t-' + key);
    if (!s || !tpl) return;
    if (cur.screen && cur.screen !== key && !opts.back) history.push({ screen: cur.screen, wf: cur.wf });
    if (opts.wf !== undefined) cur.wf = opts.wf;
    else if (!cur.wf || DATA.workflows.filter(function (w) { return w.key === cur.wf && w.screens.indexOf(key) >= 0; }).length === 0) { var w = wfOf(key); cur.wf = w ? w.key : null; }
    cur.screen = key;
    closeOverlay();
    stage.innerHTML = '';
    stage.appendChild(tpl.content.cloneNode(true));
    bindRepeaters(stage);
    stage.querySelectorAll('.ud-btn').forEach(function (b) { menus.apply(b, menus.get(b)); });
    title.textContent = (s.label || s.name) + (cur.wf ? '  ·  ' + DATA.workflows.filter(function (w) { return w.key === cur.wf; })[0].name : '');
    document.querySelectorAll('.pv-screen').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-screen') === key && (b.getAttribute('data-wf') || '') === (cur.wf || '')); });
    var list = order(), i = list.indexOf(key);
    prevBtn.disabled = i <= 0; nextBtn.disabled = i < 0 || i >= list.length - 1;
    // links of this screen + developer notes
    linksBox.innerHTML = '';
    (s.links || []).forEach(function (l) {
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = '<strong></strong><small></small>'; b.firstChild.textContent = l.name || l.to; b.lastChild.textContent = '→ ' + (byKey[l.to] ? (byKey[l.to].label || byKey[l.to].name) : l.to) + ' · ' + l.trigger;
      b.addEventListener('click', function () { go(l.to); }); linksBox.appendChild(b);
    });
    if (!(s.links || []).length) linksBox.innerHTML = '<small>No outgoing links.</small>';
    devBox.textContent = s.descriptionDev || '';
    canvas.scrollTop = 0; fit();
    try { location.hash = key; } catch (e) {}
  }
  function back() { var h = history.pop(); if (h) go(h.screen, { back: true, wf: h.wf }); else toast('Nothing to go back to'); }
  function step(d) { var list = order(), i = list.indexOf(cur.screen) + d; if (i >= 0 && i < list.length) go(list[i], { wf: cur.wf }); }
  prevBtn.addEventListener('click', function () { step(-1); }); nextBtn.addEventListener('click', function () { step(1); });
  document.getElementById('pv-info-toggle').addEventListener('click', function () { info.classList.toggle('open'); fit(); });

  // popups, drawers, inline elements and toolbars of the screen
  var openOverlay = null, returnTo = null;
  function closeOverlay() { if (!openOverlay) return false; openOverlay.hidden = true; openOverlay = null; if (returnTo && returnTo.focus) returnTo.focus(); returnTo = null; return true; }
  function trigger(t) {
    if (!t) return;
    if (t.hasAttribute('data-ud-close')) { closeOverlay(); return; }
    if (t.hasAttribute('data-ud-back')) { back(); return; }
    if (t.hasAttribute('data-ud-toggle')) { t.classList.toggle('ud-on'); return; }
    var href = t.getAttribute('data-ud-href') || '';
    if (href) { var k = href.replace(/\\.html$/, ''); if (byKey[k]) go(k); else toast('Target screen is not part of this export'); return; }
    var o = document.getElementById(t.getAttribute('data-ud-open'));
    if (!o) return;
    closeOverlay(); o.hidden = false; openOverlay = o; returnTo = t;
    var c = o.querySelector('.ud-close'); if (c) c.focus();
  }
  // screen links are <a href="key.html">: never navigate away from this single file
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a.ud-hotspot, a.ud-ctl') : null;
    if (a) {
      ev.preventDefault();
      // workflow link hotspots are plain <a href="<screen-key>.html">: open that screen inside the viewer
      var h = a.getAttribute('href') || '', tr = a.getAttribute('data-trigger') || 'click';
      if (/\\.html$/.test(h) && !a.hasAttribute('data-ud-href') && (tr === 'click' || tr === 'tap')) {
        var k = h.replace(/\\.html$/, '');
        if (byKey[k]) go(k); else toast('Target screen is not part of this export');
        return;
      }
    }
    var t = ev.target && ev.target.closest ? ev.target.closest('[data-ud-open], [data-ud-close], [data-ud-back], [data-ud-toggle], [data-ud-href]') : null;
    if (t && stage.contains(t) || (t && t.closest && t.closest('.ud-overlay'))) {
      var trig = t.getAttribute('data-trigger') || 'click';
      if (trig === 'click' || t.hasAttribute('data-ud-close')) trigger(t);
      return;
    }
    // click-triggered animations: toggle .ud-on on the animated element that was clicked
    var an = ev.target && ev.target.closest ? ev.target.closest('[class*="ud-e"]') : null;
    if (an && stage.contains(an)) an.classList.toggle('ud-on');
  }, true);
  ['dblclick', 'mouseover', 'mouseleave', 'mousedown', 'mouseup', 'dragstart', 'drop', 'focus'].forEach(function (domEv) {
    var mapTrig = domEv === 'mouseup' ? 'release' : (domEv === 'dragstart' ? 'drag' : domEv);
    document.addEventListener(domEv, function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-trigger="' + mapTrig + '"]') : null;
      if (t && stage.contains(t)) trigger(t);
    }, true);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|select|textarea/i.test(ev.target.tagName)) return;
    if (ev.key === 'Escape') closeOverlay();
    else if (ev.key === 'ArrowRight' || ev.key === 'PageDown') step(1);
    else if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { if (ev.altKey) back(); else step(-1); }
  });

  // left panel: tree + search
  var tree = document.getElementById('pv-tree');
  function row(key, wfKey, idx) {
    var s = byKey[key]; if (!s) return null;
    var b = document.createElement('button'); b.type = 'button'; b.className = 'pv-screen'; b.setAttribute('data-screen', key); b.setAttribute('data-wf', wfKey || '');
    b.setAttribute('data-search', ((s.label || '') + ' ' + (s.name || '') + ' ' + key).toLowerCase());
    var n = document.createElement('span'); n.textContent = (s.label || s.name); var m = document.createElement('small'); m.textContent = (idx != null ? (idx + 1) + ' · ' : '') + s.width + '×' + s.height;
    b.appendChild(n); b.appendChild(m); b.addEventListener('click', function () { go(key, { wf: wfKey || null }); }); return b;
  }
  function group(name, keys, wfKey, open, count) {
    var d = document.createElement('details'); d.className = 'pv-wf'; if (open) d.open = true;
    var sm = document.createElement('summary'); var t = document.createElement('span'); t.textContent = name; var c = document.createElement('small'); c.textContent = count + ' screen' + (count === 1 ? '' : 's');
    sm.appendChild(t); sm.appendChild(c); d.appendChild(sm);
    var box = document.createElement('div'); box.className = 'pv-screens';
    keys.forEach(function (k, i) { var r = row(k, wfKey, i); if (r) box.appendChild(r); }); d.appendChild(box); return d;
  }
  var assigned = {};
  DATA.workflows.forEach(function (w, i) { w.screens.forEach(function (k) { assigned[k] = 1; }); tree.appendChild(group(w.label || w.name, w.screens, w.key, i === 0, w.screens.length)); });
  var loose = screens.map(function (s) { return s.key; }).filter(function (k) { return !assigned[k]; });
  if (loose.length) tree.appendChild(group('Screens outside workflows', loose, '', !DATA.workflows.length, loose.length));
  document.getElementById('pv-search').addEventListener('input', function (e) {
    var q = e.target.value.toLowerCase();
    tree.querySelectorAll('.pv-screen').forEach(function (b) { b.style.display = !q || b.getAttribute('data-search').indexOf(q) >= 0 ? '' : 'none'; });
    if (q) tree.querySelectorAll('details').forEach(function (d) { d.open = true; });
  });

  var start = (location.hash || '').replace('#', '');
  var first = byKey[start] ? start : (DATA.workflows[0] && DATA.workflows[0].screens[0]) || (screens[0] && screens[0].key);
  if (first) go(first, { wf: byKey[start] ? undefined : (DATA.workflows[0] ? DATA.workflows[0].key : null) });
  else stage.innerHTML = '<div class="pv-empty">This project has no screens yet.</div>';
})();
`;
}

/**
 * @param {{title: string, themes: object[], primary: object, workflows: {key,name,label,descriptionDev,screens: string[]}[],
 *          screens: {key,name,label,descriptionDev,width,height,links,parts}[], menuRuntime: string, repeaterRuntime: string}} p
 */
export function projectViewerHtml({ title, themes, primary, workflows, screens, menuRuntime, repeaterRuntime }) {
  const data = {
    title,
    themes: themes.map(t => ({ key: t.key, name: t.name })),
    workflows: workflows.map(w => ({ key: w.key, name: w.name, label: w.label, descriptionDev: w.descriptionDev, screens: w.screens })),
    screens: screens.map(s => ({ key: s.key, name: s.name, label: s.label, descriptionDev: s.descriptionDev, width: s.width, height: s.height,
      links: (s.links || []).map(l => ({ name: l.name, to: l.to, trigger: l.trigger })) }))
  };
  const templates = screens.map(s => `<template id="t-${esc(s.key)}">${s.parts.device}\n${s.parts.overlays}</template>`).join('\n');
  const bg = resolveTokens('{{bg}}', primary.tokens);
  return `<!doctype html>
<html lang="en" data-theme="${esc(primary.key)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · project viewer</title>
<style>
${themesCss(themes)}
${APP_CSS}
${VIEWER_CSS}
</style>
</head>
<body style="background:${esc(bg)}">
<div class="pv">
  <aside class="pv-left" aria-label="Workflows">
    <div class="pv-head">
      <h1>${esc(title)}</h1>
      <small>${workflows.length} workflow(s) · ${screens.length} screen(s)</small>
      <input id="pv-search" type="search" placeholder="Search screens…" aria-label="Search screens">
      <label>Theme <select id="pv-theme"></select></label>
    </div>
    <nav class="pv-tree" id="pv-tree"></nav>
  </aside>
  <main class="pv-right">
    <div class="pv-bar">
      <button type="button" id="pv-prev" aria-label="Previous screen">‹ Prev</button>
      <b id="pv-title"></b>
      <button type="button" id="pv-next" aria-label="Next screen">Next ›</button>
      <button type="button" id="pv-info-toggle" aria-label="Links and notes">ⓘ</button>
    </div>
    <div class="pv-canvas" id="pv-canvas"><div class="pv-stage" id="pv-stage"></div></div>
    <div class="pv-info" id="pv-info"><h2>Navigation</h2><div class="pv-links" id="pv-links"></div><h2>description-dev</h2><div class="ud-dev" id="pv-dev"></div></div>
  </main>
</div>
<div class="pv-toast" id="pv-toast" role="status"></div>
<script type="application/json" id="pv-data">${jsonForScript(data)}</script>
${templates}
<script>
${viewerJs(menuRuntime, repeaterRuntime)}
</script>
</body>
</html>
`;
}
