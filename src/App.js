import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from 'recharts';
import { createClient } from '@supabase/supabase-js';

// ---------- Farb- & Typo-Tokens (Ledger-Optik) ----------
const C = {
  paper: '#F2F0E9',
  paperRaised: '#FBFAF6',
  ink: '#26231C',
  inkSoft: '#5B5647',
  line: '#D9D4C4',
  lineStrong: '#B7B096',
  green: '#2F5233',
  greenSoft: '#DCE8DA',
  gain: '#3D7A4F',
  loss: '#B3502B',
  lossSoft: '#F4DCCF',
  gainSoft: '#DCEEE0',
  amber: '#A9782F',
};
const FONT_SERIF = "'IBM Plex Serif', Georgia, serif";
const FONT_SANS = "'Inter', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', 'Courier New', monospace";

const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtEUR = (n) =>
  (n < 0 ? '-' : '') +
  Math.abs(n)
    .toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
    .replace('-', '');
const monthKey = (d) => d.slice(0, 7);

// ---------- Seed-Daten ----------
const seed = {
  konten: [
    {
      id: uid(),
      name: 'Gehalt',
      typ: 'Ertrag',
      gruppe: 'Betriebliche Erträge',
    },
    {
      id: uid(),
      name: 'Sonstige Erträge',
      typ: 'Ertrag',
      gruppe: 'Sonstige Erträge',
    },
    {
      id: uid(),
      name: 'Wohnen',
      typ: 'Aufwand',
      gruppe: 'Fixkosten',
      kostenart: 'Fix',
    },
    {
      id: uid(),
      name: 'Versicherungen',
      typ: 'Aufwand',
      gruppe: 'Fixkosten',
      kostenart: 'Fix',
    },
    {
      id: uid(),
      name: 'Lebensmittel',
      typ: 'Aufwand',
      gruppe: 'Variable Kosten',
      kostenart: 'Variabel',
    },
    {
      id: uid(),
      name: 'Mobilität',
      typ: 'Aufwand',
      gruppe: 'Variable Kosten',
      kostenart: 'Variabel',
    },
    {
      id: uid(),
      name: 'Freizeit',
      typ: 'Aufwand',
      gruppe: 'Variable Kosten',
      kostenart: 'Variabel',
    },
    {
      id: uid(),
      name: 'Sonstiges',
      typ: 'Aufwand',
      gruppe: 'Sonstige Aufwendungen',
      kostenart: 'Variabel',
    },
  ],
  klassen: [
    { id: uid(), name: 'Privathaushalt', typ: 'Kostenstelle' },
    { id: uid(), name: 'Nebentätigkeit', typ: 'Kostenträger' },
  ],
  adressen: [],
  bankkonten: [{ id: uid(), name: 'Girokonto', startsaldo: 0 }],
  bilanzpositionen: [],
  vermoegenswerte: [],
  vermoegensBuchungen: [],
  darlehen: [],
  sondertilgungen: [],
  buchungen: [],
};

const STORAGE_KEY = 'haushaltsbuch-v1';

const supabase = createClient(
  'https://qatpgbwzjegzwnixfsai.supabase.co', // z. B. https://abcdefgh.supabase.co
  'sb_publishable_vRzu_oYDFZtp54g7NBLBTQ_GrC8_p0r'
);

async function loadData() {
  try {
    const { data, error } = await supabase
      .from('haushaltsbuch')
      .select('data')
      .eq('id', 'ragnar')
      .single();
    if (error) throw error;
    if (data && data.data && Object.keys(data.data).length > 0)
      return data.data;
  } catch (e) {
    console.error('Laden fehlgeschlagen', e);
  }
  return seed;
}

async function saveData(data) {
  try {
    await supabase
      .from('haushaltsbuch')
      .update({ data, updated_at: new Date().toISOString() })
      .eq('id', 'ragnar');
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
  }
}

// ---------- Kleine UI-Bausteine ----------
function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.paperRaised,
        border: `1px solid ${C.line}`,
        borderRadius: 6,
        padding: '16px 18px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function Label({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: C.inkSoft,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}
