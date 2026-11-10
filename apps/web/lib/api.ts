export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function cookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (UNSAFE_METHODS.has(method)) {
    const csrf = cookie("pg_csrf");
    if (csrf) headers.set("x-poolguard-csrf", csrf);
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    throw new ApiError(
      typeof record.error === "string" ? record.error : `${response.status} ${response.statusText}`,
      response.status,
      typeof record.code === "string" ? record.code : null,
      body,
    );
  }
  return body as T;
}

export async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const element = document.createElement("textarea");
  element.value = value;
  element.style.position = "fixed";
  element.style.opacity = "0";
  document.body.appendChild(element);
  element.select();
  document.execCommand("copy");
  element.remove();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
