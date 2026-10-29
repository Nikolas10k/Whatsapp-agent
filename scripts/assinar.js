// Cria a assinatura mensal de um cliente no Asaas e mostra o link da primeira fatura
// (o cliente escolhe Pix, boleto ou cartão). Enquanto não houver painel, é assim que se vende.
// Uso: npm run assinar -- <workspace_id> <plano_id> <email> <cpf_ou_cnpj> [preco_em_reais]
//   preco_em_reais (opcional): preço especial, ex. de fundador. Fica travado nesta assinatura.
//   Planos: publi_basico, publi_pro, agente_essencial, agente_pro, combo_basico
import { createClient } from '@supabase/supabase-js';
import { criarAsaas } from '../lib/asaas.js';

const [workspaceId, planoId, email, cpfCnpj, precoReais] = process.argv.slice(2);
if (!workspaceId || !planoId || !email || !cpfCnpj) {
  console.error('Uso: npm run assinar -- <workspace_id> <plano_id> <email> <cpf_ou_cnpj> [preco_em_reais]');
  process.exit(1);
}

const env = process.env;
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const asaas = criarAsaas(env);
const ok = ({ data, error }) => { if (error) throw error; return data; };

const plano = ok(await sb.from('givance_planos').select('*').eq('id', planoId).maybeSingle());
if (!plano) { console.error(`Plano "${planoId}" não existe`); process.exit(1); }
const workspace = ok(await sb.from('workspaces').select('id, name').eq('id', workspaceId).maybeSingle());
if (!workspace) { console.error(`Workspace "${workspaceId}" não existe`); process.exit(1); }

const preco = precoReais ? Math.round(Number(precoReais.replace(',', '.')) * 100) : plano.preco_centavos;
if (!Number.isInteger(preco) || preco <= 0) { console.error('Preço inválido'); process.exit(1); }

// Reaproveita o cliente do Asaas se o workspace já tiver outra assinatura
const anterior = ok(await sb.from('givance_assinaturas').select('asaas_customer_id')
  .eq('workspace_id', workspaceId).not('asaas_customer_id', 'is', null).limit(1));
const clienteId = anterior[0]?.asaas_customer_id
  ?? (await asaas.criarCliente({ nome: workspace.name, email, cpfCnpj: cpfCnpj.replace(/\D/g, ''), workspaceId })).id;

const nossa = ok(await sb.from('givance_assinaturas')
  .insert({ workspace_id: workspaceId, plano_id: planoId, preco_centavos: preco, asaas_customer_id: clienteId })
  .select('id').single());

try {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const assinatura = await asaas.criarAssinatura({
    cliente: clienteId,
    valorCentavos: preco,
    descricao: `${plano.nome} · Givance`,
    primeiroVencimento: hoje,
    referencia: nossa.id,
  });
  const cobrancas = await asaas.cobrancasDaAssinatura(assinatura.id);
  const link = cobrancas.data?.[0]?.invoiceUrl ?? null;
  ok(await sb.from('givance_assinaturas')
    .update({ asaas_subscription_id: assinatura.id, link_pagamento: link }).eq('id', nossa.id));

  console.log(`Assinatura criada: ${workspace.name} · ${plano.nome} · R$ ${(preco / 100).toFixed(2).replace('.', ',')}/mês`);
  console.log(link ? `Link da primeira fatura (mande para o cliente): ${link}` : 'A fatura ainda está sendo gerada: confira no painel do Asaas.');
} catch (erro) {
  await sb.from('givance_assinaturas').delete().eq('id', nossa.id);
  throw erro;
}
