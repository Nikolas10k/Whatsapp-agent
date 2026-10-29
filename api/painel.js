import { createClient } from '@supabase/supabase-js';
import { criarDb } from '../lib/db.js';
import { criarWhatsapp } from '../lib/whatsapp.js';
import { executarAcao, ErroPainel } from '../lib/painel.js';

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

// Ações do painel (assumir, devolver, responder, status, editar ficha).
// O navegador manda o token de login do Supabase; aqui ele é conferido no próprio Supabase.
export async function POST(request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ erro: 'Faça login de novo' }, 401);

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return json({ erro: 'Faça login de novo' }, 401);

  const bruto = await request.text();
  if (bruto.length > 50_000) return json({ erro: 'Pedido grande demais' }, 413);
  let corpo;
  try { corpo = JSON.parse(bruto); } catch { return json({ erro: 'Pedido inválido' }, 400); }

  try {
    const r = await executarAcao({
      usuarioId: data.user.id,
      acao: corpo.acao,
      negocioId: corpo.negocio_id,
      contato: corpo.contato,
      dados: corpo.dados ?? {},
    }, { db: criarDb(), whatsapp: criarWhatsapp() });
    return json(r);
  } catch (erro) {
    if (erro instanceof ErroPainel) return json({ erro: erro.message }, erro.status);
    console.error('[painel] falha', corpo.acao, erro);
    return json({ erro: 'Não foi possível concluir agora. Tente de novo.' }, 500);
  }
}
