import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Papa from "papaparse";
import { createClient } from "@supabase/supabase-js";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell
} from "recharts";

// ---------- Farb- & Typo-Tokens (Ledger-Optik) ----------
const C = {
  paper: "#F2F0E9",
  paperRaised: "#FBFAF6",
  ink: "#26231C",
  inkSoft: "#5B5647",
  line: "#D9D4C4",
  lineStrong: "#B7B096",
  green: "#2F5233",
  greenSoft: "#DCE8DA",
  gain: "#3D7A4F",
  loss: "#B3502B",
  lossSoft: "#F4DCCF",
  gainSoft: "#DCEEE0",
  amber: "#A9782F",
};
const FONT_SERIF = "'IBM Plex Serif', Georgia, serif";
const FONT_SANS = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'Courier New', monospace";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtEUR = (n) =>
  (n < 0 ? "-" : "") +
  Math.abs(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" }).replace("-", "");
const monthKey = (d) => d.slice(0, 7);
const istBlattkonto = (konto, alleKonten) => !alleKonten.some((k) => k.parentId === konto.id);
const kontoTiefe = (konto, byId) => {
  let tiefe = 0, k = konto;
  while (k && k.parentId && byId[k.parentId]) { tiefe++; k = byId[k.parentId]; if (tiefe > 20) break; }
  return tiefe;
};
const kontoPfadName = (konto, byId) => {
  const teile = [];
  let k = konto, i = 0;
  while (k) { teile.unshift(k.name); if (!k.parentId || !byId[k.parentId]) break; k = byId[k.parentId]; i++; if (i > 20) break; }
  return teile.join(" / ");
};
const bookingPostings = (b) => {
  if (b.splits && b.splits.length > 0) return b.splits;
  if (b.art === "Einnahme" || b.art === "Ausgabe") return [{ kontoId: b.kontoId, betrag: b.betrag, klasseId: b.klasseId }];
  return [];
};
const naechsteBuchungsnummer = (buchungen, datum) => {
  const jahr = (datum || todayISO()).slice(0, 4);
  const praefix = `B-${jahr}-`;
  const maxNr = buchungen.reduce((max, b) => {
    if (!b.buchungsnummer || !b.buchungsnummer.startsWith(praefix)) return max;
    const n = parseInt(b.buchungsnummer.slice(praefix.length), 10);
    return isNaN(n) ? max : Math.max(max, n);
  }, 0);
  return `${praefix}${String(maxNr + 1).padStart(4, "0")}`;
};

// ---------- Seed-Daten ----------
const LAENDER = [
  "Deutschland", "Österreich", "Schweiz", "Niederlande", "Belgien", "Luxemburg", "Frankreich", "Italien", "Spanien",
  "Portugal", "Dänemark", "Schweden", "Norwegen", "Finnland", "Polen", "Tschechien", "Slowakei", "Ungarn", "Slowenien",
  "Kroatien", "Griechenland", "Irland", "Vereinigtes Königreich", "USA", "Kanada", "Sonstiges",
];

const seed = {
  konten: [
    { id: uid(), name: "Gehalt", typ: "Ertrag", gruppe: "Betriebliche Erträge" },
    { id: uid(), name: "Sonstige Erträge", typ: "Ertrag", gruppe: "Sonstige Erträge" },
    { id: uid(), name: "Wohnen", typ: "Aufwand", gruppe: "Fixkosten", kostenart: "Fix" },
    { id: uid(), name: "Versicherungen", typ: "Aufwand", gruppe: "Fixkosten", kostenart: "Fix" },
    { id: uid(), name: "Lebensmittel", typ: "Aufwand", gruppe: "Variable Kosten", kostenart: "Variabel" },
    { id: uid(), name: "Mobilität", typ: "Aufwand", gruppe: "Variable Kosten", kostenart: "Variabel" },
    { id: uid(), name: "Freizeit", typ: "Aufwand", gruppe: "Variable Kosten", kostenart: "Variabel" },
    { id: uid(), name: "Sonstiges", typ: "Aufwand", gruppe: "Sonstige Aufwendungen", kostenart: "Variabel" },
  ],
  klassen: [
    { id: uid(), name: "Privathaushalt", typ: "Kostenstelle" },
    { id: uid(), name: "Nebentätigkeit", typ: "Kostenträger" },
  ],
  adressen: [],
  adresskategorien: [
    { id: uid(), name: "Privatperson" },
    { id: uid(), name: "Supermarkt" },
    { id: uid(), name: "Einzelhandel" },
  ],
  bankkonten: [{ id: uid(), name: "Girokonto", startsaldo: 0 }],
  bilanzpositionen: [],
  vermoegenswerte: [],
  vermoegensBuchungen: [],
  darlehen: [],
  sondertilgungen: [],
  buchungen: [],
};

const STORAGE_KEY = "haushaltsbuch-v1";

const supabase = createClient(
  "https://qatpgbwzjegzwnixfsai.supabase.co",   // z. B. https://abcdefgh.supabase.co
  "sb_publishable_vRzu_oYDFZtp54g7NBLBTQ_GrC8_p0r"
);

const numOrNull = (v) => (v === "" || v === null || v === undefined ? null : Number(v));

// Reihenfolge wichtig wegen Fremdschlüsseln: Kinder vor Eltern löschen, Eltern vor Kindern einfügen.
const DELETE_ORDER = ["buchungssplits", "buchungen", "sondertilgungen", "vermoegensbuchungen", "darlehen", "vermoegenswerte", "bilanzpositionen", "bankkonten", "adressen", "klassen", "konten"];
const INSERT_ORDER = [...DELETE_ORDER].reverse();

async function loadData() {
  try {
    const [konten, klassen, adressen, adresskategorien, bankkonten, bilanzpositionen, vermoegenswerte, vermoegensbuchungen, darlehen, sondertilgungen, buchungen, buchungssplits] = await Promise.all([
      supabase.from("konten").select("*"),
      supabase.from("klassen").select("*"),
      supabase.from("adressen").select("*"),
      supabase.from("adresskategorien").select("*"),
      supabase.from("bankkonten").select("*"),
      supabase.from("bilanzpositionen").select("*"),
      supabase.from("vermoegenswerte").select("*"),
      supabase.from("vermoegensbuchungen").select("*"),
      supabase.from("darlehen").select("*"),
      supabase.from("sondertilgungen").select("*"),
      supabase.from("buchungen").select("*"),
      supabase.from("buchungssplits").select("*"),
    ]);
    const alleLeer = [konten, klassen, adressen, bankkonten, buchungen].every((r) => !r.data || r.data.length === 0);
    if (alleLeer) {
      // Erststart: leere Datenbank mit den Start-Kategorien befüllen, damit spätere Buchungen
      // gültige Fremdschlüssel-Verweise haben (statt nur lokal im Speicher zu existieren).
      seed.konten.forEach((k) => dbInsert("konten", mapKonto(k)));
      seed.klassen.forEach((k) => dbInsert("klassen", mapKlasse(k)));
      seed.bankkonten.forEach((b) => dbInsert("bankkonten", mapBankkonto(b)));
      seed.adresskategorien.forEach((k) => dbInsert("adresskategorien", mapAdresskategorie(k)));
      return seed;
    }

    const splitsProBuchung = {};
    (buchungssplits.data || []).forEach((s) => {
      (splitsProBuchung[s.buchung_id] = splitsProBuchung[s.buchung_id] || []).push({ id: s.id, kontoId: s.konto_id, betrag: s.betrag, klasseId: s.klasse_id });
    });

    return {
      konten: (konten.data || []).map((r) => ({ id: r.id, name: r.name, typ: r.typ, gruppe: r.gruppe, kostenart: r.kostenart, parentId: r.parent_id })),
      klassen: klassen.data || [],
      adressen: (adressen.data || []).map((r) => ({ id: r.id, name: r.name, iban: r.iban, notiz: r.notiz, strasse: r.strasse, plz: r.plz, stadt: r.stadt, land: r.land, kategorieId: r.kategorie_id })),
      adresskategorien: adresskategorien.data || [],
      bankkonten: (bankkonten.data || []).map((r) => ({ id: r.id, name: r.name, startsaldo: r.startsaldo, kreditinstitutId: r.kreditinstitut_id, kontotyp: r.kontotyp, kontonummer: r.kontonummer })),
      bilanzpositionen: bilanzpositionen.data || [],
      vermoegenswerte: (vermoegenswerte.data || []).map((r) => ({ id: r.id, name: r.name, typ: r.typ, kaufwert: r.kaufwert, kaufdatum: r.kaufdatum, isin: r.isin, anzahl: r.anzahl, aktuellerKurs: r.aktueller_kurs, kursDatum: r.kurs_datum, notiz: r.notiz })),
      vermoegensBuchungen: (vermoegensbuchungen.data || []).map((r) => ({ id: r.id, vermoegenswertId: r.vermoegenswert_id, datum: r.datum, wert: r.wert })),
      darlehen: (darlehen.data || []).map((r) => ({ id: r.id, name: r.name, glaeubiger: r.glaeubiger, ursprungsbetrag: r.ursprungsbetrag, zinssatz: r.zinssatz, rateMonatlich: r.rate_monatlich, startdatum: r.startdatum, notiz: r.notiz })),
      sondertilgungen: (sondertilgungen.data || []).map((r) => ({ id: r.id, darlehenId: r.darlehen_id, datum: r.datum, betrag: r.betrag })),
      buchungen: (buchungen.data || []).map((r) => ({
        id: r.id, datum: r.datum, betrag: r.betrag, art: r.art, kontoId: r.konto_id, adresseId: r.adresse_id, klasseId: r.klasse_id,
        bankkontoId: r.bankkonto_id, vonBankkontoId: r.von_bankkonto_id, nachBankkontoId: r.nach_bankkonto_id, vermoegenswertId: r.vermoegenswert_id,
        beschreibung: r.beschreibung, buchungsnummer: r.buchungsnummer, splits: splitsProBuchung[r.id] || [],
      })),
    };
  } catch (e) {
    console.error("Laden fehlgeschlagen", e);
    return seed;
  }
}

// ---------- Einzelzeilen-Mapper JS -> DB-Spaltennamen ----------
const mapKonto = (k) => ({ id: k.id, name: k.name, typ: k.typ, gruppe: k.gruppe || null, kostenart: k.kostenart || null, parent_id: k.parentId || null });
const mapKlasse = (k) => ({ id: k.id, name: k.name, typ: k.typ });
const mapAdresse = (a) => ({ id: a.id, name: a.name, iban: a.iban || null, notiz: a.notiz || null, strasse: a.strasse || null, plz: a.plz || null, stadt: a.stadt || null, land: a.land || null, kategorie_id: a.kategorieId || null });
const mapAdresskategorie = (k) => ({ id: k.id, name: k.name });
const mapBankkonto = (b) => ({ id: b.id, name: b.name, startsaldo: Number(b.startsaldo) || 0, kreditinstitut_id: b.kreditinstitutId || null, kontotyp: b.kontotyp || null, kontonummer: b.kontonummer || null });
const KONTOTYPEN = ["Girokonto", "Gemeinschaftskonto", "Tagesgeld", "Festgeld", "Depot", "Kreditkarte", "Bargeld", "Sonstiges"];
const mapBilanzposition = (p) => ({ id: p.id, name: p.name, typ: p.typ, wert: Number(p.wert) || 0 });
const mapVermoegenswert = (a) => ({ id: a.id, name: a.name, typ: a.typ, kaufwert: numOrNull(a.kaufwert), kaufdatum: a.kaufdatum || null, isin: a.isin || null, anzahl: numOrNull(a.anzahl), aktueller_kurs: numOrNull(a.aktuellerKurs), kurs_datum: a.kursDatum || null, notiz: a.notiz || null });
const mapVermoegensBuchung = (v) => ({ id: v.id, vermoegenswert_id: v.vermoegenswertId, datum: v.datum, wert: Number(v.wert) });
const mapDarlehen = (l) => ({ id: l.id, name: l.name, glaeubiger: l.glaeubiger || null, ursprungsbetrag: Number(l.ursprungsbetrag) || 0, zinssatz: numOrNull(l.zinssatz), rate_monatlich: numOrNull(l.rateMonatlich), startdatum: l.startdatum || null, notiz: l.notiz || null });
const mapSondertilgung = (s) => ({ id: s.id, darlehen_id: s.darlehenId, datum: s.datum, betrag: Number(s.betrag) || 0 });
const mapBuchung = (b) => ({ id: b.id, datum: b.datum, betrag: Number(b.betrag) || 0, art: b.art, konto_id: b.kontoId || null, adresse_id: b.adresseId || null, klasse_id: b.klasseId || null, bankkonto_id: b.bankkontoId || null, von_bankkonto_id: b.vonBankkontoId || null, nach_bankkonto_id: b.nachBankkontoId || null, vermoegenswert_id: b.vermoegenswertId || null, beschreibung: b.beschreibung || null, buchungsnummer: b.buchungsnummer || null });
const mapSplit = (s, buchungId) => ({ id: s.id || uid(), buchung_id: buchungId, konto_id: s.kontoId || null, betrag: Number(s.betrag) || 0, klasse_id: s.klasseId || null });

// ---------- Generische Einzelzeilen-Operationen ----------
async function dbInsert(table, row) {
  const { error } = await supabase.from(table).insert(row);
  if (error) console.error(`Anlegen fehlgeschlagen (${table})`, error);
}
async function dbUpdate(table, row) {
  const { id, ...rest } = row;
  const { error } = await supabase.from(table).update(rest).eq("id", id);
  if (error) console.error(`Ändern fehlgeschlagen (${table})`, error);
}
async function dbDelete(table, id) {
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) console.error(`Löschen fehlgeschlagen (${table})`, error);
}
async function dbReplaceSplits(buchungId, splits) {
  await supabase.from("buchungssplits").delete().eq("buchung_id", buchungId);
  if (splits && splits.length > 0) {
    const { error } = await supabase.from("buchungssplits").insert(splits.map((s) => mapSplit(s, buchungId)));
    if (error) console.error("Anlegen fehlgeschlagen (buchungssplits)", error);
  }
}

