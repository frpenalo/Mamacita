import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowRight, ArrowLeft, Check, Phone, Copy } from 'lucide-react';
import logoIcon from '@/assets/logo.ico';
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

const Onboarding = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [assignedPhone, setAssignedPhone] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [shopName, setShopName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');

  const toggleDay = (day: string) => {
    setWorkingDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]);
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);

    // 1. Create barber record
    const { data: barberData, error } = await supabase.from('barbers').insert({
      user_id: user.id,
      name,
      shop_name: shopName,
      address,
      phone_number: phone,
      working_days: workingDays,
      working_hours_start: startTime,
      working_hours_end: endTime,
    }).select('id').single();

    if (error) {
      setLoading(false);
      toast.error('Error al guardar: ' + error.message);
      return;
    }

    // 2. Buy Vapi phone number
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      const res = await supabase.functions.invoke('vapi-buy-number', {
        body: { barber_id: barberData.id, shop_name: shopName },
      });

      if (res.error) {
        console.error('Vapi buy number error:', res.error);
        toast.error('Registro exitoso, pero no se pudo asignar número de teléfono.');
      } else {
        const phoneNumber = res.data?.phone_number;
        if (phoneNumber) {
          setAssignedPhone(phoneNumber);
        }
      }
    } catch (e) {
      console.error('Vapi buy number exception:', e);
      toast.error('Registro exitoso, pero no se pudo asignar número de teléfono.');
    }

    setLoading(false);
    toast.success('¡Bienvenido a MamaCita!');
    await queryClient.invalidateQueries({ queryKey: ['barber'] });

    // If we got a phone number, show step 4 (confirmation). Otherwise go to dashboard.
    if (!assignedPhone) {
      // Check if phone was set in the response above (state might not be updated yet)
      // We handle this by going to step 4 always after success
    }
    setStep(4);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-2">
            <img src={logoIcon} alt="MamaCita" className="h-12 w-12" />
            <span className="text-xl font-bold gold-text">MamaCita</span>
          </div>
          <div className="flex justify-center gap-2 mt-4">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`h-1.5 w-12 rounded-full transition-colors ${s <= step ? 'gold-gradient' : 'bg-secondary'}`} />
            ))}
          </div>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Datos del negocio</h2>
            <div className="space-y-2">
              <Label>Tu nombre</Label>
              <Input placeholder="Juan Pérez" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nombre del negocio</Label>
              <Input placeholder="Barbería Don Juan" value={shopName} onChange={(e) => setShopName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Dirección</Label>
              <Input placeholder="Calle 123, Ciudad" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono principal</Label>
              <Input placeholder="+1 234 567 8900" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <Button onClick={() => setStep(2)} className="w-full gold-gradient text-primary-foreground font-semibold" disabled={!name || !shopName}>
              Siguiente <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Horarios de trabajo</h2>
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
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1 gold-gradient text-primary-foreground font-semibold" disabled={workingDays.length === 0}>
                Siguiente <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Confirmar datos</h2>
            <div className="space-y-3 bg-secondary p-4 rounded-lg">
              <div><span className="text-muted-foreground text-sm">Nombre:</span> <span className="font-medium">{name}</span></div>
              <div><span className="text-muted-foreground text-sm">Negocio:</span> <span className="font-medium">{shopName}</span></div>
              <div><span className="text-muted-foreground text-sm">Dirección:</span> <span className="font-medium">{address || '—'}</span></div>
              <div><span className="text-muted-foreground text-sm">Teléfono:</span> <span className="font-medium">{phone || '—'}</span></div>
              <div><span className="text-muted-foreground text-sm">Días:</span> <span className="font-medium">{workingDays.join(', ') || '—'}</span></div>
              <div><span className="text-muted-foreground text-sm">Horario:</span> <span className="font-medium">{startTime} - {endTime}</span></div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">
                <ArrowLeft className="mr-2 h-4 w-4" /> Atrás
              </Button>
              <Button onClick={handleSubmit} className="flex-1 gold-gradient text-primary-foreground font-semibold" disabled={loading}>
                <Check className="mr-2 h-4 w-4" /> {loading ? 'Guardando...' : 'Comenzar'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
