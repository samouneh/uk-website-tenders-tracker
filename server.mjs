import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./", import.meta.url));
const port = Number(process.env.PORT || 4173);

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer((req, res) => {
  const requestPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const safePath = normalize(requestPath).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": mime[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-cache",
  });

  createReadStream(filePath).pipe(res);
}).listen(port, () => {
  console.log(`Site running on http://localhost:${port}`);
});
