import { useEffect, useMemo, useRef, useState } from "react";
import type { Choice, Participant, PollView, Span, Step } from "../../shared/types.ts";
import { STEPS } from "../../shared/types.ts";
import { ApiError, deleteEntry, patchPoll, readPoll, saveEntry } from "../lib/api.ts";
import { bestRanges, cellKey, cellsToSpans, slotsOf, spanCells, tally, toMinutes } from "../lib/grid.ts";
import { dayLong, dayShort, dayWeekday, joinNames, since } from "../lib/format.ts";
import Grid from "../components/Grid.tsx";

const STEP_LABEL: Record<Step, string> = { 15: "15 Min.", 30: "30 Min.", 60: "1 Std.", 120: "2 Std." };

const QUICK = [
  { label: "ganzer Tag", from: "00:00", to: "24:00" },
  { label: "vormittags", from: "08:00", to: "12:00" },
  { label: "nachmittags", from: "12:00", to: "17:00" },
  { label: "abends", from: "17:00", to: "23:00" },
];

const keysOf = (cells: Map<string, Choice>, choice: Choice) =>
  [...cells].filter(([, value]) => value === choice).map(([key]) => key);

export default function PollPage({ id }: { id: string }) {
  const adminToken = new URLSearchParams(window.location.search).get("a") ?? "";

  const [view, setView] = useState<PollView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [mine, setMine] = useState<Map<string, Choice>>(new Map());
  const [brush, setBrush] = useState<Choice>("yes");
  const [inspect, setInspect] = useState<string | null>(null);
  const [daySheet, setDaySheet] = useState<string | null>(null);
  const [undo, setUndo] = useState<Map<string, Choice> | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);

  const saveTimer = useRef<number | undefined>(undefined);
  const undoTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    readPoll(id)
      .then(setView)
      .catch((problem: unknown) => setLoadError(problem instanceof Error ? problem.message : "Fehler"));
  }, [id]);

  const poll = view?.poll;

  useEffect(() => {
    if (poll) document.title = `${poll.title} — Terminraster`;
  }, [poll]);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const times = useMemo(() => (poll ? slotsOf(poll) : []), [poll]);

  // Waehrend des Eintragens zeigt die Gruppenansicht den eigenen, noch nicht
  // gespeicherten Stand mit — sonst springt das Raster nach jedem Speichern.
  const displayed: Participant[] = useMemo(() => {
    if (!view || !poll) return [];
    if (!editing) return view.participants;
    const others = view.participants.filter((person) => person.name.toLowerCase() !== name.trim().toLowerCase());
    const spans: Span[] = [
      ...cellsToSpans(keysOf(mine, "yes"), poll, "yes"),
      ...cellsToSpans(keysOf(mine, "maybe"), poll, "maybe"),
    ];
    return [...others, { id: -1, name: name.trim(), locked: false, updatedAt: new Date().toISOString(), spans }];
  }, [view, poll, editing, mine, name]);

  const counts = useMemo(() => (poll ? tally(poll, displayed) : new Map()), [poll, displayed]);
  const ranges = useMemo(() => (poll ? bestRanges(poll, displayed) : []), [poll, displayed]);

  if (loadError) {
    return (
      <main className="page page-narrow">
        <h1>Nicht gefunden</h1>
        <p className="hint">{loadError}</p>
        <a className="primary" href="/">
          Neuen Termin anlegen
        </a>
      </main>
    );
  }

  if (!view || !poll) {
    return (
      <main className="page page-narrow">
        <p className="hint">Wird geladen …</p>
      </main>
    );
  }

  const closed = poll.closedAt !== null;
  const trimmedName = name.trim();
  const existing = view.participants.find((person) => person.name.toLowerCase() === trimmedName.toLowerCase());
  const needsPassword = existing?.locked === true;
  const shareUrl = `${window.location.origin}/e/${id}`;

  const refresh = () => readPoll(id).then(setView);

  const toSpans = (cells: Map<string, Choice>): Span[] => [
    ...cellsToSpans(keysOf(cells, "yes"), poll, "yes"),
    ...cellsToSpans(keysOf(cells, "maybe"), poll, "maybe"),
  ];

  function beginEditing() {
    const cells = new Map<string, Choice>();
    if (existing) {
      for (const key of spanCells(existing.spans, poll!, "yes").keys()) cells.set(key, "yes");
      for (const key of spanCells(existing.spans, poll!, "maybe").keys()) if (!cells.has(key)) cells.set(key, "maybe");
    }
    setMine(cells);
    setEditing(true);
    setSigningIn(false);
    setStatus("idle");
    setSaveError("");
  }

  async function save(cells: Map<string, Choice>) {
    setStatus("saving");
    try {
      await saveEntry(id, { name: trimmedName, password: password || null, spans: toSpans(cells) });
      setStatus("saved");
      setSaveError("");
      await refresh();
    } catch (problem) {
      setStatus("failed");
      setSaveError(problem instanceof ApiError ? problem.message : "Speichern fehlgeschlagen");
    }
  }

  function apply(next: Map<string, Choice>, snapshot: Map<string, Choice>) {
    setUndo(snapshot);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);

    setMine(next);
    window.clearTimeout(saveTimer.current);
    setStatus("saving");
    saveTimer.current = window.setTimeout(() => void save(next), 700);
  }

  function commit(keys: string[], erase: boolean) {
    const next = new Map(mine);
    for (const key of keys) {
      if (erase) next.delete(key);
      else next.set(key, brush);
    }
    apply(next, new Map(mine));
  }

  function fillDay(day: string, from: string, to: string, erase: boolean) {
    setDaySheet(null);
    const keys = times
      .filter((time) => toMinutes(time) >= toMinutes(from) && toMinutes(time) < toMinutes(to))
      .map((time) => cellKey(day, time));
    if (keys.length > 0) commit(keys, erase);
  }

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: poll!.title, url: shareUrl }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(shareUrl).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function changePoll(patch: Record<string, unknown>) {
    await patchPoll(id, patch, adminToken).catch(() => undefined);
    await refresh();
  }

  const inspected = inspect ? counts.get(inspect) : undefined;
  const absent = inspected
    ? displayed.map((p) => p.name).filter((n) => !inspected.yes.includes(n) && !inspected.maybe.includes(n))
    : [];

  return (
    <main className={editing ? "page editing" : "page"}>
      {editing ? null : (
      <header className="poll-head">
        <h1>{poll.title}</h1>
        {poll.note ? <p className="note">{poll.note}</p> : null}
        <p className="meta">
          {poll.days.length} {poll.days.length === 1 ? "Tag" : "Tage"} · {poll.fromTime}–{poll.toTime} ·{" "}
          {STEP_LABEL[poll.step]} · {displayed.length} {displayed.length === 1 ? "Antwort" : "Antworten"}
        </p>
        {closed ? <p className="banner">Geschlossen — Einträge lassen sich nicht mehr ändern.</p> : null}
      </header>
      )}

      {ranges.length > 0 && !editing ? (
        <section className="best">
          <h2>Passt am besten</h2>
          <ol>
            {ranges.map((range) => (
              <li key={`${range.day}${range.from}`}>
                <strong>
                  {dayLong(range.day)}, {range.from}–{range.to}
                </strong>
                <span>
                  {range.yes.length} von {displayed.length}
                  {range.missing.length > 0 ? ` · ohne ${joinNames(range.missing)}` : " · alle"}
                  {range.maybe.length > 0 ? ` · vielleicht ${joinNames(range.maybe)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {editing ? (
        <div className="toolbar">
          <span className="who">{trimmedName}</span>
          {poll.allowMaybe ? (
            <div className="segmented small">
              <button type="button" className={brush === "yes" ? "is-on" : ""} onClick={() => setBrush("yes")}>
                Ja
              </button>
              <button type="button" className={brush === "maybe" ? "is-on" : ""} onClick={() => setBrush("maybe")}>
                Vielleicht
              </button>
            </div>
          ) : null}
          <span className={`status is-${status}`}>
            {status === "saving"
              ? "speichert …"
              : status === "saved"
                ? "gespeichert"
                : status === "failed"
                  ? "nicht gespeichert"
                  : ""}
          </span>
          <button type="button" className="ghost" onClick={() => setEditing(false)}>
            Fertig
          </button>
        </div>
      ) : null}

      <p className="hint grid-hint">
        {editing
          ? "Tippen = ein Feld. Halten und ziehen = Block. Wischen scrollt."
          : "Ein Feld antippen zeigt, wer kann."}
      </p>

      <Grid
        poll={poll}
        times={times}
        mine={editing ? mine : new Map()}
        counts={counts}
        total={displayed.length}
        editing={editing}
        brush={brush}
        onCommit={commit}
        onInspect={setInspect}
      />

      {editing ? (
        <div className="day-quick">
          {poll.days.map((day) => (
            <button key={day} type="button" onClick={() => setDaySheet(daySheet === day ? null : day)}>
              {dayWeekday(day)} {dayShort(day)}
            </button>
          ))}
        </div>
      ) : null}

      {daySheet ? (
        <div className="sheet">
          <strong>{dayLong(daySheet)}</strong>
          <div className="sheet-options">
            {QUICK.filter(
              (option) =>
                toMinutes(option.from) < toMinutes(poll.toTime) && toMinutes(option.to) > toMinutes(poll.fromTime),
            ).map((option) => (
              <button key={option.label} type="button" onClick={() => fillDay(daySheet, option.from, option.to, false)}>
                {option.label}
              </button>
            ))}
            <button type="button" className="ghost" onClick={() => fillDay(daySheet, "00:00", "24:00", true)}>
              kann nicht
            </button>
          </div>
        </div>
      ) : null}

      {undo && editing ? (
        <div className="undo">
          <span>Geändert</span>
          <button
            type="button"
            onClick={() => {
              apply(undo, new Map(mine));
              setUndo(null);
            }}
          >
            Rückgängig
          </button>
        </div>
      ) : null}

      {saveError ? (
        <div className="error">
          <p>{saveError}</p>
          {needsPassword ? (
            <label className="field">
              <span>Kennwort für „{trimmedName}“</span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
          ) : null}
          <button type="button" onClick={() => void save(mine)}>
            Erneut speichern
          </button>
        </div>
      ) : null}

      {inspect && !editing ? (
        <section className="inspect">
          <h2>
            {dayLong(inspect.slice(0, inspect.indexOf("T")))}, {inspect.slice(inspect.indexOf("T") + 1)}
          </h2>
          <p>
            <strong>Kann:</strong> {joinNames(inspected?.yes ?? [])}
          </p>
          {(inspected?.maybe.length ?? 0) > 0 ? (
            <p>
              <strong>Vielleicht:</strong> {joinNames(inspected!.maybe)}
            </p>
          ) : null}
          <p className="muted">
            <strong>Kann nicht:</strong> {joinNames(absent)}
          </p>
          <button type="button" className="ghost" onClick={() => setInspect(null)}>
            Schließen
          </button>
        </section>
      ) : null}

      {!editing && !closed ? (
        signingIn ? (
          <section className="signin">
            <label className="field">
              <span>Dein Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                list="known-names"
                maxLength={40}
                autoFocus
              />
            </label>
            <datalist id="known-names">
              {view.participants.map((person) => (
                <option key={person.id} value={person.name} />
              ))}
            </datalist>
            <label className="field">
              <span>
                Kennwort {needsPassword ? <em>für diesen Eintrag nötig</em> : <em>optional, schützt deinen Eintrag</em>}
              </span>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <p className="hint">Kein Konto — nimm bitte nicht dein echtes Passwort.</p>
            <button type="button" className="primary" disabled={trimmedName.length === 0} onClick={beginEditing}>
              {existing ? "Eintrag ändern" : "Zeiten eintragen"}
            </button>
          </section>
        ) : (
          <button type="button" className="primary" onClick={() => setSigningIn(true)}>
            Zeiten eintragen
          </button>
        )
      ) : null}

      {editing ? null : (
      <section className="people">
        <h2>Wer geantwortet hat</h2>
        {view.participants.length === 0 ? (
          <p className="hint">Noch niemand.</p>
        ) : (
          <ul>
            {view.participants.map((person) => (
              <li key={person.id}>
                <span className="people-name">
                  {person.name}
                  {person.locked ? <em title="mit Kennwort geschützt"> · geschützt</em> : null}
                </span>
                <span className="muted">{since(person.updatedAt)}</span>
                {adminToken ? (
                  <button
                    type="button"
                    className="ghost tiny"
                    onClick={() => void deleteEntry(id, person.id, { adminToken }).then(refresh)}
                  >
                    entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {editing ? null : (
      <section className="share">
        <button type="button" className="ghost" onClick={() => void share()}>
          {copied ? "Link kopiert" : "Link teilen"}
        </button>
        <code>{shareUrl}</code>
      </section>
      )}

      {adminToken && !editing ? (
        <section className="admin">
          <h2>Verwaltung</h2>
          <p className="hint">Diesen Link behalten — nur mit ihm lässt sich der Termin ändern.</p>
          <div className="row">
            <span className="field-label">Takt</span>
            <div className="segmented small">
              {STEPS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={poll.step === option ? "is-on" : ""}
                  onClick={() => void changePoll({ step: option })}
                >
                  {STEP_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={poll.allowMaybe}
              onChange={(event) => void changePoll({ allowMaybe: event.target.checked })}
            />
            <span>„Vielleicht“ zulassen</span>
          </label>
          <button type="button" className="ghost" onClick={() => void changePoll({ closed: !closed })}>
            {closed ? "Wieder öffnen" : "Termin schließen"}
          </button>
        </section>
      ) : null}
    </main>
  );
}
