// Banco em memória com a mesma interface do db.js — usado nos testes e na bateria local.
// contas: [{ negocio, numero: { id, token?, templateAviso? }, emDia? }]
// assinaturas: [{ id, asaas_subscription_id, status, periodo_fim }]
// membros: [{ negocioId, usuarioId, papel }] — quem acessa cada agente pelo painel
export function criarDbMemoria({ contas = [], assinaturas = [], membros = [] } = {}) {
  const mensagens = [];
  const leads = new Map();
  const chave = (n, c) => `${n}:${c}`;

  return {
    mensagens, leads, assinaturas,
    async papelNoNegocio(usuarioId, negocioId) {
      return membros.find((m) => m.usuarioId === usuarioId && m.negocioId === negocioId)?.papel ?? null;
    },
    async numeroDoNegocio(negocioId) {
      return contas.find((c) => c.negocio.id === negocioId)?.numero ?? null;
    },
    async atualizarNegocio(negocioId, campos) {
      Object.assign(contas.find((c) => c.negocio.id === negocioId).negocio, campos);
    },
    async contaPorNumero(phoneNumberId) {
      return contas.find((c) => c.numero.id === phoneNumberId) ?? null;
    },
    async assinaturaPorAsaas(asaasSubscriptionId) {
      return assinaturas.find((a) => a.asaas_subscription_id === asaasSubscriptionId) ?? null;
    },
    async atualizarAssinatura(id, campos) {
      Object.assign(assinaturas.find((a) => a.id === id), campos);
    },
    async registrarMensagem({ negocio, contato, papel, conteudo, waMessageId = null }) {
      if (waMessageId && mensagens.some((m) => m.waMessageId === waMessageId)) return false;
      mensagens.push({ negocio, contato, papel, conteudo, waMessageId, criadoEm: Date.now() });
      return true;
    },
    async respostasNaUltimaHora(negocio, contato) {
      const desde = Date.now() - 3600_000;
      return mensagens.filter((m) => m.negocio === negocio && m.contato === contato
        && m.papel === 'assistant' && m.criadoEm >= desde).length;
    },
    async ultimaMensagemDoCliente(negocio, contato) {
      const doCliente = mensagens.filter((m) => m.negocio === negocio && m.contato === contato && m.papel === 'user');
      return doCliente.at(-1)?.waMessageId ?? null;
    },
    async historico(negocio, contato, limite = 20) {
      return mensagens.filter((m) => m.negocio === negocio && m.contato === contato)
        .slice(-limite).map(({ papel, conteudo }) => ({ papel, conteudo }));
    },
    async obterLead(negocio, contato) {
      return leads.get(chave(negocio, contato)) ?? null;
    },
    async salvarLead(negocio, contato, campos) {
      const atual = leads.get(chave(negocio, contato)) ?? { negocio, contato, status: 'novo', origem: 'organico' };
      const limpos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
      leads.set(chave(negocio, contato), { ...atual, ...limpos });
    },
  };
}
