const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();

exports.sendScheduledNotifications = onSchedule("every 1 minutes", async () => {
  const now = new Date();
  const usersSnap = await db.collection("users").get();

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    // Busca token FCM
    const tokenDoc = await db.doc(`users/${uid}/tokens/fcm`).get();
    if (!tokenDoc.exists) continue;
    const { token } = tokenDoc.data();
    if (!token) continue;

    // Verifica atividades agendadas
    const scheduledSnap = await db.collection(`users/${uid}/scheduled`).get();
    for (const schedDoc of scheduledSnap.docs) {
      const { title, body, notifyAt } = schedDoc.data();
      const notifyTime = new Date(notifyAt);
      const diffMin = (now - notifyTime) / 60000;

      if (diffMin >= 0 && diffMin < 2) {
        try {
          await getMessaging().send({ token, notification: { title, body } });
          await schedDoc.ref.delete();
        } catch (e) {
          console.error("Erro ao enviar push:", e);
        }
      }
    }
  }
});