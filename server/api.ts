import type { NewPoll, Poll, Span, Step } from "../shared/types.ts";
import { STEPS } from "../shared/types.ts";
import * as db from "./db.ts";
import { recordFailure, recordSuccess, retryAfter } from "./limit.ts";

export class HttpError extends Error {
  status: number;
  detail: Record<string, unknown>;

  constructor(status: number, message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^(?:[01]\d|2[0-4]):(?:00|15|30|45)$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-4]):(?:00|15|30|45)$/;

const bad = (message: string, detail?: Record<string, unknown>) => new HttpError(400, message, detail);

function text(value: unknown, field: string, max: number, min = 1): string {
  if (typeof value !== "string") throw bad(`${field} fehlt`);
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (trimmed.length < min) throw bad(`${field} darf nicht leer sein`);
  if (trimmed.length > max) throw bad(`${field} ist zu lang (max. ${max} Zeichen)`);
  return trimmed;
}

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));

export function parseNewPoll(body: unknown): NewPoll {
  if (typeof body !== "object" || body === null) throw bad("Kein Termin uebergeben");
  const raw = body as Record<string, unknown>;

  const step = Number(raw.step) as Step;
  if (!STEPS.includes(step)) throw bad("Ungueltiger Takt");

  if (!Array.isArray(raw.days) || raw.days.length === 0) throw bad("Mindestens ein Tag noetig");
  if (raw.days.length > 90) throw bad("Hoechstens 90 Tage");
  const days = [...new Set(raw.days.map((d) => text(d, "Tag", 10)))].sort();
  if (!days.every((d) => DAY.test(d) && !Number.isNaN(Date.parse(d)))) throw bad("Ungueltiges Datum");

  const fromTime = text(raw.fromTime, "Beginn", 5);
  const toTime = text(raw.toTime, "Ende", 5);
  if (!CLOCK.test(fromTime) || !CLOCK.test(toTime)) throw bad("Ungueltige Uhrzeit");
  if (minutes(toTime) - minutes(fromTime) < step) throw bad("Das Zeitfenster ist kuerzer als ein Takt");

  const timezone = text(raw.timezone ?? "Europe/Berlin", "Zeitzone", 64);
  try {
    new Intl.DateTimeFormat("de-DE", { timeZone: timezone });
  } catch {
    throw bad("Unbekannte Zeitzone");
  }

  return {
    title: text(raw.title, "Titel", 120),
    note: typeof raw.note === "string" && raw.note.trim() ? text(raw.note, "Hinweis", 500) : "",
    timezone,
    step,
    days,
    fromTime,
    toTime,
    allowMaybe: raw.allowMaybe === true,
  };
}

function parseSpans(value: unknown, poll: Poll): Span[] {
  if (!Array.isArray(value)) throw bad("Zeitraeume fehlen");
  if (value.length > 400) throw bad("Zu viele Zeitraeume");
  const days = new Set(poll.days);
  const from = minutes(poll.fromTime);
  const to = minutes(poll.toTime);

  return value.map((entry) => {
    if (typeof entry !== "object" || entry === null) throw bad("Ungueltiger Zeitraum");
    const span = entry as Record<string, unknown>;
    const start = String(span.from);
    const end = String(span.to);
    if (!STAMP.test(start) || !STAMP.test(end)) throw bad("Ungueltiger Zeitraum");

    const day = start.slice(0, 10);
    if (day !== end.slice(0, 10)) throw bad("Ein Zeitraum darf nicht ueber Mitternacht laufen");
    if (!days.has(day)) throw bad("Tag gehoert nicht zum Termin");
    if (minutes(start.slice(11)) < from || minutes(end.slice(11)) > to || start >= end) {
      throw bad("Zeitraum liegt ausserhalb des Rasters");
    }
    if (span.choice !== "yes" && !(span.choice === "maybe" && poll.allowMaybe)) throw bad("Ungueltige Wahl");
    return { from: start, to: end, choice: span.choice as Span["choice"] };
  });
}

