// ===== FIREBASE =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp }
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
let activities = [];
let unsubscribe = null;
let categoryFilter = "all";
let statusFilter = "all";
let viewMode = "day";       // day | week | month | year | all
let cursorDate = new Date(); // anchor date for navigation
let recognition = null;
let isListening = false;
let editingId = null;

const COLORS = ["#2563eb","#16a34a","#d4537e","#d85a30","#6d28d9","#b45309","#0f766e","#be185d","#3730a3","#dc2626"];
const CAT_LABELS = { trabalho:"Trabalho", saude:"Saúde", pessoal:"Pessoal", estudo:"Estudo", lazer:"Lazer", viagem:"Viagem", shows:"Shows", outro:"Outro" };
const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MONTHS_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const DAYS_PT = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];

const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.8 0 10.9-2 14.9-5.3l-6.9-5.7C29.9 37 27.1 38 24 38c-5.8 0-10.8-3.9-12.6-9.3l-7 5.4C8 40.1 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.1 5.4-5.7 7l6.9 5.7C41.8 37.5 45 31.3 45 24c0-1.3-.2-2.7-.5-4z"/></svg> Entrar com Google`;

// ===== DOM =====
const $ = id => document.getElementById(id);
const loginScreen = $("login-screen"), appScreen = $("app-screen");
const googleLoginBtn = $("google-login-btn"), logoutBtn = $("logout-btn");
const micBtn = $("mic-btn"), transcriptBox = $("transcript-box"), feedbackMsg = $("feedback-msg");
const activityList = $("activity-list");
const addForm = $("add-form"), btnOpenAdd = $("btn-open-add"), addFormClose = $("add-form-close");
const btnSaveAdd = $("btn-save-add"), btnCancelAdd = $("btn-cancel-add");
const editModal = $("edit-modal"), modalClose = $("modal-close");
const btnSaveEdit = $("btn-save-edit"), btnCancelEdit = $("btn-cancel-edit"), btnDelete = $("btn-delete");
const commandsBtn = $("commands-btn"), commandsModal = $("commands-modal"), commandsClose = $("commands-close");
const navPrev = $("nav-prev"), navNext = $("nav-next"), navToday = $("nav-today"), navLabel = $("nav-label");

// ===== AUTH =====
googleLoginBtn.addEventListener("click", async () => {
  try {
    googleLoginBtn.disabled = true; googleLoginBtn.textContent = "Entrando...";
    await signInWithPopup(auth, provider);
  } catch(e) {
    googleLoginBtn.disabled = false; googleLoginBtn.innerHTML = GOOGLE_SVG;
    showFeedback("Erro ao entrar. Tente novamente.", "error");
  }
});

logoutBtn.addEventListener("click", async () => { if (unsubscribe) unsubscribe(); await signOut(auth); });

onAuthStateChanged(auth, user => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add("hidden"); appScreen.classList.remove("hidden");
    $("user-avatar").src = user.photoURL || "";
    $("user-name").textContent = user.displayName?.split(" ")[0] || "Usuário";
    $("app-date").textContent = formatDate(new Date());
    loadActivities();
  } else {
    currentUser = null; activities = [];
    loginScreen.classList.remove("hidden"); appScreen.classList.add("hidden");
    if (unsubscribe) unsubscribe();
    googleLoginBtn.disabled = false; googleLoginBtn.innerHTML = GOOGLE_SVG;
  }
});

// ===== FIRESTORE =====
function userRef() { return collection(db, "users", currentUser.uid, "activities"); }
function docRef(id) { return doc(db, "users", currentUser.uid, "activities", id); }

function loadActivities() {
  const q = query(userRef(), orderBy("createdAt", "asc"));
  unsubscribe = onSnapshot(q, snap => {
    activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateStats(); renderView();
  });
}

async function addActivity(data) {
  const used = activities.map(a => a.color);
  const color = COLORS.find(c => !used.includes(c)) || COLORS[activities.length % COLORS.length];
  await addDoc(userRef(), { ...data, active: true, color, createdAt: serverTimestamp() });
}

