import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QRCodeSVG } from 'qrcode.react';
import { Users, DollarSign, Share2, Banknote, UserCheck, UserX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface ReferralSectionProps {
  barberId: string;
  referralCode: string | null;
  referralBalance: number;
  barberName: string;
  barberEmail?: string;
}

const ReferralSection = ({ barberId, referralCode, referralBalance, barberName, barberEmail }: ReferralSectionProps) => {
  const { data: referrals = [] } = useQuery({
    queryKey: ['referrals', barberId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_my_referrals', { p_barber_id: barberId });
      if (error) throw error;
      return data;
    },
    enabled: !!barberId,
  });

  const activeReferrals = referrals.filter((r: any) => r.status === 'active');
  const balance = referralBalance;
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

      {/* Referral list with names */}
      <div className="space-y-2">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Users className="h-4 w-4 text-primary" /> Mis referidos
        </p>
        {referrals.length === 0 ? (
          <div className="bg-card rounded-lg p-4 border border-border text-center">
            <p className="text-sm text-muted-foreground">
              Aún no tienes referidos. ¡Comparte tu link!
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {referrals.map((r: any) => {
              const isActive = r.status === 'active';
              const referred = r.referred as { name: string; shop_name: string } | null;
              return (
                <div key={r.id} className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isActive ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                      {isActive ? <UserCheck className="h-4 w-4 text-green-400" /> : <UserX className="h-4 w-4 text-yellow-400" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{referred?.name || 'Referido'}</p>
                      <p className="text-xs text-muted-foreground">{referred?.shop_name || ''}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                    isActive ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
                  }`}>
                    {isActive ? 'Activo' : 'Pendiente'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

export default ReferralSection;
