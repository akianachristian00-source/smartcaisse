// =========================================================
// SMARTCAISSE — app.js
// Connexion réelle à Supabase : authentification, boutique
// isolée par utilisateur, produits, ventes et dettes.
// =========================================================

const SUPABASE_URL = 'https://qdygbythaqrxqtpukkjk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_I5YUHBY5zeaR4DRcOlfdkw_XMjMfjmD';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let boutiqueActuelle = null;
let intervalleEssai = null;
let graphiqueVentes = null;

const etatApp = {
  produits: [],
  dettes: [],
  historique: [],
  panier: [], // { id, nom, prix, quantite }
};

// ---------------------------------------------------------
// DÉMARRAGE : reconnexion automatique si une session existe
// ---------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await demarrerSession();
  }
});

async function demarrerSession() {
  const boutique = await obtenirOuCreerBoutique();
  if (!boutique) return;
  boutiqueActuelle = boutique;

  const affichage = document.getElementById('affichage-boutique');
  if (affichage) affichage.innerText = boutique.nom;

  await chargerToutesLesDonnees();
  if (typeof afficherAppDirect === 'function') afficherAppDirect();
  demarrerCompteEssai();
}

async function obtenirOuCreerBoutique(nomBoutique) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return null;

  const { data: existante } = await supabaseClient
    .from('boutiques')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (existante) return existante;

  const { data: nouvelle, error } = await supabaseClient
    .from('boutiques')
    .insert({ user_id: user.id, nom: nomBoutique || 'Ma Boutique' })
    .select()
    .single();

  if (error) {
    alert("Erreur lors de la création de la boutique : " + error.message);
    return null;
  }
  return nouvelle;
}

// ---------------------------------------------------------
// AUTHENTIFICATION (remplace la version factice d'index.html)
// ---------------------------------------------------------
async function gererAuthentification(e) {
  e.preventDefault();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const nomBoutique = document.getElementById('auth-boutique').value.trim();
  const btn = document.getElementById('auth-btn-submit');
  const texteOriginal = btn.innerText;

  btn.disabled = true;
  btn.innerText = 'Un instant...';

  try {
    if (modeAuthActuel === 'signup') {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;

      if (!data.session) {
        alert("Compte créé ! Si Supabase demande une confirmation par email, vérifiez votre boîte mail avant de vous connecter.");
        fermerAuthModal();
        return;
      }
      await obtenirOuCreerBoutique(nomBoutique);
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }

    fermerAuthModal();
    await demarrerSession();
  } catch (err) {
    alert("Erreur : " + traduireErreurSupabase(err.message));
  } finally {
    btn.disabled = false;
    btn.innerText = texteOriginal;
  }
}

function traduireErreurSupabase(message) {
  if (!message) return "Une erreur est survenue.";
  if (message.includes('Invalid login credentials')) return "Email ou mot de passe incorrect.";
  if (message.includes('User already registered')) return "Un compte existe déjà avec cet email.";
  if (message.includes('Password should be at least')) return "Le mot de passe doit contenir au moins 6 caractères.";
  return message;
}

async function seDeconnecter() {
  if (!confirm('Voulez-vous vous déconnecter ?')) return;
  clearInterval(intervalleEssai);
  await supabaseClient.auth.signOut();
  boutiqueActuelle = null;
  etatApp.produits = [];
  etatApp.dettes = [];
  etatApp.historique = [];
  etatApp.panier = [];
  if (typeof afficherLanding === 'function') afficherLanding();
}

// ---------------------------------------------------------
// COMPTE À REBOURS DE L'ESSAI GRATUIT (72H)
// ---------------------------------------------------------
function demarrerCompteEssai() {
  clearInterval(intervalleEssai);
  mettreAJourCompteEssai();
  intervalleEssai = setInterval(mettreAJourCompteEssai, 60000);
}

function mettreAJourCompteEssai() {
  const el = document.getElementById('essai-countdown');
  if (!el || !boutiqueActuelle) return;

  if (boutiqueActuelle.plan !== 'essai') {
    el.innerText = boutiqueActuelle.plan === 'actif' ? 'Actif' : boutiqueActuelle.plan;
    return;
  }

  const fin = new Date(boutiqueActuelle.essai_fin).getTime();
  const maintenant = Date.now();
  const diffMs = fin - maintenant;

  if (diffMs <= 0) {
    el.innerText = "Expiré";
    return;
  }
  const heures = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  el.innerText = `${heures}h ${minutes}m`;
}

// ---------------------------------------------------------
// CHARGEMENT DES DONNÉES DEPUIS SUPABASE
// ---------------------------------------------------------
async function chargerToutesLesDonnees() {
  await Promise.all([chargerProduits(), chargerDettes(), chargerHistorique()]);
  rafraichirInterface();
}