// Ein Aktionsobjekt pro Tabelle: add/update/remove sprechen jeweils nur die eine betroffene Zeile an.
// (vermoegensbuchungen, sondertilgungen, buchungssplits räumt die Datenbank per "on delete cascade" automatisch mit auf.)
const db = {
  konten: { add: (k) => dbInsert("konten", mapKonto(k)), update: (k) => dbUpdate("konten", mapKonto(k)), remove: (id) => dbDelete("konten", id) },
  klassen: { add: (k) => dbInsert("klassen", mapKlasse(k)), update: (k) => dbUpdate("klassen", mapKlasse(k)), remove: (id) => dbDelete("klassen", id) },
  adressen: { add: (a) => dbInsert("adressen", mapAdresse(a)), update: (a) => dbUpdate("adressen", mapAdresse(a)), remove: (id) => dbDelete("adressen", id) },
  adresskategorien: { add: (k) => dbInsert("adresskategorien", mapAdresskategorie(k)), update: (k) => dbUpdate("adresskategorien", mapAdresskategorie(k)), remove: (id) => dbDelete("adresskategorien", id) },
  bankkonten: { add: (b) => dbInsert("bankkonten", mapBankkonto(b)), update: (b) => dbUpdate("bankkonten", mapBankkonto(b)), remove: (id) => dbDelete("bankkonten", id) },
  bilanzpositionen: { add: (p) => dbInsert("bilanzpositionen", mapBilanzposition(p)), update: (p) => dbUpdate("bilanzpositionen", mapBilanzposition(p)), remove: (id) => dbDelete("bilanzpositionen", id) },
  vermoegenswerte: { add: (a) => dbInsert("vermoegenswerte", mapVermoegenswert(a)), update: (a) => dbUpdate("vermoegenswerte", mapVermoegenswert(a)), remove: (id) => dbDelete("vermoegenswerte", id) },
  vermoegensBuchungen: { add: (v) => dbInsert("vermoegensbuchungen", mapVermoegensBuchung(v)) },
  darlehen: { add: (l) => dbInsert("darlehen", mapDarlehen(l)), update: (l) => dbUpdate("darlehen", mapDarlehen(l)), remove: (id) => dbDelete("darlehen", id) },
  sondertilgungen: { add: (s) => dbInsert("sondertilgungen", mapSondertilgung(s)) },
  buchungen: {
    add: (b) => { dbInsert("buchungen", mapBuchung(b)); if (b.splits && b.splits.length > 0) dbReplaceSplits(b.id, b.splits); },
    update: (b) => { dbUpdate("buchungen", mapBuchung(b)); dbReplaceSplits(b.id, b.splits || []); },
    remove: (id) => dbDelete("buchungen", id),
  },
};

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Anmeldung fehlgeschlagen: " + error.message);
  };

  return (
    <div style={{ maxWidth: 320, margin: "80px auto", fontFamily: FONT_SANS }}>
      <h2 style={{ fontFamily: FONT_SERIF }}>Haushaltsbuch – Anmeldung</h2>
      <form onSubmit={submit}>
        <div style={{ marginBottom: 10 }}>
          <Label>E-Mail</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div style={{ marginBottom: 10 }}>
          <Label>Passwort</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <Btn primary type="submit">Anmelden</Btn>
        {error && <div style={{ color: C.loss, fontSize: 13, marginTop: 8 }}>{error}</div>}
      </form>
    </div>
  );
}

