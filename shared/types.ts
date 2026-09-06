// Zeitpunkte sind ueberall Strings der Form "YYYY-MM-DDTHH:MM" in der Zeitzone
// des Termins. Es wird nie umgerechnet, deshalb braucht weder Server noch
// Client Datumsarithmetik — Vergleiche sind lexikographisch korrekt.

export type Step = 15 | 30 | 60 | 120;
export const STEPS: Step[] = [15, 30, 60, 120];

export type Choice = "yes" | "maybe";

export type Poll = {
  id: string;
  title: string;
  note: string;
  timezone: string;
  step: Step;
  days: string[]; // "YYYY-MM-DD", aufsteigend
  fromTime: string; // "HH:MM"
  toTime: string; // "HH:MM", exklusiv
  allowMaybe: boolean;
  closedAt: string | null;
};

// "to" ist exklusiv. Ein Zeitraum liegt immer innerhalb eines Tages.
export type Span = { from: string; to: string; choice: Choice };

export type Participant = {
  id: number;
  name: string;
  locked: boolean; // mit Kennwort geschuetzt
  updatedAt: string;
  spans: Span[];
};

export type PollView = { poll: Poll; participants: Participant[] };

export type NewPoll = {
  title: string;
  note: string;
  timezone: string;
  step: Step;
  days: string[];
  fromTime: string;
  toTime: string;
  allowMaybe: boolean;
};

export type SaveEntry = {
  name: string;
  password: string | null;
  spans: Span[];
};
