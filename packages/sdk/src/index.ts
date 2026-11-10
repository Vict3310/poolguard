import type {
  ActivityEvent,
  ChainBudgetView,
  ChainOperationView,
  SupplierExtraction,
} from "@poolguard/shared";

export class PoolGuardApiError extends Error {
  override name = "PoolGuardApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export interface PoolGuardOptions {
  /** API origin. Browser default is the same-origin `/api` proxy. */
  baseUrl?: string;
  /** Injectable fetch for authenticated server contexts or tests. */
  fetch?: typeof globalThis.fetch;
  /** Keep an in-memory cookie jar (useful in Node). Default true. */
  useCookieJar?: boolean;
}

export interface SdkAgent {
  id: string;
  label: string;
  slot: number;
  accountId: string;
  publicKey: string;
  status: string;
  keyConfigured: boolean;
}

export interface SdkBudget {
  totalFundedYocto: string;
  availableYocto: string;
  reservedYocto: string;
  spentYocto: string;
  withdrawnYocto: string;
  withdrawalPendingYocto: string;
  source: "chain" | "cache";
  stale: boolean;
}

export interface SdkTask {
  id: string;
  chainTaskId: string;
  name: string;
  objective: string;
  status: string;
  paused: boolean;
  network: "sandbox" | "testnet";
  contractId: string;
  ownerAccountId: string;
  policy: {
    version: number;
    maxPerOperationYocto: string;
    allowedProviders: string[];
    reservationTtlBlocks: number;
    expiresAtBlock: number;
  };
  budget: SdkBudget;
  agents: SdkAgent[];
  documents: Array<{ id: string; label: string; sha256: string }>;
  operations: SdkOperation[];
  pendingRecoveries: number;
}

export interface SdkOperation {
  id: string;
  chainOperationId: string;
  taskId: string;
  agent: { accountId: string; label: string };
  amountYocto: string;
  serviceId: string;
  requestHash: string;
  paymentState: string;
  fulfillmentState: string;
  needsRecovery: boolean;
  payoutAttempts: number;
  chainState?: ChainOperationView | null;
}

export interface ReserveInput {
  agentAccountId: string;
  serviceKey: string;
  documentId?: string;
  /** Reserve and immediately dispatch payment in one call. */
  execute?: boolean;
}

export interface ReserveResult {
  operation_id: string;
  payment_state: string;
  tx_hash: string;
}

export interface ExecuteResult {
  operation_id: string;
  payment_state: string;
  tx_hash: string;
}

export interface WatchHandle {
  close: () => void;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hasDocument(): boolean {
  return typeof document !== "undefined";
}

function browserCookie(name: string): string | null {
  if (!hasDocument()) return null;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return null;
}

/**
 * Typed client for the PoolGuard API.
 *
 * Financial state is read from the contract projection. Reserve/execute are the only
 * payment-creating calls, and recovery is explicit; there is deliberately no
 * "pay again" method.
 */
export class PoolGuard {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly useCookieJar: boolean;
  private readonly cookies = new Map<string, string>();

  constructor(options: PoolGuardOptions = {}) {
    const fallback = hasDocument() ? "/api" : "http://127.0.0.1:4100";
    this.baseUrl = (options.baseUrl ?? fallback).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.useCookieJar = options.useCookieJar ?? true;
  }

