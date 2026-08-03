// ==========================================
// CONFIGURATION & INITIALISATION SUPABASE
// ==========================================
// Remplacez ces valeurs par vos propres clés Supabase si nécessaire
const SUPABASE_URL = 'VOTRE_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'VOTRE_SUPABASE_ANON_KEY';
let supabaseClient = null;

if (typeof supabase !== 'undefined' && SUPABASE_URL !== 'VOTRE_SUPABASE_URL') {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// État local de l'application
let etatApp = {
  produits: [
    { id: 1, nom: "Produit Démo", prix: 1000, stock: 20 }
  ],
  panier: [],
  dettes: [
    { id: 1, client: "Client Exemple", montant: 5000, regle: false }
  ],
  historique: [
    { id: 1, ref: "Transaction #001", heure: "14:30", montant: 2500, type: "Espèces" }
  ]
};

// Initialisation au chargement de la page
document.addEventListener('DOMContentLoaded', () => {
  rafraichirInterface();
});

// ==========================================
// GESTION DU GRAPHIQUE (CHART.JS)
// ==========================================
let monGraphique = null;

function initChart() {
  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  if (monGraphique) {
    monGraphique.destroy();
  }

  monGraphique = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
      datasets: [{
        label: 'Chiffre d\'affaires (FCFA)',
        data: [0, 0, 0, 0, 0, 2500, 0],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#60a5fa',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#94a3b8', font: { size: 10 } }
        }
      }
    }
  });
}

// ==========================================
// GESTION DU STOCK & PRODUITS
// ==========================================
function enregistrerProduit() {
  const nom = document.getElementById('p-nom').value.trim();
  const prix = parseFloat(document.getElementById('p-prix').value);
  const stock = parseInt(document.getElementById('p-qty').value);

  if (!nom || isNaN(prix) || isNaN(stock)) {
    alert("Veuillez remplir correctement tous les champs du produit.");
    return;
  }

  const nouveauProduit = {
    id: Date.now(),
    nom: nom,
    prix: prix,
    stock: stock
  };

  etatApp.produits.push(nouveauProduit);
  
  // Vider les champs
  document.getElementById('p-nom').value = '';
  document.getElementById('p-prix').value = '';
  document.getElementById('p-qty').value = '';
  
  toggleFormProduit();
  rafraichirInterface();
}

function ajouterAuPanier(idProduit) {
  const produit = etatApp.produits.find(p => p.id === idProduit);
  if (!produit || produit.stock <= 0) {
    alert("Produit épuisé ou introuvable !");
    return;
  }

  const articlePanier = etatApp.panier.find(item => item.id === idProduit);
  if (articlePanier) {
    articlePanier.quantite++;
  } else {
    etatApp.panier.push({ ...produit, quantite: 1 });
  }

  rafraichirPanier();
}

// ==========================================
// GESTION DE LA CAISSE & PANIER
// ==========================================
function rafraichirPanier() {
  const containerPanier = document.getElementById('panier-articles');
  const compteurPanier = document.getElementById('cart-count');
  const totalPanierEl = document.getElementById('cart-total');

  if (!containerPanier) return;

  if (etatApp.panier.length === 0) {
    containerPanier.innerHTML = `<p class="text-center py-6 text-slate-600">Aucun article sélectionné</p>`;
    compteurPanier.innerText = '0';
    totalPanierEl.innerText = '0';
    return;
  }

  let html = '';
  let totalGlobal = 0;
  let totalArticles = 0;

  etatApp.panier.forEach(item => {
    let sousTotal = item.prix * item.quantite;
    totalGlobal += sousTotal;
    totalArticles += item.quantite;

    html += `
      <div class="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800">
        <div>
          <p class="font-bold text-white">${item.nom}</p>
          <p class="text-[10px] text-slate-400">${item.prix} FCFA x ${item.quantite}</p>
        </div>
        <div class="flex items-center space-x-2">
          <span class="font-bold text-blue-400">${sousTotal} FCFA</span>
          <button onclick="retirerDuPanier(${item.id})" class="text-rose-400 hover:text-rose-300 px-1">
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        </div>
      </div>
    `;
  });

  containerPanier.innerHTML = html;
  compteurPanier.innerText = totalArticles;
  totalPanierEl.innerText = totalGlobal.toLocaleString();
}

function retirerDuPanier(idProduit) {
  etatApp.panier = etatApp.panier.filter(item => item.id !== idProduit);
  rafraichirPanier();
}

