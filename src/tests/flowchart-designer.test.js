import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../composition-root.js';
import {
  HOME_PORT_KEY,
  normalizeFlowchartNode,
  normalizeFlowchartEdge,
  resolveNodeForRole,
  isEdgeAllowedForRole,
  splitEdgeWithDecision,
  autoLayoutFlowchart,
  validateFlowchart,
  flowchartToMermaid
} from '../domain/flowchart.js';

const here = dirname(fileURLToPath(import.meta.url));

test('FlowChart Domain: Home input sockets, output menu/action ports, Decision splitting & Role-based feature overrides', () => {
  const keys = new Set();
  const login = normalizeFlowchartNode({
    nodeKey: 'login-screen',
    kind: 'screen',
    title: 'Login Screen',
    description: 'User enters email and password.',
    ports: [
      { key: 'submit', label: 'Sign In', kind: 'submit', description: 'Submits login form' },
      { key: 'sso', label: 'Continue with SSO', kind: 'button' }
    ]
  }, keys, 0);

  const dashboard = normalizeFlowchartNode({
    nodeKey: 'dashboard-screen',
    kind: 'screen',
    title: 'Workspace Dashboard',
    description: 'Core workspace screen.',
    roleSettings: {
      allowedRoles: ['user', 'admin'],
      deniedBehavior: 'login-prompt',
      variants: {
        user: { summary: 'Standard workspace with personal items.', hiddenFeatures: 'Admin ACL console' },
        admin: { summary: 'Full workspace with moderation & system metrics.', addedFeatures: 'Admin toolbar, Audit log export' }
      }
    },
    ports: [
      { key: 'open-item', label: 'Open Item', kind: 'menu-item' },
      { key: 'admin-acl', label: 'Manage Users', kind: 'menu-item', allowedRoles: ['admin'], deniedBehavior: 'hide' }
    ]
  }, keys, 1);

  assert.equal(login.hasHomeInput, true);
  assert.equal(dashboard.hasHomeInput, true);

  // Role resolution: guest denied, user sees user features & 1 port, admin sees admin features & both ports
  const guestView = resolveNodeForRole(dashboard, 'guest');
  assert.equal(guestView.accessible, false);
  assert.equal(guestView.deniedBehavior, 'login-prompt');
  assert.equal(guestView.visiblePorts.length, 0);

  const userView = resolveNodeForRole(dashboard, 'user');
  assert.equal(userView.accessible, true);
  assert.match(userView.effectiveDescription, /Standard workspace/);
  assert.match(userView.effectiveDescription, /Hidden for user: Admin ACL console/);
  assert.deepEqual(userView.visiblePorts.map(p => p.key), ['open-item']);

  const adminView = resolveNodeForRole(dashboard, 'admin');
  assert.equal(adminView.accessible, true);
  assert.match(adminView.effectiveDescription, /Admin toolbar, Audit log export/);
  assert.deepEqual(adminView.visiblePorts.map(p => p.key), ['open-item', 'admin-acl']);

  // Direct wire -> split with a Decision node for multiple scenarios
  const eKeys = new Set();
  const edge = normalizeFlowchartEdge({
    fromNodeKey: 'login-screen',
    fromPortKey: 'submit',
    toNodeKey: 'dashboard-screen',
    label: 'Submit',
    transitionText: 'POST /api/auth/login and store session token.'
  }, eKeys, 0);
  assert.equal(edge.toPortKey, HOME_PORT_KEY);

  const split = splitEdgeWithDecision([login, dashboard], [edge], edge.edgeKey, {
    decisionTitle: 'Auth & MFA Scenario Check',
    cases: [
      { key: 'authenticated', label: 'Valid Credentials', description: 'Open dashboard', toNodeKey: 'dashboard-screen' },
      { key: 'invalid-pw', label: 'Invalid Password', description: 'Show error banner on login', toNodeKey: 'login-screen' }
    ]
  });

  assert.equal(split.decisionNode.kind, 'decision');
  assert.equal(split.nodes.length, 3);
  assert.equal(split.edges.length, 3);
  assert.equal(split.incomingEdge.toNodeKey, split.decisionNode.nodeKey);
  assert.equal(split.incomingEdge.toPortKey, HOME_PORT_KEY);
  assert.equal(split.outgoingEdges.length, 2);

  const laidOut = autoLayoutFlowchart(split.nodes, split.edges, { startNodeKey: 'login-screen' });
  const loginX = laidOut.find(n => n.nodeKey === 'login-screen').x;
  const decX = laidOut.find(n => n.nodeKey === split.decisionNode.nodeKey).x;
  assert.ok(decX > loginX, 'DAG auto-layout places downstream decision node to the right');

  const val = validateFlowchart({ startNodeKey: 'login-screen', nodes: laidOut, edges: split.edges });
  assert.equal(val.valid, true);
  assert.equal(val.errors.length, 0);

  const mmd = flowchartToMermaid({ nodes: laidOut, edges: split.edges });
  assert.match(mmd, /flowchart LR/);
  assert.match(mmd, /Auth & MFA Scenario Check/);
  assert.equal(isEdgeAllowedForRole(split.outgoingEdges[0], 'guest', new Map(laidOut.map(n => [n.nodeKey, n]))), false);
});

