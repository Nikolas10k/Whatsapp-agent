// Fala com qualquer modelo (Claude, GPT, Gemini, Llama, DeepSeek...) por uma API só: OpenRouter.
export async function chamarModelo({ mensagens, ferramentas, env = process.env }) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Agente WhatsApp Givance',
    },
    body: JSON.stringify({
      model: env.OPENROUTER_MODEL || 'anthropic/claude-haiku-4.5',
      messages: mensagens,
      tools: ferramentas,
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${await resp.text()}`);
  const dados = await resp.json();
  return dados.choices?.[0]?.message ?? { role: 'assistant', content: '' };
}
