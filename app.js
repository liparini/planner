// ===== FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, signInWithPopup,
  getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbVrUEMMQLIB-HaClqxmLMiG39xSJstUs",
  authDomain: "planner-6e747.firebaseapp.com",
  projectId: "planner-6e747",
  storageBucket: "planner-6e747.firebasestorage.app",
  messagingSenderId: "212295454552",
  appId: "1:212295454552:web:6b36242daaf784d2bddf2d"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const provider = new GoogleAuthProvider();

// ===== STATE =====
let currentUser = null;
let activities = [], birthdays = [], notifications = [];
let unsubActivities = null, unsubBirthdays = null;
let categoryFilter = "all", statusFilter = "all";
let viewMode = "day", cursorDate = new Date();
let bdayViewMonth = new Date().getMonth(), bdayViewYear = new Date().getFullYear();
let recognition = null, isListening = false;
let editingActivityId = null, editingBdayId = null;
let notifCheckInterval = null;

// WhatsApp config — dual mode: "auto" (CallMeBot API) or "manual" (wa.me link)
function getWAConfig() {
  return JSON.parse(localStorage.getItem("wa_config") || "{}");
}
function setWAConfig(cfg) {
  localStorage.setItem("wa_config", JSON.stringify(cfg));
}

// CALLMEBOT_NUMBER — the number users send the activation message to
const CALLMEBOT_NUMBER = "34644829807";
const CALLMEBOT_ACTIVATION_MSG = "I allow callmebot to send me messages";

// Build the wa.me link that opens WhatsApp with message pre-filled
function buildWaLink(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

// Update the activate link dynamically as user types their phone number
window.updateActivateLink = function() {
  const phone = $("wa-phone")?.value.trim().replace(/\D/g,"") || "";
  const link = $("wa-activate-link");
  if (!link) return;
  // Link opens WhatsApp to the CallMeBot number with activation message
  link.href = buildWaLink(CALLMEBOT_NUMBER, CALLMEBOT_ACTIVATION_MSG);
};

async function sendWhatsApp(message) {
  const cfg = getWAConfig();
  if (!cfg.phone) return;

  if (cfg.mode === "manual") {
    // Open WhatsApp with message pre-filled — user just taps Send
    const link = buildWaLink(cfg.phone, message);
    window.open(link, "_blank");
    return;
  }

  // Auto mode: CallMeBot API
  if (!cfg.apikey) return;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cfg.phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(cfg.apikey)}`;
  try { await fetch(url, { mode: "no-cors" }); } catch(e) { /* fire and forget */ }
}

const COLORS = ["#2563eb","#16a34a","#d4537e","#d85a30","#6d28d9","#b45309","#0f766e","#be185d","#3730a3","#dc2626"];
const AVATAR_COLORS = ["#2563eb","#16a34a","#d4537e","#6d28d9","#b45309","#0f766e","#be185d","#3730a3"];
const CAT_LABELS = {trabalho:"Trabalho",saude:"Saúde",pessoal:"Pessoal",estudo:"Estudo",lazer:"Lazer",viagem:"Viagem",shows:"Shows",outro:"Outro"};
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MONTHS_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DAYS_PT = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.8 0 10.9-2 14.9-5.3l-6.9-5.7C29.9 37 27.1 38 24 38c-5.8 0-10.8-3.9-12.6-9.3l-7 5.4C8 40.1 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.1 5.4-5.7 7l6.9 5.7C41.8 37.5 45 31.3 45 24c0-1.3-.2-2.7-.5-4z"/></svg> Entrar com Google`;

// ===== DOM HELPERS =====
const $ = id => document.getElementById(id);

// ===== AUTH — persistent login =====
// Set LOCAL persistence so the session survives page refreshes and tab closes
setPersistence(auth, browserLocalPersistence).catch(() => {});

// Show a loading overlay while Firebase resolves the session
$("login-screen").innerHTML += `<div id="auth-loading" style="position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;z-index:200"><div style="font-size:32px">📅</div><div style="font-size:14px;color:var(--text2)">Carregando...</div></div>`;

$("google-login-btn").addEventListener("click", async () => {
  try {
    $("google-login-btn").disabled = true;
    $("google-login-btn").textContent = "Entrando...";
    // Use popup first; fall back to redirect (popup blocked on some mobile browsers)
    try {
      await signInWithPopup(auth, provider);
    } catch(popupErr) {
      if (popupErr.code === "auth/popup-blocked" || popupErr.code === "auth/popup-closed-by-user") {
        await signInWithRedirect(auth, provider);
      } else { throw popupErr; }
    }
  } catch(e) {
    $("google-login-btn").disabled = false;
    $("google-login-btn").innerHTML = GOOGLE_SVG;
    showFeedback("Erro ao entrar. Tente novamente.", "error");
  }
});

$("logout-btn").addEventListener("click", async () => {
  if (!confirm("Deseja realmente sair?")) return;
  if (unsubActivities) unsubActivities();
  if (unsubBirthdays) unsubBirthdays();
  clearInterval(notifCheckInterval);
  await signOut(auth);
});

// Handle redirect result (when returning from Google auth redirect)
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, user => {
  // Hide loading overlay
  const loading = $("auth-loading");
  if (loading) loading.remove();

  if (user) {
    currentUser = user;
    $("login-screen").classList.add("hidden");
    $("app-screen").classList.remove("hidden");
    $("user-avatar").src = user.photoURL || "";
    $("user-name").textContent = user.displayName?.split(" ")[0] || "Usuário";
    $("app-date").textContent = new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    loadActivities();
    loadBirthdays();
    loadWASettings();
    requestNotificationPermission();
    setTimeout(() => { checkNotifications(); checkBirthdayNotifications(); }, 2000);
    notifCheckInterval = setInterval(() => { checkNotifications(); checkBirthdayNotifications(); }, 60000);
  } else {
    currentUser = null; activities = []; birthdays = []; notifications = [];
    $("login-screen").classList.remove("hidden");
    $("app-screen").classList.add("hidden");
    if (unsubActivities) unsubActivities();
    if (unsubBirthdays) unsubBirthdays();
    clearInterval(notifCheckInterval);
    $("google-login-btn").disabled = false;
    $("google-login-btn").innerHTML = GOOGLE_SVG;
  }
});