test('FlowChart Service: CRUD, Prefix Naming, Approval Gate, Materialize UI Screens, Reverse Engineering, Trash & Project-Definition Export', () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  try {
    const owner = c.auth.register({ username: 'architect', email: 'arch@example.com', password: 'password123' }).user;
    const proj = c.projects.create({ name: 'Nova Commerce', prefix: 'nova', visibility: 'private' }, { actor: owner });

    const fc = c.flowcharts.create({
      name: 'Order Checkout',
      description: 'End-to-end conceptual checkout flow covering cart screen, payment API step, fraud decision, and confirmation.',
      domain: 'fullstack',
      projectId: proj.id,
      visibility: 'project',
      nodes: [
        {
          nodeKey: 'cart-screen',
          kind: 'screen',
          title: 'Shopping Cart',
          description: 'Displays line items, promo code box, and total.',
          roleSettings: {
            variants: {
              guest: { summary: 'Requires email & shipping address inline; prompts account creation.' },
              user: { summary: 'Pre-fills saved addresses and loyalty points.' }
            }
          },
          ports: [{ key: 'pay-now', label: 'Pay Now', kind: 'submit', description: 'Starts payment authorization.' }]
        },
        {
          nodeKey: 'charge-step',
          kind: 'step',
          subtype: 'api-endpoint',
          title: 'Charge Payment API',
          description: 'Calls payment gateway and records transaction.',
          techSpec: { method: 'POST', endpoint: '/api/orders/charge', dbTables: ['orders', 'payments'] },
          ports: [{ key: 'result', label: 'Gateway Result', kind: 'api-next' }]
        },
        {
          nodeKey: 'receipt-screen',
          kind: 'screen',
          title: 'Order Confirmation',
          description: 'Shows order receipt, tracking link, and invoice download.',
          ports: []
        }
      ],
      edges: [
        { fromNodeKey: 'cart-screen', fromPortKey: 'pay-now', toNodeKey: 'charge-step', label: 'Authorize', transitionText: 'Validates shipping address and posts payment token.' },
        { fromNodeKey: 'charge-step', fromPortKey: 'result', toNodeKey: 'receipt-screen', label: 'Captured', transitionText: 'Persists order row and navigates to confirmation.' }
      ],
      autoLayout: true
    }, { actor: owner });

    assert.equal(fc.key, 'nova-flowchart-order-checkout');
    assert.equal(fc.status, 'draft');

    // Split payment result edge into a Decision node via applyOps
    const secondEdge = fc.edges.find(e => e.fromNodeKey === 'charge-step');
    const opRes = c.flowcharts.applyOps(fc.id, [
      {
        op: 'insert_decision_on_edge',
        edgeKey: secondEdge.edgeKey,
        decisionTitle: 'Payment Captured?',
        cases: [
          { key: 'captured', label: 'Payment Succeeded', toNodeKey: 'receipt-screen', description: 'Show receipt' },
          { key: 'declined', label: 'Card Declined', toNodeKey: 'cart-screen', description: 'Return to cart with decline reason' }
        ]
      }
    ], { actor: owner, projectId: proj.id });
    assert.equal(opRes.flowchart.nodes.length, 4);

    // Unapproved materialization is gated by default
    assert.throws(() => c.flowcharts.materializeToScreens(fc.id, {}, { actor: owner }), /Approve the flowchart first/);

    // Approve, then materialize visual Screens + synchronized Workflow
    c.flowcharts.setStatus(fc.id, { status: 'approved', approvalNote: 'Signed off for UI design & backend sprint.' }, { actor: owner });
    const mat = c.flowcharts.materializeToScreens(fc.id, {}, { actor: owner });
    assert.equal(mat.createdScreens.length, 2);
    assert.ok(mat.workflow?.id, 'Synchronized visual Screen Workflow was created');
    assert.equal(mat.workflow.screenCount, 2);
    assert.ok(mat.workflow.linkCount >= 1, 'Screen-to-screen navigation link bridged across step & decision nodes');

    // Reverse engineer from the materialized project screens & workflow
    const revProj = c.flowcharts.reverseEngineerFromProject({ projectId: proj.id, workflowId: mat.workflow.id, name: 'Reverse From Screens' }, { actor: owner });
    assert.ok(revProj.nodes.length >= 2);

    // Reverse engineer from plain-text app routes / transitions
    const revSpec = c.flowcharts.reverseEngineerFromAppSpec({
      projectId: proj.id,
      name: 'Imported Backend & UI Flow',
      rawText: [
        'Screen: Catalog (/products) - Lists products with filters',
        'API: GET /api/products - Queries indexed catalog',
        'Catalog (/products) --[Filter Change]--> GET /api/products : Sends filter query params'
      ].join('\n')
    }, { actor: owner });
    assert.equal(revSpec.nodes.length, 2);
    assert.equal(revSpec.edges.length, 1);

    // Export full project-definition.md & JSON
    const def = c.flowcharts.buildProjectDefinition({ projectId: proj.id, format: 'both' }, { actor: owner });
    assert.match(def.markdown, /# Project Definition: Nova Commerce/);
    assert.match(def.markdown, /Order Checkout/);
    assert.match(def.markdown, /Role-Specific Feature Variations/);
    assert.match(def.markdown, /POST \/api\/orders\/charge/);
    assert.equal(def.definition.summary.totalFlowcharts, 3);

    // Trash & Restore round-trip
    const del = c.flowcharts.remove(revSpec.id, { actor: owner });
    assert.equal(del.trashed, true);
    const restored = c.trash.restore(del.trashId, { actor: owner });
    assert.equal(restored.itemType, 'flowchart');
    assert.equal(restored.item.nodes.length, 2);
  } finally {
    c.close();
  }
});

