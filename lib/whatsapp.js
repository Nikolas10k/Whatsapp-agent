import crypto from 'node:crypto';

const graph = (env) => `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`;

// numero: { id, token?, templateAviso? }. Sem token próprio, usa o token da plataforma (WHATSAPP_TOKEN).
async function post(numero, corpo, env) {
  const resp = await fetch(`${graph(env)}/${numero.id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${numero.token || env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
  });
  if (!resp.ok) throw new Error(`WhatsApp ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export function criarWhatsapp(env = process.env) {
  return {
    enviarTexto: (numero, para, texto) =>
      post(numero, { to: para, type: 'text', text: { body: texto, preview_url: false } }, env),

    // Marca como lida e mostra "digitando..." enquanto o agente pensa
    marcarLidaDigitando: (numero, messageId) =>
      post(numero, { status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }, env)
        .catch(() => {}),

    // Aviso para o dono. Fora da janela de 24h a Meta só aceita template aprovado,
    // por isso o aviso usa o template do número (ou WHATSAPP_TEMPLATE_AVISO) quando configurado.
    async avisarDono(numero, dono, { negocio, nome, contato, resumo }) {
      if (!dono) return;
      const template = numero.templateAviso || env.WHATSAPP_TEMPLATE_AVISO;
      if (template) {
        const p = (t) => ({ type: 'text', text: String(t || '-').slice(0, 900).replace(/\s+/g, ' ') });
        return post(numero, {
          to: dono, type: 'template',
          template: {
            name: template, language: { code: env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR' },
            components: [{ type: 'body', parameters: [p(negocio), p(nome), p(`wa.me/${contato}`), p(resumo)] }],
          },
        }, env);
      }
      return post(numero, {
        to: dono, type: 'text',
        text: { body: `🔔 Lead para atender — ${negocio}\n${nome || 'Sem nome'} · wa.me/${contato}\n\n${resumo}` },
      }, env);
    },
  };
}

// Compara dois textos sem vazar, pelo tempo de resposta, quantos caracteres batem
export function iguaisSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Confere que a requisição veio mesmo da Meta (cabeçalho X-Hub-Signature-256).
// Sem segredo configurado, recusa tudo: senão qualquer um poderia forjar mensagens.
export function assinaturaValida(corpoBruto, assinatura, appSecret) {
  if (!appSecret || !assinatura?.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  return iguaisSeguro(assinatura, esperado);
}
