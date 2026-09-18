/**
 * ============================================================================
 *  INTÉGRATION AU NOUVEAU FICHIER BETHEL (dimanche)
 * ----------------------------------------------------------------------------
 *  À COLLER DANS CE NOUVEAU FICHIER (celui qui contient cet onglet), EN PLUS
 *  d'une copie complète de ton script existant AjoutRapide_Script.gs (colle-le
 *  aussi tel quel dans un autre fichier .gs du même projet -- il est conçu
 *  pour fonctionner sur "la feuille active", donc il marchera directement ici
 *  sur les onglets vides).
 *
 *  CE FICHIER AJOUTE DEUX CHOSES QUI N'EXISTENT PAS DÉJÀ DANS TON SCRIPT :
 *
 *  1) integrerPersonneDepuisVieuxFichier()
 *     Bouton de menu "➕ Intégrer une personne du vieux fichier".
 *     Tu tapes le prénom + nom -> le script va chercher cette personne dans
 *     l'ANCIEN fichier (FICHIER_SAISON_BETHEL-CAMPUS_MONTREAL_RESTRUCTURE),
 *     copie son téléphone/email/adresse/code postal, PUIS l'assigne à un
 *     Bethel dans CE nouveau fichier selon sa zone (voir point 2).
 *     Rien n'est jamais supprimé ni modifié dans l'ancien fichier -- lecture
 *     seule.
 *
 *  2) Logique d'assignation par zone (Oui/Non), propre à ce nouveau fichier :
 *     - Elle utilise le MÊME onglet "Zones Géographiques" (FSA -> BETHEL ID
 *       -> leader) et le MÊME format d'ID que ton système actuel
 *       (BETHEL-ZONE-NUMÉRO-F/M, ex: BETHEL-LVL-1-F) -- pour que tout le
 *       reste de ton script (genre auto-détecté, déplacement, etc.) continue
 *       de fonctionner sans rien changer.
 *     - Comme ce fichier est VIDE, les numéros recommencent naturellement à 1
 *       pour chaque ville -- aucun risque de collision avec les vieux BETHEL
 *       ID de l'autre fichier, ils vivent dans deux fichiers séparés.
 *     - Personne qui a dit OUI (DISPO HÉBERGER) et dont la zone n'a pas
 *       encore de Bethel ici -> devient Bethel Leader d'un nouveau Bethel.
 *     - Personne qui a dit NON -> rejoint le Bethel existant de sa zone s'il
 *       y en a un, sinon reste "EN ATTENTE D'UN LEADER DANS SA ZONE".
 *
 *  ⚠️ Modifie la constante ID_VIEUX_FICHIER ci-dessous si jamais l'URL de
 *  l'ancien fichier change.
 * ============================================================================
 */

// ID du VIEUX fichier (FICHIER_SAISON_BETHEL-CAMPUS_MONTREAL_RESTRUCTURE) --
// pris directement depuis son URL Google Sheets.
var ID_VIEUX_FICHIER = '1gzfHK7qP3C4gGX64usmtghTwGw8AT885F-BV5Ua9cwA';

// ID du formulaire HP Church (réponses) -- JAMAIS modifié par ce script,
// seulement lu. Il reste synchronisé avec Supabase/le reste du système
// exactement comme avant.
var ID_FORMULAIRE_HP_CHURCH = '19ZhSagopCYX4NiK-IigbJYWFMB47L04y7LfJNKu2I0w';

var NOM_ONGLET_ZONES_NB = 'Zones Géographiques';

// Colonnes réelles du formulaire "HP churches (réponses)" (0-based, telles
// que lues le 17 sept. 2026 -- à ajuster si une question est ajoutée/retirée
// dans le formulaire, ce qui décale les colonnes).
var COL_FORM = {
  ROLE_ACTUEL: 5, // "Quel est votre rôle actuel ?" -- Membre / Ananias / HP Leader / Overseer / Ministre ordonné / (vide)
  PRENOM: 1, NOM: 2, TELEPHONE: 3, EMAIL: 4, REGION: 6, ADRESSE: 7,
  CODE_POSTAL: 8, DISPO_HEBERGER: 10 // "Seriez-vous disposé(e) à ouvrir votre maison..."
};

// Normalise la "Région de résidence principale" / "Ville" du formulaire (et
// les quartiers/villes réels vus dans Vercel, ex: "Ville-Marie (Centre-
// ville)", "Mercier–Hochelaga-Maisonneuve", "Ste. Anne"...) vers le nom
// exact de l'onglet-ville dans ce nouveau fichier. TOUTES les valeurs
// rencontrées dans le filtre "Browse by city" de Vercel sont couvertes ici
// -- ajoute une ligne si une nouvelle ville/quartier apparaît un jour.
var REGION_VERS_ONGLET = {
  // --- Montréal (arrondissements) ---
  'montréal': 'MONTREAL', 'montreal': 'MONTREAL',
  'ville-marie (centre-ville)': 'MONTREAL', 'ville-marie': 'MONTREAL', 'centre-ville': 'MONTREAL',
  'montréal-nord': 'MONTREAL', 'montreal-nord': 'MONTREAL',
  'saint-léonard': 'MONTREAL', 'saint-leonard': 'MONTREAL',
  'anjou': 'MONTREAL',
  'rivière-des-prairies': 'MONTREAL', 'riviere-des-prairies': 'MONTREAL',
  'mercier–hochelaga-maisonneuve': 'MONTREAL', 'mercier-hochelaga-maisonneuve': 'MONTREAL',
  'rosemont–la petite-patrie': 'MONTREAL', 'rosemont-la petite-patrie': 'MONTREAL',
  'ahuntsic-cartierville': 'MONTREAL',
  'villeray': 'MONTREAL', 'villeray–saint-michel–parc-extension': 'MONTREAL',
  'côte-des-neiges–notre-dame-de-grâce': 'MONTREAL', 'cote-des-neiges-notre-dame-de-grace': 'MONTREAL',
  'saint-laurent': 'MONTREAL',
  'saint-michel': 'MONTREAL',

  // --- Pointe-aux-Trembles (son propre onglet) ---
  'pointe-aux-trembles (pat)': 'Pointe-aux-Trembles', 'pointe-aux-trembles': 'Pointe-aux-Trembles',

  // --- Laval + Basses-Laurentides / Rive-Nord proche (rattachées à Laval) ---
  'laval': 'Laval',
  'mirabel': 'Laval', 'blainville': 'Laval', 'saint-eustache': 'Laval',
  'deux-montagnes': 'Laval', 'sainte-thérèse': 'Laval', 'sainte-therese': 'Laval',
  'lorraine': 'Laval',

  // --- Ouest-de-l'Île (rattaché à Pierrefonds) ---
  'pierrefonds': 'Pierrefonds', 'pierrefonds-roxboro': 'Pierrefonds',
  'île perrot': 'Pierrefonds', 'ile perrot': 'Pierrefonds', "l'île-perrot": 'Pierrefonds',

  // --- Trois-Rivières / Mauricie ---
  'trois-rivières': 'Trois-Rivières', 'trois-rivieres': 'Trois-Rivières',
  'trois-rivières / mauricie': 'Trois-Rivières', 'trois-rivieres / mauricie': 'Trois-Rivières',

  // --- Repentigny + Lanaudière proche (rattachées à Repentigny) ---
  'repentigny': 'Repentigny',
  "l'épiphanie": 'Repentigny', "l'epiphanie": 'Repentigny', 'epiphanie': 'Repentigny',
  'saint-charles-borromée': 'Repentigny', 'saint-charles-borromee': 'Repentigny',

  // --- Terrebonne + Lanaudière proche (rattachées à Terrebonne) ---
  'terrebonne': 'Terrebonne',
  'mascouche': 'Terrebonne',
  'saint-lin': 'Terrebonne', 'saint-lin–laurentides': 'Terrebonne', 'saint-lin-laurentides': 'Terrebonne',
  'ste. anne': 'Terrebonne', 'ste-anne': 'Terrebonne', 'sainte-anne': 'Terrebonne',
  'sainte-anne-des-plaines': 'Terrebonne',

  // --- Québec ---
  'québec': 'Québec', 'quebec': 'Québec', 'région de québec': 'Québec', 'region de quebec': 'Québec',

  // --- Autres villes/provinces (onglets dédiés) ---
  'sherbrooke': 'Sherbrooke',
  'winnipeg': 'Winnipeg',
  'manitoba': 'Manitoba',
  'new-brunswick': 'New-Brunswick', 'nouveau-brunswick': 'New-Brunswick',
  'alberta': 'Alberta',
  'youth': 'Youth'
};

