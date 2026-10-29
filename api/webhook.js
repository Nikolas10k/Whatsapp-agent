import { waitUntil } from '@vercel/functions';
import { assinaturaValida, criarWhatsapp, iguaisSeguro } from '../lib/whatsapp.js';
import { criarDb } from '../lib/db.js';
import { chamarModelo } from '../lib/llm.js';
import { extrairEventos, processarEventos } from '../lib/webhook.js';

// GET: a Meta chama uma vez para confirmar que o webhook é seu.
export function GET(request) {
  const url = new URL(request.url);
  const ok = url.searchParams.get('hub.mode') === 'subscribe'
    && iguaisSeguro(url.searchParams.get('hub.verify_token'), process.env.WHATSAPP_VERIFY_TOKEN);
  return ok
    ? new Response(url.searchParams.get('hub.challenge'), { status: 200 })
    : new Response('Token inválido', { status: 403 });
}

// POST: cada mensagem nova chega aqui.
export async function POST(request) {
  if (!process.env.WHATSAPP_APP_SECRET) console.error('[webhook] WHATSAPP_APP_SECRET não configurado: recusando tudo');
  const bruto = await request.text();
  const assinatura = request.headers.get('x-hub-signature-256');
  if (!assinaturaValida(bruto, assinatura, process.env.WHATSAPP_APP_SECRET)) {
    // Com assinatura e não bate: quase sempre é WHATSAPP_APP_SECRET de outro app da Meta
    console.warn(`[webhook] assinatura recusada (${assinatura ? 'não confere com WHATSAPP_APP_SECRET' : 'sem cabeçalho'})`);
    return new Response('Assinatura inválida', { status: 401 });
  }

  let corpo;
  try { corpo = JSON.parse(bruto); } catch { return new Response('JSON inválido', { status: 400 }); }

  const eventos = extrairEventos(corpo);
  if (eventos.length) {
    const deps = {
      db: criarDb(),
      whatsapp: criarWhatsapp(),
      llm: (args) => chamarModelo(args),
      debounceMs: Number(process.env.AGRUPAR_MS ?? 3500),
      horasPausa: Number(process.env.HORAS_PAUSA ?? 12),
    };
    // Responde 200 na hora para a Meta e continua processando em segundo plano
    waitUntil(processarEventos(eventos, deps));
  }
  return new Response('ok', { status: 200 });
}
