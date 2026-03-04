import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barberId?: string;
  onCreated?: () => void;
}

const NewAppointmentDialog = ({ open, onOpenChange, barberId, onCreated }: Props) => {
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!barberId || !clientName || !date || !time) return;
    setLoading(true);

    // Create or find customer
    let customerId: string;
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('barber_id', barberId)
      .eq('name', clientName)
      .maybeSingle();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({ barber_id: barberId, name: clientName, phone_number: clientPhone })
        .select('id')
        .single();
      if (custErr || !newCustomer) {
        toast.error('Error al crear cliente');
        setLoading(false);
        return;
      }
      customerId = newCustomer.id;
    }

    const startTime = new Date(`${date}T${time}`);
    const endTime = new Date(startTime.getTime() + 30 * 60000);
    const code = `MC-${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabase.from('appointments').insert({
      barber_id: barberId,
      customer_id: customerId,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      appointment_code: code,
    });

    setLoading(false);
    if (error) {
      toast.error('Error al crear cita');
    } else {
      toast.success('Cita creada');
      setClientName('');
      setClientPhone('');
      setDate('');
      setTime('');
      onOpenChange(false);
      onCreated?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-sm">
        <DialogHeader>
          <DialogTitle>Nueva cita manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Nombre del cliente</Label>
            <Input placeholder="Nombre" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Teléfono (opcional)</Label>
            <Input placeholder="+1 234 567 8900" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Hora</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <Button onClick={handleCreate} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={loading || !clientName || !date || !time}>
            {loading ? 'Creando...' : 'Crear cita'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default NewAppointmentDialog;