// -----------------------------------------------------------------------
// MENU -- ajoute ces items à ta fonction onOpen() existante (ou laisse ce
// onOpen séparé si ce nouveau fichier n'a pas encore de menu du tout).
// -----------------------------------------------------------------------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Bethel Église')
    .addItem('🆕 Nouvelle personne (table d\'intégration)', 'lancerNouvelleIntegrationTable')
    .addItem('➕ Intégrer une personne du vieux fichier', 'lancerIntegrationDepuisVieuxFichier')
    .addItem('🔄 Récupérer les nouvelles réponses du formulaire HP Church (maintenant)', 'recupererNouvellesReponsesHPChurch')
    .addSeparator()
    .addItem('⚙️ Activer la synchro automatique HP Church (15 min)', 'activerSynchroAutomatiqueHPChurch')
    .addItem('⏹ Désactiver la synchro automatique HP Church', 'desactiverSynchroAutomatiqueHPChurch')
    .addItem('📋 Voir le journal de synchro HP Church', 'ouvrirJournalSyncHPChurch')
    .addSeparator()
    .addItem('📍 Assigner Bethel selon zone (Oui/Non)', 'assignerBethelSelonZoneNouveauBethel')
    .addToUi();
}

// -----------------------------------------------------------------------
// 0-bis) NOUVELLE PERSONNE SAISIE DIRECTEMENT À LA TABLE D'INTÉGRATION
// Le dimanche : quelqu'un vient pour la première fois, on lui demande son
// nom, son adresse et son code postal (à la main ou tapé directement ici).
// Ce bouton pose les questions une par une, puis place la personne dans la
// bonne zone -- si un leader existe déjà dans sa zone (un BETHEL ID est déjà
// là), elle est ajoutée directement chez lui comme Membre. Si elle dit Oui
// à l'hébergement et qu'aucun leader n'existe encore dans sa zone, elle
// devient elle-même Bethel Leader d'un nouveau groupe.
// -----------------------------------------------------------------------
function lancerNouvelleIntegrationTable() {
  var ui = SpreadsheetApp.getUi();

  var rPrenom = ui.prompt('Nouvelle personne -- 1/6', 'Prénom :', ui.ButtonSet.OK_CANCEL);
  if (rPrenom.getSelectedButton() !== ui.Button.OK) return;
  var prenom = rPrenom.getResponseText().trim();
  if (!prenom) { ui.alert('Le prénom est obligatoire.'); return; }

  var rNom = ui.prompt('Nouvelle personne -- 2/6', 'Nom de famille :', ui.ButtonSet.OK_CANCEL);
  if (rNom.getSelectedButton() !== ui.Button.OK) return;
  var nom = rNom.getResponseText().trim();
  if (!nom) { ui.alert('Le nom est obligatoire.'); return; }

  var rTel = ui.prompt('Nouvelle personne -- 3/6', 'Téléphone :', ui.ButtonSet.OK_CANCEL);
  if (rTel.getSelectedButton() !== ui.Button.OK) return;
  var telephone = rTel.getResponseText().trim();

  var dejaPresent = telephoneExisteDejaDansNouveauFichier(telephone, prenom, nom);
  if (dejaPresent) {
    ui.alert('⚠️ ' + prenom + ' ' + nom + ' est déjà dans ce fichier (' + dejaPresent.ville
      + ', ' + dejaPresent.hpId + '). Intégration annulée pour éviter un doublon.');
    return;
  }

  var rAdresse = ui.prompt('Nouvelle personne -- 4/6', 'Adresse (numéro civique + rue) :', ui.ButtonSet.OK_CANCEL);
  if (rAdresse.getSelectedButton() !== ui.Button.OK) return;
  var adresse = rAdresse.getResponseText().trim();

  var rCodePostal = ui.prompt('Nouvelle personne -- 5/6', 'Code postal (ex: H1A 2B3) -- obligatoire pour trouver sa zone :', ui.ButtonSet.OK_CANCEL);
  if (rCodePostal.getSelectedButton() !== ui.Button.OK) return;
  var codePostal = rCodePostal.getResponseText().trim();
  if (!codePostal || codePostal.length < 3) {
    ui.alert('Code postal manquant ou trop court -- impossible de déterminer sa zone. Redemande son code postal avant de continuer.');
    return;
  }

  var rHeberger = ui.prompt('Nouvelle personne -- 6/6',
    'Serait-elle prête à ouvrir sa maison pour un Bethel le dimanche ? Tape Oui ou Non :', ui.ButtonSet.OK_CANCEL);
  if (rHeberger.getSelectedButton() !== ui.Button.OK) return;
  var aDitOui = rHeberger.getResponseText().trim().toLowerCase().indexOf('oui') === 0;

  // Ville déduite du FSA via "Zones Géographiques" quand c'est possible, sinon
  // on demande explicitement -- jamais un mauvais onglet.
  var mapping = obtenirMappingZonesNB();
  var fsa = codePostal.toUpperCase().replace(/\s/g, '').substring(0, 3);
  var zoneInfo = mapping[fsa];
  var ville;
  if (zoneInfo && zoneInfo.villeCible && VILLE_VERS_ZONE_NB.hasOwnProperty(zoneInfo.villeCible)) {
    ville = zoneInfo.villeCible;
  } else {
    var villesDispo = Object.keys(VILLE_VERS_ZONE_NB).join(', ');
    var rVille = ui.prompt('Ville', 'Zone inconnue pour le FSA ' + fsa + ' -- dans quelle ville habite cette personne ? ('
      + villesDispo + ')', ui.ButtonSet.OK_CANCEL);
    if (rVille.getSelectedButton() !== ui.Button.OK) return;
    ville = rVille.getResponseText().trim();
    if (!VILLE_VERS_ZONE_NB.hasOwnProperty(ville)) {
      ui.alert('Ville non reconnue. Recommence en tapant exactement l\'un des noms proposés.');
      return;
    }
  }

  // Avant d'écrire quoi que ce soit, on montre à la personne à la table
  // QUI est déjà le leader de cette zone (ou qui va le devenir automatique-
  // ment) -- pour qu'elle puisse voir et confirmer avant de continuer.
  var apercu = apercuLeaderPourZone(ville, codePostal);
  var rConfirme = ui.alert('Leader de la zone (FSA ' + apercu.fsa + ')',
    apercu.message + '\n\nContinuer l\'intégration ?', ui.ButtonSet.OK_CANCEL);
  if (rConfirme !== ui.Button.OK) {
    ui.alert('Intégration annulée -- rien n\'a été ajouté.');
    return;
  }

  var resultat = placerPersonneSelonZone({
    ville: ville, prenom: prenom, nom: nom, telephone: telephone,
    email: '', adresse: adresse, codePostal: codePostal, aDitOui: aDitOui
  });
  ui.alert(resultat.message);
}

