import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import BottomNav from '@/components/BottomNav';
import { Button } from '@/components/ui/button';
import { Scissors, Plus, Clock, User } from 'lucide-react';
import NewAppointmentDialog from '@/components/NewAppointmentDialog';

const Dashboard = () => {
  const { data: barber } = useBarber();
  const [showNewAppt, setShowNewAppt] = useState(false);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const { data: todayAppointments = [], refetch } = useQuery({
    queryKey: ['appointments-today', barber?.id],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers(name, phone_number)')
        .eq('barber_id', barber.id)
        .gte('start_time', todayStart.toISOString())
        .lte('start_time', todayEnd.toISOString())
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!barber,
  });

  const { data: upcomingAppointments = [] } = useQuery({
    queryKey: ['appointments-upcoming', barber?.id],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*, customers(name, phone_number)')
        .eq('barber_id', barber.id)
        .gt('start_time', todayEnd.toISOString())
        .order('start_time', { ascending: true })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!barber,
  });

  const formatTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  };

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <div className="px-4 pt-6 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scissors className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold gold-text">MamaCita</span>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{barber?.shop_name}</p>
          <p className="text-xs text-muted-foreground">{barber?.name}</p>
        </div>
      </div>

      <div className="px-4 space-y-6">
        {/* Hoy */}
        <section>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" /> Hoy
          </h2>
          {todayAppointments.length === 0 ? (
            <div className="bg-card rounded-lg p-6 text-center">
              <p className="text-muted-foreground">No hay citas para hoy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {todayAppointments.map((appt: any) => (
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
                  <span className="text-xs text-muted-foreground font-mono">{appt.appointment_code}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Próximas */}
        <section>
          <h2 className="text-lg font-semibold mb-3">Próximas citas</h2>
          {upcomingAppointments.length === 0 ? (
            <div className="bg-card rounded-lg p-6 text-center">
              <p className="text-muted-foreground">No hay citas próximas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingAppointments.map((appt: any) => (
                <div key={appt.id} className="bg-card rounded-lg p-4 flex items-center justify-between border border-border">
                  <div>
                    <p className="font-medium text-sm">{appt.customers?.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(appt.start_time)} · {formatTime(appt.start_time)}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${appt.status === 'confirmed' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                    {appt.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowNewAppt(true)}
        className="fixed bottom-20 right-4 h-14 w-14 rounded-full gold-gradient flex items-center justify-center shadow-lg z-40"
      >
        <Plus className="h-6 w-6 text-primary-foreground" />
      </button>

      <NewAppointmentDialog open={showNewAppt} onOpenChange={setShowNewAppt} barberId={barber?.id} onCreated={refetch} />
      <BottomNav />
    </div>
  );
};

export default Dashboard;
