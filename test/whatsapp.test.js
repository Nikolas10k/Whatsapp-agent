import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comNonoDigito, criarWhatsapp } from '../lib/whatsapp.js';

test('9º dígito: só para celular brasileiro que chegou sem ele', () => {
  assert.equal(comNonoDigito('556196747738'), '5561996747738');
  assert.equal(comNonoDigito('5561996747738'), null, 'já tem o 9');
  assert.equal(comNonoDigito('556133334444'), null, 'fixo (começa com 3) não ganha 9');
  assert.equal(comNonoDigito('15556491365'), null, 'número de outro país');
});

test('número de teste recusa o celular sem 9: reenvia com o 9 e só uma vez', async (t) => {
  const destinos = [];
  t.mock.method(globalThis, 'fetch', async (_url, opcoes) => {
    const { to } = JSON.parse(opcoes.body);
    destinos.push(to);
    if (to === '556196747738') {
      return new Response('{"error":{"code":131030,"message":"Recipient phone number not in allowed list"}}', { status: 400 });
    }
    return new Response('{"messages":[{"id":"wamid.1"}]}', { status: 200 });
  });
  const wa = criarWhatsapp({ WHATSAPP_TOKEN: 'T' });
  await wa.enviarTexto({ id: 'PN' }, '556196747738', 'oi');
  assert.deepEqual(destinos, ['556196747738', '5561996747738']);
});

test('outros erros do WhatsApp não são mascarados', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":{"code":131047}}', { status: 400 }));
  const wa = criarWhatsapp({ WHATSAPP_TOKEN: 'T' });
  await assert.rejects(wa.enviarTexto({ id: 'PN' }, '556196747738', 'oi'), /131047/);
});
