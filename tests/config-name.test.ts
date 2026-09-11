import test from "node:test";
import assert from "node:assert/strict";

import { deriveConfigNameFromBaseUrl } from "../lib/config-name.ts";

test("从 API Base URL 自动提取便于记忆的名称", () => {
  assert.equal(deriveConfigNameFromBaseUrl("https://api.furry.vg/v1"), "furry");
  assert.equal(deriveConfigNameFromBaseUrl("metapi.lilililwan.xyz"), "lilililwan");
  assert.equal(deriveConfigNameFromBaseUrl("https://example.com/openai/v1"), "example");
});

test("公网 IP 和空地址使用可预期名称", () => {
  assert.equal(deriveConfigNameFromBaseUrl("http://20.119.96.222:4000/v1"), "20.119.96.222");
  assert.equal(deriveConfigNameFromBaseUrl(""), "");
});