async function saveActivity(id, data) { await updateDoc(docRef(id), data); }
async function deleteActivity(id) { await deleteDoc(docRef(id)); }

window.toggleActivity = async (id, e) => {
  e.stopPropagation();
  const a = activities.find(x => x.id === id);
  if (!a) return;
  await saveActivity(id, { active: !a.active });
  showFeedback(`"${a.name}" ${!a.active ? "ativada" : "inativada"}.`, !a.active ? "success" : "info");
};

// ===== DATE UTILS =====
function toYMD(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function parseYMD(s) {
  if (!s) return null;
  const [y,m,d] = s.split("-").map(Number);
  return new Date(y, m-1, d);
}

function isSameDay(a, b) { return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }

function getWeekRange(d) {
  const day = d.getDay();
  const start = new Date(d); start.setDate(d.getDate() - day);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { start, end };
}

function dateInRange(dateStr, start, end) {
  if (!dateStr) return false;
  const d = parseYMD(dateStr);
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  return d >= s && d <= e;
}

function fmtDisplayDate(dateStr) {
  if (!dateStr) return "";
  const d = parseYMD(dateStr);
  const today = new Date();
  if (isSameDay(d, today)) return "Hoje";
  const tomorrow = new Date(); tomorrow.setDate(today.getDate()+1);
  if (isSameDay(d, tomorrow)) return "Amanhã";
  const yesterday = new Date(); yesterday.setDate(today.getDate()-1);
  if (isSameDay(d, yesterday)) return "Ontem";
  return `${DAYS_PT[d.getDay()]}, ${String(d.getDate()).padStart(2,"0")} ${MONTHS_SHORT[d.getMonth()]}`;
}

function isToday(dateStr) {
  if (!dateStr) return false;
  return isSameDay(parseYMD(dateStr), new Date());
}

function isPast(dateStr) {
  if (!dateStr) return false;
  const d = parseYMD(dateStr);
  const t = new Date(); t.setHours(0,0,0,0);
  return d < t;
}

// ===== NAVIGATION LABEL =====
function updateNavLabel() {
  if (viewMode === "all") { navLabel.textContent = "Todas as atividades"; return; }
  if (viewMode === "day") {
    const t = new Date();
    navLabel.textContent = isSameDay(cursorDate, t) ? "Hoje" : `${DAYS_PT[cursorDate.getDay()]}, ${String(cursorDate.getDate()).padStart(2,"0")} de ${MONTHS_PT[cursorDate.getMonth()]}`;
    return;
  }
  if (viewMode === "week") {
    const { start, end } = getWeekRange(cursorDate);
    navLabel.textContent = `${String(start.getDate()).padStart(2,"0")} ${MONTHS_SHORT[start.getMonth()]} – ${String(end.getDate()).padStart(2,"0")} ${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`;
    return;
  }
  if (viewMode === "month") {
    navLabel.textContent = `${MONTHS_PT[cursorDate.getMonth()]} ${cursorDate.getFullYear()}`;
    return;
  }
  if (viewMode === "year") {
    navLabel.textContent = String(cursorDate.getFullYear());
    return;
  }
}

// ===== NAVIGATE =====
function navigate(dir) {
  if (viewMode === "day") { cursorDate.setDate(cursorDate.getDate() + dir); }
  else if (viewMode === "week") { cursorDate.setDate(cursorDate.getDate() + dir * 7); }
  else if (viewMode === "month") { cursorDate.setMonth(cursorDate.getMonth() + dir); }
  else if (viewMode === "year") { cursorDate.setFullYear(cursorDate.getFullYear() + dir); }
  renderView();
}

navPrev.addEventListener("click", () => navigate(-1));
navNext.addEventListener("click", () => navigate(1));
navToday.addEventListener("click", () => { cursorDate = new Date(); renderView(); });

document.querySelectorAll(".view-mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    viewMode = btn.dataset.view;
    document.querySelectorAll(".view-mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    // hide nav arrows for "all"
    navPrev.style.visibility = viewMode === "all" ? "hidden" : "";
    navNext.style.visibility = viewMode === "all" ? "hidden" : "";
    navToday.style.visibility = viewMode === "all" ? "hidden" : "";
    renderView();
  });
});

