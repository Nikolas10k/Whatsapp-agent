// Cadastra no banco os negócios das fichas em lib/negocios/ (Givance e Elite Car)
// e liga cada um ao seu workspace e ao seu número de WhatsApp (ids no .env).
// Uso: npm run semear
// Atenção: sobrescreve a ficha que estiver no banco com a do arquivo.
import { createClient } from '@supabase/supabase-js';
import { negocios } from '../lib/negocios/index.js';

const env = process.env;
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PREFIXO = { givance: 'GIVANCE', 'elite-car': 'ELITE' };

for (const [slug, n] of Object.entries(negocios)) {
  const p = PREFIXO[slug];
  const workspaceId = env[`${p}_WORKSPACE_ID`];
  if (!workspaceId) {
    console.log(`${n.nome}: pulado (defina ${p}_WORKSPACE_ID com o id do workspace dele na tabela workspaces)`);
    continue;
  }
  const { data, error } = await sb.from('agente_negocios').upsert({
    workspace_id: workspaceId,
    slug, nome: n.nome, nome_agente: n.nomeAgente, objetivo: n.objetivo, ficha: n.ficha,
    dono_whatsapp: env[`${p}_DONO_WHATSAPP`] || null,
    contato_humano: env[`${p}_CONTATO_HUMANO`] || null,
  }, { onConflict: 'slug' }).select('id').single();
  if (error) throw error;

  const phoneNumberId = env[`${p}_PHONE_NUMBER_ID`];
  if (phoneNumberId) {
    const { error: e } = await sb.from('agente_numeros')
      .upsert({ phone_number_id: phoneNumberId, negocio_id: data.id }, { onConflict: 'phone_number_id' });
    if (e) throw e;
  }
  console.log(`${n.nome}: ok${phoneNumberId ? ` (número ${phoneNumberId})` : ' (sem número: defina ' + p + '_PHONE_NUMBER_ID)'}`);
}
