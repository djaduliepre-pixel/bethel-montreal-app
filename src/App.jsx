import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Home, Inbox, Users, BarChart3, MapPin, Search, Check, X,
  ChevronRight, Phone, AlertCircle, Sparkles, Plus, RefreshCw,
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

const LEADERSHIP_LABELS = {
  new_member: "New member", ananias: "Ananias", hp_leader: "HP Leader",
  overseer: "Overseer", ordained_minister: "Ordained Minister",
  potential_ordained_minister: "Potential Ordained Minister", pastor: "Pastor",
};

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
function ActivateModal({ submission, zones, onClose, onActivate, activating }) {
  const [query, setQuery] = useState("");
  const [selectedZone, setSelectedZone] = useState(null);

  const matches = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return zones.filter((z) => z.zone_name.toLowerCase().includes(q) || z.city_name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, zones]);

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
            disabled={!selectedZone || activating}
            onClick={() => selectedZone && onActivate(submission, selectedZone)}
            style={{
              padding: "9px 18px", borderRadius: "8px", border: "none",
              background: selectedZone ? "var(--plum)" : "var(--border)",
              color: selectedZone ? "#fff" : "var(--ink-muted)",
              fontSize: "13.5px", fontWeight: 600, cursor: selectedZone && !activating ? "pointer" : "not-allowed",
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
function BethelDetailModal({ bethel, onClose }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await supaGet("members", `bethel_id=eq.${bethel.bethel_id}&order=role.asc,first_name.asc`);
        setMembers(data);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [bethel.bethel_id]);

  const ROLE_ORDER = ['Bethel Leader', 'Ananias', 'Overseer', 'Ministre Ordonné', 'Assistant Pasteur', 'Pasteur', 'Membre'];
  const sortedMembers = [...members].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a.role); const ib = ROLE_ORDER.indexOf(b.role);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(36,30,24,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "20px",
    }} onClick={onClose}>
      <div style={{
        background: "var(--surface)", borderRadius: "14px", width: "520px", maxWidth: "100%",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
        padding: "28px", boxShadow: "0 24px 60px rgba(36,30,24,0.25)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexShrink: 0 }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "22px", margin: 0, color: "var(--ink)" }}>
              {bethel.leader_name}
            </h2>
            <div style={{ fontSize: "13px", color: "var(--ink-muted)", marginTop: "4px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{bethel.hp_number}</span>
              <ZoneStamp code={bethel.zone_code} muted />
              <span>{bethel.zone_name}</span>
            </div>
            {bethel.address && (
              <div style={{ fontSize: "12.5px", color: "var(--ink-muted)", marginTop: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
                <MapPin size={12} /> {bethel.address}
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

          {error && (
            <div style={{ fontSize: "13px", color: "var(--brick)" }}>Could not load members: {error}</div>
          )}

          {!loading && members.length === 0 && !error && (
            <div style={{ fontSize: "13px", color: "var(--ink-muted)" }}>No members recorded for this Bethel yet.</div>
          )}

          {sortedMembers.map((m, i) => (
            <div key={m.member_id} style={{
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              padding: "10px 0", borderBottom: i < sortedMembers.length - 1 ? "1px solid var(--border)" : "none",
            }}>
              <div>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--ink)" }}>
                  {m.first_name} {m.last_name}
                </div>
                <div style={{ display: "flex", gap: "12px", marginTop: "3px", flexWrap: "wrap" }}>
                  {m.phone && (
                    <span style={{ fontSize: "11.5px", color: "var(--ink-muted)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <Phone size={11} /> {m.phone}
                    </span>
                  )}
                  {m.willing_to_host && (
                    <span style={{ fontSize: "11px", color: "var(--teal)", fontWeight: 600 }}>Willing to host</span>
                  )}
                </div>
              </div>
              <span style={{
                fontSize: "11px", padding: "3px 9px", borderRadius: "999px", fontWeight: 600,
                background: m.role === "Bethel Leader" ? "rgba(107,42,62,0.10)" : "var(--bg)",
                color: m.role === "Bethel Leader" ? "var(--plum)" : "var(--ink-muted)",
                border: "1px solid var(--border)", flexShrink: 0, marginLeft: "10px",
              }}>
                {m.role}
              </span>
            </div>
          ))}
        </div>
      </div>
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

function SubmissionsView({ submissions, onOpenActivate, onAddNew }) {
  const [filter, setFilter] = useState("pending");
  const filtered = submissions.filter((s) => (filter === "all" ? true : s.status === filter));

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

      <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
        {["pending", "approved", "all"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "6px 14px", borderRadius: "999px", fontSize: "12.5px", fontWeight: 600,
            border: `1px solid ${filter === f ? "var(--plum)" : "var(--border)"}`,
            background: filter === f ? "var(--plum)" : "var(--surface)",
            color: filter === f ? "#fff" : "var(--ink-muted)", cursor: "pointer", textTransform: "capitalize",
          }}>
            {f}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: "10px", overflow: "hidden" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "28px", textAlign: "center", color: "var(--ink-muted)", fontSize: "13.5px" }}>
            No submissions here yet — click "New submission" to test, or wait for your real intake form to send data here.
          </div>
        )}
        {filtered.map((s, i) => (
          <div key={s.submission_id} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px",
            borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none", background: "var(--surface)",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
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
              <button onClick={() => onOpenActivate(s)} style={{
                flexShrink: 0, marginLeft: "12px", padding: "8px 16px", borderRadius: "8px", border: "none",
                background: "var(--plum)", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer",
              }}>
                Activate
              </button>
            ) : (
              <span style={{ flexShrink: 0, marginLeft: "12px", color: "var(--teal)" }}><Check size={18} /></span>
            )}
          </div>
        ))}
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

function ReportsView({ submissions }) {
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
      <p style={{ color: "var(--ink-muted)", fontSize: "14px", margin: "0 0 24px" }}>
        Willing-to-host, broken down by leadership level.
      </p>
      {submissions.length === 0 ? (
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
/* App                                                                 */
/* ------------------------------------------------------------------ */
const NAV = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "submissions", label: "Submissions", icon: Inbox },
  { id: "bethels", label: "Bethels", icon: Users },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "zones", label: "Zone Lookup", icon: MapPin },
];

export default function BethelAdminPortal() {
  const [view, setView] = useState("dashboard");
  const [zones, setZones] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [bethels, setBethels] = useState([]);
  const [campusId, setCampusId] = useState(null);
  const [activateFor, setActivateFor] = useState(null);
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
      await supaPost("bethels", {
        hp_number: submission.hp_number,
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
                onAddNew={() => setShowNewSubmission(true)}
              />
            )}
            {view === "bethels" && <BethelsView bethels={bethels} onOpenDetail={setDetailFor} />}
            {view === "reports" && <ReportsView submissions={submissions} />}
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
        <BethelDetailModal bethel={detailFor} onClose={() => setDetailFor(null)} />
      )}
    </div>
  );
}
