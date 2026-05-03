// Service Worker — Firebase Cloud Messaging
// Recebe notificações push mesmo com o app fechado
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDbVrUEMMQLIB-HaClqxmLMiG39xSJstUs",
  authDomain: "planner-6e747.firebaseapp.com",
  projectId: "planner-6e747",
  storageBucket: "planner-6e747.firebasestorage.app",
  messagingSenderId: "212295454552",
  appId: "1:212295454552:web:6b36242daaf784d2bddf2d"
});

const messaging = firebase.messaging();

// Notificação em background (app fechado)
messaging.onBackgroundMessage(payload => {
  const { title, body, icon, data } = payload.notification || {};
  self.registration.showNotification(title || "Meu Planner", {
    body: body || "",
    icon: icon || "/planner/icon-192.png",
    badge: "/planner/icon-192.png",
    tag: data?.tag || "planner-notif",
    renotify: true,
    data: data || {},
    actions: [{ action: "open", title: "Abrir Planner" }]
  });
});

// Clique na notificação abre o app
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const plannerUrl = "/planner/";
      for (const client of list) {
        if (client.url.includes("/planner") && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(plannerUrl);
    })
  );
});
