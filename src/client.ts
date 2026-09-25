/**
 * Thin HTTP client over the CodePulse REST API.
 *
 * Phase 1 (foundation) only wires up what the extension's own
 * activation/status-bar logic needs right now: a health check, listing
 * repositories, and index status. Later phases add search, symbol
 * lookup, references, impact analysis, similar-code, and the
 * resolve-by-location endpoint as their own features need them -- this
 * class is not meant to grow into a full, independently-designed SDK
 * ahead of the UI that will actually call each method.
 *
 * Uses the runtime's built-in `fetch`/`URL` globals rather than adding
 * an HTTP dependency -- VS Code's desktop extension host runs on a
 * Node.js version (bundled with Electron) that has had global `fetch`
 * available since VS Code 1.83; `engines.vscode` in package.json is
 * pinned to `^1.85.0`, safely past that.
 */
export interface CodePulseRepository {
  repository_id: number;
  name: string;
  url: string;
  branch: string;
  file_count: number;
  symbol_count: number;
  last_sync: string | null;
}

export interface ResolvedSymbol {
  symbol_id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  docstring: string | null;
  complexity: number;
}

export interface ResolveResult {
  repository_id: number;
  file: string;
  line: number;
  symbol: ResolvedSymbol | null;
}

export interface IndexStatus {
  repository_id: number;
  indexed_files: number;
  total_files: number;
  indexed_symbols: number;
  last_indexed: string;
  embedding_model: string;
}

export class CodePulseApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    super(message);
    this.name = "CodePulseApiError";
  }
}

export class CodePulseClient {
  constructor(
    private readonly getServerUrl: () => string,
    private readonly getApiKey: () => Thenable<string | undefined>,
  ) {}

  /**
   * `GET /health/ready` -- deliberately never sends an API key (the
   * server itself exempts every `/health/*` route from auth, per §21;
   * this mirrors that on the client side rather than assuming it).
   * Returns `false` for ANY failure (unreachable, non-2xx, network
   * error) -- callers only ever need "is it up," not why it isn't.
   */
  async health(): Promise<boolean> {
    try {
      const base = this.baseUrl();
      const res = await fetch(`${base}/health/ready`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listRepositories(): Promise<CodePulseRepository[]> {
    const data = await this.request("GET", "/v1/repositories");
    return (data.repositories ?? []) as CodePulseRepository[];
  }

  async getIndexStatus(repositoryId: number): Promise<IndexStatus> {
    return this.request("GET", `/v1/repositories/${repositoryId}/index-status`) as Promise<IndexStatus>;
  }

  async resolveSymbol(repositoryId: number, path: string, line: number): Promise<ResolveResult> {
    return this.request("GET", `/v1/repositories/${repositoryId}/resolve`, {
      query: { path, line: String(line) },
    }) as Promise<ResolveResult>;
  }

  private baseUrl(): string {
    return this.getServerUrl().replace(/\/+$/, "");
  }

  private async request(
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<any> {
    const url = new URL(this.baseUrl() + path);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = await this.getApiKey();
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err: any) {
      throw new CodePulseApiError(
        `Could not reach the CodePulse server at ${this.baseUrl()}: ${err?.message ?? err}`,
        0,
        undefined,
      );
    }

    if (!res.ok) {
      let detail: unknown;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => undefined);
      }
      // The server's own §21 error envelope is {"error": {"code",
      // "message", "details"}} -- surface its message when present,
      // rather than just the bare HTTP status.
      const serverMessage =
        detail && typeof detail === "object" && "error" in (detail as any) && (detail as any).error?.message;
      throw new CodePulseApiError(
        serverMessage || `CodePulse API request failed: ${method} ${path} -> ${res.status}`,
        res.status,
        detail,
      );
    }

    if (res.status === 204) {
      return undefined;
    }
    return res.json();
  }
}
