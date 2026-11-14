/**
 * Astryx extended public UI catalog (Meta Astryx-inspired, kyrpy-uiux-designer).
 *
 * ~138 reusable elements for the public library: admin panel, user management,
 * credits, API keys, detailed reports, sample cards, authentication screens,
 * permissions/configuration, subscriptions, animated popups, file explorer,
 * controls/menus/icons, feedback states and onboarding.
 *
 * Tokens used: {{bg}} {{card}} {{text}} {{muted}} {{line}} {{stroke}} {{accent}} {{accent1}} {{onAccent}}.
 * Built on the shape helpers exported by astryx-catalog.js.
 */

import { R, C, L, P, T, item } from './astryx-catalog.js';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const mk = (cat, label, tag, w, h, nodes, dev, meta = {}) =>
  item(`astryx-x-${cat}-${slug(label)}`, `Astryx ${label}`, cat, tag, w, h, nodes,
    { dev, meta: { source: 'astryx-extended', ...meta } });

const GOOD = '#16A34A', BAD = '#DC2626', WARN = '#D97706', INFO = '#2563EB';
const GOOD_BG = '#DCFCE7', BAD_BG = '#FEE2E2', WARN_BG = '#FEF3C7', INFO_BG = '#DBEAFE';
const TXT = '{{text}}', MUTED = '{{muted}}', ACC = '{{accent}}';

const pill = (x, y, label, fg, bg) => {
  const w = label.length * 7 + 20;
  return [
    R(x, y, w, 22, { fill: bg, rx: 11, name: 'pill' }),
    T(x + w / 2, y + 15, label, { size: 11, weight: 600, anchor: 'middle', fill: fg, name: 'pill-text' })
  ];
};
const STATUS = {
  active: [GOOD, GOOD_BG], live: [GOOD, GOOD_BG], paid: [GOOD, GOOD_BG],
  suspended: [BAD, BAD_BG], revoked: [BAD, BAD_BG], failed: [BAD, BAD_BG],
  invited: [WARN, WARN_BG], pending: [WARN, WARN_BG],
  test: [INFO, INFO_BG]
};
const statusPill = (x, y, s) => pill(x, y, s.toUpperCase(), STATUS[s][0], STATUS[s][1]);

const av = (x, y, r, initials, color = ACC) => [
  C(x, y, r, { fill: color, name: 'avatar' }),
  T(x, y + r * 0.35, initials, { size: Math.round(r * 0.8), weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'initials' })
];

const ICON = {
  user: (x, y) => [C(x, y - 4, 4, { stroke: TXT, sw: 1.4, name: 'icon-head' }), P(`M${x - 7} ${y + 8}q7-9 14 0`, { stroke: TXT, sw: 1.4, name: 'icon-body' })],
  key: (x, y) => [C(x - 4, y, 3.5, { stroke: TXT, sw: 1.4, name: 'icon-bow' }), P(`M${x - 1} ${y}h8M${x + 5} ${y}v3M${x + 8} ${y}v3`, { stroke: TXT, sw: 1.4, name: 'icon-shaft' })],
  lock: (x, y) => [R(x - 6, y - 1, 12, 10, { rx: 2, stroke: TXT, sw: 1.4, name: 'icon-body' }), P(`M${x - 3} ${y - 1}v-3a3 3 0 016 0v3`, { stroke: TXT, sw: 1.4, name: 'icon-shackle' })],
  credit: (x, y) => [R(x - 8, y - 5, 16, 10, { rx: 2, stroke: TXT, sw: 1.4, name: 'icon-card' }), L(x - 8, y - 1, x + 8, y - 1, { stroke: TXT, name: 'icon-stripe' })],
  gear: (x, y) => [C(x, y, 6, { stroke: TXT, sw: 1.4, name: 'icon-gear' }), C(x, y, 2, { fill: TXT, name: 'icon-hub' })],
  file: (x, y) => [P(`M${x - 5} ${y - 7}h7l4 4v10h-11z`, { stroke: TXT, sw: 1.4, name: 'icon-file' })],
  folder: (x, y) => [P(`M${x - 8} ${y - 5}h5l2 2h7v9h-14z`, { stroke: TXT, sw: 1.4, name: 'icon-folder' })],
  chart: (x, y) => [P(`M${x - 7} ${y + 6}v-6M${x - 2} ${y + 6}v-10M${x + 3} ${y + 6}v-4M${x + 8} ${y + 6}v-8`, { stroke: TXT, sw: 1.6, name: 'icon-chart' })],
  shield: (x, y) => [P(`M${x} ${y - 8}l7 3v4c0 4-3 7-7 8-4-1-7-4-7-8v-4z`, { stroke: TXT, sw: 1.4, name: 'icon-shield' })],
  bell: (x, y) => [P(`M${x - 6} ${y + 4}v-4a6 6 0 0112 0v4l2 2h-16z`, { stroke: TXT, sw: 1.4, name: 'icon-bell' })],
  check: (x, y) => [P(`M${x - 6} ${y}l4 4 8-8`, { stroke: GOOD, sw: 2, name: 'icon-check' })],
  cross: (x, y) => [P(`M${x - 5} ${y - 5}l10 10M${x + 5} ${y - 5}l-10 10`, { stroke: BAD, sw: 2, name: 'icon-cross' })],
  search: (x, y) => [C(x - 1, y - 1, 5, { stroke: TXT, sw: 1.4, name: 'icon-lens' }), L(x + 3, y + 3, x + 7, y + 7, { stroke: TXT, sw: 1.4, name: 'icon-handle' })],
  plus: (x, y) => [P(`M${x - 5} ${y}h10M${x} ${y - 5}v10`, { stroke: TXT, sw: 1.6, name: 'icon-plus' })],
  upload: (x, y) => [P(`M${x - 6} ${y + 5}h12M${x} ${y + 4}v-9M${x - 4} ${y - 1}l4-4 4 4`, { stroke: TXT, sw: 1.4, name: 'icon-upload' })],
  download: (x, y) => [P(`M${x - 6} ${y + 5}h12M${x} ${y - 7}v10M${x - 4} ${y + 1}l4 4 4-4`, { stroke: TXT, sw: 1.4, name: 'icon-download' })],
  trash: (x, y) => [P(`M${x - 6} ${y - 4}h12M${x - 3} ${y - 4}v-2h6v2M${x - 5} ${y - 4}l1 10h8l1-10`, { stroke: BAD, sw: 1.3, name: 'icon-trash' })],
  star: (x, y) => [P(`M${x} ${y - 7}l2.2 4.6 5 .6-3.7 3.4 1 5L${x} ${y + 3.6}l-4.5 2.6 1-5-3.7-3.4 5-.6z`, { stroke: WARN, sw: 1.2, fill: WARN_BG, name: 'icon-star' })],
  mail: (x, y) => [R(x - 8, y - 5, 16, 11, { rx: 2, stroke: TXT, sw: 1.4, name: 'icon-mail' }), P(`M${x - 8} ${y - 5}l8 6 8-6`, { stroke: TXT, sw: 1.4, name: 'icon-flap' })],
  calendar: (x, y) => [R(x - 7, y - 6, 14, 13, { rx: 2, stroke: TXT, sw: 1.4, name: 'icon-cal' }), L(x - 7, y - 2, x + 7, y - 2, { stroke: TXT, name: 'icon-cal-top' })],
  clock: (x, y) => [C(x, y, 7, { stroke: TXT, sw: 1.4, name: 'icon-clock' }), P(`M${x} ${y - 4}v4h3`, { stroke: TXT, sw: 1.4, name: 'icon-hands' })],
  share: (x, y) => [C(x - 5, y, 2.5, { stroke: TXT, sw: 1.4, name: 'icon-node-a' }), C(x + 5, y - 5, 2.5, { stroke: TXT, sw: 1.4, name: 'icon-node-b' }), C(x + 5, y + 5, 2.5, { stroke: TXT, sw: 1.4, name: 'icon-node-c' }), L(x - 3, y - 1, x + 3, y - 4, { stroke: TXT, name: 'icon-link-a' }), L(x - 3, y + 1, x + 3, y + 4, { stroke: TXT, name: 'icon-link-b' })],
  eye: (x, y) => [P(`M${x - 8} ${y}q8-8 16 0q-8 8-16 0z`, { stroke: TXT, sw: 1.4, name: 'icon-eye' }), C(x, y, 2, { fill: TXT, name: 'icon-pupil' })]
};
const icon = (name, x, y) => ICON[name](x, y);

const bars = (x, y, w, h, vals, color) => {
  const max = Math.max(...vals), bw = w / vals.length;
  return vals.map((v, i) => {
    const bh = (v / max) * h;
    return R(x + i * bw + bw * 0.2, y + h - bh, bw * 0.6, bh, { fill: color, rx: 4, name: `bar-${i}` });
  });
};

const line = (x, y, w, h, vals, color) => {
  const max = Math.max(...vals), min = Math.min(...vals), step = w / (vals.length - 1);
  const pts = vals.map((v, i) => `${(x + i * step).toFixed(1)} ${(y + h - ((v - min) / ((max - min) || 1)) * h).toFixed(1)}`);
  return [P(`M${pts[0]}` + pts.slice(1).map(p => `L${p}`).join(''), { stroke: color, sw: 2, name: 'series' })];
};

const ring = (cx, cy, r, pct, color) => {
  const c = 2 * Math.PI * r;
  return [
    { tag: 'circle', kind: 'shape', role: null, name: 'ring-track', descriptionDev: '', attrs: { cx, cy, r, fill: 'none', stroke: '{{line}}', 'stroke-width': 10 } },
    { tag: 'circle', kind: 'shape', role: null, name: 'ring-value', descriptionDev: '', attrs: { cx, cy, r, fill: 'none', stroke: color, 'stroke-width': 10, 'stroke-linecap': 'round', 'stroke-dasharray': `${(c * pct).toFixed(1)} ${c.toFixed(1)}`, transform: `rotate(-90 ${cx} ${cy})` } }
  ];
};

const meter = (x, y, w, pct, label) => {
  const color = pct > 80 ? BAD : pct > 50 ? WARN : GOOD;
  return [
    R(x, y, w, 10, { role: 'field', rx: 5, name: 'track' }),
    R(x, y, (w * pct) / 100, 10, { fill: color, rx: 5, name: 'fill' }),
    T(x + w, y - 6, label, { size: 11, weight: 600, anchor: 'end', fill: MUTED, name: 'meter-label' })
  ];
};

const ITEMS = [];

/* ============================================================================
 * 1. ADMIN PANEL (13)
 * ========================================================================== */
const KPIS = [
  ['Total users', '12,480', '+8.2%', true], ['Active sessions', '1,932', '+3.1%', true],
  ['Churn rate', '2.4%', '-0.6%', true], ['Credits consumed', '84,215', '+14.0%', true],
  ['API calls today', '3.2M', '+21.4%', true], ['Failed payments', '17', '+5 today', false]
];
for (const [l, v, d, up] of KPIS) {
  ITEMS.push(mk('admin', `KPI ${l}`, 'div', 260, 112, [
    R(0, 0, 260, 112, { role: 'card', rx: 14, name: 'card' }),
    T(18, 30, l, { size: 12, weight: 600, fill: MUTED, name: 'label' }),
    T(18, 66, v, { size: 26, weight: 800, fill: TXT, name: 'value' }),
    ...pill(18, 78, d, up ? GOOD : BAD, up ? GOOD_BG : BAD_BG),
    ...icon('chart', 232, 26)
  ], `Admin KPI tile: ${l}.`));
}

