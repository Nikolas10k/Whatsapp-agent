import crypto from 'node:crypto';

const graph = (env) => `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`;

async function post(phoneNumberId, corpo, env) {
  const resp = await fetch(`${graph(env)}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
  });
  if (!resp.ok) throw new Error(`WhatsApp ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

export function criarWhatsapp(env = process.env) {
  return {
    enviarTexto: (phoneNumberId, para, texto) =>
      post(phoneNumberId, { to: para, type: 'text', text: { body: texto, preview_url: false } }, env),

    // Marca como lida e mostra "digitando..." enquanto o agente pensa
    marcarLidaDigitando: (phoneNumberId, messageId) =>
      post(phoneNumberId, { status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }, env)
        .catch(() => {}),

    // Aviso para o dono. Fora da janela de 24h a Meta só aceita template aprovado,
    // por isso o aviso usa o template WHATSAPP_TEMPLATE_AVISO quando configurado.
    async avisarDono(phoneNumberId, dono, { negocio, nome, contato, resumo }) {
      if (!dono) return;
      const template = env.WHATSAPP_TEMPLATE_AVISO;
      if (template) {
        const p = (t) => ({ type: 'text', text: String(t || '-').slice(0, 900).replace(/\s+/g, ' ') });
        return post(phoneNumberId, {
          to: dono, type: 'template',
          template: {
            name: template, language: { code: env.WHATSAPP_TEMPLATE_IDIOMA || 'pt_BR' },
            components: [{ type: 'body', parameters: [p(negocio), p(nome), p(`wa.me/${contato}`), p(resumo)] }],
          },
        });
      }
      return post(phoneNumberId, {
        to: dono, type: 'text',
        text: { body: `🔔 Lead para atender — ${negocio}\n${nome || 'Sem nome'} · wa.me/${contato}\n\n${resumo}` },
      });
    },
  };
}

// Confere que a requisição veio mesmo da Meta (cabeçalho X-Hub-Signature-256)
export function assinaturaValida(corpoBruto, assinatura, appSecret) {
  if (!appSecret) return true; // sem segredo configurado, não confere (só para testes)
  if (!assinatura?.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', appSecret).update(corpoBruto).digest('hex');
  const a = Buffer.from(assinatura), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
