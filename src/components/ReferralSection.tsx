import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QRCodeSVG } from 'qrcode.react';
import { Users, CreditCard, Share2, UserCheck, UserX, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReferralSectionProps {
  barberId: string;
  referralCode: string | null;
  referralCredits: number;
  barberName: string;
}

const ReferralSection = ({ barberId, referralCode, referralCredits, barberName }: ReferralSectionProps) => {
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
  const credits = referralCredits;
  const registerUrl = `https://tumamacita.com/register?ref=${referralCode}`;

  const whatsappText = encodeURIComponent(
    `Únete a MamaCita y automatiza tu barbería con IA. Regístrate aquí: ${registerUrl}`
  );
  const whatsappUrl = `https://wa.me/?text=${whatsappText}`;

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

      {/* Credits & Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-lg p-4 border border-border text-center">
          <Users className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold">{activeReferrals.length}</p>
          <p className="text-xs text-muted-foreground">Referidos activos</p>
        </div>
        <div className="bg-card rounded-lg p-4 border border-border text-center">
          <Gift className="h-5 w-5 text-green-400 mx-auto mb-1" />
          <p className="text-2xl font-bold gold-text">${credits.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">Crédito acumulado</p>
        </div>
      </div>

      {/* Credit info */}
      {credits > 0 && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-start gap-2">
          <CreditCard className="h-4 w-4 text-green-400 mt-0.5 shrink-0" />
          <p className="text-sm text-green-300">
            Se descontarán <span className="font-bold">${credits.toFixed(2)}</span> de tu próximo cobro mensual.
          </p>
        </div>
      )}

      {/* How it works */}
      <div className="bg-card rounded-lg p-3 border border-border">
        <p className="text-xs text-muted-foreground">
          💡 Por cada referido que complete su 2do mes de pago, recibes <span className="text-primary font-semibold">$10 de crédito</span> que se aplica automáticamente a tu próximo cobro.
        </p>
      </div>

      {/* Share */}
      <Button
        onClick={() => window.open(whatsappUrl, '_blank')}
        className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
      >
        <Share2 className="mr-2 h-4 w-4" /> Compartir por WhatsApp
      </Button>

      {/* Referral list */}
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
              return (
                <div key={r.id} className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${isActive ? 'bg-green-500/20' : 'bg-yellow-500/20'}`}>
                      {isActive ? <UserCheck className="h-4 w-4 text-green-400" /> : <UserX className="h-4 w-4 text-yellow-400" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{r.referred_name || 'Referido'}</p>
                      <p className="text-xs text-muted-foreground">{r.referred_shop || ''}</p>
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
