// ===== FIREBASE CONFIG =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDbVrUEMMQLIB-HaClqxmLMiG39xSJstUs",
  authDomain: "planner-6e747.firebaseapp.com",
  projectId: "planner-6e747",
  storageBucket: "planner-6e747.firebasestorage.app",
  messagingSenderId: "212295454552",
  appId: "1:212295454552:web:6b36242daaf784d2bddf2d"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ===== STATE =====
let currentUser = null;
let activities = [];
let unsubscribeActivities = null;
let currentFilter = "all";
let recognition = null;
let isListening = false;

const COLORS = ["#2563eb","#16a34a","#d4537e","#d85a30","#6d28d9","#b45309","#dc2626","#0891b2"];

// ===== DOM REFS =====
const loginScreen = document.getElementById("login-screen");
const appScreen = document.getElementById("app-screen");
const googleLoginBtn = document.getElementById("google-login-btn");
const logoutBtn = document.getElementById("logout-btn");
const userAvatar = document.getElementById("user-avatar");
const userName = document.getElementById("user-name");
const appDate = document.getElementById("app-date");
const micBtn = document.getElementById("mic-btn");
const transcriptBox = document.getElementById("transcript-box");
const feedbackMsg = document.getElementById("feedback-msg");
const activityList = document.getElementById("activity-list");

// ===== AUTH =====
googleLoginBtn.addEventListener("click", async () => {
  try {
    googleLoginBtn.disabled = true;
    googleLoginBtn.textContent = "Entrando...";
    await signInWithPopup(auth, provider);
  } catch (e) {
    googleLoginBtn.disabled = false;
    googleLoginBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.8 0 10.9-2 14.9-5.3l-6.9-5.7C29.9 37 27.1 38 24 38c-5.8 0-10.8-3.9-12.6-9.3l-7 5.4C8 40.1 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.1 5.4-5.7 7l6.9 5.7C41.8 37.5 45 31.3 45 24c0-1.3-.2-2.7-.5-4z"/></svg> Entrar com Google`;
    showFeedback("Erro ao entrar. Tente novamente.", "error");
    console.error(e);
  }
});

