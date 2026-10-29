import { criarAsaas } from '../lib/asaas.js';
import { processarEventoAsaas } from '../lib/cobranca.js';
import { criarDb } from '../lib/db.js';
import { iguaisSeguro } from '../lib/whatsapp.js';

// Webhook do Asaas: pagamentos e assinaturas da plataforma.
// O Asaas manda o token configurado no cabeçalho asaas-access-token.
export async function POST(request) {
  if (!process.env.ASAAS_WEBHOOK_TOKEN) console.error('[asaas] ASAAS_WEBHOOK_TOKEN não configurado: recusando tudo');
  if (!iguaisSeguro(request.headers.get('asaas-access-token'), process.env.ASAAS_WEBHOOK_TOKEN)) {
    return new Response('Token inválido', { status: 401 });
  }

  let evento;
  try { evento = JSON.parse(await request.text()); } catch { return new Response('JSON inválido', { status: 400 }); }

  try {
    const r = await processarEventoAsaas(evento, { db: criarDb(), asaas: criarAsaas() });
    console.log('[asaas]', evento.event, r.feito);
  } catch (erro) {
    // Responde erro para o Asaas tentar de novo mais tarde
    console.error('[asaas] falha ao processar', evento.event, erro);
    return new Response('erro', { status: 500 });
  }
  return new Response('ok', { status: 200 });
}
