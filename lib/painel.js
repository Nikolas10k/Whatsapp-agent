// Ações do painel do Agente. Quem chama (api/painel.js) já confirmou o login;
// aqui confere se o usuário é membro do workspace dono do agente e executa.

export const STATUS_LEAD = ['novo', 'qualificado', 'com_humano', 'fechado', 'perdido'];
const DIAS_PAUSA_PAINEL = 30; // assumiu pelo painel: o agente fica quieto até alguém devolver
const LIMITES_FICHA = { nome_agente: 60, objetivo: 600, ficha: 20000, dono_whatsapp: 15, contato_humano: 15 };
const LIMITE_RESPOSTA = 4000;

export class ErroPainel extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const daquiDias = (d) => new Date(Date.now() + d * 86400_000).toISOString();

/**
 * acao: assumir | devolver | status | responder | salvar_ficha
 * deps: { db, whatsapp }
 */
export async function executarAcao({ usuarioId, acao, negocioId, contato, dados = {} }, { db, whatsapp }) {
  if (typeof negocioId !== 'string' || !negocioId) throw new ErroPainel(400, 'Agente não informado');
  const papel = await db.papelNoNegocio(usuarioId, negocioId);
  if (!papel) throw new ErroPainel(403, 'Você não tem acesso a este agente');

  if (acao === 'salvar_ficha') {
    if (!['owner', 'admin'].includes(papel)) throw new ErroPainel(403, 'Só o dono ou um administrador pode editar a ficha');
    const campos = {};
    for (const [campo, max] of Object.entries(LIMITES_FICHA)) {
      if (dados[campo] === undefined) continue;
      const valor = String(dados[campo] ?? '').trim();
      if (valor.length > max) throw new ErroPainel(400, `O campo ${campo} passou de ${max} caracteres`);
      if (['dono_whatsapp', 'contato_humano'].includes(campo) && valor && !/^\d{10,15}$/.test(valor)) {
        throw new ErroPainel(400, 'WhatsApp deve ter só números, com DDI e DDD (ex.: 5561999999999)');
      }
      if (['nome_agente', 'objetivo'].includes(campo) && !valor) throw new ErroPainel(400, `O campo ${campo} não pode ficar vazio`);
      campos[campo] = valor || (campo === 'ficha' ? '' : null);
    }
    await db.atualizarNegocio(negocioId, campos);
    return { ok: true };
  }

  // As outras ações são sobre um lead que já conversou com este agente
  if (typeof contato !== 'string' || !/^\d{8,15}$/.test(contato)) throw new ErroPainel(400, 'Contato inválido');
  const lead = await db.obterLead(negocioId, contato);
  if (!lead) throw new ErroPainel(404, 'Lead não encontrado');

  switch (acao) {
    case 'assumir':
      await db.salvarLead(negocioId, contato, { status: 'com_humano', bot_pausado_ate: daquiDias(DIAS_PAUSA_PAINEL) });
      return { ok: true };

    case 'devolver':
      await db.salvarLead(negocioId, contato, {
        status: lead.status === 'com_humano' ? 'qualificado' : lead.status, bot_pausado_ate: null,
      });
      return { ok: true };

    case 'status':
      if (!STATUS_LEAD.includes(dados.status)) throw new ErroPainel(400, 'Status inválido');
      await db.salvarLead(negocioId, contato, { status: dados.status });
      return { ok: true };

    case 'responder': {
      const texto = String(dados.texto ?? '').trim();
      if (!texto) throw new ErroPainel(400, 'Escreva a mensagem');
      if (texto.length > LIMITE_RESPOSTA) throw new ErroPainel(400, `Mensagem com mais de ${LIMITE_RESPOSTA} caracteres`);
      const numero = await db.numeroDoNegocio(negocioId);
      if (!numero) throw new ErroPainel(409, 'Nenhum número de WhatsApp conectado a este agente');
      try {
        await whatsapp.enviarTexto(numero, contato, texto);
      } catch (erro) {
        console.error('[painel] envio falhou', erro);
        throw new ErroPainel(502, 'O WhatsApp não aceitou a mensagem. Se o cliente não escreve há mais de 24h, a Meta só permite modelos aprovados.');
      }
      await db.registrarMensagem({ negocio: negocioId, contato, papel: 'humano', conteudo: texto });
      // Quem responde pelo painel assumiu a conversa: o agente fica quieto
      await db.salvarLead(negocioId, contato, { status: 'com_humano', bot_pausado_ate: daquiDias(DIAS_PAUSA_PAINEL) });
      return { ok: true };
    }

    default:
      throw new ErroPainel(400, 'Ação desconhecida');
  }
}
