/**
 * Modals & panels for:
 *  - Login / Register / Account Switcher (`openAuthModal`)
 *  - Admin & User Management with ACL levels (`openAdminUsersModal`)
 *  - Project Management, Visibility & Collaborator Invitations (`openProjectsModal`)
 *  - Collaborative Design Change List with Owner Approve / Reject (`openChangesModal`)
 *  - Editable Button Templates & Device Templates (`openTemplatesModal`)
 *  - Multi-Event & Small Element Toolbar Editor (`openEventsModal`)
 *  - Root Owner & Clone Lineage Inspector (`openLineageModal`)
 *  - Offline-First PostgreSQL Sync & Translations (`openSyncModal`)
 */
import { api } from '../api.js';
import { state, emit, projectLabel, ownerLabel } from '../state.js';
import { reloadLibrary, setActiveProject } from '../actions.js';
import { h, modal, toast, confirmBox } from '../dom.js';
import { EVENT_TRIGGERS, CLICK_ACTIONS, TOOLBAR_POSITIONS, DRAWER_SIDES } from '/domain/entities.js';

const ROLE_LABELS = {
  superadmin: 'Super Admin (Full System)',
  admin: 'Admin (Users + All Projects)',
  designer: 'Designer (Create & Edit)',
  reviewer: 'Reviewer (Approve / Reject)',
  viewer: 'Viewer (Read Only)'
};

const PROJECT_ROLE_LABELS = {
  owner: 'Owner (Full Control + Approve/Reject)',
  admin: 'Project Admin (Manage + Approve/Reject)',
  editor: 'Editor (Direct Edit + Change Log)',
  contributor: 'Contributor (Propose Changes for Approval)',
  viewer: 'Viewer (Read Only)'
};

/* ============================================================================
 * 1. Login / Register / Switch User Modal
 * ========================================================================== */
export async function openAuthModal() {
  let users = [];
  try {
    users = await api.users();
  } catch {
    users = [state.user];
  }
  users = users.filter(u => u && !u.system);   // system accounts (public library owner, AI agent) cannot sign in

  let mode = 'login'; // 'login' | 'register'
  const usernameInput = h('input', { type: 'text', placeholder: 'Username or email (default: admin)', value: '' });
  const emailInput = h('input', { type: 'email', placeholder: 'email@example.com' });
  const displayInput = h('input', { type: 'text', placeholder: 'Display Name' });
  const passwordInput = h('input', { type: 'password', placeholder: 'Password (default for admin: admin)' });
  const roleSelect = h('select', {}, [
    h('option', { value: 'designer' }, 'Designer'),
    h('option', { value: 'reviewer' }, 'Reviewer'),
    h('option', { value: 'viewer' }, 'Viewer'),
    h('option', { value: 'admin' }, 'Admin')
  ]);

  const formHost = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

  const renderForm = close => {
    formHost.replaceChildren();
    const cur = state.user || { username: 'kyrpy', role: 'admin' };
    formHost.append(
      h('div', { class: 'card-sub', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'rgba(46,155,255,0.1)', borderRadius: '10px', border: '1px solid var(--line)' } },
        h('div', {},
          h('strong', {}, `Signed in as: ${cur.displayName || cur.username} (@${cur.username})`),
          h('div', { class: 'muted' }, `System ACL Role: ${ROLE_LABELS[cur.role] || cur.role}`)
        ),
        h('span', { class: 'badge accent' }, cur.role.toUpperCase())
      ),
      h('div', { class: 'tabs', style: { display: 'flex', gap: '6px' } },
        h('button', { class: `btn sm${mode === 'login' ? ' primary' : ''}`, onclick: () => { mode = 'login'; renderForm(close); } }, 'Sign In'),
        h('button', { class: `btn sm${mode === 'register' ? ' primary' : ''}`, onclick: () => { mode = 'register'; renderForm(close); } }, 'Create Account')
      )
    );

    if (mode === 'login') {
      formHost.append(
        h('label', { class: 'field' }, h('span', {}, 'Username or Email'), usernameInput),
        h('label', { class: 'field' }, h('span', {}, 'Password'), passwordInput),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const res = await api.login({ usernameOrEmail: usernameInput.value.trim(), password: passwordInput.value });
              api.setSession({ token: res.token, userId: res.user.id });
              state.user = res.user;
              await reloadLibrary();
              emit('auth:changed', res.user);
              toast(`Welcome back, ${res.user.displayName || res.user.username}!`, 'ok');
              close();
            } catch (e) {
              toast(e.message, 'error');
            }
          }
        }, 'Sign In')
      );
    } else {
      formHost.append(
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, 'Username'), usernameInput),
          h('label', { class: 'field grow' }, h('span', {}, 'Email'), emailInput)
        ),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, h('span', {}, 'Display Name'), displayInput),
          h('label', { class: 'field' }, h('span', {}, 'Role'), roleSelect)
        ),
        h('label', { class: 'field' }, h('span', {}, 'Password (min 4 chars)'), passwordInput),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const res = await api.register({
                username: usernameInput.value.trim(),
                email: emailInput.value.trim(),
                displayName: displayInput.value.trim() || usernameInput.value.trim(),
                password: passwordInput.value,
                role: roleSelect.value
              });
              api.setSession({ token: res.token, userId: res.user.id });
              state.user = res.user;
              await reloadLibrary();
              emit('auth:changed', res.user);
              toast(`Account @${res.user.username} created and signed in`, 'ok');
              close();
            } catch (e) {
              toast(e.message, 'error');
            }
          }
        }, 'Register & Sign In')
      );
    }

    if (users.length > 0) {
      formHost.append(
        h('hr', { style: { border: '0', borderTop: '1px solid var(--line)', margin: '8px 0' } }),
        h('div', { class: 'muted' }, 'Quick Switch Local / Demo Account (Offline-First Testing):'),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          users.map(u =>
            h('button', {
              class: `btn sm${state.user?.id === u.id ? ' primary' : ''}`,
              onclick: async () => {
                api.setSession({ token: null, userId: u.id });
                state.user = u;
                await reloadLibrary();
                emit('auth:changed', u);
                toast(`Switched active user to @${u.username} (${u.role})`, 'ok');
                close();
              }
            }, `@${u.username} (${u.role})`)
          )
        )
      );
    }
  };

  const m = modal({
    title: 'Account — Sign In / Register',
    content: formHost,
    actions: close => [
      h('button', {
        class: 'btn',
        onclick: async () => {
          await api.logout().catch(() => {});
          api.setSession({ token: null, userId: null });
          close();
          await ensureAuthGate({ authConfig: state.authConfig || { appMode: 'release', bypassLogin: false, requireAuth: true }, forceGate: true });
        }
      }, '🔒 Lock / Sign Out'),
      h('button', {
        class: 'btn',
        onclick: () => { close(); openAdminUsersModal(); }
      }, 'Admin & Users Panel…'),
      h('button', { class: 'btn', onclick: close }, 'Close')
    ]
  });
  renderForm(m.close);
}

/**
 * Full-screen Login / Register Protection Page for Release Mode (`APP_MODE=release` / `BYPASS_AUTH=false`),
 * with automatic or one-click bypass in Dev Mode (`APP_MODE=dev` / `BYPASS_AUTH=true`).
 */
