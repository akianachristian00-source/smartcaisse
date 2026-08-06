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
  devis: [],
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
  appliquerNomIA();
  await verifierStatutAdmin();
  if (typeof afficherAppDirect === 'function') afficherAppDirect();
  demarrerCompteEssai();
}

async function obtenirOuCreerBoutique(nomBoutique, telephone, pays) {
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
    .insert({
      user_id: user.id,
      nom: nomBoutique || 'Ma Boutique',
      telephone: telephone || null,
      pays: pays || 'CG',
    })
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
  const telephone = document.getElementById('auth-telephone')?.value.trim() || '';
  const pays = document.getElementById('auth-pays')?.value || 'CG';
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
      await obtenirOuCreerBoutique(nomBoutique, telephone, pays);
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
  await Promise.all([chargerProduits(), chargerDettes(), chargerHistorique(), chargerDevis()]);
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

  const lignesRecu = [...etatApp.panier];
  etatApp.panier = [];
  await Promise.all([chargerProduits(), chargerHistorique()]);
  rafraichirInterface();
  rafraichirPanier();

  if (confirm(`Vente enregistrée : ${totalVente.toLocaleString('fr-FR')} FCFA.\n\nImprimer le reçu ?`)) {
    imprimerRecu(vente, lignesRecu);
  }
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
  rendreListeDevis();
  rendreKPIs();
  rendreGraphique();
  genererAlertes();
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

// ---------------------------------------------------------
// PERSONNALISATION IA + PARAMÈTRES BOUTIQUE
// ---------------------------------------------------------
function appliquerNomIA() {
  const nom = boutiqueActuelle?.nom_ia || 'SmartConseil';
  setTexte('nom-ia-titre', nom);
  setTexte('chat-ia-titre', nom);
  const inputParamIA = document.getElementById('param-nom-ia');
  if (inputParamIA) inputParamIA.value = nom;
  const inputParamBoutique = document.getElementById('param-nom-boutique');
  if (inputParamBoutique && boutiqueActuelle) inputParamBoutique.value = boutiqueActuelle.nom;
}

async function enregistrerNomIA() {
  const nouveauNom = document.getElementById('param-nom-ia').value.trim();
  if (!nouveauNom) { alert("Donnez un nom à votre assistant."); return; }

  const { error } = await supabaseClient.from('boutiques').update({ nom_ia: nouveauNom }).eq('id', boutiqueActuelle.id);
  if (error) { alert("Erreur : " + error.message); return; }

  boutiqueActuelle.nom_ia = nouveauNom;
  appliquerNomIA();
  alert(`Votre assistant s'appelle maintenant "${nouveauNom}" !`);
}

async function enregistrerParametresBoutique() {
  const nouveauNom = document.getElementById('param-nom-boutique').value.trim();
  if (!nouveauNom) { alert("Le nom de la boutique ne peut pas être vide."); return; }

  const { error } = await supabaseClient.from('boutiques').update({ nom: nouveauNom }).eq('id', boutiqueActuelle.id);
  if (error) { alert("Erreur : " + error.message); return; }

  boutiqueActuelle.nom = nouveauNom;
  setTexte('affichage-boutique', nouveauNom);
  alert("Informations de la boutique mises à jour !");
}

// ---------------------------------------------------------
// CHAT IA — mode local (analyse directe des vraies données).
// Se connectera à Gemini automatiquement dès que la clé sera ajoutée.
// ---------------------------------------------------------
let chatIADemarre = false;

function ouvrirChatIA() {
  document.getElementById('chat-ia-panel').classList.remove('hidden');
  if (!chatIADemarre) {
    const nom = boutiqueActuelle?.nom_ia || 'SmartConseil';
    ajouterBulleChatIA('bot', `Bonjour ! Je suis ${nom}. Demandez-moi par exemple : "combien j'ai vendu aujourd'hui ?", "quelles dettes sont en retard ?" ou "quel produit est presque en rupture ?"`);
    chatIADemarre = true;
  }
}

function fermerChatIA() {
  document.getElementById('chat-ia-panel').classList.add('hidden');
}

function ajouterBulleChatIA(role, texte) {
  const conteneur = document.getElementById('chat-ia-messages');
  if (!conteneur) return;
  const bulle = document.createElement('div');
  bulle.className = role === 'bot'
    ? 'bg-inkdeep border border-border rounded-2xl rounded-tl-sm p-3 text-slate-200 max-w-[85%]'
    : 'bg-gold text-inkdeep rounded-2xl rounded-tr-sm p-3 ml-auto max-w-[85%] font-medium';
  bulle.innerText = texte;
  conteneur.appendChild(bulle);
  conteneur.scrollTop = conteneur.scrollHeight;
}

function envoyerMessageIA() {
  const input = document.getElementById('chat-ia-input');
  const texte = input.value.trim();
  if (!texte) return;
  ajouterBulleChatIA('user', texte);
  input.value = '';
  setTimeout(() => ajouterBulleChatIA('bot', genererReponseIALocale(texte)), 400);
}

function genererReponseIALocale(question) {
  const q = question.toLowerCase();
  const aujourdHui = new Date().toDateString();
  const ventesDuJour = etatApp.historique.filter(v => new Date(v.created_at).toDateString() === aujourdHui);
  const totalVentesJour = ventesDuJour.reduce((s, v) => s + Number(v.total), 0);
  const dettesNonReglees = etatApp.dettes.filter(d => !d.regle);
  const totalDettes = dettesNonReglees.reduce((s, d) => s + Number(d.montant), 0);
  const produitsFaibles = etatApp.produits.filter(p => p.stock <= 3);

  if (q.includes('vente') || q.includes('chiffre') || q.includes('aujourd')) {
    return totalVentesJour > 0
      ? `Aujourd'hui : ${ventesDuJour.length} vente(s) pour ${totalVentesJour.toLocaleString('fr-FR')} FCFA.`
      : "Aucune vente enregistrée aujourd'hui pour l'instant.";
  }
  if (q.includes('dette') || q.includes('crédit') || q.includes('doit')) {
    if (dettesNonReglees.length === 0) return "Aucune dette en attente, bien joué !";
    const plusGrosse = [...dettesNonReglees].sort((a, b) => b.montant - a.montant)[0];
    return `${dettesNonReglees.length} dette(s) non réglée(s) pour ${totalDettes.toLocaleString('fr-FR')} FCFA au total. La plus grosse : ${plusGrosse.client} (${Number(plusGrosse.montant).toLocaleString('fr-FR')} FCFA).`;
  }
  if (q.includes('stock') || q.includes('rupture') || q.includes('produit')) {
    return produitsFaibles.length > 0
      ? `Attention, presque en rupture : ${produitsFaibles.map(p => `${p.nom} (${p.stock})`).join(', ')}.`
      : "Votre stock est correct, rien n'est en rupture proche.";
  }
  if (q.includes('bonjour') || q.includes('salut')) {
    return "Bonjour ! Comment puis-je vous aider avec votre boutique aujourd'hui ?";
  }
  return "Je peux déjà répondre sur vos ventes, dettes et stock. Les conseils plus avancés (marges, prévisions) arriveront quand l'IA complète (Gemini) sera connectée.";
}

// ---------------------------------------------------------
// ALERTES AUTOMATIQUES (stock faible, dettes anciennes)
// ---------------------------------------------------------
const alertesEnvoyees = new Set();

function genererAlertes() {
  const conteneur = document.getElementById('alertes-ia');
  if (!conteneur) return;

  const alertes = [];
  etatApp.produits.filter(p => p.stock <= 3).forEach(p => {
    alertes.push({ id: 'stock-' + p.id, texte: `Stock faible : "${p.nom}" (${p.stock} restant)` });
  });

  const septJoursMs = 7 * 24 * 60 * 60 * 1000;
  etatApp.dettes.filter(d => !d.regle && (Date.now() - new Date(d.created_at).getTime()) > septJoursMs).forEach(d => {
    alertes.push({ id: 'dette-' + d.id, texte: `Dette ancienne (+7 jours) : ${d.client} doit ${Number(d.montant).toLocaleString('fr-FR')} FCFA` });
  });

  if (alertes.length === 0) {
    conteneur.innerHTML = `<div class="bg-emerald/10 border border-emerald/20 text-emerald text-xs p-3 rounded-xl">Aucune alerte pour le moment. Tout est sous contrôle.</div>`;
    return;
  }

  conteneur.innerHTML = alertes.map(a => `
    <div class="bg-terracotta/10 border border-terracotta/20 text-terracotta text-xs p-3 rounded-xl flex items-center gap-2">
      <i class="fa-solid fa-triangle-exclamation"></i><span>${escaperHtml(a.texte)}</span>
    </div>
  `).join('');

  alertes.forEach(a => {
    if (!alertesEnvoyees.has(a.id)) {
      alertesEnvoyees.add(a.id);
      envoyerNotificationNavigateur(a.texte);
    }
  });
}

function envoyerNotificationNavigateur(texte) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification('SmartCaisse', { body: texte });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

// ---------------------------------------------------------
// IMPRESSION DE REÇU
// (utilise l'imprimante déjà configurée sur le téléphone —
// Bluetooth ou USB, tant qu'elle apparaît dans les options
// d'impression Android/Chrome)
// ---------------------------------------------------------
function imprimerTest() {
  imprimerRecu(
    { reference: 'TEST-0001', total: 1800, mode_paiement: 'Espèces', created_at: new Date().toISOString() },
    [{ nom: 'Article de test', prix: 900, quantite: 2 }]
  );
}

function imprimerRecu(vente, lignes) {
  const zone = document.getElementById('zone-impression');
  if (!zone) return;
  const nomBoutique = boutiqueActuelle?.nom || 'SmartCaisse';

  const lignesHTML = lignes.map(l => `
    <div style="display:flex;justify-content:space-between;">
      <span>${escaperHtml(l.nom)} x${l.quantite}</span>
      <span>${(l.prix * l.quantite).toLocaleString('fr-FR')}</span>
    </div>
  `).join('');

  zone.innerHTML = `
    <div style="font-size:12px;width:280px;">
      <p style="text-align:center;font-weight:bold;">${escaperHtml(nomBoutique)}</p>
      <p style="text-align:center;font-size:10px;">${vente.reference}</p>
      <hr style="border-top:1px dashed #000;">
      ${lignesHTML}
      <hr style="border-top:1px dashed #000;">
      <div style="display:flex;justify-content:space-between;font-weight:bold;">
        <span>TOTAL</span><span>${Number(vente.total).toLocaleString('fr-FR')} FCFA</span>
      </div>
      <p style="font-size:10px;">Mode : ${vente.mode_paiement}</p>
      <p style="font-size:10px;">${new Date(vente.created_at).toLocaleString('fr-FR')}</p>
      <p style="text-align:center;font-size:10px;margin-top:8px;">Merci de votre visite</p>
    </div>
  `;
  window.print();
}

// ---------------------------------------------------------
// DEVIS CLIENTS
// ---------------------------------------------------------
let lignesDevisTemp = [];

function toggleFormDevis() {
  document.getElementById('form-devis').classList.toggle('hidden');
}

function ajouterLigneDevis() {
  lignesDevisTemp.push({ id: 'ligne-' + Date.now() + Math.random(), nom: '', prix: 0, quantite: 1 });
  rendreLignesDevis();
}

function rendreLignesDevis() {
  const conteneur = document.getElementById('dv-lignes-articles');
  if (!conteneur) return;
  conteneur.innerHTML = lignesDevisTemp.map(l => `
    <div class="grid grid-cols-[1fr_70px_50px_auto] gap-1.5 items-center">
      <input type="text" value="${escaperHtml(l.nom)}" placeholder="Article" oninput="majLigneDevis('${l.id}','nom',this.value)" class="bg-inkdeep border border-border rounded-lg px-2 py-1.5 text-[11px] text-white">
      <input type="number" value="${l.prix}" placeholder="Prix" oninput="majLigneDevis('${l.id}','prix',this.value)" class="bg-inkdeep border border-border rounded-lg px-2 py-1.5 text-[11px] text-white">
      <input type="number" value="${l.quantite}" placeholder="Qté" oninput="majLigneDevis('${l.id}','quantite',this.value)" class="bg-inkdeep border border-border rounded-lg px-2 py-1.5 text-[11px] text-white">
      <button onclick="supprimerLigneDevis('${l.id}')" class="text-terracotta"><i class="fa-solid fa-xmark"></i></button>
    </div>
  `).join('');
  calculerTotalDevis();
}

function majLigneDevis(id, champ, valeur) {
  const ligne = lignesDevisTemp.find(l => l.id === id);
  if (!ligne) return;
  ligne[champ] = champ === 'nom' ? valeur : (parseFloat(valeur) || 0);
  calculerTotalDevis();
}

function supprimerLigneDevis(id) {
  lignesDevisTemp = lignesDevisTemp.filter(l => l.id !== id);
  rendreLignesDevis();
}

function calculerTotalDevis() {
  const total = lignesDevisTemp.reduce((s, l) => s + (l.prix * l.quantite), 0);
  setTexte('dv-total', total.toLocaleString('fr-FR'));
}

async function enregistrerDevis() {
  const client = document.getElementById('dv-client').value.trim();
  const indicatif = document.getElementById('dv-indicatif').value;
  const telephoneSaisi = document.getElementById('dv-telephone').value.trim();

  if (!client || lignesDevisTemp.length === 0) {
    alert("Ajoutez le nom du client et au moins un article.");
    return;
  }

  const total = lignesDevisTemp.reduce((s, l) => s + (l.prix * l.quantite), 0);
  const telephoneComplet = telephoneSaisi ? `${indicatif}${telephoneSaisi}` : null;

  const { error } = await supabaseClient.from('devis').insert({
    boutique_id: boutiqueActuelle.id,
    client,
    telephone: telephoneComplet,
    lignes: lignesDevisTemp.map(l => ({ nom: l.nom, prix: l.prix, quantite: l.quantite })),
    total,
  });

  if (error) { alert("Erreur : " + error.message); return; }

  document.getElementById('dv-client').value = '';
  document.getElementById('dv-telephone').value = '';
  lignesDevisTemp = [];
  rendreLignesDevis();
  toggleFormDevis();

  await chargerDevis();
  rendreListeDevis();
}

async function chargerDevis() {
  if (!boutiqueActuelle) return;
  const { data, error } = await supabaseClient
    .from('devis')
    .select('*')
    .eq('boutique_id', boutiqueActuelle.id)
    .order('created_at', { ascending: false });
  if (!error) etatApp.devis = data;
}

function rendreListeDevis() {
  const conteneur = document.getElementById('liste-devis');
  if (!conteneur) return;

  if (!etatApp.devis || etatApp.devis.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-10 text-slate-500 text-xs bg-card rounded-2xl border border-border">Aucun devis pour le moment.</p>`;
    return;
  }

  conteneur.innerHTML = etatApp.devis.map(d => {
    const texteWhatsApp = encodeURIComponent(
      `Devis ${boutiqueActuelle.nom} :\n${d.lignes.map(l => `- ${l.nom} x${l.quantite} : ${(l.prix * l.quantite).toLocaleString('fr-FR')} FCFA`).join('\n')}\nTOTAL : ${Number(d.total).toLocaleString('fr-FR')} FCFA`
    );
    const numeroWa = d.telephone ? d.telephone.replace('+', '') : '';

    return `
      <div class="bg-card border border-border rounded-2xl p-4 space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-sm font-bold text-white">${escaperHtml(d.client)}</p>
          <p class="font-mono-num text-sm font-bold text-gold">${Number(d.total).toLocaleString('fr-FR')} FCFA</p>
        </div>
        <p class="text-[10px] text-slate-500">${new Date(d.created_at).toLocaleString('fr-FR')}</p>
        <div class="flex gap-2 pt-1">
          ${numeroWa ? `<a href="https://wa.me/${numeroWa}?text=${texteWhatsApp}" target="_blank" class="flex-1 text-center bg-emerald/10 text-emerald border border-emerald/20 text-[10px] font-bold py-2 rounded-lg"><i class="fa-brands fa-whatsapp"></i> Envoyer</a>` : ''}
          <button onclick='imprimerDevis(${d.id ? `"${d.id}"` : 'null'})' data-devis-id="${d.id}" class="flex-1 bg-slate-800 text-slate-200 text-[10px] font-bold py-2 rounded-lg border border-slate-700"><i class="fa-solid fa-print"></i> Imprimer</button>
        </div>
      </div>
    `;
  }).join('');
}

function imprimerDevis(id) {
  const d = etatApp.devis.find(x => x.id === id);
  if (!d) return;
  imprimerRecu(
    { reference: 'DEVIS', total: d.total, mode_paiement: 'Devis (non payé)', created_at: d.created_at },
    d.lignes
  );
}

// ---------------------------------------------------------
// CONDITIONS GÉNÉRALES D'UTILISATION
// ---------------------------------------------------------
function ouvrirCGU() {
  chargerContenuCGU();
  document.getElementById('cgu-modal').classList.remove('hidden');
}

function fermerCGU() {
  document.getElementById('cgu-modal').classList.add('hidden');
}

function chargerContenuCGU() {
  const conteneur = document.getElementById('cgu-contenu');
  if (!conteneur || conteneur.dataset.charge === 'oui') return;

  conteneur.innerHTML = `
    <p><strong>1. Objet</strong><br>SmartCaisse est un service en ligne de caisse, de gestion de stock et de créances clients destiné aux commerçants. L'utilisation du service implique l'acceptation pleine et entière des présentes conditions.</p>
    <p><strong>2. Compte et essai gratuit</strong><br>L'inscription donne accès à un essai gratuit de 72 heures. Passé ce délai, l'accès aux fonctionnalités est conditionné à la souscription d'un abonnement payant.</p>
    <p><strong>3. Abonnements et paiement</strong><br>Les abonnements (Essentiel, Pro, Premium) sont facturés selon la durée choisie, via les moyens de paiement mobile disponibles dans le pays du marchand. Le non-paiement à échéance peut entraîner la suspension de l'accès au service.</p>
    <p><strong>4. Résiliation</strong><br>L'utilisateur peut résilier son abonnement à tout moment ; l'accès reste actif jusqu'à la fin de la période déjà payée.</p>
    <p><strong>5. Données et propriété</strong><br>Les données saisies (produits, ventes, dettes, devis) appartiennent au commerçant. SmartCaisse ne les revend pas à des tiers et s'engage à les protéger.</p>
    <p><strong>6. Responsabilité</strong><br>SmartCaisse est un outil d'aide à la gestion. Le commerçant reste seul responsable de l'exactitude des informations saisies et des décisions commerciales prises.</p>
    <p><strong>7. Disponibilité du service</strong><br>SmartCaisse s'efforce d'assurer une disponibilité continue, sans garantir une absence totale d'interruption liée à des tiers (hébergeur, opérateurs mobiles, connexion internet).</p>
    <p><strong>8. Modification des conditions</strong><br>Ces conditions peuvent être modifiées à tout moment ; les utilisateurs seront informés de tout changement substantiel.</p>
    <p><strong>9. Droit applicable</strong><br>Les présentes conditions sont soumises au droit en vigueur en République du Congo. Tout litige sera soumis, à défaut d'accord amiable, aux juridictions compétentes de Brazzaville.</p>
    <p><strong>10. Contact</strong><br>Pour toute question, contactez-nous via WhatsApp depuis l'application.</p>
  `;
  conteneur.dataset.charge = 'oui';
}

// ---------------------------------------------------------
// ADMINISTRATION (visible uniquement pour les comptes admin)
// ---------------------------------------------------------
async function verifierStatutAdmin() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data } = await supabaseClient
    .from('administrateurs')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const ongletAdmin = document.getElementById('tab-sec-admin');
  if (data && ongletAdmin) {
    ongletAdmin.classList.remove('hidden');
    await chargerDonneesAdmin();
  }
}

