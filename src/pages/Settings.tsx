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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LogOut, CalendarIcon, Ban, Trash2, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { type DateRange } from 'react-day-picker';
import WeeklyScheduleEditor, { emptySchedule, scheduleFromBarber, barberFieldsFromSchedule, type WeekSchedule } from '@/components/WeeklyScheduleEditor';

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
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [schedule, setSchedule] = useState<WeekSchedule>(emptySchedule());
  const [appointmentDuration, setAppointmentDuration] = useState('45');
  const [services, setServices] = useState<{ name: string; price: string; duration: string }[]>([]);
  const [surchargeAfter, setSurchargeAfter] = useState('');
  const [surchargeAmount, setSurchargeAmount] = useState('');
  const [saving, setSaving] = useState(false);

  // Blocked times — un solo selector de RANGO (como en vuelos)
  const [blockRange, setBlockRange] = useState<DateRange | undefined>();
  const [blockStartTime, setBlockStartTime] = useState('09:00');
  const [blockEndTime, setBlockEndTime] = useState('18:00');
  const [blockReason, setBlockReason] = useState('');
  const [blockingSaving, setBlockingSaving] = useState(false);


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
      setWhatsappNumber((barber as any).whatsapp_number || '');
      setSchedule(scheduleFromBarber(barber));
      setAppointmentDuration(String((barber as any).appointment_duration || 45));
      setServices((((barber as any).services) || []).map((s: any) => ({
        name: s.name || '',
        price: s.price != null ? String(s.price) : '',
        duration: s.duration_min != null ? String(s.duration_min) : '',
      })));
      setSurchargeAfter(((barber as any).surcharge_after || '').slice(0, 5));
      setSurchargeAmount((barber as any).surcharge_amount != null ? String((barber as any).surcharge_amount) : '');
    }
  }, [barber]);

  const addService = () => setServices((p) => [...p, { name: '', price: '', duration: appointmentDuration || '30' }]);
  const removeService = (i: number) => setServices((p) => p.filter((_, idx) => idx !== i));
  const updateService = (i: number, field: 'name' | 'price' | 'duration', val: string) =>
    setServices((p) => p.map((s, idx) => (idx === i ? { ...s, [field]: val } : s)));

  const handleSave = async () => {
    if (!barber) return;
    setSaving(true);
    const cleanServices = services
      .filter((s) => s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        price: parseFloat(s.price) || 0,
        duration_min: parseInt(s.duration, 10) || parseInt(appointmentDuration, 10) || 30,
      }));
    const { error } = await supabase.from('barbers').update({
      name, shop_name: shopName, address, phone_number: phone,
      whatsapp_number: whatsappNumber,
      ...barberFieldsFromSchedule(schedule),
      appointment_duration: parseInt(appointmentDuration, 10),
      services: cleanServices,
      surcharge_after: surchargeAfter || null,
      surcharge_amount: surchargeAmount ? parseFloat(surchargeAmount) : null,
    }).eq('id', barber.id);
    setSaving(false);
    if (error) {
      const dupWhatsapp = error.code === '23505' &&
        (String(error.message).includes('barbers_whatsapp_number_unique') ||
         String(error.details).includes('barbers_whatsapp_number_unique'));
      toast.error(dupWhatsapp
        ? 'Ese número de WhatsApp ya está en uso por otro barbero. Usa un número distinto.'
        : 'Error al guardar');
      return;
    }
    toast.success('Configuración guardada');
    queryClient.invalidateQueries({ queryKey: ['barber'] });
  };

  const handleBlock = async () => {
    if (!barber || !blockRange?.from) return;
    const from = blockRange.from;
    const to = blockRange.to || blockRange.from; // un solo día si no eligió fin
    setBlockingSaving(true);
    const startStr = `${format(from, 'yyyy-MM-dd')}T${blockStartTime}:00-05:00`;
    const endStr = `${format(to, 'yyyy-MM-dd')}T${blockEndTime}:00-05:00`;
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
      setBlockRange(undefined); setBlockReason('');
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
          <div className="space-y-2">
            <Label>WhatsApp para avisos de citas</Label>
            <Input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              placeholder="984 555 1234"
            />
            <p className="text-xs text-muted-foreground">
              Aquí recibes el aviso de cada cita nueva, con botones para confirmar o cancelar.
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label>Días y horario de trabajo</Label>
            <p className="text-xs text-muted-foreground">Marca los días que trabajas y define la apertura y cierre de cada uno (pueden variar).</p>
            <WeeklyScheduleEditor value={schedule} onChange={setSchedule} />
          </div>

          <Button onClick={handleSave} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>

          <Separator />

          {/* Appointment duration */}
          <div className="space-y-3">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> Configuración de citas
            </h2>
            <div className="space-y-2">
              <Label>Duración por defecto de la cita</Label>
              <Select value={appointmentDuration} onValueChange={setAppointmentDuration}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">15 minutos</SelectItem>
                  <SelectItem value="30">30 minutos</SelectItem>
                  <SelectItem value="45">45 minutos</SelectItem>
                  <SelectItem value="60">60 minutos</SelectItem>
                  <SelectItem value="90">90 minutos</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Se usa cuando el cliente no elige un servicio con su propia duración.</p>
            </div>

            {/* Servicios y precios */}
            <div className="space-y-2">
              <Label>Servicios y precios</Label>
              <p className="text-xs text-muted-foreground">El asistente los usa para responder precios y para la duración de la cita.</p>
              {services.length > 0 && (
                <div className="flex gap-2 px-1 text-[11px] text-muted-foreground">
                  <span className="flex-1">Servicio</span>
                  <span className="w-20 text-center">Precio $</span>
                  <span className="w-16 text-center">Min</span>
                  <span className="w-8" />
                </div>
              )}
              {services.map((s, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input placeholder="Ej. Corte regular" value={s.name} onChange={(e) => updateService(i, 'name', e.target.value)} className="flex-1" />
                  <Input placeholder="35" value={s.price} onChange={(e) => updateService(i, 'price', e.target.value)} className="w-20 text-center" inputMode="decimal" />
                  <Input placeholder="30" value={s.duration} onChange={(e) => updateService(i, 'duration', e.target.value)} className="w-16 text-center" inputMode="numeric" />
                  <button onClick={() => removeService(i)} className="p-1.5 rounded-md hover:bg-destructive/20 transition-colors shrink-0" aria-label="Quitar servicio">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addService} className="border-primary text-primary">
                + Agregar servicio
              </Button>
            </div>

            {/* Recargo por hora tardía */}
            <div className="space-y-2">
              <Label>Recargo por hora tardía (opcional)</Label>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-muted-foreground">Después de</span>
                <Input type="time" value={surchargeAfter} onChange={(e) => setSurchargeAfter(e.target.value)} className="w-32" />
                <span className="text-sm text-muted-foreground">cobrar +$</span>
                <Input placeholder="10" value={surchargeAmount} onChange={(e) => setSurchargeAmount(e.target.value)} className="w-20 text-center" inputMode="decimal" />
              </div>
              <p className="text-xs text-muted-foreground">Déjalo vacío si no cobras recargo.</p>
            </div>

            <Button onClick={handleSave} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>

          <Separator />

          {/* Blocked times */}
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Ban className="h-5 w-5 text-primary" /> Bloquear horarios
            </h2>

            {/* Un solo calendario de RANGO (estilo vuelos): toca el primer día y luego el último */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Días a bloquear</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn("w-full justify-start text-sm", !blockRange?.from && "text-muted-foreground")}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {blockRange?.from ? (
                      blockRange.to && format(blockRange.to, 'yyyy-MM-dd') !== format(blockRange.from, 'yyyy-MM-dd')
                        ? `${format(blockRange.from, "d MMM", { locale: es })} – ${format(blockRange.to, "d MMM", { locale: es })}`
                        : format(blockRange.from, "d 'de' MMMM", { locale: es })
                    ) : 'Elige el día (o toca inicio y fin para un rango)'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={blockRange}
                    onSelect={setBlockRange}
                    numberOfMonths={1}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <p className="text-[11px] text-muted-foreground">Toca el primer día y luego el último para un rango, o un solo día.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Desde las</Label>
                <Input type="time" value={blockStartTime} onChange={(e) => setBlockStartTime(e.target.value)} className="text-sm h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Hasta las</Label>
                <Input type="time" value={blockEndTime} onChange={(e) => setBlockEndTime(e.target.value)} className="text-sm h-9" />
              </div>
            </div>

            <Input placeholder="Motivo (opcional)" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />

            <Button onClick={handleBlock} variant="outline" className="w-full border-primary text-primary" disabled={blockingSaving || !blockRange?.from}>
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


          <Separator />

          <Button variant="outline" onClick={signOut} className="w-full bg-transparent" style={{ borderColor: '#444444', color: '#888888' }}>
            <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default Settings;
