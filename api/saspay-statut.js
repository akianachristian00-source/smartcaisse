'use strict';
// GET /api/saspay-statut?id=<paiement_id>      -> vérifie ce paiement chez SasPay, active l'abonnement si SUCCESS
// GET /api/saspay-statut?id=en-attente         -> rattrapage : vérifie le dernier paiement en attente de l'utilisateur
const {
  config, configManquante, repondre, supabase, utilisateurDepuisRequete, verifierEtLivrer,
} = require('./_saspay');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  if (req.method !== 'GET') return repondre(res, 405, { erreur: 'Méthode non autorisée.' });

  const cfg = config();
  if (configManquante(cfg, ['saspayKey', 'serviceKey'])) {
    return repondre(res, 503, { erreur: "Le paiement en ligne n'est pas encore configuré." });
  }

  try {
    const user = await utilisateurDepuisRequete(req);
    if (!user) return repondre(res, 401, { erreur: 'Connectez-vous.' });

    const id = String((req.query && req.query.id) || '');
    let filtre;
    if (id === 'en-attente') {
      const depuis = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      filtre = '&statut=eq.PENDING&checkout_id=not.is.null&created_at=gte.' + encodeURIComponent(depuis) +
        '&order=created_at.desc&limit=1';
    } else if (UUID.test(id)) {
      filtre = '&id=eq.' + id + '&limit=1';
    } else {
      return repondre(res, 400, { erreur: 'Identifiant invalide.' });
    }

    // On ne lit que les paiements de CET utilisateur
    const lignes = await supabase('GET',
      '/rest/v1/paiements_saspay?select=*&user_id=eq.' + encodeURIComponent(user.id) + filtre);
    const paiement = lignes && lignes[0];
    if (!paiement) return repondre(res, 200, { statut: 'AUCUN' });

    const r = await verifierEtLivrer(paiement);
    return repondre(res, 200, { statut: r.statut, paiement_id: paiement.id });
  } catch (e) {
    console.error('[saspay-statut] erreur :', e && e.message, e && e.status);
    if (e && e.status === 429) return repondre(res, 429, { erreur: 'Patientez quelques secondes.' });
    return repondre(res, 500, { erreur: 'Vérification impossible pour le moment.' });
  }
};