// ===== TABS =====
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    $(`tab-${tab}`).classList.remove("hidden");
    if (tab === "birthdays") renderBirthdays();
  });
});

// ===== FIRESTORE: ACTIVITIES =====
function actRef() { return collection(db, "users", currentUser.uid, "activities"); }
function actDocRef(id) { return doc(db, "users", currentUser.uid, "activities", id); }

function loadActivities() {
  const q = query(actRef(), orderBy("createdAt","asc"));
  unsubActivities = onSnapshot(q, snap => {
    activities = snap.docs.map(d => ({id:d.id,...d.data()}));
    updateStats(); renderView();
    checkNotifications();
  });
}

async function addActivity(data) {
  const used = activities.map(a => a.color);
  const color = COLORS.find(c => !used.includes(c)) || COLORS[activities.length % COLORS.length];
  await addDoc(actRef(), {...data, active:true, color, createdAt:serverTimestamp()});
}

async function saveActivity(id, data) { await updateDoc(actDocRef(id), data); }
async function deleteActivity(id) { await deleteDoc(actDocRef(id)); }

// ===== FIRESTORE: BIRTHDAYS =====
function bdayRef() { return collection(db, "users", currentUser.uid, "birthdays"); }
function bdayDocRef(id) { return doc(db, "users", currentUser.uid, "birthdays", id); }

function loadBirthdays() {
  unsubBirthdays = onSnapshot(bdayRef(), snap => {
    birthdays = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderBirthdays();
    checkBirthdayNotifications();
    updateStats();
  });
}

async function addBirthday(data) { await addDoc(bdayRef(), {...data, createdAt:serverTimestamp()}); }
async function saveBirthday(id, data) { await updateDoc(bdayDocRef(id), data); }
async function deleteBirthday(id) { await deleteDoc(bdayDocRef(id)); }

// ===== FIRESTORE: NOTIFICATIONS =====
function notifRef() { return collection(db, "users", currentUser.uid, "notifications"); }

async function saveNotification(notif) {
  await addDoc(notifRef(), {...notif, createdAt:serverTimestamp(), read:false});
}

async function loadNotifications() {
  const snap = await getDocs(query(notifRef(), orderBy("createdAt","desc")));
  notifications = snap.docs.map(d => ({id:d.id,...d.data()}));
  updateNotifBadge();
}

async function clearAllNotifications() {
  const snap = await getDocs(notifRef());
  await Promise.all(snap.docs.map(d => deleteDoc(doc(notifRef(), d.id))));
  notifications = [];
  updateNotifBadge();
  renderNotifPanel();
}

// ===== WHATSAPP SETTINGS =====
function loadWASettings() {
  const cfg = getWAConfig();
  const mode = cfg.mode || "auto";

  // Set active tab
  document.querySelectorAll(".wa-tab").forEach(t => t.classList.toggle("active", t.dataset.watab === mode));
  $("watab-auto").classList.toggle("hidden", mode !== "auto");
  $("watab-manual").classList.toggle("hidden", mode !== "manual");

  if ($("wa-phone")) $("wa-phone").value = cfg.phone || "";
  if ($("wa-apikey")) $("wa-apikey").value = cfg.apikey || "";
  if ($("wa-phone-manual")) $("wa-phone-manual").value = cfg.phone || "";

  // Set activate link default
  window.updateActivateLink();
  updateWAStatus();
}

function updateWAStatus() {
  const cfg = getWAConfig();
  const statusEl = $("wa-status");
  if (!statusEl) return;
  if (cfg.phone && (cfg.mode === "manual" || cfg.apikey)) {
    const modeLabel = cfg.mode === "manual" ? "Manual (wa.me)" : "Automático (CallMeBot)";
    statusEl.textContent = `✅ Configurado — ${modeLabel} — ${cfg.phone}`;
    statusEl.className = "wa-status ok";
  } else {
    statusEl.textContent = "⚠️ Número não configurado";
    statusEl.className = "wa-status warn";
  }
}

// Tab switching inside WA modal
document.querySelectorAll(".wa-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.watab;
    document.querySelectorAll(".wa-tab").forEach(b => b.classList.toggle("active", b === btn));
    $("watab-auto").classList.toggle("hidden", tab !== "auto");
    $("watab-manual").classList.toggle("hidden", tab !== "manual");
  });
});
function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function showBrowserNotification(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4c5.png" });
  }
}

// Check activity notifications
async function checkNotifications() {
  if (!currentUser) return;
  const now = new Date();
  const fired = JSON.parse(localStorage.getItem(`notif_fired_${currentUser.uid}`) || "{}");

  for (const a of activities) {
    if (!a.active || !a.date || !a.time || a.notifyBefore === "" || a.notifyBefore === undefined) continue;
    const actDateTime = new Date(`${a.date}T${a.time}`);
    const notifyAt = new Date(actDateTime.getTime() - (parseInt(a.notifyBefore) || 0) * 60000);
    const key = `act_${a.id}_${a.date}_${a.time}`;
    if (fired[key]) continue;
    const diffMin = (notifyAt - now) / 60000;
    if (diffMin <= 0 && diffMin > -60) {
      fired[key] = true;
      localStorage.setItem(`notif_fired_${currentUser.uid}`, JSON.stringify(fired));
      const label = parseInt(a.notifyBefore) === 0 ? "agora" : `em ${a.notifyBefore >= 60 ? (a.notifyBefore/60)+"h" : a.notifyBefore+"min"}`;
      const msgWA = `📋 *Lembrete do Planner*\n\n*${a.name}*\n🗓 ${fmtDisplayDate(a.date)} às ${a.time}${a.description?"\n📝 "+a.description:""}`;
      showBrowserNotification(`📋 ${a.name}`, `Agendado para ${a.time} — ${fmtDisplayDate(a.date)}`);
      await sendWhatsApp(msgWA);
      await saveNotification({ type:"activity", title:a.name, sub:`${fmtDisplayDate(a.date)} às ${a.time}`, icon:"📋", label });
      await loadNotifications();
    }
  }
}

