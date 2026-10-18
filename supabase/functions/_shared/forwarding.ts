// _shared/forwarding.ts — instrucciones de DESVÍO de llamadas para el dueño.
// El dueño mantiene su número de siempre y lo desvía al número que le provisionamos
// (forwardTo). El desvío se configura en SU operador; nosotros no lo podemos activar por él,
// solo guiarlo. Los códigos varían por operador: damos los comunes y pedimos confirmarlos.

export interface ForwardingGuide {
  forward_to: string;
  recommended: "conditional" | "unconditional";
  es: { title: string; steps: string[]; note: string };
  en: { title: string; steps: string[]; note: string };
}

export function forwardingInstructions(forwardTo: string): ForwardingGuide {
  return {
    forward_to: forwardTo,
    // Recomendado: condicional (desvía solo si no contestan), así el negocio sigue pudiendo
    // atender y Julie es el respaldo. Unconditional = Julie contesta TODO.
    recommended: "conditional",
    es: {
      title: `Desvía tu número hacia ${forwardTo}`,
      steps: [
        `Desde el teléfono de tu número de siempre, activa el desvío de llamadas hacia ${forwardTo}.`,
        `Para desviar SOLO cuando no contestan (recomendado): marca *61*${forwardTo}# y llama. Para quitarlo: ##61#.`,
        `Para desviar TODAS las llamadas a Julie: marca *72${forwardTo} y llama. Para quitarlo: *73.`,
        `Si tu operador usa otros códigos o prefieres su app, busca "desvío de llamadas" y pon como destino ${forwardTo}.`,
        `Haz una llamada de prueba a tu número para confirmar que Julie contesta.`,
      ],
      note:
        "Tus clientes siguen marcando tu número de siempre; no cambia nada para ellos. El desvío es reversible cuando quieras. Los minutos de desvío los cobra tu operador.",
    },
    en: {
      title: `Forward your number to ${forwardTo}`,
      steps: [
        `From your current business line, turn on call forwarding to ${forwardTo}.`,
        `To forward ONLY when unanswered (recommended): dial *61*${forwardTo}# and call. To remove: ##61#.`,
        `To forward ALL calls to Julie: dial *72${forwardTo} and call. To remove: *73.`,
        `If your carrier uses different codes or you prefer their app, look for "call forwarding" and set the destination to ${forwardTo}.`,
        `Make a test call to your number to confirm Julie answers.`,
      ],
      note:
        "Your customers keep dialing your usual number; nothing changes for them. Forwarding is reversible anytime. Forwarding minutes are billed by your carrier.",
    },
  };
}
