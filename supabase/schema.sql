-- Rode este arquivo no Supabase: SQL Editor > New query > colar > Run

-- Histórico das conversas (memória do agente)
create table if not exists mensagens (
  id            bigserial primary key,
  negocio       text not null,              -- 'elite-car' | 'givance'
  contato       text not null,              -- número do cliente (ex: 5561999999999)
  papel         text not null check (papel in ('user', 'assistant', 'humano')),
  conteudo      text not null,
  wa_message_id text unique,                -- evita responder duas vezes a mesma mensagem
  criado_em     timestamptz not null default now()
);
create index if not exists mensagens_conversa_idx on mensagens (negocio, contato, criado_em desc);

-- Leads (um por número, por negócio)
create table if not exists leads (
  negocio          text not null,
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
  primary key (negocio, contato)
);
create index if not exists leads_status_idx on leads (negocio, status, atualizado_em desc);

-- Só o servidor (chave service_role) acessa. Sem políticas = ninguém de fora lê.
alter table mensagens enable row level security;
alter table leads enable row level security;
