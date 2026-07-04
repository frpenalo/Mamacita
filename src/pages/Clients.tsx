import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import BottomNav from '@/components/BottomNav';
import WhatsAppLinkCard from '@/components/WhatsAppLinkCard';
import ClientDetailDialog from '@/components/ClientDetailDialog';
import NewAppointmentDialog from '@/components/NewAppointmentDialog';
import { Input } from '@/components/ui/input';
import { Search, User, Phone } from 'lucide-react';

const Clients = () => {
  const { data: barber } = useBarber();
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [apptClient, setApptClient] = useState<any>(null);
  const [showNewAppt, setShowNewAppt] = useState(false);

  const { data: clients = [] } = useQuery({
    queryKey: ['clients', barber?.id],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('customers')
        .select('*, appointments(start_time)')
        .eq('barber_id', barber.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!barber,
  });

  const filtered = clients.filter((c: any) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone_number && c.phone_number.includes(search))
  );

  const getLastVisit = (appointments: any[]) => {
    if (!appointments || appointments.length === 0) return '—';
    const sorted = [...appointments].sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
    return new Date(sorted[0].start_time).toLocaleString('es-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  return (
    <div className="min-h-screen pb-20">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold mb-4">Clientes</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o teléfono"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Link/QR para que los clientes agenden por WhatsApp (producto de citas) */}
      {(barber as any)?.wa_code && (
        <div className="px-4 mb-6">
          <WhatsAppLinkCard waCode={(barber as any).wa_code} />
        </div>
      )}

      <div className="px-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="bg-card rounded-lg p-6 text-center">
            <p className="text-muted-foreground">No hay clientes registrados</p>
          </div>
        ) : (
          filtered.map((client: any) => (
            <button
              key={client.id}
              onClick={() => setSelectedClient(client)}
              className="w-full text-left bg-card rounded-lg p-4 border border-border hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{client.name}</p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {client.phone_number && (
                      <>
                        <Phone className="h-3 w-3" />
                        <span>{client.phone_number}</span>
                        <span className="mx-1">·</span>
                      </>
                    )}
                    <span>{client.total_visits} visitas</span>
                    <span className="mx-1">·</span>
                    <span>Última: {getLastVisit(client.appointments)}</span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <ClientDetailDialog
        open={!!selectedClient}
        onOpenChange={(v) => !v && setSelectedClient(null)}
        client={selectedClient}
        onCreateAppointment={(client) => {
          setApptClient(client);
          setSelectedClient(null);
          setShowNewAppt(true);
        }}
      />
      <NewAppointmentDialog
        open={showNewAppt}
        onOpenChange={setShowNewAppt}
        barberId={barber?.id}
        barberStart={barber?.working_hours_start || '09:00'}
        barberEnd={barber?.working_hours_end || '18:00'}
        appointmentDuration={(barber as any)?.appointment_duration || 45}
        preselectedClient={apptClient}
        onCreated={() => { setShowNewAppt(false); setApptClient(null); }}
      />
      <BottomNav />
    </div>
  );
};

export default Clients;
