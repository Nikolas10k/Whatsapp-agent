import { montarPrompt } from './prompt.js';

export const FERRAMENTAS = [
  {
    type: 'function',
    function: {
      name: 'registrar_lead',
      description: 'Salva ou atualiza os dados do lead. Chame assim que souber o nome e/ou o interesse, e quando descobrir algo novo.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string', description: 'Nome do cliente' },
          interesse: { type: 'string', description: 'O que o cliente quer, em poucas palavras' },
          detalhes: { type: 'string', description: 'Outras informações úteis para a equipe (prazo, negócio dele, orçamento, etc.)' },
          temperatura: { type: 'string', enum: ['frio', 'morno', 'quente'], description: 'quente = quer comprar/fechar agora' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'transferir_para_humano',
      description: 'Passa a conversa para uma pessoa da equipe e pausa o atendimento automático deste contato.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string', enum: ['quer_fechar', 'orcamento', 'pediu_humano', 'fora_da_ficha', 'reclamacao', 'outro'] },
          resumo: { type: 'string', description: 'Resumo em 1-2 frases para a equipe: quem é, o que quer, o que já foi dito' },
        },
        required: ['motivo', 'resumo'],
      },
    },
  },
];

const MSG_FALHA = 'Recebi sua mensagem! Tive um probleminha aqui, mas já avisei a equipe e alguém te responde por aqui em breve.';
const esperarPadrao = (ms) => new Promise((r) => setTimeout(r, ms));
const daquiHoras = (h) => new Date(Date.now() + h * 3600_000).toISOString();

/**
 * Processa uma mensagem que o cliente mandou.
 * deps: { db, llm, whatsapp, esperar?, debounceMs?, horasPausa?, limiteHistorico? }
 */
export async function receberMensagem(entrada, deps) {
  const { negocio, numero, contato, nomePerfil, waMessageId, texto, referral } = entrada;
  const { db, whatsapp, esperar = esperarPadrao, debounceMs = 3500 } = deps;

  // 1. Memória + proteção contra webhook repetido
  const nova = await db.registrarMensagem({ negocio: negocio.id, contato, papel: 'user', conteudo: texto, waMessageId });
  if (!nova) return { ignorado: 'duplicada' };

  // 2. Lead: cria na primeira mensagem e guarda de qual anúncio veio
  let lead = await db.obterLead(negocio.id, contato);
  const dadosAnuncio = referral ? {
    origem: 'anuncio',
    anuncio_id: referral.source_id,
    anuncio_titulo: referral.headline,
    anuncio_url: referral.source_url,
    ctwa_clid: referral.ctwa_clid,
  } : {};
  if (!lead || (referral && lead.origem !== 'anuncio')) {
    await db.salvarLead(negocio.id, contato, { nome_perfil: nomePerfil, ...dadosAnuncio });
  }

  whatsapp.marcarLidaDigitando(numero, waMessageId);

  // 3. Espera uns segundos: se o cliente mandar mais mensagens em sequência,
  //    só a última dispara a resposta (e ela responde todas de uma vez).
  await esperar(debounceMs);
  if ((await db.ultimaMensagemDoCliente(negocio.id, contato)) !== waMessageId) return { ignorado: 'agrupada' };

  // 4. Humano assumiu a conversa? Então o agente fica quieto.
  lead = await db.obterLead(negocio.id, contato);
  if (lead?.bot_pausado_ate && new Date(lead.bot_pausado_ate) > new Date()) return { ignorado: 'pausado' };

  // 5. Pensa e responde
  let resposta;
  try {
    resposta = await gerarResposta({ negocio, contato, lead, numero }, deps);
  } catch (erro) {
    console.error('[agente] falha ao gerar resposta', erro);
    resposta = MSG_FALHA;
    await db.salvarLead(negocio.id, contato, { status: 'com_humano', bot_pausado_ate: daquiHoras(deps.horasPausa ?? 12) });
    await whatsapp.avisarDono(numero, negocio.donoWhatsapp, {
      negocio: negocio.nome, nome: lead?.nome || lead?.nome_perfil, contato,
      resumo: `O agente deu erro e pausou. Última mensagem: "${texto}"`,
    }).catch(() => {});
  }

  if (!resposta?.trim()) return { ignorado: 'sem_resposta' };
  await whatsapp.enviarTexto(numero, contato, resposta);
  await db.registrarMensagem({ negocio: negocio.id, contato, papel: 'assistant', conteudo: resposta });
  return { resposta };
}

