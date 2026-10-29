// Painel do Givance Agente.
// Leitura direto do Supabase (protegida por RLS); ações passam por /api/painel, que confere o login.
// Tudo que vem do cliente entra na tela como texto (textContent), nunca como HTML.

const sb = window.supabase.createClient(window.GIVANCE.supabaseUrl, window.GIVANCE.supabaseKey);
const $ = (id) => document.getElementById(id);
const ATUALIZAR_A_CADA_MS = 15_000;

const estado = {
  usuario: null, negocios: [], negocio: null, papel: null,
  leads: [], filtro: 'todos', busca: '', contato: null, aba: 'conversas',
  ultimaMensagemId: null,
};

const STATUS = { novo: 'Novo', qualificado: 'Qualificado', com_humano: 'Com a equipe', fechado: 'Fechado', perdido: 'Perdido' };
const STATUS_ASSINATURA = {
  aguardando: 'Aguardando pagamento', teste: 'Em teste', ativa: 'Em dia',
  atrasada: 'Pagamento atrasado', cancelada: 'Cancelada', cortesia: 'Cortesia',
};

// ---------- utilidades ----------
function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}

function telefone(n) {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n ?? '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : `+${n}`;
}

const formatoHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const formatoDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const formatoDiaLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
const diaDe = (d) => formatoDia.format(d);

function quando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const min = Math.round((Date.now() - d) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (diaDe(d) === diaDe(new Date())) return formatoHora.format(d);
  if (diaDe(d) === diaDe(new Date(Date.now() - 86400_000))) return 'ontem';
  return diaDe(d);
}

const pausado = (lead) => Boolean(lead?.bot_pausado_ate) && new Date(lead.bot_pausado_ate) > new Date();
const nomeDoLead = (lead) => lead.nome || lead.nome_perfil || telefone(lead.contato);
const reais = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

let temporizadorAviso;
function avisar(texto, tipo = 'ok') {
  const a = $('aviso');
  a.textContent = texto;
  a.className = `aviso${tipo === 'erro' ? ' aviso--erro' : ''}`;
  a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { a.hidden = true; }, tipo === 'erro' ? 6000 : 3000);
}

function mostrarTela(id) {
  for (const t of ['tela-carregando', 'tela-login', 'tela-sem-agente', 'tela-app']) $(t).hidden = t !== id;
}

// Ações que mudam dados passam pelo servidor, com o token de login
async function executar(acao, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { mostrarLogin(); throw new Error('Sua sessão expirou. Entre de novo.'); }
  const resp = await fetch('/api/painel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ acao, negocio_id: estado.negocio.id, contato: estado.contato, ...extra }),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (resp.status === 401) { await sb.auth.signOut(); throw new Error('Sua sessão expirou. Entre de novo.'); }
  if (!resp.ok) throw new Error(corpo.erro || 'Não foi possível concluir agora. Tente de novo.');
  return corpo;
}

// ---------- login ----------
function mostrarLogin() {
  estado.usuario = null;
  mostrarTela('tela-login');
  $('email').focus();
}

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = $('erro-login');
  erro.hidden = true;
  const email = $('email').value.trim();
  const senha = $('senha').value;
  if (!email || !senha) { erro.textContent = 'Preencha o e-mail e a senha.'; erro.hidden = false; return; }
  const botao = $('botao-entrar');
  botao.disabled = true; botao.textContent = 'Entrando…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
  botao.disabled = false; botao.textContent = 'Entrar';
  if (error) {
    erro.textContent = error.status === 400
      ? 'E-mail ou senha não conferem. Confira e tente de novo.'
      : 'Não foi possível entrar agora. Tente de novo em instantes.';
    erro.hidden = false;
    return;
  }
  $('senha').value = '';
  entrar(data.user);
});

for (const b of document.querySelectorAll('.js-sair')) {
  b.addEventListener('click', async () => { await sb.auth.signOut(); mostrarLogin(); });
}

