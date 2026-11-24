/**
 * Pure domain prompt compilers, JSON Schemas, JSON extractors, and strict entity sanitizers
 * for Client-Side Runtime AI Generation (Gemini BYOK, Chrome Built-in Gemini Nano, Local Ollama/OpenAI-compatible, and WebGPU).
 * Zero Node-only imports; shared by `/domain/ai-runtime-spec.js` in the browser and unit tests.
 */
import { TYPES, NODE_TAGS, canContain, normalizeNode, normalizeMenuItem } from './entities.js';
import {
  HOME_PORT_KEY,
  DEFAULT_ACCESS_LEVELS,
  normalizeFlowchartNode,
  normalizeFlowchartEdge,
  autoLayoutFlowchart
} from './flowchart.js';
import { slugify } from './naming.js';

export const SURFACE_ROLES = ['bg', 'bg-glow', 'card', 'button', 'field', 'pill', 'divider', 'frame', 'container', 'repeater', 'icon', 'label'];

export const AI_PROVIDERS = [
  {
    id: 'auto',
    label: 'Auto (Best Available Client Runtime)',
    short: 'Auto',
    description: 'Automatically picks Gemini API BYOK → Local Ollama/OpenAI → Chrome Built-in Gemini Nano → WebGPU.'
  },
  {
    id: 'gemini-byok',
    label: 'Google Gemini API (BYOK — AI Studio)',
    short: 'Gemini BYOK',
    description: 'Direct browser HTTPS call to generativelanguage.googleapis.com using your personal AI Studio key (kept strictly in your browser).'
  },
  {
    id: 'chrome-nano',
    label: 'Chrome Built-in AI (Gemini Nano On-Device)',
    short: 'Gemini Nano',
    description: 'Zero-key, zero-cost local inference inside Chrome via window.LanguageModel (WebGPU/CPU).'
  },
  {
    id: 'openai-compat',
    label: 'Local Ollama / LM Studio / OpenAI-Compatible',
    short: 'Ollama / OpenAI',
    description: 'Direct browser call to localhost:11434 (Ollama), localhost:1234 (LM Studio), OpenRouter, Groq, OpenAI, or DeepSeek.'
  },
  {
    id: 'webgpu-webllm',
    label: 'In-Browser WebGPU (WebLLM Quantized Model)',
    short: 'WebGPU Local',
    description: 'Downloads and runs a compact open-weights model directly inside this browser tab via WebGPU (no key, no local server).'
  },
  {
    id: 'mcp-subscription',
    label: 'Official Subscription Bridge (Live MCP Sync)',
    short: 'MCP Subscription',
    description: 'Uses your existing Gemini / Antigravity / Claude / Cursor subscription via live /mcp sync onto the open canvas.'
  }
];