logoutBtn.addEventListener("click", async () => {
  if (unsubscribeActivities) unsubscribeActivities();
  await signOut(auth);
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    userAvatar.src = user.photoURL || "";
    userName.textContent = user.displayName?.split(" ")[0] || "Usuário";
    appDate.textContent = formatDate();
    loadActivities();
  } else {
    currentUser = null;
    activities = [];
    loginScreen.classList.remove("hidden");
    appScreen.classList.add("hidden");
    if (unsubscribeActivities) unsubscribeActivities();
    googleLoginBtn.disabled = false;
    googleLoginBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/><path fill="#34A853" d="M6.3 14.7l7 5.1C15 16.1 19.1 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z"/><path fill="#FBBC05" d="M24 46c5.8 0 10.9-2 14.9-5.3l-6.9-5.7C29.9 37 27.1 38 24 38c-5.8 0-10.8-3.9-12.6-9.3l-7 5.4C8 40.1 15.4 46 24 46z"/><path fill="#EA4335" d="M44.5 20H24v8.5h11.8c-1 3-3.1 5.4-5.7 7l6.9 5.7C41.8 37.5 45 31.3 45 24c0-1.3-.2-2.7-.5-4z"/></svg> Entrar com Google`;
  }
});

// ===== FIRESTORE =====
function loadActivities() {
  const ref = collection(db, "users", currentUser.uid, "activities");
  const q = query(ref, orderBy("createdAt", "asc"));
  unsubscribeActivities = onSnapshot(q, (snap) => {
    activities = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    updateStats();
    renderActivities();
  });
}

async function addActivity(name, category, time) {
  const ref = collection(db, "users", currentUser.uid, "activities");
  const used = activities.map(a => a.color);
  const color = COLORS.find(c => !used.includes(c)) || COLORS[activities.length % COLORS.length];
  await addDoc(ref, {
    name,
    category,
    time: time || "",
    active: true,
    color,
    createdAt: serverTimestamp()
  });
}

async function setActivityStatus(id, active) {
  const ref = doc(db, "users", currentUser.uid, "activities", id);
  await updateDoc(ref, { active });
}

// ===== TOGGLE (called from inline onclick) =====
window.toggleActivity = async (id) => {
  const a = activities.find(x => x.id === id);
  if (!a) return;
  await setActivityStatus(id, !a.active);
  showFeedback(`"${a.name}" ${!a.active ? "ativada" : "inativada"} com sucesso.`, !a.active ? "success" : "info");
};

// ===== RENDER =====
function updateStats() {
  const total = activities.length;
  const active = activities.filter(a => a.active).length;
  document.getElementById("stat-total").textContent = total;
  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-inactive").textContent = total - active;
}

function getCategoryLabel(cat) {
  return { trabalho: "Trabalho", saude: "Saúde", pessoal: "Pessoal", estudo: "Estudo", outro: "Outro" }[cat] || "Outro";
}

function renderActivities() {
  let filtered = [...activities];
  if (currentFilter === "active") filtered = filtered.filter(a => a.active);
  else if (currentFilter === "inactive") filtered = filtered.filter(a => !a.active);
  else if (["trabalho","saude","pessoal","estudo"].includes(currentFilter))
    filtered = filtered.filter(a => a.category === currentFilter);

  if (filtered.length === 0) {
    activityList.innerHTML = '<div class="empty-state">Nenhuma atividade encontrada</div>';
    return;
  }

  activityList.innerHTML = filtered.map(a => `
    <div class="activity-card ${a.active ? "" : "inactive"}">
      <div class="activity-dot" style="background:${a.color}"></div>
      <div class="activity-content">
        <div class="activity-name">${escHtml(a.name)}</div>
        <div class="activity-meta">
          ${a.time ? `<span>${escHtml(a.time)}</span>` : ""}
          <span class="activity-tag tag-${a.category}">${getCategoryLabel(a.category)}</span>
        </div>
      </div>
      <span class="status-badge ${a.active ? "status-active" : "status-inactive"}">${a.active ? "ativa" : "inativa"}</span>
      <button class="toggle-btn" onclick="toggleActivity('${a.id}')" title="${a.active ? "Inativar" : "Ativar"}">
        ${a.active ? "⏸" : "▶"}
      </button>
    </div>
  `).join("");
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ===== FILTER =====
document.getElementById("filter-row").addEventListener("click", (e) => {
  const btn = e.target.closest(".filter-btn");
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderActivities();
});

// ===== VOICE =====
function detectCategory(text) {
  if (/trabalho|reuni[aã]o|projeto|cliente|sprint|standup/i.test(text)) return "trabalho";
  if (/saude|sa[uú]de|academia|m[eé]dic|consulta|treino|corrida|gin[aá]sio/i.test(text)) return "saude";
  if (/estudo|curso|aula|leitura|livro|aprender/i.test(text)) return "estudo";
  if (/pessoal|família|familia|lazer|amigos|hobby/i.test(text)) return "pessoal";
  return "outro";
}

function extractTime(text) {
  const m = text.match(/(\d{1,2})[h:](\d{2})?|(\d{1,2})\s*hora/i);
  if (!m) return "";
  const h = String(m[1] || m[3]).padStart(2,"0");
  return `${h}:${m[2] || "00"}`;
}

async function processCommand(text) {
  const t = text.toLowerCase().trim();
  showTranscript(`"${text}"`);

  // ADICIONAR
  if (/^(adicionar?|cadastrar?|criar?|nova?)\s+/i.test(t)) {
    let name = t.replace(/^(adicionar?|cadastrar?|criar?|nova?)\s+/i, "");
    const catMatch = text.match(/categoria\s+(\w+)/i);
    name = name.replace(/\s*(categoria|cat)\s+\w+/i, "").replace(/\s*às?\s*\d+.*$/i, "").trim();
    const category = catMatch ? catMatch[1].toLowerCase() : detectCategory(t);
    const time = extractTime(t);
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    try {
      await addActivity(displayName, category, time);
      showFeedback(`✓ "${displayName}" cadastrada com sucesso!`, "success");
    } catch(e) {
      showFeedback("Erro ao salvar. Tente novamente.", "error");
      console.error(e);
    }
    return;
  }

  // INATIVAR
  if (/^inativar?\s+/i.test(t)) {
    const query2 = t.replace(/^inativar?\s+/i, "").trim();
    const match = activities.find(a => a.active && a.name.toLowerCase().includes(query2));
    if (match) {
      await setActivityStatus(match.id, false);
      showFeedback(`"${match.name}" foi inativada.`, "info");
    } else {
      showFeedback(`Nenhuma atividade ativa encontrada com "${query2}".`, "error");
    }
    return;
  }

  // ATIVAR
  if (/^ativar?\s+/i.test(t)) {
    const query2 = t.replace(/^ativar?\s+/i, "").trim();
    const match = activities.find(a => !a.active && a.name.toLowerCase().includes(query2));
    if (match) {
      await setActivityStatus(match.id, true);
      showFeedback(`"${match.name}" foi reativada!`, "success");
    } else {
      showFeedback(`Nenhuma atividade inativa encontrada com "${query2}".`, "error");
    }
    return;
  }

  // FILTROS
  if (/mostrar?\s+ativas?/i.test(t)) { setFilter("active"); return; }
  if (/mostrar?\s+inativas?/i.test(t)) { setFilter("inactive"); return; }
  if (/mostrar?\s+(todas?|tudo)/i.test(t)) { setFilter("all"); return; }

  showFeedback('Comando não reconhecido. Tente: "Adicionar [nome]" ou "Inativar [nome]".', "error");
}

function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === f);
  });
  renderActivities();
  const labels = { all: "Mostrando todas as atividades", active: "Mostrando apenas ativas", inactive: "Mostrando apenas inativas" };
  if (labels[f]) showFeedback(labels[f], "info");
}

function showTranscript(msg) {
  transcriptBox.textContent = msg;
  transcriptBox.classList.remove("hidden");
}

function showFeedback(msg, type) {
  feedbackMsg.textContent = msg;
  feedbackMsg.className = `feedback-msg ${type}`;
  feedbackMsg.classList.remove("hidden");
  clearTimeout(feedbackMsg._t);
  feedbackMsg._t = setTimeout(() => feedbackMsg.classList.add("hidden"), 3500);
}

function setupSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  recognition = new SR();
  recognition.lang = "pt-BR";
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isListening = true;
    micBtn.classList.add("listening");
    micBtn.title = "Ouvindo...";
    showTranscript("🎙 Ouvindo...");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    showTranscript(`"${transcript}"`);
    if (e.results[0].isFinal) {
      micBtn.classList.remove("listening");
      micBtn.classList.add("processing");
      micBtn.title = "Processando...";
      processCommand(transcript).finally(() => {
        micBtn.classList.remove("processing");
        micBtn.title = "Clique para falar";
      });
    }
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove("listening","processing");
    micBtn.title = "Clique para falar";
  };

  recognition.onerror = (e) => {
    isListening = false;
    micBtn.classList.remove("listening","processing");
    if (e.error === "not-allowed") showFeedback("Permissão de microfone negada.", "error");
    else if (e.error === "no-speech") showFeedback("Nenhuma fala detectada. Tente novamente.", "info");
    else showFeedback("Erro no reconhecimento. Tente novamente.", "error");
    transcriptBox.classList.add("hidden");
  };
  return true;
}

micBtn.addEventListener("click", () => {
  if (!currentUser) return;
  if (!recognition && !setupSpeech()) {
    showFeedback("Reconhecimento de voz não suportado. Use Chrome ou Edge.", "error");
    return;
  }
  if (isListening) recognition.stop();
  else {
    feedbackMsg.classList.add("hidden");
    recognition.start();
  }
});

// ===== UTILS =====
function formatDate() {
  return new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
