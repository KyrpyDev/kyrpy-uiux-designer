/**
 * Unified Client-Side AI Studio & Runtime Generator Modal (`✨ AI Studio`).
 * Connects UI Designer (Path/Icon/Button/Element/Screen) + Conceptual FlowChart Designer to all 4 pathways:
 *   1. Google Gemini API (BYOK — AI Studio, direct browser `fetch`, key never sent to `/api/*`)
 *   2. Chrome Built-in AI (`window.LanguageModel` — on-device Gemini Nano, zero key)
 *   3. Local Ollama / LM Studio / OpenAI-Compatible (`localhost:11434`, `localhost:1234`, OpenRouter, Groq, OpenAI)
 *   4. In-Browser WebGPU (`@mlc-ai/web-llm` quantized local model) + Official Subscription MCP Bridge (`/mcp`)
 */
import { h, clear, modal, toast } from '../dom.js';
import { api } from '../api.js';
import { state, emit } from '../state.js';
import { rememberName } from '../edited.js';
import { reloadLibrary } from '../actions.js';
import { startScreenProgress } from './screen-progress.js';
import { TYPES } from '/domain/entities.js';
import { FLOWCHART_DOMAINS } from '/domain/flowchart.js';
import {
  AI_PROVIDERS,
  GEMINI_MODELS,
  WEBLLM_MODELS,
  mergeGeminiModels,
  buildDesignGenerationPrompt,
  sanitizeGeneratedDesign,
  buildFlowchartGenerationPrompt,
  sanitizeGeneratedFlowchart
} from '/domain/ai-runtime-spec.js';
import {
  loadAiConfig,
  saveAiConfig,
  loadAiSecrets,
  saveAiSecrets,
  clearAiSecrets,
  probeClientAiStatus,
  generateWithClientAi,
  ensureWebGpuEngine,
  testGeminiByok,
  discoverOpenAiCompatModels
} from '../ai-client-runtime.js';

const UI_PRESETS = {
  screen: [
    'Modern SaaS Analytics Dashboard with top header, 3 KPI metric cards, revenue chart card, and recent activity list',
    'Clean Sign-In & OAuth Screen with email/password inputs, Forgot Password link, primary Sign In CTA, and Google/GitHub buttons',
    'Mobile FinTech Wallet Home Screen with balance hero card, Quick Send/Receive/Swap action buttons, and transactions feed',
    'User Profile & Role Settings Screen with avatar header, account details card, notification toggles, and Save button'
  ],
  element: [
    'Pricing Tier Card (Pro Plan) with title, $29/mo price, 4 feature rows, and primary Upgrade CTA button',
    'Confirmation Modal Dialog with warning badge, title, body copy, Cancel button, and primary Confirm button',
    'Search & Filter Top Bar with search input field, category pill chips, and New Item CTA button'
  ],
  button: [
    'Primary Rounded Action Button ("Create Project") with subtle accent border and centered bold label',
    'Split Dropdown Menu Button ("Actions ▾") with menu items for Edit, Duplicate, Share, and Archive'
  ],
  icon: [
    'Minimalist geometric Rocket launch icon (24x24 clean stroke paths)',
    'Clean Shield Checkmark security badge icon (24x24 stroke)'
  ],
  path: [
    'Smooth decorative wave divider vector path (24x24)',
    'Crisp lightning bolt vector path (24x24)'
  ]
};

const FC_PRESETS = [
  'Full-Stack E-Commerce Checkout: Cart Screen → Address & Promo Validation Step → Payment Gateway Step → Fraud/Payment Decision Router (Approved / 3DS Challenge / Declined) → Order Confirmation Screen, with Guest vs Pro vs Admin role variants',
  'Multi-Tenant SaaS Auth & Onboarding: Sign Up Screen → Verify Email API → Organization Setup Screen → Role Check Decision (Owner / Member / Viewer) → Workspace Dashboard with role-specific admin features',
  'AI Support Ticket Triage: Submit Ticket Screen → Enrichment & Priority Classifier Step → Severity Decision (Critical P1 / Normal / Auto-Resolved) → Agent Queue Screen & Escalation Webhook Step'
];

