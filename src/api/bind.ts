/**
 * Where the API listens, and who counts as "this machine".
 *
 * Pure functions over an interfaces table so they can be checked without a
 * network: the plugin passes `os.networkInterfaces()`, the tests pass a fake.
 *
 * Two places only — loopback or the Tailscale address. There is deliberately no
 * "every interface": the API speaks plain HTTP, so anywhere but a WireGuard
 * tunnel the token would cross the café Wi-Fi in clear text.
 */
import { API_BASE } from "./base";

export type ApiBind = "loopback" | "tailscale";

/** The subset of `os.NetworkInterfaceInfo` these functions look at. */
export interface IfaceAddress {
  address: string;
  family: string | number;
  internal: boolean;
}
export type IfaceTable = Record<string, IfaceAddress[] | undefined>;

export const LOOPBACK = "127.0.0.1";

const isV4 = (a: IfaceAddress): boolean => a.family === "IPv4" || a.family === 4;

/** Tailscale hands every node an address in 100.64.0.0/10: 100.64.x.x … 100.127.x.x. */
export function isTailscaleAddress(ip: string): boolean {
  const m = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * Whether a client is this machine talking to itself over loopback.
 *
 * Only loopback. A request to the Mac's own Tailscale address arrives from that
 * address, and is treated as another device — which is what it looks like to
 * anything that cannot see inside the kernel, and the safe way round to be wrong.
 */
export function isLoopbackClient(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.toLowerCase().replace(/%.*$/, "");
  return ip === "::1" || /^(?:::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

/** Who may connect at all: this machine, or something on the tailnet. */
export function isAllowedClient(address: string | undefined): boolean {
  return isLoopbackClient(address) || (address !== undefined && isTailscaleAddress(address));
}

/** The machine's Tailscale IPv4, or undefined when Tailscale is not up. */
export function tailscaleAddress(ifaces: IfaceTable): string | undefined {
  // An interface that is obviously Tailscale's first (utun* on macOS,
  // tailscale0 on Linux), but any non-internal address in the CGNAT range
  // counts: nothing else on a laptop lives there.
  const looksLikeTailscale = (name: string): number => Number(/^(tailscale|utun)/.test(name));
  const entries = Object.entries(ifaces).sort(([a], [b]) => looksLikeTailscale(b) - looksLikeTailscale(a));
  for (const [, addrs] of entries) {
    for (const a of addrs ?? []) {
      if (isV4(a) && !a.internal && isTailscaleAddress(a.address)) return a.address;
    }
  }
  return undefined;
}

/**
 * The host to bind for a setting. Tailscale with no Tailscale address falls
 * back to loopback and says so, so the caller can show a notice rather than
 * silently serving nobody.
 */
export function resolveBindHost(bind: ApiBind, ifaces: IfaceTable): { host: string; fallback?: string } {
  if (bind === "tailscale") {
    const ts = tailscaleAddress(ifaces);
    return ts
      ? { host: ts }
      : { host: LOOPBACK, fallback: "no Tailscale address found (is Tailscale running?), listening on 127.0.0.1 instead" };
  }
  return { host: LOOPBACK };
}

/** The base URL a client uses for a bound host. */
export function apiUrl(host: string, port: number, base = API_BASE): string {
  return `http://${host}:${port}${base}`;
}
