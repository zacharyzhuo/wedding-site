// Shared HTTP helpers for the Pages Functions surface. Kept tiny on purpose;
// the API layer is mostly hand-written rather than abstracted, so the helpers
// here only cover what every endpoint repeats.

export function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export function ok<T>(data: T): Response {
  return json(200, { ok: true, ...((data ?? {}) as object) })
}

export function err(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json(status, { ok: false, error: message, ...(extra ?? {}) })
}

// Reads JSON or returns null. Endpoints decide how to handle null.
export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}
