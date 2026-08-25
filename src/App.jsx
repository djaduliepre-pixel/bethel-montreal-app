import React, { useState, useEffect, useMemo, useCallback } from "react";
import { SignedIn, SignedOut, SignIn, UserButton } from "@clerk/clerk-react";
import {
  Home, Inbox, Users, BarChart3, MapPin, Search, Check, X,
  ChevronRight, Phone, AlertCircle, Sparkles, Plus, RefreshCw,
  Edit2, ArrowRightLeft, Trash2,
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

async function getDrivingMinutes(originAddress, destAddress) {
  await loadGoogleMaps();
  return new Promise((resolve, reject) => {
    const service = new window.google.maps.DistanceMatrixService();
    service.getDistanceMatrix(
      { origins: [originAddress], destinations: [destAddress], travelMode: window.google.maps.TravelMode.DRIVING },
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
  'H2C':'Montreal Ahuntsic-Cartierville','H2M':'Montreal Ahuntsic-Cartierville',
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
  'J5Y':'Repentigny Repentigny','J6A':'Repentigny Repentigny','J5Z':'Repentigny Repentigny',
  'J6X':'Terrebonne Terrebonne','J6Y':'Terrebonne Terrebonne','J6V':'Terrebonne Terrebonne','J6W':'Terrebonne Terrebonne','J7M':'Terrebonne Terrebonne',
  'J7K':'Mascouche Mascouche','J7L':'Mascouche Mascouche',
  'J6E':'Repentigny Repentigny', // L'Assomption/région -- meilleure approximation dispo
  'J6N':'Laval Auteuil', // Sainte-Thérèse/Blainville, proche Laval
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
    propre: false, prive: false, capacite: false, places: false,
  });
  const CHECKLIST_ITEMS = [
    { key: "propre", label: "The home is clean and well-maintained" },
    { key: "prive", label: "It is not an intimate space (not a bedroom, bathroom, or kitchen)" },
    { key: "capacite", label: "Can comfortably accommodate at least 4 people" },
    { key: "places", label: "Seating for at least 4 people" },
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
              Review checklist <span style={{ color: "var(--brick)" }}>*</span>
            </label>
            <div style={{ fontSize: "11.5px", color: "var(--ink-muted)", marginTop: "2px", marginBottom: "8px" }}>
              Confirm each item before activating.
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
    var inZone = bethels.filter((b) => b.zone_id === z.zone_id);
    setCandidates(inZone.map((b) => ({ bethel: b, minutes: null, error: null })));

    if (submission.address && inZone.length > 0) {
      setLoadingDistances(true);
      var results = await Promise.all(inZone.map(async (b) => {
        if (!b.address) return { bethel: b, minutes: null, error: "No address on file" };
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
      setCandidates(results);
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
              {candidates.length === 0 && (
                <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--ink-muted)" }}>No active Bethels in this zone yet.</div>
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
          <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))} />
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
function MemberProfileModal({ member, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: member.first_name || "", last_name: member.last_name || "",
    phone: member.phone || "", email: member.email || "", gender: member.gender || "",
    address: member.address || "", postal_code: member.postal_code || "",
    role: member.role || "Membre",
    ananias_name: member.ananias_name || "", bethel_leader_name: member.bethel_leader_name || "",
    overseer_name: member.overseer_name || "", ordained_minister_name: member.ordained_minister_name || "",
    willing_to_host: member.willing_to_host || false,
    status: member.status || "active",
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

  async function save() {
    setSaving(true);
    try {
      await supaPatch("members", `member_id=eq.${member.member_id}`, form);
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
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", margin: 0, color: "var(--ink)" }}>
            {editing ? "Edit profile" : `${member.first_name} ${member.last_name}`}
          </h2>
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
              <span style={labelStyle}>First / last name</span>
              <div style={{ display: "flex", gap: "6px" }}>
                <input style={inputStyle} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
                <input style={inputStyle} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
              </div>
              <span style={labelStyle}>Phone / Email</span>
              <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              <input style={inputStyle} placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              <span style={labelStyle}>Gender</span>
              <input style={inputStyle} value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))} />
              <span style={labelStyle}>Address / Postal code</span>
              <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))} />
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
      <input style={inputStyle} placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
      <input style={inputStyle} placeholder="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
      <input style={inputStyle} placeholder="Postal code" value={form.postal_code} onChange={(e) => setForm((f) => ({ ...f, postal_code: e.target.value }))} />
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
function DashboardView({ submissions, bethels, zones }) {
  const pending = submissions.filter((s) => s.status === "pending").length;
  const willing = submissions.filter((s) => s.willing_to_host).length;
  const pct = submissions.length ? Math.round((willing / submissions.length) * 100) : 0;

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
          { id: "pending", label: "Pending" },
          { id: "approved", label: "Approved" },
          { id: "all", label: "All" },
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

function BethelsView({ bethels, onOpenDetail }) {
  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Bethels</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        Rows from your real "bethels" table. Click a card to see its members.
      </p>
      {bethels.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: "10px", padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
          No Bethels yet — activate a submission to create your first one.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "12px" }}>
          {bethels.map((b) => (
            <button
              key={b.bethel_id}
              onClick={() => onOpenDetail(b)}
              style={{
                background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px",
                padding: "16px 18px", textAlign: "left", cursor: "pointer", fontFamily: "var(--font-body)",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--plum)"}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-muted)" }}>{b.hp_number}</span>
                <ZoneStamp code={b.zone_code} />
              </div>
              <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--ink)", marginTop: "8px" }}>{b.leader_name}</div>
              <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "2px" }}>{b.zone_name}</div>
              {b.address && (
                <div style={{ fontSize: "12px", color: "var(--ink-muted)", marginTop: "10px", display: "flex", alignItems: "center", gap: "5px" }}>
                  <MapPin size={12} /> {b.address}
                </div>
              )}
              <div style={{ marginTop: "10px", fontSize: "11.5px", color: "var(--plum)", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                View members <ChevronRight size={12} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DataGapsReport({ bethels }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sansContact, sansAdresse] = await Promise.all([
          supaGet("members", "or=(and(phone.is.null,email.is.null),and(phone.eq.,email.eq.))&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id"),
          supaGet("members", "or=(address.is.null,address.eq.)&status=eq.active&select=member_id,first_name,last_name,phone,email,address,bethel_id"),
        ]);
        const parId = {};
        sansContact.forEach((m) => { parId[m.member_id] = { ...m, exception: "missing_contact" }; });
        sansAdresse.forEach((m) => {
          if (parId[m.member_id]) parId[m.member_id].exception = "missing_contact"; // priorité au plus grave
          else parId[m.member_id] = { ...m, exception: "missing_address" };
        });
        setMembers(Object.values(parId));
      } catch (e) {
        setMembers([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const bethelById = useMemo(() => Object.fromEntries(bethels.map((b) => [b.bethel_id, b])), [bethels]);
  const filtered = filter === "all" ? members : members.filter((m) => m.exception === filter);
  const countContact = members.filter((m) => m.exception === "missing_contact").length;
  const countAddress = members.filter((m) => m.exception === "missing_address").length;

  const EXCEPTION_LABELS = {
    missing_contact: { label: "Missing contact", color: "var(--brick)" },
    missing_address: { label: "Missing address", color: "var(--gold)" },
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "6px", marginBottom: "16px", flexWrap: "wrap" }}>
        {[
          { id: "all", label: `All (${members.length})` },
          { id: "missing_contact", label: `Missing contact (${countContact})` },
          { id: "missing_address", label: `Missing address (${countAddress})` },
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
    </div>
  );
}

function ReportsView({ submissions, bethels }) {
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
        {tab === "hosting" ? "Willing-to-host, broken down by leadership level." : "Members missing key information."}
      </p>

      <div style={{ display: "flex", gap: "6px", marginBottom: "20px" }}>
        {[{ id: "hosting", label: "Willing to Host" }, { id: "gaps", label: "Data Gaps" }].map((t) => (
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
      ) : (
        <DataGapsReport bethels={bethels} />
      )}
    </div>
  );
}

function ZoneLookupView({ zones }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    if (!query.trim()) return zones.slice(0, 40);
    const q = query.trim().toLowerCase();
    return zones.filter((z) => z.zone_name.toLowerCase().includes(q) || z.city_name.toLowerCase().includes(q)).slice(0, 60);
  }, [query, zones]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Zone lookup</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        {zones.length} zones live in your data_zones table.
      </p>
      <div style={{ position: "relative", marginBottom: "16px", maxWidth: "360px" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "8px" }}>
        {results.map((z) => (
          <div key={z.zone_id} style={{
            border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px",
            display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)",
          }}>
            <div>
              <div style={{ fontSize: "13px", color: "var(--ink)" }}>{z.zone_name}</div>
              <div style={{ fontSize: "11.5px", color: "var(--ink-muted)" }}>{z.city_name}</div>
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
        const data = await supaGet(
          "members",
          `or=(first_name.ilike.*${encodeURIComponent(q)}*,last_name.ilike.*${encodeURIComponent(q)}*,phone.ilike.*${encodeURIComponent(q)}*)&order=first_name.asc&limit=40`
        );
        setResults(data);
      } catch (e) {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 350); // petit délai pour éviter une requête à chaque lettre tapée
    return () => clearTimeout(timer);
  }, [query]);

  const bethelById = useMemo(() => Object.fromEntries(bethels.map((b) => [b.bethel_id, b])), [bethels]);

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-display)", fontSize: "28px", margin: "0 0 4px" }}>Search Members</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 20px" }}>
        Find any of your {bethels.length ? "1200+" : ""} members and see which Bethel they belong to.
      </p>

      <div style={{ position: "relative", marginBottom: "20px", maxWidth: "420px" }}>
        <Search size={15} color="var(--ink-muted)" style={{ position: "absolute", left: "10px", top: "10px" }} />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a name or phone number…"
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
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "zones", label: "Zone Lookup", icon: MapPin },
];

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

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [zonesData, campusesData, submissionsData, bethelsRaw] = await Promise.all([
        supaGet("data_zones", "select=*&is_active=eq.true&order=zone_name.asc"),
        supaGet("campuses", "select=*&campus_code=eq.MTL"),
        supaGet("submissions", "select=*&order=submitted_at.desc"),
        supaGet("bethels", "select=*&status=eq.active&order=created_at.desc"),
      ]);
      setZones(zonesData);
      if (campusesData[0]) setCampusId(campusesData[0].campus_id);
      setSubmissions(submissionsData);

      const zoneById = Object.fromEntries(zonesData.map((z) => [z.zone_id, z]));
      setBethels(bethelsRaw.map((b) => ({
        ...b,
        zone_name: zoneById[b.zone_id]?.zone_name || "Unknown zone",
        zone_code: zoneById[b.zone_id]?.zone_code || "",
      })));
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

      await supaPost("bethels", {
        hp_number: nouveauNumero,
        campus_id: submission.campus_id,
        zone_id: zone.zone_id,
        leader_name: `${submission.first_name} ${submission.last_name}`,
        leader_role: submission.leadership_level === "hp_leader" ? "Bethel Leader" : (LEADERSHIP_LABELS[submission.leadership_level] || "Membre"),
        host_name: `${submission.first_name} ${submission.last_name}`,
        address: submission.address,
        status: "active",
      });
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
            {view === "dashboard" && <DashboardView submissions={submissions} bethels={bethels} zones={zones} />}
            {view === "submissions" && (
              <SubmissionsView
                submissions={submissions}
                onOpenActivate={setActivateFor}
                onOpenAssign={setAssignFor}
                onAddNew={() => setShowNewSubmission(true)}
              />
            )}
            {view === "bethels" && <BethelsView bethels={bethels} onOpenDetail={setDetailFor} />}
            {view === "search" && <SearchMembersView bethels={bethels} onOpenBethel={setDetailFor} />}
            {view === "reports" && <ReportsView submissions={submissions} bethels={bethels} />}
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