const SIDEBAR_ITEMS = [['Dashboard', 'chart'], ['Users', 'user'], ['Credits', 'credit'], ['API keys', 'key'], ['Reports', 'file'], ['Settings', 'gear']];
const sidebarNodes = (w, collapsed) => {
  const h = 56 + SIDEBAR_ITEMS.length * 38 + 16;
  return [
    R(0, 0, w, h, { role: 'card', name: 'sidebar' }),
    ...(collapsed ? [] : [T(20, 32, 'Admin', { size: 15, weight: 800, fill: TXT, name: 'brand' })]),
    ...SIDEBAR_ITEMS.flatMap(([label, ic], i) => {
      const y = 56 + i * 38, active = i === 1;
      return [
        ...(active ? [R(10, y, w - 20, 32, { fill: ACC, rx: 8, name: 'active-bg' })] : []),
        ...icon(ic, collapsed ? w / 2 : 26, y + 16),
        ...(collapsed ? [] : [T(42, y + 21, label, { size: 13, weight: active ? 700 : 500, fill: active ? '{{onAccent}}' : TXT, name: 'nav-label' })])
      ];
    })
  ];
};
ITEMS.push(mk('admin', 'Sidebar Navigation Expanded', 'nav', 220, 292, sidebarNodes(220, false), 'Admin sidebar with active item.'));
ITEMS.push(mk('admin', 'Sidebar Navigation Collapsed', 'nav', 56, 292, sidebarNodes(56, true), 'Icon-only collapsed admin sidebar.'));

ITEMS.push(mk('admin', 'Admin Topbar', 'header', 1000, 60, [
  R(0, 0, 1000, 60, { role: 'card', name: 'bar' }),
  T(24, 37, 'Admin Console', { size: 16, weight: 800, fill: TXT, name: 'brand' }),
  R(260, 16, 340, 28, { role: 'field', rx: 14, name: 'search' }),
  ...icon('search', 276, 30), T(296, 34, 'Search users, keys, orders...', { size: 12, fill: MUTED, name: 'search-text' }),
  ...icon('bell', 900, 30), C(930, 30, 4, { fill: BAD, name: 'unread-dot' }),
  ...av(966, 30, 14, 'KA')
], 'Admin topbar with global search, notifications and account avatar.'));

ITEMS.push(mk('admin', 'Breadcrumb Trail', 'nav', 360, 28, [
  T(0, 18, 'Admin  /  Users  /  Jane Doe', { size: 12, weight: 500, fill: MUTED, name: 'crumbs' })
], 'Breadcrumb for nested admin pages.'));

ITEMS.push(mk('admin', 'Page Header With Actions', 'header', 720, 80, [
  T(0, 30, 'User management', { size: 22, weight: 800, fill: TXT, name: 'title' }),
  T(0, 54, '248 members across 6 workspaces', { size: 13, fill: MUTED, name: 'subtitle' }),
  R(480, 22, 120, 36, { role: 'button', rx: 10, name: 'secondary' }), T(540, 45, 'Export', { size: 13, weight: 600, anchor: 'middle', fill: TXT, name: 'secondary-label' }),
  R(612, 22, 108, 36, { fill: ACC, rx: 10, name: 'primary' }), T(666, 45, 'Invite', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'primary-label' })
], 'Admin page header: title, subtitle and secondary/primary actions.'));

ITEMS.push(mk('admin', 'Filter Bar', 'div', 720, 48, [
  R(0, 0, 720, 48, { role: 'card', rx: 12, name: 'bar' }),
  R(12, 10, 220, 28, { role: 'field', rx: 8, name: 'search' }), T(26, 28, 'Filter by name or email', { size: 12, fill: MUTED, name: 'search-text' }),
  R(244, 10, 120, 28, { role: 'field', rx: 8, name: 'role-select' }), T(256, 28, 'Role: any', { size: 12, fill: TXT, name: 'role-text' }),
  R(376, 10, 130, 28, { role: 'field', rx: 8, name: 'status-select' }), T(388, 28, 'Status: active', { size: 12, fill: TXT, name: 'status-text' }),
  R(620, 10, 88, 28, { role: 'button', rx: 8, name: 'reset' }), T(664, 28, 'Reset', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'reset-label' })
], 'Filter bar for admin tables with search, role and status selects.'));

ITEMS.push(mk('admin', 'Bulk Action Bar', 'div', 560, 48, [
  R(0, 0, 560, 48, { fill: ACC, rx: 12, name: 'bar' }),
  T(18, 29, '3 selected', { size: 13, weight: 700, fill: '{{onAccent}}', name: 'count' }),
  T(300, 29, 'Suspend', { size: 13, weight: 600, fill: '{{onAccent}}', name: 'act-1' }),
  T(390, 29, 'Add credits', { size: 13, weight: 600, fill: '{{onAccent}}', name: 'act-2' }),
  T(510, 29, 'Clear', { size: 13, weight: 600, fill: '{{onAccent}}', name: 'act-3' })
], 'Appears above a table when rows are selected.'));

/* ============================================================================
 * 2. USER MANAGEMENT (15)
 * ========================================================================== */
const USERS = [['Jane Doe', 'Admin', 'Enterprise', 'JD', ACC], ['Sam Ortiz', 'Designer', 'Pro', 'SO', '#7C3AED'], ['Lee Park', 'Viewer', 'Free', 'LP', '#0891B2']];
for (const [name, role, plan, ini, col] of USERS) {
  ITEMS.push(mk('users', `User Card ${name}`, 'div', 300, 150, [
    R(0, 0, 300, 150, { role: 'card', rx: 16, name: 'card' }),
    ...av(44, 46, 22, ini, col),
    T(78, 42, name, { size: 15, weight: 700, fill: TXT, name: 'name' }),
    T(78, 60, `${role} · ${plan} plan`, { size: 12, fill: MUTED, name: 'role' }),
    L(18, 86, 282, 86, { stroke: '{{line}}', name: 'divider' }),
    T(18, 112, 'Last active 2 hours ago', { size: 11, fill: MUTED, name: 'activity' }),
    ...icon('mail', 262, 112)
  ], `User profile card for ${name} (${role}).`));
}

const ROWS = [['Jane Doe', 'jane@acme.dev', 'active'], ['Sam Ortiz', 'sam@acme.dev', 'suspended'], ['Lee Park', 'lee@acme.dev', 'invited']];
for (const [name, email, st] of ROWS) {
  ITEMS.push(mk('users', `User Row ${st} ${name}`, 'div', 720, 52, [
    R(0, 0, 720, 52, { role: 'card', rx: 10, name: 'row' }),
    C(22, 26, 1, { name: 'spacer' }),
    ...av(40, 26, 14, name.split(' ').map(w => w[0]).join('')),
    T(64, 22, name, { size: 13, weight: 600, fill: TXT, name: 'name' }),
    T(64, 38, email, { size: 11, fill: MUTED, name: 'email' }),
    ...statusPill(380, 15, st),
    T(560, 30, 'Member', { size: 12, fill: TXT, name: 'role' }),
    ...icon('gear', 690, 26)
  ], `User table row with ${st} status.`));
}

const ROLES = [['Owner', '#7C3AED', '#EDE9FE'], ['Admin', INFO, INFO_BG], ['Editor', GOOD, GOOD_BG], ['Viewer', MUTED, '#F1F5F9']];
for (const [r, fg, bg] of ROLES) {
  ITEMS.push(mk('users', `Role Badge ${r}`, 'span', r.length * 7 + 20, 22, pill(0, 0, r, fg, bg), `Role badge: ${r}.`));
}

ITEMS.push(mk('users', 'Invite Teammate Card', 'form', 360, 200, [
  R(0, 0, 360, 200, { role: 'card', rx: 16, name: 'card' }),
  T(20, 30, 'Invite teammate', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  R(20, 46, 320, 36, { role: 'field', rx: 10, name: 'email' }), T(34, 69, 'name@company.com', { size: 12, fill: MUTED, name: 'email-ph' }),
  R(20, 96, 320, 36, { role: 'field', rx: 10, name: 'role' }), T(34, 119, 'Role: Editor', { size: 12, fill: TXT, name: 'role-text' }),
  R(20, 150, 320, 34, { fill: ACC, rx: 10, name: 'send' }), T(180, 172, 'Send invite', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'send-label' })
], 'Invite form: email, role select and send action.'));

const MATRIX_ROWS = [['Read', [1, 1, 1]], ['Write', [0, 1, 1]], ['Delete', [0, 0, 1]], ['Billing', [0, 0, 1]]];
ITEMS.push(mk('users', 'Role Permission Matrix', 'table', 560, 200, [
  R(0, 0, 560, 200, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Permission', { size: 12, weight: 700, fill: MUTED, name: 'h-perm' }),
  ...['Viewer', 'Editor', 'Admin'].map((c, i) => T(300 + i * 90, 30, c, { size: 12, weight: 700, anchor: 'middle', fill: MUTED, name: `h-${i}` })),
  ...MATRIX_ROWS.flatMap(([perm, grants], ri) => [
    T(20, 70 + ri * 34, perm, { size: 13, fill: TXT, name: `perm-${ri}` }),
    ...grants.flatMap((g, ci) => icon(g ? 'check' : 'cross', 300 + ci * 90, 66 + ri * 34))
  ])
], 'Role-based permission matrix (read / write / delete / billing).'));

ITEMS.push(mk('users', 'User Detail Header', 'header', 720, 96, [
  R(0, 0, 720, 96, { role: 'card', rx: 16, name: 'card' }),
  ...av(50, 48, 28, 'JD'),
  T(92, 40, 'Jane Doe', { size: 18, weight: 800, fill: TXT, name: 'name' }),
  T(92, 60, 'jane@acme.dev · joined Mar 2025', { size: 12, fill: MUTED, name: 'meta' }),
  ...statusPill(92, 68, 'active'),
  R(560, 30, 140, 36, { role: 'button', rx: 10, name: 'impersonate' }), T(630, 53, 'View as user', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'impersonate-label' })
], 'Detail header for one user with status and quick action.'));

const EVENTS = [['Logged in from Berlin', 'user'], ['Changed role to Editor', 'gear'], ['Created API key', 'key'], ['Topped up 500 credits', 'credit']];
ITEMS.push(mk('users', 'Activity Timeline', 'ol', 360, 220, [
  R(0, 0, 360, 220, { role: 'card', rx: 14, name: 'card' }),
  L(30, 34, 30, 200, { stroke: '{{line}}', name: 'rail' }),
  ...EVENTS.flatMap(([t, ic], i) => [
    C(30, 46 + i * 44, 6, { fill: ACC, name: `dot-${i}` }),
    T(50, 50 + i * 44, t, { size: 13, weight: 500, fill: TXT, name: `event-${i}` }),
    ...icon(ic, 330, 46 + i * 44)
  ])
], 'Vertical activity timeline for a user account.'));

ITEMS.push(mk('users', 'Suspend User Confirm', 'dialog', 380, 200, [
  R(0, 0, 380, 200, { role: 'card', rx: 16, name: 'card' }),
  ...icon('shield', 34, 38),
  T(56, 42, 'Suspend Sam Ortiz?', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  T(20, 80, 'They will lose access until reinstated. Active sessions end now.', { size: 12, fill: MUTED, name: 'body' }),
  R(160, 150, 96, 32, { role: 'button', rx: 8, name: 'cancel' }), T(208, 170, 'Cancel', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'cancel-label' }),
  R(264, 150, 96, 32, { fill: BAD, rx: 8, name: 'confirm' }), T(312, 170, 'Suspend', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'confirm-label' })
], 'Destructive confirmation before suspending a user.'));

