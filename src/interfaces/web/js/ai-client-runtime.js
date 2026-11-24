/**
 * Browser-side AI Runtime Store & WebGPU Engine Adapter.
 * Wraps `/domain/ai-runtime-engine.js` with safe browser storage (`sessionStorage` by default for secrets;
 * `localStorage` only if the user explicitly opts in) and lazy WebGPU `@mlc-ai/web-llm` loading.
 */
import { extractJsonObject, WEBLLM_MODELS } from '/domain/ai-runtime-spec.js';
import {
  DEFAULT_AI_CONFIG,
  detectChromeBuiltInAi,
  testGeminiByok,
  discoverOpenAiCompatModels,
  resolveAutoProvider,
  executeClientAiStructured
} from '/domain/ai-runtime-engine.js';

const CFG_STORAGE_KEY = 'ud_ai_runtime_cfg_v1';
const SECRETS_STORAGE_KEY = 'ud_ai_runtime_secrets_v1';

const webgpuState = {
  engine: null,
  loadedModel: null,
  loading: false,
  progressText: ''
};

export function loadAiConfig() {
  try {
    const raw = localStorage.getItem(CFG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AI_CONFIG, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

export function saveAiConfig(patch = {}) {
  const next = { ...loadAiConfig(), ...patch };
  try {
    localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(next));
  } catch { /* ignore storage quota errors */ }
  // Migrate secrets between sessionStorage and localStorage if rememberSecrets changed
  const secrets = loadAiSecrets();
  saveAiSecrets(secrets, next.rememberSecrets);
  return next;
}

export function loadAiSecrets() {
  try {
    const fromSession = sessionStorage.getItem(SECRETS_STORAGE_KEY);
    if (fromSession) return JSON.parse(fromSession) || {};
    const fromLocal = localStorage.getItem(SECRETS_STORAGE_KEY);
    if (fromLocal) return JSON.parse(fromLocal) || {};
  } catch { /* ignore */ }
  return {};
}

export function saveAiSecrets(secrets = {}, remember = loadAiConfig().rememberSecrets) {
  const clean = {
    geminiApiKey: String(secrets.geminiApiKey || '').trim(),
    openAiApiKey: String(secrets.openAiApiKey || '').trim()
  };
  try {
    if (remember) {
      localStorage.setItem(SECRETS_STORAGE_KEY, JSON.stringify(clean));
      sessionStorage.removeItem(SECRETS_STORAGE_KEY);
    } else {
      sessionStorage.setItem(SECRETS_STORAGE_KEY, JSON.stringify(clean));
      localStorage.removeItem(SECRETS_STORAGE_KEY);
    }
  } catch { /* ignore */ }
  return clean;
}

export function clearAiSecrets() {
  try { sessionStorage.removeItem(SECRETS_STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(SECRETS_STORAGE_KEY); } catch { /* ignore */ }
}

export function hasWebGpuSupport() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

export function getWebGpuState() {
  return { ...webgpuState, supported: hasWebGpuSupport() };
}

/** Lazily imports `@mlc-ai/web-llm` from ESM CDN only when the user explicitly loads or runs WebGPU inference. */
export async function ensureWebGpuEngine(modelId = WEBLLM_MODELS[0].id, onStatus = null) {
  if (!hasWebGpuSupport()) {
    throw new Error('WebGPU (`navigator.gpu`) is not available in this browser or hardware profile.');
  }
  if (webgpuState.engine && webgpuState.loadedModel === modelId) {
    return webgpuState.engine;
  }
  webgpuState.loading = true;
  try {
    onStatus?.('Loading @mlc-ai/web-llm WebGPU runtime…');
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: report => {
        const text = report?.text || `Loading WebGPU model (${Math.round((report?.progress || 0) * 100)}%)…`;
        webgpuState.progressText = text;
        onStatus?.(text);
      }
    });
    webgpuState.engine = engine;
    webgpuState.loadedModel = modelId;
    webgpuState.progressText = `Loaded ${modelId} in WebGPU`;
    return engine;
  } finally {
    webgpuState.loading = false;
  }
}

async function runWebGpuStructured({ model, systemPrompt, userPrompt, schema, temperature = 0.35, onStatus }) {
  const engine = await ensureWebGpuEngine(model, onStatus);
  onStatus?.(`Generating via in-browser WebGPU (${model})…`);
  const sys = [
    systemPrompt,
    schema ? `Respond ONLY with valid JSON matching this schema:\n${JSON.stringify(schema)}` : 'Respond ONLY with valid JSON.'
  ].filter(Boolean).join('\n\n');
  const reply = await engine.chat.completions.create({
    temperature,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(userPrompt) }
    ]
  });
  const rawText = String(reply?.choices?.[0]?.message?.content || '').trim();
  return {
    provider: 'webgpu-webllm',
    model,
    rawText,
    data: extractJsonObject(rawText)
  };
}

/** Probes live availability across all 4 browser pathways without sending secrets anywhere. */
export async function probeClientAiStatus() {
  const config = loadAiConfig();
  const secrets = loadAiSecrets();
  const chrome = await detectChromeBuiltInAi(window);
  const webgpu = getWebGpuState();
  const activeAuto = resolveAutoProvider({
    config,
    secrets,
    chromeStatus: chrome,
    webgpuLoaded: Boolean(webgpu.engine)
  });

  return {
    config,
    hasGeminiKey: Boolean(secrets.geminiApiKey),
    hasOpenAiKey: Boolean(secrets.openAiApiKey),
    chrome,
    webgpu,
    resolvedProvider: activeAuto
  };
}

export async function generateWithClientAi({
  systemPrompt = '',
  userPrompt = '',
  schema = null,
  temperature = null,
  providerOverride = null,
  signal = null,
  onStatus = null
} = {}) {
  const baseCfg = loadAiConfig();
  const config = providerOverride ? { ...baseCfg, provider: providerOverride } : baseCfg;
  const secrets = loadAiSecrets();
  return executeClientAiStructured({
    config,
    secrets,
    systemPrompt,
    userPrompt,
    schema,
    temperature,
    onStatus,
    signal,
    fetchImpl: window.fetch.bind(window),
    globalObj: window,
    webgpuRunner: runWebGpuStructured,
    webgpuLoaded: Boolean(webgpuState.engine)
  });
}

export { testGeminiByok, discoverOpenAiCompatModels };
