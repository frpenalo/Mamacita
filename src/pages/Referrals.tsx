import { useBarber } from '@/hooks/useBarber';
import BottomNav from '@/components/BottomNav';
import ReferralSection from '@/components/ReferralSection';
import logoIcon from '@/assets/logo.ico';

const Referrals = () => {
  const { data: barber } = useBarber();

  return (
    <div className="min-h-screen pb-20">
      <div className="px-4 pt-6 pb-4 flex items-center gap-2">
        <img src={logoIcon} alt="MamaCita" className="h-10 w-10" />
        <span className="text-lg font-bold gold-text">MamaCita</span>
      </div>

      <div className="px-4">
        {barber ? (
          <ReferralSection
            barberId={barber.id}
            referralCode={barber.referral_code}
            referralCredits={Number(barber.referral_credits) || 0}
            barberName={barber.name}
          />
        ) : (
          <div className="bg-card rounded-lg p-6 text-center">
            <p className="text-muted-foreground">Cargando...</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
};

export default Referrals;
