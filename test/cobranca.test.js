import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emDia, umMesDepois, processarEventoAsaas } from '../lib/cobranca.js';
import { criarDbMemoria } from '../lib/db-memoria.js';
import { processarEventos } from '../lib/webhook.js';

const agora = new Date('2026-10-28T12:00:00Z');
const dias = (n) => new Date(agora.getTime() + n * 86400_000).toISOString();

test('um mês depois do vencimento, inclusive no fim do mês', () => {
  assert.equal(umMesDepois('2026-10-28'), '2026-11-29T02:59:59.000Z'); // 28/11 23:59:59 em Brasília
  assert.equal(umMesDepois('2026-01-31'), '2026-03-01T02:59:59.000Z'); // 28/02 23:59:59 em Brasília
  assert.equal(umMesDepois('2026-12-15'), '2027-01-16T02:59:59.000Z');
});

test('em dia: pago, carência de 3 dias, cortesia, produto certo', () => {
  const ag = (status, fim, produto = 'agente') => [{ status, periodo_fim: fim, produto }];
  assert.equal(emDia(ag('ativa', dias(10)), 'agente', agora), true);
  assert.equal(emDia(ag('atrasada', dias(-2)), 'agente', agora), true, 'ainda na carência');
  assert.equal(emDia(ag('atrasada', dias(-4)), 'agente', agora), false, 'passou da carência');
  assert.equal(emDia(ag('aguardando', null), 'agente', agora), false, 'primeira fatura não paga');
  assert.equal(emDia(ag('cancelada', dias(10)), 'agente', agora), false);
  assert.equal(emDia(ag('cortesia', null), 'agente', agora), true);
  assert.equal(emDia(ag('ativa', dias(10), 'publi'), 'agente', agora), false, 'plano de outro produto');
  assert.equal(emDia(ag('ativa', dias(10), 'combo'), 'agente', agora), true, 'combo inclui os dois');
  assert.equal(emDia([], 'agente', agora), false);
});

function montar(cobranca, assinatura) {
  const db = criarDbMemoria({ assinaturas: [{ id: 'a1', asaas_subscription_id: 'sub_1', status: 'aguardando', periodo_fim: null, ...assinatura }] });
  const consultadas = [];
  const asaas = { obterCobranca: async (id) => { consultadas.push(id); return { id, subscription: 'sub_1', ...cobranca }; } };
  return { db, asaas, consultadas, assinatura: db.assinaturas[0] };
}

test('pagamento recebido ativa e estende até um mês depois do vencimento', async () => {
  const { db, asaas, consultadas, assinatura } = montar({ dueDate: '2026-10-28', status: 'RECEIVED' });
  await processarEventoAsaas({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }, { db, asaas });
  assert.equal(assinatura.status, 'ativa');
  assert.equal(assinatura.periodo_fim, '2026-11-29T02:59:59.000Z');
  assert.deepEqual(consultadas, ['pay_1'], 'confere a cobrança na API, não no corpo do webhook');
});

test('evento repetido não estende duas vezes', async () => {
  const { db, asaas, assinatura } = montar({ dueDate: '2026-10-28', status: 'RECEIVED' });
  const evento = { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } };
  await processarEventoAsaas(evento, { db, asaas });
  await processarEventoAsaas({ ...evento, event: 'PAYMENT_CONFIRMED' }, { db, asaas });
  await processarEventoAsaas(evento, { db, asaas });
  assert.equal(assinatura.periodo_fim, '2026-11-29T02:59:59.000Z');
});

test('pagamento antigo chegando atrasado não encurta o período', async () => {
  const { db, asaas, assinatura } = montar({ dueDate: '2026-09-28', status: 'RECEIVED' }, { status: 'ativa', periodo_fim: '2026-11-29T02:59:59.000Z' });
  await processarEventoAsaas({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_0' } }, { db, asaas });
  assert.equal(assinatura.periodo_fim, '2026-11-29T02:59:59.000Z');
});

test('fatura vencida marca atrasada e guarda o link; estorno corta na hora', async () => {
  const { db, asaas, assinatura } = montar({ dueDate: '2026-11-28', status: 'OVERDUE', invoiceUrl: 'https://asaas/i/1' }, { status: 'ativa', periodo_fim: dias(1) });
  await processarEventoAsaas({ event: 'PAYMENT_OVERDUE', payment: { id: 'pay_2' } }, { db, asaas });
  assert.equal(assinatura.status, 'atrasada');
  assert.equal(assinatura.link_pagamento, 'https://asaas/i/1');
  await processarEventoAsaas({ event: 'PAYMENT_REFUNDED', payment: { id: 'pay_2' } }, { db, asaas });
  assert.ok(new Date(assinatura.periodo_fim) <= new Date());
});

test('assinatura cancelada no Asaas é cancelada aqui', async () => {
  const { db, asaas, assinatura } = montar({}, { status: 'ativa' });
  await processarEventoAsaas({ event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } }, { db, asaas });
  assert.equal(assinatura.status, 'cancelada');
});

test('cobrança avulsa ou de assinatura desconhecida não mexe em nada', async () => {
  const { db, asaas, assinatura } = montar({ subscription: null, dueDate: '2026-10-28' });
  const r = await processarEventoAsaas({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_9' } }, { db, asaas });
  assert.equal(r.feito, 'avulsa');
  assert.equal(assinatura.status, 'aguardando');
});

test('agente não responde cliente com assinatura vencida', async () => {
  const enviados = [];
  const negocio = { id: 'n1', nome: 'Loja', nomeAgente: 'Lu', objetivo: 'x', ficha: 'x', ativo: true };
  const deps = {
    db: criarDbMemoria({ contas: [{ negocio, numero: { id: '111' }, emDia: false }] }),
    esperar: async () => {},
    whatsapp: { enviarTexto: async (_n, _p, t) => enviados.push(t), marcarLidaDigitando: () => {}, avisarDono: async () => {} },
    llm: async () => ({ content: 'oi' }),
  };
  await processarEventos([{ tipo: 'cliente', phoneNumberId: '111', contato: '55', waMessageId: 'm1', texto: 'oi' }], deps);
  assert.equal(enviados.length, 0);
});