// ===== STATS =====
function updateStats() {
  const total = activities.length;
  const active = activities.filter(a => a.active).length;
  $("stat-total").textContent = total;
  $("stat-active").textContent = active;
  $("stat-inactive").textContent = total - active;
}

// ===== FILTER ACTIVITIES =====
function applyFilters(list) {
  return list.filter(a => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (statusFilter === "active" && !a.active) return false;
    if (statusFilter === "inactive" && a.active) return false;
    return true;
  });
}

function getViewActivities() {
  let list = applyFilters(activities);
  if (viewMode === "all") return list;

  if (viewMode === "day") {
    const dayStr = toYMD(cursorDate);
    return list.filter(a => a.date === dayStr || (!a.date && viewMode === "all"));
  }
  if (viewMode === "week") {
    const { start, end } = getWeekRange(cursorDate);
    return list.filter(a => a.date && dateInRange(a.date, start, end));
  }
  if (viewMode === "month") {
    return list.filter(a => {
      if (!a.date) return false;
      const d = parseYMD(a.date);
      return d.getFullYear() === cursorDate.getFullYear() && d.getMonth() === cursorDate.getMonth();
    });
  }
  if (viewMode === "year") {
    return list.filter(a => {
      if (!a.date) return false;
      return parseYMD(a.date).getFullYear() === cursorDate.getFullYear();
    });
  }
  return list;
}

// ===== RENDER VIEW =====
function renderView() {
  updateNavLabel();
  const list = getViewActivities();

  if (list.length === 0) {
    const msgs = {
      day: "Nenhuma atividade para este dia.",
      week: "Nenhuma atividade para esta semana.",
      month: "Nenhuma atividade para este mês.",
      year: "Nenhuma atividade para este ano.",
      all: "Nenhuma atividade cadastrada ainda."
    };
    activityList.innerHTML = `<div class="empty-state">${msgs[viewMode]}</div>`;
    return;
  }

  if (viewMode === "year") { renderYearView(list); return; }
  if (viewMode === "all") { renderGroupedView(list); return; }
  if (viewMode === "month") { renderGroupedView(list); return; }
  if (viewMode === "week") { renderGroupedView(list); return; }
  if (viewMode === "day") { renderDayView(list); return; }
}

// ===== DAY VIEW =====
function renderDayView(list) {
  const sorted = [...list].sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1; if (b.time) return 1;
    return 0;
  });
  activityList.innerHTML = `<div class="date-group-items">${sorted.map(cardHTML).join("")}</div>`;
}

// ===== GROUPED VIEW (week / month / all) =====
function renderGroupedView(list) {
  // separate dated vs no-date
  const dated = list.filter(a => a.date).sort((a,b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1; if (b.time) return 1;
    return 0;
  });
  const noDate = list.filter(a => !a.date);

  // group by date
  const groups = {};
  dated.forEach(a => { if (!groups[a.date]) groups[a.date] = []; groups[a.date].push(a); });

  let html = "";

  Object.keys(groups).sort().forEach(dateStr => {
    const items = groups[dateStr];
    const today = isToday(dateStr);
    const past = isPast(dateStr);
    const dotClass = today ? "today" : past ? "past" : "future";
    const labelClass = today ? "today-label" : past ? "past-label" : "";
    html += `
      <div class="date-group">
        <div class="date-group-header">
          <div class="date-group-dot ${dotClass}"></div>
          <div class="date-group-label ${labelClass}">${fmtDisplayDate(dateStr)}</div>
          <div class="date-group-line"></div>
          <div class="date-group-count">${items.length} item${items.length>1?"s":""}</div>
        </div>
        <div class="date-group-items">${items.map(cardHTML).join("")}</div>
      </div>`;
  });

  if (noDate.length > 0) {
    html += `
      <div class="nodate-group">
        <div class="date-group-header">
          <div class="date-group-dot"></div>
          <div class="date-group-label" style="color:var(--text3)">Sem data definida</div>
          <div class="date-group-line"></div>
          <div class="date-group-count">${noDate.length}</div>
        </div>
        <div class="date-group-items">${noDate.map(cardHTML).join("")}</div>
      </div>`;
  }

  activityList.innerHTML = html;
}

