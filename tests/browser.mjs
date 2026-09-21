// Browsertests gegen den gebauten Stand. Nicht Teil von `pnpm test`, weil
// Playwright hier keine Abhaengigkeit ist — siehe OFFENE-PUNKTE.md.
//
//   pnpm build
//   PORT=8099 DATA_DIR=./data node server/index.ts &
//   node tests/browser.mjs
//
// Playwright wird dort gesucht, wo es liegt: als eigene Abhaengigkeit, oder
// ueber PLAYWRIGHT_FROM=<pfad zu einem repo, das es hat>.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const from = process.env.PLAYWRIGHT_FROM;
    if (!from) {
      console.error(
        "Playwright nicht gefunden. Entweder installieren, oder den Pfad zu einem\n" +
          "Repo angeben, das es hat:  PLAYWRIGHT_FROM=../etymology node tests/browser.mjs",
      );
      process.exit(2);
    }
    return createRequire(pathToFileURL(`${from}/package.json`))("playwright");
  }
}

const { chromium } = await loadPlaywright();
const BASE = process.env.BASE ?? "http://localhost:8099";

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const api = (path, init) =>
  fetch(`${BASE}${path}`, { headers: { "content-type": "application/json" }, ...init });
const createPoll = (body) =>
  api("/api/polls", {
    method: "POST",
    body: JSON.stringify({ note: "", timezone: "Europe/Berlin", allowMaybe: false, ...body }),
  }).then((r) => r.json());
const putEntry = (id, body) => api(`/api/polls/${id}/entry`, { method: "PUT", body: JSON.stringify(body) });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
  locale: "de-DE",
  timezoneId: "Europe/Berlin",
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log("[pageerror]", error.message));

const cdp = await context.newCDPSession(page);
const finger = (x, y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }];
const touch = (type, x, y) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : finger(x, y) });

// dispatchTouchEvent erwartet Viewport-Koordinaten. boundingBox liefert sie erst,
// wenn das Element wirklich im Viewport liegt — sonst wird danebengetippt.
async function centre(key) {
  const element = page.locator(`[data-key="${key}"]`);
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  const spot = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-key]")?.dataset.key ?? null,
    [spot.x, spot.y],
  );
  if (hit !== key) throw new Error(`Treffer verfehlt: wollte ${key}, traf ${hit}`);
  return spot;
}

async function tap(key) {
  const spot = await centre(key);
  await touch("touchStart", spot.x, spot.y);
  await wait(60);
  await touch("touchEnd", spot.x, spot.y);
  await wait(200);
}

// --------------------------------------------------------------- Eintragen
const days = ["2026-11-12", "2026-11-13", "2026-11-14"];
const main = await createPoll({ title: "Vorstandssitzung", step: 30, days, fromTime: "09:00", toTime: "18:00", allowMaybe: true });

await page.goto(`${BASE}/e/${main.id}`);
await page.locator(".grid").waitFor();

const order = await page.locator("main > *").evaluateAll((nodes) => nodes.map((n) => n.className || n.tagName));
check(
  "Namensfeld vor dem Raster, Auswertung dahinter",
  order.indexOf("signin") < order.indexOf("grid-frame") && order.indexOf("grid-frame") < order.indexOf("people"),
  order.filter(Boolean).slice(0, 5).join(" → "),
);
check("Hilfe-Knopf erscheint erst beim Eintragen", (await page.getByRole("button", { name: "Hilfe zur Bedienung" }).count()) === 0);

await page.getByLabel("Dein Name").fill("Anna");
await page.getByRole("button", { name: "Verfügbarkeit eintragen" }).click();
await page.locator(".page.editing").waitFor();

const keys = await page.locator("[data-key]").evaluateAll((nodes) => nodes.map((n) => n.dataset.key));
check("Raster gerendert", keys.length === days.length * 18, `${keys.length} Felder`);
check("Endzeit steht unter dem Raster", (await page.locator(".grid-end").innerText()).trim() === "18:00");

