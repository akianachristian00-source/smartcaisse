-- =====================================================================
-- SmartCaisse : encaissement des abonnements via SasPay
-- A APPLIQUER sur le projet Supabase "Smartcaisse" (qdygbythaqrxqtpukkjk),
-- APRES migration_plans_et_essai.sql.
--
-- Principe : seul le serveur (clé service_role, fonctions /api sur Vercel)
-- peut créer un paiement et activer un abonnement. Le navigateur peut
-- seulement LIRE ses propres paiements.
-- =====================================================================

-- 1) Table des paiements SasPay ---------------------------------------------
create table if not exists public.paiements_saspay (
  id             uuid primary key default gen_random_uuid(),
  boutique_id    uuid not null references public.boutiques(id) on delete cascade,
  user_id        uuid not null,
  offre          text not null check (offre in ('essentiel','pro','premium')),
  mois           int  not null check (mois in (1,3,6,12)),
  montant        numeric(12,2) not null check (montant > 0),   -- prix de l'abonnement, hors frais
  devise         text not null default 'XAF',
  checkout_id    text,                                         -- id de la session SasPay
  checkout_url   text,
  transaction_id text,                                         -- id de la transaction SasPay (une fois payée)
  statut         text not null default 'PENDING'
                 check (statut in ('PENDING','SUCCESS','FAILED','EXPIRED','CANCELLED','ANOMALIE')),
  livre_at       timestamptz,                                  -- non nul = abonnement déjà activé (une seule fois)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Une même transaction SasPay ne peut financer qu'un seul abonnement
create unique index if not exists paiements_saspay_transaction_uniq
  on public.paiements_saspay (transaction_id) where transaction_id is not null;
create index if not exists paiements_saspay_user_idx
  on public.paiements_saspay (user_id, created_at desc);
create index if not exists paiements_saspay_statut_idx
  on public.paiements_saspay (statut, created_at desc);

-- 2) Sécurité : lecture de ses propres paiements seulement ---------------------
alter table public.paiements_saspay enable row level security;

drop policy if exists paiements_saspay_select_own on public.paiements_saspay;
create policy paiements_saspay_select_own on public.paiements_saspay
  for select to authenticated
  using (user_id = auth.uid());

-- Aucune politique insert/update/delete : seul le service_role (qui ignore la
-- RLS) peut écrire. Un utilisateur ne peut donc jamais se "payer" lui-même.
revoke insert, update, delete on public.paiements_saspay from anon, authenticated;

-- 3) Activation de l'abonnement, une seule fois ---------------------------------
-- Appelée uniquement par le serveur APRES vérification du paiement chez SasPay.
-- Retourne true si l'abonnement vient d'être activé, false s'il l'était déjà.
create or replace function public.livrer_paiement_saspay(p_paiement uuid, p_transaction text)
returns boolean language plpgsql security definer set search_path = public as $$
declare p public.paiements_saspay%rowtype;
begin
  select * into p from public.paiements_saspay where id = p_paiement for update;
  if not found then
    raise exception 'Paiement introuvable.';
  end if;
  if p.livre_at is not null then
    return false;  -- déjà livré : on n'ajoute pas une deuxième période
  end if;

  update public.boutiques
     set plan = 'actif',
         offre = p.offre,
         abonnement_fin = greatest(coalesce(abonnement_fin, now()), now()) + make_interval(months => p.mois)
   where id = p.boutique_id;

  update public.paiements_saspay
     set statut = 'SUCCESS',
         transaction_id = p_transaction,
         livre_at = now(),
         updated_at = now()
   where id = p.id;

  return true;
end $$;

revoke all on function public.livrer_paiement_saspay(uuid, text) from public, anon, authenticated;
grant execute on function public.livrer_paiement_saspay(uuid, text) to service_role;

-- 4) Total encaissé en ligne ce mois-ci (pour surveiller le plafond SasPay) -------
-- Réservé aux administrateurs. Mois civil, heure de Brazzaville.
create or replace function public.saspay_total_mois()
returns numeric language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.administrateurs where user_id = auth.uid()) then
    raise exception 'Reserve aux administrateurs.' using errcode = '42501';
  end if;
  return coalesce((
    select sum(montant) from public.paiements_saspay
     where livre_at is not null
       and livre_at >= date_trunc('month', now() at time zone 'Africa/Brazzaville') at time zone 'Africa/Brazzaville'
  ), 0);
end $$;

revoke all on function public.saspay_total_mois() from public, anon;
grant execute on function public.saspay_total_mois() to authenticated;

-- 5) Contrôles à faire après application ------------------------------------------
-- a) select * from public.paiements_saspay;  -> table vide au départ.
-- b) Lancer l'outil "advisors" (sécurité) de Supabase.
-- c) Variable Vercel SUPABASE_SERVICE_ROLE_KEY : jamais dans le dépôt GitHub.
