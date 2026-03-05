import { supabase } from '@/integrations/supabase/client';

const SLOT_DURATION = 45; // minutes

export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

export async function getAvailableSlots(
  barberId: string,
  date: Date,
  workStart: string,
  workEnd: string,
): Promise<TimeSlot[]> {
  // Normalize time format - DB may return "09:00:00", we need HH and MM
  const parseTime = (t: string) => {
    const parts = t.split(':');
    return { hours: parseInt(parts[0], 10), minutes: parseInt(parts[1], 10) };
  };
  const start = parseTime(workStart);
  const end = parseTime(workEnd);

  // Use the selected date's year/month/day directly
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Create start/end in local time, then we'll work in UTC
  const dayStart = new Date(year, month, day, start.hours, start.minutes, 0);
  const dayEnd = new Date(year, month, day, end.hours, end.minutes, 0);

  console.log('[slots] Date selected:', date.toISOString());
  console.log('[slots] Work range:', dayStart.toISOString(), '→', dayEnd.toISOString());
  console.log('[slots] workStart:', workStart, 'workEnd:', workEnd);

  // Generate all possible slots
  const slots: TimeSlot[] = [];
  let cursor = new Date(dayStart);
  while (cursor.getTime() + SLOT_DURATION * 60000 <= dayEnd.getTime()) {
    slots.push({
      start: new Date(cursor),
      end: new Date(cursor.getTime() + SLOT_DURATION * 60000),
      available: true,
    });
    cursor = new Date(cursor.getTime() + SLOT_DURATION * 60000);
  }

  console.log('[slots] Total slots generated:', slots.length);

  if (slots.length === 0) return [];

  // Query range: full day
  const queryStart = new Date(year, month, day, 0, 0, 0).toISOString();
  const queryEnd = new Date(year, month, day, 23, 59, 59).toISOString();

  // Fetch confirmed appointments for this date
  const { data: appointments } = await supabase
    .from('appointments')
    .select('start_time, end_time')
    .eq('barber_id', barberId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('start_time', queryStart)
    .lte('start_time', queryEnd);

  // Fetch blocked times for this date
  const { data: blockedTimes } = await supabase
    .from('blocked_times')
    .select('start_time, end_time')
    .eq('barber_id', barberId)
    .lte('start_time', queryEnd)
    .gte('end_time', queryStart);

  // Fetch held slots that haven't expired
  const { data: heldSlots } = await supabase
    .from('availability_slots')
    .select('start_time, end_time, hold_expires_at, held_by_session_id')
    .eq('barber_id', barberId)
    .eq('status', 'held')
    .gte('start_time', queryStart)
    .lte('start_time', queryEnd);

  const now = new Date();

  const result = slots.map((slot) => {
    const sStart = slot.start.getTime();
    const sEnd = slot.end.getTime();

    // Check past
    if (sStart < now.getTime()) return { ...slot, available: false };

    // Check appointments overlap
    const hasAppt = (appointments || []).some((a) => {
      const aStart = new Date(a.start_time).getTime();
      const aEnd = new Date(a.end_time).getTime();
      return aStart < sEnd && aEnd > sStart;
    });
    if (hasAppt) return { ...slot, available: false };

    // Check blocked times overlap
    const isBlocked = (blockedTimes || []).some((b) => {
      const bStart = new Date(b.start_time).getTime();
      const bEnd = new Date(b.end_time).getTime();
      return bStart < sEnd && bEnd > sStart;
    });
    if (isBlocked) return { ...slot, available: false };

    // Check held slots (not expired)
    const isHeld = (heldSlots || []).some((h) => {
      if (h.hold_expires_at && new Date(h.hold_expires_at).getTime() < now.getTime()) return false;
      const hStart = new Date(h.start_time).getTime();
      const hEnd = new Date(h.end_time).getTime();
      return hStart < sEnd && hEnd > sStart;
    });
    if (isHeld) return { ...slot, available: false };

    return slot;
  });

  const available = result.filter(s => s.available).length;
  console.log('[slots] Available:', available, '/ Total:', result.length);

  return result;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function getSessionId(): string {
  let id = sessionStorage.getItem('mc_session_id');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('mc_session_id', id);
  }
  return id;
}