export function ensureAuthGate({ authConfig = { appMode: 'dev', bypassLogin: true, requireAuth: false }, authenticated = false, forceGate = false } = {}) {
  const urlParams = new URLSearchParams(window.location.search);
  const queryWantsLogin = urlParams.get('login') === '1';
  const hasStoredToken = Boolean(api.getSession()?.token);

  // In Dev mode, bypass the login/register page automatically unless explicitly forced (?login=1 or Sign Out)
  if (!forceGate && !queryWantsLogin && (authConfig.bypassLogin || authenticated || hasStoredToken)) {
    return Promise.resolve(state.user);
  }

  return new Promise(resolve => {
    const existingGate = document.getElementById('ud-auth-gate');
    if (existingGate) existingGate.remove();

    let tab = 'login';
    const userInp = h('input', { type: 'text', placeholder: 'Username or email (default: admin)', value: 'admin' });
    const emailInp = h('input', { type: 'email', placeholder: 'you@example.com' });
    const displayInp = h('input', { type: 'text', placeholder: 'Full Name / Display Name' });
    const passInp = h('input', { type: 'password', placeholder: 'Password (default: admin)', value: '' });
    const errBox = h('div', { class: 'muted', style: { color: '#ef4444', fontSize: '12px', minHeight: '16px' } });
    const bodyBox = h('div', { class: 'stack', style: { gap: '12px' } });

    const finishAuth = async res => {
      if (res?.token && res?.user) {
        api.setSession({ token: res.token, userId: res.user.id });
        state.user = res.user;
      }
      gateOverlay.remove();
      await reloadLibrary({ silent: true }).catch(() => {});
      emit('auth:changed', state.user);
      resolve(state.user);
    };

    const renderGateCard = () => {
      bodyBox.replaceChildren();
      errBox.textContent = '';

      bodyBox.append(
        h('div', { class: 'seg', style: { width: '100%' } },
          h('button', {
            class: tab === 'login' ? 'on' : '',
            style: { flex: '1' },
            onclick: () => { tab = 'login'; renderGateCard(); }
          }, '🔐 Sign In'),
          h('button', {
            class: tab === 'register' ? 'on' : '',
            style: { flex: '1' },
            onclick: () => { tab = 'register'; renderGateCard(); }
          }, '✨ Register Account')
        )
      );

      if (tab === 'login') {
        bodyBox.append(
          h('label', { class: 'field' }, h('span', {}, 'Username or Email'), userInp),
          h('label', { class: 'field' }, h('span', {}, 'Password'), passInp),
          errBox,
          h('button', {
            class: 'btn primary ud-gate-login-btn',
            style: { width: '100%', padding: '10px', fontWeight: '700' },
            onclick: async () => {
              try {
                const res = await api.login({
                  usernameOrEmail: userInp.value.trim(),
                  password: passInp.value
                });
                toast(`Signed in as @${res.user.username}`, 'ok');
                await finishAuth(res);
              } catch (e) {
                errBox.textContent = e.message || 'Sign in failed';
              }
            }
          }, 'Sign In to Studio')
        );
      } else {
        bodyBox.append(
          h('label', { class: 'field' }, h('span', {}, 'Username'), userInp),
          h('label', { class: 'field' }, h('span', {}, 'Email'), emailInp),
          h('label', { class: 'field' }, h('span', {}, 'Display Name'), displayInp),
          h('label', { class: 'field' }, h('span', {}, 'Password (min 4 chars)'), passInp),
          errBox,
          h('button', {
            class: 'btn primary ud-gate-register-btn',
            style: { width: '100%', padding: '10px', fontWeight: '700' },
            onclick: async () => {
              try {
                const res = await api.register({
                  username: userInp.value.trim(),
                  email: emailInp.value.trim(),
                  displayName: displayInp.value.trim() || userInp.value.trim(),
                  password: passInp.value,
                  role: 'designer'
                });
                toast(`Registered & signed in as @${res.user.username}`, 'ok');
                await finishAuth(res);
              } catch (e) {
                errBox.textContent = e.message || 'Registration failed';
              }
            }
          }, 'Create Account & Enter Studio')
        );
      }

      if (authConfig.bypassLogin) {
        bodyBox.append(
          h('button', {
            class: 'btn ud-gate-dev-bypass-btn',
            style: { width: '100%', marginTop: '4px' },
            onclick: async () => {
              try {
                const res = await api.devBypassLogin();
                toast('Dev Mode: Bypassed login as Administrator', 'ok');
                await finishAuth(res);
              } catch {
                gateOverlay.remove();
                resolve(state.user);
              }
            }
          }, '⚡ Bypass Login (Dev Mode)')
        );
      }
    };

    const gateOverlay = h('div', {
      id: 'ud-auth-gate',
      style: {
        position: 'fixed',
        inset: '0',
        zIndex: '99999',
        background: 'radial-gradient(circle at 50% 20%, #172036 0%, #090c14 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }
    },
    h('div', {
      style: {
        width: '100%',
        maxWidth: '420px',
        background: 'var(--bg-1, #131824)',
        border: '1px solid var(--line, rgba(255,255,255,0.12))',
        borderRadius: '16px',
        padding: '28px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }
    },
      h('div', { style: { textAlign: 'center' } },
        h('div', { style: { fontSize: '20px', fontWeight: '800', letterSpacing: '-0.02em' } }, '◈ Kyrpy UI/UX App Designer'),
        h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
          authConfig.appMode === 'release'
            ? 'Release Mode — Sign in or create an account to access the studio'
            : 'Development Mode — Sign in or use Dev Bypass'
        )
      ),
      bodyBox,
      h('div', {
        class: 'muted',
        style: {
          fontSize: '11px',
          textAlign: 'center',
          paddingTop: '8px',
          borderTop: '1px solid var(--line, rgba(255,255,255,0.08))'
        }
      }, 'Default startup installer account: username "admin" / password "admin"')
    ));

    renderGateCard();
    document.body.appendChild(gateOverlay);
  });
}

/* ============================================================================
 * 2. Admin & User Management Panel (Full ACL Levels)
 * ========================================================================== */
export async function openAdminUsersModal() {
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '420px' } });

  const refresh = async () => {
    const users = await api.users();
    host.replaceChildren();

    // New user creation bar
    const uName = h('input', { type: 'text', placeholder: 'username' });
    const uEmail = h('input', { type: 'email', placeholder: 'email@domain.com' });
    const uDisplay = h('input', { type: 'text', placeholder: 'Display Name' });
    const uPass = h('input', { type: 'password', placeholder: 'Password', value: 'kyrpy123' });
    const uRole = h('select', {}, Object.entries(ROLE_LABELS).map(([k, v]) => h('option', { value: k, selected: k === 'designer' }, v)));

    host.append(
      h('div', { class: 'muted' }, 'Manage system users, ACL levels (superadmin, admin, designer, reviewer, viewer), and account status. Default root owner & admin is @kyrpy.'),
      h('div', { style: { padding: '12px', border: '1px solid var(--line)', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' } },
        h('div', { style: { fontWeight: '700', marginBottom: '8px', fontSize: '12px' } }, 'Add New User'),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Username'), uName),
          h('label', { class: 'field grow' }, h('span', {}, 'Email'), uEmail),
          h('label', { class: 'field grow' }, h('span', {}, 'Display Name'), uDisplay),
          h('label', { class: 'field' }, h('span', {}, 'Password'), uPass),
          h('label', { class: 'field' }, h('span', {}, 'ACL Role'), uRole),
          h('button', {
            class: 'btn primary',
            style: { alignSelf: 'flex-end' },
            onclick: async () => {
              if (!uName.value.trim()) return toast('Username is required', 'error');
              try {
                await api.createUser({
                  username: uName.value.trim(),
                  email: uEmail.value.trim() || `${uName.value.trim()}@kyrpy.com`,
                  displayName: uDisplay.value.trim() || uName.value.trim(),
                  password: uPass.value || 'kyrpy123',
                  role: uRole.value
                });
                toast(`User @${uName.value.trim()} created`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '+ Create User')
        )
      )
    );

    // Users table
    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '320px', overflow: 'auto' } });
    for (const u of users) {
      const sys = !!(u.system || u.readOnly);   // immutable system account: shown, never editable
      const roleSel = h('select', {
        disabled: sys,
        onchange: async e => {
          try {
            await api.updateUser(u.id, { role: e.target.value });
            toast(`Updated @${u.username} role to ${e.target.value}`, 'ok');
            await refresh();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }, Object.keys(ROLE_LABELS).map(r => h('option', { value: r, selected: u.role === r }, r)));

      const statusSel = h('select', {
        disabled: sys || u.id === 1,
        onchange: async e => {
          try {
            await api.updateUser(u.id, { status: e.target.value });
            toast(`Updated @${u.username} status to ${e.target.value}`, 'ok');
            await refresh();
          } catch (err) {
            toast(err.message, 'error');
          }
        }
      }, ['active', 'suspended', 'pending'].map(s => h('option', { value: s, selected: u.status === s }, s)));

      list.append(
        h('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 12px',
            border: '1px solid var(--line)',
            borderRadius: '10px',
            background: u.id === state.user?.id ? 'rgba(46,155,255,0.08)' : 'transparent'
          }
        },
          h('div', {
            style: {
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: u.avatarColor || '#2e9bff',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: '700'
            }
          }, (u.username || 'U')[0].toUpperCase()),
          h('div', { style: { flex: '1', minWidth: '140px' } },
            h('div', { style: { fontWeight: '700' } }, `${u.displayName || u.username} (@${u.username})${u.id === 1 ? ' ★ Root Admin' : ''}`,
              sys ? h('span', { class: 'badge', style: { marginLeft: '6px' }, title: u.username === 'public' ? 'Owner of the public library. Cannot sign in; admins curate its items, users clone them.' : 'System account. Cannot sign in.' }, 'System · Immutable') : null),
            h('div', { class: 'muted' }, `${u.email} · ID #${u.id}${u.username === 'public' ? ' · Public library' : ''}`)
          ),
          h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'ACL Role'), roleSel),
          h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Status'), statusSel),
          sys ? null : h('button', {
            class: 'btn sm',
            onclick: async () => {
              api.setSession({ token: null, userId: u.id });
              state.user = u;
              await reloadLibrary();
              emit('auth:changed', u);
              toast(`Now acting as @${u.username}`, 'ok');
              await refresh();
            }
          }, u.id === state.user?.id ? 'Active' : 'Use Account'),
          u.id !== 1 && !sys ? h('button', {
            class: 'btn sm danger',
            onclick: async () => {
              if (!await confirmBox(`Delete user @${u.username}? Their items will be reassigned to @kyrpy.`)) return;
              try {
                await api.deleteUser(u.id);
                toast(`Deleted @${u.username}`, 'ok');
                await refresh();
              } catch (err) {
                toast(err.message, 'error');
              }
            }
          }, 'Delete') : null
        )
      );
    }
    host.append(list);
  };

  await refresh();
  modal({
    title: 'Admin & User Management Panel (ACL)',
    wide: true,
    content: host,
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Done')]
  });
}

