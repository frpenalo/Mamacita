import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import { useAuth } from '@/hooks/useAuth';
import BottomNav from '@/components/BottomNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LogOut, Phone, MessageSquare, CalendarIcon, Ban, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const DAYS = [
  { id: 'lun', label: 'Lunes' },
  { id: 'mar', label: 'Martes' },
  { id: 'mie', label: 'Miércoles' },
  { id: 'jue', label: 'Jueves' },
  { id: 'vie', label: 'Viernes' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

const Settings = () => {
  const { data: barber } = useBarber();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [saving, setSaving] = useState(false);

  // Blocked times
  const [blockStartDate, setBlockStartDate] = useState<Date | undefined>();
  const [blockStartTime, setBlockStartTime] = useState('09:00');
  const [blockEndDate, setBlockEndDate] = useState<Date | undefined>();
  const [blockEndTime, setBlockEndTime] = useState('18:00');
  const [blockReason, setBlockReason] = useState('');
  const [blockingSaving, setBlockingSaving] = useState(false);

  // Vapi
  const [vapiAssistantId, setVapiAssistantId] = useState('');
  const [vapiPhoneNumberId, setVapiPhoneNumberId] = useState('');
  const [vapiSaving, setVapiSaving] = useState(false);

  const { data: blockedTimes = [], refetch: refetchBlocked } = useQuery({
    queryKey: ['blocked-times', barber?.id],
    queryFn: async () => {
      if (!barber) return [];
      const { data, error } = await supabase
        .from('blocked_times')
        .select('*')
        .eq('barber_id', barber.id)
        .gte('end_time', new Date().toISOString())
        .order('start_time', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!barber,
  });

  useEffect(() => {
    if (barber) {
      setName(barber.name);
      setShopName(barber.shop_name);
      setAddress(barber.address || '');
      setPhone(barber.phone_number || '');
      setWorkingDays(barber.working_days || []);
      setStartTime(barber.working_hours_start || '09:00');
      setEndTime(barber.working_hours_end || '18:00');
      setVapiAssistantId((barber as any).vapi_assistant_id || '');
      setVapiPhoneNumberId((barber as any).vapi_phone_number_id || '');
    }
  }, [barber]);

  const toggleDay = (day: string) => {
    setWorkingDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  };

  const handleSave = async () => {
    if (!barber) return;
    setSaving(true);
    const { error } = await supabase.from('barbers').update({
      name, shop_name: shopName, address, phone_number: phone,
      working_days: workingDays, working_hours_start: startTime, working_hours_end: endTime,
    }).eq('id', barber.id);
    setSaving(false);
    if (error) toast.error('Error al guardar');
    else { toast.success('Configuración guardada'); queryClient.invalidateQueries({ queryKey: ['barber'] }); }
  };

  const handleBlock = async () => {
    if (!barber || !blockStartDate || !blockEndDate) return;
    setBlockingSaving(true);
    const startStr = `${format(blockStartDate, 'yyyy-MM-dd')}T${blockStartTime}:00-05:00`;
    const endStr = `${format(blockEndDate, 'yyyy-MM-dd')}T${blockEndTime}:00-05:00`;
    const { error } = await supabase.from('blocked_times').insert({
      barber_id: barber.id,
      start_time: new Date(startStr).toISOString(),
      end_time: new Date(endStr).toISOString(),
      reason: blockReason || null,
    });
    setBlockingSaving(false);
    if (error) toast.error('Error al bloquear');
    else {
      toast.success('Horario bloqueado');
      setBlockStartDate(undefined); setBlockEndDate(undefined); setBlockReason('');
      refetchBlocked();
    }
  };

  const handleDeleteBlock = async (id: string) => {
    const { error } = await supabase.from('blocked_times').delete().eq('id', id);
    if (error) toast.error('Error al eliminar');
    else { toast.success('Bloqueo eliminado'); refetchBlocked(); }
  };

  const formatBlockDate = (d: string) => new Date(d).toLocaleDateString('es-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });

  return (
    <div className="min-h-screen pb-20">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-xl font-bold mb-6">Configuración</h1>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tu nombre</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Nombre del negocio</Label>
            <Input value={shopName} onChange={(e) => setShopName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Dirección</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Teléfono</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>

          <Separator />

          <div className="space-y-3">
            <Label>Días laborables</Label>
            <div className="grid grid-cols-2 gap-2">
              {DAYS.map((day) => (
                <label key={day.id} className="flex items-center gap-2 p-3 rounded-lg bg-secondary cursor-pointer">
                  <Checkbox checked={workingDays.includes(day.id)} onCheckedChange={() => toggleDay(day.id)} />
                  <span className="text-sm">{day.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Hora de inicio</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Hora de cierre</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
          </div>

          <Button onClick={handleSave} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>

          <Separator />

          {/* Blocked times */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Ban className="h-5 w-5 text-primary" /> Bloquear horarios
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Fecha inicio</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("w-full justify-start text-xs", !blockStartDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {blockStartDate ? format(blockStartDate, "dd MMM", { locale: es }) : "Fecha"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={blockStartDate} onSelect={setBlockStartDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
                <Input type="time" value={blockStartTime} onChange={(e) => setBlockStartTime(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Fecha fin</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className={cn("w-full justify-start text-xs", !blockEndDate && "text-muted-foreground")}>
                      <CalendarIcon className="mr-1 h-3 w-3" />
                      {blockEndDate ? format(blockEndDate, "dd MMM", { locale: es }) : "Fecha"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={blockEndDate} onSelect={setBlockEndDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
                <Input type="time" value={blockEndTime} onChange={(e) => setBlockEndTime(e.target.value)} className="text-xs h-8" />
              </div>
            </div>

            <Input placeholder="Motivo (opcional)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />

            <Button onClick={handleBlock} variant="outline" className="w-full border-primary text-primary" disabled={blockingSaving || !blockStartDate || !blockEndDate}>
              {blockingSaving ? 'Bloqueando...' : 'Bloquear horario'}
            </Button>

            {blockedTimes.length > 0 && (
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Bloqueos activos</Label>
                {blockedTimes.map((bt: any) => (
                  <div key={bt.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary border border-border">
                    <div>
                      <p className="text-sm">{formatBlockDate(bt.start_time)} — {formatBlockDate(bt.end_time)}</p>
                      {bt.reason && <p className="text-xs text-muted-foreground">{bt.reason}</p>}
                    </div>
                    <button onClick={() => handleDeleteBlock(bt.id)} className="p-1.5 rounded-md hover:bg-destructive/20 transition-colors">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Vapi Section */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Phone className="h-5 w-5 text-primary" /> Teléfono MamaCita
            </h2>
            {barber?.phone_number && (barber as any).vapi_phone_number_id ? (
              <div className="bg-secondary p-4 rounded-lg">
                <p className="text-sm text-muted-foreground">Tu número asignado:</p>
                <p className="text-lg font-bold gold-text">{barber.phone_number}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">No tienes un número de MamaCita asignado aún.</p>
                <Button
                  onClick={async () => {
                    if (!barber) return;
                    setVapiSaving(true);
                    try {
                      const res = await supabase.functions.invoke('vapi-buy-number', {
                        body: { barber_id: barber.id, shop_name: barber.shop_name },
                      });
                      if (res.error) {
                        toast.error('Error al comprar número: ' + (res.error.message || 'Error desconocido'));
                      } else if (res.data?.phone_number) {
                        toast.success(`¡Número asignado: ${res.data.phone_number}!`);
                        queryClient.invalidateQueries({ queryKey: ['barber'] });
                      } else {
                        toast.success('Número comprado. Se asignará en breve.');
                        queryClient.invalidateQueries({ queryKey: ['barber'] });
                      }
                    } catch (e: any) {
                      toast.error('Error: ' + e.message);
                    }
                    setVapiSaving(false);
                  }}
                  className="w-full gold-gradient text-primary-foreground font-semibold"
                  disabled={vapiSaving}
                >
                  {vapiSaving ? 'Comprando número...' : 'Comprar número de teléfono'}
                </Button>
              </div>
            )}
            
            <Separator className="my-2" />
            
            <div className="space-y-2">
              <Label>Vapi Assistant ID</Label>
              <Input value={vapiAssistantId} onChange={(e) => setVapiAssistantId(e.target.value)} placeholder="asst_xxxxxxxxxxxx" />
            </div>
            <div className="space-y-2">
              <Label>Vapi Phone Number ID</Label>
              <Input value={vapiPhoneNumberId} onChange={(e) => setVapiPhoneNumberId(e.target.value)} placeholder="phn_xxxxxxxxxxxx" />
            </div>
            <Button
              onClick={async () => {
                if (!barber) return;
                setVapiSaving(true);
                const { error } = await supabase.from('barbers').update({
                  vapi_assistant_id: vapiAssistantId || null,
                  vapi_phone_number_id: vapiPhoneNumberId || null,
                } as any).eq('id', barber.id);
                setVapiSaving(false);
                if (error) toast.error('Error al guardar Vapi');
                else { toast.success('Configuración Vapi guardada'); queryClient.invalidateQueries({ queryKey: ['barber'] }); }
              }}
              variant="outline"
              className="w-full border-primary text-primary"
              disabled={vapiSaving}
            >
              {vapiSaving ? 'Guardando...' : 'Guardar configuración Vapi'}
            </Button>
          </div>
          <div className="bg-card rounded-lg p-4 border border-border">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Conectar WhatsApp Business</p>
                <p className="text-xs text-muted-foreground">Próximamente</p>
              </div>
            </div>
          </div>

          <Separator />

          <Button variant="outline" onClick={signOut} className="w-full text-destructive border-destructive">
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default Settings;
