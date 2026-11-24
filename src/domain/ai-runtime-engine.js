/**
 * Pure Client-Side Multi-Provider AI Execution Engine.
 * Zero Node-only or DOM-only dependencies so both the browser (`/domain/ai-runtime-engine.js`)
 * and Node unit tests (`src/tests/ai-client-runtime.test.js`) execute the exact same code.
 *
 * Security & Privacy Guarantee:
 * - Never calls `/api/*` on the Designer backend with user AI credentials.
 * - Gemini BYOK sends keys via `x-goog-api-key` header (never in URL query strings).
 */
import { GEMINI_MODELS, WEBLLM_MODELS, extractJsonObject } from './ai-runtime-spec.js';

export const DEFAULT_AI_CONFIG = Object.freeze({
  provider: 'auto',
  geminiModel: 'gemini-4-carbon',
  discoveredGeminiModels: [],
  rememberSecrets: false,
  openAiEnabled: false,
  openAiBaseUrl: 'http://127.0.0.1:11434/v1',
  openAiModel: 'qwen2.5-coder:7b',
  webllmModel: WEBLLM_MODELS[0].id,
  temperature: 0.35
});

const GEMINI_TYPE_MAP = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN'
};

/** Converts standard lowercase JSON Schema into Gemini REST API OpenAPI 3.0 `Schema` format. */
export function toGeminiResponseSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = {};
  if (schema.type) out.type = GEMINI_TYPE_MAP[String(schema.type).toLowerCase()] || String(schema.type).toUpperCase();
  if (schema.description) out.description = String(schema.description);
  if (Array.isArray(schema.enum)) out.enum = schema.enum.map(String);
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = toGeminiResponseSchema(v);
    }
  }
  if (schema.items) out.items = toGeminiResponseSchema(schema.items);
  if (Array.isArray(schema.required) && schema.required.length) out.required = [...schema.required];
  return out;
}

export function normalizeBaseUrl(url, fallback = 'http://127.0.0.1:11434/v1') {
  const raw = String(url || fallback).trim().replace(/\/+$/, '');
  return raw || fallback;
}

/** Asserts that an outbound client AI request never targets the Designer's own `/api/` server routes. */
function assertExternalOrLocalAiUrl(url) {
  const s = String(url || '');
  if (s.startsWith('/api/') || s === '/api') {
    throw new Error('Security policy violation: Client AI keys must never be sent to Designer /api/* routes.');
  }
}

/**
 * Pathway 1: Google Gemini API (BYOK — Google AI Studio)
 * Direct browser HTTPS request to `generativelanguage.googleapis.com` using `x-goog-api-key`.
 */