const ENDPOINT_PRESETS = [
  { label: 'Ollama Local (http://127.0.0.1:11434/v1)', url: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-coder:7b' },
  { label: 'LM Studio Local (http://127.0.0.1:1234/v1)', url: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { label: 'OpenRouter (https://openrouter.ai/api/v1)', url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  { label: 'Groq (https://api.groq.com/openai/v1)', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { label: 'OpenAI (https://api.openai.com/v1)', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
];

function providerBadgeLabel(probe) {
  const p = probe?.config?.provider === 'auto' ? probe?.resolvedProvider : probe?.config?.provider;
  if (!p) return { text: '⚙ Setup AI Runtime or MCP', cls: 'warn' };
  const found = AI_PROVIDERS.find(x => x.id === p);
  const suffix = p === 'gemini-byok' && probe?.config?.geminiModel ? ` · ${probe.config.geminiModel}` : '';
  return { text: `● ${found?.short || p}${suffix}`, cls: 'ok' };
}

function populateGeminiSelect(selEl, mergedList, activeModelId, includeCustom = true) {
  clear(selEl);
  const groups = new Map();
  for (const m of mergedList) {
    const grp = m.tier || 'Gemini Models';
    if (!groups.has(grp)) groups.set(grp, []);
    groups.get(grp).push(m);
  }
  const knownIds = new Set(mergedList.map(m => m.id));
  const isCustom = activeModelId && !knownIds.has(activeModelId);
  for (const [grpLabel, items] of groups.entries()) {
    selEl.append(h('optgroup', { label: grpLabel },
      items.map(m => h('option', { value: m.id, selected: !isCustom && m.id === activeModelId }, m.label))
    ));
  }
  if (includeCustom) {
    selEl.append(h('option', { value: '__custom__', selected: Boolean(isCustom) }, 'Custom / Newly Released Model ID…'));
  } else if (isCustom) {
    selEl.append(h('option', { value: activeModelId, selected: true }, `${activeModelId} (Custom)`));
  }
  return isCustom;
}

async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied to clipboard`, 'ok');
  } catch {
    toast('Clipboard copy blocked — select and copy manually', 'error');
  }
}

/**
 * Generates visual SVG UI nodes onto a single materialized Screen from a FlowChart `screen` node.
 */
export async function generateVisualScreenForFlowchartNode(app, fc, fcNode, {
  extraPrompt = '',
  signal = null,
  onStatus = null
} = {}) {
  let screenId = fcNode.linkedScreenId ? Number(fcNode.linkedScreenId) : null;
  if (!screenId) {
    onStatus?.(`Materializing screen "${fcNode.title}" in project…`, 14);
    const mat = await api.materializeFlowchart(fc.id, { allowUnapproved: true, syncWorkflow: true });
    const updatedFc = mat?.flowchart || await api.flowchart(fc.id);
    const refreshed = (updatedFc.nodes || []).find(n => n.nodeKey === fcNode.nodeKey);
    screenId = refreshed?.linkedScreenId ? Number(refreshed.linkedScreenId) : null;
    if (app.flowchart?.fc?.id === fc.id) {
      app.flowchart.fc = updatedFc;
      app.flowchart.markBaseline();
      app.flowchart.render();
    }
  }
  if (!screenId) throw new Error(`Could not materialize a Screen record for node "${fcNode.title}".`);

  const screenDoc = await api.getDesign('screen', screenId);
  const { systemPrompt, userPrompt, schema, width, height } = buildDesignGenerationPrompt({
    targetType: 'screen',
    mode: 'create',
    width: screenDoc.width || 390,
    height: screenDoc.height || 844,
    prompt: extraPrompt || `Design a complete, production-grade UI screen for "${fcNode.title}" matching its FlowChart specification, interactive ports, and role variants.`,
    libraryCatalog: state.library || {},
    flowchartNodeContext: fcNode
  });

  const aiRes = await generateWithClientAi({
    systemPrompt,
    userPrompt,
    schema,
    signal,
    onStatus: (msg, pct) => onStatus?.(`[${fcNode.title}] ${msg}`, pct)
  });

  const clean = sanitizeGeneratedDesign(aiRes.data, {
    targetType: 'screen',
    width,
    height,
    libraryCatalog: state.library || {}
  });
  if (!clean.nodes.length) throw new Error('AI returned 0 valid design nodes.');

  await api.replaceNodes('screen', screenId, clean.nodes);
  if (clean.descriptionDev) {
    await api.updateDesign('screen', screenId, { descriptionDev: clean.descriptionDev });
  }
  return { screenId, nodesCount: clean.nodes.length, provider: aiRes.provider, model: aiRes.model };
}

/**
 * Opens the Unified AI Studio Modal.
 * @param {object} app Main application controller
 * @param {object} [initialOpts] `{ tab?: 'ui'|'flowchart'|'settings'|'mcp', targetType?: string, mode?: string, fcNodeKey?: string }`
 */
export async function openAiStudioModal(app, initialOpts = {}) {
  let activeTab = initialOpts.tab || (state.mode === 'flowchart' ? 'flowchart' : 'ui');
  let probe = await probeClientAiStatus();
  let busy = false;

  const root = h('div', { class: 'ai-studio-root' });
  const headerStatus = h('button', {
    type: 'button',
    class: 'ai-runtime-pill',
    title: 'Click to configure client-side AI runtime or BYOK keys',
    onclick: () => { activeTab = 'settings'; render(); }
  });
  const quickModelSel = h('select', {
    class: 'fc-toolbar-select',
    title: 'Quick-switch active Gemini model (e.g. Gemini 4 Carbon for deep architecture vs Gemini 3.8 Flash for rapid UI iterations)',
    dataset: { aiField: 'quick-gemini-model' },
    hidden: true,
    onchange: async () => {
      saveAiConfig({ geminiModel: quickModelSel.value });
      await refreshProbe();
      toast(`Active Gemini model: ${quickModelSel.value}`, 'ok', 1600);
    }
  });
  const tabBar = h('div', { class: 'ai-studio-tabs', role: 'tablist' });
  const bodyWrap = h('div', { class: 'ai-studio-body' });
  const inlineMsgEl = h('div', { class: 'ai-status-msg' });
  const inlineFillEl = h('div', { class: 'ai-inline-fill', style: { width: '0%' } });
  const inlineTrackEl = h('div', {
    class: 'ai-inline-track',
    role: 'progressbar',
    'aria-label': 'AI Studio progress',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    hidden: true
  }, inlineFillEl);
  const statusBanner = h('div', { class: 'ai-studio-status', hidden: true }, inlineMsgEl, inlineTrackEl);

  root.append(
    h('div', { class: 'ai-studio-top' },
      h('div', { class: 'ai-studio-subtitle' },
        'Generate theme-adaptive UI Screens, Elements, Icons & Conceptual FlowCharts at runtime in your browser — or bridge your Gemini / Claude / Cursor subscription live via MCP.'
      ),
      h('div', { class: 'row', style: { gap: '6px' } }, quickModelSel, headerStatus)
    ),
    tabBar,
    statusBanner,
    bodyWrap
  );

  const syncQuickModelBar = () => {
    const activeProv = probe?.config?.provider === 'auto' ? probe?.resolvedProvider : probe?.config?.provider;
    const showQuick = activeProv === 'gemini-byok' && activeTab !== 'settings';
    quickModelSel.hidden = !showQuick;
    if (showQuick) {
      const merged = mergeGeminiModels(probe.config?.discoveredGeminiModels || []);
      populateGeminiSelect(quickModelSel, merged, probe.config?.geminiModel || 'gemini-4-carbon', false);
    }
  };

  const setBanner = (msg, kind = 'info', pct = null) => {
    if (!msg) {
      statusBanner.hidden = true;
      inlineMsgEl.textContent = '';
      inlineTrackEl.hidden = true;
      return;
    }
    statusBanner.hidden = false;
    statusBanner.className = `ai-studio-status kind-${kind}`;
    inlineMsgEl.textContent = msg;
    if (kind === 'busy' || typeof pct === 'number') {
      inlineTrackEl.hidden = false;
      const p = typeof pct === 'number' ? Math.max(4, Math.min(100, Math.round(pct))) : (kind === 'ok' ? 100 : 35);
      inlineFillEl.style.width = `${p}%`;
      inlineTrackEl.setAttribute('aria-valuenow', String(p));
    } else if (kind === 'ok') {
      inlineTrackEl.hidden = false;
      inlineFillEl.style.width = '100%';
      inlineTrackEl.setAttribute('aria-valuenow', '100');
    } else {
      inlineTrackEl.hidden = true;
    }
  };

  const refreshProbe = async () => {
    probe = await probeClientAiStatus();
    const badge = providerBadgeLabel(probe);
    headerStatus.textContent = badge.text;
    headerStatus.className = `ai-runtime-pill ${badge.cls}`;
    syncQuickModelBar();
  };

  let closeModalFn = () => {};

  /* ==================== TAB 1: UI DESIGN GENERATOR ==================== */
  const buildUiTab = () => {
    const openDoc = app.designer?.doc || null;
    const openType = app.designer?.type || 'screen';
    let targetType = initialOpts.targetType || (openDoc ? openType : 'screen');
    let genMode = initialOpts.mode || (openDoc && initialOpts.preferRefine ? 'refine' : 'create');

    const typeSel = h('select', { dataset: { aiField: 'ui-type' } },
      ['screen', 'element', 'button', 'icon', 'path'].map(t =>
        h('option', { value: t, selected: t === targetType }, `${TYPES[t]?.label || t} (${TYPES[t]?.size?.join('×')} px)`)
      )
    );
    const modeSel = h('select', { dataset: { aiField: 'ui-mode' } },
      h('option', { value: 'create', selected: genMode === 'create' }, 'Create New Item in Active Project'),
      h('option', { value: 'refine', selected: genMode === 'refine', disabled: !openDoc }, openDoc ? `Refine / Re-layout Open "${openDoc.name}"` : 'Refine Open Design (open an item first)'),
      h('option', { value: 'append', selected: genMode === 'append', disabled: !openDoc }, openDoc ? `Append Elements onto Open "${openDoc.name}"` : 'Append onto Open Design (open an item first)')
    );

    const defSize = TYPES[targetType]?.size || [390, 844];
    const widthIn = h('input', { type: 'number', min: 16, max: 4096, value: String(openDoc && genMode !== 'create' ? openDoc.width : defSize[0]), disabled: TYPES[targetType]?.fixedSize });
    const heightIn = h('input', { type: 'number', min: 16, max: 4096, value: String(openDoc && genMode !== 'create' ? openDoc.height : defSize[1]), disabled: TYPES[targetType]?.fixedSize });

    const promptIn = h('textarea', {
      rows: 5,
      dataset: { aiField: 'ui-prompt' },
      placeholder: 'Describe the screen, card, form, button, or icon to generate (layout, sections, inputs, CTAs, states)…',
      value: initialOpts.prompt || ''
    });

    const chipsWrap = h('div', { class: 'ai-preset-chips' });
    const renderChips = () => {
      clear(chipsWrap);
      for (const sample of (UI_PRESETS[targetType] || UI_PRESETS.screen)) {
        chipsWrap.append(h('button', {
          type: 'button',
          class: 'ai-chip-btn',
          onclick: () => { promptIn.value = sample; promptIn.focus(); }
        }, sample.length > 68 ? `${sample.slice(0, 66)}…` : sample));
      }
    };

    typeSel.onchange = () => {
      targetType = typeSel.value;
      const sz = TYPES[targetType]?.size || [390, 844];
      widthIn.value = String(sz[0]);
      heightIn.value = String(sz[1]);
      widthIn.disabled = Boolean(TYPES[targetType]?.fixedSize);
      heightIn.disabled = Boolean(TYPES[targetType]?.fixedSize);
      renderChips();
    };
    modeSel.onchange = () => {
      genMode = modeSel.value;
      if (genMode !== 'create' && openDoc) {
        typeSel.value = openType;
        targetType = openType;
        widthIn.value = String(openDoc.width);
        heightIn.value = String(openDoc.height);
        renderChips();
      }
    };
    renderChips();

    const genBtn = h('button', {
      type: 'button',
      class: 'btn primary ai-run-btn',
      dataset: { act: 'ai-generate-ui' },
      onclick: async () => {
        if (busy) return;
        const promptText = promptIn.value.trim();
        if (!promptText) return toast('Describe what you want to generate first', 'error');
        busy = true;
        genBtn.disabled = true;
        const activeBadge = probe?.resolvedProvider === 'gemini-byok' ? (probe.config?.geminiModel || 'gemini-4-carbon') : (probe?.resolvedProvider || 'AI');
        const prog = startScreenProgress({
          title: `✨ Generating ${targetType} UI…`,
          detail: 'Compiling design prompt & theme tokens…',
          badge: activeBadge,
          initialPct: 10
        });
        try {
          const isEditingOpen = (genMode === 'refine' || genMode === 'append') && openDoc;
          const effType = isEditingOpen ? openType : targetType;
          const { systemPrompt, userPrompt, schema, width, height } = buildDesignGenerationPrompt({
            targetType: effType,
            mode: isEditingOpen ? genMode : 'create',
            prompt: promptText,
            width: Number(widthIn.value) || undefined,
            height: Number(heightIn.value) || undefined,
            existingDoc: isEditingOpen ? openDoc : null,
            libraryCatalog: state.library || {}
          });

          setBanner('Starting client-side AI generation…', 'busy', 18);
          prog.update({ detail: 'Waiting for AI reasoning & layout synthesis…', pct: 22 });
          const res = await generateWithClientAi({
            systemPrompt,
            userPrompt,
            schema,
            signal: prog.signal,
            onStatus: (msg, pct) => {
              prog.update({ detail: msg, ...(typeof pct === 'number' ? { pct } : {}) });
              setBanner(msg, 'busy', prog.pct);
            }
          });

          prog.update({ detail: 'Sanitizing SVG geometry & resolving library instances…', pct: 90, badge: res.model });
          setBanner('Sanitizing SVG geometry & resolving library instances…', 'busy', 90);
          const clean = sanitizeGeneratedDesign(res.data, {
            targetType: effType,
            width,
            height,
            libraryCatalog: state.library || {}
          });
          if (!clean.nodes.length) throw new Error('AI returned 0 drawable nodes. Try refining your prompt or switching models.');

          if (isEditingOpen) {
            prog.update({ detail: `Updating "${openDoc.name}" on canvas…`, pct: 96 });
            const mergedNodes = genMode === 'append'
              ? [...(openDoc.nodes || []), ...clean.nodes].map((n, idx) => ({ ...n, ord: idx }))
              : clean.nodes;
            await api.replaceNodes(openType, openDoc.id, mergedNodes);
            await app.designer.reload(false);
            app.designer.fit();
            prog.complete(`✓ Updated "${openDoc.name}" (${clean.nodes.length} nodes)`);
            setBanner(`Updated "${openDoc.name}" (${clean.nodes.length} AI nodes via ${res.provider}/${res.model})`, 'ok', 100);
            toast(`✨ Updated "${openDoc.name}" with ${clean.nodes.length} AI nodes`, 'ok');
            closeModalFn();
          } else {
            prog.update({ detail: `Saving new ${effType} "${clean.name}" to project…`, pct: 95 });
            setBanner(`Saving new ${effType} "${clean.name}" to project…`, 'busy', 95);
            const created = await api.createDesign(effType, {
              name: clean.name,
              label: clean.label,
              category: clean.category,
              descriptionDev: clean.descriptionDev,
              width: clean.width,
              height: clean.height,
              projectId: state.activeProjectId || 1,
              visibility: 'project',
              nodes: clean.nodes
            });
            if (effType === 'button' && clean.menuItems?.length) {
              for (const mi of clean.menuItems) {
                try { await api.addMenuItem(created.id, mi); } catch { /* optional */ }
              }
            }
            rememberName(effType, created.id, created.name);
            await reloadLibrary({ silent: true });
            await app.openDesign(effType, created.id);
            prog.complete(`✓ Created ${effType} "${created.name}" (${clean.nodes.length} nodes)`);
            toast(`✨ Created ${effType} "${created.name}" (${clean.nodes.length} nodes via ${res.model})`, 'ok');
            closeModalFn();
          }
        } catch (err) {
          prog.fail(err.message);
          setBanner(err.message, 'error');
          toast(err.message, 'error');
        } finally {
          busy = false;
          genBtn.disabled = false;
        }
      }
    }, '✨ Generate UI Design Now');

    return h('div', { class: 'ai-tab-pane' },
      h('div', { class: 'ai-grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Target Design Type'), typeSel),
        h('label', { class: 'field' }, h('span', {}, 'Generation Action'), modeSel)
      ),
      h('div', { class: 'ai-grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'Width (px)'), widthIn),
        h('label', { class: 'field' }, h('span', {}, 'Height (px)'), heightIn)
      ),
      h('div', { class: 'field' },
        h('span', {}, 'Quick Starter Prompts (click to fill)'),
        chipsWrap
      ),
      h('label', { class: 'field' },
        h('span', {}, 'Design Prompt (Theme-Adaptive SVG + Reusable Library Components)'),
        promptIn
      ),
      h('div', { class: 'ai-pane-footer' },
        h('span', { class: 'muted', style: { fontSize: '11.5px' } },
          'Uses theme tokens ({{bg}}, {{panel}}, {{accent}}, {{text}}) automatically so generated designs work across all 30 dark & light styles.'
        ),
        genBtn
      )
    );
  };

  /* ==================== TAB 2: FLOWCHART & AUTO-SCREENS ==================== */
  const buildFlowchartTab = () => {
    const openFc = app.flowchart?.fc || null;
    const selectedNodeKey = initialOpts.fcNodeKey || (app.flowchart?.sel?.kind === 'node' ? app.flowchart.sel.nodeKey : '');
    let fcMode = initialOpts.fcMode || (initialOpts.fcNodeKey ? 'design-screens' : openFc ? 'expand' : 'create');

    const modeSel = h('select', { dataset: { aiField: 'fc-mode' } },
      h('option', { value: 'create', selected: fcMode === 'create' }, 'Create Complete Conceptual FlowChart from Prompt'),
      h('option', { value: 'expand', selected: fcMode === 'expand', disabled: !openFc },
        openFc ? `Expand Open FlowChart "${openFc.name}"${selectedNodeKey ? ` (from ${selectedNodeKey})` : ''}` : 'Expand Open FlowChart (open a FlowChart first)'),
      h('option', { value: 'design-screens', selected: fcMode === 'design-screens', disabled: !openFc },
        openFc ? `🎨 AI-Build Visual UI Layouts for Screens in "${openFc.name}"` : '🎨 AI-Build Visual UIs from FlowChart (open a FlowChart first)')
    );
    const domainSel = h('select', { dataset: { aiField: 'fc-domain' } },
      FLOWCHART_DOMAINS.map(d => h('option', { value: d.key, selected: d.key === (openFc?.domain || 'fullstack') }, d.label))
    );

    const screenNodes = (openFc?.nodes || []).filter(n => n.kind === 'screen');
    const targetScreenSel = h('select', { dataset: { aiField: 'fc-screen-target' } },
      h('option', { value: '__all__', selected: !selectedNodeKey }, `All Screen Nodes in FlowChart (${screenNodes.length})`),
      ...screenNodes.map(sn => h('option', { value: sn.nodeKey, selected: sn.nodeKey === selectedNodeKey }, `🖥 ${sn.title} (${sn.nodeKey})`))
    );
    const screenPickerWrap = h('label', { class: 'field', hidden: fcMode !== 'design-screens' },
      h('span', {}, 'Target Conceptual Screen(s) to Materialize & AI-Design'),
      targetScreenSel
    );

    const promptIn = h('textarea', {
      rows: 5,
      dataset: { aiField: 'fc-prompt' },
      placeholder: 'Describe the user journey, screens, backend APIs, decision branches, error cases, and role-specific permissions…',
      value: initialOpts.prompt || ''
    });

    const chipsWrap = h('div', { class: 'ai-preset-chips' },
      FC_PRESETS.map(sample => h('button', {
        type: 'button',
        class: 'ai-chip-btn',
        onclick: () => { promptIn.value = sample; promptIn.focus(); }
      }, sample.length > 74 ? `${sample.slice(0, 72)}…` : sample))
    );

    modeSel.onchange = () => {
      fcMode = modeSel.value;
      screenPickerWrap.hidden = fcMode !== 'design-screens';
    };

    const runBtn = h('button', {
      type: 'button',
      class: 'btn primary ai-run-btn',
      dataset: { act: 'ai-generate-flowchart' },
      onclick: async () => {
        if (busy) return;
        busy = true;
        runBtn.disabled = true;
        const activeBadge = probe?.resolvedProvider === 'gemini-byok' ? (probe.config?.geminiModel || 'gemini-4-carbon') : (probe?.resolvedProvider || 'AI');
        const prog = startScreenProgress({
          title: fcMode === 'design-screens' ? '🎨 AI-Designing FlowChart Screens…' : '🔀 AI Building FlowChart…',
          detail: 'Preparing architecture specification…',
          badge: activeBadge,
          initialPct: 8
        });
        try {
          if (fcMode === 'design-screens') {
            if (!openFc) throw new Error('Open a FlowChart first.');
            const targets = targetScreenSel.value === '__all__'
              ? screenNodes
              : screenNodes.filter(n => n.nodeKey === targetScreenSel.value);
            if (!targets.length) throw new Error('This FlowChart has no Screen nodes yet.');

            prog.update({ totalSteps: targets.length, step: 1, pct: 10 });
            let lastScreenId = null;
            let built = 0;
            for (const sn of targets) {
              prog.update({
                step: built + 1,
                totalSteps: targets.length,
                pct: Math.round((built / targets.length) * 90) + 8,
                detail: `Designing visual UI for "${sn.title}" (${built + 1} of ${targets.length})…`
              });
              const r = await generateVisualScreenForFlowchartNode(app, openFc, sn, {
                extraPrompt: promptIn.value.trim(),
                signal: prog.signal,
                onStatus: msg => {
                  prog.update({ detail: msg });
                  setBanner(msg, 'busy', prog.pct);
                }
              });
              lastScreenId = r.screenId;
              built += 1;
            }
            await reloadLibrary({ silent: true });
            prog.complete(`✓ Designed ${built} visual Screen(s) from "${openFc.name}"`);
            toast(`✨ AI-designed ${built} visual Screen(s) from FlowChart "${openFc.name}"`, 'ok');
            if (built === 1 && lastScreenId) {
              await app.openDesign('screen', lastScreenId);
            }
            closeModalFn();
            return;
          }

          const specPrompt = promptIn.value.trim();
          if (!specPrompt) throw new Error('Enter a workflow / architecture prompt first.');

          const { systemPrompt, userPrompt, schema } = buildFlowchartGenerationPrompt({
            mode: fcMode === 'expand' ? 'expand' : 'create',
            prompt: specPrompt,
            domain: domainSel.value,
            existingFlowchart: fcMode === 'expand' ? openFc : null,
            focusNodeKey: selectedNodeKey || null
          });

          setBanner('Generating Conceptual FlowChart with client-side AI…', 'busy', 20);
          prog.update({ detail: 'Synthesizing Screens, Backend Steps, Decisions & Role Variants…', pct: 20 });
          const res = await generateWithClientAi({
            systemPrompt,
            userPrompt,
            schema,
            signal: prog.signal,
            onStatus: (msg, pct) => {
              prog.update({ detail: msg, ...(typeof pct === 'number' ? { pct } : {}) });
              setBanner(msg, 'busy', prog.pct);
            }
          });

          prog.update({ detail: 'Running DAG layout & saving FlowChart…', pct: 92, badge: res.model });
          if (fcMode === 'expand' && openFc) {
            const clean = sanitizeGeneratedFlowchart(res.data, {
              existingNodes: openFc.nodes || [],
              existingEdges: openFc.edges || [],
              autoLayout: true
            });
            const updated = await api.updateFlowchart(openFc.id, {
              nodes: clean.nodes,
              edges: clean.edges
            });
            emit('flowcharts:changed');
            await app.openFlowchart(updated.id);
            prog.complete(`✓ Added ${clean.addedNodesCount} node(s) & ${clean.addedEdgesCount} wire(s)`);
            toast(`✨ Added ${clean.addedNodesCount} node(s) & ${clean.addedEdgesCount} flow wire(s) to "${updated.name}"`, 'ok');
            closeModalFn();
          } else {
            const clean = sanitizeGeneratedFlowchart(res.data, { autoLayout: true });
            const created = await api.createFlowchart({
              name: clean.name,
              label: clean.name,
              description: clean.description,
              domain: domainSel.value || clean.domain,
              accessLevels: clean.accessLevels,
              spec: clean.spec,
              projectId: state.activeProjectId || 1,
              visibility: 'project',
              nodes: clean.nodes,
              edges: clean.edges,
              autoLayout: true
            });
            rememberName('flowchart', created.id, created.name);
            emit('flowcharts:changed');
            await reloadLibrary({ silent: true });
            await app.openFlowchart(created.id);
            prog.complete(`✓ Created FlowChart "${created.name}" (${created.nodes.length} nodes)`);
            toast(`✨ Created FlowChart "${created.name}" (${created.nodes.length} nodes, ${created.edges.length} wires)`, 'ok');
            closeModalFn();
          }
        } catch (err) {
          prog.fail(err.message);
          setBanner(err.message, 'error');
          toast(err.message, 'error');
        } finally {
          busy = false;
          runBtn.disabled = false;
        }
      }
    }, '✨ Run FlowChart AI Builder');

    return h('div', { class: 'ai-tab-pane' },
      h('div', { class: 'ai-grid-2' },
        h('label', { class: 'field' }, h('span', {}, 'FlowChart AI Action'), modeSel),
        h('label', { class: 'field' }, h('span', {}, 'Architecture Domain'), domainSel)
      ),
      screenPickerWrap,
      h('div', { class: 'field' },
        h('span', {}, 'Quick Architecture Blueprints'),
        chipsWrap
      ),
      h('label', { class: 'field' },
        h('span', {}, 'Conceptual Workflow / Screen Styling Instructions'),
        promptIn
      ),
      h('div', { class: 'ai-pane-footer' },
        h('span', { class: 'muted', style: { fontSize: '11.5px' } },
          'Creates Screens, Backend Steps, Decision Routers, Transition descriptions, and Role/Access-Level variants.'
        ),
        runBtn
      )
    );
  };

  /* ==================== TAB 3: RUNTIME & BYOK SETTINGS ==================== */
  const buildSettingsTab = () => {
    const cfg = loadAiConfig();
    const secrets = loadAiSecrets();

    const provSel = h('select', {
      dataset: { aiField: 'provider-select' },
      onchange: async () => {
        saveAiConfig({ provider: provSel.value });
        await refreshProbe();
        if (provSel.value === 'mcp-subscription') {
          activeTab = 'mcp';
          render();
        }
      }
    }, AI_PROVIDERS.map(p => h('option', { value: p.id, selected: p.id === cfg.provider }, `${p.label}`)));

    // 1. Gemini BYOK Card
    const gemKeyIn = h('input', {
      type: 'password',
      placeholder: 'AIzaSy… (Google AI Studio API key — stays in your browser)',
      value: secrets.geminiApiKey || '',
      autocomplete: 'off',
      dataset: { aiField: 'gemini-key' }
    });
    const mergedGemModels = mergeGeminiModels(cfg.discoveredGeminiModels || []);
    const gemModelSel = h('select', { dataset: { aiField: 'gemini-model' } });
    const initialCustom = populateGeminiSelect(gemModelSel, mergedGemModels, cfg.geminiModel || 'gemini-4-carbon', true);
    const gemCustomModelIn = h('input', {
      type: 'text',
      placeholder: 'e.g. gemini-4-carbon or any new AI Studio model ID',
      value: initialCustom ? cfg.geminiModel : '',
      dataset: { aiField: 'gemini-custom-model' }
    });
    const gemCustomWrap = h('label', { class: 'field', hidden: !initialCustom },
      h('span', {}, 'Custom / Preview Gemini Model ID'),
      gemCustomModelIn
    );
    gemModelSel.onchange = () => {
      gemCustomWrap.hidden = gemModelSel.value !== '__custom__';
      if (!gemCustomWrap.hidden) gemCustomModelIn.focus();
    };
    const effectiveGemModel = () => (
      gemModelSel.value === '__custom__'
        ? (gemCustomModelIn.value.trim() || 'gemini-4-carbon')
        : gemModelSel.value
    );

    const rememberChk = h('input', {
      type: 'checkbox',
      checked: Boolean(cfg.rememberSecrets)
    });

    const saveGemBtn = h('button', {
      type: 'button',
      class: 'btn sm primary',
      onclick: async () => {
        const chosenModel = effectiveGemModel();
        const keyTrimmed = gemKeyIn.value.trim();
        saveAiConfig({
          geminiModel: chosenModel,
          rememberSecrets: rememberChk.checked,
          ...(keyTrimmed && cfg.provider === 'auto' ? { provider: 'auto' } : {})
        });
        saveAiSecrets({ ...loadAiSecrets(), geminiApiKey: keyTrimmed }, rememberChk.checked);
        // Automatically sync all account-available models in the background when a key is saved
        if (keyTrimmed) {
          testGeminiByok({ apiKey: keyTrimmed, fetchImpl: window.fetch.bind(window) })
            .then(r => {
              saveAiConfig({ discoveredGeminiModels: r.modelDetails || r.models || [] });
              populateGeminiSelect(gemModelSel, mergeGeminiModels(r.modelDetails || r.models || []), effectiveGemModel(), true);
              refreshProbe();
            })
            .catch(() => {});
        }
        await refreshProbe();
        toast(keyTrimmed ? `Saved Gemini BYOK key (model: ${chosenModel})` : `Gemini model set to ${chosenModel}`, 'ok');
      }
    }, 'Save Key & Model');

    const testGemBtn = h('button', {
      type: 'button',
      class: 'btn sm',
      onclick: async () => {
        try {
          setBanner('Verifying key & syncing available models from generativelanguage.googleapis.com…', 'busy');
          const r = await testGeminiByok({ apiKey: gemKeyIn.value.trim(), fetchImpl: window.fetch.bind(window) });
          const nextModel = effectiveGemModel();
          saveAiConfig({
            discoveredGeminiModels: r.modelDetails || r.models || [],
            geminiModel: nextModel,
            rememberSecrets: rememberChk.checked
          });
          saveAiSecrets({ ...loadAiSecrets(), geminiApiKey: gemKeyIn.value.trim() }, rememberChk.checked);
          const refreshedList = mergeGeminiModels(r.modelDetails || r.models || []);
          const customNow = populateGeminiSelect(gemModelSel, refreshedList, nextModel, true);
          gemCustomWrap.hidden = !customNow;
          await refreshProbe();
          setBanner(`✓ Connected & synced ${r.models.length} generateContent models unlocked on your Google AI Studio account!`, 'ok');
          toast(`Synced ${r.models.length} Gemini models from your account!`, 'ok');
        } catch (err) {
          setBanner(err.message, 'error');
          toast(err.message, 'error');
        }
      }
    }, 'Test & Sync Account Models');

    const clearGemBtn = h('button', {
      type: 'button',
      class: 'btn sm',
      onclick: async () => {
        gemKeyIn.value = '';
        clearAiSecrets();
        await refreshProbe();
        toast('Cleared browser AI keys', 'info');
      }
    }, 'Clear Keys');

    // 2. Chrome Built-in AI (Gemini Nano) Card
    const chromeBadge = h('span', {
      class: `ai-mini-badge ${probe.chrome.supported ? 'ok' : 'muted'}`
    }, probe.chrome.message);

    // 3. Local Ollama / OpenAI-Compatible Card
    const oaiEnabledChk = h('input', {
      type: 'checkbox',
      checked: Boolean(cfg.openAiEnabled)
    });
    const oaiUrlIn = h('input', {
      type: 'text',
      value: cfg.openAiBaseUrl || 'http://127.0.0.1:11434/v1',
      placeholder: 'http://127.0.0.1:11434/v1'
    });
    const oaiModelListId = 'ai-oai-models-datalist';
    const oaiDatalist = h('datalist', { id: oaiModelListId });
    const oaiModelIn = h('input', {
      type: 'text',
      list: oaiModelListId,
      value: cfg.openAiModel || 'qwen2.5-coder:7b',
      placeholder: 'qwen2.5-coder:7b / llama3.2 / gpt-4o-mini'
    });
    const oaiKeyIn = h('input', {
      type: 'password',
      value: secrets.openAiApiKey || '',
      autocomplete: 'off',
      placeholder: 'Optional Bearer key (leave empty for local Ollama / LM Studio)'
    });
    const presetSel = h('select', {
      onchange: () => {
        const hit = ENDPOINT_PRESETS.find(p => p.url === presetSel.value);
        if (hit) {
          oaiUrlIn.value = hit.url;
          oaiModelIn.value = hit.model;
          oaiEnabledChk.checked = true;
        }
      }
    },
      h('option', { value: '' }, 'Quick Endpoint Presets…'),
      ...ENDPOINT_PRESETS.map(p => h('option', { value: p.url }, p.label))
    );

    const saveOaiBtn = h('button', {
      type: 'button',
      class: 'btn sm primary',
      onclick: async () => {
        saveAiConfig({
          openAiEnabled: oaiEnabledChk.checked,
          openAiBaseUrl: oaiUrlIn.value.trim(),
          openAiModel: oaiModelIn.value.trim()
        });
        saveAiSecrets({ ...loadAiSecrets(), openAiApiKey: oaiKeyIn.value.trim() }, rememberChk.checked);
        await refreshProbe();
        toast('Saved Local Ollama / OpenAI-compatible runtime settings', 'ok');
      }
    }, 'Save Endpoint');

    const detectOaiBtn = h('button', {
      type: 'button',
      class: 'btn sm',
      onclick: async () => {
        try {
          setBanner(`Probing models at ${oaiUrlIn.value.trim()}…`, 'busy');
          const r = await discoverOpenAiCompatModels({
            baseUrl: oaiUrlIn.value.trim(),
            apiKey: oaiKeyIn.value.trim(),
            fetchImpl: window.fetch.bind(window)
          });
          clear(oaiDatalist);
          r.models.forEach(m => oaiDatalist.append(h('option', { value: m })));
          if (r.models[0]) oaiModelIn.value = r.models[0];
          oaiEnabledChk.checked = true;
          saveAiConfig({ openAiEnabled: true, openAiBaseUrl: oaiUrlIn.value.trim(), openAiModel: oaiModelIn.value.trim() });
          await refreshProbe();
          setBanner(`✓ Found ${r.models.length} model(s): ${r.models.slice(0, 5).join(', ')}`, 'ok');
          toast(`Detected ${r.models.length} model(s)`, 'ok');
        } catch (err) {
          setBanner(err.message, 'error');
          toast(err.message, 'error');
        }
      }
    }, 'Detect Models');

    // 4. WebGPU In-Browser Card
    const webgpuSel = h('select', {},
      WEBLLM_MODELS.map(m => h('option', { value: m.id, selected: m.id === cfg.webllmModel }, m.label))
    );
    const loadWebGpuBtn = h('button', {
      type: 'button',
      class: 'btn sm',
      disabled: !probe.webgpu.supported,
      onclick: async () => {
        try {
          loadWebGpuBtn.disabled = true;
          saveAiConfig({ webllmModel: webgpuSel.value, provider: 'webgpu-webllm' });
          await ensureWebGpuEngine(webgpuSel.value, msg => setBanner(msg, 'busy'));
          await refreshProbe();
          setBanner(`✓ Loaded ${webgpuSel.value} in browser WebGPU!`, 'ok');
          toast('WebGPU model ready in browser!', 'ok');
        } catch (err) {
          setBanner(err.message, 'error');
          toast(err.message, 'error');
        } finally {
          loadWebGpuBtn.disabled = !probe.webgpu.supported;
        }
      }
    }, probe.webgpu.loadedModel ? `✓ Loaded (${probe.webgpu.loadedModel})` : 'Load Model into Browser WebGPU');

    return h('div', { class: 'ai-tab-pane ai-settings-pane' },
      h('label', { class: 'field' },
        h('span', {}, 'Preferred Client Runtime Provider'),
        provSel
      ),

      // Card 1: Gemini BYOK
      h('div', { class: 'ai-provider-card' },
        h('div', { class: 'row spread' },
          h('strong', {}, '1. Google Gemini API (BYOK — Google AI Studio · Frontier & Preview Models)'),
          h('span', { class: `ai-mini-badge ${probe.hasGeminiKey ? 'ok' : 'muted'}` }, probe.hasGeminiKey ? '✓ Key Set (Client-Only)' : 'No Key Set')
        ),
        h('div', { class: 'muted', style: { fontSize: '11.5px', lineHeight: '1.45' } },
          'Direct HTTPS call from your browser to generativelanguage.googleapis.com (x-goog-api-key header). Includes Gemini 4 Frontier (Carbon, Argon, Hydrogen), Gemini 3.8 Flash, Gemini 3.1 Pro Preview, and Gemini 2.5. Click "Test & Sync Account Models" to pull every preview/tier model unlocked on your AI Studio key — or use the 🔌 Subscription MCP Bridge tab to spend your included Google AI Ultra quota via Antigravity / Gemini CLI!'
        ),
        h('div', { class: 'ai-grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'Gemini API Key'), gemKeyIn),
          h('label', { class: 'field' }, h('span', {}, 'Gemini Model (Frontier / Flash / Synced)'), gemModelSel)
        ),
        gemCustomWrap,
        h('div', { class: 'row spread' },
          h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', cursor: 'pointer' } },
            rememberChk, 'Remember key in this browser (unchecked = session tab only)'
          ),
          h('div', { class: 'row', style: { gap: '6px' } }, testGemBtn, clearGemBtn, saveGemBtn)
        )
      ),

      // Card 2: Chrome Gemini Nano
      h('div', { class: 'ai-provider-card' },
        h('div', { class: 'row spread' },
          h('strong', {}, '2. Chrome Built-in AI (On-Device Gemini Nano — Zero Key)'),
          chromeBadge
        ),
        h('div', { class: 'row spread' },
          h('span', { class: 'muted', style: { fontSize: '11.5px' } },
            'Uses window.LanguageModel inside Chrome 138+ on desktop. Zero API cost, offline-capable.'
          ),
          h('button', {
            type: 'button',
            class: 'btn sm',
            onclick: () => copyText('chrome://flags/#prompt-api-for-gemini-nano', 'Chrome flag URL')
          }, 'Copy chrome://flags URL')
        )
      ),

      // Card 3: Local Ollama / OpenAI-compatible
      h('div', { class: 'ai-provider-card' },
        h('div', { class: 'row spread' },
          h('strong', {}, '3. Local Ollama / LM Studio / OpenAI-Compatible'),
          h('label', { class: 'row', style: { gap: '6px', fontSize: '12px', cursor: 'pointer' } }, oaiEnabledChk, 'Enabled')
        ),
        h('div', { class: 'ai-grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'Quick Preset'), presetSel),
          h('label', { class: 'field' }, h('span', {}, 'Base URL (/v1)'), oaiUrlIn)
        ),
        h('div', { class: 'ai-grid-2' },
          h('label', { class: 'field' }, h('span', {}, 'Model ID'), oaiModelIn, oaiDatalist),
          h('label', { class: 'field' }, h('span', {}, 'API Key (optional for local)'), oaiKeyIn)
        ),
        h('div', { class: 'row spread' },
          h('span', { class: 'muted', style: { fontSize: '11px' } }, 'Tip for local Ollama CORS: run `OLLAMA_ORIGINS=* ollama serve`'),
          h('div', { class: 'row', style: { gap: '6px' } }, detectOaiBtn, saveOaiBtn)
        )
      ),

      // Card 4: WebGPU In-Browser
      h('div', { class: 'ai-provider-card' },
        h('div', { class: 'row spread' },
          h('strong', {}, '4. In-Browser WebGPU Engine (@mlc-ai/web-llm)'),
          h('span', { class: `ai-mini-badge ${probe.webgpu.supported ? 'ok' : 'muted'}` },
            probe.webgpu.supported ? 'WebGPU Supported' : 'WebGPU Not Detected')
        ),
        h('div', { class: 'row spread' },
          webgpuSel,
          loadWebGpuBtn
        )
      )
    );
  };

  /* ==================== TAB 4: SUBSCRIPTION MCP BRIDGE ==================== */
  const buildMcpTab = () => {
    const activeProj = (state.projects || []).find(p => Number(p.id) === Number(state.activeProjectId)) || { id: state.activeProjectId || 1, name: 'Active Project' };
    const openFc = app.flowchart?.fc;
    const openDesign = app.designer?.doc;

    const contextPrompt = openFc
      ? `Connect to the kyrpy-uiux-designer MCP server for project "${activeProj.name}" (#${activeProj.id}). Read FlowChart "${openFc.name}" (id=${openFc.id}, resource uiux://flowchart/${openFc.key}) and uiux://project/definition. Materialize its screens with materialize_flowchart and build rich theme-adaptive UI layouts onto each linked screen!`
      : openDesign
        ? `Connect to the kyrpy-uiux-designer MCP server for project "${activeProj.name}" (#${activeProj.id}). Inspect open ${app.designer.type} "${openDesign.name}" (id=${openDesign.id}) and enhance its visual layout using theme tokens ({{bg}}, {{panel}}, {{accent}}, {{text}}) so it updates live on my open canvas.`
        : `Connect to the kyrpy-uiux-designer MCP server for project "${activeProj.name}" (#${activeProj.id}). Create a conceptual FlowChart with create_flowchart (screens, backend API steps, decision routers, and role variants), then materialize and design its UI screens!`;

    const promptBoxEl = h('textarea', { rows: 4, readonly: true, value: contextPrompt, onfocus: e => e.target.select() });

    return h('div', { class: 'ai-tab-pane' },
      h('div', { class: 'ai-provider-card' },
        h('strong', {}, 'Use Your Existing Gemini / Antigravity / Claude / Cursor Subscription Live'),
        h('p', { class: 'muted', style: { margin: '6px 0', fontSize: '12px', lineHeight: '1.5' } },
          'Consumer subscriptions (Google One AI Pro, Gemini CLI, Antigravity, Claude Pro/Max, Cursor) forbid third-party web pages from extracting OAuth session cookies — instead, they natively support MCP! Connect your official CLI/IDE once to `/mcp`, and every design or flowchart it creates streams onto your open browser canvas in real time via SSE.'
        ),
        h('div', { class: 'row', style: { gap: '8px', marginTop: '8px' } },
          h('button', {
            type: 'button',
            class: 'btn primary',
            dataset: { act: 'open-mcp-keys' },
            onclick: () => {
              import('/mcp-web/ai-keys-modal.js')
                .then(m => m.openAiKeysModal())
                .catch(e => toast(`AI Access Keys: ${e.message}`, 'error'));
            }
          }, '🔑 Open AI Access Keys & 1-Click MCP Setup Script'),
          h('a', { class: 'btn', href: '/docs/mcp', target: '_blank', rel: 'noopener' }, '📖 View Live /docs/mcp Reference ↗')
        )
      ),
      h('div', { class: 'ai-provider-card' },
        h('div', { class: 'row spread' },
          h('strong', {}, 'Ready-to-Paste Prompt for Gemini CLI / Antigravity / Claude Code / Cursor'),
          h('button', {
            type: 'button',
            class: 'btn sm primary',
            onclick: () => copyText(promptBoxEl.value, 'Live MCP task prompt')
          }, 'Copy Prompt')
        ),
        promptBoxEl
      )
    );
  };

  const TABS = [
    ['ui', '✨ UI Designer AI'],
    ['flowchart', '🔀 FlowChart & Screens AI'],
    ['settings', '⚙ Runtime & BYOK Keys'],
    ['mcp', '🔌 Subscription MCP Bridge']
  ];

  const render = () => {
    const badge = providerBadgeLabel(probe);
    headerStatus.textContent = badge.text;
    headerStatus.className = `ai-runtime-pill ${badge.cls}`;
    syncQuickModelBar();

    clear(tabBar);
    for (const [id, label] of TABS) {
      tabBar.append(h('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': String(activeTab === id),
        class: `ai-studio-tab${activeTab === id ? ' active' : ''}`,
        dataset: { aiTab: id },
        onclick: () => {
          activeTab = id;
          setBanner('');
          render();
        }
      }, label));
    }

    clear(bodyWrap);
    if (activeTab === 'ui') bodyWrap.append(buildUiTab());
    else if (activeTab === 'flowchart') bodyWrap.append(buildFlowchartTab());
    else if (activeTab === 'settings') bodyWrap.append(buildSettingsTab());
    else bodyWrap.append(buildMcpTab());
  };

  render();

  const m = modal({
    title: '✨ AI Studio — Client-Side Runtime & MCP Generator',
    wide: true,
    content: root,
    actions: close => {
      closeModalFn = close;
      return [h('button', { class: 'btn', onclick: close }, 'Close')];
    }
  });
  return m;
}
