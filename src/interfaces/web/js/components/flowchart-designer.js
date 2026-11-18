/**
 * Conceptual FlowChart Designer (ComfyUI-style interactive node graph for Frontend UI, Backend API,
 * Full-Stack & Business Logic workflows, with per-access-level feature variants, reverse engineering,
 * UI screen materialization, and full `project-definition.md` export).
 */
import { h, clear, modal, toast, promptBox, confirmBox, choiceBox, download, contextMenu } from '../dom.js';
import { ibtn, iconEl } from '../icons.js';
import { api } from '../api.js';
import { state, emit, findDesign, projectLabel, canEditOwned, ownerLabel, isSuperadminUser } from '../state.js';
import { markEdited, rememberName, lastEdited, editedName } from '../edited.js';
import { reloadLibrary } from '../actions.js';
import { openCopyMoveToProjectsModal } from './item-browser.js';
import { openLineageModal } from './collab-modals.js';
import {
  FLOWCHART_DOMAINS,
  FLOWCHART_NODE_KINDS,
  FLOWCHART_SUBTYPES,
  PORT_KINDS,
  EDGE_STYLES,
  DENIED_BEHAVIORS,
  DEFAULT_ACCESS_LEVELS,
  HOME_PORT_KEY,
  normalizeFlowchartNode,
  normalizeFlowchartEdge,
  normalizePort,
  normalizeAccessLevels,
  resolveNodeForRole,
  isEdgeAllowedForRole,
  splitEdgeWithDecision,
  autoLayoutFlowchart,
  validateFlowchart,
  flowchartToMermaid,
  flowchartFingerprint
} from '/domain/flowchart.js';

const NS = 'http://www.w3.org/2000/svg';
const KIND_META = new Map(FLOWCHART_NODE_KINDS.map(k => [k.key, k]));
const DESIGNER_PAGES = [
  ['path', 'Path designer', 'bezier'],
  ['icon', 'Icon designer', 'star'],
  ['button', 'Button designer', 'circle'],
  ['element', 'Element designer', 'rect'],
  ['screen', 'Screen designer', 'monitor'],
  ['workflow', 'Workflow designer', 'workflow'],
  ['flowchart', 'FlowChart designer', 'flowchart']
];

const cloneDeep = v => JSON.parse(JSON.stringify(v));

/** Builds the shared Designer Change Dropdown (`typeSwitch`) usable inside FlowChartDesigner & WorkflowDesigner. */
export function buildDesignerSwitchDropdown(currentType, openPage) {
  const curMeta = DESIGNER_PAGES.find(d => d[0] === currentType) || DESIGNER_PAGES[6];
  const wrap = h('div', { class: 'menu', style: { display: 'inline-flex' } });
  const panel = h('div', { class: 'menu-panel', role: 'menu' });
  const headLabel = h('span', { class: 'text-menu-label' }, curMeta[1]);
  const btn = h('button', {
    type: 'button',
    class: 'btn small ib type-switch text-menu',
    dataset: { act: 'type-switch' },
    style: { marginLeft: '6px' },
    title: 'Switch designer: opens the item of that type you edited last',
    onclick: e => {
      e.stopPropagation();
      const willOpen = !wrap.classList.contains('open');
      document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open'));
      if (!willOpen) return;
      clear(panel);
      for (const [t, title, glyph] of DESIGNER_PAGES) {
        const id = lastEdited(t);
        const name = id != null ? (findDesign(t, id)?.name || editedName(t, id)) : '';
        const text = `${title}${t === currentType ? '  ·  current' : name ? `  ·  ${name}` : ''}`;
        panel.append(h('button', {
          type: 'button',
          class: 'menu-item',
          role: 'menuitem',
          onclick: ev => {
            ev.stopPropagation();
            wrap.classList.remove('open');
            if (t !== currentType) openPage?.(t);
          }
        }, iconEl(glyph, { size: 16 }), h('span', { class: 'mi-label' }, text)));
      }
      wrap.classList.add('open');
    }
  }, headLabel, iconEl('chevDown', { size: 12 }));
  wrap.append(btn, panel);
  return wrap;
}

/** Modal to create a new conceptual FlowChart with title, domain, and description. */
export function openNewFlowchartModal({ defaultDomain = 'fullstack', onCreated } = {}) {
  const nameIn = h('input', { type: 'text', placeholder: 'e.g. Checkout & Order Fulfillment Flow', value: '' });
  const domSel = h('select', {}, FLOWCHART_DOMAINS.map(d => h('option', { value: d.key, selected: d.key === defaultDomain }, d.label)));
  const descIn = h('textarea', {
    rows: 4,
    placeholder: 'Describe what this flowchart covers: user goals, frontend screens, backend API / business rules, and role differences…'
  });
  const tplSel = h('select', {},
    h('option', { value: 'starter' }, 'Starter Entry Node (1 Screen / Trigger node)'),
    h('option', { value: 'auth-crud' }, 'Template: Sign-In → Decision → Role-Based Dashboard + API Step'),
    h('option', { value: 'empty' }, 'Blank Canvas')
  );

  const form = h('div', { class: 'fc-modal-form' },
    h('label', { class: 'field' }, h('span', {}, 'FlowChart Name'), nameIn),
    h('label', { class: 'field' }, h('span', {}, 'Workflow Scope / Domain'), domSel),
    h('label', { class: 'field' }, h('span', {}, 'Initial Template'), tplSel),
    h('label', { class: 'field' }, h('span', {}, 'Conceptual Description (for Humans & AI Coders)'), descIn)
  );

  const m = modal({
    title: 'New Conceptual FlowChart',
    wide: true,
    content: form,
    actions: close => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const name = nameIn.value.trim();
          if (!name) return toast('Enter a FlowChart name', 'error');
          const tpl = tplSel.value;
          const payload = {
            name,
            domain: domSel.value,
            description: descIn.value.trim(),
            projectId: state.activeProjectId || 1,
            visibility: (state.activeProjectId || 1) === 1 && isSuperadminUser() ? 'public' : 'project',
            seedStarter: tpl === 'starter'
          };
          if (tpl === 'auth-crud') {
            payload.nodes = [
              {
                nodeKey: 'login-screen',
                kind: 'screen',
                subtype: 'ui-screen',
                title: 'Sign In Screen',
                description: 'User enters email/username and password, or picks OAuth provider.',
                ports: [
                  { key: 'submit-login', label: 'Submit Credentials', kind: 'submit', description: 'Validates form and submits login request.' },
                  { key: 'forgot-pw', label: 'Forgot Password', kind: 'menu-item', description: 'Opens password recovery flow.' }
                ]
              },
              {
                nodeKey: 'auth-api',
                kind: 'step',
                subtype: 'api-endpoint',
                title: 'Verify Credentials API',
                description: 'Checks user hash, rate-limits failed attempts, and issues session cookie / token.',
                techSpec: { method: 'POST', endpoint: '/api/auth/login', dbTables: ['users', 'sessions'] },
                ports: [{ key: 'evaluated', label: 'Auth Result', kind: 'api-next', description: 'Passes verification outcome to decision router.' }]
              },
              {
                nodeKey: 'auth-decision',
                kind: 'decision',
                subtype: 'auth-guard',
                title: 'Credentials & Role Check',
                description: 'Branches on authentication success vs invalid credentials.',
                ports: [
                  { key: 'valid', label: 'Authenticated', kind: 'case', description: 'Valid account; route to role-aware dashboard.' },
                  { key: 'invalid', label: 'Invalid / Locked', kind: 'case', description: 'Return error state to Sign In screen.' }
                ]
              },
              {
                nodeKey: 'dashboard-screen',
                kind: 'screen',
                subtype: 'ui-screen',
                title: 'Workspace Dashboard',
                description: 'Main application hub showing role-appropriate navigation, recent items, and actions.',
                roleSettings: {
                  allowedRoles: ['user', 'pro', 'editor', 'admin'],
                  deniedBehavior: 'login-prompt',
                  variants: {
                    user: { summary: 'Shows personal workspace, recent activity, and Upgrade prompt.', hiddenFeatures: 'Admin ACL & system metrics' },
                    admin: { summary: 'Includes full personal workspace PLUS Admin Moderation bar, User ACL panel, and Audit export.', addedFeatures: 'Admin toolbar, User management, System health' }
                  }
                },
                ports: [
                  { key: 'create-item', label: 'Create Item', kind: 'button', description: 'Starts item creation flow.' },
                  { key: 'admin-panel', label: 'Admin Console', kind: 'menu-item', allowedRoles: ['admin'], deniedBehavior: 'hide', description: 'Opens system administration screen.' }
                ]
              }
            ];
            payload.edges = [
              { fromNodeKey: 'login-screen', fromPortKey: 'submit-login', toNodeKey: 'auth-api', label: 'POST /login', transitionText: 'Client validates email/password non-empty, disables button with spinner, and sends JSON over HTTPS.' },
              { fromNodeKey: 'auth-api', fromPortKey: 'evaluated', toNodeKey: 'auth-decision', label: 'Verify', transitionText: 'Evaluates password check, account lock status, and user role.' },
              { fromNodeKey: 'auth-decision', fromPortKey: 'valid', toNodeKey: 'dashboard-screen', label: 'Success', transitionText: 'Stores HttpOnly session cookie, loads user profile + role permissions, and navigates to Dashboard.' },
              { fromNodeKey: 'auth-decision', fromPortKey: 'invalid', toNodeKey: 'login-screen', label: '401 Error', transitionText: 'Increments failure counter and displays inline authentication error banner.' }
            ];
            payload.autoLayout = true;
          }
          try {
            const fc = await api.createFlowchart(payload);
            rememberName('flowchart', fc.id, fc.name);
            emit('flowcharts:changed');
            await reloadLibrary({ silent: true });
            close();
            toast(`FlowChart "${fc.name}" created`, 'ok');
            onCreated?.(fc);
          } catch (e) { toast(e.message, 'error'); }
        }
      }, 'Create FlowChart')
    ]
  });
  setTimeout(() => nameIn.focus(), 30);
  return m;
}

/** Modal to edit a FlowChart's title, domain, approval status, and conceptual description from the browser or toolbar. */
export function openEditFlowchartMetaModal(fc, { onSaved } = {}) {
  const nameIn = h('input', { type: 'text', value: fc.name || '' });
  const domSel = h('select', {}, FLOWCHART_DOMAINS.map(d => h('option', { value: d.key, selected: d.key === (fc.domain || 'fullstack') }, d.label)));
  const statusSel = h('select', {},
    h('option', { value: 'draft', selected: fc.status === 'draft' }, 'Draft (Work in Progress)'),
    h('option', { value: 'in_review', selected: fc.status === 'in_review' }, 'In Review'),
    h('option', { value: 'approved', selected: fc.status === 'approved' }, 'Approved (Ready for AI UI & Code Build)')
  );
  const descIn = h('textarea', { rows: 6, value: fc.description || fc.descriptionDev || '', placeholder: 'Detailed conceptual description of this flowchart…' });
  const noteIn = h('textarea', { rows: 2, value: fc.approvalNote || '', placeholder: 'Optional sign-off / implementation instructions for AI coder…' });

  modal({
    title: `Edit FlowChart Details — "${fc.name}"`,
    wide: true,
    content: h('div', { class: 'fc-modal-form' },
      h('label', { class: 'field' }, h('span', {}, 'Title'), nameIn),
      h('div', { class: 'fc-grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Domain / Layer'), domSel),
        h('label', { class: 'field' }, h('span', {}, 'Approval Status'), statusSel)
      ),
      h('label', { class: 'field' }, h('span', {}, 'Description'), descIn),
      h('label', { class: 'field' }, h('span', {}, 'Approval / AI Coder Sign-Off Note'), noteIn)
    ),
    actions: close => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const name = nameIn.value.trim();
          if (!name) return toast('Name cannot be empty', 'error');
          try {
            const updated = await api.updateFlowchart(fc.id, {
              name,
              label: name,
              domain: domSel.value,
              status: statusSel.value,
              description: descIn.value,
              approvalNote: noteIn.value
            });
            rememberName('flowchart', updated.id, updated.name);
            emit('flowcharts:changed');
            close();
            toast(`Updated "${updated.name}"`, 'ok');
            onSaved?.(updated);
          } catch (e) { toast(e.message, 'error'); }
        }
      }, 'Save Details')
    ]
  });
}

