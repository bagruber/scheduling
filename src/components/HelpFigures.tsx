import type { CSSProperties, ReactNode } from "react";

// Miniraster fuer die Anleitung. Die Masse stehen hier einmal und werden
// gerechnet, damit die Animationen in der CSS-Datei an denselben Punkten
// ansetzen wie die gezeichneten Felder.
const COLS = 3;
const ROWS = 4;
const CW = 34;
const CH = 17;
const GAP = 2;
const X0 = 8;
const Y0 = 26;
const HEAD_Y = 6;
const HEAD_H = 14;

const colX = (col: number) => X0 + col * (CW + GAP);
const rowY = (row: number) => Y0 + row * (CH + GAP);
const midX = (col: number) => colX(col) + CW / 2;
const midY = (row: number) => rowY(row) + CH / 2;

const cols = Array.from({ length: COLS }, (_, i) => i);
const rows = Array.from({ length: ROWS }, (_, i) => i);

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg className="tut" viewBox="0 0 122 108" role="img" aria-label={label}>
      <rect className="tut-paper" x="0.5" y="0.5" width="121" height="107" rx="5" />
      {cols.map((col) => (
        <rect key={col} className="tut-head" x={colX(col)} y={HEAD_Y} width={CW} height={HEAD_H} rx="2" />
      ))}
      {rows.map((row) =>
        cols.map((col) => (
          <rect key={`${row}-${col}`} className="tut-cell" x={colX(col)} y={rowY(row)} width={CW} height={CH} rx="2" />
        )),
      )}
      {children}
    </svg>
  );
}

function Dot({ x, y, className }: { x: number; y: number; className: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`tut-dot ${className}`}>
        <circle className="tut-ring" r="11" />
        <circle className="tut-core" r="6" />
      </g>
    </g>
  );
}

/** Tippen schaltet ein Feld an und wieder aus. */
export function TapFigure() {
  return (
    <Frame label="Ein Tipper füllt ein einzelnes Feld und leert es wieder">
      <rect className="tut-fill f-tap" x={colX(1)} y={rowY(1)} width={CW} height={CH} rx="2" />
      <Dot x={midX(1)} y={midY(1)} className="d-tap" />
    </Frame>
  );
}

/** Halten, dann ziehen: ein Rechteck aus 3x3 Feldern. */
export function DragFigure() {
  return (
    <Frame label="Gedrückt halten und ziehen füllt einen ganzen Block">
      {rows.slice(0, 3).map((row) =>
        cols.map((col) => (
          <rect
            key={`${row}-${col}`}
            className="tut-fill f-drag"
            style={{ "--i": row * COLS + col } as CSSProperties}
            x={colX(col)}
            y={rowY(row)}
            width={CW}
            height={CH}
            rx="2"
          />
        )),
      )}
      <Dot x={midX(0)} y={midY(0)} className="d-drag" />
    </Frame>
  );
}

/** Tippen auf den Tag in der Kopfzeile wählt die ganze Spalte. */
export function DayFigure() {
  return (
    <Frame label="Ein Tipper auf den Tag in der Kopfzeile füllt die ganze Spalte">
      {rows.map((row) => (
        <rect
          key={row}
          className="tut-fill f-day"
          style={{ "--i": row } as CSSProperties}
          x={colX(1)}
          y={rowY(row)}
          width={CW}
          height={CH}
          rx="2"
        />
      ))}
      <rect className="tut-head-on" x={colX(1)} y={HEAD_Y} width={CW} height={HEAD_H} rx="2" />
      <Dot x={midX(1)} y={HEAD_Y + HEAD_H / 2} className="d-day" />
    </Frame>
  );
}
