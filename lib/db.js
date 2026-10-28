import { createClient } from '@supabase/supabase-js';

// Banco real (Supabase). A versão em memória (db-memoria.js) tem a mesma interface, para testes.
export function criarDb(env = process.env) {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    // Retorna false se a mensagem já foi registrada (a Meta às vezes reenvia o mesmo webhook)
    async registrarMensagem({ negocio, contato, papel, conteudo, waMessageId = null }) {
      const { error } = await sb.from('mensagens').insert({ negocio, contato, papel, conteudo, wa_message_id: waMessageId });
      if (error?.code === '23505') return false;
      if (error) throw error;
      return true;
    },

    async ultimaMensagemDoCliente(negocio, contato) {
      const dados = ok(await sb.from('mensagens').select('wa_message_id')
        .eq('negocio', negocio).eq('contato', contato).eq('papel', 'user')
        .order('id', { ascending: false }).limit(1));
      return dados[0]?.wa_message_id ?? null;
    },

    async historico(negocio, contato, limite = 20) {
      const dados = ok(await sb.from('mensagens').select('papel, conteudo')
        .eq('negocio', negocio).eq('contato', contato)
        .order('id', { ascending: false }).limit(limite));
      return dados.reverse();
    },

    async obterLead(negocio, contato) {
      const dados = ok(await sb.from('leads').select('*').eq('negocio', negocio).eq('contato', contato).limit(1));
      return dados[0] ?? null;
    },

    async salvarLead(negocio, contato, campos) {
      const limpos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      ok(await sb.from('leads').upsert(
        { negocio, contato, ...limpos, atualizado_em: new Date().toISOString() },
        { onConflict: 'negocio,contato' },
      ));
    },
  };
}
