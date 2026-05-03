// ===== FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithRedirect, signInWithPopup,
  getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, setDoc, getDocs }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

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
const messaging = getMessaging(fbApp);

// VAPID key for FCM Web Push
const VAPID_KEY = "BEDRWdqPmYPbO-tT8PolcxXFAmATBjk6kkQ7kWrkcrIGk2vH9p1sZlBuNq0vSN_NXM1YuQDeHmhFUJa7tnMqCd4";

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

// ===== WHATSAPP — Twilio via Cloudflare Worker =====
function getWAConfig() { return JSON.parse(localStorage.getItem("wa_config") || "{}"); }
function setWAConfig(cfg) { localStorage.setItem("wa_config", JSON.stringify(cfg)); }

async function sendWhatsApp(message) {
  const cfg = getWAConfig();
  if (!cfg.workerUrl || !cfg.phone) return;
  try {
    await fetch(cfg.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: cfg.phone,
        message,
        appToken: cfg.appToken || ""
      })
    });
  } catch(e) { console.warn("WA send failed:", e); }
}

// ===== WHATSAPP WIZARD UI =====
let waStep = 1;
const WA_TOTAL = 4;

function loadWASettings() {
  const cfg = getWAConfig();
  if ($("wa-sid"))         $("wa-sid").value         = cfg.sid        || "";
  if ($("wa-token"))       $("wa-token").value       = cfg.authToken  || "";
  if ($("wa-from"))        $("wa-from").value        = cfg.from       || "";
  if ($("wa-worker-url"))  $("wa-worker-url").value  = cfg.workerUrl  || "";
  if ($("wa-app-token"))   $("wa-app-token").value   = cfg.appToken   || "";
  if ($("wa-phone"))       $("wa-phone").value       = cfg.phone      || "";
  updateWAStatus();
  goWAStep(cfg.workerUrl && cfg.phone ? 4 : 1, false);
  updateSandboxLink();
}

function updateWAStatus() {
  const cfg = getWAConfig();
  const el = $("wa-status"); if (!el) return;
  if (cfg.workerUrl && cfg.phone) {
    el.textContent = `✅ Configurado — mensagens automáticas ativas`;
    el.className = "wa-status ok";
  } else {
    el.textContent = "⚠️ Não configurado";
    el.className = "wa-status warn";
  }
}

function updateSandboxLink() {
  const from = ($("wa-from")?.value || "").replace(/\D/g,"");
  const codeEl = $("wa-sandbox-code");
  const linkEl = $("wa-sandbox-link");
  if (!codeEl || !linkEl) return;
  // Twilio sandbox join keyword is shown in Twilio console
  // We prompt user to send "join <keyword>" — they get it from console
  // We just deep-link to the Twilio sandbox number
  const sandboxNumber = from || "14155238886";
  const joinMsg = "join <cole-aqui-o-código-do-sandbox>";
  codeEl.textContent = `Veja o código em: console.twilio.com → Messaging → Try WhatsApp`;
  linkEl.href = `https://wa.me/${sandboxNumber}?text=${encodeURIComponent(joinMsg)}`;
}

function goWAStep(step, save) {
  // Save current step data before leaving
  if (save) {
    if (waStep === 1) {
      const cfg = getWAConfig();
      setWAConfig({ ...cfg,
        sid: $("wa-sid").value.trim(),
        authToken: $("wa-token").value.trim(),
        from: $("wa-from").value.trim()
      });
    }
    if (waStep === 2) {
      const cfg = getWAConfig();
      setWAConfig({ ...cfg,
        workerUrl: $("wa-worker-url").value.trim().replace(/\/$/, ""),
        appToken: $("wa-app-token").value.trim()
      });
    }
    if (waStep === 3) {
      const cfg = getWAConfig();
      setWAConfig({ ...cfg, phone: $("wa-phone").value.trim().replace(/\D/g,"") });
      updateWAStatus();
    }
  }

  waStep = Math.max(1, Math.min(WA_TOTAL, step));

  // Show/hide step content
  for (let i = 1; i <= WA_TOTAL; i++) {
    $(`wa-step-${i}`)?.classList.toggle("hidden", i !== waStep);
    $(`pill-${i}`)?.classList.toggle("active", i <= waStep);
  }

  // Nav buttons
  const backBtn = $("wa-back"), nextBtn = $("wa-next");
  backBtn.style.visibility = waStep > 1 ? "visible" : "hidden";
  if (waStep === WA_TOTAL) {
    nextBtn.textContent = "Salvar";
    nextBtn.onclick = () => { saveWA(); $("wa-modal").classList.add("hidden"); };
  } else {
    nextBtn.textContent = "Próximo →";
    nextBtn.onclick = () => { if (validateWAStep()) goWAStep(waStep + 1, true); };
  }

  if (waStep === 3) updateSandboxLink();
}

