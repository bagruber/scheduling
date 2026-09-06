import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NewPoll, Participant, Poll, Span, Step } from "../shared/types.ts";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "scheduling.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS poll (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    timezone    TEXT NOT NULL,
    step        INTEGER NOT NULL,
    days        TEXT NOT NULL,
    from_time   TEXT NOT NULL,
    to_time     TEXT NOT NULL,
    allow_maybe INTEGER NOT NULL,
    admin_token TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    closed_at   TEXT
  );
  CREATE TABLE IF NOT EXISTS participant (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id       TEXT NOT NULL REFERENCES poll(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    password_hash TEXT,
    updated_at    TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS participant_name ON participant(poll_id, name COLLATE NOCASE);
  CREATE TABLE IF NOT EXISTS span (
    participant_id INTEGER NOT NULL REFERENCES participant(id) ON DELETE CASCADE,
    from_ts        TEXT NOT NULL,
    to_ts          TEXT NOT NULL,
    choice         TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS span_by_participant ON span(participant_id);
`);

// Ohne mehrdeutige Zeichen — die ID wird vorgelesen und abgetippt.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const newId = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

// Async, nicht scryptSync: die Ableitung dauert ~100 ms und wuerde sonst bei
// jedem Kennwort den Event-Loop des einzigen Prozesses blockieren.
const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await scrypt(password, salt, 64)).toString("hex")}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  const a = Buffer.from(expected, "hex");
  const b = await scrypt(password, Buffer.from(salt, "hex"), 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Row = Record<string, string | number | bigint | Uint8Array | null>;

const toPoll = (row: Row): Poll => ({
  id: String(row.id),
  title: String(row.title),
  note: String(row.note),
  timezone: String(row.timezone),
  step: Number(row.step) as Step,
  days: JSON.parse(String(row.days)) as string[],
  fromTime: String(row.from_time),
  toTime: String(row.to_time),
  allowMaybe: Number(row.allow_maybe) === 1,
  closedAt: row.closed_at === null ? null : String(row.closed_at),
});

export function createPoll(input: NewPoll): { id: string; adminToken: string } {
  const id = newId();
  const adminToken = randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO poll (id, title, note, timezone, step, days, from_time, to_time, allow_maybe, admin_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title,
    input.note,
    input.timezone,
    input.step,
    JSON.stringify(input.days),
    input.fromTime,
    input.toTime,
    input.allowMaybe ? 1 : 0,
    adminToken,
    new Date().toISOString(),
  );
  return { id, adminToken };
}

export function getPoll(id: string): Poll | null {
  const row = db.prepare("SELECT * FROM poll WHERE id = ?").get(id) as Row | undefined;
  return row ? toPoll(row) : null;
}

export function isAdmin(id: string, token: string): boolean {
  const row = db.prepare("SELECT admin_token FROM poll WHERE id = ?").get(id) as Row | undefined;
  return row !== undefined && token.length > 0 && String(row.admin_token) === token;
}

export function patchPoll(id: string, patch: Partial<Poll>): void {
  const columns: Record<string, string> = {
    title: "title",
    note: "note",
    step: "step",
    allowMaybe: "allow_maybe",
    closedAt: "closed_at",
  };
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue;
    const value = patch[key as keyof Poll];
    sets.push(`${column} = ?`);
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : (value as string | number | null));
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE poll SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
}

export function listParticipants(pollId: string): Participant[] {
  const people = db
    .prepare("SELECT id, name, password_hash, updated_at FROM participant WHERE poll_id = ? ORDER BY id")
    .all(pollId) as Row[];
  const spans = db
    .prepare(
      `SELECT s.participant_id, s.from_ts, s.to_ts, s.choice FROM span s
       JOIN participant p ON p.id = s.participant_id WHERE p.poll_id = ?`,
    )
    .all(pollId) as Row[];

  const byPerson = new Map<number, Span[]>();
  for (const row of spans) {
    const id = Number(row.participant_id);
    const list = byPerson.get(id) ?? [];
    list.push({ from: String(row.from_ts), to: String(row.to_ts), choice: String(row.choice) as Span["choice"] });
    byPerson.set(id, list);
  }

  return people.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    locked: row.password_hash !== null,
    updatedAt: String(row.updated_at),
    spans: byPerson.get(Number(row.id)) ?? [],
  }));
}

export function findParticipant(pollId: string, name: string): { id: number; passwordHash: string | null } | null {
  const row = db
    .prepare("SELECT id, password_hash FROM participant WHERE poll_id = ? AND name = ? COLLATE NOCASE")
    .get(pollId, name) as Row | undefined;
  if (!row) return null;
  return { id: Number(row.id), passwordHash: row.password_hash === null ? null : String(row.password_hash) };
}

export function participantPoll(id: number): { pollId: string; passwordHash: string | null } | null {
  const row = db.prepare("SELECT poll_id, password_hash FROM participant WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;
  return { pollId: String(row.poll_id), passwordHash: row.password_hash === null ? null : String(row.password_hash) };
}

/** Legt an oder ersetzt. Zeitraeume werden immer vollstaendig neu geschrieben. */
export function saveEntry(pollId: string, name: string, passwordHash: string | null, spans: Span[]): number {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const existing = findParticipant(pollId, name);
    let id: number;
    if (existing) {
      id = existing.id;
      db.prepare("UPDATE participant SET name = ?, password_hash = ?, updated_at = ? WHERE id = ?").run(
        name,
        passwordHash,
        now,
        id,
      );
      db.prepare("DELETE FROM span WHERE participant_id = ?").run(id);
    } else {
      const result = db
        .prepare("INSERT INTO participant (poll_id, name, password_hash, updated_at) VALUES (?, ?, ?, ?)")
        .run(pollId, name, passwordHash, now);
      id = Number(result.lastInsertRowid);
    }
    const insert = db.prepare("INSERT INTO span (participant_id, from_ts, to_ts, choice) VALUES (?, ?, ?, ?)");
    for (const span of spans) insert.run(id, span.from, span.to, span.choice);
    db.exec("COMMIT");
    return id;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteParticipant(id: number): void {
  db.prepare("DELETE FROM participant WHERE id = ?").run(id);
}
