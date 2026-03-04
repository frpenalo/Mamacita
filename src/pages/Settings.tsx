import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBarber } from '@/hooks/useBarber';
import { useAuth } from '@/hooks/useAuth';
import { useQueryClient } from '@tanstack/react-query';
import BottomNav from '@/components/BottomNav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { LogOut, Phone, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';

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

  useEffect(() => {
    if (barber) {
      setName(barber.name);
      setShopName(barber.shop_name);
      setAddress(barber.address || '');
      setPhone(barber.phone_number || '');
      setWorkingDays(barber.working_days || []);
      setStartTime(barber.working_hours_start || '09:00');
      setEndTime(barber.working_hours_end || '18:00');
    }
  }, [barber]);

  const toggleDay = (day: string) => {
    setWorkingDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  };

  const handleSave = async () => {
    if (!barber) return;
    setSaving(true);
    const { error } = await supabase.from('barbers').update({
      name,
      shop_name: shopName,
      address,
      phone_number: phone,
      working_days: workingDays,
      working_hours_start: startTime,
      working_hours_end: endTime,
    }).eq('id', barber.id);
    setSaving(false);
    if (error) {
      toast.error('Error al guardar');
    } else {
      toast.success('Configuración guardada');
      queryClient.invalidateQueries({ queryKey: ['barber'] });
    }
  };

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

          {/* Placeholders */}
          <div className="bg-card rounded-lg p-4 border border-border">
            <div className="flex items-center gap-3">
              <Phone className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium text-sm">Conectar Vapi</p>
                <p className="text-xs text-muted-foreground">Próximamente</p>
              </div>
            </div>
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
