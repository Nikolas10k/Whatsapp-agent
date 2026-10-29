-- Planos e assinaturas da plataforma Givance (Publi + Agente). Rode depois do schema.sql.
-- A cobrança em si fica no Asaas; aqui fica o que cada workspace contratou e quanto já usou no mês.

-- Catálogo de planos. Limite vazio (null) = o plano não inclui aquele produto.
create table if not exists givance_planos (
  id                 text primary key,           -- ex: 'publi_basico'
  produto            text not null check (produto in ('publi', 'agente', 'combo')),
  nome               text not null,
  preco_centavos     integer not null,
  limite_posts       integer,                    -- posts gerados por mês (Publi)
  limite_carrosseis  integer,                    -- quantos desses podem ser carrossel
  limite_leads       integer,                    -- leads novos atendidos por mês (Agente)
  ativo              boolean not null default true, -- false = não aparece mais para venda
  ordem              integer not null default 0
);

insert into givance_planos (id, produto, nome, preco_centavos, limite_posts, limite_carrosseis, limite_leads, ordem) values
  ('publi_basico',     'publi',  'Publi Básico',     4990, 20,  4, null, 1),
  ('publi_pro',        'publi',  'Publi Pro',        8990, 35, 10, null, 2),
  ('agente_essencial', 'agente', 'Agente Essencial', 9700, null, null, 150, 3),
  ('agente_pro',       'agente', 'Agente Pro',      19700, null, null, 500, 4),
  ('combo_basico',     'combo',  'Combo',           12990, 20,  4, 150, 5)
on conflict (id) do update set
  produto = excluded.produto, nome = excluded.nome, preco_centavos = excluded.preco_centavos,
  limite_posts = excluded.limite_posts, limite_carrosseis = excluded.limite_carrosseis,
  limite_leads = excluded.limite_leads, ordem = excluded.ordem;

-- O que cada workspace contratou. Um workspace pode ter mais de uma (ex.: Publi Pro + Agente Pro).
create table if not exists givance_assinaturas (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references workspaces(id) on delete cascade,
  plano_id               text not null references givance_planos(id),
  status                 text not null default 'teste' check (status in ('teste', 'ativa', 'atrasada', 'cancelada')),
  preco_centavos         integer not null,       -- preço travado na contratação (ex.: preço de fundador)
  asaas_customer_id      text,
  asaas_subscription_id  text unique,
  periodo_inicio         timestamptz not null default now(),
  periodo_fim            timestamptz,            -- fim do período pago (ou do teste)
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);
create index if not exists givance_assinaturas_workspace_idx on givance_assinaturas (workspace_id, status);

-- Limites somados de tudo que o workspace tem ativo, e o uso no mês corrente (horário de Brasília).
create or replace view givance_uso_mes with (security_invoker = true) as
with mes as (
  select date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo' as inicio
),
limites as (
  select a.workspace_id,
         sum(p.limite_posts)      as limite_posts,
         sum(p.limite_carrosseis) as limite_carrosseis,
         sum(p.limite_leads)      as limite_leads
  from givance_assinaturas a join givance_planos p on p.id = a.plano_id
  where a.status in ('teste', 'ativa')
  group by a.workspace_id
)
select w.id as workspace_id,
       l.limite_posts, l.limite_carrosseis, l.limite_leads,
       (select count(*) from posts po join accounts ac on ac.id = po.account_id
         where ac.workspace_id = w.id and po.created_at >= (select inicio from mes)) as posts_mes,
       (select count(*) from posts po join accounts ac on ac.id = po.account_id
         where ac.workspace_id = w.id and po.type = 'carrossel' and po.created_at >= (select inicio from mes)) as carrosseis_mes,
       (select count(*) from agente_leads le join agente_negocios n on n.id = le.negocio_id
         where n.workspace_id = w.id and le.criado_em >= (select inicio from mes)) as leads_mes
from workspaces w left join limites l on l.workspace_id = w.id;

-- Segurança: planos são públicos (a landing page lê os preços); assinatura só o próprio workspace vê.
-- Criar e alterar assinatura é só pelo servidor (webhook do Asaas), nunca pelo navegador.
alter table givance_planos enable row level security;
alter table givance_assinaturas enable row level security;

drop policy if exists "todos leem planos ativos" on givance_planos;
create policy "todos leem planos ativos" on givance_planos for select to anon, authenticated using (ativo);

drop policy if exists "membros leem assinaturas" on givance_assinaturas;
create policy "membros leem assinaturas" on givance_assinaturas for select to authenticated
  using (givance_private.is_workspace_member(workspace_id));
