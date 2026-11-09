-- =====================================================================
-- SmartCaisse : offres, essai 72h, anti-abus et limites par plan
-- A APPLIQUER sur le projet Supabase "Smartcaisse" (qdygbythaqrxqtpukkjk)
-- une fois le projet réactivé (il est actuellement en pause).
-- Les limites sont appliquées ICI, côté base : le navigateur ne peut pas
-- les contourner.
-- Hypothèses sur l'existant (à vérifier avant d'appliquer) :
--   boutiques(id, user_id, nom, telephone, pays, plan, essai_fin, nom_ia, created_at)
--   dettes(id, boutique_id, client, montant, telephone, regle, regle_at, created_at)
--   devis(id, boutique_id, client, telephone, lignes, total, created_at)
--   administrateurs(user_id)
-- =====================================================================

-- 1) Nouvelles colonnes -------------------------------------------------
alter table public.boutiques add column if not exists offre text
  check (offre in ('essentiel','pro','premium'));
alter table public.boutiques add column if not exists abonnement_fin timestamptz;
alter table public.boutiques add column if not exists telephone_norm text;
alter table public.boutiques add column if not exists email_norm text;

-- 2) Normalisation : téléphone congolais et e-mail ------------------------
create or replace function public.normaliser_telephone_cg(t text)
returns text language plpgsql immutable as $$
declare chiffres text;
begin
  chiffres := regexp_replace(coalesce(t,''), '\D', '', 'g');
  if chiffres like '242%' and length(chiffres) = 12 then
    chiffres := substr(chiffres, 4);
  end if;
  -- numéro mobile congolais : 9 chiffres, commence par 04, 05 ou 06
  if chiffres ~ '^0[456][0-9]{7}$' then
    return '+242' || chiffres;
  end if;
  return null;
end $$;

create or replace function public.normaliser_email(e text)
returns text language plpgsql immutable as $$
declare local_part text; domaine text;
begin
  e := lower(trim(coalesce(e,'')));
  if position('@' in e) = 0 then return e; end if;
  local_part := split_part(e, '@', 1);
  domaine := split_part(e, '@', 2);
  local_part := split_part(local_part, '+', 1);
  if domaine in ('gmail.com','googlemail.com') then
    local_part := replace(local_part, '.', '');
    domaine := 'gmail.com';
  end if;
  return local_part || '@' || domaine;
end $$;

-- 3) Un seul essai par téléphone et par e-mail normalisé -------------------
-- (si des doublons existent déjà, créer les index échouera : les corriger
--  d'abord ou ne les créer que pour les nouvelles lignes)
create unique index if not exists boutiques_telephone_norm_uniq
  on public.boutiques (telephone_norm) where telephone_norm is not null;
create unique index if not exists boutiques_email_norm_uniq
  on public.boutiques (email_norm) where email_norm is not null;

-- 4) Création d'une boutique : essai fixé par le serveur -------------------
create or replace function public.boutiques_avant_insertion()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare mail text;
begin
  select email into mail from auth.users where id = new.user_id;
  new.telephone_norm := public.normaliser_telephone_cg(new.telephone);
  if new.telephone_norm is null then
    raise exception 'Numero de telephone invalide. Utilisez un numero congolais (ex: 06 123 45 67).'
      using errcode = 'P0001';
  end if;
  new.telephone := new.telephone_norm;
  new.email_norm := public.normaliser_email(mail);
  new.pays := 'CG';
  -- le client ne choisit ni son plan ni la fin de son essai
  new.plan := 'essai';
  new.offre := null;
  new.abonnement_fin := null;
  new.essai_fin := now() + interval '72 hours';
  return new;
end $$;

drop trigger if exists trg_boutiques_avant_insertion on public.boutiques;
create trigger trg_boutiques_avant_insertion
  before insert on public.boutiques
  for each row execute function public.boutiques_avant_insertion();

-- 5) Un utilisateur ne peut pas modifier son plan, son offre ni son essai ----
create or replace function public.boutiques_avant_modification()
returns trigger language plpgsql security definer set search_path = public as $$
declare est_admin boolean;
begin
  select exists(select 1 from public.administrateurs where user_id = auth.uid()) into est_admin;
  -- auth.uid() est null quand la modification vient du serveur (service role)
  if auth.uid() is not null and not est_admin then
    new.plan := old.plan;
    new.offre := old.offre;
    new.abonnement_fin := old.abonnement_fin;
    new.essai_fin := old.essai_fin;
    new.telephone_norm := old.telephone_norm;
    new.email_norm := old.email_norm;
    new.user_id := old.user_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_boutiques_avant_modification on public.boutiques;
create trigger trg_boutiques_avant_modification
  before update on public.boutiques
  for each row execute function public.boutiques_avant_modification();