export async function gerarResposta({ negocio, contato, lead, numero }, deps) {
  const { db, llm, whatsapp, horasPausa = 12, limiteHistorico = 20 } = deps;
  const historico = await db.historico(negocio.id, contato, limiteHistorico);

  // Junta mensagens seguidas do mesmo lado (ex.: cliente mandou 3 mensagens)
  const conversa = [];
  for (const { papel, conteudo } of historico) {
    const role = papel === 'user' ? 'user' : 'assistant';
    const ultima = conversa.at(-1);
    if (ultima?.role === role) ultima.content += `\n${conteudo}`;
    else conversa.push({ role, content: conteudo });
  }
  while (conversa[0]?.role === 'assistant') conversa.shift();

  const mensagens = [{ role: 'system', content: montarPrompt(negocio, lead) }, ...conversa];

  const ferramentas = {
    async registrar_lead({ nome, interesse, detalhes, temperatura }) {
      const status = lead?.status && lead.status !== 'novo' ? lead.status : (nome && interesse ? 'qualificado' : 'novo');
      await db.salvarLead(negocio.id, contato, { nome, interesse, detalhes, temperatura, status });
      lead = { ...lead, nome: nome ?? lead?.nome, interesse: interesse ?? lead?.interesse };
      return 'Lead salvo.';
    },
    async transferir_para_humano({ motivo, resumo }) {
      await db.salvarLead(negocio.id, contato, { status: 'com_humano', bot_pausado_ate: daquiHoras(horasPausa) });
      await whatsapp.avisarDono(numero, negocio.donoWhatsapp, {
        negocio: negocio.nome, nome: lead?.nome || lead?.nome_perfil, contato, resumo: `[${motivo}] ${resumo}`,
      }).catch((e) => console.error('[agente] aviso ao dono falhou', e));
      return negocio.contatoHumano
        ? `Transferido. A equipe foi avisada. Diga ao cliente que a equipe vai chamar e passe também o WhatsApp direto: wa.me/${negocio.contatoHumano}`
        : 'Transferido. A equipe foi avisada. Diga ao cliente que alguém vai responder por aqui em breve.';
    },
  };

  for (let rodada = 0; rodada < 4; rodada++) {
    const msg = await llm({ mensagens, ferramentas: FERRAMENTAS });
    if (!msg.tool_calls?.length) return msg.content;

    mensagens.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
    for (const chamada of msg.tool_calls) {
      let resultado;
      try {
        const fn = ferramentas[chamada.function.name];
        const args = JSON.parse(chamada.function.arguments || '{}');
        resultado = fn ? await fn(args) : 'Ferramenta desconhecida.';
      } catch (e) {
        resultado = `Erro: ${e.message}`;
      }
      mensagens.push({ role: 'tool', tool_call_id: chamada.id, content: resultado });
    }
  }
  throw new Error('Modelo entrou em loop de ferramentas');
}

/**
 * Mensagem que a EQUIPE mandou pelo app WhatsApp Business (modo coexistência).
 * Pausa o agente para esse contato. Mandar "#bot" na conversa devolve para o agente.
 */
export async function receberEcoDaEquipe({ negocio, contato, texto, waMessageId }, { db, horasPausa = 12 }) {
  if (texto.trim().toLowerCase() === '#bot') {
    await db.salvarLead(negocio.id, contato, { bot_pausado_ate: null, status: 'qualificado' });
    return { bot: 'reativado' };
  }
  await db.registrarMensagem({ negocio: negocio.id, contato, papel: 'humano', conteudo: texto, waMessageId });
  await db.salvarLead(negocio.id, contato, { status: 'com_humano', bot_pausado_ate: daquiHoras(horasPausa) });
  return { bot: 'pausado' };
}