function Input(props) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        padding: '7px 9px',
        border: `1px solid ${C.lineStrong}`,
        borderRadius: 4,
        background: '#fff',
        fontFamily: FONT_SANS,
        fontSize: 13.5,
        color: C.ink,
        boxSizing: 'border-box',
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
        width: '100%',
        padding: '7px 9px',
        border: `1px solid ${C.lineStrong}`,
        borderRadius: 4,
        background: '#fff',
        fontFamily: FONT_SANS,
        fontSize: 13.5,
        color: C.ink,
        boxSizing: 'border-box',
        ...props.style,
      }}
    >
      {props.children}
    </select>
  );
}
function Btn({ children, onClick, primary, danger, style, type = 'button' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        padding: '7px 14px',
        borderRadius: 4,
        border: `1px solid ${
          danger ? C.loss : primary ? C.green : C.lineStrong
        }`,
        background: primary ? C.green : danger ? 'transparent' : '#fff',
        color: primary ? '#fff' : danger ? C.loss : C.ink,
        fontFamily: FONT_SANS,
        fontSize: 13,
        fontWeight: 500,
        cursor: 'pointer',
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
    <span
      style={{
        fontFamily: FONT_MONO,
        color: positive ? C.gain : C.loss,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {fmtEUR(value)}
    </span>
  );
}
function Th({ children, align }) {
  return (
    <th
      style={{
        textAlign: align || 'left',
        fontSize: 11,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: C.inkSoft,
        borderBottom: `2px solid ${C.line}`,
        padding: '6px 10px',
        whiteSpace: 'nowrap',
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
        textAlign: align || 'left',
        padding: '7px 10px',
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

const NAV = [
  { id: 'dashboard', label: 'Übersicht' },
  { id: 'buchungen', label: 'Buchungen' },
  { id: 'import', label: 'Import' },
  { id: 'adressen', label: 'Adressbuch' },
  { id: 'anlagen', label: 'Anlagenregister' },
  { id: 'darlehen', label: 'Darlehen' },
  { id: 'stamm', label: 'Konten & Klassen' },
  { id: 'guv', label: 'GuV' },
  { id: 'bilanz', label: 'Bilanz' },
  { id: 'cashflow', label: 'Cashflow' },
];

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

const [session, setSession] = useState(undefined);

useEffect(() => {
  supabase.auth.getSession().then(({ data }) => setSession(data.session));
  const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
  return () => listener.subscription.unsubscribe();
}, []);

if (session === undefined) return <div style={{ padding: 40 }}>Lade…</div>;
if (!session) return <LoginScreen />;

export default function App() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('dashboard');

  useEffect(() => {
    loadData().then(setData);
  }, []);
  useEffect(() => {
    if (data) saveData(data);
  }, [data]);

  const update = useCallback((fn) => setData((d) => fn({ ...d })), []);

  if (!data) {
    return (
      <div style={{ padding: 40, fontFamily: FONT_SANS, color: C.inkSoft }}>
        Lade Haushaltsbuch…
      </div>
    );
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
      if (b.bankkontoId !== bankId) continue;
      if (biszu && b.datum > biszu) continue;
      s += b.art === 'Einnahme' ? Number(b.betrag) : -Number(b.betrag);
    }
    return s;
  };

  const assetValue = (asset, atDate) => {
    if (asset.typ === 'Wertpapier') {
      return (Number(asset.anzahl) || 0) * (Number(asset.aktuellerKurs) || 0);
    }
    const historie = data.vermoegensBuchungen
      .filter(
        (v) => v.vermoegenswertId === asset.id && (!atDate || v.datum <= atDate)
      )
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
      schedule.push({
        monat: mk,
        zins: zinsanteil,
        tilgung: tilgungsanteil,
        sondertilgung,
        restschuld: rest,
      });
      datum.setMonth(datum.getMonth() + 1);
      i++;
    }
    return schedule;
  };

  const loanRestschuld = (loan, atDate) => {
    const schedule = loanSchedule(loan);
    if (!atDate)
      return schedule.length
        ? schedule[schedule.length - 1].restschuld
        : Number(loan.ursprungsbetrag) || 0;
    const mk = monthKey(atDate);
    const entry = [...schedule].reverse().find((s) => s.monat <= mk);
    return entry ? entry.restschuld : Number(loan.ursprungsbetrag) || 0;
  };

  const nettovermoegenAt = (atDate) => {
    const aktiva =
      data.bankkonten.reduce((s, b) => s + bankSaldo(b.id, atDate), 0) +
      data.vermoegenswerte.reduce((s, a) => s + assetValue(a, atDate), 0) +
      data.bilanzpositionen
        .filter((p) => p.typ === 'Aktiva')
        .reduce((s, p) => s + Number(p.wert), 0);
    const passiva =
      data.darlehen.reduce((s, l) => s + loanRestschuld(l, atDate), 0) +
      data.bilanzpositionen
        .filter((p) => p.typ === 'Passiva')
        .reduce((s, p) => s + Number(p.wert), 0);
    return aktiva - passiva;
  };

  return (
    <div
      style={{
        fontFamily: FONT_SANS,
        background: C.paper,
        color: C.ink,
        minHeight: 480,
        borderRadius: 8,
        overflow: 'hidden',
        border: `1px solid ${C.line}`,
      }}
    >
      <div style={{ display: 'flex', minHeight: 480 }}>
        <div
          style={{
            width: 190,
            background: C.green,
            color: '#fff',
            padding: '18px 0',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              fontFamily: FONT_SERIF,
              fontSize: 18,
              padding: '0 18px 16px',
              borderBottom: '1px solid rgba(255,255,255,0.2)',
              marginBottom: 8,
            }}
          >
            Haushaltsbuch
          </div>
          {NAV.map((n) => (
            <div
              key={n.id}
              onClick={() => setTab(n.id)}
              style={{
                padding: '9px 18px',
                cursor: 'pointer',
                fontSize: 13.5,
                fontWeight: tab === n.id ? 600 : 400,
                background:
                  tab === n.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                borderLeft:
                  tab === n.id ? '3px solid #fff' : '3px solid transparent',
              }}
            >
              {n.label}
            </div>
          ))}
        </div>
        <div style={{ flex: 1, padding: 22, overflowX: 'auto' }}>
          {tab === 'dashboard' && (
            <Dashboard
              data={data}
              bankSaldo={bankSaldo}
              bankById={bankById}
              nettovermoegenAt={nettovermoegenAt}
            />
          )}
          {tab === 'buchungen' && (
            <Buchungen
              data={data}
              update={update}
              kontoById={kontoById}
              adresseById={adresseById}
              klasseById={klasseById}
              bankById={bankById}
            />
          )}
          {tab === 'import' && <ImportCSV data={data} update={update} />}
          {tab === 'adressen' && <Adressen data={data} update={update} />}
          {tab === 'anlagen' && (
            <Anlagenregister
              data={data}
              update={update}
              assetValue={assetValue}
            />
          )}
          {tab === 'darlehen' && (
            <Darlehen data={data} update={update} loanSchedule={loanSchedule} />
          )}
          {tab === 'stamm' && <Stammdaten data={data} update={update} />}
          {tab === 'guv' && (
            <GuV data={data} kontoById={kontoById} klassen={data.klassen} />
          )}
          {tab === 'bilanz' && (
            <Bilanz
              data={data}
              bankSaldo={bankSaldo}
              assetValue={assetValue}
              loanRestschuld={loanRestschuld}
              nettovermoegenAt={nettovermoegenAt}
            />
          )}
          {tab === 'cashflow' && (
            <Cashflow data={data} bankById={bankById} bankSaldo={bankSaldo} />
          )}
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
    .filter((b) => b.art === 'Einnahme' && monthKey(b.datum) === thisMonth)
    .reduce((s, b) => s + Number(b.betrag), 0);
  const ausgabenMonat = data.buchungen
    .filter((b) => b.art === 'Ausgabe' && monthKey(b.datum) === thisMonth)
    .reduce((s, b) => s + Number(b.betrag), 0);

  const monthly = {};
  for (const b of data.buchungen) {
    const mk = monthKey(b.datum);
    if (!monthly[mk]) monthly[mk] = { monat: mk, Einnahmen: 0, Ausgaben: 0 };
    monthly[mk][b.art === 'Einnahme' ? 'Einnahmen' : 'Ausgaben'] += Number(
      b.betrag
    );
  }
  const chartData = Object.values(monthly)
    .sort((a, b) => a.monat.localeCompare(b.monat))
    .slice(-12);

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Übersicht
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Card>
          <Label>Gesamtsaldo Bankkonten</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>
            <Money value={gesamtSaldo} />
          </div>
        </Card>
        <Card>
          <Label>Einnahmen (Monat)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO, color: C.gain }}>
            {fmtEUR(einnahmenMonat)}
          </div>
        </Card>
        <Card>
          <Label>Ausgaben (Monat)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO, color: C.loss }}>
            {fmtEUR(ausgabenMonat)}
          </div>
        </Card>
        <Card>
          <Label>Buchungen gesamt</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>
            {data.buchungen.length}
          </div>
        </Card>
        <Card>
          <Label>Nettovermögen (heute)</Label>
          <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>
            <Money value={nettovermoegen} />
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <Label>Einnahmen / Ausgaben je Monat</Label>
        <div style={{ width: '100%', height: 260 }}>
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
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Konto</Th>
              <Th align="right">Saldo</Th>
            </tr>
          </thead>
          <tbody>
            {data.bankkonten.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td align="right" mono>
                  <Money value={bankSaldo(b.id)} />
                </Td>
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
    betrag: '',
    art: 'Ausgabe',
    kontoId: data.konten.find((k) => k.typ === 'Aufwand')?.id || '',
    adresseId: '',
    klasseId: '',
    bankkontoId: data.bankkonten[0]?.id || '',
    beschreibung: '',
  };
}

