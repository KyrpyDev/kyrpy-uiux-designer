import test from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContainer } from '../../composition-root.js';
import { createHttpServer } from '../../interfaces/http/server.js';

const here = dirname(fileURLToPath(import.meta.url));

test('MCP End-to-End FlowChart Designer Suite: create, interactive ops, role variants, decision split, approve, materialize UI screens, reverse-engineer, and project-definition export', async () => {
  const c = buildContainer({ dbFile: ':memory:', syncEnabled: false });
  const ada = c.auth.register({ username: 'ada', email: 'ada@example.com', password: 'secret123' });
  const bob = c.auth.register({ username: 'bob', email: 'bob@example.com', password: 'secret123' });
  const adaProj = c.projects.create({ name: 'Ada SaaS', prefix: 'adasaas', visibility: 'private' }, { actor: ada.user });
  const bobProj = c.projects.create({ name: 'Bob App', prefix: 'bobapp', visibility: 'private' }, { actor: bob.user });

  const projKey = c.mcp.apiKeys.create({ name: 'ada-proj', projectId: adaProj.id, scopes: ['read', 'propose', 'request'] }, ada.user).key;
  const accKey = c.mcp.apiKeys.create({ name: 'ada-acc', kind: 'account', scopes: ['read', 'propose', 'create'] }, ada.user).key;
  const bobKey = c.mcp.apiKeys.create({ name: 'bob-proj', projectId: bobProj.id, scopes: ['read', 'propose'] }, bob.user).key;

  const server = createHttpServer(c, {
    webRoot: join(here, '..', '..', 'interfaces', 'web'),
    domainRoot: join(here, '..', '..', 'domain')
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  let rpcId = 0;
  const rpc = async (method, params = {}, bearer = projKey) => (await (await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
  })).json());
  const callOk = async (name, args = {}, bearer = projKey) => {
    const r = (await rpc('tools/call', { name, arguments: args }, bearer)).result;
    assert.ok(!r.isError, `${name} failed: ${r.content?.[0]?.text}`);
    return r.structuredContent;
  };
  const callErr = async (name, args = {}, bearer = projKey) => {
    const r = (await rpc('tools/call', { name, arguments: args }, bearer)).result;
    assert.equal(r.isError, true, `${name} should have failed`);
    return r.structuredContent.error;
  };

  try {
    // 1. Verify all 9 FlowChart & Project-Definition tools appear in tools/list
    const listed = (await rpc('tools/list')).result.tools.map(t => t.name);
    for (const expected of [
      'uiux_list_flowcharts',
      'uiux_get_flowchart',
      'uiux_create_flowchart',
      'uiux_update_flowchart',
      'uiux_flowchart_op',
      'uiux_delete_flowchart',
      'uiux_materialize_flowchart',
      'uiux_reverse_engineer_flowchart',
      'uiux_export_project_definition'
    ]) {
      assert.ok(listed.includes(expected), `missing MCP tool: ${expected}`);
    }

    // 2. AI agent creates a conceptual FlowChart via MCP
    const createdRes = await callOk('uiux_create_flowchart', {
      name: 'Subscription Billing Flow',
      description: 'Conceptual UI + Backend workflow for plan selection, Stripe checkout, and role-based billing portal.',
      domain: 'fullstack',
      nodes: [
        {
          nodeKey: 'plans-screen',
          kind: 'screen',
          title: 'Pricing Plans Screen',
          description: 'Shows Free, Pro, and Team plan cards with feature comparison.',
          ports: [{ key: 'upgrade-pro', label: 'Select Pro Plan', kind: 'button', description: 'Starts Pro subscription.' }]
        },
        {
          nodeKey: 'billing-portal',
          kind: 'screen',
          title: 'Billing Settings Screen',
          description: 'Shows current subscription, invoices, and payment method.'
        }
      ],
      edges: [
        {
          fromNodeKey: 'plans-screen',
          fromPortKey: 'upgrade-pro',
          toNodeKey: 'billing-portal',
          label: 'Subscribe',
          transitionText: 'Creates checkout session and upgrades subscription.'
        }
      ],
      autoLayout: true
    });
    const fcKey = createdRes.flowchart.key;
    assert.equal(fcKey, 'adasaas-flowchart-subscription-billing-flow');

    // 3. Interactive ComfyUI graph ops via `uiux_flowchart_op`: add backend step, split edge into Decision, set role variants, approve!
    const edgeKey = createdRes.flowchart.edges[0].edgeKey;
    const opsOut = await callOk('uiux_flowchart_op', {
      ref: fcKey,
      ops: [
        {
          op: 'insert_decision_on_edge',
          edgeKey,
          decisionTitle: 'Payment & Quota Check',
          cases: [
            { key: 'paid', label: 'Payment Succeeded', toNodeKey: 'billing-portal', description: 'Provision Pro tier and redirect to Billing Settings' },
            { key: 'failed', label: 'Payment Failed', toNodeKey: 'plans-screen', description: 'Show decline alert on Pricing Plans' }
          ]
        },
        {
          op: 'set_role_variant',
          nodeKey: 'billing-portal',
          allowedRoles: ['user', 'pro', 'admin'],
          deniedBehavior: 'login-prompt',
          roleKey: 'admin',
          summary: 'Shows organization-wide seats, tax IDs, and refund override controls.',
          addedFeatures: 'Seat management, Refund button, Invoice CSV export'
        },
        {
          op: 'set_role_variant',
          nodeKey: 'billing-portal',
          roleKey: 'user',
          summary: 'Shows personal plan status and Upgrade CTA.',
          hiddenFeatures: 'Organization seat controls & refund tools'
        },
        { op: 'auto_layout', direction: 'LR' },
        { op: 'approve', approvalNote: 'Approved via MCP test suite.' }
      ]
    });
    assert.equal(opsOut.flowchart.status, 'approved');
    assert.equal(opsOut.flowchart.nodes.length, 3);

    // 4. Inspect role-preview evaluation via `uiux_get_flowchart`
    const adminEval = await callOk('uiux_get_flowchart', { ref: fcKey, rolePreview: 'admin' });
    const portalAdmin = adminEval.roleEvaluatedNodes.find(n => n.nodeKey === 'billing-portal');
    assert.equal(portalAdmin.accessible, true);
    assert.match(portalAdmin.effectiveDescription, /Refund button/);

    // 5. Materialize approved flowchart into visual UI Screens + Workflow (works with account key too!)
    const matOut = await callOk('uiux_materialize_flowchart', { project: adaProj.key, ref: fcKey }, accKey);
    assert.equal(matOut.createdScreens.length, 2);
    assert.ok(matOut.workflow?.key);

    // 6. Reverse-engineer an external app spec via MCP
    const revOut = await callOk('uiux_reverse_engineer_flowchart', {
      mode: 'app-spec',
      name: 'Webhook Sync Pipeline',
      domain: 'backend',
      endpoints: [
        { key: 'stripe-webhook', method: 'POST', path: '/api/webhooks/stripe', title: 'Receive Stripe Event', description: 'Verifies HMAC signature.' },
        { key: 'update-entitlements', method: 'POST', path: '/internal/entitlements', title: 'Update User Tier', dbTables: ['subscriptions', 'users'] }
      ],
      transitions: [
        { from: 'stripe-webhook', port: 'verified', to: 'update-entitlements', label: 'Signature Valid', transitionText: 'Parses event payload and updates entitlements idempotently.' }
      ]
    });
    assert.equal(revOut.flowchart.nodes.length, 2);
    assert.equal(revOut.flowchart.edges.length, 1);

    // 7. Export complete project-definition.md & read MCP resources (`uiux://project/flowcharts` & `uiux://project/definition`)
    const defOut = await callOk('uiux_export_project_definition', { format: 'both' });
    assert.match(defOut.markdown, /Subscription Billing Flow/);
    assert.match(defOut.markdown, /Webhook Sync Pipeline/);

    const fcResource = await rpc('resources/read', { uri: 'uiux://project/flowcharts' });
    assert.equal(JSON.parse(fcResource.result.contents[0].text).flowcharts.length, 2);

    const defResource = await rpc('resources/read', { uri: 'uiux://project/definition' });
    assert.match(defResource.result.contents[0].text, /# Project Definition: Ada SaaS/);

    // 8. Cross-tenant isolation: Bob cannot read or mutate Ada's flowcharts
    await callErr('uiux_get_flowchart', { ref: fcKey }, bobKey);
    await callErr('uiux_update_flowchart', { ref: fcKey, name: 'Hijack' }, bobKey);

    // 9. Delete to Trash & restore via `uiux_delete_flowchart`
    const delOut = await callOk('uiux_delete_flowchart', { ref: revOut.flowchart.key });
    assert.ok(delOut.trashId > 0);
    const resOut = await callOk('uiux_delete_flowchart', { restore: true, trashId: delOut.trashId });
    assert.equal(resOut.item.key, revOut.flowchart.key);
  } finally {
    await new Promise(r => server.close(r));
    c.close();
  }
});