// Donne un aperçu, AVANT d'écrire quoi que ce soit, du leader qui existe
// déjà pour cette zone dans ce nouveau fichier -- ou, s'il n'y en a pas
// encore, du leader (Ananias/Bethel Leader) du vieux fichier qui sera
// automatiquement intégré ici pour cette zone. Sert à faire confirmer
// visuellement la personne qui gère la table d'intégration avant de
// continuer.
function apercuLeaderPourZone(nomOnglet, codePostal) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nomOngletValide = VILLE_VERS_ZONE_NB.hasOwnProperty(nomOnglet) ? nomOnglet : 'MONTREAL';
  var feuille = ss.getSheetByName(nomOngletValide);
  var fsa = codePostal.toString().trim().toUpperCase().replace(/\s/g, '').substring(0, 3);
  var mapping = obtenirMappingZonesNB();
  var zoneInfo = mapping[fsa];
  var bidReserve = zoneInfo ? zoneInfo.bethelId : '';

  var leaderIci = null;
  if (feuille) {
    var derniereLigne = feuille.getLastRow();
    if (derniereLigne >= 2) {
      var valeurs = feuille.getRange(2, 1, derniereLigne - 1, COL_NB.DISPO_HEBERGER).getValues();
      for (var i = 0; i < valeurs.length; i++) {
        var bid = (valeurs[i][COL_NB.BETHEL_ID - 1] || '').toString().trim();
        if (bid && (bid === bidReserve || !bidReserve) && valeurs[i][COL_NB.ROLE - 1] === 'Bethel Leader') {
          // Sans BETHEL ID réservé pour ce FSA, on se fie à la zone (ville) --
          // n'importe quel Bethel Leader déjà dans cet onglet est un candidat visible.
          if (!bidReserve || bid === bidReserve) {
            leaderIci = {
              nom: (valeurs[i][COL_NB.PRENOM - 1] || '') + ' ' + (valeurs[i][COL_NB.NOM - 1] || ''),
              telephone: valeurs[i][COL_NB.TELEPHONE - 1],
              bethelId: bid
            };
            if (bid === bidReserve) break; // correspondance exacte -- on arrête là
          }
        }
      }
    }
  }

  if (leaderIci) {
    return {
      fsa: fsa,
      leaderTrouve: true,
      message: '👤 Leader déjà présent dans ce nouveau fichier pour la zone ' + fsa + ' :\n'
        + leaderIci.nom.trim() + (leaderIci.telephone ? ' (' + leaderIci.telephone + ')' : '')
        + '\nBethel : ' + leaderIci.bethelId
    };
  }

  var candidatVieuxFichier = chercherLeaderPourZoneDansVieuxFichier(fsa);
  if (candidatVieuxFichier) {
    return {
      fsa: fsa,
      leaderTrouve: true,
      message: '👤 Aucun leader encore dans ce nouveau fichier pour la zone ' + fsa
        + ', mais un(e) ' + candidatVieuxFichier.role + ' de cette même zone existe dans le vieux fichier :\n'
        + candidatVieuxFichier.prenom + ' ' + candidatVieuxFichier.nom
        + (candidatVieuxFichier.telephone ? ' (' + candidatVieuxFichier.telephone + ')' : '')
        + ' -- ' + candidatVieuxFichier.ville
        + '\n\nIl/elle sera automatiquement intégré(e) ici comme nouveau Bethel Leader de cette zone.'
    };
  }

  return {
    fsa: fsa,
    leaderTrouve: false,
    message: '⚠️ Aucun leader trouvé pour la zone ' + fsa + ' -- ni dans ce nouveau fichier, ni dans le '
      + 'vieux fichier. La personne sera ajoutée "en attente d\'un leader dans sa zone" si elle n\'a pas '
      + 'dit Oui à l\'hébergement (et deviendra elle-même leader si elle a dit Oui).'
  };
}

// -----------------------------------------------------------------------
// 0) RÉCUPÉRER LES NOUVELLES RÉPONSES DU FORMULAIRE HP CHURCH
// Lecture SEULE du formulaire -- ne modifie jamais "HP churches (réponses)",
// qui reste synchronisé avec le reste du système comme avant. Traite
// uniquement les personnes qui ne sont pas déjà dans ce nouveau fichier
// (vérifié par téléphone/nom), donc on peut relancer ce bouton autant de
// fois qu'on veut sans jamais dupliquer personne.
// -----------------------------------------------------------------------
function recupererNouvellesReponsesHPChurch() {
  var resume = traiterNouvellesReponsesHPChurch();
  ecrireJournalSyncHPChurch(resume);

  var message = '✅ Intégrés dans ce nouveau fichier : ' + resume.compteIntegres + '\n'
    + 'Déjà présents (ignorés) : ' + resume.compteDejaLa + '\n'
    + 'Région non reconnue : ' + resume.compteRegionInconnue + '\n'
    + 'Sans code postal : ' + resume.compteZoneInconnue
    + '\n\nLe formulaire "HP churches (réponses)" n\'a pas été modifié (lecture seule).';
  if (resume.detailsProblemes.length) {
    message += '\n\nÀ vérifier manuellement :\n' + resume.detailsProblemes.slice(0, 25).join('\n');
    if (resume.detailsProblemes.length > 25) message += '\n... et ' + (resume.detailsProblemes.length - 25) + ' autre(s).';
  }
  SpreadsheetApp.getUi().alert('Récupération des réponses HP Church — terminé', message, SpreadsheetApp.getUi().ButtonSet.OK);
}

// -----------------------------------------------------------------------
// Version SANS interface -- appelée à la fois par le bouton manuel
// ci-dessus (qui affiche ensuite une alerte) et par le déclencheur
// automatique (qui, lui, écrit seulement dans le journal, sans jamais
// afficher de fenêtre puisque personne n'est là pour cliquer "OK").
// Toujours en lecture seule sur "HP churches (réponses)".
// -----------------------------------------------------------------------
function traiterNouvellesReponsesHPChurch() {
  var ssForm = SpreadsheetApp.openById(ID_FORMULAIRE_HP_CHURCH);
  var feuilleForm = ssForm.getSheets()[0]; // l'onglet des réponses est le premier
  var resume = {
    compteIntegres: 0, compteDejaLa: 0, compteZoneInconnue: 0, compteRegionInconnue: 0,
    detailsIntegres: [], detailsProblemes: []
  };

  var derniereLigne = feuilleForm.getLastRow();
  if (derniereLigne < 2) return resume;

  var maxCol = Math.max(COL_FORM.PRENOM, COL_FORM.NOM, COL_FORM.TELEPHONE, COL_FORM.EMAIL,
    COL_FORM.REGION, COL_FORM.ADRESSE, COL_FORM.CODE_POSTAL, COL_FORM.DISPO_HEBERGER, COL_FORM.ROLE_ACTUEL) + 1;
  var donnees = feuilleForm.getRange(2, 1, derniereLigne - 1, maxCol).getValues();

  for (var i = 0; i < donnees.length; i++) {
    var prenom = (donnees[i][COL_FORM.PRENOM] || '').toString().trim();
    var nom = (donnees[i][COL_FORM.NOM] || '').toString().trim();
    if (!prenom || !nom) continue;

    var telephone = donnees[i][COL_FORM.TELEPHONE];
    var dejaPresent = telephoneExisteDejaDansNouveauFichier(telephone, prenom, nom);
    if (dejaPresent) {
      resume.compteDejaLa++;
      continue;
    }

    var region = (donnees[i][COL_FORM.REGION] || '').toString().trim().toLowerCase();
    var ville = REGION_VERS_ONGLET[region];
    if (!ville) {
      resume.compteRegionInconnue++;
      resume.detailsProblemes.push(prenom + ' ' + nom + ' -- région non reconnue : "' + (donnees[i][COL_FORM.REGION] || '') + '"');
      continue;
    }

    var codePostal = (donnees[i][COL_FORM.CODE_POSTAL] || '').toString().trim();
    if (!codePostal) {
      resume.compteZoneInconnue++;
      resume.detailsProblemes.push(prenom + ' ' + nom + ' -- pas de code postal dans le formulaire');
      continue;
    }

    var aDitOuiHeberger = (donnees[i][COL_FORM.DISPO_HEBERGER] || '').toString().indexOf('Oui') !== -1;
    var roleActuel = (donnees[i][COL_FORM.ROLE_ACTUEL] || '').toString().trim();

    // Dire "Oui" à héberger ne veut pas dire devenir Bethel Leader :
    // -- si la personne s'est déclarée "Membre", elle reste Membre (elle
    //    peut prêter sa maison sans qu'on lui attribue un Bethel ID) ;
    // -- si elle supervise déjà d'autres groupes (Overseer, Ministre
    //    Ordonné, Assistant Pasteur, Pasteur), elle ne peut PAS non plus
    //    prendre son propre Bethel -- elle ne peut pas être à deux endroits
    //    en même temps un dimanche à 8h si elle doit aussi superviser
    //    d'autres Bethels au même moment.
    // Seuls un Ananias, un Bethel Leader (HP Leader), ou une réponse sans
    // rôle précisé laissent la porte ouverte à devenir leader ici.
    var rolesSansBethelPropre = ['Membre', 'Overseer', 'Ministre ordonné', 'Ministre Ordonné', 'Assistant Pasteur', 'Pasteur'];
    var bloqueDevenirLeader = rolesSansBethelPropre.indexOf(roleActuel) !== -1;
    var aDitOui = aDitOuiHeberger && !bloqueDevenirLeader;

    var resultat = placerPersonneSelonZone({
      ville: ville, prenom: prenom, nom: nom, telephone: telephone,
      email: donnees[i][COL_FORM.EMAIL], adresse: donnees[i][COL_FORM.ADRESSE],
      codePostal: codePostal, aDitOui: aDitOui,
      offreSaMaisonSansLeadership: aDitOuiHeberger && bloqueDevenirLeader
    });
    if (resultat.succes) {
      resume.compteIntegres++;
      resume.detailsIntegres.push(prenom + ' ' + nom);
    }
  }

  return resume;
}

