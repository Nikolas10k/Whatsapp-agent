// Regras de cobrança: o que cada evento do Asaas faz com a assinatura do cliente,
// e se o cliente está em dia para usar um produto.

export const DIAS_CARENCIA = 3;

// Vencimento 'AAAA-MM-DD' + 1 mês, no fim do dia (horário de Brasília).
// Dia 31 em mês curto cai no último dia do mês seguinte.
export function umMesDepois(vencimento) {
  const [a, m, d] = vencimento.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimoDia), 23 + 3, 59, 59)).toISOString();
}

/**
 * O workspace pode usar o produto ('agente' ou 'publi')?
 * assinaturas: [{ status, periodo_fim, produto }] — produto do plano ('agente' | 'publi' | 'combo').
 */
export function emDia(assinaturas, produto, agora = new Date()) {
  const limite = agora.getTime() - DIAS_CARENCIA * 86400_000;
  return assinaturas.some((a) => {
    if (a.produto !== produto && a.produto !== 'combo') return false;
    if (a.status === 'cortesia') return true;
    if (!['teste', 'ativa', 'atrasada'].includes(a.status)) return false;
    return Boolean(a.periodo_fim) && new Date(a.periodo_fim).getTime() > limite;
  });
}

/**
 * Processa um evento do webhook do Asaas.
 * Não confia no corpo: busca a cobrança na API antes de mudar qualquer coisa.
 * Pode receber o mesmo evento mais de uma vez: todas as mudanças são idempotentes.
 * deps: { db, asaas }
 */
export async function processarEventoAsaas(evento, { db, asaas }) {
  const tipo = evento?.event ?? '';

  if (tipo === 'SUBSCRIPTION_DELETED' || tipo === 'SUBSCRIPTION_INACTIVATED') {
    const assinatura = await db.assinaturaPorAsaas(evento.subscription?.id);
    if (assinatura) await db.atualizarAssinatura(assinatura.id, { status: 'cancelada' });
    return { feito: assinatura ? 'cancelada' : 'desconhecida' };
  }

  if (!tipo.startsWith('PAYMENT_') || !evento.payment?.id) return { feito: 'ignorado' };

  const cobranca = await asaas.obterCobranca(evento.payment.id);
  if (!cobranca.subscription) return { feito: 'avulsa' };
  const assinatura = await db.assinaturaPorAsaas(cobranca.subscription);
  if (!assinatura) return { feito: 'desconhecida' };

  switch (tipo) {
    case 'PAYMENT_CONFIRMED':
    case 'PAYMENT_RECEIVED': {
      const novoFim = umMesDepois(cobranca.dueDate);
      const fim = assinatura.periodo_fim && assinatura.periodo_fim > novoFim ? assinatura.periodo_fim : novoFim;
      await db.atualizarAssinatura(assinatura.id, { status: 'ativa', periodo_fim: fim, link_pagamento: null });
      return { feito: 'paga' };
    }
    case 'PAYMENT_CREATED':
    case 'PAYMENT_UPDATED':
      // Guarda o link da fatura em aberto para mostrar ao cliente
      if (['PENDING', 'OVERDUE'].includes(cobranca.status)) {
        await db.atualizarAssinatura(assinatura.id, { link_pagamento: cobranca.invoiceUrl });
      }
      return { feito: 'link' };
    case 'PAYMENT_OVERDUE':
      if (assinatura.status === 'cancelada') return { feito: 'ignorado' };
      await db.atualizarAssinatura(assinatura.id, { status: 'atrasada', link_pagamento: cobranca.invoiceUrl });
      return { feito: 'atrasada' };
    case 'PAYMENT_REFUNDED':
    case 'PAYMENT_CHARGEBACK_REQUESTED':
      await db.atualizarAssinatura(assinatura.id, { status: 'atrasada', periodo_fim: new Date().toISOString() });
      return { feito: 'estornada' };
    default:
      return { feito: 'ignorado' };
  }
}