// ===== YEAR VIEW =====
function renderYearView(list) {
  const byMonth = {};
  list.forEach(a => {
    if (!a.date) {
      if (!byMonth["__nodate"]) byMonth["__nodate"] = [];
      byMonth["__nodate"].push(a);
      return;
    }
    const d = parseYMD(a.date);
    const key = d.getMonth();
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(a);
  });

  let html = "";
  for (let m = 0; m < 12; m++) {
    const items = byMonth[m];
    if (!items || items.length === 0) continue;
    const sorted = [...items].sort((a,b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1; if (b.time) return 1;
      return 0;
    });
    html += `
      <div class="month-group">
        <div class="month-group-header">
          ${MONTHS_PT[m]}
          <span class="month-group-count">${items.length} atividade${items.length>1?"s":""}</span>
        </div>
        <div class="date-group-items">${sorted.map(cardHTML).join("")}</div>
      </div>`;
  }

  if (byMonth["__nodate"]?.length > 0) {
    html += `
      <div class="month-group">
        <div class="month-group-header">Sem data <span class="month-group-count">${byMonth["__nodate"].length}</span></div>
        <div class="date-group-items">${byMonth["__nodate"].map(cardHTML).join("")}</div>
      </div>`;
  }

  activityList.innerHTML = html;
}