// -----------------------------------------------------------------------
// DÉCLENCHEUR AUTOMATIQUE -- tourne tout seul toutes les 15 minutes une
// fois activé (menu "⚙️ Activer la synchro automatique..."). Fonctionne
// exactement comme le bouton manuel, mais sans jamais ouvrir de fenêtre --
// tout est écrit dans l'onglet "Journal Sync HP Church" pour que tu puisses
// vérifier ce qui s'est passé quand tu veux, sans avoir à cliquer sur rien.
// -----------------------------------------------------------------------
function synchroniserHPChurchAutomatique() {
  var resume = traiterNouvellesReponsesHPChurch();
  ecrireJournalSyncHPChurch(resume);
}

var NOM_ONGLET_JOURNAL_SYNC = 'Journal Sync HP Church';

function ecrireJournalSyncHPChurch(resume) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = ss.getSheetByName(NOM_ONGLET_JOURNAL_SYNC);
  if (!feuille) {
    feuille = ss.insertSheet(NOM_ONGLET_JOURNAL_SYNC);
    feuille.getRange(1, 1, 1, 6).setValues([[
      'Date/heure', 'Intégrés', 'Déjà présents', 'Région inconnue', 'Sans code postal', 'Détails à vérifier'
    ]]);
    feuille.getRange(1, 1, 1, 6).setFontWeight('bold');
    feuille.setFrozenRows(1);
  }
  feuille.appendRow([
    new Date(), resume.compteIntegres, resume.compteDejaLa, resume.compteRegionInconnue,
    resume.compteZoneInconnue, resume.detailsProblemes.join(' | ')
  ]);
}

function ouvrirJournalSyncHPChurch() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = ss.getSheetByName(NOM_ONGLET_JOURNAL_SYNC);
  if (!feuille) {
    SpreadsheetApp.getUi().alert('Le journal n\'existe pas encore -- il sera créé automatiquement à la première synchro (manuelle ou automatique).');
    return;
  }
  ss.setActiveSheet(feuille);
}

// Active la synchro automatique toutes les 15 minutes. Sûr à relancer
// plusieurs fois -- supprime d'abord tout ancien déclencheur pour ne
// jamais en avoir deux qui tournent en double.
function activerSynchroAutomatiqueHPChurch() {
  supprimerDeclencheursSyncHPChurch(); // évite les doublons, sans afficher d'alerte
  ScriptApp.newTrigger('synchroniserHPChurchAutomatique')
    .timeBased()
    .everyMinutes(15)
    .create();
  SpreadsheetApp.getUi().alert('✅ Synchro automatique activée : le nouveau fichier va aller chercher les '
    + 'nouvelles réponses du formulaire HP Church toutes les 15 minutes, sans que personne ait à cliquer sur rien.\n\n'
    + 'Regarde l\'onglet "' + NOM_ONGLET_JOURNAL_SYNC + '" pour voir l\'historique.');
}

function desactiverSynchroAutomatiqueHPChurch() {
  var supprimes = supprimerDeclencheursSyncHPChurch();
  SpreadsheetApp.getUi().alert(supprimes > 0
    ? '⏹ Synchro automatique désactivée.'
    : 'La synchro automatique n\'était pas activée.');
}

function supprimerDeclencheursSyncHPChurch() {
  var declencheurs = ScriptApp.getProjectTriggers();
  var supprimes = 0;
  for (var i = 0; i < declencheurs.length; i++) {
    if (declencheurs[i].getHandlerFunction() === 'synchroniserHPChurchAutomatique') {
      ScriptApp.deleteTrigger(declencheurs[i]);
      supprimes++;
    }
  }
  return supprimes;
}

// -----------------------------------------------------------------------
// 1) INTÉGRATION D'UNE PERSONNE DEPUIS LE VIEUX FICHIER
// -----------------------------------------------------------------------
function lancerIntegrationDepuisVieuxFichier() {
  var ui = SpreadsheetApp.getUi();

  var reponsePrenom = ui.prompt('Intégrer une personne', 'Prénom de la personne (exactement comme dans le vieux fichier) :', ui.ButtonSet.OK_CANCEL);
  if (reponsePrenom.getSelectedButton() !== ui.Button.OK) return;
  var prenom = reponsePrenom.getResponseText().trim();

  var reponseNom = ui.prompt('Intégrer une personne', 'Nom de famille :', ui.ButtonSet.OK_CANCEL);
  if (reponseNom.getSelectedButton() !== ui.Button.OK) return;
  var nom = reponseNom.getResponseText().trim();

  if (!prenom || !nom) {
    ui.alert('Le prénom et le nom sont obligatoires.');
    return;
  }

  var trouvailles = chercherDansVieuxFichier(prenom, nom);
  if (trouvailles.length === 0) {
    ui.alert('Personne non trouvée dans le vieux fichier : ' + prenom + ' ' + nom
      + '.\n\nVérifie l\'orthographe exacte (accents, majuscules).');
    return;
  }

  var source;
  if (trouvailles.length > 1) {
    var liste = trouvailles.map(function(t, i) {
      return (i + 1) + '. ' + t.ville + ' -- ' + t.hpId + (t.role ? ' [' + t.role + ']' : '')
        + (t.telephone ? ' (' + t.telephone + ')' : '');
    }).join('\n');
    var choix = ui.prompt('Plusieurs personnes trouvées',
      prenom + ' ' + nom + ' existe à plusieurs endroits dans le vieux fichier :\n' + liste
        + '\n\nTape le numéro de la bonne ligne :', ui.ButtonSet.OK_CANCEL);
    if (choix.getSelectedButton() !== ui.Button.OK) return;
    var idx = parseInt(choix.getResponseText().trim(), 10) - 1;
    if (isNaN(idx) || !trouvailles[idx]) {
      ui.alert('Choix invalide.');
      return;
    }
    source = trouvailles[idx];
  } else {
    source = trouvailles[0];
  }

  // Déjà présent dans CE nouveau fichier ? On ne duplique pas.
  var dejaPresent = telephoneExisteDejaDansNouveauFichier(source.telephone, prenom, nom);
  if (dejaPresent) {
    ui.alert('⚠️ ' + prenom + ' ' + nom + ' est déjà dans ce nouveau fichier (' + dejaPresent.ville
      + ', ' + dejaPresent.hpId + '). Intégration annulée pour éviter un doublon.');
    return;
  }

  if (!source.codePostal) {
    ui.alert('⚠️ ' + prenom + ' ' + nom + ' n\'a pas de code postal dans le vieux fichier -- '
      + 'impossible de déterminer sa zone automatiquement. Demande-lui son code postal, '
      + 'ajoute-le dans le vieux fichier, puis relance l\'intégration.');
    return;
  }

  // Montre AVANT tout qui est déjà (ou qui deviendra) le leader de la zone
  // de cette personne, pour confirmation visuelle.
  var apercu2 = apercuLeaderPourZone(source.ville, source.codePostal);
  var rConfirme2 = ui.alert('Leader de la zone (FSA ' + apercu2.fsa + ')',
    apercu2.message + '\n\nContinuer l\'intégration ?', ui.ButtonSet.OK_CANCEL);
  if (rConfirme2 !== ui.Button.OK) {
    ui.alert('Intégration annulée -- rien n\'a été ajouté.');
    return;
  }

  // Si cette personne est déjà LEADER (Bethel Leader / Facilitateur) dans le
  // vieux fichier, elle garde son rôle de leader dans le nouveau fichier --
  // sa chaîne de supervision (Ananias, Overseer, Ministre Ordonné, Assistant
  // Pasteur, Pasteur) est reprise directement depuis SA fiche du vieux
  // fichier, sans avoir à la retaper. Un membre ordinaire, lui, passe par la
  // logique habituelle (placerPersonneSelonZone : Membre ou nouveau Leader
  // selon Oui/Non).
  var estLeaderExistant = (source.role === 'Bethel Leader' || source.role === 'Facilitateur');

  var resultat = estLeaderExistant
    ? placerLeaderExistantSelonZone({
        ville: source.ville, prenom: prenom, nom: nom, telephone: source.telephone,
        email: source.email, adresse: source.adresse, codePostal: source.codePostal,
        ananias: source.ananias, overseer: source.overseer, ministre: source.ministre,
        assistantPasteur: source.assistantPasteur, pasteur: source.pasteur
      })
    : placerPersonneSelonZone({
        ville: source.ville, prenom: prenom, nom: nom, telephone: source.telephone,
        email: source.email, adresse: source.adresse, codePostal: source.codePostal,
        aDitOui: source.aDitOui
      });

  ui.alert(resultat.message);
}