/* ============================================================================
 * 3. Project Manager & Collaborator Sharing / Invitations Modal
 * ========================================================================== */
export async function openProjectsModal() {
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '450px' } });
  let selectedId = state.activeProjectId || 1;

  const refresh = async () => {
    const [projects, allUsers] = await Promise.all([api.projects(), api.users()]);
    state.projects = projects;
    const current = await api.project(selectedId).catch(() => projects[0]);
    if (current) selectedId = current.id;

    host.replaceChildren();

    // Create project row
    const pName = h('input', { type: 'text', placeholder: 'New project name (e.g. Mobile Banking Redesign)' });
    const pVis = h('select', {}, [
      h('option', { value: 'public' }, 'Public (items visible to all projects)'),
      h('option', { value: 'project' }, 'Project-Specific (private to project members)')
    ]);
    const pDesc = h('input', { type: 'text', placeholder: 'Project description' });

    host.append(
      h('div', { style: { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '12px', background: 'rgba(255,255,255,0.02)' } },
        h('div', { style: { fontWeight: '700', marginBottom: '6px', fontSize: '12px' } }, 'Create New Project'),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Project Name'), pName),
          h('label', { class: 'field grow' }, h('span', {}, 'Description'), pDesc),
          h('label', { class: 'field' }, h('span', {}, 'Default Visibility'), pVis),
          h('button', {
            class: 'btn primary',
            style: { alignSelf: 'flex-end' },
            onclick: async () => {
              if (!pName.value.trim()) return toast('Enter a project name', 'error');
              try {
                const created = await api.createProject({
                  name: pName.value.trim(),
                  description: pDesc.value.trim(),
                  visibility: pVis.value
                });
                selectedId = created.id;
                await setActiveProject(created.id);
                toast(`Project "${created.name}" created`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '+ Create Project')
        )
      )
    );

    // Split view: project list on left, selected project details & collaborators on right
    const leftList = h('div', { style: { flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: '6px', borderRight: '1px solid var(--line)', paddingRight: '10px' } },
      h('div', { class: 'muted' }, `Projects (${projects.length})`),
      ...projects.map(p =>
        h('div', {
          style: {
            padding: '8px 10px',
            borderRadius: '10px',
            cursor: 'pointer',
            border: p.id === selectedId ? '1px solid var(--accent)' : '1px solid var(--line)',
            background: p.id === selectedId ? 'rgba(46,155,255,0.12)' : 'transparent'
          },
          onclick: async () => {
            selectedId = p.id;
            await refresh();
          }
        },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('strong', {}, projectLabel(p)),
            h('span', { class: 'badge' }, p.visibility)
          ),
          h('div', { class: 'muted', style: { fontSize: '11px' } }, `Owner: @${p.ownerUsername || 'kyrpy'}${p.id === state.activeProjectId ? ' · ACTIVE' : ''}`)
        )
      )
    );

    const rightPane = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '10px' } });
    if (current) {
      const editName = h('input', { type: 'text', value: current.name });
      const editVis = h('select', {}, [
        h('option', { value: 'public', selected: current.visibility === 'public' }, 'Public'),
        h('option', { value: 'project', selected: current.visibility === 'project' }, 'Project-specific')
      ]);
      const editDesc = h('input', { type: 'text', value: current.description || '' });

      // Invite collaborator controls
      const inviteUserSel = h('select', {}, [
        h('option', { value: '' }, 'Select user to invite...'),
        ...allUsers.filter(u => !u.system).map(u => h('option', { value: u.username }, `@${u.username} (${u.displayName || u.role})`))
      ]);
      const inviteRoleSel = h('select', {}, Object.entries(PROJECT_ROLE_LABELS).map(([k, v]) => h('option', { value: k, selected: k === 'contributor' }, v)));

      rightPane.append(
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
          h('div', {},
            h('strong', { style: { fontSize: '15px' } }, `${current.name} (#${current.id})`),
            h('div', { class: 'muted' }, `Owner: @${current.ownerUsername || 'kyrpy'} · Key: ${current.key}`)
          ),
          h('div', { class: 'row' },
            current.id !== state.activeProjectId
              ? h('button', {
                  class: 'btn sm primary',
                  onclick: async () => {
                    await setActiveProject(current.id);
                    toast(`Switched active project to "${current.name}"`, 'ok');
                    await refresh();
                  }
                }, 'Set as Active Project')
              : h('span', { class: 'badge accent' }, '✓ Active Project'),
            h('button', {
              class: 'btn sm clone-project-btn',
              title: 'Clone this project and all its project-scoped designs & button settings',
              onclick: async () => {
                const cloneName = await promptBox('Clone Project', { value: `${current.name} (Clone)`, label: 'Cloned Project Name', okLabel: 'Clone Project' });
                if (!cloneName?.trim()) return;
                try {
                  const res = await api.cloneProject(current.id, { name: cloneName.trim(), visibility: current.visibility });
                  selectedId = res.project.id;
                  await setActiveProject(res.project.id);
                  toast(`Cloned project "${res.project.name}" (${res.copiedCount || 0} item(s))`, 'ok');
                  await refresh();
                } catch (e) {
                  toast(e.message, 'error');
                }
              }
            }, '⧉ Clone Project'),
            current.id !== 1
              ? h('button', {
                  class: 'btn sm danger delete-project-btn',
                  onclick: async () => {
                    if (!await confirmBox(`Delete project "${current.name}"? Items will move to Default Public Project.`)) return;
                    await api.deleteProject(current.id);
                    selectedId = 1;
                    await setActiveProject(1);
                    await refresh();
                  }
                }, 'Delete Project')
              : null
          )
        ),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'Name'), editName),
          h('label', { class: 'field' }, h('span', {}, 'Visibility'), editVis),
          h('label', { class: 'field grow' }, h('span', {}, 'Description'), editDesc),
          h('button', {
            class: 'btn sm primary',
            style: { alignSelf: 'flex-end' },
            onclick: async () => {
              try {
                await api.saveProject(current.id, {
                  name: editName.value.trim(),
                  visibility: editVis.value,
                  description: editDesc.value
                });
                toast('Project saved', 'ok');
                await reloadLibrary();
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, 'Save Project')
        ),
        h('div', { class: 'row', style: { gap: '8px' } },
          h('button', {
            class: 'btn sm',
            onclick: async () => {
              await api.setProjectItemsVisibility(current.id, 'public');
              await reloadLibrary();
              toast('All items in this project set to PUBLIC', 'ok');
            }
          }, 'Make All Project Items Public'),
          h('button', {
            class: 'btn sm',
            onclick: async () => {
              await api.setProjectItemsVisibility(current.id, 'project');
              await reloadLibrary();
              toast('All items in this project set to PROJECT-SPECIFIC', 'ok');
            }
          }, 'Make All Project Items Project-Specific')
        ),
        h('hr', { style: { border: '0', borderTop: '1px solid var(--line)', margin: '4px 0' } }),
        h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Share & Invite Collaborators'),
        h('div', { class: 'muted' }, 'Collaborators with Editor or Contributor role have their design edits logged in the Change List so the Owner can Approve or Reject each change.'),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field grow' }, h('span', {}, 'User'), inviteUserSel),
          h('label', { class: 'field grow' }, h('span', {}, 'Project ACL Role'), inviteRoleSel),
          h('button', {
            class: 'btn sm primary',
            style: { alignSelf: 'flex-end' },
            onclick: async () => {
              if (!inviteUserSel.value) return toast('Choose a user to invite', 'error');
              try {
                await api.inviteProjectMember(current.id, {
                  usernameOrEmail: inviteUserSel.value,
                  role: inviteRoleSel.value
                });
                toast(`Invited @${inviteUserSel.value} as ${inviteRoleSel.value}`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '+ Invite Collaborator')
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflow: 'auto' } },
          ...(current.members || []).map(m =>
            h('div', {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                border: '1px solid var(--line)',
                borderRadius: '8px'
              }
            },
              h('div', {},
                h('strong', {}, `@${m.username}`),
                h('span', { class: 'muted', style: { marginLeft: '8px' } }, `${m.displayName || ''} · ${m.status}`)
              ),
              h('div', { class: 'row' },
                h('select', {
                  onchange: async e => {
                    try {
                      await api.updateProjectMember(current.id, m.userId, e.target.value);
                      toast(`Updated @${m.username} role`, 'ok');
                      await refresh();
                    } catch (err) {
                      toast(err.message, 'error');
                    }
                  }
                }, Object.keys(PROJECT_ROLE_LABELS).map(r => h('option', { value: r, selected: m.role === r }, r))),
                m.userId !== current.ownerId
                  ? h('button', {
                      class: 'btn sm danger',
                      onclick: async () => {
                        await api.removeProjectMember(current.id, m.userId);
                        await refresh();
                      }
                    }, '✕')
                  : null
              )
            )
          )
        )
      );
    }

    host.append(h('div', { style: { display: 'flex', gap: '12px', flex: '1' } }, leftList, rightPane));
  };

  await refresh();
  modal({
    title: 'Projects, Visibility & Collaborative Sharing',
    wide: true,
    content: host,
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Done')]
  });
}