export async function callGeminiByok({
  apiKey,
  model = 'gemini-4-carbon',
  systemPrompt = '',
  userPrompt = '',
  schema = null,
  temperature = 0.35,
  onStatus = null,
  signal = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Gemini API key is empty. Paste your Google AI Studio key in AI Studio → Settings.');
  if (typeof fetchImpl !== 'function') throw new Error('Browser fetch API is unavailable.');

  const cleanModel = String(model || 'gemini-4-carbon').replace(/^models\//, '').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;
  assertExternalOrLocalAiUrl(endpoint);
  onStatus?.(`Calling Google Gemini (${cleanModel}) directly from browser…`, 22);

  const generationConfig = {
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.35,
    responseMimeType: 'application/json'
  };
  if (schema) generationConfig.responseSchema = toGeminiResponseSchema(schema);

  const body = {
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: String(systemPrompt) }] } } : {}),
    contents: [{ role: 'user', parts: [{ text: String(userPrompt) }] }],
    generationConfig
  };

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': key
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {})
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = payload?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini API error (${res.status}): ${msg}`);
  }
  const text = (payload?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('').trim();
  if (!text) {
    const blockReason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason || 'empty response';
    throw new Error(`Gemini returned no JSON output (${blockReason}).`);
  }
  return {
    provider: 'gemini-byok',
    model: cleanModel,
    rawText: text,
    data: extractJsonObject(text)
  };
}

/** Verifies a Gemini AI Studio key directly against Google's models endpoint (`x-goog-api-key`) and discovers all account-accessible models. */
export async function testGeminiByok({ apiKey, fetchImpl = globalThis.fetch } = {}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Enter a Gemini API key first.');
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100';
  assertExternalOrLocalAiUrl(endpoint);
  const res = await fetchImpl(endpoint, {
    method: 'GET',
    headers: { 'x-goog-api-key': key }
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(payload?.error?.message || `Gemini key check failed (HTTP ${res.status})`);
  }
  const genModels = (payload?.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'));
  const models = genModels
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean);
  const modelDetails = genModels
    .map(m => ({
      id: String(m.name || '').replace(/^models\//, ''),
      displayName: String(m.displayName || '').trim(),
      inputTokenLimit: Number(m.inputTokenLimit) || null,
      outputTokenLimit: Number(m.outputTokenLimit) || null
    }))
    .filter(m => m.id);
  return { ok: true, models, modelDetails };
}

/**
 * Pathway 2: Chrome Built-in AI (`window.LanguageModel` / `window.ai.languageModel` — Gemini Nano)
 */
export async function detectChromeBuiltInAi(globalObj = globalThis) {
  try {
    if (globalObj?.LanguageModel && typeof globalObj.LanguageModel.availability === 'function') {
      const avail = await globalObj.LanguageModel.availability();
      const map = {
        available: { supported: true, status: 'available', apiFlavor: 'LanguageModel', message: 'Ready on-device (Gemini Nano)' },
        downloadable: { supported: true, status: 'downloadable', apiFlavor: 'LanguageModel', message: 'Available (model download on first run)' },
        downloading: { supported: true, status: 'downloading', apiFlavor: 'LanguageModel', message: 'Downloading Gemini Nano in Chrome…' }
      };
      return map[avail] || { supported: false, status: 'unavailable', apiFlavor: 'LanguageModel', message: `Chrome LanguageModel status: ${avail}` };
    }
    const legacy = globalObj?.ai?.languageModel;
    if (legacy && typeof legacy.capabilities === 'function') {
      const caps = await legacy.capabilities();
      const a = caps?.available;
      if (a === 'readily') return { supported: true, status: 'available', apiFlavor: 'window.ai', message: 'Ready on-device (Gemini Nano)' };
      if (a === 'after-download') return { supported: true, status: 'downloadable', apiFlavor: 'window.ai', message: 'Available after Chrome model download' };
      return { supported: false, status: 'unavailable', apiFlavor: 'window.ai', message: 'Gemini Nano unavailable on this device' };
    }
  } catch (err) {
    return { supported: false, status: 'unavailable', apiFlavor: 'none', message: err.message };
  }
  return {
    supported: false,
    status: 'unavailable',
    apiFlavor: 'none',
    message: 'Not detected (enable chrome://flags/#prompt-api-for-gemini-nano in Chrome 138+)'
  };
}

export async function callChromeBuiltInAi({
  systemPrompt = '',
  userPrompt = '',
  schema = null,
  onStatus = null,
  globalObj = globalThis
} = {}) {
  const info = await detectChromeBuiltInAi(globalObj);
  if (!info.supported) {
    throw new Error(`Chrome Built-in AI (Gemini Nano) is not active in this browser: ${info.message}`);
  }
  onStatus?.('Initializing Chrome on-device Gemini Nano session…');

  const monitor = m => {
    if (m && typeof m.addEventListener === 'function') {
      m.addEventListener('downloadprogress', e => {
        const pct = typeof e?.loaded === 'number' ? Math.round(e.loaded * 100) : null;
        onStatus?.(pct !== null ? `Downloading Chrome Gemini Nano (${pct}%)…` : 'Downloading Chrome Gemini Nano…');
      });
    }
  };

  let session = null;
  try {
    if (info.apiFlavor === 'LanguageModel') {
      session = await globalObj.LanguageModel.create({
        ...(systemPrompt ? { initialPrompts: [{ role: 'system', content: String(systemPrompt) }] } : {}),
        monitor
      });
    } else {
      session = await globalObj.ai.languageModel.create({
        ...(systemPrompt ? { systemPrompt: String(systemPrompt) } : {}),
        monitor
      });
    }

    onStatus?.('Generating design with on-device Gemini Nano…');
    let rawText = '';
    if (schema) {
      try {
        rawText = await session.prompt(String(userPrompt), { responseConstraint: schema });
      } catch {
        // Fallback for Chrome builds that haven't enabled structured responseConstraint yet
        rawText = await session.prompt(`${userPrompt}\n\nRespond ONLY with valid JSON matching this schema:\n${JSON.stringify(schema)}`);
      }
    } else {
      rawText = await session.prompt(String(userPrompt));
    }
    return {
      provider: 'chrome-nano',
      model: 'gemini-nano-chrome',
      rawText,
      data: extractJsonObject(rawText)
    };
  } finally {
    try { session?.destroy?.(); } catch { /* ignore */ }
  }
}

/**
 * Pathway 3: Local Ollama / LM Studio / OpenAI-Compatible Runtime
 */
export async function discoverOpenAiCompatModels({
  baseUrl = 'http://127.0.0.1:11434/v1',
  apiKey = '',
  fetchImpl = globalThis.fetch
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  assertExternalOrLocalAiUrl(base);
  const headers = {};
  if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

  try {
    const res = await fetchImpl(`${base}/models`, { method: 'GET', headers });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const ids = (data?.data || data?.models || []).map(m => m.id || m.name).filter(Boolean);
      if (ids.length) return { ok: true, models: ids };
    }
  } catch { /* try Ollama native /api/tags fallback if localhost:11434 */ }

  if (/127\.0\.0\.1:11434|localhost:11434/.test(base)) {
    const root = base.replace(/\/v1$/, '');
    const res = await fetchImpl(`${root}/api/tags`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const ids = (data?.models || []).map(m => m.name || m.model).filter(Boolean);
      return { ok: true, models: ids };
    }
  }
  throw new Error(`Could not reach local/OpenAI endpoint at ${base}. For Ollama, start with: OLLAMA_ORIGINS=* ollama serve`);
}

export async function callOpenAiCompat({
  baseUrl = 'http://127.0.0.1:11434/v1',
  apiKey = '',
  model = 'qwen2.5-coder:7b',
  systemPrompt = '',
  userPrompt = '',
  schema = null,
  temperature = 0.35,
  onStatus = null,
  signal = null,
  fetchImpl = globalThis.fetch
} = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const endpoint = `${base}/chat/completions`;
  assertExternalOrLocalAiUrl(endpoint);
  const cleanModel = String(model || 'qwen2.5-coder:7b').trim();
  onStatus?.(`Calling ${cleanModel} at ${base}…`, 22);

  const headers = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${String(apiKey).trim()}`;

  const sys = [
    systemPrompt,
    schema ? `Output strictly valid JSON conforming to this JSON Schema:\n${JSON.stringify(schema)}` : 'Output strictly valid JSON.'
  ].filter(Boolean).join('\n\n');

  const sendReq = async useJsonFormat => fetchImpl(endpoint, {
    method: 'POST',
    headers,
    ...(signal ? { signal } : {}),
    body: JSON.stringify({
      model: cleanModel,
      temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.35,
      ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: String(userPrompt) }
      ]
    })
  });

  let res = await sendReq(true);
  if (res.status === 400) {
    // Some OpenAI-compatible servers reject `response_format: { type: 'json_object' }`; retry cleanly without it
    res = await sendReq(false);
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = payload?.error?.message || payload?.error || `HTTP ${res.status}`;
    throw new Error(`OpenAI/Ollama endpoint error (${res.status}): ${msg}`);
  }
  const text = String(payload?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Local/OpenAI model returned an empty message.');
  return {
    provider: 'openai-compat',
    model: cleanModel,
    rawText: text,
    data: extractJsonObject(text)
  };
}