// Check birthday notifications
async function checkBirthdayNotifications() {
  if (!currentUser) return;
  const now = new Date();
  const todayM = now.getMonth() + 1, todayD = now.getDate();
  const fired = JSON.parse(localStorage.getItem(`bday_fired_${currentUser.uid}`) || "{}");
  const yearKey = now.getFullYear();

  for (const b of birthdays) {
    const advanceDays = parseInt(b.notifyDaysBefore ?? 1);
    const bdayThisYear = new Date(now.getFullYear(), b.month - 1, b.day);
    const notifyDate = new Date(bdayThisYear); notifyDate.setDate(bdayThisYear.getDate() - advanceDays);
    const key = `bday_${b.id}_${yearKey}`;
    if (fired[key]) continue;
    const diffDays = Math.round((notifyDate - now) / 86400000);
    if (diffDays <= 0 && diffDays > -1) {
      fired[key] = true;
      localStorage.setItem(`bday_fired_${currentUser.uid}`, JSON.stringify(fired));
      const isToday = b.month === todayM && b.day === todayD;
      const sub = isToday ? "Hoje é o aniversário!" : `Aniversário em ${advanceDays} dia${advanceDays>1?"s":""}`;
      const age = b.year ? ` — ${yearKey - b.year} anos` : "";
      const msgWA = isToday
        ? `🎂 *Aniversário hoje!*\n\n*${b.name}*${age}\n🎉 Não esqueça de parabenizar!`
        : `🎈 *Lembrete de aniversário*\n\n*${b.name}* faz aniversário em *${advanceDays} dia${advanceDays>1?"s":""}*${age}\n📅 ${String(b.day).padStart(2,"0")}/${String(b.month).padStart(2,"0")}`;
      showBrowserNotification(`🎂 ${b.name}`, sub);
      await sendWhatsApp(msgWA);
      await saveNotification({ type:"birthday", title:b.name, sub, icon:"🎂", label:isToday?"hoje":`${advanceDays}d` });
      await loadNotifications();
    }
  }
}

function updateNotifBadge() {
  const unread = notifications.filter(n => !n.read).length;
  const badge = $("notif-badge");
  if (unread > 0) { badge.textContent = unread > 9 ? "9+" : unread; badge.classList.remove("hidden"); }
  else badge.classList.add("hidden");
}

// ===== NOTIFICATION PANEL =====
$("notif-btn").addEventListener("click", async () => {
  await loadNotifications();
  renderNotifPanel();
  $("notif-panel").classList.remove("hidden");
});
$("notif-close").addEventListener("click", () => $("notif-panel").classList.add("hidden"));
$("notif-panel").addEventListener("click", e => { if (e.target === $("notif-panel")) $("notif-panel").classList.add("hidden"); });
$("notif-clear").addEventListener("click", async () => { await clearAllNotifications(); });

function renderNotifPanel() {
  const list = $("notif-list");
  if (notifications.length === 0) {
    list.innerHTML = '<div class="notif-empty">Nenhuma notificação</div>'; return;
  }
  list.innerHTML = notifications.slice(0,30).map(n => `
    <div class="notif-item ${n.read?"":(n.type==="birthday"?"bday-notif":"unread")}">
      <div class="notif-icon-lg">${n.icon||"🔔"}</div>
      <div class="notif-content">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-sub">${escHtml(n.sub||"")}</div>
        ${n.createdAt ? `<div class="notif-time">${fmtTimestamp(n.createdAt)}</div>` : ""}
      </div>
    </div>`).join("");
}