/* ============================================================================
 * 4. Collaborative Change List & Owner Approve / Reject Modal
 * ========================================================================== */
export async function openChangesModal() {
  const host = h('div', { class: 'chg-modal' });
  const TYPES = ['path', 'icon', 'button', 'element', 'screen', 'workflow'];
  const PAGE = 100;            // cards rendered per step (lists can hold several hundred changes)
  const CHUNK = 50;            // ids per bulk request, so a long selection shows progress
  let statusFilter = 'pending';
  let typeFilter = '', authorFilter = '', query = '';
  let rows = [];               // the matching changes (lite, newest first)
  let counts = { pending: 0, approved: 0, rejected: 0, all: 0 };
  let shown = 0;               // rows[0..shown) have a card
  let gen = 0;                 // refresh generation: drops stale responses
  let busy = false;            // a bulk review is running
  let loadDeferred = false;    // load() was asked for while busy: run it once the bulk review ends
  let built = false;
  const cards = new Map();     // id -> card parts
  const selected = new Set();
  const authors = new Map();   // authorId -> name, collected from every list loaded
  let reloadTimer = null, reloadDirty = false, searchTimer = null;

  // one library reload after a burst of reviews (or when the modal closes), never one per click
  const flushReload = async () => {
    clearTimeout(reloadTimer); reloadTimer = null;
    if (!reloadDirty) return;
    reloadDirty = false;
    try {
      await reloadLibrary({ silent: false });
      emit('change:reviewed', { deferred: true });
    } catch (e) { toast(e.message, 'error'); }
  };
  const scheduleReload = () => { reloadDirty = true; clearTimeout(reloadTimer); reloadTimer = setTimeout(flushReload, 1500); };
  const filters = () => ({ targetType: typeFilter, authorId: authorFilter, q: query });
  const hasFilters = () => Boolean(typeFilter || authorFilter || query);
  const pendingRows = () => rows.filter(r => r.status === 'pending');
  const verbOf = st => st === 'approved' ? 'approved' : st === 'rejected' ? 'rejected' : st;

  // ---- toolbar ----
  const tabBtns = {};
  const tabs = h('div', { class: 'chg-tabs', role: 'tablist' },
    [['pending', 'PENDING'], ['approved', 'APPROVED'], ['rejected', 'REJECTED'], ['', 'ALL']].map(([st, label]) => {
      const badge = h('span', { class: `chg-count chg-count-${st || 'all'}` }, '0');
      const b = h('button', { class: 'btn sm', role: 'tab', onclick: () => { if (statusFilter !== st && !busy) { statusFilter = st; load(); } } }, label, badge);
      tabBtns[st] = { b, badge };
      return b;
    }));
  const typeSel = h('select', { 'aria-label': 'Item type', onchange: () => { typeFilter = typeSel.value; load(); } },
    h('option', { value: '' }, 'All item types'), TYPES.map(t => h('option', { value: t }, t)));
  const authorSel = h('select', { 'aria-label': 'Author', onchange: () => { authorFilter = authorSel.value; load(); } },
    h('option', { value: '' }, 'All authors'));
  const search = h('input', {
    type: 'search', placeholder: 'Search name, key, summary, author…', 'aria-label': 'Search changes',
    oninput: () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { if (search.value.trim() !== query) { query = search.value.trim(); load(); } }, 300); }
  });
  const selectAll = h('input', {
    type: 'checkbox', 'aria-label': 'Select every pending change in the list',
    onchange: () => {
      if (selectAll.checked) for (const r of pendingRows()) selected.add(r.id);
      else selected.clear();
      for (const card of cards.values()) if (card.box) card.box.checked = selected.has(card.ch.id);
      updateToolbar();
    }
  });
  const selectAllText = h('span', {}, 'Select all');
  const bulkNote = h('input', { type: 'text', placeholder: 'Note for bulk review (optional)', 'aria-label': 'Note for bulk review', class: 'chg-note' });
  const approveSelBtn = h('button', { class: 'btn sm primary', onclick: () => reviewSelected('approve') }, '✓ Approve selected');
  const rejectSelBtn = h('button', { class: 'btn sm danger', onclick: () => reviewSelected('reject') }, '✕ Reject selected');
  const approveAllBtn = h('button', { class: 'btn sm chg-approve-all', onclick: () => approveAllMatching() }, '✓✓ Approve all');
  const progress = h('span', { class: 'chg-progress muted', 'aria-live': 'polite' });

  const updateToolbar = () => {
    for (const [st, { b, badge }] of Object.entries(tabBtns)) {
      b.classList.toggle('primary', st === statusFilter);
      b.setAttribute('aria-selected', String(st === statusFilter));
      badge.textContent = String(counts[st || 'all'] ?? 0);
    }
    const pend = pendingRows();
    const nSel = selected.size;
    selectAll.disabled = busy || !pend.length;
    selectAll.checked = pend.length > 0 && nSel >= pend.length && pend.every(r => selected.has(r.id));
    selectAll.indeterminate = nSel > 0 && !selectAll.checked;
    selectAllText.textContent = nSel ? `${nSel} selected` : `Select all (${pend.length})`;
    approveSelBtn.textContent = `✓ Approve selected${nSel ? ` (${nSel})` : ''}`;
    rejectSelBtn.textContent = `✕ Reject selected${nSel ? ` (${nSel})` : ''}`;
    approveSelBtn.disabled = rejectSelBtn.disabled = busy || !nSel;
    approveAllBtn.textContent = `✓✓ Approve all (${counts.pending || 0} matching)`;
    approveAllBtn.disabled = busy || !counts.pending;
    // filters stay put while a bulk review runs (a reload would rebuild the cards mid-run)
    typeSel.disabled = authorSel.disabled = search.disabled = busy;
  };

  // topbar badge + status bar follow every review at once
  let countQueued = false;
  const syncPendingCount = (delta = 0) => {
    if (delta) state.pendingChangesCount = Math.max(0, (state.pendingChangesCount || 0) + delta);
    if (countQueued) return;       // coalesce a bulk run's many updates into one topbar rebuild per frame
    countQueued = true;
    requestAnimationFrame(() => { countQueued = false; emit('changes:count', state.pendingChangesCount); });
  };

  // ---- list (rendered incrementally) ----
  const list = h('div', { class: 'chg-list' });
  const moreBtn = h('button', { class: 'btn sm', onclick: () => renderMore() }, 'Show more');
  const sentinel = h('div', { class: 'chg-more' }, moreBtn);
  const emptyMsg = h('div', { class: 'muted chg-empty' }, 'No change requests matching these filters.');
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) renderMore(); }, { root: list, rootMargin: '300px' })
    : null;

  const setCardBusy = (card, on, action = '') => {
    card.busy = on;
    card.approveBtn.disabled = card.rejectBtn.disabled = on;
    if (card.box) card.box.disabled = on;
    card.el.classList.toggle('is-busy', on);
    if (on) {
      if (!action || action === 'approve') card.approveBtn.textContent = '…';
      if (!action || action === 'reject') card.rejectBtn.textContent = '…';
    } else {
      card.approveBtn.textContent = '✓ Approve';
      card.rejectBtn.textContent = '✕ Reject & Rollback';
    }
  };

  const renderCard = ch => {
    const pending = ch.status === 'pending';
    const card = { ch, busy: false };
    card.badge = h('span', { class: 'chg-badge' }, ch.status);
    card.comment = h('input', { type: 'text', placeholder: 'Review note (optional)', 'aria-label': `Review note for change #${ch.id}`, value: ch.reviewComment || '', class: 'chg-note' });
    card.approveBtn = h('button', { class: 'btn sm primary', onclick: () => reviewOne(ch.id, 'approve') }, '✓ Approve');
    card.rejectBtn = h('button', { class: 'btn sm danger', onclick: () => reviewOne(ch.id, 'reject') }, '✕ Reject & Rollback');
    card.box = pending ? h('input', {
      type: 'checkbox', class: 'chg-check', 'aria-label': `Select change #${ch.id}`, checked: selected.has(ch.id),
      onchange: () => { if (card.box.checked) selected.add(ch.id); else selected.delete(ch.id); updateToolbar(); }
    }) : null;
    card.actions = pending ? h('div', { class: 'row chg-actions' }, card.comment, card.approveBtn, card.rejectBtn) : null;
    const diff = ch.diffSummary;
    card.el = h('div', { class: `chg-card is-${ch.status}`, dataset: { id: String(ch.id) } },
      h('div', { class: 'chg-head' },
        card.box,
        h('div', { class: 'chg-title' },
          h('strong', {}, `#${ch.id} [${String(ch.targetType || '').toUpperCase()}] ${ch.targetName || ch.targetKey || ''}`),
          h('span', { class: 'muted' }, `by @${ch.authorName} · ${ch.action} · ${ch.createdAt}`)),
        card.badge),
      h('div', { class: 'chg-summary' }, ch.title || ch.summary || (typeof diff === 'string' ? diff : '')),
      diff && typeof diff === 'object'
        ? h('div', { class: 'muted chg-meta' }, `Nodes: +${diff.addedNodes ?? 0} / ~${diff.modifiedNodes ?? 0} / -${diff.removedNodes ?? 0}${(diff.changedFields || []).length ? ` · Fields: ${diff.changedFields.join(', ')}` : ''}`)
        : (diff && diff !== ch.title ? h('div', { class: 'muted chg-meta' }, String(diff)) : null),
      ch.reviewedByName ? h('div', { class: 'muted chg-meta' }, `Reviewed by @${ch.reviewedByName} at ${ch.reviewedAt}${ch.reviewComment ? `: "${ch.reviewComment}"` : ''}`) : null,
      card.actions);
    cards.set(ch.id, card);
    return card.el;
  };

  const updateMore = () => {
    const left = rows.length - shown;
    sentinel.hidden = left <= 0;
    moreBtn.textContent = `Show more (${left} remaining)`;
    emptyMsg.hidden = rows.length > 0 || cards.size > 0;
  };
  function renderMore() {
    const next = rows.slice(shown, shown + PAGE);
    if (!next.length) return updateMore();
    const frag = document.createDocumentFragment();
    for (const ch of next) frag.append(renderCard(ch));
    shown += next.length;
    list.insertBefore(frag, sentinel);
    updateMore();
  }

  // a review landed: recolor the card in place; on the PENDING tab fade it out and drop it (no list re-render)
  const markReviewed = (id, status) => {
    const idx = rows.findIndex(r => r.id === id);
    const row = idx >= 0 ? rows[idx] : null;
    const was = row ? row.status : 'pending';
    if (status === was) return false;
    if (row) row.status = status;
    if (was === 'pending') {
      counts.pending = Math.max(0, (counts.pending || 0) - 1);
      counts[status] = (counts[status] || 0) + 1;
      syncPendingCount(-1);
    }
    selected.delete(id);
    const card = cards.get(id);
    if (card) {
      card.el.classList.remove(`is-${was}`, 'is-busy');
      card.el.classList.add(`is-${status}`, 'just-reviewed');
      card.badge.textContent = status;
      card.box?.remove(); card.box = null;
      card.actions?.remove();
    }
    if (statusFilter === 'pending' && idx >= 0) {
      rows.splice(idx, 1);
      if (idx < shown) shown--;
      if (card) {
        cards.delete(id);
        const el = card.el;
        el.style.maxHeight = `${el.scrollHeight}px`;
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('chg-leaving')));
        setTimeout(() => { el.remove(); updateMore(); }, 450);
      }
    }
    return true;
  };

  const applyResults = res => {
    let ok = 0, failed = 0, skipped = 0;
    const errors = [];
    for (const r of res?.results || []) {
      const card = cards.get(r.id);
      if (r.ok) { ok++; markReviewed(r.id, r.status); continue; }
      if (r.skipped) { skipped++; if (r.status) markReviewed(r.id, r.status); continue; }
      failed++;
      if (errors.length < 3) errors.push(`#${r.id}: ${r.error}`);
      if (card) { setCardBusy(card, false); card.el.classList.add('has-error'); card.el.title = r.error || 'Review failed'; }
    }
    return { ok, failed, skipped, errors };
  };

  const refreshCounts = async () => {
    try { counts = await api.changeCounts(filters()); } catch { /* keep the local counts */ }
    if (!hasFilters()) { state.pendingChangesCount = counts.pending; syncPendingCount(); }
    updateToolbar();
  };

  async function reviewOne(id, action) {
    const card = cards.get(id);
    if (!card || card.busy || busy) return;
    setCardBusy(card, true, action);
    card.el.classList.remove('has-error');
    try {
      const saved = action === 'approve' ? await api.approveChange(id, card.comment.value) : await api.rejectChange(id, card.comment.value);
      const status = saved?.status || (action === 'approve' ? 'approved' : 'rejected');
      if (status === 'pending') { setCardBusy(card, false); progress.textContent = `#${id} is still pending`; return; }
      markReviewed(id, status);
      progress.textContent = `#${id} ${verbOf(status)}`;
      updateToolbar();
      scheduleReload();
    } catch (e) {
      setCardBusy(card, false);
      card.el.classList.add('has-error');
      toast(e.message, 'error');
    }
  }

  // reviews in chunks of CHUNK ids so a long run (a screen approval can take ~0.1 s server side) shows progress
  async function runBulk(ids, action) {
    busy = true;
    const verb = action === 'approve' ? 'Approving' : 'Rejecting';
    const targets = ids.map(id => cards.get(id)).filter(Boolean);
    for (const card of targets) setCardBusy(card, true);
    updateToolbar();
    const sum = { ok: 0, failed: 0, skipped: 0, errors: [] };
    const add = r => { sum.ok += r.ok; sum.failed += r.failed; sum.skipped += r.skipped; sum.errors.push(...r.errors); };
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        progress.textContent = `${verb}… ${i}/${ids.length}`;
        add(applyResults(await api.bulkReviewChanges({ ids: ids.slice(i, i + CHUNK), action, comment: bulkNote.value })));
        updateToolbar();
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      busy = false;
      for (const card of targets) if (card.busy && cards.get(card.ch.id) === card) setCardBusy(card, false);
      const done = action === 'approve' ? 'Approved' : 'Rejected';
      progress.textContent = `${done} ${sum.ok}${sum.skipped ? ` · ${sum.skipped} already reviewed` : ''}${sum.failed ? ` · ${sum.failed} failed` : ''}`;
      if (sum.failed) toast(`${sum.failed} change(s) could not be ${action === 'approve' ? 'approved' : 'rejected'}: ${sum.errors.join('; ')}`, 'error');
      else if (sum.ok) toast(`${done} ${sum.ok} change${sum.ok === 1 ? '' : 's'}`, 'ok');
      updateToolbar();
      if (sum.ok || sum.skipped) {
        scheduleReload();
        // approved/rejected tabs do not hold the reviewed pending rows: reload that list once
        if (loadDeferred || statusFilter === 'approved' || statusFilter === 'rejected') { loadDeferred = false; load(); }
        else refreshCounts();
      } else if (loadDeferred) { loadDeferred = false; load(); }
    }
  }

  async function reviewSelected(action) {
    const ids = [...selected];
    if (!ids.length || busy) return;
    if (ids.length > 1) {
      const ok = await confirmBox(`${action === 'approve' ? 'Approve' : 'Reject and roll back'} ${ids.length} selected changes?`,
        { okLabel: `${action === 'approve' ? 'Approve' : 'Reject'} ${ids.length}`, danger: action === 'reject' });
      if (!ok) return;
    }
    await runBulk(ids, action);
  }

  async function approveAllMatching() {
    const n = counts.pending || 0;
    if (!n || busy) return;
    if (n > 1) {
      const ok = await confirmBox(`Approve all ${n} pending changes matching the current filters? Each one is applied to its item.`,
        { okLabel: `Approve ${n}`, danger: false });
      if (!ok) return;
    }
    // the PENDING tab already holds every match; elsewhere fetch the pending ids (lite) for the same filters
    let ids = statusFilter === 'pending' ? rows.map(r => r.id) : null;
    if (!ids) {
      progress.textContent = 'Collecting matching changes…';
      try { ids = (await api.changes({ status: 'pending', lite: 1, ...filters() })).map(r => r.id); } catch (e) { progress.textContent = ''; toast(e.message, 'error'); return; }
    }
    if (ids.length) await runBulk(ids, 'approve');
  }

  const fillAuthors = changes => {
    let grew = false;
    for (const c of changes) {
      if (c.authorId != null && !authors.has(String(c.authorId))) { authors.set(String(c.authorId), c.authorName || c.authorUsername || `user ${c.authorId}`); grew = true; }
    }
    if (!grew) return;
    const cur = authorSel.value;
    authorSel.replaceChildren(h('option', { value: '' }, 'All authors'),
      ...[...authors].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => h('option', { value: id }, `@${name}`)));
    authorSel.value = cur;
  };

  const build = () => {
    built = true;
    host.replaceChildren(
      h('div', { class: 'muted' }, 'All collaborative edits are recorded with before/after snapshots. Project Owners & Admins can Approve (apply) or Reject (roll back to previous version).'),
      h('div', { class: 'chg-toolbar' }, tabs, h('div', { class: 'chg-filters' }, typeSel, authorSel, search)),
      h('div', { class: 'chg-toolbar chg-bulk' },
        h('label', { class: 'chg-selall' }, selectAll, selectAllText),
        bulkNote, approveSelBtn, rejectSelBtn, approveAllBtn, progress),
      list);
    io?.observe(sentinel);
  };

  // (re)load the list for the current tab and filters; reviews never call this
  const refresh = async () => {
    const my = ++gen;
    if (built) progress.textContent = 'Loading…';
    const [changes, cnt] = await Promise.all([
      api.changes({ status: statusFilter, lite: 1, ...filters() }),
      api.changeCounts(filters()).catch(() => null)
    ]);
    if (my !== gen) return;
    rows = changes;
    counts = cnt || {
      pending: changes.filter(c => c.status === 'pending').length,
      approved: changes.filter(c => c.status === 'approved').length,
      rejected: changes.filter(c => c.status === 'rejected').length,
      all: changes.length
    };
    if (!hasFilters()) { state.pendingChangesCount = counts.pending; syncPendingCount(); }
    for (const id of [...selected]) if (!rows.some(r => r.id === id && r.status === 'pending')) selected.delete(id);
    fillAuthors(changes);
    if (!built) build();
    cards.clear();
    shown = 0;
    list.replaceChildren(emptyMsg, sentinel);
    renderMore();
    list.scrollTop = 0;
    progress.textContent = '';
    updateToolbar();
  };
  const load = () => {
    // a filter change that slips through during a bulk run (e.g. the debounced search) reloads once it is done
    if (busy) { loadDeferred = true; return Promise.resolve(); }
    return refresh().catch(e => { progress.textContent = ''; toast(`Could not load change requests: ${e.message}`, 'error'); });
  };

  // open at once, then load (the list can be long)
  host.append(h('div', { class: 'muted', style: { padding: '24px', textAlign: 'center' } }, 'Loading change requests…'));
  modal({
    title: 'Collaborative Design Change List (Approve / Reject)',
    wide: true,
    content: host,
    onClose: () => { clearTimeout(searchTimer); io?.disconnect(); flushReload(); },
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Close')]
  });
  try { await refresh(); } catch (e) {
    host.replaceChildren(h('div', { class: 'muted', style: { padding: '24px', textAlign: 'center' } }, `Could not load change requests: ${e.message}`));
  }
}

