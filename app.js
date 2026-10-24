// Home Badminton Tournament 2026 — installable app (PWA) with a central Firebase database.
import { FIREBASE_CONFIG, OWNER_EMAIL } from "./config.js";
import SEED from "./seed.js";

const DEMO = !FIREBASE_CONFIG.apiKey || FIREBASE_CONFIG.apiKey.startsWith("PASTE");
const SDK = "10.12.2";
const APP_VERSION = "7";
const OWNER = (OWNER_EMAIL || "").toLowerCase();

// ---------------- state ----------------
let S = { meta: null, matches: [], ko: [], log: [] };
let me = { email: null, role: "viewer", name: "" };
let people = [];
let view = { tab: "fixtures", day: null, cat: "AB", team: "", scDay: null };
let loaded = false;
const isAdmin = () => me.role === "admin";
const isScorer = () => me.role === "admin" || me.role === "scorer";

// ---------------- helpers ----------------
const CATN = { AB: "Cat A & B", CD: "Cat C & D" };
const COL = (c, p) => `var(--${c}${p})`;
const TIMES = Array.from({ length: 32 }, (_, i) => { const m = 16 * 60 + i * 15; return `${Math.floor(m / 60) - 12}:${String(m % 60).padStart(2, "0")}`; });
const KOTIMES = TIMES;
const mins = t => { const [a, b] = t.split(":").map(Number); return a * 60 + b; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = v => (v === null || v === undefined || v === "") ? null : Number(v);
const fin = v => typeof v === "number" && Number.isFinite(v);
const tname = (c, p, t) => S.meta.teams[c][p][t - 1];
const fmtDate = (iso, long) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", long ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" });
const dayLabel = n => fmtDate(S.meta.days[n - 1]);
const label = m => `${tname(m.cat, m.pool, m.t1)} vs ${tname(m.cat, m.pool, m.t2)}`;
const where = (d, t, c) => `${dayLabel(d)} ${t} Court ${c}`;
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