function fmtTimestamp(ts) {
  if (!ts) return "";
  try { const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
  catch { return ""; }
}

// ===== TOGGLE ACTIVITY =====
window.toggleActivity = async (id, e) => {
  e.stopPropagation();
  const a = activities.find(x => x.id === id);
  if (!a) return;
  await saveActivity(id, {active:!a.active});
  showFeedback(`"${a.name}" ${!a.active?"ativada":"inativada"}.`, !a.active?"success":"info");
};

// ===== STATS =====
function updateStats() {
  $("stat-total").textContent = activities.length;
  $("stat-active").textContent = activities.filter(a=>a.active).length;
  $("stat-inactive").textContent = activities.filter(a=>!a.active).length;
}

// ===== DATE UTILS =====
function toYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseYMD(s) { if(!s)return null; const[y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); }
function isSameDay(a,b) { return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate(); }
function getWeekRange(d) {
  const s=new Date(d); s.setDate(d.getDate()-d.getDay());
  const e=new Date(s); e.setDate(s.getDate()+6); return {start:s,end:e};
}
function dateInRange(ds,start,end) {
  if(!ds)return false; const d=parseYMD(ds);
  return d>=new Date(start.getFullYear(),start.getMonth(),start.getDate())&&d<=new Date(end.getFullYear(),end.getMonth(),end.getDate());
}
function fmtDisplayDate(ds) {
  if(!ds)return ""; const d=parseYMD(ds), t=new Date();
  if(isSameDay(d,t))return "Hoje";
  const tom=new Date(); tom.setDate(t.getDate()+1); if(isSameDay(d,tom))return "Amanhã";
  const yes=new Date(); yes.setDate(t.getDate()-1); if(isSameDay(d,yes))return "Ontem";
  return `${DAYS_PT[d.getDay()]}, ${String(d.getDate()).padStart(2,"0")} ${MONTHS_SHORT[d.getMonth()]}`;
}
function isToday(ds) { return ds&&isSameDay(parseYMD(ds),new Date()); }
function isPast(ds) { if(!ds)return false; const d=parseYMD(ds),t=new Date(); t.setHours(0,0,0,0); return d<t; }

// ===== NAV LABEL =====
function updateNavLabel() {
  const lbl = $("nav-label");
  if(viewMode==="all"){lbl.textContent="Todas as atividades";return;}
  if(viewMode==="day"){const t=new Date();lbl.textContent=isSameDay(cursorDate,t)?"Hoje":`${DAYS_PT[cursorDate.getDay()]}, ${String(cursorDate.getDate()).padStart(2,"0")} de ${MONTHS_PT[cursorDate.getMonth()]}`;return;}
  if(viewMode==="week"){const{start,end}=getWeekRange(cursorDate);lbl.textContent=`${String(start.getDate()).padStart(2,"0")} ${MONTHS_SHORT[start.getMonth()]} – ${String(end.getDate()).padStart(2,"0")} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;return;}
  if(viewMode==="month"){lbl.textContent=`${MONTHS_PT[cursorDate.getMonth()]} ${cursorDate.getFullYear()}`;return;}
  if(viewMode==="year"){lbl.textContent=String(cursorDate.getFullYear());return;}
}

function navigate(dir) {
  if(viewMode==="day") cursorDate.setDate(cursorDate.getDate()+dir);
  else if(viewMode==="week") cursorDate.setDate(cursorDate.getDate()+dir*7);
  else if(viewMode==="month") cursorDate.setMonth(cursorDate.getMonth()+dir);
  else if(viewMode==="year") cursorDate.setFullYear(cursorDate.getFullYear()+dir);
  renderView();
}

$("nav-prev").addEventListener("click", ()=>navigate(-1));
$("nav-next").addEventListener("click", ()=>navigate(1));
$("nav-today").addEventListener("click", ()=>{cursorDate=new Date();renderView();});

document.querySelectorAll(".view-mode-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    viewMode=btn.dataset.view;
    document.querySelectorAll(".view-mode-btn").forEach(b=>b.classList.toggle("active",b===btn));
    const hidden = viewMode==="all";
    ["nav-prev","nav-next","nav-today"].forEach(id=>$(id).style.visibility=hidden?"hidden":"");
    renderView();
  });
});

// ===== FILTER/RENDER =====
function applyFilters(list) {
  return list.filter(a=>{
    if(categoryFilter!=="all"&&a.category!==categoryFilter)return false;
    if(statusFilter==="active"&&!a.active)return false;
    if(statusFilter==="inactive"&&a.active)return false;
    return true;
  });
}

function getViewActivities() {
  let list=applyFilters(activities);
  if(viewMode==="all")return list;
  if(viewMode==="day"){const ds=toYMD(cursorDate);return list.filter(a=>a.date===ds);}
  if(viewMode==="week"){const{start,end}=getWeekRange(cursorDate);return list.filter(a=>a.date&&dateInRange(a.date,start,end));}
  if(viewMode==="month")return list.filter(a=>{if(!a.date)return false;const d=parseYMD(a.date);return d.getFullYear()===cursorDate.getFullYear()&&d.getMonth()===cursorDate.getMonth();});
  if(viewMode==="year")return list.filter(a=>a.date&&parseYMD(a.date).getFullYear()===cursorDate.getFullYear());
  return list;
}

function renderView() {
  updateNavLabel();
  const list=getViewActivities();
  if(list.length===0){
    const msgs={day:"Nenhuma atividade para este dia.",week:"Nenhuma atividade para esta semana.",month:"Nenhuma atividade para este mês.",year:"Nenhuma atividade para este ano.",all:"Nenhuma atividade cadastrada ainda."};
    $("activity-list").innerHTML=`<div class="empty-state">${msgs[viewMode]}</div>`;
    return;
  }
  if(viewMode==="year"){renderYearView(list);return;}
  if(viewMode==="day"){renderDayView(list);return;}
  renderGroupedView(list);
}

function renderDayView(list){
  const sorted=[...list].sort((a,b)=>{if(a.time&&b.time)return a.time.localeCompare(b.time);if(a.time)return -1;if(b.time)return 1;return 0;});
  $("activity-list").innerHTML=`<div class="date-group-items">${sorted.map(cardHTML).join("")}</div>`;
}

function renderGroupedView(list){
  const dated=list.filter(a=>a.date).sort((a,b)=>{if(a.date!==b.date)return a.date.localeCompare(b.date);if(a.time&&b.time)return a.time.localeCompare(b.time);if(a.time)return-1;if(b.time)return 1;return 0;});
  const noDate=list.filter(a=>!a.date);
  const groups={};
  dated.forEach(a=>{if(!groups[a.date])groups[a.date]=[];groups[a.date].push(a);});
  let html="";
  Object.keys(groups).sort().forEach(ds=>{
    const items=groups[ds], today=isToday(ds), past=isPast(ds);
    const dotC=today?"today":past?"past":"future", lblC=today?"today-label":past?"past-label":"";
    html+=`<div class="date-group"><div class="date-group-header"><div class="date-group-dot ${dotC}"></div><div class="date-group-label ${lblC}">${fmtDisplayDate(ds)}</div><div class="date-group-line"></div><div class="date-group-count">${items.length} item${items.length>1?"s":""}</div></div><div class="date-group-items">${items.map(cardHTML).join("")}</div></div>`;
  });
  if(noDate.length>0)html+=`<div class="nodate-group"><div class="date-group-header"><div class="date-group-dot"></div><div class="date-group-label" style="color:var(--text3)">Sem data</div><div class="date-group-line"></div><div class="date-group-count">${noDate.length}</div></div><div class="date-group-items">${noDate.map(cardHTML).join("")}</div></div>`;
  $("activity-list").innerHTML=html;
}

function renderYearView(list){
  const byMonth={};
  list.forEach(a=>{if(!a.date){if(!byMonth["__"])byMonth["__"]=[];byMonth["__"].push(a);return;}const m=parseYMD(a.date).getMonth();if(!byMonth[m])byMonth[m]=[];byMonth[m].push(a);});
  let html="";
  for(let m=0;m<12;m++){const items=byMonth[m];if(!items?.length)continue;const sorted=[...items].sort((a,b)=>{if(a.date!==b.date)return a.date.localeCompare(b.date);if(a.time&&b.time)return a.time.localeCompare(b.time);if(a.time)return-1;if(b.time)return 1;return 0;});html+=`<div class="month-group"><div class="month-group-header">${MONTHS_PT[m]}<span class="month-group-count">${items.length} atividade${items.length>1?"s":""}</span></div><div class="date-group-items">${sorted.map(cardHTML).join("")}</div></div>`;}
  if(byMonth["__"]?.length)html+=`<div class="month-group"><div class="month-group-header">Sem data<span class="month-group-count">${byMonth["__"].length}</span></div><div class="date-group-items">${byMonth["__"].map(cardHTML).join("")}</div></div>`;
  $("activity-list").innerHTML=html;
}

function cardHTML(a){
  const desc=a.description?`<div class="activity-desc">${escHtml(a.description)}</div>`:"";
  const time=a.time?`<span class="activity-time">${a.time}</span>`:"";
  const bell=a.notifyBefore!==""&&a.notifyBefore!==undefined?`<span class="notif-icon">🔔</span>`:"";
  return `<div class="activity-card ${a.active?"":"inactive"}" onclick="openEditActivity('${a.id}')"><div class="activity-dot" style="background:${a.color}"></div><div class="activity-content"><div class="activity-name">${escHtml(a.name)}</div><div class="activity-meta">${time}${bell}<span class="activity-tag tag-${a.category}">${CAT_LABELS[a.category]||"Outro"}</span></div>${desc}</div><span class="status-badge ${a.active?"status-active":"status-inactive"}">${a.active?"ativa":"inativa"}</span><button class="toggle-btn" onclick="toggleActivity('${a.id}',event)" title="${a.active?"Inativar":"Ativar"}">${a.active?"⏸":"▶"}</button></div>`;
}

function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}

// ===== FILTERS =====
$("filter-row").addEventListener("click",e=>{
  const btn=e.target.closest(".filter-btn"); if(!btn)return;
  categoryFilter=btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(b=>b.classList.toggle("active",b===btn));
  renderView();
});
document.querySelectorAll(".status-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    statusFilter=btn.dataset.status;
    document.querySelectorAll(".status-btn").forEach(b=>b.classList.toggle("active",b===btn));
    renderView();
  });
});

// ===== ADD ACTIVITY FORM =====
$("btn-open-add").addEventListener("click",()=>{
  $("add-form").classList.remove("hidden");
  if(viewMode!=="all"&&viewMode!=="year") $("f-date").value=toYMD(cursorDate);
  $("f-name").focus();
  $("btn-open-add").style.display="none";
});

function closeAddForm(){
  $("add-form").classList.add("hidden"); $("btn-open-add").style.display="";
  ["f-name","f-date","f-time","f-desc"].forEach(id=>$(id).value="");
  $("f-category").value="trabalho"; $("f-notify").value="";
}
$("add-form-close").addEventListener("click",closeAddForm);
$("btn-cancel-add").addEventListener("click",closeAddForm);

$("btn-save-add").addEventListener("click",async()=>{
  const name=$("f-name").value.trim(); if(!name){$("f-name").focus();return;}
  try{
    $("btn-save-add").disabled=true; $("btn-save-add").textContent="Salvando...";
    await addActivity({name,category:$("f-category").value,date:$("f-date").value,time:$("f-time").value,description:$("f-desc").value.trim(),notifyBefore:$("f-notify").value});
    showFeedback(`✓ "${name}" cadastrada!`,"success"); closeAddForm();
  }catch(e){showFeedback("Erro ao salvar.","error");}
  finally{$("btn-save-add").disabled=false;$("btn-save-add").textContent="Salvar atividade";}
});

// ===== EDIT ACTIVITY MODAL =====
window.openEditActivity = id => {
  const a=activities.find(x=>x.id===id); if(!a)return;
  editingActivityId=id;
  $("e-name").value=a.name||""; $("e-category").value=a.category||"outro";
  $("e-status").value=String(a.active!==false); $("e-date").value=a.date||"";
  $("e-time").value=a.time||""; $("e-desc").value=a.description||"";
  $("e-notify").value=a.notifyBefore??""
  $("edit-modal").classList.remove("hidden");
};

function closeEditActivity(){$("edit-modal").classList.add("hidden");editingActivityId=null;}
$("modal-close").addEventListener("click",closeEditActivity);
$("btn-cancel-edit").addEventListener("click",closeEditActivity);
$("edit-modal").addEventListener("click",e=>{if(e.target===$("edit-modal"))closeEditActivity();});

$("btn-save-edit").addEventListener("click",async()=>{
  if(!editingActivityId)return;
  const name=$("e-name").value.trim(); if(!name){$("e-name").focus();return;}
  try{
    $("btn-save-edit").disabled=true;
    await saveActivity(editingActivityId,{name,category:$("e-category").value,active:$("e-status").value==="true",date:$("e-date").value,time:$("e-time").value,description:$("e-desc").value.trim(),notifyBefore:$("e-notify").value});
    showFeedback("Atividade atualizada!","success"); closeEditActivity();
  }catch(e){showFeedback("Erro ao salvar.","error");}
  finally{$("btn-save-edit").disabled=false;}
});

$("btn-delete").addEventListener("click",async()=>{
  if(!editingActivityId)return;
  const a=activities.find(x=>x.id===editingActivityId);
  if(!confirm(`Excluir "${a?.name}"?`))return;
  try{await deleteActivity(editingActivityId);showFeedback("Excluída.","info");closeEditActivity();}
  catch(e){showFeedback("Erro ao excluir.","error");}
});

// ===== BIRTHDAY TAB =====
// Fill day dropdowns
function fillDaySelect(selId){
  const sel=$(selId); sel.innerHTML="";
  for(let i=1;i<=31;i++){const o=document.createElement("option");o.value=i;o.textContent=String(i).padStart(2,"0");sel.appendChild(o);}
}
fillDaySelect("b-day"); fillDaySelect("eb-day");

$("btn-open-bday").addEventListener("click",()=>{
  $("bday-form").classList.remove("hidden");
  $("btn-open-bday").style.display="none";
  $("b-name").focus();
});
function closeBdayForm(){$("bday-form").classList.add("hidden");$("btn-open-bday").style.display="";["b-name","b-year","b-note"].forEach(id=>$(id).value="");$("b-day").value=1;$("b-month").value=1;}
$("bday-form-close").addEventListener("click",closeBdayForm);
$("btn-cancel-bday").addEventListener("click",closeBdayForm);

$("btn-save-bday").addEventListener("click",async()=>{
  const name=$("b-name").value.trim(); if(!name){$("b-name").focus();return;}
  try{
    $("btn-save-bday").disabled=true; $("btn-save-bday").textContent="Salvando...";
    await addBirthday({name,relation:$("b-relation").value,day:parseInt($("b-day").value),month:parseInt($("b-month").value),year:$("b-year").value?parseInt($("b-year").value):null,note:$("b-note").value.trim(),notifyDaysBefore:parseInt($("b-notify").value)});
    showFeedback(`🎂 "${name}" adicionado!`,"success"); closeBdayForm();
  }catch(e){showFeedback("Erro ao salvar.","error");}
  finally{$("btn-save-bday").disabled=false;$("btn-save-bday").textContent="Salvar aniversário";}
});

// Birthday month navigation
function renderBdayMonthLabel(){$("bday-month-label").textContent=`${MONTHS_PT[bdayViewMonth]} ${bdayViewYear}`;}
$("bday-prev").addEventListener("click",()=>{bdayViewMonth--;if(bdayViewMonth<0){bdayViewMonth=11;bdayViewYear--;}renderBirthdays();});
$("bday-next").addEventListener("click",()=>{bdayViewMonth++;if(bdayViewMonth>11){bdayViewMonth=0;bdayViewYear++;}renderBirthdays();});

function renderBirthdays(){
  renderBdayMonthLabel();
  renderUpcomingBirthdays();
  const inMonth=birthdays.filter(b=>b.month-1===bdayViewMonth).sort((a,b)=>a.day-b.day);
  if(inMonth.length===0){$("bday-list").innerHTML=`<div class="empty-state">Nenhum aniversário em ${MONTHS_PT[bdayViewMonth]}</div>`;return;}
  const today=new Date(), todayM=today.getMonth()+1, todayD=today.getDate();
  $("bday-list").innerHTML=inMonth.map(b=>bdayCardHTML(b,todayM,todayD)).join("");
}

function renderUpcomingBirthdays(){
  const today=new Date(), todayM=today.getMonth()+1, todayD=today.getDate();
  const upcoming=[];
  birthdays.forEach(b=>{
    const bdayThisYear=new Date(today.getFullYear(),b.month-1,b.day);
    let diff=Math.round((bdayThisYear-today)/86400000);
    if(diff<0){const next=new Date(today.getFullYear()+1,b.month-1,b.day);diff=Math.round((next-today)/86400000);}
    if(diff<=7)upcoming.push({...b,diff});
  });
  upcoming.sort((a,b)=>a.diff-b.diff);
  const el=$("bday-upcoming");
  if(upcoming.length===0){el.classList.add("hidden");return;}
  el.classList.remove("hidden");
  el.innerHTML=`<div class="upcoming-banner"><div class="upcoming-banner-title">🎉 Próximos aniversários</div>${upcoming.map(b=>`<div class="upcoming-item"><span>${b.diff===0?"🎂":"🎈"} ${escHtml(b.name)}</span><span class="upcoming-days">${b.diff===0?"Hoje!":b.diff===1?"Amanhã":`Em ${b.diff} dias`}</span></div>`).join("")}</div>`;
}

function bdayCardHTML(b, todayM, todayD){
  const isTodayBday = b.month===todayM && b.day===todayD;
  const age = b.year ? (new Date().getFullYear() - b.year) : null;
  const ageStr = age ? `<span class="bday-age">· ${age} anos</span>` : "";
  const initial = b.name.charAt(0).toUpperCase();
  const avatarColor = AVATAR_COLORS[b.name.charCodeAt(0) % AVATAR_COLORS.length];
  const noteStr = b.note ? `<div class="bday-note">${escHtml(b.note)}</div>` : "";
  const badge = isTodayBday ? `<span class="bday-today-badge">🎉 Hoje!</span>` : `<span class="bday-days-badge">${String(b.day).padStart(2,"0")} ${MONTHS_SHORT[b.month-1]}</span>`;
  return `<div class="bday-card ${isTodayBday?"today-bday":""}" onclick="openEditBday('${b.id}')">
    <div class="bday-avatar" style="background:${avatarColor}20;color:${avatarColor}">${initial}</div>
    <div class="bday-content">
      <div class="bday-name">${escHtml(b.name)}</div>
      <div class="bday-meta"><span class="relation-tag rel-${b.relation}">${relLabel(b.relation)}</span>${ageStr}</div>
      ${noteStr}
    </div>
    ${badge}
  </div>`;
}

function relLabel(r){return{familia:"Família",amigo:"Amigo(a)",trabalho:"Trabalho",outro:"Outro"}[r]||"Outro";}

// Edit birthday modal
window.openEditBday = id => {
  const b=birthdays.find(x=>x.id===id); if(!b)return;
  editingBdayId=id;
  $("eb-name").value=b.name||""; $("eb-relation").value=b.relation||"outro";
  $("eb-day").value=b.day||1; $("eb-month").value=b.month||1;
  $("eb-year").value=b.year||""; $("eb-note").value=b.note||"";
  $("eb-notify").value=b.notifyDaysBefore??1;
  $("edit-bday-modal").classList.remove("hidden");
};

function closeEditBday(){$("edit-bday-modal").classList.add("hidden");editingBdayId=null;}
$("bday-modal-close").addEventListener("click",closeEditBday);
$("btn-cancel-bday-edit").addEventListener("click",closeEditBday);
$("edit-bday-modal").addEventListener("click",e=>{if(e.target===$("edit-bday-modal"))closeEditBday();});

$("btn-save-bday-edit").addEventListener("click",async()=>{
  if(!editingBdayId)return;
  const name=$("eb-name").value.trim(); if(!name){$("eb-name").focus();return;}
  try{
    $("btn-save-bday-edit").disabled=true;
    await saveBirthday(editingBdayId,{name,relation:$("eb-relation").value,day:parseInt($("eb-day").value),month:parseInt($("eb-month").value),year:$("eb-year").value?parseInt($("eb-year").value):null,note:$("eb-note").value.trim(),notifyDaysBefore:parseInt($("eb-notify").value)});
    showFeedback("Aniversário atualizado!","success"); closeEditBday();
  }catch(e){showFeedback("Erro ao salvar.","error");}
  finally{$("btn-save-bday-edit").disabled=false;}
});

$("btn-delete-bday").addEventListener("click",async()=>{
  if(!editingBdayId)return;
  const b=birthdays.find(x=>x.id===editingBdayId);
  if(!confirm(`Excluir aniversário de "${b?.name}"?`))return;
  try{await deleteBirthday(editingBdayId);showFeedback("Excluído.","info");closeEditBday();}
  catch(e){showFeedback("Erro.","error");}
});

// ===== COMMANDS MODAL =====
$("commands-btn").addEventListener("click",()=>$("commands-modal").classList.remove("hidden"));
$("commands-close").addEventListener("click",()=>$("commands-modal").classList.add("hidden"));
$("commands-modal").addEventListener("click",e=>{if(e.target===$("commands-modal"))$("commands-modal").classList.add("hidden");});

// ===== WHATSAPP SETTINGS MODAL =====
$("wa-settings-btn").addEventListener("click",()=>{
  loadWASettings();
  $("wa-modal").classList.remove("hidden");
});
$("wa-modal-close").addEventListener("click",()=>$("wa-modal").classList.add("hidden"));
$("wa-cancel").addEventListener("click",()=>$("wa-modal").classList.add("hidden"));
$("wa-modal").addEventListener("click",e=>{if(e.target===$("wa-modal"))$("wa-modal").classList.add("hidden");});

$("btn-save-wa").addEventListener("click",()=>{
  // Detect active tab
  const activeTab = document.querySelector(".wa-tab.active")?.dataset.watab || "auto";
  let phone, apikey="", mode=activeTab;

  if (activeTab === "auto") {
    phone = $("wa-phone").value.trim().replace(/\D/g,"");
    apikey = $("wa-apikey").value.trim();
    if (!phone) { showFeedback("Informe seu número de WhatsApp.","error"); return; }
    if (!apikey) { showFeedback("Informe a API Key do CallMeBot.","error"); return; }
  } else {
    phone = $("wa-phone-manual").value.trim().replace(/\D/g,"");
    if (!phone) { showFeedback("Informe seu número de WhatsApp.","error"); return; }
  }

  setWAConfig({ phone, apikey, mode });
  updateWAStatus();
  showFeedback("✅ WhatsApp configurado com sucesso!","success");
  $("wa-modal").classList.add("hidden");
});

$("btn-test-wa").addEventListener("click",async()=>{
  const activeTab = document.querySelector(".wa-tab.active")?.dataset.watab || "auto";
  let phone, apikey="";

  if (activeTab === "auto") {
    phone = $("wa-phone").value.trim().replace(/\D/g,"");
    apikey = $("wa-apikey").value.trim();
    if (!phone || !apikey) { showFeedback("Preencha número e API Key primeiro.","error"); return; }
    setWAConfig({ phone, apikey, mode:"auto" });
  } else {
    phone = $("wa-phone-manual").value.trim().replace(/\D/g,"");
    if (!phone) { showFeedback("Informe seu número primeiro.","error"); return; }
    setWAConfig({ phone, apikey:"", mode:"manual" });
  }

  $("btn-test-wa").disabled=true; $("btn-test-wa").textContent="Enviando...";
  await sendWhatsApp("✅ *Teste do Meu Planner*\n\nWhatsApp configurado! Você receberá lembretes aqui. 📅");
  showFeedback(activeTab==="manual"?"WhatsApp aberto! Confira a mensagem.":"Mensagem enviada! Confira seu WhatsApp.","success");
  $("btn-test-wa").disabled=false; $("btn-test-wa").textContent="📱 Testar";
});

// ===== VOICE =====
function detectCategory(t){
  if(/trabalho|reuni[aã]o|projeto|cliente|sprint|standup/i.test(t))return"trabalho";
  if(/sa[uú]de|academia|m[eé]dic|consulta|treino|corrida|gin[aá]sio/i.test(t))return"saude";
  if(/estudo|curso|aula|leitura|livro|aprender/i.test(t))return"estudo";
  if(/lazer|passeio|parque|piquenique/i.test(t))return"lazer";
  if(/viagem|viajar|trip|tour|excurs/i.test(t))return"viagem";
  if(/show|concer|festival|teatro|espet/i.test(t))return"shows";
  if(/pessoal|família|familia|amigos|hobby/i.test(t))return"pessoal";
  return"outro";
}
function extractTime(t){const m=t.match(/(\d{1,2})[h:](\d{2})?|(\d{1,2})\s*hora/i);if(!m)return"";return`${String(m[1]||m[3]).padStart(2,"0")}:${m[2]||"00"}`;}

async function processCommand(text){
  const t=text.toLowerCase().trim();
  showTranscript(`"${text}"`);

  if(/^(adicionar?|cadastrar?|criar?|nova?)\s+/i.test(t)){
    let name=t.replace(/^(adicionar?|cadastrar?|criar?|nova?)\s+/i,"");
    const catMatch=text.match(/categoria\s+(\w+)/i);
    name=name.replace(/\s*(categoria|cat)\s+\w+/i,"").replace(/\s*às?\s*\d+.*$/i,"").trim();
    const category=catMatch?catMatch[1].toLowerCase():detectCategory(t);
    const time=extractTime(t);
    const displayName=name.charAt(0).toUpperCase()+name.slice(1);
    const date=viewMode==="day"?toYMD(cursorDate):"";
    try{await addActivity({name:displayName,category,time,date,description:"",notifyBefore:""});showFeedback(`✓ "${displayName}" cadastrada!`,"success");}
    catch(e){showFeedback("Erro ao salvar.","error");}
    return;
  }
  if(/^inativar?\s+/i.test(t)){
    const q=t.replace(/^inativar?\s+/i,"").trim();
    const m=activities.find(a=>a.active&&a.name.toLowerCase().includes(q));
    if(m){await saveActivity(m.id,{active:false});showFeedback(`"${m.name}" inativada.`,"info");}
    else showFeedback(`"${q}" não encontrada.`,"error"); return;
  }
  if(/^ativar?\s+/i.test(t)){
    const q=t.replace(/^ativar?\s+/i,"").trim();
    const m=activities.find(a=>!a.active&&a.name.toLowerCase().includes(q));
    if(m){await saveActivity(m.id,{active:true});showFeedback(`"${m.name}" ativada!`,"success");}
    else showFeedback(`"${q}" não encontrada.`,"error"); return;
  }
  if(/ver?\s+hoje/i.test(t)){cursorDate=new Date();setViewMode("day");return;}
  if(/ver?\s+(esta?\s+semana|semana)/i.test(t)){cursorDate=new Date();setViewMode("week");return;}
  if(/ver?\s+(este?\s+m[eê]s|m[eê]s)/i.test(t)){cursorDate=new Date();setViewMode("month");return;}
  if(/ver?\s+(este?\s+ano|ano)/i.test(t)){cursorDate=new Date();setViewMode("year");return;}
  if(/pr[oó]ximo|avan[cç]ar/i.test(t)){navigate(1);return;}
  if(/anterior|voltar/i.test(t)){navigate(-1);return;}
  showFeedback('Comando não reconhecido. Clique em 💬 para ver os comandos.',"error");
}

function setViewMode(mode){
  viewMode=mode;
  document.querySelectorAll(".view-mode-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===mode));
  ["nav-prev","nav-next","nav-today"].forEach(id=>$(id).style.visibility="");
  renderView();
}

function setupSpeech(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR)return false;
  recognition=new SR(); recognition.lang="pt-BR"; recognition.interimResults=true;
  recognition.onstart=()=>{isListening=true;$("mic-btn").classList.add("listening");showTranscript("🎙 Ouvindo...");};
  recognition.onresult=e=>{const tr=e.results[0][0].transcript;showTranscript(`"${tr}"`);if(e.results[0].isFinal){$("mic-btn").classList.remove("listening");$("mic-btn").classList.add("processing");processCommand(tr).finally(()=>$("mic-btn").classList.remove("processing"));}};
  recognition.onend=()=>{isListening=false;$("mic-btn").classList.remove("listening","processing");};
  recognition.onerror=e=>{isListening=false;$("mic-btn").classList.remove("listening","processing");if(e.error==="not-allowed")showFeedback("Permissão de microfone negada.","error");else if(e.error==="no-speech")showFeedback("Nenhuma fala detectada.","info");else showFeedback("Erro no reconhecimento.","error");$("transcript-box").classList.add("hidden");};
  return true;
}

$("mic-btn").addEventListener("click",()=>{
  if(!currentUser)return;
  if(!recognition&&!setupSpeech()){showFeedback("Voz não suportada. Use Chrome ou Edge.","error");return;}
  if(isListening)recognition.stop();else{$("feedback-msg").classList.add("hidden");recognition.start();}
});

function showTranscript(msg){$("transcript-box").textContent=msg;$("transcript-box").classList.remove("hidden");}
function showFeedback(msg,type){$("feedback-msg").textContent=msg;$("feedback-msg").className=`feedback-msg ${type}`;$("feedback-msg").classList.remove("hidden");clearTimeout($("feedback-msg")._t);$("feedback-msg")._t=setTimeout(()=>$("feedback-msg").classList.add("hidden"),3500);}