/** Resolves which concrete client runtime `auto` mode should use given current browser state. */
export function resolveAutoProvider({
  config = DEFAULT_AI_CONFIG,
  secrets = {},
  chromeStatus = { supported: false, status: 'unavailable' },
  webgpuLoaded = false
} = {}) {
  const requested = config?.provider || 'auto';
  if (requested && requested !== 'auto') return requested;

  if (String(secrets?.geminiApiKey || '').trim()) return 'gemini-byok';
  if (chromeStatus?.status === 'available') return 'chrome-nano';
  if (config?.openAiEnabled || String(secrets?.openAiApiKey || '').trim()) return 'openai-compat';
  if (chromeStatus?.status === 'downloadable') return 'chrome-nano';
  if (webgpuLoaded) return 'webgpu-webllm';
  return null;
}

/** Unified dispatcher across all client-side providers (injectable WebLLM runner for browser WebGPU). */
export async function executeClientAiStructured({
  config = DEFAULT_AI_CONFIG,
  secrets = {},
  systemPrompt = '',
  userPrompt = '',
  schema = null,
  temperature = null,
  onStatus = null,
  signal = null,
  fetchImpl = globalThis.fetch,
  globalObj = globalThis,
  webgpuRunner = null,
  webgpuLoaded = false
} = {}) {
  const chromeStatus = await detectChromeBuiltInAi(globalObj);
  const chosen = resolveAutoProvider({ config, secrets, chromeStatus, webgpuLoaded });
  if (!chosen || chosen === 'mcp-subscription') {
    throw new Error(
      'No client-side AI runtime is configured yet. Open the "⚙ Runtime & Keys" tab to add a Gemini AI Studio key, enable Local Ollama, enable Chrome Gemini Nano, load WebGPU, or use the "🔌 Subscription MCP" tab.'
    );
  }
  const temp = temperature ?? config.temperature ?? 0.35;

  if (chosen === 'gemini-byok') {
    return callGeminiByok({
      apiKey: secrets.geminiApiKey,
      model: config.geminiModel || 'gemini-4-carbon',
      systemPrompt,
      userPrompt,
      schema,
      temperature: temp,
      onStatus,
      signal,
      fetchImpl
    });
  }
  if (chosen === 'chrome-nano') {
    return callChromeBuiltInAi({
      systemPrompt,
      userPrompt,
      schema,
      onStatus,
      globalObj
    });
  }
  if (chosen === 'openai-compat') {
    return callOpenAiCompat({
      baseUrl: config.openAiBaseUrl,
      apiKey: secrets.openAiApiKey,
      model: config.openAiModel,
      systemPrompt,
      userPrompt,
      schema,
      temperature: temp,
      onStatus,
      signal,
      fetchImpl
    });
  }
  if (chosen === 'webgpu-webllm') {
    if (typeof webgpuRunner !== 'function') {
      throw new Error('WebGPU in-browser runtime is not available in this environment.');
    }
    return webgpuRunner({
      model: config.webllmModel || WEBLLM_MODELS[0].id,
      systemPrompt,
      userPrompt,
      schema,
      temperature: temp,
      onStatus
    });
  }
  throw new Error(`Unsupported AI provider "${chosen}"`);
}
