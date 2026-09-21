import type { Poll } from "../../shared/types.ts";
import type { StaffedShift } from "./grid.ts";
import { slotsOf, toClock, toMinutes } from "./grid.ts";
import { dayShort, dayWeekday } from "./format.ts";

/**
 * Semikolon statt Komma und ein BOM voran: so oeffnet Excel in deutscher
 * Einstellung die Datei direkt als Tabelle, ohne Importdialog. Ein echtes
 * .xlsx waere ein ZIP aus XML und braeuchte eine Bibliothek — siehe
 * OFFENE-PUNKTE.md.
 */
const SEPARATOR = ";";
const BREAK = "\r\n";

const cell = (value: string) =>
  /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const row = (values: string[]) => values.map(cell).join(SEPARATOR);

const hours = (value: number) => value.toLocaleString("de-DE", { maximumFractionDigits: 2 });

/**
 * Die Schichteinteilung als Matrix: Spalten sind die Stunden, gruppiert unter
 * ihrer Schicht, Zeilen die eingeteilten Personen. Ein "x" heisst eingeteilt.
 *
 * Zwei Kopfzeilen, weil beide Ebenen gebraucht werden — die grobe, um zu sehen
 * welche Schicht gemeint ist, und die feine, um Luecken innerhalb einer Schicht
 * zu erkennen.
 */
export function rosterCsv(poll: Poll, shifts: StaffedShift[]): string {
  const slots = slotsOf(poll);
  const columns = shifts.flatMap((shift) =>
    slots
      .filter((time) => toMinutes(time) >= toMinutes(shift.from) && toMinutes(time) < toMinutes(shift.to))
      .map((time) => ({ shift, from: time, to: toClock(toMinutes(time) + poll.step) })),
  );

  const label = (shift: StaffedShift) =>
    `${dayWeekday(shift.day)} ${dayShort(shift.day)} ${shift.from}–${shift.to}`;

  const onDuty = (column: (typeof columns)[number], name: string) =>
    column.shift.duties.some(
      (duty) =>
        duty.name === name &&
        toMinutes(duty.from) <= toMinutes(column.from) &&
        toMinutes(duty.to) >= toMinutes(column.to),
    );

  const people = [...new Set(shifts.flatMap((shift) => shift.duties.map((duty) => duty.name)))].sort((a, b) =>
    a.localeCompare(b, "de"),
  );

  const lines = [
    row(["Schicht", ...columns.map((column) => label(column.shift))]),
    row(["Person", ...columns.map((column) => `${column.from}–${column.to}`), "Stunden"]),
  ];

  for (const name of people) {
    const total = shifts
      .flatMap((shift) => shift.duties)
      .filter((duty) => duty.name === name)
      .reduce((sum, duty) => sum + (toMinutes(duty.to) - toMinutes(duty.from)) / 60, 0);
    lines.push(row([name, ...columns.map((column) => (onDuty(column, name) ? "x" : "")), hours(total)]));
  }

  lines.push(
    row([
      "Besetzt",
      ...columns.map((column) => String(people.filter((name) => onDuty(column, name)).length)),
    ]),
  );
  lines.push(row(["Mindestens", ...columns.map((column) => String(column.shift.min))]));

  return `﻿${lines.join(BREAK)}${BREAK}`;
}

/** Dateiname ohne alles, was Betriebssysteme nicht mögen. */
export function rosterFilename(poll: Poll): string {
  const stem = poll.title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${stem || "termin"}-schichten.csv`;
}