/* ============================================================================
 * 5. Editable Button Templates & Device Templates Modal
 * ========================================================================== */
export async function openTemplatesModal(initialTab = 'buttons') {
  let tab = initialTab;
  let modeFilter = 'all'; // 'all' | 'dark' | 'light'
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '420px' } });

  const refresh = async () => {
    const [btnTpls, devTpls] = await Promise.all([
      api.templateButtons(state.activeProjectId),
      api.templateDevices(state.activeProjectId)
    ]);
    state.templateButtons = btnTpls;
    state.templateDevices = devTpls;
    host.replaceChildren();

    host.append(
      h('div', { class: 'row spread wrap', style: { gap: '8px' } },
        h('div', { class: 'row' },
          h('button', { class: `btn sm${tab === 'buttons' ? ' primary' : ''}`, onclick: () => { tab = 'buttons'; refresh(); } }, `Editable Button Templates (${btnTpls.length})`),
          h('button', { class: `btn sm${tab === 'devices' ? ' primary' : ''}`, onclick: () => { tab = 'devices'; refresh(); } }, `Editable Device Templates (${devTpls.length})`)
        ),
        tab === 'buttons' ? h('div', { class: 'seg' },
          h('button', { class: modeFilter === 'all' ? 'on' : '', onclick: () => { modeFilter = 'all'; refresh(); } }, 'All Modes'),
          h('button', { class: modeFilter === 'dark' ? 'on' : '', onclick: () => { modeFilter = 'dark'; refresh(); } }, '🌙 Dark'),
          h('button', { class: modeFilter === 'light' ? 'on' : '', onclick: () => { modeFilter = 'light'; refresh(); } }, '☀️ Light')
        ) : null
      )
    );

    if (tab === 'buttons') {
      const bName = h('input', { type: 'text', placeholder: 'e.g. Glass Pill CTA' });
      const bShape = h('select', {}, ['pill', 'rounded', 'circle', 'square', 'outline', 'split', 'fab'].map(s => h('option', { value: s }, s)));
      const bMode = h('select', {}, [
        h('option', { value: 'dark' }, '🌙 Dark Mode'),
        h('option', { value: 'light' }, '☀️ Light Mode')
      ]);
      const bW = h('input', { type: 'number', value: '160', style: { width: '75px' } });
      const bH = h('input', { type: 'number', value: '48', style: { width: '75px' } });
      const bRx = h('input', { type: 'number', value: '24', style: { width: '70px' } });

      const visibleBtnTpls = btnTpls.filter(t => {
        if (modeFilter === 'all') return true;
        const m = t.meta?.mode || (String(t.key).includes('-light') ? 'light' : 'dark');
        return m === modeFilter;
      });

      host.append(
        h('div', { style: { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', marginBottom: '6px', fontSize: '12px' } }, 'New / Editable Button Template Type (Dark & Light Modes)'),
          h('div', { class: 'row wrap' },
            h('label', { class: 'field grow' }, h('span', {}, 'Template Name'), bName),
            h('label', { class: 'field' }, h('span', {}, 'Shape'), bShape),
            h('label', { class: 'field' }, h('span', {}, 'Mode'), bMode),
            h('label', { class: 'field' }, h('span', {}, 'Width'), bW),
            h('label', { class: 'field' }, h('span', {}, 'Height'), bH),
            h('label', { class: 'field' }, h('span', {}, 'Radius rx'), bRx),
            h('button', {
              class: 'btn sm primary',
              style: { alignSelf: 'flex-end' },
              onclick: async () => {
                if (!bName.value.trim()) return toast('Enter button template name', 'error');
                try {
                  const w = Number(bW.value) || 160, h2 = Number(bH.value) || 48, rx = Number(bRx.value) || 16;
                  await api.saveTemplateButton({
                    name: bName.value.trim(),
                    shape: bShape.value,
                    width: w,
                    height: h2,
                    meta: { mode: bMode.value },
                    projectId: state.activeProjectId,
                    visibility: 'public',
                    nodes: [
                      { tag: 'rect', kind: 'shape', role: 'button', name: 'surface', attrs: { x: 0, y: 0, width: w, height: h2, rx } },
                      { tag: 'text', kind: 'text', name: 'label', text: bName.value.trim(), attrs: { x: Math.round(w / 2), y: Math.round(h2 / 2) + 5, 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle', fill: '{{text}}' } }
                    ]
                  });
                  toast('Button template saved', 'ok');
                  await reloadLibrary();
                  await refresh();
                } catch (e) {
                  toast(e.message, 'error');
                }
              }
            }, '+ Save Button Template')
          )
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '290px', overflow: 'auto' } },
          ...visibleBtnTpls.map(t => {
            const wIn = h('input', { type: 'number', value: t.width, style: { width: '70px' } });
            const hIn = h('input', { type: 'number', value: t.height, style: { width: '70px' } });
            const mode = t.meta?.mode || (String(t.key).includes('-light') ? 'light' : 'dark');
            return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '8px' } },
              h('div', { style: { flex: '1' } },
                h('div', { class: 'row', style: { gap: '6px' } },
                  h('strong', {}, t.name),
                  h('span', { class: 'badge', style: { fontSize: '10px' } }, mode === 'light' ? '☀️ LIGHT' : '🌙 DARK')
                ),
                h('div', { class: 'muted', style: { fontSize: '11px' } }, `${t.key} · style: ${t.meta?.styleFamily || t.category} · shape: ${t.shape} · ${t.width}×${t.height}`)
              ),
              h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'W'), wIn),
              h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'H'), hIn),
              h('button', {
                class: 'btn sm',
                onclick: async () => {
                  await api.saveTemplateButton({ ...t, width: Number(wIn.value) || t.width, height: Number(hIn.value) || t.height });
                  toast(`Updated template "${t.name}"`, 'ok');
                  await refresh();
                }
              }, 'Update'),
              h('button', {
                class: 'btn sm primary',
                onclick: async () => {
                  const created = await api.instantiateTemplateButton(t.id || t.key, { name: t.name, projectId: state.activeProjectId });
                  await reloadLibrary();
                  toast(`Created button "${created.name}" from template`, 'ok');
                }
              }, '+ Create Button'),
              !t.builtin ? h('button', {
                class: 'btn sm danger',
                onclick: async () => {
                  await api.deleteTemplateButton(t.id);
                  await refresh();
                }
              }, '✕') : null
            );
          })
        )
      );
    } else {
      const dName = h('input', { type: 'text', placeholder: 'e.g. Foldable Tablet' });
      const dCat = h('select', {}, ['phone', 'tablet', 'desktop', 'watch', 'tv', 'custom'].map(c => h('option', { value: c }, c)));
      const dW = h('input', { type: 'number', value: '412', style: { width: '80px' } });
      const dH = h('input', { type: 'number', value: '915', style: { width: '80px' } });

      host.append(
        h('div', { style: { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
          h('div', { style: { fontWeight: '700', marginBottom: '6px', fontSize: '12px' } }, 'New / Editable Device Frame Template'),
          h('div', { class: 'row wrap' },
            h('label', { class: 'field grow' }, h('span', {}, 'Device Name'), dName),
            h('label', { class: 'field' }, h('span', {}, 'Category'), dCat),
            h('label', { class: 'field' }, h('span', {}, 'Width (px)'), dW),
            h('label', { class: 'field' }, h('span', {}, 'Height (px)'), dH),
            h('button', {
              class: 'btn sm primary',
              style: { alignSelf: 'flex-end' },
              onclick: async () => {
                if (!dName.value.trim()) return toast('Enter device name', 'error');
                try {
                  await api.saveTemplateDevice({
                    name: dName.value.trim(),
                    category: dCat.value,
                    width: Number(dW.value) || 390,
                    height: Number(dH.value) || 844,
                    projectId: state.activeProjectId,
                    visibility: 'public'
                  });
                  toast('Device template saved', 'ok');
                  await reloadLibrary();
                  await refresh();
                } catch (e) {
                  toast(e.message, 'error');
                }
              }
            }, '+ Save Device Template')
          )
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '290px', overflow: 'auto' } },
          ...devTpls.map(d => {
            const wIn = h('input', { type: 'number', value: d.width, style: { width: '75px' } });
            const hIn = h('input', { type: 'number', value: d.height, style: { width: '75px' } });
            return h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '8px' } },
              h('div', { style: { flex: '1' } },
                h('strong', {}, d.name),
                h('div', { class: 'muted', style: { fontSize: '11px' } }, `${d.key} · ${d.category} · ${d.width}×${d.height}`)
              ),
              h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'W'), wIn),
              h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'H'), hIn),
              h('button', {
                class: 'btn sm',
                onclick: async () => {
                  await api.saveTemplateDevice({ ...d, width: Number(wIn.value) || d.width, height: Number(hIn.value) || d.height });
                  await reloadLibrary();
                  toast(`Updated device "${d.name}"`, 'ok');
                  await refresh();
                }
              }, 'Update'),
              !d.builtin ? h('button', {
                class: 'btn sm danger',
                onclick: async () => {
                  await api.deleteTemplateDevice(d.id);
                  await refresh();
                }
              }, '✕') : null
            );
          })
        )
      );
    }
  };

  await refresh();
  modal({
    title: 'Editable Template Buttons & Template Devices',
    wide: true,
    content: host,
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Done')]
  });
}

