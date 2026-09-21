import { describe, expect, it } from "vitest";
import type { Participant, Poll } from "../../shared/types.ts";
import type { DrawnShift } from "./grid.ts";
import { staffShifts } from "./grid.ts";
import { rosterCsv, rosterFilename } from "./export.ts";

const poll: Poll = {
  id: "x",
  title: "Standdienst Wochenmarkt",
  note: "",
  timezone: "Europe/Berlin",
  step: 60,
  days: ["2026-11-12"],
  fromTime: "09:00",
  toTime: "13:00",
  allowMaybe: false,
  closedAt: null,
};

const person = (name: string, from: string, to: string): Participant => ({
  id: 1,
  name,
  locked: false,
  updatedAt: "",
  spans: [{ from: `2026-11-12T${from}`, to: `2026-11-12T${to}`, choice: "yes" }],
});

const shift: DrawnShift = { day: "2026-11-12", from: "09:00", to: "12:00", min: 2 };

describe("rosterCsv", () => {
  // Anna kann durchgehend, Bo nur bis 11 — die dritte Stunde ist unterbesetzt.
  const staffed = staffShifts(poll, [person("Anna", "09:00", "12:00"), person("Bo", "09:00", "11:00")], [shift]);
  const zeilen = rosterCsv(poll, staffed).replace("\ufeff", "").trim().split("\r\n");

  it("führt zwei Kopfzeilen: grob je Schicht, fein je Stunde", () => {
    expect(zeilen[0]).toBe("Schicht;Do 12.11. 09:00–12:00;Do 12.11. 09:00–12:00;Do 12.11. 09:00–12:00");
    expect(zeilen[1]).toBe("Person;09:00–10:00;10:00–11:00;11:00–12:00;Stunden");
  });

  it("kreuzt nur die Stunden an, in denen jemand eingeteilt ist", () => {
    expect(zeilen[2]).toBe("Anna;x;x;x;3");
    expect(zeilen[3]).toBe("Bo;x;x;;2");
  });

  it("zeigt Besetzung und Mindestzahl je Stunde", () => {
    expect(zeilen[4]).toBe("Besetzt;2;2;1");
    expect(zeilen[5]).toBe("Mindestens;2;2;2");
  });

  it("beginnt mit einem BOM, damit Excel die Umlaute erkennt", () => {
    expect(rosterCsv(poll, staffed).startsWith("\ufeff")).toBe(true);
  });

  it("schützt Semikolons im Namen", () => {
    const eigen = staffShifts(
      poll,
      [person("Meier; Anna", "09:00", "12:00"), person("Bo", "09:00", "12:00")],
      [shift],
    );
    expect(rosterCsv(poll, eigen)).toContain('"Meier; Anna"');
  });

  it("liefert ohne Schichten nur die Kopfzeilen", () => {
    const leer = rosterCsv(poll, []).replace("\ufeff", "").trim().split("\r\n");
    expect(leer).toEqual(["Schicht", "Person;Stunden", "Besetzt", "Mindestens"]);
  });
});

describe("rosterFilename", () => {
  it("macht aus dem Titel einen brauchbaren Dateinamen", () => {
    expect(rosterFilename(poll)).toBe("standdienst-wochenmarkt-schichten.csv");
    expect(rosterFilename({ ...poll, title: "Grünanlage & Co." })).toBe("gruenanlage-co-schichten.csv");
  });
});
