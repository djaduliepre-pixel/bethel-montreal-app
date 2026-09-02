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
function nettoyerAdressePourGoogleMaps(adresse) {
  return String(adresse || "").replace(/\s*\[Secteur:[^\]]*\]\s*/gi, "").trim();
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
  'H1T':'Montreal Rosemont–La Petite-Patrie','H1X':'Montreal Rosemont–La Petite-Patrie',
  'H1Y':'Montreal Rosemont–La Petite-Patrie','H2G':'Montreal Rosemont–La Petite-Patrie','H2S':'Montreal Rosemont–La Petite-Patrie',
  'H1Z':'Montreal Saint-Michel','H2A':'Montreal Saint-Michel',
  'H2E':'Montreal Villeray','H2P':'Montreal Villeray','H2R':'Montreal Villeray',
  'H3N':'Montreal Parc-Extension',
  'H1P':'Montreal Saint-Léonard','H1R':'Montreal Saint-Léonard','H1S':'Montreal Saint-Léonard',
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
  'J5Y':'Repentigny Repentigny','J6A':'Repentigny Repentigny','J5Z':'Repentigny Repentigny','J5W':'Repentigny Repentigny',
  'J6X':'Terrebonne Terrebonne','J6Y':'Terrebonne Terrebonne','J6V':'Terrebonne Terrebonne','J6W':'Terrebonne Terrebonne','J7M':'Terrebonne Terrebonne',
  'J7K':'Mascouche Mascouche','J7L':'Mascouche Mascouche',
  'J6E':'Repentigny Repentigny', // L'Assomption/région -- meilleure approximation dispo
  'J6N':'Laval Auteuil', // Sainte-Thérèse/Blainville, proche Laval
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
    first_name: "", last_name: "", phone: "", address: "",
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
        address: form.address,
        campus_id: campusId,
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