// ---------- Kleine UI-Bausteine ----------
function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.paperRaised,
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: "16px 18px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function Label({ children }) {
  return (
    <div style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: C.inkSoft, marginBottom: 4 }}>
      {children}
    </div>
  );
}
function Input(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        padding: "7px 9px",
        border: `1px solid ${C.lineStrong}`,
        borderRadius: 4,
        background: "#fff",
        fontFamily: FONT_SANS,
        fontSize: 13.5,
        color: C.ink,
        boxSizing: "border-box",
        ...props.style,
      }}
    />
  );
}
function Select(props) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        padding: "7px 9px",
        border: `1px solid ${C.lineStrong}`,
        borderRadius: 4,
        background: "#fff",
        fontFamily: FONT_SANS,
        fontSize: 13.5,
        color: C.ink,
        boxSizing: "border-box",
        ...props.style,
      }}
    >
      {props.children}
    </select>
  );
}
function Btn({ children, onClick, primary, danger, style, type = "button" }) {
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: 4,
        border: `1px solid ${danger ? C.loss : primary ? C.green : C.lineStrong}`,
        background: primary ? C.green : danger ? "transparent" : "#fff",
        color: primary ? "#fff" : danger ? C.loss : C.ink,
        fontFamily: FONT_SANS,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
function Money({ value }) {
  const positive = value >= 0;
  return (
    <span style={{ fontFamily: FONT_MONO, color: positive ? C.gain : C.loss, fontVariantNumeric: "tabular-nums" }}>
      {fmtEUR(value)}
    </span>
  );
}
function Th({ children, align }) {
  return (
    <th
      style={{
        textAlign: align || "left",
        fontSize: 11,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: C.inkSoft,
        borderBottom: `2px solid ${C.line}`,
        padding: "6px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, align, mono }) {
  return (
    <td
      style={{
        textAlign: align || "left",
        padding: "7px 10px",
        borderBottom: `1px solid ${C.line}`,
        fontFamily: mono ? FONT_MONO : FONT_SANS,
        fontSize: 13,
        color: C.ink,
      }}
    >
      {children}
    </td>
  );
}

// Durchsuchbares Auswahlfeld: tippen zum Filtern, optional gruppiert. options: [{ value, label, group? }]
function SearchSelect({ value, onChange, options, placeholder, required }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()));
  const gruppen = {};
  filtered.forEach((o) => { const g = o.group || ""; (gruppen[g] = gruppen[g] || []).push(o); });

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <Input
        value={open ? query : (selected ? selected.label : "")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        placeholder={placeholder || "– suchen –"}
        required={required && !value}
        autoComplete="off"
      />
      {open && (
        <div
          style={{
            position: "absolute", zIndex: 30, top: "calc(100% + 2px)", left: 0, right: 0,
            background: "#fff", border: `1px solid ${C.lineStrong}`, borderRadius: 4,
            maxHeight: 240, overflowY: "auto", boxShadow: "0 6px 16px rgba(0,0,0,0.14)",
          }}
        >
          {filtered.length === 0 && <div style={{ padding: "8px 10px", fontSize: 13, color: C.inkSoft }}>Keine Treffer</div>}
          {Object.entries(gruppen).map(([g, opts]) => (
            <div key={g || "_"}>
              {g && <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: C.inkSoft, padding: "5px 10px", background: C.paper }}>{g}</div>}
              {opts.map((o) => (
                <div
                  key={o.value}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
                  style={{
                    padding: "7px 10px", fontSize: 13.5, cursor: "pointer",
                    background: o.value === value ? C.gainSoft : "transparent",
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV = [
  { id: "dashboard", label: "Übersicht" },
  { id: "buchungen", label: "Buchung erfassen" },
  { id: "buchungsliste", label: "Buchungsliste" },
  { id: "import", label: "Import" },
  { id: "adressen", label: "Adressbuch" },
  { id: "anlagen", label: "Anlagenregister" },
  { id: "darlehen", label: "Darlehen" },
  { id: "stamm", label: "Konten & Klassen" },
  { id: "guv", label: "GuV" },
  { id: "bilanz", label: "Bilanz" },
  { id: "cashflow", label: "Cashflow" },
];

export default function App() {
  const [session, setSession] = useState(undefined);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [editBuchungId, setEditBuchungId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadData().then(setData);
  }, []);

  const update = useCallback((fn) => setData((d) => fn({ ...d })), []);

  if (session === undefined) return <div style={{ padding: 40 }}>Lade…</div>;
  if (!session) return <LoginScreen />;

  if (!data) {
    return <div style={{ padding: 40, fontFamily: FONT_SANS, color: C.inkSoft }}>Lade Haushaltsbuch…</div>;
  }

  const kontoById = Object.fromEntries(data.konten.map((k) => [k.id, k]));
  const adresseById = Object.fromEntries(data.adressen.map((a) => [a.id, a]));
  const klasseById = Object.fromEntries(data.klassen.map((k) => [k.id, k]));
  const bankById = Object.fromEntries(data.bankkonten.map((b) => [b.id, b]));

  const bankSaldo = (bankId, biszu) => {
    const bk = bankById[bankId];
    if (!bk) return 0;
    let s = Number(bk.startsaldo) || 0;
    for (const b of data.buchungen) {
      if (biszu && b.datum > biszu) continue;
      if (b.art === "Umbuchung") {
        if (b.vonBankkontoId === bankId) s -= Number(b.betrag);
        if (b.nachBankkontoId === bankId) s += Number(b.betrag);
        continue;
      }
      if (b.art === "Investition") {
        if (b.bankkontoId === bankId) s -= Number(b.betrag);
        continue;
      }
      if (b.bankkontoId !== bankId) continue;
      s += b.art === "Einnahme" ? Number(b.betrag) : -Number(b.betrag);
    }
    return s;
  };

  const assetValue = (asset, atDate) => {
    if (asset.typ === "Wertpapier") {
      return (Number(asset.anzahl) || 0) * (Number(asset.aktuellerKurs) || 0);
    }
    const historie = data.vermoegensBuchungen
      .filter((v) => v.vermoegenswertId === asset.id && (!atDate || v.datum <= atDate))
      .sort((a, b) => b.datum.localeCompare(a.datum));
    if (historie.length > 0) return Number(historie[0].wert);
    return Number(asset.kaufwert) || 0;
  };

  const loanSchedule = (loan) => {
    const sonderByMonat = {};
    data.sondertilgungen
      .filter((s) => s.darlehenId === loan.id)
      .forEach((s) => {
        const mk = monthKey(s.datum);
        sonderByMonat[mk] = (sonderByMonat[mk] || 0) + Number(s.betrag);
      });
    const schedule = [];
    let rest = Number(loan.ursprungsbetrag) || 0;
    let datum = new Date(loan.startdatum || todayISO());
    const zinsMonat = (Number(loan.zinssatz) || 0) / 100 / 12;
    const rate = Number(loan.rateMonatlich) || 0;
    let i = 0;
    while (rest > 0.5 && i < 600) {
      const mk = datum.toISOString().slice(0, 7);
      const zinsanteil = rest * zinsMonat;
      let tilgungsanteil = rate - zinsanteil;
      if (tilgungsanteil < 0) tilgungsanteil = 0;
      const sondertilgung = sonderByMonat[mk] || 0;
      rest = Math.max(0, rest - tilgungsanteil - sondertilgung);
      schedule.push({ monat: mk, zins: zinsanteil, tilgung: tilgungsanteil, sondertilgung, restschuld: rest });
      datum.setMonth(datum.getMonth() + 1);
      i++;
    }
    return schedule;
  };

  const loanRestschuld = (loan, atDate) => {
    const schedule = loanSchedule(loan);
    if (!atDate) return schedule.length ? schedule[schedule.length - 1].restschuld : Number(loan.ursprungsbetrag) || 0;
    const mk = monthKey(atDate);
    const entry = [...schedule].reverse().find((s) => s.monat <= mk);
    return entry ? entry.restschuld : Number(loan.ursprungsbetrag) || 0;
  };

  const nettovermoegenAt = (atDate) => {
    const aktiva =
      data.bankkonten.reduce((s, b) => s + bankSaldo(b.id, atDate), 0) +
      data.vermoegenswerte.reduce((s, a) => s + assetValue(a, atDate), 0) +
      data.bilanzpositionen.filter((p) => p.typ === "Aktiva").reduce((s, p) => s + Number(p.wert), 0);
    const passiva =
      data.darlehen.reduce((s, l) => s + loanRestschuld(l, atDate), 0) +
      data.bilanzpositionen.filter((p) => p.typ === "Passiva").reduce((s, p) => s + Number(p.wert), 0);
    return aktiva - passiva;
  };

  return (
    <div style={{ fontFamily: FONT_SANS, background: C.paper, color: C.ink, minHeight: 480, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line}` }}>
      <div style={{ display: "flex", minHeight: 480 }}>
        <div style={{ width: 190, background: C.green, color: "#fff", padding: "18px 0", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT_SERIF, fontSize: 18, padding: "0 18px 16px", borderBottom: "1px solid rgba(255,255,255,0.2)", marginBottom: 8 }}>
            Haushaltsbuch
          </div>
          {NAV.map((n) => (
            <div
              key={n.id}
              onClick={() => setTab(n.id)}
              style={{
                padding: "9px 18px",
                cursor: "pointer",
                fontSize: 13.5,
                fontWeight: tab === n.id ? 600 : 400,
                background: tab === n.id ? "rgba(255,255,255,0.14)" : "transparent",
                borderLeft: tab === n.id ? "3px solid #fff" : "3px solid transparent",
              }}
            >
              {n.label}
            </div>
          ))}
          <div
            onClick={() => supabase.auth.signOut()}
            style={{ padding: "9px 18px", cursor: "pointer", fontSize: 13.5, marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.2)", opacity: 0.85 }}
          >
            Abmelden
          </div>
        </div>
        <div style={{ flex: 1, padding: 22, overflowX: "auto" }}>
          {tab === "dashboard" && <Dashboard data={data} bankSaldo={bankSaldo} bankById={bankById} nettovermoegenAt={nettovermoegenAt} />}
          {tab === "buchungen" && <Buchungen data={data} update={update} db={db} kontoById={kontoById} assetValue={assetValue} editBuchungId={editBuchungId} onConsumedEdit={() => setEditBuchungId(null)} />}
          {tab === "buchungsliste" && <Buchungsliste data={data} update={update} db={db} kontoById={kontoById} adresseById={adresseById} bankById={bankById} onEdit={(id) => { setEditBuchungId(id); setTab("buchungen"); }} />}
          {tab === "import" && <ImportCSV data={data} update={update} />}
          {tab === "adressen" && <Adressen data={data} update={update} db={db} />}
          {tab === "anlagen" && <Anlagenregister data={data} update={update} db={db} assetValue={assetValue} />}
          {tab === "darlehen" && <Darlehen data={data} update={update} db={db} loanSchedule={loanSchedule} />}
          {tab === "stamm" && <Stammdaten data={data} update={update} db={db} />}
          {tab === "guv" && <GuV data={data} kontoById={kontoById} klassen={data.klassen} />}
          {tab === "bilanz" && <Bilanz data={data} bankSaldo={bankSaldo} assetValue={assetValue} loanRestschuld={loanRestschuld} nettovermoegenAt={nettovermoegenAt} />}
          {tab === "cashflow" && <Cashflow data={data} bankById={bankById} bankSaldo={bankSaldo} />}
        </div>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ data, bankSaldo, bankById, nettovermoegenAt }) {
  const gesamtSaldo = data.bankkonten.reduce((s, b) => s + bankSaldo(b.id), 0);
  const nettovermoegen = nettovermoegenAt(todayISO());
  const thisMonth = todayISO().slice(0, 7);
  const einnahmenMonat = data.buchungen
    .filter((b) => b.art === "Einnahme" && monthKey(b.datum) === thisMonth)
    .reduce((s, b) => s + Number(b.betrag), 0);
  const ausgabenMonat = data.buchungen
    .filter((b) => b.art === "Ausgabe" && monthKey(b.datum) === thisMonth)
    .reduce((s, b) => s + Number(b.betrag), 0);

  const monthly = {};
  for (const b of data.buchungen) {
    const mk = monthKey(b.datum);
    if (!monthly[mk]) monthly[mk] = { monat: mk, Einnahmen: 0, Ausgaben: 0 };
    monthly[mk][b.art === "Einnahme" ? "Einnahmen" : "Ausgaben"] += Number(b.betrag);
  }
  const chartData = Object.values(monthly).sort((a, b) => a.monat.localeCompare(b.monat)).slice(-12);

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Übersicht</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 20 }}>
        <Card>
          <Label>Gesamtsaldo Bankkonten</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}><Money value={gesamtSaldo} /></div>
        </Card>
        <Card>
          <Label>Einnahmen (Monat)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO, color: C.gain }}>{fmtEUR(einnahmenMonat)}</div>
        </Card>
        <Card>
          <Label>Ausgaben (Monat)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO, color: C.loss }}>{fmtEUR(ausgabenMonat)}</div>
        </Card>
        <Card>
          <Label>Buchungen gesamt</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>{data.buchungen.length}</div>
        </Card>
        <Card>
          <Label>Nettovermögen (heute)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}><Money value={nettovermoegen} /></div>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <Label>Einnahmen / Ausgaben je Monat</Label>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Einnahmen" fill={C.gain} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Ausgaben" fill={C.loss} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <Label>Bankkonten</Label>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Konto</Th><Th align="right">Saldo</Th></tr></thead>
          <tbody>
            {data.bankkonten.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td align="right" mono><Money value={bankSaldo(b.id)} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Buchungen ----------
function emptyBuchung(data) {
  return {
    id: uid(),
    datum: todayISO(),
    betrag: "",
    art: "Ausgabe",
    kontoId: data.konten.find((k) => k.typ === "Aufwand")?.id || "",
    adresseId: "",
    klasseId: "",
    bankkontoId: data.bankkonten[0]?.id || "",
    vonBankkontoId: data.bankkonten[0]?.id || "",
    nachBankkontoId: data.bankkonten[1]?.id || data.bankkonten[0]?.id || "",
    vermoegenswertId: data.vermoegenswerte[0]?.id || "",
    beschreibung: "",
    splits: [],
  };
}

function Buchungen({ data, update, db, kontoById, assetValue, editBuchungId, onConsumedEdit }) {
  const [belegart, setBelegart] = useState("Buchung"); // Buchung | Umbuchung | Investition
  const [form, setForm] = useState(() => emptyBuchung(data));
  const [editId, setEditId] = useState(null);
  const [positionen, setPositionen] = useState([{ id: uid(), kontoId: "", betrag: "", klasseId: "" }]);

  const netto = positionen.reduce((s, r) => {
    const k = kontoById[r.kontoId];
    if (!k) return s;
    const betrag = Number(r.betrag) || 0;
    return s + (k.typ === "Ertrag" ? betrag : -betrag);
  }, 0);

  const buchungsnummer = editId ? form.buchungsnummer : naechsteBuchungsnummer(data.buchungen, form.datum);

  const resetForm = () => {
    setForm(emptyBuchung(data));
    setBelegart("Buchung");
    setPositionen([{ id: uid(), kontoId: "", betrag: "", klasseId: "" }]);
    setEditId(null);
  };

  const addPosition = () => setPositionen([...positionen, { id: uid(), kontoId: "", betrag: "", klasseId: "" }]);
  const removePosition = (i) => setPositionen(positionen.filter((_, idx) => idx !== i));
  const updatePosition = (i, patch) => setPositionen(positionen.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const startEdit = (b) => {
    setForm({ ...emptyBuchung(data), ...b });
    setEditId(b.id);
    if (b.art === "Umbuchung") setBelegart("Umbuchung");
    else if (b.art === "Investition") setBelegart("Investition");
    else {
      setBelegart("Buchung");
      if (b.splits && b.splits.length > 0) setPositionen(b.splits.map((s) => ({ ...s })));
      else setPositionen([{ id: uid(), kontoId: b.kontoId, betrag: Number(b.betrag), klasseId: b.klasseId }]);
    }
  };

  useEffect(() => {
    if (editBuchungId) {
      const b = data.buchungen.find((x) => x.id === editBuchungId);
      if (b) startEdit(b);
      onConsumedEdit();
    }
  }, [editBuchungId]);

  const submit = (e) => {
    e.preventDefault();

    if (belegart === "Umbuchung") {
      if (!form.betrag || !form.vonBankkontoId || !form.nachBankkontoId || form.vonBankkontoId === form.nachBankkontoId) return;
      const rec = {
        id: editId || form.id || uid(), buchungsnummer, datum: form.datum, art: "Umbuchung", betrag: Math.abs(Number(form.betrag)),
        vonBankkontoId: form.vonBankkontoId, nachBankkontoId: form.nachBankkontoId,
        beschreibung: form.beschreibung, kontoId: "", adresseId: "", klasseId: "", bankkontoId: "", splits: [],
      };
      update((d) => ({ ...d, buchungen: editId ? d.buchungen.map((b) => (b.id === editId ? rec : b)) : [rec, ...d.buchungen] }));
      if (editId) db.buchungen.update(rec); else db.buchungen.add(rec);
      resetForm();
      return;
    }

    if (belegart === "Investition") {
      if (!form.betrag || !form.bankkontoId || !form.vermoegenswertId) return;
      const asset = data.vermoegenswerte.find((a) => a.id === form.vermoegenswertId);
      const rec = {
        id: editId || form.id || uid(), buchungsnummer, datum: form.datum, art: "Investition", betrag: Math.abs(Number(form.betrag)),
        bankkontoId: form.bankkontoId, vermoegenswertId: form.vermoegenswertId, beschreibung: form.beschreibung,
        kontoId: "", adresseId: form.adresseId, klasseId: "", splits: [],
      };
      let neueWertBuchung = null;
      update((d) => {
        const buchungen = editId ? d.buchungen.map((b) => (b.id === editId ? rec : b)) : [rec, ...d.buchungen];
        let vermoegensBuchungen = d.vermoegensBuchungen;
        if (asset && asset.typ !== "Wertpapier") {
          const bisherigerWert = assetValue(asset, form.datum);
          neueWertBuchung = { id: uid(), vermoegenswertId: form.vermoegenswertId, datum: form.datum, wert: bisherigerWert + Math.abs(Number(form.betrag)) };
          vermoegensBuchungen = [neueWertBuchung, ...vermoegensBuchungen];
        }
        return { ...d, buchungen, vermoegensBuchungen };
      });
      if (editId) db.buchungen.update(rec); else db.buchungen.add(rec);
      if (neueWertBuchung) db.vermoegensBuchungen.add(neueWertBuchung);
      resetForm();
      return;
    }

    // Buchung mit einheitlichen Positionen (ersetzt vorheriges Splitt-/Einzelmodell)
    if (!form.bankkontoId) return;
    const gueltig = positionen.filter((r) => r.kontoId && Number(r.betrag) !== 0 && r.betrag !== "");
    if (gueltig.length === 0) return;
    const nettoGueltig = gueltig.reduce((s, r) => {
      const k = kontoById[r.kontoId];
      const betrag = Number(r.betrag);
      return s + (k && k.typ === "Ertrag" ? betrag : -betrag);
    }, 0);
    const rec = {
      id: editId || form.id || uid(), buchungsnummer, datum: form.datum, art: nettoGueltig >= 0 ? "Einnahme" : "Ausgabe", betrag: Math.abs(nettoGueltig),
      bankkontoId: form.bankkontoId, adresseId: form.adresseId, beschreibung: form.beschreibung,
      kontoId: "", klasseId: "", splits: gueltig.map((r) => ({ id: r.id || uid(), kontoId: r.kontoId, betrag: Number(r.betrag), klasseId: r.klasseId })),
    };
    update((d) => ({ ...d, buchungen: editId ? d.buchungen.map((b) => (b.id === editId ? rec : b)) : [rec, ...d.buchungen] }));
    if (editId) db.buchungen.update(rec); else db.buchungen.add(rec);
    resetForm();
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Buchung erfassen</h2>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ background: C.green, color: "#fff", padding: "16px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontFamily: FONT_SERIF, fontSize: 18 }}>{editId ? "Beleg bearbeiten" : "Neuer Beleg"}</div>
            <div style={{ fontSize: 12, opacity: 0.8, letterSpacing: "0.03em", textTransform: "uppercase" }}>Belegkopf</div>
          </div>
          <div style={{ fontFamily: FONT_MONO, fontSize: 13, background: "rgba(255,255,255,0.16)", padding: "6px 14px", borderRadius: 20 }}>
            {buchungsnummer}
          </div>
        </div>

        <form onSubmit={submit} style={{ padding: 22 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
            <div>
              <Label>Datum</Label>
              <Input type="date" value={form.datum} onChange={(e) => setForm({ ...form, datum: e.target.value })} required />
            </div>
            <div>
              <Label>Belegart</Label>
              <Select value={belegart} onChange={(e) => setBelegart(e.target.value)}>
                <option value="Buchung">Buchung (Einnahme/Ausgabe)</option>
                <option value="Umbuchung">Umbuchung (zwischen eigenen Konten)</option>
                <option value="Investition">Investition (Kauf Vermögenswert)</option>
              </Select>
            </div>

            {belegart === "Buchung" && (
              <>
                <div>
                  <Label>Bankkonto</Label>
                  <Select value={form.bankkontoId} onChange={(e) => setForm({ ...form, bankkontoId: e.target.value })} required>
                    {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Adresse (Empfänger/Sender)</Label>
                  <SearchSelect
                    value={form.adresseId}
                    onChange={(v) => setForm({ ...form, adresseId: v })}
                    options={data.adressen.map((a) => ({ value: a.id, label: a.name }))}
                    placeholder="– keine / suchen –"
                  />
                </div>
              </>
            )}

            {belegart === "Umbuchung" && (
              <>
                <div>
                  <Label>Von Bankkonto</Label>
                  <Select value={form.vonBankkontoId} onChange={(e) => setForm({ ...form, vonBankkontoId: e.target.value })} required>
                    {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Nach Bankkonto</Label>
                  <Select value={form.nachBankkontoId} onChange={(e) => setForm({ ...form, nachBankkontoId: e.target.value })} required>
                    {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Betrag (€)</Label>
                  <Input type="number" step="0.01" min="0" value={form.betrag} onChange={(e) => setForm({ ...form, betrag: e.target.value })} required />
                </div>
              </>
            )}

            {belegart === "Investition" && (
              <>
                <div>
                  <Label>Bankkonto (Quelle)</Label>
                  <Select value={form.bankkontoId} onChange={(e) => setForm({ ...form, bankkontoId: e.target.value })} required>
                    {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Vermögenswert (Ziel)</Label>
                  <SearchSelect
                    value={form.vermoegenswertId}
                    onChange={(v) => setForm({ ...form, vermoegenswertId: v })}
                    options={data.vermoegenswerte.map((a) => ({ value: a.id, label: `${a.name} (${a.typ})` }))}
                    placeholder="– suchen –"
                    required
                  />
                </div>
                <div>
                  <Label>Betrag (€)</Label>
                  <Input type="number" step="0.01" min="0" value={form.betrag} onChange={(e) => setForm({ ...form, betrag: e.target.value })} required />
                </div>
                <div>
                  <Label>Adresse (Verkäufer, optional)</Label>
                  <SearchSelect
                    value={form.adresseId}
                    onChange={(v) => setForm({ ...form, adresseId: v })}
                    options={data.adressen.map((a) => ({ value: a.id, label: a.name }))}
                    placeholder="– keine / suchen –"
                  />
                </div>
              </>
            )}
          </div>

          {belegart === "Buchung" && (
            <div style={{ marginBottom: 16 }}>
              <Label>Rechnungspositionen</Label>
              <div style={{ border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", marginTop: 4 }}>
                <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1.4fr auto", background: C.paper, padding: "7px 12px", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: C.inkSoft }}>
                  <div>Kategorie</div><div>Betrag (€)</div><div>Klasse</div><div></div>
                </div>
                {positionen.map((row, i) => (
                  <div key={row.id} style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr 1.4fr auto", gap: 8, padding: "9px 12px", alignItems: "center", borderTop: `1px solid ${C.line}` }}>
                    <SearchSelect
                      value={row.kontoId}
                      onChange={(v) => updatePosition(i, { kontoId: v })}
                      options={[
                        ...data.konten.filter((k) => k.typ === "Ertrag" && istBlattkonto(k, data.konten)).map((k) => ({ value: k.id, label: kontoPfadName(k, kontoById), group: "Erträge" })),
                        ...data.konten.filter((k) => k.typ === "Aufwand" && istBlattkonto(k, data.konten)).map((k) => ({ value: k.id, label: kontoPfadName(k, kontoById), group: "Aufwendungen" })),
                      ]}
                      placeholder="– Kategorie suchen –"
                      required
                    />
                    <Input type="number" step="0.01" placeholder="neg. = Minderung" value={row.betrag} onChange={(e) => updatePosition(i, { betrag: e.target.value })} required />
                    <Select value={row.klasseId} onChange={(e) => updatePosition(i, { klasseId: e.target.value })}>
                      <option value="">– keine –</option>
                      {data.klassen.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                    </Select>
                    {positionen.length > 1
                      ? <span onClick={() => removePosition(i)} style={{ cursor: "pointer", color: C.loss, fontSize: 12 }}>entfernen</span>
                      : <span />}
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 12px", background: C.paper, borderTop: `1px solid ${C.lineStrong}` }}>
                  <Btn onClick={addPosition}>+ Position</Btn>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ color: C.inkSoft, marginRight: 8 }}>Netto-Betrag (Bankkonto)</span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: 600 }}><Money value={netto} /></span>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 6 }}>
                Richtung ergibt sich aus der Kategorie (Ertrag = Zugang, Aufwand = Abgang). Negativer Betrag mindert eine Kategorie (z. B. Rückzahlung).
              </div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Label>Beschreibung</Label>
            <Input value={form.beschreibung} onChange={(e) => setForm({ ...form, beschreibung: e.target.value })} placeholder="z. B. Miete August" />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Btn type="submit" primary>{editId ? "Beleg speichern" : "Beleg buchen"}</Btn>
            {editId && <Btn onClick={resetForm}>Abbrechen</Btn>}
          </div>
          {belegart === "Investition" && data.vermoegenswerte.find((a) => a.id === form.vermoegenswertId)?.typ === "Wertpapier" && (
            <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 8 }}>
              Hinweis: Bei Wertpapieren wird hier nur der Kaufbetrag vom Bankkonto abgebucht. Stückzahl/Kurs bitte zusätzlich im Anlagenregister pflegen, damit der Depotwert stimmt.
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

// ---------- Buchungsliste ----------
function Buchungsliste({ data, update, db, kontoById, adresseById, bankById, onEdit }) {
  const [filterJahr, setFilterJahr] = useState("");
  const [filterMonat, setFilterMonat] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [filterBankkonto, setFilterBankkonto] = useState("");
  const [filterKonto, setFilterKonto] = useState("");

  const jahre = Array.from(new Set(data.buchungen.map((b) => b.datum && b.datum.slice(0, 4)))).filter(Boolean).sort().reverse();
  const monate = [
    ["01", "Januar"], ["02", "Februar"], ["03", "März"], ["04", "April"], ["05", "Mai"], ["06", "Juni"],
    ["07", "Juli"], ["08", "August"], ["09", "September"], ["10", "Oktober"], ["11", "November"], ["12", "Dezember"],
  ];
  const kontoOptionen = data.konten.filter((k) => istBlattkonto(k, data.konten)).map((k) => ({ value: k.id, label: kontoPfadName(k, kontoById) }));

  const list = data.buchungen
    .filter((b) => {
      if (filterTag) { if (b.datum !== filterTag) return false; }
      else {
        if (filterJahr && (!b.datum || b.datum.slice(0, 4) !== filterJahr)) return false;
        if (filterMonat && (!b.datum || b.datum.slice(5, 7) !== filterMonat)) return false;
      }
      if (filterBankkonto) {
        const beteiligt = b.bankkontoId === filterBankkonto || b.vonBankkontoId === filterBankkonto || b.nachBankkontoId === filterBankkonto;
        if (!beteiligt) return false;
      }
      if (filterKonto && !bookingPostings(b).some((p) => p.kontoId === filterKonto)) return false;
      return true;
    })
    .sort((a, b) => b.datum.localeCompare(a.datum));

  const kontoLabel = (b) => {
    if (b.art === "Umbuchung") return `${bankById[b.vonBankkontoId]?.name || "?"} → ${bankById[b.nachBankkontoId]?.name || "?"}`;
    if (b.art === "Investition") return `→ ${data.vermoegenswerte.find((a) => a.id === b.vermoegenswertId)?.name || "?"}`;
    if (b.splits && b.splits.length > 1) return `Splitt (${b.splits.length} Positionen)`;
    if (b.splits && b.splits.length === 1) return kontoById[b.splits[0].kontoId]?.name || "–";
    return kontoById[b.kontoId]?.name || "–";
  };
  const betragVorzeichen = (b) => (b.art === "Einnahme" ? Number(b.betrag) : -Number(b.betrag));

  const remove = (id) => {
    update((d) => ({ ...d, buchungen: d.buchungen.filter((b) => b.id !== id) }));
    db.buchungen.remove(id);
  };

  const zuruecksetzen = () => { setFilterJahr(""); setFilterMonat(""); setFilterTag(""); setFilterBankkonto(""); setFilterKonto(""); };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Buchungsliste</h2>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, alignItems: "end" }}>
          <div>
            <Label>Jahr</Label>
            <Select value={filterJahr} onChange={(e) => setFilterJahr(e.target.value)} disabled={!!filterTag}>
              <option value="">Alle</option>
              {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
            </Select>
          </div>
          <div>
            <Label>Monat</Label>
            <Select value={filterMonat} onChange={(e) => setFilterMonat(e.target.value)} disabled={!!filterTag}>
              <option value="">Alle</option>
              {monate.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </Select>
          </div>
          <div>
            <Label>Genauer Tag</Label>
            <Input type="date" value={filterTag} onChange={(e) => setFilterTag(e.target.value)} />
          </div>
          <div>
            <Label>Bankkonto</Label>
            <Select value={filterBankkonto} onChange={(e) => setFilterBankkonto(e.target.value)}>
              <option value="">Alle</option>
              {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Kategorie</Label>
            <SearchSelect value={filterKonto} onChange={setFilterKonto} options={kontoOptionen} placeholder="Alle / suchen" />
          </div>
          <Btn onClick={zuruecksetzen}>Filter zurücksetzen</Btn>
        </div>
      </Card>

      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <Th>Nr.</Th><Th>Datum</Th><Th>Art</Th><Th>Konto / Ziel</Th><Th>Adresse</Th><Th>Bank</Th><Th>Beschreibung</Th><Th align="right">Betrag</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <Td mono style={{ fontSize: 11, color: C.inkSoft }}>{b.buchungsnummer || "–"}</Td>
                <Td mono>{b.datum}</Td>
                <Td>{b.art}</Td>
                <Td>{kontoLabel(b)}</Td>
                <Td>{adresseById[b.adresseId]?.name || "–"}</Td>
                <Td>{bankById[b.bankkontoId]?.name || "–"}</Td>
                <Td>{b.beschreibung}</Td>
                <Td align="right" mono>
                  {b.art === "Umbuchung" ? fmtEUR(Number(b.betrag)) : <Money value={b.art === "Investition" ? -Number(b.betrag) : betragVorzeichen(b)} />}
                </Td>
                <Td align="right">
                  <span onClick={() => onEdit(b.id)} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => remove(b.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
            {list.length === 0 && <tr><Td colSpan={9}><i>Keine Buchungen für diese Filter.</i></Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- CSV Import (Ersatz für Live-Onlinebanking-Abfrage) ----------
function ImportCSV({ data, update }) {
  const [rows, setRows] = useState([]);
  const [bankkontoId, setBankkontoId] = useState(data.bankkonten[0]?.id || "");
  const [mapping, setMapping] = useState({ datum: "", betrag: "", beschreibung: "" });
  const [columns, setColumns] = useState([]);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        setColumns(res.meta.fields || []);
        setRows(res.data);
        const guess = (names) => (res.meta.fields || []).find((f) => names.some((n) => f.toLowerCase().includes(n)));
        setMapping({
          datum: guess(["datum", "date", "buchungstag"]) || "",
          betrag: guess(["betrag", "amount", "umsatz"]) || "",
          beschreibung: guess(["verwendungszweck", "beschreibung", "text", "buchungstext"]) || "",
        });
      },
    });
  };

  const doImport = () => {
    if (!mapping.datum || !mapping.betrag) return;
    const kontoAufwand = data.konten.find((k) => k.typ === "Aufwand");
    const kontoErtrag = data.konten.find((k) => k.typ === "Ertrag");
    const neue = rows
      .map((r) => {
        const rawBetrag = String(r[mapping.betrag] || "0").replace(/\./g, "").replace(",", ".");
        const betrag = parseFloat(rawBetrag);
        if (isNaN(betrag) || betrag === 0) return null;
        let datum = r[mapping.datum] || todayISO();
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
          const [t, m, j] = datum.split(".");
          datum = `${j}-${m}-${t}`;
        }
        return {
          id: uid(),
          datum,
          betrag: Math.abs(betrag),
          art: betrag >= 0 ? "Einnahme" : "Ausgabe",
          kontoId: (betrag >= 0 ? kontoErtrag : kontoAufwand)?.id || "",
          adresseId: "",
          klasseId: "",
          bankkontoId,
          beschreibung: r[mapping.beschreibung] || "",
        };
      })
      .filter(Boolean);
    update((d) => ({ ...d, buchungen: [...neue, ...d.buchungen] }));
    setRows([]);
    setColumns([]);
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Import (CSV-Kontoauszug)</h2>
      <Card style={{ marginBottom: 16, background: C.gainSoft, borderColor: C.gain }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Eine direkte Live-Verbindung zu deinem Onlinebanking ist hier aus Sicherheitsgründen nicht möglich (dafür wäre eine
          FinTS/PSD2-Anbindung mit deinen Bankzugangsdaten nötig). Praktikabler Ersatz: Lade den CSV- oder CAMT-Export deiner
          Bank herunter und importiere ihn hier.
        </div>
      </Card>
      <Card>
        <div style={{ marginBottom: 12 }}>
          <Label>Ziel-Bankkonto</Label>
          <Select value={bankkontoId} onChange={(e) => setBankkontoId(e.target.value)} style={{ maxWidth: 260 }}>
            {data.bankkonten.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Label>CSV-Datei wählen</Label>
          <input type="file" accept=".csv" onChange={handleFile} />
        </div>

        {columns.length > 0 && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 12 }}>
              <div>
                <Label>Spalte: Datum</Label>
                <Select value={mapping.datum} onChange={(e) => setMapping({ ...mapping, datum: e.target.value })}>
                  <option value="">– wählen –</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div>
                <Label>Spalte: Betrag</Label>
                <Select value={mapping.betrag} onChange={(e) => setMapping({ ...mapping, betrag: e.target.value })}>
                  <option value="">– wählen –</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
              <div>
                <Label>Spalte: Beschreibung</Label>
                <Select value={mapping.beschreibung} onChange={(e) => setMapping({ ...mapping, beschreibung: e.target.value })}>
                  <option value="">– keine –</option>
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>
              {rows.length} Zeilen erkannt. Positive Beträge werden als Einnahme, negative als Ausgabe importiert
              (Kategorie kann danach unter „Buchungen“ angepasst werden).
            </div>
            <Btn primary onClick={doImport}>{rows.length} Buchungen importieren</Btn>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- Adressbuch ----------
function emptyAdresse() {
  return { id: null, name: "", strasse: "", plz: "", stadt: "", land: "Deutschland", kategorieId: "", iban: "", notiz: "" };
}

function Adressen({ data, update, db }) {
  const [form, setForm] = useState(emptyAdresse());
  const [neueKategorie, setNeueKategorie] = useState("");
  const kategorieById = Object.fromEntries(data.adresskategorien.map((k) => [k.id, k]));

  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    const rec = { ...form, id: form.id || uid() };
    update((d) => ({
      ...d,
      adressen: form.id ? d.adressen.map((a) => (a.id === form.id ? rec : a)) : [rec, ...d.adressen],
    }));
    if (form.id) db.adressen.update(rec); else db.adressen.add(rec);
    setForm(emptyAdresse());
  };
  const remove = (id) => {
    update((d) => ({ ...d, adressen: d.adressen.filter((a) => a.id !== id) }));
    db.adressen.remove(id);
  };

  const addKategorie = () => {
    if (!neueKategorie.trim()) return;
    const rec = { id: uid(), name: neueKategorie.trim() };
    update((d) => ({ ...d, adresskategorien: [...d.adresskategorien, rec] }));
    db.adresskategorien.add(rec);
    setForm({ ...form, kategorieId: rec.id });
    setNeueKategorie("");
  };
  const removeKategorie = (id) => {
    update((d) => ({ ...d, adresskategorien: d.adresskategorien.filter((k) => k.id !== id) }));
    db.adresskategorien.remove(id);
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Adressbuch</h2>
      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div>
              <Label>Kategorie</Label>
              <Select value={form.kategorieId} onChange={(e) => setForm({ ...form, kategorieId: e.target.value })}>
                <option value="">– keine –</option>
                {data.adresskategorien.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </Select>
            </div>
            <div><Label>IBAN (optional)</Label><Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.5fr 1.5fr", gap: 10, marginBottom: 10 }}>
            <div><Label>Straße + Hausnr.</Label><Input value={form.strasse} onChange={(e) => setForm({ ...form, strasse: e.target.value })} /></div>
            <div><Label>PLZ</Label><Input value={form.plz} onChange={(e) => setForm({ ...form, plz: e.target.value })} /></div>
            <div><Label>Stadt</Label><Input value={form.stadt} onChange={(e) => setForm({ ...form, stadt: e.target.value })} /></div>
            <div>
              <Label>Land</Label>
              <Select value={form.land} onChange={(e) => setForm({ ...form, land: e.target.value })}>
                {LAENDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label>Notiz</Label>
            <Input value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn primary type="submit">{form.id ? "Speichern" : "Adresse anlegen"}</Btn>
            {form.id && <Btn onClick={() => setForm(emptyAdresse())}>Abbrechen</Btn>}
          </div>
        </form>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Kategorien verwalten</Label>
        <div style={{ display: "flex", gap: 8, margin: "8px 0", flexWrap: "wrap" }}>
          {data.adresskategorien.map((k) => (
            <span key={k.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 20, padding: "4px 10px", fontSize: 12.5 }}>
              {k.name}
              <span onClick={() => removeKategorie(k.id)} style={{ cursor: "pointer", color: C.loss }}>✕</span>
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input value={neueKategorie} onChange={(e) => setNeueKategorie(e.target.value)} placeholder="Neue Kategorie, z. B. Supermarkt" style={{ maxWidth: 240 }} />
          <Btn onClick={addKategorie}>+ Hinzufügen</Btn>
        </div>
      </Card>

      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Kategorie</Th><Th>Adresse</Th><Th>IBAN</Th><Th></Th></tr></thead>
          <tbody>
            {data.adressen.map((a) => (
              <tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>{kategorieById[a.kategorieId]?.name || "–"}</Td>
                <Td>{[a.strasse, [a.plz, a.stadt].filter(Boolean).join(" "), a.land].filter(Boolean).join(", ") || "–"}</Td>
                <Td mono>{a.iban}</Td>
                <Td align="right">
                  <span onClick={() => setForm({ ...emptyAdresse(), ...a })} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => remove(a.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
            {data.adressen.length === 0 && <tr><Td colSpan={5}><i>Noch keine Adressen erfasst.</i></Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Stammdaten: Konten, Klassen, Bankkonten, Bilanzpositionen ----------
function Stammdaten({ data, update, db }) {
  const kontoById = Object.fromEntries(data.konten.map((k) => [k.id, k]));
  const [kForm, setKForm] = useState({ id: null, name: "", typ: "Aufwand", gruppe: "", kostenart: "Variabel", parentId: "" });
  const [klForm, setKlForm] = useState({ id: null, name: "", typ: "Kostenstelle" });
  const [bForm, setBForm] = useState({ id: null, name: "", startsaldo: "", kreditinstitutId: "", kontotyp: "Girokonto", kontonummer: "" });
  const [sichtbareKontonummern, setSichtbareKontonummern] = useState({});
  const [pForm, setPForm] = useState({ id: null, name: "", typ: "Aktiva", wert: "" });

  const saveList = (listName, form, setForm, empty) => (e) => {
    e.preventDefault();
    if (!form.name) return;
    const rec = { ...form, id: form.id || uid() };
    update((d) => ({
      ...d,
      [listName]: form.id ? d[listName].map((x) => (x.id === form.id ? rec : x)) : [rec, ...d[listName]],
    }));
    if (db[listName]) { if (form.id) db[listName].update(rec); else db[listName].add(rec); }
    setForm(empty);
  };
  const removeFrom = (listName, id) => {
    update((d) => ({ ...d, [listName]: d[listName].filter((x) => x.id !== id) }));
    if (db[listName]) db[listName].remove(id);
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Konten & Klassen</h2>

      <Card style={{ marginBottom: 16 }}>
        <Label>Konten (GuV-Kategorien: Erträge / Aufwendungen)</Label>
        <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>
          Konten lassen sich verschachteln (z. B. Lebenshaltung → Lebensmittel → Nahrung). Bebuchbar in Buchungen ist immer nur die jeweils unterste Ebene.
        </div>
        <form onSubmit={saveList("konten", kForm, setKForm, { id: null, name: "", typ: "Aufwand", gruppe: "", kostenart: "Variabel", parentId: "" })} style={{ margin: "10px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Name" value={kForm.name} onChange={(e) => setKForm({ ...kForm, name: e.target.value })} required />
            <Select value={kForm.typ} onChange={(e) => setKForm({ ...kForm, typ: e.target.value })}>
              <option value="Aufwand">Aufwand</option><option value="Ertrag">Ertrag</option>
            </Select>
            <SearchSelect
              value={kForm.parentId || ""}
              onChange={(v) => setKForm({ ...kForm, parentId: v })}
              options={data.konten.filter((k) => k.typ === kForm.typ && k.id !== kForm.id).map((k) => ({ value: k.id, label: kontoPfadName(k, kontoById) }))}
              placeholder="– oberste Ebene / suchen –"
            />
            <Input placeholder="Gruppe (z. B. Fixkosten)" value={kForm.gruppe} onChange={(e) => setKForm({ ...kForm, gruppe: e.target.value })} />
            {kForm.typ === "Aufwand" && (
              <Select value={kForm.kostenart} onChange={(e) => setKForm({ ...kForm, kostenart: e.target.value })}>
                <option value="Fix">Fixkosten</option><option value="Variabel">Variable Kosten</option>
              </Select>
            )}
            <Btn primary type="submit">{kForm.id ? "Speichern" : "Hinzufügen"}</Btn>
          </div>
        </form>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Typ</Th><Th>Gruppe</Th><Th>Kostenart</Th><Th>Bebuchbar</Th><Th></Th></tr></thead>
          <tbody>
            {[...data.konten].sort((a, b) => a.typ.localeCompare(b.typ) || kontoPfadName(a, kontoById).localeCompare(kontoPfadName(b, kontoById))).map((k) => (
              <tr key={k.id}>
                <Td style={{ paddingLeft: 10 + kontoTiefe(k, kontoById) * 18 }}>{kontoTiefe(k, kontoById) > 0 ? "↳ " : ""}{k.name}</Td>
                <Td>{k.typ}</Td><Td>{k.gruppe}</Td><Td>{k.typ === "Aufwand" ? (k.kostenart || "Variabel") : "–"}</Td>
                <Td>{istBlattkonto(k, data.konten) ? "Ja" : "– Gruppe –"}</Td>
                <Td align="right">
                  <span onClick={() => setKForm({ ...k, parentId: k.parentId || "" })} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => removeFrom("konten", k.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Klassen (Kostenstellen / Kostenträger)</Label>
        <form onSubmit={saveList("klassen", klForm, setKlForm, { id: null, name: "", typ: "Kostenstelle" })} style={{ margin: "10px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Name" value={klForm.name} onChange={(e) => setKlForm({ ...klForm, name: e.target.value })} required />
            <Select value={klForm.typ} onChange={(e) => setKlForm({ ...klForm, typ: e.target.value })}>
              <option value="Kostenstelle">Kostenstelle</option><option value="Kostenträger">Kostenträger</option>
            </Select>
            <Btn primary type="submit">{klForm.id ? "Speichern" : "Hinzufügen"}</Btn>
          </div>
        </form>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Typ</Th><Th></Th></tr></thead>
          <tbody>
            {data.klassen.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}</Td><Td>{k.typ}</Td>
                <Td align="right">
                  <span onClick={() => setKlForm(k)} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => removeFrom("klassen", k.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Bankkonten</Label>
        <form onSubmit={saveList("bankkonten", bForm, setBForm, { id: null, name: "", startsaldo: "", kreditinstitutId: "", kontotyp: "Girokonto", kontonummer: "" })} style={{ margin: "10px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Name" value={bForm.name} onChange={(e) => setBForm({ ...bForm, name: e.target.value })} required />
            <Select value={bForm.kontotyp} onChange={(e) => setBForm({ ...bForm, kontotyp: e.target.value })}>
              {KONTOTYPEN.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
            <SearchSelect
              value={bForm.kreditinstitutId}
              onChange={(v) => setBForm({ ...bForm, kreditinstitutId: v })}
              options={data.adressen.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="Kreditinstitut suchen"
            />
            <Input type="number" step="0.01" placeholder="Startsaldo (€)" value={bForm.startsaldo} onChange={(e) => setBForm({ ...bForm, startsaldo: e.target.value })} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Kontonummer / IBAN (optional)" value={bForm.kontonummer} onChange={(e) => setBForm({ ...bForm, kontonummer: e.target.value })} />
            <Btn primary type="submit">{bForm.id ? "Speichern" : "Hinzufügen"}</Btn>
          </div>
        </form>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Typ</Th><Th>Kreditinstitut</Th><Th>Kontonummer</Th><Th align="right">Startsaldo</Th><Th></Th></tr></thead>
          <tbody>
            {data.bankkonten.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td>{b.kontotyp || "–"}</Td>
                <Td>{data.adressen.find((a) => a.id === b.kreditinstitutId)?.name || "–"}</Td>
                <Td mono>
                  {b.kontonummer
                    ? (sichtbareKontonummern[b.id] ? b.kontonummer : "•".repeat(Math.max(4, b.kontonummer.length - 4)) + b.kontonummer.slice(-4))
                    : "–"}
                  {b.kontonummer && (
                    <span
                      onClick={() => setSichtbareKontonummern({ ...sichtbareKontonummern, [b.id]: !sichtbareKontonummern[b.id] })}
                      style={{ cursor: "pointer", marginLeft: 8, fontSize: 11, color: C.green }}
                    >
                      {sichtbareKontonummern[b.id] ? "verbergen" : "anzeigen"}
                    </span>
                  )}
                </Td>
                <Td align="right" mono>{fmtEUR(Number(b.startsaldo) || 0)}</Td>
                <Td align="right">
                  <span onClick={() => setBForm({ id: null, name: "", startsaldo: "", kreditinstitutId: "", kontotyp: "Girokonto", kontonummer: "", ...b })} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => removeFrom("bankkonten", b.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <Label>Sonstige Bilanzpositionen (z. B. Darlehen, Sachwerte – manuell gepflegt)</Label>
        <form onSubmit={saveList("bilanzpositionen", pForm, setPForm, { id: null, name: "", typ: "Aktiva", wert: "" })} style={{ margin: "10px 0" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Name" value={pForm.name} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} required />
            <Select value={pForm.typ} onChange={(e) => setPForm({ ...pForm, typ: e.target.value })}>
              <option value="Aktiva">Aktiva</option><option value="Passiva">Passiva</option>
            </Select>
            <Input type="number" step="0.01" placeholder="Wert (€)" value={pForm.wert} onChange={(e) => setPForm({ ...pForm, wert: e.target.value })} />
            <Btn primary type="submit">{pForm.id ? "Speichern" : "Hinzufügen"}</Btn>
          </div>
        </form>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Typ</Th><Th align="right">Wert</Th><Th></Th></tr></thead>
          <tbody>
            {data.bilanzpositionen.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td><Td>{p.typ}</Td><Td align="right" mono>{fmtEUR(Number(p.wert) || 0)}</Td>
                <Td align="right">
                  <span onClick={() => setPForm(p)} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                  <span onClick={() => removeFrom("bilanzpositionen", p.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- GuV ----------
function GuV({ data, kontoById, klassen }) {
  const [von, setVon] = useState(todayISO().slice(0, 4) + "-01-01");
  const [bis, setBis] = useState(todayISO());
  const [klasseFilter, setKlasseFilter] = useState("");

  const relevante = data.buchungen.filter((b) => b.datum >= von && b.datum <= bis);

  const postingsOf = (b) => {
    const list = bookingPostings(b);
    return klasseFilter ? list.filter((p) => p.klasseId === klasseFilter) : list;
  };

  const gruppiere = (typ) => {
    const map = {};
    for (const b of relevante) {
      for (const p of postingsOf(b)) {
        const k = kontoById[p.kontoId];
        if (!k || k.typ !== typ) continue;
        const gruppe = k.gruppe || "Ohne Gruppe";
        map[gruppe] = map[gruppe] || {};
        map[gruppe][k.name] = (map[gruppe][k.name] || 0) + Number(p.betrag);
      }
    }
    return map;
  };
  const ertraege = gruppiere("Ertrag");
  const aufwendungen = gruppiere("Aufwand");
  const sumErtraege = Object.values(ertraege).reduce((s, g) => s + Object.values(g).reduce((a, b) => a + b, 0), 0);
  const sumAufwendungen = Object.values(aufwendungen).reduce((s, g) => s + Object.values(g).reduce((a, b) => a + b, 0), 0);
  const ergebnis = sumErtraege - sumAufwendungen;
  const ergebnisquote = sumErtraege > 0 ? (ergebnis / sumErtraege) * 100 : 0;

  const fixVarMonatlich = (() => {
    const map = {};
    for (const b of relevante) {
      for (const p of postingsOf(b)) {
        const k = kontoById[p.kontoId];
        if (!k || k.typ !== "Aufwand") continue;
        const mk = monthKey(b.datum);
        map[mk] = map[mk] || { monat: mk, Fix: 0, Variabel: 0 };
        map[mk][k.kostenart === "Fix" ? "Fix" : "Variabel"] += Number(p.betrag);
      }
    }
    return Object.values(map).sort((a, b) => a.monat.localeCompare(b.monat));
  })();
  const sumFix = fixVarMonatlich.reduce((s, m) => s + m.Fix, 0);
  const fixquote = sumAufwendungen > 0 ? (sumFix / sumAufwendungen) * 100 : 0;

  const ertragsVerlauf = (() => {
    const perMonat = {};
    const totalProKonto = {};
    for (const b of relevante) {
      for (const p of postingsOf(b)) {
        const k = kontoById[p.kontoId];
        if (!k || k.typ !== "Ertrag") continue;
        const mk = monthKey(b.datum);
        perMonat[mk] = perMonat[mk] || {};
        perMonat[mk][k.name] = (perMonat[mk][k.name] || 0) + Number(p.betrag);
        totalProKonto[k.name] = (totalProKonto[k.name] || 0) + Number(p.betrag);
      }
    }
    const topKonten = Object.entries(totalProKonto).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
    const rows = Object.keys(perMonat).sort().map((mk) => {
      const row = { monat: mk };
      topKonten.forEach((n) => (row[n] = perMonat[mk][n] || 0));
      return row;
    });
    return { rows, keys: topKonten };
  })();
  const linienFarben = [C.green, C.amber, C.loss, "#4A6FA5", "#8B6EA0"];

  const renderGruppe = (gruppen, farbe) =>
    Object.entries(gruppen).map(([gruppe, konten]) => (
      <React.Fragment key={gruppe}>
        <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>{gruppe}</Td></tr>
        {Object.entries(konten).map(([name, wert]) => (
          <tr key={name}>
            <Td style={{ paddingLeft: 24 }}>{name}</Td>
            <Td align="right" mono style={{ color: farbe }}>{fmtEUR(wert)}</Td>
          </tr>
        ))}
      </React.Fragment>
    ));

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Gewinn- und Verlustrechnung</h2>
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div><Label>Von</Label><Input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></div>
        <div><Label>Bis</Label><Input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></div>
        <div>
          <Label>Klasse</Label>
          <Select value={klasseFilter} onChange={(e) => setKlasseFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">Alle</option>
            {klassen.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Card><Label>Ergebnis</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO }}><Money value={ergebnis} /></div></Card>
        <Card><Label>Ergebnisquote</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO }}>{ergebnisquote.toFixed(1)} %</div></Card>
        <Card><Label>Fixkostenquote</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO }}>{fixquote.toFixed(1)} %</div></Card>
        <Card><Label>Aufwand gesamt</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.loss }}>{fmtEUR(sumAufwendungen)}</div></Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Label>Kostenstruktur je Monat (Fix / Variabel)</Label>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={fixVarMonatlich}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Fix" stackId="k" fill={C.amber} />
              <Bar dataKey="Variabel" stackId="k" fill={C.lineStrong} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Erträge im Zeitverlauf nach Kategorie (Top 5)</Label>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={ertragsVerlauf.rows}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {ertragsVerlauf.keys.map((k, i) => (
                <Line key={k} type="monotone" dataKey={k} stroke={linienFarben[i % linienFarben.length]} strokeWidth={2} dot={{ r: 2 }} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Position</Th><Th align="right">Betrag</Th></tr></thead>
          <tbody>
            <tr><Td style={{ fontWeight: 700, fontFamily: FONT_SERIF }} colSpan={2}>Erträge</Td></tr>
            {renderGruppe(ertraege, C.gain)}
            <tr><Td style={{ fontWeight: 600 }}>Summe Erträge</Td><Td align="right" mono style={{ fontWeight: 600, color: C.gain }}>{fmtEUR(sumErtraege)}</Td></tr>
            <tr><Td colSpan={2} style={{ borderBottom: `2px solid ${C.line}`, padding: 4 }}></Td></tr>
            <tr><Td style={{ fontWeight: 700, fontFamily: FONT_SERIF }} colSpan={2}>Aufwendungen</Td></tr>
            {renderGruppe(aufwendungen, C.loss)}
            <tr><Td style={{ fontWeight: 600 }}>Summe Aufwendungen</Td><Td align="right" mono style={{ fontWeight: 600, color: C.loss }}>{fmtEUR(sumAufwendungen)}</Td></tr>
            <tr><Td colSpan={2} style={{ borderBottom: `2px solid ${C.lineStrong}`, padding: 4 }}></Td></tr>
            <tr>
              <Td style={{ fontWeight: 700, fontFamily: FONT_SERIF, fontSize: 15 }}>Jahresüberschuss / -fehlbetrag</Td>
              <Td align="right" mono style={{ fontWeight: 700, fontSize: 15 }}><Money value={ergebnis} /></Td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Bilanz ----------
function Bilanz({ data, bankSaldo, assetValue, loanRestschuld, nettovermoegenAt }) {
  const [stichtag, setStichtag] = useState(todayISO());

  const aktivaBank = data.bankkonten.map((b) => ({ name: b.name, wert: bankSaldo(b.id, stichtag) }));
  const aktivaAnlagen = data.vermoegenswerte.map((a) => ({ name: a.name, typ: a.typ, wert: assetValue(a, stichtag) }));
  const aktivaSonstige = data.bilanzpositionen.filter((p) => p.typ === "Aktiva");
  const passivaDarlehen = data.darlehen.map((l) => ({ name: l.name, wert: loanRestschuld(l, stichtag) }));
  const passivaSonstige = data.bilanzpositionen.filter((p) => p.typ === "Passiva");

  const sumAktivaBank = aktivaBank.reduce((s, a) => s + a.wert, 0);
  const sumAktivaAnlagen = aktivaAnlagen.reduce((s, a) => s + a.wert, 0);
  const sumAktivaSonstige = aktivaSonstige.reduce((s, a) => s + Number(a.wert), 0);
  const sumAktiva = sumAktivaBank + sumAktivaAnlagen + sumAktivaSonstige;
  const sumPassivaDarlehen = passivaDarlehen.reduce((s, a) => s + a.wert, 0);
  const sumPassivaSonstige = passivaSonstige.reduce((s, a) => s + Number(a.wert), 0);
  const eigenkapital = sumAktiva - sumPassivaDarlehen - sumPassivaSonstige;

  const vermoegensverlauf = (() => {
    const monate = [];
    const start = new Date(stichtag);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start);
      d.setMonth(d.getMonth() - i);
      monate.push(d.toISOString().slice(0, 7));
    }
    return monate.map((mk) => ({ monat: mk, Nettovermögen: nettovermoegenAt(mk + "-28") }));
  })();

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Bilanz</h2>
      <div style={{ marginBottom: 14 }}>
        <Label>Stichtag</Label>
        <Input type="date" value={stichtag} onChange={(e) => setStichtag(e.target.value)} style={{ width: 180 }} />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Label>Vermögensentwicklung (Nettovermögen, letzte 12 Monate)</Label>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={vermoegensverlauf}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line type="monotone" dataKey="Nettovermögen" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ fontWeight: 700, fontFamily: FONT_SERIF, marginBottom: 8 }}>Aktiva</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Bankguthaben</Td></tr>
              {aktivaBank.map((a) => (
                <tr key={a.name}><Td style={{ paddingLeft: 20 }}>{a.name}</Td><Td align="right" mono>{fmtEUR(a.wert)}</Td></tr>
              ))}
              {aktivaAnlagen.length > 0 && <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Anlagevermögen</Td></tr>}
              {aktivaAnlagen.map((a, i) => (
                <tr key={i}><Td style={{ paddingLeft: 20 }}>{a.name} ({a.typ})</Td><Td align="right" mono>{fmtEUR(a.wert)}</Td></tr>
              ))}
              {aktivaSonstige.length > 0 && <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Sonstige Aktiva</Td></tr>}
              {aktivaSonstige.map((a) => (
                <tr key={a.id}><Td style={{ paddingLeft: 20 }}>{a.name}</Td><Td align="right" mono>{fmtEUR(Number(a.wert))}</Td></tr>
              ))}
              <tr><Td style={{ fontWeight: 700 }}>Summe Aktiva</Td><Td align="right" mono style={{ fontWeight: 700 }}>{fmtEUR(sumAktiva)}</Td></tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <div style={{ fontWeight: 700, fontFamily: FONT_SERIF, marginBottom: 8 }}>Passiva</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {passivaDarlehen.length > 0 && <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Darlehen</Td></tr>}
              {passivaDarlehen.map((a, i) => (
                <tr key={i}><Td style={{ paddingLeft: 20 }}>{a.name}</Td><Td align="right" mono>{fmtEUR(a.wert)}</Td></tr>
              ))}
              {passivaSonstige.length > 0 && <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Sonstige Verbindlichkeiten</Td></tr>}
              {passivaSonstige.map((a) => (
                <tr key={a.id}><Td style={{ paddingLeft: 20 }}>{a.name}</Td><Td align="right" mono>{fmtEUR(Number(a.wert))}</Td></tr>
              ))}
              <tr><Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>Eigenkapital</Td></tr>
              <tr><Td style={{ paddingLeft: 20 }}>Eigenkapital (rechnerisch)</Td><Td align="right" mono>{fmtEUR(eigenkapital)}</Td></tr>
              <tr><Td style={{ fontWeight: 700 }}>Summe Passiva</Td><Td align="right" mono style={{ fontWeight: 700 }}>{fmtEUR(sumPassivaDarlehen + sumPassivaSonstige + eigenkapital)}</Td></tr>
            </tbody>
          </table>
        </Card>
      </div>
      <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 10 }}>
        Hinweis: Das Eigenkapital wird rechnerisch als Restgröße (Aktiva − Verbindlichkeiten) ermittelt, damit die Bilanz
        automatisch ausgeglichen ist. Darlehens-Restschulden werden aus dem hinterlegten Tilgungsplan zum Stichtag berechnet.
      </div>
    </div>
  );
}

// ---------- Anlagenregister ----------
function emptyAsset() {
  return { id: uid(), name: "", typ: "Wertpapier", kaufwert: "", kaufdatum: todayISO(), isin: "", anzahl: "", aktuellerKurs: "", kursDatum: todayISO(), notiz: "" };
}

function Anlagenregister({ data, update, db, assetValue }) {
  const [form, setForm] = useState(emptyAsset());
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [wertForm, setWertForm] = useState({ datum: todayISO(), wert: "" });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    const rec = { ...form, id: editId || form.id || uid() };
    update((d) => ({
      ...d,
      vermoegenswerte: editId ? d.vermoegenswerte.map((a) => (a.id === editId ? rec : a)) : [rec, ...d.vermoegenswerte],
    }));
    if (editId) db.vermoegenswerte.update(rec); else db.vermoegenswerte.add(rec);
    setForm(emptyAsset());
    setEditId(null);
  };
  const remove = (id) => {
    update((d) => ({
      ...d,
      vermoegenswerte: d.vermoegenswerte.filter((a) => a.id !== id),
      vermoegensBuchungen: d.vermoegensBuchungen.filter((v) => v.vermoegenswertId !== id),
    }));
    db.vermoegenswerte.remove(id); // Wertbuchungen räumt "on delete cascade" in der DB automatisch mit auf
  };
  const startEdit = (a) => { setForm(a); setEditId(a.id); };

  const addWert = (assetId) => {
    if (!wertForm.wert) return;
    const rec = { id: uid(), vermoegenswertId: assetId, datum: wertForm.datum, wert: wertForm.wert };
    update((d) => ({ ...d, vermoegensBuchungen: [rec, ...d.vermoegensBuchungen] }));
    db.vermoegensBuchungen.add(rec);
    setWertForm({ datum: todayISO(), wert: "" });
  };

  const updateKurs = (assetId, kurs) => {
    if (kurs === "" || kurs === undefined) return;
    let rec = null;
    update((d) => ({
      ...d,
      vermoegenswerte: d.vermoegenswerte.map((a) => {
        if (a.id !== assetId) return a;
        rec = { ...a, aktuellerKurs: kurs, kursDatum: todayISO() };
        return rec;
      }),
    }));
    if (rec) db.vermoegenswerte.update(rec);
  };

  const gesamtwert = data.vermoegenswerte.reduce((s, a) => s + assetValue(a), 0);

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Anlagenregister</h2>
      <Card style={{ marginBottom: 16, background: C.gainSoft, borderColor: C.gain }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Ein automatischer Kursabruf für Wertpapiere ist in dieser Browser-Sandbox nicht zuverlässig möglich, da
          Verbindungen zu externen Kurs-APIs hier blockiert sind. Kurse deshalb unten manuell pflegen. In einer
          eigenständig gehosteten Version ließe sich ein echter Kursabruf über eine Marktdaten-API ergänzen.
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <Label>Gesamtwert Anlagenregister</Label>
        <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>{fmtEUR(gesamtwert)}</div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Select value={form.typ} onChange={(e) => setForm({ ...form, typ: e.target.value })}>
              <option value="Wertpapier">Wertpapier</option>
              <option value="Immobilie">Immobilie</option>
              <option value="Vertrag">Vertrag</option>
              <option value="Sonstiges">Sonstiges</option>
            </Select>
            <div><Label>Kaufdatum</Label><Input type="date" value={form.kaufdatum} onChange={(e) => setForm({ ...form, kaufdatum: e.target.value })} /></div>
            <div><Label>Kaufwert (€)</Label><Input type="number" step="0.01" value={form.kaufwert} onChange={(e) => setForm({ ...form, kaufwert: e.target.value })} /></div>
          </div>
          {form.typ === "Wertpapier" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
              <div><Label>ISIN / WKN</Label><Input value={form.isin} onChange={(e) => setForm({ ...form, isin: e.target.value })} /></div>
              <div><Label>Stückzahl</Label><Input type="number" step="0.0001" value={form.anzahl} onChange={(e) => setForm({ ...form, anzahl: e.target.value })} /></div>
              <div><Label>Aktueller Kurs (€/Stück)</Label><Input type="number" step="0.01" value={form.aktuellerKurs} onChange={(e) => setForm({ ...form, aktuellerKurs: e.target.value })} /></div>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <Label>Notiz</Label>
            <Input value={form.notiz} onChange={(e) => setForm({ ...form, notiz: e.target.value })} />
          </div>
          <Btn primary type="submit">{editId ? "Speichern" : "Vermögenswert anlegen"}</Btn>
          {editId && <Btn onClick={() => { setForm(emptyAsset()); setEditId(null); }} style={{ marginLeft: 8 }}>Abbrechen</Btn>}
        </form>
      </Card>

      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Name</Th><Th>Typ</Th><Th align="right">Aktueller Wert</Th><Th>Stand</Th><Th></Th></tr></thead>
          <tbody>
            {data.vermoegenswerte.map((a) => (
              <React.Fragment key={a.id}>
                <tr>
                  <Td>{a.name}{a.isin ? ` (${a.isin})` : ""}</Td>
                  <Td>{a.typ}</Td>
                  <Td align="right" mono>{fmtEUR(assetValue(a))}</Td>
                  <Td>{a.typ === "Wertpapier" ? a.kursDatum : "–"}</Td>
                  <Td align="right">
                    <span onClick={() => setSelected(selected === a.id ? null : a.id)} style={{ cursor: "pointer", fontSize: 12, color: C.green, marginRight: 10 }}>
                      {selected === a.id ? "schließen" : "Wert erfassen"}
                    </span>
                    <span onClick={() => startEdit(a)} style={{ cursor: "pointer", fontSize: 12, color: C.amber, marginRight: 10 }}>bearbeiten</span>
                    <span onClick={() => remove(a.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
                  </Td>
                </tr>
                {selected === a.id && (
                  <tr>
                    <Td colSpan={5} style={{ background: C.paper }}>
                      {a.typ === "Wertpapier" ? (
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div><Label>Neuer Kurs (€/Stück)</Label><Input type="number" step="0.01" defaultValue={a.aktuellerKurs} onBlur={(e) => updateKurs(a.id, e.target.value)} style={{ width: 140 }} /></div>
                          <div style={{ fontSize: 12, color: C.inkSoft }}>Feld verlassen speichert den Kurs mit heutigem Datum.</div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                          <div><Label>Datum</Label><Input type="date" value={wertForm.datum} onChange={(e) => setWertForm({ ...wertForm, datum: e.target.value })} /></div>
                          <div><Label>Neuer Wert (€)</Label><Input type="number" step="0.01" value={wertForm.wert} onChange={(e) => setWertForm({ ...wertForm, wert: e.target.value })} /></div>
                          <Btn primary onClick={() => addWert(a.id)}>Wert erfassen</Btn>
                          <div style={{ fontSize: 12, color: C.inkSoft, width: "100%" }}>
                            Historie: {data.vermoegensBuchungen.filter((v) => v.vermoegenswertId === a.id).sort((x, y) => y.datum.localeCompare(x.datum)).map((v) => `${v.datum}: ${fmtEUR(Number(v.wert))}`).join(" · ") || "keine Einträge"}
                          </div>
                        </div>
                      )}
                    </Td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {data.vermoegenswerte.length === 0 && <tr><Td colSpan={5}><i>Noch keine Vermögenswerte erfasst.</i></Td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Darlehen ----------
function emptyLoan() {
  return { id: uid(), name: "", glaeubiger: "", ursprungsbetrag: "", zinssatz: "", rateMonatlich: "", startdatum: todayISO(), notiz: "" };
}

function Darlehen({ data, update, db, loanSchedule }) {
  const [form, setForm] = useState(emptyLoan());
  const [editId, setEditId] = useState(null);
  const [offen, setOffen] = useState(null);
  const [sForm, setSForm] = useState({ datum: todayISO(), betrag: "" });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name || !form.ursprungsbetrag) return;
    const rec = { ...form, id: editId || form.id || uid() };
    update((d) => ({
      ...d,
      darlehen: editId ? d.darlehen.map((l) => (l.id === editId ? rec : l)) : [rec, ...d.darlehen],
    }));
    if (editId) db.darlehen.update(rec); else db.darlehen.add(rec);
    setForm(emptyLoan());
    setEditId(null);
  };
  const remove = (id) => {
    update((d) => ({
      ...d,
      darlehen: d.darlehen.filter((l) => l.id !== id),
      sondertilgungen: d.sondertilgungen.filter((s) => s.darlehenId !== id),
    }));
    db.darlehen.remove(id); // Sondertilgungen räumt "on delete cascade" in der DB automatisch mit auf
  };
  const startEdit = (l) => { setForm(l); setEditId(l.id); };

  const addSonder = (darlehenId) => {
    if (!sForm.betrag) return;
    const rec = { id: uid(), darlehenId, datum: sForm.datum, betrag: sForm.betrag };
    update((d) => ({ ...d, sondertilgungen: [rec, ...d.sondertilgungen] }));
    db.sondertilgungen.add(rec);
    setSForm({ datum: todayISO(), betrag: "" });
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Darlehen</h2>
      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 8 }}>
            <Input placeholder="Bezeichnung" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input placeholder="Gläubiger" value={form.glaeubiger} onChange={(e) => setForm({ ...form, glaeubiger: e.target.value })} />
            <div><Label>Startdatum</Label><Input type="date" value={form.startdatum} onChange={(e) => setForm({ ...form, startdatum: e.target.value })} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div><Label>Ursprungsbetrag (€)</Label><Input type="number" step="0.01" value={form.ursprungsbetrag} onChange={(e) => setForm({ ...form, ursprungsbetrag: e.target.value })} required /></div>
            <div><Label>Zinssatz (% p. a.)</Label><Input type="number" step="0.01" value={form.zinssatz} onChange={(e) => setForm({ ...form, zinssatz: e.target.value })} /></div>
            <div><Label>Monatliche Rate (€)</Label><Input type="number" step="0.01" value={form.rateMonatlich} onChange={(e) => setForm({ ...form, rateMonatlich: e.target.value })} /></div>
          </div>
          <Btn primary type="submit">{editId ? "Speichern" : "Darlehen anlegen"}</Btn>
          {editId && <Btn onClick={() => { setForm(emptyLoan()); setEditId(null); }} style={{ marginLeft: 8 }}>Abbrechen</Btn>}
        </form>
      </Card>

      {data.darlehen.map((l) => {
        const schedule = loanSchedule(l);
        const restschuldHeute = (() => {
          const mk = todayISO().slice(0, 7);
          const entry = [...schedule].reverse().find((s) => s.monat <= mk);
          return entry ? entry.restschuld : Number(l.ursprungsbetrag) || 0;
        })();
        const chartData = schedule.slice(0, 240);
        return (
          <Card key={l.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 700, fontFamily: FONT_SERIF, fontSize: 15 }}>{l.name}</div>
                <div style={{ fontSize: 12, color: C.inkSoft }}>{l.glaeubiger} · {l.zinssatz}% p. a. · Rate {fmtEUR(Number(l.rateMonatlich) || 0)}/Monat</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <Label>Restschuld heute</Label>
                <div style={{ fontSize: 18, fontFamily: FONT_MONO }}>{fmtEUR(restschuldHeute)}</div>
              </div>
            </div>
            <div style={{ width: "100%", height: 200, margin: "12px 0" }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid stroke={C.line} vertical={false} />
                  <XAxis dataKey="monat" tick={{ fontSize: 10, fill: C.inkSoft }} interval={Math.max(0, Math.floor(chartData.length / 8))} />
                  <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} />
                  <Tooltip formatter={(v) => fmtEUR(v)} />
                  <Line type="monotone" dataKey="restschuld" stroke={C.amber} strokeWidth={2} dot={false} name="Restschuld" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
              <div><Label>Sondertilgung Datum</Label><Input type="date" value={sForm.datum} onChange={(e) => setSForm({ ...sForm, datum: e.target.value })} /></div>
              <div><Label>Betrag (€)</Label><Input type="number" step="0.01" value={sForm.betrag} onChange={(e) => setSForm({ ...sForm, betrag: e.target.value })} /></div>
              <Btn primary onClick={() => addSonder(l.id)}>Sondertilgung erfassen</Btn>
              <Btn onClick={() => setOffen(offen === l.id ? null : l.id)}>{offen === l.id ? "Tilgungsplan schließen" : "Tilgungsplan anzeigen"}</Btn>
              <span onClick={() => startEdit(l)} style={{ cursor: "pointer", fontSize: 12, color: C.amber }}>bearbeiten</span>
              <span onClick={() => remove(l.id)} style={{ cursor: "pointer", fontSize: 12, color: C.loss }}>löschen</span>
            </div>
            {data.sondertilgungen.filter((s) => s.darlehenId === l.id).length > 0 && (
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>
                Sondertilgungen: {data.sondertilgungen.filter((s) => s.darlehenId === l.id).sort((a, b) => a.datum.localeCompare(b.datum)).map((s) => `${s.datum}: ${fmtEUR(Number(s.betrag))}`).join(" · ")}
              </div>
            )}
            {offen === l.id && (
              <div style={{ maxHeight: 260, overflowY: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr><Th>Monat</Th><Th align="right">Zins</Th><Th align="right">Tilgung</Th><Th align="right">Sondertilgung</Th><Th align="right">Restschuld</Th></tr></thead>
                  <tbody>
                    {schedule.map((s) => (
                      <tr key={s.monat}>
                        <Td mono>{s.monat}</Td>
                        <Td align="right" mono>{fmtEUR(s.zins)}</Td>
                        <Td align="right" mono>{fmtEUR(s.tilgung)}</Td>
                        <Td align="right" mono>{s.sondertilgung ? fmtEUR(s.sondertilgung) : "–"}</Td>
                        <Td align="right" mono>{fmtEUR(s.restschuld)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      {data.darlehen.length === 0 && <Card><i>Noch keine Darlehen erfasst.</i></Card>}
    </div>
  );
}

// ---------- Cashflow ----------
function Cashflow({ data, bankById, bankSaldo }) {
  const [von, setVon] = useState(todayISO().slice(0, 4) + "-01-01");
  const [bis, setBis] = useState(todayISO());

  const relevante = data.buchungen.filter((b) => b.datum >= von && b.datum <= bis);
  const monthly = {};
  for (const b of relevante) {
    const mk = monthKey(b.datum);
    monthly[mk] = monthly[mk] || { monat: mk, Einzahlungen: 0, Auszahlungen: 0 };
    monthly[mk][b.art === "Einnahme" ? "Einzahlungen" : "Auszahlungen"] += Number(b.betrag);
  }
  const chartData = Object.values(monthly).sort((a, b) => a.monat.localeCompare(b.monat));
  chartData.forEach((m) => (m.Netto = m.Einzahlungen - m.Auszahlungen));

  const liquiditaet = chartData.map((m) => ({
    monat: m.monat,
    Bestand: data.bankkonten.reduce((s, b) => s + bankSaldo(b.id, m.monat + "-28"), 0),
  }));

  const sumEin = relevante.filter((b) => b.art === "Einnahme").reduce((s, b) => s + Number(b.betrag), 0);
  const sumAus = relevante.filter((b) => b.art === "Ausgabe").reduce((s, b) => s + Number(b.betrag), 0);

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>Cashflow</h2>
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div><Label>Von</Label><Input type="date" value={von} onChange={(e) => setVon(e.target.value)} /></div>
        <div><Label>Bis</Label><Input type="date" value={bis} onChange={(e) => setBis(e.target.value)} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
        <Card><Label>Einzahlungen</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.gain }}>{fmtEUR(sumEin)}</div></Card>
        <Card><Label>Auszahlungen</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.loss }}>{fmtEUR(sumAus)}</div></Card>
        <Card><Label>Netto-Cashflow</Label><div style={{ fontSize: 20, fontFamily: FONT_MONO }}><Money value={sumEin - sumAus} /></div></Card>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Label>Liquiditätsentwicklung (Bankbestand je Monatsende)</Label>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={liquiditaet}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line type="monotone" dataKey="Bestand" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <Label>Netto-Cashflow je Monat</Label>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line type="monotone" dataKey="Netto" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><Th>Monat</Th><Th align="right">Einzahlungen</Th><Th align="right">Auszahlungen</Th><Th align="right">Netto</Th></tr></thead>
          <tbody>
            {chartData.map((m) => (
              <tr key={m.monat}>
                <Td mono>{m.monat}</Td>
                <Td align="right" mono style={{ color: C.gain }}>{fmtEUR(m.Einzahlungen)}</Td>
                <Td align="right" mono style={{ color: C.loss }}>{fmtEUR(m.Auszahlungen)}</Td>
                <Td align="right" mono><Money value={m.Netto} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
