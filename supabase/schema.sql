-- Rode este arquivo no Supabase: SQL Editor > New query > colar > Run
-- Roda no mesmo banco do Givance Publi: o cliente é o workspace (tabela workspaces),
-- e quem acessa é quem está em workspace_members. Tudo do agente tem o prefixo agente_.

-- Configuração do agente de WhatsApp de cada cliente
create table if not exists agente_negocios (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  account_id      uuid references accounts(id) on delete set null, -- de qual marca (brand_profiles) puxar tom e serviços
  slug            text not null unique,         -- identificador curto (ex: 'givance')
  nome            text not null,
  nome_agente     text not null,                -- como o agente se apresenta
  objetivo        text not null,
  ficha           text not null default '',     -- o que o Instagram não mostra: preços, horários, condições
  dono_whatsapp   text,                         -- quem recebe o aviso de lead quente (DDI, sem +)
  contato_humano  text,                         -- WhatsApp da equipe, se ela não atende pelo mesmo número
  ativo           boolean not null default true, -- false = agente desligado (ex.: assinatura vencida)
  criado_em       timestamptz not null default now()
);
create index if not exists agente_negocios_workspace_idx on agente_negocios (workspace_id);

-- Números de WhatsApp conectados. Cada um aponta para um negócio.
create table if not exists agente_numeros (
  phone_number_id text primary key,             -- "Identificação do número de telefone" na Meta
  negocio_id      uuid not null references agente_negocios(id) on delete cascade,
  waba_id         text,
  telefone        text,                         -- só para exibir (ex: 5561999999999)
  access_token    text,                         -- token do cliente, CIFRADO (lib/cripto.js). Vazio = usa WHATSAPP_TOKEN da plataforma
  template_aviso  text,                         -- template aprovado na WABA do cliente para avisar o dono
  criado_em       timestamptz not null default now()
);
create index if not exists agente_numeros_negocio_idx on agente_numeros (negocio_id);

-- Histórico das conversas (memória do agente)
create table if not exists agente_mensagens (
  id            bigserial primary key,
  negocio_id    uuid not null references agente_negocios(id) on delete cascade,
  contato       text not null,              -- número do cliente (ex: 5561999999999)
  papel         text not null check (papel in ('user', 'assistant', 'humano')),
  conteudo      text not null,
  wa_message_id text unique,                -- evita responder duas vezes a mesma mensagem
  criado_em     timestamptz not null default now()
);
create index if not exists agente_mensagens_conversa_idx on agente_mensagens (negocio_id, contato, criado_em desc);

-- Leads (um por número, por negócio)
create table if not exists agente_leads (
  negocio_id       uuid not null references agente_negocios(id) on delete cascade,
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
create index if not exists agente_leads_status_idx on agente_leads (negocio_id, status, atualizado_em desc);
create index if not exists agente_leads_mes_idx on agente_leads (negocio_id, criado_em);

-- Segurança: o servidor usa a chave service_role e enxerga tudo.
-- Pelo painel, cada usuário só LÊ o que é dos workspaces de que é membro.
-- agente_numeros não tem política nenhuma: os tokens nunca saem do servidor.
alter table agente_negocios enable row level security;
alter table agente_numeros enable row level security;
alter table agente_mensagens enable row level security;
alter table agente_leads enable row level security;

create or replace function givance_private.agente_pode_ver(n uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agente_negocios a
    where a.id = n and givance_private.is_workspace_member(a.workspace_id)
  );
$$;

drop policy if exists "membros leem o agente" on agente_negocios;
create policy "membros leem o agente" on agente_negocios for select to authenticated
  using (givance_private.is_workspace_member(workspace_id));

drop policy if exists "membros leem mensagens" on agente_mensagens;
create policy "membros leem mensagens" on agente_mensagens for select to authenticated
  using (givance_private.agente_pode_ver(negocio_id));

drop policy if exists "membros leem leads" on agente_leads;
create policy "membros leem leads" on agente_leads for select to authenticated
  using (givance_private.agente_pode_ver(negocio_id));
