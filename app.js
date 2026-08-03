// Initialisation de l'application SmartCaisse
document.addEventListener('DOMContentLoaded', () => {
  console.log('SmartCaisse chargée avec succès.');

  // Exemple d'interaction pour tester les boutons
  const btnNouvelleVente = document.querySelector('button:nth-child(1)');
  if (btnNouvelleVente) {
    btnNouvelleVente.addEventListener('click', () => {
      alert('Module Nouvelle Vente : Prêt à être connecté à Supabase !');
    });
  }
});
