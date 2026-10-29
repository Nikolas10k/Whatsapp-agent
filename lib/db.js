import { createClient } from '@supabase/supabase-js';
import { decifrar } from './cripto.js';

// Linha da tabela "negocios" no formato que o agente e o prompt usam
export function negocioDoBanco(linha) {
  return {
    id: linha.id,
    workspaceId: linha.workspace_id,
    accountId: linha.account_id,
    slug: linha.slug,
    nome: linha.nome,
    nomeAgente: linha.nome_agente,
    objetivo: linha.objetivo,
    ficha: linha.ficha,
    donoWhatsapp: linha.dono_whatsapp,
    contatoHumano: linha.contato_humano,
    ativo: linha.ativo,
  };
}

// Banco real (Supabase). A versão em memória (db-memoria.js) tem a mesma interface, para testes.
export function criarDb(env = process.env) {
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const ok = ({ data, error }) => { if (error) throw error; return data; };

  return {
    // Qual negócio atende este número, e com qual token. null = número desconhecido.
    async contaPorNumero(phoneNumberId) {
      const linha = ok(await sb.from('agente_numeros')
        .select('phone_number_id, access_token, template_aviso, agente_negocios(*)')
        .eq('phone_number_id', phoneNumberId).maybeSingle());
      if (!linha?.agente_negocios) return null;
      return {
        negocio: negocioDoBanco(linha.agente_negocios),
        numero: {
          id: linha.phone_number_id,
          token: linha.access_token ? decifrar(linha.access_token, env) : null,
          templateAviso: linha.template_aviso,
        },
      };
    },

    // Retorna false se a mensagem já foi registrada (a Meta às vezes reenvia o mesmo webhook)
    async registrarMensagem({ negocio, contato, papel, conteudo, waMessageId = null }) {
      const { error } = await sb.from('agente_mensagens').insert({ negocio_id: negocio, contato, papel, conteudo, wa_message_id: waMessageId });
      if (error?.code === '23505') return false;
      if (error) throw error;
      return true;
    },

    async ultimaMensagemDoCliente(negocio, contato) {
      const dados = ok(await sb.from('agente_mensagens').select('wa_message_id')
        .eq('negocio_id', negocio).eq('contato', contato).eq('papel', 'user')
        .order('id', { ascending: false }).limit(1));
      return dados[0]?.wa_message_id ?? null;
    },

    async respostasNaUltimaHora(negocio, contato) {
      const { count, error } = await sb.from('agente_mensagens').select('id', { count: 'exact', head: true })
        .eq('negocio_id', negocio).eq('contato', contato).eq('papel', 'assistant')
        .gte('criado_em', new Date(Date.now() - 3600_000).toISOString());
      if (error) throw error;
      return count ?? 0;
    },

    async historico(negocio, contato, limite = 20) {
      const dados = ok(await sb.from('agente_mensagens').select('papel, conteudo')
        .eq('negocio_id', negocio).eq('contato', contato)
        .order('id', { ascending: false }).limit(limite));
      return dados.reverse();
    },

    async obterLead(negocio, contato) {
      const dados = ok(await sb.from('agente_leads').select('*').eq('negocio_id', negocio).eq('contato', contato).limit(1));
      return dados[0] ?? null;
    },

    async salvarLead(negocio, contato, campos) {
      const limpos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      ok(await sb.from('agente_leads').upsert(
        { negocio_id: negocio, contato, ...limpos, atualizado_em: new Date().toISOString() },
        { onConflict: 'negocio_id,contato' },
      ));
    },
  };
}
