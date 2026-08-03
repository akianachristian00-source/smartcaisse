// ==========================================
// CONFIGURATION SUPABASE
// ==========================================
const SUPABASE_URL = 'https://fugmcqbxfouzjftyoddd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kJ1asJ_bg_rWSb4kzXxLTA_PQgRklHo';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let salesChartInstance = null;

// ==========================================
// INITIALISATION DU GRAPHIQUE STYLE STRIPE
// ==========================================
function initChart() {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  // Éviter de recréer plusieurs graphiques si déjà créé
  if (salesChartInstance) {
    salesChartInstance.destroy();
  }

  const chartCtx = ctx.getContext('2d');

  // Création du dégradé de couleur sous la courbe (Style Stripe)
  const gradient = chartCtx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, 'rgba(37, 99, 235, 0.4)'); // Bleu haut
  gradient.addColorStop(1, 'rgba(37, 99, 235, 0.0)'); // Transparent bas

  salesChartInstance = new Chart(chartCtx, {
    type: 'line',
    data: {
      labels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
      datasets: [{
        label: 'Ventes (FCFA)',
        data: [0, 0, 0, 0, 0, 0, 0], // Données réelles à charger dynamiquement
        borderColor: '#3b82f6',
        borderWidth: 2.5,
        fill: true,
        backgroundColor: gradient,
        tension: 0.4, // Rend la courbe fluide et arrondie
        pointBackgroundColor: '#3b82f6',
        pointRadius: 0,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#94a3b8',
          bodyColor: '#f8fafc',
          borderColor: '#1e293b',
          borderWidth: 1,
          padding: 10,
          displayColors: false,
          callbacks: {
            label: function(context) {
              return context.parsed.y + ' FCFA';
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b', font: { size: 10 } }
        },
        y: {
          display: false,
          grid: { display: false }
        }
      }
    }
  });
}

// ==========================================
// LOGIQUE DE L'APPLICATION SMARTCAISSE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('SmartCaisse connectée avec succès à Supabase.');

  const btnVente = document.getElementById('btn-vente');
  const btnStock = document.getElementById('btn-stock');

  if (btnVente) {
    btnVente.addEventListener('click', () => {
      alert('Module Nouvelle Vente : Prêt à enregistrer un encaissement.');
    });
  }

  if (btnStock) {
    btnStock.addEventListener('click', () => {
      alert('Module Gestion Stock : Prêt à réapprovisionner.');
    });
  }

  chargerStatistiquesDuJour();
});

async function chargerStatistiquesDuJour() {
  try {
    const { data: sales, error: salesError } = await supabase
      .from('sales')
      .select('total_amount');

    if (!salesError && sales) {
      const totalVentes = sales.reduce((acc, sale) => acc + Number(sale.total_amount), 0);
      console.log('Total Ventes chargées :', totalVentes);
    }
  } catch (err) {
    console.error('Erreur lors du chargement des données :', err);
  }
}
