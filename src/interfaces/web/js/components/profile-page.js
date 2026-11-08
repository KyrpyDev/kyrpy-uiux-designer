/**
 * My Profile page (topbar profile icon): account card, profile details, password change, signed-in
 * sessions and activity. Backed by /api/auth/profile* (ProfileService). Every change needs a session.
 */
import { api } from '../api.js';
import { state, emit } from '../state.js';
import { h, modal, toast, confirmBox } from '../dom.js';
import { openAuthModal, ensureAuthGate, openChangesModal, openProjectsModal } from './collab-modals.js';

const TABS = [['profile', 'Profile'], ['password', 'Password'], ['sessions', 'Sessions'], ['activity', 'Activity']];
const SWATCHES = ['#2e9bff', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444', '#64748b'];
const ROLE_TEXT = { superadmin: 'superadmin', admin: 'Admin', designer: 'Designer', reviewer: 'Reviewer', viewer: 'Viewer' };
const ITEM_LABELS = { path: 'Paths', icon: 'Icons', button: 'Buttons', element: 'Elements', screen: 'Screens', workflow: 'Workflows' };

const initials = u => (String(u?.displayName || u?.username || '?').replace(/\(.*?\)/g, ' ').match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const when = iso => {
  if (!iso) return '—';
  const d = new Date(String(iso).includes('T') ? iso : `${String(iso).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
};
const openAiKeys = () => import('/mcp-web/ai-keys-modal.js').then(m => m.openAiKeysModal()).catch(e => toast(`AI Access Keys: ${e.message}`, 'error'));

/** Rough strength score 0–4 for the meter (the server enforces the real rules). */
export function passwordStrength(p) {
  const s = String(p || '');
  if (!s) return 0;
  let score = 0;
  if (s.length >= 8) score++;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/[0-9]/.test(s) && /[^A-Za-z0-9]/.test(s)) score++;
  if (s.length < 8 || !/[A-Za-z]/.test(s) || !/[0-9]/.test(s)) score = Math.min(score, 1);
  return score;
}

async function signOut(close) {
  await api.logout().catch(() => {});
  api.setSession({ token: null, userId: null });
  close?.();
  await ensureAuthGate({ authConfig: state.authConfig || { appMode: 'release', bypassLogin: false, requireAuth: true }, forceGate: true });
}

export async function openProfilePage({ tab = 'profile' } = {}) {
  let data = null;
  let current = TABS.some(t => t[0] === tab) ? tab : 'profile';
  const head = h('div', { class: 'profile-head' });
  const tabsEl = h('div', { class: 'tabs profile-tabs', role: 'tablist' });
  const body = h('div', { class: 'profile-body' }, h('div', { class: 'muted profile-empty' }, 'Loading your profile…'));
  const root = h('div', { class: 'profile-page' }, head, tabsEl, body);

  const m = modal({
    title: 'My Profile',
    wide: true,
    content: root,
    actions: close => [
      h('button', { class: 'btn', onclick: () => openAiKeys() }, 'AI Access Keys…'),
      h('button', { class: 'btn', onclick: () => { close(); openAuthModal(); } }, 'Switch Account…'),
      h('button', { class: 'btn danger', onclick: () => signOut(close) }, 'Sign Out'),
      h('button', { class: 'btn primary', onclick: close }, 'Close')
    ]
  });

  const setUser = user => {
    if (!user) return;
    const same = ['displayName', 'email', 'avatarColor', 'role', 'username'].every(k => state.user?.[k] === user[k]);
    state.user = { ...state.user, ...user };
    if (same) return;
    emit('auth:changed', state.user);
  };

  const renderHead = () => {
    const u = data.user;
    head.replaceChildren(
      h('div', { class: 'profile-avatar', style: { background: u.avatarColor || '#2e9bff' }, 'aria-hidden': 'true' }, initials(u)),
      h('div', { class: 'profile-id' },
        h('div', { class: 'profile-name' }, u.displayName || u.username),
        h('div', { class: 'muted' }, `@${u.username} · ${u.email}`),
        h('div', { class: 'row profile-badges' },
          h('span', { class: 'badge' }, ROLE_TEXT[u.role] || u.role),
          h('span', { class: `badge ${u.status === 'active' ? 'ok' : 'warn'}` }, u.status),
          data.isAdmin ? h('span', { class: 'badge accent' }, 'admin rights') : null,
          !data.canWrite ? h('span', { class: 'badge' }, 'read-only') : null)),
      data.devFallback ? h('div', { class: 'profile-note full' }, 'Dev mode: you are not signed in, so the designer acts as the default admin. Sign in to manage your own account and sessions.') : null,
      h('div', { class: 'profile-dates muted' },
        h('div', {}, `Member since ${when(u.createdAt)}`),
        h('div', {}, `Last sign-in ${when(u.lastLoginAt)}`))
    );
  };

  const renderTabs = () => {
    tabsEl.replaceChildren(...TABS.map(([k, label]) => h('button', {
      class: current === k ? 'on' : '', role: 'tab', 'aria-selected': String(current === k),
      onclick: () => { current = k; renderTabs(); renderBody(); }
    }, k === 'sessions' && data ? `${label} (${data.sessions.length})` : label)));
  };

  /* ---------- Profile ---------- */
  const profileTab = () => {
    const u = data.user;
    const name = h('input', { type: 'text', value: u.displayName || '', maxlength: '80', autocomplete: 'name' });
    const email = h('input', { type: 'email', value: u.email || '', autocomplete: 'email' });
    const pass = h('input', { type: 'password', placeholder: 'Needed only when the email changes', autocomplete: 'current-password' });
    const passRow = h('label', { class: 'field', hidden: true }, h('span', {}, 'Current password'), pass);
    let color = u.avatarColor || '#2e9bff';
    const custom = h('input', { type: 'color', value: color, 'aria-label': 'Custom avatar color' });
    const swatchRow = h('div', { class: 'row profile-swatches' });
    const drawSwatches = () => swatchRow.replaceChildren(
      ...SWATCHES.map(c => h('button', { type: 'button', class: `profile-swatch${c.toLowerCase() === color.toLowerCase() ? ' on' : ''}`, style: { background: c }, 'aria-label': `Avatar color ${c}`, onclick: () => { color = c; custom.value = c; drawSwatches(); } })),
      custom);
    custom.addEventListener('input', () => { color = custom.value; drawSwatches(); });
    drawSwatches();
    email.addEventListener('input', () => { passRow.hidden = email.value.trim().toLowerCase() === String(u.email).toLowerCase(); });
    const save = h('button', { class: 'btn primary', type: 'submit' }, 'Save Profile');
    const form = h('form', { class: 'profile-form', onsubmit: async e => {
      e.preventDefault();
      const patch = {};
      if (name.value.trim() !== (u.displayName || '')) patch.displayName = name.value.trim();
      if (email.value.trim().toLowerCase() !== String(u.email).toLowerCase()) { patch.email = email.value.trim(); patch.currentPassword = pass.value; }
      if (color.toLowerCase() !== String(u.avatarColor || '').toLowerCase()) patch.avatarColor = color;
      if (!Object.keys(patch).length) return toast('Nothing changed', 'info');
      save.disabled = true;
      try {
        data = await api.updateProfile(patch);
        setUser(data.user);
        toast('Profile saved', 'ok');
        renderHead(); renderBody();
      } catch (err) { toast(err.message, 'error'); } finally { save.disabled = false; }
    } },
      h('div', { class: 'profile-grid' },
        h('label', { class: 'field' }, h('span', {}, 'Username (cannot be changed)'), h('input', { type: 'text', value: u.username, disabled: true })),
        h('label', { class: 'field' }, h('span', {}, 'Display name'), name),
        h('label', { class: 'field full' }, h('span', {}, 'Email (used to sign in)'), email),
        passRow,
        h('div', { class: 'field full' }, h('span', {}, 'Avatar color'), swatchRow)),
      h('div', { class: 'row profile-actions' }, save));
    return form;
  };

  /* ---------- Password ---------- */
  const passwordTab = () => {
    const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    const next = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: String(data.passwordPolicy.minLength) });
    const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
    const others = h('input', { type: 'checkbox', checked: true });
    const meter = h('div', { class: 'pw-meter', 'aria-hidden': 'true' }, h('span', {}));
    const hint = h('div', { class: 'muted pw-hint' });
    const words = ['too weak', 'weak', 'fair', 'good', 'strong'];
    const update = () => {
      const sc = passwordStrength(next.value);
      meter.dataset.score = String(sc);
      meter.firstChild.style.width = `${next.value ? (sc + 1) * 20 : 0}%`;
      const mismatch = again.value && again.value !== next.value;
      hint.textContent = next.value ? `Strength: ${words[sc]}${mismatch ? ' · the two new passwords differ' : ''}` : `At least ${data.passwordPolicy.minLength} characters with a letter and a digit.`;
      hint.classList.toggle('bad', !!mismatch);
    };
    next.addEventListener('input', update); again.addEventListener('input', update); update();
    const show = h('input', { type: 'checkbox' });
    show.addEventListener('change', () => { for (const i of [cur, next, again]) i.type = show.checked ? 'text' : 'password'; });
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Change Password');
    return h('form', { class: 'profile-form', onsubmit: async e => {
      e.preventDefault();
      if (next.value !== again.value) return toast('The two new passwords differ', 'error');
      btn.disabled = true;
      try {
        const res = await api.changePassword({ currentPassword: cur.value, newPassword: next.value, signOutOthers: others.checked });
        toast(`Password changed${res.signedOutSessions ? ` · ${res.signedOutSessions} other session(s) signed out` : ''}`, 'ok');
        cur.value = next.value = again.value = ''; update();
        data = await api.profile(); renderTabs(); renderHead();
      } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    } },
      // hidden username helps password managers pair the new password with the account
      h('input', { type: 'text', value: data.user.username, autocomplete: 'username', hidden: true, readonly: true }),
      data.passwordSetByUser ? null : h('div', { class: 'profile-note' }, 'This account still uses a default password. Choose your own now.'),
      h('div', { class: 'profile-grid' },
        h('label', { class: 'field full' }, h('span', {}, 'Current password'), cur),
        h('label', { class: 'field' }, h('span', {}, 'New password'), next),
        h('label', { class: 'field' }, h('span', {}, 'Repeat new password'), again),
        h('div', { class: 'field full' }, meter, hint)),
      h('label', { class: 'row check' }, show, h('span', {}, 'Show passwords')),
      h('label', { class: 'row check' }, others, h('span', {}, 'Sign out all my other sessions')),
      h('div', { class: 'row profile-actions' }, btn));
  };

  /* ---------- Sessions ---------- */
  const sessionsTab = () => {
    const list = h('div', { class: 'profile-sessions' },
      ...data.sessions.map(s => h('div', { class: 'list-row profile-session' },
        h('div', { class: 'grow' },
          h('b', {}, s.current ? 'This browser' : `Session ${s.sid.slice(0, 8)}`),
          s.current ? h('span', { class: 'badge ok', style: { marginLeft: '6px' } }, 'current') : null,
          h('div', { class: 'muted' }, `Signed in ${when(s.createdAt)} · expires ${when(s.expiresAt)}`)),
        h('button', { class: `btn sm${s.current ? '' : ' danger'}`, onclick: async () => {
          if (s.current) return signOut(m.close);
          try { await api.revokeSession(s.sid); toast('Session signed out', 'ok'); data = await api.profile(); renderTabs(); renderBody(); } catch (err) { toast(err.message, 'error'); }
        } }, s.current ? 'Sign out' : 'Revoke'))));
    const others = data.sessions.filter(s => !s.current).length;
    return h('div', {},
      h('p', { class: 'muted' }, 'Places where you are signed in to the designer. AI agents use API keys, not sessions (see AI Access Keys).'),
      list,
      h('div', { class: 'row profile-actions' },
        h('button', { class: 'btn danger', disabled: !others, onclick: async () => {
          if (!await confirmBox(`Sign out ${others} other session(s)?`, { okLabel: 'Sign out others' })) return;
          try { const r = await api.revokeOtherSessions(); toast(`${r.revoked} session(s) signed out`, 'ok'); data = await api.profile(); renderTabs(); renderBody(); } catch (err) { toast(err.message, 'error'); }
        } }, `Sign out other sessions (${others})`)));
  };

  /* ---------- Activity ---------- */
  const activityTab = () => {
    const s = data.stats;
    const tile = (label, value, onclick) => h(onclick ? 'button' : 'div', { class: 'profile-stat', ...(onclick ? { type: 'button', onclick } : {}) }, h('b', {}, String(value)), h('span', {}, label));
    return h('div', {},
      h('div', { class: 'profile-stats' },
        tile('Projects owned', s.projectsOwned, () => { m.close(); openProjectsModal(); }),
        tile('Projects joined', s.projectsMember),
        tile('Pending invitations', s.invitationsPending, s.invitationsPending ? () => { m.close(); openProjectsModal(); } : null),
        tile('Changes to review', s.changesToReview, () => { m.close(); openChangesModal(); }),
        tile('My changes waiting', s.changesAuthoredPending),
        tile('Active AI keys', s.apiKeysActive, () => openAiKeys())),
      h('h4', { class: 'profile-sub' }, `Items I created (${s.itemsTotal})`),
      h('div', { class: 'profile-stats small' }, ...Object.entries(s.itemsCreated).map(([t, n]) => tile(ITEM_LABELS[t] || t, n))));
  };

  const renderBody = () => {
    const make = { profile: profileTab, password: passwordTab, sessions: sessionsTab, activity: activityTab }[current];
    body.replaceChildren(make());
  };

  try {
    data = await api.profile();
  } catch (err) {
    head.replaceChildren();
    // only an auth failure means "sign in"; a missing route, 5xx or network error gets a retry instead
    const needsLogin = err.status === 401 || err.status === 403;
    body.replaceChildren(h('div', { class: 'profile-empty' },
      h('p', {}, needsLogin ? (err.message || 'Please sign in to see your profile.') : `Could not load your profile: ${err.message || 'unknown error'}`),
      needsLogin
        ? h('button', { class: 'btn primary', onclick: () => { m.close(); openAuthModal(); } }, 'Sign In…')
        : h('button', { class: 'btn primary', onclick: () => { m.close(); openProfilePage({ tab }); } }, 'Retry')));
    return m;
  }
  setUser(data.user);
  renderHead(); renderTabs(); renderBody();
  return m;
}
