'use strict';
// POST /api/saspay-creer   { offre: "pro", mois: 3 }
// Crée une session de paiement SasPay (page de paiement hébergée) et renvoie son lien.
// Le client choisit MTN ou Airtel sur la page SasPay : pas besoin de code réseau ici.
const {
  config, configManquante, calculerMontant, montantDecimal, repondre,
  saspay, supabase, utilisateurDepuisRequete, majPaiement, debutDuMoisIso,
} = require('./_saspay');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return repondre(res, 405, { erreur: 'Méthode non autorisée.' });

  const cfg = config();
  const manque = configManquante(cfg, ['saspayKey', 'serviceKey', 'appUrl']);
  if (manque) {
    console.error('[saspay-creer] variables manquantes :', manque.join(', '));
    return repondre(res, 503, { erreur: "Le paiement en ligne n'est pas encore configuré." });
  }

  try {
    const user = await utilisateurDepuisRequete(req);
    if (!user) return repondre(res, 401, { erreur: 'Connectez-vous pour payer.' });

    // Corps JSON (Vercel le lit déjà ; on accepte aussi une chaîne)
    let corps = req.body;
    if (typeof corps === 'string') { try { corps = JSON.parse(corps); } catch (e) { corps = null; } }
    const offre = corps && String(corps.offre || '');
    const mois = corps && Number(corps.mois);
    const montant = calculerMontant(offre, mois);
    if (!montant) return repondre(res, 400, { erreur: 'Offre ou durée invalide.' });

    // La boutique est retrouvée par l'identité de l'utilisateur, jamais par un id envoyé par le navigateur
    const boutiques = await supabase('GET',
      '/rest/v1/boutiques?select=id,nom&user_id=eq.' + encodeURIComponent(user.id) + '&limit=1');
    const boutique = boutiques && boutiques[0];
    if (!boutique) return repondre(res, 404, { erreur: 'Boutique introuvable.' });

    // Plafond mensuel du compte SasPay Particulier : on arrête les paiements en ligne avant de l'atteindre
    const livres = await supabase('GET',
      '/rest/v1/paiements_saspay?select=montant&livre_at=gte.' + encodeURIComponent(debutDuMoisIso()));
    const totalMois = (livres || []).reduce((s, p) => s + Number(p.montant || 0), 0);
    if (totalMois + montant > cfg.plafondMensuel) {
      console.error('[saspay-creer] plafond mensuel proche : total', totalMois, '+', montant);
      return repondre(res, 409, {
        code: 'plafond',
        erreur: "Le paiement en ligne est momentanément indisponible. Payez via WhatsApp, nous activons votre offre.",
      });
    }

    // Même demande dans les 10 dernières minutes : on réutilise le lien (SasPay ne déduplique pas les sessions)
    const depuis = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recents = await supabase('GET',
      '/rest/v1/paiements_saspay?select=id,checkout_url&statut=eq.PENDING&checkout_url=not.is.null' +
      '&user_id=eq.' + encodeURIComponent(user.id) +
      '&offre=eq.' + encodeURIComponent(offre) + '&mois=eq.' + mois +
      '&created_at=gte.' + encodeURIComponent(depuis) + '&order=created_at.desc&limit=1');
    if (recents && recents[0]) {
      return repondre(res, 200, { paiement_id: recents[0].id, checkout_url: recents[0].checkout_url });
    }

    // 1) on enregistre l'intention de paiement (statut PENDING)
    const lignes = await supabase('POST', '/rest/v1/paiements_saspay', {
      boutique_id: boutique.id,
      user_id: user.id,
      offre,
      mois,
      montant,
      devise: 'XAF',
    });
    const paiement = lignes && lignes[0];
    if (!paiement) throw new Error('Enregistrement du paiement impossible.');

    // 2) on crée la session chez SasPay
    let session;
    try {
      session = await saspay('POST', '/checkout-sessions/', {
        amount: montantDecimal(montant),            // chaîne décimale : "7500.00"
        currency: 'XAF',
        country: 'CG',
        description: 'Abonnement SmartCaisse ' + offre + ' - ' + mois + ' mois',
        customer_email: user.email,
        customer_name: String(boutique.nom || 'Client SmartCaisse').slice(0, 100),
        return_url: cfg.appUrl + '/?paiement=' + paiement.id,
        metadata: { paiement_id: paiement.id, boutique_id: boutique.id, offre, mois },
        fee_charge_mode: cfg.modeFrais,             // DEDUCTED par défaut : le client paie le prix exact (si autorisé sur le compte)
      });
    } catch (e) {
      await majPaiement(paiement.id, { statut: 'FAILED' });
      console.error('[saspay-creer] SasPay a refusé la session :', e.status, e.code, e.message);
      if (e.status === 429) return repondre(res, 429, { erreur: 'Trop de demandes, réessayez dans une minute.' });
      return repondre(res, 502, { erreur: "Le service de paiement n'est pas disponible. Réessayez ou payez via WhatsApp." });
    }

    const url = session && session.checkout_url;
    if (!session || !session.id || typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      await majPaiement(paiement.id, { statut: 'FAILED' });
      console.error('[saspay-creer] réponse SasPay inattendue (id ou checkout_url manquant)');
      return repondre(res, 502, { erreur: "Le service de paiement n'est pas disponible. Réessayez ou payez via WhatsApp." });
    }

    await majPaiement(paiement.id, { checkout_id: String(session.id), checkout_url: url });
    return repondre(res, 200, { paiement_id: paiement.id, checkout_url: url });
  } catch (e) {
    console.error('[saspay-creer] erreur :', e && e.message);
    return repondre(res, 500, { erreur: 'Erreur inattendue. Réessayez.' });
  }
};
