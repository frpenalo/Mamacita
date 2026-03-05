import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { MoreVertical, XCircle, UserX, CheckCircle, CalendarIcon, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getAvailableSlots, type TimeSlot } from '@/lib/slots';

interface Props {
  appointment: any;
  barberId: string;
  barberStart?: string;
  barberEnd?: string;
  onUpdated: () => void;
}

const AppointmentActions = ({ appointment, barberId, barberStart = '09:00', barberEnd = '18:00', onUpdated }: Props) => {
  const [showReschedule, setShowReschedule] = useState(false);
  const [date, setDate] = useState<Date | undefined>();
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateStatus = async (status: string) => {
    const { error } = await supabase.from('appointments').update({ status }).eq('id', appointment.id);
    if (error) toast.error('Error al actualizar');
    else { toast.success(`Cita ${status === 'cancelled' ? 'cancelada' : status === 'no_show' ? 'marcada como no show' : 'completada'}`); onUpdated(); }
  };

  const loadSlots = async (d: Date) => {
    setDate(d);
    setSelectedSlot(null);
    setLoadingSlots(true);
    const s = await getAvailableSlots(barberId, d, barberStart, barberEnd);
    setSlots(s);
    setLoadingSlots(false);
  };

  const handleReschedule = async () => {
    if (!selectedSlot) return;
    setSaving(true);
    const { error } = await supabase.from('appointments').update({
      start_time: selectedSlot.start.toISOString(),
      end_time: selectedSlot.end.toISOString(),
      status: 'rescheduled',
    }).eq('id', appointment.id);
    setSaving(false);
    if (error) toast.error('Error al reagendar');
    else { toast.success('Cita reagendada'); setShowReschedule(false); onUpdated(); }
  };

  const formatSlotTime = (d: Date) =>
    d.toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  if (appointment.status === 'cancelled' || appointment.status === 'completed' || appointment.status === 'no_show') return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1 rounded-md hover:bg-secondary transition-colors">
            <MoreVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-card border-border">
          <DropdownMenuItem onClick={() => updateStatus('completed')} className="gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" /> Completada
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => updateStatus('no_show')} className="gap-2">
            <UserX className="h-4 w-4 text-yellow-500" /> No Show
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowReschedule(true)} className="gap-2">
            <CalendarIcon className="h-4 w-4 text-blue-400" /> Reagendar
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => updateStatus('cancelled')} className="gap-2 text-destructive">
            <XCircle className="h-4 w-4" /> Cancelar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={showReschedule} onOpenChange={setShowReschedule}>
        <DialogContent className="bg-card border-border max-w-sm">
          <DialogHeader>
            <DialogTitle>Reagendar cita</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("w-full justify-start", !date && "text-muted-foreground")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP", { locale: es }) : "Seleccionar fecha"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && loadSlots(d)}
                  disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>

            {date && (
              loadingSlots ? (
                <p className="text-sm text-muted-foreground text-center py-4">Cargando...</p>
              ) : slots.filter(s => s.available).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Sin horarios</p>
              ) : (
                <ScrollArea className="max-h-40">
                  <div className="grid grid-cols-2 gap-2">
                    {slots.filter(s => s.available).map((slot) => (
                      <button
                        key={slot.start.toISOString()}
                        onClick={() => setSelectedSlot(slot)}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-lg text-sm border transition-all",
                          selectedSlot?.start.getTime() === slot.start.getTime()
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border bg-secondary hover:border-primary/50"
                        )}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        {formatSlotTime(slot.start)}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )
            )}

            {selectedSlot && (
              <Button onClick={handleReschedule} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={saving}>
                {saving ? 'Guardando...' : 'Confirmar reagenda'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default AppointmentActions;
