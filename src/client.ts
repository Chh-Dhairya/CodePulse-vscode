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

export interface IndexJobHandle {
  job_id: string;
  repository_id: number;
  status: string;
  url: string;
}

export interface JobStatus {
  job_id: string;
  repository_id: number;
  status: string;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: unknown;
}

export interface SearchResultItem {
  doc_id: string;
  symbol_name: string;
  file_path: string;
  type: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  docstring: string | null;
  snippet: string | null;
  language: string | null;
  relevance_score: number;
  keyword_score: number;
  vector_score: number;
  embedding_distance: number;
  graph_score: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  execution_time_ms: number;
  query: string;
  search_type: string;
}

export interface SymbolDetails {
  symbol_id: number;
  name: string;
  type: string;
  file: string;
  line_start: number;
  line_end: number;
  docstring: string | null;
  source_code: string | null;
  called_by: Array<{ symbol: string; file: string; confidence: string }>;
  calls: Array<{ symbol: string; file: string; confidence: string }>;
  complexity: number;
}

export interface SimilarSymbolsResponse {
  query_symbol: { id: number; name: string };
  similar: unknown[];
}

export interface ImpactAnalysis {
  symbol: string;
  direct_callers: number;
  indirect_callers: number;
  call_chain: unknown[];
  dependencies: unknown[];
  callers: { direct: unknown[]; transitive: unknown[] };
  callees: { direct: unknown[]; transitive: unknown[] };
}

export interface ReferencesResult {
  symbol: string;
  callers: unknown[];
  subclasses: unknown[];
}

export interface ModuleStructure {
  repository_id: number;
  clusters: Array<{ id: number; files: string[] }>;
  ranked_by_inbound: unknown[];
  ranked_by_outbound: unknown[];
}

export interface FileSymbol {
  symbol_id: number;
  name: string;
  type: string;
  line_start: number;
  line_end: number;
  complexity: number;
}

export interface FileSymbolsResult {
  repository_id: number;
  file: string;
  symbols: FileSymbol[];
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

  /** `GET /v1/repositories/{id}/file-symbols` -- every symbol in one file, for CodeLens placement. */
  async getFileSymbols(repositoryId: number, path: string): Promise<FileSymbolsResult> {
    return this.request("GET", `/v1/repositories/${repositoryId}/file-symbols`, {
      query: { path },
    }) as Promise<FileSymbolsResult>;
  }

  /** `POST /v1/repositories/index` -- `url` is a local filesystem path (only `source: "local"` is implemented server-side). */
  async indexRepository(localPath: string, branch = "main"): Promise<IndexJobHandle> {
    return this.request("POST", "/v1/repositories/index", {
      body: { source: "local", url: localPath, branch },
    }) as Promise<IndexJobHandle>;
  }

  async getJobStatus(jobId: string): Promise<JobStatus> {
    return this.request("GET", `/v1/jobs/${jobId}`) as Promise<JobStatus>;
  }

  async search(
    query: string,
    opts: { repositoryId?: number; limit?: number; searchType?: string } = {},
  ): Promise<SearchResponse> {
    return this.request("POST", "/v1/search", {
      body: {
        repository_id: opts.repositoryId,
        query,
        limit: opts.limit ?? 20,
        search_type: opts.searchType ?? "hybrid",
      },
    }) as Promise<SearchResponse>;
  }

  async getSymbolDetails(symbolId: number): Promise<SymbolDetails> {
    return this.request("GET", `/v1/symbols/${symbolId}`) as Promise<SymbolDetails>;
  }

  async getSimilar(symbolId: number, opts: { limit?: number; threshold?: number } = {}): Promise<SimilarSymbolsResponse> {
    return this.request("POST", `/v1/symbols/${symbolId}/similar`, {
      body: { limit: opts.limit ?? 10, threshold: opts.threshold ?? 0.75 },
    }) as Promise<SimilarSymbolsResponse>;
  }

  async getImpactAnalysis(symbolId: number, depth = 3): Promise<ImpactAnalysis> {
    return this.request("POST", `/v1/symbols/${symbolId}/impact-analysis`, {
      body: { depth },
    }) as Promise<ImpactAnalysis>;
  }

  async getReferences(symbolId: number): Promise<ReferencesResult> {
    return this.request("GET", `/v1/symbols/${symbolId}/references`) as Promise<ReferencesResult>;
  }

  async getModules(repositoryId: number): Promise<ModuleStructure> {
    return this.request("GET", `/v1/repositories/${repositoryId}/modules`) as Promise<ModuleStructure>;
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
