import { useEffect, useMemo, useRef, useState } from "react";
import type { Choice, Participant, PollView, Span, Step } from "../../shared/types.ts";
import { STEPS } from "../../shared/types.ts";
import { ApiError, deleteEntry, patchPoll, readPoll, saveEntry } from "../lib/api.ts";
import type { DrawnShift } from "../lib/grid.ts";
import {
  bestRanges,
  cellKey,
  cellsToSpans,
  dayOf,
  planShifts,
  slotsOf,
  spanCells,
  staffShifts,
  tally,
  timeOf,
  toMinutes,
} from "../lib/grid.ts";
import { dayLong, joinNames, since } from "../lib/format.ts";
import Grid from "../components/Grid.tsx";
import { DayFigure, DragFigure, TapFigure } from "../components/HelpFigures.tsx";
import { DEMO, reset as resetDemo } from "../lib/demoStore.ts";
import { rosterCsv, rosterFilename } from "../lib/export.ts";

const STEP_LABEL: Record<Step, string> = { 15: "15 Min.", 30: "30 Min.", 60: "1 Std.", 120: "2 Std." };

const hours = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 1 });

/** Stunden je Person, absteigend — die Zahl, an der man die Last ablesen kann. */
const hoursPerPerson = (shifts: { from: string; to: string; crew: string[] }[]) => {
  const total = new Map<string, number>();
  for (const shift of shifts) {
    const span = (toMinutes(shift.to) - toMinutes(shift.from)) / 60;
    for (const name of shift.crew) total.set(name, (total.get(name) ?? 0) + span);
  }
  return [...total].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

const keysOf = (cells: Map<string, Choice>, choice: Choice) =>
  [...cells].filter(([, value]) => value === choice).map(([key]) => key);

export default function PollPage({ id }: { id: string }) {
  const adminToken = new URLSearchParams(window.location.search).get("a") ?? "";

  const [view, setView] = useState<PollView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [mine, setMine] = useState<Map<string, Choice>>(new Map());
  const [brush, setBrush] = useState<Choice>("yes");
  const [showCounts, setShowCounts] = useState(false);
  const [inspect, setInspect] = useState<string | null>(null);
  const [undo, setUndo] = useState<Map<string, Choice> | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveError, setSaveError] = useState("");
  const [copied, setCopied] = useState(false);
  const [calling, setCalling] = useState(false);
  const [focusPerson, setFocusPerson] = useState<string | null>(null);
  const [planMode, setPlanMode] = useState<"single" | "shifts" | "draw">("single");
  const [drawnCells, setDrawnCells] = useState<Map<string, Choice>>(new Map());
  const [mins, setMins] = useState<Map<string, number>>(new Map());
  const [minPeople, setMinPeople] = useState(2);
  const [extra, setExtra] = useState(0);

  const saveTimer = useRef<number | undefined>(undefined);
  const undoTimer = useRef<number | undefined>(undefined);
  const help = useRef<HTMLDialogElement>(null);
  const signin = useRef<HTMLElement>(null);
  const nameField = useRef<HTMLInputElement>(null);

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

  // Waehrend des Eintragens zeigt die Auszaehlung den eigenen, noch nicht
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

  const answeredCount = displayed.filter((p) => p.spans.some((s) => s.choice === "yes")).length;
  const maxPeople = Math.max(1, displayed.length);
  const shiftSize = Math.min(minPeople, maxPeople);
  const plan = useMemo(
    () => (poll ? planShifts(poll, displayed, shiftSize) : { shifts: [], enough: 0, unplaceable: [] }),
    [poll, displayed, shiftSize],
  );
  // planShifts gibt die Schichten in der Reihenfolge aus, in der es sie
  // vergeben hat. Angezeigt wird erst, was noetig ist, damit jeder einmal dran
  // war; nachgeladene kommen chronologisch an ihren Platz.
  const visible = Math.min(plan.enough + extra, plan.shifts.length);
  const shown = useMemo(
    () => plan.shifts.slice(0, visible).sort((a, b) => (`${a.day}T${a.from}` < `${b.day}T${b.from}` ? -1 : 1)),
    [plan, visible],
  );
  const placed = new Set(shown.flatMap((shift) => shift.crew)).size;

  // Wie viel jeder im angezeigten Plan traegt — die Zahl, an der man merkt,
  // ob sich die Last verteilt.
  const load = useMemo(() => hoursPerPerson(shown), [shown]);

  // Von Hand gezeichnete Schichten: zusammenhaengend Gemaltes wird je Tag zu
  // einer Schicht. Die Mindestzahl haengt am Beginn der Schicht, damit sie ein
  // Neuzeichnen nebenan uebersteht.
  const drawnShifts: DrawnShift[] = useMemo(() => {
    if (!poll) return [];
    return cellsToSpans([...drawnCells.keys()], poll, "yes").map((span) => {
      const day = dayOf(span.from);
      const from = timeOf(span.from);
      return { day, from, to: timeOf(span.to), min: mins.get(`${day}T${from}`) ?? shiftSize };
    });
  }, [poll, drawnCells, mins, shiftSize]);

  const staffed = useMemo(
    () => (poll ? staffShifts(poll, displayed, drawnShifts) : []),
    [poll, displayed, drawnShifts],
  );
  // Jeder Einsatz bringt seine eigene Dauer mit — wer nur einen Teil der
  // Schicht traegt, bekommt auch nur den angerechnet.
  const drawnLoad = useMemo(() => {
    const total = new Map<string, number>();
    for (const shift of staffed) {
      for (const duty of shift.duties) {
        const span = (toMinutes(duty.to) - toMinutes(duty.from)) / 60;
        total.set(duty.name, (total.get(duty.name) ?? 0) + span);
      }
    }
    return [...total].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }, [staffed]);

  // Ein angetippter Name blendet dessen Zeiten ins Raster — sonst muss man sie
  // sich aus der Heatmap zusammenreimen.
  const focusCells = useMemo(() => {
    const cells = new Map<string, Choice>();
    const person = poll && focusPerson ? displayed.find((p) => p.name === focusPerson) : undefined;
    if (!poll || !person) return cells;
    for (const key of spanCells(person.spans, poll, "yes").keys()) cells.set(key, "yes");
    for (const key of spanCells(person.spans, poll, "maybe").keys()) if (!cells.has(key)) cells.set(key, "maybe");
    return cells;
  }, [poll, displayed, focusPerson]);

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

  const mode = adminToken ? planMode : "single";
  const planning = !editing && mode === "draw";

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
    setStatus("idle");
    setSaveError("");
    setInspect(null);
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

  /** Im Zeichenmodus malt man Schichten statt eigener Zeiten. */
  function commitDrawn(keys: string[], erase: boolean) {
    const next = new Map(drawnCells);
    for (const key of keys) {
      if (erase) next.delete(key);
      else next.set(key, "yes");
    }
    setDrawnCells(next);
  }

  /** Kopfzeile eines Tages: ganzen Tag setzen — oder leeren, wenn er schon voll ist. */
  function toggleDay(day: string) {
    const keys = times.map((time) => cellKey(day, time));
    if (planning) {
      commitDrawn(keys, keys.every((key) => drawnCells.has(key)));
      return;
    }
    commit(keys, keys.every((key) => mine.get(key) === brush));
  }

  // Beide APIs gibt es nur im sicheren Kontext. Ueber http://<ip>:<port> fehlt
  // navigator.clipboard ganz — ohne Guard wirft der Zugriff, und der Knopf
  // taete stumm nichts. Dann lieber keinen Knopf zeigen: die URL steht daneben.
  const canShare = typeof navigator.share === "function" || navigator.clipboard !== undefined;

  async function share() {
    if (navigator.share) {
      await navigator.share({ title: poll!.title, url: shareUrl }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Kopieren abgelehnt — die URL steht ohnehin daneben.
    }
  }

  /** Die Einteilung als Tabelle — Spalten je Stunde, Zeilen je Person. */
  function downloadRoster() {
    const blob = new Blob([rosterCsv(poll!, staffed)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = rosterFilename(poll!);
    link.click();
    URL.revokeObjectURL(url);
  }

  async function changePoll(patch: Record<string, unknown>) {
    await patchPoll(id, patch, adminToken).catch(() => undefined);
    await refresh();
  }

  /** Vor dem Eintragen ist ein Tipper ins Raster ein Versuch mitzumachen. */
  function activateCell(key: string) {
    if (!closed && !showCounts) {
      signin.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameField.current?.focus({ preventScroll: true });
      setCalling(true);
      window.setTimeout(() => setCalling(false), 2600);
      return;
    }
    setInspect(key);
  }

  const inspected = inspect ? counts.get(inspect) : undefined;
  const absent = inspected
    ? displayed.map((p) => p.name).filter((n) => !inspected.yes.includes(n) && !inspected.maybe.includes(n))
    : [];

  return (
    <main className={editing ? "page editing" : "page"}>
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
      ) : (
        <>
          {DEMO ? (
            <p className="demo-note">
              Mockup ohne Server — was du einträgst, bleibt in diesem Browser und geht nirgendwo hin.{" "}
              <button type="button" className="linkish" onClick={resetDemo}>
                Zurücksetzen
              </button>
            </p>
          ) : null}

          <header className="poll-head">
            <h1>{poll.title}</h1>
            {poll.note ? <p className="note">{poll.note}</p> : null}
            {closed ? <p className="banner">Geschlossen — Einträge lassen sich nicht mehr ändern.</p> : null}
          </header>

          {closed ? null : (
            <section className="signin" ref={signin}>
              <div className="row two">
                <label className="field">
                  <span>Dein Name</span>
                  <input
                    ref={nameField}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    list="known-names"
                    maxLength={40}
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Kennwort {needsPassword ? <em>nötig</em> : <em>optional</em>}</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
                </label>
              </div>
              <datalist id="known-names">
                {view.participants.map((person) => (
                  <option key={person.id} value={person.name} />
                ))}
              </datalist>
              {existing ? (
                <p className={needsPassword ? "notice is-locked" : "notice"}>
                  <strong>„{existing.name}“ hat hier schon einen Eintrag.</strong>{" "}
                  {needsPassword
                    ? "Er ist mit einem Kennwort geschützt — ohne dieses Kennwort lässt er sich nicht ändern."
                    : "Wenn du fortfährst, änderst du diesen Eintrag."}
                </p>
              ) : (
                <p className="hint">
                  Das Kennwort ermöglicht dir, deine Angaben zu ändern. Du erstellst damit kein Konto. Wähle bitte
                  kein Passwort, das du bereits verwendest.
                </p>
              )}
              {calling ? (
                <p className="notice">
                  Trag zuerst deinen Namen ein und tipp auf <strong>Verfügbarkeit eintragen</strong> — danach lässt
                  sich das Raster ausfüllen.
                </p>
              ) : null}
              <button
                type="button"
                className={calling ? "primary is-calling" : "primary"}
                disabled={trimmedName.length === 0}
                onClick={beginEditing}
              >
                {existing ? "Eintrag ändern" : "Verfügbarkeit eintragen"}
              </button>
            </section>
          )}
        </>
      )}

      {editing || planning || showCounts || focusPerson ? (
        <div className="grid-bar">
          <p className="hint">
            {editing
              ? "Tippen wählt ein Feld, Halten und Ziehen einen Block."
              : planning
                ? "Schichten ins Raster malen — die Besetzung wird gewählt."
                : focusPerson
                  ? `Zeiten von ${focusPerson}`
                  : "Ein Feld antippen zeigt, wer kann."}
          </p>
          {focusPerson && !editing ? (
            <button type="button" className="ghost tiny" onClick={() => setFocusPerson(null)}>
              Alle zeigen
            </button>
          ) : null}
          {editing ? (
            <button
              type="button"
              className="icon"
              aria-label="Hilfe zur Bedienung"
              onClick={() => help.current?.showModal()}
            >
              ?
            </button>
          ) : null}
        </div>
      ) : null}

      <Grid
        poll={poll}
        times={times}
        mine={editing ? mine : planning ? drawnCells : focusCells}
        counts={counts}
        total={displayed.length}
        showCounts={planning || (showCounts && !focusPerson)}
        editing={editing}
        planning={planning}
        brush={planning ? "yes" : brush}
        onCommit={planning ? commitDrawn : commit}
        onInspect={activateCell}
        onDayToggle={toggleDay}
      />

      {planning ? null : (
        <label className="check compact">
          <input type="checkbox" checked={showCounts} onChange={(event) => setShowCounts(event.target.checked)} />
          <span>Antworten anderer zeigen</span>
        </label>
      )}

      {undo && editing ? (
        <button
          type="button"
          className="undo"
          onClick={() => {
            apply(undo, new Map(mine));
            setUndo(null);
          }}
        >
          <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5.6 5.4H9.2a4 4 0 1 1 0 8H6.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            <path
              d="M7.8 2.7 5 5.4l2.8 2.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Rückgängig
        </button>
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
          <button type="button" className="ghost" onClick={() => void save(mine)}>
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

      {!editing && displayed.length > 0 ? (
        <section className="best">
          {adminToken ? (
            <div className="best-head">
              <h2>Auswertung</h2>
              <div className="segmented small">
                <button type="button" className={mode === "single" ? "is-on" : ""} onClick={() => setPlanMode("single")}>
                  Termin
                </button>
                <button type="button" className={mode === "shifts" ? "is-on" : ""} onClick={() => setPlanMode("shifts")}>
                  Schichten
                </button>
                <button type="button" className={mode === "draw" ? "is-on" : ""} onClick={() => setPlanMode("draw")}>
                  Zeichnen
                </button>
              </div>
            </div>
          ) : (
            <h2>Passt am besten</h2>
          )}

          {mode === "single" ? (
            ranges.length === 0 ? (
              <p className="hint">Noch hat niemand Zeiten eingetragen.</p>
            ) : (
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
            )
          ) : mode === "shifts" ? (
            <>
              <div className="row">
                <span className="field-label">Mindestens</span>
                <select
                  value={shiftSize}
                  aria-label="Mindestzahl an Personen je Schicht"
                  onChange={(event) => setMinPeople(Number(event.target.value))}
                >
                  {Array.from({ length: maxPeople }, (_, i) => i + 1).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span className="row-sep">{shiftSize === 1 ? "Person je Schicht" : "Personen je Schicht"}</span>
              </div>

              {shown.length === 0 ? (
                <p className="hint">Keine Schicht erreicht diese Mindestzahl.</p>
              ) : (
                <>
                  <p className="hint">
                    {placed} von {answeredCount} {answeredCount === 1 ? "Person" : "Personen"} eingeteilt, auf{" "}
                    {shown.length} {shown.length === 1 ? "Schicht" : "Schichten"}.
                  </p>
                  <ol>
                    {shown.map((shift) => (
                      <li key={`${shift.day}${shift.from}`}>
                        <strong>
                          {dayLong(shift.day)}, {shift.from}–{shift.to}
                        </strong>
                        <span>{joinNames(shift.crew)}</span>
                        {shift.standby.length > 0 ? (
                          <span className="muted">könnte einspringen: {joinNames(shift.standby)}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <p className="hint">
                    Stunden je Person: {load.map(([name, value]) => `${name} ${hours(value)} h`).join(" · ")}
                  </p>
                  {visible < plan.shifts.length || extra > 0 ? (
                    <div className="row">
                      {visible < plan.shifts.length ? (
                        <button type="button" className="ghost" onClick={() => setExtra(extra + 1)}>
                          Weitere Schicht laden
                        </button>
                      ) : null}
                      {extra > 0 ? (
                        <button type="button" className="ghost" onClick={() => setExtra(extra - 1)}>
                          Letzte entfernen
                        </button>
                      ) : null}
                      {visible < plan.shifts.length ? (
                        <span className="hint">noch {plan.shifts.length - visible} möglich</span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}

              {plan.unplaceable.length > 0 ? (
                <p className="hint">Kommt in keiner Schicht unter: {joinNames(plan.unplaceable)}</p>
              ) : null}
            </>
          ) : (
            <>
              <div className="row">
                <span className="field-label">Neue Schichten mit</span>
                <select
                  value={shiftSize}
                  aria-label="Mindestzahl für neu gezeichnete Schichten"
                  onChange={(event) => setMinPeople(Number(event.target.value))}
                >
                  {Array.from({ length: maxPeople }, (_, i) => i + 1).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span className="row-sep">{shiftSize === 1 ? "Person" : "Personen"}</span>
              </div>

              {staffed.length === 0 ? (
                <p className="hint">
                  Noch nichts markiert. Male die Schichten ins Raster — tippen, halten und ziehen, oder auf den Tag in
                  der Kopfzeile tippen.
                </p>
              ) : (
                <>
                  <ol>
                    {staffed.map((shift) => (
                      <li key={`${shift.day}${shift.from}`} className={shift.gaps.length > 0 ? "is-short" : ""}>
                        <strong>
                          {dayLong(shift.day)}, {shift.from}–{shift.to}
                        </strong>
                        <span>
                          {shift.duties.length === 0
                            ? "niemand kann"
                            : joinNames(
                                shift.duties.map((duty) =>
                                  duty.whole ? duty.name : `${duty.name} (nur ${duty.from}–${duty.to})`,
                                ),
                              )}
                        </span>
                        {shift.gaps.map((gap) => (
                          <span key={gap.from} className="short-note">
                            {gap.from}–{gap.to}: nur {gap.have} von {shift.min}
                          </span>
                        ))}
                        {shift.standby.length > 0 ? (
                          <span className="muted">könnte einspringen: {joinNames(shift.standby)}</span>
                        ) : null}
                        <label className="shift-min">
                          <span className="muted">mindestens</span>
                          <select
                            value={shift.min}
                            aria-label={`Mindestzahl für ${dayLong(shift.day)} ${shift.from}`}
                            onChange={(event) =>
                              setMins(new Map(mins).set(`${shift.day}T${shift.from}`, Number(event.target.value)))
                            }
                          >
                            {Array.from({ length: maxPeople }, (_, i) => i + 1).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ol>
                  <p className="hint">
                    Stunden je Person: {drawnLoad.map(([name, value]) => `${name} ${hours(value)} h`).join(" · ")}
                  </p>
                  <div className="row">
                    <button type="button" className="ghost" onClick={downloadRoster}>
                      Als Tabelle laden
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        setDrawnCells(new Map());
                        setMins(new Map());
                      }}
                    >
                      Markierung leeren
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      ) : null}

      {!editing ? (
        <>
          <section className="people">
            <h2>Wer geantwortet hat</h2>
            {view.participants.length === 0 ? (
              <p className="hint">Noch niemand.</p>
            ) : (
              <ul>
                {view.participants.map((person) => (
                  <li key={person.id} className={focusPerson === person.name ? "is-focused" : ""}>
                    <button
                      type="button"
                      className="people-name"
                      aria-pressed={focusPerson === person.name}
                      onClick={() => setFocusPerson(focusPerson === person.name ? null : person.name)}
                    >
                      {person.name}
                      {person.locked ? (
                        <span className="lock" title="mit Kennwort geschützt">
                          <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
                            <rect
                              x="3.6"
                              y="7"
                              width="8.8"
                              height="6.4"
                              rx="1.6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                            <path
                              d="M5.9 7V5.3a2.1 2.1 0 0 1 4.2 0V7"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                          geschützt
                        </span>
                      ) : null}
                    </button>
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

          {DEMO ? null : (
          <section className="share">
            {canShare ? (
              <button type="button" className="ghost" onClick={() => void share()}>
                {copied ? "Link kopiert" : "Link teilen"}
              </button>
            ) : null}
            <code>{shareUrl}</code>
          </section>
          )}
        </>
      ) : null}

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

      <dialog className="help" ref={help}>
        <h2>Zeiten markieren</h2>
        <ol className="tut-list">
          <li>
            <TapFigure />
            <p>
              <strong>Tippen</strong> schaltet ein einzelnes Feld an oder aus.
            </p>
          </li>
          <li>
            <DragFigure />
            <p>
              <strong>Halten und ziehen</strong> wählt einen ganzen Block. Wischen scrollt wie gewohnt weiter.
            </p>
          </li>
          <li>
            <DayFigure />
            <p>
              <strong>Auf den Tag in der Kopfzeile tippen</strong> wählt den ganzen Tag — nochmal tippen leert ihn.
            </p>
          </li>
        </ol>
        <p className="hint">Wo du anfängst, entscheidet die Richtung: auf leer wird gemalt, auf gefüllt wird radiert.</p>
        <button type="button" className="ghost" onClick={() => help.current?.close()}>
          Schließen
        </button>
      </dialog>
    </main>
  );
}
