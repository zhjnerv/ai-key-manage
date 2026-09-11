import type {
  BenchmarkRoundRequest,
  BenchmarkRoundResponse,
  EndpointTestRequest,
  EndpointTestResponse,
  ImageGenerationTestRequest,
  ImageGenerationTestResponse,
  ModelProbeRequest,
  ModelProbeResponse,
  ResponseTransport,
  TextProtocol,
} from "./ai-endpoint-types";

const FAIL_TEXT = "主人，我不行了";
const PASS_TEXT = "主人，快鞭策我吧";
const ANTHROPIC_VERSION = "2023-06-01";
const TEXT_MODEL_CANDIDATES = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-4.1-mini",
  "gpt-4o-mini",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
];

const IMAGE_MODEL_PATTERNS = [
  /gpt[-_.]?image/i,
  /dall[-_. ]?e/i,
  /\bflux(?:[-_.]|$)/i,
  /stable[-_. ]?diffusion/i,
  /\bsdxl(?:[-_.]|$)/i,
  /\bimagen(?:[-_.]|$)/i,
  /\bideogram(?:[-_.]|$)/i,
  /\brecraft(?:[-_.]|$)/i,
  /\bseedream(?:[-_.]|$)/i,
  /\bcogview(?:[-_.]|$)/i,
  /\bkolors(?:[-_.]|$)/i,
  /qwen[-_.]?image/i,
  /wanx[-_.]?image/i,
  /image[-_.]?generation/i,
];

const ENDPOINT_SUFFIX_RE = /\/(?:chat\/completions|responses?|messages|models|images\/generations|completions)$/i;

type TextAttempt = {
  ok: boolean;
  text: string;
  elapsedMs: number;
  protocol: TextProtocol;
  transport: ResponseTransport;
  firstTokenMs?: number;
  error?: string;
};

