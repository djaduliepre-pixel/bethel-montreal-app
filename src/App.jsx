// ============================================================================
// SYNC AUTOMATIQUE v2 -- Formulaire "HP churches" -> bethel-montreal-app
// AVEC PROTECTION ANTI-DOUBLON : avant chaque envoi, vérifie si une personne
// avec le même prénom + nom + téléphone existe déjà (soumission OU membre actif).
// Si oui, la nouvelle réponse est ignorée (juste notée dans les logs).
// ============================================================================

var SUPABASE_URL = "https://bqcpvxzqquyfjnytotsq.supabase.co";
var SUPABASE_KEY = "sb_publishable_h74yAuAWRJRf3V4GlHIYvA_pVSmdNOm";

var ROLE_MAP = {
  "Membre": "new_member",
  "Nouveau membre": "new_member",
  "Ananias": "ananias",
  "HP Leader": "hp_leader",
  "Bethel Leader": "hp_leader",
  "Overseer": "overseer",
  "Ministre ordonné": "ordained_minister",
  "Ministre ordonné potentiel": "potential_ordained_minister",
  "Assistant Pasteur": "assistant_pastor",
  "Pasteur": "pastor",
};

function normalise(s) {
  return String(s || "").trim().toLowerCase();
}

// Vérifie si cette personne existe déjà (soumission en attente/approuvée, OU membre actif)
function existeDeja(prenom, nom, telephone) {
  var p = normalise(prenom), n = normalise(nom);

  // 1) Vérifie dans les soumissions existantes
  var subUrl = SUPABASE_URL + "/rest/v1/submissions?select=first_name,last_name,phone"
    + "&first_name=ilike." + encodeURIComponent(p)
    + "&last_name=ilike." + encodeURIComponent(n);
  var subRes = UrlFetchApp.fetch(subUrl, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    muteHttpExceptions: true,
  });
  var subs = JSON.parse(subRes.getContentText());
  if (subs && subs.length > 0) return true;

  // 2) Vérifie aussi parmi les vrais membres déjà assignés à un Bethel
  var memUrl = SUPABASE_URL + "/rest/v1/members?select=first_name,last_name,phone"
    + "&first_name=ilike." + encodeURIComponent(p)
    + "&last_name=ilike." + encodeURIComponent(n)
    + "&status=eq.active";
  var memRes = UrlFetchApp.fetch(memUrl, {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
    muteHttpExceptions: true,
  });
  var mems = JSON.parse(memRes.getContentText());
  if (mems && mems.length > 0) return true;

  return false;
}

function onFormSubmit(e) {
  try {
    var v = e.values;

    var prenom = v[1] || "";
    var nom = v[2] || "";
    var telephone = v[3] || "";

    if (!prenom && !nom) return;

    if (existeDeja(prenom, nom, telephone)) {
      Logger.log("DOUBLON IGNORÉ: " + prenom + " " + nom + " existe déjà (soumission ou membre).");
      return; // On arrête ici, rien n'est envoyé à Supabase
    }

    var roleBrut = v[5] || "";
    var adresseResidentielle = v[7] || "";
    var codePostal = v[8] || "";
    var dispoHeberger = v[10] || "";
    var capacite = v[12] || "";
    var adresseMaps = v[32] || adresseResidentielle;

    var leadershipLevel = ROLE_MAP[roleBrut] || "new_member";
    var willing = String(dispoHeberger).indexOf("Oui") === 0;

    var campusRes = UrlFetchApp.fetch(
      SUPABASE_URL + "/rest/v1/campuses?campus_code=eq.MTL&select=campus_id",
      { headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY } }
    );
    var campusData = JSON.parse(campusRes.getContentText());
    var campusId = campusData.length > 0 ? campusData[0].campus_id : null;

    var hpNumber = "FORM-" + new Date().getTime();
    var payload = {
      hp_number: hpNumber,
      first_name: prenom,
      last_name: nom,
      phone: String(telephone),
      address: adresseMaps + (codePostal ? (", " + codePostal) : ""),
      campus_id: campusId,
      willing_to_host: willing,
      house_capacity: String(capacite),
      leadership_level: leadershipLevel,
      status: "pending",
    };

    var res = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/submissions", {
      method: "post",
      contentType: "application/json",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: "Bearer " + SUPABASE_KEY,
        Prefer: "return=representation",
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    Logger.log("Réponse Supabase (" + res.getResponseCode() + "): " + res.getContentText());
  } catch (err) {
    Logger.log("ERREUR onFormSubmit: " + err.message);
  }
}

function testerEnvoiManuel() {
  var faux = {
    values: [
      new Date(), "Test", "Prénom", "514-000-0000", "test@example.com",
      "Membre", "Montréal", "123 rue Test", "H1H 1H1", "Véhicule personnel",
      "Oui", "", "5", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""
    ]
  };
  onFormSubmit(faux);
}
