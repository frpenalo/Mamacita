import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import BottomNav from '@/components/BottomNav';
import { Plus, Clock, User, Copy, Phone, CalendarDays } from 'lucide-react';
import { toast } from 'sonner';
import logoIcon from '@/assets/logo.ico';
import NewAppointmentDialog from '@/components/NewAppointmentDialog';
import AppointmentActions from '@/components/AppointmentActions';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const statusColors: Record<string, string> = {
  confirmed: 'bg-primary/20 text-primary',
  completed: 'bg-green-500/20 text-green-400',
  cancelled: 'bg-destructive/20 text-destructive',
  no_show: 'bg-yellow-500/20 text-yellow-400',
  rescheduled: 'bg-blue-400/20 text-blue-400',
};

const statusLabels: Record<string, string> = {
  confirmed: 'Confirmada',
  completed: 'Completada',
  cancelled: 'Cancelada',
  no_show: 'No Show',
  rescheduled: 'Reagendada',
};

const getNextNDays = (count: number) => {
  const days: { date: Date; dateStr: string; label: string }[] = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(0, 0, 0, 0);

    const dateStr = d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });

    let label: string;
    if (i === 0) {
      label = 'Hoy';
    } else {
      const weekday = d.toLocaleDateString('es-US', { weekday: 'short', timeZone: 'America/New_York' });
      const day = d.getDate();
      label = `${weekday.charAt(0).toUpperCase() + weekday.slice(1)} ${day}`;
    }

    days.push({ date: d, dateStr, label });
  }
  return days;
};

const Dashboard = () => {
  const { data: barber } = useBarber();
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const days = useMemo(() => getNextNDays(7), []);
  const dateStrOf = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/New_York' });
  const selectedDateStr = dateStrOf(selectedDate);

  const { data: appointments = [], refetch } = useQuery({
    queryKey: ['appointments-all', barber?.id],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers(name, phone_number)')
        .eq('barber_id', barber.id)
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!barber,
  });

  // Conteo de citas por día (para los badges de los tabs).
  const countByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const appt of appointments) {
      const ds = new Date(appt.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
      map[ds] = (map[ds] || 0) + 1;
    }
    return map;
  }, [appointments]);

  const handleRefresh = () => { refetch(); };

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleString('es-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

  const selectedAppointments = useMemo(
    () => appointments.filter((a: any) => new Date(a.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) === selectedDateStr),
    [appointments, selectedDateStr],
  );
  const selectedLabel = selectedDate.toLocaleDateString('es-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' });

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="MamaCita" className="h-10 w-10" />
          <span className="text-lg font-bold gold-text">MamaCita</span>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{barber?.shop_name}</p>
          <p className="text-xs text-muted-foreground">{barber?.name}</p>
        </div>
      </div>

      <div className="px-4 space-y-6">
        {/* MamaCita Phone Number (voz) */}
        {barber?.phone_number && (barber as any).vapi_phone_number_id && (
          <div className="bg-card rounded-lg p-3 border border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-primary" />
              <span className="text-sm">Tu número MamaCita: <span className="font-bold gold-text">{barber.phone_number}</span></span>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(barber.phone_number!);
                toast.success('Número copiado');
              }}
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <Copy className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}

        {/* 7-Day Tabs */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Citas
          </h2>

          <div className="flex items-center gap-2">
            <ScrollArea className="w-full">
              <div className="flex gap-2 pb-2">
                {days.map((day) => {
                  const count = countByDay[day.dateStr] || 0;
                  const isActive = day.dateStr === selectedDateStr;
                  return (
                    <button
                      key={day.dateStr}
                      onClick={() => setSelectedDate(day.date)}
                      className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 ${
                        isActive
                          ? 'text-primary-foreground shadow-md'
                          : 'bg-secondary text-muted-foreground hover:text-foreground'
                      }`}
                      style={isActive ? { backgroundColor: '#C9A96E' } : undefined}
                    >
                      {day.label}
                      {count > 0 && (
                        <Badge
                          variant={isActive ? 'secondary' : 'default'}
                          className="h-5 min-w-5 flex items-center justify-center px-1.5 text-[10px]"
                        >
                          {count}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            {/* Calendario: saltar a cualquier fecha */}
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Elegir fecha en el calendario"
                >
                  <CalendarDays className="h-5 w-5" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => { if (d) { const nd = new Date(d); nd.setHours(0, 0, 0, 0); setSelectedDate(nd); setCalOpen(false); } }}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>

          <p className="mt-3 text-sm font-medium capitalize">{selectedLabel}</p>

          <div className="mt-2">
            {selectedAppointments.length === 0 ? (
              <div className="bg-card rounded-lg p-6 text-center">
                <p className="text-muted-foreground">No hay citas para este día</p>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedAppointments.map((appt: any) => (
                  <div key={appt.id} className="bg-card rounded-lg p-4 flex items-center justify-between border border-border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center">
                        <User className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{appt.customers?.name}</p>
                        <p className="text-xs text-muted-foreground">{formatTime(appt.start_time)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColors[appt.status] || 'bg-secondary text-muted-foreground'}`}>
                        {statusLabels[appt.status] || appt.status}
                      </span>
                      <AppointmentActions
                        appointment={appt}
                        barberId={barber!.id}
                        barberStart={barber?.working_hours_start || '09:00'}
                        barberEnd={barber?.working_hours_end || '18:00'}
                        appointmentDuration={(barber as any)?.appointment_duration || 45}
                        onUpdated={handleRefresh}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowNewAppt(true)}
        className="fixed bottom-20 right-4 h-14 w-14 rounded-full gold-gradient flex items-center justify-center shadow-lg z-40"
      >
        <Plus className="h-6 w-6 text-primary-foreground" />
      </button>

      <NewAppointmentDialog
        open={showNewAppt}
        onOpenChange={setShowNewAppt}
        barberId={barber?.id}
        barberStart={barber?.working_hours_start || '09:00'}
        barberEnd={barber?.working_hours_end || '18:00'}
        appointmentDuration={(barber as any)?.appointment_duration || 45}
        onCreated={handleRefresh}
      />
      <BottomNav />
    </div>
  );
};

export default Dashboard;
