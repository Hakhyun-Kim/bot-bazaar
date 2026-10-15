// Run the free-gas relayer under Node: SPONSOR_KEY=… RPC_URL=… TANK=… node sponsor/serve.mjs [port]
// (On Cloudflare, deploy sponsor/relayer.mjs as a Worker with the same variables instead.)
import http from "node:http";
import { handle } from "./relayer.mjs";

export function serve(env, port = 8787) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ["GET", "HEAD", "OPTIONS"].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const r = await handle(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const k of ["SPONSOR_KEY", "RPC_URL", "TANK"]) if (!process.env[k]) throw new Error(`set ${k}`);
  const port = Number(process.argv[2] || 8787);
  await serve(process.env, port);
  console.log(`free-gas relayer on http://127.0.0.1:${port} (tank ${process.env.TANK})`);
}
