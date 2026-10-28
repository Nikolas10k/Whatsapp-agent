import { createClient } from '@supabase/supabase-js';
import { decifrar } from './cripto.js';

// Linha da tabela "negocios" no formato que o agente e o prompt usam
export function negocioDoBanco(linha) {
  return {
    id: linha.id,
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
      const linha = ok(await sb.from('numeros_whatsapp')
        .select('phone_number_id, access_token, template_aviso, negocios(*)')
        .eq('phone_number_id', phoneNumberId).maybeSingle());
      if (!linha?.negocios) return null;
      return {
        negocio: negocioDoBanco(linha.negocios),
        numero: {
          id: linha.phone_number_id,
          token: linha.access_token ? decifrar(linha.access_token, env) : null,
          templateAviso: linha.template_aviso,
        },
      };
    },

    // Retorna false se a mensagem já foi registrada (a Meta às vezes reenvia o mesmo webhook)
    async registrarMensagem({ negocio, contato, papel, conteudo, waMessageId = null }) {
      const { error } = await sb.from('mensagens').insert({ negocio_id: negocio, contato, papel, conteudo, wa_message_id: waMessageId });
      if (error?.code === '23505') return false;
      if (error) throw error;
      return true;
    },

    async ultimaMensagemDoCliente(negocio, contato) {
      const dados = ok(await sb.from('mensagens').select('wa_message_id')
        .eq('negocio_id', negocio).eq('contato', contato).eq('papel', 'user')
        .order('id', { ascending: false }).limit(1));
      return dados[0]?.wa_message_id ?? null;
    },

    async historico(negocio, contato, limite = 20) {
      const dados = ok(await sb.from('mensagens').select('papel, conteudo')
        .eq('negocio_id', negocio).eq('contato', contato)
        .order('id', { ascending: false }).limit(limite));
      return dados.reverse();
    },

    async obterLead(negocio, contato) {
      const dados = ok(await sb.from('leads').select('*').eq('negocio_id', negocio).eq('contato', contato).limit(1));
      return dados[0] ?? null;
    },

    async salvarLead(negocio, contato, campos) {
      const limpos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      ok(await sb.from('leads').upsert(
        { negocio_id: negocio, contato, ...limpos, atualizado_em: new Date().toISOString() },
        { onConflict: 'negocio_id,contato' },
      ));
    },
  };
}