// ---------------- data store: Firebase or demo ----------------
async function firebaseStore() {
  const base = `https://www.gstatic.com/firebasejs/${SDK}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fs = await import(`${base}/firebase-firestore.js`);
  const au = await import(`${base}/firebase-auth.js`);
  const app = initializeApp(FIREBASE_CONFIG);
  let db;
  try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
  catch (e) { db = fs.getFirestore(app); }
  const auth = au.getAuth(app);
  au.getRedirectResult(auth).catch(() => {});
  const stamp = () => ({ updatedBy: me.email, updatedAt: fs.serverTimestamp() });
  let unsubPeople = null;
  return {
    listen(cb) {
      fs.onSnapshot(fs.doc(db, "meta", "config"), d => { S.meta = d.exists() ? d.data() : null; loaded = true; cb(); }, () => { loaded = true; cb(); });
      fs.onSnapshot(fs.collection(db, "matches"), q => { S.matches = q.docs.map(d => ({ id: d.id, ...d.data() })); cb(); });
      fs.onSnapshot(fs.collection(db, "ko"), q => { S.ko = q.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)); cb(); });
      fs.onSnapshot(fs.query(fs.collection(db, "log"), fs.orderBy("at", "desc"), fs.limit(300)), q => { S.log = q.docs.map(d => ({ id: d.id, ...d.data() })); cb(); });
    },
    onAuth(cb) {
      au.onAuthStateChanged(auth, async u => {
        if (unsubPeople) { unsubPeople(); unsubPeople = null; people = []; }
        if (!u) { cb(null, "viewer", ""); return; }
        const email = (u.email || "").toLowerCase();
        let role = email === OWNER ? "admin" : "viewer";
        try { const r = await fs.getDoc(fs.doc(db, "roles", email)); if (role !== "admin" && r.exists()) role = r.data().role; } catch (e) {}
        if (role === "admin") unsubPeople = fs.onSnapshot(fs.collection(db, "roles"), q => { people = q.docs.map(d => ({ email: d.id, ...d.data() })); render(); });
        cb(email, role, u.displayName || "");
      });
    },
    async signIn() {
      const p = new au.GoogleAuthProvider();
      try { await au.signInWithPopup(auth, p); }
      catch (e) { if (/popup/.test(e.code || "")) await au.signInWithRedirect(auth, p); else throw e; }
    },
    signOut: () => au.signOut(auth),
    async commit(ops) {
      const b = fs.writeBatch(db);
      for (const o of ops) {
        if (o.type === "update") b.update(fs.doc(db, o.col, o.id), { ...o.fields, ...stamp() });
        if (o.type === "set") b.set(fs.doc(db, o.col, o.id), { ...o.fields, ...stamp() });
        if (o.type === "delete") b.delete(fs.doc(db, o.col, o.id));
        if (o.type === "log") b.set(fs.doc(fs.collection(db, "log")), { text: o.text, kind: o.kind || "schedule", changes: o.changes || [], revert: !!o.revert, by: me.email, at: fs.serverTimestamp() });
      }
      await b.commit();
    },
    async seed() {
      const b = fs.writeBatch(db);
      b.set(fs.doc(db, "meta", "config"), SEED.meta);
      for (const m of SEED.matches) b.set(fs.doc(db, "matches", m.id), m);
      for (const k of SEED.ko) b.set(fs.doc(db, "ko", k.id), k);
      b.set(fs.doc(fs.collection(db, "log")), { text: "Final fixtures loaded", by: me.email, at: fs.serverTimestamp() });
      await b.commit();
    },
    setRole: (email, role) => fs.setDoc(fs.doc(db, "roles", email.toLowerCase()), { role, addedBy: me.email, at: fs.serverTimestamp() }),
    removeRole: email => fs.deleteDoc(fs.doc(db, "roles", email))
  };
}

function demoStore() {
  // Runs on this phone only (no central database). For trying the app before Firebase is set up.
  const KEY = "hbt-demo";
  let D; try { D = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { D = null; }
  if (!D) D = { meta: SEED.meta, matches: SEED.matches, ko: SEED.ko, log: [], roles: [], user: null };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {} };
  let cbData = () => {}, cbAuth = () => {};
  const push = () => { S.meta = D.meta; S.matches = D.matches; S.ko = D.ko; S.log = [...D.log].reverse(); people = D.roles; loaded = true; cbData(); };
  return {
    listen(cb) { cbData = cb; setTimeout(push, 0); },
    onAuth(cb) { cbAuth = cb; setTimeout(() => cb(D.user?.email || null, D.user?.role || "viewer", ""), 0); },
    async signIn() {
      const role = prompt("DEMO sign-in. Type admin or scorer", "admin");
      if (!role) return;
      D.user = { email: role === "scorer" ? "scorer@demo" : "admin@demo", role: role === "scorer" ? "scorer" : "admin" };
      save(); cbAuth(D.user.email, D.user.role, "");
    },
    async signOut() { D.user = null; save(); cbAuth(null, "viewer", ""); },
    async commit(ops) {
      for (const o of ops) {
        if (o.type === "update") { const list = o.col === "ko" ? D.ko : o.col === "log" ? D.log : D.matches; Object.assign(list.find(x => x.id === o.id), o.fields, { updatedBy: me.email }); }
        if (o.type === "set") (o.col === "ko" ? D.ko : D.matches).push({ id: o.id, ...o.fields });
        if (o.type === "delete") { if (o.col === "ko") D.ko = D.ko.filter(x => x.id !== o.id); else D.matches = D.matches.filter(x => x.id !== o.id); }
        if (o.type === "log") D.log.push({ id: "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: o.text, kind: o.kind || "schedule", changes: o.changes || [], revert: !!o.revert, by: me.email, at: { iso: new Date().toISOString() } });
      }
      save(); push();
    },
    async seed() { push(); },
    async setRole(email, role) { D.roles = D.roles.filter(r => r.email !== email); D.roles.push({ email: email.toLowerCase(), role }); save(); push(); },
    async removeRole(email) { D.roles = D.roles.filter(r => r.email !== email); save(); push(); }
  };
}

// ---------------- standings ----------------
const done = m => fin(m.s1) && fin(m.s2) && m.s1 !== m.s2;
function standings(c, p) {
  const n = S.meta.teams[c][p].length, rows = {};
  for (let t = 1; t <= n; t++) rows[t] = { t, P: 0, W: 0, L: 0, F: 0, A: 0 };
  const ms = S.matches.filter(m => m.cat === c && m.pool === p && !m.extra);
  for (const m of ms) {
    if (!done(m)) continue;
    const a = rows[m.t1], b = rows[m.t2]; a.P++; b.P++; a.F += m.s1; a.A += m.s2; b.F += m.s2; b.A += m.s1;
    if (m.s1 > m.s2) { a.W++; b.L++; } else { b.W++; a.L++; }
  }
  const list = Object.values(rows).map(r => ({ ...r, Pts: r.W * 2, D: r.F - r.A }));
  // points, then head-to-head for a two-way tie, then points difference, then points scored
  list.sort((x, y) => y.Pts - x.Pts || y.D - x.D || y.F - x.F || x.t - y.t);
  for (let i = 0; i < list.length - 1; i++) {
    const x = list[i], y = list[i + 1];
    const tiedGroup = list.filter(r => r.Pts === x.Pts);
    if (x.Pts === y.Pts && tiedGroup.length === 2) {
      const h = ms.find(m => done(m) && ((m.t1 === x.t && m.t2 === y.t) || (m.t1 === y.t && m.t2 === x.t)));
      if (h) { const yWon = (h.t1 === y.t && h.s1 > h.s2) || (h.t2 === y.t && h.s2 > h.s1); if (yWon) { list[i] = y; list[i + 1] = x; } }
    }
  }
  return { list, complete: ms.length > 0 && ms.every(done), played: ms.filter(done).length, total: ms.length };
}
const QUAL = { AB: 2, CD: 1 };
function koGames(k) { let a = 0, b = 0; const g = k.g || []; for (let i = 0; i < 3; i++) { const x = g[2 * i], y = g[2 * i + 1]; if (fin(x) && fin(y) && x !== y) { x > y ? a++ : b++; } } return [a, b]; }
function koWinner(k) { const [a, b] = koGames(k); if (a >= 2) return resolve(k.a); if (b >= 2) return resolve(k.b); return null; }
function resolve(ref) {
  const p = ref.split("|");
  if (p[0] === "W") { const k = S.ko.find(x => x.id === p[1]); if (!k) return "TBD"; return koWinner(k) || `${k.label} winner`; }
  const [c, pool, pos] = [p[0], p[1], +p[2]]; const st = standings(c, pool);
  if (!st.complete) return `Pool ${pool} ${pos === 1 ? "winner" : "runner-up"}`;
  return tname(c, pool, st.list[pos - 1].t);
}

// ---------------- rendering ----------------
const TABS = () => isScorer()
  ? [["fixtures", "Fixtures"], ["scorer", "Scorer"], ["standings", "Standings"], ["knockouts", "Knockouts"], ["teams", "My team"], ["rules", "Rules"], ["changes", "Activity log"], ...(isAdmin() ? [["people", "People"]] : [])]
  : [["fixtures", "Fixtures"], ["standings", "Standings"]];
function renderHeader() {
  document.getElementById("demo").innerHTML = DEMO ? '<div class="demo">Demo mode: changes stay on this phone. Finish the Firebase setup to share one live view.</div>' : "";
  document.getElementById("net").innerHTML = navigator.onLine ? "" : '<div class="offline">Offline. Showing the last saved data; changes sync when you reconnect.</div>';
  if (S.meta) { document.getElementById("club").textContent = S.meta.club; document.getElementById("title").innerHTML = esc(S.meta.title.replace(/ 2026$/, "")) + " <span>2026</span>"; }
  const league = S.matches.filter(m => !m.extra), played = league.filter(done).length;
  document.getElementById("upd").textContent = S.meta ? `${played} of ${league.length} league matches played` : (loaded ? "" : "Loading…");
  document.getElementById("who").innerHTML = me.email
    ? `<span class="role">${me.role === "admin" ? "Admin" : me.role === "scorer" ? "Scorer" : "Viewer"} · v${APP_VERSION}</span><span style="opacity:.8">${esc(me.email)}</span><button class="btn" id="signout">Sign out</button>`
    : `<button class="btn" id="signin">Organiser sign-in</button>`;
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!standalone && installEvt) document.getElementById("who").insertAdjacentHTML("afterbegin", `<button class="btn" id="install" style="background:var(--accent);color:var(--accent-ink)">Install app</button>`);
  let hint = document.getElementById("iosHint");
  const showHint = !standalone && ios && !sessionStorage.getItem("hbt-hint-off");
  if (showHint && !hint) { document.body.insertAdjacentHTML("afterbegin", `<div id="iosHint" class="demo" style="background:#24406E">To install: tap <b>Share</b> ⬆︎ then <b>Add to Home Screen</b>. <button class="btn" id="hintOff" style="padding:2px 8px;font-size:12px;margin-left:6px">OK</button></div>`); }
  if (!showHint && hint) hint.remove();
  document.getElementById("tabs").innerHTML = TABS().map(([k, l]) => `<button role="tab" aria-selected="${view.tab === k}" data-tab="${k}">${l}</button>`).join("");
}
function matchCard(m) {
  const c = m.cat, p = m.pool, d = done(m), w1 = d && m.s1 > m.s2, w2 = d && m.s2 > m.s1;
  const r = (t, s, w, l) => `<div class="row${w ? " w" : ""}${l ? " l" : ""}"><span class="nm">${p}${t} ${esc(tname(c, p, t))}</span><span class="sc">${fin(s) ? s : ""}</span></div>`;
  const body = `<div class="meta"><span class="tag">${CATN[c]}, Pool ${p}${m.extra ? " · Extra match" : ""}</span><span>Court ${m.court}</span></div>` + r(m.t1, m.s1, w1, w2) + r(m.t2, m.s2, w2, w1) + (m.note ? `<div class="note">${esc(m.note)}</div>` : "") + (m.toss && isScorer() && done(m) ? `<div class="note">${esc(m.toss)}</div>` : "");
  return isScorer() ? `<button class="card" style="--c:${COL(c, p)}" data-edit="${m.id}">${body}</button>` : `<div class="card" style="--c:${COL(c, p)}">${body}</div>`;
}
function todayDay() { const t = new Date(); const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; const i = S.meta.days.indexOf(iso); return i >= 0 ? i + 1 : (iso === S.meta.koDate ? "ko" : 1); }
function renderFixtures() {
  if (view.day == null) view.day = todayDay();
  const d = view.day, n = S.meta.days.length;
  let h = `<div class="chips" role="group" aria-label="Choose a day">`;
  for (let i = 1; i <= n; i++) h += `<button class="chip" aria-pressed="${d === i}" data-day="${i}">Day ${i}<small>${dayLabel(i)}</small></button>`;
  h += `<button class="chip" aria-pressed="${d === "ko"}" data-day="ko">Knockouts<small>${fmtDate(S.meta.koDate)}</small></button></div>`;
  if (d === "ko") return h + koHTML();
  const ms = S.matches.filter(m => m.day === d);
  h += `<div class="dayhead"><h2>${fmtDate(S.meta.days[d - 1], true)}</h2><span>${ms.length} matches, ${ms.filter(done).length} played</span></div>`;
  if (isAdmin()) h += `<div class="acts" style="justify-content:flex-start;margin:0 0 10px"><button class="btn pri" data-add="${d}">+ Add a match to this day</button></div>`;
  const times = [...new Set(ms.map(m => m.time))].sort((a, b) => mins(a) - mins(b));
  if (!times.length) h += `<p class="empty">No matches on this day.</p>`;
  for (const t of times) {
    const c1 = ms.find(m => m.time === t && m.court === 1), c2 = ms.find(m => m.time === t && m.court === 2);
    h += `<div class="slot"><div class="time">${t}<small>PM</small></div><div class="courts">${c1 ? matchCard(c1) : '<div class="card free">Court 1 free</div>'}${c2 ? matchCard(c2) : '<div class="card free">Court 2 free</div>'}</div></div>`;
  }
  return h;
}
function renderStandings() {
  let h = `<div class="seg">${["AB", "CD"].map(c => `<button class="chip" aria-pressed="${view.cat === c}" data-cat="${c}">${CATN[c].replace("Cat", "Category")}</button>`).join("")}</div>`;
  const c = view.cat;
  h += `<p class="note" style="margin:0 0 10px">Win = 2 points. Shaded rows are in qualifying places (${c === "AB" ? "top 2" : "pool winner"}).</p>`;
  for (const p of Object.keys(S.meta.teams[c]).sort()) {
    const st = standings(c, p);
    h += `<div class="tablewrap"><div class="poolh" style="--c:${COL(c, p)}">Pool ${p}<span>${st.played} of ${st.total} played</span></div><table><thead><tr><th>#</th><th style="text-align:left">Team</th><th>P</th><th>W</th><th>L</th><th>Pts</th><th>+/-</th></tr></thead><tbody>`;
    st.list.forEach((r, i) => { const q = i < QUAL[c]; h += `<tr class="${q ? "q" : ""}"><td>${i + 1}</td><td class="tm">${esc(tname(c, p, r.t))}${q && st.complete ? ' <span class="badge">Q</span>' : ""}</td><td>${r.P}</td><td>${r.W}</td><td>${r.L}</td><td><b>${r.Pts}</b></td><td>${r.D > 0 ? "+" : ""}${r.D}</td></tr>`; });
    h += `</tbody></table></div>`;
  }
  return h;
}
function koHTML() {
  let h = `<div class="dayhead"><h2>Knockouts, ${fmtDate(S.meta.koDate, true)}</h2></div><p class="note" style="margin:0 0 10px">Best of three games, each to 15 points. Qualifiers appear once each pool has finished.</p>`;
  for (const c of ["AB", "CD"]) {
    h += `<h3 class="cond" style="margin:14px 0 6px;font-size:20px">${CATN[c].replace("Cat", "Category")}</h3>`;
    for (const k of S.ko.filter(x => x.cat === c).sort((a, b) => mins(a.time) - mins(b.time))) {
      const [a, b] = koGames(k), w = koWinner(k), g = k.g || [];
      const gs = [0, 1, 2].filter(i => fin(g[2 * i]) && fin(g[2 * i + 1])).map(i => `${g[2 * i]}–${g[2 * i + 1]}`).join(", ");
      const inner = `<h3>${k.label}</h3><div class="meta"><span>${k.time} PM, Court ${k.court}</span><span>${gs ? `Games ${a}–${b}` : ""}</span></div>
        <div class="row${w && a > b ? " w" : ""}"><span class="nm">${esc(resolve(k.a))}</span><span class="sc">${gs ? a : ""}</span></div>
        <div class="row${w && b > a ? " w" : ""}"><span class="nm">${esc(resolve(k.b))}</span><span class="sc">${gs ? b : ""}</span></div>
        ${gs ? `<div class="games">${gs}</div>` : ""}${w ? `<div class="note"><b>Winner: ${esc(w)}</b></div>` : ""}`;
      const col = c === "AB" ? "var(--ABA)" : "var(--CDA)";
      h += isScorer() ? `<button class="kocard card" style="--c:${col};display:block" data-ko="${k.id}">${inner}</button>` : `<div class="kocard" style="--c:${col}">${inner}</div>`;
    }
  }
  return h;
}
function renderTeams() {
  const opts = [];
  for (const c of ["AB", "CD"]) for (const p of Object.keys(S.meta.teams[c])) S.meta.teams[c][p].forEach((n, i) => opts.push([`${c}|${p}|${i + 1}`, `${n} (${CATN[c]}, Pool ${p})`]));
  opts.sort((a, b) => a[1].localeCompare(b[1]));
  let h = `<label for="teamSel">Choose a team to see all its matches</label><select id="teamSel"><option value="">Select team</option>${opts.map(([v, l]) => `<option value="${v}"${view.team === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  if (view.team) {
    const [c, p, t] = view.team.split("|");
    const ms = S.matches.filter(m => m.cat === c && m.pool === p && (m.t1 == t || m.t2 == t)).sort((a, b) => a.day - b.day || mins(a.time) - mins(b.time));
    const st = standings(c, p), pos = st.list.findIndex(r => r.t == t) + 1, r = st.list[pos - 1];
    h += `<p style="margin:12px 0"><b>Position ${pos}</b> in Pool ${p}: played ${r.P}, won ${r.W}, ${r.Pts} points.</p>`;
    for (const m of ms) h += `<div class="slot"><div class="time" style="font-size:16px">${dayLabel(m.day).replace(" ", "<br>")}<small>${m.time} PM</small></div><div>${matchCard(m)}</div></div>`;
  }
  return h;
}
function renderRules() {
  return `<div class="rules"><h3>Format</h3><p>Every team plays every other team in its pool once. Matches every 30 minutes on two courts from 7:00 PM (5:00 PM on Saturday 31 October).</p>
  <h3>League match</h3><p>One game to 30 points. Change ends at 15.</p>
  <h3>Points and positions</h3><p>A win is worth 2 points. Teams are ordered by points. If two teams are level, the winner of their league match goes ahead. If three or more are level, points difference, then points scored.</p>
  <h3>Qualifying</h3><p>Category A &amp; B: top 2 from Pool A and Pool B. Category C &amp; D: the winner of each of the four pools.</p>
  <h3>Semi-finals and finals</h3><p>Sunday 1 November. Best of three games, each to 15 points. Finals are played one at a time on Court 1.</p>
  <h3>Install this app</h3><p><b>Android (Chrome):</b> menu ⋮, then Install app or Add to Home screen.<br><b>iPhone (Safari):</b> Share, then Add to Home Screen.</p>
  ${installEvt ? '<button class="btn pri" id="install">Install app on this phone</button>' : ""}</div>`;
}
function renderChanges() {
  const f = view.logf || "all";
  const chips = [["all", "All"], ["result", "Results"], ["schedule", "Schedule"], ["people", "People"]].map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-logf="${k}">${l}</button>`).join("");
  const when = x => { const d = x.at?.toDate ? x.at.toDate() : (x.at?.iso ? new Date(x.at.iso) : null); return d ? d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Just now"; };
  const rows = S.log.filter(x => f === "all" || (x.kind || "schedule") === f);
  let h = `<div class="seg">${chips}</div><p class="note" style="margin:0 0 10px">Every result, schedule change and organiser change, newest first, with who made it.${isAdmin() ? " Tap <b>Undo</b> to put things back the way they were; fixtures and standings update for everyone." : ""}</p>`;
  if (!rows.length) return h + `<p class="empty">Nothing here yet.</p>`;
  h += `<ul class="log" style="list-style:none;padding:0">` + rows.map(x => {
    const rv = x.revertedBy ? `<div class="note" style="color:var(--warn)">Undone by ${esc(x.revertedBy)}${x.revertedAt ? ", " + new Date(x.revertedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : ""}</div>` : "";
    const canUndo = isAdmin() && !x.revertedBy && !x.revert && x.changes && x.changes.length;
    return `<li style="border-bottom:1px solid var(--line);padding:10px 0;display:flex;gap:10px;align-items:flex-start"><div style="flex:1;min-width:0"><time>${when(x)}${x.by ? " · " + esc(x.by) : ""}</time><div${x.revertedBy ? ' style="text-decoration:line-through;opacity:.7"' : ""}>${esc(x.text)}</div>${rv}</div>${canUndo ? `<button class="btn" data-undo="${esc(x.id)}" style="flex:0 0 auto;padding:8px 12px">Undo</button>` : ""}</li>`;
  }).join("") + `</ul>`;
  return h;
}
function renderPeople() {
  if (!isAdmin()) return "";
  return `<p class="note" style="margin:0 0 10px">Viewers don’t need an account. Add the Google (Gmail) address of each organiser. <b>Scorers</b> can enter results; <b>Admins</b> can also reschedule matches and manage people. They sign in with “Organiser sign-in”.</p>
  <div class="grid2"><input id="pEmail" type="email" placeholder="name@gmail.com" autocomplete="off"><select id="pRole"><option value="scorer">Scorer</option><option value="admin">Admin</option></select></div>
  <div class="acts"><button class="btn pri" id="pAdd">Add person</button></div>
  <h3 class="cond" style="font-size:20px;margin:16px 0 6px">Organisers</h3>
  <ul class="people"><li><span>${esc(OWNER || "(owner email not set)")}</span><span class="role">Owner, Admin</span></li>
  ${people.filter(p => p.email !== OWNER).map(p => `<li><span>${esc(p.email)}</span><span style="display:flex;gap:6px;align-items:center"><span class="role">${p.role === "admin" ? "Admin" : "Scorer"}</span><button class="btn" data-rm="${esc(p.email)}">Remove</button></span></li>`).join("")}</ul>`;
}
function render() {
  renderHeader();
  const M = document.getElementById("main");
  if (!S.meta) {
    M.innerHTML = !loaded ? `<p class="empty">Loading fixtures…</p>` : isAdmin()
      ? `<div class="alert ok">The database is empty. Load the final fixtures (72 league matches and the knockouts) to start.</div><div class="acts"><button class="btn pri" id="seed">Load the final fixtures</button></div>`
      : `<p class="empty">Fixtures haven’t been loaded yet. The admin needs to sign in and load them.</p>`;
    return;
  }
  if (!TABS().some(([k]) => k === view.tab)) view.tab = "fixtures";
  M.innerHTML = view.tab === "fixtures" ? renderFixtures() : view.tab === "scorer" ? renderScorer() : view.tab === "standings" ? renderStandings()
    : view.tab === "knockouts" ? koHTML() : view.tab === "teams" ? renderTeams() : view.tab === "rules" ? renderRules() : view.tab === "people" ? renderPeople() : renderChanges();
}

// ---------------- editing ----------------
const dlg = document.getElementById("dlg");
const teamKeys = m => [`${m.cat}|${m.pool}|${m.t1}`, `${m.cat}|${m.pool}|${m.t2}`];
function clashes(m, day, time, ignore) {
  // problems for match m if it were played at (day, time), ignoring matches in `ignore`
  const errs = [], warns = [];
  for (const o of S.matches) {
    if (o.id === m.id || ignore.includes(o.id) || o.day !== day) continue;
    const share = teamKeys(o).filter(k => teamKeys(m).includes(k));
    if (!share.length) continue;
    const gap = Math.abs(mins(o.time) - mins(time));
    const nm = share.map(k => { const [c, p, t] = k.split("|"); return tname(c, p, +t); }).join(" and ");
    if (gap < 60) errs.push(`${nm} already play at ${o.time} that night. Leave at least one match between.`);
    else warns.push(`${nm} will play twice that night (also at ${o.time}).`);
  }
  return { errs, warns };
}
function checkMove(m, day, time, court) {
  const occupant = S.matches.find(o => o.id !== m.id && o.day === day && o.time === time && o.court === court) || null;
  const r = clashes(m, day, time, occupant ? [occupant.id] : []);
  if (occupant) {
    const back = clashes(occupant, m.day, m.time, [m.id]);
    back.errs.forEach(x => r.errs.push(`After the swap, ${x.charAt(0).toLowerCase() + x.slice(1)}`));
    back.warns.forEach(x => r.warns.push(`After the swap, ${x.charAt(0).toLowerCase() + x.slice(1)}`));
  }
  return { ...r, occupant };
}
const clean = o => { if (!o) return null; const c = JSON.parse(JSON.stringify(o)); delete c.id; delete c.updatedAt; delete c.updatedBy; return c; };
const val = v => (v === undefined ? null : v);
function docOf(col, id) { return (col === "ko" ? S.ko : S.matches).find(x => x.id === id) || null; }
function nameOf(col, id, snap) {
  const d = (snap && snap.cat) ? snap : docOf(col, id); if (!d) return id;
  if (col === "ko") return `${CATN[d.cat]} ${d.label}`;
  return `${tname(d.cat, d.pool, d.t1)} vs ${tname(d.cat, d.pool, d.t2)}`;
}
const scoreTxt = (a, b) => (fin(a) && fin(b) ? `${a}–${b}` : "not played");
const gamesTxt = g => { const x = (g || []); const p = [0, 1, 2].filter(i => fin(x[2 * i]) && fin(x[2 * i + 1])).map(i => `${x[2 * i]}–${x[2 * i + 1]}`); return p.length ? p.join(", ") : "not played"; };
function autoText(changes) {
  const out = [];
  for (const c of changes) {
    const nm = nameOf(c.col, c.id, c.before || c.after);
    if (c.type === "set") { out.push(`Added: ${nm}`); continue; }
    if (c.type === "delete") { out.push(`Deleted: ${nm}`); continue; }
    const A = c.after, B = c.before;
    if ("s1" in A || "s2" in A) out.push(`Result ${nm}: ${scoreTxt(A.s1, A.s2)} (was ${scoreTxt(B.s1, B.s2)})`);
    if ("g" in A) out.push(`Result ${nm}: ${gamesTxt(A.g)} (was ${gamesTxt(B.g)})`);
    if ("note" in A) out.push(`Note on ${nm}: “${A.note || "(removed)"}”`);
    if (("time" in A || "court" in A) && c.col === "ko") out.push(`${nm} moved to ${A.time} Court ${A.court}`);
  }
  return out.join(" · ") || "Change saved";
}
async function save(ops, msg) {
  const texts = ops.filter(o => o.type === "log").map(o => o.text);
  const real = ops.filter(o => o.type !== "log");
  const changes = real.filter(o => o.col === "matches" || o.col === "ko").map(o => {
    const cur = docOf(o.col, o.id);
    if (o.type === "update") { const before = {}, after = {}; for (const k of Object.keys(o.fields)) { before[k] = val(cur ? cur[k] : null); after[k] = val(o.fields[k]); } return { col: o.col, id: o.id, type: "update", before: clean(before), after: clean(after) }; }
    if (o.type === "set") return { col: o.col, id: o.id, type: "set", before: null, after: clean(o.fields) };
    return { col: o.col, id: o.id, type: "delete", before: clean(cur), after: null };
  });
  const schedule = changes.some(c => c.type !== "update" || ["day", "time", "court"].some(k => c.after && k in c.after));
  let text = texts.join(" · ");
  if (!ops.noAuto) {
    const auto = autoText(texts.length ? changes.filter(c => c.type === "update") : changes);
    if (auto !== "Change saved" || !texts.length) text = [text, auto].filter(Boolean).join(" · ");
  }
  if (changes.length || texts.length) real.push({ type: "log", text, kind: ops.kind || (schedule ? "schedule" : "result"), changes, revert: !!ops.noAuto });
  try { await store.commit(real); toast(msg || "Saved for everyone"); return true; }
  catch (e) { console.error(e); alert(e.code === "permission-denied" ? "You don’t have permission for this change. Ask the admin." : "Couldn’t save. Check your connection and try again."); return false; }
}
async function revertLog(id) {
  const L = S.log.find(x => x.id === id); if (!L || !L.changes || !L.changes.length) return;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const later = [];
  for (const c of L.changes) {
    const cur = docOf(c.col, c.id);
    if (c.type === "update" && cur && Object.keys(c.after).some(k => !same(cur[k], c.after[k]))) later.push(nameOf(c.col, c.id));
    if (c.type === "set" && !cur) later.push(nameOf(c.col, c.id, c.after) + " (already removed)");
    if (c.type === "delete" && cur) later.push(nameOf(c.col, c.id, c.before) + " (already back)");
  }
  let msg = `Undo this change?\n\n${L.text}`;
  if (later.length) msg += `\n\nCareful: ${later.join(", ")} changed again after this. Undoing will overwrite the later change too.`;
  if (!confirm(msg)) return;
  const ops = [];
  for (const c of [...L.changes].reverse()) {
    if (c.type === "update") ops.push({ type: "update", col: c.col, id: c.id, fields: c.before });
    if (c.type === "set") { if (docOf(c.col, c.id)) ops.push({ type: "delete", col: c.col, id: c.id }); }
    if (c.type === "delete") ops.push({ type: "set", col: c.col, id: c.id, fields: c.before });
  }
  ops.push({ type: "update", col: "log", id: L.id, fields: { revertedBy: me.email, revertedAt: new Date().toISOString() } });
  ops.push({ type: "log", text: `Reverted: ${L.text}` });
  ops.kind = L.kind; ops.noAuto = true;
  await save(ops, "Change undone for everyone");
}
function openEdit(id) {
  const m = S.matches.find(x => x.id === id); if (!m) return;
  const admin = isAdmin();
  const dOpts = S.meta.days.map((_, i) => `<option value="${i + 1}"${m.day === i + 1 ? " selected" : ""}>Day ${i + 1}, ${dayLabel(i + 1)}</option>`).join("");
  const tOpts = TIMES.map(t => `<option${m.time === t ? " selected" : ""}>${t}</option>`).join("");
  dlg.innerHTML = `<form method="dialog" class="dlg" novalidate><h3>${esc(label(m))}</h3><div class="note">${CATN[m.cat]}, Pool ${m.pool}${m.extra ? ", extra match (not counted in standings)" : ""}. ${where(m.day, m.time, m.court)}</div>
  <label>Result (leave both blank if not played)</label><div class="grid2"><input id="s1" type="number" inputmode="numeric" min="0" max="60" placeholder="${esc(tname(m.cat, m.pool, m.t1))}" value="${fin(m.s1) ? m.s1 : ""}"><input id="s2" type="number" inputmode="numeric" min="0" max="60" placeholder="${esc(tname(m.cat, m.pool, m.t2))}" value="${fin(m.s2) ? m.s2 : ""}"></div>
  ${admin ? `<label>Reschedule</label><div class="grid3"><select id="ed" aria-label="Day">${dOpts}</select><select id="et" aria-label="Time">${tOpts}</select><select id="ec" aria-label="Court"><option value="1"${m.court === 1 ? " selected" : ""}>Court 1</option><option value="2"${m.court === 2 ? " selected" : ""}>Court 2</option></select></div>` : ""}
  <label for="en">Note (optional, e.g. walkover or reason for change)</label><input id="en" value="${esc(m.note || "")}">
  <div class="acts" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" id="clr">Clear result (not played yet)</button>${admin && m.extra ? '<button type="button" class="btn" id="delx" style="color:var(--warn)">Delete this extra match</button>' : ""}</div>
  <div id="chk"></div><div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn pri" id="apply" value="apply">Save</button></div></form>`;
  const q = s => dlg.querySelector(s);
  q("#clr").addEventListener("click", () => { q("#s1").value = ""; q("#s2").value = ""; check(); });
  if (q("#delx")) q("#delx").addEventListener("click", () => { if (confirm("Delete this extra match?")) { dlg.returnValue = "cancel"; dlg.close(); save([{ type: "delete", col: "matches", id: m.id }, { type: "log", text: `Extra match deleted: ${label(m)}, ${where(m.day, m.time, m.court)}` }], "Match deleted"); } });
  function check() {
    let html = "", bad = false; const s1 = q("#s1").value, s2 = q("#s2").value;
    if ((s1 === "") !== (s2 === "")) { html += `<div class="alert bad">Enter both scores, or leave both blank.</div>`; bad = true; }
    else if (s1 !== "" && +s1 === +s2) { html += `<div class="alert bad">Scores can’t be level. One team must win.</div>`; bad = true; }
    if (admin) {
      const day = +q("#ed").value, time = q("#et").value, court = +q("#ec").value;
      if (!(day === m.day && time === m.time && court === m.court)) {
        const r = checkMove(m, day, time, court);
        r.errs.forEach(e => html += `<div class="alert bad">${esc(e)}</div>`);
        if (r.occupant) html += `<div class="alert bad" style="background:var(--surface2);color:var(--ink)">${esc(label(r.occupant))} is in that slot. Saving will swap the two matches.</div>`;
        r.warns.forEach(e => html += `<div class="alert bad" style="background:var(--surface2);color:var(--ink)">${esc(e)}</div>`);
        if (!r.errs.length && !r.occupant && !r.warns.length) html += `<div class="alert ok">That slot is free and both teams are available.</div>`;
        if (r.errs.length) bad = true;
      }
    }
    q("#chk").innerHTML = html; q("#apply").disabled = bad;
  }
  dlg.querySelectorAll("input,select").forEach(e => e.addEventListener("input", check)); check();
  dlg.onclose = () => {
    if (dlg.returnValue !== "apply") return;
    const ops = [], fields = {}, note = q("#en").value.trim();
    const ns1 = num(q("#s1").value), ns2 = num(q("#s2").value);
    if (ns1 !== (m.s1 ?? null) || ns2 !== (m.s2 ?? null)) { fields.s1 = ns1; fields.s2 = ns2; }
    if (ns1 === null && ns2 === null && m.toss) fields.toss = "";   // clearing the result also clears the toss
    if ((m.note || "") !== note) fields.note = note;
    if (admin) {
      const day = +q("#ed").value, time = q("#et").value, court = +q("#ec").value;
      if (!(day === m.day && time === m.time && court === m.court)) {
        const from = where(m.day, m.time, m.court), occ = S.matches.find(o => o.id !== m.id && o.day === day && o.time === time && o.court === court);
        if (occ) { ops.push({ type: "update", col: "matches", id: occ.id, fields: { day: m.day, time: m.time, court: m.court } }); ops.push({ type: "log", text: `${label(occ)} moved from ${where(day, time, court)} to ${from} (swapped)` }); }
        Object.assign(fields, { day, time, court });
        ops.push({ type: "log", text: `${label(m)} moved from ${from} to ${where(day, time, court)}${note ? " (" + note + ")" : ""}` });
      }
    }
    if (Object.keys(fields).length) ops.unshift({ type: "update", col: "matches", id: m.id, fields });
    if (ops.length) save(ops);
  };
  dlg.showModal();
}
function openKO(id) {
  const k = S.ko.find(x => x.id === id), g = k.g || [], admin = isAdmin();
  const v = i => fin(g[i]) ? g[i] : "";
  dlg.innerHTML = `<form method="dialog" class="dlg" novalidate><h3>${CATN[k.cat]} ${k.label}</h3><div class="note">${esc(resolve(k.a))} vs ${esc(resolve(k.b))}</div>
  ${[0, 1, 2].map(i => `<label>Game ${i + 1}${i === 2 ? " (only if one game all)" : ""}</label><div class="grid2"><input type="number" inputmode="numeric" min="0" max="30" id="g${i}a" value="${v(2 * i)}" placeholder="Team 1"><input type="number" inputmode="numeric" min="0" max="30" id="g${i}b" value="${v(2 * i + 1)}" placeholder="Team 2"></div>`).join("")}
  ${admin ? `<div class="grid2"><div><label>Time</label><select id="kt">${KOTIMES.map(t => `<option${k.time === t ? " selected" : ""}>${t}</option>`).join("")}</select></div><div><label>Court</label><select id="kc"><option value="1"${k.court === 1 ? " selected" : ""}>Court 1</option><option value="2"${k.court === 2 ? " selected" : ""}>Court 2</option></select></div></div>` : ""}
  <div class="acts" style="justify-content:flex-start;margin-top:8px"><button type="button" class="btn" id="kclr">Clear all games (not played yet)</button></div>
  <div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn pri" value="apply">Save</button></div></form>`;
  dlg.querySelector("#kclr").addEventListener("click", () => dlg.querySelectorAll("input[type=number]").forEach(i => i.value = ""));
  dlg.onclose = () => {
    if (dlg.returnValue !== "apply") return; const q = s => dlg.querySelector(s);
    const ng = [0, 1, 2].flatMap(i => [num(q(`#g${i}a`).value), num(q(`#g${i}b`).value)]);
    const ops = [], fields = {};
    if (JSON.stringify(ng) !== JSON.stringify(g.length ? g : [null, null, null, null, null, null])) fields.g = ng;
    if (ng.every(v => v === null) && k.toss) fields.toss = "";
    if (admin) { const nt = q("#kt").value, nc = +q("#kc").value; if (nt !== k.time || nc !== k.court) { fields.time = nt; fields.court = nc; ops.push({ type: "log", text: `${CATN[k.cat]} ${k.label} moved from ${k.time} Court ${k.court} to ${nt} Court ${nc}` }); } }
    if (Object.keys(fields).length) ops.unshift({ type: "update", col: "ko", id: k.id, fields });
    if (ops.length) save(ops);
  };
  dlg.showModal();
}

function openAdd(day) {
  const pools = [];
  for (const c of ["AB", "CD"]) for (const p of Object.keys(S.meta.teams[c]).sort()) pools.push([`${c}|${p}`, `${CATN[c]}, Pool ${p}`]);
  dlg.innerHTML = `<form method="dialog" class="dlg" novalidate><h3>Add a match to ${esc(dayLabel(day))}</h3>
  <div class="note">Use this for replays, tie-breakers or rescheduled games that need a new slot. Extra matches show on the fixtures but don’t count in the pool standings. To move an existing league match, tap that match instead.</div>
  <label>Pool</label><select id="ap">${pools.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
  <div class="grid2"><div><label>Team 1</label><select id="a1"></select></div><div><label>Team 2</label><select id="a2"></select></div></div>
  <div class="grid2"><div><label>Time</label><select id="at">${TIMES.map(t => `<option${t === "9:30" ? " selected" : ""}>${t}</option>`).join("")}</select></div><div><label>Court</label><select id="ac"><option value="1">Court 1</option><option value="2">Court 2</option></select></div></div>
  <label for="an">Note (e.g. replay of the 7:00 match)</label><input id="an">
  <div id="achk"></div><div class="acts"><button class="btn" value="cancel">Cancel</button><button class="btn pri" id="aok" value="apply">Add match</button></div></form>`;
  const q = s => dlg.querySelector(s);
  function teams() { const [c, p] = q("#ap").value.split("|"); const opts = S.meta.teams[c][p].map((n, i) => `<option value="${i + 1}">${p}${i + 1} ${esc(n)}</option>`).join(""); q("#a1").innerHTML = opts; q("#a2").innerHTML = opts; q("#a2").selectedIndex = 1; check(); }
  function draft() { const [c, p] = q("#ap").value.split("|"); let t1 = +q("#a1").value, t2 = +q("#a2").value; if (t1 > t2) [t1, t2] = [t2, t1]; return { id: "x" + Date.now().toString(36), cat: c, pool: p, t1, t2, day, time: q("#at").value, court: +q("#ac").value, s1: null, s2: null, note: q("#an").value.trim(), extra: true }; }
  function check() {
    const m = draft(); let html = "", bad = false;
    if (m.t1 === m.t2) { html += `<div class="alert bad">Choose two different teams.</div>`; bad = true; }
    else {
      const occ = S.matches.find(o => o.day === day && o.time === m.time && o.court === m.court);
      if (occ) { html += `<div class="alert bad">${esc(label(occ))} is already on Court ${m.court} at ${m.time}. Pick another time or court.</div>`; bad = true; }
      const r = clashes(m, day, m.time, []);
      r.errs.forEach(e => html += `<div class="alert bad">${esc(e)}</div>`); if (r.errs.length) bad = true;
      r.warns.forEach(e => html += `<div class="alert bad" style="background:var(--surface2);color:var(--ink)">${esc(e)}</div>`);
      if (!bad && !r.warns.length) html += `<div class="alert ok">Slot is free and both teams are available.</div>`;
    }
    q("#achk").innerHTML = html; q("#aok").disabled = bad;
  }
  q("#ap").addEventListener("change", teams); ["#a1", "#a2", "#at", "#ac"].forEach(s => q(s).addEventListener("change", check)); teams();
  dlg.onclose = () => { if (dlg.returnValue !== "apply") return; const m = draft(); const { id, ...fields } = m;
    save([{ type: "set", col: "matches", id, fields }, { type: "log", text: `Extra match added: ${label(m)}, ${where(day, m.time, m.court)}${m.note ? " (" + m.note + ")" : ""}` }], "Match added for everyone"); };
  dlg.showModal();
}

// ---------------- scorer (doubles service tracking) ----------------
let SC = null;
const scLoad = () => { try { SC = JSON.parse(localStorage.getItem("hbt-scorer") || "null"); if (SC && SC.players === undefined) SC = null; } catch (e) { SC = null; } };
const scSave = () => { try { localStorage.setItem("hbt-scorer", JSON.stringify(SC)); } catch (e) {} };
const splitTeam = n => { const i = String(n).indexOf(" & "); return i > 0 ? [n.slice(0, i), n.slice(i + 3)] : [`${n} player 1`, `${n} player 2`]; };
function scNew(ref, a, b, mode, lbl) {
  SC = { ref, a, b, mode, label: lbl, target: mode === "ko" ? 15 : 30, players: [splitTeam(a), splitTeam(b)],
    stage: "toss", setup: { tw: null, tc: null, lt: null, fs: null, fr: null },
    games: [], pts: [0, 0], left: 0, right: [0, 0], servTeam: null, changedEnds: false, hist: [], done: false, toss: "" };
  scSave();
}
const scGamesWon = () => { let a = 0, b = 0; for (const g of SC.games) g[0] > g[1] ? a++ : b++; return [a, b]; };
const tn = i => (i === 0 ? SC.a : SC.b);
// who serves and who receives right now
function scServe() {
  const s = SC.servTeam, o = 1 - s, even = SC.pts[s] % 2 === 0;
  const sp = even ? SC.right[s] : 1 - SC.right[s];
  const rp = even ? SC.right[o] : 1 - SC.right[o];
  return { s, o, sp, rp, court: even ? "right" : "left", server: SC.players[s][sp], receiver: SC.players[o][rp] };
}
function scStartGame(servTeam, fs, fr) {
  SC.servTeam = servTeam; SC.right[servTeam] = fs; SC.right[1 - servTeam] = fr; SC.stage = "play";
}
function scPoint(i) {
  if (SC.done || SC.stage !== "play") return;
  SC.hist.push(JSON.stringify({ pts: SC.pts, games: SC.games, left: SC.left, right: SC.right, servTeam: SC.servTeam, changedEnds: SC.changedEnds, done: SC.done, stage: SC.stage, setup: SC.setup }));
  SC.pts = [...SC.pts]; SC.pts[i]++; SC.right = [...SC.right];
  if (i === SC.servTeam) SC.right[i] = 1 - SC.right[i];   // serving side wins: server switches service court
  else SC.servTeam = i;                                   // receiving side wins: they serve, nobody moves
  if (SC.mode === "league" && !SC.changedEnds && Math.max(...SC.pts) === 15) { SC.changedEnds = true; SC.left = 1 - SC.left; SC.flash = "Change ends"; }
  if (SC.pts[i] >= SC.target) {
    SC.games = [...SC.games, SC.pts]; const [wa, wb] = scGamesWon();
    if (SC.mode === "league" || wa === 2 || wb === 2) { SC.done = true; SC.flash = "Match over"; }
    else { SC.pts = [0, 0]; SC.left = 1 - SC.left; SC.stage = "newgame"; SC.setup = { fs: null, fr: null, winner: i }; SC.flash = `Game ${SC.games.length} to ${tn(i)}. Change ends`; }
  }
  scSave(); render(); try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
}
function scUndo() { if (!SC || !SC.hist.length) return; Object.assign(SC, JSON.parse(SC.hist.pop())); SC.flash = ""; scSave(); render(); }
function scResultText() {
  const gs = SC.games.map(g => `${g[0]}–${g[1]}`).join(", ");
  const w = SC.mode === "ko" ? (scGamesWon()[0] > scGamesWon()[1] ? SC.a : SC.b) : (SC.games[0][0] > SC.games[0][1] ? SC.a : SC.b);
  return `${SC.label || "Match"}: ${SC.a} vs ${SC.b}, ${gs}. Winner: ${w}.${SC.toss ? " " + SC.toss : ""}`;
}
const pick = (field, value, labelTxt, on) => `<button class="chip" style="flex:1 1 45%;padding:10px 8px;font-size:15px" aria-pressed="${on}" data-ts="${field}|${value}">${esc(labelTxt)}</button>`;
function renderToss() {
  const u = SC.setup, P = SC.players;
  const servTeam = u.tw === null || u.tc === null ? null : (u.tc === "serve" ? u.tw : 1 - u.tw);
  let h = `<div class="sc-head"><h2>${esc(SC.label || "Free game")}</h2><span class="note">${esc(SC.a)} vs ${esc(SC.b)}</span></div>`;
  h += `<label>1. Who won the toss?</label><div class="chips" style="flex-wrap:wrap">${pick("tw", 0, SC.a, u.tw === 0)}${pick("tw", 1, SC.b, u.tw === 1)}</div>`;
  if (u.tw !== null) h += `<label>2. ${esc(tn(u.tw))} chose</label><div class="chips" style="flex-wrap:wrap">${pick("tc", "serve", "To serve first", u.tc === "serve")}${pick("tc", "court", "Court side", u.tc === "court")}</div>
    <p class="note" style="margin:4px 0 0">${u.tc === "serve" ? `So ${esc(tn(1 - u.tw))} choose the court side.` : u.tc === "court" ? `So ${esc(tn(1 - u.tw))} serve first.` : "The other team gets the remaining choice."}</p>`;
  if (servTeam !== null) {
    h += `<label>3. Which team is on the LEFT of your screen? (as you face the court)</label><div class="chips" style="flex-wrap:wrap">${pick("lt", 0, SC.a, u.lt === 0)}${pick("lt", 1, SC.b, u.lt === 1)}</div>`;
    h += `<label>4. Who serves first for ${esc(tn(servTeam))}? (from the right service court)</label><div class="chips" style="flex-wrap:wrap">${pick("fs", 0, P[servTeam][0], u.fs === 0)}${pick("fs", 1, P[servTeam][1], u.fs === 1)}</div>`;
    h += `<label>5. Who receives first for ${esc(tn(1 - servTeam))}? (standing in the right service court)</label><div class="chips" style="flex-wrap:wrap">${pick("fr", 0, P[1 - servTeam][0], u.fr === 0)}${pick("fr", 1, P[1 - servTeam][1], u.fr === 1)}</div>`;
  }
  const ready = servTeam !== null && u.lt !== null && u.fs !== null && u.fr !== null;
  h += `<div class="sc-tools"><button class="btn pri" id="scStart" ${ready ? "" : "disabled"}>Start match</button></div><div class="sc-tools"><button class="btn" id="scEnd">Cancel and choose another match</button></div>`;
  return h;
}
function renderNewGame() {
  const u = SC.setup, s = u.winner, P = SC.players, [wa, wb] = scGamesWon();
  let h = `<div class="sc-head"><h2>Game ${SC.games.length + 1}</h2><span class="note">Games: ${SC.games.map(g => g[0] + "–" + g[1]).join(", ")} (${wa}–${wb})</span></div>`;
  if (SC.flash) { h += `<div class="banner" role="status">${esc(SC.flash)}</div>`; SC.flash = ""; scSave(); }
  h += `<p class="note">${esc(tn(s))} won the last game, so they serve first. Teams have changed ends on your screen.</p>`;
  h += `<label>Who serves first for ${esc(tn(s))}?</label><div class="chips" style="flex-wrap:wrap">${pick("fs", 0, P[s][0], u.fs === 0)}${pick("fs", 1, P[s][1], u.fs === 1)}</div>`;
  h += `<label>Who receives first for ${esc(tn(1 - s))}?</label><div class="chips" style="flex-wrap:wrap">${pick("fr", 0, P[1 - s][0], u.fr === 0)}${pick("fr", 1, P[1 - s][1], u.fr === 1)}</div>`;
  h += `<div class="sc-tools"><button class="btn pri" id="ngStart" ${u.fs !== null && u.fr !== null ? "" : "disabled"}>Start game ${SC.games.length + 1}</button><button class="btn" id="scUndo">Undo last point</button></div>`;
  return h;
}
function renderScorer() {
  if (!SC) {
    const d = view.scDay || todayDay();
    let h = `<p class="note" style="margin:0 0 8px">Pick a match to score. You’ll record the toss and first server, then tap a team’s side for each rally they win.</p><label for="scDay">Day</label><select id="scDay">${S.meta.days.map((_, i) => `<option value="${i + 1}"${d == i + 1 ? " selected" : ""}>Day ${i + 1}, ${dayLabel(i + 1)}</option>`).join("")}<option value="ko"${d === "ko" ? " selected" : ""}>Knockouts, ${fmtDate(S.meta.koDate)}</option></select><div class="pick" style="margin-top:10px">`;
    if (d === "ko") for (const k of S.ko) h += `<button class="btn" data-scko="${k.id}">${k.time} ${CATN[k.cat]} ${k.label}: ${esc(resolve(k.a))} vs ${esc(resolve(k.b))}</button>`;
    else for (const m of S.matches.filter(m => m.day === +d).sort((a, b) => mins(a.time) - mins(b.time) || a.court - b.court)) h += `<button class="btn" data-scm="${m.id}">${m.time} C${m.court}: ${esc(label(m))}${m.extra ? " (extra)" : ""}${done(m) ? " (played)" : ""}</button>`;
    return h + `</div><label style="margin-top:16px">Or a friendly game</label><button class="btn" data-scfree="1">Start a free game</button>`;
  }
  if (SC.stage === "toss") return renderToss();
  if (SC.stage === "newgame" && !SC.done) return renderNewGame();
  const L = SC.left, R = 1 - L, gw = scGamesWon(), sv = scServe();
  const players = i => [0, 1].map(p => {
    const inRight = SC.right[i] === p, court = inRight ? "R" : "L";
    const isS = !SC.done && sv.s === i && sv.sp === p, isR = !SC.done && sv.o === i && sv.rp === p;
    return `<div style="display:flex;gap:6px;align-items:center;justify-content:center;font:600 14px Barlow,sans-serif;margin-top:4px;${isS ? "background:rgba(255,255,255,.28);border-radius:999px;padding:2px 8px" : ""}"><span style="font-size:11px;background:rgba(0,0,0,.25);border-radius:4px;padding:0 5px">${court}</span>${esc(SC.players[i][p])}${isS ? " 🏸" : isR ? ' <span style="font-size:11px;opacity:.85">(receives)</span>' : ""}</div>`;
  }).sort(() => 0).join("");
  const side = (i, cls) => `<button class="side ${cls}" data-pt="${i}" ${SC.done ? "disabled" : ""}><div class="tn">${esc(tn(i))}</div><div class="pts">${SC.pts[i]}</div><div class="gw">${SC.mode === "ko" ? "Games won: " + gw[i] : ""}</div>${players(i)}</button>`;
  let h = `<div class="sc-head"><h2>${esc(SC.label || "Free game")}</h2><span class="note">${SC.mode === "ko" ? "Best of three, each game to 15" : "One game to 30, change ends at 15"}</span></div>`;
  if (SC.games.length && SC.mode === "ko") h += `<div class="note">Games: ${SC.games.map(g => g[0] + "–" + g[1]).join(", ")}</div>`;
  if (SC.flash) h += `<div class="banner" role="status">${esc(SC.flash)}</div>`;
  if (!SC.done) h += `<div class="alert ok" style="font-size:15px;margin-top:8px">🏸 <b>${esc(sv.server)}</b> serves from the <b>${sv.court}</b> court to <b>${esc(sv.receiver)}</b> · ${SC.pts[sv.s]}–${SC.pts[sv.o]}</div>`;
  h += SC.done ? `<div class="alert ok" style="font-size:16px">${esc(scResultText())}</div>` : `<div class="sc-wrap">${side(L, "l")}${side(R, "r")}</div>`;
  h += `<div class="sc-tools"><button class="btn" id="scUndo" ${SC.hist.length ? "" : "disabled"}>Undo last rally</button>${SC.done ? "" : '<button class="btn" id="scSwap">Swap sides on screen</button>'}</div>`;
  if (SC.toss) h += `<p class="note" style="margin-top:6px">${esc(SC.toss)}</p>`;
  if (SC.done) h += `<div class="sc-tools"><button class="btn" id="scCopy">Copy result for WhatsApp</button>${isScorer() && SC.ref ? '<button class="btn acc" id="scSaveRes">Save result for everyone</button>' : ""}</div>`;
  h += `<div class="sc-tools"><button class="btn" id="scEnd">${SC.done ? "Score another match" : "Stop and choose another match"}</button></div>`;
  if (SC.flash) { SC.flash = ""; scSave(); }
  return h;
}
function scSetup(field, value) {
  const u = SC.setup; u[field] = value === "serve" || value === "court" ? value : +value;
  if (field === "tw" || field === "tc") { u.fs = null; u.fr = null; }
  scSave(); render();
}
function scBegin() {
  const u = SC.setup, servTeam = u.tc === "serve" ? u.tw : 1 - u.tw;
  SC.left = u.lt; scStartGame(servTeam, u.fs, u.fr);
  SC.toss = `Toss: ${tn(u.tw)} won and chose ${u.tc === "serve" ? "to serve" : "court side"}. First serve: ${SC.players[servTeam][u.fs]} to ${SC.players[1 - servTeam][u.fr]}.`;
  scSave(); render();
}
function scBeginGame() { const u = SC.setup; SC.hist.push(JSON.stringify({ pts: SC.pts, games: SC.games, left: SC.left, right: SC.right, servTeam: SC.servTeam, changedEnds: SC.changedEnds, done: SC.done, stage: SC.stage, setup: { ...u, fs: null, fr: null } })); scStartGame(u.winner, u.fs, u.fr); scSave(); render(); }
async function scSaveResult() {
  const [kind, id] = SC.ref.split("|");
  const prev = kind === "m" ? S.matches.find(x => x.id === id) : null;
  if (prev && done(prev) && !confirm(`This match already has a result (${prev.s1}–${prev.s2}). Replace it with the new score?`)) return;
  const toss = SC.toss || "";
  if (kind === "m") await save([{ type: "update", col: "matches", id, fields: { s1: SC.games[0][0], s2: SC.games[0][1], toss } }], "Result saved for everyone");
  else { const g = [0, 1, 2].flatMap(i => SC.games[i] ? [...SC.games[i]] : [null, null]); await save([{ type: "update", col: "ko", id, fields: { g, toss } }], "Result saved for everyone"); }
  SC = null; scSave(); view.tab = "fixtures"; render();
}

// ---------------- events ----------------
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; render(); });
window.addEventListener("appinstalled", () => { installEvt = null; render(); });
window.addEventListener("online", render); window.addEventListener("offline", render);
document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (t.id === "signin") { try { await store.signIn(); } catch (err) { alert("Sign-in failed: " + (err.message || err)); } return; }
  if (t.id === "signout") { await store.signOut(); return; }
  if (t.id === "seed") { t.disabled = true; try { await store.seed(); toast("Fixtures loaded"); } catch (err) { alert("Couldn’t load fixtures: " + (err.code || err.message)); t.disabled = false; } return; }
  if (t.id === "install" && installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (x) {} installEvt = null; render(); return; }
  if (t.id === "hintOff") { try { sessionStorage.setItem("hbt-hint-off", "1"); } catch (x) {} render(); return; }
  if (t.id === "pAdd") { const em = document.getElementById("pEmail").value.trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { alert("Enter a valid email address."); return; } try { const rl = document.getElementById("pRole").value; await store.setRole(em, rl); await store.commit([{ type: "log", text: `${em} added as ${rl === "admin" ? "Admin" : "Scorer"}`, kind: "people", changes: [] }]); toast("Added " + em); } catch (err) { alert("Couldn’t add: " + (err.code || err.message)); } return; }
  if (d.rm) { if (confirm(`Remove ${d.rm}?`)) { try { await store.removeRole(d.rm); await store.commit([{ type: "log", text: `${d.rm} removed as organiser`, kind: "people", changes: [] }]); } catch (err) { alert("Couldn’t remove: " + (err.code || err.message)); } } return; }
  if (d.tab) { view.tab = d.tab; render(); setHash(); window.scrollTo(0, 0); return; }
  if (d.day) { view.day = d.day === "ko" ? "ko" : +d.day; render(); setHash(); return; }
  if (d.cat) { view.cat = d.cat; render(); return; }
  if (d.logf) { view.logf = d.logf; render(); return; }
  if (d.undo) { await revertLog(d.undo); return; }
  if (d.add) { openAdd(+d.add); return; }
  if (d.edit) { openEdit(d.edit); return; }
  if (d.ko) { openKO(d.ko); return; }
  if (d.pt != null) { scPoint(+d.pt); return; }
  if (d.scm) { const m = S.matches.find(x => x.id === d.scm); scNew("m|" + m.id, tname(m.cat, m.pool, m.t1), tname(m.cat, m.pool, m.t2), "league", `${CATN[m.cat]}, Pool ${m.pool}, ${m.time} Court ${m.court}`); render(); return; }
  if (d.scko) { const k = S.ko.find(x => x.id === d.scko); scNew("k|" + k.id, resolve(k.a), resolve(k.b), "ko", `${CATN[k.cat]} ${k.label}`); render(); return; }
  if (d.scfree) { const a = prompt("Team on the left", "Team 1"); if (a === null) return; const b = prompt("Team on the right", "Team 2"); if (b === null) return; const ko = confirm("Best of three games to 15?\nOK = best of three, Cancel = one game to 30"); scNew(null, a || "Team 1", b || "Team 2", ko ? "ko" : "league", "Free game"); render(); return; }
  if (t.id === "scUndo") { scUndo(); return; }
  if (t.id === "scSwap") { SC.left = 1 - SC.left; scSave(); render(); return; }
  if (d.ts) { const [f, v] = d.ts.split("|"); scSetup(f, v); return; }
  if (t.id === "scStart") { scBegin(); return; }
  if (t.id === "ngStart") { scBeginGame(); return; }
  if (t.id === "scCopy") { const txt = scResultText(); try { await navigator.clipboard.writeText(txt); toast("Result copied. Paste it into WhatsApp."); } catch (err) { prompt("Copy this result:", txt); } return; }
  if (t.id === "scSaveRes") { await scSaveResult(); return; }
  if (t.id === "scEnd") { if (SC.done || confirm("Stop scoring this match? The score so far will be lost.")) { SC = null; scSave(); render(); } return; }
});
document.addEventListener("change", e => {
  if (e.target.id === "scDay") { view.scDay = e.target.value === "ko" ? "ko" : +e.target.value; render(); }
  if (e.target.id === "teamSel") { view.team = e.target.value; try { localStorage.setItem("hbt-team", view.team); } catch (x) {} render(); }
});
function setHash() { const tok = view.tab === "fixtures" ? (view.day === "ko" ? "ko" : "d" + view.day) : view.tab; try { history.replaceState(null, "", "#" + tok); } catch (e) {} }
function fromHash() { const h = (location.hash || "").slice(1); if (/^d[1-7]$/.test(h)) { view.tab = "fixtures"; view.day = +h.slice(1); } else if (h === "ko") { view.tab = "fixtures"; view.day = "ko"; } else if (["scorer", "standings", "knockouts", "teams", "rules", "changes", "people"].includes(h)) view.tab = h; }

// ---------------- start ----------------
try { view.team = localStorage.getItem("hbt-team") || ""; } catch (e) {}
scLoad(); fromHash();
let store;
try { store = DEMO ? demoStore() : await firebaseStore(); }
catch (e) { console.error(e); document.getElementById("main").innerHTML = `<div class="alert bad">Couldn’t connect. Check your internet connection and the settings in config.js.</div>`; }
if (store) {
  let pend = false;
  const schedule = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; if (!dlg.open) render(); }); };
  dlg.addEventListener("close", () => setTimeout(render, 0));
  store.listen(schedule);
  store.onAuth((email, role, name) => { me = { email, role, name }; render(); });
}
