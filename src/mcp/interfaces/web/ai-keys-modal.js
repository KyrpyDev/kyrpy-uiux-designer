/**
 * Profile → "AI Access Keys" modal (MCP layer web module, served at /mcp-web/).
 * Create / rotate / revoke API keys for owned projects, copy client config, and edit project AI settings.
 *
 * Secret-bearing calls (create, rotate) use a direct fetch: the shared api client caches GETs and queues
 * failed POSTs for offline replay, which would create keys whose plaintext nobody ever sees.
 */
import { h, modal, toast, confirmBox } from '/js/dom.js';
import { api } from '/js/api.js';
import { state } from '/js/state.js';

const EXPIRY = [['30', '30 days'], ['90', '90 days (recommended)'], ['365', '1 year'], ['never', 'Never expires']];
const SCOPE_INFO = {
  read: 'Read the design system, search and download items (always on)',
  request: 'Ask for missing items (item requests)',
  propose: 'Propose new or changed items as a reviewable changeset (never approves)'
};
const STATUS_LABEL = { active: 'Active', rotating: 'Rotating (grace period)', expired: 'Expired', revoked: 'Revoked' };

function injectStyles() {
  if (document.getElementById('aik-styles')) return;
  document.head.append(h('style', { id: 'aik-styles' }, `
.aik { display: flex; flex-direction: column; gap: 14px; width: min(860px, 86vw); max-width: 100%; }
.aik .row { flex-wrap: wrap; min-width: 0; }
.aik .field { min-width: 0; }
.aik-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: rgba(255,255,255,.02); }
.aik-card h4 { margin: 0 0 8px; font-size: 13px; }
.aik-reveal { border-color: var(--accent); background: rgba(46,155,255,.08); }
.aik-secret { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; flex: 1 1 220px; min-width: 0; font-size: 13px; }
.aik-warn { color: #f5b544; font-size: 12px; margin: 6px 0; }
.aik-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.aik-table th { text-align: left; color: var(--muted); font-weight: 600; padding: 4px 6px; border-bottom: 1px solid var(--line); }
.aik-table td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.aik-table tr.off td { opacity: .55; }
.aik-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.aik-chip { display: inline-block; font-size: 10px; padding: 1px 6px; margin: 1px 2px 1px 0; border-radius: 9px; background: rgba(46,155,255,.18); }
.aik-st-active { color: #3fb950; } .aik-st-rotating { color: #f5b544; } .aik-st-expired, .aik-st-revoked { color: var(--muted); }
.aik-snippet { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; white-space: pre; overflow-x: auto;
  background: #060a13; border: 1px solid var(--line); border-radius: 8px; padding: 8px; margin: 6px 0 0; color: var(--text); }
.aik-scopes label { display: flex; gap: 6px; align-items: flex-start; font-size: 12px; margin: 2px 0; color: var(--text); }
.aik-empty { color: var(--muted); font-size: 12px; padding: 8px 0; }
@media (max-width: 720px) { .aik { width: auto; } .aik-table .aik-hide-sm { display: none; } .aik .field.grow { flex: 1 1 100%; } }
`));
}

/** Direct, non-cached, non-queued JSON request with the current session headers. */
async function secretRequest(method, url, body) {
  const { token, userId, projectId } = api.getSession();
  const headers = { 'content-type': 'application/json', 'x-user-id': String(userId || 1), 'x-project-id': String(projectId || 1) };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(url, { method, headers, body: JSON.stringify(body ?? {}), cache: 'no-store' });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error?.message || r.statusText);
  return data;
}

const when = iso => {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [n, u] = abs < 3600 ? [Math.round(abs / 60), 'min'] : abs < 86400 ? [Math.round(abs / 3600), 'h'] : [Math.round(abs / 86400), 'd'];
  return diff < 0 ? `${n} ${u} ago` : `in ${n} ${u}`;
};

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'ok'); }
  catch { toast('Copy failed — select the text and copy it by hand', 'error'); }
}

function clientSnippets(key, project) {
  const url = `${location.origin}/mcp`;
  return [
    ['Claude Code', `claude mcp add --transport http kyrpy-uiux ${url} \\\n  --header "Authorization: Bearer ${key}"`],
    ['.mcp.json', JSON.stringify({ mcpServers: { 'kyrpy-uiux': { type: 'http', url, headers: { Authorization: 'Bearer ${KYRPY_UIUX_API_KEY}' } } } }, null, 2)
      + `\n\n# shell / .env (never commit):\nKYRPY_UIUX_API_KEY=${key}`],
    ['Generic', `MCP endpoint:  ${url}\nTransport:     Streamable HTTP\nHeader:        Authorization: Bearer ${key}\nProject:       ${project?.key || ''}`]
  ];
}

