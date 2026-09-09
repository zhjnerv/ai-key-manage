export type TextProtocol = "chat" | "response" | "message";
export type ResponseTransport = "stream" | "json";

export type EndpointTestRequest = {
  baseUrl: string;
  apiKey: string;
  model?: string;
};

export type EndpointTestResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    message: string;
    detail?: string;
    responseText?: string;
    protocol?: TextProtocol;
    transport?: ResponseTransport;
    testedAt: string;
  };
};

export type ModelProbeRequest = {
  baseUrl: string;
  apiKey: string;
  currentModel?: string;
};

export type ModelProbeResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    supportedModels: string[];
    imageModels: string[];
    recommendedModel?: string;
    detail?: string;
    testedAt: string;
  };
};

export type BenchmarkRoundRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type BenchmarkRoundResponse = {
  ok: boolean;
  sample?: {
    elapsedMs: number;
    firstTokenMs?: number;
    protocol?: TextProtocol;
  };
  error?: string;
};

export type ImageGenerationTestRequest = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ImageGenerationTestResponse = {
  ok: boolean;
  result: {
    status: "success" | "error";
    model: string;
    protocol: "images";
    detail?: string;
    imageUrl?: string;
    revisedPrompt?: string;
    elapsedMs?: number;
    testedAt: string;
  };
};