async function chargerDonneesAdmin() {
  const { data: boutiques, error } = await supabaseClient
    .from('boutiques')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !boutiques) return;

  const enEssai = boutiques.filter(b => b.plan === 'essai').length;
  const actifs = boutiques.filter(b => b.plan === 'actif').length;

  setTexte('admin-total-boutiques', boutiques.length);
  setTexte('admin-total-essai', enEssai);
  setTexte('admin-total-actifs', actifs);

  const conteneur = document.getElementById('admin-liste-boutiques');
  if (!conteneur) return;

  if (boutiques.length === 0) {
    conteneur.innerHTML = `<p class="text-center py-10 text-slate-500 text-xs">Aucune boutique enregistrée.</p>`;
    return;
  }

  conteneur.innerHTML = boutiques.map(b => `
    <div class="flex items-center justify-between p-4">
      <div>
        <p class="text-sm font-bold text-white">${escaperHtml(b.nom)}</p>
        <p class="text-[11px] text-slate-500">${b.pays || '—'} · ${b.telephone || 'Tél. non renseigné'}</p>
      </div>
      <span class="text-[10px] font-bold px-3 py-1.5 rounded-full ${b.plan === 'actif' ? 'bg-emerald/10 text-emerald border border-emerald/20' : 'bg-gold/10 text-gold border border-gold/20'}">
        ${b.plan === 'essai' ? 'Essai' : b.plan === 'actif' ? 'Actif' : b.plan}
      </span>
    </div>
  `).join('');
}

// ---------------------------------------------------------
// GUIDE D'UTILISATION
// ---------------------------------------------------------
function ouvrirGuide() {
  document.getElementById('guide-modal').classList.remove('hidden');
}
function fermerGuide() {
  document.getElementById('guide-modal').classList.add('hidden');
}
