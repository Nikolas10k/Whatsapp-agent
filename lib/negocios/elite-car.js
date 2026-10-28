// Ficha de negócio da Elite Car — PREENCHER antes de ligar o agente.
// Tudo que estiver escrito "(preencher)" o agente trata como informação desconhecida
// e transfere para um humano em vez de inventar.
export default {
  id: 'elite-car',
  nome: 'Elite Car',
  nomeAgente: 'assistente da Elite Car', // (preencher) nome com que o agente se apresenta
  objetivo:
    'Responder dúvidas, qualificar o lead que veio do anúncio e passar para a equipe fechar. (preencher: agendar visita? pedir modelo do carro? enviar orçamento?)',
  ficha: `
EMPRESA: Elite Car. (preencher: o que faz — venda de seminovos, estética automotiva, locação, oficina...)

ENDEREÇO: (preencher)

HORÁRIO: (preencher)

SERVIÇOS / PRODUTOS E PREÇOS:
- (preencher: serviço — preço — duração)

FORMAS DE PAGAMENTO: (preencher)

REGRAS: (preencher: sinal, garantia, política de cancelamento, financiamento...)

PARA QUALIFICAR, DESCUBRA (uma pergunta por vez):
1. Nome do cliente.
2. O que ele procura. (preencher: ex. modelo/ano do carro, serviço desejado)
3. Para quando.
Quando tiver nome + interesse, registre o lead. Quando o cliente quiser fechar, agendar ou pedir algo que não está nesta ficha, transfira para humano.
`.trim(),
};
