import { describe, expect, it } from "vitest";
import type { Participant, Poll, Step } from "../../shared/types.ts";
import { bestRanges, cellsToSpans, planShifts, slotsOf, spanCells, tally } from "./grid.ts";

const poll = (step: Step, days = ["2026-11-12"], fromTime = "09:00", toTime = "13:00"): Poll => ({
  id: "x",
  title: "t",
  note: "",
  timezone: "Europe/Berlin",
  step,
  days,
  fromTime,
  toTime,
  allowMaybe: true,
  closedAt: null,
});

const person = (name: string, spans: Participant["spans"]): Participant => ({
  id: 1,
  name,
  locked: false,
  updatedAt: "",
  spans,
});

describe("slotsOf", () => {
  it("schneidet das Ende exklusiv ab", () => {
    expect(slotsOf(poll(60, ["2026-11-12"], "09:00", "12:00"))).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("laesst einen angebrochenen Rest weg", () => {
    // 11:00 wuerde bis 13:00 laufen und damit ueber das Ende hinausragen.
    expect(slotsOf(poll(120, ["2026-11-12"], "09:00", "12:00"))).toEqual(["09:00"]);
  });
});

describe("spanCells", () => {
  it("deckt ganze Felder als full aus", () => {
    const cells = spanCells([{ from: "2026-11-12T09:00", to: "2026-11-12T10:00", choice: "yes" }], poll(30), "yes");
    expect([...cells]).toEqual([
      ["2026-11-12T09:00", "full"],
      ["2026-11-12T09:30", "full"],
    ]);
  });

  it("markiert ein nur halb abgedecktes Feld als part", () => {
    const cells = spanCells([{ from: "2026-11-12T09:00", to: "2026-11-12T09:30", choice: "yes" }], poll(60), "yes");
    expect(cells.get("2026-11-12T09:00")).toBe("part");
  });

  it("addiert zwei Teilstuecke zu einem vollen Feld", () => {
    const cells = spanCells(
      [
        { from: "2026-11-12T09:00", to: "2026-11-12T09:15", choice: "yes" },
        { from: "2026-11-12T09:15", to: "2026-11-12T10:00", choice: "yes" },
      ],
      poll(60),
      "yes",
    );
    expect(cells.get("2026-11-12T09:00")).toBe("full");
  });

  it("ignoriert die andere Wahl", () => {
    const spans = [{ from: "2026-11-12T09:00", to: "2026-11-12T10:00", choice: "maybe" as const }];
    expect(spanCells(spans, poll(30), "yes").size).toBe(0);
    expect(spanCells(spans, poll(30), "maybe").size).toBe(2);
  });

  it("ueberlebt eine Taktaenderung nach der Antwort", () => {
    // Bei 120er-Takt geantwortet, spaeter auf 30 Minuten umgestellt.
    const spans = [{ from: "2026-11-12T09:00", to: "2026-11-12T11:00", choice: "yes" as const }];
    const cells = spanCells(spans, poll(30), "yes");
    expect(cells.size).toBe(4);
    expect([...cells.values()].every((c) => c === "full")).toBe(true);
  });
});

describe("cellsToSpans", () => {
  it("fasst benachbarte Felder zusammen und trennt bei Luecken", () => {
    const keys = ["2026-11-12T09:00", "2026-11-12T09:30", "2026-11-12T11:00"];
    expect(cellsToSpans(keys, poll(30), "yes")).toEqual([
      { from: "2026-11-12T09:00", to: "2026-11-12T10:00", choice: "yes" },
      { from: "2026-11-12T11:00", to: "2026-11-12T11:30", choice: "yes" },
    ]);
  });

  it("trennt ueber Tagesgrenzen", () => {
    const keys = ["2026-11-13T09:00", "2026-11-12T09:00"];
    const spans = cellsToSpans(keys, poll(30, ["2026-11-12", "2026-11-13"]), "yes");
    expect(spans.map((s) => s.from)).toEqual(["2026-11-12T09:00", "2026-11-13T09:00"]);
  });

  it("ist die Umkehrung von spanCells", () => {
    const p = poll(30, ["2026-11-12", "2026-11-13"]);
    const original = [
      { from: "2026-11-12T09:30", to: "2026-11-12T11:00", choice: "yes" as const },
      { from: "2026-11-13T12:00", to: "2026-11-13T13:00", choice: "yes" as const },
    ];
    expect(cellsToSpans(spanCells(original, p, "yes").keys(), p, "yes")).toEqual(original);
  });
});

describe("tally", () => {
  it("zaehlt ja und vielleicht getrennt", () => {
    const counts = tally(poll(60), [
      person("Anna", [{ from: "2026-11-12T09:00", to: "2026-11-12T11:00", choice: "yes" }]),
      person("Bo", [{ from: "2026-11-12T10:00", to: "2026-11-12T11:00", choice: "maybe" }]),
    ]);
    expect(counts.get("2026-11-12T09:00")).toEqual({ yes: ["Anna"], maybe: [] });
    expect(counts.get("2026-11-12T10:00")).toEqual({ yes: ["Anna"], maybe: ["Bo"] });
  });

  it("zaehlt eine Person pro Feld nur einmal", () => {
    const counts = tally(poll(60), [
      person("Anna", [
        { from: "2026-11-12T09:00", to: "2026-11-12T10:00", choice: "yes" },
        { from: "2026-11-12T09:00", to: "2026-11-12T10:00", choice: "maybe" },
      ]),
    ]);
    expect(counts.get("2026-11-12T09:00")).toEqual({ yes: ["Anna"], maybe: [] });
  });
});

describe("bestRanges", () => {
  const people = [
    person("Anna", [{ from: "2026-11-12T09:00", to: "2026-11-12T12:00", choice: "yes" }]),
    person("Bo", [{ from: "2026-11-12T10:00", to: "2026-11-12T12:00", choice: "yes" }]),
    person("Cem", [{ from: "2026-11-12T11:00", to: "2026-11-12T12:00", choice: "yes" }]),
  ];

  it("verschmilzt gleich besetzte Nachbarfelder zu einem Fenster", () => {
    const [best] = bestRanges(poll(60), people, 1);
    expect(best).toMatchObject({ from: "11:00", to: "12:00", yes: ["Anna", "Bo", "Cem"], missing: [] });
  });

  it("nennt die Fehlenden", () => {
    const ranges = bestRanges(poll(60), people, 3);
    expect(ranges[1]).toMatchObject({ from: "10:00", to: "11:00", missing: ["Cem"] });
    expect(ranges[2]).toMatchObject({ from: "09:00", to: "10:00", missing: ["Bo", "Cem"] });
  });

  it("liefert nichts, wenn niemand geantwortet hat", () => {
    expect(bestRanges(poll(60), [])).toEqual([]);
  });
});

describe("planShifts", () => {
  const p = poll(60, ["2026-11-12", "2026-11-13"], "09:00", "13:00");
  const yes = (day: string, from: string, to: string) => ({ from: `${day}T${from}`, to: `${day}T${to}`, choice: "yes" as const });
  const d0 = "2026-11-12";
  const d1 = "2026-11-13";

  it("teilt zwei getrennte Gruppen in zwei Schichten ein", () => {
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "10:00")]),
        person("Bo", [yes(d0, "09:00", "10:00")]),
        person("Cem", [yes(d1, "11:00", "12:00")]),
        person("Dilan", [yes(d1, "11:00", "12:00")]),
      ],
      2,
    );
    expect(plan.shifts).toHaveLength(2);
    expect(plan.shifts.flatMap((s) => s.crew).sort()).toEqual(["Anna", "Bo", "Cem", "Dilan"]);
    expect(plan.unplaceable).toEqual([]);
  });

  it("bedient zuerst den, der am wenigsten Zeit hat", () => {
    // Cem kann nur einmal. Wer nach dem vollsten Fenster ginge, liesse ihn uebrig.
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "13:00")]),
        person("Bo", [yes(d0, "09:00", "13:00")]),
        person("Cem", [yes(d0, "12:00", "13:00")]),
      ],
      2,
    );
    expect(plan.shifts).toHaveLength(1);
    expect(plan.shifts[0]).toMatchObject({ from: "12:00", to: "13:00", crew: ["Anna", "Bo", "Cem"] });
  });

  it("zieht eine Schicht ueber das Fenster, in dem dieselben koennen", () => {
    const plan = planShifts(
      p,
      [person("Anna", [yes(d0, "09:00", "12:00")]), person("Bo", [yes(d0, "09:00", "12:00")])],
      2,
    );
    expect(plan.shifts[0]).toMatchObject({ from: "09:00", to: "12:00" });
  });

  it("fuellt bis zur Mindestzahl mit jemandem auf, der schon eingeteilt ist", () => {
    // Cem kann nur, wenn ausser ihm nur Anna kann — Anna macht also zwei Dienste.
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "11:00")]),
        person("Bo", [yes(d0, "09:00", "10:00")]),
        person("Cem", [yes(d0, "10:00", "11:00")]),
      ],
      2,
    );
    expect(plan.shifts).toHaveLength(2);
    expect(plan.shifts.every((s) => s.crew.length >= 2)).toBe(true);
    expect(plan.shifts.flatMap((s) => s.crew).filter((n) => n === "Anna")).toHaveLength(2);
    expect(new Set(plan.shifts.flatMap((s) => s.crew))).toEqual(new Set(["Anna", "Bo", "Cem"]));
  });

  it("teilt niemanden zweimal ein, solange es nicht noetig ist", () => {
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "13:00")]),
        person("Bo", [yes(d0, "09:00", "13:00")]),
        person("Cem", [yes(d1, "09:00", "13:00")]),
        person("Dilan", [yes(d1, "09:00", "13:00")]),
      ],
      2,
    );
    const crews = plan.shifts.flatMap((s) => s.crew);
    expect(crews).toHaveLength(new Set(crews).size);
  });

  it("nennt als Ersatz, wer auch koennte, aber schon woanders steht", () => {
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "11:00")]),
        person("Bo", [yes(d0, "09:00", "10:00")]),
        person("Cem", [yes(d0, "10:00", "11:00")]),
      ],
      2,
    );
    // In der zweiten Schicht stehen Anna und Cem; Bo kann dann nicht.
    expect(plan.shifts[1].standby).toEqual([]);
    // In der ersten koennen nur Anna und Bo, beide stehen drin.
    expect(plan.shifts[0].standby).toEqual([]);
  });

  it("meldet, wen die Mindestzahl ausschliesst", () => {
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "10:00")]),
        person("Bo", [yes(d0, "09:00", "10:00")]),
        person("Cem", [yes(d1, "09:00", "10:00")]),
      ],
      2,
    );
    expect(plan.shifts).toHaveLength(1);
    expect(plan.unplaceable).toEqual(["Cem"]);
  });

  it("zaehlt Vielleicht nicht als Zusage", () => {
    const plan = planShifts(
      p,
      [
        person("Anna", [yes(d0, "09:00", "10:00")]),
        person("Bo", [{ from: `${d0}T09:00`, to: `${d0}T10:00`, choice: "maybe" }]),
      ],
      2,
    );
    expect(plan.shifts).toEqual([]);
    expect(plan.unplaceable).toEqual(["Anna"]);
  });

  it("liefert nichts, wenn niemand geantwortet hat", () => {
    expect(planShifts(p, [], 2)).toEqual({ shifts: [], unplaceable: [] });
  });
});
