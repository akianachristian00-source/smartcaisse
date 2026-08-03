// ==========================================
// CONFIGURATION SUPABASE
// ==========================================
const SUPABASE_URL = 'https://fugmcqbxfouzjftyoddd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kJ1asJ_bg_rWSb4kzXxLTA_PQgRklHo';

// Initialisation du client Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// LOGIQUE DE L'APPLICATION SMARTCAISSE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('SmartCaisse connectée avec succès à Supabase.');

  // Gestion des clics sur les boutons d'action
  const btnVente = document.getElementById('btn-vente');
  const btnStock = document.getElementById('btn-stock');

  if (btnVente) {
    btnVente.addEventListener('click', () => {
      alert('Module Nouvelle Vente : Connecté à la base de données !');
    });
  }

  if (btnStock) {
    btnStock.addEventListener('click', () => {
      alert('Module Gestion Stock : En cours d\'accès aux articles.');
    });
  }

  // Chargement des données au démarrage
  chargerStatistiquesDuJour();
});

// Fonction pour récupérer les chiffres du jour depuis Supabase
async function chargerStatistiquesDuJour() {
  try {
    // 1. Récupération des ventes
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('total_amount');

    if (!salesError && sales) {
      const totalVentes = sales.reduce((acc, sale) => acc + Number(sale.total_amount), 0);
      console.log('Total Ventes chargées :', totalVentes);
    }

    // 2. Récupération des dettes
    const { data: debts, error: debtsError } = await supabase
      .from('debts')
      .select('amount')
      .eq('status', 'pending');

    if (!debtsError && debts) {
      const totalDettes = debts.reduce((acc, debt) => acc + Number(debt.amount), 0);
      console.log('Total Créances chargées :', totalDettes);
    }
  } catch (err) {
    console.error('Erreur lors du chargement des données :', err);
  }
}