export const GEMINI_MODELS = [
  // Gemini 4 Frontier Series — Best reasoning, architecture & full-stack UI generation
  { id: 'gemini-4-carbon', tier: 'Gemini 4 Frontier (Best)', label: 'Gemini 4 Carbon (★ Best Flagship Default — Deepest Architecture & Full-Stack Reasoning)' },
  { id: 'gemini-4-argon', tier: 'Gemini 4 Frontier (Best)', label: 'Gemini 4 Argon (Frontier Engineering — Fast Heavyweight UI & Code)' },
  { id: 'gemini-4-hydrogen', tier: 'Gemini 4 Frontier (Best)', label: 'Gemini 4 Hydrogen (1M Context Agentic — Rapid Multi-Step Workflows)' },
  // Gemini 3.x Pro, Flash & Lite Series
  { id: 'gemini-3.8-flash', tier: 'Gemini 3.x Series', label: 'Gemini 3.8 Flash (High-Speed 1M Reasoning Workhorse)' },
  { id: 'gemini-3.7-flash', tier: 'Gemini 3.x Series', label: 'Gemini 3.7 Flash' },
  { id: 'gemini-3.6-flash', tier: 'Gemini 3.x Series', label: 'Gemini 3.6 Flash' },
  { id: 'gemini-3.5-flash', tier: 'Gemini 3.x Series', label: 'Gemini 3.5 Flash' },
  { id: 'gemini-3.5-flash-lite', tier: 'Gemini 3.x Series', label: 'Gemini 3.5 Flash-Lite (Ultra-Fast / High Free-Tier Quota)' },
  { id: 'gemini-3.1-pro-preview', tier: 'Gemini 3.x Series', label: 'Gemini 3.1 Pro Preview (Advanced Multimodal & Complex Layout)' },
  { id: 'gemini-3.1-pro-preview-customtools', tier: 'Gemini 3.x Series', label: 'Gemini 3.1 Pro CustomTools Preview' },
  { id: 'gemini-3.1-flash-lite', tier: 'Gemini 3.x Series', label: 'Gemini 3.1 Flash-Lite' },
  // Gemini 2.5 & 2.0 Series
  { id: 'gemini-2.5-pro', tier: 'Gemini 2.5 & 2.0 Series', label: 'Gemini 2.5 Pro (Complex Layout & Architecture)' },
  { id: 'gemini-2.5-flash', tier: 'Gemini 2.5 & 2.0 Series', label: 'Gemini 2.5 Flash (Balanced Speed & Free Tier)' },
  { id: 'gemini-2.5-flash-lite', tier: 'Gemini 2.5 & 2.0 Series', label: 'Gemini 2.5 Flash-Lite' },
  { id: 'gemini-2.0-flash', tier: 'Gemini 2.5 & 2.0 Series', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', tier: 'Gemini 2.5 & 2.0 Series', label: 'Gemini 2.0 Flash-Lite' },
  // Rolling Latest Aliases
  { id: 'gemini-pro-latest', tier: 'Rolling Latest Aliases', label: 'gemini-pro-latest (Auto-Tracks Latest Pro)' },
  { id: 'gemini-flash-latest', tier: 'Rolling Latest Aliases', label: 'gemini-flash-latest (Auto-Tracks Latest Flash)' },
  { id: 'gemini-flash-lite-latest', tier: 'Rolling Latest Aliases', label: 'gemini-flash-lite-latest (Auto-Tracks Latest Flash-Lite)' }
];

/** Merges built-in `GEMINI_MODELS` with live models discovered from the user's Google AI Studio account (`GET /v1beta/models`). */
export function mergeGeminiModels(discovered = []) {
  const byId = new Map(GEMINI_MODELS.map(m => [m.id, { ...m }]));
  for (const raw of (Array.isArray(discovered) ? discovered : [])) {
    const id = String((typeof raw === 'string' ? raw : raw?.id) || '').replace(/^models\//, '').trim();
    if (!id || byId.has(id)) continue;
    // Skip pure embedding / imagen / veo / aqa non-JSON-chat models if any slipped in
    if (/^(text-embedding|embedding|aqa|imagen|veo)/i.test(id)) continue;
    const display = typeof raw === 'object' && raw?.displayName ? `${raw.displayName} (${id})` : `${id} (Synced from AI Studio)`;
    byId.set(id, { id, tier: 'Synced from Your AI Studio Account', label: display });
  }
  return [...byId.values()];
}

export const WEBLLM_MODELS = [
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 3B Instruct (Fast WebGPU ~1.9 GB)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B Instruct (WebGPU ~2.0 GB)' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 1.5B Instruct (Lightweight ~1.0 GB)' }
];

/** Gemini-compatible OpenAPI 3.0 subset JSON Schemas (uppercase/lowercase normalized by provider adapter). */
export const DESIGN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    category: { type: 'string' },
    descriptionDev: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['shape', 'text', 'instance'] },
          tag: { type: 'string', enum: ['rect', 'circle', 'ellipse', 'path', 'line', 'polygon', 'text', 'use'] },
          name: { type: 'string' },
          role: { type: 'string' },
          refType: { type: 'string' },
          refKey: { type: 'string' },
          text: { type: 'string' },
          descriptionDev: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
          rx: { type: 'number' },
          cx: { type: 'number' },
          cy: { type: 'number' },
          r: { type: 'number' },
          d: { type: 'string' },
          fill: { type: 'string' },
          stroke: { type: 'string' },
          strokeWidth: { type: 'number' },
          fontSize: { type: 'number' },
          fontWeight: { type: 'string' },
          textAnchor: { type: 'string' },
          inputType: { type: 'string' },
          placeholder: { type: 'string' }
        },
        required: ['tag', 'name']
      }
    },
    menuItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          action: { type: 'string' },
          descriptionDev: { type: 'string' }
        },
        required: ['label']
      }
    }
  },
  required: ['name', 'nodes']
};