// Cherche prénom+nom dans TOUS les onglets villes du VIEUX fichier (lecture seule).
function chercherDansVieuxFichier(prenom, nom) {
  var ssVieux = SpreadsheetApp.openById(ID_VIEUX_FICHIER);
  var pCible = prenom.toString().trim().toLowerCase();
  var nCible = nom.toString().trim().toLowerCase();
  var villes = ['MONTREAL', 'Laval', 'Pierrefonds', 'Trois-Rivières', 'Repentigny', 'Terrebonne',
    'Pointe-aux-Trembles', 'Québec', 'Sherbrooke', 'Winnipeg', 'Manitoba', 'New-Brunswick', 'Youth', 'Alberta'];
  var resultats = [];

  for (var s = 0; s < villes.length; s++) {
    var feuille = ssVieux.getSheetByName(villes[s]);
    if (!feuille) continue;
    var derniereLigne = feuille.getLastRow();
    if (derniereLigne < 2) continue;
    var donnees = feuille.getRange(2, 1, derniereLigne - 1, 40).getValues();
    for (var i = 0; i < donnees.length; i++) {
      var p = (donnees[i][1] || '').toString().trim().toLowerCase();
      var n = (donnees[i][2] || '').toString().trim().toLowerCase();
      if (p === pCible && n === nCible) {
        resultats.push({
          ville: villes[s],
          hpId: (donnees[i][12] || '').toString().trim(),
          telephone: donnees[i][3],
          email: donnees[i][4],
          adresse: donnees[i][6],
          codePostal: (donnees[i][8] || '').toString().trim(),
          aDitOui: (donnees[i][39] || '').toString().indexOf('Oui') !== -1, // colonne AN, DISPO HÉBERGER
          // Rôle et chaîne de supervision PROPRES à cette personne (utile si
          // c'est elle-même un leader -- voir placerLeaderExistantSelonZone) :
          role: (donnees[i][16] || '').toString().trim(),          // colonne 17, ROLE
          ananias: (donnees[i][18] || '').toString().trim(),        // colonne 19, ANANIAS
          overseer: (donnees[i][20] || '').toString().trim(),       // colonne 21, OVERSEER
          ministre: (donnees[i][21] || '').toString().trim(),       // colonne 22, MINISTRE ORDONNÉ
          assistantPasteur: (donnees[i][37] || '').toString().trim(), // colonne 38, ASSISTANT PASTEUR
          pasteur: (donnees[i][38] || '').toString().trim()          // colonne 39, PASTEUR
        });
      }
    }
  }
  return resultats;
}

// -----------------------------------------------------------------------
// 2) ASSIGNATION PAR ZONE DANS CE NOUVEAU FICHIER
// (structure des onglets villes identique à l'ancien fichier)
// -----------------------------------------------------------------------
var COL_NB = {
  CAMPUS: 1, PRENOM: 2, NOM: 3, TELEPHONE: 4, EMAIL: 5, GENDER: 6,
  ADRESSE: 7, VILLE: 8, CODE_POSTAL: 9, PROVINCE: 10, PAYS: 11,
  BETHEL_NUMBER: 12, BETHEL_ID: 13, BETHEL_ZONE: 14, DAY_OF_BETHEL: 15,
  TIME: 16, ROLE: 17, BETHEL_MEMBRE: 18, ANANIAS: 19, BETHEL_LEADER: 20,
  OVERSEER: 21, MINISTRE_ORDONNE: 22, STATUS: 23,
  ASSISTANT_PASTEUR: 38, PASTEUR: 39, DISPO_HEBERGER: 40
};

var VILLE_VERS_ZONE_NB = {
  'MONTREAL': 'MTL', 'Laval': 'LVL', 'Pierrefonds': 'PRF', 'Trois-Rivières': 'TRV',
  'Repentigny': 'RPT', 'Terrebonne': 'TRB', 'Pointe-aux-Trembles': 'PAT', 'Québec': 'QBC',
  'Sherbrooke': 'SHR', 'Winnipeg': 'WIN', 'Manitoba': 'MTA', 'New-Brunswick': 'NBW',
  'Youth': 'YTH', 'Alberta': 'ALB'
};

function obtenirMappingZonesNB() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = ss.getSheetByName(NOM_ONGLET_ZONES_NB);
  if (!feuille) return {};
  var derniereLigne = feuille.getLastRow();
  if (derniereLigne < 2) return {};
  var donnees = feuille.getRange(2, 1, derniereLigne - 1, 7).getValues();
  var mapping = {};
  for (var i = 0; i < donnees.length; i++) {
    var fsa = (donnees[i][0] || '').toString().trim().toUpperCase();
    if (!fsa) continue;
    mapping[fsa] = {
      villeCible: (donnees[i][1] || '').toString().trim(),
      bethelId: (donnees[i][2] || '').toString().trim(),
      overseer: (donnees[i][3] || '').toString().trim(),
      ministre: (donnees[i][4] || '').toString().trim(),
      assistantPasteur: (donnees[i][5] || '').toString().trim(),
      pasteur: (donnees[i][6] || '').toString().trim()
    };
  }
  return mapping;
}

function telephoneExisteDejaDansNouveauFichier(telephone, prenom, nom) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var villes = Object.keys(VILLE_VERS_ZONE_NB);
  var telCible = normaliserTelNB(telephone);
  var pCible = (prenom || '').toString().trim().toLowerCase();
  var nCible = (nom || '').toString().trim().toLowerCase();

  for (var s = 0; s < villes.length; s++) {
    var feuille = ss.getSheetByName(villes[s]);
    if (!feuille) continue;
    var derniereLigne = feuille.getLastRow();
    if (derniereLigne < 2) continue;
    var donnees = feuille.getRange(2, 1, derniereLigne - 1, 13).getValues();
    for (var i = 0; i < donnees.length; i++) {
      var p = (donnees[i][1] || '').toString().trim().toLowerCase();
      var n = (donnees[i][2] || '').toString().trim().toLowerCase();
      var t = normaliserTelNB(donnees[i][3]);
      if ((t && telCible && t === telCible) || (p === pCible && n === nCible && p !== '')) {
        return { ville: villes[s], hpId: donnees[i][12] };
      }
    }
  }
  return null;
}

function normaliserTelNB(tel) {
  return (tel || '').toString().replace(/[^\d]/g, '');
}

