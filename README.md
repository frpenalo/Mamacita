# Mamacita

Plataforma de agentes de IA para pequeños negocios (marca sombrilla de Softmedia):

- **Julie (voz):** contesta el teléfono del negocio y maneja la lista de espera walk-in (integrada con NXTUP).
- **Agente de citas (WhatsApp):** el cliente agenda, mueve y cancela su cita por WhatsApp; el barbero la gestiona por WhatsApp o desde el panel.

Contexto completo, reglas y flujo de deploy: [`CLAUDE.md`](CLAUDE.md). Specs y planes: [`planning/`](planning/).

## Stack

- Panel web: Vite + React + TypeScript + shadcn/ui + Tailwind, publicado en Vercel (`tumamacita.com`).
- Backend: Supabase (Postgres + Edge Functions en Deno + Auth + RLS + pg_cron), proyecto `kpgseyfkucnnzdaoqjdq`.
- Voz: VAPI. Mensajería: Twilio (WhatsApp + SMS). Cobros: Stripe.

## Desarrollo local

```sh
npm i
npm run dev
```

## Deploy

- **Panel web:** cada push a `main` publica en Vercel.
- **Edge functions:** `supabase functions deploy <nombre> --use-api`.
- **Migraciones:** `supabase db push`.
