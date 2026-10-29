// Cadastra no Asaas o webhook de pagamentos apontando para a Vercel. Rode uma vez por ambiente.
// Uso: npm run asaas:webhook -- <email_para_avisos> [url]
//   email_para_avisos: o Asaas avisa nesse e-mail se o webhook começar a falhar.
import { criarAsaas } from '../lib/asaas.js';

const [email, url = 'https://agente-whatsapp-opal.vercel.app/api/asaas'] = process.argv.slice(2);
if (!email) { console.error('Uso: npm run asaas:webhook -- <email_para_avisos> [url]'); process.exit(1); }
if (!process.env.ASAAS_WEBHOOK_TOKEN || process.env.ASAAS_WEBHOOK_TOKEN.length < 32) {
  console.error('Defina ASAAS_WEBHOOK_TOKEN no .env (32 caracteres ou mais), o mesmo que está na Vercel');
  process.exit(1);
}

const webhook = await criarAsaas().criarWebhook({
  name: 'Givance',
  url,
  email,
  enabled: true,
  interrupted: false,
  apiVersion: 3,
  authToken: process.env.ASAAS_WEBHOOK_TOKEN,
  sendType: 'SEQUENTIALLY',
  events: [
    'PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
    'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED',
    'SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED',
  ],
});
console.log(`Webhook criado (${webhook.id}) → ${url}`);