// ---------- entrada e troca de agente ----------
async function entrar(usuario) {
  estado.usuario = usuario;
  mostrarTela('tela-carregando');
  const { data, error } = await sb.from('agente_negocios')
    .select('id, workspace_id, nome, nome_agente, objetivo, ficha, dono_whatsapp, contato_humano, ativo').order('nome');
  if (error) { mostrarTela('tela-login'); avisar('Não foi possível carregar sua conta. Tente de novo.', 'erro'); return; }
  estado.negocios = data;
  if (!data.length) { mostrarTela('tela-sem-agente'); return; }

  $('usuario-email').textContent = usuario.email;
  const seletor = $('seletor-negocio');
  seletor.replaceChildren(...data.map((n) => el('option', { value: n.id }, n.nome)));
  seletor.hidden = data.length < 2;
  let salvo = null;
  try { salvo = localStorage.getItem('givance.negocio'); } catch { /* sem armazenamento: usa o primeiro */ }
  await escolherNegocio(data.find((n) => n.id === salvo) ?? data[0]);
  mostrarTela('tela-app');
}

$('seletor-negocio').addEventListener('change', (e) => {
  escolherNegocio(estado.negocios.find((n) => n.id === e.target.value));
});

async function escolherNegocio(negocio) {
  estado.negocio = negocio;
  estado.contato = null;
  $('seletor-negocio').value = negocio.id;
  try { localStorage.setItem('givance.negocio', negocio.id); } catch { /* opcional */ }
  const { data } = await sb.from('workspace_members').select('role')
    .eq('workspace_id', negocio.workspace_id).eq('user_id', estado.usuario.id).maybeSingle();
  estado.papel = data?.role ?? null;
  fecharConversa();
  preencherFicha();
  await carregarLeads();
  if (estado.aba === 'plano') carregarPlano();
}

// ---------- abas ----------
const abas = [...document.querySelectorAll('.aba')];
function irPara(aba) {
  estado.aba = aba;
  for (const b of abas) {
    const ativa = b.dataset.aba === aba;
    b.setAttribute('aria-selected', String(ativa));
    b.tabIndex = ativa ? 0 : -1;
    $(`aba-${b.dataset.aba}`).hidden = !ativa;
  }
  if (aba === 'plano') carregarPlano();
  if (aba === 'conversas') carregarLeads();
}
for (const b of abas) {
  b.addEventListener('click', () => irPara(b.dataset.aba));
  b.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const i = abas.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
    const proxima = abas[(i + abas.length) % abas.length];
    proxima.focus();
    irPara(proxima.dataset.aba);
  });
}

// ---------- leads ----------
async function carregarLeads() {
  if (!estado.negocio) return;
  const { data, error } = await sb.from('agente_leads').select('*')
    .eq('negocio_id', estado.negocio.id).order('atualizado_em', { ascending: false }).limit(300);
  if (error) { avisar('Não foi possível atualizar os leads. Tentando de novo em instantes.', 'erro'); return; }
  estado.leads = data;
  desenharLeads();
  if (estado.contato) desenharCabecalho();
}

function leadsFiltrados() {
  const busca = estado.busca.toLowerCase();
  return estado.leads.filter((l) => {
    if (estado.filtro === 'com_humano' && !(l.status === 'com_humano' || pausado(l))) return false;
    if (estado.filtro === 'quente' && l.temperatura !== 'quente') return false;
    if (estado.filtro === 'anuncio' && l.origem !== 'anuncio') return false;
    if (!busca) return true;
    return [l.nome, l.nome_perfil, l.contato, l.interesse].some((v) => v?.toLowerCase().includes(busca));
  });
}