// ===== CARD HTML =====
function cardHTML(a) {
  const descStr = a.description ? `<div class="activity-desc">${escHtml(a.description)}</div>` : "";
  const timeStr = a.time ? `<span class="activity-time">${a.time}</span>` : "";
  return `
    <div class="activity-card ${a.active?"":"inactive"}" onclick="openEdit('${a.id}')">
      <div class="activity-dot" style="background:${a.color}"></div>
      <div class="activity-content">
        <div class="activity-name">${escHtml(a.name)}</div>
        <div class="activity-meta">
          ${timeStr}
          <span class="activity-tag tag-${a.category}">${CAT_LABELS[a.category]||"Outro"}</span>
        </div>
        ${descStr}
      </div>
      <span class="status-badge ${a.active?"status-active":"status-inactive"}">${a.active?"ativa":"inativa"}</span>
      <button class="toggle-btn" onclick="toggleActivity('${a.id}',event)" title="${a.active?"Inativar":"Ativar"}">${a.active?"⏸":"▶"}</button>
    </div>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ===== FILTERS =====
document.getElementById("filter-row").addEventListener("click", e => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  categoryFilter = btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderView();
});

document.querySelectorAll(".status-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    statusFilter = btn.dataset.status;
    document.querySelectorAll(".status-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderView();
  });
});

// ===== ADD FORM =====
btnOpenAdd.addEventListener("click", () => {
  addForm.classList.remove("hidden");
  // pre-fill date with cursor date for day/week/month views
  if (viewMode !== "all" && viewMode !== "year") {
    $("f-date").value = toYMD(cursorDate);
  }
  $("f-name").focus();
  btnOpenAdd.style.display = "none";
});

function closeAddForm() {
  addForm.classList.add("hidden"); btnOpenAdd.style.display = "";
  ["f-name","f-date","f-time","f-desc"].forEach(id => $(id).value = "");
  $("f-category").value = "trabalho";
}

addFormClose.addEventListener("click", closeAddForm);
btnCancelAdd.addEventListener("click", closeAddForm);

btnSaveAdd.addEventListener("click", async () => {
  const name = $("f-name").value.trim();
  if (!name) { $("f-name").focus(); return; }
  try {
    btnSaveAdd.disabled = true; btnSaveAdd.textContent = "Salvando...";
    await addActivity({
      name,
      category: $("f-category").value,
      date: $("f-date").value,
      time: $("f-time").value,
      description: $("f-desc").value.trim()
    });
    showFeedback(`✓ "${name}" cadastrada!`, "success");
    closeAddForm();
  } catch(e) { showFeedback("Erro ao salvar.", "error"); console.error(e); }
  finally { btnSaveAdd.disabled = false; btnSaveAdd.textContent = "Salvar atividade"; }
});

// ===== EDIT MODAL =====
window.openEdit = id => {
  const a = activities.find(x => x.id === id);
  if (!a) return;
  editingId = id;
  $("e-name").value = a.name||"";
  $("e-category").value = a.category||"outro";
  $("e-status").value = String(a.active !== false);
  $("e-date").value = a.date||"";
  $("e-time").value = a.time||"";
  $("e-desc").value = a.description||"";
  editModal.classList.remove("hidden");
};

function closeEdit() { editModal.classList.add("hidden"); editingId = null; }
modalClose.addEventListener("click", closeEdit);
btnCancelEdit.addEventListener("click", closeEdit);
editModal.addEventListener("click", e => { if (e.target === editModal) closeEdit(); });

btnSaveEdit.addEventListener("click", async () => {
  if (!editingId) return;
  const name = $("e-name").value.trim();
  if (!name) { $("e-name").focus(); return; }
  try {
    btnSaveEdit.disabled = true;
    await saveActivity(editingId, {
      name,
      category: $("e-category").value,
      active: $("e-status").value === "true",
      date: $("e-date").value,
      time: $("e-time").value,
      description: $("e-desc").value.trim()
    });
    showFeedback("Atividade atualizada!", "success");
    closeEdit();
  } catch(e) { showFeedback("Erro ao salvar.", "error"); }
  finally { btnSaveEdit.disabled = false; }
});

btnDelete.addEventListener("click", async () => {
  if (!editingId) return;
  const a = activities.find(x => x.id === editingId);
  if (!confirm(`Excluir "${a?.name}"?`)) return;
  try { await deleteActivity(editingId); showFeedback("Atividade excluída.", "info"); closeEdit(); }
  catch(e) { showFeedback("Erro ao excluir.", "error"); }
});

// ===== COMMANDS MODAL =====
commandsBtn.addEventListener("click", () => commandsModal.classList.remove("hidden"));
commandsClose.addEventListener("click", () => commandsModal.classList.add("hidden"));
commandsModal.addEventListener("click", e => { if (e.target === commandsModal) commandsModal.classList.add("hidden"); });

// ===== VOICE =====
function detectCategory(t) {
  if (/trabalho|reuni[aã]o|projeto|cliente|sprint|standup/i.test(t)) return "trabalho";
  if (/sa[uú]de|academia|m[eé]dic|consulta|treino|corrida|gin[aá]sio/i.test(t)) return "saude";
  if (/estudo|curso|aula|leitura|livro|aprender/i.test(t)) return "estudo";
  if (/lazer|passeio|parque|piquenique/i.test(t)) return "lazer";
  if (/viagem|viajar|trip|tour|excurs/i.test(t)) return "viagem";
  if (/show|concer|festival|teatro|espet/i.test(t)) return "shows";
  if (/pessoal|família|familia|amigos|hobby/i.test(t)) return "pessoal";
  return "outro";
}

function extractTime(t) {
  const m = t.match(/(\d{1,2})[h:](\d{2})?|(\d{1,2})\s*hora/i);
  if (!m) return "";
  return `${String(m[1]||m[3]).padStart(2,"0")}:${m[2]||"00"}`;
}

async function processCommand(text) {
  const t = text.toLowerCase().trim();
  showTranscript(`"${text}"`);

  if (/^(adicionar?|cadastrar?|criar?|nova?)\s+/i.test(t)) {
    let name = t.replace(/^(adicionar?|cadastrar?|criar?|nova?)\s+/i,"");
    const catMatch = text.match(/categoria\s+(\w+)/i);
    name = name.replace(/\s*(categoria|cat)\s+\w+/i,"").replace(/\s*às?\s*\d+.*$/i,"").trim();
    const category = catMatch ? catMatch[1].toLowerCase() : detectCategory(t);
    const time = extractTime(t);
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    // use current cursor date for day view
    const date = viewMode === "day" ? toYMD(cursorDate) : "";
    try {
      await addActivity({ name:displayName, category, time, date, description:"" });
      showFeedback(`✓ "${displayName}" cadastrada!`, "success");
    } catch(e) { showFeedback("Erro ao salvar.", "error"); }
    return;
  }

  if (/^inativar?\s+/i.test(t)) {
    const q = t.replace(/^inativar?\s+/i,"").trim();
    const match = activities.find(a => a.active && a.name.toLowerCase().includes(q));
    if (match) { await saveActivity(match.id, {active:false}); showFeedback(`"${match.name}" inativada.`,"info"); }
    else showFeedback(`Atividade ativa "${q}" não encontrada.`,"error");
    return;
  }

  if (/^ativar?\s+/i.test(t)) {
    const q = t.replace(/^ativar?\s+/i,"").trim();
    const match = activities.find(a => !a.active && a.name.toLowerCase().includes(q));
    if (match) { await saveActivity(match.id, {active:true}); showFeedback(`"${match.name}" ativada!`,"success"); }
    else showFeedback(`Atividade inativa "${q}" não encontrada.`,"error");
    return;
  }

  // Navigation commands
  if (/ver?\s+hoje/i.test(t)) { cursorDate = new Date(); setViewMode("day"); return; }
  if (/ver?\s+(esta?\s+semana|semana)/i.test(t)) { cursorDate = new Date(); setViewMode("week"); return; }
  if (/ver?\s+(este?\s+m[eê]s|m[eê]s)/i.test(t)) { cursorDate = new Date(); setViewMode("month"); return; }
  if (/ver?\s+(este?\s+ano|ano)/i.test(t)) { cursorDate = new Date(); setViewMode("year"); return; }
  if (/pr[oó]ximo|avan[cç]ar/i.test(t)) { navigate(1); return; }
  if (/anterior|voltar/i.test(t)) { navigate(-1); return; }

  showFeedback('Comando não reconhecido. Clique em 💬 para ver os comandos.', "error");
}

function setViewMode(mode) {
  viewMode = mode;
  document.querySelectorAll(".view-mode-btn").forEach(b => b.classList.toggle("active", b.dataset.view === mode));
  navPrev.style.visibility = ""; navNext.style.visibility = ""; navToday.style.visibility = "";
  renderView();
  showFeedback(`Visualizando: ${mode==="day"?"Dia":mode==="week"?"Semana":mode==="month"?"Mês":"Ano"}`, "info");
}

function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  recognition = new SR();
  recognition.lang = "pt-BR"; recognition.interimResults = true;
  recognition.onstart = () => { isListening=true; micBtn.classList.add("listening"); showTranscript("🎙 Ouvindo..."); };
  recognition.onresult = e => {
    const tr = e.results[0][0].transcript;
    showTranscript(`"${tr}"`);
    if (e.results[0].isFinal) {
      micBtn.classList.remove("listening"); micBtn.classList.add("processing");
      processCommand(tr).finally(() => micBtn.classList.remove("processing"));
    }
  };
  recognition.onend = () => { isListening=false; micBtn.classList.remove("listening","processing"); };
  recognition.onerror = e => {
    isListening=false; micBtn.classList.remove("listening","processing");
    if (e.error==="not-allowed") showFeedback("Permissão de microfone negada.","error");
    else if (e.error==="no-speech") showFeedback("Nenhuma fala detectada.","info");
    else showFeedback("Erro no reconhecimento.","error");
    transcriptBox.classList.add("hidden");
  };
  return true;
}

micBtn.addEventListener("click", () => {
  if (!currentUser) return;
  if (!recognition && !setupSpeech()) { showFeedback("Voz não suportada. Use Chrome ou Edge.","error"); return; }
  if (isListening) recognition.stop();
  else { feedbackMsg.classList.add("hidden"); recognition.start(); }
});

function showTranscript(msg) { transcriptBox.textContent=msg; transcriptBox.classList.remove("hidden"); }
function showFeedback(msg, type) {
  feedbackMsg.textContent=msg; feedbackMsg.className=`feedback-msg ${type}`; feedbackMsg.classList.remove("hidden");
  clearTimeout(feedbackMsg._t); feedbackMsg._t=setTimeout(()=>feedbackMsg.classList.add("hidden"),3500);
}
function formatDate(d) { return d.toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"}); }