const countYes = () => page.locator(".cell.is-yes").count();

await tap(keys[3]);
check("Tippen schaltet ein Feld", (await countYes()) === 1);
await tap(keys[3]);
check("Erneutes Tippen radiert", (await countYes()) === 0);

// Halten und ziehen: Rechteck ueber drei Tage und vier Zeilen
const from = await centre(keys[0]);
const to = await centre(keys[11]);
await touch("touchStart", from.x, from.y);
await wait(400);
check("Langes Drücken quittiert sichtbar", (await page.locator(".cell.is-anchor").count()) === 1);
for (let i = 1; i <= 8; i += 1) {
  await touch("touchMove", from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await wait(15);
}
await touch("touchEnd", to.x, to.y);
await wait(250);
check("Halten und ziehen malt ein Rechteck", (await countYes()) === 12, `${await countYes()} von 12`);

await page.locator(".grid-day.is-button").first().click();
await wait(300);
check("Tageskopf wählt den ganzen Tag", (await countYes()) === 26, `${await countYes()}`);
await page.getByRole("button", { name: "Rückgängig" }).click();
await wait(300);
check("Rückgängig stellt den Stand davor her", (await countYes()) === 12);

await page.getByRole("button", { name: "Hilfe zur Bedienung" }).click();
await wait(200);
const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
check(
  "Hilfe-Modal zeigt drei laufende Anleitungen",
  (await page.locator("dialog.help svg.tut").count()) === 3 && running > 0,
  `${running} Animationen`,
);
await page.locator("dialog.help").getByRole("button", { name: "Schließen" }).click();

await page.getByText("gespeichert", { exact: true }).waitFor({ timeout: 5000 });
check("Autosave meldet gespeichert", true);
await page.getByRole("button", { name: "Fertig" }).click();

// ------------------------------------------------------- Ansicht und Namen
await putEntry(main.id, { name: "Bo", password: "geheim", spans: [{ from: `${days[1]}T10:00`, to: `${days[1]}T14:00`, choice: "yes" }] });
await page.goto(`${BASE}/e/${main.id}`);
await page.locator(".grid").waitFor();

const filled = () =>
  page.locator(".cell").evaluateAll((cells) => cells.filter((c) => (c.style.getPropertyValue("--fill") || "0") !== "0").length);
check("Antworten anderer sind standardmäßig ausgeblendet", (await filled()) === 0);

await page.getByRole("button", { name: /^Bo/ }).click();
await wait(300);
check(
  "Ein angetippter Name zeigt dessen Zeiten",
  (await page.locator(".cell.is-yes").count()) === 8 && (await page.locator(".grid-bar").innerText()).includes("Bo"),
  `${await page.locator(".cell.is-yes").count()} Felder`,
);
await page.getByRole("button", { name: "Alle zeigen" }).click();
await wait(300);
check("Alle zeigen räumt die Personenansicht weg", (await page.locator(".cell.is-yes").count()) === 0);

await page.getByLabel("Antworten anderer zeigen").check();
await wait(200);
check("Toggle blendet die Auszählung ein", (await filled()) > 0);

// ------------------------------------------------------------- Auswertung
check("Ein Termin ist die Voreinstellung", (await page.locator(".best ol li").count()) > 0);
await page.getByRole("button", { name: "Mehrere Schichten" }).click();
await wait(300);
const shifts = await page.locator(".best ol li").count();
check("Schichtplan wird berechnet", shifts > 0, `${shifts} Schichten`);
const covered = (await page.locator(".best ol").innerText()).includes("Bo");
check("Der Schichtplan nennt die Beteiligten", covered);
// Eigener Termin, an dem die Mindestzahl nachweislich etwas aendert: Anna und
// Bo ueberschneiden sich, Cem kann nur allein.
const cover = await createPoll({ title: "Schichten", step: 60, days, fromTime: "09:00", toTime: "12:00" });
await putEntry(cover.id, { name: "Anna", spans: [{ from: `${days[0]}T09:00`, to: `${days[0]}T10:00`, choice: "yes" }] });
await putEntry(cover.id, { name: "Bo", spans: [{ from: `${days[0]}T09:00`, to: `${days[0]}T10:00`, choice: "yes" }] });
await putEntry(cover.id, { name: "Cem", spans: [{ from: `${days[1]}T09:00`, to: `${days[1]}T10:00`, choice: "yes" }] });
await page.goto(`${BASE}/e/${cover.id}`);
await page.locator(".grid").waitFor();
await page.getByRole("button", { name: "Mehrere Schichten" }).click();
await wait(300);

await page.getByLabel("Mindestzahl an Personen je Schicht").selectOption("1");
await wait(300);
check(
  "Mindestzahl 1 bringt alle unter",
  (await page.locator(".best ol li").count()) === 2 && !(await page.locator(".best").innerText()).includes("Kommt in keiner"),
  `${await page.locator(".best ol li").count()} Schichten`,
);

await page.getByLabel("Mindestzahl an Personen je Schicht").selectOption("2");
await wait(300);
const text = await page.locator(".best").innerText();
check(
  "Mindestzahl 2 schließt den Einzelnen aus",
  (await page.locator(".best ol li").count()) === 1 && text.includes("Kommt in keiner Schicht unter") && text.includes("Cem"),
  text.replace(/\s+/g, " ").slice(-70),
);

check("Einteilung wird zusammengefasst", (await page.locator(".best").innerText()).includes("eingeteilt"));

// Die Hauptansicht mit der Heatmap bleibt neben der Schichtansicht bestehen.
await page.getByLabel("Antworten anderer zeigen").check();
await wait(300);
check(
  "Heatmap laeuft neben der Schichtansicht weiter",
  (await filled()) > 0 && (await page.locator(".best ol li").count()) > 0,
  `${await filled()} gefüllte Felder`,
);

await page.getByRole("button", { name: /^Cem/ }).click();
await wait(300);
const duringFocus = await filled();
await page.getByRole("button", { name: "Alle zeigen" }).click();
await wait(300);
check(
  "Nach der Personenansicht ist die Heatmap wieder da",
  duringFocus === 0 && (await filled()) > 0,
  `waehrend ${duringFocus}, danach ${await filled()}`,
);


// Die Anzahl der Schichten steht nicht vorab fest: gezeigt wird, was noetig
// ist, damit jeder einmal dran war — der Rest laesst sich nachladen.
const more = await createPoll({ title: "Nachladen", step: 60, days, fromTime: "09:00", toTime: "12:00" });
for (const name of ["Anna", "Bo"]) {
  await putEntry(more.id, {
    name,
    spans: [
      { from: `${days[0]}T09:00`, to: `${days[0]}T11:00`, choice: "yes" },
      { from: `${days[1]}T09:00`, to: `${days[1]}T11:00`, choice: "yes" },
    ],
  });
}
await page.goto(`${BASE}/e/${more.id}`);
await page.locator(".grid").waitFor();
await page.getByRole("button", { name: "Mehrere Schichten" }).click();
await wait(300);
const first = await page.locator(".best ol li").count();
check("Zuerst nur so viele Schichten wie nötig", first === 1, `${first} Schichten`);
check("Nachladen wird angeboten", (await page.getByRole("button", { name: "Weitere Schicht laden" }).count()) === 1);

await page.getByRole("button", { name: "Weitere Schicht laden" }).click();
await wait(300);
check("Weitere Schicht wird nachgeladen", (await page.locator(".best ol li").count()) === first + 1);
check(
  "Ist alles geladen, verschwindet der Knopf",
  (await page.getByRole("button", { name: "Weitere Schicht laden" }).count()) === 0,
);

await page.goto(`${BASE}/e/${main.id}`);
await page.locator(".grid").waitFor();

// ------------------------------------------------- Kennwort und Scrollen
await page.getByLabel("Dein Name").fill("bo");
await wait(200);
check("Geschützter Name wird ausgewiesen", (await page.locator(".signin .notice.is-locked").count()) === 1);
await page.getByRole("button", { name: "Eintrag ändern" }).click();
await page.locator(".page.editing").waitFor();
await page.locator(`[data-key="${keys[8]}"]`).tap();
await page.locator(".error").waitFor({ timeout: 5000 });
check("Geschützter Eintrag ist ohne Kennwort gesperrt", (await page.locator(".error").innerText()).includes("Kennwort"));

// Passt das Raster ganz, muss der Wisch darueber die Seite bewegen.
const short = await createPoll({ title: "Kurz", step: 60, days, fromTime: "09:00", toTime: "13:00" });
for (const name of ["Anna", "Bo", "Cem"]) {
  await putEntry(short.id, { name, spans: [{ from: `${days[1]}T10:00`, to: `${days[1]}T12:00`, choice: "yes" }] });
}
await page.goto(`${BASE}/e/${short.id}`);
await page.locator(".grid").waitFor();
await wait(300);
const box = await page.locator(".grid-scroll").boundingBox();
await touch("touchStart", box.x + box.width / 2, box.y + box.height / 2);
for (let i = 1; i <= 8; i += 1) await touch("touchMove", box.x + box.width / 2, box.y + box.height / 2 - (180 * i) / 8);
await touch("touchEnd", box.x + box.width / 2, box.y + box.height / 2 - 180);
await wait(500);
check("Wisch über dem Raster scrollt die Seite", (await page.evaluate(() => Math.round(window.scrollY))) > 40);

// Im Eintragen-Modus muss ein zu hohes Raster in sich scrollen.
const tall = await createPoll({ title: "Lang", step: 15, days, fromTime: "08:00", toTime: "20:00" });
await page.goto(`${BASE}/e/${tall.id}`);
await page.getByLabel("Dein Name").fill("Anna");
await page.getByRole("button", { name: "Verfügbarkeit eintragen" }).click();
await page.locator(".page.editing").waitFor();
await wait(300);
const overflow = await page.locator(".grid-scroll").evaluate((n) => n.scrollHeight - n.clientHeight);
check("Hohes Raster scrollt im Eintragen-Modus in sich", overflow > 100, `Überlauf ${overflow}px`);

await browser.close();

// ---------------------------------------------------- Kopfzeilen und Bremse
const pollPage = await fetch(`${BASE}/e/zzzzzzzz`);
check("Terminseiten stehen auf noindex", (pollPage.headers.get("x-robots-tag") ?? "").includes("noindex"));
check("Startseite bleibt indexierbar", (await fetch(BASE)).headers.get("x-robots-tag") === null);
const overTls = await fetch(BASE, { headers: { "x-forwarded-proto": "https" } });
check("Hinter TLS wird HSTS gesetzt", (overTls.headers.get("strict-transport-security") ?? "").includes("max-age"));
check("robots.txt sperrt /e/", (await (await fetch(`${BASE}/robots.txt`)).text()).includes("Disallow: /e/"));

const guard = await createPoll({ title: "Bremse", step: 60, days: [days[0]], fromTime: "09:00", toTime: "12:00" });
await putEntry(guard.id, { name: "Lea", password: "richtig", spans: [] });
let attempt;
for (let i = 0; i < 11; i += 1) {
  attempt = await putEntry(guard.id, { name: "Lea", password: "falsch", spans: [] });
}
check(
  "Kennwortraten wird nach 10 Fehlversuchen gebremst",
  attempt.status === 429 && Number(attempt.headers.get("retry-after")) > 0,
  `status ${attempt.status}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
process.exit(failed.length === 0 ? 0 : 1);