export const FLOWCHART_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    domain: { type: 'string', enum: ['fullstack', 'frontend', 'backend', 'business-logic', 'auth-acl'] },
    businessRules: { type: 'string' },
    dataModels: { type: 'string' },
    accessLevels: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          color: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['key', 'name']
      }
    },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nodeKey: { type: 'string' },
          kind: { type: 'string', enum: ['screen', 'step', 'decision', 'trigger', 'subflow', 'end'] },
          subtype: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          allowedRoles: { type: 'array', items: { type: 'string' } },
          deniedBehavior: { type: 'string' },
          roleVariants: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                roleKey: { type: 'string' },
                summary: { type: 'string' },
                addedFeatures: { type: 'string' },
                hiddenFeatures: { type: 'string' }
              },
              required: ['roleKey', 'summary']
            }
          },
          method: { type: 'string' },
          endpoint: { type: 'string' },
          dbTables: { type: 'array', items: { type: 'string' } },
          requestSchema: { type: 'string' },
          responseSchema: { type: 'string' },
          ports: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                label: { type: 'string' },
                kind: { type: 'string' },
                description: { type: 'string' },
                allowedRoles: { type: 'array', items: { type: 'string' } }
              },
              required: ['key', 'label']
            }
          }
        },
        required: ['nodeKey', 'kind', 'title', 'description']
      }
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fromNodeKey: { type: 'string' },
          fromPortKey: { type: 'string' },
          toNodeKey: { type: 'string' },
          label: { type: 'string' },
          transitionText: { type: 'string' },
          conditionExpr: { type: 'string' }
        },
        required: ['fromNodeKey', 'fromPortKey', 'toNodeKey', 'transitionText']
      }
    }
  },
  required: ['name', 'nodes', 'edges']
};

/** Extracts and parses JSON from raw LLM text, stripping markdown code fences or prose wrappers safely. */
export function extractJsonObject(rawText) {
  if (rawText && typeof rawText === 'object') return rawText;
  const text = String(rawText ?? '').trim();
  if (!text) throw new Error('AI returned an empty response');
  try { return JSON.parse(text); } catch { /* try stripping fences / prose */ }

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) {
    try { return JSON.parse(fence[1].trim()); } catch { /* continue */ }
  }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const slice = text.slice(firstBrace, lastBrace + 1);
    try { return JSON.parse(slice); } catch {
      // Repair trailing commas before } or ]
      const repaired = slice.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(repaired);
    }
  }
  throw new Error('Could not parse structured JSON from AI response');
}