/** Modal to reverse-engineer either existing Project Screens/Workflows OR external App Routes/Code Spec into a FlowChart. */
export async function openReverseEngineerModal({ onCreated } = {}) {
  let workflows = [];
  try { workflows = await api.workflows({ projectId: state.activeProjectId || 1, includePublic: false }); } catch { workflows = []; }

  let tab = 'project';
  const bodyWrap = h('div', { class: 'fc-modal-form' });
  const nameIn = h('input', { type: 'text', placeholder: 'e.g. Reverse-Engineered Checkout & API Flow', value: '' });
  const wfSel = h('select', {},
    h('option', { value: '' }, 'All Project Screens (Auto-crawl routes & menus)'),
    ...workflows.map(w => h('option', { value: String(w.id) }, `From Workflow: ${w.name} (${w.screenCount} screens)`))
  );
  const backendChk = h('input', { type: 'checkbox', checked: true });
  const rawSpecArea = h('textarea', {
    rows: 10,
    placeholder: [
      '# Paste routes, screens, API endpoints, decisions & transitions (plain text or JSON):',
      'Screen: Sign In (/login) - User enters credentials or SSO',
      'API: POST /api/auth/login - Validates user credentials & creates session',
      'Decision: Role Gate? - Routes user by access level',
      'Screen: User Dashboard (/app) - Personal workspace & items',
      'Screen: Admin Console (/admin) - System ACL, audit logs & moderation',
      'Sign In (/login) --[Submit Login]--> POST /api/auth/login : Validates inputs & posts JSON',
      'POST /api/auth/login --[Auth Result]--> Role Gate? : Evaluates token & role claims',
      'Role Gate? --[Standard User]--> User Dashboard (/app) : Loads user workspace',
      'Role Gate? --[Admin]--> Admin Console (/admin) : Loads admin management tools'
    ].join('\n')
  });

  const renderTab = () => {
    clear(bodyWrap);
    const tabsBar = h('div', { class: 'fc-pill-tabs' },
      h('button', { type: 'button', class: `btn small${tab === 'project' ? ' primary' : ''}`, onclick: () => { tab = 'project'; renderTab(); } }, '1. From Project Screens & Workflows'),
      h('button', { type: 'button', class: `btn small${tab === 'app-spec' ? ' primary' : ''}`, onclick: () => { tab = 'app-spec'; renderTab(); } }, '2. From External App / Routes / Spec')
    );
    if (tab === 'project') {
      bodyWrap.append(
        tabsBar,
        h('p', { class: 'muted' }, 'Scans visual screens, buttons, popup/radial menus, form fields, and workflow links in the active project and synthesizes a laid-out conceptual FlowChart.'),
        h('label', { class: 'field' }, h('span', {}, 'New FlowChart Name (optional)'), nameIn),
        h('label', { class: 'field' }, h('span', {}, 'Source Screens / Workflow'), wfSel),
        h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer' } }, backendChk, h('span', {}, 'Synthesize Validation Decisions & Backend API Steps for form screens'))
      );
    } else {
      bodyWrap.append(
        tabsBar,
        h('p', { class: 'muted' }, 'Paste route definitions, screen/API lists, arrow transitions (`A --[Action]--> B : transition logic`), or a JSON spec `{ screens, endpoints, decisions, transitions }` to generate a conceptual FlowChart.'),
        h('label', { class: 'field' }, h('span', {}, 'New FlowChart Name'), nameIn),
        h('label', { class: 'field' }, h('span', {}, 'App Specification (Plain-Text Flow Lines or JSON)'), rawSpecArea)
      );
    }
  };
  renderTab();

  modal({
    title: '⚡ Reverse Engineer App → Conceptual FlowChart',
    wide: true,
    content: bodyWrap,
    actions: close => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          try {
            let payload;
            if (tab === 'project') {
              payload = {
                mode: 'project',
                projectId: state.activeProjectId || 1,
                name: nameIn.value.trim() || undefined,
                workflowId: wfSel.value ? Number(wfSel.value) : undefined,
                includeBackendSteps: backendChk.checked
              };
            } else {
              const raw = rawSpecArea.value.trim();
              if (!raw) return toast('Paste app routes, transitions, or JSON specification first', 'error');
              let parsedJson = null;
              if (raw.startsWith('{')) {
                try { parsedJson = JSON.parse(raw); } catch { return toast('Invalid JSON syntax in specification', 'error'); }
              }
              payload = parsedJson
                ? { ...parsedJson, mode: 'app-spec', projectId: state.activeProjectId || 1, name: nameIn.value.trim() || parsedJson.name || 'Reverse-Engineered App FlowChart' }
                : { mode: 'app-spec', projectId: state.activeProjectId || 1, name: nameIn.value.trim() || 'Reverse-Engineered App FlowChart', rawText: raw };
            }
            const fc = await api.reverseEngineerFlowchart(payload);
            rememberName('flowchart', fc.id, fc.name);
            emit('flowcharts:changed');
            await reloadLibrary({ silent: true });
            close();
            toast(`Reverse-engineered "${fc.name}" (${fc.nodes.length} nodes, ${fc.edges.length} connections)`, 'ok');
            onCreated?.(fc);
          } catch (e) { toast(e.message, 'error'); }
        }
      }, 'Generate FlowChart')
    ]
  });
}

/** Modal to preview, copy, and download the complete `project-definition.md` & `.json` blueprint for AI coders. */
export async function openProjectDefinitionModal({ flowchartIds = null } = {}) {
  const pid = state.activeProjectId || 1;
  let onlyApproved = false;
  const pre = h('textarea', { class: 'fc-code-preview', rows: 20, readonly: true });
  const summaryBar = h('div', { class: 'muted', style: { marginBottom: '8px' } }, 'Compiling project definition…');
  let latest = null;

  const refresh = async () => {
    try {
      latest = await api.exportProjectDefinition(pid, {
        format: 'both',
        onlyApproved: onlyApproved ? '1' : '0',
        ...(flowchartIds?.length ? { flowchartIds } : {})
      });
      pre.value = latest.markdown || '';
      const s = latest.definition?.summary || {};
      summaryBar.textContent = `${s.totalFlowcharts ?? 0} flowchart(s) (${s.approvedFlowcharts ?? 0} approved) · ${s.conceptualScreens ?? 0} conceptual screen(s) · ${s.backendAndLogicSteps ?? 0} backend/logic step(s) · ${s.decisionRouters ?? 0} decision router(s) · ${s.visualScreens ?? 0} visual screen(s)`;
    } catch (e) {
      summaryBar.textContent = `Error: ${e.message}`;
    }
  };

  const approvedChk = h('input', {
    type: 'checkbox',
    checked: false,
    onchange: () => { onlyApproved = approvedChk.checked; refresh(); }
  });

  await refresh();
  modal({
    title: '📄 Project Definition Blueprint (for AI Coders & Documentation)',
    w90: true,
    content: h('div', { class: 'fc-modal-form' },
      h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
        summaryBar,
        h('label', { class: 'row', style: { gap: '6px', cursor: 'pointer' } }, approvedChk, h('span', {}, 'Approved flowcharts only'))
      ),
      pre
    ),
    actions: close => [
      h('button', {
        class: 'btn',
        onclick: async () => {
          if (!latest?.markdown) return;
          try { await navigator.clipboard.writeText(latest.markdown); toast('Copied project-definition.md to clipboard', 'ok'); }
          catch { pre.select(); document.execCommand('copy'); toast('Copied to clipboard', 'ok'); }
        }
      }, 'Copy Markdown'),
      h('button', {
        class: 'btn',
        onclick: () => latest?.definition && download(latest.jsonFilename || 'project-definition.json', JSON.stringify(latest.definition, null, 2), 'application/json')
      }, 'Download JSON'),
      h('button', {
        class: 'btn primary',
        onclick: () => latest?.markdown && download(latest.filename || 'project-definition.md', latest.markdown, 'text/markdown')
      }, 'Download project-definition.md'),
      h('button', { class: 'btn', onclick: close }, 'Close')
    ]
  });
}