async function chargerProduits() {
  if (!boutiqueActuelle) return;
  const { data, error } = await supabaseClient
    .from('produits')
    .select('*')
    .eq('boutique_id', boutiqueActuelle.id)
    .order('created_at', { ascending: false });
  if (!error) etatApp.produits = data;
}

async function chargerDettes() {
  if (!boutiqueActuelle) return;
  const { data, error } = await supabaseClient
    .from('dettes')
    .select('*')
    .eq('boutique_id', boutiqueActuelle.id)
    .order('created_at', { ascending: false });
  if (!error) etatApp.dettes = data;
}

async function chargerHistorique() {
  if (!boutiqueActuelle) return;
  const { data, error } = await supabaseClient
    .from('ventes')
    .select('*')
    .eq('boutique_id', boutiqueActuelle.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (!error) etatApp.historique = data;
}

// ---------------------------------------------------------
// PRODUITS / STOCK
// ---------------------------------------------------------
async function enregistrerProduit() {
  const nom = document.getElementById('p-nom').value.trim();
  const prix = parseFloat(document.getElementById('p-prix').value);
  const stock = parseInt(document.getElementById('p-qty').value, 10);

  if (!nom || isNaN(prix) || isNaN(stock) || prix < 0 || stock < 0) {
    alert("Veuillez remplir correctement le nom, le prix et la quantité.");
    return;
  }

  const { error } = await supabaseClient
    .from('produits')
    .insert({ boutique_id: boutiqueActuelle.id, nom, prix, stock });

  if (error) {
    alert("Erreur lors de l'enregistrement : " + error.message);
    return;
  }

  document.getElementById('p-nom').value = '';
  document.getElementById('p-prix').value = '';
  document.getElementById('p-qty').value = '';
  toggleFormProduit();

  await chargerProduits();
  rafraichirInterface();
}

// ---------------------------------------------------------
// CAISSE / PANIER (le panier reste local jusqu'à l'encaissement)
// ---------------------------------------------------------
function ajouterAuPanier(produitId) {
  const produit = etatApp.produits.find(p => p.id === produitId);
  if (!produit) return;

  if (produit.stock <= 0) {
    alert("Stock épuisé pour cet article.");
    return;
  }

  const ligne = etatApp.panier.find(item => item.id === produitId);
  if (ligne) {
    if (ligne.quantite >= produit.stock) {
      alert("Quantité maximale atteinte pour cet article.");
      return;
    }
    ligne.quantite += 1;
  } else {
    etatApp.panier.push({ id: produit.id, nom: produit.nom, prix: Number(produit.prix), quantite: 1 });
  }
  rafraichirPanier();
}

function retirerDuPanier(produitId) {
  etatApp.panier = etatApp.panier.filter(item => item.id !== produitId);
  rafraichirPanier();
}

function viderPanier() {
  etatApp.panier = [];
  rafraichirPanier();
}

async function validerEncaissement() {
  if (!boutiqueActuelle) return;
  if (etatApp.panier.length === 0) {
    alert("Le panier est vide !");
    return;
  }

  const totalVente = etatApp.panier.reduce((somme, item) => somme + item.prix * item.quantite, 0);
  const reference = `VTE-${Date.now().toString().slice(-6)}`;

  const { data: vente, error: erreurVente } = await supabaseClient
    .from('ventes')
    .insert({ boutique_id: boutiqueActuelle.id, reference, total: totalVente, mode_paiement: 'Espèces' })
    .select()
    .single();

  if (erreurVente) {
    alert("Erreur lors de l'encaissement : " + erreurVente.message);
    return;
  }

  const lignesArticles = etatApp.panier.map(item => ({
    vente_id: vente.id,
    produit_id: item.id,
    nom: item.nom,
    prix_unitaire: item.prix,
    quantite: item.quantite,
  }));
  await supabaseClient.from('ventes_articles').insert(lignesArticles);

  // Mise à jour du stock pour chaque article vendu
  for (const item of etatApp.panier) {
    const produit = etatApp.produits.find(p => p.id === item.id);
    const nouveauStock = Math.max(0, (produit?.stock ?? 0) - item.quantite);
    await supabaseClient.from('produits').update({ stock: nouveauStock }).eq('id', item.id);
  }

  etatApp.panier = [];
  await Promise.all([chargerProduits(), chargerHistorique()]);
  rafraichirInterface();
  rafraichirPanier();
  alert(`Vente enregistrée : ${totalVente.toLocaleString('fr-FR')} FCFA`);
}

// ---------------------------------------------------------
// DETTES / CRÉANCES
// ---------------------------------------------------------
async function enregistrerDette() {
  const client = document.getElementById('d-client').value.trim();
  const montant = parseFloat(document.getElementById('d-montant').value);
  const telEl = document.getElementById('d-telephone');
  const telephone = telEl ? telEl.value.trim() : '';

  if (!client || isNaN(montant) || montant <= 0) {
    alert("Veuillez indiquer le nom du client et un montant valide.");
    return;
  }

  const { error } = await supabaseClient
    .from('dettes')
    .insert({ boutique_id: boutiqueActuelle.id, client, montant, telephone: telephone || null });

  if (error) {
    alert("Erreur lors de l'enregistrement : " + error.message);
    return;
  }

  document.getElementById('d-client').value = '';
  document.getElementById('d-montant').value = '';
  if (telEl) telEl.value = '';
  toggleFormDette();

  await chargerDettes();
  rafraichirInterface();
}

async function reglerDette(detteId) {
  if (!confirm('Confirmer le règlement de cette dette ?')) return;

  const { error } = await supabaseClient
    .from('dettes')
    .update({ regle: true, regle_at: new Date().toISOString() })
    .eq('id', detteId);

  if (error) {
    alert("Erreur : " + error.message);
    return;
  }

  await chargerDettes();
  rafraichirInterface();
}

// ---------------------------------------------------------
// AFFICHAGE / RENDU DE L'INTERFACE
// ---------------------------------------------------------
function rafraichirInterface() {
  rendreListeProduitsCaisse();
  rendreListeStock();
  rendreListeDettes();
  rendreListeHistorique();
  rendreKPIs();
  rendreGraphique();
}

function rendreListeProduitsCaisse() {
  const conteneur = document.getElementById('liste-produits-caisse');
  if (!conteneur) return;

  if (etatApp.produits.length === 0) {
    conteneur.innerHTML = `<p class="col-span-full text-center py-10 text-slate-500 text-xs">Aucun produit. Ajoutez vos articles dans l'onglet "Gestion Stock".</p>`;
    return;
  }

  conteneur.innerHTML = etatApp.produits.map(p => `
    <button onclick="ajouterAuPanier('${p.id}')" class="bg-card hover:bg-cardhi border border-border rounded-xl p-3 text-left transition active:scale-95 ${p.stock <= 0 ? 'opacity-40 pointer-events-none' : ''}">
      <p class="text-xs font-bold text-white truncate">${escaperHtml(p.nom)}</p>
      <p class="font-mono-num text-sm text-gold font-bold mt-1">${Number(p.prix).toLocaleString('fr-FR')} FCFA</p>
      <p class="text-[10px] ${p.stock <= 3 ? 'text-terracotta' : 'text-slate-500'} mt-0.5">Stock : ${p.stock}</p>
    </button>
  `).join('');
}

function rendreListeStock() {
  const conteneur = document.getElementById('liste-stock');
  if (!conteneur) return;

  if (etatApp.produits.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-10 text-slate-500 text-xs">Aucun produit enregistré pour le moment.</p>`;
    return;
  }

  conteneur.innerHTML = etatApp.produits.map(p => `
    <div class="flex items-center justify-between p-4">
      <div>
        <p class="text-sm font-bold text-white">${escaperHtml(p.nom)}</p>
        <p class="text-xs text-slate-400 font-mono-num">${Number(p.prix).toLocaleString('fr-FR')} FCFA</p>
      </div>
      <span class="text-xs font-bold px-3 py-1.5 rounded-full ${p.stock <= 3 ? 'bg-terracotta/10 text-terracotta border border-terracotta/20' : 'bg-emerald/10 text-emerald border border-emerald/20'}">
        ${p.stock} en stock
      </span>
    </div>
  `).join('');
}

function rendreListeDettes() {
  const conteneur = document.getElementById('liste-dettes');
  if (!conteneur) return;

  if (etatApp.dettes.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-10 text-slate-500 text-xs bg-card rounded-2xl border border-border">Aucune dette enregistrée.</p>`;
    return;
  }

  conteneur.innerHTML = etatApp.dettes.map(d => `
    <div class="bg-card border border-border rounded-2xl p-4 flex items-center justify-between ${d.regle ? 'opacity-50' : ''}">
      <div>
        <p class="text-sm font-bold text-white">${escaperHtml(d.client)}</p>
        <p class="text-xs text-slate-400 font-mono-num">${Number(d.montant).toLocaleString('fr-FR')} FCFA${d.telephone ? ' · ' + escaperHtml(d.telephone) : ''}</p>
      </div>
      ${d.regle
        ? `<span class="text-[10px] font-bold text-emerald bg-emerald/10 px-3 py-1.5 rounded-full border border-emerald/20">Réglée</span>`
        : `<button onclick="reglerDette('${d.id}')" class="text-[10px] font-bold text-inkdeep bg-gold hover:bg-gold-light px-3 py-1.5 rounded-full transition">Marquer réglée</button>`
      }
    </div>
  `).join('');
}

function rendreListeHistorique() {
  const conteneur = document.getElementById('liste-historique');
  if (!conteneur) return;

  if (etatApp.historique.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-10 text-slate-500 text-xs bg-card rounded-2xl border border-border">Aucune vente enregistrée pour le moment.</p>`;
    return;
  }

  conteneur.innerHTML = etatApp.historique.map(v => `
    <div class="bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
      <div>
        <p class="text-sm font-bold text-white">${v.reference}</p>
        <p class="text-xs text-slate-400">${new Date(v.created_at).toLocaleString('fr-FR')} · ${v.mode_paiement}</p>
      </div>
      <p class="font-mono-num text-sm font-bold text-emerald">${Number(v.total).toLocaleString('fr-FR')} FCFA</p>
    </div>
  `).join('');
}

function rendrePanier() {
  const conteneur = document.getElementById('panier-articles');
  const compteur = document.getElementById('cart-count');
  const totalEl = document.getElementById('cart-total');
  if (!conteneur) return;

  if (etatApp.panier.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-6 text-slate-600">Aucun article sélectionné</p>`;
  } else {
    conteneur.innerHTML = etatApp.panier.map(item => `
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <p class="text-white font-medium">${escaperHtml(item.nom)}</p>
          <p class="text-[10px] text-slate-500">${item.quantite} x ${item.prix.toLocaleString('fr-FR')} FCFA</p>
        </div>
        <button onclick="retirerDuPanier('${item.id}')" class="text-terracotta hover:text-terracotta-dim px-2">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join('');
  }

  const total = etatApp.panier.reduce((s, item) => s + item.prix * item.quantite, 0);
  if (compteur) compteur.innerText = etatApp.panier.reduce((s, item) => s + item.quantite, 0);
  if (totalEl) totalEl.innerText = total.toLocaleString('fr-FR');
}
// alias conservé pour compatibilité avec le reste du code
function rafraichirPanier() { rendrePanier(); }

function rendreKPIs() {
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = etatApp.historique
    .filter(v => new Date(v.created_at).toDateString() === aujourdHui)
    .reduce((s, v) => s + Number(v.total), 0);

  const dettesNonReglees = etatApp.dettes.filter(d => !d.regle);
  const totalDettes = dettesNonReglees.reduce((s, d) => s + Number(d.montant), 0);
  const beneficeEstime = Math.round(ventesDuJour * 0.25);

  setTexte('kpi-ventes-jour', ventesDuJour.toLocaleString('fr-FR'));
  setTexte('kpi-dettes', totalDettes.toLocaleString('fr-FR'));
  setTexte('kpi-dettes-clients', dettesNonReglees.length);
  setTexte('kpi-stock-count', etatApp.produits.length);
  setTexte('kpi-benefice', beneficeEstime.toLocaleString('fr-FR'));
}

function setTexte(id, valeur) {
  const el = document.getElementById(id);
  if (el) el.innerText = valeur;
}

function escaperHtml(texte) {
  const div = document.createElement('div');
  div.innerText = texte ?? '';
  return div.innerHTML;
}

// ---------------------------------------------------------
// GRAPHIQUE DES VENTES DE LA SEMAINE
// ---------------------------------------------------------
function rendreGraphique() {
  const canvas = document.getElementById('salesChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const jours = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const totauxParJour = [0, 0, 0, 0, 0, 0, 0];

  const uneSemaineAvant = Date.now() - 7 * 24 * 60 * 60 * 1000;
  etatApp.historique.forEach(v => {
    const date = new Date(v.created_at);
    if (date.getTime() >= uneSemaineAvant) {
      totauxParJour[date.getDay()] += Number(v.total);
    }
  });

  if (graphiqueVentes) graphiqueVentes.destroy();

  graphiqueVentes = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: jours,
      datasets: [{
        label: 'Ventes (FCFA)',
        data: totauxParJour,
        borderColor: '#E8A93B',
        backgroundColor: 'rgba(232,169,59,0.12)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#E8A93B',
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.08)' } },
        y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(148,163,184,0.08)' } },
      },
    },
  });
}

// Fonction appelée par le bouton "Voir la démo" — laisse l'aperçu vide si non connecté
function initChart() {
  rendreGraphique();
}
