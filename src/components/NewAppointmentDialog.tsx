import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { CalendarIcon, Search, UserPlus, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { getAvailableSlots, generateCode, getSessionId, type TimeSlot } from '@/lib/slots';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barberId?: string;
  barberStart?: string;
  barberEnd?: string;
  preselectedClient?: any;
  onCreated?: () => void;
}

const NewAppointmentDialog = ({ open, onOpenChange, barberId, barberStart = '09:00', barberEnd = '18:00', preselectedClient, onCreated }: Props) => {
  // Client
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<any[]>([]);
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [isNewClient, setIsNewClient] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  // Date & time
  const [date, setDate] = useState<Date | undefined>();
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [holdId, setHoldId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  // Search clients
  useEffect(() => {
    if (!barberId || clientSearch.length < 2) { setClients([]); return; }
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from('customers')
        .select('id, name, phone_number')
        .eq('barber_id', barberId)
        .or(`name.ilike.%${clientSearch}%,phone_number.ilike.%${clientSearch}%`)
        .limit(5);
      setClients(data || []);
    }, 300);
    return () => clearTimeout(timeout);
  }, [clientSearch, barberId]);

  // Load slots when date changes
  useEffect(() => {
    if (!barberId || !date) { setSlots([]); return; }
    setLoadingSlots(true);
    setSelectedSlot(null);
    getAvailableSlots(barberId, date, barberStart, barberEnd)
      .then(setSlots)
      .finally(() => setLoadingSlots(false));
  }, [barberId, date, barberStart, barberEnd]);

  // Cleanup hold on close
  const releaseHold = useCallback(async () => {
    if (holdId) {
      await supabase.from('availability_slots').delete().eq('id', holdId);
      setHoldId(null);
    }
  }, [holdId]);

  // Set preselected client when dialog opens
  useEffect(() => {
    if (open && preselectedClient) {
      setSelectedClient(preselectedClient);
    }
  }, [open, preselectedClient]);

  useEffect(() => {
    if (!open) {
      releaseHold();
      // Reset form
      setClientSearch('');
      setClients([]);
      setSelectedClient(null);
      setIsNewClient(false);
      setNewName('');
      setNewPhone('');
      setDate(undefined);
      setSlots([]);
      setSelectedSlot(null);
    }
  }, [open, releaseHold]);

  // Hold slot
  const holdSlot = async (slot: TimeSlot) => {
    if (!barberId) return;
    await releaseHold();
    setSelectedSlot(slot);

    const sessionId = getSessionId();
    const holdExpires = new Date(Date.now() + 3 * 60000).toISOString();

    const { data, error } = await supabase.from('availability_slots').insert({
      barber_id: barberId,
      start_time: slot.start.toISOString(),
      end_time: slot.end.toISOString(),
      status: 'held',
      hold_expires_at: holdExpires,
      held_by_session_id: sessionId,
    }).select('id').single();

    if (!error && data) setHoldId(data.id);
  };

  const handleConfirm = async () => {
    if (!barberId || !selectedSlot || (!selectedClient && !isNewClient)) return;
    if (isNewClient && !newName) return;
    setLoading(true);

    try {
      let customerId: string;

      if (selectedClient) {
        customerId = selectedClient.id;
      } else {
        const { data: newCust, error: custErr } = await supabase
          .from('customers')
          .insert({ barber_id: barberId, name: newName, phone_number: newPhone || null })
          .select('id')
          .single();
        if (custErr || !newCust) { toast.error('Error al crear cliente'); setLoading(false); return; }
        customerId = newCust.id;
      }

      const code = generateCode();

      const { error } = await supabase.from('appointments').insert({
        barber_id: barberId,
        customer_id: customerId,
        start_time: selectedSlot.start.toISOString(),
        end_time: selectedSlot.end.toISOString(),
        appointment_code: code,
        status: 'confirmed',
      });

      if (error) { toast.error('Error al crear cita'); setLoading(false); return; }

      // Increment visits
      const { data: custData } = await supabase.from('customers').select('total_visits').eq('id', customerId).single();
      if (custData) {
        await supabase.from('customers').update({ total_visits: (custData.total_visits || 0) + 1 }).eq('id', customerId);
      }

      // Update hold to confirmed
      if (holdId) {
        await supabase.from('availability_slots').update({ status: 'confirmed' }).eq('id', holdId);
        setHoldId(null);
      }

      toast.success(`Cita confirmada — Código: ${code}`);
      onOpenChange(false);
      onCreated?.();
    } finally {
      setLoading(false);
    }
  };

  const formatSlotTime = (d: Date) =>
    d.toLocaleTimeString('es-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  const hasClient = selectedClient || (isNewClient && newName);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) releaseHold(); onOpenChange(v); }}>
      <DialogContent className="bg-card border-border max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">Nueva cita</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Step 1: Client */}
          {!selectedClient && !isNewClient ? (
            <div className="space-y-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Cliente</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nombre o teléfono"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              {clients.length > 0 && (
                <div className="space-y-1">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClient(c); setClientSearch(''); }}
                      className="w-full text-left p-3 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      {c.phone_number && <p className="text-xs text-muted-foreground">{c.phone_number}</p>}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => setIsNewClient(true)}
                className="flex items-center gap-2 w-full p-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
              >
                <UserPlus className="h-4 w-4" /> Crear cliente nuevo
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Cliente</Label>
              {selectedClient ? (
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
                  <div>
                    <p className="text-sm font-medium">{selectedClient.name}</p>
                    {selectedClient.phone_number && <p className="text-xs text-muted-foreground">{selectedClient.phone_number}</p>}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedClient(null); setClientSearch(''); }}>Cambiar</Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input placeholder="Nombre del cliente" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  <Input placeholder="Teléfono (opcional)" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
                  <Button variant="ghost" size="sm" onClick={() => { setIsNewClient(false); setNewName(''); setNewPhone(''); }}>
                    ← Buscar existente
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Step 2: Date */}
          {hasClient && (
            <div className="space-y-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Fecha</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: es }) : "Seleccionar fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          )}

          {/* Step 3: Time slots */}
          {hasClient && date && (
            <div className="space-y-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">Horario disponible</Label>
              {loadingSlots ? (
                <p className="text-sm text-muted-foreground text-center py-4">Cargando horarios...</p>
              ) : slots.filter((s) => s.available).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No hay horarios disponibles</p>
              ) : (
                <ScrollArea className="max-h-40">
                  <div className="grid grid-cols-2 gap-2">
                    {slots.filter((s) => s.available).map((slot) => {
                      const isSelected = selectedSlot?.start.getTime() === slot.start.getTime();
                      return (
                        <button
                          key={slot.start.toISOString()}
                          onClick={() => holdSlot(slot)}
                          className={cn(
                            "flex items-center gap-2 p-3 rounded-lg text-sm transition-all border",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary font-medium"
                              : "border-border bg-secondary hover:border-primary/50"
                          )}
                        >
                          <Clock className="h-3.5 w-3.5" />
                          {formatSlotTime(slot.start)}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* Confirm */}
          {hasClient && selectedSlot && (
            <Button
              onClick={handleConfirm}
              className="w-full gold-gradient text-primary-foreground font-semibold"
              disabled={loading}
            >
              {loading ? 'Confirmando...' : 'Confirmar cita'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NewAppointmentDialog;
