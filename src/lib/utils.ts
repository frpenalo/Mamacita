import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Fecha+hora de pared en una zona ("2026-10-21", "09:00", "America/New_York") → instante UTC.
 *  Respeta el horario de verano (un offset fijo como -05:00 queda 1 h corrido de mar a nov). */
export function zonedTimeToUtc(date: string, time: string, timeZone: string): Date {
  const asUtc = new Date(`${date}T${time}:00Z`);
  const offsetMs = (d: Date) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(d).map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime();
  };
  const first = new Date(asUtc.getTime() - offsetMs(asUtc));
  return new Date(asUtc.getTime() - offsetMs(first));
}
