const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
const db = getFirestore();
const fcm = getMessaging();

// Runs every minute — checks all scheduled notifications
exports.sendPushNotifications = onSchedule("every 1 minutes", async () => {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 60000); // next 60 seconds

  const usersSnap = await db.collection("users").get();

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    // Get FCM token
    const tokenDoc = await db.doc(`users/${uid}/tokens/fcm`).get();
    if (!tokenDoc.exists) continue;
    const { token } = tokenDoc.data();
    if (!token) continue;

    // Check scheduled notifications in window
    const scheduled = await db.collection(`users/${uid}/scheduled`)
      .where("notifyAt", ">=", now.toISOString())
      .where("notifyAt", "<", windowEnd.toISOString())
      .get();

    for (const notifDoc of scheduled.docs) {
      const { title, body, activityId } = notifDoc.data();
      try {
        await fcm.send({
          token,
          notification: { title, body },
          webpush: {
            notification: {
              title, body,
              icon: "https://liparini.github.io/planner/icon-192.png",
              badge: "https://liparini.github.io/planner/icon-192.png",
              tag: activityId,
              renotify: true,
              requireInteraction: true
            },
            fcmOptions: { link: "https://liparini.github.io/planner/" }
          }
        });
        // Delete after sending
        await notifDoc.ref.delete();
        console.log(`Push sent to ${uid}: ${title}`);
      } catch(e) {
        console.error(`Push failed for ${uid}:`, e.message);
      }
    }

    // Check birthday notifications
    const bdaysSnap = await db.collection(`users/${uid}/birthdays`).get();
    const todayM = now.getMonth() + 1, todayD = now.getDate();
    const hour = now.getHours();

    if (hour === 8) { // Send birthday alerts at 8am
      for (const bday of bdaysSnap.docs) {
        const b = bday.data();
        const advanceDays = parseInt(b.notifyDaysBefore ?? 1);
        const bdayDate = new Date(now.getFullYear(), b.month - 1, b.day);
        const notifyDate = new Date(bdayDate);
        notifyDate.setDate(bdayDate.getDate() - advanceDays);

        const isToday = notifyDate.getDate() === todayD && notifyDate.getMonth() + 1 === todayM;
        if (!isToday) continue;

        const fireKey = `bday_${bday.id}_${now.getFullYear()}`;
        const firedDoc = await db.doc(`users/${uid}/fired/${fireKey}`).get();
        if (firedDoc.exists) continue;

        const isBdayToday = b.month === todayM && b.day === todayD;
        const age = b.year ? ` — ${now.getFullYear() - b.year} anos` : "";
        const title = isBdayToday ? `🎂 Aniversário hoje!` : `🎈 Lembrete de aniversário`;
        const body = isBdayToday
          ? `${b.name}${age} — Não esqueça de parabenizar!`
          : `${b.name} faz aniversário em ${advanceDays} dia${advanceDays > 1 ? "s" : ""}${age}`;

        try {
          await fcm.send({
            token,
            notification: { title, body },
            webpush: {
              notification: { title, body, icon: "https://liparini.github.io/planner/icon-192.png", tag: bday.id, renotify: true },
              fcmOptions: { link: "https://liparini.github.io/planner/" }
            }
          });
          await db.doc(`users/${uid}/fired/${fireKey}`).set({ sentAt: Timestamp.now() });
        } catch(e) {
          console.error(`Bday push failed:`, e.message);
        }
      }
    }
  }
});