/* ============================================================================
 * 6. Multi-Event & Small Element Toolbar Editor Modal
 * ========================================================================== */
export async function openEventsModal({ node, docType, docId, onSave }) {
  const screens = await api.list('screen');
  const elements = state.library.elements || [];
  const events = Array.isArray(node.events) ? node.events.map(e => ({ ...e })) : [];
  if (node.onClick && !events.some(e => e.trigger === 'click')) {
    events.unshift({ trigger: 'click', ...node.onClick });
  }

  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

  const trigSel = h('select', {}, EVENT_TRIGGERS.map(t => h('option', { value: t }, t)));
  const actSel = h('select', {}, [
    h('option', { value: 'element' }, 'Open an Element (inline/modal)'),
    h('option', { value: 'popup' }, 'Open a Popup (centered overlay)'),
    h('option', { value: 'toolbar' }, 'Open Small Element Floating Toolbar'),
    h('option', { value: 'drawer' }, 'Open a Slide-in Drawer'),
    h('option', { value: 'screen' }, 'Route to a Screen'),
    h('option', { value: 'animate' }, 'Trigger Animation'),
    h('option', { value: 'toggle' }, 'Toggle / Flip Element State'),
    h('option', { value: 'back' }, 'Go Back (previous screen)')
  ]);
  const targetScreenSel = h('select', {}, screens.map(s => h('option', { value: s.id }, `${s.name} (${s.key})`)));
  const targetElemSel = h('select', {}, [
    h('option', { value: '' }, 'Default built-in mini toolbar / choose element...'),
    ...elements.map(e => h('option', { value: e.id }, `${e.name} (${e.width}×${e.height})`))
  ]);
  const posSel = h('select', {}, TOOLBAR_POSITIONS.map(p => h('option', { value: p }, p)));
  const sideSel = h('select', {}, DRAWER_SIDES.map(s => h('option', { value: s }, s)));

  const renderList = () => {
    host.replaceChildren();
    host.append(
      h('div', { class: 'muted' }, `Configure interactive events for "${node.name || node.tag}" (#${node.id}). Every event (click, mouseover, release, drag, drop, dblclick, etc.) can open an element, a popup, a small element toolbar, route to a screen, or trigger animations.`),
      h('div', { style: { padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px' } },
        h('div', { style: { fontWeight: '700', marginBottom: '6px', fontSize: '12px' } }, 'Add Event Binding'),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field' }, h('span', {}, 'Event Trigger'), trigSel),
          h('label', { class: 'field grow' }, h('span', {}, 'Action'), actSel),
          h('label', { class: 'field grow' }, h('span', {}, 'Target Screen (for route)'), targetScreenSel),
          h('label', { class: 'field grow' }, h('span', {}, 'Target Element / Toolbar'), targetElemSel),
          h('label', { class: 'field' }, h('span', {}, 'Toolbar Pos'), posSel),
          h('label', { class: 'field' }, h('span', {}, 'Drawer Side'), sideSel),
          h('button', {
            class: 'btn sm primary',
            style: { alignSelf: 'flex-end' },
            onclick: () => {
              const type = actSel.value;
              const ev = { trigger: trigSel.value, type };
              if (type === 'screen') {
                const tid = Number(targetScreenSel.value);
                if (!tid) return toast('Create or select a target screen first', 'error');
                ev.targetId = tid;
              } else if (type === 'popup' || type === 'drawer' || type === 'element') {
                const tid = Number(targetElemSel.value || elements[0]?.id);
                if (!tid) return toast('Select a target element', 'error');
                ev.targetId = tid;
                if (type === 'drawer') ev.side = sideSel.value;
                if (type === 'element') ev.position = posSel.value;
              } else if (type === 'toolbar') {
                if (targetElemSel.value) ev.targetId = Number(targetElemSel.value);
                ev.position = posSel.value || 'top';
              }
              const existingIdx = events.findIndex(x => x.trigger === ev.trigger && x.type === ev.type);
              if (existingIdx >= 0) events[existingIdx] = ev;
              else events.push(ev);
              renderList();
            }
          }, '+ Add Event')
        )
      )
    );

    const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflow: 'auto' } });
    if (!events.length) {
      list.append(h('div', { class: 'muted', style: { padding: '16px', textAlign: 'center' } }, 'No events bound to this element yet.'));
    }
    events.forEach((ev, idx) => {
      let targetLabel = '';
      if (ev.type === 'screen') {
        const sc = screens.find(s => s.id === ev.targetId);
        targetLabel = `→ Screen: ${sc ? sc.name : '#' + ev.targetId}`;
      } else if (['popup', 'drawer', 'element', 'toolbar'].includes(ev.type)) {
        const el = elements.find(e => e.id === ev.targetId);
        targetLabel = `→ ${el ? el.name : (ev.type === 'toolbar' ? 'Quick Mini Toolbar' : '#' + ev.targetId)}${ev.side ? ` (${ev.side})` : ''}${ev.position ? ` [${ev.position}]` : ''}`;
      }
      list.append(
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '8px' } },
          h('div', {},
            h('span', { class: 'badge accent', style: { marginRight: '8px' } }, `on:${ev.trigger}`),
            h('strong', {}, ev.type.toUpperCase()),
            h('span', { class: 'muted', style: { marginLeft: '8px' } }, targetLabel)
          ),
          h('button', {
            class: 'btn sm danger',
            onclick: () => {
              events.splice(idx, 1);
              renderList();
            }
          }, '✕')
        )
      );
    });
    host.append(list);
  };

  renderList();
  modal({
    title: `Events & Actions — ${node.name || node.tag}`,
    wide: true,
    content: host,
    actions: close => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const clickEv = events.find(e => e.trigger === 'click');
          const onClick = clickEv && ['screen', 'popup', 'drawer', 'back', 'element', 'toolbar', 'animate', 'toggle'].includes(clickEv.type)
            ? { type: clickEv.type, ...(clickEv.targetId ? { targetId: clickEv.targetId } : {}), ...(clickEv.side ? { side: clickEv.side } : {}), ...(clickEv.position ? { position: clickEv.position } : {}) }
            : null;
          if (onSave) await onSave({ events, onClick });
          else if (docType && docId) await api.patchNode(docType, docId, node.id, { events, onClick });
          toast('Element events saved', 'ok');
          close();
        }
      }, 'Save Events')
    ]
  });
}