type JsonRequestResult = {
  response: Response;
  payload: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cleanOneLineText(input: string, maxLen = 260): string {
  const value = input.replace(/\s+/g, " ").trim();
  return value.length <= maxLen ? value : `${value.slice(0, maxLen)}...`;
}

function cleanMultilineText(input: string, maxLen = 2000): string {
  const value = input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return value.length <= maxLen ? value : `${value.slice(0, maxLen).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

export function normalizeBaseUrl(raw: string): string {
  const cleaned = raw.trim().replace(/\/+$/, "");
  if (!cleaned) return "";
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

/**
 * 将用户粘贴的域名或具体 API 地址收敛为版本根路径，供多协议端点共同使用。
 */
export function toAiApiBaseUrl(raw: string): string {
  const normalized = normalizeBaseUrl(raw);
  if (!normalized) return "";

  try {
    const url = new URL(normalized);
    url.search = "";
    url.hash = "";
    let pathname = url.pathname.replace(/\/+$/, "");
    pathname = pathname.replace(ENDPOINT_SUFFIX_RE, "").replace(/\/+$/, "");
    if (!/\/v\d+$/i.test(pathname)) pathname = `${pathname}/v1`;
    url.pathname = pathname.replace(/\/{2,}/g, "/");
    return url.toString().replace(/\/+$/, "");
  } catch {
    const withoutEndpoint = normalized.replace(ENDPOINT_SUFFIX_RE, "");
    return /\/v\d+$/i.test(withoutEndpoint) ? withoutEndpoint : `${withoutEndpoint}/v1`;
  }
}

export function cleanKey(raw: string): string {
  return raw.replace(/^Bearer\s+/i, "").trim();
}

export function isLikelyImageGenerationModel(model: string): boolean {
  const normalized = model.trim();
  return Boolean(normalized) && IMAGE_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isClaudeModel(model: string): boolean {
  return /(?:^|[-_.])claude(?:[-_.]|$)/i.test(model) || /anthropic/i.test(model);
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") return cleanOneLineText(error);
  if (!isRecord(error)) return "";

  for (const value of [error.error, error.message]) {
    if (typeof value === "string" && value.trim()) return cleanOneLineText(value);
    if (isRecord(value) && typeof value.message === "string" && value.message.trim()) {
      return cleanOneLineText(value.message);
    }
  }

  const nestedPaths = [
    ["response", "error", "message"],
    ["response", "data", "error", "message"],
    ["data", "error", "message"],
    ["body", "error", "message"],
    ["cause", "message"],
  ];

  for (const path of nestedPaths) {
    let current: unknown = error;
    for (const key of path) {
      if (!isRecord(current)) {
        current = "";
        break;
      }
      current = current[key];
    }
    if (typeof current === "string" && current.trim()) return cleanOneLineText(current);
  }

  return "";
}

export function makeErrorDetail(error: unknown): string {
  const record = isRecord(error) ? error : {};
  const status = typeof record.status === "number" ? record.status : undefined;
  const name = typeof record.name === "string" ? record.name : "";
  const raw = getErrorMessage(error);

  let detail = "测试异常，请检查地址、模型或协议";
  if (status === 401 || status === 403) detail = "Key 无效或权限不足";
  else if (status === 404) detail = "地址可达，但目标协议端点不存在";
  else if (status === 429) detail = "请求过于频繁或额度不足";
  else if (typeof status === "number") detail = `请求失败（HTTP ${status}）`;
  else if (name === "AbortError" || /timeout|timed out|aborted/i.test(raw)) detail = "请求超时，请检查地址或模型";
  else if (error instanceof TypeError || /failed to fetch|network|cors|load failed|connection|enotfound|econnrefused/i.test(raw)) {
    detail = "浏览器无法直连该地址，可能被 CORS、证书或网络策略拦截";
  }

  if (!raw || detail.includes(raw)) return detail;
  return `${detail}；接口返回：${raw}`;
}

const RATE_LIMIT_BACKOFF_MS = [5000, 15000, 30000, 65000] as const;
const MAX_RATE_LIMIT_RETRIES = RATE_LIMIT_BACKOFF_MS.length;
const RATE_LIMIT_TEXT_RE = /rate[\s_-]*limit|too many requests|\btpm\b|\brpm\b|tokens? per minute|requests? per minute|每分钟|限流|请求过于频繁|频率限制/i;
const MINUTE_LIMIT_TEXT_RE = /\btpm\b|\brpm\b|tokens? per minute|requests? per minute|per minute|每分钟|分钟额度/i;

function parseDurationMs(value: string, nowMs: number): number | undefined {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) return Math.max(0, numeric - nowMs);
    if (numeric > 1_000_000_000) return Math.max(0, numeric * 1000 - nowMs);
    return Math.max(0, numeric * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);

  let totalMs = 0;
  let matched = false;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2];
    totalMs += amount * (unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000);
  }
  return matched ? totalMs : undefined;
}

function getHeaderRetryDelayMs(response: Response, nowMs: number): number | undefined {
  const retryAfterMs = response.headers.get("retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number(retryAfterMs);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const parsed = parseDurationMs(retryAfter, nowMs);
    if (parsed !== undefined) return parsed;
  }

  const resetHeaders = [
    "x-ratelimit-reset",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
  ];
  const delays = resetHeaders
    .map((name) => response.headers.get(name))
    .filter((value): value is string => Boolean(value))
    .map((value) => parseDurationMs(value, nowMs))
    .filter((value): value is number => value !== undefined);
  return delays.length > 0 ? Math.max(...delays) : undefined;
}

export function getRateLimitDelayMs(
  response: Response,
  payload: unknown,
  retryIndex: number,
  nowMs = Date.now(),
): number | undefined {
  const message = getErrorMessage(payload);
  if (response.status !== 429 && !RATE_LIMIT_TEXT_RE.test(message)) return undefined;

  const headerDelay = getHeaderRetryDelayMs(response, nowMs);
  if (headerDelay !== undefined) return Math.min(65000, Math.max(1000, Math.round(headerDelay)));
  if (MINUTE_LIMIT_TEXT_RE.test(message)) return 65000;
  return RATE_LIMIT_BACKOFF_MS[Math.min(retryIndex, RATE_LIMIT_BACKOFF_MS.length - 1)];
}

function isRateLimitErrorText(value: string): boolean {
  return RATE_LIMIT_TEXT_RE.test(value);
}

function isAuthenticationErrorText(value: string): boolean {
  return /invalid token|invalid api key|incorrect api key|unauthorized|authentication|鉴权失败|令牌无效|密钥无效/i.test(value);
}

function compactErrors(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    const key = value.replace(/\s*\(request id:[^)]+\)/gi, "").replace(/request[_ -]?id[：:]?\s*[A-Za-z0-9_-]+/gi, "").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

async function waitForRateLimit(delayMs: number, url: string, retryNumber: number): Promise<void> {
  let upstreamHost = "unknown";
  try {
    upstreamHost = new URL(url).host;
  } catch {
    // URL 已在上游调用前校验；这里只保留安全的诊断信息。
  }
  console.log(JSON.stringify({ event: "rate_limit_wait", upstreamHost, retryNumber, delayMs }));
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
}

async function fetchOnceWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

async function fetchResponseWithRateLimitRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  for (let retryIndex = 0; ; retryIndex += 1) {
    const response = await fetchOnceWithTimeout(url, init, timeoutMs);
    const payload = response.ok ? null : await readPayload(response.clone());
    const delayMs = getRateLimitDelayMs(response, payload, retryIndex);
    if (delayMs === undefined || retryIndex >= MAX_RATE_LIMIT_RETRIES) return response;
    await waitForRateLimit(delayMs, url, retryIndex + 1);
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: cleanOneLineText(text) };
    }
  } catch {
    return null;
  }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<JsonRequestResult> {
  for (let retryIndex = 0; ; retryIndex += 1) {
    const response = await fetchOnceWithTimeout(url, init, timeoutMs);
    const payload = await readPayload(response);
    const delayMs = getRateLimitDelayMs(response, payload, retryIndex);
    if (delayMs === undefined || retryIndex >= MAX_RATE_LIMIT_RETRIES) return { response, payload };
    await waitForRateLimit(delayMs, url, retryIndex + 1);
  }
}

function requestError(response: Response, payload: unknown): string {
  return getErrorMessage(payload) || `HTTP ${response.status}`;
}

function toReadableResponseText(content: unknown): string {
  if (typeof content === "string") return cleanMultilineText(content);
  if (!Array.isArray(content)) return "";
  return cleanMultilineText(
    content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!isRecord(part)) return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join("\n"),
  );
}

function extractChatText(payload: unknown): string {
  const choice = isRecord(payload) && Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  const message = isRecord(choice) ? choice.message : undefined;
  return toReadableResponseText(isRecord(message) ? message.content : undefined);
}

function extractResponseText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return cleanMultilineText(payload.output_text);
  if (!Array.isArray(payload.output)) return "";

  return cleanMultilineText(
    payload.output
      .flatMap((item) => {
        if (!isRecord(item) || !Array.isArray(item.content)) return [];
        return item.content.map((part) => {
          if (!isRecord(part)) return "";
          if (typeof part.text === "string") return part.text;
          return typeof part.refusal === "string" ? part.refusal : "";
        });
      })
      .filter(Boolean)
      .join("\n"),
  );
}

function extractMessageText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return "";
  return cleanMultilineText(
    payload.content
      .map((block) => (isRecord(block) && block.type === "text" && typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n"),
  );
}

function extractStreamDeltaText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return "";
  const choice = payload.choices[0];
  const delta = isRecord(choice) ? choice.delta : undefined;
  if (!isRecord(delta)) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content
      .map((part) => {
        if (typeof part === "string") return part;
        return isRecord(part) && typeof part.text === "string" ? part.text : "";
      })
      .join("");
  }
  return typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
}

function isLowSignalText(text: string): boolean {
  const value = text.trim().toLowerCase();
  if (!value) return true;
  return ["ok", "okay", "ok.", "ok!", "好的", "收到", "收到。", "已收到", "明白", "在", "在的", "hi", "hello"].includes(value);
}

function scoreText(text: string): number {
  const value = text.trim();
  if (!value) return -1;
  let score = Math.min(value.length, 240);
  if (/[\u4e00-\u9fa5]/.test(value)) score += 40;
  if (!isLowSignalText(value)) score += 120;
  if (/[，。！？,.!?]/.test(value)) score += 20;
  return score;
}

function pickBestAttempt(attempts: TextAttempt[]): TextAttempt | undefined {
  return attempts
    .filter((attempt) => attempt.ok && attempt.text.trim())
    .sort((left, right) => scoreText(right.text) - scoreText(left.text) || left.elapsedMs - right.elapsedMs)[0];
}

async function requestChatJson(baseUrl: string, apiKey: string, model: string, prompt: string, maxTokens: number): Promise<TextAttempt> {
  const startedAt = performance.now();
  try {
    const { response, payload } = await fetchJson(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens }),
      },
      12000,
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok || (isRecord(payload) && "error" in payload)) {
      return { ok: false, text: "", elapsedMs, protocol: "chat", transport: "json", error: requestError(response, payload) };
    }
    const text = extractChatText(payload);
    return text
      ? { ok: true, text, elapsedMs, protocol: "chat", transport: "json" }
      : { ok: false, text: "", elapsedMs, protocol: "chat", transport: "json", error: "未返回消息内容" };
  } catch (error) {
    return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "chat", transport: "json", error: makeErrorDetail(error) };
  }
}

function parseSseBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((data) => data && data !== "[DONE]")
    .map((data) => {
      try {
        return extractStreamDeltaText(JSON.parse(data) as unknown);
      } catch {
        return "";
      }
    })
    .join("");
}

async function requestChatStream(baseUrl: string, apiKey: string, model: string, prompt: string, maxTokens: number): Promise<TextAttempt> {
  const startedAt = performance.now();
  try {
    const response = await fetchResponseWithRateLimitRetry(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, stream: true }),
      },
      20000,
    );

    if (!response.ok) {
      const payload = await readPayload(response);
      return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "chat", transport: "stream", error: requestError(response, payload) };
    }
    if (!response.body) {
      return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "chat", transport: "stream", error: "流式响应不可用" };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let firstTokenMs: number | undefined;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const delta = parseSseBlock(block);
        if (!delta) continue;
        if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - startedAt);
        text += delta;
      }
    }

    const finalDelta = parseSseBlock(buffer.replace(/\r\n/g, "\n"));
    if (finalDelta) {
      if (firstTokenMs === undefined) firstTokenMs = Math.round(performance.now() - startedAt);
      text += finalDelta;
    }

    const elapsedMs = Math.round(performance.now() - startedAt);
    const cleaned = cleanMultilineText(text.replace(/```(?:json)?/gi, "").replace(/```/g, ""));
    return cleaned
      ? { ok: true, text: cleaned, elapsedMs, firstTokenMs, protocol: "chat", transport: "stream" }
      : { ok: false, text: "", elapsedMs, protocol: "chat", transport: "stream", error: "流式响应未返回可读内容" };
  } catch (error) {
    return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "chat", transport: "stream", error: makeErrorDetail(error) };
  }
}

async function requestResponses(baseUrl: string, apiKey: string, model: string, prompt: string): Promise<TextAttempt> {
  const startedAt = performance.now();
  try {
    const { response, payload } = await fetchJson(
      `${baseUrl}/responses`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: prompt }),
      },
      12000,
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok || (isRecord(payload) && "error" in payload)) {
      return { ok: false, text: "", elapsedMs, protocol: "response", transport: "json", error: requestError(response, payload) };
    }
    const text = extractResponseText(payload);
    return text
      ? { ok: true, text, elapsedMs, protocol: "response", transport: "json" }
      : { ok: false, text: "", elapsedMs, protocol: "response", transport: "json", error: "未返回消息内容" };
  } catch (error) {
    return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "response", transport: "json", error: makeErrorDetail(error) };
  }
}

async function requestMessages(baseUrl: string, apiKey: string, model: string, prompt: string, maxTokens: number): Promise<TextAttempt> {
  const startedAt = performance.now();
  try {
    const { response, payload } = await fetchJson(
      `${baseUrl}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      },
      15000,
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok || (isRecord(payload) && payload.type === "error")) {
      return { ok: false, text: "", elapsedMs, protocol: "message", transport: "json", error: requestError(response, payload) };
    }
    const text = extractMessageText(payload);
    return text
      ? { ok: true, text, elapsedMs, protocol: "message", transport: "json" }
      : { ok: false, text: "", elapsedMs, protocol: "message", transport: "json", error: "未返回消息内容" };
  } catch (error) {
    return { ok: false, text: "", elapsedMs: Math.round(performance.now() - startedAt), protocol: "message", transport: "json", error: makeErrorDetail(error) };
  }
}