  private cookieHeader(): string | null {
    if (!this.useCookieJar) return null;
    if (this.cookies.size === 0) return null;
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private csrf(): string | null {
    if (this.useCookieJar) {
      const fromJar = this.cookies.get("pg_csrf");
      if (fromJar) return fromJar;
    }
    return browserCookie("pg_csrf");
  }

  private captureCookies(response: Response) {
    if (!this.useCookieJar) return;
    const headerValues =
      typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
        : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;,]+=)/);
    for (const raw of headerValues) {
      const pair = raw.split(";")[0]?.trim();
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const cookie = this.cookieHeader();
    if (cookie) headers.set("cookie", cookie);
    if (UNSAFE.has(method)) {
      const csrf = this.csrf();
      if (csrf) headers.set("x-poolguard-csrf", csrf);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      method,
      headers,
      credentials: "include",
      cache: "no-store",
    });
    this.captureCookies(response);
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!response.ok) {
      const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
      throw new PoolGuardApiError(
        typeof record.error === "string" ? record.error : `${response.status} ${response.statusText}`,
        response.status,
        typeof record.code === "string" ? record.code : null,
        body,
      );
    }
    return body as T;
  }

  /** Sandbox-only development session. Never available in production. */
  async devSession(): Promise<{ user: { accountId: string } }> {
    return this.request("/dev/session", { method: "POST" });
  }

  async session(): Promise<{ authenticated: boolean; user?: { accountId: string } }> {
    return this.request("/auth/session");
  }

  async signOut(): Promise<void> {
    await this.request("/auth/logout", { method: "POST" });
    this.cookies.clear();
  }

  async listTasks(): Promise<Array<{ id: string; name: string; status: string }>> {
    const response = await this.request<{ tasks: Array<{ id: string; name: string; status: string }> }>("/tasks");
    return response.tasks;
  }

  async getTask(taskId: string): Promise<SdkTask> {
    const response = await this.request<{ task: SdkTask }>(`/tasks/${encodeURIComponent(taskId)}`);
    return response.task;
  }

  async getBudget(taskId: string): Promise<ChainBudgetView> {
    const response = await this.request<{ budget: ChainBudgetView }>(
      `/tasks/${encodeURIComponent(taskId)}/budget`,
    );
    return response.budget;
  }

  async getOperation(operationId: string): Promise<SdkOperation> {
    const response = await this.request<{ operation: SdkOperation }>(
      `/operations/${encodeURIComponent(operationId)}`,
    );
    return response.operation;
  }

  async reservePurchase(taskId: string, input: ReserveInput): Promise<ReserveResult> {
    return this.request<ReserveResult>(`/tasks/${encodeURIComponent(taskId)}/purchases/reserve`, {
      method: "POST",
      body: JSON.stringify({
        agent_account_id: input.agentAccountId,
        service_key: input.serviceKey,
        document_id: input.documentId,
        execute: input.execute ?? false,
      }),
    });
  }

  async executePurchase(operationId: string): Promise<ExecuteResult> {
    return this.request<ExecuteResult>(`/operations/${encodeURIComponent(operationId)}/execute`, {
      method: "POST",
    });
  }

  async recoverOperation(operationId: string): Promise<unknown> {
    return this.request(`/operations/${encodeURIComponent(operationId)}/recover`, { method: "POST" });
  }

  async getResult(operationId: string): Promise<SupplierExtraction> {
    const response = await this.request<{ result: SupplierExtraction }>(
      `/operations/${encodeURIComponent(operationId)}/result`,
    );
    return response.result;
  }

  async getActivity(): Promise<ActivityEvent[]> {
    const response = await this.request<{ events: ActivityEvent[] }>("/activity");
    return response.events;
  }

  async getTaskEvents(taskId: string, after = "0"): Promise<ActivityEvent[]> {
    const response = await this.request<{ events: ActivityEvent[] }>(
      `/tasks/${encodeURIComponent(taskId)}/events?after=${encodeURIComponent(after)}`,
    );
    return response.events;
  }

  /**
   * Live task activity. Uses EventSource where available and falls back to polling
   * durable events. Reconnection is safe: event ids are durable.
   */
  watchTask(taskId: string, onEvent: (event: ActivityEvent) => void): WatchHandle {
    if (typeof EventSource !== "undefined") {
      const source = new EventSource(`${this.baseUrl}/tasks/${encodeURIComponent(taskId)}/events/stream`, {
        withCredentials: true,
      });
      const listener = (event: MessageEvent<string>) => {
        try {
          onEvent(JSON.parse(event.data) as ActivityEvent);
        } catch {
          /* ignore malformed frame */
        }
      };
      source.addEventListener("activity", listener as EventListener);
      return { close: () => source.close() };
    }

    let closed = false;
    let after = "0";
    const poll = async () => {
      while (!closed) {
        try {
          const events = await this.getTaskEvents(taskId, after);
          for (const event of events) {
            after = event.id;
            onEvent(event);
          }
        } catch {
          /* transient failure: retry */
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    };
    void poll();
    return { close: () => { closed = true; } };
  }
}
