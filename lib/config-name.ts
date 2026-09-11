const GENERIC_HOST_PREFIXES = new Set([
  "ai",
  "api",
  "gateway",
  "metapi",
  "newapi",
  "openai",
  "proxy",
  "relay",
  "server",
  "www",
]);

function cleanNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^api[-_]?/i, "")
    .replace(/[-_]?api$/i, "")
    .replace(/[^a-z0-9\p{L}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * 从 Base URL 提取便于识别的短名称；通用 API 前缀会被跳过。
 */
export function deriveConfigNameFromBaseUrl(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) return "";

  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname) return "";
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return hostname;

    const labels = hostname.split(".").filter(Boolean);
    if (labels.length === 0) return "";

    let candidateIndex = 0;
    while (candidateIndex < labels.length - 1 && GENERIC_HOST_PREFIXES.has(labels[candidateIndex])) {
      candidateIndex += 1;
    }

    return cleanNamePart(labels[candidateIndex]) || cleanNamePart(labels[0]);
  } catch {
    return "";
  }
}