async function executeTextAttempts(baseUrl: string, apiKey: string, model: string, prompt: string, maxTokens: number): Promise<TextAttempt[]> {
  const attempts: TextAttempt[] = [];
  const sequence = isClaudeModel(model)
    ? [requestMessages, requestChatStream, requestChatJson, requestResponses]
    : [requestChatStream, requestChatJson, requestResponses, requestMessages];

  for (const request of sequence) {
    const result = await request(baseUrl, apiKey, model, prompt, maxTokens);
    attempts.push(result);
    if (result.ok && !isLowSignalText(result.text)) break;
    if (result.error && isRateLimitErrorText(result.error)) break;
  }
  return attempts;
}

function protocolLabel(protocol: TextProtocol, transport: ResponseTransport): string {
  if (protocol === "chat") return transport === "stream" ? "chat（流式）" : "chat";
  return protocol;
}

function formatAttemptErrors(attempts: TextAttempt[]): string {
  return compactErrors(
    attempts
      .filter((attempt) => !attempt.ok && attempt.error)
      .map((attempt) => `${protocolLabel(attempt.protocol, attempt.transport)}：${attempt.error}`),
  ).join("；");
}

export async function runEndpointTest(input: EndpointTestRequest): Promise<EndpointTestResponse> {
  const baseUrl = toAiApiBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const model = input.model?.trim() || "gpt-4o-mini";
  const testedAt = new Date().toISOString();

  if (!baseUrl || !apiKey) {
    return { ok: false, result: { status: "error", message: FAIL_TEXT, detail: "地址或 Key 为空", testedAt } };
  }
  if (isLikelyImageGenerationModel(model)) {
    return { ok: false, result: { status: "error", message: FAIL_TEXT, detail: "当前模型看起来是图像生成模型，请使用图像测试", testedAt } };
  }

  const attempts = await executeTextAttempts(baseUrl, apiKey, model, "你是谁？请用一句简短中文回复，不要使用 Markdown。", 48);
  const best = pickBestAttempt(attempts);
  if (best) {
    const label = protocolLabel(best.protocol, best.transport);
    return {
      ok: true,
      result: {
        status: "success",
        message: PASS_TEXT,
        detail: `接口连通，协议：${label}`,
        responseText: best.text,
        protocol: best.protocol,
        transport: best.transport,
        testedAt,
      },
    };
  }

  return {
    ok: false,
    result: {
      status: "error",
      message: FAIL_TEXT,
      detail: formatAttemptErrors(attempts) || "所有文本协议均未返回可读内容",
      testedAt,
    },
  };
}

