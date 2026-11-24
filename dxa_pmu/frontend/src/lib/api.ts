/** Thin client for the backend. Requests go to /api/*, which next.config.ts proxies to the FastAPI server. */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function messageFrom(data: unknown): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "Please check the details you entered and try again.";
  return "Something went wrong. Please try again.";
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the app server (the browser could not connect). Reload the page; if it keeps happening, check that `npm run dev` is still running.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  // The proxy answers with a plain-text 500 when the backend is not running at all.
  if (!res.ok && data === null && res.status >= 500) {
    throw new ApiError(res.status, "Cannot reach the backend. Make sure it is running (uvicorn app.main:app --port 8000 in backend/).");
  }
  if (!res.ok) throw new ApiError(res.status, messageFrom(data));
  return data as T;
}

export const reportUrl = (id: string) => `/api/reports/${id}/download`;
