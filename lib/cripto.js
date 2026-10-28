import crypto from 'node:crypto';

// Os tokens de WhatsApp dos clientes ficam cifrados no banco (AES-256-GCM).
// TOKEN_KEY: 32 bytes em base64. Gere com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
function chave(env) {
  const k = Buffer.from(env.TOKEN_KEY ?? '', 'base64');
  if (k.length !== 32) throw new Error('TOKEN_KEY inválida: precisa ter 32 bytes em base64');
  return k;
}

export function cifrar(texto, env = process.env) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(env), iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), dados].map((b) => b.toString('base64')).join('.');
}

export function decifrar(cifrado, env = process.env) {
  const [iv, tag, dados] = cifrado.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', chave(env), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]).toString('utf8');
}
