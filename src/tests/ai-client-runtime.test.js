import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DESIGN_RESPONSE_SCHEMA,
  FLOWCHART_RESPONSE_SCHEMA,
  extractJsonObject,
  buildDesignGenerationPrompt,
  sanitizeGeneratedDesign,
  buildFlowchartGenerationPrompt,
  sanitizeGeneratedFlowchart
} from '../domain/ai-runtime-spec.js';

import {
  toGeminiResponseSchema,
  callGeminiByok,
  testGeminiByok,
  detectChromeBuiltInAi,
  callChromeBuiltInAi,
  discoverOpenAiCompatModels,
  callOpenAiCompat,
  resolveAutoProvider,
  executeClientAiStructured
} from '../domain/ai-runtime-engine.js';

describe('Client-Side AI Runtime Spec & Sanitizers', () => {
  it('extracts JSON from clean text, markdown fences, and trailing-comma prose wrappers', () => {
    assert.deepEqual(extractJsonObject('{"name":"Alpha","nodes":[]}'), { name: 'Alpha', nodes: [] });
    assert.deepEqual(
      extractJsonObject('Here is your layout:\n```json\n{"name":"Beta","nodes":[{"tag":"rect","name":"box",},]}\n```\nEnjoy!'),
      { name: 'Beta', nodes: [{ tag: 'rect', name: 'box' }] }
    );
  });

  it('builds prompts and sanitizes theme-adaptive Screen designs with library instance resolution', () => {
    const libraryCatalog = {
      icons: [{ id: 42, key: 'lucide-rocket', name: 'Rocket', width: 24, height: 24 }],
      buttons: [{ id: 77, key: 'primary-cta', name: 'Primary CTA', width: 160, height: 44 }]
    };

    const promptPack = buildDesignGenerationPrompt({
      targetType: 'screen',
      mode: 'create',
      prompt: 'Create a launch screen with rocket icon and primary button',
      libraryCatalog
    });
    assert.match(promptPack.systemPrompt, /lucide-rocket/);
    assert.match(promptPack.systemPrompt, /\{\{accent\}\}/);

    const clean = sanitizeGeneratedDesign({
      name: 'Launch Pad Screen',
      category: 'Onboarding',
      nodes: [
        { tag: 'rect', name: 'hero-card', role: 'card', x: 20, y: 60, width: 350, height: 180, fill: '{{panel}}' },
        { tag: 'text', name: 'hero-title', text: 'Welcome Aboard', x: 40, y: 110, fontSize: 24, fontWeight: '700', fill: '{{text}}' },
        { kind: 'instance', tag: 'use', refType: 'icon', refKey: 'lucide-rocket', name: 'rocket-ic', x: 40, y: 140, width: 28, height: 28 },
        { tag: 'rect', name: 'bad-color', x: 10, y: 10, width: 20, height: 20, fill: 'javascript:alert(1)' }
      ]
    }, { targetType: 'screen', width: 390, height: 844, libraryCatalog });

    assert.equal(clean.width, 390);
    assert.equal(clean.height, 844);
    // Auto-prepended screen-bg + 4 nodes = 5 nodes
    assert.equal(clean.nodes.length, 5);
    assert.equal(clean.nodes[0].role, 'bg');
    const rocketInst = clean.nodes.find(n => n.kind === 'instance');
    assert.ok(rocketInst);
    assert.equal(rocketInst.refId, 42);
    assert.equal(rocketInst.refType, 'icon');
    const sanitizedBad = clean.nodes.find(n => n.name === 'bad-color');
    assert.equal(sanitizedBad.attrs.fill, '{{accent}}');
  });

  it('sanitizes generated Conceptual FlowCharts with decision routers, role variants, and DAG layout', () => {
    const promptPack = buildFlowchartGenerationPrompt({
      mode: 'create',
      domain: 'fullstack',
      prompt: 'Checkout with payment decision'
    });
    assert.match(promptPack.systemPrompt, /decision/);

    const fc = sanitizeGeneratedFlowchart({
      name: 'AI Checkout Flow',
      domain: 'fullstack',
      nodes: [
        {
          nodeKey: 'cart-screen',
          kind: 'screen',
          title: 'Cart Screen',
          description: 'Displays items and checkout CTA',
          roleVariants: [
            { roleKey: 'guest', summary: 'Shows Sign-In upsell banner', hiddenFeatures: 'Saved cards' },
            { roleKey: 'pro', summary: 'One-click express checkout enabled', addedFeatures: 'Express Pay' }
          ],
          ports: [{ key: 'pay-now', label: 'Pay Now', kind: 'submit' }]
        },
        {
          nodeKey: 'pay-check',
          kind: 'decision',
          title: 'Payment Authorized?',
          description: 'Routes on gateway outcome',
          ports: [
            { key: 'approved', label: 'Approved', kind: 'case' },
            { key: 'declined', label: 'Declined', kind: 'case' }
          ]
        },
        {
          nodeKey: 'receipt-screen',
          kind: 'screen',
          title: 'Order Receipt',
          description: 'Shows confirmation number'
        }
      ],
      edges: [
        { fromNodeKey: 'cart-screen', fromPortKey: 'pay-now', toNodeKey: 'pay-check', transitionText: 'Submits tokenized card to payment API' },
        { fromNodeKey: 'pay-check', fromPortKey: 'approved', toNodeKey: 'receipt-screen', transitionText: 'Creates order record and navigates to receipt' }
      ]
    });

    assert.equal(fc.nodes.length, 3);
    assert.equal(fc.edges.length, 2);
    const cart = fc.nodes.find(n => n.nodeKey === 'cart-screen');
    assert.equal(cart.roleSettings.variants.pro.addedFeatures, 'Express Pay');
    assert.ok(fc.edges.every(e => e.toPortKey === 'home'));
  });
});

