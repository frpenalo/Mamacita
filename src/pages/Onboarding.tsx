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
import { Switch } from '@/components/ui/switch';
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

    // Re-fetch session to ensure we have a valid user_id
    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user?.id;
    if (!currentUserId) {
      setLoading(false);
      toast.error('Sesión expirada. Por favor inicia sesión nuevamente.');
      navigate('/login');
      return;
    }

    // 1. Create barber record
    const { data: barberData, error } = await supabase.from('barbers').insert({
      user_id: currentUserId,
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
      // Detect stale session (user deleted from auth.users)
      if (error.code === '23503' && error.message.includes('barbers_user_id_fkey')) {
        toast.error('Tu sesión es inválida. Cerrando sesión...');
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }
      toast.error('Error al guardar: ' + error.message);
      return;
    }

    // 2. Handle referral if ref code exists
    const refCode = localStorage.getItem('mamacita_ref');
    if (refCode && barberData?.id) {
      await supabase.rpc('create_referral', { ref_code: refCode, new_barber_id: barberData.id });
      localStorage.removeItem('mamacita_ref');
    }

    setLoading(false);
    setStep(4);
    toast.success('¡Bienvenido a MamaCita!');
    await queryClient.refetchQueries({ queryKey: ['barber'] });
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
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className={`h-1.5 w-10 rounded-full transition-colors ${s <= step ? 'gold-gradient' : 'bg-secondary'}`} />
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

        {step === 4 && (
          <div className="space-y-6 text-center">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full gold-gradient flex items-center justify-center">
                <Check className="h-8 w-8 text-primary-foreground" />
              </div>
            </div>
            <h2 className="text-xl font-semibold">¡Todo listo!</h2>
            {assignedPhone ? (
              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">Tu número de MamaCita es:</p>
                <div className="flex items-center justify-center gap-2 bg-secondary p-4 rounded-lg">
                  <Phone className="h-5 w-5 text-primary" />
                  <span className="text-lg font-bold gold-text">{assignedPhone}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(assignedPhone);
                      toast.success('Número copiado');
                    }}
                    className="ml-1 p-1 rounded hover:bg-muted transition-colors"
                  >
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
                <p className="text-muted-foreground text-sm">
                  Compártelo con tus clientes para que puedan agendar citas automáticamente.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                Tu cuenta ha sido creada exitosamente. El número de teléfono será asignado pronto.
              </p>
            )}
            <Button onClick={() => navigate('/dashboard')} className="w-full gold-gradient text-primary-foreground font-semibold">
              Ir al Dashboard <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
