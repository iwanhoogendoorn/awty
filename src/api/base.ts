/**
 * Where the API lives. `/awty/v1` is the mount; `API_VERSION` (reported as
 * `api` by `GET /health`) is the contract revision a client checks to tell a
 * newer plugin from an older one without parsing the plugin's own version.
 */
export const API_BASE = "/awty/v1";
export const API_VERSION = 1;
/** Helm has 27125; this sits a few doors down so both can run at once. */
export const DEFAULT_API_PORT = 27131;