function extractModels(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return uniqueStrings(
    payload.data.map((item) => (isRecord(item) && typeof item.id === "string" ? item.id : "")),
  );
}

function chooseRecommendedModel(currentModel: string, models: string[]): string {
  const current = currentModel.trim();
  if (current && models.includes(current) && !isLikelyImageGenerationModel(current)) return current;
  for (const candidate of TEXT_MODEL_CANDIDATES) {
    if (models.includes(candidate)) return candidate;
  }
  return models.find((model) => !isLikelyImageGenerationModel(model)) || "";
}

type ModelRequestResult = {
  models: string[];
  error?: string;
  authenticationRejected?: boolean;
  rateLimited?: boolean;
};

type ModelAuthentication = "bearer" | "anthropic" | "none";

async function requestModels(baseUrl: string, apiKey: string, authentication: ModelAuthentication): Promise<ModelRequestResult> {
  try {
    const headers: Record<string, string> = authentication === "none"
      ? {}
      : authentication === "anthropic"
        ? {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-dangerous-direct-browser-access": "true",
          }
        : { Authorization: `Bearer ${apiKey}` };
    const { response, payload } = await fetchJson(`${baseUrl}/models`, { headers }, 10000);
    if (!response.ok) {
      const error = requestError(response, payload);
      return {
        models: [],
        error,
        authenticationRejected: response.status === 401 || response.status === 403 || isAuthenticationErrorText(error),
        rateLimited: response.status === 429 || isRateLimitErrorText(error),
      };
    }
    const models = extractModels(payload);
    return models.length > 0 ? { models } : { models: [], error: "/models 可达，但未返回可识别模型" };
  } catch (error) {
    const detail = makeErrorDetail(error);
    return { models: [], error: detail, rateLimited: isRateLimitErrorText(detail) };
  }
}