function selosDoLead(lead) {
  return el('span', { class: 'selos' },
    lead.temperatura && el('span', { class: `selo selo--${lead.temperatura}` }, lead.temperatura[0].toUpperCase() + lead.temperatura.slice(1)),
    pausado(lead) ? el('span', { class: 'selo selo--equipe' }, 'Equipe') : null,
    lead.origem === 'anuncio' && el('span', { class: 'selo selo--anuncio' }, 'Anúncio'),
    ['fechado', 'perdido'].includes(lead.status) && el('span', { class: 'selo' }, STATUS[lead.status]),
  );
}

function desenharLeads() {
  const lista = leadsFiltrados();
  $('leads').replaceChildren(...lista.map((lead) => el('li', {},
    el('button', {
      class: 'lead', type: 'button', 'aria-current': lead.contato === estado.contato ? 'true' : null,
      onclick: () => abrirLead(lead.contato),
    },
    el('span', { class: 'lead__linha' },
      el('span', { class: 'lead__nome' }, nomeDoLead(lead)),
      el('span', { class: 'lead__quando' }, quando(lead.atualizado_em))),
    el('span', { class: 'lead__interesse' }, lead.interesse || telefone(lead.contato)),
    selosDoLead(lead)),
  )));

  const vazio = $('leads-vazio');
  vazio.hidden = lista.length > 0;
  if (!lista.length) {
    vazio.replaceChildren(...(estado.leads.length
      ? [el('strong', {}, 'Nenhum lead neste filtro'), el('span', {}, 'Tente outro filtro ou limpe a busca.')]
      : [el('strong', {}, 'Nenhum lead ainda'), el('span', {}, 'Assim que alguém chamar no WhatsApp, o lead aparece aqui.')]));
  }
}

$('busca').addEventListener('input', (e) => { estado.busca = e.target.value.trim(); desenharLeads(); });
for (const f of document.querySelectorAll('.filtro')) {
  f.addEventListener('click', () => {
    estado.filtro = f.dataset.filtro;
    for (const outro of document.querySelectorAll('.filtro')) outro.setAttribute('aria-pressed', String(outro === f));
    desenharLeads();
  });
}

// ---------- conversa ----------
const leadAtual = () => estado.leads.find((l) => l.contato === estado.contato);

async function abrirLead(contato) {
  estado.contato = contato;
  estado.ultimaMensagemId = null;
  $('conversa-vazia').hidden = true;
  $('conversa-conteudo').hidden = false;
  $('aba-conversas').classList.add('mostrando-conversa');
  $('texto-resposta').value = '';
  desenharLeads();
  desenharCabecalho();
  $('mensagens').replaceChildren();
  await carregarMensagens();
}

function fecharConversa() {
  estado.contato = null;
  $('conversa-vazia').hidden = false;
  $('conversa-conteudo').hidden = true;
  $('aba-conversas').classList.remove('mostrando-conversa');
}
$('voltar').addEventListener('click', () => { fecharConversa(); desenharLeads(); });

function desenharCabecalho() {
  const lead = leadAtual();
  if (!lead) return;
  $('lead-nome').textContent = nomeDoLead(lead);
  $('lead-detalhes').textContent = [telefone(lead.contato), lead.interesse, lead.detalhes].filter(Boolean).join(' · ');
  const equipe = pausado(lead);
  const situacao = $('lead-situacao');
  situacao.textContent = equipe ? 'Equipe atendendo' : 'Agente atendendo';
  situacao.className = `selo ${equipe ? 'selo--equipe' : 'selo--agente'}`;
  $('botao-assumir').textContent = equipe ? 'Devolver ao agente' : 'Assumir conversa';
  $('lead-status').value = lead.status in STATUS ? lead.status : 'novo';
  const faixa = $('lead-faixa');
  faixa.hidden = lead.origem !== 'anuncio';
  faixa.textContent = lead.origem === 'anuncio' ? `Veio do anúncio${lead.anuncio_titulo ? `: “${lead.anuncio_titulo}”` : ''}` : '';
}

