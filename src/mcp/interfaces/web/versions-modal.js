/**
 * Collaborate → "Versions & AI Changesets" (MCP layer web module, served at /mcp-web/).
 * Review AI changesets (per-item before/after, approve all / selected, reject) and browse project versions.
 *
 * Proposed SVGs are written by agents: they are shown only as <img src="data:…">, which never runs scripts.
 * Requests use a direct fetch (no GET cache, no offline replay of approvals).
 */
import { h, modal, toast } from '/js/dom.js';
import { api } from '/js/api.js';
import { state } from '/js/state.js';

async function request(method, url, body) {
  const { token, userId, projectId } = api.getSession();
  const headers = { 'content-type': 'application/json', 'x-user-id': String(userId || 1), 'x-project-id': String(projectId || 1) };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error?.message || r.statusText);
  return data;
}

function injectStyles() {
  if (document.getElementById('ver-styles')) return;
  document.head.append(h('style', { id: 'ver-styles' }, `
.ver { display: flex; flex-direction: column; gap: 12px; width: min(980px, 88vw); max-width: 100%; min-height: 420px; }
.ver-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.ver-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: rgba(255,255,255,.02); }
.ver-list { display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow: auto; }
.ver-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; cursor: pointer; }
.ver-row:hover { border-color: var(--accent); }
.ver-grow { flex: 1 1 240px; min-width: 0; }
.ver-muted { color: var(--muted); font-size: 12px; }
.ver-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
.ver-badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 9px; text-transform: uppercase; letter-spacing: .03em; }
.ver-b-create { background: rgba(63,185,80,.18); color: #3fb950; } .ver-b-update { background: rgba(46,155,255,.18); color: #58a6ff; }
.ver-b-delete { background: rgba(248,81,73,.18); color: #f85149; }
.ver-s-submitted, .ver-s-staged, .ver-s-pending { color: #f5b544; } .ver-s-approved, .ver-s-applied { color: #3fb950; }
.ver-s-rejected, .ver-s-failed, .ver-s-conflict, .ver-s-conflicted { color: #f85149; } .ver-s-superseded, .ver-s-expired, .ver-s-discarded, .ver-s-open { color: var(--muted); }
.ver-op { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: start; }
.ver-op-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ver-warn { color: #f5b544; font-size: 12px; }
.ver-pair { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.ver-pane { flex: 1 1 200px; min-width: 0; border: 1px solid var(--line); border-radius: 10px; padding: 6px; text-align: center; }
.ver-pane img { max-width: 100%; max-height: 220px; background: repeating-conic-gradient(rgba(127,127,127,.12) 0 25%, transparent 0 50%) 0 0 / 16px 16px; border-radius: 6px; }
.ver-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ver-actions input[type=text] { flex: 1 1 220px; min-width: 0; }
.ver-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.ver-table th { text-align: left; color: var(--muted); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.ver-table td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
@media (max-width: 720px) { .ver { width: auto; } .ver-hide-sm { display: none; } }
`));
}

