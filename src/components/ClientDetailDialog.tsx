import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { User, Phone, Calendar, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: any;
  onCreateAppointment?: (client: any) => void;
}

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

const ClientDetailDialog = ({ open, onOpenChange, client, onCreateAppointment }: Props) => {
  const { data: appointments = [] } = useQuery({
    queryKey: ['client-appointments', client?.id],
    queryFn: async () => {
      if (!client) return [];
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('customer_id', client.id)
        .order('start_time', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!client && open,
  });

  if (!client) return null;

  const formatDate = (d: string) => new Date(d).toLocaleDateString('es-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Detalle del cliente</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Client info */}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-secondary">
            <div className="h-12 w-12 rounded-full bg-background flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold">{client.name}</p>
              {client.phone_number && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {client.phone_number}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{client.total_visits || 0} visitas</p>
            </div>
          </div>

          {onCreateAppointment && (
            <Button
              onClick={() => onCreateAppointment(client)}
              className="w-full gold-gradient text-primary-foreground font-semibold"
            >
              <Plus className="mr-2 h-4 w-4" /> Crear cita
            </Button>
          )}

          {/* Appointments */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Historial de citas</p>
            <ScrollArea className="max-h-60">
              {appointments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Sin citas registradas</p>
              ) : (
                <div className="space-y-2">
                  {appointments.map((appt: any) => (
                    <div key={appt.id} className="p-3 rounded-lg bg-secondary/50 border border-border flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm">{formatDate(appt.start_time)}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {formatTime(appt.start_time)}
                          </p>
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full ${statusColors[appt.status] || 'bg-secondary text-muted-foreground'}`}>
                        {statusLabels[appt.status] || appt.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ClientDetailDialog;