describe('Client-Side Multi-Provider AI Execution Engine', () => {
  it('converts JSON Schema to Gemini uppercase OpenAPI Schema and sends x-goog-api-key header (never query string or /api/*)', async () => {
    const gemSchema = toGeminiResponseSchema(DESIGN_RESPONSE_SCHEMA);
    assert.equal(gemSchema.type, 'OBJECT');
    assert.equal(gemSchema.properties.nodes.type, 'ARRAY');

    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, init });
      assert.ok(!String(url).includes('AIzaSecretKey'), 'API key must not leak in URL query string');
      assert.ok(!String(url).startsWith('/api/'), 'Client BYOK request must never hit Designer /api/*');
      assert.equal(init.headers['x-goog-api-key'], 'AIzaSecretKey');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"name":"Gemini Screen","nodes":[{"tag":"rect","name":"card"}]}' }] } }]
        })
      };
    };

    const res = await callGeminiByok({
      apiKey: 'AIzaSecretKey',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Sys',
      userPrompt: 'Build screen',
      schema: DESIGN_RESPONSE_SCHEMA,
      fetchImpl: mockFetch
    });
    assert.equal(calls.length, 1);
    assert.equal(res.provider, 'gemini-byok');
    assert.equal(res.data.name, 'Gemini Screen');

    const keyProbe = await testGeminiByok({
      apiKey: 'AIzaSecretKey',
      fetchImpl: async (url, init) => {
        assert.equal(init.headers['x-goog-api-key'], 'AIzaSecretKey');
        return {
          ok: true,
          status: 200,
          json: async () => ({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] })
        };
      }
    });
    assert.deepEqual(keyProbe.models, ['gemini-2.5-flash']);
  });

  it('supports Chrome Built-in AI (window.LanguageModel — Gemini Nano) with session cleanup', async () => {
    let destroyed = false;
    const mockGlobal = {
      LanguageModel: {
        availability: async () => 'available',
        create: async () => ({
          prompt: async (_prompt, opts) => {
            assert.ok(opts?.responseConstraint);
            return '{"name":"Nano Icon","nodes":[{"tag":"circle","name":"dot","cx":12,"cy":12,"r":6}]}';
          },
          destroy: () => { destroyed = true; }
        })
      }
    };

    const status = await detectChromeBuiltInAi(mockGlobal);
    assert.equal(status.supported, true);
    assert.equal(status.status, 'available');

    const res = await callChromeBuiltInAi({
      systemPrompt: 'Icon builder',
      userPrompt: 'Dot icon',
      schema: DESIGN_RESPONSE_SCHEMA,
      globalObj: mockGlobal
    });
    assert.equal(res.provider, 'chrome-nano');
    assert.equal(res.data.name, 'Nano Icon');
    assert.equal(destroyed, true);
  });

  it('discovers Ollama / OpenAI-compatible models and retries cleanly if response_format is rejected', async () => {
    const modelsRes = await discoverOpenAiCompatModels({
      baseUrl: 'http://127.0.0.1:11434/v1',
      fetchImpl: async url => {
        if (url.endsWith('/v1/models')) return { ok: false, status: 404, json: async () => ({}) };
        if (url.endsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({ models: [{ name: 'qwen2.5-coder:7b' }] }) };
        throw new Error(`Unexpected URL ${url}`);
      }
    });
    assert.deepEqual(modelsRes.models, ['qwen2.5-coder:7b']);

    let attempt = 0;
    const chatRes = await callOpenAiCompat({
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5-coder:7b',
      systemPrompt: 'Flow builder',
      userPrompt: 'Simple flow',
      schema: FLOWCHART_RESPONSE_SCHEMA,
      fetchImpl: async (_url, init) => {
        attempt += 1;
        const body = JSON.parse(init.body);
        if (attempt === 1) {
          assert.deepEqual(body.response_format, { type: 'json_object' });
          return { ok: false, status: 400, json: async () => ({ error: 'response_format unsupported' }) };
        }
        assert.equal(body.response_format, undefined);
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '{"name":"Local Flow","nodes":[],"edges":[]}' } }] })
        };
      }
    });
    assert.equal(attempt, 2);
    assert.equal(chatRes.provider, 'openai-compat');
    assert.equal(chatRes.data.name, 'Local Flow');
  });

  it('routes auto provider across Gemini BYOK -> Chrome Nano -> Ollama -> WebGPU and blocks /api/* URLs', async () => {
    assert.equal(resolveAutoProvider({
      config: { provider: 'auto' },
      secrets: { geminiApiKey: 'AIza...' },
      chromeStatus: { supported: true, status: 'available' }
    }), 'gemini-byok');

    assert.equal(resolveAutoProvider({
      config: { provider: 'auto', openAiEnabled: false },
      secrets: {},
      chromeStatus: { supported: true, status: 'available' }
    }), 'chrome-nano');

    assert.equal(resolveAutoProvider({
      config: { provider: 'auto', openAiEnabled: false },
      secrets: {},
      chromeStatus: { supported: false, status: 'unavailable' },
      webgpuLoaded: true
    }), 'webgpu-webllm');

    const webgpuOut = await executeClientAiStructured({
      config: { provider: 'auto', webllmModel: 'Qwen2.5-3B-Instruct-q4f16_1-MLC' },
      secrets: {},
      globalObj: {},
      webgpuLoaded: true,
      webgpuRunner: async ({ model }) => ({ provider: 'webgpu-webllm', model, data: { name: 'WebGPU Card', nodes: [] } })
    });
    assert.equal(webgpuOut.provider, 'webgpu-webllm');

    await assert.rejects(
      () => callOpenAiCompat({ baseUrl: '/api/evil-leak', fetchImpl: async () => ({ ok: true }) }),
      /Security policy violation/
    );
  });

  it('wires AI Studio into main topbar, Designer docbar, and FlowChartDesigner toolbar', () => {
    const readWeb = rel => readFileSync(fileURLToPath(new URL(`../interfaces/web/${rel}`, import.meta.url)), 'utf8');
    const mainJs = readWeb('js/main.js');
    const designerJs = readWeb('js/components/designer.js');
    const fcJs = readWeb('js/components/flowchart-designer.js');
    const studioJs = readWeb('js/components/ai-studio-modal.js');

    assert.match(mainJs, /openAiStudioModal/);
    assert.match(mainJs, /topbar-ai-btn/);
    assert.match(designerJs, /dz-ai-studio/);
    assert.match(fcJs, /fc-ai-studio/);
    assert.match(fcJs, /fc-ai-screen-btn/);
    assert.match(studioJs, /Subscription MCP Bridge/);

    // Verify every named import from state.js in ai-studio-modal.js actually exists in state.js
    const stateSrc = readWeb('js/state.js');
    const stateExports = new Set([...stateSrc.matchAll(/export (?:const|let|function|async function) (\w+)/g)].map(m => m[1]));
    for (const m of studioJs.matchAll(/import \{([^}]*)\} from '\.\.\/state\.js'/g)) {
      for (const sym of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        assert.ok(stateExports.has(sym), `ai-studio-modal.js imported "${sym}" from state.js, which is not exported there`);
      }
    }
  });
});