async function carregarMensagens() {
  const contato = estado.contato;
  if (!contato) return;
  const { data, error } = await sb.from('agente_mensagens').select('id, papel, conteudo, criado_em')
    .eq('negocio_id', estado.negocio.id).eq('contato', contato).order('id', { ascending: false }).limit(150);
  if (error || contato !== estado.contato) return;
  const mensagens = data.reverse();
  const ultima = mensagens.at(-1)?.id ?? null;
  if (ultima === estado.ultimaMensagemId) return; // nada novo
  const caixa = $('mensagens');
  const estavaNoFim = !estado.ultimaMensagemId || caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80;
  estado.ultimaMensagemId = ultima;

  const itens = [];
  let diaAnterior = null;
  for (const m of mensagens) {
    const d = new Date(m.criado_em);
    if (diaDe(d) !== diaAnterior) {
      diaAnterior = diaDe(d);
      itens.push(el('li', { class: 'dia' }, formatoDiaLongo.format(d)));
    }
    const autor = m.papel === 'user' ? 'Cliente' : m.papel === 'assistant' ? estado.negocio.nome_agente || 'Agente' : 'Equipe';
    itens.push(el('li', { class: `msg msg--${m.papel}` },
      el('div', { class: 'msg__autor' }, autor),
      m.conteudo,
      el('small', {}, formatoHora.format(d))));
  }
  caixa.replaceChildren(...itens);
  if (estavaNoFim) caixa.scrollTop = caixa.scrollHeight;
}

$('botao-assumir').addEventListener('click', async (e) => {
  const lead = leadAtual();
  const devolver = pausado(lead);
  e.target.disabled = true;
  try {
    await executar(devolver ? 'devolver' : 'assumir');
    avisar(devolver ? 'Conversa devolvida ao agente.' : 'Você assumiu a conversa. O agente não responde mais este contato.');
    await carregarLeads();
  } catch (erro) { avisar(erro.message, 'erro'); }
  e.target.disabled = false;
});

$('lead-status').addEventListener('change', async (e) => {
  try {
    await executar('status', { dados: { status: e.target.value } });
    avisar(`Lead marcado como ${STATUS[e.target.value].toLowerCase()}.`);
    await carregarLeads();
  } catch (erro) { avisar(erro.message, 'erro'); desenharCabecalho(); }
});

async function enviarResposta() {
  const caixa = $('texto-resposta');
  const texto = caixa.value.trim();
  if (!texto) { caixa.focus(); return; }
  const botao = $('botao-enviar');
  botao.disabled = true; botao.textContent = 'Enviando…';
  try {
    await executar('responder', { dados: { texto } });
    caixa.value = '';
    await Promise.all([carregarMensagens(), carregarLeads()]);
  } catch (erro) { avisar(erro.message, 'erro'); }
  botao.disabled = false; botao.textContent = 'Enviar';
}
$('form-resposta').addEventListener('submit', (e) => { e.preventDefault(); enviarResposta(); });
$('texto-resposta').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviarResposta(); }
});

// ---------- ficha ----------
const camposFicha = {
  nome_agente: 'f-nome-agente', dono_whatsapp: 'f-dono', objetivo: 'f-objetivo', ficha: 'f-ficha', contato_humano: 'f-contato',
};

function preencherFicha() {
  const pode = ['owner', 'admin'].includes(estado.papel);
  for (const [campo, id] of Object.entries(camposFicha)) {
    $(id).value = estado.negocio[campo] ?? '';
    $(id).disabled = !pode;
  }
  $('botao-salvar-ficha').hidden = !pode;
  $('ficha-somente-leitura').hidden = pode;
  $('erro-ficha').hidden = true;
}

$('form-ficha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const erro = $('erro-ficha');
  erro.hidden = true;
  const dados = Object.fromEntries(Object.entries(camposFicha).map(([campo, id]) => [campo, $(id).value.trim()]));
  for (const campo of ['dono_whatsapp', 'contato_humano']) dados[campo] = dados[campo].replace(/\D/g, '');
  const botao = $('botao-salvar-ficha');
  botao.disabled = true; botao.textContent = 'Salvando…';
  try {
    await executar('salvar_ficha', { contato: undefined, dados });
    Object.assign(estado.negocio, dados);
    preencherFicha();
    avisar('Ficha salva. O agente já usa a versão nova na próxima mensagem.');
  } catch (falha) {
    erro.textContent = falha.message;
    erro.hidden = false;
  }
  botao.disabled = false; botao.textContent = 'Salvar ficha';
});