// Place une personne (déjà identifiée) dans ce nouveau fichier, selon sa zone.
// info = { ville, prenom, nom, telephone, email, adresse, codePostal, aDitOui }
function placerPersonneSelonZone(info) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nomOnglet = info.ville;
  if (!VILLE_VERS_ZONE_NB.hasOwnProperty(nomOnglet)) {
    // Repli si le nom d'onglet ne correspond pas exactement (ex. "Montréal" vs "MONTREAL")
    nomOnglet = 'MONTREAL';
  }
  var feuille = ss.getSheetByName(nomOnglet);
  if (!feuille) {
    return { succes: false, message: 'Onglet introuvable dans le nouveau fichier : ' + nomOnglet + '.' };
  }

  var mapping = obtenirMappingZonesNB();
  var fsa = info.codePostal.toString().trim().toUpperCase().replace(/\s/g, '').substring(0, 3);
  var zoneInfo = mapping[fsa];

  var zoneCode = VILLE_VERS_ZONE_NB[nomOnglet];

  // Index des groupes déjà présents dans cet onglet (ce nouveau fichier)
  var derniereLigne = feuille.getLastRow();
  var valeurs = derniereLigne >= 2 ? feuille.getRange(2, 1, derniereLigne - 1, COL_NB.DISPO_HEBERGER).getValues() : [];
  var groupesExistants = {};
  var numeroMax = 0;
  for (var i = 0; i < valeurs.length; i++) {
    var bid = (valeurs[i][COL_NB.BETHEL_ID - 1] || '').toString().trim();
    if (!bid) continue;
    if (!groupesExistants[bid]) {
      groupesExistants[bid] = {
        bethelNumber: valeurs[i][COL_NB.BETHEL_NUMBER - 1],
        dayOfBethel: valeurs[i][COL_NB.DAY_OF_BETHEL - 1] || 'Dimanche',
        time: valeurs[i][COL_NB.TIME - 1] || '8:00',
        leader: '', ananias: '', overseer: '', ministre: '',
        assistantPasteur: valeurs[i][COL_NB.ASSISTANT_PASTEUR - 1],
        pasteur: valeurs[i][COL_NB.PASTEUR - 1]
      };
    }
    if (valeurs[i][COL_NB.ROLE - 1] === 'Bethel Leader') {
      groupesExistants[bid].leader = valeurs[i][COL_NB.PRENOM - 1] + ' ' + valeurs[i][COL_NB.NOM - 1];
    }
    if (valeurs[i][COL_NB.ANANIAS - 1]) groupesExistants[bid].ananias = valeurs[i][COL_NB.ANANIAS - 1];
    if (valeurs[i][COL_NB.OVERSEER - 1]) groupesExistants[bid].overseer = valeurs[i][COL_NB.OVERSEER - 1];
    if (valeurs[i][COL_NB.MINISTRE_ORDONNE - 1]) groupesExistants[bid].ministre = valeurs[i][COL_NB.MINISTRE_ORDONNE - 1];
    var n = Number(valeurs[i][COL_NB.BETHEL_NUMBER - 1]) || 0;
    if (n > numeroMax) numeroMax = n;
  }

  var bidReserve = zoneInfo ? zoneInfo.bethelId : '';
  var groupeReserve = bidReserve ? groupesExistants[bidReserve] : null;

  var ligneCible = feuille.getLastRow() + 1;
  var role, bethelIdFinal, leaderNom, ananias, overseer, ministre, assistantPasteur, pasteur, jour, heure, numero, statut;

  if (groupeReserve && groupeReserve.leader) {
    // Un leader existe déjà dans cette zone ici -> Membre
    role = 'Membre';
    bethelIdFinal = bidReserve;
    numero = groupeReserve.bethelNumber;
    jour = groupeReserve.dayOfBethel;
    heure = groupeReserve.time;
    leaderNom = groupeReserve.leader;
    ananias = groupeReserve.ananias;
    overseer = groupeReserve.overseer || (zoneInfo ? zoneInfo.overseer : '');
    ministre = groupeReserve.ministre || (zoneInfo ? zoneInfo.ministre : '');
    assistantPasteur = groupeReserve.assistantPasteur || (zoneInfo ? zoneInfo.assistantPasteur : '');
    pasteur = groupeReserve.pasteur || (zoneInfo ? zoneInfo.pasteur : '');
    statut = 'Active';
  } else if (info.aDitOui) {
    // Devient Bethel Leader d'un nouveau Bethel dans sa zone
    numero = numeroMax + 1;
    bethelIdFinal = bidReserve || ('BETHEL-' + zoneCode + '-' + numero + '-F');
    role = 'Bethel Leader';
    jour = 'Dimanche';
    heure = '8:00';
    leaderNom = info.prenom + ' ' + info.nom;
    ananias = '';
    overseer = zoneInfo ? zoneInfo.overseer : '';
    ministre = zoneInfo ? zoneInfo.ministre : '';
    assistantPasteur = zoneInfo ? zoneInfo.assistantPasteur : '';
    pasteur = zoneInfo ? zoneInfo.pasteur : '';
    statut = 'Active';
  } else {
    // Aucun leader dans sa zone ici, et elle n'a pas dit Oui -> avant de la
    // mettre "en attente", on va chercher s'il existe déjà un Ananias ou un
    // Bethel Leader dans le VIEUX fichier qui habite dans cette même zone
    // (même FSA). Si oui, on l'intègre automatiquement ici comme nouveau
    // Bethel Leader (avec sa propre chaîne de supervision), puis on rattache
    // la personne à lui -- elle n'a pas besoin d'attendre.
    if (!info._dejaTenteAutoLeader) {
      var candidatLeader = chercherLeaderPourZoneDansVieuxFichier(fsa);
      if (candidatLeader) {
        var dejaPresentLeader = telephoneExisteDejaDansNouveauFichier(
          candidatLeader.telephone, candidatLeader.prenom, candidatLeader.nom);
        if (!dejaPresentLeader) {
          placerLeaderExistantSelonZone({
            ville: nomOnglet, prenom: candidatLeader.prenom, nom: candidatLeader.nom,
            telephone: candidatLeader.telephone, email: candidatLeader.email,
            adresse: candidatLeader.adresse, codePostal: candidatLeader.codePostal,
            ananias: candidatLeader.ananias, overseer: candidatLeader.overseer,
            ministre: candidatLeader.ministre, assistantPasteur: candidatLeader.assistantPasteur,
            pasteur: candidatLeader.pasteur
          });
        }
        info._dejaTenteAutoLeader = true;
        return placerPersonneSelonZone(info); // relance : le leader existe maintenant ici
      }
      info._dejaTenteAutoLeader = true;
    }

    // Vraiment aucun leader trouvé nulle part pour cette zone -> en attente
    feuille.getRange(ligneCible, COL_NB.CAMPUS).setValue(nomOnglet === 'MONTREAL' ? 'MONTREAL' : nomOnglet);
    feuille.getRange(ligneCible, COL_NB.PRENOM).setValue(info.prenom);
    feuille.getRange(ligneCible, COL_NB.NOM).setValue(info.nom);
    feuille.getRange(ligneCible, COL_NB.TELEPHONE).setValue(info.telephone);
    feuille.getRange(ligneCible, COL_NB.EMAIL).setValue(info.email);
    feuille.getRange(ligneCible, COL_NB.ADRESSE).setValue(info.adresse);
    feuille.getRange(ligneCible, COL_NB.CODE_POSTAL).setValue(info.codePostal);
    var statutAttente = 'EN ATTENTE D\'UN LEADER DANS SA ZONE (FSA ' + fsa + ')'
      + (info.offreSaMaisonSansLeadership ? ' -- offre sa maison pour héberger le Bethel dès qu\'un leader sera trouvé' : '');
    feuille.getRange(ligneCible, COL_NB.STATUS).setValue(statutAttente);
    return {
      succes: true,
      message: '⏳ ' + info.prenom + ' ' + info.nom + ' ajouté(e) dans ' + nomOnglet
        + ', en attente d\'un leader dans sa zone (FSA ' + fsa + ')'
        + (info.offreSaMaisonSansLeadership ? ' -- elle offre sa maison pour le Bethel, mais reste Membre (pas de Bethel ID)' : '') + '. '
        + 'Elle sera reliée automatiquement dès qu\'un leader "Oui" apparaîtra dans cette zone.'
    };
  }

  feuille.getRange(ligneCible, COL_NB.CAMPUS).setValue(nomOnglet === 'MONTREAL' ? 'MONTREAL' : nomOnglet);
  feuille.getRange(ligneCible, COL_NB.PRENOM).setValue(info.prenom);
  feuille.getRange(ligneCible, COL_NB.NOM).setValue(info.nom);
  feuille.getRange(ligneCible, COL_NB.TELEPHONE).setValue(info.telephone);
  feuille.getRange(ligneCible, COL_NB.EMAIL).setValue(info.email);
  feuille.getRange(ligneCible, COL_NB.ADRESSE).setValue(info.adresse);
  feuille.getRange(ligneCible, COL_NB.CODE_POSTAL).setValue(info.codePostal);
  feuille.getRange(ligneCible, COL_NB.BETHEL_NUMBER).setValue(numero);
  feuille.getRange(ligneCible, COL_NB.BETHEL_ID).setValue(bethelIdFinal);
  feuille.getRange(ligneCible, COL_NB.BETHEL_ZONE).setValue(zoneCode);
  feuille.getRange(ligneCible, COL_NB.DAY_OF_BETHEL).setValue(jour);
  feuille.getRange(ligneCible, COL_NB.TIME).setValue(heure);
  feuille.getRange(ligneCible, COL_NB.ROLE).setValue(role);
  feuille.getRange(ligneCible, COL_NB.BETHEL_MEMBRE).setValue(info.prenom + ' ' + info.nom);
  feuille.getRange(ligneCible, COL_NB.ANANIAS).setValue(ananias);
  feuille.getRange(ligneCible, COL_NB.BETHEL_LEADER).setValue(leaderNom);
  feuille.getRange(ligneCible, COL_NB.OVERSEER).setValue(overseer);
  feuille.getRange(ligneCible, COL_NB.MINISTRE_ORDONNE).setValue(ministre);
  feuille.getRange(ligneCible, COL_NB.ASSISTANT_PASTEUR).setValue(assistantPasteur);
  feuille.getRange(ligneCible, COL_NB.PASTEUR).setValue(pasteur);
  feuille.getRange(ligneCible, COL_NB.STATUS).setValue(statut);

  return {
    succes: true,
    message: role === 'Bethel Leader'
      ? '✅ ' + info.prenom + ' ' + info.nom + ' intégré(e) dans ' + nomOnglet + ' comme NOUVEAU Bethel Leader ('
        + bethelIdFinal + ', zone ' + fsa + ').'
      : '✅ ' + info.prenom + ' ' + info.nom + ' intégré(e) dans ' + nomOnglet + ' (' + bethelIdFinal + ', Membre).'
  };
}