-- 6) Accès autorisé ? (essai en cours ou abonnement actif) ------------------
create or replace function public.offre_effective(p_boutique uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when b.plan = 'actif' and (b.abonnement_fin is null or b.abonnement_fin > now())
      then coalesce(b.offre, 'essentiel')
    when b.plan = 'essai' and b.essai_fin > now() then 'essai'
    else 'expire'
  end
  from public.boutiques b where b.id = p_boutique;
$$;

-- 7) Limites par plan sur les dettes (10 en cours pour Essentiel et essai) ---
create or replace function public.dettes_limite()
returns trigger language plpgsql security definer set search_path = public as $$
declare offre text; en_cours int;
begin
  offre := public.offre_effective(new.boutique_id);
  if offre = 'expire' or offre is null then
    raise exception 'Abonnement expire : choisissez une offre pour continuer.' using errcode = 'P0001';
  end if;
  if offre in ('essai','essentiel') then
    select count(*) into en_cours from public.dettes
      where boutique_id = new.boutique_id and coalesce(regle,false) = false;
    if en_cours >= 10 then
      raise exception 'Limite de 10 dettes en cours atteinte. Passez a l''offre Pro pour des dettes illimitees.'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_dettes_limite on public.dettes;
create trigger trg_dettes_limite
  before insert on public.dettes
  for each row execute function public.dettes_limite();

-- 8) Devis réservés à Pro et Premium ----------------------------------------
create or replace function public.devis_limite()
returns trigger language plpgsql security definer set search_path = public as $$
declare offre text;
begin
  offre := public.offre_effective(new.boutique_id);
  if offre not in ('pro','premium') then
    raise exception 'Les devis sont inclus a partir de l''offre Pro.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_devis_limite on public.devis;
create trigger trg_devis_limite
  before insert on public.devis
  for each row execute function public.devis_limite();

-- 9) Ventes et produits : bloqués quand l'essai est terminé -------------------
create or replace function public.acces_actif_requis()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.offre_effective(new.boutique_id) = 'expire' then
    raise exception 'Abonnement expire : choisissez une offre pour continuer.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_ventes_acces on public.ventes;
create trigger trg_ventes_acces before insert on public.ventes
  for each row execute function public.acces_actif_requis();

drop trigger if exists trg_produits_acces on public.produits;
create trigger trg_produits_acces before insert on public.produits
  for each row execute function public.acces_actif_requis();

-- 10) Activation d'un abonnement par l'administrateur (avant GeniusPay) -------
-- Utilisation depuis l'espace admin : select public.activer_abonnement(<boutique>, 'pro', 3);
create or replace function public.activer_abonnement(p_boutique uuid, p_offre text, p_mois int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.administrateurs where user_id = auth.uid()) then
    raise exception 'Reserve aux administrateurs.' using errcode = '42501';
  end if;
  if p_offre not in ('essentiel','pro','premium') or p_mois not in (1,3,6,12) then
    raise exception 'Parametres invalides.';
  end if;
  update public.boutiques
     set plan = 'actif',
         offre = p_offre,
         abonnement_fin = greatest(coalesce(abonnement_fin, now()), now()) + make_interval(months => p_mois)
   where id = p_boutique;
end $$;

revoke all on function public.activer_abonnement(uuid, text, int) from public, anon;
grant execute on function public.activer_abonnement(uuid, text, int) to authenticated;

-- 11) Ajustements constatés sur la base réelle -------------------------------
-- a) colonne utilisée par l'app pour le nom de l'assistant IA
alter table public.boutiques add column if not exists nom_ia text;

-- b) is_admin() : chemin de recherche figé (alerte de sécurité Supabase)
alter function public.is_admin() set search_path = public;

-- c) la table abonnements n'est pas utilisée par l'app : on retire la possibilité
--    pour un utilisateur de s'y créer ou modifier un abonnement lui-même
drop policy if exists abonnements_insert_own on public.abonnements;
drop policy if exists abonnements_update_own on public.abonnements;

-- d) prix et remises de référence alignés sur la nouvelle grille
update public.plans set prix_mensuel = 3500  where code = 'essentiel';
update public.plans set prix_mensuel = 7500  where code = 'pro';
update public.plans set prix_mensuel = 12500 where code = 'premium';
update public.reductions_duree set reduction_pourcent = 0  where duree_mois = 1;
update public.reductions_duree set reduction_pourcent = 5  where duree_mois = 3;
update public.reductions_duree set reduction_pourcent = 10 where duree_mois = 6;
update public.reductions_duree set reduction_pourcent = 15 where duree_mois = 12;

-- e) compte administrateur existant : Premium 12 mois pour pouvoir tout tester
update public.boutiques b
   set plan = 'actif', offre = 'premium', abonnement_fin = now() + interval '12 months'
 where exists (select 1 from public.administrateurs a where a.user_id = b.user_id);

-- 12) Contrôles à faire après application ------------------------------------
-- a) Les politiques RLS de boutiques/produits/ventes/dettes/devis doivent
--    toutes filtrer sur boutiques.user_id = auth.uid().
-- b) La table administrateurs ne doit être lisible que par son propre
--    utilisateur, et seul un admin doit pouvoir lire toutes les boutiques.
-- c) Lancer l'outil "advisors" de Supabase (sécurité) après la migration.