export async function runPublicModelProbe(input: ModelProbeRequest): Promise<ModelProbeResponse> {
  const baseUrl = toAiApiBaseUrl(input.baseUrl);
  const currentModel = input.currentModel?.trim() || "";
  const testedAt = new Date().toISOString();
  if (!baseUrl) {
    return { ok: false, result: { status: "error", supportedModels: [], imageModels: [], detail: "地址为空，无法探测模型", testedAt } };
  }

  const attempt = await requestModels(baseUrl, "", "none");
  if (attempt.models.length === 0) {
    return {
      ok: false,
      result: {
        status: "error",
        supportedModels: [],
        imageModels: [],
        detail: `HTTP 模型探测未携带 Key：${attempt.error || "未返回可识别模型"}`,
        testedAt,
      },
    };
  }

  const imageModels = attempt.models.filter(isLikelyImageGenerationModel);
  return {
    ok: true,
    result: {
      status: "success",
      supportedModels: attempt.models,
      imageModels,
      recommendedModel: chooseRecommendedModel(currentModel, attempt.models) || undefined,
      detail: `通过公开 HTTP /models 识别 ${attempt.models.length} 个模型；未向上游发送 Key`,
      testedAt,
    },
  };
}

export async function runModelProbe(input: ModelProbeRequest): Promise<ModelProbeResponse> {
  const baseUrl = toAiApiBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const currentModel = input.currentModel?.trim() || "";
  const testedAt = new Date().toISOString();

  if (!baseUrl || !apiKey) {
    return { ok: false, result: { status: "error", supportedModels: [], imageModels: [], detail: "地址或 Key 为空，无法探测模型", testedAt } };
  }

  const bearerModels = await requestModels(baseUrl, apiKey, "bearer");
  const modelAttempts = [bearerModels];
  if (bearerModels.models.length === 0 && !bearerModels.rateLimited) {
    modelAttempts.push(await requestModels(baseUrl, apiKey, "anthropic"));
  }
  const models = uniqueStrings(modelAttempts.flatMap((attempt) => attempt.models));
  if (models.length > 0) {
    const imageModels = models.filter(isLikelyImageGenerationModel);
    return {
      ok: true,
      result: {
        status: "success",
        supportedModels: models,
        imageModels,
        recommendedModel: chooseRecommendedModel(currentModel, models) || undefined,
        detail: `读取 /models 成功，共识别 ${models.length} 个模型，其中图像模型 ${imageModels.length} 个`,
        testedAt,
      },
    };
  }

  const modelErrors = compactErrors(modelAttempts.map((attempt) => attempt.error || ""));
  const allAuthenticationRejected = modelAttempts.length > 0 && modelAttempts.every((attempt) => attempt.authenticationRejected);
  const anyRateLimited = modelAttempts.some((attempt) => attempt.rateLimited);
  if (allAuthenticationRejected || anyRateLimited) {
    return {
      ok: false,
      result: {
        status: "error",
        supportedModels: [],
        imageModels: [],
        detail: modelErrors.join("；") || (anyRateLimited ? "模型接口触发限流，自动重试后仍不可用" : "模型接口鉴权失败"),
        testedAt,
      },
    };
  }

  const supportedModels: string[] = [];
  const fallbackModels = uniqueStrings([currentModel, ...TEXT_MODEL_CANDIDATES]).filter((model) => model && !isLikelyImageGenerationModel(model));
  const fallbackErrors: string[] = [];
  for (const model of fallbackModels) {
    const response = await runEndpointTest({ baseUrl, apiKey, model });
    if (response.ok) supportedModels.push(model);
    else if (response.result.detail) fallbackErrors.push(response.result.detail);
  }

  const imageModels = currentModel && isLikelyImageGenerationModel(currentModel) ? [currentModel] : [];
  if (supportedModels.length > 0 || imageModels.length > 0) {
    return {
      ok: true,
      result: {
        status: "success",
        supportedModels: uniqueStrings([...supportedModels, ...imageModels]),
        imageModels,
        recommendedModel: chooseRecommendedModel(currentModel, supportedModels) || undefined,
        detail: `未能读取 /models；文本协议试探成功 ${supportedModels.length} 个${imageModels.length ? "，并按名称识别 1 个图像模型" : ""}`,
        testedAt,
      },
    };
  }

  return {
    ok: false,
    result: {
      status: "error",
      supportedModels: [],
      imageModels: [],
      detail: compactErrors([...modelErrors, ...fallbackErrors]).join("；") || "未探测到可用模型",
      testedAt,
    },
  };
}

