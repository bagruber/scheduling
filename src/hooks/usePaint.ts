import { useEffect, useRef, useState } from "react";

// Auf dem Handy bedeutet ein Wisch gleichzeitig "scrollen" und "malen". Statt
// eines Moduswechsels trennt die Geste selbst: ein kurzer Tipper schaltet ein
// Feld, ein Wisch scrollt wie gewohnt, und erst ein ruhiges Halten startet die
// Rechteckauswahl. Weil bis dahin nichts bewegt wurde, hat der Browser das
// Scrollen noch nicht begonnen — ein preventDefault auf dem ersten touchmove
// danach verhindert es zuverlaessig.
const LONG_PRESS_MS = 250;
const SLOP_PX = 8;

type Options = {
  days: string[];
  times: string[];
  enabled: boolean;
  isSet: (key: string) => boolean;
  onCommit: (keys: string[], erase: boolean) => void;
};

export type PaintPreview = { keys: Set<string>; erase: boolean };

const splitKey = (key: string): [string, string] => {
  const at = key.indexOf("T");
  return [key.slice(0, at), key.slice(at + 1)];
};

export function usePaint(options: Options) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<PaintPreview | null>(null);
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const grid = ref.current;
    if (!grid) return;

    let pointerId: number | null = null;
    let startKey: string | null = null;
    let startX = 0;
    let startY = 0;
    let painting = false;
    let erase = false;
    let aborted = false;
    let selection = new Set<string>();
    let timer: number | undefined;

    const keyAt = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-key]")?.dataset.key ?? null;

    const rectangle = (from: string, to: string) => {
      const { days, times } = latest.current;
      const [fromDay, fromTime] = splitKey(from);
      const [toDay, toTime] = splitKey(to);
      const d0 = days.indexOf(fromDay);
      const d1 = days.indexOf(toDay);
      const t0 = times.indexOf(fromTime);
      const t1 = times.indexOf(toTime);
      if (d0 < 0 || d1 < 0 || t0 < 0 || t1 < 0) return new Set([from]);

      const keys = new Set<string>();
      for (let d = Math.min(d0, d1); d <= Math.max(d0, d1); d += 1) {
        for (let t = Math.min(t0, t1); t <= Math.max(t0, t1); t += 1) keys.add(`${days[d]}T${times[t]}`);
      }
      return keys;
    };

    const show = (keys: Set<string>) => {
      selection = keys;
      setPreview({ keys, erase });
    };

    const begin = () => {
      if (!startKey) return;
      painting = true;
      // Die erste Zelle bestimmt die Richtung: auf Leerem malt man, auf
      // Gesetztem radiert man. Damit entfaellt ein weiterer Schalter.
      erase = latest.current.isSet(startKey);
      navigator.vibrate?.(10);
      if (pointerId !== null) grid.setPointerCapture(pointerId);
      show(new Set([startKey]));
    };

    const reset = () => {
      window.clearTimeout(timer);
      pointerId = null;
      startKey = null;
      painting = false;
      aborted = false;
      selection = new Set();
      setPreview(null);
    };

    const onDown = (event: PointerEvent) => {
      if (!latest.current.enabled || event.button !== 0 || pointerId !== null) return;
      const key = keyAt(event.clientX, event.clientY);
      if (!key) return;

      pointerId = event.pointerId;
      startKey = key;
      startX = event.clientX;
      startY = event.clientY;
      painting = false;
      aborted = false;

      if (event.pointerType === "touch") {
        timer = window.setTimeout(begin, LONG_PRESS_MS);
      } else {
        event.preventDefault();
        begin();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || !startKey) return;
      if (!painting) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > SLOP_PX) {
          window.clearTimeout(timer);
          aborted = true;
        }
        return;
      }
      show(rectangle(startKey, keyAt(event.clientX, event.clientY) ?? startKey));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId || !startKey) return;
      if (painting) latest.current.onCommit([...selection], erase);
      else if (!aborted) latest.current.onCommit([startKey], latest.current.isSet(startKey));
      reset();
    };

    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) reset();
    };

    // Muss nicht-passiv am Raster selbst haengen: auf window/document erzwingt
    // Chrome passive und preventDefault waere wirkungslos.
    const blockScroll = (event: TouchEvent) => {
      if (painting) event.preventDefault();
    };

    grid.addEventListener("pointerdown", onDown);
    grid.addEventListener("touchmove", blockScroll, { passive: false });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    return () => {
      window.clearTimeout(timer);
      grid.removeEventListener("pointerdown", onDown);
      grid.removeEventListener("touchmove", blockScroll);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, []);

  return { ref, preview };
}
