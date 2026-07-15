// _shared/shop-hours.ts — horario del shop ESTRUCTURADO (fuente única).
// hours = { mon:{open:"08:30",close:"21:00"}, ..., sun:{...} } — día ausente/null = cerrado.
// Sirve para (a) respetar el horario (¿abierto AHORA?) y (b) decirlo (formateo a lenguaje natural).

import { formatInTimeZone } from "https://esm.sh/date-fns-tz@3.2.0";

export interface DayHours { open: string; close: string } // "HH:mm" 24h, zero-padded
export type WeekHours = Record<string, DayHours | null>;

const ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const NAME: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

/** ¿El shop está abierto en `at` (o ahora), según su horario y timezone? Sin horario → true (fail-open). */
export function isShopOpen(hours: WeekHours | null | undefined, timezone: string, at?: Date): boolean {
  if (!hours || Object.keys(hours).length === 0) return true; // sin config → no bloquear
  const now = at ?? new Date();
  const dayKey = formatInTimeZone(now, timezone, "EEE").toLowerCase(); // "mon".."sun"
  const hhmm = formatInTimeZone(now, timezone, "HH:mm");               // "20:30"
  const dh = hours[dayKey];
  if (!dh || !dh.open || !dh.close) return false; // cerrado ese día
  return hhmm >= dh.open && hhmm < dh.close;      // "HH:mm" zero-padded → compara bien como string
}

function to12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
const same = (a: DayHours | null | undefined, b: DayHours) => !!a && a.open === b.open && a.close === b.close;

/** Formatea el horario a inglés natural (Julie lo traduce/dice). Agrupa días consecutivos iguales. */
export function hoursForSpeech(hours: WeekHours | null | undefined): string {
  if (!hours) return "";
  const groups: string[] = [];
  let i = 0;
  while (i < 7) {
    const dh = hours[ORDER[i]];
    if (!dh || !dh.open || !dh.close) { i++; continue; }
    let j = i;
    while (j + 1 < 7 && same(hours[ORDER[j + 1]], dh)) j++;
    const label = i === j ? NAME[ORDER[i]] : `${NAME[ORDER[i]]} to ${NAME[ORDER[j]]}`;
    groups.push(`${label}: ${to12(dh.open)} to ${to12(dh.close)}`);
    i = j + 1;
  }
  return groups.join(". ");
}