ITEMS.push(mk('users', 'Team Directory Grid Header', 'header', 720, 56, [
  T(0, 24, 'Workspace members', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  T(0, 42, '6 teams · 248 people', { size: 11, fill: MUTED, name: 'sub' }),
  ...icon('search', 660, 24), ...icon('plus', 694, 24)
], 'Section header for member grids with search and add.'));

/* ============================================================================
 * 3. CREDITS MANAGEMENT (12)
 * ========================================================================== */
const METERS = [['Starter plan', 35], ['Team plan', 68], ['Enterprise plan', 92]];
for (const [label, pct] of METERS) {
  ITEMS.push(mk('credits', `Credit Meter ${label}`, 'div', 300, 52, [
    T(0, 14, label, { size: 12, weight: 600, fill: TXT, name: 'label' }),
    ...meter(0, 30, 300, pct, `${pct}% used`)
  ], `Credit usage meter for ${label}.`, { pct }));
}

ITEMS.push(mk('credits', 'Credit Balance Card', 'div', 300, 140, [
  R(0, 0, 300, 140, { fill: ACC, rx: 18, name: 'card' }),
  T(20, 34, 'Available credits', { size: 12, weight: 600, fill: '{{onAccent}}', name: 'label' }),
  T(20, 80, '24,650', { size: 34, weight: 800, fill: '{{onAccent}}', name: 'value' }),
  R(20, 98, 120, 28, { fill: '#FFFFFF', rx: 8, name: 'topup' }), T(80, 116, 'Top up', { size: 12, weight: 700, anchor: 'middle', fill: ACC, name: 'topup-label' })
], 'Headline balance card with top-up action.'));

const PACKS = [['Starter', '1,000', '$10'], ['Pro', '10,000', '$80'], ['Team', '50,000', '$320']];
for (const [name, cr, price] of PACKS) {
  ITEMS.push(mk('credits', `Top-Up Pack ${name}`, 'div', 220, 220, [
    R(0, 0, 220, 220, { role: 'card', rx: 16, name: 'card' }),
    T(20, 34, name, { size: 14, weight: 700, fill: TXT, name: 'name' }),
    T(20, 84, cr, { size: 24, weight: 800, fill: TXT, name: 'credits' }),
    T(20, 104, 'credits', { size: 12, fill: MUTED, name: 'unit' }),
    T(20, 140, price, { size: 18, weight: 700, fill: ACC, name: 'price' }),
    R(20, 166, 180, 34, { fill: ACC, rx: 10, name: 'buy' }), T(110, 188, 'Buy pack', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'buy-label' })
  ], `Credit top-up pack: ${name}.`));
}

const TXNS = [['Grant · Team bonus', '+500', GOOD], ['Spend · Report export', '-120', BAD], ['Refund · Failed job', '+15', GOOD]];
for (const [label, amt, col] of TXNS) {
  ITEMS.push(mk('credits', `Transaction ${label.split(' · ')[0]} ${amt}`, 'li', 560, 44, [
    R(0, 0, 560, 44, { role: 'card', rx: 10, name: 'row' }),
    T(16, 27, label.split(' · ')[1], { size: 13, weight: 500, fill: TXT, name: 'desc' }),
    T(200, 27, label.split(' · ')[0], { size: 11, fill: MUTED, name: 'type' }),
    T(544, 27, amt, { size: 14, weight: 700, anchor: 'end', fill: col, name: 'amount' })
  ], `Credit ledger entry: ${label}.`));
}

ITEMS.push(mk('credits', 'Low Balance Banner', 'div', 560, 56, [
  R(0, 0, 560, 56, { fill: WARN_BG, rx: 12, name: 'banner' }),
  ...icon('bell', 24, 28),
  T(44, 24, 'Running low on credits', { size: 13, weight: 700, fill: WARN, name: 'title' }),
  T(44, 42, '8% left. Top up to avoid pausing report exports.', { size: 11, fill: TXT, name: 'body' }),
  R(440, 14, 104, 28, { fill: WARN, rx: 8, name: 'cta' }), T(492, 32, 'Top up', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'cta-label' })
], 'Warning banner shown when credit balance is low.'));

ITEMS.push(mk('credits', 'Credit Usage Bars', 'figure', 420, 200, [
  R(0, 0, 420, 200, { role: 'card', rx: 14, name: 'card' }),
  ...bars(20, 30, 380, 130, [42, 58, 35, 77, 64, 90, 51], ACC),
  L(20, 166, 400, 166, { stroke: '{{line}}', name: 'axis' }),
  T(20, 186, 'Credits used per day · last 7 days', { size: 11, fill: MUTED, name: 'caption' })
], 'Bar chart of daily credit consumption.'));

/* ============================================================================
 * 4. API KEY MANAGEMENT (12)
 * ========================================================================== */
const KEYS = [['Production ingest', 'live'], ['Staging sync', 'test'], ['Old mobile client', 'revoked']];
for (const [name, st] of KEYS) {
  ITEMS.push(mk('apikeys', `API Key Row ${name}`, 'div', 720, 56, [
    R(0, 0, 720, 56, { role: 'card', rx: 10, name: 'row' }),
    ...icon('key', 24, 28),
    T(44, 24, name, { size: 13, weight: 600, fill: TXT, name: 'name' }),
    T(44, 42, 'sk_••••••••••••4f2a', { size: 11, fill: MUTED, name: 'masked' }),
    ...statusPill(360, 17, st),
    T(520, 32, 'Last used 4m ago', { size: 11, fill: MUTED, name: 'used' }),
    ...icon('trash', 690, 28)
  ], `API key row: ${name} (${st}).`));
}

ITEMS.push(mk('apikeys', 'Key Reveal Card', 'div', 480, 130, [
  R(0, 0, 480, 130, { role: 'card', rx: 16, name: 'card' }),
  T(20, 30, 'Copy your new secret key', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  R(20, 44, 380, 36, { role: 'field', rx: 8, name: 'secret' }), T(34, 67, 'sk_live_8c2f…91de', { size: 12, fill: TXT, name: 'secret-text' }),
  R(410, 44, 50, 36, { role: 'button', rx: 8, name: 'copy' }), ...icon('download', 435, 62),
  T(20, 104, 'It will not be shown again after you close this.', { size: 11, fill: WARN, name: 'warning' })
], 'One-time reveal of a newly created API key.'));

const SCOPES = ['read:users', 'write:credits', 'read:reports', 'admin:keys'];
ITEMS.push(mk('apikeys', 'Scope Checklist', 'fieldset', 320, 200, [
  R(0, 0, 320, 200, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Scopes', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...SCOPES.flatMap((s, i) => [
    R(20, 46 + i * 36, 16, 16, { rx: 4, stroke: ACC, sw: 1.5, name: `box-${i}` }),
    ...(i < 3 ? icon('check', 28, 54 + i * 36) : []),
    T(48, 58 + i * 36, s, { size: 12, fill: TXT, name: `scope-${i}` })
  ])
], 'Checklist of API key scopes.'));

ITEMS.push(mk('apikeys', 'Create API Key Modal', 'dialog', 420, 300, [
  R(0, 0, 420, 300, { role: 'card', rx: 18, name: 'card' }),
  T(24, 36, 'Create API key', { size: 16, weight: 700, fill: TXT, name: 'title' }),
  T(24, 66, 'Name', { size: 11, weight: 600, fill: MUTED, name: 'l-name' }),
  R(24, 74, 372, 36, { role: 'field', rx: 10, name: 'name' }), T(38, 97, 'CI pipeline', { size: 12, fill: TXT, name: 'name-text' }),
  T(24, 130, 'Environment', { size: 11, weight: 600, fill: MUTED, name: 'l-env' }),
  R(24, 138, 176, 34, { fill: ACC, rx: 10, name: 'live' }), T(112, 159, 'Live', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'live-t' }),
  R(220, 138, 176, 34, { role: 'field', rx: 10, name: 'test' }), T(308, 159, 'Test', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'test-t' }),
  R(24, 240, 90, 34, { role: 'button', rx: 10, name: 'cancel' }), T(69, 261, 'Cancel', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'cancel-t' }),
  R(306, 240, 90, 34, { fill: ACC, rx: 10, name: 'create' }), T(351, 261, 'Create', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'create-t' })
], 'Modal to create a named API key for an environment.'));

ITEMS.push(mk('apikeys', 'Rate Limit Meter', 'div', 360, 90, [
  R(0, 0, 360, 90, { role: 'card', rx: 14, name: 'card' }),
  T(18, 28, 'Requests / minute', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  ...meter(18, 50, 324, 62, '620 / 1000')
], 'Rate limit usage for a key.'));

ITEMS.push(mk('apikeys', 'Secret Copy Field', 'div', 420, 48, [
  R(0, 0, 420, 48, { role: 'field', rx: 10, name: 'field' }),
  T(14, 29, 'sk_live_•••••••••••••••••', { size: 13, fill: TXT, name: 'masked' }),
  ...icon('eye', 360, 24), ...icon('download', 392, 24)
], 'Masked secret field with reveal and copy.'));

ITEMS.push(mk('apikeys', 'Regenerate Key Confirm', 'dialog', 380, 180, [
  R(0, 0, 380, 180, { role: 'card', rx: 16, name: 'card' }),
  T(20, 34, 'Regenerate this key?', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  T(20, 60, 'The current secret stops working immediately.', { size: 12, fill: MUTED, name: 'body' }),
  R(180, 130, 90, 32, { role: 'button', rx: 8, name: 'cancel' }), T(225, 150, 'Cancel', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'cancel-t' }),
  R(278, 130, 84, 32, { fill: BAD, rx: 8, name: 'confirm' }), T(320, 150, 'Rotate', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'confirm-t' })
], 'Confirm before rotating an API key secret.'));

ITEMS.push(mk('apikeys', 'API Usage Sparkline', 'figure', 360, 120, [
  R(0, 0, 360, 120, { role: 'card', rx: 14, name: 'card' }),
  T(18, 28, 'Calls · 7 days', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  ...line(18, 46, 324, 56, [12, 18, 15, 30, 26, 41, 38], ACC)
], 'Sparkline of API calls over a week.'));

ITEMS.push(mk('apikeys', 'Environment Segmented Toggle', 'div', 220, 36, [
  R(0, 0, 220, 36, { role: 'field', rx: 10, name: 'track' }),
  R(4, 4, 106, 28, { fill: ACC, rx: 8, name: 'thumb' }), T(57, 22, 'Live', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'live' }),
  T(163, 22, 'Test', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'test' })
], 'Live / test environment segmented control.'));

ITEMS.push(mk('apikeys', 'Webhook Endpoint Row', 'div', 720, 52, [
  R(0, 0, 720, 52, { role: 'card', rx: 10, name: 'row' }),
  ...icon('share', 24, 26),
  T(44, 22, 'https://hooks.acme.dev/credits', { size: 12, weight: 600, fill: TXT, name: 'url' }),
  T(44, 38, 'Events: credit.low, key.revoked', { size: 11, fill: MUTED, name: 'events' }),
  ...statusPill(560, 15, 'active')
], 'Webhook endpoint row with subscribed events.'));

/* ============================================================================
 * 5. DETAILED REPORTS (12)
 * ========================================================================== */
