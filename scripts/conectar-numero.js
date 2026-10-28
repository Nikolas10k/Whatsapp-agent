// Liga um número de WhatsApp a um negócio já cadastrado, guardando o token cifrado.
// Uso: npm run conectar -- <slug> <phone_number_id> [token] [waba_id]
//   Sem token, o número usa o token da plataforma (WHATSAPP_TOKEN): serve para números
//   que estão na WABA da própria Givance.
import { createClient } from '@supabase/supabase-js';
import { cifrar } from '../lib/cripto.js';

const [slug, phoneNumberId, token, wabaId] = process.argv.slice(2);
if (!slug || !phoneNumberId) {
  console.error('Uso: npm run conectar -- <slug> <phone_number_id> [token] [waba_id]');
  process.exit(1);
}

const env = process.env;
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: negocio, error } = await sb.from('negocios').select('id, nome').eq('slug', slug).maybeSingle();
if (error) throw error;
if (!negocio) { console.error(`Negócio "${slug}" não existe`); process.exit(1); }

const { error: e } = await sb.from('numeros_whatsapp').upsert({
  phone_number_id: phoneNumberId,
  negocio_id: negocio.id,
  access_token: token ? cifrar(token, env) : null,
  waba_id: wabaId ?? null,
}, { onConflict: 'phone_number_id' });
if (e) throw e;
console.log(`Número ${phoneNumberId} ligado a ${negocio.nome}${token ? ' (token próprio)' : ' (token da plataforma)'}`);
