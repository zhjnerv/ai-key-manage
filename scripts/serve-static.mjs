import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "out");
const port = Number(process.env.PORT || 3000);
const host = process.env.HOSTNAME || "0.0.0.0";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function resolveFile(urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]);
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let candidate = join(root, safePath);
  if (existsSync(candidate) && statSync(candidate).isDirectory()) candidate = join(candidate, "index.html");
  if (!existsSync(candidate) && !extname(candidate)) candidate = join(candidate, "index.html");
  return candidate.startsWith(root) && existsSync(candidate) ? candidate : join(root, "404.html");
}

createServer((request, response) => {
  const file = resolveFile(request.url);
  const status = file.endsWith("404.html") ? 404 : 200;
  response.writeHead(status, {
    "content-type": contentTypes[extname(file)] || "application/octet-stream",
    "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(file).pipe(response);
}).listen(port, host, () => {
  console.log(`AI Key Vault static server: http://${host}:${port}`);
});