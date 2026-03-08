import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QRCodeSVG } from 'qrcode.react';
import { Users, DollarSign, Share2, Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ReferralSectionProps {
  barberId: string;
  referralCode: string | null;
  barberName: string;
  barberEmail?: string;
}

const ReferralSection = ({ barberId, referralCode, barberName, barberEmail }: ReferralSectionProps) => {
  const { data: referrals = [] } = useQuery({
    queryKey: ['referrals', barberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_barber_id', barberId);
      if (error) throw error;
      return data;
    },
    enabled: !!barberId,
  });

  const activeReferrals = referrals.filter((r: any) => r.status === 'active');
  const balance = activeReferrals.length * 5;
  const registerUrl = `https://tumamacita.com/register?ref=${referralCode}`;

  const whatsappText = encodeURIComponent(
    `Únete a MamaCita y automatiza tu barbería con IA. Regístrate aquí: ${registerUrl}`
  );
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

  const handleCashOut = () => {
    if (balance < 50) return;
    const subject = encodeURIComponent(`Solicitud de Cash Out - ${barberName}`);
    const body = encodeURIComponent(
      `Hola,\n\nSolicito el retiro de mi balance de referidos.\n\nNombre: ${barberName}\nEmail: ${barberEmail || 'N/A'}\nReferidos activos: ${activeReferrals.length}\nBalance: $${balance}\nCódigo de referido: ${referralCode}\n\nGracias.`
    );
    window.open(`mailto:admin@tumamacita.com?subject=${subject}&body=${body}`, '_blank');
    toast.success('Se abrió tu cliente de correo para enviar la solicitud');
  };

  if (!referralCode) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" /> Referidos
      </h2>

      {/* QR Code */}
      <div className="bg-card rounded-lg p-4 border border-border flex flex-col items-center gap-3">
        <div className="bg-white p-3 rounded-lg">
          <QRCodeSVG value={registerUrl} size={160} />
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Escanea para registrarse con tu código
        </p>
        <p className="text-xs font-mono text-primary">{referralCode}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-lg p-4 border border-border text-center">
          <Users className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold">{activeReferrals.length}</p>
          <p className="text-xs text-muted-foreground">Referidos activos</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border text-center">
          <DollarSign className="h-5 w-5 text-green-400 mx-auto mb-1" />
          <p className="text-2xl font-bold gold-text">${balance}</p>
          <p className="text-xs text-muted-foreground">Balance</p>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={() => window.open(whatsappUrl, '_blank')}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
        >
          <Share2 className="mr-2 h-4 w-4" /> Compartir por WhatsApp
        </Button>

        <Button
          onClick={handleCashOut}
          variant="outline"
          className="w-full border-primary text-primary"
          disabled={balance < 50}
        >
          <Banknote className="mr-2 h-4 w-4" />
          {balance < 50 ? `Cash Out (mín. $50)` : `Solicitar Cash Out ($${balance})`}
        </Button>
      </div>

      {/* Referral list */}
      {referrals.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Historial</p>
          {referrals.map((r: any) => (
            <div key={r.id} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
              <span className="text-sm">Referido</span>
              <span className={`text-xs px-2 py-1 rounded-full ${
                r.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {r.status === 'active' ? 'Activo' : 'Pendiente'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export default ReferralSection;
