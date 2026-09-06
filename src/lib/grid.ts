import type { Choice, Participant, Poll, Span } from "../../shared/types.ts";

// Der Takt ist reine Anzeige-Aufloesung: gespeichert werden Zeitraeume, nicht
// Rasterfelder. Deshalb ueberlebt jede Antwort eine spaetere Taktaenderung —
// eine Zwei-Stunden-Zusage fuellt im 30-Minuten-Raster eben vier Felder, und
// ein nur teilweise abgedecktes Feld wird als "part" markiert.
export type Cover = "full" | "part";
export type Cell = { day: string; time: string };

const pad = (n: number) => String(n).padStart(2, "0");

export const toMinutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
export const toClock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

export const cellKey = (day: string, time: string) => `${day}T${time}`;
export const dayOf = (stamp: string) => stamp.slice(0, stamp.indexOf("T"));
export const timeOf = (stamp: string) => stamp.slice(stamp.indexOf("T") + 1);

/** Alle Rasterzeilen des Termins, z. B. ["09:00", "09:30", …]. Ende exklusiv. */
export function slotsOf(poll: Poll): string[] {
  const end = toMinutes(poll.toTime);
  const out: string[] = [];
  for (let m = toMinutes(poll.fromTime); m + poll.step <= end; m += poll.step) out.push(toClock(m));
  return out;
}

/** Zeitraeume → Rasterfelder. Nur Spans der uebergebenen Wahl werden gezaehlt. */
export function spanCells(spans: Span[], poll: Poll, choice: Choice): Map<string, Cover> {
  const slots = slotsOf(poll);
  const covered = new Map<string, number>();

  for (const span of spans) {
    if (span.choice !== choice) continue;
    const day = dayOf(span.from);
    const from = toMinutes(timeOf(span.from));
    const to = toMinutes(timeOf(span.to));
    for (const time of slots) {
      const start = toMinutes(time);
      const overlap = Math.min(to, start + poll.step) - Math.max(from, start);
      if (overlap <= 0) continue;
      const key = cellKey(day, time);
      covered.set(key, (covered.get(key) ?? 0) + overlap);
    }
  }

  const out = new Map<string, Cover>();
  for (const [key, minutes] of covered) out.set(key, minutes >= poll.step ? "full" : "part");
  return out;
}

/** Rasterfelder → zusammengefasste Zeitraeume. Umkehrung von spanCells. */
export function cellsToSpans(keys: Iterable<string>, poll: Poll, choice: Choice): Span[] {
  const byDay = new Map<string, number[]>();
  for (const key of keys) {
    const day = dayOf(key);
    const list = byDay.get(day);
    if (list) list.push(toMinutes(timeOf(key)));
    else byDay.set(day, [toMinutes(timeOf(key))]);
  }

  const out: Span[] = [];
  for (const day of [...byDay.keys()].sort()) {
    const minutes = byDay.get(day)!.sort((a, b) => a - b);
    let start = minutes[0];
    let end = start + poll.step;
    for (const m of minutes.slice(1)) {
      if (m === end) {
        end = m + poll.step;
        continue;
      }
      out.push({ from: `${day}T${toClock(start)}`, to: `${day}T${toClock(end)}`, choice });
      start = m;
      end = m + poll.step;
    }
    out.push({ from: `${day}T${toClock(start)}`, to: `${day}T${toClock(end)}`, choice });
  }
  return out;
}

export type Tally = { yes: string[]; maybe: string[] };

/**
 * Wer kann wann. Teilweise abgedeckte Felder zaehlen mit — das kommt nur vor,
 * wenn der Takt nach einer Antwort vergroebert wurde.
 */
export function tally(poll: Poll, participants: Participant[]): Map<string, Tally> {
  const out = new Map<string, Tally>();
  const at = (key: string) => {
    let entry = out.get(key);
    if (!entry) out.set(key, (entry = { yes: [], maybe: [] }));
    return entry;
  };

  for (const person of participants) {
    for (const key of spanCells(person.spans, poll, "yes").keys()) at(key).yes.push(person.name);
    for (const key of spanCells(person.spans, poll, "maybe").keys()) {
      const entry = at(key);
      if (!entry.yes.includes(person.name)) entry.maybe.push(person.name);
    }
  }
  return out;
}

export type Range = {
  day: string;
  from: string;
  to: string;
  yes: string[];
  maybe: string[];
  missing: string[];
};

/**
 * Die besten Zeitfenster. Benachbarte Felder mit identischer Besetzung werden
 * zu einem Fenster verschmolzen, damit "alle ausser Anna, 14–16 Uhr" als ein
 * Vorschlag erscheint und nicht als vier.
 */
export function bestRanges(poll: Poll, participants: Participant[], limit = 3): Range[] {
  const counts = tally(poll, participants);
  const everyone = participants.map((p) => p.name);
  const slots = slotsOf(poll);
  const ranges: Range[] = [];

  for (const day of poll.days) {
    let run: Range | null = null;
    let signature = "";

    const flush = () => {
      if (run && run.yes.length > 0) ranges.push(run);
      run = null;
    };

    for (const time of slots) {
      const entry = counts.get(cellKey(day, time)) ?? { yes: [], maybe: [] };
      const next = `${entry.yes.join("\u0000")}|${entry.maybe.join("\u0000")}`;
      if (run && next === signature) {
        run.to = toClock(toMinutes(time) + poll.step);
        continue;
      }
      flush();
      signature = next;
      run = {
        day,
        from: time,
        to: toClock(toMinutes(time) + poll.step),
        yes: entry.yes,
        maybe: entry.maybe,
        missing: everyone.filter((n) => !entry.yes.includes(n) && !entry.maybe.includes(n)),
      };
    }
    flush();
  }

  ranges.sort(
    (a, b) =>
      b.yes.length - a.yes.length ||
      b.maybe.length - a.maybe.length ||
      toMinutes(b.to) - toMinutes(b.from) - (toMinutes(a.to) - toMinutes(a.from)) ||
      (a.day < b.day ? -1 : 1),
  );
  return ranges.slice(0, limit);
}
