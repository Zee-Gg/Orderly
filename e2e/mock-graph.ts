import { readFileSync } from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";

/**
 * A tiny fake WhatsApp Graph API for e2e tests (the app server is started with
 * WHATSAPP_GRAPH_BASE_URL pointing here, see playwright.config.ts):
 *   POST /v*\/{phone_number_id}/messages → a fake wamid
 *   GET  /v*\/{media_id}                 → a download link (IMG… = png, AUD… = ogg)
 *   GET  /media/{media_id}               → the bytes
 * Every call must carry a Bearer token, like the real API.
 */
export const MOCK_GRAPH_PORT = 3999;
export const MOCK_GRAPH_URL = `http://localhost:${MOCK_GRAPH_PORT}`;

// 1×1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
// A real Ogg/Opus voice note (≈4 s), like WhatsApp sends.
const OGG = readFileSync(path.resolve(process.cwd(), "tests/voice-eval/fixtures/order-en.ogg"));

export function startMockGraph(): Promise<Server> {
  let sent = 0;
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!req.headers.authorization?.startsWith("Bearer ")) return json(401, { error: { code: 190, message: "No token" } });
    const url = new URL(req.url ?? "/", MOCK_GRAPH_URL);
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "POST" && parts.length === 3 && parts[2] === "messages") {
      req.resume();
      return json(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.mock.${Date.now()}.${++sent}` }] });
    }
    if (req.method === "GET" && parts[0] === "media" && parts[1]) {
      const audio = parts[1].startsWith("AUD");
      res.writeHead(200, { "Content-Type": audio ? "audio/ogg" : "image/png" });
      return res.end(audio ? OGG : PNG);
    }
    if (req.method === "GET" && parts.length === 2 && /^v\d/.test(parts[0])) {
      const id = parts[1];
      const audio = id.startsWith("AUD");
      return json(200, {
        id,
        url: `${MOCK_GRAPH_URL}/media/${id}`,
        mime_type: audio ? "audio/ogg; codecs=opus" : "image/png",
        file_size: audio ? OGG.length : PNG.length,
      });
    }
    json(404, { error: { code: 100, message: "Unknown path" } });
  });
  return new Promise((resolve) => server.listen(MOCK_GRAPH_PORT, () => resolve(server)));
}