ITEMS.push(mk('reports', 'Bar Chart Report', 'figure', 420, 240, [
  R(0, 0, 420, 240, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Signups by month', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...bars(20, 50, 380, 150, [120, 180, 150, 220, 260, 240], ACC),
  L(20, 200, 400, 200, { stroke: '{{line}}', name: 'axis' }),
  T(20, 224, 'Jan → Jun 2026', { size: 11, fill: MUTED, name: 'caption' })
], 'Bar chart report for monthly signups.'));

ITEMS.push(mk('reports', 'Line Trend Report', 'figure', 420, 220, [
  R(0, 0, 420, 220, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Revenue trend', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...line(20, 60, 380, 120, [20, 26, 22, 34, 31, 42, 48], ACC),
  T(20, 200, '30 days · +21% vs previous', { size: 11, fill: MUTED, name: 'caption' })
], 'Line chart report for a time series.'));

ITEMS.push(mk('reports', 'Donut Breakdown Report', 'figure', 300, 220, [
  R(0, 0, 300, 220, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Plan mix', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...ring(110, 125, 62, 0.56, ACC), ...ring(110, 125, 62, 0.28, '#7C3AED'),
  T(110, 130, '62%', { size: 18, weight: 800, anchor: 'middle', fill: TXT, name: 'center' }),
  C(236, 80, 5, { fill: ACC, name: 'k1' }), T(248, 84, 'Pro 56%', { size: 11, fill: TXT, name: 'l1' }),
  C(236, 104, 5, { fill: '#7C3AED', name: 'k2' }), T(248, 108, 'Team 28%', { size: 11, fill: TXT, name: 'l2' })
], 'Donut chart report of plan distribution.'));

ITEMS.push(mk('reports', 'Data Table Report', 'table', 720, 200, [
  R(0, 0, 720, 200, { role: 'card', rx: 14, name: 'card' }),
  ...['Report', 'Owner', 'Rows', 'Status'].map((h, i) => T([20, 260, 400, 560][i], 34, h, { size: 11, weight: 700, fill: MUTED, name: `h-${i}` })),
  L(16, 46, 704, 46, { stroke: '{{line}}', name: 'head-rule' }),
  ...[['Q2 revenue', 'Jane', '12,408', 'paid'], ['Churn cohorts', 'Sam', '3,911', 'pending'], ['Failed jobs', 'Lee', '88', 'failed']].flatMap((r, ri) => [
    T(20, 76 + ri * 40, r[0], { size: 13, fill: TXT, name: `c0-${ri}` }),
    T(260, 76 + ri * 40, r[1], { size: 13, fill: TXT, name: `c1-${ri}` }),
    T(400, 76 + ri * 40, r[2], { size: 13, fill: TXT, name: `c2-${ri}` }),
    ...statusPill(560, 60 + ri * 40, r[3])
  ])
], 'Detailed data table report with status column.'));

ITEMS.push(mk('reports', 'Report Filter Panel', 'form', 280, 260, [
  R(0, 0, 280, 260, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Filters', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...['Team', 'Plan', 'Region', 'Metric'].flatMap((f, i) => [
    T(20, 60 + i * 50, f, { size: 11, weight: 600, fill: MUTED, name: `l-${i}` }),
    R(20, 66 + i * 50, 240, 30, { role: 'field', rx: 8, name: `f-${i}` }),
    T(32, 86 + i * 50, 'All', { size: 12, fill: TXT, name: `v-${i}` })
  ])
], 'Filter side panel for report builders.'));

ITEMS.push(mk('reports', 'Date Range Picker', 'div', 320, 260, [
  R(0, 0, 320, 260, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'May 2026', { size: 14, weight: 700, fill: TXT, name: 'month' }),
  ...Array.from({ length: 14 }, (_, i) => T(20 + (i % 7) * 42, 70 + Math.floor(i / 7) * 34, String(i + 1), { size: 12, fill: TXT, name: `d-${i}` })),
  R(20 + 2 * 42 - 14, 70 + 2 * 34 - 16, 28, 24, { fill: ACC, rx: 12, name: 'start' }),
  R(20 + 6 * 42 - 14, 70 + 3 * 34 - 16, 28, 24, { fill: ACC, rx: 12, name: 'end' }),
  T(20, 236, 'Apply range', { size: 12, weight: 700, fill: ACC, name: 'apply' })
], 'Date range picker with highlighted start and end.'));

ITEMS.push(mk('reports', 'Summary Metric Tiles', 'div', 720, 96, [
  ...[['Revenue', '$48.2k'], ['Orders', '1,204'], ['Refunds', '$412'], ['NPS', '61']].flatMap(([l, v], i) => [
    R(i * 180, 0, 170, 96, { role: 'card', rx: 14, name: `tile-${i}` }),
    T(i * 180 + 16, 32, l, { size: 11, weight: 600, fill: MUTED, name: `tl-${i}` }),
    T(i * 180 + 16, 70, v, { size: 22, weight: 800, fill: TXT, name: `tv-${i}` })
  ])
], 'Row of four summary metrics above a report.'));

ITEMS.push(mk('reports', 'Export Report Menu', 'menu', 200, 150, [
  R(0, 0, 200, 150, { role: 'card', rx: 12, name: 'menu' }),
  ...['PDF', 'CSV', 'XLSX', 'Schedule email'].flatMap((f, i) => [
    T(18, 34 + i * 32, f, { size: 13, fill: TXT, name: `opt-${i}` })
  ])
], 'Export format dropdown menu.'));

ITEMS.push(mk('reports', 'Scheduled Report Row', 'div', 720, 52, [
  R(0, 0, 720, 52, { role: 'card', rx: 10, name: 'row' }),
  ...icon('calendar', 24, 26),
  T(44, 22, 'Weekly credit burn', { size: 13, weight: 600, fill: TXT, name: 'name' }),
  T(44, 38, 'Mondays 08:00 · to finance@acme.dev', { size: 11, fill: MUTED, name: 'sched' }),
  ...statusPill(560, 15, 'active')
], 'Scheduled report with recipients and state.'));

const HEAT = Array.from({ length: 6 }, (_, r) => Array.from({ length: 7 }, (_, c) => ((r * 7 + c * 3) % 10) / 10));
ITEMS.push(mk('reports', 'Activity Heatmap', 'figure', 420, 180, [
  R(0, 0, 420, 180, { role: 'card', rx: 14, name: 'card' }),
  ...HEAT.flatMap((row, r) => row.map((v, c) => R(20 + c * 52, 40 + r * 22, 44, 16, { fill: ACC, op: 0.12 + v * 0.88, rx: 4, name: `cell-${r}-${c}` })))
], 'Heatmap of activity by week and day.'));

ITEMS.push(mk('reports', 'Conversion Funnel', 'figure', 420, 220, [
  R(0, 0, 420, 220, { role: 'card', rx: 14, name: 'card' }),
  ...[['Visited', 1, 380], ['Signed up', 0.6, 228], ['Activated', 0.34, 130], ['Paid', 0.12, 46]].flatMap(([l, _, w], i) => [
    R(210 - w / 2, 40 + i * 42, w, 32, { fill: ACC, op: 1 - i * 0.2, rx: 8, name: `step-${i}` }),
    T(210, 61 + i * 42, `${l}`, { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: `step-t-${i}` })
  ])
], 'Funnel report from visit to paid conversion.'));

ITEMS.push(mk('reports', 'Leaderboard List', 'ol', 320, 240, [
  R(0, 0, 320, 240, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Top teams this month', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...['Platform', 'Growth', 'Design', 'Data'].flatMap((n, i) => [
    T(20, 64 + i * 42, `${i + 1}`, { size: 13, weight: 800, fill: ACC, name: `rank-${i}` }),
    T(44, 64 + i * 42, n, { size: 13, weight: 600, fill: TXT, name: `team-${i}` }),
    T(300, 64 + i * 42, `${(120 - i * 18)}k`, { size: 13, weight: 700, anchor: 'end', fill: TXT, name: `score-${i}` })
  ])
], 'Ranked list of teams by usage.'));

/* ============================================================================
 * 6. SAMPLE CARDS (10)
 * ========================================================================== */
ITEMS.push(mk('cards', 'Product Card', 'article', 280, 320, [
  R(0, 0, 280, 320, { role: 'card', rx: 18, name: 'card' }),
  R(12, 12, 256, 160, { fill: '#E0E7FF', rx: 12, name: 'image' }),
  T(20, 200, 'Designer Pro Kit', { size: 16, weight: 700, fill: TXT, name: 'title' }),
  T(20, 222, 'Components, flows and tokens', { size: 12, fill: MUTED, name: 'desc' }),
  T(20, 262, '$49', { size: 20, weight: 800, fill: TXT, name: 'price' }),
  R(160, 244, 104, 36, { fill: ACC, rx: 10, name: 'buy' }), T(212, 267, 'Add to cart', { size: 11, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'buy-t' })
], 'Product card with image, price and add-to-cart.'));

ITEMS.push(mk('cards', 'Article Card', 'article', 320, 260, [
  R(0, 0, 320, 260, { role: 'card', rx: 16, name: 'card' }),
  R(0, 0, 320, 120, { fill: '#FCE7F3', rx: 16, name: 'cover' }),
  ...pill(16, 136, 'GUIDE', INFO, INFO_BG),
  T(16, 186, 'Designing admin tables that scale', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  T(16, 212, '6 min read · May 2026', { size: 11, fill: MUTED, name: 'meta' })
], 'Editorial article preview card.'));

ITEMS.push(mk('cards', 'Profile Card', 'article', 280, 240, [
  R(0, 0, 280, 240, { role: 'card', rx: 18, name: 'card' }),
  ...av(140, 60, 30, 'AR', '#7C3AED'),
  T(140, 112, 'Ana Ruiz', { size: 16, weight: 700, anchor: 'middle', fill: TXT, name: 'name' }),
  T(140, 132, 'Product designer', { size: 12, anchor: 'middle', fill: MUTED, name: 'role' }),
  R(40, 156, 96, 34, { role: 'button', rx: 10, name: 'follow' }), T(88, 178, 'Message', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'follow-t' }),
  R(144, 156, 96, 34, { fill: ACC, rx: 10, name: 'connect' }), T(192, 178, 'Connect', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'connect-t' })
], 'Person profile card with two actions.'));