function guardAttempts(ip: string, pollId: string, name: string): string {
  const key = `${ip}|${pollId}|${name.toLowerCase()}`;
  const wait = retryAfter(key);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60);
    throw new HttpError(429, `Zu viele Fehlversuche. Bitte in ${minutes} Minuten erneut versuchen.`, {
      retryAfter: wait,
    });
  }
  return key;
}

function requirePoll(id: string): Poll {
  const poll = db.getPoll(id);
  if (!poll) throw new HttpError(404, "Termin nicht gefunden");
  return poll;
}

export function createPoll(body: unknown) {
  return { status: 201, json: db.createPoll(parseNewPoll(body)) };
}

export function readPoll(id: string) {
  return { status: 200, json: { poll: requirePoll(id), participants: db.listParticipants(id) } };
}

export function patchPoll(id: string, body: unknown, adminToken: string) {
  requirePoll(id);
  if (!db.isAdmin(id, adminToken)) throw new HttpError(403, "Kein Verwaltungszugriff");
  if (typeof body !== "object" || body === null) throw bad("Nichts zu aendern");
  const raw = body as Record<string, unknown>;
  const patch: Partial<Poll> = {};

  if ("title" in raw) patch.title = text(raw.title, "Titel", 120);
  if ("note" in raw) patch.note = typeof raw.note === "string" && raw.note.trim() ? text(raw.note, "Hinweis", 500) : "";
  if ("step" in raw) {
    const step = Number(raw.step) as Step;
    if (!STEPS.includes(step)) throw bad("Ungueltiger Takt");
    patch.step = step;
  }
  if ("allowMaybe" in raw) patch.allowMaybe = raw.allowMaybe === true;
  if ("closed" in raw) patch.closedAt = raw.closed === true ? new Date().toISOString() : null;

  db.patchPoll(id, patch);
  return { status: 200, json: { poll: requirePoll(id) } };
}

export async function saveEntry(id: string, body: unknown, ip: string) {
  const poll = requirePoll(id);
  if (poll.closedAt) throw new HttpError(409, "Der Termin ist geschlossen");
  if (typeof body !== "object" || body === null) throw bad("Kein Eintrag uebergeben");
  const raw = body as Record<string, unknown>;

  const name = text(raw.name, "Name", 40);
  const password = typeof raw.password === "string" && raw.password.length > 0 ? raw.password : null;
  if (password && password.length > 200) throw bad("Kennwort ist zu lang");
  const spans = parseSpans(raw.spans, poll);

  const existing = db.findParticipant(id, name);
  let hash = existing?.passwordHash ?? null;
  if (existing?.passwordHash) {
    const key = guardAttempts(ip, id, name);
    if (!password) throw new HttpError(401, "Dieser Eintrag ist mit einem Kennwort geschuetzt", { needsPassword: true });
    if (!(await db.checkPassword(password, existing.passwordHash))) {
      recordFailure(key);
      throw new HttpError(401, "Kennwort stimmt nicht", { needsPassword: true });
    }
    recordSuccess(key);
  } else if (password) {
    hash = await db.hashPassword(password);
  }

  return { status: 200, json: { id: db.saveEntry(id, name, hash, spans) } };
}

export async function deleteEntry(id: string, participantId: number, body: unknown, adminToken: string, ip: string) {
  requirePoll(id);
  const entry = db.participantPoll(participantId);
  if (!entry || entry.pollId !== id) throw new HttpError(404, "Eintrag nicht gefunden");

  if (!db.isAdmin(id, adminToken) && entry.passwordHash) {
    const key = guardAttempts(ip, id, String(participantId));
    const raw = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const password = typeof raw.password === "string" ? raw.password : "";
    if (!password || !(await db.checkPassword(password, entry.passwordHash))) {
      recordFailure(key);
      throw new HttpError(401, "Kennwort stimmt nicht", { needsPassword: true });
    }
    recordSuccess(key);
  }

  db.deleteParticipant(participantId);
  return { status: 200, json: { ok: true } };
}
