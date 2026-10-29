import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarAcao, ErroPainel } from '../lib/painel.js';
import { criarDbMemoria } from '../lib/db-memoria.js';

const negocio = { id: 'n1', nome: 'Loja', nomeAgente: 'Lu', objetivo: 'vender', ficha: 'x', ativo: true };

async function montar({ papel = 'owner', comNumero = true } = {}) {
  const db = criarDbMemoria({
    contas: comNumero ? [{ negocio, numero: { id: 'PN1', token: 'T' } }] : [],
    membros: [{ negocioId: 'n1', usuarioId: 'u1', papel }],
  });
  await db.salvarLead('n1', '5561988887777', { nome: 'Ana' });
  const enviados = [];
  const whatsapp = { enviarTexto: async (numero, para, texto) => enviados.push({ numero, para, texto }) };
  const acao = (acao, extra = {}) => executarAcao({ usuarioId: 'u1', acao, negocioId: 'n1', contato: '5561988887777', ...extra }, { db, whatsapp });
  return { db, enviados, acao };
}

const falhaCom = (status) => (e) => e instanceof ErroPainel && e.status === status;

test('quem não é membro do workspace não mexe em nada', async () => {
  const { db, enviados } = await montar();
  await assert.rejects(
    executarAcao({ usuarioId: 'intruso', acao: 'responder', negocioId: 'n1', contato: '5561988887777', dados: { texto: 'oi' } }, { db, whatsapp: { enviarTexto: async () => enviados.push(1) } }),
    falhaCom(403),
  );
  assert.equal(enviados.length, 0);
});

test('responder envia pelo número do agente, registra como equipe e pausa o agente', async () => {
  const { db, enviados, acao } = await montar();
  await acao('responder', { dados: { texto: '  Oi Ana, aqui é o Nikolas  ' } });
  assert.deepEqual(enviados[0], { numero: { id: 'PN1', token: 'T' }, para: '5561988887777', texto: 'Oi Ana, aqui é o Nikolas' });
  assert.equal(db.mensagens.at(-1).papel, 'humano');
  const lead = await db.obterLead('n1', '5561988887777');
  assert.equal(lead.status, 'com_humano');
  assert.ok(new Date(lead.bot_pausado_ate) > new Date(Date.now() + 20 * 86400_000));
});

test('não deixa usar o número do agente para mandar mensagem a quem nunca conversou', async () => {
  const { enviados, acao } = await montar();
  await assert.rejects(acao('responder', { contato: '5511900000000', dados: { texto: 'promoção!' } }), falhaCom(404));
  await assert.rejects(acao('responder', { contato: '55; drop table', dados: { texto: 'x' } }), falhaCom(400));
  assert.equal(enviados.length, 0);
});

test('sem número conectado, avisa em vez de quebrar', async () => {
  const db = criarDbMemoria({ membros: [{ negocioId: 'n1', usuarioId: 'u1', papel: 'owner' }] });
  await db.salvarLead('n1', '5561988887777', {});
  await assert.rejects(
    executarAcao({ usuarioId: 'u1', acao: 'responder', negocioId: 'n1', contato: '5561988887777', dados: { texto: 'oi' } }, { db, whatsapp: {} }),
    falhaCom(409),
  );
});

test('assumir e devolver a conversa', async () => {
  const { db, acao } = await montar();
  await acao('assumir');
  assert.equal((await db.obterLead('n1', '5561988887777')).status, 'com_humano');
  await acao('devolver');
  const lead = await db.obterLead('n1', '5561988887777');
  assert.equal(lead.bot_pausado_ate, null);
  assert.equal(lead.status, 'qualificado');
});

test('status só aceita os valores conhecidos', async () => {
  const { db, acao } = await montar();
  await acao('status', { dados: { status: 'fechado' } });
  assert.equal((await db.obterLead('n1', '5561988887777')).status, 'fechado');
  await assert.rejects(acao('status', { dados: { status: 'vip' } }), falhaCom(400));
});

test('ficha: dono edita, editor não; valida WhatsApp e tamanho', async () => {
  const dono = await montar();
  await dono.acao('salvar_ficha', { dados: { nome_agente: 'Gi', ficha: 'Horário: 9h às 18h', dono_whatsapp: '5561999999999' } });
  assert.equal(negocio.nome_agente, 'Gi');
  assert.equal(negocio.dono_whatsapp, '5561999999999');
  await assert.rejects(dono.acao('salvar_ficha', { dados: { dono_whatsapp: '(61) 9999' } }), falhaCom(400));
  await assert.rejects(dono.acao('salvar_ficha', { dados: { ficha: 'x'.repeat(20001) } }), falhaCom(400));
  await assert.rejects(dono.acao('salvar_ficha', { dados: { nome_agente: '   ' } }), falhaCom(400));

  const editor = await montar({ papel: 'editor' });
  await assert.rejects(editor.acao('salvar_ficha', { dados: { ficha: 'y' } }), falhaCom(403));
});

test('ação desconhecida é recusada', async () => {
  const { acao } = await montar();
  await assert.rejects(acao('apagar_tudo'), falhaCom(400));
});