function validerEncaissement() {
  if (etatApp.panier.length === 0) {
    alert("Le panier est vide !");
    return;
  }

  let totalVente = etatApp.panier.reduce((sum, item) => sum + (item.prix * item.quantite), 0);

  // Mettre à jour les stocks
  etatApp.panier.forEach(articlePanier => {
    const prod = etatApp.produits.find(p => p.id === articlePanier.id);
    if (prod) {
      prod.stock -= articlePanier.quantite;
    }
  });

  // Ajouter à l'historique
  const nouvelleTransaction = {
    id: Date.now(),
    ref: `Transaction #${Math.floor(100 + Math.random() * 900)}`,
    heure: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    montant: totalVente,
    type: "Espèces"
  };

  etatApp.historique.unshift(nouvelleTransaction);
  etatApp.panier = [];

  rafraichirInterface();
  rafraichirPanier();
  alert("Encaissement validé avec succès !");
}

// ==========================================
// GESTION DES DETTES
// ==========================================
function enregistrerDette() {
  const client = document.getElementById('d-client').value.trim();
  const montant = parseFloat(document.getElementById('d-montant').value);

  if (!client || isNaN(montant)) {
    alert("Veuillez renseigner le nom du client et le montant.");
    return;
  }

  etatApp.dettes.push({
    id: Date.now(),
    client: client,
    montant: montant,
    regle: false
  });

  document.getElementById('d-client').value = '';
  document.getElementById('d-montant').value = '';
  toggleFormDette();
  rafraichirInterface();
}

// ==========================================
// MISE A JOUR GLOBALE DE L'INTERFACE (DOM)
// ==========================================
function rafraichirInterface() {
  // 1. Rendu Stock Caisse
  const containerProduitsCaisse = document.getElementById('liste-produits-caisse');
  if (containerProduitsCaisse) {
    let htmlCaisse = '';
    etatApp.produits.forEach(p => {
      htmlCaisse += `
        <div class="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-2 hover:border-slate-700 transition cursor-pointer" onclick="ajouterAuPanier(${p.id})">
          <div>
            <p class="text-xs font-bold text-white">${p.nom}</p>
            <p class="text-[10px] text-slate-400">Stock: ${p.stock} unités</p>
          </div>
          <div class="flex justify-between items-center pt-2 border-t border-slate-800">
            <span class="text-xs font-bold text-blue-400">${p.prix} FCFA</span>
            <span class="bg-blue-600 text-white w-7 h-7 rounded-lg text-xs flex items-center justify-center shadow">
              <i class="fa-solid fa-plus"></i>
            </span>
          </div>
        </div>
      `;
    });
    containerProduitsCaisse.innerHTML = htmlCaisse;
  }

  // 2. Rendu Gestion Stock
  const containerStock = document.getElementById('liste-stock');
  if (containerStock) {
    let htmlStock = '';
    etatApp.produits.forEach(p => {
      htmlStock += `
        <div class="p-3.5 flex justify-between items-center text-xs border-b border-slate-800/60">
          <div>
            <p class="font-bold text-white">${p.nom}</p>
            <p class="text-[10px] text-slate-400">Prix : ${p.prix} FCFA</p>
          </div>
          <span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-lg font-medium">
            ${p.stock} en stock
          </span>
        </div>
      `;
    });
    containerStock.innerHTML = htmlStock;
  }

  // 3. Rendu Dettes
  const containerDettes = document.getElementById('liste-dettes');
  if (containerDettes) {
    let htmlDettes = '';
    etatApp.dettes.forEach(d => {
      htmlDettes += `
        <div class="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div>
            <p class="text-xs font-bold text-white">${d.client}</p>
            <p class="text-[10px] text-rose-400 font-semibold">Reste à payer : ${d.montant} FCFA</p>
          </div>
          <button class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-xl border border-slate-700">
            Régler
          </button>
        </div>
      `;
    });
    containerDettes.innerHTML = htmlDettes;
  }

  // 4. Rendu Historique
  const containerHistorique = document.getElementById('liste-historique');
  if (containerHistorique) {
    let htmlHist = '';
    etatApp.historique.forEach(h => {
      htmlHist += `
        <div class="bg-slate-900 p-3.5 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div class="space-y-0.5">
            <p class="text-xs font-bold text-white">${h.ref}</p>
            <p class="text-[10px] text-slate-500">${h.heure} • ${h.type}</p>
          </div>
          <span class="text-xs font-bold text-emerald-400">+${h.montant} FCFA</span>
        </div>
      `;
    });
    containerHistorique.innerHTML = htmlHist;
  }
}