ITEMS.push(mk('cards', 'Media Card', 'article', 320, 220, [
  R(0, 0, 320, 220, { role: 'card', rx: 16, name: 'card' }),
  R(0, 0, 320, 130, { fill: '#DBEAFE', rx: 16, name: 'media' }),
  P('M20 110l60-50 40 30 50-40 130 60z', { fill: '#93C5FD', stroke: 'none', name: 'landscape' }),
  T(16, 160, 'Onboarding walkthrough', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...icon('file', 290, 160),
  T(16, 186, 'Video · 4:12', { size: 11, fill: MUTED, name: 'meta' })
], 'Media card with thumbnail and duration.'));

ITEMS.push(mk('cards', 'Feature Card', 'div', 300, 180, [
  R(0, 0, 300, 180, { role: 'card', rx: 16, name: 'card' }),
  R(20, 20, 40, 40, { fill: ACC, rx: 12, name: 'icon-bg' }), ...icon('shield', 40, 40),
  T(20, 88, 'Granular permissions', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  T(20, 112, 'Grant access per workspace, team or app.', { size: 12, fill: MUTED, name: 'desc' }),
  T(20, 150, 'Learn more →', { size: 12, weight: 600, fill: ACC, name: 'link' })
], 'Feature highlight card with icon and link.'));

ITEMS.push(mk('cards', 'Stat Card', 'div', 240, 120, [
  R(0, 0, 240, 120, { role: 'card', rx: 16, name: 'card' }),
  T(18, 30, 'Open tickets', { size: 12, weight: 600, fill: MUTED, name: 'label' }),
  T(18, 68, '37', { size: 28, weight: 800, fill: TXT, name: 'value' }),
  ...pill(18, 84, '-4 this week', GOOD, GOOD_BG)
], 'Compact stat card with trend pill.'));

ITEMS.push(mk('cards', 'Testimonial Card', 'blockquote', 340, 160, [
  R(0, 0, 340, 160, { role: 'card', rx: 16, name: 'card' }),
  ...icon('star', 26, 26), ...icon('star', 46, 26), ...icon('star', 66, 26),
  T(20, 60, '“Setup took minutes, and our admins love it.”', { size: 13, fill: TXT, name: 'quote' }),
  ...av(36, 124, 14, 'MK', '#0891B2'),
  T(60, 120, 'Mina K.', { size: 12, weight: 700, fill: TXT, name: 'author' }),
  T(60, 136, 'Head of Ops, Northwind', { size: 11, fill: MUTED, name: 'role' })
], 'Customer quote card with rating.'));

ITEMS.push(mk('cards', 'Notification Card', 'div', 360, 84, [
  R(0, 0, 360, 84, { role: 'card', rx: 14, name: 'card' }),
  C(28, 42, 10, { fill: INFO_BG, name: 'dot-bg' }), C(28, 42, 4, { fill: INFO, name: 'dot' }),
  T(50, 32, 'New sign-in from Chrome', { size: 13, weight: 700, fill: TXT, name: 'title' }),
  T(50, 52, 'Berlin, DE · 2 minutes ago', { size: 11, fill: MUTED, name: 'body' }),
  ...icon('bell', 330, 22)
], 'Notification card with unread dot.'));

ITEMS.push(mk('cards', 'Event Card', 'article', 300, 160, [
  R(0, 0, 300, 160, { role: 'card', rx: 16, name: 'card' }),
  R(16, 16, 56, 56, { fill: ACC, rx: 12, name: 'date-bg' }),
  T(44, 40, 'JUN', { size: 10, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'month' }),
  T(44, 60, '12', { size: 18, weight: 800, anchor: 'middle', fill: '{{onAccent}}', name: 'day' }),
  T(88, 36, 'Admin roundtable', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  ...icon('clock', 96, 58), T(108, 62, '16:00 – 17:00 UTC', { size: 11, fill: MUTED, name: 'time' }),
  R(16, 108, 268, 36, { role: 'button', rx: 10, name: 'rsvp' }), T(150, 130, 'RSVP', { size: 12, weight: 700, anchor: 'middle', fill: TXT, name: 'rsvp-t' })
], 'Event card with date block and RSVP.'));

ITEMS.push(mk('cards', 'Invoice Card', 'article', 360, 200, [
  R(0, 0, 360, 200, { role: 'card', rx: 16, name: 'card' }),
  T(20, 30, 'Invoice #1042', { size: 14, weight: 700, fill: TXT, name: 'id' }),
  ...statusPill(260, 14, 'paid'),
  T(20, 62, 'Pro plan · May 2026', { size: 12, fill: MUTED, name: 'desc' }),
  L(20, 80, 340, 80, { stroke: '{{line}}', name: 'rule' }),
  T(20, 108, 'Subtotal', { size: 12, fill: MUTED, name: 'sub-l' }), T(340, 108, '$80.00', { size: 12, anchor: 'end', fill: TXT, name: 'sub-v' }),
  T(20, 130, 'Tax', { size: 12, fill: MUTED, name: 'tax-l' }), T(340, 130, '$0.00', { size: 12, anchor: 'end', fill: TXT, name: 'tax-v' }),
  T(20, 160, 'Total', { size: 14, weight: 700, fill: TXT, name: 'tot-l' }), T(340, 160, '$80.00', { size: 14, weight: 800, anchor: 'end', fill: TXT, name: 'tot-v' }),
  ...icon('download', 332, 30)
], 'Invoice summary card with status and total.'));

/* ============================================================================
 * 7. AUTHENTICATION / REGISTER / LOGIN (10)
 * ========================================================================== */
ITEMS.push(mk('auth', 'Login Form', 'form', 360, 420, [
  R(0, 0, 360, 420, { role: 'card', rx: 20, name: 'card' }),
  ...av(180, 50, 22, 'K', ACC),
  T(180, 104, 'Welcome back', { size: 20, weight: 800, anchor: 'middle', fill: TXT, name: 'title' }),
  T(180, 124, 'Sign in to continue', { size: 12, anchor: 'middle', fill: MUTED, name: 'sub' }),
  T(28, 160, 'Email', { size: 11, weight: 600, fill: MUTED, name: 'l-email' }), R(28, 168, 304, 40, { role: 'field', rx: 10, name: 'email' }),
  T(28, 230, 'Password', { size: 11, weight: 600, fill: MUTED, name: 'l-pass' }), R(28, 238, 304, 40, { role: 'field', rx: 10, name: 'pass' }),
  T(322, 262, 'Forgot?', { size: 11, weight: 600, anchor: 'end', fill: ACC, name: 'forgot' }),
  R(28, 296, 304, 42, { fill: ACC, rx: 12, name: 'submit' }), T(180, 322, 'Sign in', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'submit-t' }),
  T(180, 372, 'New here? Create an account', { size: 12, anchor: 'middle', fill: MUTED, name: 'register-link' })
], 'Email and password sign-in form.'));

ITEMS.push(mk('auth', 'Register Form', 'form', 360, 520, [
  R(0, 0, 360, 520, { role: 'card', rx: 20, name: 'card' }),
  T(28, 46, 'Create your account', { size: 20, weight: 800, fill: TXT, name: 'title' }),
  ...['Full name', 'Work email', 'Password', 'Company'].flatMap((f, i) => [
    T(28, 84 + i * 76, f, { size: 11, weight: 600, fill: MUTED, name: `l-${i}` }),
    R(28, 92 + i * 76, 304, 40, { role: 'field', rx: 10, name: `f-${i}` })
  ]),
  T(28, 392, 'By signing up you agree to the Terms.', { size: 11, fill: MUTED, name: 'terms' }),
  R(28, 412, 304, 42, { fill: ACC, rx: 12, name: 'submit' }), T(180, 438, 'Create account', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'submit-t' }),
  T(180, 484, 'Already registered? Sign in', { size: 12, anchor: 'middle', fill: MUTED, name: 'login-link' })
], 'Sign-up form with name, email, password and company.'));

ITEMS.push(mk('auth', 'Forgot Password Card', 'form', 360, 260, [
  R(0, 0, 360, 260, { role: 'card', rx: 20, name: 'card' }),
  ...icon('mail', 180, 40),
  T(180, 80, 'Reset your password', { size: 17, weight: 800, anchor: 'middle', fill: TXT, name: 'title' }),
  T(180, 102, "We'll email a secure reset link.", { size: 12, anchor: 'middle', fill: MUTED, name: 'body' }),
  R(28, 124, 304, 40, { role: 'field', rx: 10, name: 'email' }), T(42, 148, 'you@company.com', { size: 12, fill: MUTED, name: 'email-t' }),
  R(28, 184, 304, 42, { fill: ACC, rx: 12, name: 'send' }), T(180, 210, 'Send reset link', { size: 14, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'send-t' })
], 'Forgot password request card.'));

ITEMS.push(mk('auth', 'OTP Code Entry', 'form', 360, 200, [
  R(0, 0, 360, 200, { role: 'card', rx: 20, name: 'card' }),
  T(180, 40, 'Enter the 6-digit code', { size: 15, weight: 700, anchor: 'middle', fill: TXT, name: 'title' }),
  T(180, 60, 'Sent to j•••@acme.dev', { size: 11, anchor: 'middle', fill: MUTED, name: 'hint' }),
  ...Array.from({ length: 6 }, (_, i) => [
    R(28 + i * 50, 80, 42, 50, { role: 'field', rx: 10, name: `digit-${i}` }),
    T(49 + i * 50, 113, i < 3 ? String(i + 4) : '', { size: 20, weight: 700, anchor: 'middle', fill: TXT, name: `digit-t-${i}` })
  ]).flat(),
  T(180, 166, 'Resend in 0:42', { size: 11, anchor: 'middle', fill: MUTED, name: 'resend' })
], 'Six-digit one-time code entry.'));

ITEMS.push(mk('auth', 'Social Login Buttons', 'div', 360, 180, [
  R(0, 0, 360, 180, { role: 'card', rx: 20, name: 'card' }),
  ...['Continue with Google', 'Continue with GitHub', 'Continue with Microsoft'].flatMap((l, i) => [
    R(28, 20 + i * 52, 304, 40, { role: 'button', rx: 10, name: `soc-${i}` }),
    T(180, 45 + i * 52, l, { size: 13, weight: 600, anchor: 'middle', fill: TXT, name: `soc-t-${i}` })
  ])
], 'Stacked OAuth sign-in provider buttons.'));

ITEMS.push(mk('auth', 'Password Strength Meter', 'div', 320, 60, [
  T(0, 14, 'Password strength', { size: 11, weight: 600, fill: MUTED, name: 'label' }),
  ...[0, 1, 2, 3].flatMap(i => [R(i * 82, 24, 74, 8, { fill: i < 3 ? WARN : '{{line}}', rx: 4, name: `seg-${i}` })]),
  T(320, 14, 'Good', { size: 11, weight: 700, anchor: 'end', fill: WARN, name: 'verdict' })
], 'Four-segment password strength indicator.'));

ITEMS.push(mk('auth', 'Two-Factor Setup Card', 'form', 360, 380, [
  R(0, 0, 360, 380, { role: 'card', rx: 20, name: 'card' }),
  T(180, 36, 'Set up two-factor auth', { size: 16, weight: 800, anchor: 'middle', fill: TXT, name: 'title' }),
  R(110, 56, 140, 140, { fill: '#FFFFFF', stroke: '{{line}}', sw: 1, rx: 8, name: 'qr-frame' }),
  ...Array.from({ length: 49 }, (_, i) => (i * 7 + (i % 5)) % 3 === 0 ? R(122 + (i % 7) * 17, 68 + Math.floor(i / 7) * 17, 12, 12, { fill: '#111827', name: `qr-${i}` }) : null).filter(Boolean),
  T(180, 220, 'Scan with your authenticator app', { size: 11, anchor: 'middle', fill: MUTED, name: 'hint' }),
  R(28, 236, 304, 40, { role: 'field', rx: 10, name: 'code' }), T(180, 260, 'Enter 6-digit code', { size: 12, anchor: 'middle', fill: MUTED, name: 'code-t' }),
  R(28, 300, 304, 42, { fill: ACC, rx: 12, name: 'verify' }), T(180, 326, 'Verify and enable', { size: 13, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'verify-t' })
], 'Two-factor authentication enrolment with QR code.'));

ITEMS.push(mk('auth', 'Magic Link Sent Card', 'div', 360, 220, [
  R(0, 0, 360, 220, { role: 'card', rx: 20, name: 'card' }),
  C(180, 48, 22, { fill: GOOD_BG, name: 'badge-bg' }), ...icon('check', 180, 48),
  T(180, 96, 'Check your inbox', { size: 16, weight: 800, anchor: 'middle', fill: TXT, name: 'title' }),
  T(180, 118, 'We sent a sign-in link to jane@acme.dev', { size: 12, anchor: 'middle', fill: MUTED, name: 'body' }),
  R(120, 150, 120, 34, { role: 'button', rx: 10, name: 'open' }), T(180, 172, 'Open mail app', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'open-t' })
], 'Confirmation after requesting a magic sign-in link.'));

