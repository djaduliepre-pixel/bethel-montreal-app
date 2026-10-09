import React, { useState, useEffect, useMemo, useCallback } from "react";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import {
  Home, Inbox, Users, BarChart3, MapPin, Search, Check, X,
  ChevronRight, Phone, AlertCircle, Sparkles, Plus, RefreshCw,
  Edit2, ArrowRightLeft, Trash2, BookOpen, Network,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Connexion à la vraie base de données Supabase                      */
/* ------------------------------------------------------------------ */
const SUPABASE_URL = "https://bqcpvxzqquyfjnytotsq.supabase.co";
const SUPABASE_KEY = "sb_publishable_h74yAuAWRJRf3V4GlHIYvA_pVSmdNOm";

async function supaGet(table, query = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
  return res.json();
}

// Supabase impose un plafond serveur de 1000 lignes par requête, peu importe le
// "limit" demandé côté client -- cette fonction boucle avec Range/offset pour
// vraiment tout récupérer (utile pour les tables comme "members" qui dépassent 1000).
async function supaGetTout(table, query = "") {
  const TAILLE_PAGE = 1000;
  let tout = [];
  let debut = 0;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${debut}-${debut + TAILLE_PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
    const page = await res.json();
    tout = tout.concat(page);
    if (page.length < TAILLE_PAGE) break; // dernière page atteinte
    debut += TAILLE_PAGE;
  }
  return tout;
}

async function supaPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPatch(table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${table} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${fn} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaDelete(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`DELETE ${table} failed: ${res.status} ${await res.text()}`);
}

// Vérifie si une personne du même nom existe déjà (soumission OU membre actif).
// Retourne un message d'avertissement si un doublon probable est trouvé, sinon null.
async function verifierDoublon(firstName, lastName) {
  if (!firstName || !lastName) return null;
  const fn = encodeURIComponent(firstName.trim());
  const ln = encodeURIComponent(lastName.trim());
  try {
    const [subs, mems] = await Promise.all([
      supaGet("submissions", `first_name=ilike.${fn}&last_name=ilike.${ln}&select=hp_number,status`),
      supaGet("members", `first_name=ilike.${fn}&last_name=ilike.${ln}&status=eq.active&select=member_id,role`),
    ]);
    if (subs.length > 0) return `A submission already exists for ${firstName} ${lastName} (${subs[0].hp_number}, ${subs[0].status}).`;
    if (mems.length > 0) return `${firstName} ${lastName} is already an active member (role: ${mems[0].role}).`;
  } catch (e) {
    // En cas d'erreur réseau, on laisse passer plutôt que de bloquer l'utilisateur
    return null;
  }
  return null;
}

// Vérifie si un numéro de téléphone est déjà utilisé par une soumission ou un
// membre actif -- deux personnes différentes ont rarement le même numéro,
// donc un match ici est un signal fort de doublon (même si le nom diffère,
// p.ex. faute de frappe ou surnom).
async function verifierDoublonTelephone(phone) {
  const chiffres = (phone || "").replace(/\D/g, "");
  if (chiffres.length < 10) return null;
  const formate = `(${chiffres.slice(0, 3)}) ${chiffres.slice(3, 6)}-${chiffres.slice(6, 10)}`;
  const p = encodeURIComponent(formate);
  try {
    const [subs, mems] = await Promise.all([
      supaGet("submissions", `phone=eq.${p}&select=first_name,last_name,hp_number,status`),
      supaGet("members", `phone=eq.${p}&status=eq.active&select=member_id,first_name,last_name,role`),
    ]);
    if (mems.length > 0) return `Ce numéro est déjà utilisé par ${mems[0].first_name} ${mems[0].last_name} (membre actif, rôle : ${mems[0].role}).`;
    if (subs.length > 0) return `Ce numéro est déjà utilisé par une soumission existante : ${subs[0].first_name} ${subs[0].last_name} (${subs[0].hp_number}).`;
  } catch (e) {
    return null;
  }
  return null;
}

// Combine les deux vérifications (nom + téléphone) pour le panneau
// "Ajouter / retirer des membres". Retourne un tableau de messages (vide si
// aucun doublon probable détecté).
async function verifierDoublonsComplet(firstName, lastName, phone) {
  const [parNom, parTelephone] = await Promise.all([
    verifierDoublon(firstName, lastName),
    verifierDoublonTelephone(phone),
  ]);
  return [parNom, parTelephone].filter(Boolean);
}

const LEADERSHIP_LABELS = {
  new_member: "New member", ananias: "Ananias", hp_leader: "HP Leader",
  overseer: "Overseer", ordained_minister: "Ordained Minister",
  potential_ordained_minister: "Potential Ordained Minister", pastor: "Pastor",
};

/* ------------------------------------------------------------------ */
/* Google Maps -- calcul du temps de trajet (règle des 15 minutes)    */
/* ------------------------------------------------------------------ */
const GOOGLE_MAPS_KEY = "AIzaSyAVXR_SH01n033i6tpRnWsvSLv1I_iDlZE";
const LIMITE_MINUTES_PROXIMITE = 15;

let googleMapsLoadingPromise = null;
function loadGoogleMaps() {
  if (window.google && window.google.maps) return Promise.resolve();
  if (googleMapsLoadingPromise) return googleMapsLoadingPromise;
  googleMapsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
  return googleMapsLoadingPromise;
}

// Retire le texte "[Secteur: ...]" (ajouté par le formulaire pour garder une info
// utile à l'affichage) avant d'envoyer l'adresse à Google Maps -- ce texte entre
// crochets brise parfois la reconnaissance de l'adresse et fait échouer le calcul.
//
// Ajoute aussi ", Québec, Canada" quand l'adresse ne mentionne déjà aucun pays --
// beaucoup d'adresses en base sont courtes (ex: "6270 rue Pierre #12", sans ville
// ni province). Sans indice de pays, Google Maps peut géocoder ce genre d'adresse
// n'importe où dans le monde et renvoyer un temps de trajet absurde (ex: 386 min
// entre deux adresses de Montréal). Ce biais géographique force la recherche vers
// le Québec pour éviter ce genre de faux résultat.
function nettoyerAdressePourGoogleMaps(adresse) {
  let nettoyee = String(adresse || "").replace(/\s*\[Secteur:[^\]]*\]\s*/gi, "").trim();
  if (nettoyee && !/canada/i.test(nettoyee)) {
    nettoyee = `${nettoyee}, Canada`;
  }
  return nettoyee;
}

async function getDrivingMinutes(originAddress, destAddress) {
  await loadGoogleMaps();
  const origine = nettoyerAdressePourGoogleMaps(originAddress);
  const destination = nettoyerAdressePourGoogleMaps(destAddress);
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      { origins: [origine], destinations: [destination], travelMode: window.google.maps.TravelMode.DRIVING },
      (response, status) => {
        if (status !== "OK") { reject(new Error(status)); return; }
        const el = response.rows[0]?.elements[0];
        if (!el || el.status !== "OK") { reject(new Error(el?.status || "No route found")); return; }
        resolve(Math.round(el.duration.value / 60));
      }
    );
  });
}

/* ------------------------------------------------------------------ */
/* Petits blocs visuels                                               */
/* ------------------------------------------------------------------ */
function ZoneStamp({ code, muted }) {
  if (!code) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.04em",
      padding: "3px 8px", borderRadius: "3px",
      border: `1.5px dashed ${muted ? "var(--border)" : "var(--plum)"}`,
      color: muted ? "var(--ink-muted)" : "var(--plum)",
      transform: "rotate(-1deg)",
      background: muted ? "transparent" : "rgba(107,42,62,0.05)",
    }}>
      {code}
    </span>
  );
}

function StatusPill({ status }) {
  const map = {
    pending: { bg: "rgba(184,134,59,0.14)", fg: "var(--gold)", label: "Pending" },
    approved: { bg: "rgba(31,92,78,0.14)", fg: "var(--teal)", label: "Activated" },
    active: { bg: "rgba(31,92,78,0.14)", fg: "var(--teal)", label: "Active" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: "11.5px", fontWeight: 600,
      padding: "3px 10px", borderRadius: "999px", letterSpacing: "0.02em",
    }}>
      {s.label}
    </span>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px",
      padding: "20px 22px", flex: "1 1 160px", minWidth: "160px",
    }}>
      <div style={{ fontSize: "12px", color: "var(--ink-muted)", fontWeight: 600, letterSpacing: "0.03em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "34px", color: accent || "var(--ink)", marginTop: "6px", lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "6px" }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : Activer un Bethel                                        */
/* ------------------------------------------------------------------ */
// Table de correspondance code postal (FSA) -> nom de zone officielle, pour suggérer
// automatiquement la bonne zone plutôt que de se fier uniquement au texte "Montréal".
const ZONE_PAR_FSA = {
  'H1G':'Montreal Montréal-Nord','H1H':'Montreal Montréal-Nord',
  'H1J':'Montreal Anjou','H1K':'Montreal Anjou',
  'H1A':'Montreal Pointe-aux-Trembles (PAT)',
  'H1B':'Montreal Pointe-aux-Trembles (PAT)',
  'H1C':'Montreal Rivière-des-Prairies (RDP)',
  'H1E':'Montreal Rivière-des-Prairies (RDP)',
  'H1L':'Montreal Mercier–Hochelaga-Maisonneuve','H1M':'Montreal Mercier–Hochelaga-Maisonneuve',
  'H1N':'Montreal Mercier–Hochelaga-Maisonneuve','H1V':'Montreal Mercier–Hochelaga-Maisonneuve',
  'H1W':'Montreal Mercier–Hochelaga-Maisonneuve',
  'H1X':'Montreal Rosemont–La Petite-Patrie',
  'H1Y':'Montreal Rosemont–La Petite-Patrie','H2G':'Montreal Rosemont–La Petite-Patrie','H2S':'Montreal Rosemont–La Petite-Patrie',
  'H1Z':'Montreal Saint-Michel','H2A':'Montreal Saint-Michel',
  'H2E':'Montreal Villeray','H2P':'Montreal Villeray','H2R':'Montreal Villeray',
  'H3N':'Montreal Parc-Extension',
  'H1P':'Montreal Saint-Léonard','H1R':'Montreal Saint-Léonard','H1S':'Montreal Saint-Léonard','H1T':'Montreal Saint-Léonard',
  'H2V':'Montreal Outremont',
  'H3S':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce','H3T':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce',
  'H3V':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce','H3W':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce',
  'H4A':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce','H4B':'Montreal Côte-des-Neiges–Notre-Dame-de-Grâce',
  'H2H':'Montreal Le Plateau-Mont-Royal','H2J':'Montreal Le Plateau-Mont-Royal',
  'H2K':'Montreal Le Plateau-Mont-Royal','H2L':'Montreal Le Plateau-Mont-Royal',
  'H2T':'Montreal Le Plateau-Mont-Royal','H2W':'Montreal Le Plateau-Mont-Royal',
  'H2Y':'Montreal Ville-Marie (Centre-ville)','H2Z':'Montreal Ville-Marie (Centre-ville)',
  'H3A':'Montreal Ville-Marie (Centre-ville)','H3B':'Montreal Ville-Marie (Centre-ville)',
  'H3C':'Montreal Ville-Marie (Centre-ville)','H3G':'Montreal Ville-Marie (Centre-ville)','H3H':'Montreal Ville-Marie (Centre-ville)',
  'H3J':'Montreal Le Sud-Ouest','H3K':'Montreal Le Sud-Ouest','H4C':'Montreal Le Sud-Ouest','H4E':'Montreal Le Sud-Ouest',
  'H8N':'Montreal LaSalle','H8P':'Montreal LaSalle','H8R':'Montreal LaSalle',
  'H8S':'Montreal Lachine','H8T':'Montreal Lachine',
  'H4L':'Montreal Saint-Laurent','H4M':'Montreal Saint-Laurent','H4N':'Montreal Saint-Laurent','H4R':'Montreal Saint-Laurent',
  'H2C':'Montreal Ahuntsic-Cartierville','H2M':'Montreal Ahuntsic-Cartierville','H2B':'Montreal Ahuntsic-Cartierville','H2N':'Montreal Ahuntsic-Cartierville',
  'H3L':'Montreal Ahuntsic-Cartierville','H3M':'Montreal Ahuntsic-Cartierville',
  'H4J':'Montreal Ahuntsic-Cartierville','H4K':'Montreal Ahuntsic-Cartierville',
  'H3E':'Montreal Verdun','H4G':'Montreal Verdun','H4H':'Montreal Verdun',
  'H8Y':'Montreal Pierrefonds-Roxboro','H8Z':'Montreal Pierrefonds-Roxboro',
  'H9A':'Montreal Pierrefonds-Roxboro','H9H':'Montreal Pierrefonds-Roxboro',
  'H9J':'Montreal Pierrefonds-Roxboro','H9K':'Montreal Pierrefonds-Roxboro',
  'H9C':"Montreal L'Île-Bizard–Sainte-Geneviève",'H9E':"Montreal L'Île-Bizard–Sainte-Geneviève",
  'H9B':'Montreal Dorval / West Island','H9P':'Montreal Dorval / West Island',
  'H9R':'Montreal Dorval / West Island','H9S':'Montreal Dorval / West Island',
  'H9W':'Montreal Dorval / West Island','H9X':'Montreal Dorval / West Island',
  'H7H':'Laval Auteuil','H7J':'Laval Auteuil','H7K':'Laval Auteuil',
  'H7M':'Laval Vimont','H7R':'Laval Laval-Ouest',
  'H7N':'Laval Pont-Viau','H7G':'Laval Pont-Viau',
  'H7S':'Laval Chomedey','H7T':'Laval Chomedey','H7V':'Laval Chomedey','H7W':'Laval Chomedey',
  'H7P':'Laval Fabreville', // ajouté le 6 sept. 2026, secteur absent avant
  'H7C':'Laval Duvernay', // ajouté le 6 sept. 2026, secteur absent avant (Duvernay/Saint-Vincent-de-Paul)
  'J5Y':'Repentigny Repentigny','J6A':'Repentigny Repentigny','J5Z':'Repentigny Repentigny',
  'J5W':'L\'Épiphanie L\'Épiphanie', // corrigé le 15 sept. 2026 -- zone dédiée existante, plus besoin d'approximer vers Repentigny
  'J6X':'Terrebonne Terrebonne','J6Y':'Terrebonne Terrebonne','J6V':'Terrebonne Terrebonne','J6W':'Terrebonne Terrebonne','J7M':'Terrebonne Terrebonne',
  'J7K':'Mascouche Mascouche','J7L':'Mascouche Mascouche',
  'J6E':'Saint-Charles-Borromée Saint-Charles-Borromée', // corrigé le 7 sept. 2026 -- zone dédiée créée, plus besoin d'approximer vers Repentigny
  'J6N':'Beauharnois Beauharnois', // Beauharnois -- corrigé le 4 sept. 2026, PAS Laval comme deviné avant
  'J6Z':'Lorraine Lorraine', // Lorraine (Laurentides), pas Terrebonne comme deviné plus tôt
  'J6':'Terrebonne Terrebonne', // repli large pour tout le reste de la famille J6 (Lanaudière)
  'G8':'Trois-Rivières Trois-Rivières','G9':'Trois-Rivières Trois-Rivières',
  'G0X':'Trois-Rivières Shawinigan',
  'G1V':'Région Sainte-Foy–Sillery–Cap-Rouge','G1W':'Région Sainte-Foy–Sillery–Cap-Rouge',
  'G1S':'Région Sainte-Foy–Sillery–Cap-Rouge','G1T':'Région Sainte-Foy–Sillery–Cap-Rouge',
  'G1K':'Région La Cité-Limoilou','G1L':'Région La Cité-Limoilou','G1J':'Région La Cité-Limoilou',
  'G1N':'Région Les Rivières','G1P':'Région Les Rivières','G1G':'Région Les Rivières','G1H':'Région Les Rivières',
  'G1C':'Région Beauport','G1E':'Région Beauport',
  'G2A':'Région Charlesbourg','G2B':'Région Charlesbourg','G2C':'Région Charlesbourg','G2N':'Région Charlesbourg',
  'J1E':'Sherbrooke Fleurimont','J1G':'Sherbrooke Fleurimont','J1H':'Sherbrooke Mont-Bellevue',
  'J1J':'Sherbrooke Jacques-Cartier','J1K':'Sherbrooke Lennoxville','J1L':'Sherbrooke Rock Forest–Saint-Élie–Deauville',
  'J1N':'Sherbrooke Brompton','J1C':'Sherbrooke Fleurimont',
  // Régions rurales du Québec sans zone d\u00e9taill\u00e9e -- rep\u00e8re g\u00e9n\u00e9ral seulement
  'G6':'Repentigny Repentigny', // Bellechasse/Lévis, direction générale la plus proche
  'J8':'Sherbrooke Fleurimont', 'J9':'Sherbrooke Fleurimont',
  'J0':'Repentigny Repentigny', // codes ruraux J0xxxx, très variés -- vérifier manuellement
  // Winnipeg / Manitoba
  'R5H':'Ste. Anne Ste. Anne',
  'R2K':'Winnipeg North Kildonan','R2G':'Winnipeg North End','R2W':'Winnipeg North End',
  'R3C':'Winnipeg City Centre (Centre-ville)','R3B':'Winnipeg City Centre (Centre-ville)',
  'R2H':'Winnipeg St. Boniface (secteur francophone)','R2M':'Winnipeg St. Boniface (secteur francophone)',
  'R2M2':'Winnipeg St. Vital','R3T':'Winnipeg Fort Garry','R3M':'Winnipeg River Heights',
  'R3J':'Winnipeg St. James-Assiniboia','R3G':'Winnipeg West End','R2C':'Winnipeg Transcona',
  'R':'Manitoba (hors Winnipeg)', // repli très large pour tout le Manitoba non couvert ci-dessus
  // New-Brunswick
  'E1A':'New-Brunswick Moncton','E1C':'New-Brunswick Moncton','E1G':'New-Brunswick Dieppe',
  'E1B':'New-Brunswick Riverview','E3B':'New-Brunswick Fredericton','E2L':'New-Brunswick Saint John',
  'E3L':'New-Brunswick Edmundston','E':'New-Brunswick Moncton', // repli large
  // Alberta
  'T2P':'Alberta Calgary Downtown','T2G':'Alberta Calgary Downtown','T2E':'Alberta Calgary Nord-Est',
  'T2A':'Alberta Calgary Sud-Est','T2J':'Alberta Calgary Sud-Est','T2V':'Alberta Calgary Sud-Ouest',
  'T2W':'Alberta Calgary Sud-Ouest','T5J':'Alberta Edmonton Downtown','T6L':'Alberta Mill Woods',
  'T5T':'Alberta West Edmonton','T8N':'Alberta St. Albert','T':'Alberta Calgary Downtown', // repli large
};

function suggererZoneDepuisAdresse(adresse) {
  if (!adresse) return null;
  const m = adresse.match(/([A-Za-z]\d[A-Za-z])\s?\d[A-Za-z]\d/);
  if (!m) return null;
  const fsa = m[1].toUpperCase();
  // Essaie du plus précis (3 caractères) au moins précis (1re lettre = province)
  return ZONE_PAR_FSA[fsa] || ZONE_PAR_FSA[fsa.slice(0, 2)] || ZONE_PAR_FSA[fsa.slice(0, 1)] || null;
}

function ActivateModal({ submission, zones, onClose, onActivate, activating }) {
  const [query, setQuery] = useState("");
  const [selectedZone, setSelectedZone] = useState(null);
  const [checklist, setChecklist] = useState({
    propre: false, prive: false, capacite: false, places: false, tv: false, internetElec: false,
  });
  const [rappelOuvert, setRappelOuvert] = useState(false);
  const CHECKLIST_ITEMS = [
    { key: "propre", label: "Le lieu est propre et bien entretenu" },
    { key: "prive", label: "Ce n'est pas un espace intime (pas une chambre, une salle de bain ou une cuisine)" },
    { key: "capacite", label: "Peut accueillir confortablement au moins 4 personnes" },
    { key: "places", label: "Places assises pour au moins 4 personnes" },
    { key: "tv", label: "Télévision disponible" },
    { key: "internetElec", label: "Internet et électricité disponibles" },
  ];
  const checklistComplete = Object.values(checklist).every(Boolean);

  const matches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return zones.filter((z) => z.zone_name.toLowerCase().includes(q) || z.city_name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, zones]);

  const nomZoneSuggeree = useMemo(() => suggererZoneDepuisAdresse(submission.address), [submission.address]);
  const zoneSuggeree = useMemo(
    () => (nomZoneSuggeree ? zones.find((z) => z.zone_name === nomZoneSuggeree) : null),
    [nomZoneSuggeree, zones]
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "440px", maxWidth: "100%",
        padding: "28px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: 0, color: "var(--ink)" }}>
              Activate Bethel
            </h2>
            <div style={{ fontSize: "13px", color: "var(--ink-muted)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
              {submission.hp_number} · {submission.first_name} {submission.last_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{
          marginTop: "18px", display: "flex", gap: "8px", alignItems: "flex-start",
          background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
        }}>
          <MapPin size={16} color="var(--ink-muted)" style={{ marginTop: "2px", flexShrink: 0 }} />
          <span style={{ fontSize: "13.5px", color: "var(--ink)", lineHeight: 1.4 }}>{submission.address}</span>
        </div>

        <button
          onClick={() => setRappelOuvert(!rappelOuvert)}
          style={{
            display: "flex", alignItems: "center", gap: "5px", marginTop: "10px", background: "none",
            border: "none", cursor: "pointer", color: "var(--plum)", fontSize: "12px", fontWeight: 600, padding: 0,
          }}
        >
          <ChevronRight size={12} style={{ transform: rappelOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
          Approval process reminder
        </button>
        {rappelOuvert && (
          <ol style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "12px", color: "var(--ink-muted)", lineHeight: 1.9 }}>
            <li>Click on the person's name (already done)</li>
            <li>Call the person for an interview</li>
            <li>Congratulate them for this beautiful decision</li>
            <li>Ask a few questions about the home</li>
            <li>Those questions are the checklist below</li>
            <li>Do a home visit to confirm before activating</li>
          </ol>
        )}

        <div style={{ marginTop: "18px" }}>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>
            Zone <span style={{ color: "var(--brick)" }}>*</span>
          </label>
          <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px", marginBottom: "8px" }}>
            Match the zone to the address above. Type to search.
          </div>

          {zoneSuggeree && !selectedZone && (
            <button
              onClick={() => { setSelectedZone(zoneSuggeree); setQuery(""); }}
              style={{
                display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left",
                padding: "9px 12px", marginBottom: "10px", borderRadius: "8px", cursor: "pointer",
                border: "1.5px solid var(--teal)", background: "rgba(31,92,78,0.06)", fontFamily: "var(--font-body)",
              }}
            >
              <Sparkles size={14} color="var(--teal)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: "12.5px", color: "var(--teal)" }}>
                Suggested from postal code: <strong>{zoneSuggeree.zone_name}</strong> — click to use
              </span>
            </button>
          )}

          <div style={{ position: "relative" }}>
            <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedZone(null); }}
              placeholder="Type a neighborhood or city…"
              style={{
                width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 32px",
                border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px",
                fontFamily: "var(--font-body)", outline: "none",
              }}
            />
          </div>

          {selectedZone ? (
            <div style={{
              marginTop: "10px", display: "flex", alignItems: "center", justifyContent: "space-between",
              border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ZoneStamp code={selectedZone.zone_code} />
                <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>
                  {selectedZone.zone_name} <span style={{ color: "var(--ink-muted)" }}>· {selectedZone.city_name}</span>
                </span>
              </div>
              <button onClick={() => setSelectedZone(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}>
                <X size={15} />
              </button>
            </div>
          ) : matches.length > 0 ? (
            <div style={{ marginTop: "8px", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
              {matches.map((z) => (
                <button key={z.zone_id} onClick={() => { setSelectedZone(z); setQuery(""); }} style={{
                  display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between",
                  padding: "9px 12px", border: "none", borderBottom: "1px solid var(--border)",
                  background: "var(--surface)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)",
                }}>
                  <span style={{ fontSize: "13px", color: "var(--ink)" }}>
                    {z.zone_name} <span style={{ color: "var(--ink-muted)" }}>· {z.city_name}</span>
                  </span>
                  <ChevronRight size={14} color="var(--ink-muted)" />
                </button>
              ))}
            </div>
          ) : query.trim().length >= 2 ? (
            <div style={{
              marginTop: "10px", display: "flex", gap: "8px", fontSize: "12.5px", color: "var(--brick)",
              background: "rgba(162,59,51,0.08)", borderRadius: "8px", padding: "10px 12px",
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: "1px" }} />
              <span>No zone matches "{query}" in your data_zones table yet.</span>
            </div>
          ) : null}
        </div>

        {selectedZone && (
          <div style={{ marginTop: "18px" }}>
            <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>
              Liste de vérification <span style={{ color: "var(--brick)" }}>*</span>
            </label>
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "2px", marginBottom: "8px" }}>
              Confirme chaque point avant d'activer.
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "4px 12px", background: "var(--bg)" }}>
              {CHECKLIST_ITEMS.map((item, i) => (
                <label key={item.key} style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "9px 0",
                  borderBottom: i < CHECKLIST_ITEMS.length - 1 ? "1px solid var(--border)" : "none",
                  cursor: "pointer", fontSize: "13px", color: "var(--ink)",
                }}>
                  <input
                    type="checkbox"
                    checked={checklist[item.key]}
                    onChange={(e) => setChecklist((c) => ({ ...c, [item.key]: e.target.checked }))}
                    style={{ width: "16px", height: "16px", flexShrink: 0, accentColor: "var(--teal)" }}
                  />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedZone && checklistComplete && (
          <div style={{
            marginTop: "14px", fontSize: "12px", color: "var(--gold)", background: "rgba(184,134,59,0.10)",
            borderRadius: "8px", padding: "10px 12px",
          }}>
            This will insert a new row in your real "bethels" table (Supabase) and mark this submission as approved.
          </div>
        )}

        <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button onClick={onClose} style={{
            padding: "9px 16px", borderRadius: "8px", border: "1px solid var(--border)",
            background: "var(--surface)", color: "var(--ink)", fontSize: "13.5px", cursor: "pointer",
          }}>
            Cancel
          </button>
          <button
            disabled={!selectedZone || !checklistComplete || activating}
            onClick={() => selectedZone && checklistComplete && onActivate(submission, selectedZone)}
            style={{
              padding: "9px 18px", borderRadius: "8px", border: "none",
              background: (selectedZone && checklistComplete) ? "var(--plum)" : "var(--border)",
              color: (selectedZone && checklistComplete) ? "#fff" : "var(--ink-muted)",
              fontSize: "13.5px", fontWeight: 600, cursor: (selectedZone && checklistComplete && !activating) ? "pointer" : "not-allowed",
            }}
          >
            {activating ? "Activating…" : "Activate Bethel"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : Assigner à un Bethel existant (pour ceux qui ont dit "Non")*/
/* ------------------------------------------------------------------ */
function AssignMemberModal({ submission, zones, bethels, onClose, onAssign, assigning }) {
  const [zoneQuery, setZoneQuery] = useState("");
  const [selectedZone, setSelectedZone] = useState(null);
  const [candidates, setCandidates] = useState([]); // [{bethel, minutes|null, error|null}]
  const supervisionParBethel = useSupervisionParBethel();
  const nbMembresParBethel = useNombreMembresParBethel();
  const [loadingDistances, setLoadingDistances] = useState(false);
  const [selectedBethel, setSelectedBethel] = useState(null);

  const zoneMatches = useMemo(() => {
    if (zoneQuery.trim().length < 2) return [];
    const q = zoneQuery.trim().toLowerCase();
    return zones.filter((z) => z.zone_name.toLowerCase().includes(q) || z.city_name.toLowerCase().includes(q)).slice(0, 8);
  }, [zoneQuery, zones]);

  const nomZoneSuggeree = useMemo(() => suggererZoneDepuisAdresse(submission.address), [submission.address]);
  const zoneSuggeree = useMemo(
    () => (nomZoneSuggeree ? zones.find((z) => z.zone_name === nomZoneSuggeree) : null),
    [nomZoneSuggeree, zones]
  );

  async function pickZone(z) {
    setSelectedZone(z);
    setZoneQuery("");
    setSelectedBethel(null);
    // On ne limite plus aux Bethels de CETTE zone précise -- on cherche parmi
    // TOUS les Bethels actifs avec une adresse, et on garde les plus proches
    // en vrai temps de trajet, peu importe leur étiquette de zone.
    var candidatsPossibles = bethels.filter((b) => b.address);
    setCandidates(candidatsPossibles.map((b) => ({ bethel: b, minutes: null, error: null })));

    if (submission.address && candidatsPossibles.length > 0) {
      setLoadingDistances(true);
      var results = await Promise.all(candidatsPossibles.map(async (b) => {
        try {
          var minutes = await getDrivingMinutes(submission.address, b.address);
          return { bethel: b, minutes: minutes, error: null };
        } catch (e) {
          return { bethel: b, minutes: null, error: e.message };
        }
      }));
      results.sort((a, b) => {
        if (a.minutes == null) return 1;
        if (b.minutes == null) return -1;
        return a.minutes - b.minutes;
      });
      setCandidates(results.slice(0, 20)); // garde les 20 plus proches, peu importe la zone
      setLoadingDistances(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "480px", maxWidth: "100%",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        padding: "28px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: 0, color: "var(--ink)" }}>
              Assign to a Bethel
            </h2>
            <div style={{ fontSize: "13px", color: "var(--ink-muted)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>
              {submission.hp_number} · {submission.first_name} {submission.last_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        {submission.address && (
          <div style={{
            marginTop: "14px", display: "flex", gap: "8px", alignItems: "flex-start",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
          }}>
            <MapPin size={16} color="var(--ink-muted)" style={{ marginTop: "2px", flexShrink: 0 }} />
            <span style={{ fontSize: "13.5px", color: "var(--ink)", lineHeight: 1.4 }}>{submission.address}</span>
          </div>
        )}

        <div style={{ marginTop: "16px", overflowY: "auto", flex: 1 }}>
          <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>
            Step 1 — Zone <span style={{ color: "var(--brick)" }}>*</span>
          </label>

          {selectedZone ? (
            <div style={{
              marginTop: "8px", display: "flex", alignItems: "center", justifyContent: "space-between",
              border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <ZoneStamp code={selectedZone.zone_code} />
                <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>{selectedZone.zone_name}</span>
              </div>
              <button onClick={() => { setSelectedZone(null); setCandidates([]); setSelectedBethel(null); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              {zoneSuggeree && (
                <button
                  onClick={() => pickZone(zoneSuggeree)}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left",
                    padding: "9px 12px", marginTop: "8px", borderRadius: "8px", cursor: "pointer",
                    border: "1.5px solid var(--teal)", background: "rgba(31,92,78,0.06)", fontFamily: "var(--font-body)",
                  }}
                >
                  <Sparkles size={14} color="var(--teal)" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: "12.5px", color: "var(--teal)" }}>
                    Suggested from postal code: <strong>{zoneSuggeree.zone_name}</strong> — click to use
                  </span>
                </button>
              )}
              <div style={{ position: "relative", marginTop: "8px" }}>
                <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
                <input
                  value={zoneQuery}
                  onChange={(e) => setZoneQuery(e.target.value)}
                  placeholder="Type a neighborhood or city…"
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 32px",
                    border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", outline: "none",
                  }}
                />
                {zoneMatches.length > 0 && (
                  <div style={{ marginTop: "6px", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden" }}>
                  {zoneMatches.map((z) => (
                    <button key={z.zone_id} onClick={() => pickZone(z)} style={{
                      display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 12px", border: "none", borderBottom: "1px solid var(--border)",
                      background: "var(--surface)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)",
                    }}>
                      <span style={{ fontSize: "13px", color: "var(--ink)" }}>{z.zone_name} <span style={{ color: "var(--ink-muted)" }}>· {z.city_name}</span></span>
                      <ChevronRight size={14} color="var(--ink-muted)" />
                    </button>
                  ))}
                </div>
              )}
              </div>
            </>
          )}

          {selectedZone && (
            <>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", marginTop: "18px", display: "block" }}>
                Step 2 — Choose a Bethel {loadingDistances && <span style={{ fontWeight: 400, color: "var(--ink-muted)" }}>(checking travel times…)</span>}
              </label>
              <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "2px" }}>
                Showing the closest Bethels overall, not limited to this zone's label.
              </div>
              {!loadingDistances && candidates.length > 0 && (() => {
                const meilleurTemps = candidates.reduce((min, c) => (c.minutes != null && c.minutes < min ? c.minutes : min), Infinity);
                if (meilleurTemps === Infinity || meilleurTemps <= LIMITE_MINUTES_PROXIMITE) return null;
                return (
                  <div style={{
                    marginTop: "10px", padding: "10px 12px", borderRadius: "8px",
                    background: "rgba(184,134,59,0.10)", border: "1px solid rgba(184,134,59,0.3)",
                    fontSize: "12.5px", color: "var(--ink)", lineHeight: 1.5,
                  }}>
                    ⚠️ No Bethel within {LIMITE_MINUTES_PROXIMITE} min was found (closest is {meilleurTemps} min).
                    Consider whether <strong>{submission.first_name} {submission.last_name}</strong> might be a good
                    candidate to host their own new Bethel instead, rather than assigning to a distant group.
                  </div>
                );
              })()}
              {candidates.length === 0 && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>No active Bethels with an address found.</div>
              )}
              <div style={{ marginTop: "8px" }}>
                {candidates.map((c) => (
                  <button
                    key={c.bethel.bethel_id}
                    onClick={() => setSelectedBethel(c.bethel)}
                    style={{
                      display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 12px", marginBottom: "6px", borderRadius: "8px", textAlign: "left", cursor: "pointer",
                      border: selectedBethel?.bethel_id === c.bethel.bethel_id ? "2px solid var(--plum)" : "1px solid var(--border)",
                      background: "var(--surface)", fontFamily: "var(--font-body)",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{c.bethel.leader_name}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>{c.bethel.hp_number}</div>
                      <LigneSupervisionBethel rows={supervisionParBethel[c.bethel.bethel_id]} nbMembres={nbMembresParBethel ? (nbMembresParBethel[c.bethel.bethel_id] || 0) : null} />
                    </div>
                    {c.minutes != null ? (
                      <span style={{
                        fontSize: "11.5px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                        background: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "rgba(31,92,78,0.10)" : "rgba(184,134,59,0.12)",
                        color: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "var(--teal)" : "var(--gold)",
                      }}>
                        🚗 {c.minutes} min
                      </span>
                    ) : c.error ? (
                      <span style={{ fontSize: "11px", color: "var(--ink-muted)" }}>{c.error}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end", gap: "10px", flexShrink: 0 }}>
          <button onClick={onClose} style={{
            padding: "9px 16px", borderRadius: "8px", border: "1px solid var(--border)",
            background: "var(--surface)", color: "var(--ink)", fontSize: "13.5px", cursor: "pointer",
          }}>
            Cancel
          </button>
          <button
            disabled={!selectedBethel || assigning}
            onClick={() => selectedBethel && onAssign(submission, selectedBethel)}
            style={{
              padding: "9px 18px", borderRadius: "8px", border: "none",
              background: selectedBethel ? "var(--plum)" : "var(--border)",
              color: selectedBethel ? "#fff" : "var(--ink-muted)",
              fontSize: "13.5px", fontWeight: 600, cursor: selectedBethel && !assigning ? "pointer" : "not-allowed",
            }}
          >
            {assigning ? "Assigning…" : "Assign as member"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : Nouvelle soumission (pour tester sans SQL)                */
/* ------------------------------------------------------------------ */
function NewSubmissionModal({ campusId, onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", address: "", city: "", postal_code: "",
    willing_to_host: "no", leadership_level: "new_member",
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.first_name || !form.last_name) return;
    setSaving(true);
    try {
      const avertissement = await verifierDoublon(form.first_name, form.last_name);
      if (avertissement && !window.confirm(`${avertissement}\n\nCreate this submission anyway?`)) {
        setSaving(false);
        return;
      }
      const hp = "SUB-" + Date.now().toString().slice(-6);
      const [row] = await supaPost("submissions", {
        hp_number: hp,
        first_name: form.first_name,
        last_name: form.last_name,
        phone: form.phone,
        address: [form.address, form.city, form.postal_code].filter(Boolean).join(", "),
        campus_id: campusId || CAMPUS_FIXE_ID,
        willing_to_host: form.willing_to_host === "yes",
        leadership_level: form.leadership_level,
        status: "pending",
      });
      onCreated(row);
    } catch (e) {
      alert("Error creating submission: " + e.message);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px", marginBottom: "10px",
    border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", fontFamily: "var(--font-body)",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "400px", maxWidth: "100%",
        padding: "28px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0 }}>New submission</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={18} /></button>
        </div>
        <input placeholder="First name" style={inputStyle} value={form.first_name} onChange={set("first_name")} />
        <input placeholder="Last name" style={inputStyle} value={form.last_name} onChange={set("last_name")} />
        <input placeholder="Phone" style={inputStyle} value={form.phone} onChange={set("phone")} />
        <input placeholder="Address" style={inputStyle} value={form.address} onChange={set("address")} />
        <input placeholder="City" style={inputStyle} value={form.city} onChange={set("city")} />
        <input placeholder="Postal code" style={inputStyle} value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: formaterCodePostal(e.target.value) }))} />
        <select style={inputStyle} value={form.willing_to_host} onChange={set("willing_to_host")}>
          <option value="no">Not willing to host</option>
          <option value="yes">Willing to host</option>
        </select>
        <select style={inputStyle} value={form.leadership_level} onChange={set("leadership_level")}>
          {Object.entries(LEADERSHIP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={submit} disabled={saving} style={{
          marginTop: "6px", width: "100%", padding: "10px", borderRadius: "8px", border: "none",
          background: "var(--plum)", color: "#fff", fontSize: "13.5px", fontWeight: 600, cursor: "pointer",
        }}>
          {saving ? "Saving…" : "Create submission"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vue : Ajouter / retirer des membres, avec placement automatique    */
/* par géolocalisation (adresse -> Bethel actif le plus proche).      */
/* ------------------------------------------------------------------ */
// Rôles capables de diriger leur propre Bethel (jamais un simple Membre --
// règle métier : "le membre est un bébé, il ne peut pas avoir de numéro de Bethel").
// Règle fixe : il n'existe qu'un seul campus, « TG Montreal ». Toute création de Bethel l'utilise.
const CAMPUS_FIXE_ID = "34b41e1d-3aef-46da-9d7d-8797fd110475";
const CAMPUS_FIXE_NOM = "TG Montreal";
const ROLES_PEUVENT_DIRIGER = ["Ananias", "Bethel Leader", "Overseer", "Ministre Ordonné"];

// Devine le prochain hp_number disponible pour un nouveau Bethel, avec le nom de
// ville écrit au complet (plus de code abrégé genre "RPT" ou de suffixe "-F") :
// "Bethel-Repentigny-000010". Le numéro est séquentiel PAR VILLE, sur 6 chiffres,
// pour que deux Bethels de la même ville se différencient clairement l'un de l'autre.
function suggererProchainHpNumber(cityName, bethelsTous) {
  const ville = (cityName || "").trim();
  if (!ville) return "";
  const villeEchappee = ville.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^Bethel-${villeEchappee}-(\\d+)$`, "i");
  let maxNum = 0;
  bethelsTous.forEach((b) => {
    if (!b.hp_number) return;
    const m = b.hp_number.match(regex);
    if (m) {
      const num = parseInt(m[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  const prochain = String(maxNum + 1).padStart(6, "0");
  return `Bethel-${ville}-${prochain}`;
}

function ManageMembersView({ bethels, onChanged }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", phone: "", email: "", gender: "", decision: "",
    address: "", postal_code: "", role: "Membre", willing_to_host: false,
  });
  const [candidates, setCandidates] = useState([]); // [{bethel, minutes|null, error|null}]
  const supervisionParBethel = useSupervisionParBethel();
  const nbMembresParBethel = useNombreMembresParBethel();
  const [loadingDistances, setLoadingDistances] = useState(false);
  const [selectedBethel, setSelectedBethel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [justAdded, setJustAdded] = useState(null);

  // Détection de doublon "en amont" : dès que le nom complet ou le téléphone
  // est saisi, on vérifie en base avant même de chercher un Bethel. Tant
  // qu'une alerte est active, la recherche de Bethel et l'ajout sont bloqués
  // -- sauf si le/la staff coche explicitement "ce n'est pas un doublon".
  const [doublonAlertes, setDoublonAlertes] = useState([]); // string[]
  const [verifiantDoublon, setVerifiantDoublon] = useState(false);
  const [ignorerDoublon, setIgnorerDoublon] = useState(false);

  // Proposition de nouveau Bethel (uniquement pertinente si le rôle peut diriger
  // ET a dit "oui" à héberger -- sinon on cherche simplement un Bethel existant).
  const [zoneProposee, setZoneProposee] = useState(null); // { zone_id, zone_name } déduite du Bethel actif le plus proche
  const [hpNumberPropose, setHpNumberPropose] = useState("");
  const [creantNouveauBethel, setCreantNouveauBethel] = useState(false);

  const peutDirigerEtDitOui = ROLES_PEUVENT_DIRIGER.includes(form.role) && form.willing_to_host;

  // Dès que le prénom+nom OU le téléphone changent, on revérifie en base
  // après un court délai (debounce) -- avant même que le staff clique sur
  // "Trouver le Bethel". Toute nouvelle modification du formulaire annule
  // l'autorisation "continuer quand même" précédente, pour éviter qu'elle
  // reste valide pour une personne différente.
  useEffect(() => {
    setIgnorerDoublon(false);
    const nomPret = form.first_name.trim().length >= 2 && form.last_name.trim().length >= 2;
    const telPret = form.phone.replace(/\D/g, "").length >= 10;
    if (!nomPret && !telPret) {
      setDoublonAlertes([]);
      return;
    }
    let annule = false;
    setVerifiantDoublon(true);
    const timer = setTimeout(async () => {
      const messages = await verifierDoublonsComplet(form.first_name, form.last_name, form.phone);
      if (!annule) {
        setDoublonAlertes(messages);
        setVerifiantDoublon(false);
      }
    }, 500);
    return () => { annule = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.first_name, form.last_name, form.phone]);

  const doublonBloquant = doublonAlertes.length > 0 && !ignorerDoublon;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "9px 10px", marginBottom: "10px",
    border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", fontFamily: "var(--font-body)",
  };

  // Étape 1 : dès que le nom + l'adresse sont saisis, on calcule le temps de
  // trajet réel jusqu'à TOUS les Bethels actifs qui ont une adresse (peu
  // importe leur étiquette de zone -- même logique que "Assign to a Bethel"),
  // et on trie du plus proche au plus loin.
  async function trouverBethel() {
    if (!form.address) return;
    setSelectedBethel(null);
    setJustAdded(null);
    setZoneProposee(null);
    setHpNumberPropose("");
    const candidatsPossibles = bethels.filter((b) => b.address);
    setCandidates(candidatsPossibles.map((b) => ({ bethel: b, minutes: null, error: null })));
    setLoadingDistances(true);
    try {
      const results = await Promise.all(candidatsPossibles.map(async (b) => {
        try {
          const minutes = await getDrivingMinutes(form.address, b.address);
          return { bethel: b, minutes, error: null };
        } catch (e) {
          return { bethel: b, minutes: null, error: e.message };
        }
      }));
      results.sort((a, b) => {
        if (a.minutes == null) return 1;
        if (b.minutes == null) return -1;
        return a.minutes - b.minutes;
      });
      const meilleurs = results.slice(0, 20);
      setCandidates(meilleurs);

      // La zone la plus plausible pour cette adresse = celle du Bethel actif le
      // plus proche (même méthode de vérification utilisée manuellement toute
      // cette session : le Bethel voisin le plus proche indique la vraie zone).
      const plusProcheAvecZone = meilleurs.find((c) => c.minutes != null && c.bethel.zone_id);
      if (plusProcheAvecZone) {
        const ville = plusProcheAvecZone.bethel.city_name || plusProcheAvecZone.bethel.zone_name;
        setZoneProposee({
          zone_id: plusProcheAvecZone.bethel.zone_id,
          zone_name: plusProcheAvecZone.bethel.zone_name,
          city_name: ville,
        });
        setHpNumberPropose(suggererProchainHpNumber(ville, bethels));
      }

      // Sélectionne automatiquement le plus proche s'il respecte la règle des 15 min
      // -- mais seulement pour un Membre simple, ou un leader qui n'a PAS dit "oui"
      // à héberger (donc pas candidat à diriger son propre nouveau Bethel).
      if (!peutDirigerEtDitOui) {
        const plusProche = meilleurs.find((c) => c.minutes != null);
        if (plusProche && plusProche.minutes <= LIMITE_MINUTES_PROXIMITE) {
          setSelectedBethel(plusProche.bethel);
        }
      }
    } finally {
      setLoadingDistances(false);
    }
  }

  // Pour un leader (Ananias/Bethel Leader/Overseer/Ministre) qui a dit "oui" à
  // héberger : au lieu de le rattacher à un Bethel existant, on lui crée SON
  // PROPRE Bethel, dans sa vraie zone, avec une rupture complète de tout ancien
  // groupe -- le modèle "membre hôte + Ananias envoyé" / "virage à 360°" déjà
  // utilisé manuellement cette session.
  async function creerNouveauBethelEtAjouter() {
    if (!form.first_name || !form.last_name || !zoneProposee || !hpNumberPropose.trim()) return;
    if (doublonBloquant) { alert("Un doublon probable a été détecté. Coche \"Ce n'est pas un doublon\" avant de continuer."); return; }
    setCreantNouveauBethel(true);
    try {
      const messages = await verifierDoublonsComplet(form.first_name, form.last_name, form.phone);
      if (messages.length > 0 && !window.confirm(`${messages.join("\n")}\n\nCréer quand même un nouveau Bethel pour cette personne ?`)) {
        setCreantNouveauBethel(false);
        return;
      }
      const nomComplet = `${form.first_name} ${form.last_name}`;
      const [nouveauBethel] = await supaPost("bethels", {
        hp_number: hpNumberPropose.trim(),
        campus_id: CAMPUS_FIXE_ID,
        zone_id: zoneProposee.zone_id,
        leader_name: nomComplet,
        leader_role: form.role,
        host_name: nomComplet,
        address: form.address,
        status: "active",
      });
      await supaPost("members", {
        first_name: form.first_name, last_name: form.last_name, phone: form.phone,
        email: form.email || null, gender: form.gender || null, decision: form.decision || null,
        address: form.address, postal_code: form.postal_code, role: form.role,
        willing_to_host: true, bethel_id: nouveauBethel.bethel_id, status: "active",
      });
      setJustAdded({
        name: nomComplet, bethel: nouveauBethel, nouveauBethelCree: true,
        details: {
          phone: form.phone, email: form.email, gender: form.gender, decision: form.decision,
          address: form.address, postal_code: form.postal_code, role: form.role, willing_to_host: true,
        },
      });
      setForm({ first_name: "", last_name: "", phone: "", email: "", gender: "", decision: "", address: "", postal_code: "", role: "Membre", willing_to_host: false });
      setCandidates([]);
      setSelectedBethel(null);
      setZoneProposee(null);
      setHpNumberPropose("");
      onChanged();
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      setCreantNouveauBethel(false);
    }
  }

  async function confirmerAjout() {
    if (!form.first_name || !form.last_name || !selectedBethel) return;
    if (doublonBloquant) { alert("Un doublon probable a été détecté. Coche \"Ce n'est pas un doublon\" avant de continuer."); return; }
    setSaving(true);
    try {
      const messages = await verifierDoublonsComplet(form.first_name, form.last_name, form.phone);
      if (messages.length > 0 && !window.confirm(`${messages.join("\n")}\n\nAjouter quand même ce membre ?`)) {
        setSaving(false);
        return;
      }
      await supaPost("members", {
        first_name: form.first_name, last_name: form.last_name, phone: form.phone,
        email: form.email || null, gender: form.gender || null, decision: form.decision || null,
        address: form.address, postal_code: form.postal_code, role: form.role,
        willing_to_host: form.willing_to_host, bethel_id: selectedBethel.bethel_id, status: "active",
      });
      setJustAdded({
        name: `${form.first_name} ${form.last_name}`, bethel: selectedBethel,
        details: {
          phone: form.phone, email: form.email, gender: form.gender, decision: form.decision,
          address: form.address, postal_code: form.postal_code, role: form.role, willing_to_host: form.willing_to_host,
        },
      });
      setForm({ first_name: "", last_name: "", phone: "", email: "", gender: "", decision: "", address: "", postal_code: "", role: "Membre", willing_to_host: false });
      setCandidates([]);
      setSelectedBethel(null);
      onChanged();
      if (results.length > 0) relancerRecherche(); // rafraîchit la liste du bas si elle est déjà affichée
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      setSaving(false);
    }
  }

  // Étape 2 (en bas de page) : rechercher / retirer un membre existant.
  async function relancerRecherche() {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    setSearching(true);
    try {
      const parNom = await supaGet(
        "members",
        `or=(first_name.ilike.*${encodeURIComponent(q)}*,last_name.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*)&status=eq.active&order=first_name.asc&limit=40`
      );
      setResults(parNom);
    } catch (e) {
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }

  useEffect(() => {
    const timer = setTimeout(relancerRecherche, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function retirerMembre(m) {
    if (!window.confirm(`Retirer ${m.first_name} ${m.last_name} de l'église ?`)) return;
    setBusyId(m.member_id);
    try {
      await supaDelete("members", `member_id=eq.${m.member_id}`);
      setResults((r) => r.filter((x) => x.member_id !== m.member_id));
      onChanged();
    } catch (e) {
      alert("Erreur : " + e.message);
    } finally {
      setBusyId(null);
    }
  }

  const bethelById = useMemo(() => Object.fromEntries(bethels.map((b) => [b.bethel_id, b])), [bethels]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Ajouter / retirer des membres</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px", maxWidth: "560px" }}>
        Ajoute une nouvelle personne avec son adresse : le système calcule le temps de trajet réel
        vers chaque Bethel actif et propose automatiquement le plus proche (règle des {LIMITE_MINUTES_PROXIMITE} min).
      </p>

      <div style={{
        border: "1px solid var(--border)", borderRadius: "14px", padding: "22px",
        background: "var(--surface)", maxWidth: "560px", marginBottom: "36px",
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
          <input placeholder="Prénom" style={inputStyle} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
          <input placeholder="Nom" style={inputStyle} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
        </div>
        <input placeholder="Téléphone" style={inputStyle} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formaterTelephone(e.target.value) }))} />
        <input placeholder="Courriel" type="email" style={inputStyle} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <input placeholder="Adresse complète" style={inputStyle} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
        <input placeholder="Code postal" style={inputStyle} value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: formaterCodePostal(e.target.value) }))} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
          <select style={inputStyle} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
            <option value="">Sexe…</option>
            <option value="Homme">Homme</option>
            <option value="Femme">Femme</option>
          </select>
          <select style={inputStyle} value={form.decision} onChange={(e) => setForm((f) => ({ ...f, decision: e.target.value }))}>
            <option value="">Décision…</option>
            {["Planté", "Sauvé", "Restauré", "Baptisé"].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px", alignItems: "center" }}>
          <select style={inputStyle} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {["Membre", "Ananias", "Bethel Leader", "Overseer", "Ministre Ordonné", "Assistant Pasteur", "Pasteur"].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--ink-muted)", marginBottom: "10px" }}>
            <input type="checkbox" checked={form.willing_to_host} onChange={(e) => setForm((f) => ({ ...f, willing_to_host: e.target.checked }))} />
            Disposé(e) à héberger
          </label>
        </div>

        {verifiantDoublon && (
          <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginBottom: "10px" }}>
            Vérification des doublons…
          </div>
        )}

        {doublonAlertes.length > 0 && (
          <div style={{
            marginBottom: "14px", padding: "12px 14px", borderRadius: "10px",
            background: "rgba(178,34,52,0.07)", border: "1.5px solid #b22234",
          }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#b22234", marginBottom: "6px" }}>
              ⚠ Doublon probable détecté
            </div>
            {doublonAlertes.map((msg, i) => (
              <div key={i} style={{ fontSize: "12px", color: "var(--ink)", marginBottom: "4px", lineHeight: 1.4 }}>{msg}</div>
            ))}
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "var(--ink)", marginTop: "8px", fontWeight: 600 }}>
              <input type="checkbox" checked={ignorerDoublon} onChange={(e) => setIgnorerDoublon(e.target.checked)} />
              Ce n'est pas un doublon, continuer quand même
            </label>
          </div>
        )}

        <button
          onClick={trouverBethel}
          disabled={!form.first_name || !form.last_name || !form.address || loadingDistances || doublonBloquant}
          style={{
            width: "100%", padding: "9px", borderRadius: "8px", border: "1px solid var(--plum)",
            background: "transparent", color: "var(--plum)", fontSize: "13px", fontWeight: 600,
            cursor: form.address ? "pointer" : "not-allowed", display: "flex", alignItems: "center",
            justifyContent: "center", gap: "6px", marginBottom: candidates.length ? "14px" : 0,
          }}
        >
          <Search size={14} /> {loadingDistances ? "Recherche du Bethel le plus proche…" : "Trouver le Bethel le plus proche"}
        </button>

        {peutDirigerEtDitOui && zoneProposee && !loadingDistances && (
          <div style={{
            marginBottom: "14px", padding: "14px", borderRadius: "10px",
            background: "rgba(31,92,78,0.06)", border: "1.5px solid var(--teal)",
          }}>
            <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--teal)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
              <Sparkles size={13} /> {form.role} disposé(e) à héberger — créer son propre Bethel
            </div>
            <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginBottom: "10px", lineHeight: 1.5 }}>
              Zone détectée : <strong style={{ color: "var(--ink)" }}>{zoneProposee.zone_name}</strong>.
              Un nouveau Bethel indépendant sera créé (aucun lien avec un ancien groupe), avec {form.first_name || "cette personne"} comme leader.
            </div>
            <label style={{ fontSize: "11px", color: "var(--ink-muted)", display: "block", marginBottom: "3px" }}>Numéro de Bethel (modifiable)</label>
            <input
              style={{ ...inputStyle, marginBottom: "10px", fontFamily: "var(--font-mono)" }}
              value={hpNumberPropose}
              onChange={(e) => setHpNumberPropose(e.target.value)}
            />
            <button
              disabled={creantNouveauBethel || !hpNumberPropose.trim() || doublonBloquant}
              onClick={creerNouveauBethelEtAjouter}
              style={{
                width: "100%", padding: "9px", borderRadius: "8px", border: "none",
                background: "var(--teal)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}
            >
              {creantNouveauBethel ? "Création…" : `Créer ${hpNumberPropose || "le Bethel"} et ajouter ${form.first_name || "la personne"}`}
            </button>
            <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "8px" }}>
              Ou choisis plutôt un Bethel existant ci-dessous si cette personne doit rejoindre un groupe déjà en place.
            </div>
          </div>
        )}

        {candidates.length > 0 && !loadingDistances && (() => {
          const meilleurTemps = candidates.reduce((min, c) => (c.minutes != null && c.minutes < min ? c.minutes : min), Infinity);
          if (meilleurTemps === Infinity || meilleurTemps <= LIMITE_MINUTES_PROXIMITE) return null;
          return (
            <div style={{
              marginBottom: "10px", padding: "10px 12px", borderRadius: "8px",
              background: "rgba(184,134,59,0.10)", border: "1px solid rgba(184,134,59,0.3)",
              fontSize: "12.5px", color: "var(--ink)", lineHeight: 1.5,
            }}>
              ⚠️ Aucun Bethel à moins de {LIMITE_MINUTES_PROXIMITE} min (le plus proche est à {meilleurTemps} min).
              {peutDirigerEtDitOui ? " C'est un bon signe pour créer un nouveau Bethel ci-dessus plutôt que de rejoindre un groupe éloigné." : " Cette personne pourrait plutôt être candidate pour héberger un nouveau Bethel dans sa zone."}
            </div>
          );
        })()}

        {candidates.length > 0 && (
          <div style={{ maxHeight: "260px", overflowY: "auto" }}>
            {candidates.map((c) => (
              <button
                key={c.bethel.bethel_id}
                onClick={() => setSelectedBethel(c.bethel)}
                style={{
                  display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center",
                  padding: "9px 11px", marginBottom: "6px", borderRadius: "8px", textAlign: "left", cursor: "pointer",
                  border: selectedBethel?.bethel_id === c.bethel.bethel_id ? "2px solid var(--plum)" : "1px solid var(--border)",
                  background: "var(--surface)", fontFamily: "var(--font-body)",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{c.bethel.leader_name}</div>
                  <div style={{ fontSize: "11px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>
                    {c.bethel.hp_number} · {c.bethel.zone_name || "zone inconnue"}
                  </div>
                  <LigneSupervisionBethel rows={supervisionParBethel[c.bethel.bethel_id]} nbMembres={nbMembresParBethel ? (nbMembresParBethel[c.bethel.bethel_id] || 0) : null} />
                </div>
                {c.minutes != null ? (
                  <span style={{
                    fontSize: "11.5px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                    background: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "rgba(31,92,78,0.10)" : "rgba(184,134,59,0.12)",
                    color: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "var(--teal)" : "var(--gold)",
                  }}>
                    🚗 {c.minutes} min
                  </span>
                ) : c.error ? (
                  <span style={{ fontSize: "11px", color: "var(--ink-muted)" }}>{c.error}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {selectedBethel && (
          <button
            disabled={saving || doublonBloquant}
            onClick={confirmerAjout}
            style={{
              marginTop: "6px", width: "100%", padding: "10px", borderRadius: "8px", border: "none",
              background: "var(--plum)", color: "#fff", fontSize: "13.5px", fontWeight: 600, cursor: "pointer",
            }}
          >
            {saving ? "Ajout en cours…" : `Ajouter dans ${selectedBethel.hp_number} (${selectedBethel.leader_name})`}
          </button>
        )}

        {justAdded && (
          <div style={{
            marginTop: "12px", padding: "10px 12px", borderRadius: "8px",
            background: "rgba(31,92,78,0.10)", color: "var(--teal)", fontSize: "12.5px", fontWeight: 600,
          }}>
            <Check size={13} style={{ verticalAlign: "-2px", marginRight: "4px" }} />
            {justAdded.nouveauBethelCree
              ? `${justAdded.name} dirige maintenant son propre Bethel : ${justAdded.bethel.hp_number}.`
              : `${justAdded.name} ajouté(e) à ${justAdded.bethel.hp_number} (${justAdded.bethel.leader_name}).`}
          </div>
        )}

        {justAdded && justAdded.details && (
          <div style={{
            marginTop: "10px", padding: "16px", borderRadius: "10px",
            border: "1px solid var(--border)", background: "#fafafa",
          }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: "10px" }}>
              Fiche — ce qui vient d'être enregistré
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>{justAdded.name}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 14px", fontSize: "12.5px", color: "var(--ink)" }}>
              <div><span style={{ color: "var(--ink-muted)" }}>Téléphone :</span> {justAdded.details.phone || "—"}</div>
              <div><span style={{ color: "var(--ink-muted)" }}>Courriel :</span> {justAdded.details.email || "—"}</div>
              <div><span style={{ color: "var(--ink-muted)" }}>Sexe :</span> {justAdded.details.gender || "—"}</div>
              <div><span style={{ color: "var(--ink-muted)" }}>Décision :</span> {justAdded.details.decision || "—"}</div>
              <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--ink-muted)" }}>Adresse :</span> {justAdded.details.address || "—"} {justAdded.details.postal_code ? `(${justAdded.details.postal_code})` : ""}</div>
              <div><span style={{ color: "var(--ink-muted)" }}>Rôle :</span> {justAdded.details.role}</div>
              <div><span style={{ color: "var(--ink-muted)" }}>Disposé(e) à héberger :</span> {justAdded.details.willing_to_host ? "Oui" : "Non"}</div>
              <div style={{ gridColumn: "1 / -1", paddingTop: "4px", borderTop: "1px solid var(--border)", marginTop: "4px" }}>
                <span style={{ color: "var(--ink-muted)" }}>Bethel :</span>{" "}
                <strong>{justAdded.bethel.hp_number}</strong>
                {justAdded.bethel.zone_name ? ` — ${justAdded.bethel.zone_name}` : ""}
                {!justAdded.nouveauBethelCree ? ` (leader : ${justAdded.bethel.leader_name})` : ""}
              </div>
            </div>
          </div>
        )}
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "0 0 10px" }}>Retirer un membre existant</h2>
      <div style={{ position: "relative", marginBottom: "16px", maxWidth: "420px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher par nom ou téléphone…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 32px",
            border: "1px solid var(--border)", borderRadius: "8px", fontSize: "14px", outline: "none",
          }}
        />
      </div>

      {searching && <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Recherche…</div>}
      {!searching && searched && results.length === 0 && (
        <div style={{ fontSize: "13.5px", color: "var(--ink-muted)" }}>Aucun membre trouvé pour "{query}".</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxWidth: "620px" }}>
        {results.map((m) => {
          const bethel = bethelById[m.bethel_id];
          const ouvert = expandedId === m.member_id;
          return (
            <div key={m.member_id} style={{
              padding: "10px 14px", borderRadius: "10px", border: "1px solid var(--border)", background: "var(--surface)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                   onClick={() => setExpandedId(ouvert ? null : m.member_id)}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{m.first_name} {m.last_name}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>
                    {m.role}{bethel ? ` · ${bethel.hp_number} (${bethel.zone_name || "zone inconnue"})` : ""}{m.phone ? ` · ${m.phone}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "11.5px", color: "var(--plum)", fontWeight: 600 }}>{ouvert ? "Masquer" : "Voir la fiche"}</span>
                  <button
                    disabled={busyId === m.member_id}
                    onClick={(e) => { e.stopPropagation(); retirerMembre(m); }}
                    title="Retirer"
                    style={{
                      display: "flex", alignItems: "center", gap: "5px", padding: "6px 11px", borderRadius: "7px",
                      border: "1px solid var(--brick)", background: "transparent", color: "var(--brick)",
                      fontSize: "12px", fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    <Trash2 size={12} /> {busyId === m.member_id ? "…" : "Retirer"}
                  </button>
                </div>
              </div>
              {ouvert && (
                <div style={{
                  marginTop: "10px", paddingTop: "10px", borderTop: "1px solid var(--border)",
                  display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 14px", fontSize: "12.5px", color: "var(--ink)",
                }}>
                  <div><span style={{ color: "var(--ink-muted)" }}>Téléphone :</span> {m.phone || "—"}</div>
                  <div><span style={{ color: "var(--ink-muted)" }}>Courriel :</span> {m.email || "—"}</div>
                  <div><span style={{ color: "var(--ink-muted)" }}>Sexe :</span> {m.gender || "—"}</div>
                  <div><span style={{ color: "var(--ink-muted)" }}>Décision :</span> {m.decision || "—"}</div>
                  <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--ink-muted)" }}>Adresse :</span> {m.address || "—"} {m.postal_code ? `(${m.postal_code})` : ""}</div>
                  <div><span style={{ color: "var(--ink-muted)" }}>Disposé(e) à héberger :</span> {m.willing_to_host ? "Oui" : "Non"}</div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <span style={{ color: "var(--ink-muted)" }}>Bethel :</span>{" "}
                    {bethel ? <strong>{bethel.hp_number}{bethel.zone_name ? ` — ${bethel.zone_name}` : ""} (leader : {bethel.leader_name})</strong> : "—"}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : détail d'un Bethel, avec ses membres                     */
/* ------------------------------------------------------------------ */
function MemberRow({ m, bethels, currentBethelId, onChanged, isLast, onOpenProfile }) {
  const [mode, setMode] = useState(null); // null | 'edit' | 'move'
  const [form, setForm] = useState({
    phone: m.phone || "", address: m.address || "", postal_code: m.postal_code || "",
  });
  const [moveTarget, setMoveTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [distanceInfo, setDistanceInfo] = useState(null); // { minutes } | { error } | null
  const [distanceLoading, setDistanceLoading] = useState(false);

  useEffect(() => {
    if (!moveTarget || !m.address) { setDistanceInfo(null); return; }
    const target = bethels.find((b) => b.bethel_id === moveTarget);
    if (!target || !target.address) { setDistanceInfo(null); return; }
    setDistanceLoading(true);
    setDistanceInfo(null);
    getDrivingMinutes(m.address, target.address)
      .then((minutes) => setDistanceInfo({ minutes }))
      .catch((e) => setDistanceInfo({ error: e.message }))
      .finally(() => setDistanceLoading(false));
  }, [moveTarget, m.address, bethels]);

  async function saveEdit() {
    setBusy(true);
    try {
      await supaPatch("members", `member_id=eq.${m.member_id}`, form);
      setMode(null);
      onChanged();
    } catch (e) { alert("Error: " + e.message); } finally { setBusy(false); }
  }

  async function doMove() {
    if (!moveTarget) return;
    setBusy(true);
    try {
      await supaPatch("members", `member_id=eq.${m.member_id}`, { bethel_id: moveTarget });
      setMode(null);
      onChanged();
    } catch (e) { alert("Error: " + e.message); } finally { setBusy(false); }
  }

  async function doRemove() {
    if (!window.confirm(`Remove ${m.first_name} ${m.last_name} from this Bethel?`)) return;
    setBusy(true);
    try {
      await supaDelete("members", `member_id=eq.${m.member_id}`);
      onChanged();
    } catch (e) { alert("Error: " + e.message); } finally { setBusy(false); }
  }

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "6px 8px", marginBottom: "6px",
    border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", fontFamily: "var(--font-body)",
  };
  const iconBtn = {
    background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)",
    padding: "3px", display: "flex", alignItems: "center",
  };

  return (
    <div style={{ padding: "10px 0", borderBottom: isLast ? "none" : "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
            <button
              onClick={() => onOpenProfile(m)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", textDecoration: "underline", textDecorationColor: "var(--border)", textUnderlineOffset: "3px" }}
            >
              {m.first_name} {m.last_name}
            </button>
          </div>
          <div style={{ display: "flex", gap: "12px", marginTop: "3px", flexWrap: "wrap" }}>
            {m.phone && (
              <span style={{ fontSize: "11.5px", color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                <Phone size={11} /> {m.phone}
              </span>
            )}
            {m.address && (
              <span style={{ fontSize: "11.5px", color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                <MapPin size={11} /> {m.address}{m.postal_code ? `, ${m.postal_code}` : ""}
              </span>
            )}
            {m.willing_to_host && (
              <span style={{ fontSize: "11px", color: "var(--teal)", fontWeight: 600 }}>Willing to host</span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0, marginLeft: "10px" }}>
          <span style={{
            fontSize: "11px", padding: "3px 9px", borderRadius: "999px", fontWeight: 600,
            background: m.role === "Bethel Leader" ? "rgba(107,42,62,0.10)" : "var(--bg)",
            color: m.role === "Bethel Leader" ? "var(--plum)" : "var(--ink-muted)",
            border: "1px solid var(--border)",
          }}>
            {m.role}
          </span>
          <button title="Edit address/phone" style={iconBtn} onClick={() => setMode(mode === "edit" ? null : "edit")}><Edit2 size={13} /></button>
          <button title="Move to another Bethel" style={iconBtn} onClick={() => setMode(mode === "move" ? null : "move")}><ArrowRightLeft size={13} /></button>
          <button title="Remove" style={{ ...iconBtn, color: "var(--brick)" }} onClick={doRemove}><Trash2 size={13} /></button>
        </div>
      </div>

      {mode === "edit" && (
        <div style={{ marginTop: "10px", padding: "10px", background: "var(--bg)", borderRadius: "8px" }}>
          <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formaterTelephone(e.target.value) }))} />
          <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: formaterCodePostal(e.target.value) }))} />
          <div style={{ display: "flex", gap: "8px" }}>
            <button disabled={busy} onClick={saveEdit} style={{ padding: "6px 12px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setMode(null)} style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {mode === "move" && (
        <div style={{ marginTop: "10px", padding: "10px", background: "var(--bg)", borderRadius: "8px" }}>
          <select style={inputStyle} value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
            <option value="">Choose destination Bethel…</option>
            {bethels.filter((b) => b.bethel_id !== currentBethelId).map((b) => (
              <option key={b.bethel_id} value={b.bethel_id}>{b.hp_number} — {b.leader_name} ({b.zone_name})</option>
            ))}
          </select>

          {distanceLoading && (
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginBottom: "8px" }}>Checking travel time…</div>
          )}
          {distanceInfo?.minutes !== undefined && (
            <div style={{
              fontSize: "12px", marginBottom: "8px", padding: "7px 10px", borderRadius: "6px",
              display: "flex", alignItems: "center", gap: "6px", fontWeight: 600,
              background: distanceInfo.minutes <= LIMITE_MINUTES_PROXIMITE ? "rgba(31,92,78,0.10)" : "rgba(184,134,59,0.12)",
              color: distanceInfo.minutes <= LIMITE_MINUTES_PROXIMITE ? "var(--teal)" : "var(--gold)",
            }}>
              🚗 {distanceInfo.minutes} min driving
              {distanceInfo.minutes > LIMITE_MINUTES_PROXIMITE && (
                <span style={{ fontWeight: 500 }}>— outside the {LIMITE_MINUTES_PROXIMITE}-minute rule</span>
              )}
            </div>
          )}
          {distanceInfo?.error && (
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginBottom: "8px" }}>
              Could not check travel time ({distanceInfo.error}).
            </div>
          )}

          <div style={{ display: "flex", gap: "8px" }}>
            <button disabled={busy || !moveTarget} onClick={doMove} style={{ padding: "6px 12px", borderRadius: "6px", border: "none", background: moveTarget ? "var(--plum)" : "var(--border)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: moveTarget ? "pointer" : "not-allowed" }}>
              {busy ? "Moving…" : distanceInfo?.minutes > LIMITE_MINUTES_PROXIMITE ? "Move anyway" : "Move"}
            </button>
            <button onClick={() => setMode(null)} style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : Profil complet d'un membre                                */
/* ------------------------------------------------------------------ */
const PROVINCES_CANADA = [
  "Alberta", "Colombie-Britannique", "Île-du-Prince-Édouard", "Manitoba",
  "Nouveau-Brunswick", "Nouvelle-Écosse", "Nunavut", "Ontario", "Québec",
  "Saskatchewan", "Terre-Neuve-et-Labrador", "Territoires du Nord-Ouest", "Yukon",
];

function MemberProfileModal({ member, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [form, setForm] = useState({
    first_name: member.first_name || "", last_name: member.last_name || "",
    phone: member.phone || "", email: member.email || "", gender: member.gender || "",
    address: member.address || "", postal_code: member.postal_code || "",
    role: member.role || "Membre",
    ananias_name: member.ananias_name || "", bethel_leader_name: member.bethel_leader_name || "",
    overseer_name: member.overseer_name || "", ordained_minister_name: member.ordained_minister_name || "",
    willing_to_host: member.willing_to_host || false,
    willing_to_supervise: member.willing_to_supervise || false,
    status: member.status || "active",
    photo_url: member.photo_url || "",
    previous_church: member.previous_church || "",
    baptized: member.baptized || false,
    baptism_date: member.baptism_date || "",
    city: member.city || "",
    province: member.province || "",
    country: member.country || "Canada",
    first_visit_date: member.first_visit_date || "",
    church_integration_date: member.church_integration_date || "",
  });

  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "7px 9px", marginBottom: "8px",
    border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", fontFamily: "var(--font-body)",
  };
  const labelStyle = { fontSize: "10.5px", fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", display: "block", marginBottom: "3px" };

  function Field({ label, value }) {
    if (!value) return null;
    return (
      <div style={{ marginBottom: "12px" }}>
        <span style={labelStyle}>{label}</span>
        <div style={{ fontSize: "13.5px", color: "var(--ink)" }}>{value}</div>
      </div>
    );
  }

  async function televerserPhoto(fichier) {
    setUploadingPhoto(true);
    try {
      const extension = fichier.name.split(".").pop();
      const cheminFichier = `${member.member_id}-${Date.now()}.${extension}`;
      const res = await fetch(
        `${SUPABASE_URL}/storage/v1/object/member-photos/${cheminFichier}`,
        {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
          body: fichier,
        }
      );
      if (!res.ok) throw new Error("Upload failed: " + (await res.text()));
      const urlPublique = `${SUPABASE_URL}/storage/v1/object/public/member-photos/${cheminFichier}`;
      setForm((f) => ({ ...f, photo_url: urlPublique }));
    } catch (e) {
      alert("Photo upload error: " + e.message);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      // Les champs date vides doivent être envoyés comme "rien" (null),
      // jamais comme du texte vide "" -- sinon la base de données refuse.
      const payload = {
        ...form,
        baptism_date: form.baptism_date || null,
        first_visit_date: form.first_visit_date || null,
        church_integration_date: form.church_integration_date || null,
      };
      await supaPatch("members", `member_id=eq.${member.member_id}`, payload);
      setEditing(false);
      onSaved();
    } catch (e) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "420px", maxWidth: "100%",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        padding: "26px", boxShadow: "0 24px 60px rgba(36,30,24,0.3)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {(member.photo_url || form.photo_url) && !editing ? (
              <img src={member.photo_url} alt="" style={{ width: "48px", height: "48px", borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
            ) : !editing ? (
              <div style={{
                width: "48px", height: "48px", borderRadius: "50%", background: "var(--bg)",
                border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "16px", fontWeight: 700, color: "var(--ink-muted)",
              }}>
                {(member.first_name || "?")[0]}
              </div>
            ) : null}
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0, color: "var(--ink)" }}>
              {editing ? "Edit profile" : `${member.first_name} ${member.last_name}`}
            </h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ marginTop: "14px", overflowY: "auto", flex: 1 }}>
          {!editing ? (
            <>
              <Field label="Role" value={member.role} />
              <Field label="Status" value={member.status === "inactive" ? "Inactive" : "Active"} />
              <Field label="Phone" value={member.phone} />
              <Field label="Email" value={member.email} />
              <Field label="Gender" value={member.gender} />
              <Field label="Address" value={member.address ? `${member.address}${member.postal_code ? ", " + member.postal_code : ""}` : null} />
              <Field label="Willing to host" value={member.willing_to_host ? "Yes" : "No"} />
              <Field label="Willing to supervise" value={member.willing_to_supervise ? "Yes" : "No"} />

              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "16px", marginBottom: "10px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                Membership record
              </div>
              <Field label="Previous church / group" value={member.previous_church} />
              <Field label="City, Province" value={member.city ? `${member.city}${member.province ? ", " + member.province : ""}` : null} />
              <Field label="First visit date" value={member.first_visit_date} />
              <Field label="Church integration date" value={member.church_integration_date} />
              <Field label="Baptized" value={member.baptized ? `Yes${member.baptism_date ? " — " + member.baptism_date : ""}` : "No"} />

              {(member.ananias_name || member.bethel_leader_name || member.overseer_name || member.ordained_minister_name) && (
                <>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "16px", marginBottom: "10px", borderTop: "1px solid var(--border)", paddingTop: "14px" }}>
                    Supervision chain
                  </div>
                  <Field label="Ananias" value={member.ananias_name} />
                  <Field label="Bethel Leader" value={member.bethel_leader_name} />
                  <Field label="Overseer" value={member.overseer_name} />
                  <Field label="Ministre Ordonné" value={member.ordained_minister_name} />
                </>
              )}

              <button onClick={() => setEditing(true)} style={{
                marginTop: "10px", width: "100%", padding: "9px", borderRadius: "8px",
                border: "1px solid var(--plum)", background: "transparent", color: "var(--plum)",
                fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}>
                Edit full profile
              </button>
            </>
          ) : (
            <>
              <span style={labelStyle}>Photo</span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                {form.photo_url ? (
                  <img src={form.photo_url} alt="" style={{ width: "44px", height: "44px", borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border)" }} />
                ) : (
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: "var(--bg)", border: "1px solid var(--border)" }} />
                )}
                <label style={{
                  padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)",
                  fontSize: "11.5px", cursor: "pointer", color: "var(--ink)",
                }}>
                  {uploadingPhoto ? "Uploading…" : "Upload photo"}
                  <input type="file" accept="image/*" style={{ display: "none" }} disabled={uploadingPhoto}
                    onChange={(e) => e.target.files[0] && televerserPhoto(e.target.files[0])} />
                </label>
              </div>
              <input style={inputStyle} placeholder="Or paste a photo link (URL)" value={form.photo_url} onChange={(e) => setForm((f) => ({ ...f, photo_url: e.target.value }))} />

              <span style={labelStyle}>First / last name</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <input style={inputStyle} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
                <input style={inputStyle} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
              <span style={labelStyle}>Phone / Email</span>
              <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formaterTelephone(e.target.value) }))} />
              <input style={inputStyle} placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <span style={labelStyle}>Gender</span>
              <input style={inputStyle} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))} />
              <span style={labelStyle}>Address / Postal code</span>
              <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: formaterCodePostal(e.target.value) }))} />

              <span style={labelStyle}>Ville</span>
              <input style={inputStyle} placeholder="Ville" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              <span style={labelStyle}>Province</span>
              <select style={inputStyle} value={form.province} onChange={(e) => setForm((f) => ({ ...f, province: e.target.value }))}>
                <option value="">— Choisir une province —</option>
                {PROVINCES_CANADA.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <span style={labelStyle}>Pays</span>
              <input style={inputStyle} placeholder="Pays" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
              <span style={labelStyle}>Date de première visite</span>
              <input type="date" style={inputStyle} value={form.first_visit_date} onChange={(e) => setForm((f) => ({ ...f, first_visit_date: e.target.value }))} />
              <span style={labelStyle}>Date d'intégration à l'église</span>
              <input type="date" style={inputStyle} value={form.church_integration_date} onChange={(e) => setForm((f) => ({ ...f, church_integration_date: e.target.value }))} />

              <span style={labelStyle}>Role</span>
              <select style={inputStyle} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {["Membre", "Ananias", "Bethel Leader", "Overseer", "Ministre Ordonné", "Assistant Pasteur", "Pasteur"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <span style={labelStyle}>Status</span>
              <select style={inputStyle} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--ink)", margin: "6px 0 10px" }}>
                <input type="checkbox" checked={form.willing_to_host} onChange={(e) => setForm((f) => ({ ...f, willing_to_host: e.target.checked }))} />
                Willing to host
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--ink)", margin: "6px 0 10px" }}>
                <input type="checkbox" checked={form.willing_to_supervise} onChange={(e) => setForm((f) => ({ ...f, willing_to_supervise: e.target.checked }))} />
                Willing to supervise (Overseer available for outreach)
              </label>

              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.03em", margin: "6px 0 8px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                Membership record
              </div>
              <span style={labelStyle}>Previous church / group</span>
              <input style={inputStyle} placeholder="e.g. Tabernacle de Gloire" value={form.previous_church} onChange={(e) => setForm((f) => ({ ...f, previous_church: e.target.value }))} />
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", color: "var(--ink)", margin: "2px 0 8px" }}>
                <input type="checkbox" checked={form.baptized} onChange={(e) => setForm((f) => ({ ...f, baptized: e.target.checked }))} />
                Baptized
              </label>
              {form.baptized && (
                <>
                  <span style={labelStyle}>Baptism date</span>
                  <input type="date" style={inputStyle} value={form.baptism_date} onChange={(e) => setForm((f) => ({ ...f, baptism_date: e.target.value }))} />
                </>
              )}

              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--plum)", textTransform: "uppercase", letterSpacing: "0.03em", marginTop: "6px", marginBottom: "8px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                Supervision chain
              </div>
              <span style={labelStyle}>Ananias</span>
              <input style={inputStyle} value={form.ananias_name} onChange={(e) => setForm((f) => ({ ...f, ananias_name: e.target.value }))} />
              <span style={labelStyle}>Bethel Leader</span>
              <input style={inputStyle} value={form.bethel_leader_name} onChange={(e) => setForm((f) => ({ ...f, bethel_leader_name: e.target.value }))} />
              <span style={labelStyle}>Overseer</span>
              <input style={inputStyle} value={form.overseer_name} onChange={(e) => setForm((f) => ({ ...f, overseer_name: e.target.value }))} />
              <span style={labelStyle}>Ministre Ordonné</span>
              <input style={inputStyle} value={form.ordained_minister_name} onChange={(e) => setForm((f) => ({ ...f, ordained_minister_name: e.target.value }))} />

              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button disabled={saving} onClick={save} style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditing(false)} style={{ flex: 1, padding: "9px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "13px", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Chaîne de supervision d'un Bethel, lue sur ses membres actifs (aucune écriture).
// Sert à faire hériter un nouveau membre de ananias / leader / overseer / ministre.
async function chaineSupervisionDuBethel(bethelId) {
  const rows = await supaGet("members", `bethel_id=eq.${bethelId}&status=eq.active&select=first_name,last_name,role,ananias_name,bethel_leader_name,overseer_name,ordained_minister_name`);
  const nom = (m) => [m.first_name, m.last_name].filter(Boolean).join(" ").trim();
  const parRole = (r) => rows.find((m) => m.role === r);
  const chef = parRole("Bethel Leader") || parRole("Ananias") || rows.find((m) => m.ananias_name || m.bethel_leader_name || m.overseer_name || m.ordained_minister_name) || {};
  const prem = (champ) => (rows.find((m) => m[champ]) || {})[champ] || "";
  return {
    ananias_name: (parRole("Ananias") && nom(parRole("Ananias"))) || chef.ananias_name || prem("ananias_name") || null,
    bethel_leader_name: (parRole("Bethel Leader") && nom(parRole("Bethel Leader"))) || chef.bethel_leader_name || prem("bethel_leader_name") || null,
    overseer_name: chef.overseer_name || (parRole("Overseer") && nom(parRole("Overseer"))) || prem("overseer_name") || null,
    ordained_minister_name: chef.ordained_minister_name || (parRole("Ministre Ordonné") && nom(parRole("Ministre Ordonné"))) || prem("ordained_minister_name") || null,
  };
}

// Contrôle de zone (règle de proximité ~15 min). Lecture seule.
// Retourne { minutes, autreZone } ; minutes = null si Google ne trouve pas le trajet.
async function controlerZoneMembre(bethel, adresse, codePostal) {
  const complete = [adresse, codePostal].filter(Boolean).join(", ");
  let autreZone = "";
  try {
    const zones = await supaGet("data_zones", "select=zone_id,city_name");
    const texte = normaliseNom(complete);
    const trouvee = zones.find((z) => z.zone_id !== bethel.zone_id && z.city_name && texte.includes(normaliseNom(z.city_name)));
    autreZone = trouvee ? trouvee.city_name : "";
  } catch (e) { /* facultatif */ }
  let minutes = null;
  try { minutes = await getDrivingMinutes(complete, bethel.address); } catch (e) { minutes = null; }
  return { minutes, autreZone };
}

function AddMemberForm({ bethelId, bethel, onAdded }) {
  const vide = { first_name: "", last_name: "", phone: "", email: "", address: "", postal_code: "", role: "Membre" };
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(vide);
  const [saving, setSaving] = useState(false);
  const [alerte, setAlerte] = useState(null); // { minutes, autreZone } quand hors zone
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "7px 9px", marginBottom: "7px",
    border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", fontFamily: "var(--font-body)",
  };

  async function enregistrer() {
    const chaine = await chaineSupervisionDuBethel(bethelId).catch(() => ({}));
    const payload = { ...form, bethel_id: bethelId, status: "active", ...chaine };
    if (!payload.email) delete payload.email;
    await supaPost("members", payload);
    setForm(vide);
    setAlerte(null);
    setOpen(false);
    onAdded();
  }

  async function submit() {
    if (!form.first_name || !form.last_name) return;
    setSaving(true);
    try {
      const avertissement = await verifierDoublon(form.first_name, form.last_name);
      if (avertissement && !window.confirm(`${avertissement}\n\nAdd this member anyway?`)) {
        setSaving(false);
        return;
      }
      // Contrôle de zone : seulement si on connaît l'adresse du membre ET celle du Bethel.
      if (bethel && bethel.address && (form.address || form.postal_code) && !alerte) {
        const ctl = await controlerZoneMembre(bethel, form.address, form.postal_code);
        const horsZone = (ctl.minutes != null && ctl.minutes > LIMITE_MINUTES_PROXIMITE) || (ctl.minutes == null && ctl.autreZone);
        if (horsZone) { setAlerte(ctl); setSaving(false); return; }
      }
      await enregistrer();
    } catch (e) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  async function ajouterQuandMeme() {
    setSaving(true);
    try { await enregistrer(); } catch (e) { alert("Error: " + e.message); } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        marginTop: "12px", display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px",
        borderRadius: "8px", border: "1px dashed var(--border)", background: "transparent",
        color: "var(--plum)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", width: "100%", justifyContent: "center",
      }}>
        <Plus size={13} /> Add member
      </button>
    );
  }

  const maj = (champ, fn) => (e) => { setAlerte(null); setForm((f) => ({ ...f, [champ]: fn ? fn(e.target.value) : e.target.value })); };
  return (
    <div style={{ marginTop: "12px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
      <input style={inputStyle} placeholder="First name" value={form.first_name} onChange={maj("first_name")} />
      <input style={inputStyle} placeholder="Last name" value={form.last_name} onChange={maj("last_name")} />
      <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={maj("phone", formaterTelephone)} />
      <input style={inputStyle} placeholder="Email" type="email" value={form.email} onChange={maj("email")} />
      <input style={inputStyle} placeholder="Address" value={form.address} onChange={maj("address")} />
      <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={maj("postal_code", formaterCodePostal)} />
      <select style={inputStyle} value={form.role} onChange={maj("role")}>
        {["Membre", "Ananias", "Bethel Leader", "Overseer", "Ministre Ordonné", "Assistant Pasteur", "Pasteur"].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      {alerte && (
        <div style={{ marginBottom: "8px", padding: "10px 12px", borderRadius: "8px", background: "rgba(184,134,59,0.10)", border: "1px solid rgba(184,134,59,0.3)", fontSize: "12.5px", color: "var(--ink)", lineHeight: 1.5 }}>
          ⚠️ Attention : l'adresse de ce membre est située {alerte.autreZone ? `à ${alerte.autreZone}` : "hors de la zone de ce Bethel"}
          {alerte.minutes != null ? ` (≈ ${alerte.minutes} min de route)` : ""}. Conformément à la règle de proximité (~{LIMITE_MINUTES_PROXIMITE} min),
          ce membre devrait être orienté vers un Bethel de sa zone.
          <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
            <button disabled={saving} onClick={ajouterQuandMeme} style={{ padding: "6px 12px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Ajouter quand même
            </button>
            <button onClick={() => setAlerte(null)} style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>
              Corriger l'adresse
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: "8px" }}>
        <button disabled={saving} onClick={submit} style={{ padding: "7px 14px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
          {saving ? "Vérification…" : "Add"}
        </button>
        <button onClick={() => { setOpen(false); setAlerte(null); }} style={{ padding: "7px 14px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : détail d'un Bethel, avec ses membres                     */
/* ------------------------------------------------------------------ */
function FindNearbyMembersPanel({ bethel, onAssigned, autoStart = false }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [assigningId, setAssigningId] = useState(null);

  async function lancerRecherche() {
    if (!bethel.address) return;
    setLoading(true);
    setOpen(true);
    try {
      const [pendants, membresActifs, bethelsTous, zonesToutes] = await Promise.all([
        supaGet("submissions", "status=eq.pending&willing_to_host=eq.false&select=submission_id,first_name,last_name,phone,address,leadership_level"),
        supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,phone,address,bethel_id"),
        supaGet("bethels", "select=bethel_id,zone_id"),
        supaGet("data_zones", "select=zone_id,zone_name"),
      ]);
      const zoneParBethelId = Object.fromEntries(bethelsTous.map((b) => [b.bethel_id, b.zone_id]));
      const nomZoneParId = Object.fromEntries(zonesToutes.map((z) => [z.zone_id, z.zone_name]));

      // Groupe 1 : soumissions "Non" en attente.
      // Exclut une personne dès qu'elle est DÉJÀ membre actif QUELQUE PART,
      // peu importe la zone. Avant, on ne l'excluait que si son Bethel actuel
      // était dans la MÊME zone que celui qui cherche — mais une personne déjà
      // membre ailleurs (ex: coincée dans un vieux groupe hors-zone à cause
      // d'une incohérence de zone) restait visible comme "Assign", ce qui
      // permettait de créer un DOUBLON en cliquant "Assign" au lieu de
      // "Move here". Elle doit plutôt apparaître seulement dans le Groupe 2
      // (membresMalPlaces) avec le bouton "Move here", qui transfère son
      // dossier existant plutôt que d'en créer un nouveau.
      const nomsDejaMembres = new Set(
        membresActifs.map((m) => normaliseNom(`${m.first_name} ${m.last_name}`))
      );
      const pendantsFiltres = pendants
        .filter((p) => !nomsDejaMembres.has(normaliseNom(`${p.first_name} ${p.last_name}`)))
        .map((p) => ({ ...p, kind: "pending" }));

      // Groupe 2 : membres déjà actifs, mais coincés dans un Bethel d'une
      // AUTRE zone que celle-ci — candidats à transférer vers ce Bethel.
      const membresMalPlaces = membresActifs
        .filter((m) => m.bethel_id !== bethel.bethel_id && zoneParBethelId[m.bethel_id] !== bethel.zone_id)
        .map((m) => ({
          ...m,
          kind: "member",
          zoneActuelle: nomZoneParId[zoneParBethelId[m.bethel_id]] || "",
        }));

      const candidatsAvecAdresse = [...pendantsFiltres, ...membresMalPlaces].filter((c) => c.address);
      const avecDistance = await Promise.all(
        candidatsAvecAdresse.map(async (c) => {
          try {
            const minutes = await getDrivingMinutes(c.address, bethel.address);
            return { ...c, minutes, error: null };
          } catch (e) {
            return { ...c, minutes: null, error: e.message };
          }
        })
      );
      avecDistance.sort((a, b) => {
        if (a.minutes == null) return 1;
        if (b.minutes == null) return -1;
        return a.minutes - b.minutes;
      });
      setCandidats(avecDistance); // montre tout le monde, personne n'est coupé silencieusement
    } catch (e) {
      setCandidats([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (autoStart && bethel.address) lancerRecherche(); /* eslint-disable-next-line */ }, []);

  async function assigner(candidat) {
    const cleId = candidat.kind === "member" ? candidat.member_id : candidat.submission_id;
    setAssigningId(cleId);
    try {
      if (candidat.kind === "member") {
        // Membre déjà actif ailleurs : on le transfère simplement dans ce Bethel.
        const chaine = await chaineSupervisionDuBethel(bethel.bethel_id).catch(() => ({}));
        await supaPatch("members", `member_id=eq.${candidat.member_id}`, { bethel_id: bethel.bethel_id, ...chaine });
        setCandidats((c) => c.filter((x) => (x.kind === "member" ? x.member_id : x.submission_id) !== cleId));
      } else {
        await supaPost("members", {
          bethel_id: bethel.bethel_id,
          first_name: candidat.first_name, last_name: candidat.last_name, phone: candidat.phone,
          address: candidat.address,
          role: LEADERSHIP_LABELS[candidat.leadership_level] || "Membre",
          willing_to_host: false, status: "active",
          ...(await chaineSupervisionDuBethel(bethel.bethel_id).catch(() => ({}))),
        });
        await supaPatch("submissions", `submission_id=eq.${candidat.submission_id}`, {
          status: "approved", zone_id: bethel.zone_id, reviewed_at: new Date().toISOString(),
        });
        setCandidats((c) => c.filter((x) => (x.kind === "member" ? x.member_id : x.submission_id) !== cleId));
      }
      onAssigned();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setAssigningId(null);
    }
  }

  if (!bethel.address) {
    return (
      <div style={{ fontSize: "12px", color: "var(--brick)", marginTop: "10px" }}>
        ⚠️ Ajoutez une adresse à ce Bethel avant de chercher des membres à proximité.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "14px" }}>
      {!open ? (
        <button onClick={lancerRecherche} style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
          border: "1px solid var(--plum)", background: "transparent", color: "var(--plum)", fontSize: "13px",
          fontWeight: 600, cursor: "pointer",
        }}>
          <Search size={14} /> Trouver à proximité
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", background: "var(--bg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Candidats à proximité (en attente + membres mal placés)</span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
          </div>
          {loading ? (
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Calcul des temps de trajet…</div>
          ) : candidats.length === 0 ? (
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Aucune soumission en attente ni membre mal placé avec une adresse exploitable.</div>
          ) : (
            <>
              {(() => {
                const meilleurTemps = candidats.reduce((min, c) => (c.minutes != null && c.minutes < min ? c.minutes : min), Infinity);
                if (meilleurTemps === Infinity || meilleurTemps <= LIMITE_MINUTES_PROXIMITE) return null;
                return (
                  <div style={{
                    marginBottom: "10px", padding: "10px 12px", borderRadius: "8px",
                    background: "rgba(184,134,59,0.10)", border: "1px solid rgba(184,134,59,0.3)",
                    fontSize: "12.5px", color: "var(--ink)", lineHeight: 1.5,
                  }}>
                    ⚠️ No one is within {LIMITE_MINUTES_PROXIMITE} min of this Bethel (closest is {meilleurTemps} min).
                    This group may struggle to grow — consider reviewing its zone, or waiting for a closer candidate.
                  </div>
                );
              })()}
              {candidats.map((c) => {
              const cleId = c.kind === "member" ? c.member_id : c.submission_id;
              return (
              <div key={cleId} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{c.first_name} {c.last_name}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{c.address}</div>
                  {c.kind === "member" && (
                    <div style={{
                      display: "inline-block", marginTop: "3px", fontSize: "10.5px", fontWeight: 600,
                      padding: "2px 7px", borderRadius: "999px", background: "rgba(31,92,78,0.10)", color: "var(--teal)",
                    }}>
                      ✅ Déjà membre — {c.zoneActuelle || "autre zone"}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                  {c.minutes != null ? (
                    <span style={{
                      fontSize: "11.5px", fontWeight: 600, padding: "3px 9px", borderRadius: "999px",
                      background: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "rgba(31,92,78,0.10)" : "rgba(184,134,59,0.12)",
                      color: c.minutes <= LIMITE_MINUTES_PROXIMITE ? "var(--teal)" : "var(--gold)",
                    }}>
                      🚗 {c.minutes} min
                    </span>
                  ) : (
                    <span style={{ fontSize: "11px", color: "var(--brick)" }} title={c.error}>⚠️ {c.error || "No route"}</span>
                  )}
                  <button
                    disabled={assigningId === cleId}
                    onClick={() => assigner(c)}
                    style={{
                      padding: "5px 12px", borderRadius: "6px", border: "none", background: "var(--plum)",
                      color: "#fff", fontSize: "11.5px", fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    {assigningId === cleId ? "…" : c.kind === "member" ? "Déplacer ici" : "Assigner"}
                  </button>
                </div>
              </div>
              );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
function BethelDetailModal({ bethel, bethels, zones, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addrForm, setAddrForm] = useState(bethel.address || "");
  const [changingZone, setChangingZone] = useState(false);
  const [zoneQuery, setZoneQuery] = useState("");
  const [profileFor, setProfileFor] = useState(null);

  async function loadMembers() {
    setLoading(true);
    try {
      const data = await supaGet("members", `bethel_id=eq.${bethel.bethel_id}&order=role.asc,first_name.asc`);
      setMembers(data);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  useEffect(() => { loadMembers(); }, [bethel.bethel_id]);

  const ROLE_ORDER = ['Bethel Leader', 'Ananias', 'Overseer', 'Ministre Ordonné', 'Assistant Pasteur', 'Pasteur', 'Membre'];
  const sortedMembers = [...members].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a.role); const ib = ROLE_ORDER.indexOf(b.role);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  async function saveAddress() {
    try {
      await supaPatch("bethels", `bethel_id=eq.${bethel.bethel_id}`, { address: addrForm });
      setEditingAddress(false);
      onChanged();
    } catch (e) { alert("Error: " + e.message); }
  }

  const zoneMatches = zoneQuery.trim().length >= 2
    ? zones.filter((z) => z.zone_name.toLowerCase().includes(zoneQuery.toLowerCase()) || z.city_name.toLowerCase().includes(zoneQuery.toLowerCase())).slice(0, 6)
    : [];

  async function changeZone(z) {
    try {
      await supaPatch("bethels", `bethel_id=eq.${bethel.bethel_id}`, { zone_id: z.zone_id });
      setChangingZone(false);
      setZoneQuery("");
      onChanged();
    } catch (e) { alert("Error: " + e.message); }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "540px", maxWidth: "100%",
        maxHeight: "85vh", display: "flex", flexDirection: "column",
        padding: "28px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: 0, color: "var(--ink)" }}>
              {bethel.leader_name}
            </h2>
            <div style={{ fontSize: "13px", color: "var(--ink-muted)", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{bethel.hp_number}</span>
              <ZoneStamp code={bethel.zone_code} muted />
              <span>{bethel.zone_name}</span>
              <button onClick={() => setChangingZone(!changingZone)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--plum)", fontSize: "11.5px", fontWeight: 600 }}>
                Change
              </button>
            </div>

            {changingZone && (
              <div style={{ marginTop: "8px" }}>
                <input
                  autoFocus
                  placeholder="Search a zone…"
                  value={zoneQuery}
                  onChange={(e) => setZoneQuery(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px" }}
                />
                {zoneMatches.map((z) => (
                  <button key={z.zone_id} onClick={() => changeZone(z)} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "6px 8px", border: "none",
                    background: "var(--bg)", borderRadius: "6px", marginTop: "4px", fontSize: "12px", cursor: "pointer",
                  }}>
                    {z.zone_name} · {z.city_name}
                  </button>
                ))}
              </div>
            )}

            {!editingAddress ? (
              <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                <MapPin size={12} /> {bethel.address || "No address"}
                <button onClick={() => { setAddrForm(bethel.address || ""); setEditingAddress(true); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--plum)", fontSize: "11px", fontWeight: 600 }}>
                  Edit
                </button>
              </div>
            ) : (
              <div style={{ marginTop: "6px", display: "flex", gap: "6px" }}>
                <input value={addrForm} onChange={(e) => setAddrForm(e.target.value)} style={{ flex: 1, boxSizing: "border-box", padding: "5px 8px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px" }} />
                <button onClick={saveAddress} style={{ padding: "5px 10px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "11.5px", cursor: "pointer" }}>Save</button>
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px", flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ marginTop: "18px", paddingTop: "16px", borderTop: "1px solid var(--border)", overflowY: "auto", flex: 1 }}>
          {!loading && <ChecklistPreparation bethel={bethel} membres={members.filter((m) => m.status !== "inactive")} />}
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", margin: "14px 0 10px" }}>
            {loading ? "Loading members…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
          </div>

          {error && <div style={{ fontSize: "13px", color: "var(--brick)" }}>Could not load members: {error}</div>}
          {!loading && members.length === 0 && !error && (
            <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>No members recorded for this Bethel yet.</div>
          )}

          {sortedMembers.map((m, i) => (
            <MemberRow
              key={m.member_id}
              m={m}
              bethels={bethels}
              currentBethelId={bethel.bethel_id}
              isLast={i === sortedMembers.length - 1}
              onChanged={() => { loadMembers(); onChanged(); }}
              onOpenProfile={setProfileFor}
            />
          ))}

          <AddMemberForm bethelId={bethel.bethel_id} bethel={bethel} onAdded={loadMembers} />
          <FindNearbyMembersPanel bethel={bethel} onAssigned={() => { loadMembers(); onChanged(); }} />
        </div>
      </div>

      {profileFor && (
        <MemberProfileModal
          member={profileFor}
          onClose={() => setProfileFor(null)}
          onSaved={() => { loadMembers(); onChanged(); setProfileFor(null); }}
        />
      )}
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Vues                                                                */
/* ------------------------------------------------------------------ */
// Trouve la meilleure correspondance de nom parmi une liste restreinte de candidats
// (ex: trouver quel "Overseer" correspond au texte tapé dans le champ "overseer_name").
function trouveDansListe(nomTape, candidats) {
  if (!nomTape || !nomTape.trim()) return null;
  const mots = new Set(normaliseNom(nomTape).split(/\s+/).filter((w) => w.length > 1));
  const seuil = mots.size >= 2 ? 2 : 1;
  let meilleur = null, meilleurScore = 0;
  for (const c of candidats) {
    const motsNom = new Set(normaliseNom(`${c.first_name} ${c.last_name}`).split(/\s+/).filter((w) => w.length > 1));
    let communs = 0;
    for (const w of mots) if (motsNom.has(w)) communs++;
    if (communs > meilleurScore) { meilleurScore = communs; meilleur = c; }
  }
  return meilleurScore >= seuil ? meilleur : null;
}

function SupervisionGridView() {
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [membresData, bethelsData, zonesData] = await Promise.all([
          supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,phone,email,address,city,postal_code,bethel_id,overseer_name,ordained_minister_name"),
          supaGet("bethels", "select=bethel_id,zone_id&status=eq.active&limit=5000"),
          supaGet("data_zones", "select=zone_id,zone_name&is_active=eq.true"),
        ]);
        const zoneNomParId = Object.fromEntries(zonesData.map((z) => [z.zone_id, z.zone_name]));
        const zoneParBethel = Object.fromEntries(bethelsData.map((b) => [b.bethel_id, zoneNomParId[b.zone_id] || ""]));
        // Attache la vraie zone du Bethel de chaque personne (pas sa ville personnelle,
        // souvent jamais remplie) -- c'est celle-là qu'on a corrigée toute la journée.
        setMembres(membresData.map((m) => ({ ...m, zoneReelle: zoneParBethel[m.bethel_id] || m.city || "" })));
      } catch (e) {
        setMembres([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lignes = useMemo(() => {
    const ministres = membres.filter((m) => m.role === "Ministre Ordonné");
    const overseers = membres.filter((m) => m.role === "Overseer");
    const bethelLeaders = membres.filter((m) => m.overseer_name && m.role !== "Overseer" && m.role !== "Ministre Ordonné");

    // Correspondance par clé exacte normalisée -- plus simple et plus fiable que la
    // recherche floue par mots communs pour ce cas précis (on contrôle le texte nous-mêmes).
    const overseersParMinistre = {}; // clé = normaliseNom(nom du ministre) -> [overseers]
    overseers.forEach((o) => {
      const cle = normaliseNom(o.ordained_minister_name || "");
      if (!cle) return;
      if (!overseersParMinistre[cle]) overseersParMinistre[cle] = [];
      overseersParMinistre[cle].push(o);
    });

    const blParOverseer = {}; // clé = normaliseNom(nom de l'overseer) -> [bethel leaders]
    bethelLeaders.forEach((bl) => {
      const cle = normaliseNom(bl.overseer_name || "");
      if (!cle) return;
      if (!blParOverseer[cle]) blParOverseer[cle] = [];
      blParOverseer[cle].push(bl);
    });

    const resultat = [];

    ministres.forEach((min) => {
      const cleMin = normaliseNom(`${min.first_name} ${min.last_name}`);
      const sesOverseers = overseersParMinistre[cleMin] || [];
      // On ignore les Ministres qui n'ont encore AUCUN Overseer relié -- rien d'utile à montrer
      if (sesOverseers.length === 0) return;

      let premiereLigneDuBloc = true;
      sesOverseers.forEach((ov) => {
        const cleOv = normaliseNom(`${ov.first_name} ${ov.last_name}`);
        const sesBL = blParOverseer[cleOv] || [];
        if (sesBL.length === 0) {
          resultat.push({ ministre: min, overseer: ov, bl: null, nouveauBloc: premiereLigneDuBloc });
          premiereLigneDuBloc = false;
        } else {
          sesBL.forEach((bl) => {
            resultat.push({ ministre: min, overseer: ov, bl, nouveauBloc: premiereLigneDuBloc });
            premiereLigneDuBloc = false;
          });
        }
      });
    });

    return resultat;
  }, [membres]);

  // --- Petit formulaire pour ajouter/modifier un lien de supervision directement ici ---
  const [formOuvert, setFormOuvert] = useState(false);
  const [nomPersonne, setNomPersonne] = useState("");
  const [nomSuperviseur, setNomSuperviseur] = useState("");
  const [typeLien, setTypeLien] = useState("overseer_name");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function enregistrerLien() {
    if (!nomPersonne.trim() || !nomSuperviseur.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const mots = nomPersonne.trim().split(/\s+/);
      const prenom = mots[0], nom = mots.slice(1).join(" ") || mots[0];
      const existants = await supaGet(
        "members",
        `first_name=ilike.*${encodeURIComponent(prenom)}*&last_name=ilike.*${encodeURIComponent(nom)}*&status=eq.active&select=member_id`
      );
      if (existants.length === 0) {
        setMessage({ type: "error", text: `No member found matching "${nomPersonne}".` });
        setBusy(false);
        return;
      }
      await supaPatch("members", `member_id=eq.${existants[0].member_id}`, { [typeLien]: nomSuperviseur.trim() });
      setMessage({ type: "ok", text: `Linked ${nomPersonne} → ${nomSuperviseur}` });
      setNomPersonne(""); setNomSuperviseur("");
      // Recharge
      const data = await supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,phone,email,address,city,postal_code,bethel_id,overseer_name,ordained_minister_name");
      setMembres((prev) => data.map((m) => {
        const ancien = prev.find((p) => p.member_id === m.member_id);
        return { ...m, zoneReelle: ancien ? ancien.zoneReelle : m.city || "" };
      }));
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // 6 colonnes séparées par personne, identique au Google Sheets : Prénom, Nom, Téléphone, Courriel, Zone, Adresse
  function Cellules({ personne }) {
    if (!personne) {
      return (
        <>
          <td style={{ padding: "5px 8px", borderRight: "1px solid var(--border)" }}></td>
          <td style={{ padding: "5px 8px", borderRight: "1px solid var(--border)" }}></td>
          <td style={{ padding: "5px 8px", borderRight: "1px solid var(--border)" }}></td>
          <td style={{ padding: "5px 8px", borderRight: "1px solid var(--border)" }}></td>
          <td style={{ padding: "5px 8px", borderRight: "1px solid var(--border)" }}></td>
          <td style={{ padding: "5px 8px", borderRight: "2px solid var(--ink-muted)" }}></td>
        </>
      );
    }
    return (
      <>
        <td style={{ padding: "5px 8px", fontSize: "12px", color: "var(--ink)" }}>{personne.first_name}</td>
        <td style={{ padding: "5px 8px", fontSize: "12px", color: "var(--ink)" }}>{personne.last_name}</td>
        <td style={{ padding: "5px 8px", fontSize: "11.5px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>{personne.phone || ""}</td>
        <td style={{ padding: "5px 8px", fontSize: "11px", color: "var(--ink-muted)" }}>{personne.email || ""}</td>
        <td style={{ padding: "5px 8px", fontSize: "11.5px", color: "var(--ink)" }}>{personne.zoneReelle || ""}</td>
        <td style={{ padding: "5px 8px", fontSize: "11px", color: "var(--ink-muted)", borderRight: "2px solid var(--ink-muted)" }}>
          {personne.address || ""}{personne.postal_code ? `, ${personne.postal_code}` : ""}
        </td>
      </>
    );
  }

  return (
    <div>
      {!formOuvert ? (
        <button onClick={() => setFormOuvert(true)} style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
          border: "1px solid var(--border)", background: "transparent", color: "var(--ink-muted)", fontSize: "13px",
          fontWeight: 600, cursor: "pointer", marginBottom: "16px",
        }}>
          <Plus size={14} /> Add / update a supervision link
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", background: "var(--surface)", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Add or update a supervision link</span>
            <button onClick={() => setFormOuvert(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
            <input placeholder="Person's name (e.g. Suze Wilda Eline)" value={nomPersonne} onChange={(e) => setNomPersonne(e.target.value)}
              style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", width: "220px" }} />
            <select value={typeLien} onChange={(e) => setTypeLien(e.target.value)}
              style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px" }}>
              <option value="overseer_name">is supervised by (Overseer)</option>
              <option value="ordained_minister_name">is supervised by (Ministre Ordonné)</option>
            </select>
            <input placeholder="Supervisor's name (e.g. Casulmane Angrand)" value={nomSuperviseur} onChange={(e) => setNomSuperviseur(e.target.value)}
              style={{ padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", width: "220px" }} />
            <button disabled={busy || !nomPersonne.trim() || !nomSuperviseur.trim()} onClick={enregistrerLien} style={{
              padding: "7px 16px", borderRadius: "6px", border: "none",
              background: (nomPersonne.trim() && nomSuperviseur.trim()) ? "var(--plum)" : "var(--border)",
              color: "#fff", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
            }}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          {message && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: message.type === "ok" ? "var(--teal)" : "var(--brick)" }}>
              {message.type === "ok" ? "✓ " : "⚠️ "}{message.text}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Loading…</div>
      ) : lignes.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No supervision links found yet.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "12px", width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th colSpan={6} style={{ textAlign: "center", padding: "6px", color: "var(--plum)", fontSize: "11px", textTransform: "uppercase", borderRight: "2px solid var(--ink-muted)", borderBottom: "1px solid var(--border)" }}>Minister Infos</th>
                <th colSpan={6} style={{ textAlign: "center", padding: "6px", color: "var(--teal)", fontSize: "11px", textTransform: "uppercase", borderRight: "2px solid var(--ink-muted)", borderBottom: "1px solid var(--border)" }}>Overseer Infos</th>
                <th colSpan={6} style={{ textAlign: "center", padding: "6px", color: "var(--gold)", fontSize: "11px", textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>Bethel Leader Infos</th>
              </tr>
              <tr style={{ background: "var(--bg)" }}>
                {[1, 2, 3].map((bloc) => (
                  <React.Fragment key={bloc}>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase" }}>First Name</th>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase" }}>Last Name</th>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase" }}>Phone#</th>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase" }}>Email</th>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase" }}>Zone</th>
                    <th style={{ padding: "5px 8px", color: "var(--ink-muted)", fontSize: "10px", textTransform: "uppercase", borderRight: bloc < 3 ? "2px solid var(--ink-muted)" : "none" }}>Address</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={i} style={{ borderTop: l.nouveauBloc && i > 0 ? "3px solid var(--plum)" : "1px solid var(--border)" }}>
                  <Cellules personne={l.ministre} />
                  <Cellules personne={l.overseer} />
                  <Cellules personne={l.bl} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OrgChartView() {
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ouvert, setOuvert] = useState({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await supaGet(
          "members",
          "status=eq.active&select=member_id,first_name,last_name,role,phone,email,ananias_name,bethel_leader_name,overseer_name,ordained_minister_name&limit=5000"
        );
        setMembres(data);
      } catch (e) {
        setMembres([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const arbre = useMemo(() => {
    const ministres = membres.filter((m) => m.role === "Ministre Ordonné");
    const overseers = membres.filter((m) => m.role === "Overseer");
    const bethelLeaders = membres.filter((m) => m.role === "Bethel Leader");
    const ananias = membres.filter((m) => m.role === "Ananias");

    const overseersSansParent = [];
    const overseersParMinistre = {}; // ministre.member_id -> [overseers]
    overseers.forEach((o) => {
      const parent = trouveDansListe(o.ordained_minister_name, ministres);
      if (parent) {
        overseersParMinistre[parent.member_id] = overseersParMinistre[parent.member_id] || [];
        overseersParMinistre[parent.member_id].push(o);
      } else {
        overseersSansParent.push(o);
      }
    });

    const blSansParent = [];
    const blParOverseer = {};
    bethelLeaders.forEach((bl) => {
      const parent = trouveDansListe(bl.overseer_name, overseers);
      if (parent) {
        blParOverseer[parent.member_id] = blParOverseer[parent.member_id] || [];
        blParOverseer[parent.member_id].push(bl);
      } else {
        blSansParent.push(bl);
      }
    });

    const ananiasSansParent = [];
    const ananiasParBL = {};
    ananias.forEach((a) => {
      const parent = trouveDansListe(a.bethel_leader_name, bethelLeaders);
      if (parent) {
        ananiasParBL[parent.member_id] = ananiasParBL[parent.member_id] || [];
        ananiasParBL[parent.member_id].push(a);
      } else {
        ananiasSansParent.push(a);
      }
    });

    return { ministres, overseersParMinistre, overseersSansParent, blParOverseer, blSansParent, ananiasParBL, ananiasSansParent };
  }, [membres]);

  function toggle(id) {
    setOuvert((o) => ({ ...o, [id]: !o[id] }));
  }

  function LignePersonne({ personne, niveau, enfants, coteCouleur }) {
    const aDesEnfants = enfants && enfants.length > 0;
    const estOuvert = ouvert[personne.member_id];
    return (
      <div style={{ marginLeft: `${niveau * 22}px` }}>
        <button
          onClick={() => aDesEnfants && toggle(personne.member_id)}
          style={{
            display: "flex", alignItems: "center", gap: "8px", width: "100%", textAlign: "left",
            padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border)",
            borderLeft: `3px solid ${coteCouleur}`, background: "var(--surface)", cursor: aDesEnfants ? "pointer" : "default",
            marginBottom: "6px", fontFamily: "var(--font-body)",
          }}
        >
          {aDesEnfants ? (
            <ChevronRight size={13} color="var(--ink-muted)" style={{ transform: estOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
          ) : (
            <span style={{ width: "13px", flexShrink: 0 }} />
          )}
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{personne.first_name} {personne.last_name}</span>
            <span style={{ fontSize: "11px", color: "var(--ink-muted)", marginLeft: "8px" }}>{personne.role}</span>
          </div>
          {personne.phone && <span style={{ fontSize: "11px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>{personne.phone}</span>}
          {aDesEnfants && <span style={{ fontSize: "11px", color: "var(--plum)", fontWeight: 600 }}>{enfants.length}</span>}
        </button>
      </div>
    );
  }

  function BrancheMinistre({ ministre }) {
    const enfants = arbre.overseersParMinistre[ministre.member_id] || [];
    return (
      <div>
        <LignePersonne personne={ministre} niveau={0} enfants={enfants} coteCouleur="var(--plum)" />
        {ouvert[ministre.member_id] && enfants.map((o) => <BrancheOverseer key={o.member_id} overseer={o} />)}
      </div>
    );
  }

  function BrancheOverseer({ overseer }) {
    const enfants = arbre.blParOverseer[overseer.member_id] || [];
    return (
      <div>
        <LignePersonne personne={overseer} niveau={1} enfants={enfants} coteCouleur="var(--teal)" />
        {ouvert[overseer.member_id] && enfants.map((bl) => <BrancheBethelLeader key={bl.member_id} bl={bl} />)}
      </div>
    );
  }

  function BrancheBethelLeader({ bl }) {
    const enfants = arbre.ananiasParBL[bl.member_id] || [];
    return (
      <div>
        <LignePersonne personne={bl} niveau={2} enfants={enfants} coteCouleur="var(--gold)" />
        {ouvert[bl.member_id] && enfants.map((a) => (
          <div key={a.member_id} style={{ marginLeft: "66px" }}>
            <LignePersonne personne={a} niveau={0} enfants={null} coteCouleur="var(--border)" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Loading…</div>
      ) : arbre.ministres.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No Ministre Ordonné found yet.
        </div>
      ) : (
        <>
          {arbre.ministres.map((m) => <BrancheMinistre key={m.member_id} ministre={m} />)}

          {(arbre.overseersSansParent.length > 0 || arbre.blSansParent.length > 0 || arbre.ananiasSansParent.length > 0) && (
            <div style={{ marginTop: "26px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "10px" }}>
                ⚠️ Unassigned (no matching supervisor found)
              </div>
              {arbre.overseersSansParent.map((o) => <LignePersonne key={o.member_id} personne={o} niveau={0} enfants={null} coteCouleur="var(--brick)" />)}
              {arbre.blSansParent.map((bl) => <LignePersonne key={bl.member_id} personne={bl} niveau={0} enfants={null} coteCouleur="var(--brick)" />)}
              {arbre.ananiasSansParent.map((a) => <LignePersonne key={a.member_id} personne={a} niveau={0} enfants={null} coteCouleur="var(--brick)" />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Objectif 31 octobre : 115 Bethels pleinement opérationnels.        */
/* 7 étapes : 1 actif, 2 leader, 3 overseer, 5 membres (calculées) ;   */
/* 4 accès app, 6 présence, 7 service (cochées à la main, table        */
/* bethel_readiness). Lecture seule sur bethels / members.             */
/* ------------------------------------------------------------------ */
const OBJECTIF_BETHELS = 115;
const ETAPES_PREPARATION = [
  { n: 1, id: "actif", court: "Activés", label: "Bethel activé" },
  { n: 2, id: "leader", court: "Leaders assignés", label: "Leader Bethel assigné" },
  { n: 3, id: "overseer", court: "Superviseurs assignés", label: "Superviseur (Overseer) assigné" },
  { n: 4, id: "app", court: "Accès app validé", label: "Accès à l'app TG Bethel validé", manuel: "app_access" },
  { n: 5, id: "membres", court: "Avec membres", label: "Membres ajoutés" },
  { n: 6, id: "presence", court: "Présence prête", label: "Présence prête", manuel: "presence_ready" },
  { n: 7, id: "service", court: "Service prêt", label: "Service du dimanche prêt", manuel: "service_ready" },
];

function etapesBethel(b, membres, ready) {
  const sansChef = ["", "membre", "new member", "nouveau potentiel"];
  const nomLeader = (b.leader_name || "").trim();
  const leader = !!nomLeader && !/^unassigned$/i.test(nomLeader) && !sansChef.includes((b.leader_role || "").trim().toLowerCase());
  const overseer = membres.some((m) => (m.overseer_name || "").trim()) || ["overseer", "ministre ordonné"].includes((b.leader_role || "").trim().toLowerCase());
  const r = ready || {};
  const e = {
    actif: b.status !== "inactive",
    leader,
    overseer,
    app: !!r.app_access,
    membres: membres.length > 0,
    presence: !!r.presence_ready,
    service: !!r.service_ready,
  };
  const faits = ETAPES_PREPARATION.filter((x) => e[x.id]).length;
  const statut = faits === 7 ? "pret" : (!e.actif || !e.leader || !e.overseer) ? "bloque" : "en_cours";
  return { ...e, faits, statut };
}

function usePreparationBethels(cleRecharge) {
  const [etat, setEtat] = useState({ map: {}, charge: false, tableOk: true, erreur: "" });
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const [bets, mems, ready] = await Promise.all([
          supaGetTout("bethels", "select=bethel_id,hp_number,bethel_name_officiel,status,leader_name,leader_role"),
          supaGetTout("members", "status=eq.active&select=bethel_id,overseer_name"),
          supaGetTout("bethel_readiness", "select=*").catch(() => null),
        ]);
        const membresParBethel = {};
        mems.forEach((m) => { (membresParBethel[m.bethel_id] = membresParBethel[m.bethel_id] || []).push(m); });
        const readyParId = Object.fromEntries((ready || []).map((r) => [r.bethel_id, r]));
        const map = {};
        bets.filter(estBethelOfficielLigne).forEach((b) => { map[b.bethel_id] = etapesBethel(b, membresParBethel[b.bethel_id] || [], readyParId[b.bethel_id]); });
        if (!annule) setEtat({ map, charge: true, tableOk: ready !== null, erreur: "" });
      } catch (e) { if (!annule) setEtat({ map: {}, charge: true, tableOk: true, erreur: e.message }); }
    })();
    return () => { annule = true; };
  }, [cleRecharge]);
  return etat;
}

function ObjectifOctobre() {
  const { map, charge, tableOk, erreur } = usePreparationBethels(0);
  const liste = Object.values(map);
  const prets = liste.filter((x) => x.statut === "pret").length;
  const pct = Math.min(100, Math.round((prets / OBJECTIF_BETHELS) * 100));
  const joursRestants = Math.max(0, Math.ceil((new Date("2026-10-31T23:59:59-04:00") - new Date()) / 86400000));
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "12px", background: "var(--surface)", padding: "16px 18px", marginBottom: "22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "19px", color: "var(--ink)" }}>Objectif 31 Octobre : {OBJECTIF_BETHELS} Bethels Opérationnels</div>
        <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>{joursRestants} jour{joursRestants > 1 ? "s" : ""} restant{joursRestants > 1 ? "s" : ""}</div>
      </div>
      {!charge ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "10px" }}>Chargement…</div> : erreur ? <div style={{ fontSize: "12.5px", color: "var(--brick)", marginTop: "10px" }}>Erreur : {erreur}</div> : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", margin: "12px 0 14px" }}>
            <div style={{ flex: 1, height: "12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "999px", overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--teal)", transition: "width .3s" }} />
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--teal)", whiteSpace: "nowrap" }}>{prets}/{OBJECTIF_BETHELS} · {pct}%</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px" }}>
            {ETAPES_PREPARATION.map((et) => {
              const n = liste.filter((x) => x[et.id]).length;
              return (
                <div key={et.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", background: "var(--bg)" }}>
                  <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase" }}>{et.n}. {et.court}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--ink)" }}>{n}<span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>/{OBJECTIF_BETHELS}</span></div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "10px" }}>
            {liste.length} Bethels officiels dans le système. Étapes 1, 2, 3 et 5 calculées automatiquement ; 4, 6 et 7 cochées par l'équipe admin dans la fiche du Bethel.
            {!tableOk && " ⚠️ Table bethel_readiness introuvable : les étapes 4, 6 et 7 restent à 0."}
          </div>
        </>
      )}
    </div>
  );
}

function ChecklistPreparation({ bethel, membres, onChange }) {
  const [ready, setReady] = useState(undefined); // undefined = chargement, null = table absente
  const [enCours, setEnCours] = useState("");
  useEffect(() => {
    setReady(undefined);
    supaGet("bethel_readiness", `bethel_id=eq.${bethel.bethel_id}&select=*`).then((r) => setReady(r[0] || {})).catch(() => setReady(null));
  }, [bethel.bethel_id]);
  if (ready === undefined) return null;
  const e = etapesBethel(bethel, membres, ready);
  async function basculer(champ, valeur) {
    setEnCours(champ);
    try {
      const corps = { [champ]: valeur, updated_at: new Date().toISOString() };
      const existe = await supaGet("bethel_readiness", `bethel_id=eq.${bethel.bethel_id}&select=bethel_id`);
      const res = existe.length ? await supaPatch("bethel_readiness", `bethel_id=eq.${bethel.bethel_id}`, corps) : await supaPost("bethel_readiness", { bethel_id: bethel.bethel_id, ...corps });
      setReady(res[0] || { ...ready, ...corps });
      onChange && onChange();
    } catch (err) { alert("Erreur : " + err.message); } finally { setEnCours(""); }
  }
  const couleurs = { pret: "#1f7a45", en_cours: "var(--gold)", bloque: "var(--brick)" };
  const libelle = { pret: "Prêt", en_cours: "En cours", bloque: "Bloqué" };
  return (
    <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Checklist de préparation (7 étapes)</div>
        <span style={{ fontSize: "11.5px", fontWeight: 700, color: couleurs[e.statut] }}>{e.faits}/7 · {libelle[e.statut]}</span>
      </div>
      {ETAPES_PREPARATION.map((et) => (
        <label key={et.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", fontSize: "13px", color: "var(--ink)", cursor: et.manuel && ready !== null ? "pointer" : "default" }}>
          <input type="checkbox" checked={!!e[et.id]} disabled={!et.manuel || ready === null || enCours === et.manuel}
            onChange={(ev) => et.manuel && basculer(et.manuel, ev.target.checked)} />
          <span>{et.n}. {et.label}</span>
          {!et.manuel && <span style={{ fontSize: "10.5px", color: "var(--ink-muted)" }}>(auto)</span>}
        </label>
      ))}
      {ready === null && <div style={{ fontSize: "11.5px", color: "var(--brick)" }}>Table bethel_readiness introuvable : étapes 4, 6 et 7 désactivées.</div>}
    </div>
  );
}

function DashboardView({ submissions, bethels, zones, onNavigate }) {
  const pending = submissions.filter((s) => s.status === "pending").length;
  const willing = submissions.filter((s) => s.willing_to_host).length;
  const pct = submissions.length ? Math.round((willing / submissions.length) * 100) : 0;

  const readyToActivate = submissions.filter((s) => s.status === "pending" && s.willing_to_host).length;
  const readyToAssign = submissions.filter((s) => s.status === "pending" && !s.willing_to_host).length;
  const approved = submissions.filter((s) => s.status === "approved").length;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Tableau de bord</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 24px" }}>
        Live data from your Supabase database — bethel-montreal-app.
      </p>
      <ObjectifOctobre />
      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
        <StatCard label="Pending submissions" value={pending} sub="awaiting zone match" accent="var(--gold)" />
        <StatCard label="Active Bethels" value={bethels.length} sub="households running today" accent="var(--teal)" />
        <StatCard label="Willing to host" value={submissions.length ? `${pct}%` : "—"} sub={`${willing} of ${submissions.length} submissions`} accent="var(--plum)" />
        <StatCard label="Zones on file" value={zones.length} sub="Québec + Canada" />
      </div>

      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "32px 0 12px" }}>Workflow queue</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {[
          {
            label: "Ready to Activate", value: readyToActivate, color: "var(--teal)",
            desc: "Yes submissions still pending — ready to call, review, and activate as a new Bethel.",
          },
          {
            label: "Ready to Assign", value: readyToAssign, color: "var(--gold)",
            desc: "No submissions still pending — need to be matched to a nearby active Bethel.",
          },
          {
            label: "Approved", value: approved, color: "var(--plum)",
            desc: "Submissions already processed — activated as a Bethel or assigned as a member.",
          },
        ].map((row) => (
          <button
            key={row.label}
            onClick={() => onNavigate && onNavigate("submissions")}
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "14px 18px", borderRadius: "10px", border: "1px solid var(--border)",
              background: "var(--surface)", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)",
            }}
          >
            <div>
              <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{row.label}</div>
              <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "3px", maxWidth: "480px" }}>{row.desc}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "16px" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: "22px", color: row.color }}>{row.value}</span>
              <ChevronRight size={16} color="var(--ink-muted)" />
            </div>
          </button>
        ))}
      </div>

      {submissions.length > 0 && (
        <>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "18px", margin: "32px 0 12px" }}>Newest submissions</h2>
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            {submissions.slice(0, 4).map((s, i) => (
              <div key={s.submission_id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px",
                borderBottom: i < 3 ? "1px solid var(--border)" : "none", background: "var(--surface)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-muted)" }}>{s.hp_number}</span>
                  <span style={{ fontSize: "13.5px", color: "var(--ink)" }}>{s.first_name} {s.last_name}</span>
                </div>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SubmissionsView({ submissions, onOpenActivate, onOpenAssign, onAddNew }) {
  const [filter, setFilter] = useState("ready");
  const readyToHost = submissions.filter((s) => s.status === "pending" && s.willing_to_host);
  const filtered =
    filter === "ready" ? readyToHost
    : filter === "all" ? submissions
    : submissions.filter((s) => s.status === filter);

  // Dans "Pending" et "All", les gens prêts à héberger remontent toujours en premier.
  const sorted = [...filtered].sort((a, b) => {
    if (filter === "ready") return 0;
    const ra = a.status === "pending" && a.willing_to_host ? 0 : 1;
    const rb = b.status === "pending" && b.willing_to_host ? 0 : 1;
    return ra - rb;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Soumissions</h1>
          <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
            Real rows from your submissions table.
          </p>
        </div>
        <button onClick={onAddNew} style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
          border: "1px solid var(--plum)", background: "transparent", color: "var(--plum)", fontSize: "13px",
          fontWeight: 600, cursor: "pointer",
        }}>
          <Plus size={14} /> New submission
        </button>
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
        {[
          { id: "ready", label: `⭐ Ready to host (${readyToHost.length})` },
          { id: "pending", label: `Pending (${submissions.filter((s) => s.status === "pending").length})` },
          { id: "approved", label: `Approved (${submissions.filter((s) => s.status === "approved").length})` },
          { id: "all", label: `All (${submissions.length})` },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${filter === f.id ? "var(--plum)" : "var(--border)"}`,
            background: filter === f.id ? "var(--plum)" : "var(--surface)",
            color: filter === f.id ? "#fff" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
        {sorted.length === 0 && (
          <div style={{ padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
            {filter === "ready"
              ? "Nobody is currently pending and willing to host."
              : "No submissions here yet — click \"New submission\" to test, or wait for your real intake form to send data here."}
          </div>
        )}
        {sorted.map((s, i) => {
          const readyBadge = s.status === "pending" && s.willing_to_host;
          return (
          <div key={s.submission_id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px",
            borderBottom: i < sorted.length - 1 ? "1px solid var(--border)" : "none",
            background: readyBadge ? "rgba(184,134,59,0.06)" : "var(--surface)",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                {readyBadge && <span title="Ready to host">⭐</span>}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-muted)" }}>{s.hp_number}</span>
                <span style={{ fontSize: "14.5px", fontWeight: 600, color: "var(--ink)" }}>{s.first_name} {s.last_name}</span>
                <StatusPill status={s.status} />
              </div>
              <div style={{ display: "flex", gap: "14px", marginTop: "4px", flexWrap: "wrap" }}>
                {s.address && (
                  <span style={{ fontSize: "12px", color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <MapPin size={12} /> {s.address}
                  </span>
                )}
                {s.phone && (
                  <span style={{ fontSize: "12px", color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Phone size={12} /> {s.phone}
                  </span>
                )}
              </div>
              <div style={{ marginTop: "6px", display: "flex", gap: "8px" }}>
                <span style={{
                  fontSize: "11px", padding: "2px 8px", borderRadius: "999px",
                  background: s.willing_to_host ? "rgba(31,92,78,0.12)" : "rgba(162,59,51,0.10)",
                  color: s.willing_to_host ? "var(--teal)" : "var(--brick)", fontWeight: 600,
                }}>
                  {s.willing_to_host ? "Willing to host" : "Not hosting"}
                </span>
                {s.leadership_level && (
                  <span style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "999px", background: "var(--bg)", color: "var(--ink-muted)", border: "1px solid var(--border)" }}>
                    {LEADERSHIP_LABELS[s.leadership_level] || s.leadership_level}
                  </span>
                )}
              </div>
            </div>
            {s.status === "pending" ? (
              s.willing_to_host ? (
                <button onClick={() => onOpenActivate(s)} style={{
                  flexShrink: 0, marginLeft: "12px", padding: "8px 16px", borderRadius: "8px", border: "none",
                  background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                }}>
                  Activate
                </button>
              ) : (
                <button onClick={() => onOpenAssign(s)} style={{
                  flexShrink: 0, marginLeft: "12px", padding: "8px 16px", borderRadius: "8px",
                  border: "1px solid var(--plum)", background: "transparent", color: "var(--plum)",
                  fontSize: "13px", fontWeight: 600, cursor: "pointer",
                }}>
                  Assign to Bethel
                </button>
              )
            ) : (
              <span style={{ flexShrink: 0, marginLeft: "12px", color: "var(--teal)" }}><Check size={18} /></span>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page « Bethels » -- reproduit l'interface du portail Shekinah       */
/* (/campus-admin/bethels). Ne modifie JAMAIS bethel_id ni hp_number ; */
/* « Désactiver » ne change que le champ status (aucune suppression).  */
/* ------------------------------------------------------------------ */
const estBethelOfficielLigne = (b) => !!b.bethel_name_officiel || /^bethel-.+-\d{6}$/i.test(b.hp_number || "");

/* ------------------------------------------------------------------ */
/* Onglet « Details » du panneau d'un Bethel (comme le portail         */
/* Shekinah) : infos du Bethel, origine HP, assignation du leader.    */
/* Lecture dans bethels / members / submissions ; l'assignation ne     */
/* supprime rien et refuse de mettre deux leaders dans un Bethel.      */
/* ------------------------------------------------------------------ */
function DetailsBethelShekinah({ bethel, onReload }) {
  const [info, setInfo] = useState(null);
  const [choix, setChoix] = useState(false);
  const [candidats, setCandidats] = useState(null);
  const [candId, setCandId] = useState("");
  const [msg, setMsg] = useState("");
  const [enCours, setEnCours] = useState(false);
  const ROLES_SANS_CHEF = ["", "Membre", "New member", "Nouveau Potentiel"];
  const dateCourte = (d) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

  async function charger() {
    const [zones, campus, membres, subs] = await Promise.all([
      bethel.zone_id ? supaGet("data_zones", `zone_id=eq.${bethel.zone_id}&select=zone_code,city_code,city_name,zone_name`).catch(() => []) : [],
      bethel.campus_id ? supaGet("campuses", `campus_id=eq.${bethel.campus_id}&select=campus_name`).catch(() => []) : [],
      supaGet("members", `bethel_id=eq.${bethel.bethel_id}&status=eq.active&select=member_id,first_name,last_name,phone,email,address,role,willing_to_host,ananias_name,overseer_name,ordained_minister_name`).catch(() => []),
      supaGetTout("submissions", "select=first_name,last_name,leadership_level,willing_to_host,status,submitted_at,reviewed_at&order=submitted_at.desc").catch(() => []),
    ]);
    const cle = (p) => normaliseNom(`${p.first_name || ""} ${p.last_name || ""}`);
    const chefNom = ROLES_SANS_CHEF.includes(bethel.leader_role || "") ? "" : normaliseNom(bethel.leader_name || "");
    const hoteNom = normaliseNom(bethel.host_name || bethel.leader_name || "");
    const chef = chefNom ? membres.find((m) => cle(m) === chefNom) || null : null;
    const hote = membres.find((m) => cle(m) === hoteNom && !ROLES_PEUVENT_DIRIGER.includes(m.role)) || membres.find((m) => cle(m) === hoteNom) || null;
    const sub = hote ? subs.find((s) => cle(s) === cle(hote)) : subs.find((s) => cle(s) === hoteNom);
    setInfo({ zone: zones[0] || null, campus: (campus[0] || {}).campus_name || "", membres, chef, hote, sub, aChef: !!chefNom });
  }
  useEffect(() => { setInfo(null); setChoix(false); setMsg(""); charger().catch((e) => setMsg("Erreur : " + e.message)); /* eslint-disable-next-line */ }, [bethel.bethel_id, bethel.leader_name]);

  async function ouvrirChoix() {
    setChoix(true); setMsg(""); setCandidats(null);
    try {
      const villeNom = info && info.zone ? info.zone.city_name : "";
      const zonesVille = villeNom ? await supaGet("data_zones", `city_name=eq.${encodeURIComponent(villeNom)}&select=zone_id`) : [];
      const idsZones = new Set(zonesVille.map((z) => z.zone_id));
      const [bets, chefs] = await Promise.all([
        supaGetTout("bethels", "status=eq.active&select=bethel_id,hp_number,bethel_name_officiel,zone_id,leader_name"),
        supaGetTout("members", "status=eq.active&role=in.(%22Ananias%22,%22Bethel%20Leader%22)&select=member_id,first_name,last_name,phone,role,bethel_id"),
      ]);
      const betParId = Object.fromEntries(bets.map((b) => [b.bethel_id, b]));
      const liste = chefs.filter((m) => {
        const b = betParId[m.bethel_id];
        if (!b || b.bethel_id === bethel.bethel_id || !idsZones.has(b.zone_id)) return false;
        const dirigeOfficiel = estBethelOfficielLigne(b) && normaliseNom(b.leader_name || "") === normaliseNom(`${m.first_name} ${m.last_name}`);
        return !dirigeOfficiel; // un leader qui dirige déjà un Bethel officiel n'est pas proposé
      }).map((m) => ({ ...m, origine: (betParId[m.bethel_id] || {}).hp_number || "" }));
      const vus = new Set();
      setCandidats(liste.filter((m) => { const k = normaliseNom(`${m.first_name} ${m.last_name}`); if (vus.has(k)) return false; vus.add(k); return true; }));
    } catch (e) { setMsg("Erreur : " + e.message); setCandidats([]); }
  }

  async function assigner() {
    const c = (candidats || []).find((x) => x.member_id === candId); if (!c || !info) return;
    const nom = `${c.first_name} ${c.last_name}`.trim();
    const autres = info.membres.filter((m) => ROLES_PEUVENT_DIRIGER.includes(m.role) && normaliseNom(`${m.first_name} ${m.last_name}`) !== normaliseNom(nom));
    if (autres.length) { setMsg(`⚠️ Deux leaders ne peuvent pas cohabiter : ${autres.map((m) => `${m.first_name} ${m.last_name}`).join(", ")} est déjà leader de ce Bethel. Déplacez-le d'abord.`); return; }
    if (!window.confirm(`Assigner ${nom} (${c.role}) comme leader de ${bethel.bethel_name_officiel || bethel.hp_number} ?\n\nAucun groupe ne sera supprimé.`)) return;
    setEnCours(true); setMsg("");
    let etape = "début";
    try {
      etape = "chaîne de supervision";
      const chaine = await chaineSupervisionDuBethel(bethel.bethel_id);
      const nouvelle = { ...chaine, ...(c.role === "Ananias" ? { ananias_name: nom } : { bethel_leader_name: nom }) };
      etape = "mise à jour du Bethel";
      await supaPatch("bethels", `bethel_id=eq.${bethel.bethel_id}`, { leader_name: nom, leader_role: c.role });
      etape = "déplacement du leader";
      const ancienId = c.bethel_id;
      await supaPatch("members", `member_id=eq.${c.member_id}`, { bethel_id: bethel.bethel_id, ...nouvelle });
      etape = "ancien groupe du leader";
      const anciens = await supaGet("bethels", `bethel_id=eq.${ancienId}&select=bethel_id,hp_number,bethel_name_officiel,status`);
      if (anciens[0] && anciens[0].status !== "inactive" && !estBethelOfficielLigne(anciens[0])) {
        const reste = await supaGet("members", `bethel_id=eq.${ancienId}&status=eq.active&select=member_id`);
        if (reste.length === 0) await supaPatch("bethels", `bethel_id=eq.${ancienId}`, { status: "inactive" });
      }
      setMsg(`✅ ${nom} est maintenant leader de ce Bethel.`);
      setChoix(false); setCandId("");
      onReload && onReload();
    } catch (e) { setMsg(`⚠️ Échec à l'étape « ${etape} » : ${e.message}`); }
    finally { setEnCours(false); }
  }

  const ligne2 = (label, val, mono) => (
    <div style={{ padding: "6px 0" }}>
      <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
      <div style={{ fontSize: "13px", color: "var(--ink)", fontWeight: 600, fontFamily: mono ? "var(--font-mono)" : undefined, wordBreak: "break-word" }}>{val || "—"}</div>
    </div>
  );
  const grille = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 14px" };
  if (!info) return <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>{msg || "Chargement des détails…"}</div>;
  const { zone, campus, membres, chef, hote, sub, aChef } = info;
  const btn = { padding: "7px 14px", borderRadius: "999px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" };
  return (
    <div>
      <div style={{ display: "inline-block", padding: "2px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600,
        background: bethel.status === "inactive" ? "rgba(150,150,150,0.15)" : "rgba(40,160,90,0.14)", color: bethel.status === "inactive" ? "var(--ink-muted)" : "#1f7a45", marginBottom: "6px" }}>
        {bethel.status === "inactive" ? "Inactive" : "Active"}
      </div>
      <div style={grille}>
        {ligne2("Church ID", bethel.church_id || bethel.hp_number, true)}
        {ligne2("Zone code", zone ? (zone.zone_code || zone.city_code) : "")}
        {ligne2("Campus", CAMPUS_FIXE_NOM)}
        {ligne2("Leader", aChef ? bethel.leader_name : "—")}
        {ligne2("Leader email", chef && chef.email)}
        {ligne2("Members", String(membres.length))}
        {ligne2("Activated", "—")}
        {ligne2("Created", dateCourte(bethel.created_at))}
      </div>
      <button onClick={() => (choix ? setChoix(false) : ouvrirChoix())} style={{ ...btn, margin: "8px 0 4px" }}>{aChef ? "Edit Leader" : "Assign Leader"}</button>
      {choix && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "10px", margin: "6px 0 8px", background: "var(--bg)" }}>
          <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginBottom: "6px" }}>
            Ananias / Bethel Leader de la même ville ({zone ? zone.city_name : "—"}) qui ne dirigent pas déjà un Bethel officiel.
          </div>
          {candidats === null ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Chargement…</div>
            : candidats.length === 0 ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Aucun leader disponible dans cette ville.</div>
            : (
              <>
                <select value={candId} onChange={(e) => setCandId(e.target.value)} style={{ width: "100%", padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px" }}>
                  <option value="">Choisir un leader…</option>
                  {candidats.map((c) => <option key={c.member_id} value={c.member_id}>{c.first_name} {c.last_name} · {c.role}{c.origine ? ` (${c.origine})` : ""}</option>)}
                </select>
                <button disabled={!candId || enCours} onClick={assigner} style={{ ...btn, marginTop: "8px", background: "var(--plum)", color: "#fff", border: "none", opacity: !candId || enCours ? 0.5 : 1 }}>
                  {enCours ? "En cours…" : "Confirmer"}
                </button>
              </>
            )}
        </div>
      )}
      {msg && <div style={{ fontSize: "12px", margin: "6px 0", color: msg.startsWith("✅") ? "#1f7a45" : "var(--brick)" }}>{msg}</div>}

      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", margin: "14px 0 2px", paddingTop: "10px", borderTop: "1px solid var(--border)" }}>HP origin</div>
      <div style={grille}>
        {ligne2("Applicant name", hote ? `${hote.first_name} ${hote.last_name}` : bethel.host_name)}
        {ligne2("Email", hote && hote.email)}
        {ligne2("Phone", hote && hote.phone)}
        {ligne2("HP group", bethel.hp_number, true)}
        {ligne2("HP facilitator", hote && (hote.overseer_name || hote.ananias_name))}
        {ligne2("Willing to host", hote ? (hote.willing_to_host ? "Oui" : "Non") : (sub ? (sub.willing_to_host ? "Oui" : "Non") : ""))}
        {ligne2("Address", bethel.address || (hote && hote.address))}
        {ligne2("Leadership level", (sub && sub.leadership_level) || (hote && hote.role))}
        {ligne2("Approved at", sub && sub.status === "approved" ? dateCourte(sub.reviewed_at) : "")}
      </div>
      <ChecklistPreparation bethel={bethel} membres={membres} />
    </div>
  );
}

function BethelSidePanel({ bethel, mode, bethels, onClose, onReload, onOpenDetail }) {
  const [membres, setMembres] = useState([]);
  const [chargement, setChargement] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [pool, setPool] = useState([]);
  const [envoiId, setEnvoiId] = useState(null);
  const [formPresence, setFormPresence] = useState(false);

  const titres = {
    voir: "Détails du Bethel",
    ajouter: "Ajouter un membre",
    assigner: "Assigner des membres",
    proximite: "Trouver à proximité",
  };

  async function chargerMembres() {
    setChargement(true);
    try {
      const data = await supaGet("members", `bethel_id=eq.${bethel.bethel_id}&select=member_id,first_name,last_name,phone,email,role,postal_code,status&order=last_name.asc`);
      setMembres(data);
    } catch (e) { setMembres([]); } finally { setChargement(false); }
  }

  async function chargerPool() {
    setChargement(true);
    try {
      const idsAnciens = new Set(bethels.filter((b) => !estBethelOfficielLigne(b)).map((b) => b.bethel_id));
      const [mem, soum] = await Promise.all([
        supaGetTout("members", "select=member_id,first_name,last_name,phone,address,postal_code,city,bethel_id"),
        supaGet("submissions", "status=eq.pending&select=submission_id,first_name,last_name,phone,address,leadership_level"),
      ]);
      const codeParId = Object.fromEntries(bethels.map((b) => [b.bethel_id, b.hp_number]));
      setPool([
        ...mem.filter((m) => idsAnciens.has(m.bethel_id)).map((m) => ({ ...m, kind: "member", origine: codeParId[m.bethel_id] || "ancien groupe" })),
        ...soum.map((s) => ({ ...s, kind: "pending", origine: "HP churches (réponses)" })),
      ]);
    } catch (e) { setPool([]); } finally { setChargement(false); }
  }

  useEffect(() => {
    if (mode === "voir") chargerMembres();
    if (mode === "assigner") chargerPool();
    // eslint-disable-next-line
  }, [mode, bethel.bethel_id]);

  async function assigner(c) {
    const cle = c.kind === "member" ? c.member_id : c.submission_id;
    setEnvoiId(cle);
    try {
      if (c.kind === "member") {
        // Un seul membre à la fois, via la fonction SQL (hérite de la chaîne de supervision du Bethel).
        await supaRpc("fn_assign_member_to_bethel", { p_member_id: c.member_id, p_bethel_id: bethel.bethel_id });
      } else {
        await supaPost("members", {
          bethel_id: bethel.bethel_id, first_name: c.first_name, last_name: c.last_name, phone: c.phone,
          address: c.address, postal_code: c.postal_code,
          role: LEADERSHIP_LABELS[c.leadership_level] || "Membre", willing_to_host: false, status: "active",
        });
        await supaPatch("submissions", `submission_id=eq.${c.submission_id}`, {
          status: "approved", zone_id: bethel.zone_id, reviewed_at: new Date().toISOString(),
        });
      }
      setPool((p) => p.filter((x) => (x.kind === "member" ? x.member_id : x.submission_id) !== cle));
      onReload();
    } catch (e) {
      alert("Erreur : " + e.message + (c.kind === "member" ? "\n\n(Le Bethel cible doit avoir un Bethel Leader actif enregistré.)" : ""));
    } finally { setEnvoiId(null); }
  }

  const q = normaliseNom(recherche);
  const poolFiltre = pool
    .filter((c) => !q || normaliseNom(`${c.first_name} ${c.last_name} ${c.postal_code || ""} ${c.city || ""}`).includes(q))
    .slice(0, 60);

  const ligne = (label, val) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "6px 0", borderBottom: "1px solid var(--border)", fontSize: "13px" }}>
      <span style={{ color: "var(--ink-muted)" }}>{label}</span>
      <span style={{ color: "var(--ink)", fontWeight: 600, textAlign: "right" }}>{val || "—"}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 60 }} />
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", background: "var(--surface)",
        zIndex: 61, boxShadow: "-8px 0 24px rgba(0,0,0,0.15)", overflowY: "auto", padding: "20px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{titres[mode]}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--ink)" }}>{bethel.bethel_name_officiel || bethel.hp_number}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-muted)" }}>{bethel.church_id || bethel.hp_number}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={18} /></button>
        </div>

        {mode === "voir" && (
          <>
            <DetailsBethelShekinah bethel={bethel} onReload={() => { chargerMembres(); onReload(); }} />
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", margin: "16px 0 6px" }}>
              Membres ({membres.length})
            </div>
            {chargement ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Chargement…</div>
              : membres.length === 0 ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Aucun membre pour l'instant.</div>
              : membres.map((m) => (
                <div key={m.member_id} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{m.first_name} {m.last_name}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{[m.role, m.phone, m.postal_code].filter(Boolean).join(" · ")}</div>
                </div>
              ))}
            <AddMemberForm bethelId={bethel.bethel_id} bethel={bethel} onAdded={() => { chargerMembres(); onReload(); }} />
            <FindNearbyMembersPanel bethel={bethel} onAssigned={() => { chargerMembres(); onReload(); }} />
            <button onClick={() => setFormPresence(true)} style={{
              marginTop: "16px", marginRight: "8px", padding: "8px 14px", borderRadius: "8px", border: "none",
              background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer",
            }}>
              + Enregistrer une présence
            </button>
            {formPresence && <AttendanceFormModal bethels={bethels} bethelIdInitial={bethel.bethel_id} onClose={() => setFormPresence(false)} />}
            <button onClick={() => { onClose(); onOpenDetail(bethel); }} style={{
              marginTop: "16px", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--plum)",
              background: "transparent", color: "var(--plum)", fontSize: "13px", fontWeight: 600, cursor: "pointer",
            }}>
              Ouvrir la fiche complète
            </button>
          </>
        )}

        {mode === "ajouter" && <AddMemberForm bethelId={bethel.bethel_id} bethel={bethel} onAdded={() => { onReload(); onClose(); }} />}

        {mode === "proximite" && (
          <>
            <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginBottom: "6px" }}>
              Personnes en attente et membres mal placés, triés par temps de route vers ce Bethel (règle des {LIMITE_MINUTES_PROXIMITE} minutes).
            </div>
            <FindNearbyMembersPanel bethel={bethel} onAssigned={onReload} autoStart />
          </>
        )}

        {mode === "assigner" && (
          <>
            <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginBottom: "10px", lineHeight: 1.5 }}>
              Bassin des anciens groupes (BETHEL-MTL-…, LVL, RPT…) et soumissions « HP churches » en attente. Les membres sont transférés <b>un par un</b> ;
              les anciens groupes ne sont jamais vidés ni supprimés.
            </div>
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher par nom, code postal ou ville…"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px", marginBottom: "10px" }} />
            {chargement ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Chargement du bassin…</div>
              : poolFiltre.length === 0 ? <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Aucun résultat.</div>
              : poolFiltre.map((c) => {
                const cle = c.kind === "member" ? c.member_id : c.submission_id;
                return (
                  <div key={cle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{c.first_name} {c.last_name}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{[c.postal_code, c.city, c.address].filter(Boolean).join(" · ") || "Adresse inconnue"}</div>
                      <div style={{ fontSize: "10.5px", color: "var(--gold)", fontFamily: "var(--font-mono)" }}>{c.origine}</div>
                    </div>
                    <button disabled={envoiId === cle} onClick={() => {
                      if (window.confirm(`Assigner ${c.first_name} ${c.last_name} à ${bethel.bethel_name_officiel || bethel.hp_number} ?`)) assigner(c);
                    }} style={{ padding: "5px 12px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                      {envoiId === cle ? "…" : "Assigner"}
                    </button>
                  </div>
                );
              })}
            {pool.length > poolFiltre.length && (
              <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "8px" }}>
                {poolFiltre.length} affichés sur {pool.length} — affinez la recherche.
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function DistanceDeuxAdresses() {
  const [ouvert, setOuvert] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [minutes, setMinutes] = useState(null);
  const [erreur, setErreur] = useState("");
  const [calcul, setCalcul] = useState(false);

  async function calculer() {
    if (!a.trim() || !b.trim()) return;
    setCalcul(true); setErreur(""); setMinutes(null);
    try { setMinutes(await getDrivingMinutes(a, b)); }
    catch (e) { setErreur(e.message || "Trajet introuvable"); }
    finally { setCalcul(false); }
  }

  const champ = { width: "100%", boxSizing: "border-box", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px", marginBottom: "8px" };
  if (!ouvert) {
    return (
      <button onClick={() => setOuvert(true)} style={{ marginBottom: "14px", padding: "6px 14px", borderRadius: "999px", border: "1px dashed var(--border)", background: "transparent", color: "var(--plum)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}>
        🚗 Distance entre deux adresses
      </button>
    );
  }
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "14px", background: "var(--bg)", maxWidth: "460px", marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>Distance entre deux adresses (en voiture)</span>
        <button onClick={() => setOuvert(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
      </div>
      <input style={champ} placeholder="Adresse 1 (ex. 699 boul. Lucille-Teasdale, Terrebonne)" value={a} onChange={(e) => setA(e.target.value)} />
      <input style={champ} placeholder="Adresse 2 (ex. 1611 chemin St-Charles, Terrebonne)" value={b} onChange={(e) => setB(e.target.value)} />
      <button disabled={calcul} onClick={calculer} style={{ padding: "7px 14px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}>
        {calcul ? "Calcul…" : "Calculer"}
      </button>
      {minutes != null && (
        <div style={{ marginTop: "10px", fontSize: "14px", fontWeight: 700, color: minutes <= LIMITE_MINUTES_PROXIMITE ? "var(--teal)" : "var(--gold)" }}>
          🚗 {minutes} min {minutes <= LIMITE_MINUTES_PROXIMITE ? `— dans la limite de ${LIMITE_MINUTES_PROXIMITE} min` : `— au-delà de ${LIMITE_MINUTES_PROXIMITE} min`}
        </div>
      )}
      {erreur && <div style={{ marginTop: "10px", fontSize: "12.5px", color: "var(--brick)" }}>⚠️ {erreur}</div>}
    </div>
  );
}

// Soumissions « HP churches » en attente (pending) rattachées à une ville : permet de
// retrouver à tout moment un leader qui a dit Non (ex. Wilfrid) et de le récupérer s'il dit Oui plus tard.
function EnAttenteDeVille({ ville }) {
  const [lignes, setLignes] = useState([]);
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const zones = await supaGet("data_zones", `city_name=eq.${encodeURIComponent(ville)}&select=zone_id`);
        if (!zones.length) { if (!annule) setLignes([]); return; }
        const ids = zones.map((z) => z.zone_id).join(",");
        const subs = await supaGet("submissions", `status=eq.pending&zone_id=in.(${ids})&select=submission_id,first_name,last_name,phone,address,willing_to_host,leadership_level,submitted_at&order=submitted_at.desc`);
        if (!annule) setLignes(subs);
      } catch (e) { if (!annule) setLignes([]); }
    })();
    return () => { annule = true; };
  }, [ville]);
  if (!lignes.length) return null;
  const NIVEAUX_LEADER = ["hp_leader", "ananias", "overseer", "ordained_minister", "bethel_leader"];
  const maisons = lignes.filter((x) => x.willing_to_host === true);
  const leaders = lignes.filter((x) => x.willing_to_host !== true && NIVEAUX_LEADER.includes(x.leadership_level));
  const membres = lignes.filter((x) => x.willing_to_host !== true && !NIVEAUX_LEADER.includes(x.leadership_level));
  const pastille = (v) => v === true
    ? <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", background: "rgba(31,92,78,0.10)", padding: "2px 9px", borderRadius: "999px" }}>Oui</span>
    : <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)", background: "rgba(162,59,51,0.10)", padding: "2px 9px", borderRadius: "999px" }}>Non</span>;
  const bloc = (titre, aide, liste) => liste.length === 0 ? null : (
    <div style={{ marginBottom: "10px" }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{titre} ({liste.length})</div>
      <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", margin: "2px 0 4px" }}>{aide}</div>
      {liste.map((x) => (
        <div key={x.submission_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", padding: "6px 0", borderTop: "1px solid var(--border)" }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>{x.first_name} {x.last_name}</div>
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{[LEADERSHIP_LABELS[x.leadership_level], x.phone, x.address].filter(Boolean).join(" · ")}</div>
          </div>
          {pastille(x.willing_to_host)}
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "10px", background: "var(--surface)", padding: "12px 14px", marginBottom: "16px" }}>
      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>En attente à {ville} ({lignes.length})</div>
      {bloc("Maisons « Oui » à approuver", "C'est la maison du membre qui est activée et approuvée, jamais celle d'un leader qui a dit Non.", maisons)}
      {bloc("Leaders « Non » à placer", "Leur maison n'est pas utilisée : ils iront chez un membre « Oui » (Rapports → Jumelages). Gardés ici pour les retrouver s'ils changent d'avis.", leaders)}
      {bloc("Membres « Non » en attente d'un Bethel", "À rattacher à un Bethel de la zone.", membres)}
    </div>
  );
}

function BethelsView({ bethels, memberCounts, onOpenDetail, onReload }) {
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("all");
  const [villeChoisie, setVilleChoisie] = useState("all");
  const [sousZoneChoisie, setSousZoneChoisie] = useState("all");
  const [panneau, setPanneau] = useState(null); // { mode, bethelId }
  const [enCours, setEnCours] = useState(null);
  const prep = usePreparationBethels(bethels.length);

  // « En attente d'assignation » = Bethel actif sans responsable enregistré (aucun Bethel Leader).
  const sansResponsable = (b) => b.status !== "inactive" && !b.has_leader_member && (!b.leader_name || /^unassigned$/i.test(b.leader_name.trim()));
  const codeAffiche = (b) => b.church_id || b.hp_number;

  const filtres = [
    { id: "all", label: "Tous" },
    { id: "pending", label: "En attente d'assignation" },
    { id: "active", label: "Actif" },
    { id: "inactive", label: "Inactif" },
    { id: "needs_members", label: "Besoin de membres" },
    { id: "willing_yes", label: "Willing : Oui" },
    { id: "willing_no", label: "Willing : Non" },
    { id: "prep_pret", label: "Prêts (7/7)" },
    { id: "prep_cours", label: "En cours" },
    { id: "prep_bloque", label: "Bloqués" },
  ];
  const statutPrep = (b) => (prep.map[b.bethel_id] || {}).statut;

  const villes = useMemo(() => {
    const compteurs = {};
    bethels.forEach((b) => {
      const v = b.city_name || b.zone_name || "Inconnu";
      compteurs[v] = (compteurs[v] || 0) + 1;
    });
    return Object.entries(compteurs).sort((a, b) => b[1] - a[1]);
  }, [bethels]);

  const sousZones = useMemo(() => {
    if (villeChoisie === "all") return [];
    const compteurs = {};
    bethels
      .filter((b) => (b.city_name || b.zone_name) === villeChoisie)
      .forEach((b) => { compteurs[b.zone_name] = (compteurs[b.zone_name] || 0) + 1; });
    const entries = Object.entries(compteurs);
    return entries.length > 1 ? entries.sort((a, b) => b[1] - a[1]) : [];
  }, [bethels, villeChoisie]);

  const resultats = useMemo(() => {
    let liste = bethels;
    if (filtre === "pending") liste = liste.filter(sansResponsable);
    if (filtre === "active") liste = liste.filter((b) => b.status !== "inactive");
    if (filtre === "inactive") liste = liste.filter((b) => b.status === "inactive");
    if (filtre === "needs_members") liste = liste.filter((b) => b.status !== "inactive" && (memberCounts[b.bethel_id] || 0) < 3);
    if (filtre === "willing_yes") liste = liste.filter((b) => b.leader_willing_to_host === true);
    if (filtre === "willing_no") liste = liste.filter((b) => b.leader_willing_to_host === false);
    if (filtre === "prep_pret") liste = liste.filter((b) => statutPrep(b) === "pret");
    if (filtre === "prep_cours") liste = liste.filter((b) => statutPrep(b) === "en_cours");
    if (filtre === "prep_bloque") liste = liste.filter((b) => statutPrep(b) === "bloque");
    if (villeChoisie !== "all") liste = liste.filter((b) => (b.city_name || b.zone_name) === villeChoisie);
    if (sousZoneChoisie !== "all") liste = liste.filter((b) => b.zone_name === sousZoneChoisie);
    const q = normaliseNom(recherche);
    if (q) {
      liste = liste.filter((b) =>
        normaliseNom([b.leader_name, b.leader_full_name, b.hp_number, b.church_id, b.bethel_name_officiel].filter(Boolean).join(" ")).includes(q)
      );
    }
    return liste;
  }, [bethels, memberCounts, filtre, recherche, villeChoisie, sousZoneChoisie, prep.map]);

  const compteFiltre = (id) => {
    if (id === "all") return bethels.length;
    if (id === "pending") return bethels.filter(sansResponsable).length;
    if (id === "active") return bethels.filter((b) => b.status !== "inactive").length;
    if (id === "inactive") return bethels.filter((b) => b.status === "inactive").length;
    if (id === "willing_yes") return bethels.filter((b) => b.leader_willing_to_host === true).length;
    if (id === "willing_no") return bethels.filter((b) => b.leader_willing_to_host === false).length;
    if (id === "prep_pret") return bethels.filter((b) => statutPrep(b) === "pret").length;
    if (id === "prep_cours") return bethels.filter((b) => statutPrep(b) === "en_cours").length;
    if (id === "prep_bloque") return bethels.filter((b) => statutPrep(b) === "bloque").length;
    return bethels.filter((b) => b.status !== "inactive" && (memberCounts[b.bethel_id] || 0) < 3).length;
  };

  async function basculerStatut(b) {
    const desactiver = b.status !== "inactive";
    const msg = desactiver
      ? `Désactiver le Bethel ${codeAffiche(b)} ?\n\nIl ne sera pas supprimé : seul son statut passera à « Inactif » (réversible).`
      : `Réactiver le Bethel ${codeAffiche(b)} ?`;
    if (!window.confirm(msg)) return;
    setEnCours(b.bethel_id);
    try {
      await supaPatch("bethels", `bethel_id=eq.${b.bethel_id}`, { status: desactiver ? "inactive" : "active" });
      onReload();
    } catch (e) { alert("Erreur : " + e.message); } finally { setEnCours(null); }
  }

  const pilleStyle = (actif, couleur = "var(--plum)") => ({
    padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer",
    border: `1px solid ${actif ? couleur : "var(--border)"}`,
    background: actif ? couleur : "var(--surface)", color: actif ? "#fff" : "var(--ink-muted)",
  });
  const thStyle = (align = "left") => ({ textAlign: align, padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" });
  const btnAction = (couleur, plein = false) => ({
    padding: "5px 10px", borderRadius: "6px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${couleur}`, background: plein ? couleur : "transparent", color: plein ? "#fff" : couleur,
  });

  const bethelPanneau = panneau ? bethels.find((b) => b.bethel_id === panneau.bethelId) : null;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Bethels</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 16px" }}>
        Campus: TG Montreal — {bethels.length} au total.
      </p>

      <div style={{ position: "relative", maxWidth: "400px", marginBottom: "14px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher par nom ou Church ID..."
          style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 32px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", outline: "none" }}
        />
      </div>

      <DistanceDeuxAdresses />

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
        {filtres.map((f) => (
          <button key={f.id} onClick={() => setFiltre(f.id)} style={pilleStyle(filtre === f.id)}>
            {f.label} ({compteFiltre(f.id)})
          </button>
        ))}
      </div>

      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "6px" }}>
          Parcourir par ville
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button onClick={() => { setVilleChoisie("all"); setSousZoneChoisie("all"); }} style={{ ...pilleStyle(villeChoisie === "all", "var(--teal)"), padding: "5px 12px", fontSize: "12px" }}>
            Toutes les villes
          </button>
          {villes.map(([ville, count]) => (
            <button key={ville} onClick={() => { setVilleChoisie(ville); setSousZoneChoisie("all"); }} style={{ ...pilleStyle(villeChoisie === ville, "var(--teal)"), padding: "5px 12px", fontSize: "12px" }}>
              {ville} ({count})
            </button>
          ))}
        </div>
        {sousZones.length > 0 && (
          <div style={{ marginTop: "10px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button onClick={() => setSousZoneChoisie("all")} style={{ ...pilleStyle(sousZoneChoisie === "all", "var(--gold)"), padding: "4px 10px", fontSize: "11.5px" }}>Tous les quartiers</button>
            {sousZones.map(([sz, count]) => (
              <button key={sz} onClick={() => setSousZoneChoisie(sz)} style={{ ...pilleStyle(sousZoneChoisie === sz, "var(--gold)"), padding: "4px 10px", fontSize: "11.5px" }}>
                {sz.replace(villeChoisie, "").trim() || sz} ({count})
              </button>
            ))}
          </div>
        )}
      </div>

      {villeChoisie !== "all" && <EnAttenteDeVille ville={villeChoisie} />}

      {resultats.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          Aucun Bethel ne correspond à cette recherche / ce filtre.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={thStyle()}>Code Bethel (Church ID)</th>
                <th style={thStyle()}>Responsable</th>
                <th style={thStyle("center")}>Willing ?</th>
                <th style={thStyle("center")}>Membres</th>
                <th style={thStyle()}>Statut</th>
                <th style={thStyle("right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((b, i) => {
                const count = memberCounts[b.bethel_id] || 0;
                const inactif = b.status === "inactive";
                const attente = sansResponsable(b);
                const nomResp = b.leader_full_name || b.leader_name;
                return (
                  <tr key={b.bethel_id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none", opacity: enCours === b.bethel_id ? 0.5 : 1 }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)", fontFamily: "var(--font-mono)" }}>{codeAffiche(b)}</div>
                      <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{b.bethel_name_officiel || b.hp_number}</div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: "var(--ink)" }}>{nomResp && !/^unassigned$/i.test(nomResp) ? nomResp : "—"}</div>
                      {b.leader_email && <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{b.leader_email}</div>}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      {b.leader_willing_to_host === true ? (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", background: "rgba(31,92,78,0.10)", padding: "2px 9px", borderRadius: "999px" }}>Oui</span>
                      ) : b.leader_willing_to_host === false ? (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)", background: "rgba(162,59,51,0.10)", padding: "2px 9px", borderRadius: "999px" }}>Non</span>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--ink-muted)" }} title="Aucune soumission trouvée pour ce responsable (probablement un des groupes importés au début)">—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <span style={{ fontWeight: 600, color: count < 3 && !inactif ? "var(--brick)" : "var(--ink)" }}>{count}</span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontSize: "11px", padding: "2px 9px", borderRadius: "999px", fontWeight: 600,
                        background: inactif ? "rgba(120,120,120,0.15)" : attente ? "rgba(184,134,59,0.12)" : "rgba(31,92,78,0.10)",
                        color: inactif ? "var(--ink-muted)" : attente ? "var(--gold)" : "var(--teal)",
                      }}>
                        {inactif ? "Inactif" : attente ? "En attente" : "Actif"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button onClick={() => setPanneau({ mode: "voir", bethelId: b.bethel_id })} style={btnAction("var(--plum)")}>Voir</button>
                        <button onClick={() => setPanneau({ mode: "ajouter", bethelId: b.bethel_id })} style={btnAction("var(--teal)")}>+ Ajouter un membre</button>
                        <button onClick={() => setPanneau({ mode: "assigner", bethelId: b.bethel_id })} style={btnAction("var(--plum)")}>Assigner des membres</button>
                        <button onClick={() => setPanneau({ mode: "proximite", bethelId: b.bethel_id })} style={btnAction("#E07B1A", true)}>Trouver à proximité</button>
                        <button onClick={() => basculerStatut(b)} style={btnAction(inactif ? "var(--teal)" : "var(--brick)")}>
                          {inactif ? "Réactiver" : "Désactiver"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {bethelPanneau && (
        <BethelSidePanel
          key={`${panneau.mode}-${bethelPanneau.bethel_id}`}
          bethel={bethelPanneau}
          mode={panneau.mode}
          bethels={bethels}
          onClose={() => setPanneau(null)}
          onReload={onReload}
          onOpenDetail={onOpenDetail}
        />
      )}
    </div>
  );
}

function ZoneMismatchReport({ zones, onChanged }) {
  const [loading, setLoading] = useState(true);
  const [mismatches, setMismatches] = useState([]);
  const [fixingId, setFixingId] = useState(null);

  async function scanner() {
    setLoading(true);
    try {
      const tousLesBethels = await supaGet("bethels", "status=eq.active&select=bethel_id,hp_number,leader_name,address,zone_id&limit=5000");
      const zoneById = Object.fromEntries(zones.map((z) => [z.zone_id, z]));

      const trouves = [];
      tousLesBethels.forEach((b) => {
        if (!b.address || b.address === "Adresse à confirmer") return;
        const suggestion = suggererZoneDepuisAdresse(b.address);
        if (!suggestion) return; // pas de suggestion possible, on ne peut pas comparer
        const zoneActuelle = zoneById[b.zone_id];
        if (!zoneActuelle) return;
        if (normaliseNom(zoneActuelle.zone_name) !== normaliseNom(suggestion)) {
          const zoneSuggeree = zones.find((z) => normaliseNom(z.zone_name) === normaliseNom(suggestion));
          trouves.push({
            bethel: b, zoneActuelle: zoneActuelle.zone_name,
            zoneSuggereeNom: suggestion, zoneSuggereeObj: zoneSuggeree,
          });
        }
      });
      setMismatches(trouves);
    } catch (e) {
      setMismatches([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { scanner(); }, [zones]);

  async function corriger(m) {
    if (!m.zoneSuggereeObj) return;
    setFixingId(m.bethel.bethel_id);
    try {
      await supaPatch("bethels", `bethel_id=eq.${m.bethel.bethel_id}`, { zone_id: m.zoneSuggereeObj.zone_id });
      setMismatches((liste) => liste.filter((x) => x.bethel.bethel_id !== m.bethel.bethel_id));
      onChanged && onChanged();
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setFixingId(null);
    }
  }

  const [corrigeantTout, setCorrigeantTout] = useState(false);
  async function corrigerTout() {
    setCorrigeantTout(true);
    const corrigeables = mismatches.filter((m) => m.zoneSuggereeObj);
    for (const m of corrigeables) {
      try {
        await supaPatch("bethels", `bethel_id=eq.${m.bethel.bethel_id}`, { zone_id: m.zoneSuggereeObj.zone_id });
      } catch (e) { /* on continue même si une correction échoue */ }
    }
    setCorrigeantTout(false);
    onChanged && onChanged();
    scanner(); // re-scanne pour confirmer que tout est bien réglé
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
          Compares each Bethel's assigned zone against what its postal code suggests.
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          {mismatches.filter((m) => m.zoneSuggereeObj).length > 0 && (
            <button onClick={corrigerTout} disabled={corrigeantTout || loading} style={{
              display: "flex", alignItems: "center", gap: "5px", padding: "6px 14px", borderRadius: "6px",
              border: "none", background: "var(--plum)", fontSize: "12px", fontWeight: 600, color: "#fff", cursor: "pointer",
            }}>
              {corrigeantTout ? "Fixing all…" : `Fix All (${mismatches.filter((m) => m.zoneSuggereeObj).length})`}
            </button>
          )}
          <button onClick={scanner} disabled={loading} style={{
            display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", borderRadius: "6px",
            border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", color: "var(--ink-muted)", cursor: "pointer",
          }}>
            <RefreshCw size={12} /> Re-scan
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Scanning all active Bethels…</div>
      ) : mismatches.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No mismatches found — every Bethel's zone matches its address. 🎉
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          {mismatches.map((m, i) => (
            <div key={m.bethel.bethel_id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
              borderBottom: i < mismatches.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
            }}>
              <div>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{m.bethel.leader_name} — {m.bethel.hp_number}</div>
                <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>{m.bethel.address}</div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  <span style={{ color: "var(--brick)" }}>{m.zoneActuelle}</span>
                  <span style={{ color: "var(--ink-muted)" }}> → suggested: </span>
                  <span style={{ color: "var(--teal)", fontWeight: 600 }}>{m.zoneSuggereeNom}</span>
                </div>
              </div>
              <button
                disabled={fixingId === m.bethel.bethel_id || !m.zoneSuggereeObj}
                onClick={() => corriger(m)}
                style={{
                  padding: "6px 14px", borderRadius: "6px", border: "none",
                  background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600,
                  cursor: "pointer", flexShrink: 0, marginLeft: "12px",
                }}
              >
                {fixingId === m.bethel.bethel_id ? "…" : "Fix"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DataGapsReport({ bethels }) {
  const [members, setMembers] = useState([]);
  const [bethelsSansLeader, setBethelsSansLeader] = useState([]);
  const [zonesNonVerifiees, setZonesNonVerifiees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sansContact, sansAdresse, sansEmail] = await Promise.all([
          supaGetTout("members", "or=(and(phone.is.null,email.is.null),and(phone.eq.,email.eq.))&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id"),
          supaGetTout("members", "or=(address.is.null,address.eq.)&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id"),
          supaGetTout("members", "or=(email.is.null,email.eq.)&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id"),
        ]);
        const parId = {};
        // Priorité : missing_contact > missing_address > no_email (le plus grave écrase le moins grave)
        sansEmail.forEach((m) => { parId[m.member_id] = { ...m, exception: "no_email" }; });
        sansAdresse.forEach((m) => {
          if (!parId[m.member_id] || parId[m.member_id].exception === "no_email") parId[m.member_id] = { ...m, exception: "missing_address" };
        });
        sansContact.forEach((m) => { parId[m.member_id] = { ...m, exception: "missing_contact" }; });
        setMembers(Object.values(parId));

        // Bethels sans leader (aucun leader_name, ou 0 membre du tout)
        const sansLeader = (bethels || []).filter((b) => !b.leader_name || !b.leader_name.trim());
        setBethelsSansLeader(sansLeader);

        // Bethels avec une zone assignée mais AUCUNE vraie adresse -- la zone est donc
        // juste héritée d'un ancien numéro/préfixe, jamais confirmée par une vraie adresse.
        const nonVerifies = (bethels || []).filter(
          (b) => !b.address || !b.address.trim() || b.address === "Adresse à confirmer"
        );
        setZonesNonVerifiees(nonVerifies);
      } catch (e) {
        setMembers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [bethels]);

  const bethelById = useMemo(() => Object.fromEntries(bethels.map((b) => [b.bethel_id, b])), [bethels]);
  const filtered = filter === "no_leader" ? [] : filter === "all" ? members : members.filter((m) => m.exception === filter);
  const countContact = members.filter((m) => m.exception === "missing_contact").length;
  const countAddress = members.filter((m) => m.exception === "missing_address").length;
  const countEmail = members.filter((m) => m.exception === "no_email").length;
  const countNoLeader = bethelsSansLeader.length;
  const countZoneNonVerifiee = zonesNonVerifiees.length;

  const EXCEPTION_LABELS = {
    missing_contact: { label: "Missing contact", color: "var(--brick)" },
    missing_address: { label: "Missing address", color: "var(--gold)" },
    no_email: { label: "No email", color: "var(--gold)" },
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
        {[
          { id: "all", label: `All (${members.length})` },
          { id: "missing_contact", label: `Missing contact (${countContact})` },
          { id: "missing_address", label: `Missing address (${countAddress})` },
          { id: "no_email", label: `No email (${countEmail})` },
          { id: "no_leader", label: `No leader (${countNoLeader})` },
          { id: "unverified_zone", label: `Unverified zone (${countZoneNonVerifiee})` },
        ].map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${filter === f.id ? "var(--plum)" : "var(--border)"}`,
            background: filter === f.id ? "var(--plum)" : "var(--surface)",
            color: filter === f.id ? "#fff" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {f.label}
          </button>
        ))}
      </div>

      {filter === "no_leader" ? (
        bethelsSansLeader.length === 0 ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
            No Bethels missing a leader. 🎉
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            {bethelsSansLeader.map((b, i) => (
              <div key={b.bethel_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
                borderBottom: i < bethelsSansLeader.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
              }}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{b.hp_number}</div>
                  <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>{b.zone_name}</div>
                </div>
                <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "999px", fontWeight: 600, background: "rgba(162,59,51,0.10)", color: "var(--brick)" }}>
                  No leader
                </span>
              </div>
            ))}
          </div>
        )
      ) : filter === "unverified_zone" ? (
        zonesNonVerifiees.length === 0 ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
            Every Bethel's zone is backed by a real address. 🎉
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", fontSize: "12px", color: "var(--ink-muted)", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
              These Bethels show a zone, but it's inherited from an old numbering prefix — never confirmed by a real address.
            </div>
            {zonesNonVerifiees.map((b, i) => (
              <div key={b.bethel_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
                borderBottom: i < zonesNonVerifiees.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
              }}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{b.leader_name || "—"} — {b.hp_number}</div>
                  <div style={{ fontSize: "12px", color: "var(--gold)", marginTop: "2px" }}>Currently labeled: {b.zone_name}</div>
                </div>
                <span style={{ fontSize: "11px", padding: "3px 10px", borderRadius: "999px", fontWeight: 600, background: "rgba(184,134,59,0.10)", color: "var(--gold)" }}>
                  Unverified
                </span>
              </div>
            ))}
          </div>
        )
      ) : (
      <>
      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Checking members…</div>
      ) : filtered.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No gaps found — every active member has contact info and an address. 🎉
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          {filtered.map((m, i) => {
            const bethel = bethelById[m.bethel_id];
            const ex = EXCEPTION_LABELS[m.exception];
            return (
              <div key={m.member_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
                borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
              }}>
                <div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{m.first_name} {m.last_name}</div>
                  <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>
                    {bethel ? `${bethel.leader_name}'s Bethel · ${bethel.zone_name}` : "Unknown Bethel"}
                  </div>
                </div>
                <span style={{
                  fontSize: "11px", padding: "3px 10px", borderRadius: "999px", fontWeight: 600,
                  background: `${ex.color}18`, color: ex.color,
                }}>
                  {ex.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// Compare l'adresse PERSONNELLE de chaque membre (pas celle du Bethel) à la zone
// suggérée par son propre code postal -- utile pour repérer les membres "cachés"
// dans un Bethel dont le leader pourrait déménager, comme Marie André Luc chez
// Marie Clotilde Luc : si le leader bouge un jour, ce rapport permet de retrouver
// tout de suite qui d'autre dans ce Bethel a une adresse personnelle différente.
function MemberZoneMismatchReport({ zones }) {
  const [loading, setLoading] = useState(true);
  const [mismatches, setMismatches] = useState([]);

  async function scanner() {
    setLoading(true);
    try {
      const membres = await supaGetTout(
        "members",
        "status=eq.active&select=member_id,first_name,last_name,address,bethel_id&order=first_name.asc"
      );
      const bethelsData = await supaGet("bethels", "select=bethel_id,hp_number,leader_name,zone_id&status=eq.active&limit=5000");
      const zoneById = Object.fromEntries(zones.map((z) => [z.zone_id, z]));
      const bethelById = Object.fromEntries(bethelsData.map((b) => [b.bethel_id, b]));

      const trouves = [];
      membres.forEach((m) => {
        if (!m.address || !m.address.trim()) return; // pas d'adresse perso à comparer
        const suggestion = suggererZoneDepuisAdresse(m.address);
        if (!suggestion) return;
        const bethel = bethelById[m.bethel_id];
        if (!bethel) return;
        const zoneActuelle = zoneById[bethel.zone_id];
        if (!zoneActuelle) return;
        if (normaliseNom(zoneActuelle.zone_name) !== normaliseNom(suggestion)) {
          trouves.push({
            membre: m, bethel, zoneActuelleNom: zoneActuelle.zone_name, zoneSuggereeNom: suggestion,
          });
        }
      });
      setMismatches(trouves);
    } catch (e) {
      setMismatches([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { scanner(); }, [zones]);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <span style={{ fontSize: "13px", color: "var(--ink-muted)" }}>
          Compares each member's own address against their Bethel's zone -- catches people "hidden" inside a group whose leader might move.
        </span>
        <button onClick={scanner} disabled={loading} style={{
          display: "flex", alignItems: "center", gap: "5px", padding: "6px 12px", borderRadius: "6px",
          border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", color: "var(--ink-muted)", cursor: "pointer",
        }}>
          <RefreshCw size={12} /> Re-scan
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Scanning all active members…</div>
      ) : mismatches.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No mismatches found -- every member's own address matches their Bethel's zone. 🎉
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          {mismatches.map((m, i) => (
            <div key={m.membre.member_id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px",
              borderBottom: i < mismatches.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
            }}>
              <div>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>{m.membre.first_name} {m.membre.last_name}</div>
                <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>{m.membre.address}</div>
                <div style={{ fontSize: "12px", marginTop: "4px" }}>
                  In <strong>{m.bethel.leader_name}</strong>'s Bethel ({m.bethel.hp_number}) —
                  <span style={{ color: "var(--brick)" }}> {m.zoneActuelleNom}</span>
                  <span style={{ color: "var(--ink-muted)" }}> but their own address suggests </span>
                  <span style={{ color: "var(--teal)", fontWeight: 600 }}>{m.zoneSuggereeNom}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// Pas encore de colonne "pastor" dans le schéma -- un seul campus/pasteur existe
// aujourd'hui, donc on le fixe ici. Le jour où members.pastor_name (ou une table
// pastors) existe, remplacer cette constante par une vraie valeur lue en base.
const CAMPUS_PASTOR = "Stanley St-Georges";

function estValeurVide(v) {
  return !v || !String(v).trim() || String(v).trim().toUpperCase() === "UNASSIGNED";
}

// Compare deux noms sans tenir compte des accents, de la casse ni des espaces multiples.
function normaliserNom(v) {
  return String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

// Lecture seule de la copie du Google Sheet (table supervision_sheet) : renvoie
// { bethel_id: [lignes] } pour afficher le ministre et l'overseer à côté d'un Bethel proposé.
// En cas d'erreur, renvoie {} et rien ne s'affiche : les listes fonctionnent comme avant.
function useSupervisionParBethel() {
  const [parBethel, setParBethel] = useState({});
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const rows = await supaGetTout("supervision_sheet", "actif=eq.true&bethel_id=not.is.null&select=bethel_id,ministre,overseer,leader");
        if (annule) return;
        const m = {};
        rows.forEach((r) => { (m[r.bethel_id] = m[r.bethel_id] || []).push(r); });
        setParBethel(m);
      } catch (e) { /* silencieux : affichage optionnel */ }
    })();
    return () => { annule = true; };
  }, []);
  return parBethel;
}

// Nombre de membres actifs par Bethel (lecture seule), pour l'afficher dans les listes de Bethels proposés.
// Renvoie null tant que ce n'est pas chargé (ou en cas d'erreur) : rien ne s'affiche alors.
function useNombreMembresParBethel() {
  const [nb, setNb] = useState(null);
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const rows = await supaGetTout("members", "status=eq.active&bethel_id=not.is.null&select=bethel_id");
        if (annule) return;
        const m = {};
        rows.forEach((r) => { m[r.bethel_id] = (m[r.bethel_id] || 0) + 1; });
        setNb(m);
      } catch (e) { /* silencieux : affichage optionnel */ }
    })();
    return () => { annule = true; };
  }, []);
  return nb;
}

// Petite ligne grise « Ministre · Overseer · N membres » sous un Bethel proposé.
// Rien si on n'a ni information de supervision ni nombre de membres.
function LigneSupervisionBethel({ rows, nbMembres }) {
  const aSup = rows && rows.length > 0;
  const aNb = nbMembres !== null && nbMembres !== undefined;
  if (!aSup && !aNb) return null;
  let texte = "";
  if (aSup) {
    const r = rows.find((x) => !estValeurVide(x.ministre) || !estValeurVide(x.overseer)) || rows[0];
    const ministre = estValeurVide(r.ministre) ? "" : r.ministre;
    const overseer = estValeurVide(r.overseer) ? "" : r.overseer;
    const ministreLeader = ministre && !estValeurVide(r.leader) && normaliserNom(ministre) === normaliserNom(r.leader);
    texte = ministreLeader
      ? `Ministre-leader : ${ministre}`
      : `Ministre : ${ministre || "non renseigné"} · Overseer : ${overseer || "non renseigné"}`;
  }
  if (aNb) texte += `${texte ? " · " : ""}${nbMembres} membre${nbMembres > 1 ? "s" : ""}`;
  return <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "2px" }}>{texte}</div>;
}

// Fenêtre en lecture seule : liste des membres d'un Bethel (aucune modification possible).
function MembresBethelModal({ bethelId, titre, onClose }) {
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(null);
  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const data = await supaGet("members", `bethel_id=eq.${bethelId}&select=first_name,last_name,role,phone,status&order=role.asc,first_name.asc`);
        if (!annule) setMembres(data);
      } catch (e) {
        if (!annule) setErreur(e.message);
      } finally {
        if (!annule) setLoading(false);
      }
    })();
    return () => { annule = true; };
  }, [bethelId]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px" }} onClick={onClose}>
      <div style={{ background: "var(--surface)", borderRadius: "14px", width: "460px", maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", padding: "24px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0, color: "var(--ink)" }}>Membres du Bethel</h2>
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "4px", fontFamily: "var(--font-mono)" }}>{titre}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", fontSize: "18px", padding: "4px" }}>✕</button>
        </div>
        <div style={{ marginTop: "14px", overflowY: "auto" }}>
          {loading && <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Chargement…</div>}
          {erreur && <div style={{ fontSize: "13px", color: "var(--brick)" }}>Impossible de charger les membres : {erreur}</div>}
          {!loading && !erreur && membres.length === 0 && <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Aucun membre enregistré pour ce Bethel.</div>}
          {!loading && !erreur && membres.length > 0 && (
            <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginBottom: "8px" }}>{membres.length} membre{membres.length > 1 ? "s" : ""}</div>
          )}
          {membres.map((m, i) => (
            <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: "10px" }}>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{m.first_name} {m.last_name}</div>
                <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{m.role || "Membre"}{m.status === "inactive" ? " · inactif" : ""}</div>
              </div>
              <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>{m.phone || ""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BethelSupervisionReport() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rows, setRows] = useState([]);
  const [subTab, setSubTab] = useState("bypastor");
  const [drawerBethelId, setDrawerBethelId] = useState(null);
  const [filtreType, setFiltreType] = useState("officiels"); // "officiels" | "anciens" | "tous"
  const [membresAnciens, setMembresAnciens] = useState([]); // membres encore logés dans un ancien groupe (bassin HP)
  const [ministersList, setMinistersList] = useState([]);
  const [overseersList, setOverseersList] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [bethelsData, membersData, zonesData] = await Promise.all([
          supaGetTout("bethels", "status=eq.active&select=bethel_id,hp_number,church_id,bethel_name_officiel,leader_name,zone_id"),
          supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,bethel_id,overseer_name,ordained_minister_name,bethel_leader_name,postal_code,city,address"),
          supaGetTout("data_zones", "is_active=eq.true&select=zone_id,zone_code,zone_name"),
        ]);

        const zoneById = Object.fromEntries(zonesData.map((z) => [z.zone_id, z]));
        const membresParBethel = {};
        membersData.forEach((m) => {
          if (!m.bethel_id) return;
          (membresParBethel[m.bethel_id] = membresParBethel[m.bethel_id] || []).push(m);
        });

        // Listes de candidats pour les sélecteurs [Change] du panneau latéral
        const nomsMinistres = Array.from(new Set(
          membersData.filter((m) => m.role === "Ministre Ordonné").map((m) => `${m.first_name} ${m.last_name}`.trim())
        )).sort();
        const nomsOverseers = Array.from(new Set(
          membersData.filter((m) => m.role === "Overseer").map((m) => `${m.first_name} ${m.last_name}`.trim())
        )).sort();
        setMinistersList(nomsMinistres);
        setOverseersList(nomsOverseers);

        // Bethel "officiel" = nom officiel renseigné OU code déjà au format Bethel-Ville-000000.
        // Tout le reste (BETHEL-MTL-.., BETHEL-LVL-.., BETHEL-RPT-.., FORM-..) = ancien groupe / bassin HP.
        const estOfficiel = (b) => !!b.bethel_name_officiel || /^bethel-.+-\d{6}$/i.test(b.hp_number || "");
        const anciensParId = Object.fromEntries(bethelsData.filter((b) => !estOfficiel(b)).map((b) => [b.bethel_id, b]));
        setMembresAnciens(
          membersData
            .filter((m) => m.bethel_id && anciensParId[m.bethel_id])
            .map((m) => ({ ...m, ancienCode: anciensParId[m.bethel_id].hp_number }))
        );

        const construites = bethelsData.map((b) => {
          const equipe = membresParBethel[b.bethel_id] || [];
          const leaderMembre = equipe.find((m) => m.role === "Bethel Leader") || null;
          // Pas de "Bethel Leader" formel ? On prend n'importe quel membre de ce Bethel
          // pour récupérer la chaîne minister/overseer déjà renseignée sur sa fiche --
          // c'est la même donnée dénormalisée partout dans ce Bethel (voir synchro Shekinah).
          const reference = leaderMembre || equipe[0] || null;

          const minister = reference?.ordained_minister_name || "";
          const overseer = reference?.overseer_name || "";
          const bethelLeader = leaderMembre
            ? `${leaderMembre.first_name} ${leaderMembre.last_name}`
            : (b.leader_name || "");

          const zone = zoneById[b.zone_id];
          // Un Ministre Ordonné qui dirige lui-même son Bethel est son propre ministre et
          // n'a pas d'overseer : c'est le pasteur de campus qui le supervise directement.
          const ministreDirige =
            !estValeurVide(bethelLeader) &&
            (normaliserNom(minister) === normaliserNom(bethelLeader) ||
              equipe.some((m) => m.role === "Ministre Ordonné" &&
                normaliserNom(`${m.first_name} ${m.last_name}`) === normaliserNom(bethelLeader)));
          const ministerAffiche = ministreDirige && estValeurVide(minister) ? bethelLeader : minister;
          const missingMinister = estValeurVide(ministerAffiche);
          const missingOverseer = ministreDirige ? false : estValeurVide(overseer);
          const missingLeader = estValeurVide(bethelLeader);

          return {
            bethelId: b.bethel_id,
            pastor: CAMPUS_PASTOR,
            ministreDirige,
            minister: ministerAffiche, overseer, bethelLeader,
            churchId: b.church_id || "",
            bethelName: b.bethel_name_officiel || b.hp_number,
            zone: zone?.zone_code || zone?.zone_name || "—",
            isOfficiel: estOfficiel(b),
            zoneId: b.zone_id,
            hasAnyMember: equipe.length > 0,
            missingMinister, missingOverseer, missingLeader,
            chainComplete: !missingMinister && !missingOverseer && !missingLeader,
          };
        });

        setRows(construites);
      } catch (e) {
        setLoadError(e.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // --- Agrégations partagées entre les 5 sous-onglets ---

  const nbOfficiels = useMemo(() => rows.filter((r) => r.isOfficiel).length, [rows]);
  const nbAnciens = rows.length - nbOfficiels;
  const rowsVue = useMemo(
    () => rows.filter((r) => filtreType === "tous" || (filtreType === "officiels" ? r.isOfficiel : !r.isOfficiel)),
    [rows, filtreType]
  );

  const parPasteur = useMemo(() => {
    const groupes = {};
    rowsVue.forEach((r) => {
      if (!groupes[r.pastor]) groupes[r.pastor] = [];
      groupes[r.pastor].push(r);
    });
    return groupes;
  }, [rowsVue]);

  const resumeParPasteur = useMemo(() => {
    return Object.entries(parPasteur).map(([pastor, rs]) => {
      const ministers = new Set(rs.map((r) => r.minister).filter((v) => !estValeurVide(v)));
      const overseers = new Set(rs.map((r) => r.overseer).filter((v) => !estValeurVide(v)));
      const incomplete = rs.filter((r) => !r.chainComplete).length;
      const priority = incomplete > 5 ? "High" : incomplete > 0 ? "Medium" : "Low";
      return { pastor, ministers: ministers.size, overseers: overseers.size, bethels: rs.length, incomplete, priority };
    });
  }, [parPasteur]);

  const parMinistre = useMemo(() => {
    const groupes = {};
    rowsVue.forEach((r) => {
      const cle = `${r.pastor}||${r.minister || "(unassigned)"}`;
      if (!groupes[cle]) groupes[cle] = { pastor: r.pastor, minister: r.minister || "Non assigné", rows: [] };
      groupes[cle].rows.push(r);
    });
    return Object.values(groupes).map((g) => {
      const overseers = new Set(g.rows.map((r) => r.overseer).filter((v) => !estValeurVide(v)));
      const missingOverseer = g.rows.filter((r) => r.missingOverseer).length;
      const missingLeader = g.rows.filter((r) => r.missingLeader).length;
      return {
        pastor: g.pastor, minister: g.minister,
        overseers: overseers.size, bethels: g.rows.length,
        missingOverseer, missingLeader,
        needsReview: missingOverseer > 0 || missingLeader > 0,
      };
    });
  }, [rowsVue]);

  function actionRequise(missingPastor, missingMinister, missingOverseer, missingLeader) {
    const actions = [];
    if (missingPastor) actions.push("Attribuer un Pasteur");
    if (missingMinister) actions.push("Attribuer un Ministre");
    if (missingOverseer) actions.push("Attribuer un Superviseur");
    if (missingLeader) actions.push("Attribuer un Responsable de Bethel");
    return actions.join("; ") || "—";
  }

  const incompletes = useMemo(() => rowsVue.filter((r) => !r.chainComplete), [rowsVue]);

  const qualiteDonnees = useMemo(() => {
    const missingMinisterCount = rowsVue.filter((r) => r.missingMinister).length;
    const missingOverseerCount = rowsVue.filter((r) => r.missingOverseer).length;
    const missingLeaderCount = rowsVue.filter((r) => r.missingLeader).length;
    const noRecordCount = rowsVue.filter((r) => !r.hasAnyMember).length;
    return { missingMinisterCount, missingOverseerCount, missingLeaderCount, noRecordCount };
  }, [rowsVue]);

  // --- Édition en direct de la chaîne de supervision depuis le panneau latéral ---
  // Le nom est dénormalisé sur chaque fiche membre du Bethel : on met donc à jour
  // TOUS les membres de ce bethel_id (comme pour les mises à jour précédentes de ce type).
  async function majChaineSupervision(bethelId, champ, valeur) {
    const colonne = champ === "minister" ? "ordained_minister_name" : "overseer_name";
    await supaPatch("members", `bethel_id=eq.${bethelId}`, { [colonne]: valeur || null });
    setRows((prev) => prev.map((r) => {
      if (r.bethelId !== bethelId) return r;
      const maj = { ...r, [champ]: valeur || "" };
      maj.missingMinister = estValeurVide(maj.minister);
      maj.missingOverseer = r.ministreDirige ? false : estValeurVide(maj.overseer);
      maj.missingLeader = estValeurVide(maj.bethelLeader);
      maj.chainComplete = !maj.missingMinister && !maj.missingOverseer && !maj.missingLeader;
      return maj;
    }));
  }

  // --- Petits composants d'affichage réutilisés dans les 5 sous-onglets ---

  function PilleHealth({ complete }) {
    return (
      <span style={{
        fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "999px",
        background: complete ? "rgba(31,92,78,0.10)" : "rgba(162,59,51,0.10)",
        color: complete ? "var(--teal)" : "var(--brick)",
      }}>
        {complete ? "Complet" : "À réviser"}
      </span>
    );
  }

  function PilleChain({ r }) {
    const etapes = [
      { ok: !r.missingMinister, label: "M" },
      { ok: !r.missingOverseer, label: "O" },
      { ok: !r.missingLeader, label: "L" },
    ];
    return (
      <span style={{ display: "inline-flex", gap: "3px" }}>
        {etapes.map((e, i) => (
          <span key={i} title={e.label} style={{
            width: "18px", height: "18px", borderRadius: "5px", fontSize: "10px", fontWeight: 700,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            background: e.ok ? "rgba(31,92,78,0.12)" : "rgba(162,59,51,0.12)",
            color: e.ok ? "var(--teal)" : "var(--brick)",
          }}>{e.label}</span>
        ))}
      </span>
    );
  }

  function PilleReview({ needsReview }) {
    return (
      <span style={{
        fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "999px",
        background: needsReview ? "rgba(184,134,59,0.12)" : "rgba(31,92,78,0.10)",
        color: needsReview ? "var(--gold)" : "var(--teal)",
      }}>
        {needsReview ? "À réviser" : "Conforme"}
      </span>
    );
  }

  // --- Panneau latéral coulissant (drawer) : détail + édition de la chaîne de supervision ---
  function BethelDrawer({ row, onClose }) {
    const [editingField, setEditingField] = useState(null); // "minister" | "overseer" | null
    const [saving, setSaving] = useState(false);
    const [drawerTab, setDrawerTab] = useState("chain");

    // Les 3 sections ci-dessous n'ont pas encore de table dédiée dans la base :
    // elles restent donc locales à cette session du panneau (non persistées côté Supabase).
    const [rolesSpirituels, setRolesSpirituels] = useState([]);
    const [personneRole, setPersonneRole] = useState("");
    const [roleChoisi, setRoleChoisi] = useState("");
    const [visites, setVisites] = useState([]);
    const [nouvelleVisiteOuverte, setNouvelleVisiteOuverte] = useState(false);
    const [visiteDate, setVisiteDate] = useState("");
    const [visiteNote, setVisiteNote] = useState("");
    const [notes, setNotes] = useState([]);
    const [nouvelleNoteOuverte, setNouvelleNoteOuverte] = useState(false);
    const [texteNote, setTexteNote] = useState("");
    const [rechercheAncien, setRechercheAncien] = useState("");
    const [transfertEnCours, setTransfertEnCours] = useState(null);

    if (!row) return null;

    const resultatsAnciens = (() => {
      const q = normaliseNom(rechercheAncien);
      const qBrut = rechercheAncien.trim().toLowerCase().replace(/\s+/g, "");
      if (q.length < 2 && qBrut.length < 3) return [];
      return membresAnciens.filter((m) => {
        const texte = normaliseNom(`${m.first_name} ${m.last_name} ${m.city || ""} ${m.address || ""}`);
        const cp = (m.postal_code || "").toLowerCase().replace(/\s+/g, "");
        return (q.length >= 2 && texte.includes(q)) || (qBrut.length >= 3 && cp.startsWith(qBrut));
      }).slice(0, 30);
    })();

    // Extraction d'UN membre d'un ancien groupe vers ce Bethel officiel.
    // L'ancien groupe n'est jamais modifié ni supprimé : seul ce membre change de bethel_id
    // (la fonction fn_assign_member_to_bethel recopie aussi sa chaîne de supervision).
    async function transfererMembre(m) {
      const nom = `${m.first_name} ${m.last_name}`;
      if (!window.confirm(`Transférer ${nom} de ${m.ancienCode} vers ${row.bethelName} ?`)) return;
      setTransfertEnCours(m.member_id);
      try {
        await supaRpc("fn_assign_member_to_bethel", { p_member_id: m.member_id, p_bethel_id: row.bethelId });
        setMembresAnciens((prev) => prev.filter((x) => x.member_id !== m.member_id));
        setRows((prev) => prev.map((r) => (r.bethelId === row.bethelId ? { ...r, hasAnyMember: true } : r)));
      } catch (e) {
        alert("Transfert impossible : " + e.message);
      } finally {
        setTransfertEnCours(null);
      }
    }

    async function appliquer(champ, valeur) {
      setSaving(true);
      try {
        await majChaineSupervision(row.bethelId, champ, valeur);
        setEditingField(null);
      } catch (e) {
        alert("Erreur lors de la mise à jour : " + e.message);
      } finally {
        setSaving(false);
      }
    }

    function attribuerRoleSpirituel() {
      if (!personneRole.trim() || !roleChoisi) return;
      setRolesSpirituels((prev) => [...prev, { personne: personneRole.trim(), role: roleChoisi }]);
      setPersonneRole("");
      setRoleChoisi("");
    }

    function ajouterVisite() {
      if (!visiteDate) return;
      setVisites((prev) => [{ date: visiteDate, note: visiteNote.trim() }, ...prev]);
      setVisiteDate("");
      setVisiteNote("");
      setNouvelleVisiteOuverte(false);
    }

    function ajouterNote() {
      if (!texteNote.trim()) return;
      setNotes((prev) => [{ texte: texteNote.trim(), date: new Date().toLocaleDateString("fr-CA") }, ...prev]);
      setTexteNote("");
      setNouvelleNoteOuverte(false);
    }

    const DRAWER_TABS = [
      { id: "chain", label: "Chaîne" },
      { id: "spiritual", label: "Rôles spirituels" },
      { id: "visits", label: "Historique des visites" },
      { id: "notes", label: "Notes" },
      ...(row.isOfficiel ? [{ id: "extraction", label: "Extraction" }] : []),
    ];

    const ROLES_CHAINE = ["Pasteur", "Ministre", "Superviseur"];
    const ROLES_SPIRITUELS_AUTRES = ["Ananias", "Responsable de Bethel", "Louange", "Intercession", "Accueil"];

    function BlocChaine({ titre, valeur, champ, options, editable }) {
      const enEdition = editingField === champ;
      return (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "14px", marginBottom: "12px" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>
            {titre}
          </div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)", marginBottom: "10px" }}>
            {!estValeurVide(valeur) ? valeur : <span style={{ color: "var(--brick)", fontWeight: 600 }}>Non assigné</span>}
          </div>
          {enEdition ? (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <select
                defaultValue=""
                disabled={saving}
                onChange={(e) => e.target.value && appliquer(champ, e.target.value)}
                style={{ flex: 1, padding: "6px 8px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px" }}
              >
                <option value="" disabled>Sélectionner un {titre.toLowerCase()}…</option>
                {options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <button onClick={() => setEditingField(null)} disabled={saving} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>Annuler</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => appliquer(champ, null)}
                disabled={!editable || saving || estValeurVide(valeur)}
                style={{ padding: "5px 12px", borderRadius: "999px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-muted)", fontSize: "11.5px", fontWeight: 600, cursor: (editable && !estValeurVide(valeur)) ? "pointer" : "not-allowed", opacity: (editable && !estValeurVide(valeur)) ? 1 : 0.5 }}
              >
                Effacer
              </button>
              <button
                onClick={() => setEditingField(champ)}
                disabled={!editable || saving}
                style={{ padding: "5px 12px", borderRadius: "999px", border: "1px solid var(--plum)", background: "var(--plum)", color: "#fff", fontSize: "11.5px", fontWeight: 600, cursor: editable ? "pointer" : "not-allowed", opacity: editable ? 1 : 0.5 }}
              >
                Modifier
              </button>
            </div>
          )}
          {!editable && (
            <div style={{ fontSize: "10.5px", color: "var(--ink-muted)", marginTop: "6px" }}>
              Pas encore modifiable — aucun champ d'attribution de Pasteur n'existe dans le modèle de données.
            </div>
          )}
        </div>
      );
    }

    return (
      <>
        <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,16,20,0.35)", zIndex: 60 }} />
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "420px", maxWidth: "92vw",
          background: "var(--surface)", borderLeft: "1px solid var(--border)", boxShadow: "-12px 0 32px rgba(0,0,0,0.18)",
          zIndex: 61, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>{row.bethelName}</div>
                <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "2px" }}>
                  {row.zone} · {row.churchId || "—"}
                </div>
              </div>
              <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--ink-muted)", fontSize: "20px", lineHeight: 1, padding: "4px" }}>×</button>
            </div>
            <div style={{ marginTop: "10px" }}>
              <PilleHealth complete={row.chainComplete} />
            </div>
            <div style={{ marginTop: "12px", fontSize: "12.5px", color: "var(--ink-muted)", lineHeight: 1.7 }}>
              <div><strong style={{ color: "var(--ink)" }}>Ministre :</strong> {row.minister || "—"}</div>
              <div><strong style={{ color: "var(--ink)" }}>Superviseur :</strong> {row.overseer || "—"}</div>
              <div><strong style={{ color: "var(--ink)" }}>Responsable :</strong> {row.bethelLeader || "—"}</div>
              <div><strong style={{ color: "var(--ink)" }}>Dernière visite :</strong> {visites[0] ? visites[0].date : "—"} <span style={{ fontSize: "11px" }}>{visites[0] ? "" : "(aucune donnée pour le moment)"}</span></div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "4px", padding: "10px 20px 0", borderBottom: "1px solid var(--border)" }}>
            {DRAWER_TABS.map((t) => (
              <button key={t.id} onClick={() => setDrawerTab(t.id)} style={{
                padding: "7px 12px", fontSize: "12px", fontWeight: 600, border: "none", borderBottom: `2px solid ${drawerTab === t.id ? "var(--plum)" : "transparent"}`,
                background: "transparent", color: drawerTab === t.id ? "var(--plum)" : "var(--ink-muted)", cursor: "pointer",
              }}>
                {t.label}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: "18px 20px" }}>
            {drawerTab === "chain" && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "12px" }}>Chaîne de supervision</div>
                <BlocChaine titre="Pasteur" valeur={row.pastor} champ="pastor" options={[]} editable={false} />
                <BlocChaine titre="Ministre" valeur={row.minister} champ="minister" options={ministersList} editable={true} />
                <BlocChaine titre="Superviseur" valeur={row.overseer} champ="overseer" options={overseersList} editable={true} />
              </div>
            )}

            {drawerTab === "spiritual" && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "4px" }}>Attribuer un rôle spirituel</div>
                <p style={{ fontSize: "11.5px", color: "var(--ink-muted)", margin: "0 0 12px", lineHeight: 1.5 }}>
                  Attribuez un rôle de croissance spirituelle. Les rôles de la chaîne (Pasteur, Ministre, Superviseur) les rendent sélectionnables dans la chaîne de supervision.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>Personne</div>
                    <input
                      value={personneRole}
                      onChange={(e) => setPersonneRole(e.target.value)}
                      placeholder="Rechercher par nom..."
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px" }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" }}>Rôle</div>
                    <select
                      value={roleChoisi}
                      onChange={(e) => setRoleChoisi(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px" }}
                    >
                      <option value="">Sélectionner un rôle...</option>
                      {[...ROLES_CHAINE, ...ROLES_SPIRITUELS_AUTRES].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={attribuerRoleSpirituel}
                    disabled={!personneRole.trim() || !roleChoisi}
                    style={{ padding: "7px 12px", borderRadius: "8px", border: "1px solid var(--plum)", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: (!personneRole.trim() || !roleChoisi) ? "not-allowed" : "pointer", opacity: (!personneRole.trim() || !roleChoisi) ? 0.5 : 1 }}
                  >
                    Attribuer le rôle
                  </button>
                </div>
                {rolesSpirituels.length === 0 ? (
                  <div style={{ color: "var(--ink-muted)", fontSize: "12.5px", textAlign: "center", padding: "20px 10px", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                    Aucun rôle attribué durant cette session.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {rolesSpirituels.map((r, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12.5px" }}>
                        <span>{r.personne}</span>
                        <span style={{ color: "var(--plum)", fontWeight: 600 }}>{r.role}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {drawerTab === "visits" && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                  <button
                    onClick={() => setNouvelleVisiteOuverte((v) => !v)}
                    style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--plum)", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                  >
                    + Nouvelle visite
                  </button>
                </div>
                {nouvelleVisiteOuverte && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <input type="date" value={visiteDate} onChange={(e) => setVisiteDate(e.target.value)} style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "12.5px" }} />
                    <textarea value={visiteNote} onChange={(e) => setVisiteNote(e.target.value)} placeholder="Notes de la visite..." rows={3} style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "12.5px", resize: "vertical" }} />
                    <button onClick={ajouterVisite} disabled={!visiteDate} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", fontWeight: 600, cursor: !visiteDate ? "not-allowed" : "pointer", opacity: !visiteDate ? 0.5 : 1 }}>Enregistrer</button>
                  </div>
                )}
                {visites.length === 0 ? (
                  <div style={{ color: "var(--ink-muted)", fontSize: "13px", textAlign: "center", padding: "30px 10px" }}>
                    Aucune visite de supervision enregistrée pour le moment.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {visites.map((v, i) => (
                      <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px" }}>
                        <div style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--plum)" }}>{v.date}</div>
                        {v.note && <div style={{ fontSize: "12.5px", color: "var(--ink)", marginTop: "2px" }}>{v.note}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {drawerTab === "extraction" && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "4px" }}>Extraire un membre d'un ancien groupe</div>
                <p style={{ fontSize: "11.5px", color: "var(--ink-muted)", margin: "0 0 10px", lineHeight: 1.5 }}>
                  Cherchez par nom, ville, adresse ou code postal parmi les membres encore logés dans un ancien groupe (BETHEL-MTL-…, FORM-…). Le transfert se fait un membre à la fois ; l'ancien groupe est conservé.
                </p>
                <input
                  value={rechercheAncien}
                  onChange={(e) => setRechercheAncien(e.target.value)}
                  placeholder="Nom, ville ou code postal (ex: H1G)…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px", marginBottom: "10px" }}
                />
                {resultatsAnciens.length === 0 ? (
                  <div style={{ color: "var(--ink-muted)", fontSize: "12.5px", textAlign: "center", padding: "20px 10px", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                    {rechercheAncien.trim() ? "Aucun membre trouvé dans les anciens groupes." : `${membresAnciens.length} membres dans les anciens groupes — lancez une recherche.`}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {resultatsAnciens.map((m) => (
                      <div key={m.member_id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px", display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "12.5px", fontWeight: 600 }}>{m.first_name} {m.last_name}</div>
                          <div style={{ fontSize: "11px", color: "var(--ink-muted)" }}>{[m.address, m.city, m.postal_code].filter(Boolean).join(" · ") || "Adresse non renseignée"}</div>
                          <div style={{ fontSize: "10.5px", fontFamily: "var(--font-mono)", color: "var(--ink-muted)" }}>{m.ancienCode}</div>
                        </div>
                        <button
                          onClick={() => transfererMembre(m)}
                          disabled={transfertEnCours === m.member_id}
                          style={{ padding: "5px 10px", borderRadius: "999px", border: "1px solid var(--plum)", background: "var(--plum)", color: "#fff", fontSize: "11px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", opacity: transfertEnCours === m.member_id ? 0.5 : 1 }}
                        >
                          Transférer ici
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {drawerTab === "notes" && (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                  <button
                    onClick={() => setNouvelleNoteOuverte((v) => !v)}
                    style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--plum)", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                  >
                    Ajouter une note
                  </button>
                </div>
                {nouvelleNoteOuverte && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", marginBottom: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
                    <textarea value={texteNote} onChange={(e) => setTexteNote(e.target.value)} placeholder="Écrire une note..." rows={3} style={{ padding: "6px 8px", borderRadius: "6px", border: "1px solid var(--border)", fontSize: "12.5px", resize: "vertical" }} />
                    <button onClick={ajouterNote} disabled={!texteNote.trim()} style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", fontWeight: 600, cursor: !texteNote.trim() ? "not-allowed" : "pointer", opacity: !texteNote.trim() ? 0.5 : 1 }}>Enregistrer</button>
                  </div>
                )}
                {notes.length === 0 ? (
                  <div style={{ color: "var(--ink-muted)", fontSize: "13px", textAlign: "center", padding: "30px 10px" }}>
                    Aucune note enregistrée pour le moment.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {notes.map((n, i) => (
                      <div key={i} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 10px" }}>
                        <div style={{ fontSize: "11px", color: "var(--ink-muted)" }}>{n.date}</div>
                        <div style={{ fontSize: "12.5px", color: "var(--ink)", marginTop: "2px" }}>{n.texte}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  const SOUS_ONGLETS = [
    { id: "bypastor", label: "Par Pasteur" },
    { id: "summary", label: "Résumé" },
    { id: "leadership", label: "Leadership" },
    { id: "actionview", label: "Actions requises" },
    { id: "dataquality", label: "Qualité des données" },
    { id: "fichiersheet", label: "Fichier Google Sheet" },
  ];

  const thStyle = { padding: "8px 10px", textAlign: "left", fontSize: "10.5px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid var(--border)" };
  const tdStyle = { padding: "9px 10px", fontSize: "12.5px", color: "var(--ink)", borderBottom: "1px solid var(--border)" };

  if (loading) {
    return <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Chargement de la chaîne de supervision…</div>;
  }
  if (loadError) {
    return <div style={{ fontSize: "13px", color: "var(--brick)" }}>Erreur : {loadError}</div>;
  }

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: "0 0 4px" }}>Supervision des Bethels</h2>
      <p style={{ color: "var(--ink-muted)", fontSize: "13px", margin: "0 0 16px" }}>
        Chaîne de supervision : Pasteur → Ministre → Superviseur → Responsable de Bethel → Bethel · TG Montréal
      </p>

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap", alignItems: "center" }}>
        {[
          { id: "officiels", label: `Bethels officiels (${nbOfficiels})` },
          { id: "anciens", label: `Anciens groupes / Bassin HP (${nbAnciens})` },
          { id: "tous", label: `Tous (${rows.length})` },
        ].map((f) => (
          <button key={f.id} onClick={() => setFiltreType(f.id)} style={{
            padding: "5px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            border: `1px solid ${filtreType === f.id ? "var(--teal)" : "var(--border)"}`,
            background: filtreType === f.id ? "rgba(31,92,78,0.10)" : "var(--surface)",
            color: filtreType === f.id ? "var(--teal)" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {f.label}
          </button>
        ))}
      </div>
      {filtreType === "anciens" && (
        <p style={{ color: "var(--ink-muted)", fontSize: "12px", margin: "0 0 14px" }}>
          Anciens groupes historiques (BETHEL-MTL-…, BETHEL-LVL-…, FORM-…) : ils sont conservés tels quels comme réservoir de membres et ne sont jamais supprimés. Les membres en sont extraits un par un depuis la fiche d'un Bethel officiel (onglet « Extraction »).
        </p>
      )}

      <div style={{ display: "flex", gap: "6px", marginBottom: "18px", flexWrap: "wrap" }}>
        {SOUS_ONGLETS.map((t) => (
          <button key={t.id} onClick={() => setSubTab(t.id)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${subTab === t.id ? "var(--plum)" : "var(--border)"}`,
            background: subTab === t.id ? "var(--plum)" : "var(--surface)",
            color: subTab === t.id ? "#fff" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "bypastor" && (
        <div>
          <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginBottom: "20px" }}>
            <StatCard label="Groupes pastoraux" value={Object.keys(parPasteur).length} />
            <StatCard label="Ministres" value={new Set(rowsVue.map((r) => r.minister).filter((v) => !estValeurVide(v))).size} accent="var(--plum)" />
            <StatCard label="Superviseurs" value={new Set(rowsVue.map((r) => r.overseer).filter((v) => !estValeurVide(v))).size} accent="var(--teal)" />
            <StatCard label="Bethels" value={rowsVue.length} />
            <StatCard label="À réviser" value={incompletes.length} accent={incompletes.length ? "var(--brick)" : "var(--teal)"} />
          </div>

          {Object.entries(parPasteur).map(([pastor, rs]) => (
            <div key={pastor} style={{ marginBottom: "22px" }}>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--plum)", marginBottom: "8px" }}>
                Pasteur {pastor}
              </div>
              <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ background: "var(--bg)" }}>
                      <th style={thStyle}>Ministre</th>
                      <th style={thStyle}>Superviseur</th>
                      <th style={thStyle}>Responsable Bethel</th>
                      <th style={thStyle}>Code Bethel (Church ID)</th>
                      <th style={thStyle}>Nom du Bethel</th>
                      <th style={thStyle}>Zone</th>
                      <th style={thStyle}>Chaîne</th>
                      <th style={thStyle}>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rs.map((r) => (
                      <tr
                        key={r.bethelId}
                        className="bsr-clickable-row"
                        onClick={() => setDrawerBethelId(r.bethelId)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={tdStyle}>{r.minister || "—"}</td>
                        <td style={tdStyle}>{r.overseer || "—"}</td>
                        <td style={tdStyle}>{r.bethelLeader || "—"}</td>
                        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-muted)" }}>{r.churchId || "—"}</td>
                        <td style={tdStyle}>{r.bethelName}</td>
                        <td style={tdStyle}>{r.zone}</td>
                        <td style={tdStyle}><PilleChain r={r} /></td>
                        <td style={tdStyle}><PilleHealth complete={r.chainComplete} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {subTab === "summary" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={thStyle}>Pasteur</th>
                <th style={thStyle}>Ministres</th>
                <th style={thStyle}>Superviseurs</th>
                <th style={thStyle}>Bethels</th>
                <th style={thStyle}>Chaînes incomplètes</th>
                <th style={thStyle}>Priorité</th>
              </tr>
            </thead>
            <tbody>
              {resumeParPasteur.map((s) => (
                <tr key={s.pastor}>
                  <td style={tdStyle}>{s.pastor}</td>
                  <td style={tdStyle}>{s.ministers}</td>
                  <td style={tdStyle}>{s.overseers}</td>
                  <td style={tdStyle}>{s.bethels}</td>
                  <td style={tdStyle}>{s.incomplete}</td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "999px",
                      background: s.priority === "High" ? "rgba(162,59,51,0.10)" : s.priority === "Medium" ? "rgba(184,134,59,0.12)" : "rgba(31,92,78,0.10)",
                      color: s.priority === "High" ? "var(--brick)" : s.priority === "Medium" ? "var(--gold)" : "var(--teal)",
                    }}>
                      {s.priority === "High" ? "Élevée" : s.priority === "Medium" ? "Moyenne" : "Faible"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "leadership" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={thStyle}>Pasteur</th>
                <th style={thStyle}>Ministre</th>
                <th style={thStyle}>Superviseurs</th>
                <th style={thStyle}>Bethels</th>
                <th style={thStyle}>Superviseur manquant</th>
                <th style={thStyle}>Responsable manquant</th>
                <th style={thStyle}>Révision</th>
              </tr>
            </thead>
            <tbody>
              {parMinistre.map((g, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{g.pastor}</td>
                  <td style={tdStyle}>{g.minister}</td>
                  <td style={tdStyle}>{g.overseers}</td>
                  <td style={tdStyle}>{g.bethels}</td>
                  <td style={tdStyle}>{g.missingOverseer}</td>
                  <td style={tdStyle}>{g.missingLeader}</td>
                  <td style={tdStyle}><PilleReview needsReview={g.needsReview} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === "actionview" && (
        <div>
          <p style={{ color: "var(--ink-muted)", fontSize: "13px", margin: "0 0 14px" }}>
            {incompletes.length} Bethels avec une chaîne de supervision incomplète. Utilisez cette vue pour les réunions d'attribution.
          </p>
          {incompletes.length === 0 ? (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
              Toutes les chaînes de supervision sont complètes. 🎉
            </div>
          ) : (
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    <th style={thStyle}>Pasteur</th>
                    <th style={thStyle}>Ministre</th>
                    <th style={thStyle}>Superviseur</th>
                    <th style={thStyle}>Responsable Bethel</th>
                    <th style={thStyle}>Bethel</th>
                    <th style={thStyle}>Action requise</th>
                  </tr>
                </thead>
                <tbody>
                  {incompletes.map((r) => (
                    <tr key={r.bethelId}>
                      <td style={tdStyle}>{r.pastor}</td>
                      <td style={tdStyle}>{r.minister || "—"}</td>
                      <td style={tdStyle}>{r.overseer || "—"}</td>
                      <td style={tdStyle}>{r.bethelLeader || "—"}</td>
                      <td style={tdStyle}>{r.bethelName}</td>
                      <td style={{ ...tdStyle, color: "var(--brick)", fontWeight: 600 }}>
                        {actionRequise(false, r.missingMinister, r.missingOverseer, r.missingLeader)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subTab === "fichiersheet" && <SupervisionSheetPanel />}

      {subTab === "dataquality" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={thStyle}>Type de problème</th>
                <th style={thStyle}>Valeur actuelle</th>
                <th style={thStyle}>Observation</th>
                <th style={thStyle}>Action recommandée</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }}>Attributions manquantes</td>
                <td style={tdStyle}>
                  0 Pasteur / {qualiteDonnees.missingMinisterCount} Ministre / {qualiteDonnees.missingOverseerCount} Superviseur / {qualiteDonnees.missingLeaderCount} Responsable de Bethel non assignés
                </td>
                <td style={tdStyle}>Certaines fiches n'ont pas encore une chaîne de supervision complète.</td>
                <td style={tdStyle}>Prioriser l'attribution du Superviseur et du Responsable de Bethel, puis compléter les niveaux supérieurs.</td>
              </tr>
              <tr>
                <td style={{ ...tdStyle, fontWeight: 600 }}>Fiche Bethel manquante</td>
                <td style={tdStyle}>{qualiteDonnees.noRecordCount} Bethels sans fiche de chaîne</td>
                <td style={tdStyle}>Certains Bethels ne sont reliés à aucune chaîne de supervision.</td>
                <td style={tdStyle}>Attribuer un Pasteur, un Ministre et un Superviseur pour chaque Bethel non relié.</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .bsr-clickable-row:hover td {
          background: var(--bg) !important;
        }
      `}</style>

      {drawerBethelId && (
        <BethelDrawer
          row={rows.find((r) => r.bethelId === drawerBethelId) || null}
          onClose={() => setDrawerBethelId(null)}
        />
      )}
    </div>
  );
}

// --- Fichier Google Sheet de supervision (lecture seule) -------------------
// Affiche la copie du Sheet « Copie de BETHEL_MONTREAL_MANITOBA_NEWBRUNSWICK » (onglet _Données)
// stockée dans la table supervision_sheet. La synchro passe par la fonction Supabase
// sync-supervision-sheet : elle lit le Sheet (jamais d'écriture dedans) et ne supprime rien
// (une ligne absente du fichier est marquée inactive). bethels et members ne sont pas touchés.
function SupervisionSheetPanel() {
  const [lignes, setLignes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [campus, setCampus] = useState("tous");
  const [recherche, setRecherche] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState(null);
  const [bethelOuvert, setBethelOuvert] = useState(null); // { id, titre } -> fenêtre des membres

  async function charger() {
    setLoading(true);
    setErreur(null);
    try {
      const data = await supaGetTout("supervision_sheet", "actif=eq.true&select=*&order=id");
      setLignes(data);
    } catch (e) {
      setErreur(e.message);
      setLignes([]);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { charger(); }, []);

  async function appelerSynchro(apply) {
    setEnCours(true);
    setResultat(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-supervision-sheet`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ apply }),
      });
      const j = await res.json().catch(() => ({ ok: false, erreur: `Réponse illisible (${res.status})` }));
      setResultat(j);
      if (j.ok && apply) await charger();
    } catch (e) {
      setResultat({ ok: false, erreur: e.message });
    } finally {
      setEnCours(false);
    }
  }

  function lancerSynchro() {
    if (window.confirm("Synchroniser maintenant ? Le Google Sheet est lu en lecture seule et seule la copie dans l'app est mise à jour. Aucune donnée n'est supprimée.")) {
      appelerSynchro(true);
    }
  }

  const campusListe = useMemo(() => Array.from(new Set(lignes.map((l) => l.campus))).sort(), [lignes]);
  const vue = useMemo(() => {
    const q = normaliserNom(recherche); // insensible aux accents, à la casse et aux espaces multiples
    const cle = (v) => normaliserNom(v || "");
    const filtrees = lignes.filter((l) => {
      if (campus !== "tous" && l.campus !== campus) return false;
      if (!q) return true;
      return [l.n_bethel, l.leader, l.ministre, l.overseer, l.l_zone, l.l_tel, l.l_courriel]
        .some((v) => normaliserNom(v).includes(q));
    });
    // Affichage seulement : même ordre que le Google Sheet (campus, puis position de la ligne dans le fichier)
    const pos = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? 1e9 : n; };
    return [...filtrees].sort((a, b) =>
      cle(a.campus).localeCompare(cle(b.campus)) ||
      pos(a.ligne_campus) - pos(b.ligne_campus) ||
      (a.id || 0) - (b.id || 0));
  }, [lignes, campus, recherche]);

  const statsCampus = useMemo(() => {
    const out = {};
    lignes.forEach((l) => {
      const s = (out[l.campus] = out[l.campus] || { lignes: 0, bethels: new Set(), leaders: new Set(), ministres: new Set(), overseers: new Set() });
      s.lignes += 1;
      if (l.n_bethel) s.bethels.add(l.n_bethel);
      if (l.leader) s.leaders.add(`${String(l.leader).toLowerCase()}|${l.n_bethel || ""}`);
      if (l.ministre) s.ministres.add(String(l.ministre).toLowerCase());
      if (l.overseer) s.overseers.add(String(l.overseer).toLowerCase());
    });
    return out;
  }, [lignes]);

  const th = { padding: "8px 10px", textAlign: "left", fontSize: "10.5px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const td = { padding: "8px 10px", fontSize: "12px", color: "var(--ink)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const btn = (actif) => ({
    padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: enCours ? "wait" : "pointer",
    border: `1px solid ${actif ? "var(--plum)" : "var(--border)"}`,
    background: actif ? "var(--plum)" : "var(--surface)", color: actif ? "#fff" : "var(--ink)",
    opacity: enCours ? 0.6 : 1,
  });

  return (
    <div>
      <p style={{ color: "var(--ink-muted)", fontSize: "12.5px", margin: "0 0 12px" }}>
        Copie en lecture seule de l'onglet « _Données » du Google Sheet de supervision. Le Sheet n'est jamais modifié par l'application.
      </p>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <button disabled={enCours} onClick={() => appelerSynchro(false)} style={btn(false)}>Tester (sans rien écrire)</button>
        <button disabled={enCours} onClick={lancerSynchro} style={btn(true)}>Synchroniser maintenant</button>
        {enCours && <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>En cours…</span>}
      </div>

      {resultat && (
        <div style={{ border: `1px solid ${resultat.ok ? "var(--teal)" : "var(--brick)"}`, borderRadius: "10px", padding: "10px 12px", marginBottom: "14px", fontSize: "12px" }}>
          {!resultat.ok ? (
            <div style={{ color: "var(--brick)", fontWeight: 600 }}>Erreur : {resultat.erreur}</div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6, color: "var(--teal)" }}>
                {resultat.ecriture ? "Synchronisation terminée" : "Test à blanc (rien n'a été écrit)"}
              </div>
              <div>{resultat.lignes_total} lignes · {resultat.ministres_total} ministres · {resultat.bethels_rattaches_a_la_base} Bethels rattachés à la base · {resultat.lignes_qui_seraient_desactivees} ligne(s) {resultat.ecriture ? "désactivée(s)" : "qui seraient désactivées"}</div>
              {Object.entries(resultat.par_campus || {}).map(([c, s]) => (
                <div key={c} style={{ color: "var(--ink-muted)" }}>
                  {c} : {s.n_bethel} N° Bethel · {s.leaders} leaders · {s.sans_leader} sans leader · {s.ministres} ministres · {s.overseers} overseers
                </div>
              ))}
              {(resultat.n_bethel_sans_correspondance || []).length > 0 && (
                <div style={{ color: "var(--brick)", marginTop: 4 }}>
                  N° sans correspondance dans la base : {resultat.n_bethel_sans_correspondance.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Chargement…</div>
      ) : erreur ? (
        <div style={{ fontSize: "13px", color: "var(--brick)" }}>Erreur : {erreur}</div>
      ) : lignes.length === 0 ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)", border: "1px dashed var(--border)", borderRadius: "10px", padding: "16px" }}>
          Aucune donnée synchronisée pour l'instant. Lance d'abord « Tester (sans rien écrire) », puis « Synchroniser maintenant ».
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
            {Object.entries(statsCampus).map(([c, s]) => (
              <div key={c} style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "8px 12px", fontSize: "12px", background: "var(--surface)" }}>
                <div style={{ fontWeight: 700, color: "var(--plum)" }}>{c}</div>
                <div>{s.bethels.size} N° Bethel · {s.leaders.size} leaders</div>
                <div style={{ color: "var(--ink-muted)" }}>{s.ministres.size} ministres · {s.overseers.size} overseers</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px", alignItems: "center" }}>
            <select value={campus} onChange={(e) => setCampus(e.target.value)} style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px" }}>
              <option value="tous">Tous les campus</option>
              {campusListe.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher (N° Bethel, nom, zone, téléphone…)"
              style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid var(--border)", fontSize: "12.5px", minWidth: "260px" }} />
            <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>{vue.length} ligne(s)</span>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto", maxHeight: "560px" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr style={{ background: "var(--bg)", position: "sticky", top: 0 }}>
                  <th style={th}>Campus</th>
                  <th style={th}>Ministre</th>
                  <th style={th}>Overseer</th>
                  <th style={th}>N° Bethel</th>
                  <th style={th}>Leader</th>
                  <th style={th}>Téléphone</th>
                  <th style={th}>Courriel</th>
                  <th style={th}>Zone</th>
                  <th style={th}>Rôle</th>
                  <th style={th}>Notes</th>
                  <th style={th}>Dans la base</th>
                </tr>
              </thead>
              <tbody>
                {vue.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>{l.campus}</td>
                    <td style={td}>{l.ministre || "—"}</td>
                    <td style={td}>{l.overseer || "—"}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: "11px" }}>{l.n_bethel || "—"}</td>
                    <td style={td}>{l.leader || "—"}</td>
                    <td style={td}>{l.l_tel || "—"}</td>
                    <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: "11px" }}>{l.l_courriel || "—"}</td>
                    <td style={td}>{l.l_zone || "—"}</td>
                    <td style={td}>{l.role_leader || "—"}</td>
                    <td style={td}>{l.notes || ""}</td>
                    <td style={td}>
                      {l.bethel_id ? (
                        <>
                          Oui{" · "}
                          <button
                            onClick={() => setBethelOuvert({ id: l.bethel_id, titre: `${l.n_bethel || ""} · ${l.leader || ""}` })}
                            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--plum)", fontSize: "12px", textDecoration: "underline", fontFamily: "var(--font-body)" }}
                          >
                            voir les membres
                          </button>
                        </>
                      ) : l.n_bethel ? "Non" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {bethelOuvert && (
        <MembresBethelModal bethelId={bethelOuvert.id} titre={bethelOuvert.titre} onClose={() => setBethelOuvert(null)} />
      )}
    </div>
  );
}

// --- "Bethel Supervision Format" -----------------------------------------
// Reproduit le format du classeur officiel (onglet CAMPUS) : une ligne par
// Bethel, avec les coordonnées complètes (prénom, nom, téléphone, courriel,
// zone, adresse) du Ministre, du Superviseur et du Responsable de Bethel,
// plus le Pasteur et le numéro de Bethel ("Bethel#").
function BethelSupervisionFormatView() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [bethelsData, membersData, zonesData] = await Promise.all([
          supaGetTout("bethels", "status=eq.active&select=bethel_id,hp_number,church_id,bethel_name_officiel,zone_id"),
          supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,phone,email,address,city,bethel_id,overseer_name,ordained_minister_name"),
          supaGetTout("data_zones", "is_active=eq.true&select=zone_id,zone_code,zone_name"),
        ]);

        const zoneById = Object.fromEntries(zonesData.map((z) => [z.zone_id, z]));
        const bethelById = Object.fromEntries(bethelsData.map((b) => [b.bethel_id, b]));
        const nomZoneDuBethel = (bethelId) => {
          const b = bethelById[bethelId];
          const z = b && zoneById[b.zone_id];
          return z?.zone_name || z?.zone_code || "";
        };

        const membresParBethel = {};
        membersData.forEach((m) => {
          if (!m.bethel_id) return;
          (membresParBethel[m.bethel_id] = membresParBethel[m.bethel_id] || []).push(m);
        });

        // Fiches de contact des Ministres et Superviseurs, indexées par nom normalisé,
        // pour retrouver leur téléphone/courriel/adresse même quand leur nom n'apparaît
        // qu'en texte libre (ordained_minister_name / overseer_name) sur les fiches des membres.
        const ministresParNom = {};
        const overseersParNom = {};
        membersData.forEach((m) => {
          const cle = normaliseNom(`${m.first_name || ""} ${m.last_name || ""}`);
          if (!cle) return;
          if (m.role === "Ministre Ordonné") ministresParNom[cle] = m;
          if (m.role === "Overseer") overseersParNom[cle] = m;
        });

        function contactDepuisTexte(nomTexte, index) {
          const fiche = index[normaliseNom(nomTexte)];
          if (fiche) {
            return {
              firstName: fiche.first_name || "",
              lastName: fiche.last_name || "",
              phone: fiche.phone || "",
              email: fiche.email || "",
              zone: fiche.city || nomZoneDuBethel(fiche.bethel_id) || "",
              address: fiche.address || "",
            };
          }
          // Pas de fiche membre retrouvée pour ce nom : on garde au moins le nom tel quel.
          const mots = (nomTexte || "").trim().split(/\s+/);
          return {
            firstName: mots[0] || "",
            lastName: mots.slice(1).join(" "),
            phone: "", email: "", zone: "", address: "",
          };
        }

        const construites = bethelsData.map((b) => {
          const equipe = membresParBethel[b.bethel_id] || [];
          const leaderMembre = equipe.find((m) => m.role === "Bethel Leader") || null;
          const reference = leaderMembre || equipe[0] || null;

          const ministerTexte = reference?.ordained_minister_name || "";
          const overseerTexte = reference?.overseer_name || "";

          return {
            bethelId: b.bethel_id,
            pastor: CAMPUS_PASTOR,
            minister: !estValeurVide(ministerTexte) ? contactDepuisTexte(ministerTexte, ministresParNom) : null,
            overseer: !estValeurVide(overseerTexte) ? contactDepuisTexte(overseerTexte, overseersParNom) : null,
            bethelNumber: b.hp_number || b.bethel_name_officiel || "—",
            leader: leaderMembre ? {
              firstName: leaderMembre.first_name || "",
              lastName: leaderMembre.last_name || "",
              phone: leaderMembre.phone || "",
              email: leaderMembre.email || "",
              zone: leaderMembre.city || nomZoneDuBethel(b.bethel_id) || "",
              address: leaderMembre.address || "",
            } : null,
            ministerKey: normaliseNom(ministerTexte) || "(non assigné)",
            ministerLabel: !estValeurVide(ministerTexte) ? ministerTexte : "Non assigné",
          };
        });

        setRows(construites);
      } catch (e) {
        setLoadError(e.message);
        setRows([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const parPasteur = useMemo(() => {
    const groupes = {};
    rows.forEach((r) => {
      if (!groupes[r.pastor]) groupes[r.pastor] = [];
      groupes[r.pastor].push(r);
    });
    return groupes;
  }, [rows]);

  const thStyle = { padding: "8px 10px", textAlign: "left", fontSize: "10px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const tdStyle = { padding: "8px 10px", fontSize: "12px", color: "var(--ink)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  const groupHeadStyle = { padding: "6px 10px", fontSize: "10.5px", fontWeight: 700, color: "var(--plum)", background: "rgba(107,42,62,0.06)", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };

  function Personne({ p }) {
    if (!p) return <td colSpan={6} style={{ ...tdStyle, color: "var(--brick)", fontWeight: 600 }}>Non assigné</td>;
    return (
      <>
        <td style={tdStyle}>{p.firstName || "—"}</td>
        <td style={tdStyle}>{p.lastName || "—"}</td>
        <td style={tdStyle}>{p.phone || "—"}</td>
        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "11px" }}>{p.email || "—"}</td>
        <td style={tdStyle}>{p.zone || "—"}</td>
        <td style={{ ...tdStyle, whiteSpace: "normal", minWidth: "180px" }}>{p.address || "—"}</td>
      </>
    );
  }

  if (loading) {
    return <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Chargement du format de supervision…</div>;
  }
  if (loadError) {
    return <div style={{ fontSize: "13px", color: "var(--brick)" }}>Erreur : {loadError}</div>;
  }

  return (
    <div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: "0 0 4px" }}>Format de supervision des Bethels</h2>
      <p style={{ color: "var(--ink-muted)", fontSize: "13px", margin: "0 0 16px" }}>
        Format calqué sur le classeur officiel : coordonnées complètes du Ministre, du Superviseur et du Responsable de Bethel, par Pasteur.
      </p>

      {Object.entries(parPasteur).map(([pastor, rs]) => {
        // Regroupe par Ministre pour suivre l'ordre du classeur (bloc Ministre -> Bethels).
        const parMinistre = {};
        rs.forEach((r) => {
          (parMinistre[r.ministerKey] = parMinistre[r.ministerKey] || { label: r.ministerLabel, rows: [] }).rows.push(r);
        });

        return (
          <div key={pastor} style={{ marginBottom: "26px" }}>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--plum)", marginBottom: "8px" }}>
              Pasteur {pastor}
            </div>
            <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr style={{ background: "var(--bg)" }}>
                    <th style={thStyle} rowSpan={2}>Bethel#</th>
                    <th style={{ ...thStyle, textAlign: "center" }} colSpan={6}>Ministre</th>
                    <th style={{ ...thStyle, textAlign: "center" }} colSpan={6}>Superviseur</th>
                    <th style={{ ...thStyle, textAlign: "center" }} colSpan={6}>Responsable de Bethel</th>
                  </tr>
                  <tr style={{ background: "var(--bg)" }}>
                    {["Prénom", "Nom", "Téléphone", "Courriel", "Zone", "Adresse"].map((h) => <th key={"m" + h} style={thStyle}>{h}</th>)}
                    {["Prénom", "Nom", "Téléphone", "Courriel", "Zone", "Adresse"].map((h) => <th key={"o" + h} style={thStyle}>{h}</th>)}
                    {["Prénom", "Nom", "Téléphone", "Courriel", "Zone", "Adresse"].map((h) => <th key={"l" + h} style={thStyle}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {Object.values(parMinistre).map((groupe, gi) => (
                    <React.Fragment key={gi}>
                      <tr>
                        <td colSpan={19} style={groupHeadStyle}>Ministre : {groupe.label}</td>
                      </tr>
                      {groupe.rows.map((r) => (
                        <tr key={r.bethelId}>
                          <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-muted)" }}>{r.bethelNumber}</td>
                          <Personne p={r.minister} />
                          <Personne p={r.overseer} />
                          <Personne p={r.leader} />
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rapports > Jumelages : un leader qui ne reçoit pas (Non) est envoyé  */
/* chez un membre qui reçoit (Oui) de la même ville. Crée un nouveau   */
/* Bethel chez l'hôte. Ne supprime rien : l'ancien groupe est          */
/* simplement désactivé s'il se retrouve vide.                         */
/* ------------------------------------------------------------------ */
function JumelageView({ zones, onChanged }) {
  const [donnees, setDonnees] = useState(null);
  const [ville, setVille] = useState("");
  const [chefCle, setChefCle] = useState("");
  const [hoteCle, setHoteCle] = useState("");
  const [form, setForm] = useState({ numero: "", overseer: "", ministre: "" });
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState("");

  async function charger() {
    const [mem, bet, subs, feuille] = await Promise.all([
      supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,phone,address,postal_code,willing_to_host,bethel_id,overseer_name,ordained_minister_name"),
      supaGetTout("bethels", "select=bethel_id,hp_number,bethel_name_officiel,status,zone_id,campus_id,leader_name,host_name"),
      supaGetTout("submissions", "select=submission_id,first_name,last_name,phone,address,campus_id,willing_to_host,leadership_level,status,zone_id,submitted_at&order=submitted_at.desc"),
      supaGetTout("supervision_sheet", "actif=eq.true&select=l_prenom,l_nom,l_adresse,n_bethel").catch(() => []),
    ]);
    setDonnees({ mem, bet, subs, feuille });
  }
  useEffect(() => { charger().catch((e) => setMessage("Erreur de chargement : " + e.message)); /* eslint-disable-next-line */ }, []);

  const villeDeZone = useMemo(() => Object.fromEntries(zones.map((z) => [z.zone_id, z.city_name])), [zones]);

  const analyse = useMemo(() => {
    if (!donnees) return null;
    const { mem, bet, subs, feuille } = donnees;
    const betParId = Object.fromEntries(bet.map((b) => [b.bethel_id, b]));
    const cle = (p) => normaliseNom(`${p.first_name} ${p.last_name}`);
    // Clé d'adresse : numéro civique + premier mot significatif de la rue (ex. « 5555|henri »).
    const MOTS_VIDES = new Set(["rue", "boul", "boulevard", "bd", "avenue", "ave", "av", "chemin", "ch", "de", "du", "des", "la", "le", "les", "d", "l", "app", "apt", "appartement"]);
    const cleAdresse = (a) => {
      const mots = normaliseNom(String(a || "")).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      const num = mots.find((w) => /^\d+[a-z]?$/.test(w));
      if (!num) return "";
      const rue = mots.slice(mots.indexOf(num) + 1).find((w) => !MOTS_VIDES.has(w) && !/^\d/.test(w));
      return rue ? `${num}|${rue}` : "";
    };
    // Le Google Sheet : l'adresse du leader y est celle du membre qui reçoit.
    const leadersFeuille = new Set(); const adressesPrises = {};
    (feuille || []).forEach((r) => {
      const k = normaliseNom(`${r.l_prenom || ""} ${r.l_nom || ""}`); const ka = cleAdresse(r.l_adresse);
      if (!k || !ka) return;
      leadersFeuille.add(k);
      (adressesPrises[ka] = adressesPrises[ka] || []).push({ k, n: r.n_bethel });
    });
    const deja = { chefs: 0, hotes: 0, horsVille: 0 };
    // Maisons déjà activées : adresse d'un Bethel officiel actif (la maison est prise).
    const maisonsActives = new Set();
    bet.forEach((x) => { if (x.status !== "inactive" && estBethelOfficielLigne(x)) { const ka = cleAdresse(x.address); if (ka) maisonsActives.add(ka); } });
    const FSA_VILLE = { Terrebonne: ["J6V", "J6W", "J6X", "J6Y", "J6Z", "J7M"], Mascouche: ["J7K", "J7L"], Repentigny: ["J5Y", "J5Z", "J6A"] };
    const horsVille = (v, adr) => {
      const ok = FSA_VILLE[v]; if (!ok) return false;
      const m = String(adr || "").toUpperCase().match(/\b([A-Z]\d[A-Z])\s?\d[A-Z]\d\b/);
      return !!m && !ok.includes(m[1]);
    };
    const subParCle = {};
    subs.forEach((x) => { const k = cle(x); if (!subParCle[k]) subParCle[k] = x; }); // la plus récente d'abord
    const ville_de = (p, k) => {
      const sb = subParCle[k];
      const zSub = sb && sb.zone_id ? villeDeZone[sb.zone_id] : null;
      const b = betParId[p.bethel_id];
      return zSub || (b && villeDeZone[b.zone_id]) || "";
    };
    const chefs = []; const hotes = []; const vus = new Set(); const chefsMasques = [];
    mem.forEach((m) => {
      const k = cle(m); if (vus.has(k)) return; vus.add(k);
      const sb = subParCle[k];
      const veutRecevoir = sb ? sb.willing_to_host : m.willing_to_host;
      const b = betParId[m.bethel_id];
      const v = ville_de(m, k);
      if (!v) return;
      if (ROLES_PEUVENT_DIRIGER.includes(m.role)) {
        const dirigeDeja = b && b.status !== "inactive" && estBethelOfficielLigne(b) && normaliseNom(b.leader_name || "") === k;
        if (veutRecevoir === false && (dirigeDeja || leadersFeuille.has(k))) {
          deja.chefs++;
          chefsMasques.push({ cle: k, m, ville: v, origine: b ? (b.bethel_name_officiel || b.hp_number) : "", raison: dirigeDeja ? "dirige déjà un Bethel officiel" : "déjà placé selon le Google Sheet" });
        }
        else if (veutRecevoir === false) chefs.push({ cle: k, type: "member", m, ville: v, origine: b ? b.hp_number : "" });
      } else if (veutRecevoir === true) {
        const adr = m.address || (sb && sb.address) || "";
        const prisPar = (adressesPrises[cleAdresse(adr)] || []).filter((x) => x.k !== k);
        const hoteDe = bet.find((x) => x.status !== "inactive" && normaliseNom(x.host_name || "") === k && normaliseNom(x.leader_name || "") !== k);
        const dirigeOfficiel = b && b.status !== "inactive" && estBethelOfficielLigne(b) && normaliseNom(b.leader_name || "") === k;
        if (horsVille(v, adr)) deja.horsVille++;
        else if (prisPar.length || hoteDe || dirigeOfficiel || maisonsActives.has(cleAdresse(adr))) deja.hotes++;
        else hotes.push({ cle: k, type: "member", m, ville: v, origine: b ? b.hp_number : "", adresse: adr });
      }
    });
    // Hôtes « Oui » qui n'ont encore aucune fiche membre (soumissions en attente)
    const vusSub = new Set();
    subs.forEach((x) => {
      const k = cle(x); if (vusSub.has(k)) return; vusSub.add(k);
      if (vus.has(k) || x.status !== "pending" || x.willing_to_host !== true || !x.zone_id) return;
      if (horsVille(villeDeZone[x.zone_id], x.address)) { deja.horsVille++; return; }
      if ((adressesPrises[cleAdresse(x.address)] || []).some((y) => y.k !== k) || maisonsActives.has(cleAdresse(x.address))) { deja.hotes++; return; }
      hotes.push({ cle: k, type: "submission", sub: x, ville: villeDeZone[x.zone_id] || "", origine: "HP churches (réponses)", adresse: x.address || "" });
    });
    const villes = [...new Set([...chefs, ...hotes].map((x) => x.ville).filter(Boolean))].sort();
    return { chefs, hotes, villes, betParId, subParCle, deja, chefsMasques };
  }, [donnees, villeDeZone]);

  const chef = analyse && analyse.chefs.find((c) => c.cle === chefCle && c.ville === ville);
  const hote = analyse && analyse.hotes.find((h) => h.cle === hoteCle && h.ville === ville);

  useEffect(() => {
    if (chef) setForm((f) => ({ ...f, overseer: chef.m.overseer_name || "", ministre: chef.m.ordained_minister_name || "" }));
    // eslint-disable-next-line
  }, [chefCle]);

  async function former() {
    if (!chef || !hote) return;
    const numero = form.numero.trim();
    if (numero && !/^Bethel-.+-\d{6}$/i.test(numero)) { setMessage("Le numéro officiel doit ressembler à Bethel-Montréal-000058 (ou rester vide)."); return; }
    if (!hote.adresse) { setMessage("L'hôte n'a pas d'adresse enregistrée : ajoutez-la d'abord dans sa fiche."); return; }
    const nomChef = `${chef.m.first_name} ${chef.m.last_name}`.trim();
    const nomHote = hote.type === "member" ? `${hote.m.first_name} ${hote.m.last_name}`.trim() : `${hote.sub.first_name} ${hote.sub.last_name}`.trim();
    if (!window.confirm(`Former un nouveau Bethel ?\n\nLeader : ${nomChef}\nChez : ${nomHote}\nAdresse : ${hote.adresse}\nVille : ${ville}\nNuméro : ${numero || "(à venir)"}\n\nAucun groupe ne sera supprimé.`)) return;
    setEnCours(true); setMessage("");
    let etape = "début";
    try {
      if (numero) {
        etape = "vérification du numéro";
        const deja = await supaGet("bethels", `or=(hp_number.eq.${encodeURIComponent(numero)},bethel_name_officiel.eq.${encodeURIComponent(numero)})&select=bethel_id`);
        if (deja.length) throw new Error("Ce numéro est déjà utilisé par un autre Bethel.");
      }
      const { betParId } = analyse;
      const ancienChef = betParId[chef.m.bethel_id];
      const ancienHote = hote.type === "member" ? betParId[hote.m.bethel_id] : null;
      const zoneVille = zones.filter((z) => z.city_name === ville);
      const zoneId = (hote.type === "submission" && hote.sub.zone_id && villeDeZone[hote.sub.zone_id] === ville ? hote.sub.zone_id : (zoneVille[0] || {}).zone_id);
      const campusId = CAMPUS_FIXE_ID;
      if (!zoneId || !campusId) throw new Error("Zone ou campus introuvable pour ce Bethel.");
      const nouveauId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : null;
      const chaine = { ananias_name: nomChef, overseer_name: form.overseer.trim() || null, ordained_minister_name: form.ministre.trim() || null };

      etape = "création du Bethel";
      const cree = await supaPost("bethels", {
        ...(nouveauId ? { bethel_id: nouveauId } : {}),
        hp_number: numero || `FORM-${Date.now()}`, bethel_name_officiel: numero || null,
        campus_id: campusId, zone_id: zoneId, leader_name: nomChef, leader_role: chef.m.role,
        host_name: nomHote, address: hote.adresse, status: "active",
      });
      const idNeuf = (cree && cree[0] && cree[0].bethel_id) || nouveauId;
      if (!idNeuf) throw new Error("Identifiant du nouveau Bethel introuvable.");

      etape = "déplacement du leader";
      await supaPatch("members", `member_id=eq.${chef.m.member_id}`, { bethel_id: idNeuf, ...chaine });
      etape = "rattachement de l'hôte";
      if (hote.type === "member") {
        await supaPatch("members", `member_id=eq.${hote.m.member_id}`, { bethel_id: idNeuf, willing_to_host: true, ...chaine });
      } else {
        await supaPost("members", { bethel_id: idNeuf, first_name: hote.sub.first_name.trim(), last_name: hote.sub.last_name.trim(), phone: hote.sub.phone, address: hote.sub.address, role: "Membre", willing_to_host: true, status: "active", ...chaine });
      }
      etape = "approbation de la soumission de l'hôte";
      const sbHote = analyse.subParCle[hote.cle];
      if (sbHote && sbHote.status === "pending") {
        await supaPatch("submissions", `submission_id=eq.${sbHote.submission_id}`, { status: "approved", zone_id: zoneId, reviewed_at: new Date().toISOString() });
      }
      etape = "ancien groupe du leader";
      if (ancienChef && ancienChef.status !== "inactive" && !estBethelOfficielLigne(ancienChef)) {
        const reste = await supaGet("members", `bethel_id=eq.${ancienChef.bethel_id}&status=eq.active&select=member_id`);
        if (reste.length === 0) await supaPatch("bethels", `bethel_id=eq.${ancienChef.bethel_id}`, { status: "inactive" });
      }
      setMessage(`✅ Bethel créé : ${nomChef} chez ${nomHote}${numero ? ` (${numero})` : ""}.`);
      setChefCle(""); setHoteCle(""); setForm({ numero: "", overseer: "", ministre: "" });
      await charger(); onChanged && onChanged();
    } catch (e) {
      setMessage(`⚠️ Échec à l'étape « ${etape} » : ${e.message}. Vérifiez dans la page Bethels avant de recommencer.`);
    } finally { setEnCours(false); }
  }

  if (!analyse) return <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>{message || "Chargement…"}</div>;

  const colonne = (titre, liste, choisi, setChoisi, couleur) => (
    <div style={{ flex: "1 1 320px", border: "1px solid var(--border)", borderRadius: "10px", background: "var(--surface)", padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "6px" }}>{titre} ({liste.length})</div>
      {liste.length === 0 && <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Personne dans cette ville.</div>}
      {liste.map((x) => {
        const p = x.type === "member" ? x.m : x.sub;
        const actif = choisi === x.cle;
        return (
          <div key={x.cle} onClick={() => setChoisi(actif ? "" : x.cle)} style={{
            cursor: "pointer", padding: "7px 8px", borderRadius: "8px", marginBottom: "4px",
            border: `1px solid ${actif ? couleur : "transparent"}`, background: actif ? "rgba(107,42,62,0.06)" : "transparent",
          }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>{p.first_name} {p.last_name}{x.type === "member" && ROLES_PEUVENT_DIRIGER.includes(x.m.role) ? ` · ${x.m.role}` : ""}</div>
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{[p.phone, x.adresse || p.address].filter(Boolean).join(" · ") || "Adresse inconnue"}</div>
            {x.origine && <div style={{ fontSize: "10.5px", color: "var(--gold)", fontFamily: "var(--font-mono)" }}>{x.origine}</div>}
          </div>
        );
      })}
    </div>
  );

  const chefsVille = analyse.chefs.filter((c) => c.ville === ville);
  const hotesVille = analyse.hotes.filter((h) => h.ville === ville);
  const champ = { padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginBottom: "10px", lineHeight: 1.5 }}>
        Choisissez une ville, un leader qui <b>ne reçoit pas</b> (Non) et un membre qui <b>reçoit</b> (Oui) : un nouveau Bethel est créé chez l'hôte, avec le leader.
        Deux leaders ne cohabitent jamais ; aucun groupe n'est supprimé.
      </div>
      <select value={ville} onChange={(e) => { setVille(e.target.value); setChefCle(""); setHoteCle(""); setMessage(""); }} style={{ ...champ, maxWidth: "320px", marginBottom: "12px" }}>
        <option value="">— Choisir une ville —</option>
        {analyse.villes.map((v) => <option key={v} value={v}>{v}</option>)}
      </select>
      {ville && (
        <>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
            {colonne("Leaders « Non »", chefsVille, chefCle, setChefCle, "var(--brick)")}
            {colonne("Hôtes « Oui »", hotesVille, hoteCle, setHoteCle, "var(--teal)")}
          </div>
          <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginBottom: "12px" }}>
            Les leaders et les hôtes déjà placés selon le Google Sheet (adresse du leader = adresse de l'hôte) ne sont pas proposés
            ({analyse.deja.chefs} leaders et {analyse.deja.hotes} hôtes masqués au total).
            Une maison dont l'adresse est déjà celle d'un Bethel officiel actif n'est pas reproposée.
            {analyse.deja.horsVille > 0 && ` ${analyse.deja.horsVille} hôte(s) masqué(s) : adresse hors de la ville (code postal d'une autre région).`}
          </div>
          {analyse.chefsMasques.filter((c) => c.ville === ville).length > 0 && (
            <details style={{ marginBottom: "12px", fontSize: "12.5px" }}>
              <summary style={{ cursor: "pointer", color: "var(--ink-muted)" }}>
                Leaders « Non » déjà placés dans cette ville ({analyse.chefsMasques.filter((c) => c.ville === ville).length})
              </summary>
              {analyse.chefsMasques.filter((c) => c.ville === ville).map((c) => (
                <div key={c.cle} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
                  <b>{c.m.first_name} {c.m.last_name}</b> · {c.m.role} · {c.origine} — <span style={{ color: "var(--ink-muted)" }}>{c.raison}</span>
                </div>
              ))}
            </details>
          )}
          {chef && hote && (
            <div style={{ border: "1px solid var(--plum)", borderRadius: "10px", padding: "14px", background: "var(--surface)", maxWidth: "520px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px", color: "var(--ink)" }}>
                {chef.m.first_name} {chef.m.last_name} → chez {(hote.type === "member" ? hote.m : hote.sub).first_name} {(hote.type === "member" ? hote.m : hote.sub).last_name}
              </div>
              <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginBottom: "8px" }}>{hote.adresse || "⚠️ Adresse de l'hôte manquante"}</div>
              <input style={{ ...champ, marginBottom: "6px" }} placeholder="Numéro officiel Shekinah (ex. Bethel-Montréal-000058) — facultatif" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} />
              <input style={{ ...champ, marginBottom: "6px" }} placeholder="Overseer" value={form.overseer} onChange={(e) => setForm((f) => ({ ...f, overseer: e.target.value }))} />
              <input style={{ ...champ, marginBottom: "10px" }} placeholder="Ministre ordonné" value={form.ministre} onChange={(e) => setForm((f) => ({ ...f, ministre: e.target.value }))} />
              <button disabled={enCours} onClick={former} style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                {enCours ? "Création…" : "Former le Bethel"}
              </button>
            </div>
          )}
        </>
      )}
      {message && <div style={{ marginTop: "12px", fontSize: "12.5px", color: message.startsWith("✅") ? "var(--teal)" : "var(--brick)" }}>{message}</div>}
    </div>
  );
}

function ReportsView({ submissions, bethels, zones, onChanged }) {

  
const [tab, setTab] = useState("hosting");
  const byLeadership = useMemo(() => {
    const counts = {};
    submissions.forEach((s) => {
      const key = s.leadership_level || "unknown";
      counts[key] = counts[key] || { yes: 0, no: 0 };
      if (s.willing_to_host) counts[key].yes++;
      else counts[key].no++;
    });
    return counts;
  }, [submissions]);

  const maxVal = Math.max(1, ...Object.values(byLeadership).map((v) => v.yes + v.no));

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Rapports</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 16px" }}>
        {tab === "jumelage" ? "Envoyer un leader « Non » chez un membre « Oui » de la même ville : un nouveau Bethel est créé chez l'hôte." : tab === "hosting" ? "Disponibilité pour héberger, par niveau de leadership." : tab === "gaps" ? "Membres avec des informations clés manquantes." : tab === "zonemismatch" ? "Bethels dont la zone ne correspond pas à leur adresse." : tab === "bethelsupervision" ? "Chaîne complète Pasteur → Ministre → Superviseur → Responsable de Bethel → Bethel, par état." : tab === "supervision" ? "Format calqué sur le classeur officiel, avec les coordonnées complètes de chaque niveau de la chaîne." : tab === "orgchart" ? "Hiérarchie complète, du Ministre Ordonné jusqu'au Responsable de Bethel." : "Membres dont l'adresse ne correspond pas à la zone de leur Bethel."}
      </p>

      <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
        {[{ id: "hosting", label: "Disponibles pour héberger" }, { id: "gaps", label: "Données manquantes" }, { id: "zonemismatch", label: "Écarts de zone" }, { id: "membermismatch", label: "Écarts d'adresse membre" }, { id: "bethelsupervision", label: "Supervision des Bethels" }, { id: "jumelage", label: "Jumelages" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "7px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
            border: `1px solid ${tab === t.id ? "var(--plum)" : "var(--border)"}`,
            background: tab === t.id ? "rgba(107,42,62,0.08)" : "var(--surface)",
            color: tab === t.id ? "var(--plum)" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "jumelage" ? (
        <JumelageView zones={zones} onChanged={onChanged} />
      ) : tab === "bethelsupervision" ? (
        <BethelSupervisionReport />
      ) : tab === "hosting" ? (
        submissions.length === 0 ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
            No submissions yet to report on.
          </div>
        ) : (
          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "20px", background: "var(--surface)" }}>
            {Object.entries(byLeadership).map(([role, v]) => {
              const total = v.yes + v.no;
              return (
                <div key={role} style={{ marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--ink)", fontWeight: 600 }}>{LEADERSHIP_LABELS[role] || role}</span>
                    <span style={{ color: "var(--ink-muted)" }}>{v.yes} yes / {total} total</span>
                  </div>
                  <div style={{ height: "8px", background: "var(--bg)", borderRadius: "999px", overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${(v.yes / maxVal) * 100}%`, background: "var(--teal)" }} />
                    <div style={{ width: `${(v.no / maxVal) * 100}%`, background: "var(--brick)", opacity: 0.55 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : tab === "gaps" ? (
        <DataGapsReport bethels={bethels} />
      ) : tab === "zonemismatch" ? (
        <ZoneMismatchReport zones={zones} onChanged={onChanged} />
      ) : (
        <MemberZoneMismatchReport zones={zones} />
      )}
    </div>
  );
}

function ZoneLookupView({ zones }) {
  const [query, setQuery] = useState("");
  const [regionFiltree, setRegionFiltree] = useState("all");

  const regions = useMemo(() => {
    const ensemble = new Set(zones.map((z) => z.region).filter(Boolean));
    return [...ensemble].sort();
  }, [zones]);

  const results = useMemo(() => {
    let liste = zones;
    if (regionFiltree !== "all") liste = liste.filter((z) => z.region === regionFiltree);

    const q = query.trim().toLowerCase();
    if (q) {
      liste = liste.filter((z) => z.zone_name.toLowerCase().includes(q) || z.city_name.toLowerCase().includes(q));
    }
    return liste.slice(0, query.trim() || regionFiltree !== "all" ? 200 : 40);
  }, [query, zones, regionFiltree]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Zone lookup</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        {zones.length} zones live in your data_zones table.
      </p>
      <div style={{ position: "relative", marginBottom: "14px", maxWidth: "360px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a city or neighborhood…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 32px",
            border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button onClick={() => setRegionFiltree("all")} style={{
          padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
          border: `1px solid ${regionFiltree === "all" ? "var(--plum)" : "var(--border)"}`,
          background: regionFiltree === "all" ? "var(--plum)" : "var(--surface)",
          color: regionFiltree === "all" ? "#fff" : "var(--ink-muted)", cursor: "pointer",
        }}>
          All regions
        </button>
        {regions.map((r) => (
          <button key={r} onClick={() => setRegionFiltree(r)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${regionFiltree === r ? "var(--plum)" : "var(--border)"}`,
            background: regionFiltree === r ? "var(--plum)" : "var(--surface)",
            color: regionFiltree === r ? "#fff" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {r}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "8px" }}>
        {results.map((z) => (
          <div key={z.zone_id} style={{
            border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
            display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)",
          }}>
            <div>
              <div style={{ fontSize: "13px", color: "var(--ink)" }}>{z.zone_name}</div>
              <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{z.city_name}{z.region ? ` · ${z.region}` : ""}</div>
            </div>
            <ZoneStamp code={z.zone_code} muted />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vue : Recherche d'un membre parmi les 1200+, sur tous les Bethels  */
/* ------------------------------------------------------------------ */
function SearchMembersView({ bethels, onOpenBethel }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        // 1) Cherche par nom/téléphone, comme avant
        const parNom = await supaGet(
          "members",
          `or=(first_name.ilike.*${encodeURIComponent(q)}*,last_name.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*)&order=first_name.asc&limit=40`
        );

        // 2) Cherche aussi si le texte tapé correspond à une ville/zone --
        // si oui, ramène TOUS les membres des Bethels de cette zone.
        const bethelsCorrespondants = bethels.filter((b) =>
          (b.zone_name || "").toLowerCase().includes(q.toLowerCase())
        );
        let parZone = [];
        if (bethelsCorrespondants.length > 0) {
          const idsZone = bethelsCorrespondants.map((b) => b.bethel_id);
          parZone = await supaGet(
            "members",
            `bethel_id=in.(${idsZone.join(",")})&status=eq.active&order=first_name.asc&limit=500`
          );
        }

        // Fusionne les deux listes, sans doublons
        const fusion = {};
        [...parNom, ...parZone].forEach((m) => { fusion[m.member_id] = m; });
        setResults(Object.values(fusion));
      } catch (e) {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 350); // petit délai pour éviter une requête à chaque lettre tapée
    return () => clearTimeout(timer);
  }, [query, bethels]);

  const bethelById = useMemo(() => Object.fromEntries(bethels.map((b) => [b.bethel_id, b])), [bethels]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Recherche membres</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        Find any of your {bethels.length ? "1200+" : ""} members, or search by city/zone (e.g. "Anjou").
      </p>

      <div style={{ position: "relative", marginBottom: "20px", maxWidth: "420px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name, phone number, or city…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 32px",
            border: "1px solid var(--border)", borderRadius: "8px", fontSize: "14px", outline: "none",
          }}
        />
      </div>

      {loading && <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Searching…</div>}

      {!loading && searched && results.length === 0 && (
        <div style={{ fontSize: "13.5px", color: "var(--ink-muted)" }}>No member found matching "{query}".</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {results.map((m) => {
          const bethel = bethelById[m.bethel_id];
          return (
            <button
              key={m.member_id}
              onClick={() => bethel && onOpenBethel(bethel)}
              disabled={!bethel}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "12px 16px", borderRadius: "10px", border: "1px solid var(--border)",
                background: "var(--surface)", textAlign: "left", cursor: bethel ? "pointer" : "default",
                fontFamily: "var(--font-body)",
              }}
            >
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--ink)" }}>
                  {m.first_name} {m.last_name}
                  <span style={{
                    marginLeft: "8px", fontSize: "11px", padding: "2px 8px", borderRadius: "999px", fontWeight: 600,
                    background: m.role === "Bethel Leader" ? "rgba(107,42,62,0.10)" : "var(--bg)",
                    color: m.role === "Bethel Leader" ? "var(--plum)" : "var(--ink-muted)",
                    border: "1px solid var(--border)",
                  }}>
                    {m.role}
                  </span>
                </div>
                {m.phone && (
                  <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "3px", display: "flex", alignItems: "center", gap: "4px" }}>
                    <Phone size={11} /> {m.phone}
                  </div>
                )}
              </div>
              {bethel ? (
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "12.5px", color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
                    <Users size={12} /> {bethel.leader_name}'s Bethel
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--ink-muted)", marginTop: "2px" }}>
                    {bethel.hp_number} · {bethel.zone_name}
                  </div>
                </div>
              ) : (
                <span style={{ fontSize: "11.5px", color: "var(--brick)" }}>Bethel not found</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Vue : Présences hebdomadaires (table attendance). Une ligne par     */
/* Bethel et par semaine (lundi → dimanche). Ne supprime rien.         */
/* ------------------------------------------------------------------ */
const dateIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function lundiDe(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const j = (x.getDay() + 6) % 7; x.setDate(x.getDate() - j); return x; }

/* ------------------------------------------------------------------ */
/* Formulaire de saisie rapide d'une présence (administrateur).        */
/* Insère ou met à jour la ligne (bethel_id, semaine) de `attendance`. */
/* ------------------------------------------------------------------ */
function AttendanceFormModal({ bethels, bethelIdInitial, semaineInitiale, onSaved, onClose }) {
  const liste = useMemo(() => bethels.filter((b) => b.status !== "inactive" && estBethelOfficielLigne(b)).sort((a, b) => (a.leader_name || "").localeCompare(b.leader_name || "")), [bethels]);
  const [bethelId, setBethelId] = useState(bethelIdInitial || "");
  const [jour, setJour] = useState(semaineInitiale || dateIso(new Date()));
  const [vals, setVals] = useState({ sunday_count: "", visitors_count: "", midweek_count: "", decisions_count: "", home_visits_count: "", notes: "", status: "On time" });
  const [existe, setExiste] = useState(null);
  const [enCours, setEnCours] = useState(false);
  const [msg, setMsg] = useState("");
  const lun = lundiDe(new Date(`${jour}T12:00:00`));
  const debut = dateIso(lun);
  const fin = dateIso(new Date(lun.getFullYear(), lun.getMonth(), lun.getDate() + 6));

  useEffect(() => {
    setExiste(null);
    if (!bethelId) return;
    supaGet("attendance", `bethel_id=eq.${bethelId}&week_start_date=eq.${debut}&select=*`).then((r) => {
      const l = r[0] || null; setExiste(l);
      setVals(l ? { sunday_count: l.sunday_count, visitors_count: l.visitors_count, midweek_count: l.midweek_count, decisions_count: l.decisions_count, home_visits_count: l.home_visits_count, notes: l.notes || "", status: l.status || "On time" }
        : { sunday_count: "", visitors_count: "", midweek_count: "", decisions_count: "", home_visits_count: "", notes: "", status: "On time" });
    }).catch(() => {});
  }, [bethelId, debut]);

  const nb = (k) => Math.max(0, parseInt(vals[k], 10) || 0);
  const total = nb("sunday_count") + nb("visitors_count");
  const maj = (k, v) => setVals((x) => ({ ...x, [k]: v }));

  async function enregistrer() {
    if (!bethelId) { setMsg("Choisissez un Bethel."); return; }
    setEnCours(true); setMsg("");
    try {
      const corps = {
        bethel_id: bethelId, week_start_date: debut, week_end_date: fin,
        sunday_count: nb("sunday_count"), visitors_count: nb("visitors_count"), midweek_count: nb("midweek_count"),
        decisions_count: nb("decisions_count"), home_visits_count: nb("home_visits_count"),
        notes: vals.notes.trim() || null, status: vals.status, submitted_at: new Date().toISOString(),
      };
      const res = existe ? await supaPatch("attendance", `id=eq.${existe.id}`, corps) : await supaPost("attendance", corps);
      onSaved && onSaved(res[0]);
      onClose();
    } catch (e) { setMsg("⚠️ " + e.message); } finally { setEnCours(false); }
  }

  const champ = { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", width: "100%", boxSizing: "border-box" };
  const lab = { fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", display: "block", marginBottom: "4px" };
  const nombre = (k, label) => (
    <div><label style={lab}>{label}</label><input type="number" min="0" value={vals[k]} onChange={(e) => maj(k, e.target.value)} style={champ} /></div>
  );
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 80 }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(520px, 94vw)", maxHeight: "92vh", overflowY: "auto", background: "var(--surface)", borderRadius: "14px", padding: "20px", zIndex: 81, boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--ink)" }}>Enregistrer une présence</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={18} /></button>
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={lab}>Bethel</label>
          <select value={bethelId} onChange={(e) => setBethelId(e.target.value)} style={champ}>
            <option value="">Choisir un Bethel…</option>
            {liste.map((b) => <option key={b.bethel_id} value={b.bethel_id}>{b.leader_name || "—"} · {b.bethel_name_officiel || b.hp_number}</option>)}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
          <div><label style={lab}>Semaine (un jour de la semaine)</label><input type="date" value={jour} onChange={(e) => e.target.value && setJour(e.target.value)} style={champ} /></div>
          <div><label style={lab}>Du lundi au dimanche</label><div style={{ ...champ, background: "var(--bg)", color: "var(--ink)" }}>{debut} → {fin}</div></div>
        </div>
        {existe && <div style={{ fontSize: "12px", color: "var(--gold)", marginBottom: "10px" }}>Une présence existe déjà pour cette semaine : elle sera mise à jour.</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
          {nombre("sunday_count", "Dimanche (membres présents)")}
          {nombre("visitors_count", "Visiteurs (invités)")}
          {nombre("midweek_count", "Réunions de semaine")}
          {nombre("decisions_count", "Décisions (âmes sauvées)")}
          {nombre("home_visits_count", "Visites à domicile")}
          <div><label style={lab}>Total (dimanche + visiteurs)</label><div style={{ ...champ, background: "var(--bg)", fontWeight: 700 }}>{total}</div></div>
        </div>
        <div style={{ marginBottom: "10px" }}>
          <label style={lab}>Statut</label>
          <select value={vals.status} onChange={(e) => maj("status", e.target.value)} style={champ}><option>On time</option><option>Late</option></select>
        </div>
        <div style={{ marginBottom: "12px" }}>
          <label style={lab}>Notes / Commentaires (optionnel)</label>
          <textarea value={vals.notes} onChange={(e) => maj("notes", e.target.value)} rows={3} style={{ ...champ, resize: "vertical", fontFamily: "inherit" }} />
        </div>
        {msg && <div style={{ fontSize: "12.5px", color: "var(--brick)", marginBottom: "10px" }}>{msg}</div>}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "13px", cursor: "pointer" }}>Annuler</button>
          <button onClick={enregistrer} disabled={enCours || !bethelId} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", opacity: enCours || !bethelId ? 0.5 : 1 }}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </>
  );
}

function AttendanceView() {
  const [lundi, setLundi] = useState(() => lundiDe(new Date()));
  const [bethels, setBethels] = useState(null);
  const [zonesVille, setZonesVille] = useState({});
  const [lignes, setLignes] = useState({}); // bethel_id -> ligne attendance enregistrée
  const [saisie, setSaisie] = useState({});  // bethel_id -> valeurs en cours de saisie
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [enCours, setEnCours] = useState("");
  const [message, setMessage] = useState("");
  const [formOuvert, setFormOuvert] = useState(false);
  const debut = dateIso(lundi);
  const fin = dateIso(new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 6));

  useEffect(() => {
    (async () => {
      try {
        const [bets, zones] = await Promise.all([
          supaGetTout("bethels", "status=eq.active&select=bethel_id,hp_number,bethel_name_officiel,leader_name,zone_id&order=hp_number.asc"),
          supaGet("data_zones", "select=zone_id,city_name&limit=2000"),
        ]);
        setBethels(bets.filter(estBethelOfficielLigne));
        setZonesVille(Object.fromEntries(zones.map((z) => [z.zone_id, z.city_name])));
      } catch (e) { setMessage("Erreur : " + e.message); setBethels([]); }
    })();
  }, []);

  async function chargerSemaine() {
    try {
      const rows = await supaGetTout("attendance", `week_start_date=eq.${debut}&select=*`);
      setLignes(Object.fromEntries(rows.map((r) => [r.bethel_id, r])));
      setSaisie({});
      setMessage("");
    } catch (e) { setMessage("Erreur de chargement des présences : " + e.message); }
  }
  useEffect(() => { chargerSemaine(); /* eslint-disable-next-line */ }, [debut]);

  const CHAMPS = [
    { id: "sunday_count", label: "Dimanche" },
    { id: "visitors_count", label: "Visiteurs" },
    { id: "midweek_count", label: "Semaine" },
    { id: "decisions_count", label: "Décisions" },
    { id: "home_visits_count", label: "Visites" },
  ];
  const valeur = (id, champ) => {
    if (saisie[id] && saisie[id][champ] !== undefined) return saisie[id][champ];
    const l = lignes[id]; return l ? l[champ] : "";
  };
  const totalDe = (id) => (Number(valeur(id, "sunday_count")) || 0) + (Number(valeur(id, "visitors_count")) || 0);
  const modifie = (id) => !!saisie[id];

  async function enregistrer(b) {
    const id = b.bethel_id;
    const corps = { bethel_id: id, week_start_date: debut, week_end_date: fin, status: (saisie[id] && saisie[id].status) || (lignes[id] && lignes[id].status) || "On time" };
    CHAMPS.forEach((c) => { corps[c.id] = Math.max(0, parseInt(valeur(id, c.id), 10) || 0); });
    setEnCours(id);
    try {
      const existe = lignes[id];
      const res = existe
        ? await supaPatch("attendance", `id=eq.${existe.id}`, { ...corps, submitted_at: new Date().toISOString() })
        : await supaPost("attendance", corps);
      setLignes((l) => ({ ...l, [id]: res[0] }));
      setSaisie((s) => { const n = { ...s }; delete n[id]; return n; });
    } catch (e) { setMessage("⚠️ " + e.message); } finally { setEnCours(""); }
  }

  if (!bethels) return <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>{message || "Chargement…"}</div>;
  const q = normaliseNom(recherche);
  const visibles = bethels.filter((b) => {
    if (q && !normaliseNom(`${b.leader_name || ""} ${b.hp_number} ${b.bethel_name_officiel || ""}`).includes(q)) return false;
    if (filtre === "soumis") return !!lignes[b.bethel_id];
    if (filtre === "manquants") return !lignes[b.bethel_id];
    return true;
  });
  const soumis = bethels.filter((b) => lignes[b.bethel_id]).length;
  const somme = (champ) => Object.values(lignes).reduce((a, l) => a + (Number(l[champ]) || 0), 0);
  const btn = { padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink)" };
  const inp = { width: "62px", padding: "5px 6px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", textAlign: "right" };
  const th = { textAlign: "left", padding: "9px 10px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" };
  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Présences</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 14px" }}>Campus: TG Montreal — présences hebdomadaires des Bethels.</p>
      <div style={{ marginBottom: "12px" }}>
        <button onClick={() => setFormOuvert(true)} style={{ ...btn, background: "var(--plum)", color: "#fff", border: "none", padding: "8px 16px" }}>+ Enregistrer une présence</button>
      </div>
      {formOuvert && (
        <AttendanceFormModal bethels={bethels} semaineInitiale={debut} onClose={() => setFormOuvert(false)}
          onSaved={(row) => { setFiltre("soumis"); if (row.week_start_date === debut) setLignes((l) => ({ ...l, [row.bethel_id]: row })); else setLundi(new Date(`${row.week_start_date}T12:00:00`)); }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "12px" }}>
        <button style={btn} onClick={() => setLundi(new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() - 7))}>← Semaine précédente</button>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>Semaine du {debut} au {fin}</div>
        <button style={btn} onClick={() => setLundi(new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + 7))}>Semaine suivante →</button>
        <button style={btn} onClick={() => setLundi(lundiDe(new Date()))}>Cette semaine</button>
      </div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
        {[["Bethels ayant soumis", `${soumis}/${bethels.length}`], ["Dimanche", somme("sunday_count")], ["Visiteurs", somme("visitors_count")], ["Total", somme("total_count")], ["Décisions", somme("decisions_count")], ["Visites à domicile", somme("home_visits_count")]].map(([l, v]) => (
          <div key={l} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "8px 12px", background: "var(--surface)" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase" }}>{l}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: "18px", color: "var(--ink)" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px", alignItems: "center" }}>
        <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un leader ou un Bethel…" style={{ padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13px", minWidth: "240px" }} />
        {[["tous", "Tous"], ["soumis", "Soumis"], ["manquants", "Non soumis"]].map(([id, l]) => (
          <button key={id} onClick={() => setFiltre(id)} style={{ ...btn, background: filtre === id ? "var(--plum)" : "var(--surface)", color: filtre === id ? "#fff" : "var(--ink-muted)" }}>{l}</button>
        ))}
      </div>
      {message && <div style={{ fontSize: "12.5px", color: "var(--brick)", marginBottom: "10px" }}>{message}</div>}
      <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "auto", background: "var(--surface)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: "860px" }}>
          <thead><tr style={{ background: "var(--bg)" }}>
            <th style={th}>Bethel</th>
            {CHAMPS.slice(0, 2).map((c) => <th key={c.id} style={th}>{c.label}</th>)}
            <th style={th}>Total</th>
            {CHAMPS.slice(2).map((c) => <th key={c.id} style={th}>{c.label}</th>)}
            <th style={th}>Statut</th><th style={th}></th>
          </tr></thead>
          <tbody>
            {visibles.map((b) => {
              const id = b.bethel_id; const l = lignes[id];
              return (
                <tr key={id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 10px", fontSize: "13px" }}>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{b.leader_name || "—"}</div>
                    <div style={{ fontSize: "11px", color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>{b.bethel_name_officiel || b.hp_number} · {zonesVille[b.zone_id] || ""}</div>
                  </td>
                  {CHAMPS.slice(0, 2).map((c) => (
                    <td key={c.id} style={{ padding: "7px 6px" }}><input type="number" min="0" style={inp} value={valeur(id, c.id)} onChange={(e) => setSaisie((s) => ({ ...s, [id]: { ...(s[id] || {}), [c.id]: e.target.value } }))} /></td>
                  ))}
                  <td style={{ padding: "7px 10px", fontSize: "13px", fontWeight: 700 }}>{l || modifie(id) ? totalDe(id) : "—"}</td>
                  {CHAMPS.slice(2).map((c) => (
                    <td key={c.id} style={{ padding: "7px 6px" }}><input type="number" min="0" style={inp} value={valeur(id, c.id)} onChange={(e) => setSaisie((s) => ({ ...s, [id]: { ...(s[id] || {}), [c.id]: e.target.value } }))} /></td>
                  ))}
                  <td style={{ padding: "7px 6px" }}>
                    <select value={(saisie[id] && saisie[id].status) || (l && l.status) || "On time"} onChange={(e) => setSaisie((s) => ({ ...s, [id]: { ...(s[id] || {}), status: e.target.value } }))} style={{ padding: "5px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12px" }}>
                      <option>On time</option><option>Late</option>
                    </select>
                  </td>
                  <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                    <button disabled={enCours === id || (!modifie(id) && !!l)} onClick={() => enregistrer(b)} style={{ ...btn, padding: "5px 12px", background: modifie(id) || !l ? "var(--plum)" : "var(--surface)", color: modifie(id) || !l ? "#fff" : "var(--ink-muted)", opacity: enCours === id ? 0.5 : 1 }}>
                      {enCours === id ? "…" : l && !modifie(id) ? "✓ Soumis" : "Enregistrer"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibles.length === 0 && <tr><td colSpan={9} style={{ padding: "14px", fontSize: "13px", color: "var(--ink-muted)" }}>Aucun Bethel.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const NAV = [
  { id: "dashboard", label: "Tableau de bord", icon: Home },
  { id: "submissions", label: "Soumissions", icon: Inbox },
  { id: "bethels", label: "Bethels", icon: Users },
  { id: "manage-members", label: "Gérer les membres", icon: Plus },
  { id: "search", label: "Recherche membres", icon: Search },
  { id: "devotions", label: "Dévotions", icon: BookOpen },
  { id: "attendance", label: "Présences", icon: Check },
  { id: "reports", label: "Rapports", icon: BarChart3 },
  { id: "zones", label: "Recherche de zone", icon: MapPin },
];

/* ------------------------------------------------------------------ */
/* Vue : Suivi des dévotions quotidiennes, % de conformité vs objectif */
/* ------------------------------------------------------------------ */
const OBJECTIF_DEVOTION = 0.8; // 80%, même cible que l'ancien système Excel

function debutSemaineCourante() {
  // La semaine de dévotion va du samedi au vendredi (pas lundi-dimanche).
  const d = new Date();
  const jour = d.getDay(); // 0=dimanche, 6=samedi
  const decalage = (jour + 1) % 7; // nombre de jours depuis le dernier samedi
  const samedi = new Date(d);
  samedi.setDate(d.getDate() - decalage);
  return samedi.toISOString().slice(0, 10);
}
function finSemaineCourante() {
  const debut = new Date(debutSemaineCourante() + "T00:00:00");
  debut.setDate(debut.getDate() + 6); // vendredi suivant
  return debut.toISOString().slice(0, 10);
}

// Année fiscale personnalisée : Q1 = août-octobre, Q2 = novembre-janvier,
// Q3 = février-avril, Q4 = mai-juillet. "anneeFiscale" est l'année où le Q1 commence
// (ex: anneeFiscale=2026 -> Q1 va d'août 2026 à octobre 2026, Q2 chevauche jusqu'à janvier 2027).
function datesDuTrimestre(trimestre, anneeFiscale) {
  // Mois de départ de chaque trimestre, en mois écoulés depuis août (0=août, 1=sept, ... 11=juillet)
  const moisDepuisAout = (trimestre - 1) * 3;
  const debut = new Date(anneeFiscale, 7 + moisDepuisAout, 1); // 7 = août (index 0-based)
  const fin = new Date(anneeFiscale, 7 + moisDepuisAout + 3, 0); // dernier jour, 3 mois plus tard
  return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

// Détermine l'année fiscale en cours (celle où le prochain/actuel Q1 débute en août)
function anneeFiscaleCourante() {
  const auj = new Date();
  const mois = auj.getMonth(); // 0=janvier ... 7=août
  return mois >= 7 ? auj.getFullYear() : auj.getFullYear() - 1;
}

// Formate un numéro de téléphone automatiquement en (514) 123-4567 pendant la saisie
function formaterTelephone(valeur) {
  const chiffres = valeur.replace(/\D/g, "").slice(0, 10);
  if (chiffres.length <= 3) return chiffres;
  if (chiffres.length <= 6) return `(${chiffres.slice(0, 3)}) ${chiffres.slice(3)}`;
  return `(${chiffres.slice(0, 3)}) ${chiffres.slice(3, 6)}-${chiffres.slice(6)}`;
}

// Formate un code postal canadien en majuscules avec espace : H1G 4G6
function formaterCodePostal(valeur) {
  const propre = valeur.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (propre.length <= 3) return propre;
  return `${propre.slice(0, 3)} ${propre.slice(3)}`;
}

function normaliseNom(s) {
  // Enlève aussi les accents (é->e, à->a, etc.) pour que "Dieudonné" et "Dieudonne"
  // soient reconnus comme la même personne, peu importe qui a tapé l'accent ou non.
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_']/g, " ") // remplace tirets/apostrophes par un espace (ex: "Jean-Jacques" -> "Jean Jacques")
    .replace(/[^a-z\s]/gi, "")
    .replace(/\s+/g, " ") // évite les espaces doublés
    .trim();
}

// Rapproche un nom soumis dans une dévotion avec la bonne fiche membre, avec la même
// règle stricte partout dans l'app (au moins 2 mots en commun si le nom en a 2+).
function trouveMembreParNomGlobal(nomSoumis, listeMembres) {
  const mots = new Set(normaliseNom(nomSoumis).split(/\s+/).filter((w) => w.length > 1));
  const seuilRequis = mots.size >= 2 ? 2 : 1;
  let meilleur = null, meilleurScore = 0;
  for (const m of listeMembres) {
    const motsNom = new Set(normaliseNom(`${m.first_name} ${m.last_name}`).split(/\s+/).filter((w) => w.length > 1));
    let communs = 0;
    for (const w of mots) if (motsNom.has(w)) communs++;
    if (communs > meilleurScore) { meilleurScore = communs; meilleur = m; }
  }
  return meilleurScore >= seuilRequis ? meilleur : null;
}

// Analyse un texte exporté de WhatsApp et en extrait les dévotions valides
// (même logique que le script utilisé pour l'import initial des 2094 dévotions).
// Convertit une date écrite en français (plusieurs formats) en YYYY-MM-DD
const MOIS_FR = {
  'janvier': '01', 'février': '02', 'fevrier': '02', 'mars': '03', 'avril': '04',
  'mai': '05', 'juin': '06', 'juillet': '07', 'août': '08', 'aout': '08',
  'septembre': '09', 'octobre': '10', 'novembre': '11', 'décembre': '12', 'decembre': '12',
};

function extraireVraieDateDevotion(corps, dateEnvoiRepli) {
  function essaieFormats(brut) {
    let m = brut.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (m) { const [, j, mo, an] = m; return `${an}-${mo.padStart(2, '0')}-${j.padStart(2, '0')}`; }
    m = brut.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { const [, an, mo, j] = m; return `${an}-${mo.padStart(2, '0')}-${j.padStart(2, '0')}`; }
    m = brut.match(/(\d{1,2})(?:er)?\s+([a-zûéèà]+)\s+(\d{4})/i);
    if (m) {
      const [, j, moisTexte, an] = m;
      const mo = MOIS_FR[moisTexte.toLowerCase()];
      if (mo) return `${an}-${mo}-${j.padStart(2, '0')}`;
    }
    return null;
  }

  // 1) Cherche un champ "Date :" explicite dans le texte
  const mChamp = corps.match(/\*?Date\*?\.?\s*:?\s*([^\n\r]+)/i);
  if (mChamp) {
    const trouve = essaieFormats(mChamp[1].trim());
    if (trouve) return trouve;
  }

  // 2) Repli : cherche une phrase du type "Dévotion du 20 Août 2026" ou "Dévotion 20 Août 2026"
  // (utilisé par les gens qui rattrapent une dévotion en retard, sans champ "Date:" séparé).
  const mPhrase = corps.match(/[ée]votion(?:\s+du)?\s+(\d{1,2}(?:er)?\s+[a-zûéèà]+\s+\d{4})/i);
  if (mPhrase) {
    const trouve = essaieFormats(mPhrase[1]);
    if (trouve) return trouve;
  }

  return dateEnvoiRepli; // si rien ne correspond, on garde la date d'envoi comme dernier repli
}

function analyserTexteWhatsApp(texte) {
  const messages = [];
  const regex = /\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\] ([^:]+): /g;
  const positions = [];
  let m;
  while ((m = regex.exec(texte)) !== null) {
    positions.push({ index: m.index, fin: regex.lastIndex, date: m[1], expediteur: m[3].trim() });
  }
  for (let i = 0; i < positions.length; i++) {
    const debut = positions[i].fin;
    const fin = i + 1 < positions.length ? positions[i + 1].index : texte.length;
    const corps = texte.slice(debut, fin).trim();
    if (!corps.toLowerCase().includes("évotion") || corps.length < 80) continue;

    // Nom/Prénom peuvent apparaître dans n'importe quel ordre, et le nom de famille
    // peut avoir plusieurs mots (ex: "Paul Vilbrun") -- on cherche chaque champ
    // indépendamment, peu importe où il se trouve dans le texte.
    // (?<![A-Za-zÀ-ÿ]) empêche de faire correspondre "nom" à l'intérieur du mot "Prénom"
    const mNom = corps.match(/(?<![A-Za-zÀ-ÿ])\*?Nom(?:\s+de\s+famille)?\*?\.?\s*:\s*([A-Za-zÀ-ÿ'\-]+(?:\s+[A-Za-zÀ-ÿ'\-]+)?)\s*(?:\n|\r|\*|Pr[ée]nom|Campus|Minist[èe]re|HP|$)/i);
    const mPrenom = corps.match(/\*?Pr[ée]nom\*?\.?\s*:\s*([A-Za-zÀ-ÿ'\-]+(?:\s+[A-Za-zÀ-ÿ'\-]+)?)\s*(?:\n|\r|\*|Nom|Campus|Minist[èe]re|HP|$)/i);
    const mCampus = corps.match(/\*?Campus\*?\s*:\s*([A-Za-zÀ-ÿ\s]+?)(?:\n|\r|Minist|HP|$)/i);

    let submitter = null, confidence = "whatsapp";
    if (mNom && mPrenom) {
      submitter = `${mPrenom[1].trim()} ${mNom[1].trim()}`;
      confidence = "declared";
    } else {
      submitter = positions[i].expediteur.replace(/^[~\s]+/, "").trim();
    }

    const vraieDate = extraireVraieDateDevotion(corps, positions[i].date);

    messages.push({
      submitter_name: submitter,
      name_confidence: confidence,
      devotion_date: vraieDate,
      campus_declared: mCampus ? mCampus[1].trim() : null,
      raw_snippet: corps.slice(0, 150),
    });
  }
  return messages;
}

function AddDevotionManualPanel({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  const [membreChoisi, setMembreChoisi] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    const q = recherche.trim();
    if (q.length < 2 || membreChoisi) { setResultats([]); return; }
    setChercheEnCours(true);
    const minuteur = setTimeout(async () => {
      try {
        const data = await supaGet(
          "members",
          `or=(first_name.ilike.*${encodeURIComponent(q)}*,last_name.ilike.*${encodeURIComponent(q)}*)&status=eq.active&order=first_name.asc&limit=15`
        );
        setResultats(data);
      } catch (e) {
        setResultats([]);
      } finally {
        setChercheEnCours(false);
      }
    }, 300);
    return () => clearTimeout(minuteur);
  }, [recherche, membreChoisi]);

  async function ajouter() {
    if (!membreChoisi) return;
    setBusy(true);
    setMessage(null);
    try {
      const submitter = `${membreChoisi.first_name} ${membreChoisi.last_name}`;
      const existantes = await supaGet(
        "devotions",
        `submitter_name=ilike.${encodeURIComponent(submitter)}&devotion_date=eq.${date}&select=devotion_id`
      );
      if (existantes.length > 0) {
        setMessage({ type: "warn", text: `Already logged for ${submitter} on ${date}.` });
        setBusy(false);
        return;
      }
      await supaPost("devotions", {
        submitter_name: submitter, name_confidence: "declared",
        devotion_date: date, raw_snippet: "Added manually via portal",
      });
      setMessage({ type: "ok", text: `Added: ${submitter} — ${date}` });
      setMembreChoisi(null); setRecherche("");
      onAdded();
    } catch (e) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
        border: "1px solid var(--border)", background: "transparent", color: "var(--ink-muted)", fontSize: "13px",
        fontWeight: 600, cursor: "pointer",
      }}>
        <Plus size={14} /> Add manually
      </button>
    );
  }

  const inputStyle = {
    padding: "7px 9px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px",
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "18px", background: "var(--surface)", marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Add a devotion manually</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ position: "relative", width: "260px" }}>
          {membreChoisi ? (
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "7px 10px", border: "1px solid var(--plum)", borderRadius: "6px", background: "rgba(107,42,62,0.06)",
            }}>
              <span style={{ fontSize: "12.5px", color: "var(--ink)", fontWeight: 600 }}>
                {membreChoisi.first_name} {membreChoisi.last_name}
              </span>
              <button onClick={() => { setMembreChoisi(null); setRecherche(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}>
                <X size={13} />
              </button>
            </div>
          ) : (
            <>
              <input
                placeholder="Type a name to search…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
              />
              {(resultats.length > 0 || chercheEnCours) && (
                <div style={{
                  position: "absolute", top: "34px", left: 0, right: 0, zIndex: 20,
                  border: "1px solid var(--border)", borderRadius: "8px", background: "var(--surface)",
                  boxShadow: "0 8px 20px rgba(36,30,24,0.12)", maxHeight: "220px", overflowY: "auto",
                }}>
                  {chercheEnCours && <div style={{ padding: "8px 10px", fontSize: "12px", color: "var(--ink-muted)" }}>Searching…</div>}
                  {resultats.map((m) => (
                    <button
                      key={m.member_id}
                      onClick={() => { setMembreChoisi(m); setResultats([]); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                        border: "none", borderBottom: "1px solid var(--border)", background: "var(--surface)",
                        cursor: "pointer", fontSize: "12.5px", fontFamily: "var(--font-body)",
                      }}
                    >
                      <span style={{ color: "var(--ink)" }}>{m.first_name} {m.last_name}</span>
                      <span style={{ color: "var(--ink-muted)", marginLeft: "6px", fontSize: "11px" }}>{m.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <button disabled={busy || !membreChoisi} onClick={ajouter} style={{
          padding: "7px 16px", borderRadius: "6px", border: "none",
          background: membreChoisi ? "var(--plum)" : "var(--border)",
          color: membreChoisi ? "#fff" : "var(--ink-muted)", fontSize: "12.5px", fontWeight: 600,
          cursor: (membreChoisi && !busy) ? "pointer" : "not-allowed",
        }}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
      {message && (
        <div style={{ marginTop: "8px", fontSize: "12px", color: message.type === "ok" ? "var(--teal)" : message.type === "warn" ? "var(--gold)" : "var(--brick)" }}>
          {message.type === "ok" ? "✓ " : "⚠️ "}{message.text}
        </div>
      )}
    </div>
  );
}

function ImportDevotionsPanel({ onImported }) {
  const [open, setOpen] = useState(false);
  const [texte, setTexte] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState(null);

  async function importer() {
    setBusy(true);
    setResultat(null);
    try {
      const trouvees = analyserTexteWhatsApp(texte);
      if (trouvees.length === 0) {
        setResultat({ ajoutees: 0, doublons: 0, total: 0 });
        setBusy(false);
        return;
      }
      // Vérifie les doublons déjà présents (même nom + même date)
      const dates = [...new Set(trouvees.map((t) => t.devotion_date))];
      const existantes = await supaGet(
        "devotions",
        `devotion_date=in.(${dates.join(",")})&select=submitter_name,devotion_date`
      );
      const dejaVues = new Set(existantes.map((e) => `${normaliseNom(e.submitter_name)}|${e.devotion_date}`));

      const aInserer = trouvees.filter((t) => !dejaVues.has(`${normaliseNom(t.submitter_name)}|${t.devotion_date}`));
      const doublons = trouvees.length - aInserer.length;

      if (aInserer.length > 0) {
        // Insère par petits lots pour rester fiable
        for (let i = 0; i < aInserer.length; i += 200) {
          await supaPost("devotions", aInserer.slice(i, i + 200));
        }
      }
      setResultat({ ajoutees: aInserer.length, doublons, total: trouvees.length });
      setTexte("");
      onImported();
    } catch (e) {
      setResultat({ erreur: e.message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px",
        border: "1px solid var(--plum)", background: "transparent", color: "var(--plum)", fontSize: "13px",
        fontWeight: 600, cursor: "pointer",
      }}>
        <Plus size={14} /> Import WhatsApp devotions
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "18px", background: "var(--surface)", marginBottom: "18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Import WhatsApp devotions</span>
        <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
      </div>
      <p style={{ fontSize: "12px", color: "var(--ink-muted)", margin: "0 0 10px" }}>
        Paste the exported WhatsApp chat text below (or part of it). Already-imported devotions (same name + same date) are skipped automatically.
      </p>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        placeholder="Paste WhatsApp chat export text here…"
        style={{
          width: "100%", boxSizing: "border-box", minHeight: "160px", padding: "10px",
          border: "1px solid var(--border)", borderRadius: "8px", fontSize: "12px",
          fontFamily: "var(--font-mono)", resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}>
        <button disabled={busy || !texte.trim()} onClick={importer} style={{
          padding: "8px 16px", borderRadius: "8px", border: "none",
          background: texte.trim() ? "var(--plum)" : "var(--border)",
          color: texte.trim() ? "#fff" : "var(--ink-muted)", fontSize: "13px", fontWeight: 600,
          cursor: texte.trim() && !busy ? "pointer" : "not-allowed",
        }}>
          {busy ? "Importing…" : "Process & Import"}
        </button>
        {resultat && !resultat.erreur && (
          <span style={{ fontSize: "12.5px", color: "var(--teal)" }}>
            ✓ {resultat.ajoutees} added, {resultat.doublons} already existed ({resultat.total} found total)
          </span>
        )}
        {resultat?.erreur && (
          <span style={{ fontSize: "12.5px", color: "var(--brick)" }}>Error: {resultat.erreur}</span>
        )}
      </div>
    </div>
  );
}

function PersonDevotionModal({ membre, onClose }) {
  const [devotions, setDevotions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // Cherche large (par prénom OU nom), puis affine avec le même rapprochement par mots
        const cible = normaliseNom(`${membre.first_name} ${membre.last_name}`);
        const motsCible = new Set(cible.split(/\s+/).filter((w) => w.length > 1));
        const prenomMot = motsCible.values().next().value || membre.first_name;

        const large = await supaGet(
          "devotions",
          `submitter_name=ilike.*${encodeURIComponent(membre.last_name)}*&select=devotion_date,submitter_name,raw_snippet&order=devotion_date.desc`
        );
        const filtre = large.filter((d) => {
          const mots = new Set(normaliseNom(d.submitter_name).split(/\s+/).filter((w) => w.length > 1));
          // Exige que TOUS les mots du nom cible soient présents (prénom ET nom),
          // pas juste un seul -- évite de mélanger "Judeline Nicolas" et "Nicolas Rameau".
          for (const w of motsCible) if (!mots.has(w)) return false;
          return motsCible.size > 0;
        });
        setDevotions(filtre);
      } catch (e) {
        setDevotions([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [membre]);

  const premiereDate = devotions.length ? devotions[devotions.length - 1].devotion_date : null;
  const derniereDate = devotions.length ? devotions[0].devotion_date : null;
  const joursUniques = new Set(devotions.map((d) => d.devotion_date)).size;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "440px", maxWidth: "100%",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
        padding: "26px", boxShadow: "0 24px 60px rgba(36,30,24,0.3)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0, color: "var(--ink)" }}>
              {membre.first_name} {membre.last_name}
            </h2>
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "3px" }}>{membre.role}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)", padding: "4px" }}>
            <X size={18} />
          </button>
        </div>

        {!loading && devotions.length > 0 && (
          <div style={{ display: "flex", gap: "18px", marginTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: "26px", color: "var(--plum)" }}>{joursUniques}</div>
              <div style={{ fontSize: "11px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Unique days</div>
            </div>
            {joursUniques !== devotions.length && (
              <div>
                <div style={{ fontSize: "13px", color: "var(--gold)", fontWeight: 600, marginTop: "6px" }}>{devotions.length} entries</div>
                <div style={{ fontSize: "11px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>({devotions.length - joursUniques} duplicate{devotions.length - joursUniques > 1 ? "s" : ""})</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: "13px", color: "var(--ink)", fontWeight: 600, marginTop: "6px" }}>{premiereDate}</div>
              <div style={{ fontSize: "11px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>First</div>
            </div>
            <div>
              <div style={{ fontSize: "13px", color: "var(--ink)", fontWeight: 600, marginTop: "6px" }}>{derniereDate}</div>
              <div style={{ fontSize: "11px", color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>Most recent</div>
            </div>
          </div>
        )}

        <div style={{ marginTop: "14px", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Loading…</div>
          ) : devotions.length === 0 ? (
            <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>No devotions found for this person yet.</div>
          ) : (
            devotions.map((d, i) => (
              <div key={i} style={{
                display: "flex", flexDirection: "column", padding: "9px 0",
                borderBottom: i < devotions.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--ink)" }}>{d.devotion_date}</span>
                {d.raw_snippet && (
                  <span style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "2px" }}>{d.raw_snippet.slice(0, 90)}…</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function DevotionsView() {
  const [dateDebut, setDateDebut] = useState(debutSemaineCourante());
  const [dateFin, setDateFin] = useState(finSemaineCourante());
  const [devotions, setDevotions] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleOuvert, setRoleOuvert] = useState(null);
  const [personneOuverte, setPersonneOuverte] = useState(null);

  async function recharger() {
    setLoading(true);
    try {
      const [devs, mems] = await Promise.all([
        supaGet("devotions", `devotion_date=gte.${dateDebut}&devotion_date=lte.${dateFin}&select=submitter_name,devotion_date&limit=5000`),
        supaGetTout("members", "status=eq.active&select=member_id,first_name,last_name,role,phone"),
      ]);
      setDevotions(devs);
      setMembers(mems);
    } catch (e) {
      setDevotions([]); setMembers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { recharger(); }, [dateDebut, dateFin]);

  const { parRole, nonApparies } = useMemo(() => {
    // Prépare un index de membres par mots du nom, pour un rapprochement rapide
    const membresAvecCle = members.map((m) => ({
      ...m,
      motsNom: new Set(normaliseNom(`${m.first_name} ${m.last_name}`).split(/\s+/).filter((w) => w.length > 1)),
    }));

    function trouveMembreParNom(nomSoumis) {
      const mots = new Set(normaliseNom(nomSoumis).split(/\s+/).filter((w) => w.length > 1));
      // Si le nom soumis a prénom + nom (2 mots ou plus), exige au moins 2 mots en commun
      // pour éviter qu'un seul nom de famille partagé ne fasse matcher la mauvaise personne
      // (ex: "Nicolas Rameau" ne doit jamais correspondre à "Judeline Nicolas").
      const seuilRequis = mots.size >= 2 ? 2 : 1;
      let meilleur = null, meilleurScore = 0;
      for (const m of membresAvecCle) {
        let communs = 0;
        for (const w of mots) if (m.motsNom.has(w)) communs++;
        if (communs > meilleurScore) { meilleurScore = communs; meilleur = m; }
      }
      return meilleurScore >= seuilRequis ? meilleur : null;
    }

    // Pour chaque rôle : liste des membres, et le sous-ensemble ayant soumis
    const parRole = {};
    members.forEach((m) => {
      const role = m.role || "Membre";
      parRole[role] = parRole[role] || { tousLesMembres: [], aSoumisIds: new Set() };
      parRole[role].tousLesMembres.push(m);
    });

    const nonApparies = [];

    devotions.forEach((d) => {
      const membre = trouveMembreParNom(d.submitter_name);
      if (!membre) { nonApparies.push(d.submitter_name); return; }
      const role = membre.role || "Membre";
      if (!parRole[role]) parRole[role] = { tousLesMembres: [], aSoumisIds: new Set() };
      parRole[role].aSoumisIds.add(membre.member_id);
    });

    // Ajoute des champs pratiques : total, manquants (avec téléphone), et ceux qui ont soumis
    Object.values(parRole).forEach((v) => {
      v.total = v.tousLesMembres.length;
      v.manquants = v.tousLesMembres.filter((m) => !v.aSoumisIds.has(m.member_id));
      v.ontSoumis = v.tousLesMembres.filter((m) => v.aSoumisIds.has(m.member_id));
    });

    return { parRole, nonApparies: [...new Set(nonApparies)], trouveMembreParNom };
  }, [devotions, members]);

  // Grille hebdomadaire : pour chaque semaine (lundi à dimanche) de la période choisie,
  // qui a soumis au moins une fois -- l'équivalent fiable de l'onglet "SUIVI" de l'ancien fichier.
  const { jours, parJourParMembre, scoreParMembre } = useMemo(() => {
    // Liste chaque jour (pas semaine) entre dateDebut et dateFin -- comme l'onglet "SUIVI".
    const liste = [];
    let curseur = new Date(dateDebut + "T00:00:00");
    const finObj = new Date(dateFin + "T00:00:00");
    while (curseur <= finObj) {
      liste.push(curseur.toISOString().slice(0, 10));
      curseur.setDate(curseur.getDate() + 1);
    }

    const map = {}; // member_id -> Set(date exacte où soumis)
    devotions.forEach((d) => {
      const membre = trouveMembreParNomGlobal(d.submitter_name, members);
      if (!membre) return;
      map[membre.member_id] = map[membre.member_id] || new Set();
      map[membre.member_id].add(d.devotion_date);
    });

    // Score = nombre de jours distincts soumis dans la période (sur 7, si la période est 1 semaine)
    const scores = {};
    Object.entries(map).forEach(([id, set]) => { scores[id] = set.size; });

    return { jours: liste, parJourParMembre: map, scoreParMembre: scores };
  }, [devotions, members, dateDebut, dateFin]);

  const ORDRE_ROLES = ['Bethel Leader', 'Ananias', 'Overseer', 'Ministre Ordonné', 'Assistant Pasteur', 'Pasteur', 'Membre'];
  const rolesTries = Object.keys(parRole).sort((a, b) => {
    const ia = ORDRE_ROLES.indexOf(a); const ib = ORDRE_ROLES.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  const totalMembres = Object.values(parRole).reduce((s, v) => s + v.total, 0);
  const totalSoumis = Object.values(parRole).reduce((s, v) => s + v.ontSoumis.length, 0);
  const pctGlobal = totalMembres ? totalSoumis / totalMembres : 0;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Dévotions</h1>
          <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 16px" }}>
            Weekly devotion compliance vs {Math.round(OBJECTIF_DEVOTION * 100)}% goal, by role.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "18px" }}>
        <ImportDevotionsPanel onImported={recharger} />
        <AddDevotionManualPanel onAdded={recharger} />
      </div>

      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "20px", flexWrap: "wrap" }}>
        <label style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>
          From <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)}
            style={{ marginLeft: "6px", padding: "5px 8px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px" }} />
        </label>
        <label style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>
          To <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)}
            style={{ marginLeft: "6px", padding: "5px 8px", border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px" }} />
        </label>
        <button onClick={() => { setDateDebut(debutSemaineCourante()); setDateFin(finSemaineCourante()); }} style={{
          padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)",
          fontSize: "12px", color: "var(--ink-muted)", cursor: "pointer",
        }}>
          This week
        </button>
        {[1, 2, 3, 4].map((t) => (
          <button key={t} onClick={() => {
            const { debut, fin } = datesDuTrimestre(t, anneeFiscaleCourante());
            setDateDebut(debut); setDateFin(fin);
          }} style={{
            padding: "6px 12px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)",
            fontSize: "12px", color: "var(--ink-muted)", cursor: "pointer",
          }}>
            Q{t}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>Loading…</div>
      ) : (
        <>
          <div style={{
            border: "1px solid var(--border)", borderRadius: "10px", padding: "20px 22px",
            background: "var(--surface)", marginBottom: "18px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                Overall compliance
              </span>
              <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>Goal: {Math.round(OBJECTIF_DEVOTION * 100)}%</span>
            </div>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: "40px", marginTop: "4px",
              color: pctGlobal >= OBJECTIF_DEVOTION ? "var(--teal)" : "var(--brick)",
            }}>
              {Math.round(pctGlobal * 100)}%
            </div>
            <div style={{ height: "10px", background: "var(--bg)", borderRadius: "999px", overflow: "hidden", marginTop: "8px", position: "relative" }}>
              <div style={{ width: `${Math.min(100, pctGlobal * 100)}%`, height: "100%", background: pctGlobal >= OBJECTIF_DEVOTION ? "var(--teal)" : "var(--brick)" }} />
              <div style={{ position: "absolute", left: `${OBJECTIF_DEVOTION * 100}%`, top: 0, bottom: 0, width: "2px", background: "var(--ink)" }} />
            </div>
            <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "6px" }}>
              {totalSoumis} of {totalMembres} active members submitted at least one devotion in this period.
            </div>
          </div>

          <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "20px", background: "var(--surface)" }}>
            {rolesTries.map((role) => {
              const v = parRole[role];
              const pct = v.total ? v.ontSoumis.length / v.total : 0;
              const ok = pct >= OBJECTIF_DEVOTION;
              const estOuvert = roleOuvert === role;
              return (
                <div key={role} style={{ marginBottom: "16px" }}>
                  <button
                    onClick={() => setRoleOuvert(estOuvert ? null : role)}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px", marginBottom: "5px" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600, display: "flex", alignItems: "center", gap: "5px" }}>
                        {role} <ChevronRight size={12} style={{ transform: estOuvert ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                      </span>
                      <span style={{ color: ok ? "var(--teal)" : "var(--brick)", fontWeight: 600 }}>
                        {v.ontSoumis.length} / {v.total} ({Math.round(pct * 100)}%)
                      </span>
                    </div>
                    <div style={{ height: "8px", background: "var(--bg)", borderRadius: "999px", overflow: "hidden", position: "relative" }}>
                      <div style={{ width: `${Math.min(100, pct * 100)}%`, height: "100%", background: ok ? "var(--teal)" : "var(--brick)" }} />
                      <div style={{ position: "absolute", left: `${OBJECTIF_DEVOTION * 100}%`, top: 0, bottom: 0, width: "1.5px", background: "var(--ink-muted)", opacity: 0.5 }} />
                    </div>
                  </button>

                  {estOuvert && (
                    <div style={{ marginTop: "10px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
                      {v.manquants.length > 0 && (
                        <>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "8px" }}>
                            📞 Missing — call for encouragement ({v.manquants.length})
                          </div>
                          {v.manquants.map((m) => (
                            <button key={m.member_id} onClick={() => setPersonneOuverte(m)} style={{
                              display: "flex", width: "100%", justifyContent: "space-between", padding: "5px 0",
                              fontSize: "12.5px", borderBottom: "1px solid var(--border)", background: "none",
                              border: "none", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-body)",
                            }}>
                              <span style={{ color: "var(--ink)", textDecoration: "underline", textDecorationColor: "var(--border)" }}>{m.first_name} {m.last_name}</span>
                              <span style={{ color: "var(--ink-muted)", fontFamily: "var(--font-mono)" }}>{m.phone || "no phone"}</span>
                            </button>
                          ))}
                        </>
                      )}
                      {v.ontSoumis.length > 0 && (
                        <>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", textTransform: "uppercase", letterSpacing: "0.03em", margin: "14px 0 8px" }}>
                            ✓ Submitted ({v.ontSoumis.length})
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--ink-muted)", lineHeight: 1.9 }}>
                            {v.ontSoumis.map((m, idx) => (
                              <span key={m.member_id}>
                                <button onClick={() => setPersonneOuverte(m)} style={{
                                  background: "none", border: "none", cursor: "pointer", padding: 0,
                                  color: "var(--ink-muted)", textDecoration: "underline", textDecorationColor: "var(--border)",
                                  fontSize: "12px", fontFamily: "var(--font-body)",
                                }}>
                                  {m.first_name} {m.last_name}
                                </button>
                                {idx < v.ontSoumis.length - 1 ? ", " : ""}
                              </span>
                            ))}
                          </div>
                        </>
                      )}

                      {jours.length > 1 && v.tousLesMembres.length > 0 && (
                        <div style={{ marginTop: "16px", overflowX: "auto" }}>
                          <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "8px" }}>
                            📅 Daily breakdown — sorted by score
                          </div>
                          <table style={{ borderCollapse: "collapse", fontSize: "11px", whiteSpace: "nowrap" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "4px 10px 4px 0", color: "var(--ink-muted)", position: "sticky", left: 0, background: "var(--bg)" }}>Name</th>
                                <th style={{ padding: "4px 8px", color: "var(--ink-muted)", fontWeight: 700 }}>Score</th>
                                {jours.map((j) => (
                                  <th key={j} style={{ padding: "4px 6px", color: "var(--ink-muted)", fontWeight: 600 }}>
                                    {new Date(j + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", day: "numeric" })}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {[...v.tousLesMembres]
                                .sort((a, b) => (scoreParMembre[b.member_id] || 0) - (scoreParMembre[a.member_id] || 0))
                                .map((m) => {
                                  const score = scoreParMembre[m.member_id] || 0;
                                  const pct = jours.length ? Math.round((score / jours.length) * 100) : 0;
                                  return (
                                    <tr key={m.member_id}>
                                      <td style={{
                                        padding: "3px 10px 3px 0", color: "var(--ink)", position: "sticky", left: 0,
                                        background: "var(--bg)", cursor: "pointer", textDecoration: "underline", textDecorationColor: "var(--border)",
                                      }} onClick={() => setPersonneOuverte(m)}>
                                        {m.first_name} {m.last_name}
                                      </td>
                                      <td style={{
                                        padding: "3px 8px", textAlign: "center", fontWeight: 700,
                                        color: pct >= Math.round(OBJECTIF_DEVOTION * 100) ? "var(--teal)" : score === 0 ? "var(--brick)" : "var(--gold)",
                                      }}>
                                        {score}/{jours.length} ({pct}%)
                                      </td>
                                      {jours.map((j) => {
                                        const aSoumis = parJourParMembre[m.member_id]?.has(j);
                                        return (
                                          <td key={j} style={{ padding: "3px 6px", textAlign: "center" }}>
                                            <span style={{ color: aSoumis ? "var(--teal)" : "var(--border)" }}>{aSoumis ? "✓" : "·"}</span>
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  );
                                })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {nonApparies.length > 0 && (
            <div style={{ marginTop: "18px" }}>
              <button onClick={() => setRoleOuvert(roleOuvert === "unmatched" ? null : "unmatched")} style={{
                background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)",
                fontSize: "12.5px", padding: 0, textDecoration: "underline",
              }}>
                {roleOuvert === "unmatched" ? "Hide" : "Show"} {nonApparies.length} unmatched submitter name(s)
              </button>
              {roleOuvert === "unmatched" && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--ink-muted)", lineHeight: 1.8 }}>
                  {nonApparies.join(", ")}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {personneOuverte && (
        <PersonDevotionModal membre={personneOuverte} onClose={() => setPersonneOuverte(null)} />
      )}
    </div>
  );
}

export default function BethelAdminPortal() {
  return (
    <>
      <SignedOut>
        <div style={{
          minHeight: "600px", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#FAF6EF", borderRadius: "12px", border: "1px solid #E4DACB",
        }}>
          <SignIn />
        </div>
      </SignedOut>
      <SignedIn>
        <BethelAdminPortalInner />
      </SignedIn>
    </>
  );
}

function BethelAdminPortalInner() {
  const [view, setView] = useState("dashboard");
  const [zones, setZones] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [bethels, setBethels] = useState([]);
  const [campusId, setCampusId] = useState(null);
  const [activateFor, setActivateFor] = useState(null);
  const [assignFor, setAssignFor] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [showNewSubmission, setShowNewSubmission] = useState(false);
  const [detailFor, setDetailFor] = useState(null);
  const [activating, setActivating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [memberCounts, setMemberCounts] = useState({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [zonesData, campusesData, submissionsData, bethelsRaw, membresLegers, responsables] = await Promise.all([
        supaGet("data_zones", "select=*&is_active=eq.true&order=zone_name.asc"),
        supaGet("campuses", "select=*&campus_code=eq.MTL"),
        supaGet("submissions", "select=*&order=submitted_at.desc&limit=5000"),
        // Charge TOUS les Bethels (actifs ET inactifs) -- avant, le filtre
        // "status=eq.active" excluait carrément les Bethels inactifs des
        // données de l'appli, ce qui rendait les boutons de filtre
        // "Active/Inactive" de l'écran Bethels inutiles (un Bethel inactif
        // n'apparaissait jamais, même sous "Inactive" ou "All"), et le
        // Bethel d'un membre inactif s'affichait comme "Bethel not found"
        // dans Search Members.
        supaGet("bethels", "select=*&order=created_at.desc&limit=5000"),
        supaGetTout("members", "select=bethel_id,first_name,last_name,willing_to_host"),
        // Responsables (Bethel Leader actifs) : nom + courriel pour la page Bethels
        supaGetTout("members", "select=bethel_id,first_name,last_name,email&role=eq.Bethel%20Leader&status=eq.active"),
      ]);
      setZones(zonesData);
      if (campusesData[0]) setCampusId(campusesData[0].campus_id);
      setSubmissions(submissionsData);

      const compteurs = {};
      const membresParBethel = {};
      membresLegers.forEach((m) => {
        compteurs[m.bethel_id] = (compteurs[m.bethel_id] || 0) + 1;
        membresParBethel[m.bethel_id] = membresParBethel[m.bethel_id] || [];
        membresParBethel[m.bethel_id].push(m);
      });
      setMemberCounts(compteurs);

      const zoneById = Object.fromEntries(zonesData.map((z) => [z.zone_id, z]));
      // Prépare une liste de soumissions avec leurs mots de nom, pour une comparaison
      // souple (peu importe l'ordre prénom/nom, ou un nom du milieu en trop).
      const soumissionsAvecMots = submissionsData.map((s) => ({
        ...s,
        motsNom: new Set(normaliseNom(`${s.first_name} ${s.last_name}`).split(/\s+/).filter((w) => w.length > 1)),
      }));

      function trouveSoumissionDuLeader(nomLeader) {
        const mots = new Set(normaliseNom(nomLeader).split(/\s+/).filter((w) => w.length > 1));
        if (mots.size === 0) return null;
        const seuil = mots.size >= 2 ? 2 : 1;
        let meilleur = null, meilleurScore = 0;
        for (const s of soumissionsAvecMots) {
          let communs = 0;
          for (const w of mots) if (s.motsNom.has(w)) communs++;
          if (communs > meilleurScore) { meilleurScore = communs; meilleur = s; }
        }
        return meilleurScore >= seuil ? meilleur : null;
      }

      const responsableParBethel = {};
      responsables.forEach((m) => { if (!responsableParBethel[m.bethel_id]) responsableParBethel[m.bethel_id] = m; });

      setBethels(bethelsRaw.map((b) => {
        const resp = responsableParBethel[b.bethel_id];
        const soumissionDuLeader = trouveSoumissionDuLeader(b.leader_name || "");
        return {
          ...b,
          has_leader_member: !!resp,
          leader_full_name: resp ? `${resp.first_name || ""} ${resp.last_name || ""}`.trim() : "",
          leader_email: resp?.email || "",
          zone_name: zoneById[b.zone_id]?.zone_name || "Unknown zone",
          zone_code: zoneById[b.zone_id]?.zone_code || "",
          city_name: zoneById[b.zone_id]?.city_name || "",
          region: zoneById[b.zone_id]?.region || "",
          // null = aucune soumission trouvée pour ce leader (probablement un des 191 groupes
          // importés au tout début, avant l'existence du formulaire numérique)
          leader_willing_to_host: soumissionDuLeader ? soumissionDuLeader.willing_to_host : null,
        };
      }));
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleActivate = useCallback(async (submission, zone) => {
    setActivating(true);
    try {
      // Détermine le bon préfixe de ville à partir du nom de la zone choisie
      // (ex: "Laval Chomedey" -> LVL, "Repentigny Repentigny" -> RPT), pour que
      // la numérotation continue celle de la vraie ville, pas toujours Montréal.
      const PREFIXE_PAR_VILLE = {
        'Montreal': 'MTL', 'Laval': 'LVL', 'Repentigny': 'RPT', 'Terrebonne': 'TRB',
        'Trois-Rivières': 'TRM', 'Sherbrooke': 'SHR', 'Région': 'QBC',
        'Lachenaie': 'LCN', 'Mascouche': 'MSC', 'Longueuil': 'LNG',
        'Winnipeg': 'WIN', 'Manitoba': 'MTA', 'New-Brunswick': 'NBW', 'Alberta': 'ALB',
      };
      const premierMot = zone.zone_name.split(' ')[0];
      const prefixeVille = PREFIXE_PAR_VILLE[premierMot] || 'MTL';

      let nouveauNumero = `BETHEL-${prefixeVille}-${Date.now()}`; // repli si la recherche échoue
      try {
        const existants = await supaGet("bethels", `hp_number=like.BETHEL-${prefixeVille}-*&select=hp_number`);
        let max = 0;
        existants.forEach((b) => {
          const m = b.hp_number.match(new RegExp(`^BETHEL-${prefixeVille}-(\\d+)`));
          if (m) {
            const n = parseInt(m[1], 10);
            if (n > max) max = n;
          }
        });
        nouveauNumero = `BETHEL-${prefixeVille}-${max + 1}`;
      } catch (e) { /* on garde le repli si la recherche échoue */ }

      const [nouveauBethel] = await supaPost("bethels", {
        hp_number: nouveauNumero,
        campus_id: CAMPUS_FIXE_ID,
        zone_id: zone.zone_id,
        leader_name: `${submission.first_name} ${submission.last_name}`,
        leader_role: submission.leadership_level === "hp_leader" ? "Bethel Leader" : (LEADERSHIP_LABELS[submission.leadership_level] || "Membre"),
        host_name: `${submission.first_name} ${submission.last_name}`,
        address: submission.address,
        status: "active",
      });

      // Ajoute automatiquement la leader/hôtesse elle-même comme premier membre
      // de son propre Bethel -- sinon le groupe reste vide même si elle en est
      // clairement responsable.
      if (nouveauBethel) {
        try {
          await supaPost("members", {
            bethel_id: nouveauBethel.bethel_id,
            first_name: submission.first_name,
            last_name: submission.last_name,
            phone: submission.phone,
            address: submission.address,
            role: submission.leadership_level === "hp_leader" ? "Bethel Leader" : (LEADERSHIP_LABELS[submission.leadership_level] || "Membre"),
            willing_to_host: true,
            status: "active",
          });
        } catch (e) { /* la fiche Bethel reste créée même si cet ajout échoue */ }
      }

      await supaPatch("submissions", `submission_id=eq.${submission.submission_id}`, {
        status: "approved", zone_id: zone.zone_id, reviewed_at: new Date().toISOString(),
      });
      setActivateFor(null);
      await loadAll();
    } catch (e) {
      alert("Error activating Bethel: " + e.message);
    } finally {
      setActivating(false);
    }
  }, [loadAll]);

  const handleAssign = useCallback(async (submission, targetBethel) => {
    setAssigning(true);
    try {
      await supaPost("members", {
        bethel_id: targetBethel.bethel_id,
        first_name: submission.first_name,
        last_name: submission.last_name,
        phone: submission.phone,
        address: submission.address,
        role: submission.leadership_level === "hp_leader" ? "Bethel Leader" : (LEADERSHIP_LABELS[submission.leadership_level] || "Membre"),
        willing_to_host: false,
        status: "active",
      });
      await supaPatch("submissions", `submission_id=eq.${submission.submission_id}`, {
        status: "approved", zone_id: targetBethel.zone_id, reviewed_at: new Date().toISOString(),
      });
      setAssignFor(null);
      await loadAll();
    } catch (e) {
      alert("Error assigning member: " + e.message);
    } finally {
      setAssigning(false);
    }
  }, [loadAll]);

  return (
    <div style={{
      "--bg": "#FAF6EF", "--surface": "#FFFFFF", "--border": "#E4DACB",
      "--ink": "#241E18", "--ink-muted": "#8A7E6C",
      "--plum": "#6B2A3E", "--teal": "#1F5C4E", "--gold": "#B8863B", "--brick": "#A23B33",
      "--font-display": "'Fraunces', Georgia, serif",
      "--font-body": "'Inter', -apple-system, sans-serif",
      "--font-mono": "'IBM Plex Mono', ui-monospace, monospace",
      background: "var(--bg)", minHeight: "600px", display: "flex",
      fontFamily: "var(--font-body)", color: "var(--ink)", borderRadius: "12px", overflow: "hidden",
      border: "1px solid var(--border)",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        button:focus-visible, input:focus-visible { outline: 2px solid var(--plum); outline-offset: 1px; }
      `}</style>

      <aside style={{ width: "210px", flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)", padding: "20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "0 8px", marginBottom: "22px" }}>
          <div style={{ width: "26px", height: "26px", borderRadius: "6px", background: "var(--plum)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Sparkles size={14} color="#F4E9DC" />
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "17px", fontWeight: 600 }}>Bethel</span>
        </div>
        {NAV.map((n) => {
          const Icon = n.icon;
          const active = view === n.id;
          return (
            <button key={n.id} onClick={() => setView(n.id)} style={{
              display: "flex", alignItems: "center", gap: "10px", width: "100%", textAlign: "left",
              padding: "9px 10px", borderRadius: "8px", border: "none", marginBottom: "2px",
              background: active ? "rgba(107,42,62,0.09)" : "transparent",
              color: active ? "var(--plum)" : "var(--ink-muted)",
              fontSize: "13.5px", fontWeight: active ? 600 : 500, cursor: "pointer",
            }}>
              <Icon size={16} />
              {n.label}
            </button>
          );
        })}
        <button onClick={loadAll} style={{
          marginTop: "18px", display: "flex", alignItems: "center", gap: "8px", width: "100%",
          padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--bg)",
          color: "var(--ink-muted)", fontSize: "12px", cursor: "pointer",
        }}>
          <RefreshCw size={13} /> Actualiser depuis Supabase
        </button>
        <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px" }}>
          <UserButton afterSignOutUrl="/" />
          <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>Connecté</span>
        </div>
      </aside>

      <main style={{ flex: 1, padding: "28px 32px", overflowY: "auto", maxHeight: "700px" }}>
        {loadError && (
          <div style={{
            marginBottom: "18px", padding: "12px 16px", borderRadius: "8px",
            background: "rgba(162,59,51,0.08)", color: "var(--brick)", fontSize: "13px",
          }}>
            Could not load from Supabase: {loadError}
          </div>
        )}
        {loading ? (
          <div style={{ color: "var(--ink-muted)", fontSize: "14px" }}>Loading from Supabase…</div>
        ) : (
          <>
            {view === "dashboard" && <DashboardView submissions={submissions} bethels={bethels} zones={zones} onNavigate={setView} />}
            {view === "submissions" && (
              <SubmissionsView
                submissions={submissions}
                onOpenActivate={setActivateFor}
                onOpenAssign={setAssignFor}
                onAddNew={() => setShowNewSubmission(true)}
              />
            )}
            {view === "bethels" && <BethelsView bethels={bethels} memberCounts={memberCounts} onOpenDetail={setDetailFor} onReload={loadAll} />}
            {view === "manage-members" && <ManageMembersView bethels={bethels} onChanged={loadAll} />}
            {view === "search" && <SearchMembersView bethels={bethels} onOpenBethel={setDetailFor} />}
            {view === "devotions" && <DevotionsView />}
            {view === "attendance" && <AttendanceView />}
            {view === "reports" && <ReportsView submissions={submissions} bethels={bethels} zones={zones} onChanged={loadAll} />}
            {view === "zones" && <ZoneLookupView zones={zones} />}
          </>
        )}
      </main>

      {activateFor && (
        <ActivateModal
          submission={activateFor}
          zones={zones}
          onClose={() => setActivateFor(null)}
          onActivate={handleActivate}
          activating={activating}
        />
      )}
      {showNewSubmission && (
        <NewSubmissionModal
          campusId={campusId}
          onClose={() => setShowNewSubmission(false)}
          onCreated={() => { setShowNewSubmission(false); loadAll(); }}
        />
      )}
      {detailFor && (
        <BethelDetailModal
          bethel={detailFor}
          bethels={bethels}
          zones={zones}
          onClose={() => setDetailFor(null)}
          onChanged={loadAll}
        />
      )}
      {assignFor && (
        <AssignMemberModal
          submission={assignFor}
          zones={zones}
          bethels={bethels}
          onClose={() => setAssignFor(null)}
          onAssign={handleAssign}
          assigning={assigning}
        />
      )}
    </div>
  );
}
