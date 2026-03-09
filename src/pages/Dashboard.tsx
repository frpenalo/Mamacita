import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import BottomNav from '@/components/BottomNav';
import { Plus, Clock, User, Copy, Phone } from 'lucide-react';
import { toast } from 'sonner';
import logoIcon from '@/assets/logo.ico';
import NewAppointmentDialog from '@/components/NewAppointmentDialog';
import AppointmentActions from '@/components/AppointmentActions';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

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

const getNext7Days = () => {
  const days: { date: Date; dateStr: string; label: string }[] = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));

  for (let i = 0; i < 7; i++) {
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
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  const days = useMemo(() => getNext7Days(), []);

  const { data: weekAppointments = [], refetch } = useQuery({
    queryKey: ['appointments-week', barber?.id, days[0]?.dateStr],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers(name, phone_number)')
        .eq('barber_id', barber.id)
        .order('start_time', { ascending: true });
      if (error) throw error;

      // Filter to only the 7-day window
      const dayStrs = new Set(days.map(d => d.dateStr));
      return (data || []).filter((appt: any) => {
        const apptDate = new Date(appt.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
        return dayStrs.has(apptDate);
      });
    },
    enabled: !!barber,
  });

  // Group appointments by date string
  const appointmentsByDay = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const day of days) {
      map[day.dateStr] = [];
    }
    for (const appt of weekAppointments) {
      const apptDate = new Date(appt.start_time).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
      if (map[apptDate]) {
        map[apptDate].push(appt);
      }
    }
    return map;
  }, [weekAppointments, days]);

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

  const selectedDay = days[selectedDayIndex];
  const selectedAppointments = selectedDay ? (appointmentsByDay[selectedDay.dateStr] || []) : [];

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
        {/* MamaCita Phone Number */}
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

          <ScrollArea className="w-full">
            <div className="flex gap-2 pb-2">
              {days.map((day, i) => {
                const count = (appointmentsByDay[day.dateStr] || []).length;
                const isActive = i === selectedDayIndex;
                return (
                  <button
                    key={day.dateStr}
                    onClick={() => setSelectedDayIndex(i)}
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

          <div className="mt-3">
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
        onCreated={handleRefresh}
      />
      <BottomNav />
    </div>
  );
};

export default Dashboard;