ITEMS.push(mk('auth', 'SSO Provider Row', 'div', 360, 56, [
  R(0, 0, 360, 56, { role: 'card', rx: 12, name: 'row' }),
  ...icon('lock', 26, 28),
  T(48, 24, 'Single sign-on', { size: 13, weight: 600, fill: TXT, name: 'name' }),
  T(48, 40, 'Okta · enforced for acme.dev', { size: 11, fill: MUTED, name: 'desc' }),
  ...statusPill(262, 17, 'active')
], 'SSO provider status row.'));

ITEMS.push(mk('auth', 'Email Verification Banner', 'div', 560, 56, [
  R(0, 0, 560, 56, { fill: INFO_BG, rx: 12, name: 'banner' }),
  ...icon('mail', 24, 28),
  T(44, 24, 'Verify your email address', { size: 13, weight: 700, fill: INFO, name: 'title' }),
  T(44, 42, 'Access to billing unlocks after verification.', { size: 11, fill: TXT, name: 'body' }),
  R(440, 14, 104, 28, { fill: INFO, rx: 8, name: 'cta' }), T(492, 32, 'Resend', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'cta-t' })
], 'Banner prompting the user to verify their email.'));

/* ============================================================================
 * 8. APP PERMISSIONS & CONFIGURATION (8)
 * ========================================================================== */
const PERMS = [['Camera access', 'allow'], ['Location', 'deny'], ['Notifications', 'inherited']];
for (const [label, mode] of PERMS) {
  const st = mode === 'allow' ? ['allowed', GOOD, GOOD_BG] : mode === 'deny' ? ['denied', BAD, BAD_BG] : ['inherited', INFO, INFO_BG];
  ITEMS.push(mk('config', `Permission ${label} ${mode}`, 'div', 520, 56, [
    R(0, 0, 520, 56, { role: 'card', rx: 12, name: 'row' }),
    ...icon(mode === 'deny' ? 'lock' : 'shield', 24, 28),
    T(44, 26, label, { size: 13, weight: 600, fill: TXT, name: 'label' }),
    T(44, 42, 'Applies to all workspace apps', { size: 11, fill: MUTED, name: 'desc' }),
    ...pill(380, 17, st[0].toUpperCase(), st[1], st[2])
  ], `Permission row: ${label} (${mode}).`));
}

ITEMS.push(mk('config', 'Configuration Section', 'form', 520, 220, [
  R(0, 0, 520, 220, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'Session settings', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  T(20, 48, 'Control how long users stay signed in.', { size: 11, fill: MUTED, name: 'desc' }),
  T(20, 84, 'Session timeout', { size: 12, fill: TXT, name: 'l1' }), R(360, 70, 140, 30, { role: 'field', rx: 8, name: 'f1' }), T(374, 90, '8 hours', { size: 12, fill: TXT, name: 'v1' }),
  T(20, 130, 'Require 2FA for admins', { size: 12, fill: TXT, name: 'l2' }), R(440, 118, 52, 28, { fill: ACC, rx: 14, name: 'sw' }), C(478, 132, 10, { fill: '#FFFFFF', name: 'sw-knob' }),
  T(20, 176, 'Allowed email domains', { size: 12, fill: TXT, name: 'l3' }), R(260, 162, 240, 30, { role: 'field', rx: 8, name: 'f3' }), T(274, 182, 'acme.dev, acme.io', { size: 12, fill: MUTED, name: 'v3' })
], 'Settings group card with timeout, toggle and domain field.'));

ITEMS.push(mk('config', 'Feature Flag Row', 'div', 520, 56, [
  R(0, 0, 520, 56, { role: 'card', rx: 12, name: 'row' }),
  T(20, 26, 'new-report-builder', { size: 13, weight: 600, fill: TXT, name: 'flag' }),
  T(20, 42, 'Rolled out to 40% of workspaces', { size: 11, fill: MUTED, name: 'desc' }),
  R(440, 16, 52, 24, { fill: ACC, rx: 12, name: 'sw' }), C(480, 28, 9, { fill: '#FFFFFF', name: 'knob' })
], 'Feature flag row with rollout percentage.'));

ITEMS.push(mk('config', 'Environment Switch', 'div', 300, 36, [
  R(0, 0, 300, 36, { role: 'field', rx: 10, name: 'track' }),
  R(4, 4, 92, 28, { fill: ACC, rx: 8, name: 'thumb' }),
  T(50, 22, 'Prod', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'prod' }),
  T(150, 22, 'Staging', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'staging' }),
  T(250, 22, 'Dev', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'dev' })
], 'Three-way environment switch.'));

ITEMS.push(mk('config', 'App Permission Matrix', 'table', 560, 200, [
  R(0, 0, 560, 200, { role: 'card', rx: 14, name: 'card' }),
  T(20, 30, 'App', { size: 12, weight: 700, fill: MUTED, name: 'h0' }),
  ...['Read', 'Export', 'Admin'].map((h, i) => T(300 + i * 80, 30, h, { size: 12, weight: 700, anchor: 'middle', fill: MUTED, name: `h${i + 1}` })),
  ...['Reports', 'Credits', 'Keys'].flatMap((app, ri) => [
    T(20, 70 + ri * 40, app, { size: 13, fill: TXT, name: `app-${ri}` }),
    ...[[1, 1, 0], [1, 0, 0], [1, 1, 1]][ri].flatMap((g, ci) => icon(g ? 'check' : 'cross', 300 + ci * 80, 66 + ri * 40))
  ])
], 'Per-app permission grid for workspace roles.'));

ITEMS.push(mk('config', 'Configuration Tabs', 'nav', 560, 44, [
  R(0, 0, 560, 44, { role: 'card', rx: 12, name: 'bar' }),
  ...['General', 'Security', 'Billing', 'Webhooks'].flatMap((t, i) => [
    ...(i === 1 ? [R(6, 6, 130, 32, { fill: ACC, rx: 8, name: 'active' })] : []),
    T(70 + i * 130, 27, t, { size: 13, weight: i === 1 ? 700 : 500, anchor: 'middle', fill: i === 1 ? '{{onAccent}}' : TXT, name: `tab-${i}` })
  ])
], 'Tab bar for configuration sections.'));

ITEMS.push(mk('config', 'Danger Zone Card', 'div', 520, 140, [
  R(0, 0, 520, 140, { role: 'card', rx: 14, name: 'card' }),
  R(0, 0, 4, 140, { fill: BAD, name: 'edge' }),
  T(24, 34, 'Danger zone', { size: 14, weight: 700, fill: BAD, name: 'title' }),
  T(24, 56, 'Delete this workspace and all its data. This cannot be undone.', { size: 12, fill: MUTED, name: 'desc' }),
  R(24, 84, 150, 34, { fill: BAD, rx: 10, name: 'delete' }), T(99, 106, 'Delete workspace', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'delete-t' })
], 'Destructive settings area with delete action.'));

/* ============================================================================
 * 9. SUBSCRIPTIONS (9)
 * ========================================================================== */
const PLANS = [
  ['Free', '$0', ['5 projects', 'Community support'], false],
  ['Pro', '$29', ['Unlimited projects', '10k credits / month', 'Priority support'], true],
  ['Enterprise', 'Custom', ['SSO & audit logs', 'Dedicated CSM', 'Custom credits'], false]
];
for (const [name, price, feats, hi] of PLANS) {
  ITEMS.push(mk('subscriptions', `Pricing Card ${name}`, 'div', 260, 380, [
    R(0, 0, 260, 380, { role: 'card', rx: 18, name: 'card', stroke: hi ? ACC : 'none', sw: 2 }),
    ...(hi ? pill(20, 18, 'MOST POPULAR', '{{onAccent}}', ACC) : []),
    T(20, hi ? 72 : 48, name, { size: 16, weight: 700, fill: TXT, name: 'name' }),
    T(20, hi ? 110 : 86, price, { size: 30, weight: 800, fill: TXT, name: 'price' }),
    ...feats.flatMap((f, i) => [
      ...icon('check', 30, (hi ? 150 : 126) + i * 28),
      T(46, (hi ? 154 : 130) + i * 28, f, { size: 12, fill: TXT, name: `feat-${i}` })
    ]),
    R(20, 320, 220, 40, { fill: hi ? ACC : '{{line}}', rx: 12, name: 'cta' }),
    T(130, 345, hi ? 'Upgrade to Pro' : name === 'Free' ? 'Current plan' : 'Contact sales', { size: 13, weight: 700, anchor: 'middle', fill: hi ? '{{onAccent}}' : TXT, name: 'cta-t' })
  ], `Pricing tier card: ${name}.`));
}

ITEMS.push(mk('subscriptions', 'Billing Cycle Toggle', 'div', 240, 36, [
  R(0, 0, 240, 36, { role: 'field', rx: 10, name: 'track' }),
  R(4, 4, 116, 28, { fill: ACC, rx: 8, name: 'thumb' }),
  T(62, 22, 'Monthly', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'm' }),
  T(180, 22, 'Yearly −20%', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'y' })
], 'Monthly / yearly billing toggle with discount.'));

ITEMS.push(mk('subscriptions', 'Current Plan Banner', 'div', 560, 72, [
  R(0, 0, 560, 72, { role: 'card', rx: 14, name: 'card' }),
  R(0, 0, 4, 72, { fill: ACC, name: 'edge' }),
  T(24, 30, 'You are on Pro', { size: 14, weight: 700, fill: TXT, name: 'title' }),
  T(24, 52, 'Renews 14 Dec 2026 · $29 / month', { size: 12, fill: MUTED, name: 'desc' }),
  R(420, 20, 120, 32, { role: 'button', rx: 10, name: 'manage' }), T(480, 41, 'Manage plan', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'manage-t' })
], 'Current subscription summary banner.'));

ITEMS.push(mk('subscriptions', 'Subscription Invoice Row', 'div', 560, 48, [
  R(0, 0, 560, 48, { role: 'card', rx: 10, name: 'row' }),
  T(16, 29, 'Nov 14, 2026', { size: 13, fill: TXT, name: 'date' }),
  T(180, 29, 'Pro · monthly', { size: 12, fill: MUTED, name: 'plan' }),
  ...statusPill(330, 13, 'paid'),
  T(544, 29, '$29.00', { size: 13, weight: 700, anchor: 'end', fill: TXT, name: 'amount' }),
  ...icon('download', 500, 24)
], 'Subscription invoice history row.'));

ITEMS.push(mk('subscriptions', 'Payment Method Card', 'div', 320, 140, [
  R(0, 0, 320, 140, { fill: '#1F2937', rx: 16, name: 'card' }),
  T(20, 40, '•••• •••• •••• 4242', { size: 15, weight: 600, fill: '#FFFFFF', name: 'number' }),
  T(20, 76, 'Expires 08/29', { size: 11, fill: '#9CA3AF', name: 'exp' }),
  T(20, 118, 'Jane Doe', { size: 11, fill: '#D1D5DB', name: 'holder' }),
  R(240, 100, 60, 26, { fill: '#374151', rx: 6, name: 'brand' }), T(270, 117, 'VISA', { size: 10, weight: 800, anchor: 'middle', fill: '#FFFFFF', name: 'brand-t' })
], 'Saved card visual with masked number.'));