function Buchungen({
  data,
  update,
  kontoById,
  adresseById,
  klasseById,
  bankById,
}) {
  const [form, setForm] = useState(() => emptyBuchung(data));
  const [filterMonat, setFilterMonat] = useState('');
  const [editId, setEditId] = useState(null);

  const kontenFuerArt = data.konten.filter(
    (k) => k.typ === (form.art === 'Einnahme' ? 'Ertrag' : 'Aufwand')
  );

  const submit = (e) => {
    e.preventDefault();
    if (!form.betrag || !form.kontoId || !form.bankkontoId) return;
    update((d) => {
      const rec = { ...form, betrag: Math.abs(Number(form.betrag)) };
      if (editId) {
        d.buchungen = d.buchungen.map((b) => (b.id === editId ? rec : b));
      } else {
        d.buchungen = [rec, ...d.buchungen];
      }
      return d;
    });
    setForm(emptyBuchung(data));
    setEditId(null);
  };

  const remove = (id) =>
    update((d) => ({
      ...d,
      buchungen: d.buchungen.filter((b) => b.id !== id),
    }));
  const startEdit = (b) => {
    setForm(b);
    setEditId(b.id);
  };

  const list = data.buchungen
    .filter((b) => !filterMonat || monthKey(b.datum) === filterMonat)
    .sort((a, b) => b.datum.localeCompare(a.datum));

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Buchungen
      </h2>

      <Card style={{ marginBottom: 18 }}>
        <form onSubmit={submit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <Label>Datum</Label>
              <Input
                type="date"
                value={form.datum}
                onChange={(e) => setForm({ ...form, datum: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Art</Label>
              <Select
                value={form.art}
                onChange={(e) => {
                  const art = e.target.value;
                  const passendesKonto = data.konten.find(
                    (k) => k.typ === (art === 'Einnahme' ? 'Ertrag' : 'Aufwand')
                  );
                  setForm({ ...form, art, kontoId: passendesKonto?.id || '' });
                }}
              >
                <option value="Ausgabe">Ausgabe</option>
                <option value="Einnahme">Einnahme</option>
              </Select>
            </div>
            <div>
              <Label>Betrag (€)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.betrag}
                onChange={(e) => setForm({ ...form, betrag: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Bankkonto</Label>
              <Select
                value={form.bankkontoId}
                onChange={(e) =>
                  setForm({ ...form, bankkontoId: e.target.value })
                }
                required
              >
                {data.bankkonten.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <Label>Kategorie (Konto)</Label>
              <Select
                value={form.kontoId}
                onChange={(e) => setForm({ ...form, kontoId: e.target.value })}
                required
              >
                <option value="">– wählen –</option>
                {kontenFuerArt.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Adresse (Empfänger/Sender)</Label>
              <Select
                value={form.adresseId}
                onChange={(e) =>
                  setForm({ ...form, adresseId: e.target.value })
                }
              >
                <option value="">– keine –</option>
                {data.adressen.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Klasse (Kostenstelle/-träger)</Label>
              <Select
                value={form.klasseId}
                onChange={(e) => setForm({ ...form, klasseId: e.target.value })}
              >
                <option value="">– keine –</option>
                {data.klassen.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.typ})
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <Label>Beschreibung</Label>
            <Input
              value={form.beschreibung}
              onChange={(e) =>
                setForm({ ...form, beschreibung: e.target.value })
              }
              placeholder="z. B. Miete August"
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn type="submit" primary>
              {editId ? 'Buchung speichern' : 'Buchung erfassen'}
            </Btn>
            {editId && (
              <Btn
                onClick={() => {
                  setForm(emptyBuchung(data));
                  setEditId(null);
                }}
              >
                Abbrechen
              </Btn>
            )}
          </div>
        </form>
      </Card>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 8,
        }}
      >
        <Label>Monat filtern</Label>
        <Input
          type="month"
          value={filterMonat}
          onChange={(e) => setFilterMonat(e.target.value)}
          style={{ width: 160 }}
        />
        {filterMonat && (
          <Btn onClick={() => setFilterMonat('')}>Zurücksetzen</Btn>
        )}
      </div>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Datum</Th>
              <Th>Konto</Th>
              <Th>Adresse</Th>
              <Th>Klasse</Th>
              <Th>Bank</Th>
              <Th>Beschreibung</Th>
              <Th align="right">Betrag</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <Td mono>{b.datum}</Td>
                <Td>{kontoById[b.kontoId]?.name || '–'}</Td>
                <Td>{adresseById[b.adresseId]?.name || '–'}</Td>
                <Td>{klasseById[b.klasseId]?.name || '–'}</Td>
                <Td>{bankById[b.bankkontoId]?.name || '–'}</Td>
                <Td>{b.beschreibung}</Td>
                <Td align="right" mono>
                  <Money
                    value={
                      b.art === 'Einnahme'
                        ? Number(b.betrag)
                        : -Number(b.betrag)
                    }
                  />
                </Td>
                <Td align="right">
                  <span
                    onClick={() => startEdit(b)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => remove(b.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
                </Td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <Td colSpan={8}>
                  <i>Keine Buchungen vorhanden.</i>
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- CSV Import (Ersatz für Live-Onlinebanking-Abfrage) ----------
function ImportCSV({ data, update }) {
  const [rows, setRows] = useState([]);
  const [bankkontoId, setBankkontoId] = useState(data.bankkonten[0]?.id || '');
  const [mapping, setMapping] = useState({
    datum: '',
    betrag: '',
    beschreibung: '',
  });
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
        const guess = (names) =>
          (res.meta.fields || []).find((f) =>
            names.some((n) => f.toLowerCase().includes(n))
          );
        setMapping({
          datum: guess(['datum', 'date', 'buchungstag']) || '',
          betrag: guess(['betrag', 'amount', 'umsatz']) || '',
          beschreibung:
            guess([
              'verwendungszweck',
              'beschreibung',
              'text',
              'buchungstext',
            ]) || '',
        });
      },
    });
  };

  const doImport = () => {
    if (!mapping.datum || !mapping.betrag) return;
    const kontoAufwand = data.konten.find((k) => k.typ === 'Aufwand');
    const kontoErtrag = data.konten.find((k) => k.typ === 'Ertrag');
    const neue = rows
      .map((r) => {
        const rawBetrag = String(r[mapping.betrag] || '0')
          .replace(/\./g, '')
          .replace(',', '.');
        const betrag = parseFloat(rawBetrag);
        if (isNaN(betrag) || betrag === 0) return null;
        let datum = r[mapping.datum] || todayISO();
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(datum)) {
          const [t, m, j] = datum.split('.');
          datum = `${j}-${m}-${t}`;
        }
        return {
          id: uid(),
          datum,
          betrag: Math.abs(betrag),
          art: betrag >= 0 ? 'Einnahme' : 'Ausgabe',
          kontoId: (betrag >= 0 ? kontoErtrag : kontoAufwand)?.id || '',
          adresseId: '',
          klasseId: '',
          bankkontoId,
          beschreibung: r[mapping.beschreibung] || '',
        };
      })
      .filter(Boolean);
    update((d) => ({ ...d, buchungen: [...neue, ...d.buchungen] }));
    setRows([]);
    setColumns([]);
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Import (CSV-Kontoauszug)
      </h2>
      <Card
        style={{
          marginBottom: 16,
          background: C.gainSoft,
          borderColor: C.gain,
        }}
      >
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Eine direkte Live-Verbindung zu deinem Onlinebanking ist hier aus
          Sicherheitsgründen nicht möglich (dafür wäre eine FinTS/PSD2-Anbindung
          mit deinen Bankzugangsdaten nötig). Praktikabler Ersatz: Lade den CSV-
          oder CAMT-Export deiner Bank herunter und importiere ihn hier.
        </div>
      </Card>
      <Card>
        <div style={{ marginBottom: 12 }}>
          <Label>Ziel-Bankkonto</Label>
          <Select
            value={bankkontoId}
            onChange={(e) => setBankkontoId(e.target.value)}
            style={{ maxWidth: 260 }}
          >
            {data.bankkonten.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Label>CSV-Datei wählen</Label>
          <input type="file" accept=".csv" onChange={handleFile} />
        </div>

        {columns.length > 0 && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div>
                <Label>Spalte: Datum</Label>
                <Select
                  value={mapping.datum}
                  onChange={(e) =>
                    setMapping({ ...mapping, datum: e.target.value })
                  }
                >
                  <option value="">– wählen –</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Spalte: Betrag</Label>
                <Select
                  value={mapping.betrag}
                  onChange={(e) =>
                    setMapping({ ...mapping, betrag: e.target.value })
                  }
                >
                  <option value="">– wählen –</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Spalte: Beschreibung</Label>
                <Select
                  value={mapping.beschreibung}
                  onChange={(e) =>
                    setMapping({ ...mapping, beschreibung: e.target.value })
                  }
                >
                  <option value="">– keine –</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 10 }}>
              {rows.length} Zeilen erkannt. Positive Beträge werden als
              Einnahme, negative als Ausgabe importiert (Kategorie kann danach
              unter „Buchungen“ angepasst werden).
            </div>
            <Btn primary onClick={doImport}>
              {rows.length} Buchungen importieren
            </Btn>
          </>
        )}
      </Card>
    </div>
  );
}

// ---------- Adressbuch ----------
function Adressen({ data, update }) {
  const [form, setForm] = useState({
    id: null,
    name: '',
    rolle: 'Beide',
    iban: '',
    notiz: '',
  });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    update((d) => {
      if (form.id) {
        d.adressen = d.adressen.map((a) =>
          a.id === form.id ? { ...form } : a
        );
      } else {
        d.adressen = [{ ...form, id: uid() }, ...d.adressen];
      }
      return d;
    });
    setForm({ id: null, name: '', rolle: 'Beide', iban: '', notiz: '' });
  };
  const remove = (id) =>
    update((d) => ({ ...d, adressen: d.adressen.filter((a) => a.id !== id) }));

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Adressbuch
      </h2>
      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Rolle</Label>
              <Select
                value={form.rolle}
                onChange={(e) => setForm({ ...form, rolle: e.target.value })}
              >
                <option>Empfänger</option>
                <option>Sender</option>
                <option>Beide</option>
              </Select>
            </div>
            <div>
              <Label>IBAN (optional)</Label>
              <Input
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
              />
            </div>
            <div>
              <Label>Notiz</Label>
              <Input
                value={form.notiz}
                onChange={(e) => setForm({ ...form, notiz: e.target.value })}
              />
            </div>
          </div>
          <Btn primary type="submit">
            {form.id ? 'Speichern' : 'Adresse anlegen'}
          </Btn>
          {form.id && (
            <Btn
              onClick={() =>
                setForm({
                  id: null,
                  name: '',
                  rolle: 'Beide',
                  iban: '',
                  notiz: '',
                })
              }
              style={{ marginLeft: 8 }}
            >
              Abbrechen
            </Btn>
          )}
        </form>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Rolle</Th>
              <Th>IBAN</Th>
              <Th>Notiz</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.adressen.map((a) => (
              <tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>{a.rolle}</Td>
                <Td mono>{a.iban}</Td>
                <Td>{a.notiz}</Td>
                <Td align="right">
                  <span
                    onClick={() => setForm(a)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => remove(a.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
                </Td>
              </tr>
            ))}
            {data.adressen.length === 0 && (
              <tr>
                <Td colSpan={5}>
                  <i>Noch keine Adressen erfasst.</i>
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Stammdaten: Konten, Klassen, Bankkonten, Bilanzpositionen ----------
function Stammdaten({ data, update }) {
  const [kForm, setKForm] = useState({
    id: null,
    name: '',
    typ: 'Aufwand',
    gruppe: '',
    kostenart: 'Variabel',
  });
  const [klForm, setKlForm] = useState({
    id: null,
    name: '',
    typ: 'Kostenstelle',
  });
  const [bForm, setBForm] = useState({ id: null, name: '', startsaldo: '' });
  const [pForm, setPForm] = useState({
    id: null,
    name: '',
    typ: 'Aktiva',
    wert: '',
  });

  const saveList = (listName, form, setForm, empty) => (e) => {
    e.preventDefault();
    if (!form.name) return;
    update((d) => {
      if (form.id)
        d[listName] = d[listName].map((x) =>
          x.id === form.id ? { ...form } : x
        );
      else d[listName] = [{ ...form, id: uid() }, ...d[listName]];
      return d;
    });
    setForm(empty);
  };
  const removeFrom = (listName, id) =>
    update((d) => ({
      ...d,
      [listName]: d[listName].filter((x) => x.id !== id),
    }));

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Konten & Klassen
      </h2>

      <Card style={{ marginBottom: 16 }}>
        <Label>Konten (GuV-Kategorien: Erträge / Aufwendungen)</Label>
        <form
          onSubmit={saveList('konten', kForm, setKForm, {
            id: null,
            name: '',
            typ: 'Aufwand',
            gruppe: '',
            kostenart: 'Variabel',
          })}
          style={{ margin: '10px 0' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Name"
              value={kForm.name}
              onChange={(e) => setKForm({ ...kForm, name: e.target.value })}
              required
            />
            <Select
              value={kForm.typ}
              onChange={(e) => setKForm({ ...kForm, typ: e.target.value })}
            >
              <option value="Aufwand">Aufwand</option>
              <option value="Ertrag">Ertrag</option>
            </Select>
            <Input
              placeholder="Gruppe (z. B. Fixkosten)"
              value={kForm.gruppe}
              onChange={(e) => setKForm({ ...kForm, gruppe: e.target.value })}
            />
            {kForm.typ === 'Aufwand' && (
              <Select
                value={kForm.kostenart}
                onChange={(e) =>
                  setKForm({ ...kForm, kostenart: e.target.value })
                }
              >
                <option value="Fix">Fixkosten</option>
                <option value="Variabel">Variable Kosten</option>
              </Select>
            )}
            <Btn primary type="submit">
              {kForm.id ? 'Speichern' : 'Hinzufügen'}
            </Btn>
          </div>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Typ</Th>
              <Th>Gruppe</Th>
              <Th>Kostenart</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.konten.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}</Td>
                <Td>{k.typ}</Td>
                <Td>{k.gruppe}</Td>
                <Td>{k.typ === 'Aufwand' ? k.kostenart || 'Variabel' : '–'}</Td>
                <Td align="right">
                  <span
                    onClick={() => setKForm(k)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => removeFrom('konten', k.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Klassen (Kostenstellen / Kostenträger)</Label>
        <form
          onSubmit={saveList('klassen', klForm, setKlForm, {
            id: null,
            name: '',
            typ: 'Kostenstelle',
          })}
          style={{ margin: '10px 0' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Name"
              value={klForm.name}
              onChange={(e) => setKlForm({ ...klForm, name: e.target.value })}
              required
            />
            <Select
              value={klForm.typ}
              onChange={(e) => setKlForm({ ...klForm, typ: e.target.value })}
            >
              <option value="Kostenstelle">Kostenstelle</option>
              <option value="Kostenträger">Kostenträger</option>
            </Select>
            <Btn primary type="submit">
              {klForm.id ? 'Speichern' : 'Hinzufügen'}
            </Btn>
          </div>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Typ</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.klassen.map((k) => (
              <tr key={k.id}>
                <Td>{k.name}</Td>
                <Td>{k.typ}</Td>
                <Td align="right">
                  <span
                    onClick={() => setKlForm(k)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => removeFrom('klassen', k.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <Label>Bankkonten</Label>
        <form
          onSubmit={saveList('bankkonten', bForm, setBForm, {
            id: null,
            name: '',
            startsaldo: '',
          })}
          style={{ margin: '10px 0' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Name"
              value={bForm.name}
              onChange={(e) => setBForm({ ...bForm, name: e.target.value })}
              required
            />
            <Input
              type="number"
              step="0.01"
              placeholder="Startsaldo (€)"
              value={bForm.startsaldo}
              onChange={(e) =>
                setBForm({ ...bForm, startsaldo: e.target.value })
              }
            />
            <Btn primary type="submit">
              {bForm.id ? 'Speichern' : 'Hinzufügen'}
            </Btn>
          </div>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th align="right">Startsaldo</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.bankkonten.map((b) => (
              <tr key={b.id}>
                <Td>{b.name}</Td>
                <Td align="right" mono>
                  {fmtEUR(Number(b.startsaldo) || 0)}
                </Td>
                <Td align="right">
                  <span
                    onClick={() => setBForm(b)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => removeFrom('bankkonten', b.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <Label>
          Sonstige Bilanzpositionen (z. B. Darlehen, Sachwerte – manuell
          gepflegt)
        </Label>
        <form
          onSubmit={saveList('bilanzpositionen', pForm, setPForm, {
            id: null,
            name: '',
            typ: 'Aktiva',
            wert: '',
          })}
          style={{ margin: '10px 0' }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Name"
              value={pForm.name}
              onChange={(e) => setPForm({ ...pForm, name: e.target.value })}
              required
            />
            <Select
              value={pForm.typ}
              onChange={(e) => setPForm({ ...pForm, typ: e.target.value })}
            >
              <option value="Aktiva">Aktiva</option>
              <option value="Passiva">Passiva</option>
            </Select>
            <Input
              type="number"
              step="0.01"
              placeholder="Wert (€)"
              value={pForm.wert}
              onChange={(e) => setPForm({ ...pForm, wert: e.target.value })}
            />
            <Btn primary type="submit">
              {pForm.id ? 'Speichern' : 'Hinzufügen'}
            </Btn>
          </div>
        </form>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Typ</Th>
              <Th align="right">Wert</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.bilanzpositionen.map((p) => (
              <tr key={p.id}>
                <Td>{p.name}</Td>
                <Td>{p.typ}</Td>
                <Td align="right" mono>
                  {fmtEUR(Number(p.wert) || 0)}
                </Td>
                <Td align="right">
                  <span
                    onClick={() => setPForm(p)}
                    style={{
                      cursor: 'pointer',
                      fontSize: 12,
                      color: C.amber,
                      marginRight: 10,
                    }}
                  >
                    bearbeiten
                  </span>
                  <span
                    onClick={() => removeFrom('bilanzpositionen', p.id)}
                    style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                  >
                    löschen
                  </span>
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
  const [von, setVon] = useState(todayISO().slice(0, 4) + '-01-01');
  const [bis, setBis] = useState(todayISO());
  const [klasseFilter, setKlasseFilter] = useState('');

  const relevante = data.buchungen.filter(
    (b) =>
      b.datum >= von &&
      b.datum <= bis &&
      (!klasseFilter || b.klasseId === klasseFilter)
  );

  const gruppiere = (typ) => {
    const map = {};
    for (const b of relevante) {
      const k = kontoById[b.kontoId];
      if (!k || k.typ !== typ) continue;
      const gruppe = k.gruppe || 'Ohne Gruppe';
      map[gruppe] = map[gruppe] || {};
      map[gruppe][k.name] = (map[gruppe][k.name] || 0) + Number(b.betrag);
    }
    return map;
  };
  const ertraege = gruppiere('Ertrag');
  const aufwendungen = gruppiere('Aufwand');
  const sumErtraege = Object.values(ertraege).reduce(
    (s, g) => s + Object.values(g).reduce((a, b) => a + b, 0),
    0
  );
  const sumAufwendungen = Object.values(aufwendungen).reduce(
    (s, g) => s + Object.values(g).reduce((a, b) => a + b, 0),
    0
  );
  const ergebnis = sumErtraege - sumAufwendungen;
  const ergebnisquote = sumErtraege > 0 ? (ergebnis / sumErtraege) * 100 : 0;

  const fixVarMonatlich = (() => {
    const map = {};
    for (const b of relevante) {
      const k = kontoById[b.kontoId];
      if (!k || k.typ !== 'Aufwand') continue;
      const mk = monthKey(b.datum);
      map[mk] = map[mk] || { monat: mk, Fix: 0, Variabel: 0 };
      map[mk][k.kostenart === 'Fix' ? 'Fix' : 'Variabel'] += Number(b.betrag);
    }
    return Object.values(map).sort((a, b) => a.monat.localeCompare(b.monat));
  })();
  const sumFix = fixVarMonatlich.reduce((s, m) => s + m.Fix, 0);
  const fixquote = sumAufwendungen > 0 ? (sumFix / sumAufwendungen) * 100 : 0;

  const ertragsVerlauf = (() => {
    const perMonat = {};
    const totalProKonto = {};
    for (const b of relevante) {
      const k = kontoById[b.kontoId];
      if (!k || k.typ !== 'Ertrag') continue;
      const mk = monthKey(b.datum);
      perMonat[mk] = perMonat[mk] || {};
      perMonat[mk][k.name] = (perMonat[mk][k.name] || 0) + Number(b.betrag);
      totalProKonto[k.name] = (totalProKonto[k.name] || 0) + Number(b.betrag);
    }
    const topKonten = Object.entries(totalProKonto)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n]) => n);
    const rows = Object.keys(perMonat)
      .sort()
      .map((mk) => {
        const row = { monat: mk };
        topKonten.forEach((n) => (row[n] = perMonat[mk][n] || 0));
        return row;
      });
    return { rows, keys: topKonten };
  })();
  const linienFarben = [C.green, C.amber, C.loss, '#4A6FA5', '#8B6EA0'];

  const renderGruppe = (gruppen, farbe) =>
    Object.entries(gruppen).map(([gruppe, konten]) => (
      <React.Fragment key={gruppe}>
        <tr>
          <Td style={{ fontWeight: 600, background: C.paper }} colSpan={2}>
            {gruppe}
          </Td>
        </tr>
        {Object.entries(konten).map(([name, wert]) => (
          <tr key={name}>
            <Td style={{ paddingLeft: 24 }}>{name}</Td>
            <Td align="right" mono style={{ color: farbe }}>
              {fmtEUR(wert)}
            </Td>
          </tr>
        ))}
      </React.Fragment>
    ));

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Gewinn- und Verlustrechnung
      </h2>
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div>
          <Label>Von</Label>
          <Input
            type="date"
            value={von}
            onChange={(e) => setVon(e.target.value)}
          />
        </div>
        <div>
          <Label>Bis</Label>
          <Input
            type="date"
            value={bis}
            onChange={(e) => setBis(e.target.value)}
          />
        </div>
        <div>
          <Label>Klasse</Label>
          <Select
            value={klasseFilter}
            onChange={(e) => setKlasseFilter(e.target.value)}
            style={{ width: 200 }}
          >
            <option value="">Alle</option>
            {klassen.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card>
          <Label>Ergebnis</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO }}>
            <Money value={ergebnis} />
          </div>
        </Card>
        <Card>
          <Label>Ergebnisquote</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO }}>
            {ergebnisquote.toFixed(1)} %
          </div>
        </Card>
        <Card>
          <Label>Fixkostenquote</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO }}>
            {fixquote.toFixed(1)} %
          </div>
        </Card>
        <Card>
          <Label>Aufwand gesamt</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.loss }}>
            {fmtEUR(sumAufwendungen)}
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Label>Kostenstruktur je Monat (Fix / Variabel)</Label>
        <div style={{ width: '100%', height: 220 }}>
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
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={ertragsVerlauf.rows}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {ertragsVerlauf.keys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stroke={linienFarben[i % linienFarben.length]}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Position</Th>
              <Th align="right">Betrag</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td
                style={{ fontWeight: 700, fontFamily: FONT_SERIF }}
                colSpan={2}
              >
                Erträge
              </Td>
            </tr>
            {renderGruppe(ertraege, C.gain)}
            <tr>
              <Td style={{ fontWeight: 600 }}>Summe Erträge</Td>
              <Td align="right" mono style={{ fontWeight: 600, color: C.gain }}>
                {fmtEUR(sumErtraege)}
              </Td>
            </tr>
            <tr>
              <Td
                colSpan={2}
                style={{ borderBottom: `2px solid ${C.line}`, padding: 4 }}
              ></Td>
            </tr>
            <tr>
              <Td
                style={{ fontWeight: 700, fontFamily: FONT_SERIF }}
                colSpan={2}
              >
                Aufwendungen
              </Td>
            </tr>
            {renderGruppe(aufwendungen, C.loss)}
            <tr>
              <Td style={{ fontWeight: 600 }}>Summe Aufwendungen</Td>
              <Td align="right" mono style={{ fontWeight: 600, color: C.loss }}>
                {fmtEUR(sumAufwendungen)}
              </Td>
            </tr>
            <tr>
              <Td
                colSpan={2}
                style={{
                  borderBottom: `2px solid ${C.lineStrong}`,
                  padding: 4,
                }}
              ></Td>
            </tr>
            <tr>
              <Td
                style={{
                  fontWeight: 700,
                  fontFamily: FONT_SERIF,
                  fontSize: 15,
                }}
              >
                Jahresüberschuss / -fehlbetrag
              </Td>
              <Td align="right" mono style={{ fontWeight: 700, fontSize: 15 }}>
                <Money value={ergebnis} />
              </Td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Bilanz ----------
function Bilanz({
  data,
  bankSaldo,
  assetValue,
  loanRestschuld,
  nettovermoegenAt,
}) {
  const [stichtag, setStichtag] = useState(todayISO());

  const aktivaBank = data.bankkonten.map((b) => ({
    name: b.name,
    wert: bankSaldo(b.id, stichtag),
  }));
  const aktivaAnlagen = data.vermoegenswerte.map((a) => ({
    name: a.name,
    typ: a.typ,
    wert: assetValue(a, stichtag),
  }));
  const aktivaSonstige = data.bilanzpositionen.filter(
    (p) => p.typ === 'Aktiva'
  );
  const passivaDarlehen = data.darlehen.map((l) => ({
    name: l.name,
    wert: loanRestschuld(l, stichtag),
  }));
  const passivaSonstige = data.bilanzpositionen.filter(
    (p) => p.typ === 'Passiva'
  );

  const sumAktivaBank = aktivaBank.reduce((s, a) => s + a.wert, 0);
  const sumAktivaAnlagen = aktivaAnlagen.reduce((s, a) => s + a.wert, 0);
  const sumAktivaSonstige = aktivaSonstige.reduce(
    (s, a) => s + Number(a.wert),
    0
  );
  const sumAktiva = sumAktivaBank + sumAktivaAnlagen + sumAktivaSonstige;
  const sumPassivaDarlehen = passivaDarlehen.reduce((s, a) => s + a.wert, 0);
  const sumPassivaSonstige = passivaSonstige.reduce(
    (s, a) => s + Number(a.wert),
    0
  );
  const eigenkapital = sumAktiva - sumPassivaDarlehen - sumPassivaSonstige;

  const vermoegensverlauf = (() => {
    const monate = [];
    const start = new Date(stichtag);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(start);
      d.setMonth(d.getMonth() - i);
      monate.push(d.toISOString().slice(0, 7));
    }
    return monate.map((mk) => ({
      monat: mk,
      Nettovermögen: nettovermoegenAt(mk + '-28'),
    }));
  })();

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Bilanz
      </h2>
      <div style={{ marginBottom: 14 }}>
        <Label>Stichtag</Label>
        <Input
          type="date"
          value={stichtag}
          onChange={(e) => setStichtag(e.target.value)}
          style={{ width: 180 }}
        />
      </div>

      <Card style={{ marginBottom: 16 }}>
        <Label>Vermögensentwicklung (Nettovermögen, letzte 12 Monate)</Label>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={vermoegensverlauf}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line
                type="monotone"
                dataKey="Nettovermögen"
                stroke={C.green}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <div
            style={{ fontWeight: 700, fontFamily: FONT_SERIF, marginBottom: 8 }}
          >
            Aktiva
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <tr>
                <Td
                  style={{ fontWeight: 600, background: C.paper }}
                  colSpan={2}
                >
                  Bankguthaben
                </Td>
              </tr>
              {aktivaBank.map((a) => (
                <tr key={a.name}>
                  <Td style={{ paddingLeft: 20 }}>{a.name}</Td>
                  <Td align="right" mono>
                    {fmtEUR(a.wert)}
                  </Td>
                </tr>
              ))}
              {aktivaAnlagen.length > 0 && (
                <tr>
                  <Td
                    style={{ fontWeight: 600, background: C.paper }}
                    colSpan={2}
                  >
                    Anlagevermögen
                  </Td>
                </tr>
              )}
              {aktivaAnlagen.map((a, i) => (
                <tr key={i}>
                  <Td style={{ paddingLeft: 20 }}>
                    {a.name} ({a.typ})
                  </Td>
                  <Td align="right" mono>
                    {fmtEUR(a.wert)}
                  </Td>
                </tr>
              ))}
              {aktivaSonstige.length > 0 && (
                <tr>
                  <Td
                    style={{ fontWeight: 600, background: C.paper }}
                    colSpan={2}
                  >
                    Sonstige Aktiva
                  </Td>
                </tr>
              )}
              {aktivaSonstige.map((a) => (
                <tr key={a.id}>
                  <Td style={{ paddingLeft: 20 }}>{a.name}</Td>
                  <Td align="right" mono>
                    {fmtEUR(Number(a.wert))}
                  </Td>
                </tr>
              ))}
              <tr>
                <Td style={{ fontWeight: 700 }}>Summe Aktiva</Td>
                <Td align="right" mono style={{ fontWeight: 700 }}>
                  {fmtEUR(sumAktiva)}
                </Td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card>
          <div
            style={{ fontWeight: 700, fontFamily: FONT_SERIF, marginBottom: 8 }}
          >
            Passiva
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {passivaDarlehen.length > 0 && (
                <tr>
                  <Td
                    style={{ fontWeight: 600, background: C.paper }}
                    colSpan={2}
                  >
                    Darlehen
                  </Td>
                </tr>
              )}
              {passivaDarlehen.map((a, i) => (
                <tr key={i}>
                  <Td style={{ paddingLeft: 20 }}>{a.name}</Td>
                  <Td align="right" mono>
                    {fmtEUR(a.wert)}
                  </Td>
                </tr>
              ))}
              {passivaSonstige.length > 0 && (
                <tr>
                  <Td
                    style={{ fontWeight: 600, background: C.paper }}
                    colSpan={2}
                  >
                    Sonstige Verbindlichkeiten
                  </Td>
                </tr>
              )}
              {passivaSonstige.map((a) => (
                <tr key={a.id}>
                  <Td style={{ paddingLeft: 20 }}>{a.name}</Td>
                  <Td align="right" mono>
                    {fmtEUR(Number(a.wert))}
                  </Td>
                </tr>
              ))}
              <tr>
                <Td
                  style={{ fontWeight: 600, background: C.paper }}
                  colSpan={2}
                >
                  Eigenkapital
                </Td>
              </tr>
              <tr>
                <Td style={{ paddingLeft: 20 }}>Eigenkapital (rechnerisch)</Td>
                <Td align="right" mono>
                  {fmtEUR(eigenkapital)}
                </Td>
              </tr>
              <tr>
                <Td style={{ fontWeight: 700 }}>Summe Passiva</Td>
                <Td align="right" mono style={{ fontWeight: 700 }}>
                  {fmtEUR(
                    sumPassivaDarlehen + sumPassivaSonstige + eigenkapital
                  )}
                </Td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>
      <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 10 }}>
        Hinweis: Das Eigenkapital wird rechnerisch als Restgröße (Aktiva −
        Verbindlichkeiten) ermittelt, damit die Bilanz automatisch ausgeglichen
        ist. Darlehens-Restschulden werden aus dem hinterlegten Tilgungsplan zum
        Stichtag berechnet.
      </div>
    </div>
  );
}

// ---------- Anlagenregister ----------
function emptyAsset() {
  return {
    id: uid(),
    name: '',
    typ: 'Wertpapier',
    kaufwert: '',
    kaufdatum: todayISO(),
    isin: '',
    anzahl: '',
    aktuellerKurs: '',
    kursDatum: todayISO(),
    notiz: '',
  };
}

function Anlagenregister({ data, update, assetValue }) {
  const [form, setForm] = useState(emptyAsset());
  const [editId, setEditId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [wertForm, setWertForm] = useState({ datum: todayISO(), wert: '' });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name) return;
    update((d) => {
      if (editId)
        d.vermoegenswerte = d.vermoegenswerte.map((a) =>
          a.id === editId ? { ...form } : a
        );
      else d.vermoegenswerte = [{ ...form, id: uid() }, ...d.vermoegenswerte];
      return d;
    });
    setForm(emptyAsset());
    setEditId(null);
  };
  const remove = (id) =>
    update((d) => ({
      ...d,
      vermoegenswerte: d.vermoegenswerte.filter((a) => a.id !== id),
      vermoegensBuchungen: d.vermoegensBuchungen.filter(
        (v) => v.vermoegenswertId !== id
      ),
    }));
  const startEdit = (a) => {
    setForm(a);
    setEditId(a.id);
  };

  const addWert = (assetId) => {
    if (!wertForm.wert) return;
    update((d) => ({
      ...d,
      vermoegensBuchungen: [
        {
          id: uid(),
          vermoegenswertId: assetId,
          datum: wertForm.datum,
          wert: wertForm.wert,
        },
        ...d.vermoegensBuchungen,
      ],
    }));
    setWertForm({ datum: todayISO(), wert: '' });
  };

  const updateKurs = (assetId, kurs) => {
    if (kurs === '' || kurs === undefined) return;
    update((d) => ({
      ...d,
      vermoegenswerte: d.vermoegenswerte.map((a) =>
        a.id === assetId
          ? { ...a, aktuellerKurs: kurs, kursDatum: todayISO() }
          : a
      ),
    }));
  };

  const gesamtwert = data.vermoegenswerte.reduce(
    (s, a) => s + assetValue(a),
    0
  );

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Anlagenregister
      </h2>
      <Card
        style={{
          marginBottom: 16,
          background: C.gainSoft,
          borderColor: C.gain,
        }}
      >
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Ein automatischer Kursabruf für Wertpapiere ist in dieser
          Browser-Sandbox nicht zuverlässig möglich, da Verbindungen zu externen
          Kurs-APIs hier blockiert sind. Kurse deshalb unten manuell pflegen. In
          einer eigenständig gehosteten Version ließe sich ein echter Kursabruf
          über eine Marktdaten-API ergänzen.
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <Label>Gesamtwert Anlagenregister</Label>
        <div style={{ fontSize: 22, fontFamily: FONT_MONO }}>
          {fmtEUR(gesamtwert)}
        </div>
      </Card>

      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Select
              value={form.typ}
              onChange={(e) => setForm({ ...form, typ: e.target.value })}
            >
              <option value="Wertpapier">Wertpapier</option>
              <option value="Immobilie">Immobilie</option>
              <option value="Vertrag">Vertrag</option>
              <option value="Sonstiges">Sonstiges</option>
            </Select>
            <div>
              <Label>Kaufdatum</Label>
              <Input
                type="date"
                value={form.kaufdatum}
                onChange={(e) =>
                  setForm({ ...form, kaufdatum: e.target.value })
                }
              />
            </div>
            <div>
              <Label>Kaufwert (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.kaufwert}
                onChange={(e) => setForm({ ...form, kaufwert: e.target.value })}
              />
            </div>
          </div>
          {form.typ === 'Wertpapier' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div>
                <Label>ISIN / WKN</Label>
                <Input
                  value={form.isin}
                  onChange={(e) => setForm({ ...form, isin: e.target.value })}
                />
              </div>
              <div>
                <Label>Stückzahl</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.anzahl}
                  onChange={(e) => setForm({ ...form, anzahl: e.target.value })}
                />
              </div>
              <div>
                <Label>Aktueller Kurs (€/Stück)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.aktuellerKurs}
                  onChange={(e) =>
                    setForm({ ...form, aktuellerKurs: e.target.value })
                  }
                />
              </div>
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <Label>Notiz</Label>
            <Input
              value={form.notiz}
              onChange={(e) => setForm({ ...form, notiz: e.target.value })}
            />
          </div>
          <Btn primary type="submit">
            {editId ? 'Speichern' : 'Vermögenswert anlegen'}
          </Btn>
          {editId && (
            <Btn
              onClick={() => {
                setForm(emptyAsset());
                setEditId(null);
              }}
              style={{ marginLeft: 8 }}
            >
              Abbrechen
            </Btn>
          )}
        </form>
      </Card>

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Typ</Th>
              <Th align="right">Aktueller Wert</Th>
              <Th>Stand</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {data.vermoegenswerte.map((a) => (
              <React.Fragment key={a.id}>
                <tr>
                  <Td>
                    {a.name}
                    {a.isin ? ` (${a.isin})` : ''}
                  </Td>
                  <Td>{a.typ}</Td>
                  <Td align="right" mono>
                    {fmtEUR(assetValue(a))}
                  </Td>
                  <Td>{a.typ === 'Wertpapier' ? a.kursDatum : '–'}</Td>
                  <Td align="right">
                    <span
                      onClick={() =>
                        setSelected(selected === a.id ? null : a.id)
                      }
                      style={{
                        cursor: 'pointer',
                        fontSize: 12,
                        color: C.green,
                        marginRight: 10,
                      }}
                    >
                      {selected === a.id ? 'schließen' : 'Wert erfassen'}
                    </span>
                    <span
                      onClick={() => startEdit(a)}
                      style={{
                        cursor: 'pointer',
                        fontSize: 12,
                        color: C.amber,
                        marginRight: 10,
                      }}
                    >
                      bearbeiten
                    </span>
                    <span
                      onClick={() => remove(a.id)}
                      style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
                    >
                      löschen
                    </span>
                  </Td>
                </tr>
                {selected === a.id && (
                  <tr>
                    <Td colSpan={5} style={{ background: C.paper }}>
                      {a.typ === 'Wertpapier' ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-end',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <Label>Neuer Kurs (€/Stück)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              defaultValue={a.aktuellerKurs}
                              onBlur={(e) => updateKurs(a.id, e.target.value)}
                              style={{ width: 140 }}
                            />
                          </div>
                          <div style={{ fontSize: 12, color: C.inkSoft }}>
                            Feld verlassen speichert den Kurs mit heutigem
                            Datum.
                          </div>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: 'flex',
                            gap: 10,
                            alignItems: 'flex-end',
                            flexWrap: 'wrap',
                          }}
                        >
                          <div>
                            <Label>Datum</Label>
                            <Input
                              type="date"
                              value={wertForm.datum}
                              onChange={(e) =>
                                setWertForm({
                                  ...wertForm,
                                  datum: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label>Neuer Wert (€)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={wertForm.wert}
                              onChange={(e) =>
                                setWertForm({
                                  ...wertForm,
                                  wert: e.target.value,
                                })
                              }
                            />
                          </div>
                          <Btn primary onClick={() => addWert(a.id)}>
                            Wert erfassen
                          </Btn>
                          <div
                            style={{
                              fontSize: 12,
                              color: C.inkSoft,
                              width: '100%',
                            }}
                          >
                            Historie:{' '}
                            {data.vermoegensBuchungen
                              .filter((v) => v.vermoegenswertId === a.id)
                              .sort((x, y) => y.datum.localeCompare(x.datum))
                              .map(
                                (v) => `${v.datum}: ${fmtEUR(Number(v.wert))}`
                              )
                              .join(' · ') || 'keine Einträge'}
                          </div>
                        </div>
                      )}
                    </Td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {data.vermoegenswerte.length === 0 && (
              <tr>
                <Td colSpan={5}>
                  <i>Noch keine Vermögenswerte erfasst.</i>
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ---------- Darlehen ----------
function emptyLoan() {
  return {
    id: uid(),
    name: '',
    glaeubiger: '',
    ursprungsbetrag: '',
    zinssatz: '',
    rateMonatlich: '',
    startdatum: todayISO(),
    notiz: '',
  };
}

function Darlehen({ data, update, loanSchedule }) {
  const [form, setForm] = useState(emptyLoan());
  const [editId, setEditId] = useState(null);
  const [offen, setOffen] = useState(null);
  const [sForm, setSForm] = useState({ datum: todayISO(), betrag: '' });

  const submit = (e) => {
    e.preventDefault();
    if (!form.name || !form.ursprungsbetrag) return;
    update((d) => {
      if (editId)
        d.darlehen = d.darlehen.map((l) => (l.id === editId ? { ...form } : l));
      else d.darlehen = [{ ...form, id: uid() }, ...d.darlehen];
      return d;
    });
    setForm(emptyLoan());
    setEditId(null);
  };
  const remove = (id) =>
    update((d) => ({
      ...d,
      darlehen: d.darlehen.filter((l) => l.id !== id),
      sondertilgungen: d.sondertilgungen.filter((s) => s.darlehenId !== id),
    }));
  const startEdit = (l) => {
    setForm(l);
    setEditId(l.id);
  };

  const addSonder = (darlehenId) => {
    if (!sForm.betrag) return;
    update((d) => ({
      ...d,
      sondertilgungen: [
        { id: uid(), darlehenId, datum: sForm.datum, betrag: sForm.betrag },
        ...d.sondertilgungen,
      ],
    }));
    setSForm({ datum: todayISO(), betrag: '' });
  };

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Darlehen
      </h2>
      <Card style={{ marginBottom: 16 }}>
        <form onSubmit={submit}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <Input
              placeholder="Bezeichnung"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <Input
              placeholder="Gläubiger"
              value={form.glaeubiger}
              onChange={(e) => setForm({ ...form, glaeubiger: e.target.value })}
            />
            <div>
              <Label>Startdatum</Label>
              <Input
                type="date"
                value={form.startdatum}
                onChange={(e) =>
                  setForm({ ...form, startdatum: e.target.value })
                }
              />
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div>
              <Label>Ursprungsbetrag (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.ursprungsbetrag}
                onChange={(e) =>
                  setForm({ ...form, ursprungsbetrag: e.target.value })
                }
                required
              />
            </div>
            <div>
              <Label>Zinssatz (% p. a.)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.zinssatz}
                onChange={(e) => setForm({ ...form, zinssatz: e.target.value })}
              />
            </div>
            <div>
              <Label>Monatliche Rate (€)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.rateMonatlich}
                onChange={(e) =>
                  setForm({ ...form, rateMonatlich: e.target.value })
                }
              />
            </div>
          </div>
          <Btn primary type="submit">
            {editId ? 'Speichern' : 'Darlehen anlegen'}
          </Btn>
          {editId && (
            <Btn
              onClick={() => {
                setForm(emptyLoan());
                setEditId(null);
              }}
              style={{ marginLeft: 8 }}
            >
              Abbrechen
            </Btn>
          )}
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
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontFamily: FONT_SERIF,
                    fontSize: 15,
                  }}
                >
                  {l.name}
                </div>
                <div style={{ fontSize: 12, color: C.inkSoft }}>
                  {l.glaeubiger} · {l.zinssatz}% p. a. · Rate{' '}
                  {fmtEUR(Number(l.rateMonatlich) || 0)}/Monat
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Label>Restschuld heute</Label>
                <div style={{ fontSize: 18, fontFamily: FONT_MONO }}>
                  {fmtEUR(restschuldHeute)}
                </div>
              </div>
            </div>
            <div style={{ width: '100%', height: 200, margin: '12px 0' }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <CartesianGrid stroke={C.line} vertical={false} />
                  <XAxis
                    dataKey="monat"
                    tick={{ fontSize: 10, fill: C.inkSoft }}
                    interval={Math.max(0, Math.floor(chartData.length / 8))}
                  />
                  <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} />
                  <Tooltip formatter={(v) => fmtEUR(v)} />
                  <Line
                    type="monotone"
                    dataKey="restschuld"
                    stroke={C.amber}
                    strokeWidth={2}
                    dot={false}
                    name="Restschuld"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginBottom: 8,
              }}
            >
              <div>
                <Label>Sondertilgung Datum</Label>
                <Input
                  type="date"
                  value={sForm.datum}
                  onChange={(e) =>
                    setSForm({ ...sForm, datum: e.target.value })
                  }
                />
              </div>
              <div>
                <Label>Betrag (€)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={sForm.betrag}
                  onChange={(e) =>
                    setSForm({ ...sForm, betrag: e.target.value })
                  }
                />
              </div>
              <Btn primary onClick={() => addSonder(l.id)}>
                Sondertilgung erfassen
              </Btn>
              <Btn onClick={() => setOffen(offen === l.id ? null : l.id)}>
                {offen === l.id
                  ? 'Tilgungsplan schließen'
                  : 'Tilgungsplan anzeigen'}
              </Btn>
              <span
                onClick={() => startEdit(l)}
                style={{ cursor: 'pointer', fontSize: 12, color: C.amber }}
              >
                bearbeiten
              </span>
              <span
                onClick={() => remove(l.id)}
                style={{ cursor: 'pointer', fontSize: 12, color: C.loss }}
              >
                löschen
              </span>
            </div>
            {data.sondertilgungen.filter((s) => s.darlehenId === l.id).length >
              0 && (
              <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>
                Sondertilgungen:{' '}
                {data.sondertilgungen
                  .filter((s) => s.darlehenId === l.id)
                  .sort((a, b) => a.datum.localeCompare(b.datum))
                  .map((s) => `${s.datum}: ${fmtEUR(Number(s.betrag))}`)
                  .join(' · ')}
              </div>
            )}
            {offen === l.id && (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <Th>Monat</Th>
                      <Th align="right">Zins</Th>
                      <Th align="right">Tilgung</Th>
                      <Th align="right">Sondertilgung</Th>
                      <Th align="right">Restschuld</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((s) => (
                      <tr key={s.monat}>
                        <Td mono>{s.monat}</Td>
                        <Td align="right" mono>
                          {fmtEUR(s.zins)}
                        </Td>
                        <Td align="right" mono>
                          {fmtEUR(s.tilgung)}
                        </Td>
                        <Td align="right" mono>
                          {s.sondertilgung ? fmtEUR(s.sondertilgung) : '–'}
                        </Td>
                        <Td align="right" mono>
                          {fmtEUR(s.restschuld)}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}
      {data.darlehen.length === 0 && (
        <Card>
          <i>Noch keine Darlehen erfasst.</i>
        </Card>
      )}
    </div>
  );
}

// ---------- Cashflow ----------
function Cashflow({ data, bankById, bankSaldo }) {
  const [von, setVon] = useState(todayISO().slice(0, 4) + '-01-01');
  const [bis, setBis] = useState(todayISO());

  const relevante = data.buchungen.filter(
    (b) => b.datum >= von && b.datum <= bis
  );
  const monthly = {};
  for (const b of relevante) {
    const mk = monthKey(b.datum);
    monthly[mk] = monthly[mk] || {
      monat: mk,
      Einzahlungen: 0,
      Auszahlungen: 0,
    };
    monthly[mk][b.art === 'Einnahme' ? 'Einzahlungen' : 'Auszahlungen'] +=
      Number(b.betrag);
  }
  const chartData = Object.values(monthly).sort((a, b) =>
    a.monat.localeCompare(b.monat)
  );
  chartData.forEach((m) => (m.Netto = m.Einzahlungen - m.Auszahlungen));

  const liquiditaet = chartData.map((m) => ({
    monat: m.monat,
    Bestand: data.bankkonten.reduce(
      (s, b) => s + bankSaldo(b.id, m.monat + '-28'),
      0
    ),
  }));

  const sumEin = relevante
    .filter((b) => b.art === 'Einnahme')
    .reduce((s, b) => s + Number(b.betrag), 0);
  const sumAus = relevante
    .filter((b) => b.art === 'Ausgabe')
    .reduce((s, b) => s + Number(b.betrag), 0);

  return (
    <div>
      <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 500, marginTop: 0 }}>
        Cashflow
      </h2>
      <div
        style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}
      >
        <div>
          <Label>Von</Label>
          <Input
            type="date"
            value={von}
            onChange={(e) => setVon(e.target.value)}
          />
        </div>
        <div>
          <Label>Bis</Label>
          <Input
            type="date"
            value={bis}
            onChange={(e) => setBis(e.target.value)}
          />
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Card>
          <Label>Einzahlungen</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.gain }}>
            {fmtEUR(sumEin)}
          </div>
        </Card>
        <Card>
          <Label>Auszahlungen</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO, color: C.loss }}>
            {fmtEUR(sumAus)}
          </div>
        </Card>
        <Card>
          <Label>Netto-Cashflow</Label>
          <div style={{ fontSize: 20, fontFamily: FONT_MONO }}>
            <Money value={sumEin - sumAus} />
          </div>
        </Card>
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Label>Liquiditätsentwicklung (Bankbestand je Monatsende)</Label>
        <div style={{ width: '100%', height: 220 }}>
          <ResponsiveContainer>
            <LineChart data={liquiditaet}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line
                type="monotone"
                dataKey="Bestand"
                stroke={C.green}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <Label>Netto-Cashflow je Monat</Label>
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid stroke={C.line} vertical={false} />
              <XAxis dataKey="monat" tick={{ fontSize: 11, fill: C.inkSoft }} />
              <YAxis tick={{ fontSize: 11, fill: C.inkSoft }} />
              <Tooltip formatter={(v) => fmtEUR(v)} />
              <Line
                type="monotone"
                dataKey="Netto"
                stroke={C.green}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Monat</Th>
              <Th align="right">Einzahlungen</Th>
              <Th align="right">Auszahlungen</Th>
              <Th align="right">Netto</Th>
            </tr>
          </thead>
          <tbody>
            {chartData.map((m) => (
              <tr key={m.monat}>
                <Td mono>{m.monat}</Td>
                <Td align="right" mono style={{ color: C.gain }}>
                  {fmtEUR(m.Einzahlungen)}
                </Td>
                <Td align="right" mono style={{ color: C.loss }}>
                  {fmtEUR(m.Auszahlungen)}
                </Td>
                <Td align="right" mono>
                  <Money value={m.Netto} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
