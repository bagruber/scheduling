import type { Choice, Participant, Poll, PollView, Span } from "../../shared/types.ts";
import { ApiError } from "./apiError.ts";
import { nextDays } from "./format.ts";

// Mockup fuer GitHub Pages: kein Server, keine Datenbank. Alles liegt im
// localStorage des Besuchers und ist mit einem Klick zurueckgesetzt.
export const DEMO = import.meta.env.VITE_DEMO === "1";
export const DEMO_ID = "demo";

const KEY = "terminraster-demo";

type Stored = Participant & { mark: string | null };
type Store = { poll: Poll; participants: Stored[] };

/**
 * Kein scrypt, keine Sicherheit — im Mockup gibt es nichts zu schuetzen. Der
 * Zweck ist allein, das eingegebene Kennwort nicht im Klartext im Browser
 * liegen zu lassen. FNV-1a, weil es dafuer reicht und vier Zeilen sind.
 */
function mark(password: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < password.length; i += 1) {
    hash = Math.imul(hash ^ password.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

const ago = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

function seed(): Store {
  const days = nextDays(5, 1);
  const span = (day: number, from: string, to: string, choice: Choice = "yes"): Span => ({
    from: `${days[day]}T${from}`,
    to: `${days[day]}T${to}`,
    choice,
  });

  return {
    poll: {
      id: DEMO_ID,
      title: "Vorstandssitzung",
      note: "Wir brauchen etwa 90 Minuten.",
      timezone: "Europe/Berlin",
      step: 30,
      days,
      fromTime: "09:00",
      toTime: "18:00",
      allowMaybe: true,
      closedAt: null,
    },
    participants: [
      {
        id: 1,
        name: "Anna",
        locked: false,
        mark: null,
        updatedAt: ago(26),
        spans: [span(0, "09:00", "12:00"), span(1, "09:00", "18:00"), span(3, "14:00", "18:00")],
      },
      {
        id: 2,
        name: "Bo",
        locked: false,
        mark: null,
        updatedAt: ago(20),
        spans: [span(0, "12:00", "14:00", "maybe"), span(1, "10:00", "15:00"), span(4, "13:00", "18:00")],
      },
      {
        id: 3,
        name: "Cem",
        locked: false,
        mark: null,
        updatedAt: ago(5),
        spans: [span(1, "11:00", "17:00"), span(2, "09:00", "11:30"), span(3, "15:00", "18:00")],
      },
      {
        id: 4,
        name: "Dilan",
        locked: false,
        mark: null,
        updatedAt: ago(2),
        spans: [span(1, "11:00", "13:00"), span(1, "13:00", "16:00", "maybe"), span(4, "09:00", "12:00")],
      },
    ],
  };
}

function load(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    // Privater Modus oder gesperrter Speicher: dann eben jedes Mal frisch.
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // Nicht speichern zu koennen ist im Mockup kein Fehler, der jemanden stoert.
  }
}

export function reset() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // s. o.
  }
  window.location.reload();
}

const strip = ({ mark: _mark, ...rest }: Stored): Participant => rest;

export async function readPoll(): Promise<PollView> {
  const store = load();
  return { poll: store.poll, participants: store.participants.map(strip) };
}

export async function saveEntry(entry: { name: string; password: string | null; spans: Span[] }) {
  const store = load();
  const name = entry.name.trim();
  const existing = store.participants.find((person) => person.name.toLowerCase() === name.toLowerCase());

  if (existing?.mark) {
    if (!entry.password) throw new ApiError(401, "Dieser Eintrag ist mit einem Kennwort geschützt", true);
    if (mark(entry.password) !== existing.mark) throw new ApiError(401, "Kennwort stimmt nicht", true);
  }

  const stamp = new Date().toISOString();
  if (existing) {
    existing.spans = entry.spans;
    existing.updatedAt = stamp;
    if (!existing.mark && entry.password) {
      existing.mark = mark(entry.password);
      existing.locked = true;
    }
  } else {
    store.participants.push({
      id: Math.max(0, ...store.participants.map((p) => p.id)) + 1,
      name,
      locked: entry.password !== null,
      mark: entry.password ? mark(entry.password) : null,
      updatedAt: stamp,
      spans: entry.spans,
    });
  }

  save(store);
  return { id: store.participants.length };
}
