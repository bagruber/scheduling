// Der Tagesschluessel ist ein reiner Kalendertag. Zum Formatieren wird er auf
// 12 Uhr gesetzt, damit keine Zeitzonenverschiebung ihn auf den Vortag kippt.
const atNoon = (day: string) => new Date(`${day}T12:00:00`);

const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const shortDate = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric" });
const longDate = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

export const dayWeekday = (day: string) => weekday.format(atNoon(day)).replace(".", "");
export const dayShort = (day: string) => shortDate.format(atNoon(day));
export const dayLong = (day: string) => longDate.format(atNoon(day));

export const isWeekend = (day: string) => [0, 6].includes(atNoon(day).getDay());

/** "gerade eben", "vor 3 Min.", sonst Uhrzeit oder Datum. */
export function since(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "gerade eben";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const stamp = new Date(iso);
  const sameDay = stamp.toDateString() === new Date().toDateString();
  return sameDay
    ? stamp.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : stamp.toLocaleDateString("de-DE", { day: "numeric", month: "numeric" });
}

/** Aufzaehlung mit "und" vor dem letzten Namen. */
export function joinNames(names: string[]): string {
  if (names.length === 0) return "niemand";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

/** Die naechsten n Tage ab heute als Tagesschluessel. */
export function nextDays(count: number, offset = 0): string[] {
  const out: string[] = [];
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  for (let i = offset; i < offset + count; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    out.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}