export class FlowChartDesigner {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.fc = null;
    this.zoom = 0.92;
    this.pan = { x: 40, y: 40 };
    this.edgeStyle = 'bezier';
    this.rolePreview = 'all';
    this.sel = null;              // { kind: 'node', nodeKey } | { kind: 'edge', edgeKey } | null
    this.drag = null;             // pan | node | wire
    this.spaceDown = false;
    this.inspectorOpen = true;
    this.baseline = null;
    this.baselineFp = '';
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];
    this.nodeEls = new Map();

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) this.spaceDown = true;
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.spaceDown = false; });
    onKeyBindings(this);
  }

  isOwnedByCurrentUser(rec = this.fc) {
    return canEditOwned(rec);
  }

  snapshot() {
    if (!this.fc) return null;
    return cloneDeep({
      name: this.fc.name,
      label: this.fc.label,
      description: this.fc.description,
      domain: this.fc.domain,
      status: this.fc.status,
      approvalNote: this.fc.approvalNote,
      startNodeKey: this.fc.startNodeKey,
      linkedWorkflowId: this.fc.linkedWorkflowId,
      visibility: this.fc.visibility,
      accessLevels: this.fc.accessLevels,
      spec: this.fc.spec,
      nodes: this.fc.nodes,
      edges: this.fc.edges
    });
  }

  markBaseline() {
    this.baseline = this.snapshot();
    this.baselineFp = flowchartFingerprint(this.fc);
    this.dirty = false;
    this.updateDocBar();
  }

  checkDirty() {
    if (!this.fc) { this.dirty = false; return; }
    this.dirty = flowchartFingerprint(this.fc) !== this.baselineFp;
    this.updateDocBar();
  }

  pushUndo(snap = this.snapshot()) {
    if (!snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
  }

  applySnapshotLocal(snap) {
    if (!this.fc || !snap) return;
    Object.assign(this.fc, cloneDeep(snap));
    this.checkDirty();
    this.rebuildCanvas();
    this.renderInspector();
  }

  undo() {
    if (!this.undoStack.length || !this.fc) return toast('Nothing to undo');
    this.redoStack.push(this.snapshot());
    this.applySnapshotLocal(this.undoStack.pop());
  }

  redo() {
    if (!this.redoStack.length || !this.fc) return toast('Nothing to redo');
    this.undoStack.push(this.snapshot());
    this.applySnapshotLocal(this.redoStack.pop());
  }

  async confirmLeave() {
    if (!this.fc || !this.dirty) return true;
    const c = await choiceBox(
      'Unsaved FlowChart changes',
      `"${this.fc.name}" has unsaved conceptual changes. Save them before leaving?`,
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Discard changes', value: 'discard', kind: 'danger' },
        { label: 'Save', value: 'save', kind: 'primary' }
      ]
    );
    if (c === 'save') return this.save();
    if (c === 'discard') return this.reset({ confirm: false });
    return false;
  }

  async load(id) {
    this.fc = await api.flowchart(id, { mermaid: true });
    rememberName('flowchart', this.fc.id, this.fc.name);
    this.sel = null;
    this.rolePreview = 'all';
    this.undoStack = [];
    this.redoStack = [];
    this.markBaseline();
    this.render();
    requestAnimationFrame(() => this.fit());
  }

  async refresh() {
    if (!this.fc) return;
    this.fc = await api.flowchart(this.fc.id, { mermaid: true });
    this.markBaseline();
    this.render();
  }

  async save() {
    if (!this.fc) return false;
    if (!this.isOwnedByCurrentUser()) {
      toast('Read-only FlowChart: use "Save as…" to clone into your project', 'error');
      return false;
    }
    try {
      const saved = await api.updateFlowchart(this.fc.id, {
        name: this.fc.name,
        label: this.fc.label || this.fc.name,
        description: this.fc.description || '',
        domain: this.fc.domain,
        status: this.fc.status,
        approvalNote: this.fc.approvalNote || '',
        startNodeKey: this.fc.startNodeKey,
        linkedWorkflowId: this.fc.linkedWorkflowId,
        visibility: this.fc.visibility,
        accessLevels: this.fc.accessLevels,
        spec: this.fc.spec,
        nodes: this.fc.nodes,
        edges: this.fc.edges
      });
      this.fc = saved;
      markEdited('flowchart', saved.id);
      rememberName('flowchart', saved.id, saved.name);
      this.markBaseline();
      this.rebuildCanvas();
      this.renderInspector();
      emit('flowcharts:changed');
      toast(`Saved FlowChart "${saved.name}"`, 'ok', 2000);
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  async saveAs() {
    if (!this.fc) return false;
    const name = await promptBox('Save FlowChart as…', { value: `${this.fc.name} copy`, label: 'New FlowChart Name', okLabel: 'Save Copy' });
    if (!name?.trim()) return false;
    try {
      const created = await api.createFlowchart({
        name: name.trim(),
        description: this.fc.description,
        domain: this.fc.domain,
        status: 'draft',
        accessLevels: this.fc.accessLevels,
        spec: this.fc.spec,
        startNodeKey: this.fc.startNodeKey,
        projectId: state.activeProjectId || this.fc.projectId || 1,
        visibility: 'project',
        nodes: this.fc.nodes,
        edges: this.fc.edges
      });
      rememberName('flowchart', created.id, created.name);
      emit('flowcharts:changed');
      await this.app.openFlowchart(created.id);
      toast(`Saved as "${created.name}"`, 'ok');
      return true;
    } catch (e) {
      toast(e.message, 'error');
      return false;
    }
  }

  async reset({ confirm = true } = {}) {
    if (!this.fc || !this.dirty) return true;
    if (confirm && !(await confirmBox(`Discard unsaved changes to "${this.fc.name}"?`, { okLabel: 'Discard' }))) return false;
    await this.load(this.fc.id);
    toast('Reverted to last saved version', 'info');
    return true;
  }

  refreshBack() {
    if (!this.backBtn) return;
    const target = this.app.backTarget?.();
    this.backBtn.disabled = !this.app.canBack?.();
    this.backBtn.title = target ? `Back to ${target} (Alt+←)` : 'Back to the previous page (Alt+←)';
  }

  buildDocBar() {
    const ownedByMe = this.isOwnedByCurrentUser(this.fc);
    this.backBtn = ibtn('back', 'Back', () => this.app.back(), { desc: 'Return to the previous page', kbd: 'Alt+←', dataset: { act: 'back' } });
    this.saveBtn = ibtn('save', 'Save', () => this.save(), { kbd: 'Ctrl+S', disabled: !ownedByMe, cls: 'save' });
    this.saveAsBtn = ibtn('copy', 'Save as…', () => this.saveAs(), { desc: 'Save a copy of this FlowChart in the active project' });
    this.resetBtn = ibtn('undo', 'Reset', () => this.reset(), { desc: 'Revert unsaved changes' });
    const fcItem = () => [{ type: 'flowchart', id: this.fc.id, name: this.fc.name, key: this.fc.key, creatorId: this.fc.creatorId }];
    const copyToBtn = ibtn('copy', 'Copy to…', () => this.fc && openCopyMoveToProjectsModal({ items: fcItem(), mode: 'copy' }), { desc: 'Copy this FlowChart to project(s)' });
    const moveToBtn = ibtn('import', 'Move to…', () => this.fc && ownedByMe && openCopyMoveToProjectsModal({ items: fcItem(), mode: 'move' }), {
      disabled: !ownedByMe,
      desc: ownedByMe ? 'Move this FlowChart to your project(s)' : 'FlowCharts owned by other users can only be copied'
    });

    const isApproved = this.fc?.status === 'approved';
    this.approveBtn = h('button', {
      type: 'button',
      class: `btn small fc-status-btn status-${this.fc?.status || 'draft'}`,
      dataset: { act: 'fc-toggle-approve' },
      title: isApproved
        ? 'Approved for AI UI & Backend implementation — click to change status or sign-off note'
        : 'Mark this FlowChart as Approved so AI coders can materialize UI screens and implement backend logic',
      onclick: () => this.toggleApproval()
    }, isApproved ? '✓ Approved' : this.fc?.status === 'in_review' ? '⏳ In Review' : '✎ Draft · Approve');

    this.docbar = h('div', { class: 'dz-docbar fc-docbar', role: 'toolbar', 'aria-label': 'FlowChart Document' },
      this.backBtn, h('span', { class: 'sep-v' }),
      this.saveBtn, this.saveAsBtn, this.resetBtn,
      h('span', { class: 'sep-v' }),
      copyToBtn, moveToBtn,
      h('span', { class: 'sep-v' }),
      this.approveBtn
    );
    this.updateDocBar();
    return this.docbar;
  }

  updateDocBar() {
    if (!this.saveBtn || !this.fc) return;
    const ownedByMe = this.isOwnedByCurrentUser(this.fc);
    this.saveBtn.disabled = !ownedByMe;
    this.saveBtn.classList.toggle('dirty', this.dirty && ownedByMe);
    this.resetBtn.disabled = !this.dirty;
    const status = !ownedByMe
      ? `🔒 Owned by ${ownerLabel(this.fc.creatorUsername, this.fc.creatorId)}: use Save as…`
      : this.dirty ? '● Unsaved changes: press Save (Ctrl+S)' : '✓ All changes saved';
    this.saveBtn.dataset.tip = `Save\n${status}`;
    if (this.approveBtn) {
      const st = this.fc.status || 'draft';
      this.approveBtn.className = `btn small fc-status-btn status-${st}`;
      this.approveBtn.textContent = st === 'approved' ? '✓ Approved' : st === 'in_review' ? '⏳ In Review' : '✎ Draft · Approve';
    }
    this.refreshBack();
  }

  async toggleApproval() {
    if (!this.fc) return;
    if (this.fc.status === 'approved') {
      const choice = await choiceBox(
        `FlowChart "${this.fc.name}" is Approved`,
        'Switch back to Draft to revise the design, or materialize visual UI Screens right now?',
        [
          { label: 'Close', value: 'cancel' },
          { label: 'Revert to Draft', value: 'draft' },
          { label: '🎨 Materialize UI Screens & Workflow', value: 'materialize', kind: 'primary' }
        ]
      );
      if (choice === 'draft') {
        this.pushUndo();
        this.fc.status = 'draft';
        this.checkDirty();
        await this.save();
      } else if (choice === 'materialize') {
        this.openMaterializeModal();
      }
      return;
    }

    const report = validateFlowchart(this.fc);
    if (!report.valid) {
      toast(`Fix ${report.errors.length} validation error(s) before approving`, 'error');
      this.openValidationModal();
      return;
    }
    const note = await promptBox('Approve FlowChart for AI Coding & UI Design', {
      value: this.fc.approvalNote || 'Approved by user. Ready for UI screen design and backend implementation.',
      label: 'Approval / Implementation Note for AI Coder',
      okLabel: '✓ Approve & Save'
    });
    if (note === null) return;
    this.pushUndo();
    this.fc.status = 'approved';
    this.fc.approvalNote = note.trim();
    this.checkDirty();
    await this.save();
    toast(`"${this.fc.name}" is now APPROVED — AI coders can materialize UIs and build the backend`, 'ok', 4200);
  }

  render() {
    clear(this.root);
    this.root.classList.add('fc-designer');
    if (!this.fc) {
      this.root.append(h('div', { class: 'empty', style: { margin: 'auto' } },
        h('h3', {}, 'Conceptual FlowChart Designer'),
        h('p', { class: 'muted' }, 'Create or select a FlowChart from the left panel or top menu bar to design screens, backend steps, decisions, and access levels.'),
        h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center', marginTop: '12px' } },
          h('button', { class: 'btn primary', onclick: () => openNewFlowchartModal({ onCreated: fc => this.app.openFlowchart(fc.id) }) }, '+ New FlowChart'),
          h('button', { class: 'btn', onclick: () => openReverseEngineerModal({ onCreated: fc => this.app.openFlowchart(fc.id) }) }, '⚡ Reverse Engineer App')
        )
      ));
      return;
    }

    const fc = this.fc;
    const switcher = buildDesignerSwitchDropdown('flowchart', t => window.dispatchEvent(new CustomEvent('ud:open-page', { detail: { type: t } })));

    const nameIn = h('input', {
      class: 'doc-title fc-title-input',
      type: 'text',
      value: fc.name,
      title: `Click to rename · key: ${fc.key}`,
      'aria-label': 'FlowChart name',
      spellcheck: 'false'
    });
    nameIn.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); }
      if (e.key === 'Escape') { nameIn.value = this.fc.name; nameIn.blur(); }
    });
    nameIn.addEventListener('blur', () => {
      const v = nameIn.value.trim();
      if (!v || v === this.fc.name) { nameIn.value = this.fc.name; return; }
      this.pushUndo();
      this.fc.name = v;
      this.fc.label = v;
      this.checkDirty();
      this.renderInspector();
    });

    const domainSel = h('select', {
      class: 'fc-toolbar-select',
      title: 'FlowChart target domain (Frontend, Backend, Full-Stack, Business Logic, Auth/ACL)',
      onchange: () => {
        this.pushUndo();
        this.fc.domain = domainSel.value;
        this.checkDirty();
        this.renderInspector();
      }
    }, FLOWCHART_DOMAINS.map(d => h('option', { value: d.key, selected: d.key === fc.domain }, d.badge)));

    const descBtn = h('button', {
      type: 'button',
      class: 'btn small',
      title: 'Edit FlowChart description & sign-off details',
      onclick: () => openEditFlowchartMetaModal(this.fc, { onSaved: updated => { this.fc = { ...this.fc, ...updated }; this.markBaseline(); this.render(); } })
    }, '📝 Description');

    const addScreenBtn = h('button', {
      type: 'button',
      class: 'btn small fc-add-btn kind-screen',
      dataset: { act: 'fc-add-screen' },
      title: 'Add a Conceptual Screen node (with Home input + Menu/Action output sockets + Role settings)',
      onclick: () => this.addNodeOfKind('screen')
    }, '+ Screen');
    const addStepBtn = h('button', {
      type: 'button',
      class: 'btn small fc-add-btn kind-step',
      dataset: { act: 'fc-add-step' },
      title: 'Add a Step / Backend API / Business Logic node',
      onclick: () => this.addNodeOfKind('step')
    }, '+ Step');
    const addDecisionBtn = h('button', {
      type: 'button',
      class: 'btn small fc-add-btn kind-decision',
      dataset: { act: 'fc-add-decision' },
      title: 'Add a Decision / Multi-Scenario Router node',
      onclick: () => this.addNodeOfKind('decision')
    }, '+ ◇ Decision');
    const addMoreNodesSel = h('select', {
      class: 'fc-toolbar-select',
      title: 'Add Trigger, Sub-Flowchart, or End node',
      onchange: () => {
        if (!addMoreNodesSel.value) return;
        this.addNodeOfKind(addMoreNodesSel.value);
        addMoreNodesSel.value = '';
      }
    },
      h('option', { value: '' }, '+ More…'),
      h('option', { value: 'trigger' }, '⚡ Trigger / Entry Node'),
      h('option', { value: 'subflow' }, '🔗 Sub-Flowchart Node'),
      h('option', { value: 'end' }, '⏹ End / Terminal Node')
    );

    const roleSel = h('select', {
      class: 'fc-toolbar-select fc-role-select',
      dataset: { act: 'fc-role-preview' },
      title: 'Preview FlowChart for a specific Access Level / User Role (highlights role-specific screen features and restricted branches)',
      onchange: () => {
        this.rolePreview = roleSel.value;
        this.rebuildCanvas();
        this.renderInspector();
      }
    },
      h('option', { value: 'all', selected: this.rolePreview === 'all' }, '👁 Role: All (Master)'),
      ...(fc.accessLevels || DEFAULT_ACCESS_LEVELS).map(r =>
        h('option', { value: r.key, selected: this.rolePreview === r.key }, `👁 @${r.key} (${r.name})`)
      )
    );
    const rolesCfgBtn = h('button', {
      type: 'button',
      class: 'btn small',
      title: 'Configure project/flowchart Access Levels & Roles',
      onclick: () => this.openRolesModal()
    }, '⚙ Roles');

    const styleSel = h('select', {
      class: 'fc-toolbar-select',
      title: 'Default connection wire curve style',
      onchange: () => { this.edgeStyle = styleSel.value; }
    }, EDGE_STYLES.map(s => h('option', { value: s, selected: s === this.edgeStyle }, `${s} wires`)));

    this.zoomLabel = h('span', { class: 'muted', style: { minWidth: '44px', textAlign: 'center' } }, `${Math.round(this.zoom * 100)}%`);

    const bar = h('div', { class: 'dz-bar fc-bar', role: 'toolbar', 'aria-label': 'FlowChart tools' },
      switcher,
      nameIn,
      domainSel,
      descBtn,
      h('span', { class: 'sep-v' }),
      ibtn('undo', 'Undo', () => this.undo(), { kbd: 'Ctrl+Z' }),
      ibtn('redo', 'Redo', () => this.redo(), { kbd: 'Ctrl+Y' }),
      ibtn('copy', 'Duplicate node', () => this.duplicateSelected(), { kbd: 'Ctrl+D' }),
      ibtn('trash', 'Delete selected', () => this.deleteSelected(), { kbd: 'Del' }),
      h('span', { class: 'sep-v' }),
      addScreenBtn, addStepBtn, addDecisionBtn, addMoreNodesSel,
      h('span', { class: 'sep-v' }),
      roleSel, rolesCfgBtn,
      h('span', { class: 'sep-v' }),
      styleSel,
      ibtn('grid', 'Auto Layout (DAG)', () => this.autoLayout(), { desc: 'Arrange nodes cleanly left → right along flow connections' }),
      ibtn('check', 'Validate FlowChart', () => this.openValidationModal(), { desc: 'Check for orphan nodes, missing transition descriptions, or unconnected decision branches' }),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { act: 'fc-ai-studio' },
        title: '✨ AI Studio — Generate or expand FlowCharts & build visual UI Screens at runtime in your browser',
        onclick: () => this.app.openAiStudio?.({ tab: 'flowchart' })
      }, '✨ AI Studio'),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { act: 'fc-reverse-eng' },
        title: 'Reverse-engineer existing Screens/Workflows or external App Specs into FlowCharts',
        onclick: () => openReverseEngineerModal({ onCreated: created => this.app.openFlowchart(created.id) })
      }, '⚡ Reverse Eng.'),
      h('button', {
        type: 'button',
        class: 'btn small',
        dataset: { act: 'fc-materialize' },
        title: 'Materialize conceptual Screen nodes into visual Screen designs & Workflow routes for AI/UI building',
        onclick: () => this.openMaterializeModal()
      }, '🎨 Build UIs'),
      h('button', {
        type: 'button',
        class: 'btn small primary',
        dataset: { act: 'fc-export-def' },
        title: 'Export full project-definition.md & JSON documentation for AI coders',
        onclick: () => openProjectDefinitionModal()
      }, '📄 Project Spec'),
      h('span', { class: 'grow' }),
      ibtn('zoomOut', 'Zoom out', () => this.zoomBy(1 / 1.2)),
      this.zoomLabel,
      ibtn('zoomIn', 'Zoom in', () => this.zoomBy(1.2)),
      ibtn('fit', 'Fit to window', () => this.fit(), { kbd: '0' }),
      ibtn('arrowUp', 'Collapse all', () => this.collapseAll(true)),
      ibtn('arrowDown', 'Expand all', () => this.collapseAll(false)),
      ibtn('inspector', 'Inspector', () => {
        this.inspectorOpen = !this.inspectorOpen;
        this.inspectorEl?.classList.toggle('collapsed', !this.inspectorOpen);
      }, { active: this.inspectorOpen })
    );

    const oldDoc = this.docbar, oldBar = this.toolbar;
    const docbar = this.buildDocBar();
    this.toolbar = bar;
    const inRow = el => el?.isConnected && el.closest('#typebar');
    if (inRow(oldDoc)) oldDoc.replaceWith(docbar);
    if (inRow(oldBar)) oldBar.replaceWith(bar);
    if (!docbar.isConnected) this.root.append(docbar);
    if (!bar.isConnected) this.root.append(bar);

    this.svgLayer = document.createElementNS(NS, 'svg');
    this.svgLayer.setAttribute('class', 'fc-svg');
    this.nodesLayer = h('div', { class: 'fc-nodes-layer' });
    this.badgesLayer = h('div', { class: 'fc-badges-layer' });
    this.world = h('div', { class: 'fc-world' }, this.svgLayer, this.nodesLayer, this.badgesLayer);

    this.roleBanner = h('div', { class: 'fc-role-banner', hidden: true });
    const hintBanner = h('div', { class: 'fc-canvas-hint' },
      'Drag from any right ◉ port to a target ◉ Home port (or drop on empty canvas to quick-create) · Click 📝 over any wire to define transition flow or ◇ to split into a Decision node · Right-click canvas for node menu'
    );
    this.viewport = h('div', { class: 'fc-viewport', tabindex: '0', 'aria-label': 'FlowChart ComfyUI Canvas' },
      this.roleBanner,
      hintBanner,
      this.world
    );
    this.inspectorEl = h('aside', { class: `dz-inspector fc-inspector${this.inspectorOpen ? '' : ' collapsed'}` });

    this.root.append(h('div', { class: 'dz-body fc-body' }, this.viewport, this.inspectorEl));
    this.bindViewportEvents();
    this.rebuildCanvas();
    this.applyView();
    this.renderInspector();
    emit('topbar:refresh');
  }

  applyView() {
    if (!this.world) return;
    this.world.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    if (this.zoomLabel) this.zoomLabel.textContent = `${Math.round(this.zoom * 100)}%`;
    if (this.viewport) {
      const step = Math.max(12, Math.round(28 * this.zoom));
      this.viewport.style.backgroundSize = `${step}px ${step}px`;
      this.viewport.style.backgroundPosition = `${this.pan.x}px ${this.pan.y}px`;
    }
  }

  worldPoint(ev) {
    const r = this.viewport.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - this.pan.x) / this.zoom,
      y: (ev.clientY - r.top - this.pan.y) / this.zoom
    };
  }

  zoomBy(factor, cx, cy) {
    if (!this.viewport) return;
    const r = this.viewport.getBoundingClientRect();
    cx = cx ?? r.width / 2;
    cy = cy ?? r.height / 2;
    const nz = Math.min(2.6, Math.max(0.18, this.zoom * factor));
    this.pan.x = cx - (cx - this.pan.x) * (nz / this.zoom);
    this.pan.y = cy - (cy - this.pan.y) * (nz / this.zoom);
    this.zoom = nz;
    this.applyView();
  }

  fit() {
    if (!this.viewport || !this.fc?.nodes?.length) return;
    const r = this.viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of this.fc.nodes) {
      const el = this.nodeEls.get(n.nodeKey);
      const w = n.width || 300;
      const hgt = el ? el.offsetHeight : (n.collapsed ? 64 : 230);
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + w);
      y1 = Math.max(y1, n.y + hgt);
    }
    const bw = Math.max(320, x1 - x0);
    const bh = Math.max(240, y1 - y0);
    this.zoom = Math.min(1.15, Math.max(0.22, Math.min((r.width - 120) / bw, (r.height - 120) / bh)));
    this.pan.x = Math.round((r.width - bw * this.zoom) / 2 - x0 * this.zoom);
    this.pan.y = Math.round((r.height - bh * this.zoom) / 2 - y0 * this.zoom);
    this.applyView();
    this.drawEdges();
  }

  collapseAll(collapsed) {
    if (!this.fc?.nodes?.length) return;
    this.pushUndo();
    for (const n of this.fc.nodes) n.collapsed = Boolean(collapsed);
    this.checkDirty();
    this.rebuildCanvas();
  }

  autoLayout(direction = 'LR') {
    if (!this.fc?.nodes?.length) return;
    this.pushUndo();
    this.fc.nodes = autoLayoutFlowchart(this.fc.nodes, this.fc.edges, {
      direction,
      startNodeKey: this.fc.startNodeKey
    });
    this.checkDirty();
    this.rebuildCanvas();
    requestAnimationFrame(() => this.fit());
  }

  addNodeOfKind(kind = 'screen', { at = null, connectFrom = null } = {}) {
    if (!this.fc) return null;
    this.pushUndo();
    const center = at || (() => {
      const r = this.viewport?.getBoundingClientRect() || { width: 900, height: 600 };
      return {
        x: Math.round((r.width / 2 - this.pan.x) / this.zoom - 140 + (Math.random() * 40 - 20)),
        y: Math.round((r.height / 2 - this.pan.y) / this.zoom - 90 + (Math.random() * 40 - 20))
      };
    })();
    const keys = new Set(this.fc.nodes.map(n => n.nodeKey));
    const node = normalizeFlowchartNode({
      kind,
      title: kind === 'screen' ? `Screen ${this.fc.nodes.filter(n => n.kind === 'screen').length + 1}`
        : kind === 'step' ? `Action Step ${this.fc.nodes.filter(n => n.kind === 'step').length + 1}`
        : kind === 'decision' ? `Decision ${this.fc.nodes.filter(n => n.kind === 'decision').length + 1}`
        : kind === 'trigger' ? 'Flow Trigger'
        : kind === 'subflow' ? 'Sub-Flow Call'
        : 'Flow Complete',
      x: center.x,
      y: center.y
    }, keys, this.fc.nodes.length);
    this.fc.nodes.push(node);
    if (!this.fc.startNodeKey) this.fc.startNodeKey = node.nodeKey;

    let createdEdge = null;
    if (connectFrom?.fromNodeKey && node.hasHomeInput) {
      const edgeKeys = new Set(this.fc.edges.map(e => e.edgeKey));
      createdEdge = normalizeFlowchartEdge({
        fromNodeKey: connectFrom.fromNodeKey,
        fromPortKey: connectFrom.fromPortKey,
        toNodeKey: node.nodeKey,
        toPortKey: HOME_PORT_KEY,
        style: this.edgeStyle,
        label: connectFrom.label || '',
        transitionText: connectFrom.transitionText || ''
      }, edgeKeys, this.fc.edges.length);
      this.fc.edges.push(createdEdge);
    }

    this.sel = { kind: 'node', nodeKey: node.nodeKey };
    this.checkDirty();
    this.rebuildCanvas();
    this.renderInspector();
    if (createdEdge) {
      this.openEdgeFlowModal(createdEdge.edgeKey, { isNew: true });
    }
    return node;
  }

  duplicateSelected() {
    if (!this.fc || this.sel?.kind !== 'node') return toast('Select a node to duplicate');
    const src = this.fc.nodes.find(n => n.nodeKey === this.sel.nodeKey);
    if (!src) return;
    this.pushUndo();
    const keys = new Set(this.fc.nodes.map(n => n.nodeKey));
    const copy = normalizeFlowchartNode({
      ...cloneDeep(src),
      nodeKey: `${src.nodeKey}-copy`,
      title: `${src.title} Copy`,
      x: src.x + 48,
      y: src.y + 48,
      linkedScreenId: null
    }, keys, this.fc.nodes.length);
    this.fc.nodes.push(copy);
    this.sel = { kind: 'node', nodeKey: copy.nodeKey };
    this.checkDirty();
    this.rebuildCanvas();
    this.renderInspector();
  }

  deleteSelected() {
    if (!this.fc || !this.sel) return;
    this.pushUndo();
    if (this.sel.kind === 'node') {
      const k = this.sel.nodeKey;
      const n = this.fc.nodes.find(x => x.nodeKey === k);
      if (n?.locked) return toast(`"${n.title}" is locked`, 'error');
      this.fc.nodes = this.fc.nodes.filter(x => x.nodeKey !== k);
      this.fc.edges = this.fc.edges.filter(e => e.fromNodeKey !== k && e.toNodeKey !== k);
      if (this.fc.startNodeKey === k) this.fc.startNodeKey = this.fc.nodes[0]?.nodeKey || null;
    } else if (this.sel.kind === 'edge') {
      this.fc.edges = this.fc.edges.filter(e => e.edgeKey !== this.sel.edgeKey);
    }
    this.sel = null;
    this.checkDirty();
    this.rebuildCanvas();
    this.renderInspector();
  }

  selectItem(sel) {
    this.sel = sel;
    for (const [k, el] of this.nodeEls) {
      el.classList.toggle('selected', sel?.kind === 'node' && sel.nodeKey === k);
    }
    this.drawEdges();
    this.renderInspector();
  }

  rebuildCanvas() {
    if (!this.nodesLayer || !this.fc) return;
    clear(this.nodesLayer);
    this.nodeEls.clear();

    // Role banner at top of viewport when previewing a specific access level
    if (this.roleBanner) {
      if (this.rolePreview && this.rolePreview !== 'all') {
        const roleObj = (this.fc.accessLevels || DEFAULT_ACCESS_LEVELS).find(r => r.key === this.rolePreview);
        this.roleBanner.hidden = false;
        clear(this.roleBanner);
        this.roleBanner.append(
          h('span', { class: 'fc-role-dot', style: { background: roleObj?.color || '#2e9bff' } }),
          h('b', {}, `Role Preview: @${this.rolePreview}${roleObj ? ` (${roleObj.name})` : ''}`),
          h('span', { class: 'muted' }, roleObj?.description || 'Showing role-specific features and access gates.'),
          h('button', { class: 'btn small', onclick: () => { this.rolePreview = 'all'; this.render(); } }, 'Show All Roles')
        );
      } else {
        this.roleBanner.hidden = true;
      }
    }

    for (const node of this.fc.nodes) {
      const card = this.buildNodeCard(node);
      this.nodeEls.set(node.nodeKey, card);
      this.nodesLayer.append(card);
    }
    requestAnimationFrame(() => this.drawEdges());
  }

  buildNodeCard(node) {
    const meta = KIND_META.get(node.kind) || KIND_META.get('screen');
    const isStart = this.fc.startNodeKey === node.nodeKey;
    const isSelected = this.sel?.kind === 'node' && this.sel.nodeKey === node.nodeKey;
    const roleEval = resolveNodeForRole(node, this.rolePreview);
    const dimmedByRole = this.rolePreview !== 'all' && !roleEval.accessible;

    const titleInput = h('input', {
      type: 'text',
      class: 'fc-node-title-input',
      value: node.title,
      title: `Node key: ${node.nodeKey}`,
      onpointerdown: e => e.stopPropagation(),
      onkeydown: e => {
        e.stopPropagation();
        if (e.key === 'Enter') e.target.blur();
      },
      onchange: e => {
        const v = e.target.value.trim();
        if (!v || v === node.title) { e.target.value = node.title; return; }
        this.pushUndo();
        node.title = v;
        this.checkDirty();
        this.renderInspector();
      }
    });

    const header = h('div', {
      class: 'fc-node-header',
      style: { '--fc-accent': meta.color }
    },
      h('span', { class: 'fc-kind-pill' }, node.kind === 'decision' ? '◇ DECISION' : node.kind.toUpperCase()),
      titleInput,
      h('button', {
        type: 'button',
        class: `fc-hdr-btn${isStart ? ' on' : ''}`,
        title: isStart ? 'Start / Entry node of this FlowChart' : 'Set as Start / Entry node',
        onpointerdown: e => e.stopPropagation(),
        onclick: e => {
          e.stopPropagation();
          this.pushUndo();
          this.fc.startNodeKey = node.nodeKey;
          this.checkDirty();
          this.rebuildCanvas();
          this.renderInspector();
        }
      }, isStart ? '★' : '☆'),
      h('button', {
        type: 'button',
        class: 'fc-hdr-btn',
        title: node.collapsed ? 'Expand node' : 'Collapse node',
        onpointerdown: e => e.stopPropagation(),
        onclick: e => {
          e.stopPropagation();
          node.collapsed = !node.collapsed;
          this.checkDirty();
          this.rebuildCanvas();
        }
      }, node.collapsed ? '▾' : '▴')
    );

    // Home input socket row (every connectable node has a Home input node!)
    const homeRow = node.hasHomeInput
      ? h('div', { class: 'fc-home-row', dataset: { fcTargetNode: node.nodeKey } },
          h('span', {
            class: 'fc-socket fc-socket-in',
            dataset: { fcIn: HOME_PORT_KEY, fcNode: node.nodeKey },
            title: 'Home Input Node — drop incoming connection wires here'
          }),
          h('span', { class: 'fc-home-label' }, 'Home (In)'),
          node.subtype ? h('span', { class: 'fc-subtype-chip' }, node.subtype) : null,
          roleEval.restricted
            ? h('span', { class: 'fc-role-badge', title: `Allowed roles: ${node.roleSettings.allowedRoles.join(', ')}` },
                `🔒 ${node.roleSettings.allowedRoles.join(', ')}`)
            : null
        )
      : h('div', { class: 'fc-home-row fc-trigger-row' },
          h('span', { class: 'fc-subtype-chip' }, `⚡ ${node.subtype || 'trigger'}`),
          roleEval.restricted
            ? h('span', { class: 'fc-role-badge' }, `🔒 ${node.roleSettings.allowedRoles.join(', ')}`)
            : null
        );

    // Body: inline ComfyUI textual definition textbox + technical/screen pills + role variant banner
    const bodyChildren = [];
    if (!node.collapsed) {
      if (dimmedByRole) {
        bodyChildren.push(h('div', { class: 'fc-role-denied-note' },
          `🚫 Denied for @${this.rolePreview} → ${roleEval.deniedBehavior}${node.roleSettings?.redirectNodeKey ? ` (${node.roleSettings.redirectNodeKey})` : ''}`
        ));
      } else if (this.rolePreview !== 'all' && roleEval.variant) {
        bodyChildren.push(h('div', { class: 'fc-role-variant-note' },
          h('b', {}, `@${this.rolePreview} view: `),
          roleEval.effectiveDescription
        ));
      }

      const descBox = h('textarea', {
        class: 'fc-node-textarea',
        rows: node.kind === 'decision' ? 2 : 3,
        value: node.description || '',
        placeholder: node.kind === 'screen'
          ? 'Textual screen definition: what user sees, data shown, states & interactions…'
          : node.kind === 'decision'
            ? 'Condition / scenario evaluation logic…'
            : 'Step / backend action logic: validations, API/DB operations, side effects…',
        onpointerdown: e => e.stopPropagation(),
        onwheel: e => e.stopPropagation(),
        onkeydown: e => e.stopPropagation(),
        onfocus: () => { if (this.sel?.nodeKey !== node.nodeKey) this.selectItem({ kind: 'node', nodeKey: node.nodeKey }); },
        onchange: e => {
          this.pushUndo();
          node.description = e.target.value;
          this.checkDirty();
          if (this.sel?.nodeKey === node.nodeKey) this.renderInspector();
        }
      });
      bodyChildren.push(descBox);

      // Technical badge or Linked Visual Screen button
      const metaPills = [];
      if (node.techSpec?.method || node.techSpec?.endpoint) {
        metaPills.push(h('span', { class: 'fc-tech-pill' }, `${node.techSpec.method || 'API'} ${node.techSpec.endpoint || ''}`.trim()));
      }
      if (node.techSpec?.dbTables?.length) {
        metaPills.push(h('span', { class: 'fc-tech-pill' }, `🗄 ${node.techSpec.dbTables.join(', ')}`));
      }
      const variantCount = Object.keys(node.roleSettings?.variants || {}).length;
      if (variantCount > 0) {
        metaPills.push(h('span', { class: 'fc-tech-pill fc-role-count-pill', title: 'Per-access-level feature variants configured on this node' }, `👥 ${variantCount} role variant(s)`));
      }
      if (node.kind === 'screen') {
        if (node.linkedScreenId) {
          metaPills.push(h('button', {
            type: 'button',
            class: 'fc-link-screen-btn',
            title: 'Open the linked visual UI Screen in Screen Designer',
            onpointerdown: e => e.stopPropagation(),
            onclick: e => {
              e.stopPropagation();
              this.app.openDesign('screen', node.linkedScreenId);
            }
          }, '🖥 Open UI Screen ↗'));
        }
        metaPills.push(h('button', {
          type: 'button',
          class: 'fc-link-screen-btn fc-ai-screen-btn',
          title: 'Generate visual UI layout for this conceptual screen in your browser via AI Studio',
          onpointerdown: e => e.stopPropagation(),
          onclick: e => {
            e.stopPropagation();
            this.app.openAiStudio?.({ tab: 'flowchart', fcMode: 'design-screens', fcNodeKey: node.nodeKey });
          }
        }, '✨ AI UI'));
      }
      if (metaPills.length) bodyChildren.push(h('div', { class: 'fc-meta-pills' }, metaPills));
    }

    // Output Ports (Menu items, Buttons, Sub-actions, Decision scenarios)
    const portsWrap = h('div', { class: 'fc-ports-list' });
    for (const port of node.ports || []) {
      const portRestricted = this.rolePreview !== 'all' && port.allowedRoles?.length && !port.allowedRoles.includes(this.rolePreview);
      const portRow = h('div', { class: `fc-port-row${portRestricted ? ' restricted' : ''}` },
        h('span', { class: `fc-port-kind kind-${port.kind || 'action'}` }, port.kind === 'case' ? '◇' : port.kind === 'menu-item' ? '☰' : '▸'),
        h('input', {
          type: 'text',
          class: 'fc-port-input',
          value: port.label,
          title: port.description ? `${port.label}: ${port.description}` : `Output port "${port.key}" — drag ◉ to connect`,
          onpointerdown: e => e.stopPropagation(),
          onkeydown: e => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); },
          onchange: e => {
            const v = e.target.value.trim();
            if (!v) { e.target.value = port.label; return; }
            this.pushUndo();
            port.label = v;
            this.checkDirty();
            this.drawEdges();
            if (this.sel?.nodeKey === node.nodeKey) this.renderInspector();
          }
        }),
        port.allowedRoles?.length ? h('span', { class: 'fc-port-role-tag', title: `Roles: ${port.allowedRoles.join(', ')}` }, `🔒${port.allowedRoles.length}`) : null,
        h('span', {
          class: 'fc-socket fc-socket-out',
          dataset: { fcOut: port.key, fcNode: node.nodeKey },
          title: `Drag from "${port.label}" to connect to a Screen, Step, or Decision Home node`,
          onpointerdown: ev => this.startWireDrag(ev, node.nodeKey, port.key)
        })
      );
      portsWrap.append(portRow);
    }

    const footer = !node.collapsed && node.kind !== 'end'
      ? h('div', { class: 'fc-node-footer' },
          h('button', {
            type: 'button',
            class: 'fc-add-port-btn',
            onpointerdown: e => e.stopPropagation(),
            onclick: e => {
              e.stopPropagation();
              this.pushUndo();
              const pKeys = new Set((node.ports || []).map(p => p.key));
              const defaultKind = node.kind === 'decision' ? 'case' : node.kind === 'screen' ? 'menu-item' : 'action';
              const defaultLabel = node.kind === 'decision'
                ? `Case ${(node.ports?.length || 0) + 1}`
                : node.kind === 'screen'
                  ? `Menu Item ${(node.ports?.length || 0) + 1}`
                  : `Sub-Action ${(node.ports?.length || 0) + 1}`;
              node.ports.push(normalizePort({ label: defaultLabel, kind: defaultKind }, node.ports.length, pKeys, defaultKind));
              this.checkDirty();
              this.rebuildCanvas();
              this.selectItem({ kind: 'node', nodeKey: node.nodeKey });
            }
          }, node.kind === 'decision' ? '+ Add Scenario / Case' : node.kind === 'screen' ? '+ Add Menu / Action Node' : '+ Add Output Branch')
        )
      : null;

    const card = h('div', {
      class: `fc-node kind-${node.kind}${isSelected ? ' selected' : ''}${dimmedByRole ? ' role-dimmed' : ''}${node.collapsed ? ' collapsed' : ''}`,
      dataset: { nodeKey: node.nodeKey },
      style: {
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${node.width || meta.defaultWidth}px`,
        '--fc-accent': meta.color
      },
      onpointerdown: ev => this.onNodePointerDown(ev, node),
      oncontextmenu: ev => {
        ev.preventDefault();
        ev.stopPropagation();
        this.selectItem({ kind: 'node', nodeKey: node.nodeKey });
        contextMenu(ev.clientX, ev.clientY, [
          { label: `★ Set "${node.title}" as Start Node`, fn: () => { this.pushUndo(); this.fc.startNodeKey = node.nodeKey; this.checkDirty(); this.rebuildCanvas(); } },
          { label: '⧉ Duplicate Node', kbd: 'Ctrl+D', fn: () => this.duplicateSelected() },
          { label: node.locked ? '🔓 Unlock Node Position' : '🔒 Lock Node Position', fn: () => { node.locked = !node.locked; this.checkDirty(); this.renderInspector(); } },
          '-',
          { label: '🗑 Delete Node', kbd: 'Del', fn: () => this.deleteSelected() }
        ]);
      }
    }, header, homeRow, bodyChildren.length ? h('div', { class: 'fc-node-body' }, bodyChildren) : null, portsWrap, footer);

    return card;
  }

  /** Computes exact world-space center of an input (`home`) or output (`portKey`) socket pin. */
  socketWorldCenter(nodeKey, dir, portKey = HOME_PORT_KEY) {
    const card = this.nodeEls.get(nodeKey);
    const node = this.fc?.nodes?.find(n => n.nodeKey === nodeKey);
    if (!node) return { x: 0, y: 0 };
    if (card && this.world) {
      const sel = dir === 'in' ? `[data-fc-in="${portKey}"]` : `[data-fc-out="${portKey}"]`;
      const pin = card.querySelector(sel);
      if (pin) {
        const wr = this.world.getBoundingClientRect();
        const pr = pin.getBoundingClientRect();
        if (wr.width > 0 && pr.width > 0) {
          return {
            x: (pr.left + pr.width / 2 - wr.left) / this.zoom,
            y: (pr.top + pr.height / 2 - wr.top) / this.zoom
          };
        }
      }
    }
    // Fallback geometric coordinates (e.g. headless / collapsed / zero-layout)
    const w = node.width || 300;
    if (dir === 'in') return { x: node.x, y: node.y + 46 };
    const pIdx = Math.max(0, (node.ports || []).findIndex(p => p.key === portKey));
    return { x: node.x + w, y: node.y + (node.collapsed ? 46 : 168 + pIdx * 32) };
  }

  curveData(p1, p2, style = 'bezier') {
    if (style === 'straight') {
      return {
        d: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
      };
    }
    if (style === 'orthogonal') {
      const mx = Math.round((p1.x + p2.x) / 2);
      return {
        d: `M ${p1.x} ${p1.y} L ${mx} ${p1.y} L ${mx} ${p2.y} L ${p2.x} ${p2.y}`,
        mid: { x: mx, y: (p1.y + p2.y) / 2 }
      };
    }
    const dx = Math.max(72, Math.min(280, Math.abs(p2.x - p1.x) * 0.52));
    const c1 = { x: p1.x + dx, y: p1.y };
    const c2 = { x: p2.x - dx, y: p2.y };
    // Exact t=0.5 point on cubic Bezier
    const mid = {
      x: 0.125 * p1.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * p2.x,
      y: 0.125 * p1.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * p2.y
    };
    return {
      d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`,
      mid
    };
  }

  drawEdges() {
    if (!this.svgLayer || !this.badgesLayer || !this.fc) return;
    this.svgLayer.innerHTML = `<defs>
      <marker id="fc-arr" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 1L11 6L0 11z" fill="#58a6ff"/>
      </marker>
      <marker id="fc-arr-sel" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M0 1L11 6L0 11z" fill="#fbbf24"/>
      </marker>
      <marker id="fc-arr-dim" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0 1L11 6L0 11z" fill="#64748b"/>
      </marker>
    </defs>`;
    clear(this.badgesLayer);

    const byKey = new Map(this.fc.nodes.map(n => [n.nodeKey, n]));
    for (const edge of this.fc.edges) {
      if (!byKey.has(edge.fromNodeKey) || !byKey.has(edge.toNodeKey)) continue;
      const p1 = this.socketWorldCenter(edge.fromNodeKey, 'out', edge.fromPortKey);
      const p2 = this.socketWorldCenter(edge.toNodeKey, 'in', edge.toPortKey || HOME_PORT_KEY);
      const { d, mid } = this.curveData(p1, p2, edge.style || 'bezier');
      const selected = this.sel?.kind === 'edge' && this.sel.edgeKey === edge.edgeKey;
      const allowed = isEdgeAllowedForRole(edge, this.rolePreview, byKey);
      const srcKind = byKey.get(edge.fromNodeKey)?.kind || 'screen';
      const strokeColor = selected ? '#fbbf24' : !allowed ? '#64748b' : (KIND_META.get(srcKind)?.color || '#58a6ff');

      // Wide transparent hit path for easy clicking
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('class', 'fc-edge-hit');
      hit.addEventListener('pointerdown', ev => { ev.stopPropagation(); this.selectItem({ kind: 'edge', edgeKey: edge.edgeKey }); });
      hit.addEventListener('dblclick', ev => { ev.stopPropagation(); this.openEdgeFlowModal(edge.edgeKey); });

      const wire = document.createElementNS(NS, 'path');
      wire.setAttribute('d', d);
      wire.setAttribute('class', `fc-edge-wire${selected ? ' selected' : ''}${!allowed ? ' dimmed' : ''}`);
      wire.setAttribute('stroke', strokeColor);
      wire.setAttribute('marker-end', selected ? 'url(#fc-arr-sel)' : !allowed ? 'url(#fc-arr-dim)' : 'url(#fc-arr)');
      this.svgLayer.append(hit, wire);

      // Interactive icon badge right over the midpoint of the connection line!
      const hasSpec = Boolean((edge.transitionText || '').trim());
      const snippet = edge.label || (hasSpec ? edge.transitionText.trim().split(/\r?\n/)[0].slice(0, 26) : '');
      const badge = h('div', {
        class: `fc-edge-badge${selected ? ' selected' : ''}${hasSpec ? ' has-spec' : ''}${!allowed ? ' dimmed' : ''}`,
        style: { left: `${Math.round(mid.x)}px`, top: `${Math.round(mid.y)}px` },
        dataset: { edgeKey: edge.edgeKey },
        onpointerdown: ev => ev.stopPropagation()
      },
        h('button', {
          type: 'button',
          class: 'fc-edge-spec-btn',
          title: hasSpec
            ? `Transition Flow: ${edge.transitionText}\n(Click to edit textual transition definition)`
            : 'Click to define what happens through this transition while moving to the next node',
          onclick: ev => {
            ev.stopPropagation();
            this.selectItem({ kind: 'edge', edgeKey: edge.edgeKey });
            this.openEdgeFlowModal(edge.edgeKey);
          }
        },
          h('span', { class: 'fc-edge-ico' }, hasSpec ? '📝' : '💬'),
          snippet ? h('span', { class: 'fc-edge-lbl' }, snippet) : null
        ),
        h('button', {
          type: 'button',
          class: 'fc-edge-split-btn',
          title: 'Multiple scenarios or cases on this connection? Click to insert a ◇ Decision Node here!',
          onclick: ev => {
            ev.stopPropagation();
            this.selectItem({ kind: 'edge', edgeKey: edge.edgeKey });
            this.openInsertDecisionModal(edge.edgeKey);
          }
        }, '◇')
      );
      this.badgesLayer.append(badge);
    }

    // Live wire preview while dragging from an output port
    if (this.drag?.mode === 'wire') {
      const { d } = this.curveData(this.drag.startPt, this.drag.curPt, this.edgeStyle);
      const temp = document.createElementNS(NS, 'path');
      temp.setAttribute('d', d);
      temp.setAttribute('class', 'fc-edge-preview');
      this.svgLayer.append(temp);
    }
  }

  bindViewportEvents() {
    const vp = this.viewport;
    vp.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = vp.getBoundingClientRect();
      this.zoomBy(ev.deltaY < 0 ? 1.12 : 1 / 1.12, ev.clientX - r.left, ev.clientY - r.top);
    }, { passive: false });

    vp.addEventListener('contextmenu', ev => {
      if (ev.target.closest('.fc-node, .fc-edge-badge')) return;
      ev.preventDefault();
      const pt = this.worldPoint(ev);
      contextMenu(ev.clientX, ev.clientY, [
        { label: '🖥 + Add Screen Node here', fn: () => this.addNodeOfKind('screen', { at: pt }) },
        { label: '⚙ + Add Step / Backend Logic Node here', fn: () => this.addNodeOfKind('step', { at: pt }) },
        { label: '◇ + Add Decision / Scenario Router here', fn: () => this.addNodeOfKind('decision', { at: pt }) },
        { label: '⚡ + Add Trigger / Entry Node here', fn: () => this.addNodeOfKind('trigger', { at: pt }) },
        { label: '🔗 + Add Sub-Flowchart Node here', fn: () => this.addNodeOfKind('subflow', { at: pt }) },
        { label: '⏹ + Add End / Terminal Node here', fn: () => this.addNodeOfKind('end', { at: pt }) },
        '-',
        { label: '📐 Auto-Layout FlowChart (Left → Right)', fn: () => this.autoLayout('LR') },
        { label: '📐 Auto-Layout FlowChart (Top → Bottom)', fn: () => this.autoLayout('TB') },
        { label: '⛶ Fit Canvas to Window', kbd: '0', fn: () => this.fit() }
      ]);
    });

    vp.addEventListener('pointerdown', ev => {
      if (ev.button === 1 || (ev.button === 0 && (this.spaceDown || ev.target === vp || ev.target === this.world || ev.target === this.svgLayer))) {
        if (ev.button === 0 && !this.spaceDown) this.selectItem(null);
        this.drag = { mode: 'pan', sx: ev.clientX - this.pan.x, sy: ev.clientY - this.pan.y };
        vp.setPointerCapture(ev.pointerId);
      }
    });

    vp.addEventListener('pointermove', ev => {
      if (!this.drag) return;
      if (this.drag.mode === 'pan') {
        this.pan.x = ev.clientX - this.drag.sx;
        this.pan.y = ev.clientY - this.drag.sy;
        this.applyView();
      } else if (this.drag.mode === 'node') {
        const pt = this.worldPoint(ev);
        const rawX = pt.x - this.drag.dx;
        const rawY = pt.y - this.drag.dy;
        const snapStep = state.settings?.snapToGrid && !ev.ctrlKey ? 16 : 1;
        this.drag.node.x = Math.round(rawX / snapStep) * snapStep;
        this.drag.node.y = Math.round(rawY / snapStep) * snapStep;
        const card = this.nodeEls.get(this.drag.node.nodeKey);
        if (card) {
          card.style.left = `${this.drag.node.x}px`;
          card.style.top = `${this.drag.node.y}px`;
        }
        this.drag.moved = true;
        this.drawEdges();
      } else if (this.drag.mode === 'wire') {
        this.drag.curPt = this.worldPoint(ev);
        this.drawEdges();
      }
    });

    const endDrag = ev => {
      if (!this.drag) return;
      const d = this.drag;
      this.drag = null;
      try { vp.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (d.mode === 'node' && d.moved) {
        this.undoStack.push(d.beforeSnap);
        this.redoStack = [];
        this.checkDirty();
        this.renderInspector();
      } else if (d.mode === 'wire') {
        this.finishWireDrag(ev, d);
      }
    };
    vp.addEventListener('pointerup', endDrag);
    vp.addEventListener('pointercancel', endDrag);
  }

  onNodePointerDown(ev, node) {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    this.selectItem({ kind: 'node', nodeKey: node.nodeKey });
    if (node.locked || this.spaceDown) return;
    const pt = this.worldPoint(ev);
    this.drag = {
      mode: 'node',
      node,
      dx: pt.x - node.x,
      dy: pt.y - node.y,
      moved: false,
      beforeSnap: this.snapshot()
    };
    this.viewport.setPointerCapture(ev.pointerId);
  }

  startWireDrag(ev, fromNodeKey, fromPortKey) {
    ev.stopPropagation();
    ev.preventDefault();
    const startPt = this.socketWorldCenter(fromNodeKey, 'out', fromPortKey);
    this.drag = {
      mode: 'wire',
      fromNodeKey,
      fromPortKey,
      startPt,
      curPt: this.worldPoint(ev)
    };
    this.viewport.setPointerCapture(ev.pointerId);
    this.drawEdges();
  }

  finishWireDrag(ev, wireDrag) {
    const hitEl = document.elementFromPoint(ev.clientX, ev.clientY);
    const inPin = hitEl?.closest?.('[data-fc-in]');
    const targetCard = hitEl?.closest?.('.fc-node');
    const targetNodeKey = inPin?.dataset?.fcNode || targetCard?.dataset?.nodeKey || null;

    if (targetNodeKey && targetNodeKey !== wireDrag.fromNodeKey) {
      const targetNode = this.fc.nodes.find(n => n.nodeKey === targetNodeKey);
      if (!targetNode?.hasHomeInput) {
        this.drawEdges();
        return toast('Trigger nodes are entry points and cannot receive incoming Home connections', 'error');
      }
      // Check duplicate identical wire
      const dup = this.fc.edges.find(e => e.fromNodeKey === wireDrag.fromNodeKey && e.fromPortKey === wireDrag.fromPortKey && e.toNodeKey === targetNodeKey);
      if (dup) {
        this.drawEdges();
        this.selectItem({ kind: 'edge', edgeKey: dup.edgeKey });
        this.openEdgeFlowModal(dup.edgeKey);
        return;
      }
      this.pushUndo();
      const edgeKeys = new Set(this.fc.edges.map(e => e.edgeKey));
      const srcNode = this.fc.nodes.find(n => n.nodeKey === wireDrag.fromNodeKey);
      const port = srcNode?.ports?.find(p => p.key === wireDrag.fromPortKey);
      const created = normalizeFlowchartEdge({
        fromNodeKey: wireDrag.fromNodeKey,
        fromPortKey: wireDrag.fromPortKey,
        toNodeKey: targetNodeKey,
        toPortKey: HOME_PORT_KEY,
        label: port?.label || '',
        transitionText: '',
        style: this.edgeStyle
      }, edgeKeys, this.fc.edges.length);
      this.fc.edges.push(created);
      this.selectItem({ kind: 'edge', edgeKey: created.edgeKey });
      this.checkDirty();
      this.drawEdges();
      this.renderInspector();
      this.openEdgeFlowModal(created.edgeKey, { isNew: true });
      return;
    }

    this.drawEdges();
    // Dropped on empty canvas -> ComfyUI quick-create & connect menu!
    if (!targetCard) {
      const dropPt = this.worldPoint(ev);
      const at = { x: Math.round(dropPt.x), y: Math.round(dropPt.y - 36) };
      const conn = { fromNodeKey: wireDrag.fromNodeKey, fromPortKey: wireDrag.fromPortKey };
      contextMenu(ev.clientX, ev.clientY, [
        { label: '🖥 Connect to New Screen Node', fn: () => this.addNodeOfKind('screen', { at, connectFrom: conn }) },
        { label: '⚙ Connect to New Step / Backend Action', fn: () => this.addNodeOfKind('step', { at, connectFrom: conn }) },
        { label: '◇ Connect to New Decision / Scenario Router', fn: () => this.addNodeOfKind('decision', { at, connectFrom: conn }) },
        { label: '🔗 Connect to New Sub-Flowchart Node', fn: () => this.addNodeOfKind('subflow', { at, connectFrom: conn }) },
        { label: '⏹ Connect to New End / Terminal Node', fn: () => this.addNodeOfKind('end', { at, connectFrom: conn }) }
      ]);
    }
  }

  /** Opens the Transition Flow Definition editor when clicking the 📝/💬 icon over any connection line. */
  openEdgeFlowModal(edgeKey, { isNew = false } = {}) {
    const edge = this.fc?.edges?.find(e => e.edgeKey === edgeKey);
    if (!edge) return;
    const src = this.fc.nodes.find(n => n.nodeKey === edge.fromNodeKey);
    const dst = this.fc.nodes.find(n => n.nodeKey === edge.toNodeKey);
    const port = src?.ports?.find(p => p.key === edge.fromPortKey);

    const lblIn = h('input', { type: 'text', value: edge.label || '', placeholder: port?.label || 'e.g. Submit Order / Valid Token' });
    const transIn = h('textarea', {
      rows: 5,
      value: edge.transitionText || '',
      placeholder: 'Describe everything that happens during this flow transition: validations, API request/response, payload passed, UI animation/loading state, state updates, or error fallback…'
    });
    const condIn = h('input', { type: 'text', value: edge.conditionExpr || '', placeholder: 'Optional guard condition, e.g. user.isVerified && cart.total > 0' });
    const styleSel = h('select', {}, EDGE_STYLES.map(s => h('option', { value: s, selected: s === (edge.style || 'bezier') }, s)));

    const m = modal({
      title: `Transition Flow: "${src?.title || edge.fromNodeKey}" [${port?.label || edge.fromPortKey}] → "${dst?.title || edge.toNodeKey}"`,
      wide: true,
      content: h('div', { class: 'fc-modal-form' },
        h('label', { class: 'field' }, h('span', {}, 'Transition Textual Definition (What happens while transitioning)'), transIn),
        h('div', { class: 'fc-grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'Wire Badge Label'), lblIn),
          h('label', { class: 'field' }, h('span', {}, 'Wire Curve Style'), styleSel)
        ),
        h('label', { class: 'field' }, h('span', {}, 'Optional Guard / Scenario Condition'), condIn),
        h('div', { class: 'fc-callout' },
          h('span', {}, 'Does this transition have multiple possible scenarios or cases (e.g. Success vs Validation Error vs Unauthorized)?'),
          h('button', {
            type: 'button',
            class: 'btn small',
            onclick: () => {
              m.close();
              this.openInsertDecisionModal(edge.edgeKey);
            }
          }, '◇ Split into Decision Node…')
        )
      ),
      actions: close => [
        !isNew ? h('button', {
          class: 'btn danger',
          onclick: () => {
            this.pushUndo();
            this.fc.edges = this.fc.edges.filter(x => x.edgeKey !== edge.edgeKey);
            this.sel = null;
            this.checkDirty();
            this.drawEdges();
            this.renderInspector();
            close();
          }
        }, 'Disconnect') : null,
        h('button', { class: 'btn', onclick: close }, 'Close'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            this.pushUndo();
            edge.label = lblIn.value.trim();
            edge.transitionText = transIn.value;
            edge.conditionExpr = condIn.value.trim();
            edge.style = styleSel.value;
            this.checkDirty();
            this.drawEdges();
            this.renderInspector();
            close();
          }
        }, 'Save Transition')
      ].filter(Boolean)
    });
    setTimeout(() => transIn.focus(), 30);
  }

  /** Splits an existing connection line by inserting a Decision Node with user-defined scenario branches! */
  openInsertDecisionModal(edgeKey) {
    const edge = this.fc?.edges?.find(e => e.edgeKey === edgeKey);
    if (!edge) return;
    const src = this.fc.nodes.find(n => n.nodeKey === edge.fromNodeKey);
    const dst = this.fc.nodes.find(n => n.nodeKey === edge.toNodeKey);

    const titleIn = h('input', { type: 'text', value: `Check ${edge.label || dst?.title || 'Scenario'}` });
    const descIn = h('textarea', { rows: 2, value: edge.conditionExpr ? `Evaluates ${edge.conditionExpr}` : 'Evaluates condition / response and diverges into scenario branches.' });
    const cases = [
      { label: edge.label || 'Scenario 1 (Success / Match)', description: edge.transitionText || `Proceeds to "${dst?.title || edge.toNodeKey}".`, toNodeKey: edge.toNodeKey },
      { label: 'Scenario 2 (Error / Alternate Case)', description: 'Handles alternate scenario or error path.', toNodeKey: '' }
    ];

    const casesBox = h('div', { class: 'fc-cases-editor' });
    const renderCases = () => {
      clear(casesBox);
      cases.forEach((c, idx) => {
        const lbl = h('input', { type: 'text', value: c.label, placeholder: `Scenario ${idx + 1} label`, oninput: e => { c.label = e.target.value; } });
        const targetSel = h('select', { onchange: e => { c.toNodeKey = e.target.value; } },
          h('option', { value: '', selected: !c.toNodeKey }, '— Leave unwired (connect on canvas) —'),
          ...this.fc.nodes.filter(n => n.hasHomeInput).map(n =>
            h('option', { value: n.nodeKey, selected: c.toNodeKey === n.nodeKey }, `→ ${n.title} (${n.kind})`)
          )
        );
        const tr = h('input', { type: 'text', value: c.description, placeholder: 'What happens in this scenario…', oninput: e => { c.description = e.target.value; } });
        casesBox.append(h('div', { class: 'fc-case-row' },
          h('div', { class: 'row', style: { gap: '6px' } },
            h('span', { class: 'badge' }, `Case ${idx + 1}`),
            lbl,
            targetSel,
            cases.length > 2 ? h('button', { type: 'button', class: 'icon-btn', onclick: () => { cases.splice(idx, 1); renderCases(); } }, '✕') : null
          ),
          tr
        ));
      });
    };
    renderCases();

    modal({
      title: `◇ Insert Decision Node on Connection (${src?.title || edge.fromNodeKey} → ${dst?.title || edge.toNodeKey})`,
      wide: true,
      content: h('div', { class: 'fc-modal-form' },
        h('label', { class: 'field' }, h('span', {}, 'Decision Node Title'), titleIn),
        h('label', { class: 'field' }, h('span', {}, 'Decision Logic / Rule Description'), descIn),
        h('div', { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center' } },
          h('b', {}, 'Scenario Output Branches'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { cases.push({ label: `Scenario ${cases.length + 1}`, description: '', toNodeKey: '' }); renderCases(); } }, '+ Add Scenario')
        ),
        casesBox
      ),
      actions: close => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            try {
              this.pushUndo();
              const split = splitEdgeWithDecision(this.fc.nodes, this.fc.edges, edgeKey, {
                decisionTitle: titleIn.value.trim() || 'Decision Router',
                decisionDescription: descIn.value,
                cases
              });
              this.fc.nodes = split.nodes;
              this.fc.edges = split.edges;
              this.sel = { kind: 'node', nodeKey: split.decisionNode.nodeKey };
              this.checkDirty();
              this.rebuildCanvas();
              this.renderInspector();
              close();
              toast(`Inserted Decision node "${split.decisionNode.title}" with ${split.decisionNode.ports.length} scenario branches`, 'ok');
            } catch (e) { toast(e.message, 'error'); }
          }
        }, '◇ Insert Decision Node')
      ]
    });
  }

  /** Modal to configure Access Levels / Roles on this FlowChart. */
  openRolesModal() {
    if (!this.fc) return;
    const list = cloneDeep(this.fc.accessLevels || DEFAULT_ACCESS_LEVELS);
    const box = h('div', { class: 'fc-cases-editor' });
    const draw = () => {
      clear(box);
      list.forEach((r, idx) => {
        box.append(h('div', { class: 'fc-case-row' },
          h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } },
            h('input', { type: 'color', value: r.color || '#2e9bff', style: { width: '34px', height: '28px', padding: '0' }, oninput: e => { r.color = e.target.value; } }),
            h('input', { type: 'text', value: r.key, placeholder: 'role-key', style: { maxWidth: '130px' }, oninput: e => { r.key = e.target.value; } }),
            h('input', { type: 'text', value: r.name, placeholder: 'Display Name', oninput: e => { r.name = e.target.value; } }),
            list.length > 1 ? h('button', { type: 'button', class: 'icon-btn', title: 'Remove role', onclick: () => { list.splice(idx, 1); draw(); } }, '🗑') : null
          ),
          h('input', { type: 'text', value: r.description || '', placeholder: 'What permissions or UI features this access level has…', oninput: e => { r.description = e.target.value; } })
        ));
      });
    };
    draw();

    modal({
      title: '⚙ Access Levels & User Roles Configuration',
      wide: true,
      content: h('div', { class: 'fc-modal-form' },
        h('p', { class: 'muted' }, 'Define access levels (e.g. guest, user, pro, editor, admin). Each Screen or Step node can customize which features appear or change for each access level.'),
        box,
        h('button', {
          type: 'button',
          class: 'btn small',
          onclick: () => { list.push({ key: `role-${list.length + 1}`, name: `Role ${list.length + 1}`, color: '#14b8a6', description: '' }); draw(); }
        }, '+ Add Access Level')
      ),
      actions: close => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            this.pushUndo();
            this.fc.accessLevels = normalizeAccessLevels(list);
            if (this.rolePreview !== 'all' && !this.fc.accessLevels.some(r => r.key === this.rolePreview)) this.rolePreview = 'all';
            this.checkDirty();
            this.render();
            close();
          }
        }, 'Apply Roles')
      ]
    });
  }

  /** Modal showing validation & gap analysis report for the active FlowChart. */
  openValidationModal() {
    if (!this.fc) return;
    const rep = validateFlowchart(this.fc);
    const items = [
      ...rep.errors.map(e => ({ sev: 'error', ...e })),
      ...rep.warnings.map(w => ({ sev: 'warn', ...w }))
    ];
    modal({
      title: `FlowChart Validation & Gap Check — "${this.fc.name}"`,
      wide: true,
      content: h('div', { class: 'fc-modal-form' },
        h('div', { class: 'fc-callout' },
          h('b', {}, rep.valid ? '✓ Graph Structure Valid' : `✕ ${rep.errors.length} Structural Error(s)`),
          h('span', { class: 'muted' }, `${rep.stats.screens} Screens · ${rep.stats.steps} Steps · ${rep.stats.decisions} Decisions · ${rep.stats.edges} Transitions · ${rep.warnings.length} Gap Warning(s)`)
        ),
        items.length
          ? h('div', { class: 'fc-cases-editor' }, items.map(it => h('div', {
              class: 'fc-case-row',
              style: { cursor: (it.nodeKey || it.edgeKey) ? 'pointer' : 'default' },
              onclick: () => {
                if (it.nodeKey) this.selectItem({ kind: 'node', nodeKey: it.nodeKey });
                else if (it.edgeKey) this.selectItem({ kind: 'edge', edgeKey: it.edgeKey });
              }
            },
              h('span', { class: 'badge' }, it.sev === 'error' ? 'ERROR' : 'GAP HINT'),
              ' ',
              it.message
            )))
          : h('p', {}, '🎉 Zero errors and zero gap warnings! Every node and transition has a clear textual specification.')
      ),
      actions: close => [h('button', { class: 'btn primary', onclick: close }, 'Done')]
    });
  }

  /** Materializes conceptual Screen nodes into real visual Screen designs + Workflow routes! */
  async openMaterializeModal() {
    if (!this.fc) return;
    if (this.dirty) {
      const ok = await this.save();
      if (!ok) return;
    }
    const screenNodes = this.fc.nodes.filter(n => n.kind === 'screen');
    if (!screenNodes.length) return toast('Add at least one Screen node to materialize visual UI screens', 'error');

    const syncWfChk = h('input', { type: 'checkbox', checked: true });
    const syncDescChk = h('input', { type: 'checkbox', checked: true });
    const allowUnapproved = this.fc.status !== 'approved';

    modal({
      title: `🎨 Materialize Visual UI Screens from "${this.fc.name}"`,
      wide: true,
      content: h('div', { class: 'fc-modal-form' },
        allowUnapproved
          ? h('div', { class: 'fc-callout' },
              h('span', {}, `Note: "${this.fc.name}" is currently "${this.fc.status}". Approving first is recommended so AI coders treat the spec as signed off.`))
          : null,
        h('p', {}, `This will create or update ${screenNodes.length} visual Screen item(s) in your project library (carrying all conceptual descriptions, menu items, and per-role feature specs) so you or an AI coder can immediately build visual UIs with library elements:`),
        h('ul', { class: 'muted', style: { margin: '0 0 8px 18px' } },
          screenNodes.map(n => h('li', {}, `${n.title} (${n.linkedScreenId ? `linked to Screen #${n.linkedScreenId}` : 'will create new Screen'})`))
        ),
        h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer' } }, syncDescChk, h('span', {}, 'Sync conceptual & role specifications into Screen developer descriptions')),
        h('label', { class: 'row', style: { gap: '8px', cursor: 'pointer' } }, syncWfChk, h('span', {}, 'Create / update synchronized visual Screen Workflow with navigation routes'))
      ),
      actions: close => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              const out = await api.materializeFlowchart(this.fc.id, {
                allowUnapproved: true,
                syncDescriptions: syncDescChk.checked,
                syncWorkflow: syncWfChk.checked
              });
              this.fc = out.flowchart;
              this.markBaseline();
              await reloadLibrary({ silent: true });
              emit('workflows:changed');
              this.rebuildCanvas();
              this.renderInspector();
              close();
              toast(`Materialized ${out.createdScreens.length} new screen(s) & ${out.updatedScreens.length} existing screen(s)`, 'ok', 4200);
            } catch (e) { toast(e.message, 'error'); }
          }
        }, '🎨 Generate & Link UI Screens')
      ]
    });
  }

  /* ==================== RIGHT INSPECTOR ==================== */
  renderInspector() {
    if (!this.inspectorEl || !this.fc) return;
    clear(this.inspectorEl);

    const sec = (title, ...kids) => h('section', { class: 'insp-sec fc-insp-sec' }, h('h4', {}, title), ...kids);
    const fld = (label, ctrl) => h('label', { class: 'field' }, h('span', {}, label), ctrl);

    if (this.sel?.kind === 'node') {
      const node = this.fc.nodes.find(n => n.nodeKey === this.sel.nodeKey);
      if (!node) { this.sel = null; return this.renderInspector(); }

      const kindSel = h('select', {
        onchange: () => {
          this.pushUndo();
          node.kind = kindSel.value;
          node.hasHomeInput = KIND_META.get(node.kind)?.hasHomeInput ?? true;
          node.subtype = (FLOWCHART_SUBTYPES[node.kind] || [])[0] || '';
          this.checkDirty();
          this.rebuildCanvas();
          this.renderInspector();
        }
      }, FLOWCHART_NODE_KINDS.map(k => h('option', { value: k.key, selected: k.key === node.kind }, k.label)));

      const subtypeSel = h('select', {
        onchange: () => {
          this.pushUndo();
          node.subtype = subtypeSel.value;
          this.checkDirty();
          this.rebuildCanvas();
        }
      }, (FLOWCHART_SUBTYPES[node.kind] || ['custom']).map(st => h('option', { value: st, selected: st === node.subtype }, st)));

      const titleIn = h('input', {
        type: 'text',
        value: node.title,
        onchange: () => {
          const v = titleIn.value.trim();
          if (!v) return;
          this.pushUndo();
          node.title = v;
          this.checkDirty();
          this.rebuildCanvas();
        }
      });

      const descArea = h('textarea', {
        rows: 5,
        value: node.description || '',
        placeholder: 'Full textual specification of what happens in this screen or step…',
        onchange: () => {
          this.pushUndo();
          node.description = descArea.value;
          this.checkDirty();
          this.rebuildCanvas();
        }
      });

      const widthIn = h('input', {
        type: 'number',
        min: 220,
        max: 640,
        step: 10,
        value: String(node.width || 300),
        onchange: () => {
          node.width = Math.max(220, Math.min(640, Number(widthIn.value) || 300));
          this.checkDirty();
          this.rebuildCanvas();
        }
      });

      // Output ports editor
      const portsSec = h('div', { class: 'fc-insp-list' });
      (node.ports || []).forEach((p, idx) => {
        portsSec.append(h('div', { class: 'fc-insp-port-card' },
          h('div', { class: 'row', style: { gap: '6px' } },
            h('input', {
              type: 'text',
              value: p.label,
              placeholder: 'Port label',
              onchange: e => { p.label = e.target.value.trim() || p.label; this.checkDirty(); this.rebuildCanvas(); }
            }),
            h('select', {
              style: { maxWidth: '105px' },
              onchange: e => { p.kind = e.target.value; this.checkDirty(); this.rebuildCanvas(); }
            }, PORT_KINDS.map(pk => h('option', { value: pk, selected: pk === p.kind }, pk))),
            h('button', {
              type: 'button',
              class: 'icon-btn',
              title: 'Delete output port & its wires',
              onclick: () => {
                this.pushUndo();
                node.ports.splice(idx, 1);
                this.fc.edges = this.fc.edges.filter(e => !(e.fromNodeKey === node.nodeKey && e.fromPortKey === p.key));
                this.checkDirty();
                this.rebuildCanvas();
                this.renderInspector();
              }
            }, '🗑')
          ),
          h('input', {
            type: 'text',
            value: p.description || '',
            placeholder: 'What this menu item / sub-action triggers…',
            onchange: e => { p.description = e.target.value; this.checkDirty(); }
          })
        ));
      });

      // Per-Access-Level / Role Settings & Feature Overrides!
      const roles = this.fc.accessLevels || DEFAULT_ACCESS_LEVELS;
      const rs = node.roleSettings || (node.roleSettings = { allowedRoles: [], deniedBehavior: 'hide', redirectNodeKey: '', variants: {} });
      const roleChecks = h('div', { class: 'fc-role-checks' },
        roles.map(r => {
          const checked = !rs.allowedRoles.length || rs.allowedRoles.includes(r.key);
          return h('label', { class: 'fc-role-chip-chk' },
            h('input', {
              type: 'checkbox',
              checked,
              onchange: e => {
                this.pushUndo();
                const cur = rs.allowedRoles.length ? new Set(rs.allowedRoles) : new Set(roles.map(x => x.key));
                if (e.target.checked) cur.add(r.key); else cur.delete(r.key);
                rs.allowedRoles = cur.size === roles.length ? [] : [...cur];
                this.checkDirty();
                this.rebuildCanvas();
                this.renderInspector();
              }
            }),
            h('span', {}, `@${r.key}`)
          );
        })
      );

      const deniedSel = h('select', {
        onchange: e => { rs.deniedBehavior = e.target.value; this.checkDirty(); this.rebuildCanvas(); }
      }, DENIED_BEHAVIORS.map(db => h('option', { value: db, selected: db === (rs.deniedBehavior || 'hide') }, db)));

      const roleVariantSel = h('select', {});
      for (const r of roles) roleVariantSel.append(h('option', { value: r.key }, `@${r.key} — ${r.name}`));
      const variantEditorWrap = h('div', { class: 'fc-variant-box' });
      const renderVariantInputs = () => {
        clear(variantEditorWrap);
        const rk = roleVariantSel.value || roles[0]?.key || 'user';
        const curV = rs.variants?.[rk] || { summary: '', addedFeatures: '', hiddenFeatures: '', notes: '' };
        const commitVariant = (field, val) => {
          if (!rs.variants) rs.variants = {};
          const next = { ...curV, [field]: val };
          if (!next.summary && !next.addedFeatures && !next.hiddenFeatures && !next.notes) delete rs.variants[rk];
          else rs.variants[rk] = next;
          this.checkDirty();
          this.rebuildCanvas();
        };
        variantEditorWrap.append(
          fld(`How "${node.title}" behaves for @${rk}`, h('textarea', {
            rows: 2,
            value: curV.summary || '',
            placeholder: `e.g. For @${rk}, shows personal items and read-only analytics…`,
            onchange: e => commitVariant('summary', e.target.value)
          })),
          fld(`Extra Features Included for @${rk}`, h('input', {
            type: 'text',
            value: curV.addedFeatures || '',
            placeholder: 'e.g. Moderation toolbar, Export CSV, Bulk delete',
            onchange: e => commitVariant('addedFeatures', e.target.value)
          })),
          fld(`Features Hidden / Disabled for @${rk}`, h('input', {
            type: 'text',
            value: curV.hiddenFeatures || '',
            placeholder: 'e.g. Billing settings, API keys',
            onchange: e => commitVariant('hiddenFeatures', e.target.value)
          }))
        );
      };
      roleVariantSel.addEventListener('change', renderVariantInputs);
      renderVariantInputs();

      // Technical & Backend Contract section
      const ts = node.techSpec || (node.techSpec = {});
      const techSec = sec('Backend, API & Technical Contract',
        h('div', { class: 'fc-grid-2' },
          fld('HTTP / Action Method', h('input', {
            type: 'text',
            value: ts.method || '',
            placeholder: 'GET / POST / EVENT',
            onchange: e => { ts.method = e.target.value.trim().toUpperCase(); this.checkDirty(); this.rebuildCanvas(); }
          })),
          fld('Route / API Endpoint', h('input', {
            type: 'text',
            value: ts.endpoint || '',
            placeholder: '/api/orders or /checkout',
            onchange: e => { ts.endpoint = e.target.value.trim(); this.checkDirty(); this.rebuildCanvas(); }
          }))
        ),
        fld('Database Tables Touched (comma-separated)', h('input', {
          type: 'text',
          value: (ts.dbTables || []).join(', '),
          placeholder: 'users, orders, order_items',
          onchange: e => { ts.dbTables = e.target.value.split(',').map(s => s.trim()).filter(Boolean); this.checkDirty(); this.rebuildCanvas(); }
        })),
        fld('Request / Input Payload', h('textarea', {
          rows: 2,
          value: ts.requestSchema || '',
          placeholder: '{ items: CartItem[], couponCode?: string }',
          onchange: e => { ts.requestSchema = e.target.value; this.checkDirty(); }
        })),
        fld('Response / State Output', h('textarea', {
          rows: 2,
          value: ts.responseSchema || '',
          placeholder: '{ orderId: string, status: "paid" | "pending" }',
          onchange: e => { ts.responseSchema = e.target.value; this.checkDirty(); }
        })),
        fld('Error Cases & Edge Conditions', h('textarea', {
          rows: 2,
          value: ts.errorCases || '',
          placeholder: '400 invalid coupon, 402 payment declined, 409 out of stock',
          onchange: e => { ts.errorCases = e.target.value; this.checkDirty(); }
        }))
      );

      this.inspectorEl.append(
        sec(`Node — ${node.nodeKey}`,
          fld('Title', titleIn),
          h('div', { class: 'fc-grid-2' }, fld('Node Kind', kindSel), fld('Subtype', subtypeSel)),
          fld('Width (px)', widthIn),
          fld('Textual Specification', descArea)
        ),
        sec('Output Nodes (Menu Items / Actions / Cases)',
          portsSec,
          h('button', {
            type: 'button',
            class: 'btn small',
            onclick: () => {
              this.pushUndo();
              const pKeys = new Set((node.ports || []).map(p => p.key));
              const dk = node.kind === 'decision' ? 'case' : node.kind === 'screen' ? 'menu-item' : 'action';
              node.ports.push(normalizePort({ label: `Option ${node.ports.length + 1}`, kind: dk }, node.ports.length, pKeys, dk));
              this.checkDirty();
              this.rebuildCanvas();
              this.renderInspector();
            }
          }, '+ Add Output Node')
        ),
        sec('Access Levels & Per-Role Features',
          h('small', { class: 'muted' }, 'Allowed roles (uncheck to restrict this screen/step):'),
          roleChecks,
          fld('When Denied Behavior', deniedSel),
          fld('Customize Features for Specific Role', roleVariantSel),
          variantEditorWrap
        ),
        techSec
      );
      return;
    }

    if (this.sel?.kind === 'edge') {
      const edge = this.fc.edges.find(e => e.edgeKey === this.sel.edgeKey);
      if (!edge) { this.sel = null; return this.renderInspector(); }
      const src = this.fc.nodes.find(n => n.nodeKey === edge.fromNodeKey);
      const dst = this.fc.nodes.find(n => n.nodeKey === edge.toNodeKey);

      this.inspectorEl.append(
        sec('Transition Connection',
          h('p', { class: 'muted' }, `${src?.title || edge.fromNodeKey} [${edge.fromPortKey}] → ${dst?.title || edge.toNodeKey} [Home]`),
          fld('Wire Badge Label', h('input', {
            type: 'text',
            value: edge.label || '',
            onchange: e => { edge.label = e.target.value.trim(); this.checkDirty(); this.drawEdges(); }
          })),
          fld('Transition Flow Definition (What happens through the transition)', h('textarea', {
            rows: 5,
            value: edge.transitionText || '',
            placeholder: 'Explain what happens during this transition (validation, API call, state payload, UI transition)…',
            onchange: e => { edge.transitionText = e.target.value; this.checkDirty(); this.drawEdges(); }
          })),
          fld('Guard / Scenario Condition', h('input', {
            type: 'text',
            value: edge.conditionExpr || '',
            placeholder: 'e.g. response.status === 200',
            onchange: e => { edge.conditionExpr = e.target.value.trim(); this.checkDirty(); }
          })),
          fld('Curve Style', h('select', {
            onchange: e => { edge.style = e.target.value; this.checkDirty(); this.drawEdges(); }
          }, EDGE_STYLES.map(s => h('option', { value: s, selected: s === (edge.style || 'bezier') }, s)))),
          h('div', { class: 'row', style: { gap: '6px', marginTop: '8px', flexWrap: 'wrap' } },
            h('button', { type: 'button', class: 'btn small primary', onclick: () => this.openInsertDecisionModal(edge.edgeKey) }, '◇ Split into Decision Node…'),
            h('button', { type: 'button', class: 'btn small danger', onclick: () => this.deleteSelected() }, '🗑 Disconnect')
          )
        )
      );
      return;
    }

    // Default: FlowChart Document Inspector
    const fc = this.fc;
    const spec = fc.spec || (fc.spec = {});
    const val = validateFlowchart(fc);
    const mermaidText = flowchartToMermaid(fc, { roleKey: this.rolePreview === 'all' ? null : this.rolePreview });

    this.inspectorEl.append(
      sec('FlowChart Specification',
        fld('Name', h('input', {
          type: 'text',
          value: fc.name,
          onchange: e => { const v = e.target.value.trim(); if (v) { fc.name = v; fc.label = v; this.checkDirty(); this.render(); } }
        })),
        h('div', { class: 'muted', style: { fontSize: '11px', marginBottom: '6px' } }, `Key: ${fc.key} · Status: ${fc.status.toUpperCase()}`),
        fld('Conceptual Description', h('textarea', {
          rows: 4,
          value: fc.description || '',
          placeholder: 'Explain the goal, actors, and end-to-end flow of this workflow…',
          onchange: e => { fc.description = e.target.value; this.checkDirty(); }
        })),
        fld('Global Business Rules & Invariants', h('textarea', {
          rows: 3,
          value: spec.businessRules || '',
          placeholder: 'Domain invariants, pricing/quota rules, security constraints…',
          onchange: e => { spec.businessRules = e.target.value; this.checkDirty(); }
        })),
        fld('Data Models & Entities', h('textarea', {
          rows: 3,
          value: spec.dataModels || '',
          placeholder: 'Tables / entities read & written by this flow…',
          onchange: e => { spec.dataModels = e.target.value; this.checkDirty(); }
        }))
      ),
      sec('Readiness & AI Handoff',
        h('div', { class: 'muted', style: { marginBottom: '8px' } },
          `${val.stats.nodes} nodes (${val.stats.screens} screens, ${val.stats.steps} steps, ${val.stats.decisions} decisions) · ${val.stats.edges} transitions · ${val.warnings.length} gap warning(s)`
        ),
        h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
          h('button', { type: 'button', class: 'btn small', onclick: () => this.openValidationModal() }, '✓ Gap Check'),
          h('button', { type: 'button', class: 'btn small', onclick: () => this.openRolesModal() }, `⚙ Roles (${(fc.accessLevels || []).length})`),
          h('button', { type: 'button', class: 'btn small', onclick: () => this.openMaterializeModal() }, '🎨 Build UIs'),
          h('button', { type: 'button', class: 'btn small primary', onclick: () => openProjectDefinitionModal({ flowchartIds: [fc.id] }) }, '📄 Export Spec')
        )
      ),
      sec('Live Mermaid Preview',
        h('textarea', { class: 'fc-code-preview', rows: 7, readonly: true, value: mermaidText })
      )
    );
  }
}

function onKeyBindings(self) {
  document.addEventListener('keydown', e => {
    if (state.mode !== 'flowchart' || !self.fc) return;
    if (document.querySelector('#modal-root .modal-overlay')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); self.undo(); }
    else if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); self.redo(); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); self.duplicateSelected(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); self.deleteSelected(); }
    else if (e.key === '0' && !mod) { e.preventDefault(); self.fit(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); self.zoomBy(1.2); }
    else if (e.key === '-') { e.preventDefault(); self.zoomBy(1 / 1.2); }
  });
}