ITEMS.push(mk('subscriptions', 'Usage Quota Bar', 'div', 360, 80, [
  T(0, 16, 'Seats used', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  ...meter(0, 36, 360, 60, '6 / 10 seats')
], 'Quota progress for seats included in a plan.'));

ITEMS.push(mk('subscriptions', 'Cancel Subscription Modal', 'dialog', 400, 240, [
  R(0, 0, 400, 240, { role: 'card', rx: 18, name: 'card' }),
  T(24, 36, 'Cancel Pro subscription?', { size: 16, weight: 700, fill: TXT, name: 'title' }),
  T(24, 62, 'You keep access until 14 Dec 2026. Credits roll over for 30 days.', { size: 12, fill: MUTED, name: 'body' }),
  R(24, 170, 170, 36, { role: 'button', rx: 10, name: 'keep' }), T(109, 193, 'Keep Pro', { size: 13, weight: 700, anchor: 'middle', fill: TXT, name: 'keep-t' }),
  R(206, 170, 170, 36, { fill: BAD, rx: 10, name: 'cancel' }), T(291, 193, 'Cancel plan', { size: 13, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'cancel-t' })
], 'Subscription cancellation with retention option.'));

/* ============================================================================
 * 10. ANIMATED POPUPS & FEEDBACK (7)
 * ========================================================================== */
ITEMS.push(mk('popups', 'Animated Dialog', 'dialog', 440, 240, [
  R(0, 0, 440, 240, { role: 'card', rx: 22, name: 'card' }),
  C(44, 44, 18, { fill: ACC, name: 'badge' }), ...icon('star', 44, 44),
  T(76, 40, 'You unlocked Pro features', { size: 16, weight: 800, fill: TXT, name: 'title' }),
  T(76, 62, 'Advanced reports and 10k monthly credits are ready.', { size: 12, fill: MUTED, name: 'body' }),
  R(260, 186, 80, 34, { role: 'button', rx: 10, name: 'later' }), T(300, 208, 'Later', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'later-t' }),
  R(348, 186, 72, 34, { fill: ACC, rx: 10, name: 'go' }), T(384, 208, 'Go', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'go-t' })
], 'Celebratory modal that springs in with scale and fade.', { motion: 'spring-scale-in' }));

ITEMS.push(mk('popups', 'Bottom Sheet', 'dialog', 360, 280, [
  R(0, 0, 360, 280, { role: 'card', rx: 24, name: 'sheet' }),
  R(160, 10, 40, 4, { fill: '{{line}}', rx: 2, name: 'grabber' }),
  T(24, 46, 'Share report', { size: 15, weight: 700, fill: TXT, name: 'title' }),
  ...['Copy link', 'Email to team', 'Download PDF'].flatMap((a, i) => [
    ...icon(['share', 'mail', 'download'][i], 36, 84 + i * 48),
    T(60, 88 + i * 48, a, { size: 13, fill: TXT, name: `act-${i}` })
  ])
], 'Bottom sheet with share actions and drag grabber.', { motion: 'spring-slide-up' }));

ITEMS.push(mk('popups', 'Toast Success', 'div', 360, 60, [
  R(0, 0, 360, 60, { role: 'card', rx: 14, name: 'toast' }), R(0, 0, 4, 60, { fill: GOOD, name: 'edge' }),
  ...icon('check', 26, 30), T(48, 26, 'Key created', { size: 13, weight: 700, fill: TXT, name: 'title' }),
  T(48, 44, 'Copy it now, it will not be shown again.', { size: 11, fill: MUTED, name: 'body' })
], 'Success toast with accent edge.', { motion: 'spring-fade' }));

ITEMS.push(mk('popups', 'Toast Warning', 'div', 360, 60, [
  R(0, 0, 360, 60, { role: 'card', rx: 14, name: 'toast' }), R(0, 0, 4, 60, { fill: WARN, name: 'edge' }),
  ...icon('bell', 26, 30), T(48, 26, 'Credits almost gone', { size: 13, weight: 700, fill: TXT, name: 'title' }),
  T(48, 44, '5% remaining this cycle.', { size: 11, fill: MUTED, name: 'body' })
], 'Warning toast for low resources.', { motion: 'spring-fade' }));

ITEMS.push(mk('popups', 'Toast Error', 'div', 360, 60, [
  R(0, 0, 360, 60, { role: 'card', rx: 14, name: 'toast' }), R(0, 0, 4, 60, { fill: BAD, name: 'edge' }),
  ...icon('cross', 26, 30), T(48, 26, 'Export failed', { size: 13, weight: 700, fill: TXT, name: 'title' }),
  R(268, 18, 76, 24, { role: 'button', rx: 8, name: 'retry' }), T(306, 34, 'Retry', { size: 11, weight: 700, anchor: 'middle', fill: TXT, name: 'retry-t' })
], 'Error toast with inline retry.', { motion: 'spring-fade' }));

ITEMS.push(mk('popups', 'Tooltip Bubble', 'div', 200, 44, [
  R(0, 0, 200, 44, { fill: '#111827', rx: 8, name: 'bubble' }),
  T(100, 27, 'Unused credits expire in 30 days', { size: 10, anchor: 'middle', fill: '#FFFFFF', name: 'text' })
], 'Dark tooltip bubble.', { motion: 'spring-fade' }));

ITEMS.push(mk('popups', 'Popover Menu', 'menu', 200, 180, [
  R(0, 0, 200, 180, { role: 'card', rx: 12, name: 'menu' }),
  ...['Profile', 'Billing', 'API keys', 'Sign out'].flatMap((o, i) => [
    ...(i === 3 ? [L(12, 128, 188, 128, { stroke: '{{line}}', name: 'divider' })] : []),
    T(16, 34 + i * 34, o, { size: 13, fill: i === 3 ? BAD : TXT, name: `item-${i}` })
  ])
], 'Popover account menu.', { motion: 'spring-scale-in' }));

/* ============================================================================
 * 11. FILE EXPLORER (10)
 * ========================================================================== */
const TREE = [['Reports', 0, 'folder'], ['2026', 1, 'folder'], ['June.xlsx', 2, 'file'], ['Exports', 1, 'folder'], ['Assets', 0, 'folder'], ['logo.svg', 1, 'file']];
ITEMS.push(mk('files', 'Folder Tree', 'nav', 280, 300, [
  R(0, 0, 280, 300, { role: 'card', rx: 14, name: 'card' }),
  ...TREE.flatMap(([n, d, k], i) => {
    const y = 34 + i * 40, x = 16 + d * 18;
    return [...icon(k, x + 6, y), T(x + 20, y + 4, n, { size: 13, fill: TXT, name: `node-${i}` })];
  })
], 'Hierarchical folder tree navigator.'));

ITEMS.push(mk('files', 'File List Row', 'li', 620, 44, [
  R(0, 0, 620, 44, { role: 'card', rx: 10, name: 'row' }),
  ...icon('file', 24, 22),
  T(44, 27, 'June-revenue.xlsx', { size: 13, weight: 600, fill: TXT, name: 'name' }),
  T(340, 27, '2.4 MB', { size: 12, fill: MUTED, name: 'size' }),
  T(440, 27, '14 Nov 2026', { size: 12, fill: MUTED, name: 'date' }),
  ...icon('download', 596, 22)
], 'Detail row in a file list.'));

ITEMS.push(mk('files', 'Folder Grid Tile', 'button', 140, 120, [
  R(0, 0, 140, 120, { role: 'card', rx: 14, name: 'tile' }),
  ...icon('folder', 70, 44),
  T(70, 88, 'Exports', { size: 13, weight: 600, anchor: 'middle', fill: TXT, name: 'name' }),
  T(70, 106, '24 files', { size: 11, anchor: 'middle', fill: MUTED, name: 'count' })
], 'Folder tile for grid view.'));

ITEMS.push(mk('files', 'Image File Tile', 'button', 140, 120, [
  R(0, 0, 140, 120, { role: 'card', rx: 14, name: 'tile' }),
  R(10, 10, 120, 74, { fill: '#DCFCE7', rx: 10, name: 'thumb' }),
  P('M20 74l28-26 22 18 16-12 34 26z', { fill: '#86EFAC', stroke: 'none', name: 'thumb-art' }),
  T(10, 104, 'banner.png', { size: 12, weight: 600, fill: TXT, name: 'name' })
], 'Image file tile with thumbnail.'));

ITEMS.push(mk('files', 'Breadcrumb Path', 'nav', 420, 28, [
  T(0, 18, 'Workspace  ›  Reports  ›  2026  ›  June', { size: 12, fill: MUTED, name: 'path' })
], 'File explorer path bar.'));

ITEMS.push(mk('files', 'Upload Dropzone', 'div', 400, 180, [
  R(0, 0, 400, 180, { rx: 16, stroke: ACC, sw: 1.5, dash: '6 6', name: 'zone' }),
  ...icon('upload', 200, 58),
  T(200, 102, 'Drop files here or browse', { size: 14, weight: 700, anchor: 'middle', fill: TXT, name: 'title' }),
  T(200, 122, 'PDF, CSV, XLSX · up to 50 MB', { size: 11, anchor: 'middle', fill: MUTED, name: 'hint' }),
  R(150, 138, 100, 28, { fill: ACC, rx: 8, name: 'browse' }), T(200, 156, 'Browse', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'browse-t' })
], 'Drag-and-drop upload zone with browse button.'));

ITEMS.push(mk('files', 'File Preview Panel', 'aside', 320, 360, [
  R(0, 0, 320, 360, { role: 'card', rx: 16, name: 'card' }),
  R(16, 16, 288, 150, { fill: '#F1F5F9', rx: 12, name: 'preview' }),
  ...icon('file', 160, 90),
  T(16, 196, 'June-revenue.xlsx', { size: 14, weight: 700, fill: TXT, name: 'name' }),
  T(16, 216, 'Edited by Jane · 14 Nov 2026', { size: 11, fill: MUTED, name: 'meta' }),
  R(16, 240, 136, 34, { role: 'button', rx: 10, name: 'share' }), T(84, 262, 'Share', { size: 12, weight: 600, anchor: 'middle', fill: TXT, name: 'share-t' }),
  R(168, 240, 136, 34, { fill: ACC, rx: 10, name: 'open' }), T(236, 262, 'Open', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'open-t' })
], 'Side panel previewing a selected file.'));

