import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import logoIcon from '@/assets/logo.ico';
import { toast } from 'sonner';

const Register = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get('ref');

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
    } else {
      // Store referral code for use during onboarding
      if (refCode) {
        localStorage.setItem('mamacita_ref', refCode);
      }
      toast.success('Cuenta creada. Revisa tu correo para confirmar.');
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <img src={logoIcon} alt="MamaCita" className="h-14 w-14" />
            <h1 className="text-3xl font-bold gold-text">MamaCita</h1>
          </div>
          <p className="text-lg font-medium text-foreground">Crea tu cuenta</p>
        </div>

        <form onSubmit={handleRegister} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" type="email" placeholder="tu@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input id="confirmPassword" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full gold-gradient text-primary-foreground font-semibold" disabled={loading}>
            {loading ? 'Creando cuenta...' : 'Registrarse'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Register;
