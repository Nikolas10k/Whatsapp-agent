-- Rode este arquivo no Supabase: SQL Editor > New query > colar > Run

-- Cada cliente do SaaS (empresa que usa o agente)
create table if not exists negocios (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,         -- identificador curto (ex: 'givance')
  nome            text not null,
  nome_agente     text not null,                -- como o agente se apresenta
  objetivo        text not null,
  ficha           text not null default '',     -- tudo que o agente sabe sobre o negócio
  dono_whatsapp   text,                         -- quem recebe o aviso de lead quente (DDI, sem +)
  contato_humano  text,                         -- WhatsApp da equipe, se ela não atende pelo mesmo número
  ativo           boolean not null default true, -- false = agente desligado (ex.: assinatura vencida)
  criado_em       timestamptz not null default now()
);

-- Números de WhatsApp conectados. Cada um aponta para um negócio.
create table if not exists numeros_whatsapp (
  phone_number_id text primary key,             -- "Identificação do número de telefone" na Meta
  negocio_id      uuid not null references negocios(id) on delete cascade,
  waba_id         text,
  telefone        text,                         -- só para exibir (ex: 5561999999999)
  access_token    text,                         -- token do cliente, CIFRADO (lib/cripto.js). Vazio = usa WHATSAPP_TOKEN da plataforma
  template_aviso  text,                         -- template aprovado na WABA do cliente para avisar o dono
  criado_em       timestamptz not null default now()
);
create index if not exists numeros_negocio_idx on numeros_whatsapp (negocio_id);

-- Quem pode entrar no painel de cada negócio (usuários do Supabase Auth)
create table if not exists membros (
  negocio_id  uuid not null references negocios(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  papel       text not null default 'dono' check (papel in ('dono', 'equipe')),
  criado_em   timestamptz not null default now(),
  primary key (negocio_id, user_id)
);
create index if not exists membros_user_idx on membros (user_id);

-- Histórico das conversas (memória do agente)
create table if not exists mensagens (
  id            bigserial primary key,
  negocio_id    uuid not null references negocios(id) on delete cascade,
  contato       text not null,              -- número do cliente (ex: 5561999999999)
  papel         text not null check (papel in ('user', 'assistant', 'humano')),
  conteudo      text not null,
  wa_message_id text unique,                -- evita responder duas vezes a mesma mensagem
  criado_em     timestamptz not null default now()
);
create index if not exists mensagens_conversa_idx on mensagens (negocio_id, contato, criado_em desc);

-- Leads (um por número, por negócio)
create table if not exists leads (
  negocio_id       uuid not null references negocios(id) on delete cascade,
  contato          text not null,
  nome_perfil      text,                    -- nome do perfil do WhatsApp
  nome             text,                    -- nome que o cliente informou
  interesse        text,
  detalhes         text,
  temperatura      text check (temperatura in ('frio', 'morno', 'quente')),
  status           text not null default 'novo', -- novo | qualificado | com_humano | fechado | perdido
  origem           text not null default 'organico', -- 'anuncio' quando veio de Click-to-WhatsApp
  anuncio_id       text,
  anuncio_titulo   text,
  anuncio_url      text,
  ctwa_clid        text,                    -- id do clique do anúncio (serve para conversões)
  bot_pausado_ate  timestamptz,             -- enquanto no futuro, o agente não responde (humano assumiu)
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  primary key (negocio_id, contato)
);
create index if not exists leads_status_idx on leads (negocio_id, status, atualizado_em desc);

-- Segurança: o servidor usa a chave service_role e enxerga tudo.
-- Pelo painel (usuário logado), cada um só LÊ os dados dos negócios de que é membro.
-- numeros_whatsapp não tem política nenhuma: os tokens nunca saem do servidor.
alter table negocios enable row level security;
alter table numeros_whatsapp enable row level security;
alter table membros enable row level security;
alter table mensagens enable row level security;
alter table leads enable row level security;

create or replace function eh_membro(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where negocio_id = n and user_id = auth.uid());
$$;

drop policy if exists "membro le negocio" on negocios;
create policy "membro le negocio" on negocios for select to authenticated using (eh_membro(id));

drop policy if exists "membro le os proprios vinculos" on membros;
create policy "membro le os proprios vinculos" on membros for select to authenticated using (user_id = auth.uid());

drop policy if exists "membro le mensagens" on mensagens;
create policy "membro le mensagens" on mensagens for select to authenticated using (eh_membro(negocio_id));

drop policy if exists "membro le leads" on leads;
create policy "membro le leads" on leads for select to authenticated using (eh_membro(negocio_id));
