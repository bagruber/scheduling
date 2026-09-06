import type { NewPoll, Poll, PollView, Span } from "../../shared/types.ts";

export class ApiError extends Error {
  status: number;
  needsPassword: boolean;

  constructor(status: number, message: string, needsPassword: boolean) {
    super(message);
    this.status = status;
    this.needsPassword = needsPassword;
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError(0, "Keine Verbindung zum Server", false);
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(response.status, String(body.error ?? "Unbekannter Fehler"), body.needsPassword === true);
  }
  return body as T;
}

export const createPoll = (input: NewPoll) =>
  request<{ id: string; adminToken: string }>("/api/polls", { method: "POST", body: JSON.stringify(input) });

export const readPoll = (id: string) => request<PollView>(`/api/polls/${id}`);

export const saveEntry = (id: string, entry: { name: string; password: string | null; spans: Span[] }) =>
  request<{ id: number }>(`/api/polls/${id}/entry`, { method: "PUT", body: JSON.stringify(entry) });

export const deleteEntry = (id: string, participantId: number, auth: { password?: string; adminToken?: string }) =>
  request<{ ok: true }>(`/api/polls/${id}/entry/${participantId}`, {
    method: "DELETE",
    headers: auth.adminToken ? { "x-admin-token": auth.adminToken } : {},
    body: JSON.stringify({ password: auth.password ?? "" }),
  });

export const patchPoll = (id: string, patch: Record<string, unknown>, adminToken: string) =>
  request<{ poll: Poll }>(`/api/polls/${id}`, {
    method: "PATCH",
    headers: { "x-admin-token": adminToken },
    body: JSON.stringify(patch),
  });
