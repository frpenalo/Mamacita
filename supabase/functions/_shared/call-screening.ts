// _shared/call-screening.ts — pre-filtro anti-spam de voz (capa 1: antes de contestar).
//
// Barato y en NUESTRO webhook (vapi-assistant-request). Solo mata lo obvio:
//   - blocklist manual (números/prefijos) — efecto limitado por spoofing, para casos puntuales
//   - rate-limit por número (muchas llamadas en poca ventana) — atrapa robocalls en loop
// Sin número (oculto/anónimo): NO se bloquea aquí — pasa al gate de CONTENIDO de Julie.
// La capa fuerte contra el spam de ventas (que rota números) es Julie detectando el pitch.

// deno-lint-ignore no-explicit-any
type Supa = any;

const RATE_WINDOW_MIN = 10; // ventana
const RATE_MAX_CALLS = 5;   // máx. llamadas contestadas por número en la ventana

export interface Screen {
  block: boolean;
  reason?: "blocklist" | "rate_limit";
}

export async function screenCaller(supabase: Supa, callerPhone: string | null): Promise<Screen> {
  // Anónimo/oculto: no se bloquea por número (perderíamos clientes reales) → gate de contenido.
  if (!callerPhone) return { block: false };
  const norm = callerPhone.replace(/\D/g, "");
  if (!norm) return { block: false };

  try {
    // 1. Blocklist (número exacto o prefijo). Tabla chica → se evalúa en memoria.
    const { data: blocked } = await supabase.from("blocked_callers").select("pattern");
    for (const b of blocked || []) {
      const p = String(b.pattern || "").replace(/\D/g, "");
      if (p && (norm === p || norm.startsWith(p))) return { block: true, reason: "blocklist" };
    }

    // 2. Rate-limit: cuántas llamadas de este número en la ventana (solo cuenta las contestadas,
    //    porque las rechazadas no se registran → la N+1 se rechaza y se recupera al deslizar).
    const since = new Date(Date.now() - RATE_WINDOW_MIN * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("caller_phone", callerPhone)
      .gte("started_at", since);
    if ((count ?? 0) >= RATE_MAX_CALLS) return { block: true, reason: "rate_limit" };
  } catch (err) {
    // Fail-open: si el screening falla, NO bloqueamos (mejor dejar pasar que colgarle a un cliente).
    console.error("[call-screening] error:", err);
    return { block: false };
  }

  return { block: false };
}