// Cherche, dans le VIEUX fichier (lecture seule), un Ananias ou un Bethel
// Leader qui habite dans le FSA donné (même zone). Priorité à un "Bethel
// Leader" trouvé dans la zone ; sinon un "Ananias". Retourne null si aucun
// des deux n'existe dans cette zone.
// Mise en cache par FSA pour ne scanner le vieux fichier qu'une seule fois
// par zone, même si on traite plusieurs personnes de la même zone d'affilée
// (ex: en lot depuis le formulaire HP Church).
var _cacheLeadersParZoneVieuxFichier = null;
function chercherLeaderPourZoneDansVieuxFichier(fsa) {
  if (!_cacheLeadersParZoneVieuxFichier) _cacheLeadersParZoneVieuxFichier = {};
  if (_cacheLeadersParZoneVieuxFichier.hasOwnProperty(fsa)) return _cacheLeadersParZoneVieuxFichier[fsa];

  var ssVieux = SpreadsheetApp.openById(ID_VIEUX_FICHIER);
  var villes = ['MONTREAL', 'Laval', 'Pierrefonds', 'Trois-Rivières', 'Repentigny', 'Terrebonne',
    'Pointe-aux-Trembles', 'Québec', 'Sherbrooke', 'Winnipeg', 'Manitoba', 'New-Brunswick', 'Youth', 'Alberta'];
  var meilleurBethelLeader = null;
  var meilleurAnanias = null;

  for (var s = 0; s < villes.length; s++) {
    var feuille = ssVieux.getSheetByName(villes[s]);
    if (!feuille) continue;
    var derniereLigne = feuille.getLastRow();
    if (derniereLigne < 2) continue;
    var donnees = feuille.getRange(2, 1, derniereLigne - 1, 40).getValues();
    for (var i = 0; i < donnees.length; i++) {
      var role = (donnees[i][16] || '').toString().trim(); // colonne 17, ROLE
      if (role !== 'Bethel Leader' && role !== 'Ananias') continue;
      var cp = (donnees[i][8] || '').toString().trim().toUpperCase().replace(/\s/g, ''); // colonne 9, CODE POSTAL
      if (cp.substring(0, 3) !== fsa) continue;
      var candidat = {
        ville: villes[s],
        prenom: (donnees[i][1] || '').toString().trim(),
        nom: (donnees[i][2] || '').toString().trim(),
        telephone: donnees[i][3], email: donnees[i][4], adresse: donnees[i][6],
        codePostal: (donnees[i][8] || '').toString().trim(),
        role: role,
        ananias: (donnees[i][18] || '').toString().trim(),
        overseer: (donnees[i][20] || '').toString().trim(),
        ministre: (donnees[i][21] || '').toString().trim(),
        assistantPasteur: (donnees[i][37] || '').toString().trim(),
        pasteur: (donnees[i][38] || '').toString().trim()
      };
      if (role === 'Bethel Leader' && !meilleurBethelLeader) meilleurBethelLeader = candidat;
      if (role === 'Ananias' && !meilleurAnanias) meilleurAnanias = candidat;
    }
    if (meilleurBethelLeader) break;
  }

  var resultat = meilleurBethelLeader || meilleurAnanias || null;
  _cacheLeadersParZoneVieuxFichier[fsa] = resultat;
  return resultat;
}

