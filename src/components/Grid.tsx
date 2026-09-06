import { Fragment, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import type { Choice, Poll } from "../../shared/types.ts";
import type { Tally } from "../lib/grid.ts";
import { cellKey } from "../lib/grid.ts";
import { dayShort, dayWeekday, isWeekend } from "../lib/format.ts";
import { usePaint } from "../hooks/usePaint.ts";

type Props = {
  poll: Poll;
  times: string[];
  mine: Map<string, Choice>;
  counts: Map<string, Tally>;
  total: number;
  editing: boolean;
  brush: Choice;
  onCommit: (keys: string[], erase: boolean) => void;
  onInspect: (key: string) => void;
};

const rowHeight = (step: number) => (step >= 120 ? 64 : step >= 60 ? 46 : step >= 30 ? 36 : 28);

export default function Grid({ poll, times, mine, counts, total, editing, brush, onCommit, onInspect }: Props) {
  const [focus, setFocus] = useState<[number, number]>([0, 0]);
  const { ref, preview } = usePaint({
    days: poll.days,
    times,
    enabled: editing,
    // Nur wenn das Feld schon den aktiven Pinsel traegt, wird radiert.
    // Sonst schreibt "Vielleicht" ein Ja-Feld um, statt es zu loeschen.
    isSet: (key) => mine.get(key) === brush,
    onCommit,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const [dayIndex, timeIndex] = focus;
    const key = cellKey(poll.days[dayIndex], times[timeIndex]);

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (editing) onCommit([key], mine.get(key) === brush);
      else onInspect(key);
      return;
    }
    const move = steps[event.key];
    if (!move) return;
    event.preventDefault();
    const next: [number, number] = [
      Math.min(poll.days.length - 1, Math.max(0, dayIndex + move[0])),
      Math.min(times.length - 1, Math.max(0, timeIndex + move[1])),
    ];
    setFocus(next);
    ref.current
      ?.querySelector<HTMLElement>(`[data-key="${cellKey(poll.days[next[0]], times[next[1]])}"]`)
      ?.focus({ preventScroll: false });
  };

  const style = {
    "--cols": poll.days.length,
    "--row-h": `${rowHeight(poll.step)}px`,
  } as CSSProperties;

  return (
    <div className="grid-scroll" style={style}>
      <div className="grid" role="grid" ref={ref} onKeyDown={onKeyDown}>
        <div className="grid-corner" />
        {poll.days.map((day) => (
          <div key={day} className={`grid-day${isWeekend(day) ? " is-weekend" : ""}`} role="columnheader">
            <span className="grid-day-name">{dayWeekday(day)}</span>
            <span className="grid-day-date">{dayShort(day)}</span>
          </div>
        ))}

        {times.map((time, timeIndex) => (
          <Fragment key={time}>
            <div className="grid-time" role="rowheader">
              {poll.step >= 30 || time.endsWith(":00") ? time : ""}
            </div>
            {poll.days.map((day, dayIndex) => {
              const key = cellKey(day, time);
              const painted = preview?.keys.has(key) ?? false;
              const own = painted ? (preview!.erase ? undefined : brush) : mine.get(key);
              const tally = counts.get(key);
              const yes = tally?.yes.length ?? 0;
              const maybe = tally?.maybe.length ?? 0;
              const fill = total > 0 ? Math.round(((yes + maybe * 0.5) / total) * 100) : 0;
              const focused = focus[0] === dayIndex && focus[1] === timeIndex;

              return (
                <div
                  key={key}
                  role="gridcell"
                  data-key={key}
                  tabIndex={focused ? 0 : -1}
                  aria-selected={own !== undefined}
                  aria-label={`${dayWeekday(day)} ${dayShort(day)} ${time}, ${yes} von ${total}`}
                  className={[
                    "cell",
                    own === "yes" ? "is-yes" : "",
                    own === "maybe" ? "is-maybe" : "",
                    painted ? "is-painting" : "",
                    time.endsWith(":00") ? "is-hour" : "",
                    fill > 55 ? "on-dark" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{ "--fill": fill } as CSSProperties}
                  onFocus={() => setFocus([dayIndex, timeIndex])}
                  onClick={editing ? undefined : () => onInspect(key)}
                >
                  {!editing && total > 1 && yes > 0 ? <span className="cell-count">{yes}</span> : null}
                </div>
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
