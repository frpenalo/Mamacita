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
  workStart: string,  // "09:00"
  workEnd: string,    // "18:00"
): Promise<TimeSlot[]> {
  // Normalize time format - DB may return "09:00:00", we need "09:00"
  const normalizeTime = (t: string) => t.split(':').slice(0, 2).join(':');
  const startNorm = normalizeTime(workStart);
  const endNorm = normalizeTime(workEnd);

  // Build date range in EST
  const dateStr = date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dayStart = new Date(`${dateStr}T${startNorm}:00-05:00`);
  const dayEnd = new Date(`${dateStr}T${endNorm}:00-05:00`);

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

  if (slots.length === 0) return [];

  // Fetch confirmed appointments for this date
  const { data: appointments } = await supabase
    .from('appointments')
    .select('start_time, end_time')
    .eq('barber_id', barberId)
    .in('status', ['confirmed', 'rescheduled'])
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  // Fetch blocked times for this date
  const { data: blockedTimes } = await supabase
    .from('blocked_times')
    .select('start_time, end_time')
    .eq('barber_id', barberId)
    .lte('start_time', dayEnd.toISOString())
    .gte('end_time', dayStart.toISOString());

  // Fetch held slots that haven't expired
  const { data: heldSlots } = await supabase
    .from('availability_slots')
    .select('start_time, end_time, hold_expires_at, held_by_session_id')
    .eq('barber_id', barberId)
    .eq('status', 'held')
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  const now = new Date();

  return slots.map((slot) => {
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