const when = iso => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};
const st = s => h('span', { class: `ver-s-${s}`, style: { fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' } }, s);
const svgImg = (svg, alt) => (svg ? h('img', { alt, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }) : h('div', { class: 'ver-muted', style: { padding: '24px 0' } }, '—'));

export async function openVersionsModal({ changeset, tab: startTab } = {}) {
  injectStyles();
  const projectId = state.activeProjectId || 1;
  const project = (state.projects || []).find(p => p.id === projectId);
  const host = h('div', { class: 'ver' });
  let tab = startTab || 'review';

  const tabs = () => h('div', { class: 'ver-tabs' },
    [['review', 'AI changesets — waiting'], ['all', 'All changesets'], ['requests', 'AI item requests'], ['versions', 'Versions']].map(([k, label]) =>
      h('button', { class: `btn sm${tab === k ? ' primary' : ''}`, onclick: () => { tab = k; render(); } }, label)));

  async function render() {
    host.replaceChildren(tabs(), h('div', { class: 'ver-muted' }, 'Loading…'));
    try {
      const body = tab === 'versions' ? await versionsView() : tab === 'requests' ? await requestsView() : await changesetList(tab === 'review' ? 'submitted' : '');
      host.replaceChildren(tabs(), body);
    } catch (e) { host.replaceChildren(tabs(), h('div', { class: 'aik-warn ver-warn' }, e.message)); }
  }

  async function changesetList(status) {
    const list = await request('GET', `/api/projects/${projectId}/changesets${status ? `?status=${status}` : ''}`);
    const wrap = h('div', { class: 'ver-list' });
    wrap.append(h('div', { class: 'ver-muted' }, `Project "${project?.name || projectId}". AI agents propose changes as changesets; nothing changes in the design until you approve. Approved items form a new project version that the app pulls.`));
    if (!list.length) wrap.append(h('div', { class: 'ver-muted', style: { padding: '24px', textAlign: 'center' } }, status ? 'No AI changesets are waiting for review.' : 'No AI changesets yet.'));
    for (const cs of list) {
      wrap.append(h('div', { class: 'ver-card ver-row', role: 'button', tabindex: '0', onclick: () => openDetail(cs.changeset), onkeydown: e => { if (e.key === 'Enter') openDetail(cs.changeset); } },
        h('div', { class: 'ver-grow' },
          h('div', {}, h('strong', {}, cs.message || cs.summary || 'AI changeset'), ' ', st(cs.status)),
          h('div', { class: 'ver-muted' }, `${cs.opCount} item(s) · based on v${cs.baseVersion ?? '?'}${cs.resultVersion?.number ? ` → v${cs.resultVersion.number}` : ''} · ${when(cs.submittedAt || cs.createdAt)}`)),
        h('span', { class: 'ver-mono ver-hide-sm' }, cs.changeset.slice(0, 8)),
        h('button', { class: 'btn sm' }, cs.status === 'submitted' ? 'Review →' : 'Open →')));
    }
    return wrap;
  }

  async function requestsView() {
    const list = await request('GET', `/api/projects/${projectId}/item-requests`);
    const wrap = h('div', { class: 'ver-list' }, h('div', { class: 'ver-muted' }, 'Coding agents ask for items that do not exist yet. The designer agent fulfils them through changesets; you can also link an existing project item by key, or reject the request.'));
    if (!list.length) wrap.append(h('div', { class: 'ver-muted', style: { padding: '24px', textAlign: 'center' } }, 'No item requests yet.'));
    for (const r of list) {
      const open = ['open', 'claimed', 'in-review'].includes(r.status);
      const ref = h('input', { type: 'text', placeholder: `${r.type} key in this project`, maxlength: '120', style: { flex: '1 1 160px', minWidth: 0 } });
      const act = async (path, body, msg) => { try { await request('POST', `/api/item-requests/${r.uid}/${path}`, body); toast(msg, 'ok'); render(); } catch (e) { toast(e.message, 'error'); } };
      wrap.append(h('div', { class: 'ver-card' },
        h('div', { class: 'ver-op-head' }, h('span', { class: 'ver-badge ver-b-update' }, r.type), h('strong', {}, r.intent), st(r.status)),
        h('div', { class: 'ver-muted' }, `${when(r.createdAt)}${r.candidates?.length ? ` · candidates: ${r.candidates.map(c => c.key).join(', ')}` : ' · no similar item existed'}${r.item ? ` · item: ${r.item.key}` : ''}${r.note ? ` · ${r.note}` : ''}`),
        Object.keys(r.constraints || {}).length ? h('div', { class: 'ver-mono' }, JSON.stringify(r.constraints)) : null,
        open ? h('div', { class: 'ver-actions', style: { marginTop: '6px' } }, ref,
          h('button', { class: 'btn sm primary', onclick: () => ref.value.trim() ? act('fulfill', { type: r.type, ref: ref.value.trim() }, 'Request fulfilled') : toast('Enter an item key', 'error') }, 'Fulfil with item'),
          h('button', { class: 'btn sm danger', onclick: () => act('reject', {}, 'Request rejected') }, 'Reject')) : null));
    }
    return wrap;
  }

  async function versionsView() {
    const data = await request('GET', `/api/projects/${projectId}/versions`);
    const label = h('input', { type: 'text', placeholder: 'Label for the head, e.g. 1.2.0 (optional)', maxlength: '40' });
    const msg = h('input', { type: 'text', placeholder: 'Message (optional)', maxlength: '500' });
    const save = h('button', { class: 'btn sm primary', onclick: async () => {
      try { await request('POST', `/api/projects/${projectId}/versions`, { label: label.value.trim(), message: msg.value.trim() }); toast('Version saved', 'ok'); render(); } catch (e) { toast(e.message, 'error'); }
    } }, 'Save version');
    const rows = data.versions.map(v => h('tr', {},
      h('td', {}, v.number ? h('strong', {}, `v${v.number}`) : '—', v.label ? h('div', { class: 'ver-mono' }, v.label) : null),
      h('td', {}, st(v.status), v.number === data.head ? h('div', { class: 'ver-muted' }, 'head') : null),
      h('td', {}, v.source),
      h('td', { class: 'ver-hide-sm' }, String(v.items)),
      h('td', {}, v.message || ''),
      h('td', { class: 'ver-hide-sm' }, when(v.approvedAt || v.createdAt))));
    return h('div', { class: 'ver-list' },
      h('div', { class: 'ver-card' }, h('div', { class: 'ver-muted', style: { marginBottom: '6px' } }, `Head: v${data.head}. Designer edits are recorded as a new version automatically; give the head a label to mark a release.`),
        h('div', { class: 'ver-actions', style: { justifyContent: 'flex-start' } }, label, msg, save)),
      h('table', { class: 'ver-table' },
        h('thead', {}, h('tr', {}, ['Version', 'Status', 'Source', 'Items', 'Message', 'When'].map((t, i) => h('th', { class: i === 3 || i === 5 ? 'ver-hide-sm' : '' }, t)))),
        h('tbody', {}, rows)));
  }

  async function openDetail(uid) {
    const body = h('div', { class: 'ver' }, h('div', { class: 'ver-muted' }, 'Loading…'));
    const m = modal({ title: 'AI changeset review', content: body, wide: true });
    const load = async () => {
      let cs;
      try { cs = await request('GET', `/api/changesets/${uid}`); } catch (e) { body.replaceChildren(h('div', { class: 'ver-warn' }, e.message)); return; }
      const pending = cs.ops.filter(o => o.status === 'staged');
      const picked = new Set(pending.map(o => o.opUid));
      const comment = h('input', { type: 'text', placeholder: 'Note for the agent (optional)', maxlength: '1000' });
      const send = async (approve, reject) => {
        try {
          const r = await request('POST', `/api/changesets/${uid}/review`, { approve, reject, comment: comment.value.trim() });
          toast(r.status === 'approved' ? `Approved — project is now v${r.resultVersion?.number}` : r.status === 'rejected' ? 'Changeset rejected' : 'Review saved', 'ok');
          import('/js/actions.js').then(a => a.reloadLibrary?.({ silent: true })).catch(() => {});
          await load(); render();
        } catch (e) { toast(e.message, 'error'); }
      };
      const ops = cs.ops.map(o => {
        const box = h('input', { type: 'checkbox', checked: picked.has(o.opUid), disabled: o.status !== 'staged' || !cs.canReview, 'aria-label': `Select ${o.key}`,
          onchange: e => { if (e.target.checked) picked.add(o.opUid); else picked.delete(o.opUid); } });
        const pair = h('div', { class: 'ver-pair' });
        const showBtn = h('button', { class: 'btn sm', onclick: async () => {
          showBtn.disabled = true;
          try {
            const p = await request('GET', `/api/changesets/${uid}/ops/${o.opUid}/preview`);
            pair.replaceChildren(
              h('div', { class: 'ver-pane' }, h('div', { class: 'ver-muted' }, 'Before'), svgImg(p.before, `${o.key} before`)),
              h('div', { class: 'ver-pane' }, h('div', { class: 'ver-muted' }, 'After'), svgImg(p.after, `${o.key} after`)));
            if (p.note) pair.append(h('div', { class: 'ver-muted' }, p.note));
            showBtn.remove();
          } catch (e) { toast(e.message, 'error'); showBtn.disabled = false; }
        } }, 'Show before / after');
        return h('div', { class: 'ver-card ver-op' }, box,
          h('div', {},
            h('div', { class: 'ver-op-head' }, h('span', { class: `ver-badge ver-b-${o.op}` }, o.op), h('strong', {}, o.name || o.key),
              h('span', { class: 'ver-muted' }, `${o.type} · ${o.key}`), st(o.status)),
            o.changedFields?.length ? h('div', { class: 'ver-muted' }, `Changed: ${o.changedFields.join(', ')}`) : null,
            o.changedSinceBase && o.status === 'staged' ? h('div', { class: 'ver-warn' }, '⚠ This item was edited in the designer after the agent read it; approving overwrites those edits.') : null,
            o.error ? h('div', { class: 'ver-warn' }, o.error) : null,
            o.type !== 'workflow' ? h('div', { style: { marginTop: '6px' } }, showBtn) : null,
            pair));
      });
      body.replaceChildren(
        h('div', { class: 'ver-card' },
          h('div', {}, h('strong', {}, cs.message || cs.summary || 'AI changeset'), ' ', st(cs.status)),
          h('div', { class: 'ver-muted' }, `${cs.opCount} item(s) · based on v${cs.baseVersion ?? '?'} · submitted ${when(cs.submittedAt)}${cs.resultVersion?.number ? ` · became v${cs.resultVersion.number}` : ''}${cs.reviewedBy ? ` · reviewed by @${cs.reviewedBy}` : ''}`),
          cs.reviewComment ? h('div', { class: 'ver-muted' }, `Note: "${cs.reviewComment}"`) : null),
        h('div', { class: 'ver-list' }, ops),
        pending.length && cs.canReview
          ? h('div', { class: 'ver-actions' }, comment,
            h('button', { class: 'btn sm primary', onclick: () => send(pending.map(o => o.opUid), []) }, `✓ Approve all (${pending.length})`),
            h('button', { class: 'btn sm', onclick: () => send([...picked], pending.map(o => o.opUid).filter(u => !picked.has(u))) }, '✓ Approve selected, reject the rest'),
            h('button', { class: 'btn sm danger', onclick: () => send([], pending.map(o => o.opUid)) }, '✕ Reject all'))
          : pending.length ? h('div', { class: 'ver-muted' }, 'Only the project owner or an admin can approve.') : null);
    };
    await load();
    return m;
  }

  modal({ title: 'Versions, AI Changesets & Requests', content: host, wide: true });
  await render();
  if (changeset) openDetail(changeset);
}