// ---------- plano ----------
async function carregarPlano() {
  const ws = estado.negocio.workspace_id;
  const [assinaturas, uso] = await Promise.all([
    sb.from('givance_assinaturas')
      .select('status, periodo_fim, preco_centavos, link_pagamento, givance_planos(nome, produto, limite_leads)')
      .eq('workspace_id', ws).neq('status', 'cancelada').order('criado_em', { ascending: false }),
    sb.from('givance_uso_mes').select('leads_mes, limite_leads').eq('workspace_id', ws).maybeSingle(),
  ]);
  const area = $('plano');
  if (assinaturas.error) { area.replaceChildren(el('p', { class: 'erro' }, 'Não foi possível carregar o plano agora.')); return; }

  const cartoes = assinaturas.data.map((a) => el('div', { class: 'cartao' },
    el('div', { class: 'cartao__topo' },
      el('div', {},
        el('h2', {}, a.givance_planos?.nome ?? 'Plano'),
        el('p', { class: 'cartao__preco' }, a.status === 'cortesia' ? 'Cortesia da Givance Tech' : `${reais(a.preco_centavos)} por mês`)),
      el('span', { class: `selo ${['ativa', 'cortesia', 'teste'].includes(a.status) ? 'selo--agente' : a.status === 'atrasada' ? 'selo--quente' : ''}` },
        STATUS_ASSINATURA[a.status] ?? a.status)),
    el('div', { class: 'cartao__linha' },
      a.periodo_fim && a.status !== 'cortesia' ? el('span', {}, `Pago até ${formatoDia.format(new Date(a.periodo_fim))}`) : null,
      a.link_pagamento ? el('a', { class: 'botao botao--principal', href: a.link_pagamento, target: '_blank', rel: 'noopener noreferrer' }, 'Pagar fatura') : null)));

  if (!cartoes.length) {
    cartoes.push(el('div', { class: 'cartao vazio' },
      el('strong', {}, 'Nenhuma assinatura ativa'),
      el('span', {}, 'Fale com a Givance Tech para escolher um plano.')));
  }

  const limite = uso.data?.limite_leads;
  const usados = uso.data?.leads_mes ?? 0;
  if (limite) {
    const pct = Math.min(100, Math.round((usados / limite) * 100));
    const preenchimento = el('span');
    preenchimento.style.width = `${pct}%`;
    cartoes.unshift(el('div', { class: 'cartao' },
      el('div', { class: 'uso__numeros' },
        el('span', {}, 'Leads atendidos neste mês'),
        el('span', {}, el('strong', {}, String(usados)), ` de ${limite}`)),
      el('div', { class: `barra-uso${pct >= 85 ? ' barra-uso--alerta' : ''}`, role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'Uso de leads no mês' }, preenchimento),
      pct >= 85 ? el('small', {}, 'Você está perto do limite do plano. Fale com a Givance Tech para aumentar.') : null));
  }
  area.replaceChildren(el('div', { class: 'cartoes' }, cartoes));
}

// ---------- atualização automática ----------
setInterval(() => {
  if (document.visibilityState !== 'visible' || !estado.usuario || estado.aba !== 'conversas') return;
  carregarLeads();
  carregarMensagens();
}, ATUALIZAR_A_CADA_MS);

// ---------- início ----------
sb.auth.onAuthStateChange((evento) => { if (evento === 'SIGNED_OUT') mostrarLogin(); });
const { data: { session } } = await sb.auth.getSession();
if (session) entrar(session.user); else mostrarLogin();
