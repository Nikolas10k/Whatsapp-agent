import { receberMensagem, receberEcoDaEquipe } from './agente.js';

// Textos gigantes só servem para gastar IA: corta no tamanho de uma mensagem longa de verdade
const LIMITE_TEXTO = 2000;
const cortar = (t, max) => (t.length > max ? `${t.slice(0, max)} [mensagem cortada]` : t);

export function textoDaMensagem(m) {
  switch (m.type) {
    case 'text': return m.text?.body ?? '';
    case 'button': return m.button?.text ?? '';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    case 'image': return `[o cliente mandou uma imagem]${m.image?.caption ? ` ${m.image.caption}` : ''}`;
    case 'video': return `[o cliente mandou um vídeo]${m.video?.caption ? ` ${m.video.caption}` : ''}`;
    case 'audio': return '[o cliente mandou um áudio — você não consegue ouvir; peça com gentileza para escrever]';
    case 'document': return `[o cliente mandou um arquivo: ${m.document?.filename ?? 'documento'}]`;
    case 'location': return `[o cliente mandou uma localização: ${m.location?.address ?? `${m.location?.latitude},${m.location?.longitude}`}]`;
    case 'sticker': return '[figurinha]';
    case 'reaction': return null; // reações não precisam de resposta
    default: return null;
  }
}

// Recebe o JSON do webhook da Meta e devolve a lista de tarefas a processar.
// De qual negócio é cada evento só se descobre depois, no banco (processarEventos).
export function extrairEventos(corpo) {
  const eventos = [];
  for (const entry of corpo?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const phoneNumberId = v.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      if (change.field === 'messages') {
        const nomes = Object.fromEntries((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
        for (const m of v.messages ?? []) {
          const texto = textoDaMensagem(m);
          if (texto == null) continue;
          eventos.push({
            tipo: 'cliente', phoneNumberId,
            contato: m.from, nomePerfil: nomes[m.from]?.slice(0, 100), waMessageId: m.id,
            texto: cortar(texto, LIMITE_TEXTO), referral: m.referral,
          });
        }
      }

      // Coexistência: mensagens que a equipe mandou pelo app WhatsApp Business
      if (change.field === 'smb_message_echoes') {
        for (const m of v.message_echoes ?? []) {
          const texto = textoDaMensagem(m);
          if (texto == null || !m.to) continue;
          eventos.push({ tipo: 'equipe', phoneNumberId, contato: m.to, waMessageId: m.id, texto });
        }
      }
    }
  }
  return eventos;
}

export async function processarEventos(eventos, deps) {
  // Cada número é consultado no banco uma vez só por webhook
  const contas = new Map();
  const conta = (id) => {
    if (!contas.has(id)) contas.set(id, deps.db.contaPorNumero(id));
    return contas.get(id);
  };

  // Contatos diferentes em paralelo
  await Promise.allSettled(eventos.map(async (e) => {
    try {
      const c = await conta(e.phoneNumberId);
      if (!c?.negocio.ativo) return; // número desconhecido ou cliente desativado
      const evento = { ...e, negocio: c.negocio, numero: c.numero };
      await (e.tipo === 'equipe' ? receberEcoDaEquipe(evento, deps) : receberMensagem(evento, deps));
    } catch (erro) {
      console.error('[webhook] erro ao processar', e.contato, erro);
    }
  }));
}
