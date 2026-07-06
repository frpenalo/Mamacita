import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

export interface DaySchedule { enabled: boolean; start: string; end: string; }
export type WeekSchedule = Record<string, DaySchedule>;

export const SCHEDULE_DAYS = [
  { id: 'lun', label: 'Lunes' },
  { id: 'mar', label: 'Martes' },
  { id: 'mie', label: 'Miércoles' },
  { id: 'jue', label: 'Jueves' },
  { id: 'vie', label: 'Viernes' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

export function emptySchedule(): WeekSchedule {
  const s: WeekSchedule = {};
  for (const d of SCHEDULE_DAYS) s[d.id] = { enabled: false, start: '09:00', end: '18:00' };
  return s;
}

/** Arma el schedule desde el barbero: working_hours (por día) o legacy (working_days + fijo). */
export function scheduleFromBarber(barber: any): WeekSchedule {
  const s = emptySchedule();
  const wh = barber?.working_hours;
  if (wh && typeof wh === 'object' && Object.keys(wh).length > 0) {
    for (const d of SCHEDULE_DAYS) {
      const dh = wh[d.id];
      if (dh && dh.start && dh.end) s[d.id] = { enabled: true, start: String(dh.start).slice(0, 5), end: String(dh.end).slice(0, 5) };
    }
    return s;
  }
  const start = (barber?.working_hours_start || '09:00').slice(0, 5);
  const end = (barber?.working_hours_end || '18:00').slice(0, 5);
  const days: string[] = barber?.working_days || [];
  for (const d of SCHEDULE_DAYS) s[d.id] = { enabled: days.includes(d.id), start, end };
  return s;
}

/** Deriva los campos a guardar en `barbers` (nuevo working_hours + legacy para compat). */
export function barberFieldsFromSchedule(schedule: WeekSchedule) {
  const working_hours: Record<string, { start: string; end: string }> = {};
  const working_days: string[] = [];
  let minStart: string | null = null;
  let maxEnd: string | null = null;
  for (const d of SCHEDULE_DAYS) {
    const ds = schedule[d.id];
    if (ds?.enabled && ds.start && ds.end) {
      working_hours[d.id] = { start: ds.start, end: ds.end };
      working_days.push(d.id);
      if (!minStart || ds.start < minStart) minStart = ds.start;
      if (!maxEnd || ds.end > maxEnd) maxEnd = ds.end;
    }
  }
  return { working_hours, working_days, working_hours_start: minStart || '09:00', working_hours_end: maxEnd || '18:00' };
}

interface Props { value: WeekSchedule; onChange: (v: WeekSchedule) => void; }

export default function WeeklyScheduleEditor({ value, onChange }: Props) {
  const set = (id: string, patch: Partial<DaySchedule>) =>
    onChange({ ...value, [id]: { ...value[id], ...patch } });

  return (
    <div className="space-y-2">
      {SCHEDULE_DAYS.map((d) => {
        const ds = value[d.id] || { enabled: false, start: '09:00', end: '18:00' };
        return (
          <div key={d.id} className="flex items-center gap-2">
            <label className="flex items-center gap-2 w-24 shrink-0 cursor-pointer">
              <Checkbox checked={ds.enabled} onCheckedChange={(c) => set(d.id, { enabled: !!c })} />
              <span className="text-sm">{d.label}</span>
            </label>
            {ds.enabled ? (
              <div className="flex items-center gap-1.5 flex-1">
                <Input type="time" value={ds.start} onChange={(e) => set(d.id, { start: e.target.value })} className="h-9 text-sm" />
                <span className="text-muted-foreground text-sm">–</span>
                <Input type="time" value={ds.end} onChange={(e) => set(d.id, { end: e.target.value })} className="h-9 text-sm" />
              </div>
            ) : (
              <span className="flex-1 text-sm text-muted-foreground">Cerrado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