/** One-time panel that shows a new plaintext key and ready-to-paste client configuration. */
function revealPanel(result, project) {
  const secret = h('input', { class: 'aik-secret', type: 'text', readonly: true, value: result.key, 'aria-label': 'New API key', onfocus: e => e.target.select() });
  const snippets = clientSnippets(result.key, project);
  const pre = h('pre', { class: 'aik-snippet' }, snippets[0][1]);
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  snippets.forEach(([label, text], i) => tabs.append(h('button', {
    class: i === 0 ? 'on' : '', role: 'tab', 'aria-selected': i === 0 ? 'true' : 'false',
    onclick: e => {
      tabs.querySelectorAll('button').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); });
      e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-selected', 'true');
      pre.textContent = text;
    }
  }, label)));
  return h('div', { class: 'aik-card aik-reveal', role: 'status', 'aria-live': 'polite' },
    h('h4', {}, `Key "${result.apiKey.name}" for ${result.apiKey.projectName || project?.name || 'project'}`),
    h('div', { class: 'row' }, secret, h('button', { class: 'btn sm primary', onclick: () => copy(result.key, 'Key') }, 'Copy key')),
    h('div', { class: 'aik-warn' }, '⚠ Copy it now — this key is shown only once. Store it in your AI client or an environment variable, never in the repository.'),
    h('div', { class: 'row spread' }, tabs, h('button', { class: 'btn sm', onclick: () => copy(pre.textContent, 'Configuration') }, 'Copy config')),
    pre,
    h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, 'Then tell your agent: “Run uiux_init for this project.”')
  );
}