/** Builds system & user prompts for generating or refining a visual UI design (`path`, `icon`, `button`, `element`, `screen`). */
export function buildDesignGenerationPrompt({
  targetType = 'screen',
  mode = 'create',
  prompt = '',
  width = null,
  height = null,
  existingDoc = null,
  libraryCatalog = {},
  flowchartNodeContext = null
} = {}) {
  const T = TYPES[targetType] || TYPES.screen;
  const w = Number(width) || existingDoc?.width || T.size[0];
  const h = Number(height) || existingDoc?.height || T.size[1];
  const allowedRefs = T.accepts || [];
  const iconSamples = (libraryCatalog.icons || []).slice(0, 35).map(i => i.key).join(', ');
  const btnSamples = (libraryCatalog.buttons || []).slice(0, 20).map(b => `${b.key}(${b.width}x${b.height})`).join(', ');
  const elSamples = (libraryCatalog.elements || []).slice(0, 20).map(e => `${e.key}(${e.width}x${e.height})`).join(', ');

  const systemPrompt = [
    `You are the Kyrpy UI/UX Designer AI Engine generating a theme-adaptive "${targetType}" (${w}x${h} px).`,
    'Return ONLY a single valid JSON object matching the requested schema (no markdown commentary).',
    'DESIGN SYSTEM RULES:',
    `1. Canvas bounds: x in [0..${w}], y in [0..${h}]. Keep generous padding (16-24px on screens, 8-12px on elements) and clean visual hierarchy.`,
    '2. ALWAYS use theme tokens for colors so the design adapts to all 30 dark/light themes:',
    '   - Backgrounds: role="bg" (screen background), role="card" (cards/panels/bars), role="field" (inputs), role="button" (CTA buttons).',
    '   - Fills & Strokes: "{{bg}}", "{{panel}}", "{{field}}", "{{accent}}", "{{accent1}}", "{{stroke}}", "{{success}}", "{{warning}}", "{{danger}}", "none".',
    '   - Typography (`tag: "text"`): set `text` string, `x`, `y` (baseline), `fill`: "{{text}}" for primary or "{{muted}}" for secondary, or "{{onAccent}}" over `{{accent}}` buttons; `fontSize` (e.g. 22 title, 15 body, 12 caption), `fontWeight` ("700"|"600"|"400"), `textAnchor` ("start"|"middle"|"end").',
    targetType === 'path' || targetType === 'icon'
      ? '3. 24x24 vector icon/path: use crisp SVG `path` (`d`), `circle`, `rect`, `line`, `polyline` with `fill: "none"`, `stroke: "currentColor"` (or `"{{accent}}"`), `strokeWidth: 1.8`.'
      : `3. Reusable library instances allowed in ${targetType}: [${allowedRefs.join(', ')}]. Place an existing item with { "kind": "instance", "tag": "use", "refType": "icon"|"button"|"element", "refKey": "<key>", "name": "...", "x": ..., "y": ..., "width": ..., "height": ... }.`,
    allowedRefs.includes('icon') && iconSamples ? `   Available icon keys sample: ${iconSamples}` : '',
    allowedRefs.includes('button') && btnSamples ? `   Available button keys sample: ${btnSamples}` : '',
    allowedRefs.includes('element') && elSamples ? `   Available element keys sample: ${elSamples}` : '',
    '4. For interactive inputs (`role: "field"`), set `inputType` ("text"|"email"|"password"|"search") and `placeholder`, plus a separate `tag: "text"` label.',
    '5. For CTA buttons drawn with shapes: add a `rect` (`role: "button"` or `fill: "{{accent}}"`, `rx: 12`) AND a centered `tag: "text"` (`textAnchor: "middle"`, `fill: "{{onAccent}}"`, `fontWeight: "600"`) right after it.'
  ].filter(Boolean).join('\n');

  const userParts = [];
  if (flowchartNodeContext) {
    userParts.push(
      `Conceptual FlowChart Screen Specification:`,
      `- Title: ${flowchartNodeContext.title}`,
      `- Description: ${flowchartNodeContext.description || ''}`,
      flowchartNodeContext.ports?.length
        ? `- Required Interactive Buttons / Menu Actions on this Screen:\n${flowchartNodeContext.ports.map(p => `  * ${p.label} (${p.kind}): ${p.description || ''}`).join('\n')}`
        : '',
      Object.keys(flowchartNodeContext.roleSettings?.variants || {}).length
        ? `- Access-Level Features: ${JSON.stringify(flowchartNodeContext.roleSettings.variants)}`
        : ''
    );
  }
  if (mode === 'refine' && existingDoc?.nodes?.length) {
    userParts.push(
      `Current open ${targetType} "${existingDoc.name}" (${w}x${h}) has ${existingDoc.nodes.length} nodes:`,
      JSON.stringify(existingDoc.nodes.slice(0, 45).map(n => ({
        tag: n.tag, kind: n.kind, name: n.name, role: n.role, refType: n.refType, text: n.text, attrs: n.attrs
      }))),
      `Modify/improve or add to this design according to the user's instruction and return the COMPLETE updated nodes[] list.`
    );
  } else if (mode === 'append' && existingDoc) {
    userParts.push(
      `Open ${targetType} "${existingDoc.name}" (${w}x${h}). Return ONLY the NEW nodes[] to append onto this canvas.`
    );
  }
  userParts.push(`User Request: ${prompt || (flowchartNodeContext ? `Design a complete, polished ${flowchartNodeContext.title} screen.` : `Design a modern ${targetType}.`)}`);

  return { systemPrompt, userPrompt: userParts.filter(Boolean).join('\n\n'), schema: DESIGN_RESPONSE_SCHEMA, width: w, height: h };
}