// -----------------------------------------------------------------------
// 2-bis) INTÉGRATION D'UN LEADER DÉJÀ EXISTANT (venant du vieux fichier)
// Cette personne a déjà son propre Bethel ID et sa propre chaîne de
// supervision (Ananias, Overseer, Ministre Ordonné, Assistant Pasteur,
// Pasteur) dans le vieux fichier -- elle DEVIENT le nouveau leader de sa
// zone ici, une fois son ancien groupe vidé. On ne lui redemande jamais
// Oui/Non : elle est déjà, de fait, un leader. Sa chaîne est copiée telle
// quelle depuis sa fiche du vieux fichier -- et, en plus, reportée dans
// l'onglet "Zones Géographiques" pour cette zone, afin que les prochaines
// personnes qui y arrivent héritent automatiquement de la bonne chaîne
// sans que quelqu'un ait à la retaper à la main.
// info = { ville, prenom, nom, telephone, email, adresse, codePostal,
//          ananias, overseer, ministre, assistantPasteur, pasteur }
// -----------------------------------------------------------------------
function placerLeaderExistantSelonZone(info) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var nomOnglet = VILLE_VERS_ZONE_NB.hasOwnProperty(info.ville) ? info.ville : 'MONTREAL';
  var feuille = ss.getSheetByName(nomOnglet);
  if (!feuille) {
    return { succes: false, message: 'Onglet introuvable dans le nouveau fichier : ' + nomOnglet + '.' };
  }

  var mapping = obtenirMappingZonesNB();
  var fsa = info.codePostal.toString().trim().toUpperCase().replace(/\s/g, '').substring(0, 3);
  var zoneInfo = mapping[fsa];
  var zoneCode = VILLE_VERS_ZONE_NB[nomOnglet];

  // Groupes déjà présents ici, pour savoir si cette zone a déjà un leader
  // dans CE nouveau fichier et calculer le prochain numéro disponible.
  var derniereLigne = feuille.getLastRow();
  var valeurs = derniereLigne >= 2 ? feuille.getRange(2, 1, derniereLigne - 1, COL_NB.DISPO_HEBERGER).getValues() : [];
  var leaderDejaLa = null;
  var numeroMax = 0;
  var bidReserve = zoneInfo ? zoneInfo.bethelId : '';
  for (var i = 0; i < valeurs.length; i++) {
    var bid = (valeurs[i][COL_NB.BETHEL_ID - 1] || '').toString().trim();
    if (!bid) continue;
    var n = Number(valeurs[i][COL_NB.BETHEL_NUMBER - 1]) || 0;
    if (n > numeroMax) numeroMax = n;
    if (bid === bidReserve && valeurs[i][COL_NB.ROLE - 1] === 'Bethel Leader') {
      leaderDejaLa = valeurs[i][COL_NB.PRENOM - 1] + ' ' + valeurs[i][COL_NB.NOM - 1];
    }
  }

  if (leaderDejaLa) {
    return {
      succes: false,
      message: '⚠️ La zone de ' + info.prenom + ' ' + info.nom + ' (FSA ' + fsa + ', ' + nomOnglet
        + ') a déjà un leader dans ce nouveau fichier : ' + leaderDejaLa + '.\n\n'
        + 'Pour éviter deux leaders dans la même zone, ' + info.prenom + ' ' + info.nom
        + ' n\'a PAS été ajouté(e). Décide manuellement : soit elle rejoint ' + leaderDejaLa
        + ' comme Membre (utilise "🆕 Nouvelle personne" ou ajoute-la à la main), soit '
        + leaderDejaLa + ' n\'est plus le bon leader pour cette zone.'
    };
  }

  var numero = numeroMax + 1;
  var bethelIdFinal = bidReserve || ('BETHEL-' + zoneCode + '-' + numero + '-F');
  // Chaîne de supervision : d'abord celle de la personne elle-même (vieux
  // fichier), sinon celle déjà connue pour cette zone dans "Zones Géographiques".
  var ananias = info.ananias || '';
  var overseer = info.overseer || (zoneInfo ? zoneInfo.overseer : '') || '';
  var ministre = info.ministre || (zoneInfo ? zoneInfo.ministre : '') || '';
  var assistantPasteur = info.assistantPasteur || (zoneInfo ? zoneInfo.assistantPasteur : '') || '';
  var pasteur = info.pasteur || (zoneInfo ? zoneInfo.pasteur : '') || '';

  var ligneCible = feuille.getLastRow() + 1;
  feuille.getRange(ligneCible, COL_NB.CAMPUS).setValue(nomOnglet);
  feuille.getRange(ligneCible, COL_NB.PRENOM).setValue(info.prenom);
  feuille.getRange(ligneCible, COL_NB.NOM).setValue(info.nom);
  feuille.getRange(ligneCible, COL_NB.TELEPHONE).setValue(info.telephone);
  feuille.getRange(ligneCible, COL_NB.EMAIL).setValue(info.email);
  feuille.getRange(ligneCible, COL_NB.ADRESSE).setValue(info.adresse);
  feuille.getRange(ligneCible, COL_NB.CODE_POSTAL).setValue(info.codePostal);
  feuille.getRange(ligneCible, COL_NB.BETHEL_NUMBER).setValue(numero);
  feuille.getRange(ligneCible, COL_NB.BETHEL_ID).setValue(bethelIdFinal);
  feuille.getRange(ligneCible, COL_NB.BETHEL_ZONE).setValue(zoneCode);
  feuille.getRange(ligneCible, COL_NB.DAY_OF_BETHEL).setValue('Dimanche');
  feuille.getRange(ligneCible, COL_NB.TIME).setValue('8:00');
  feuille.getRange(ligneCible, COL_NB.ROLE).setValue('Bethel Leader');
  feuille.getRange(ligneCible, COL_NB.BETHEL_MEMBRE).setValue(info.prenom + ' ' + info.nom);
  feuille.getRange(ligneCible, COL_NB.ANANIAS).setValue(ananias);
  feuille.getRange(ligneCible, COL_NB.BETHEL_LEADER).setValue(info.prenom + ' ' + info.nom);
  feuille.getRange(ligneCible, COL_NB.OVERSEER).setValue(overseer);
  feuille.getRange(ligneCible, COL_NB.MINISTRE_ORDONNE).setValue(ministre);
  feuille.getRange(ligneCible, COL_NB.ASSISTANT_PASTEUR).setValue(assistantPasteur);
  feuille.getRange(ligneCible, COL_NB.PASTEUR).setValue(pasteur);
  feuille.getRange(ligneCible, COL_NB.STATUS).setValue('Active');

  // Reporte la chaîne dans "Zones Géographiques" pour que les prochains
  // arrivants dans cette zone en héritent automatiquement (sans écraser des
  // valeurs déjà présentes).
  remplirChaineZonesGeographiques(fsa, bethelIdFinal, ananias, overseer, ministre, assistantPasteur, pasteur);

  return {
    succes: true,
    message: '✅ ' + info.prenom + ' ' + info.nom + ' intégré(e) dans ' + nomOnglet
      + ' comme Bethel Leader (' + bethelIdFinal + ', zone ' + fsa + '), avec sa chaîne de '
      + 'supervision reprise du vieux fichier. La zone ' + fsa + ' a été mise à jour dans '
      + '"Zones Géographiques" pour les prochains arrivants.'
  };
}

// Remplit (sans écraser) les colonnes Overseer / Ministre Ordonné /
// Assistant Pasteur / Pasteur de l'onglet "Zones Géographiques" pour le FSA
// donné -- et le BETHEL ID si la case était vide.
function remplirChaineZonesGeographiques(fsa, bethelId, ananias, overseer, ministre, assistantPasteur, pasteur) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var feuille = ss.getSheetByName(NOM_ONGLET_ZONES_NB);
  if (!feuille) return;
  var derniereLigne = feuille.getLastRow();
  if (derniereLigne < 2) return;
  var donnees = feuille.getRange(2, 1, derniereLigne - 1, 7).getValues();
  for (var i = 0; i < donnees.length; i++) {
    var fsaLigne = (donnees[i][0] || '').toString().trim().toUpperCase();
    if (fsaLigne !== fsa) continue;
    var r = i + 2;
    if (!donnees[i][2]) feuille.getRange(r, 3).setValue(bethelId);          // BETHEL ID
    if (!donnees[i][3]) feuille.getRange(r, 4).setValue(overseer);          // Overseer
    if (!donnees[i][4]) feuille.getRange(r, 5).setValue(ministre);          // Ministre Ordonné
    if (!donnees[i][5]) feuille.getRange(r, 6).setValue(assistantPasteur);  // Assistant Pasteur
    if (!donnees[i][6]) feuille.getRange(r, 7).setValue(pasteur);           // Pasteur
  }
}

// -----------------------------------------------------------------------
// Bouton "Assigner Bethel selon zone (Oui/Non)" -- traite en lot toutes les
// lignes déjà présentes dans CE nouveau fichier qui ont un code postal mais
// pas encore de BETHEL ID (utile si des lignes ont été collées directement
// au lieu de passer par "Intégrer une personne").
// -----------------------------------------------------------------------
function assignerBethelSelonZoneNouveauBethel() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var villes = Object.keys(VILLE_VERS_ZONE_NB);
  var compteTraites = 0;

  villes.forEach(function(nomOnglet) {
    var feuille = ss.getSheetByName(nomOnglet);
    if (!feuille) return;
    var derniereLigne = feuille.getLastRow();
    if (derniereLigne < 2) return;
    var valeurs = feuille.getRange(2, 1, derniereLigne - 1, COL_NB.DISPO_HEBERGER).getValues();
    for (var i = 0; i < valeurs.length; i++) {
      var prenom = (valeurs[i][COL_NB.PRENOM - 1] || '').toString().trim();
      var bidActuel = (valeurs[i][COL_NB.BETHEL_ID - 1] || '').toString().trim();
      var cp = (valeurs[i][COL_NB.CODE_POSTAL - 1] || '').toString().trim();
      if (!prenom || bidActuel || !cp) continue;

      var infoLigne = {
        ville: nomOnglet, prenom: prenom, nom: (valeurs[i][COL_NB.NOM - 1] || '').toString().trim(),
        telephone: valeurs[i][COL_NB.TELEPHONE - 1], email: valeurs[i][COL_NB.EMAIL - 1],
        adresse: valeurs[i][COL_NB.ADRESSE - 1], codePostal: cp,
        aDitOui: (valeurs[i][COL_NB.DISPO_HEBERGER - 1] || '').toString().indexOf('Oui') !== -1
      };
      // Supprime la ligne brute avant de la ré-écrire proprement via placerPersonneSelonZone
      feuille.deleteRow(i + 2);
      placerPersonneSelonZone(infoLigne);
      compteTraites++;
      break; // les lignes ont bougé, on recommence la boucle pour cet onglet à la prochaine passe
    }
  });

  ui.alert(compteTraites > 0
    ? '✅ ' + compteTraites + ' ligne(s) traitée(s). Relance le bouton si le résumé affiche encore des lignes en attente.'
    : 'Rien à traiter -- aucune ligne avec un code postal mais sans BETHEL ID.');
}