export async function openAiKeysModal() {
  injectStyles();
  const host = h('div', { class: 'aik' });
  const me = state.user || {};
  let reveal = null;
  let projectForSettings = null;

  const render = async () => {
    let projects = [], keys = [];
    try { projects = await api.get('/api/projects'); }
    catch (e) { toast(`Could not load projects: ${e.message}`, 'error'); }
    try { keys = await (await fetch('/api/me/api-keys', { headers: authHeaders(), cache: 'no-store' })).json(); }
    catch { keys = null; }
    if (!Array.isArray(keys)) { toast(keys?.error?.message || 'Could not load keys', 'error'); keys = []; }
    const owned = projects.filter(p => Number(p.ownerId) === Number(me.id));
    if (!projectForSettings || !owned.some(p => p.id === projectForSettings)) projectForSettings = owned[0]?.id ?? null;

    host.replaceChildren(
      h('div', { class: 'muted', style: { fontSize: '12px' } },
        'API keys let an AI coding agent (Claude Code, Cursor, Antigravity …) read this designer’s design system for one project and propose changes. ',
        'Each key belongs to you and one project you own. Proposals always need your approval in the designer.'),
      reveal || '',
      createCard(owned),
      keysCard(keys),
      owned.length ? settingsCard(owned) : ''
    );
  };

  const authHeaders = () => {
    const { token, userId, projectId } = api.getSession();
    const hd = { 'x-user-id': String(userId || 1), 'x-project-id': String(projectId || 1) };
    if (token) hd.authorization = `Bearer ${token}`;
    return hd;
  };

  function createCard(owned) {
    if (!owned.length) {
      return h('div', { class: 'aik-card' }, h('h4', {}, 'Create a key'),
        h('div', { class: 'aik-empty' }, 'You don’t own any project yet. Create one from Collaborate → Projects, then come back.'));
    }
    const name = h('input', { type: 'text', placeholder: 'e.g. Claude Code — laptop', maxlength: '80' });
    const project = h('select', {}, owned.map(p => h('option', { value: String(p.id), selected: p.id === state.activeProjectId }, `${p.name} (${p.key})`)));
    const expiry = h('select', {}, EXPIRY.map(([v, l]) => h('option', { value: v, selected: v === '90' }, l)));
    const scopeBoxes = Object.entries(SCOPE_INFO).map(([s, info]) => {
      const box = h('input', { type: 'checkbox', checked: true, disabled: s === 'read', value: s });
      return { s, box, el: h('label', {}, box, h('span', {}, h('strong', {}, s), ` — ${info}`)) };
    });
    const btn = h('button', {
      class: 'btn primary', style: { alignSelf: 'flex-end' },
      onclick: async () => {
        if (!name.value.trim()) { toast('Give the key a name so you can recognise it later', 'error'); name.focus(); return; }
        btn.disabled = true;
        try {
          const result = await secretRequest('POST', '/api/me/api-keys', {
            name: name.value.trim(),
            projectId: Number(project.value),
            scopes: scopeBoxes.filter(x => x.box.checked).map(x => x.s),
            expiresInDays: expiry.value === 'never' ? null : Number(expiry.value)
          });
          reveal = revealPanel(result, owned.find(p => p.id === Number(project.value)));
          toast('API key created — copy it now', 'ok');
          await render();
        } catch (e) { toast(e.message, 'error'); }
        finally { btn.disabled = false; }
      }
    }, '+ Create key');
    return h('div', { class: 'aik-card' }, h('h4', {}, 'Create a key'),
      h('div', { class: 'row wrap' },
        h('label', { class: 'field grow' }, h('span', {}, 'Name'), name),
        h('label', { class: 'field' }, h('span', {}, 'Project'), project),
        h('label', { class: 'field' }, h('span', {}, 'Expires'), expiry),
        btn),
      h('div', { class: 'aik-scopes', role: 'group', 'aria-label': 'Scopes' }, scopeBoxes.map(x => x.el)));
  }

  function keysCard(keys) {
    if (!keys.length) return h('div', { class: 'aik-card' }, h('h4', {}, 'Your keys'), h('div', { class: 'aik-empty' }, 'No keys yet.'));
    const rows = keys.map(k => {
      const live = k.status === 'active' || k.status === 'rotating';
      return h('tr', { class: live ? '' : 'off' },
        h('td', {}, h('strong', {}, k.name), h('div', { class: 'aik-mono muted' }, `${k.prefix}…`)),
        h('td', {}, k.projectName || k.projectKey || k.projectId),
        h('td', { class: 'aik-hide-sm' }, k.scopes.map(s => h('span', { class: 'aik-chip' }, s))),
        h('td', { class: 'aik-hide-sm', title: k.lastUsedIp ? `from ${k.lastUsedIp}` : '' }, k.lastUsedAt ? when(k.lastUsedAt) : 'never used'),
        h('td', { class: 'aik-hide-sm' }, k.expiresAt ? when(k.expiresAt) : 'never'),
        h('td', { class: `aik-st-${k.status}` }, STATUS_LABEL[k.status] || k.status),
        h('td', { style: { whiteSpace: 'nowrap' } },
          k.status === 'active' ? h('button', {
            class: 'btn sm', title: 'Issue a new key; this one keeps working for 24 hours',
            onclick: async () => {
              if (!await confirmBox(`Rotate "${k.name}"? A new key is issued now and this one stops working in 24 hours.`, { okLabel: 'Rotate', danger: false })) return;
              try {
                const result = await secretRequest('POST', `/api/me/api-keys/${k.id}/rotate`, {});
                reveal = revealPanel(result, { name: k.projectName, key: k.projectKey });
                toast('New key issued — copy it now', 'ok');
                await render();
              } catch (e) { toast(e.message, 'error'); }
            }
          }, 'Rotate') : '',
          live ? h('button', {
            class: 'btn sm danger', style: { marginLeft: '4px' },
            onclick: async () => {
              if (!await confirmBox(`Revoke "${k.name}"? Agents using it lose access immediately.`, { okLabel: 'Revoke' })) return;
              try { await api.del(`/api/me/api-keys/${k.id}`); toast('Key revoked', 'ok'); await render(); }
              catch (e) { toast(e.message, 'error'); }
            }
          }, 'Revoke') : ''));
    });
    return h('div', { class: 'aik-card' }, h('h4', {}, `Your keys (${keys.length})`),
      h('div', { style: { overflowX: 'auto' } },
        h('table', { class: 'aik-table' },
          h('thead', {}, h('tr', {}, ['Name', 'Project', 'Scopes', 'Last used', 'Expires', 'Status', ''].map((t, i) =>
            h('th', { class: [2, 3, 4].includes(i) ? 'aik-hide-sm' : '' }, t)))),
          h('tbody', {}, rows))));
  }

  function settingsCard(owned) {
    const pick = h('select', { onchange: async e => { projectForSettings = Number(e.target.value); await render(); } },
      owned.map(p => h('option', { value: String(p.id), selected: p.id === projectForSettings }, p.name)));
    const body = h('div', { class: 'aik-empty' }, 'Loading…');
    api.get(`/api/projects/${projectForSettings}/ai-settings`).then(s => {
      const toggle = (key, label, hint) => {
        const box = h('input', { type: 'checkbox', checked: !!s[key], disabled: !s.canEdit });
        box.addEventListener('change', async () => {
          try { await api.put(`/api/projects/${projectForSettings}/ai-settings`, { [key]: box.checked }); toast('AI setting saved', 'ok'); }
          catch (e) { box.checked = !box.checked; toast(e.message, 'error'); }
        });
        return h('label', { class: 'row', style: { alignItems: 'flex-start', fontSize: '12px', margin: '4px 0' } }, box,
          h('span', {}, h('strong', {}, label), h('div', { class: 'muted' }, hint)));
      };
      body.replaceWith(h('div', {},
        toggle('pushRequiresReview', 'AI pushes need my review', 'Changes proposed with an API key wait in the change list until you approve them (recommended).'),
        toggle('mayCreatePublicItems', 'AI may create public items', 'Off: items created by AI stay inside this project.'),
        h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', {
            class: 'btn sm danger',
            onclick: async () => {
              if (!await confirmBox('Revoke every API key of this project, including other people’s? Agents lose access immediately.', { okLabel: 'Revoke all' })) return;
              try { const r = await api.post(`/api/projects/${projectForSettings}/api-keys/revoke-all`, {}); toast(`${r.revoked} key(s) revoked`, 'ok'); await render(); }
              catch (e) { toast(e.message, 'error'); }
            }
          }, 'Revoke all keys of this project'))));
    }).catch(e => { body.textContent = e.message; });
    return h('div', { class: 'aik-card' }, h('div', { class: 'row spread' }, h('h4', {}, 'Project AI settings'), pick), body);
  }

  modal({ title: 'AI Access Keys (MCP)', content: host, wide: true, onClose: () => { reveal = null; } });
  await render();
}