/** Sanitizes raw AI design JSON into 100% valid `normalizeDesign` + `normalizeNode` records. */
export function sanitizeGeneratedDesign(raw, {
  targetType = 'screen',
  width = null,
  height = null,
  libraryCatalog = {}
} = {}) {
  const parsed = extractJsonObject(raw);
  const T = TYPES[targetType] || TYPES.screen;
  const w = T.fixedSize ? T.size[0] : (Number(parsed.width) > 0 ? Number(parsed.width) : (Number(width) || T.size[0]));
  const h = T.fixedSize ? T.size[1] : (Number(parsed.height) > 0 ? Number(parsed.height) : (Number(height) || T.size[1]));

  const lookupRefId = (refType, refKeyOrId) => {
    if (!refType || !canContain(targetType, refType)) return null;
    const list = libraryCatalog[`${refType}s`] || libraryCatalog[refType] || [];
    if (!list.length) return null;
    if (typeof refKeyOrId === 'number' || /^\d+$/.test(String(refKeyOrId || ''))) {
      const hit = list.find(x => Number(x.id) === Number(refKeyOrId));
      if (hit) return hit;
    }
    const keySlug = slugify(String(refKeyOrId || ''), '');
    return list.find(x => x.key === keySlug || slugify(x.name, '') === keySlug || x.key.endsWith(`-${keySlug}`)) || null;
  };

  const safeColor = (val, fallback) => {
    if (val === undefined || val === null || val === '') return fallback;
    const s = String(val).trim();
    if (/^(javascript:|data:text\/html|http:|https:)/i.test(s)) return fallback;
    return s;
  };

  const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const cleanNodes = [];

  rawNodes.slice(0, 160).forEach((rn, idx) => {
    if (!rn || typeof rn !== 'object') return;
    const baseName = slugify(rn.name || rn.text || `${rn.tag || 'node'}-${idx + 1}`, `node-${idx + 1}`).slice(0, 64);
    const role = rn.role && SURFACE_ROLES.includes(rn.role) ? rn.role : null;

    // Resolve library instance if requested
    if ((rn.kind === 'instance' || rn.refType || rn.refKey) && rn.refType) {
      const refType = String(rn.refType).toLowerCase().replace(/s$/, '');
      const found = lookupRefId(refType, rn.refKey ?? rn.refId ?? rn.name);
      if (found) {
        const iw = Number(rn.width) > 0 ? Number(rn.width) : (found.width || 24);
        const ih = Number(rn.height) > 0 ? Number(rn.height) : (found.height || 24);
        cleanNodes.push(normalizeNode({
          kind: 'instance',
          tag: 'use',
          name: baseName,
          refType,
          refId: Number(found.id),
          ord: cleanNodes.length,
          descriptionDev: String(rn.descriptionDev || ''),
          attrs: {
            x: Math.round(Number(rn.x ?? rn.attrs?.x ?? 16)),
            y: Math.round(Number(rn.y ?? rn.attrs?.y ?? 16)),
            width: Math.round(iw),
            height: Math.round(ih)
          }
        }));
        return;
      }
    }

    // Standard vector / text node
    let tag = String(rn.tag || (rn.text ? 'text' : 'rect')).toLowerCase();
    if (!NODE_TAGS.includes(tag) || tag === 'use' || tag === 'image' || tag === 'g') {
      tag = rn.text ? 'text' : (rn.d || rn.attrs?.d ? 'path' : 'rect');
    }
    const rawAttrs = rn.attrs && typeof rn.attrs === 'object' ? { ...rn.attrs } : {};
    const attrs = {};

    if (tag === 'rect') {
      attrs.x = Math.round(Number(rn.x ?? rawAttrs.x ?? 0));
      attrs.y = Math.round(Number(rn.y ?? rawAttrs.y ?? 0));
      attrs.width = Math.max(2, Math.round(Number(rn.width ?? rawAttrs.width ?? (role === 'bg' ? w : Math.min(200, w - 32)))));
      attrs.height = Math.max(2, Math.round(Number(rn.height ?? rawAttrs.height ?? (role === 'bg' ? h : 48))));
      const rx = rn.rx ?? rawAttrs.rx;
      if (rx !== undefined) attrs.rx = Math.max(0, Math.round(Number(rx) || 0));
      else if (role === 'card' || role === 'button' || role === 'field') attrs.rx = 12;
    } else if (tag === 'circle') {
      attrs.cx = Number(rn.cx ?? rawAttrs.cx ?? (Number(rn.x || 0) + Number(rn.r || 12)));
      attrs.cy = Number(rn.cy ?? rawAttrs.cy ?? (Number(rn.y || 0) + Number(rn.r || 12)));
      attrs.r = Math.max(1, Number(rn.r ?? rawAttrs.r ?? 12));
    } else if (tag === 'ellipse') {
      attrs.cx = Number(rn.cx ?? rawAttrs.cx ?? w / 2);
      attrs.cy = Number(rn.cy ?? rawAttrs.cy ?? h / 2);
      attrs.rx = Math.max(1, Number(rn.rx ?? rawAttrs.rx ?? 20));
      attrs.ry = Math.max(1, Number(rn.ry ?? rawAttrs.ry ?? 12));
    } else if (tag === 'line') {
      attrs.x1 = Number(rn.x1 ?? rawAttrs.x1 ?? rn.x ?? 0);
      attrs.y1 = Number(rn.y1 ?? rawAttrs.y1 ?? rn.y ?? 0);
      attrs.x2 = Number(rn.x2 ?? rawAttrs.x2 ?? (Number(attrs.x1) + Number(rn.width || 100)));
      attrs.y2 = Number(rn.y2 ?? rawAttrs.y2 ?? attrs.y1);
    } else if (tag === 'path') {
      attrs.d = String(rn.d ?? rawAttrs.d ?? 'M 4 12 L 20 12');
    } else if (tag === 'polygon' || tag === 'polyline') {
      attrs.points = String(rn.points ?? rawAttrs.points ?? '12,2 22,20 2,20');
    } else if (tag === 'text') {
      attrs.x = Math.round(Number(rn.x ?? rawAttrs.x ?? 24));
      attrs.y = Math.round(Number(rn.y ?? rawAttrs.y ?? 40));
      attrs['font-size'] = Math.max(9, Math.min(64, Math.round(Number(rn.fontSize ?? rawAttrs['font-size'] ?? 15))));
      if (rn.fontWeight || rawAttrs['font-weight']) attrs['font-weight'] = String(rn.fontWeight ?? rawAttrs['font-weight']);
      if (rn.textAnchor || rawAttrs['text-anchor']) attrs['text-anchor'] = String(rn.textAnchor ?? rawAttrs['text-anchor']);
    }

    const fill = safeColor(rn.fill ?? rawAttrs.fill, tag === 'text' ? '{{text}}' : (targetType === 'icon' || targetType === 'path') ? 'none' : role ? undefined : '{{accent}}');
    const stroke = safeColor(rn.stroke ?? rawAttrs.stroke, (targetType === 'icon' || targetType === 'path') ? 'currentColor' : undefined);
    const sw = rn.strokeWidth ?? rawAttrs['stroke-width'];
    if (fill !== undefined) attrs.fill = fill;
    if (stroke !== undefined) attrs.stroke = stroke;
    if (sw !== undefined) attrs['stroke-width'] = Number(sw) || 1.5;
    else if (targetType === 'icon' || targetType === 'path') attrs['stroke-width'] = 1.8;

    if (role === 'field') {
      if (rn.inputType || rawAttrs['data-input-type']) attrs['data-input-type'] = String(rn.inputType || rawAttrs['data-input-type']);
      if (rn.placeholder || rawAttrs['data-placeholder']) attrs['data-placeholder'] = String(rn.placeholder || rawAttrs['data-placeholder']);
    }

    try {
      cleanNodes.push(normalizeNode({
        kind: tag === 'text' ? 'text' : 'shape',
        tag,
        name: baseName,
        role,
        ord: cleanNodes.length,
        text: tag === 'text' ? String(rn.text ?? rn.label ?? baseName) : '',
        descriptionDev: String(rn.descriptionDev || ''),
        attrs
      }));
    } catch { /* skip malformed node */ }
  });

  // Ensure screen has a background rect if creating from scratch and none was supplied
  if (targetType === 'screen' && cleanNodes.length && !cleanNodes.some(n => n.role === 'bg')) {
    cleanNodes.unshift(normalizeNode({
      kind: 'shape',
      tag: 'rect',
      name: 'screen-bg',
      role: 'bg',
      ord: 0,
      attrs: { x: 0, y: 0, width: w, height: h, fill: '{{bg}}' }
    }));
    cleanNodes.forEach((n, i) => { n.ord = i; });
  }

  const menuItems = Array.isArray(parsed.menuItems)
    ? parsed.menuItems.slice(0, 20).map((m, idx) => {
        try { return normalizeMenuItem({ label: m.label || `Item ${idx + 1}`, action: m.action || '', descriptionDev: m.descriptionDev || '', ord: idx }); }
        catch { return null; }
      }).filter(Boolean)
    : [];

  return {
    name: String(parsed.name || `AI ${T.label}`).trim().slice(0, 120),
    label: String(parsed.label || parsed.name || `AI ${T.label}`).trim().slice(0, 160),
    category: slugify(parsed.category || 'ai-generated', 'general'),
    descriptionDev: String(parsed.descriptionDev || '').slice(0, 8000),
    width: w,
    height: h,
    nodes: cleanNodes,
    menuItems
  };
}