export async function runModelBenchmarkRound(input: BenchmarkRoundRequest): Promise<BenchmarkRoundResponse> {
  const baseUrl = toAiApiBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const model = input.model.trim();
  if (!baseUrl || !apiKey) return { ok: false, error: "地址或 Key 为空，无法执行模型测试" };
  if (!model) return { ok: false, error: "模型为空，无法执行模型测试" };
  if (isLikelyImageGenerationModel(model)) return { ok: false, error: "图像模型不参与文本性能评测" };

  const attempts = await executeTextAttempts(baseUrl, apiKey, model, "Reply with exactly OK. Do not add anything else.", 8);
  const best = pickBestAttempt(attempts);
  if (!best) return { ok: false, error: formatAttemptErrors(attempts) || "测速失败，未返回可读内容" };
  return {
    ok: true,
    sample: {
      elapsedMs: best.elapsedMs,
      firstTokenMs: best.firstTokenMs,
      protocol: best.protocol,
    },
  };
}

export async function runImageGenerationTest(input: ImageGenerationTestRequest): Promise<ImageGenerationTestResponse> {
  const baseUrl = toAiApiBaseUrl(input.baseUrl);
  const apiKey = cleanKey(input.apiKey);
  const model = input.model.trim();
  const testedAt = new Date().toISOString();
  if (!baseUrl || !apiKey || !model) {
    return { ok: false, result: { status: "error", model, protocol: "images", detail: "地址、Key 或图像模型为空", testedAt } };
  }

  const startedAt = performance.now();
  try {
    const { response, payload } = await fetchJson(
      `${baseUrl}/images/generations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          prompt: "A simple green circle centered on a clean white background, flat icon style, no text.",
          n: 1,
        }),
      },
      90000,
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok || (isRecord(payload) && "error" in payload)) {
      return { ok: false, result: { status: "error", model, protocol: "images", detail: requestError(response, payload), elapsedMs, testedAt } };
    }

    const first = isRecord(payload) && Array.isArray(payload.data) ? payload.data[0] : undefined;
    const imageUrl = isRecord(first)
      ? typeof first.b64_json === "string" && first.b64_json
        ? `data:image/png;base64,${first.b64_json}`
        : typeof first.url === "string"
          ? first.url
          : ""
      : "";
    const revisedPrompt = isRecord(first) && typeof first.revised_prompt === "string" ? first.revised_prompt : undefined;
    if (!imageUrl) {
      return { ok: false, result: { status: "error", model, protocol: "images", detail: "Images 接口成功，但未返回可显示的图片", elapsedMs, testedAt } };
    }

    return {
      ok: true,
      result: {
        status: "success",
        model,
        protocol: "images",
        detail: `图像生成成功，协议：images，耗时 ${(elapsedMs / 1000).toFixed(2)} 秒`,
        imageUrl,
        revisedPrompt,
        elapsedMs,
        testedAt,
      },
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        status: "error",
        model,
        protocol: "images",
        detail: makeErrorDetail(error),
        elapsedMs: Math.round(performance.now() - startedAt),
        testedAt,
      },
    };
  }
}