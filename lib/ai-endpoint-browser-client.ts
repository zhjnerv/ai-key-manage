import {
  isLikelyImageGenerationModel,
  makeErrorDetail,
  runEndpointTest as runEndpointTestDirect,
  runImageGenerationTest as runImageGenerationTestDirect,
  runModelBenchmarkRound as runModelBenchmarkRoundDirect,
  runModelProbe as runModelProbeDirect,
} from "./ai-endpoint-client";
import type {
  BenchmarkRoundRequest,
  BenchmarkRoundResponse,
  EndpointTestRequest,
  EndpointTestResponse,
  ImageGenerationTestRequest,
  ImageGenerationTestResponse,
  ModelProbeRequest,
  ModelProbeResponse,
} from "./ai-endpoint-types";

export { isLikelyImageGenerationModel, makeErrorDetail };

const USE_SERVER_PROXY = process.env.NEXT_PUBLIC_USE_SERVER_PROXY === "1";
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

async function postServerApi<TRequest, TResponse>(path: string, input: TRequest): Promise<TResponse> {
  const response = await fetch(`${APP_BASE_PATH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `服务端代理请求失败：HTTP ${response.status}`);
  }

  return (await response.json()) as TResponse;
}

export function runEndpointTest(input: EndpointTestRequest): Promise<EndpointTestResponse> {
  return USE_SERVER_PROXY
    ? postServerApi<EndpointTestRequest, EndpointTestResponse>("/api/test", input)
    : runEndpointTestDirect(input);
}

export function runModelProbe(input: ModelProbeRequest): Promise<ModelProbeResponse> {
  return USE_SERVER_PROXY
    ? postServerApi<ModelProbeRequest, ModelProbeResponse>("/api/probe", input)
    : runModelProbeDirect(input);
}

export function runModelBenchmarkRound(input: BenchmarkRoundRequest): Promise<BenchmarkRoundResponse> {
  return USE_SERVER_PROXY
    ? postServerApi<BenchmarkRoundRequest, BenchmarkRoundResponse>("/api/benchmark", input)
    : runModelBenchmarkRoundDirect(input);
}

export function runImageGenerationTest(input: ImageGenerationTestRequest): Promise<ImageGenerationTestResponse> {
  return USE_SERVER_PROXY
    ? postServerApi<ImageGenerationTestRequest, ImageGenerationTestResponse>("/api/image", input)
    : runImageGenerationTestDirect(input);
}
