import test from "node:test";
import assert from "node:assert/strict";

import {
  getRateLimitDelayMs,
  isLikelyImageGenerationModel,
  runEndpointTest,
  runImageGenerationTest,
  runModelProbe,
  toAiApiBaseUrl,
} from "../lib/ai-endpoint-client.ts";

function jsonResponse(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("规范化常见 API 地址", () => {
  assert.equal(toAiApiBaseUrl("api.example.com"), "https://api.example.com/v1");
  assert.equal(toAiApiBaseUrl("https://api.example.com/v1/chat/completions"), "https://api.example.com/v1");
  assert.equal(toAiApiBaseUrl("https://api.example.com/v1/messages"), "https://api.example.com/v1");
  assert.equal(toAiApiBaseUrl("https://api.example.com/openai/v2/images/generations"), "https://api.example.com/openai/v2");
});

test("识别主流 OpenAI 兼容图像模型", () => {
  for (const model of ["gpt-image-2.5-sunburst", "gpt-image-1", "dall-e-3", "flux-1.1-pro", "stable-diffusion-xl", "qwen-image"]) {
    assert.equal(isLikelyImageGenerationModel(model), true, model);
  }
  for (const model of ["gpt-5", "claude-sonnet-5", "qwen-vl-max", "text-embedding-3-large"]) {
    assert.equal(isLikelyImageGenerationModel(model), false, model);
  }
});

test("Claude 模型优先使用 message 协议并输出协议类型", async (t) => {
  const calls: Array<{ url: string; headers: Headers }> = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return jsonResponse({ content: [{ type: "text", text: "我是 Claude。" }] });
  });

  const response = await runEndpointTest({
    baseUrl: "https://api.anthropic.test",
    apiKey: "sk-ant-test",
    model: "claude-sonnet-test",
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.protocol, "message");
  assert.equal(response.result.transport, "json");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/messages$/);
  assert.equal(calls[0].headers.get("x-api-key"), "sk-ant-test");
  assert.equal(calls[0].headers.get("anthropic-version"), "2023-06-01");
  assert.equal(calls[0].headers.get("anthropic-dangerous-direct-browser-access"), "true");
});

test("chat 不可用时回退 response 协议", async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/responses")) return jsonResponse({ output_text: "Responses 协议可用。" });
    return jsonResponse({ error: { message: "not found" } }, 404);
  });

  const response = await runEndpointTest({
    baseUrl: "https://api.example.test/v1",
    apiKey: "sk-test",
    model: "gpt-test",
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.protocol, "response");
  assert.equal(response.result.responseText, "Responses 协议可用。");
  assert.deepEqual(urls, [
    "https://api.example.test/v1/chat/completions",
    "https://api.example.test/v1/chat/completions",
    "https://api.example.test/v1/responses",
  ]);
});

test("模型列表自动分类图像模型", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    jsonResponse({ data: [{ id: "gpt-5" }, { id: "gpt-image-2.5-flare" }, { id: "flux-1.1-pro" }] }),
  );

  const response = await runModelProbe({ baseUrl: "https://api.example.test", apiKey: "sk-test", currentModel: "gpt-5" });
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.imageModels, ["gpt-image-2.5-flare", "flux-1.1-pro"]);
  assert.equal(response.result.recommendedModel, "gpt-5");
});

test("Images 协议返回可预览图片", async (t) => {
  t.mock.method(globalThis, "fetch", async () => jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }));
  const response = await runImageGenerationTest({
    baseUrl: "https://api.example.test",
    apiKey: "sk-test",
    model: "gpt-image-2.5-sunburst",
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.protocol, "images");
  assert.equal(response.result.imageUrl, "data:image/png;base64,aGVsbG8=");
});

test("限流等待优先采用响应头并封顶 65 秒", () => {
  assert.equal(
    getRateLimitDelayMs(new Response("", { status: 429, headers: { "Retry-After": "12" } }), null, 0, 0),
    12000,
  );
  assert.equal(
    getRateLimitDelayMs(new Response("", { status: 429, headers: { "Retry-After": "120" } }), null, 0, 0),
    65000,
  );
  assert.equal(
    getRateLimitDelayMs(new Response("", { status: 400 }), { error: { message: "TPM limit exceeded per minute" } }, 0, 0),
    65000,
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => getRateLimitDelayMs(new Response("", { status: 429 }), null, index, 0)),
    [5000, 15000, 30000, 65000],
  );
});

test("模型列表触发限流后自动等待并重试当前请求", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse({ error: { message: "rate limit" } }, 429, { "retry-after-ms": "1" });
    }
    return jsonResponse({ data: [{ id: "gpt-5" }] });
  });

  const response = await runModelProbe({ baseUrl: "https://api.example.test", apiKey: "sk-test", currentModel: "gpt-5" });
  assert.equal(response.ok, true);
  assert.equal(calls, 2);
});

test("模型接口两种鉴权均被拒绝时不再轰炸候选模型", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return jsonResponse({ error: { message: `Invalid token (request id: request-${calls})` } }, 401);
  });

  const response = await runModelProbe({ baseUrl: "https://api.example.test", apiKey: "wrong-token" });
  assert.equal(response.ok, false);
  assert.equal(calls, 2);
  assert.match(response.result.detail || "", /Invalid token/);
  assert.doesNotMatch(response.result.detail || "", /gpt-5/);
});
