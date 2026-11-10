'use strict';
// POST /api/saspay-webhook
// URL à enregistrer dans SasPay (Développeur > Webhooks) :  https://<votre-site>/api/saspay-webhook
// Événements à cocher au minimum : transaction.success, transaction.failed
//
// Le webhook sert de DECLENCHEUR : il ne livre jamais sur la foi de son contenu.
// Pour chaque paiement en attente, le serveur redemande le statut réel à SasPay,
// puis active l'abonnement une seule fois (verrou en base).
const {
  config, configManquante, repondre, supabase, signatureValide, lireCorpsBrut, verifierEtLivrer,
} = require('./_saspay');

const EVENEMENTS = ['transaction.success', 'transaction.failed', 'transaction.cancelled', 'webhook.test'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return repondre(res, 405, { erreur: 'Méthode non autorisée.' });

  const cfg = config();
  if (configManquante(cfg, ['saspayKey', 'serviceKey', 'webhookSecret'])) {
    console.error('[saspay-webhook] variables manquantes');
    return repondre(res, 503, { erreur: 'Non configuré.' });
  }

  const corpsBrut = await lireCorpsBrut(req);
  const ok = signatureValide(
    corpsBrut,
    req.headers['x-webhook-signature'],
    req.headers['x-webhook-timestamp'],
    cfg.webhookSecret
  );
  if (!ok) return repondre(res, 401, { erreur: 'Signature invalide.' });

  let evenement = String(req.headers['x-webhook-event'] || '');
  try {
    const json = JSON.parse(corpsBrut.toString('utf8'));
    if (json && json.event) evenement = String(json.event);
  } catch (e) {
    return repondre(res, 400, { erreur: 'Corps invalide.' });
  }

  if (evenement === 'webhook.test') return repondre(res, 200, { ok: true, test: true });
  if (!EVENEMENTS.includes(evenement)) return repondre(res, 200, { ok: true, ignore: true });

  try {
    // Les paiements encore en attente des 48 dernières heures (au plus 10, pour rester sous la limite de 300 requêtes/min)
    const depuis = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const en_attente = await supabase('GET',
      '/rest/v1/paiements_saspay?select=*&statut=eq.PENDING&checkout_id=not.is.null' +
      '&created_at=gte.' + encodeURIComponent(depuis) + '&order=created_at.desc&limit=10');

    const resultats = await Promise.allSettled((en_attente || []).map((p) => verifierEtLivrer(p)));
    const erreurs = resultats.filter((r) => r.status === 'rejected');
    if (erreurs.length) {
      console.error('[saspay-webhook] erreurs :', erreurs.map((r) => r.reason && r.reason.message).join(' | '));
      // 500 => SasPay réessaiera plus tard
      return repondre(res, 500, { ok: false });
    }
    return repondre(res, 200, { ok: true, verifies: resultats.length });
  } catch (e) {
    console.error('[saspay-webhook] erreur :', e && e.message);
    return repondre(res, 500, { ok: false });
  }
};

// La signature se calcule sur le corps BRUT : on désactive l'analyse automatique du JSON.
// (à placer APRES module.exports = ..., sinon cette ligne est écrasée)
module.exports.config = { api: { bodyParser: false } };