function AddMemberForm({ bethelId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", address: "", postal_code: "", role: "Membre" });
  const [saving, setSaving] = useState(false);
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "7px 9px", marginBottom: "7px",
    border: "1px solid var(--border)", borderRadius: "6px", fontSize: "12.5px", fontFamily: "var(--font-body)",
  };

  async function submit() {
    if (!form.first_name || !form.last_name) return;
    setSaving(true);
    try {
      const avertissement = await verifierDoublon(form.first_name, form.last_name);
      if (avertissement && !window.confirm(`${avertissement}\n\nAdd this member anyway?`)) {
        setSaving(false);
        return;
      }
      await supaPost("members", { ...form, bethel_id: bethelId, status: "active" });
      setForm({ first_name: "", last_name: "", phone: "", address: "", postal_code: "", role: "Membre" });
      setOpen(false);
      onAdded();
    } catch (e) { alert("Error: " + e.message); } finally { setSaving(false); }
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

  return (
    <div style={{ marginTop: "12px", padding: "12px", background: "var(--bg)", borderRadius: "8px" }}>
      <input style={inputStyle} placeholder="First name" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
      <input style={inputStyle} placeholder="Last name" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
      <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formaterTelephone(e.target.value) }))} />
      <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
      <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: formaterCodePostal(e.target.value) }))} />
      <select style={inputStyle} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
        {["Membre", "Ananias", "Bethel Leader", "Overseer", "Ministre Ordonné", "Assistant Pasteur", "Pasteur"].map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <div style={{ display: "flex", gap: "8px" }}>
        <button disabled={saving} onClick={submit} style={{ padding: "7px 14px", borderRadius: "6px", border: "none", background: "var(--plum)", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={() => setOpen(false)} style={{ padding: "7px 14px", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre : détail d'un Bethel, avec ses membres                     */
/* ------------------------------------------------------------------ */
function FindNearbyMembersPanel({ bethel, onAssigned }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [candidats, setCandidats] = useState([]);
  const [assigningId, setAssigningId] = useState(null);

  async function lancerRecherche() {
    if (!bethel.address) return;
    setLoading(true);
    setOpen(true);
    try {
      const [pendants, membresActifs] = await Promise.all([
        supaGet("submissions", "status=eq.pending&willing_to_host=eq.false&select=submission_id,first_name,last_name,phone,address,leadership_level"),
        supaGet("members", "status=eq.active&select=first_name,last_name&limit=5000"),
      ]);
      // Exclut toute personne qui a une vieille soumission "Non" en attente,
      // mais qui existe DÉJÀ comme membre actif ailleurs (ex: elle a dit "Non"
      // il y a longtemps, puis "Oui" plus récemment et a déjà son propre Bethel).
      const nomsDejaMembres = new Set(membresActifs.map((m) => normaliseNom(`${m.first_name} ${m.last_name}`)));
      const pendantsFiltres = pendants.filter((p) => !nomsDejaMembres.has(normaliseNom(`${p.first_name} ${p.last_name}`)));

      const avecDistance = await Promise.all(
        pendantsFiltres.filter((p) => p.address).map(async (p) => {
          try {
            const minutes = await getDrivingMinutes(p.address, bethel.address);
            return { ...p, minutes, error: null };
          } catch (e) {
            return { ...p, minutes: null, error: e.message };
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

  async function assigner(candidat) {
    setAssigningId(candidat.submission_id);
    try {
      await supaPost("members", {
        bethel_id: bethel.bethel_id,
        first_name: candidat.first_name, last_name: candidat.last_name, phone: candidat.phone,
        address: candidat.address,
        role: LEADERSHIP_LABELS[candidat.leadership_level] || "Membre",
        willing_to_host: false, status: "active",
      });
      await supaPatch("submissions", `submission_id=eq.${candidat.submission_id}`, {
        status: "approved", zone_id: bethel.zone_id, reviewed_at: new Date().toISOString(),
      });
      setCandidats((c) => c.filter((x) => x.submission_id !== candidat.submission_id));
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
        ⚠️ Add an address to this Bethel before searching for nearby members.
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
          <Search size={14} /> Find Nearby Members
        </button>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "16px", background: "var(--bg)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>Nearby pending members ("No" submissions)</span>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-muted)" }}><X size={16} /></button>
          </div>
          {loading ? (
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>Checking travel times for all pending submissions…</div>
          ) : candidats.length === 0 ? (
            <div style={{ fontSize: "12.5px", color: "var(--ink-muted)" }}>No pending "No" submissions with a usable address found.</div>
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
              {candidats.map((c) => (
              <div key={c.submission_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0",
                borderBottom: "1px solid var(--border)",
              }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)" }}>{c.first_name} {c.last_name}</div>
                  <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{c.address}</div>
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
                    disabled={assigningId === c.submission_id}
                    onClick={() => assigner(c)}
                    style={{
                      padding: "5px 12px", borderRadius: "6px", border: "none", background: "var(--plum)",
                      color: "#fff", fontSize: "11.5px", fontWeight: 600, cursor: "pointer",
                    }}
                  >
                    {assigningId === c.submission_id ? "…" : "Assign"}
                  </button>
                </div>
              </div>
              ))}
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
          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "10px" }}>
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

          <AddMemberForm bethelId={bethel.bethel_id} onAdded={loadMembers} />
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
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Org Chart</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        Auto-generated from each member's supervision chain fields. Click a row to expand.
      </p>

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

function DashboardView({ submissions, bethels, zones, onNavigate }) {
  const pending = submissions.filter((s) => s.status === "pending").length;
  const willing = submissions.filter((s) => s.willing_to_host).length;
  const pct = submissions.length ? Math.round((willing / submissions.length) * 100) : 0;

  const readyToActivate = submissions.filter((s) => s.status === "pending" && s.willing_to_host).length;
  const readyToAssign = submissions.filter((s) => s.status === "pending" && !s.willing_to_host).length;
  const approved = submissions.filter((s) => s.status === "approved").length;

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Dashboard</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 24px" }}>
        Live data from your Supabase database — bethel-montreal-app.
      </p>
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
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Submissions</h1>
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

function BethelsView({ bethels, memberCounts, onOpenDetail }) {
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("all");
  const [villeChoisie, setVilleChoisie] = useState("all");
  const [sousZoneChoisie, setSousZoneChoisie] = useState("all");

  const filtres = [
    { id: "all", label: "All" },
    { id: "needs_members", label: "Needs Members" },
    { id: "active", label: "Active" },
    { id: "inactive", label: "Inactive" },
    { id: "willing_yes", label: "Willing: Yes" },
    { id: "willing_no", label: "Willing: No" },
  ];

  const villes = useMemo(() => {
    const compteurs = {};
    bethels.forEach((b) => {
      const v = b.city_name || b.zone_name || "Unknown";
      compteurs[v] = (compteurs[v] || 0) + 1;
    });
    return Object.entries(compteurs).sort((a, b) => b[1] - a[1]); // triées par nombre décroissant
  }, [bethels]);

  // Sous-zones précises (ex: "Laval Chomedey", "Laval Vimont") disponibles UNE FOIS qu'une ville est choisie
  const sousZones = useMemo(() => {
    if (villeChoisie === "all") return [];
    const compteurs = {};
    bethels
      .filter((b) => (b.city_name || b.zone_name) === villeChoisie)
      .forEach((b) => { compteurs[b.zone_name] = (compteurs[b.zone_name] || 0) + 1; });
    const entries = Object.entries(compteurs);
    return entries.length > 1 ? entries.sort((a, b) => b[1] - a[1]) : []; // pas utile si une seule sous-zone
  }, [bethels, villeChoisie]);

  const resultats = useMemo(() => {
    let liste = bethels;
    if (filtre === "needs_members") liste = liste.filter((b) => (memberCounts[b.bethel_id] || 0) === 0);
    if (filtre === "active") liste = liste.filter((b) => b.status !== "inactive");
    if (filtre === "inactive") liste = liste.filter((b) => b.status === "inactive");
    if (filtre === "willing_yes") liste = liste.filter((b) => b.leader_willing_to_host === true);
    if (filtre === "willing_no") liste = liste.filter((b) => b.leader_willing_to_host === false);
    if (villeChoisie !== "all") liste = liste.filter((b) => (b.city_name || b.zone_name) === villeChoisie);
    if (sousZoneChoisie !== "all") liste = liste.filter((b) => b.zone_name === sousZoneChoisie);

    const q = recherche.trim().toLowerCase();
    if (q.length >= 1) {
      liste = liste.filter((b) =>
        (b.leader_name || "").toLowerCase().includes(q) || (b.hp_number || "").toLowerCase().includes(q)
      );
    }
    return liste;
  }, [bethels, memberCounts, filtre, recherche, villeChoisie, sousZoneChoisie]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Bethels</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 16px" }}>
        Campus: TG Montreal — {bethels.length} total.
      </p>

      <div style={{ position: "relative", maxWidth: "360px", marginBottom: "14px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Search by name or church ID…"
          style={{
            width: "100%", boxSizing: "border-box", padding: "8px 10px 8px 32px",
            border: "1px solid var(--border)", borderRadius: "8px", fontSize: "13.5px", outline: "none",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
        {filtres.map((f) => (
          <button key={f.id} onClick={() => setFiltre(f.id)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${filtre === f.id ? "var(--plum)" : "var(--border)"}`,
            background: filtre === f.id ? "var(--plum)" : "var(--surface)",
            color: filtre === f.id ? "#fff" : "var(--ink-muted)", cursor: "pointer",
          }}>
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "6px" }}>
          Browse by city
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button onClick={() => { setVilleChoisie("all"); setSousZoneChoisie("all"); }} style={{
            padding: "5px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600,
            border: `1px solid ${villeChoisie === "all" ? "var(--teal)" : "var(--border)"}`,
            background: villeChoisie === "all" ? "rgba(31,92,78,0.10)" : "var(--surface)",
            color: villeChoisie === "all" ? "var(--teal)" : "var(--ink-muted)", cursor: "pointer",
          }}>
            All cities
          </button>
          {villes.map(([ville, count]) => (
            <button key={ville} onClick={() => { setVilleChoisie(ville); setSousZoneChoisie("all"); }} style={{
              padding: "5px 12px", borderRadius: "999px", fontSize: "12px", fontWeight: 600,
              border: `1px solid ${villeChoisie === ville ? "var(--teal)" : "var(--border)"}`,
              background: villeChoisie === ville ? "rgba(31,92,78,0.10)" : "var(--surface)",
              color: villeChoisie === ville ? "var(--teal)" : "var(--ink-muted)", cursor: "pointer",
            }}>
              {ville} ({count})
            </button>
          ))}
        </div>

        {sousZones.length > 0 && (
          <div style={{ marginTop: "10px" }}>
            <div style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--ink-muted)", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: "6px" }}>
              Narrow by neighborhood
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button onClick={() => setSousZoneChoisie("all")} style={{
                padding: "4px 10px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600,
                border: `1px solid ${sousZoneChoisie === "all" ? "var(--gold)" : "var(--border)"}`,
                background: sousZoneChoisie === "all" ? "rgba(184,134,59,0.10)" : "var(--surface)",
                color: sousZoneChoisie === "all" ? "var(--gold)" : "var(--ink-muted)", cursor: "pointer",
              }}>
                All neighborhoods
              </button>
              {sousZones.map(([sz, count]) => (
                <button key={sz} onClick={() => setSousZoneChoisie(sz)} style={{
                  padding: "4px 10px", borderRadius: "999px", fontSize: "11.5px", fontWeight: 600,
                  border: `1px solid ${sousZoneChoisie === sz ? "var(--gold)" : "var(--border)"}`,
                  background: sousZoneChoisie === sz ? "rgba(184,134,59,0.10)" : "var(--surface)",
                  color: sousZoneChoisie === sz ? "var(--gold)" : "var(--ink-muted)", cursor: "pointer",
                }}>
                  {sz.replace(villeChoisie, "").trim() || sz} ({count})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>


      {resultats.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No Bethels match this search/filter.
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Church ID</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Leader</th>
                <th style={{ textAlign: "center", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Willing?</th>
                <th style={{ textAlign: "center", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Members</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Zone</th>
                <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Status</th>
                <th style={{ textAlign: "right", padding: "10px 14px", color: "var(--ink-muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.03em" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {resultats.map((b, i) => {
                const count = memberCounts[b.bethel_id] || 0;
                return (
                  <tr key={b.bethel_id} style={{ borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "10px 14px" }}>
                      <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink)" }}>{b.hp_number}</div>
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <button
                        onClick={() => onOpenDetail(b)}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: 0,
                          color: "var(--ink)", fontWeight: 600, fontSize: "13px", fontFamily: "var(--font-body)",
                          textDecoration: "underline", textDecorationColor: "var(--border)",
                        }}
                      >
                        {b.leader_name || "—"}
                      </button>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      {b.leader_willing_to_host === true ? (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--teal)", background: "rgba(31,92,78,0.10)", padding: "2px 9px", borderRadius: "999px" }}>Yes</span>
                      ) : b.leader_willing_to_host === false ? (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)", background: "rgba(162,59,51,0.10)", padding: "2px 9px", borderRadius: "999px" }}>No</span>
                      ) : (
                        <span style={{ fontSize: "11px", color: "var(--ink-muted)" }} title="No matching submission found — likely one of the original 191 imported groups">—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      {count === 0 ? (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--brick)" }}>0 NEEDED</span>
                      ) : (
                        <span style={{ color: "var(--ink)" }}>{count}</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--ink-muted)", fontSize: "12px" }}>{b.zone_name}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{
                        fontSize: "11px", padding: "2px 9px", borderRadius: "999px", fontWeight: 600,
                        background: b.status === "inactive" ? "rgba(162,59,51,0.10)" : "rgba(31,92,78,0.10)",
                        color: b.status === "inactive" ? "var(--brick)" : "var(--teal)",
                      }}>
                        {b.status === "inactive" ? "Inactive" : "Active"}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right" }}>
                      <button onClick={() => onOpenDetail(b)} style={{
                        padding: "5px 12px", borderRadius: "6px", border: "1px solid var(--plum)",
                        background: "transparent", color: "var(--plum)", fontSize: "12px", fontWeight: 600, cursor: "pointer",
                      }}>
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sansContact, sansAdresse, sansEmail] = await Promise.all([
          supaGet("members", "or=(and(phone.is.null,email.is.null),and(phone.eq.,email.eq.))&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id&limit=5000"),
          supaGet("members", "or=(address.is.null,address.eq.)&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id&limit=5000"),
          supaGet("members", "or=(email.is.null,email.eq.)&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id&limit=5000"),
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
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Reports</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 16px" }}>
        {tab === "hosting" ? "Willing-to-host, broken down by leadership level." : tab === "gaps" ? "Members missing key information." : "Bethels whose zone doesn't match their address."}
      </p>

      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {[{ id: "hosting", label: "Willing to Host" }, { id: "gaps", label: "Data Gaps" }, { id: "zonemismatch", label: "Zone Mismatches" }].map((t) => (
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

      {tab === "hosting" ? (
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
      ) : (
        <ZoneMismatchReport zones={zones} onChanged={onChanged} />
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
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Search Members</h1>
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
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "submissions", label: "Submissions", icon: Inbox },
  { id: "bethels", label: "Bethels", icon: Users },
  { id: "search", label: "Search Members", icon: Search },
  { id: "devotions", label: "Devotions", icon: BookOpen },
  { id: "orgchart", label: "Org Chart", icon: Network },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "zones", label: "Zone Lookup", icon: MapPin },
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
        supaGet("members", "status=eq.active&select=member_id,first_name,last_name,role,phone&limit=5000"),
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
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Devotions</h1>
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
      const [zonesData, campusesData, submissionsData, bethelsRaw, membresLegers] = await Promise.all([
        supaGet("data_zones", "select=*&is_active=eq.true&order=zone_name.asc"),
        supaGet("campuses", "select=*&campus_code=eq.MTL"),
        supaGet("submissions", "select=*&order=submitted_at.desc&limit=5000"),
        supaGet("bethels", "select=*&status=eq.active&order=created_at.desc&limit=5000"),
        supaGet("members", "select=bethel_id,first_name,last_name,willing_to_host&status=eq.active&limit=5000"),
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
      // Prépare un index par nom pour retrouver la vraie réponse (Oui/Non) de chaque leader
      const submissionsParNom = {};
      submissionsData.forEach((s) => {
        const cle = normaliseNom(`${s.first_name} ${s.last_name}`);
        if (!submissionsParNom[cle]) submissionsParNom[cle] = s;
      });

      setBethels(bethelsRaw.map((b) => {
        const soumissionDuLeader = submissionsParNom[normaliseNom(b.leader_name || "")];
        return {
          ...b,
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
        campus_id: submission.campus_id,
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
          <RefreshCw size={13} /> Refresh from Supabase
        </button>
        <div style={{ marginTop: "14px", display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px" }}>
          <UserButton afterSignOutUrl="/" />
          <span style={{ fontSize: "12px", color: "var(--ink-muted)" }}>Signed in</span>
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
            {view === "bethels" && <BethelsView bethels={bethels} memberCounts={memberCounts} onOpenDetail={setDetailFor} />}
            {view === "search" && <SearchMembersView bethels={bethels} onOpenBethel={setDetailFor} />}
            {view === "devotions" && <DevotionsView />}
            {view === "orgchart" && <OrgChartView />}
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
