import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as api from "./api.ts";
import { HttpError } from "./api.ts";
import { clientIp } from "./limit.ts";

const PORT = Number(process.env.PORT ?? 8080);
const STATIC_ROOT = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const MAX_BODY = 128 * 1024;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Anfrage ist zu gross");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Ungueltiges JSON");
  }
}

async function route(req: IncomingMessage, path: string[], body: unknown) {
  const token = String(req.headers["x-admin-token"] ?? "");
  const ip = clientIp(req.headers["x-forwarded-for"], req.socket.remoteAddress);
  const [, resource, id, sub, subId] = path; // path[0] === "api"

  if (resource !== "polls") throw new HttpError(404, "Unbekannter Endpunkt");
  if (id === undefined) {
    if (req.method === "POST") return api.createPoll(body);
    throw new HttpError(405, "Methode nicht erlaubt");
  }
  if (sub === undefined) {
    if (req.method === "GET") return api.readPoll(id);
    if (req.method === "PATCH") return api.patchPoll(id, body, token);
    throw new HttpError(405, "Methode nicht erlaubt");
  }
  if (sub === "entry") {
    if (subId === undefined && req.method === "PUT") return api.saveEntry(id, body, ip);
    if (subId !== undefined && req.method === "DELETE") {
      const numeric = Number(subId);
      if (!Number.isInteger(numeric)) throw new HttpError(400, "Ungueltige Eintrags-ID");
      return api.deleteEntry(id, numeric, body, token, ip);
    }
    throw new HttpError(405, "Methode nicht erlaubt");
  }
  throw new HttpError(404, "Unbekannter Endpunkt");
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Methode nicht erlaubt" });
    return;
  }

  const wanted = resolve(join(STATIC_ROOT, normalize(decodeURIComponent(pathname))));
  const isAsset = wanted.startsWith(STATIC_ROOT + "\\") || wanted.startsWith(STATIC_ROOT + "/");
  const file = isAsset && (await stat(wanted).catch(() => null))?.isFile() ? wanted : join(STATIC_ROOT, "index.html");

  const info = await stat(file).catch(() => null);
  if (!info) {
    sendJson(res, 404, { error: "Kein Build vorhanden — pnpm build ausfuehren" });
    return;
  }

  // Terminseiten gehoeren nicht in einen Suchindex — dort stehen Namen. Die
  // Startseite darf gefunden werden, deshalb haengt der Header am Pfad und
  // nicht global am Dokument.
  if (pathname.startsWith("/e/")) res.setHeader("x-robots-tag", "noindex, nofollow");

  // Vite haengt einen Hash an jeden Dateinamen unter /assets, die duerfen ewig
  // im Cache bleiben. index.html darf es nie, sonst haengt der Client fest.
  const immutable = file !== join(STATIC_ROOT, "index.html") && pathname.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);

    // Nach einem TLS-Aufruf soll der Browser gar nicht erst wieder ueber http
    // anfragen — sonst laesst sich der erste Sprung abfangen, bevor die
    // Weiterleitung greift. Die Seite hat Kennwortfelder, das lohnt sich.
    // Nur wenn der Proxy https gemeldet hat: im Klartext waere der Header
    // wirkungslos und im Dev ueber http sperrend.
    if (req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("strict-transport-security", "max-age=31536000");
    }

    if (segments[0] !== "api") {
      await serveStatic(req, res, url.pathname);
      return;
    }

    try {
      const body = req.method === "GET" || req.method === "HEAD" ? null : await readBody(req);
      const result = await route(req, segments, body);
      sendJson(res, result.status, result.json);
    } catch (error) {
      if (error instanceof HttpError) {
        if (typeof error.detail.retryAfter === "number") res.setHeader("retry-after", String(error.detail.retryAfter));
        sendJson(res, error.status, { error: error.message, ...error.detail });
        return;
      }
      console.error(error);
      sendJson(res, 500, { error: "Serverfehler" });
    }
  })().catch((error: unknown) => {
    console.error(error);
    if (!res.headersSent) res.writeHead(500).end();
  });
});

server.listen(PORT, () => console.log(`scheduling laeuft auf http://localhost:${PORT}`));
