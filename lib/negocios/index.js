import givance from './givance.js';
import eliteCar from './elite-car.js';

// Cada número de WhatsApp (phone_number_id da Meta) aponta para um negócio.
// Os IDs ficam nas variáveis de ambiente para não precisar mexer no código.
export function negocioPorNumero(phoneNumberId, env = process.env) {
  const mapa = {
    [env.GIVANCE_PHONE_NUMBER_ID]: { ...givance, donoWhatsapp: env.GIVANCE_DONO_WHATSAPP, contatoHumano: env.GIVANCE_CONTATO_HUMANO },
    [env.ELITE_PHONE_NUMBER_ID]: { ...eliteCar, donoWhatsapp: env.ELITE_DONO_WHATSAPP, contatoHumano: env.ELITE_CONTATO_HUMANO },
  };
  delete mapa.undefined;
  return mapa[phoneNumberId] || null;
}

export const negocios = { givance, 'elite-car': eliteCar };