/* ============================================================================
 * 7. Root Owner & Clone Lineage Inspector Modal
 * ========================================================================== */
export async function openLineageModal(type, id) {
  const lineage = await api.getLineage(type, id);
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('div', { style: { padding: '12px', border: '1px solid var(--line)', borderRadius: '10px', background: 'rgba(46,155,255,0.08)' } },
      h('div', { style: { fontWeight: '700', fontSize: '14px' } }, `${lineage.itemName || lineage.item?.name} (${lineage.itemKey || lineage.item?.key})`),
      h('div', { class: 'muted', style: { marginTop: '4px' } }, `Current Creator: ${ownerLabel(lineage.creator?.username || 'kyrpy')} · Root Original Owner: ${ownerLabel(lineage.rootOwner?.username || 'kyrpy')}`),
      h('div', { class: 'muted' }, `Visibility: ${lineage.visibility || lineage.item?.visibility} · Project ID: #${lineage.projectId || lineage.item?.projectId}`)
    ),
    h('div', { style: { fontWeight: '700', fontSize: '12px' } }, 'Provenance & Clone Chain (Root → Current):'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
      ...[...(lineage.chain || [])].reverse().map((step, idx) =>
        h('div', { style: { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between' } },
          h('span', {}, `${idx === 0 ? '★ ROOT ORIGIN' : `↳ Clone Hop #${idx}`}: ${step.name} (${step.key})`),
          h('span', { class: 'muted' }, `Owner: @${step.creatorUsername} · #${step.id}`)
        )
      )
    )
  );
  modal({
    title: 'Item Provenance & Root Owner Lineage',
    content: host,
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Close')]
  });
}

/* ============================================================================
 * 8. Offline-First & PostgreSQL Sync + Translations Modal
 * ========================================================================== */
export async function openSyncModal(initialTab = 'sync') {
  let tab = initialTab;
  const host = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '360px' } });

  const refresh = async () => {
    host.replaceChildren();
    host.append(
      h('div', { class: 'row' },
        h('button', { class: `btn sm${tab === 'sync' ? ' primary' : ''}`, onclick: () => { tab = 'sync'; refresh(); } }, 'Offline-First & PostgreSQL Sync'),
        h('button', { class: `btn sm${tab === 'i18n' ? ' primary' : ''}`, onclick: () => { tab = 'i18n'; refresh(); } }, 'Multi-Language Translations (i18n)')
      )
    );

    if (tab === 'sync') {
      const st = await api.syncStatus();
      state.syncStatus = st;
      const browserOutbox = api.outbox();

      host.append(
        h('div', { style: { padding: '12px', border: '1px solid var(--line)', borderRadius: '12px', background: 'rgba(16,185,129,0.08)' } },
          h('div', { style: { fontWeight: '700', fontSize: '14px' } }, `PostgreSQL Database: ${st.database} @ ${st.host}:${st.port}`),
          h('div', { class: 'muted', style: { marginTop: '4px' } }, `Local SQLite Outbox Pending: ${st.pendingCount} · Synced Total: ${st.syncedCount} · Browser Offline Outbox: ${browserOutbox.length}`),
          h('div', { class: 'muted' }, `Last Push: ${st.state?.last_push_at || 'never'} · Last Pull: ${st.state?.last_pull_at || 'never'} · Status: ${st.state?.last_sync_status || 'ready'}`)
        ),
        h('div', { class: 'row wrap' },
          h('button', {
            class: 'btn primary',
            onclick: async () => {
              try {
                await api.flushOutbox();
                const res = await api.syncNow({ pull: true, forceFullPush: false });
                await reloadLibrary();
                toast(`Synced with PostgreSQL! Pushed ${res.push?.pushed ?? 0} changes.`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '⟳ Sync Now (Push & Pull)'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              try {
                const res = await api.syncPush({ forceFull: true });
                toast(`Full snapshot pushed to PostgreSQL (${res.pushed} tables/batches)`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '⬆ Force Full Push to PostgreSQL'),
          h('button', {
            class: 'btn',
            onclick: async () => {
              try {
                const res = await api.syncPull();
                await reloadLibrary();
                toast(`Pulled ${res.pulledUsers} users & ${res.pulledProjects} projects from PostgreSQL`, 'ok');
                await refresh();
              } catch (e) {
                toast(e.message, 'error');
              }
            }
          }, '⬇ Pull from PostgreSQL')
        )
      );
    } else {
      const [rows, langs] = await Promise.all([api.translations({ projectId: state.activeProjectId }), api.languages()]);
      const tLang = h('input', { type: 'text', placeholder: 'Lang code (e.g. tr, de, es)', value: 'tr', style: { width: '90px' } });
      const tType = h('select', {}, ['screen', 'element', 'button', 'icon', 'workflow'].map(x => h('option', { value: x }, x)));
      const tId = h('input', { type: 'number', placeholder: 'Item ID', value: '1', style: { width: '80px' } });
      const tField = h('input', { type: 'text', placeholder: 'Field (label)', value: 'label', style: { width: '100px' } });
      const tVal = h('input', { type: 'text', placeholder: 'Translated text' });

      host.append(
        h('div', { class: 'muted' }, `Active Languages: ${(langs || []).map(l => typeof l === 'object' ? `${l.code} (${l.count})` : l).join(', ') || 'en'}`),
        h('div', { class: 'row wrap' },
          h('label', { class: 'field' }, h('span', {}, 'Lang'), tLang),
          h('label', { class: 'field' }, h('span', {}, 'Type'), tType),
          h('label', { class: 'field' }, h('span', {}, 'Item ID'), tId),
          h('label', { class: 'field' }, h('span', {}, 'Field'), tField),
          h('label', { class: 'field grow' }, h('span', {}, 'Translated Value'), tVal),
          h('button', {
            class: 'btn sm primary',
            style: { alignSelf: 'flex-end' },
            onclick: async () => {
              if (!tVal.value.trim()) return toast('Enter translated value', 'error');
              await api.saveTranslation({
                projectId: state.activeProjectId,
                lang: tLang.value.trim(),
                itemType: tType.value,
                itemId: Number(tId.value) || 1,
                field: tField.value.trim() || 'label',
                value: tVal.value.trim()
              });
              toast('Translation saved', 'ok');
              await refresh();
            }
          }, '+ Save Translation')
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '240px', overflow: 'auto' } },
          ...rows.map(r =>
            h('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '6px 10px', border: '1px solid var(--line)', borderRadius: '8px' } },
              h('span', {}, `[${r.lang}] ${r.itemType} #${r.itemId}.${r.field} = "${r.value}"`),
              h('button', { class: 'btn sm danger', onclick: async () => { await api.deleteTranslation(r.id); await refresh(); } }, '✕')
            )
          )
        )
      );
    }
  };

  await refresh();
  modal({
    title: 'Offline-First PostgreSQL Sync & Translations',
    wide: true,
    content: host,
    actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Done')]
  });
}
