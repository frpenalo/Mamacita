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
  // Mensaje pre-llenado: instrucción clara + el código integrado, para que el cliente
  // sepa que solo debe ENVIARLO y no borre el código. El webhook detecta "agendar-CODE"
  // (contiguo); el resto es guía. "reservar" (no "agendar") en la instrucción evita
  // que el regex del código haga match antes de tiempo.
  const message = `Envía este mensaje para reservar tu cita ✂️ agendar-${waCode}`;
  const link = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
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
    <div className="bg-card rounded-xl border border-border p-5 max-w-md mx-auto">
      {/* Encabezado */}
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary shrink-0" />
        <h2 className="text-base font-semibold">Tu link para clientes</h2>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
        Compártelo para que tus clientes agenden por WhatsApp. Pégalo en tus redes o imprime el QR para tu local.
      </p>
      <p className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground leading-relaxed">
        Al abrirlo, tu cliente ve este mensaje listo para enviar:<br />
        <span className="text-foreground">“Envía este mensaje para reservar tu cita ✂️ agendar-{waCode}”</span>
      </p>

      {/* QR sobre fondo blanco (para que escanee bien) */}
      <div ref={qrWrapRef} className="mt-4 flex justify-center">
        <div className="bg-white p-3 rounded-xl">
          <QRCodeCanvas value={link} size={150} level="M" />
        </div>
      </div>

      {/* Campo de link con el botón Copiar adosado — queda claro qué copiar */}
      <div className="mt-4">
        <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Tu link</span>
        <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-background">
          <span className="flex-1 min-w-0 self-center truncate px-3 py-2.5 text-xs text-muted-foreground">
            {link}
          </span>
          <button
            onClick={copyLink}
            className="flex shrink-0 items-center gap-1.5 px-4 gold-gradient text-sm font-semibold text-primary-foreground"
          >
            <Copy className="h-4 w-4" /> Copiar
          </button>
        </div>
      </div>

      {/* Acción secundaria */}
      <button
        onClick={downloadQR}
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm text-foreground transition-colors hover:bg-secondary"
      >
        <Download className="h-4 w-4" /> Descargar QR
      </button>
    </div>
  );
};

export default WhatsAppLinkCard;