/** Builds system & user prompts for Conceptual FlowChart generation or node expansion. */
export function buildFlowchartGenerationPrompt({
  mode = 'create',
  prompt = '',
  domain = 'fullstack',
  existingFlowchart = null,
  focusNodeKey = null
} = {}) {
  const systemPrompt = [
    'You are the Kyrpy Conceptual FlowChart Architect (ComfyUI-style node graph for Frontend Screens, Backend API Steps, Business Logic, Decision Routers, and Role/Access-Level Variations).',
    'Return ONLY a single valid JSON object matching the requested schema (no markdown prose).',
    'ARCHITECTURE RULES:',
    '1. Every `screen`, `step`, `decision`, `subflow`, and `end` node automatically has a `home` input socket.',
    '2. Every `screen` or `step` node defines outgoing `ports` (menu items, buttons, sub-actions, API outcomes) that connect via `edges` (`fromNodeKey` + `fromPortKey` -> `toNodeKey`).',
    '3. Whenever a flow branches into multiple scenarios or outcomes (e.g. Valid vs Invalid, Authorized vs Forbidden, In Stock vs Out of Stock), include a `decision` node with 2+ `case` ports!',
    '4. Every edge MUST carry a clear `transitionText` explaining what happens during the transition (validation, HTTP request, state mutation, animation, error handling).',
    '5. Include `roleVariants` on key screens/steps where different access levels (e.g. `guest`, `user`, `pro`, `admin`) see different features on the same screen, and set `allowedRoles` on restricted nodes/ports.',
    '6. For backend/API `step` nodes, populate `method`, `endpoint`, `dbTables`, `requestSchema`, and `responseSchema`.'
  ].join('\n');

  const userParts = [`Target Domain: ${domain}`];
  if (mode === 'expand' && existingFlowchart) {
    const focusNode = existingFlowchart.nodes?.find(n => n.nodeKey === focusNodeKey);
    userParts.push(
      `Existing FlowChart "${existingFlowchart.name}" currently has nodes: ${existingFlowchart.nodes.map(n => `${n.nodeKey} (${n.kind}: "${n.title}", ports: [${(n.ports || []).map(p => p.key).join(', ')}])`).join('; ')}.`,
      focusNode
        ? `Focus Node to expand downstream from: "${focusNode.title}" (nodeKey: "${focusNode.nodeKey}", ports: ${JSON.stringify(focusNode.ports)}).`
        : '',
      'Return ONLY the NEW downstream `nodes` and NEW `edges` (edges may connect from existing `nodeKey`/`portKey` to your new nodes, or between new nodes).'
    );
  }
  userParts.push(`User Specification: ${prompt}`);

  return { systemPrompt, userPrompt: userParts.filter(Boolean).join('\n\n'), schema: FLOWCHART_RESPONSE_SCHEMA };
}

