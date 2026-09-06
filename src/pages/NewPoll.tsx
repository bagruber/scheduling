import { useMemo, useState } from "react";
import type { Step } from "../../shared/types.ts";
import { STEPS } from "../../shared/types.ts";
import { createPoll } from "../lib/api.ts";
import { navigate } from "../lib/router.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const TIMES = Array.from({ length: 49 }, (_, i) => `${pad(Math.floor(i / 2))}:${i % 2 ? "30" : "00"}`);
const STEP_LABEL: Record<Step, string> = { 15: "15 Min.", 30: "30 Min.", 60: "1 Std.", 120: "2 Std." };
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** Kalenderfelder des Monats, vorne mit Leerfeldern bis zum ersten Montag. */
function monthCells(anchor: Date): (string | null)[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const length = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= length; d += 1) cells.push(dayKey(new Date(anchor.getFullYear(), anchor.getMonth(), d)));
  return cells;
}

export default function NewPoll() {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState<string[]>([]);
  const [fromTime, setFromTime] = useState("09:00");
  const [toTime, setToTime] = useState("18:00");
  const [step, setStep] = useState<Step>(30);
  const [allowMaybe, setAllowMaybe] = useState(false);
  const [anchor, setAnchor] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const today = dayKey(new Date());
  const cells = useMemo(() => monthCells(anchor), [anchor]);
  const monthName = anchor.toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const toggleDay = (day: string) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort()));

  const shiftMonth = (delta: number) =>
    setAnchor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));

  const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const windowTooShort = minutes(toTime) - minutes(fromTime) < step;
  const ready = title.trim().length > 0 && days.length > 0 && !windowTooShort;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const { id, adminToken } = await createPoll({
        title: title.trim(),
        note: note.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        step,
        days,
        fromTime,
        toTime,
        allowMaybe,
      });
      navigate(`/e/${id}?a=${adminToken}`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Konnte nicht angelegt werden");
      setBusy(false);
    }
  }

  return (
    <main className="page page-narrow">
      <header className="intro">
        <h1>Terminraster</h1>
        <p>
          Tage und Zeitfenster festlegen, Link teilen, alle malen ihre Zeiten ins Raster. Kein Konto, keine Cookies.
        </p>
      </header>

      <label className="field">
        <span>Worum geht es?</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Vorstandssitzung"
          maxLength={120}
          autoFocus
        />
      </label>

      <label className="field">
        <span>
          Hinweis <em>optional</em>
        </span>
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Wir brauchen ca. 90 Minuten"
          maxLength={500}
        />
      </label>

      <section className="field">
        <span className="field-label">
          Welche Tage? {days.length > 0 ? <em>{days.length} ausgewählt</em> : null}
        </span>
        <div className="calendar">
          <div className="calendar-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Vorheriger Monat">
              ‹
            </button>
            <strong>{monthName}</strong>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Nächster Monat">
              ›
            </button>
          </div>
          <div className="calendar-grid">
            {WEEKDAYS.map((name) => (
              <span key={name} className="calendar-weekday">
                {name}
              </span>
            ))}
            {cells.map((day, index) =>
              day === null ? (
                <span key={`leer-${index}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  disabled={day < today}
                  aria-pressed={days.includes(day)}
                  className={`calendar-day${days.includes(day) ? " is-on" : ""}`}
                  onClick={() => toggleDay(day)}
                >
                  {Number(day.slice(8))}
                </button>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="field">
        <span className="field-label">Zwischen welchen Uhrzeiten?</span>
        <div className="row">
          <select value={fromTime} onChange={(event) => setFromTime(event.target.value)} aria-label="Beginn">
            {TIMES.slice(0, -1).map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
          <span className="row-sep">bis</span>
          <select value={toTime} onChange={(event) => setToTime(event.target.value)} aria-label="Ende">
            {TIMES.filter((time) => time > fromTime).map((time) => (
              <option key={time}>{time}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="field">
        <span className="field-label">In welchem Takt?</span>
        <div className="segmented">
          {STEPS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={step === option}
              className={step === option ? "is-on" : ""}
              onClick={() => setStep(option)}
            >
              {STEP_LABEL[option]}
            </button>
          ))}
        </div>
        <p className="hint">Der Takt lässt sich später ändern, ohne dass jemand neu antworten muss.</p>
      </section>

      <label className="check">
        <input type="checkbox" checked={allowMaybe} onChange={(event) => setAllowMaybe(event.target.checked)} />
        <span>
          „Vielleicht“ zulassen
          <em>Zweite Stufe neben Ja — hilfreich, wenn Zeiten nur unter Vorbehalt passen.</em>
        </span>
      </label>

      {windowTooShort ? <p className="error">Das Zeitfenster ist kürzer als ein Takt.</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <button type="button" className="primary" disabled={!ready || busy} onClick={submit}>
        {busy ? "Wird angelegt …" : "Termin anlegen"}
      </button>
    </main>
  );
}
