// Kennwortversuche begrenzen. Gezaehlt werden nur Fehlversuche, richtige
// Eingaben setzen den Zaehler zurueck — normales Benutzen laeuft also nie
// gegen die Grenze.
//
// Der Schluessel ist IP plus Zieleintrag, nicht die IP allein: hinter einem
// gemeinsamen Anschluss soll nicht die ganze Gruppe gesperrt werden, weil
// eine Person ihr Kennwort vergessen hat.
//
// Das haelt Raten gegen einen bestimmten Eintrag auf. Gegen viele Rechner
// gleichzeitig hilft es nicht — dafuer ist ein Terminraster das falsche Ziel.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; until: number }>();

function prune(now: number) {
  for (const [key, entry] of failures) if (entry.until <= now) failures.delete(key);
}

/** Sekunden bis zum naechsten erlaubten Versuch, oder 0 wenn frei. */
export function retryAfter(key: string): number {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || entry.until <= now) return 0;
  return entry.count >= MAX_FAILURES ? Math.ceil((entry.until - now) / 1000) : 0;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  prune(now);
  const entry = failures.get(key);
  if (entry && entry.until > now) entry.count += 1;
  else failures.set(key, { count: 1, until: now + WINDOW_MS });
}

export function recordSuccess(key: string): void {
  failures.delete(key);
}

/**
 * Hinter dem Coolify-Proxy steht die echte Adresse in x-forwarded-for. Das ist
 * nur vertrauenswuerdig, weil der Container nicht direkt erreichbar ist —
 * ohne Proxy davor koennte der Header frei gesetzt werden.
 */
export function clientIp(forwardedFor: string | string[] | undefined, remote: string | undefined): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return (header ?? "").split(",")[0].trim() || remote || "unbekannt";
}