function validateWAStep() {
  if (waStep === 1) {
    if (!$("wa-sid").value.trim()) { showFeedback("Informe o Account SID.", "error"); return false; }
    if (!$("wa-token").value.trim()) { showFeedback("Informe o Auth Token.", "error"); return false; }
    if (!$("wa-from").value.trim()) { showFeedback("Informe o número do Sandbox.", "error"); return false; }
  }
  if (waStep === 2) {
    if (!$("wa-worker-url").value.trim()) { showFeedback("Informe a URL do Worker.", "error"); return false; }
  }
  if (waStep === 3) {
    if (!$("wa-phone").value.trim()) { showFeedback("Informe seu número.", "error"); return false; }
  }
  return true;
}

function saveWA() {
  const cfg = getWAConfig();
  setWAConfig({ ...cfg,
    phone: $("wa-phone").value.trim().replace(/\D/g,""),
    workerUrl: $("wa-worker-url").value.trim().replace(/\/$/, ""),
    appToken: $("wa-app-token").value.trim(),
    sid: $("wa-sid").value.trim(),
    authToken: $("wa-token").value.trim(),
    from: $("wa-from").value.trim()
  });
  updateWAStatus();
  showFeedback("✅ WhatsApp automático configurado!", "success");
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
    setupPushNotifications();
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

// ===== PUSH NOTIFICATIONS (FCM) =====
async function setupPushNotifications() {
  try {
    // Register service worker
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.register("/planner/firebase-messaging-sw.js");

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    // Get FCM token
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg
    });

    if (token && currentUser) {
      // Save token to Firestore so Cloud Function can use it
      await setDoc(doc(db, "users", currentUser.uid, "tokens", "fcm"), {
        token, updatedAt: serverTimestamp(), platform: navigator.userAgent
      });
    }

    // Handle foreground messages
    onMessage(messaging, payload => {
      const { title, body } = payload.notification || {};
      showFeedback(`🔔 ${title}: ${body}`, "info");
    });

  } catch(e) {
    console.warn("Push setup failed:", e);
  }
}

// Schedule push notifications via Firestore triggers
async function schedulePushNotification(activity) {
  if (!currentUser || !activity.date || !activity.time || activity.notifyBefore === "" || activity.notifyBefore === undefined) return;
  const notifyAt = new Date(`${activity.date}T${activity.time}`);
  notifyAt.setMinutes(notifyAt.getMinutes() - (parseInt(activity.notifyBefore) || 0));
  if (notifyAt <= new Date()) return;

  // Save scheduled notification to Firestore
  await setDoc(doc(db, "users", currentUser.uid, "scheduled", activity.id), {
    title: `📋 ${activity.name}`,
    body: `${fmtDisplayDate(activity.date)} às ${activity.time}${activity.description ? " — " + activity.description : ""}`,
    notifyAt: notifyAt.toISOString(),
    activityId: activity.id,
    updatedAt: serverTimestamp()
  });
}
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
$("wa-settings-btn").addEventListener("click",()=>{ loadWASettings(); $("wa-modal").classList.remove("hidden"); });
$("wa-modal-close").addEventListener("click",()=>$("wa-modal").classList.add("hidden"));
$("wa-cancel").addEventListener("click",()=>$("wa-modal").classList.add("hidden"));
$("wa-modal").addEventListener("click",e=>{if(e.target===$("wa-modal"))$("wa-modal").classList.add("hidden");});
$("wa-back").addEventListener("click",()=>goWAStep(waStep - 1, false));
// wa-next onclick is assigned dynamically inside goWAStep()

$("btn-test-wa")?.addEventListener("click", async () => {
  const btn = $("btn-test-wa"), resultEl = $("wa-test-result");
  btn.disabled = true; btn.textContent = "Enviando...";
  try {
    const cfg = getWAConfig();
    const res = await fetch(cfg.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: cfg.phone, message: "✅ *Teste — Meu Planner*\n\nMensagem automática funcionando! 📅\n\nVocê receberá lembretes assim:\n\n📋 *Reunião de equipe*\n🗓 Hoje às 14:00", appToken: cfg.appToken || "" })
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.textContent = "✅ Mensagem enviada! Confira seu WhatsApp.";
      resultEl.style.cssText = "background:var(--green-bg);color:var(--green)";
    } else {
      resultEl.textContent = `❌ Erro Twilio: ${data.error || "verifique as credenciais"}`;
      resultEl.style.cssText = "background:var(--red-bg);color:var(--red)";
    }
  } catch(e) {
    resultEl.textContent = "❌ Não conectou ao Worker — verifique a URL.";
    resultEl.style.cssText = "background:var(--red-bg);color:var(--red)";
  }
  resultEl.classList.remove("hidden");
  btn.disabled = false; btn.textContent = "📱 Enviar mensagem de teste";
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
