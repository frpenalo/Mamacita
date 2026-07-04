import { useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Copy, Download, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

// Número compartido de MamaCita (WhatsApp). El código del barbero identifica la cuenta.
const WA_NUMBER = '19844009792';

interface Props {
  waCode: string;
}

const WhatsAppLinkCard = ({ waCode }: Props) => {
  const link = `https://wa.me/${WA_NUMBER}?text=agendar-${waCode}`;
  const qrWrapRef = useRef<HTMLDivElement>(null);

  const copyLink = () => {
    navigator.clipboard.writeText(link);
    toast.success('Link copiado');
  };

  const downloadQR = () => {
    const canvas = qrWrapRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `mamacita-${waCode}.png`;
    a.click();
    toast.success('QR descargado');
  };

  return (
    <div className="bg-card rounded-lg p-4 border border-border space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Tu link para clientes</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Comparte esto para que tus clientes agenden citas por WhatsApp. Pégalo en tus redes o
        imprime el QR para tu local.
      </p>

      {/* QR sobre fondo blanco (para que escanee bien) */}
      <div ref={qrWrapRef} className="flex justify-center">
        <div className="bg-white p-3 rounded-lg">
          <QRCodeCanvas value={link} size={168} level="M" />
        </div>
      </div>

      {/* Link con copiar rápido */}
      <div className="flex items-center gap-2 bg-secondary rounded-lg p-2.5">
        <span className="text-xs text-muted-foreground truncate flex-1">{link}</span>
        <button
          onClick={copyLink}
          className="p-1.5 rounded-md hover:bg-muted transition-colors flex-shrink-0"
          aria-label="Copiar link"
        >
          <Copy className="h-4 w-4 text-primary" />
        </button>
      </div>

      {/* Acciones */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={copyLink}
          className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-secondary text-sm hover:bg-secondary/80 transition-colors"
        >
          <Copy className="h-4 w-4" /> Copiar link
        </button>
        <button
          onClick={downloadQR}
          className="flex items-center justify-center gap-2 p-2.5 rounded-lg bg-secondary text-sm hover:bg-secondary/80 transition-colors"
        >
          <Download className="h-4 w-4" /> Descargar QR
        </button>
      </div>
    </div>
  );
};

export default WhatsAppLinkCard;