test('FlowChart Web UI Contracts: Top Menu Bar, Designer Switcher Dropdown, Left Browser & ComfyUI Designer Module', () => {
  const mainSrc = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'main.js'), 'utf8');
  const designerSrc = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'components', 'designer.js'), 'utf8');
  const libSrc = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'components', 'library-panel.js'), 'utf8');
  const fcSrc = readFileSync(join(here, '..', 'interfaces', 'web', 'js', 'components', 'flowchart-designer.js'), 'utf8');

  assert.match(mainSrc, /\['FlowChart',\s*\[/, 'Top menu bar has dedicated FlowChart menu');
  assert.match(mainSrc, /openFlowchart\(/, 'App shell wires openFlowchart');
  assert.match(designerSrc, /'workflow',\s*'flowchart'/, 'Designer change dropdown includes FlowChart designer');
  assert.match(libSrc, /\['flowchart',\s*'FlowCharts'\]/, 'Left library panel includes FlowCharts browser tab');
  assert.match(libSrc, /fc-mini-crud/, 'Left FlowChart browser includes compact CRUD toolbar');
  assert.match(fcSrc, /fc-edge-badge/, 'ComfyUI canvas renders interactive transition icon over connection lines');
  assert.match(fcSrc, /openInsertDecisionModal/, 'Connection lines can split into Decision nodes for multi-scenario flows');
});
