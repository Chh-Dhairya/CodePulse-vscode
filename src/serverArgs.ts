/**
 * Turns the configured `codepulse.serverUrl` into the arguments for
 * `codepulse serve`, so a server launched by the extension listens where the
 * extension will look for it.
 *
 * Before this existed the extension ran a bare `codepulse serve`, which always
 * binds the default port 8000: with `serverUrl` set to any other port the
 * launched server came up on the wrong port, the extension waited out its
 * readiness timeout and reported failure (found by clicking "Start Server" in
 * a real VS Code window).
 *
 * Pure (no `vscode` import) so it can be unit-tested in plain Node.
 */
export type ServeArgs = { args: string[] } | { error: string };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function serveArgsForUrl(serverUrl: string): ServeArgs {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return { error: `codepulse.serverUrl "${serverUrl}" is not a valid URL.` };
  }
  if (url.protocol !== "http:") {
    return {
      error: `codepulse.serverUrl "${serverUrl}" is not an http:// URL; the local CodePulse server only speaks plain HTTP, so the extension cannot start one for it.`,
    };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return {
      error: `codepulse.serverUrl "${serverUrl}" is not a local address, so the extension cannot start a server for it. Start that server yourself, or point serverUrl at http://127.0.0.1:<port>.`,
    };
  }
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port || "80";
  return { args: ["serve", "--host", host, "--port", port] };
}
