/**
 * Single-file project viewer ("Export all project"): every workflow and every screen of a project in ONE html file.
 * Left panel (30%): workflows with their screens. Right panel (70%): the selected screen, interactive: workflow links,
 * click/event actions, popups and drawers, button menus (hub / radial / popup / drawer / slider / carousel) with their
 * animations, repeaters. All css and js are inlined; no network, no server, no other files.
 */
import { themesCss, APP_CSS, screenParts } from './templates.js';
import { resolveTokens } from '../../domain/theme.js';
import { DEVICES } from '../../domain/entities.js';

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

/* scrollbars of the workflow list and the canvas: visible, thin, themed */
.pv-tree, .pv-canvas, .pv-info { scrollbar-width: thin; scrollbar-color: var(--ud-accent) transparent; }
.pv-tree::-webkit-scrollbar, .pv-canvas::-webkit-scrollbar, .pv-info::-webkit-scrollbar { width: 10px; height: 10px; }
.pv-tree::-webkit-scrollbar-track, .pv-canvas::-webkit-scrollbar-track, .pv-info::-webkit-scrollbar-track { background: transparent; }
.pv-tree::-webkit-scrollbar-thumb, .pv-canvas::-webkit-scrollbar-thumb, .pv-info::-webkit-scrollbar-thumb { background: var(--ud-line); border-radius: 8px; border: 2px solid transparent; background-clip: content-box; }
.pv-tree::-webkit-scrollbar-thumb:hover, .pv-canvas::-webkit-scrollbar-thumb:hover { background: var(--ud-accent); background-clip: content-box; }
/* the bar between the two panels is draggable (scalable) */
.pv-split { flex: 0 0 6px; cursor: col-resize; background: transparent; margin-left: -3px; margin-right: -3px; z-index: 5; position: relative; }
.pv-split:hover, .pv-split.drag { background: var(--ud-accent); opacity: .5; }
.pv-left { flex: 0 0 var(--pv-left-w, 30%); max-width: 70%; }
.pv-tools { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pv-tools label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--ud-muted); }
.pv-tools select { font: inherit; font-size: 12px; max-width: 150px; color: var(--ud-text); background: var(--ud-field); border: 1px solid var(--ud-line); border-radius: 8px; padding: 4px 8px; }
/* device templates: a frame around the screen */
.pv-frame { position: relative; flex: none; background: #0b0d12; box-shadow: 0 0 0 2px #2a2f3a, 0 18px 50px rgba(0,0,0,.55); padding: var(--pv-pad, 12px); border-radius: calc(var(--pv-r, 40px) + var(--pv-pad, 12px)); box-sizing: content-box; }
.pv-frame > .ud-device { border-radius: var(--pv-r, 40px); overflow: hidden; }
.pv-frame[data-frame="iphone"] { --pv-pad: 12px; }
.pv-frame[data-frame="iphone"]::before { content: ''; position: absolute; z-index: 4; top: calc(var(--pv-pad) + 10px); left: 50%; width: 30%; height: 26px; transform: translateX(-50%); background: #000; border-radius: 20px; pointer-events: none; }
.pv-frame[data-frame="iphone"]::after, .pv-frame[data-frame="android"]::after { content: ''; position: absolute; z-index: 4; bottom: calc(var(--pv-pad) + 7px); left: 50%; width: 34%; height: 5px; transform: translateX(-50%); background: rgba(255,255,255,.6); border-radius: 4px; pointer-events: none; }
.pv-frame[data-frame="android"] { --pv-pad: 9px; }
.pv-frame[data-frame="android"]::before { content: ''; position: absolute; z-index: 4; top: calc(var(--pv-pad) + 9px); left: 50%; width: 12px; height: 12px; transform: translateX(-50%); background: #000; border-radius: 50%; pointer-events: none; }
.pv-frame[data-frame="tablet"] { --pv-pad: 16px; --pv-r: 22px; }
.pv-frame[data-frame="tablet"]::before { content: ''; position: absolute; z-index: 4; top: 6px; left: 50%; width: 7px; height: 7px; transform: translateX(-50%); background: #1c2029; border-radius: 50%; }
.pv-frame[data-frame="desktop"] { --pv-pad: 0; --pv-r: 0; border-radius: 10px; padding-top: 30px; }
.pv-frame[data-frame="desktop"]::before { content: ''; position: absolute; top: 10px; left: 12px; width: 10px; height: 10px; border-radius: 50%; background: #ff5f57; box-shadow: 16px 0 #febc2e, 32px 0 #28c840; }
.pv-frame[data-frame="desktop"] > .ud-device { border-radius: 0 0 10px 10px; }
.pv-frame[data-frame="watch"] { --pv-pad: 14px; --pv-r: 44px; }
.pv-frame[data-frame="none"] { box-shadow: none; background: transparent; padding: 0; border-radius: 0; }
.ud-btn, .rm-item { cursor: pointer; }
.ud-btn:active { transform: scale(.96); }
[data-btn-style="flat"] .rm-item :is(rect,circle,path):first-child, [data-btn-style="flat"] .ud-btn :is(rect,circle):first-of-type { filter: none; stroke: none; }
[data-btn-style="outline"] .rm-item :is(rect,circle):first-of-type, [data-btn-style="outline"] .ud-btn :is(rect,circle):first-of-type { fill: transparent; stroke: var(--ud-accent); stroke-width: 2px; }
[data-btn-style="solid"] .rm-item :is(rect,circle):first-of-type, [data-btn-style="solid"] .ud-btn :is(rect,circle):first-of-type { fill: var(--ud-accent); stroke: none; }
[data-btn-style="pill"] .rm-item rect:first-of-type, [data-btn-style="pill"] .ud-btn rect:first-of-type { rx: 999px; ry: 999px; }
[data-btn-style="square"] .rm-item rect:first-of-type, [data-btn-style="square"] .ud-btn rect:first-of-type { rx: 4px; ry: 4px; }
[data-btn-style="glow"] .rm-item, [data-btn-style="glow"] .ud-btn { filter: drop-shadow(0 0 6px var(--ud-accent)); }
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
  function findOverlay(key) {
    if (!key) return null;
    var all = document.querySelectorAll('.ud-overlay'), k = String(key).toLowerCase();
    for (var i = 0; i < all.length; i++) { var id = all[i].id.toLowerCase(); if (id === k || id.slice(-(k.length + 1)) === '-' + k) return all[i]; }
    return null;
  }
  function openOv(o, from) { if (!o) return false; closeOverlay(); o.hidden = false; openOverlay = o; returnTo = from || null; var ac = Number(o.getAttribute('data-ud-autoclose')) || 0; if (ac > 0) autoTimer = setTimeout(function () { if (openOverlay === o) closeOverlay(); }, ac * 1000); var c = o.querySelector('.ud-close'); if (c) c.focus(); return true; }
  var menus = bindMenus(stage, { onAction: function (a) {
    var act = a.action || '';
    if (a.target && byKey[a.target]) { go(a.target); return; }
    if (a.targetElement || a.targetElementId) { if (openOv(findOverlay(a.targetElement) || findOverlay(a.targetElementId))) return; }
    if (act === 'back') { back(); return; }
    if (act === 'close') { closeOverlay(); return; }
    toast('Menu action: ' + (act || a.item || 'item'));
  } });

  // device templates: a frame (iphone, android, tablet, desktop, watch) around the screen
  var devSel = document.getElementById('pv-device'), btnSel = document.getElementById('pv-btnstyle'), frameChoice = 'auto';
  var FRAMES = { mobile: 'iphone', tablet: 'tablet', desktop: 'desktop', kiosk: 'tablet', wearable: 'watch' };
  function frameKind(s) {
    var k = frameChoice === 'auto' ? (s.device || '') : frameChoice;
    if (k === 'none') return 'none';
    var d = DATA.devices[k] || {};
    if (/android|pixel|galaxy/.test(k)) return 'android';
    return FRAMES[d.category] || 'iphone';
  }
  /** the device being inspected: the chosen template, else the screen's own (auto) */
  function devOf(s) { return frameChoice === 'auto' ? null : DATA.devices[frameChoice] || null; }
  function applyFrame(s) {
    var dev = stage.querySelector(':scope > .ud-device'); if (!dev) return;
    var kind = frameKind(s), f = document.createElement('div'); f.className = 'pv-frame'; f.setAttribute('data-frame', kind);
    var d = DATA.devices[frameChoice === 'auto' ? s.device : frameChoice]; if (d && d.cornerRadius) f.style.setProperty('--pv-r', Math.round(d.cornerRadius * Math.min(1, s.width / d.width)) + 'px');
    dev.parentNode.insertBefore(f, dev); f.appendChild(dev);
  }
  if (devSel) {
    var o0 = document.createElement('option'); o0.value = 'auto'; o0.textContent = 'Device: screen default'; devSel.appendChild(o0);
    [['none', 'No frame']].forEach(function (p) { var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; devSel.appendChild(o); });
    Object.keys(DATA.devices).forEach(function (k) { var d = DATA.devices[k], o = document.createElement('option'); o.value = k; o.textContent = d.name + ' (' + d.width + '×' + d.height + ')'; devSel.appendChild(o); });
    try { var sd = localStorage.getItem('ud-pv-device'); if (sd && devSel.querySelector('option[value="' + sd + '"]')) { devSel.value = sd; frameChoice = sd; } } catch (e) {}
    devSel.addEventListener('change', function () { frameChoice = devSel.value; try { localStorage.setItem('ud-pv-device', frameChoice); } catch (e) {} if (cur.screen) go(cur.screen, { back: true, keep: true }); });
  }
  if (btnSel) {
    [['', 'Button style: theme'], ['flat', 'Flat'], ['outline', 'Outline'], ['solid', 'Solid'], ['pill', 'Pill'], ['square', 'Square'], ['glow', 'Glow']].forEach(function (p) { var o = document.createElement('option'); o.value = p[0]; o.textContent = p[1]; btnSel.appendChild(o); });
    try { var sb = localStorage.getItem('ud-pv-btn'); if (sb && btnSel.querySelector('option[value="' + sb + '"]')) btnSel.value = sb; } catch (e) {}
    var setBtn = function () { if (btnSel.value) stage.setAttribute('data-btn-style', btnSel.value); else stage.removeAttribute('data-btn-style'); document.querySelectorAll('.ud-overlay').forEach(function (o) { if (btnSel.value) o.setAttribute('data-btn-style', btnSel.value); else o.removeAttribute('data-btn-style'); }); try { localStorage.setItem('ud-pv-btn', btnSel.value); } catch (e) {} };
    btnSel.addEventListener('change', setBtn); setBtn();
  }

  function fit() {
    var dev = stage.querySelector('.ud-device'); var s = byKey[cur.screen];
    if (!dev || !s) return;
    var fr = dev.closest('.pv-frame'), padW = fr ? 80 : 0;
    var availW = canvas.clientWidth - 36 - padW, availH = canvas.clientHeight - 36 - padW;
    var td = devOf(s), w;
    if (td && fr) {
      // inspect the screen on another device: the frame has that device's size and shape, the screen is scaled to fit inside it
      var k = Math.min(availW / td.width, availH / td.height, 1.6), bw = td.width * k, bh = td.height * k;
      var sk = Math.min(bw / s.width, bh / s.height);
      w = Math.max(60, s.width * sk);
      fr.style.width = bw + 'px'; fr.style.height = bh + 'px'; fr.style.display = 'flex'; fr.style.alignItems = 'center'; fr.style.justifyContent = 'center';
    } else {
      w = Math.max(160, Math.min(s.width, availW, availH * s.width / s.height));
      if (fr) { fr.style.width = ''; fr.style.height = ''; fr.style.display = ''; }
    }
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
    if (cur.screen && cur.screen !== key && !opts.back && !opts.keep) history.push({ screen: cur.screen, wf: cur.wf });
    if (opts.wf !== undefined) cur.wf = opts.wf;
    else if (!cur.wf || DATA.workflows.filter(function (w) { return w.key === cur.wf && w.screens.indexOf(key) >= 0; }).length === 0) { var w = wfOf(key); cur.wf = w ? w.key : null; }
    cur.screen = key;
    closeOverlay();
    stage.innerHTML = '';
    stage.appendChild(tpl.content.cloneNode(true));
    applyFrame(s);
    if (btnSel && btnSel.value) document.querySelectorAll('.ud-overlay').forEach(function (o) { o.setAttribute('data-btn-style', btnSel.value); });
    bindRepeaters(stage);
    bindRepeaterScroll(stage);   // once per stage: wheel / drag inside a repeater scrolls its copies
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
  var openOverlay = null, returnTo = null, autoTimer = null;
  function closeOverlay() { clearTimeout(autoTimer); autoTimer = null; if (!openOverlay) return false; openOverlay.hidden = true; openOverlay = null; if (returnTo && returnTo.focus) returnTo.focus(); returnTo = null; return true; }
  function trigger(t) {
    if (!t) return;
    if (t.hasAttribute('data-ud-close')) { closeOverlay(); return; }
    if (t.hasAttribute('data-ud-back')) { back(); return; }
    if (t.hasAttribute('data-ud-toggle')) { t.classList.toggle('ud-on'); return; }
    var href = t.getAttribute('data-ud-href') || '';
    if (href) { var k = href.replace(/\\.html$/, ''); if (byKey[k]) go(k); else toast('Target screen is not part of this export'); return; }
    openOv(document.getElementById(t.getAttribute('data-ud-open')), t);
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
  ['dblclick', 'mouseover', 'mouseleave', 'mousedown', 'mouseup', 'dragstart', 'drop', 'focus', 'contextmenu'].forEach(function (domEv) {
    var mapTrig = domEv === 'mouseup' ? 'release' : (domEv === 'dragstart' ? 'drag' : domEv);
    document.addEventListener(domEv, function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-trigger="' + mapTrig + '"]') : null;
      if (!t && domEv === 'contextmenu' && ev.target && ev.target.closest) t = ev.target.closest('[data-trigger="rightclick"]');
      if (t && stage.contains(t)) { if (domEv === 'contextmenu') ev.preventDefault(); trigger(t); }
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

  // draggable bar between the workflow list and the screen
  var split = document.getElementById('pv-split'), leftP = document.querySelector('.pv-left');
  if (split && leftP) {
    split.addEventListener('mousedown', function (ev) {
      ev.preventDefault(); split.classList.add('drag');
      var move = function (e) { var w = Math.max(220, Math.min(window.innerWidth * 0.7, e.clientX)); leftP.style.setProperty('--pv-left-w', w + 'px'); fit(); };
      var up = function () { split.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }

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
export function projectViewerHtml({ title, themes, primary, workflows, screens, menuRuntime, repeaterRuntime, devices = DEVICES }) {
  const data = {
    title,
    themes: themes.map(t => ({ key: t.key, name: t.name })),
    workflows: workflows.map(w => ({ key: w.key, name: w.name, label: w.label, descriptionDev: w.descriptionDev, screens: w.screens })),
    devices: Object.fromEntries(Object.entries(devices || DEVICES).map(([k, d]) => [k, { name: d.name, width: d.width, height: d.height, category: d.category, cornerRadius: d.cornerRadius }])),
    screens: screens.map(s => ({ key: s.key, name: s.name, label: s.label, descriptionDev: s.descriptionDev, width: s.width, height: s.height, device: s.device || null,
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
    </div>
    <nav class="pv-tree" id="pv-tree"></nav>
  </aside>
  <div class="pv-split" id="pv-split" role="separator" aria-orientation="vertical" aria-label="Resize panels"></div>
  <main class="pv-right">
    <div class="pv-bar">
      <button type="button" id="pv-prev" aria-label="Previous screen">‹ Prev</button>
      <b id="pv-title"></b>
      <span class="pv-tools"><label><select id="pv-device" aria-label="Device type"></select></label>
      <label><select id="pv-theme" aria-label="Design style"></select></label>
      <label><select id="pv-btnstyle" aria-label="Button style"></select></label></span>
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