/** Sanitizes raw AI FlowChart JSON into normalized `FlowChart` nodes, edges, accessLevels, and spec. */
export function sanitizeGeneratedFlowchart(raw, {
  existingNodes = [],
  existingEdges = [],
  autoLayout = true
} = {}) {
  const parsed = extractJsonObject(raw);
  const nodeKeys = new Set(existingNodes.map(n => n.nodeKey));
  const newNodes = [];

  for (const rn of (Array.isArray(parsed.nodes) ? parsed.nodes : []).slice(0, 120)) {
    if (!rn || typeof rn !== 'object') continue;
    const variantsObj = {};
    if (Array.isArray(rn.roleVariants)) {
      for (const rv of rn.roleVariants) {
        if (rv?.roleKey) {
          variantsObj[slugify(rv.roleKey, 'role')] = {
            summary: String(rv.summary || ''),
            addedFeatures: String(rv.addedFeatures || ''),
            hiddenFeatures: String(rv.hiddenFeatures || ''),
            notes: String(rv.notes || '')
          };
        }
      }
    } else if (rn.roleSettings?.variants && typeof rn.roleSettings.variants === 'object') {
      Object.assign(variantsObj, rn.roleSettings.variants);
    }

    const normalized = normalizeFlowchartNode({
      nodeKey: rn.nodeKey || rn.key || slugify(rn.title || rn.name || 'node', 'node'),
      kind: rn.kind || 'screen',
      subtype: rn.subtype,
      title: rn.title || rn.name || 'Step',
      description: rn.description || '',
      ports: Array.isArray(rn.ports) && rn.ports.length ? rn.ports : undefined,
      roleSettings: {
        allowedRoles: rn.allowedRoles || rn.roleSettings?.allowedRoles || [],
        deniedBehavior: rn.deniedBehavior || rn.roleSettings?.deniedBehavior || 'hide',
        variants: variantsObj
      },
      techSpec: {
        method: rn.method || rn.techSpec?.method || '',
        endpoint: rn.endpoint || rn.techSpec?.endpoint || '',
        dbTables: rn.dbTables || rn.techSpec?.dbTables || [],
        requestSchema: rn.requestSchema || rn.techSpec?.requestSchema || '',
        responseSchema: rn.responseSchema || rn.techSpec?.responseSchema || ''
      }
    }, nodeKeys, existingNodes.length + newNodes.length);
    newNodes.push(normalized);
  }

  const combinedNodes = [...existingNodes.map(n => ({ ...n, ports: [...(n.ports || [])] })), ...newNodes];
  const byKey = new Map(combinedNodes.map(n => [n.nodeKey, n]));
  const edgeKeys = new Set(existingEdges.map(e => e.edgeKey));
  const newEdges = [];

  for (const re of (Array.isArray(parsed.edges) ? parsed.edges : []).slice(0, 240)) {
    if (!re || typeof re !== 'object') continue;
    const fromKey = slugify(re.fromNodeKey || re.from || '', '');
    const toKey = slugify(re.toNodeKey || re.to || '', '');
    const src = byKey.get(fromKey) || combinedNodes.find(n => n.nodeKey === re.fromNodeKey);
    const dst = byKey.get(toKey) || combinedNodes.find(n => n.nodeKey === re.toNodeKey);
    if (!src || !dst || dst.kind === 'trigger') continue;
    const portKey = slugify(re.fromPortKey || re.fromPort || src.ports?.[0]?.key || 'next', 'next');
    if (!src.ports.some(p => p.key === portKey)) {
      src.ports.push({
        key: portKey,
        label: re.label || re.fromPortKey || 'Next',
        kind: src.kind === 'decision' ? 'case' : src.kind === 'screen' ? 'menu-item' : 'action',
        description: '',
        allowedRoles: [],
        deniedBehavior: 'hide'
      });
    }
    try {
      const edge = normalizeFlowchartEdge({
        fromNodeKey: src.nodeKey,
        fromPortKey: portKey,
        toNodeKey: dst.nodeKey,
        toPortKey: HOME_PORT_KEY,
        label: re.label || '',
        transitionText: re.transitionText || re.description || '',
        conditionExpr: re.conditionExpr || re.condition || ''
      }, edgeKeys, existingEdges.length + newEdges.length);
      newEdges.push(edge);
    } catch { /* skip invalid edge */ }
  }

  const allEdges = [...existingEdges, ...newEdges];
  const laidOutNodes = autoLayout ? autoLayoutFlowchart(combinedNodes, allEdges, { startNodeKey: combinedNodes[0]?.nodeKey }) : combinedNodes;

  return {
    name: String(parsed.name || 'AI Generated FlowChart').trim().slice(0, 140),
    description: String(parsed.description || '').slice(0, 20000),
    domain: ['fullstack', 'frontend', 'backend', 'business-logic', 'auth-acl'].includes(parsed.domain) ? parsed.domain : 'fullstack',
    accessLevels: Array.isArray(parsed.accessLevels) && parsed.accessLevels.length ? parsed.accessLevels : DEFAULT_ACCESS_LEVELS,
    spec: {
      businessRules: String(parsed.businessRules || ''),
      dataModels: String(parsed.dataModels || '')
    },
    nodes: laidOutNodes,
    edges: allEdges,
    addedNodesCount: newNodes.length,
    addedEdgesCount: newEdges.length
  };
}
