/**
 * A small HTTP server so other tools can read and change trips through AWTY.
 *
 * Off unless switched on; bound to 127.0.0.1 or to the Tailscale address and
 * nothing else; every request carries the token from Settings. Writes from any
 * address but loopback are refused unless "Allow writes from other devices" is
 * on. The routing lives in routes.ts — this file is only plumbing.
 */
import { API_BASE } from "./base";
import { isAllowedClient, isLoopbackClient, LOOPBACK } from "./bind";
import { handle, type ApiDeps } from "./routes";

export interface ApiServer {
  close: () => void;
  port: number;
  host: string;
}

/** A trip is a page of frontmatter; anything larger is a mistake or an attack. */
const MAX_BODY = 1_000_000;

/**
 * The methods that change notes. Only these are held back from other devices;
 * anything else (PUT, HEAD, …) goes on to the router, which answers it with
 * the same 405 wherever it came from.
 */
const WRITES = new Set(["POST", "PATCH", "DELETE"]);

/** Constant-time over digests of equal length, so neither the bytes nor the token's length leak through timing. */
export function sameToken(a: string, b: string): boolean {
  const crypto = require("crypto") as typeof import("crypto");
  const digest = (x: string): Buffer => crypto.createHash("sha256").update(x, "utf8").digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A short id that ties a generic 500 to the full error in the console. */
const requestId = (): string => Math.random().toString(36).slice(2, 10);

export async function startApiServer(opts: {
  port: number;
  host?: string;
  token: string;
  deps: ApiDeps;
  /** Read per request, so flipping the switch needs no restart. */
  allowRemoteWrites: () => boolean;
  log?: (m: string) => void;
  /** Who may connect at all. Defaults to loopback and the tailnet. */
  allowClient?: (address: string | undefined) => boolean;
  /** Who counts as this machine for the remote-writes rule. Defaults to loopback. */
  isLocal?: (address: string | undefined) => boolean;
}): Promise<ApiServer> {
  const host = opts.host?.trim() || LOOPBACK;
  const allowClient = opts.allowClient ?? isAllowedClient;
  const isLocal = opts.isLocal ?? isLoopbackClient;
  // Required at run time so the bundle still loads on mobile, which has no node.
  const http = require("http") as typeof import("http");

  const server = http.createServer((req, res) => {
    // Only an authenticated caller learns the revision; before that the server says as little as it can.
    let authed = false;
    const headers = (): Record<string, string> => ({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(authed ? { "x-awty-revision": String(opts.deps.revision()) } : {}),
    });
    const send = (status: number, body: unknown, extra: Record<string, string> = {}): void => {
      if (res.headersSent) return;
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extra, ...headers() });
      res.end(JSON.stringify(body ?? null));
    };
    const fail = (e: unknown): void => {
      const id = requestId();
      opts.log?.(`request ${id} failed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
      send(500, { error: "Internal error", requestId: id });
    };

    try {
      const address = req.socket.remoteAddress;
      if (!allowClient(address)) {
        opts.log?.(`refused a client outside loopback and the tailnet: ${address ?? "unknown"}`);
        send(403, { error: "Forbidden" });
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== API_BASE && !url.pathname.startsWith(`${API_BASE}/`)) {
        send(404, { error: "Not found" });
        return;
      }
      const auth = req.headers["authorization"];
      const given = typeof auth === "string" && auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
      if (opts.token === "" || !sameToken(given, opts.token)) {
        send(401, { error: "Send the AWTY API token as: Authorization: Bearer <token>" });
        return;
      }
      authed = true;

      const method = (req.method ?? "GET").toUpperCase();
      if (WRITES.has(method) && !isLocal(address) && !opts.allowRemoteWrites()) {
        send(403, {
          error: "Writes from other devices are switched off. Turn on Settings → Are We There Yet? → Local API → Allow writes from other devices.",
        });
        req.resume();
        return;
      }

      // Refuse an oversized body from its declared length, and otherwise once it
      // passes the cap. The rest is drained (for a second at most) so the client
      // gets the 413 rather than a reset connection.
      const tooLarge = (): void => {
        send(413, { error: "Body too large" });
        req.resume();
        const cut = setTimeout(() => req.destroy(), 1000);
        cut.unref?.();
        req.on("end", () => clearTimeout(cut));
      };
      if (Number(req.headers["content-length"] ?? 0) > MAX_BODY) {
        tooLarge();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let refused = false;
      req.on("data", (c: Buffer) => {
        if (refused) return;
        size += c.length;
        if (size > MAX_BODY) {
          refused = true;
          chunks.length = 0;
          tooLarge();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (refused) return;
        void (async () => {
          let body: unknown;
          const raw = Buffer.concat(chunks).toString("utf8");
          if (raw.trim() !== "") {
            try {
              body = JSON.parse(raw);
            } catch {
              send(400, { error: "Body must be JSON" });
              return;
            }
          }
          const query: Record<string, string> = {};
          url.searchParams.forEach((v, k) => {
            query[k] = v;
          });
          try {
            const r = await handle(
              { method, path: url.pathname.slice(API_BASE.length).replace(/^\/+|\/+$/g, ""), query, body },
              opts.deps,
            );
            send(r.status, r.body, r.headers);
          } catch (e) {
            fail(e);
          }
        })();
      });
    } catch (e) {
      fail(e);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : opts.port;
  opts.log?.(`listening on http://${host}:${port}${API_BASE}`);
  return {
    // Closing stops new connections; a kept-alive socket would otherwise go on
    // serving the old token.
    close: () => {
      server.close();
      server.closeAllConnections();
    },
    port,
    host,
  };
}
