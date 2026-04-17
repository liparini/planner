# 📅 Meu Planner

Agenda com controle por voz, login Google e sincronização em nuvem via Firebase.

## ✨ Funcionalidades

- **Login com Google** via Firebase Auth
- **Dados na nuvem** — atividades salvas por usuário no Firestore
- **Controle por voz** — adicionar e inativar atividades falando
- **Filtros** por status e categoria
- **Tema automático** claro/escuro

## 🚀 Como hospedar no GitHub Pages

### 1. Crie o repositório

```bash
git init
git add .
git commit -m "feat: initial planner setup"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/meu-planner.git
git push -u origin main
```

### 2. Ative o GitHub Pages

No repositório GitHub:
1. Vá em **Settings → Pages**
2. Em **Source**, selecione **GitHub Actions**
3. O deploy acontece automaticamente a cada push na `main`

### 3. Configure o Firebase

No [Firebase Console](https://console.firebase.google.com/project/planner-6e747):

**a) Authentication → Sign-in method**
- Ative o provedor **Google**

**b) Authentication → Settings → Authorized domains**
- Adicione: `SEU_USUARIO.github.io`

**c) Firestore Database**
- Crie o banco em modo **produção**
- Vá em **Rules** e configure:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/activities/{activityId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 🎙 Comandos de voz

| Comando | Ação |
|---------|------|
| `"Adicionar reunião de trabalho às 14h"` | Cadastra nova atividade |
| `"Adicionar academia categoria saúde"` | Cadastra com categoria específica |
| `"Inativar academia"` | Inativa atividade pelo nome |
| `"Ativar academia"` | Reativa atividade |
| `"Mostrar ativas"` | Filtra lista |
| `"Mostrar todas"` | Remove filtro |

> **Nota:** Reconhecimento de voz funciona melhor no Chrome e Edge.

## 📁 Estrutura

```
├── index.html          — Página principal
├── style.css           — Estilos
├── app.js              — Lógica + Firebase
└── .github/
    └── workflows/
        └── deploy.yml  — Deploy automático
```
