import { useEffect, useMemo, useRef, useState } from "react";
import type { Choice, Participant, PollView, Span, Step } from "../../shared/types.ts";
import { STEPS } from "../../shared/types.ts";
import { ApiError, deleteEntry, patchPoll, readPoll, saveEntry } from "../lib/api.ts";
import { bestRanges, cellKey, cellsToSpans, slotsOf, spanCells, tally } from "../lib/grid.ts";
import { dayLong, joinNames, since } from "../lib/format.ts";
import Grid from "../components/Grid.tsx";
import { DayFigure, DragFigure, TapFigure } from "../components/HelpFigures.tsx";
import { DEMO, reset as resetDemo } from "../lib/demoStore.ts";

const STEP_LABEL: Record<Step, string> = { 15: "15 Min.", 30: "30 Min.", 60: "1 Std.", 120: "2 Std." };

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

  /** Kopfzeile eines Tages: ganzen Tag setzen — oder leeren, wenn er schon voll ist. */
  function toggleDay(day: string) {
    const keys = times.map((time) => cellKey(day, time));
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

      {editing || showCounts ? (
        <div className="grid-bar">
          <p className="hint">
            {editing ? "Tippen wählt ein Feld, Halten und Ziehen einen Block." : "Ein Feld antippen zeigt, wer kann."}
          </p>
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
        mine={editing ? mine : new Map()}
        counts={counts}
        total={displayed.length}
        showCounts={showCounts}
        editing={editing}
        brush={brush}
        onCommit={commit}
        onInspect={activateCell}
        onDayToggle={toggleDay}
      />

      <label className="check compact">
        <input type="checkbox" checked={showCounts} onChange={(event) => setShowCounts(event.target.checked)} />
        <span>Antworten anderer zeigen</span>
      </label>

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

      {!editing && ranges.length > 0 ? (
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

      {!editing ? (
        <>
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
