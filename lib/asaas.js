// Cliente da API do Asaas (cobrança das assinaturas da plataforma Givance).
// ASAAS_AMBIENTE=producao usa a conta real; qualquer outro valor usa o sandbox.
const BASES = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
};

export function criarAsaas(env = process.env) {
  const base = env.ASAAS_AMBIENTE === 'producao' ? BASES.producao : BASES.sandbox;

  async function chamar(metodo, caminho, corpo) {
    const resp = await fetch(`${base}${caminho}`, {
      method: metodo,
      headers: {
        access_token: env.ASAAS_API_KEY,
        'User-Agent': 'Givance',
        'Content-Type': 'application/json',
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const dados = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const motivo = dados.errors?.map((e) => e.description).join('; ') || resp.statusText;
      throw new Error(`Asaas ${resp.status}: ${motivo}`);
    }
    return dados;
  }

  return {
    criarCliente: ({ nome, email, cpfCnpj, celular, workspaceId }) =>
      chamar('POST', '/customers', { name: nome, email, cpfCnpj, mobilePhone: celular, externalReference: workspaceId }),

    // billingType UNDEFINED: o cliente escolhe Pix, boleto ou cartão na fatura de cada mês
    criarAssinatura: ({ cliente, valorCentavos, descricao, primeiroVencimento, referencia }) =>
      chamar('POST', '/subscriptions', {
        customer: cliente,
        billingType: 'UNDEFINED',
        value: valorCentavos / 100,
        nextDueDate: primeiroVencimento,
        cycle: 'MONTHLY',
        description: descricao,
        externalReference: referencia,
      }),

    cobrancasDaAssinatura: (assinaturaId) => chamar('GET', `/subscriptions/${encodeURIComponent(assinaturaId)}/payments`),

    obterCobranca: (cobrancaId) => chamar('GET', `/payments/${encodeURIComponent(cobrancaId)}`),

    criarWebhook: (config) => chamar('POST', '/webhooks', config),
  };
}
