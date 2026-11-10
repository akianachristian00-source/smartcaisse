'use strict';
// =====================================================================
// Outils partagés pour l'encaissement SasPay (fonctions serveur Vercel).
// Ce fichier commence par "_" : Vercel ne le publie PAS comme une route.
// La clé SasPay et la clé service_role ne quittent jamais le serveur.
// =====================================================================
const crypto = require('crypto');

const SASPAY_BASE = 'https://api.saspay.me/api/v1';

// Prix et remises : DOIVENT rester identiques à OFFRES / remises de app.js
// et de la table public.plans. Le serveur recalcule toujours le montant :
// on ne fait jamais confiance au prix envoyé par le navigateur.
const PRIX = { essentiel: 3500, pro: 7500, premium: 12500 };
const REMISES = { 1: 0, 3: 5, 6: 10, 12: 15 };

function env(nom, defaut) {
  const v = process.env[nom];
  return v && v.trim() ? v.trim() : defaut;
}

function config() {
  return {
    saspayKey: env('SASPAY_API_KEY'),
    webhookSecret: env('SASPAY_WEBHOOK_SECRET'),
    appUrl: (env('APP_URL', '') || '').replace(/\/+$/, ''),
    supabaseUrl: (env('SUPABASE_URL', 'https://qdygbythaqrxqtpukkjk.supabase.co') || '').replace(/\/+$/, ''),
    // clé publique (déjà présente dans app.js) : sert seulement à valider le jeton de l'utilisateur
    supabaseAnon: env('SUPABASE_ANON_KEY', 'sb_publishable_I5YUHBY5zeaR4DRcOlfdkw_XMjMfjmD'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    // Plafond du compte SasPay "Particulier" : 1 000 000 FCFA/mois. On s'arrête un peu avant,
    // car on ne sait pas si SasPay compte le montant avec ou sans frais (~5,7 %).
    plafondMensuel: Number(env('SASPAY_PLAFOND_MENSUEL', '940000')),
    // DEDUCTED : le client paie exactement le prix affiché, les frais SasPay sont prélevés sur ce que tu reçois.
    // ADD_ON   : le client paie les frais EN PLUS du prix.
    modeFrais: ['ADD_ON', 'DEDUCTED'].includes(env('SASPAY_FEE_MODE', 'DEDUCTED')) ? env('SASPAY_FEE_MODE', 'DEDUCTED') : 'DEDUCTED',
  };
}

function configManquante(cfg, besoins) {
  const manquants = besoins.filter((k) => !cfg[k]);
  return manquants.length ? manquants : null;
}

// ---------- Montant (en FCFA entiers, calculé côté serveur) ----------------
function calculerMontant(offre, mois) {
  if (!Object.prototype.hasOwnProperty.call(PRIX, offre)) return null;
  if (!Object.prototype.hasOwnProperty.call(REMISES, mois)) return null;
  return Math.round((PRIX[offre] * mois * (100 - REMISES[mois])) / 100);
}

// SasPay veut des montants en chaîne décimale : "3500.00", jamais un flottant
function montantDecimal(n) {
  return Number(n).toFixed(2);
}

// ---------- Réponses HTTP -----------------------------------------------------
function repondre(res, code, corps) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

// ---------- Appels SasPay -------------------------------------------------------
class ErreurSasPay extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function saspay(methode, chemin, corps) {
  const cfg = config();
  const res = await fetch(SASPAY_BASE + chemin, {
    method: methode,
    headers: {
      Authorization: 'Bearer ' + cfg.saspayKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* corps vide ou non JSON */ }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || 'Erreur SasPay';
    const code = json && json.error && json.error.code;
    throw new ErreurSasPay(msg, res.status, code);
  }
  // Enveloppe documentée : { success, data, code } ; on accepte aussi un objet brut
  return json && json.data && typeof json.data === 'object' ? json.data : json;
}

// ---------- Appels Supabase (clé service_role, serveur uniquement) ----------------
async function supabase(methode, chemin, corps, extra) {
  const cfg = config();
  const res = await fetch(cfg.supabaseUrl + chemin, {
    method: methode,
    headers: Object.assign({
      apikey: cfg.serviceKey,
      Authorization: 'Bearer ' + cfg.serviceKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }, extra || {}),
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await res.text();
  let json = null;
  try { json = texte ? JSON.parse(texte) : null; } catch (e) { /* ignore */ }
  if (!res.ok) {
    const err = new Error((json && (json.message || json.error)) || 'Erreur base de données');
    err.status = res.status;
    throw err;
  }
  return json;
}

// Qui appelle ? On demande à Supabase de valider le jeton de connexion.
async function utilisateurDepuisRequete(req) {
  const cfg = config();
  const entete = req.headers['authorization'] || '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7).trim() : '';
  if (!jeton) return null;
  const res = await fetch(cfg.supabaseUrl + '/auth/v1/user', {
    headers: { apikey: cfg.supabaseAnon, Authorization: 'Bearer ' + jeton },
  });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? { id: u.id, email: u.email || '' } : null;
}

// ---------- Webhook : signature ------------------------------------------------------
// HMAC SHA-256 (hex) de "<timestamp>.<corps brut>", tolérance 300 s, comparaison en temps constant.
function signatureValide(corpsBrut, signature, timestamp, secret) {
  if (!secret || !signature || !timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const attendu = crypto.createHmac('sha256', secret)
    .update(String(timestamp) + '.')
    .update(corpsBrut)
    .digest('hex');
  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(String(signature).trim().toLowerCase(), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Corps brut de la requête (indispensable : la signature se calcule sur les octets reçus)
async function lireCorpsBrut(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  const morceaux = [];
  for await (const m of req) morceaux.push(Buffer.isBuffer(m) ? m : Buffer.from(m));
  return Buffer.concat(morceaux);
}

// ---------- Vérifier un paiement chez SasPay, puis livrer UNE seule fois -------------
// Règle d'or : on ne livre jamais sur la foi d'un webhook, d'une redirection ou du navigateur.
// Seul le statut SUCCESS lu directement chez SasPay (côté serveur) active l'abonnement.
async function verifierEtLivrer(paiement) {
  if (paiement.livre_at) return { statut: 'SUCCESS', livre: false };
  if (!paiement.checkout_id) return { statut: paiement.statut === 'PENDING' ? 'PENDING' : paiement.statut };

  const session = await saspay('GET', '/checkout-sessions/' + encodeURIComponent(paiement.checkout_id) + '/status/');
  const transactionId = session && session.transaction_id ? String(session.transaction_id) : null;

  if (!transactionId) {
    if (session && (session.status === 'EXPIRED' || session.status === 'CANCELLED')) {
      await majPaiement(paiement.id, { statut: session.status });
      return { statut: session.status };
    }
    return { statut: 'PENDING' };
  }

  const v = await saspay('GET', '/payments/' + encodeURIComponent(transactionId) + '/verify/');
  const statutSasPay = v && v.status;

  if (statutSasPay === 'SUCCESS') {
    const demande = Number(v.requested_amount);
    const devise = v.currency;
    const montantOk = Number.isFinite(demande) && demande + 0.005 >= Number(paiement.montant);
    const deviseOk = devise === paiement.devise;
    if (!montantOk || !deviseOk) {
      // Paiement réussi mais montant/devise inattendus : on ne livre pas, un humain tranche.
      console.error('[saspay] ANOMALIE paiement', paiement.id, 'attendu', paiement.montant, paiement.devise,
        'recu', v.requested_amount, devise);
      await majPaiement(paiement.id, { statut: 'ANOMALIE', transaction_id: transactionId });
      return { statut: 'ANOMALIE' };
    }
    const livre = await supabase('POST', '/rest/v1/rpc/livrer_paiement_saspay', {
      p_paiement: paiement.id,
      p_transaction: transactionId,
    });
    return { statut: 'SUCCESS', livre: livre === true };
  }

  if (statutSasPay === 'FAILED' || statutSasPay === 'CANCELLED') {
    await majPaiement(paiement.id, { statut: 'FAILED', transaction_id: null });
    return { statut: 'FAILED' };
  }
  return { statut: 'PENDING' };
}

async function majPaiement(id, champs) {
  const corps = Object.assign({}, champs, { updated_at: new Date().toISOString() });
  await supabase('PATCH', '/rest/v1/paiements_saspay?id=eq.' + encodeURIComponent(id), corps);
}

// Début du mois civil à Brazzaville (UTC+1, sans heure d'été), en ISO UTC
function debutDuMoisIso() {
  const local = new Date(Date.now() + 3600000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 3600000).toISOString();
}

module.exports = {
  PRIX, REMISES, config, configManquante, calculerMontant, montantDecimal, repondre,
  saspay, supabase, utilisateurDepuisRequete, signatureValide, lireCorpsBrut,
  verifierEtLivrer, majPaiement, debutDuMoisIso, ErreurSasPay,
};