ITEMS.push(mk('files', 'Storage Quota Bar', 'div', 300, 70, [
  T(0, 16, 'Storage', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  ...meter(0, 34, 300, 42, '4.2 GB / 10 GB')
], 'Storage usage bar for a workspace.'));

ITEMS.push(mk('files', 'File Context Menu', 'menu', 200, 220, [
  R(0, 0, 200, 220, { role: 'card', rx: 12, name: 'menu' }),
  ...['Open', 'Rename', 'Duplicate', 'Move to…', 'Download', 'Delete'].flatMap((o, i) => [
    ...(i === 5 ? [L(12, 180, 188, 180, { stroke: '{{line}}', name: 'divider' })] : []),
    T(16, 34 + i * 30, o, { size: 13, fill: i === 5 ? BAD : TXT, name: `item-${i}` })
  ])
], 'Right-click context menu for files.'));

ITEMS.push(mk('files', 'File Toolbar', 'div', 560, 48, [
  R(0, 0, 560, 48, { role: 'card', rx: 12, name: 'bar' }),
  ...['upload', 'plus', 'download', 'share', 'trash'].flatMap((ic, i) => icon(ic, 30 + i * 40, 24)),
  R(260, 12, 120, 24, { role: 'field', rx: 8, name: 'sort' }), T(272, 28, 'Sort: Name', { size: 11, fill: TXT, name: 'sort-t' }),
  ...icon('search', 530, 24)
], 'Toolbar for file operations and sorting.'));

/* ============================================================================
 * 12. CONTROLS, MENUS, ICONS & NAVIGATION (14)
 * ========================================================================== */
ITEMS.push(mk('controls', 'Segmented Control', 'div', 300, 36, [
  R(0, 0, 300, 36, { role: 'field', rx: 10, name: 'track' }),
  R(4, 4, 96, 28, { fill: ACC, rx: 8, name: 'thumb' }),
  ...['Day', 'Week', 'Month'].map((t, i) => T(52 + i * 100, 22, t, { size: 12, weight: i === 0 ? 700 : 600, anchor: 'middle', fill: i === 0 ? '{{onAccent}}' : TXT, name: `seg-${i}` }))
], 'Three-option segmented control.'));

ITEMS.push(mk('controls', 'Underline Tab Bar', 'nav', 480, 44, [
  L(0, 42, 480, 42, { stroke: '{{line}}', name: 'base' }),
  ...['Overview', 'Members', 'Activity', 'Logs'].flatMap((t, i) => [
    T(20 + i * 110, 26, t, { size: 13, weight: i === 0 ? 700 : 500, fill: i === 0 ? ACC : MUTED, name: `tab-${i}` }),
    ...(i === 0 ? [R(20, 38, 62, 3, { fill: ACC, rx: 2, name: 'indicator' })] : [])
  ])
], 'Underline style tab bar.'));

ITEMS.push(mk('controls', 'Stepper Progress', 'nav', 420, 60, [
  L(20, 18, 400, 18, { stroke: '{{line}}', sw: 2, name: 'track' }),
  L(20, 18, 200, 18, { stroke: ACC, sw: 2, name: 'done' }),
  ...['Account', 'Team', 'Plan', 'Done'].flatMap((s, i) => [
    C(20 + i * 127, 18, 9, { fill: i <= 1 ? ACC : '{{card}}', stroke: ACC, sw: 2, name: `dot-${i}` }),
    T(20 + i * 127, 46, s, { size: 11, weight: 600, anchor: 'middle', fill: i <= 1 ? TXT : MUTED, name: `lbl-${i}` })
  ])
], 'Four-step progress stepper.'));

ITEMS.push(mk('controls', 'Pagination Bar', 'nav', 300, 36, [
  R(0, 0, 300, 36, { role: 'card', rx: 10, name: 'bar' }),
  T(20, 23, '‹ Prev', { size: 12, fill: MUTED, name: 'prev' }),
  ...['1', '2', '3', '…', '12'].map((p, i) => T(110 + i * 26, 23, p, { size: 12, weight: i === 0 ? 800 : 500, anchor: 'middle', fill: i === 0 ? ACC : TXT, name: `page-${i}` })),
  T(280, 23, 'Next ›', { size: 12, anchor: 'end', fill: TXT, name: 'next' })
], 'Pagination bar with page numbers.'));

ITEMS.push(mk('controls', 'Filter Chip Active', 'button', 120, 32, [
  R(0, 0, 120, 32, { fill: ACC, rx: 16, name: 'chip' }),
  T(60, 21, 'Status: live', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'chip-t' })
], 'Active filter chip.'));

ITEMS.push(mk('controls', 'Filter Chip Inactive', 'button', 120, 32, [
  R(0, 0, 120, 32, { role: 'button', rx: 16, name: 'chip' }),
  T(60, 21, 'Status: any', { size: 12, weight: 500, anchor: 'middle', fill: TXT, name: 'chip-t' })
], 'Inactive filter chip.'));

ITEMS.push(mk('controls', 'Notification Badge Count', 'span', 40, 22, [
  R(0, 0, 40, 22, { fill: BAD, rx: 11, name: 'badge' }),
  T(20, 15, '99+', { size: 11, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'count' })
], 'Unread count badge.'));

ITEMS.push(mk('controls', 'Avatar Stack', 'div', 160, 40, [
  ...av(20, 20, 16, 'JD', ACC), ...av(48, 20, 16, 'SO', '#7C3AED'), ...av(76, 20, 16, 'LP', '#0891B2'),
  ...av(104, 20, 16, '+4', '{{muted}}')
], 'Overlapping avatars with overflow count.'));

ITEMS.push(mk('controls', 'Progress Bar Labeled', 'div', 320, 40, [
  T(0, 14, 'Importing records', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  T(320, 14, '64%', { size: 12, weight: 700, anchor: 'end', fill: TXT, name: 'pct' }),
  R(0, 24, 320, 8, { role: 'field', rx: 4, name: 'track' }),
  R(0, 24, 205, 8, { fill: ACC, rx: 4, name: 'value' })
], 'Labeled determinate progress bar.'));

ITEMS.push(mk('controls', 'Progress Bar Thin', 'div', 320, 14, [
  R(0, 0, 320, 6, { role: 'field', rx: 3, name: 'track' }),
  R(0, 0, 96, 6, { fill: GOOD, rx: 3, name: 'value' })
], 'Thin progress bar without label.'));

ITEMS.push(mk('controls', 'Range Slider', 'div', 300, 40, [
  T(0, 12, 'Monthly budget', { size: 12, weight: 600, fill: TXT, name: 'label' }),
  T(300, 12, '$250', { size: 12, weight: 700, anchor: 'end', fill: TXT, name: 'value' }),
  L(0, 28, 300, 28, { stroke: '{{line}}', sw: 4, name: 'track' }),
  L(0, 28, 150, 28, { stroke: ACC, sw: 4, name: 'range' }),
  C(150, 28, 9, { fill: '#FFFFFF', stroke: ACC, sw: 2, name: 'thumb' })
], 'Single-value range slider.'));

ITEMS.push(mk('controls', 'Switch Toggle On', 'button', 52, 30, [
  R(0, 0, 52, 30, { fill: ACC, rx: 15, name: 'track' }),
  C(38, 15, 11, { fill: '#FFFFFF', name: 'knob' })
], 'Switch in on state.'));

ITEMS.push(mk('controls', 'Checkbox Group', 'fieldset', 260, 140, [
  ...['Email digests', 'Product news', 'Security alerts', 'Billing receipts'].flatMap((o, i) => [
    R(0, i * 34, 18, 18, { rx: 5, stroke: ACC, sw: 1.6, name: `box-${i}` }),
    ...(i !== 1 ? icon('check', 9, 9 + i * 34) : []),
    T(28, 14 + i * 34, o, { size: 13, fill: TXT, name: `opt-${i}` })
  ])
], 'Multi-select checkbox group.'));

ITEMS.push(mk('controls', 'Radio Group', 'fieldset', 260, 120, [
  ...['Daily', 'Weekly', 'Monthly'].flatMap((o, i) => [
    C(9, 9 + i * 34, 8, { stroke: ACC, sw: 1.6, name: `radio-${i}` }),
    ...(i === 1 ? [C(9, 43, 4, { fill: ACC, name: 'radio-dot' })] : []),
    T(28, 14 + i * 34, o, { size: 13, fill: TXT, name: `ro-${i}` })
  ])
], 'Single-select radio group.'));

/* ============================================================================
 * 13. FEEDBACK STATES (4)
 * ========================================================================== */
ITEMS.push(mk('states', 'Empty State', 'div', 360, 240, [
  R(0, 0, 360, 240, { role: 'card', rx: 18, name: 'card' }),
  C(180, 62, 30, { fill: ACC, name: 'bg' }),
  ...icon('folder', 180, 62),
  T(180, 124, 'No reports yet', { size: 16, weight: 800, anchor: 'middle', fill: TXT, name: 'title' }),
  T(180, 146, 'Create a report to see trends here.', { size: 12, anchor: 'middle', fill: MUTED, name: 'body' }),
  R(120, 166, 120, 36, { fill: ACC, rx: 10, name: 'cta' }), T(180, 189, 'New report', { size: 12, weight: 700, anchor: 'middle', fill: '{{onAccent}}', name: 'cta-t' })
], 'Empty state with illustration and call to action.'));

ITEMS.push(mk('states', 'Skeleton Card', 'div', 300, 180, [
  R(0, 0, 300, 180, { role: 'card', rx: 16, name: 'card' }),
  C(36, 40, 18, { fill: '{{line}}', name: 'sk-avatar' }),
  R(64, 30, 140, 12, { fill: '{{line}}', rx: 6, name: 'sk-title' }),
  R(64, 50, 90, 10, { fill: '{{line}}', rx: 5, name: 'sk-sub' }),
  R(20, 84, 260, 10, { fill: '{{line}}', rx: 5, name: 'sk-l1' }),
  R(20, 104, 230, 10, { fill: '{{line}}', rx: 5, name: 'sk-l2' }),
  R(20, 124, 180, 10, { fill: '{{line}}', rx: 5, name: 'sk-l3' })
], 'Loading skeleton placeholder card.'));

ITEMS.push(mk('states', 'Error Banner', 'div', 560, 56, [
  R(0, 0, 560, 56, { fill: BAD_BG, rx: 12, name: 'banner' }),
  ...icon('cross', 24, 28),
  T(44, 24, 'Could not load usage data', { size: 13, weight: 700, fill: BAD, name: 'title' }),
  T(44, 42, 'Check your connection and try again.', { size: 11, fill: TXT, name: 'body' }),
  R(446, 14, 98, 28, { fill: BAD, rx: 8, name: 'retry' }), T(495, 32, 'Retry', { size: 12, weight: 700, anchor: 'middle', fill: '#FFFFFF', name: 'retry-t' })
], 'Inline error banner with retry.'));

ITEMS.push(mk('states', 'Success Banner', 'div', 560, 56, [
  R(0, 0, 560, 56, { fill: GOOD_BG, rx: 12, name: 'banner' }),
  ...icon('check', 24, 28),
  T(44, 24, 'Changes saved', { size: 13, weight: 700, fill: GOOD, name: 'title' }),
  T(44, 42, 'Permissions for Editors were updated.', { size: 11, fill: TXT, name: 'body' })
], 'Inline success confirmation banner.'));

/* ============================================================================
 * 14. ONBOARDING (2)
 * ========================================================================== */
ITEMS.push(mk('onboarding', 'Onboarding Checklist', 'div', 360, 260, [
  R(0, 0, 360, 260, { role: 'card', rx: 16, name: 'card' }),
  T(20, 30, 'Get started', { size: 15, weight: 800, fill: TXT, name: 'title' }),
  R(20, 42, 320, 6, { role: 'field', rx: 3, name: 'track' }), R(20, 42, 160, 6, { fill: ACC, rx: 3, name: 'value' }),
  ...['Verify email', 'Invite a teammate', 'Create first API key', 'Top up credits'].flatMap((s, i) => [
    ...(i < 2 ? icon('check', 30, 78 + i * 40) : [C(30, 78 + i * 40, 7, { stroke: MUTED, sw: 1.4, name: `todo-${i}` })]),
    T(50, 82 + i * 40, s, { size: 13, weight: 500, fill: i < 2 ? MUTED : TXT, name: `step-${i}` })
  ])
], 'Onboarding checklist with progress.'));

ITEMS.push(mk('onboarding', 'Wizard Step Header', 'header', 560, 72, [
  T(0, 26, 'Step 2 of 4', { size: 11, weight: 700, fill: ACC, name: 'step' }),
  T(0, 52, 'Choose your plan', { size: 20, weight: 800, fill: TXT, name: 'title' }),
  R(420, 30, 140, 8, { role: 'field', rx: 4, name: 'track' }), R(420, 30, 70, 8, { fill: ACC, rx: 4, name: 'value' })
], 'Header for multi-step onboarding wizard.'));

export const ASTRYX_EXTENDED_ELEMENTS = ITEMS;
