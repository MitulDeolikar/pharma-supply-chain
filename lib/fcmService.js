const admin = require('firebase-admin');

function getMessaging() {
  if (!process.env.FCM_SERVICE_ACCOUNT) return null;

  if (!global.__firebaseApp) {
    try {
      const serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
      global.__firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch (e) {
      console.error('Firebase init failed:', e.message);
      return null;
    }
  }

  return admin.messaging(global.__firebaseApp);
}

async function sendPushNotification(token, title, body, data = {}) {
  const messaging = getMessaging();
  if (!messaging || !token) return;
  try {
    await messaging.send({
      token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      android: { priority: 'high', notification: { sound: 'default' } },
    });
  } catch (err) {
    console.error('FCM send error:', err.message);
  }
}

async function notifyUsers(connection, userType, userIds, title, body, data = {}) {
  if (!userIds || userIds.length === 0) return;
  const messaging = getMessaging();
  if (!messaging) return;
  try {
    const placeholders = userIds.map(() => '?').join(',');
    const [rows] = await connection.execute(
      `SELECT fcm_token FROM push_tokens WHERE user_type = ? AND user_id IN (${placeholders})`,
      [userType, ...userIds]
    );
    for (const { fcm_token } of rows) {
      await sendPushNotification(fcm_token, title, body, data);
    }
  } catch (err) {
    console.error('notifyUsers error:', err.message);
  }
}

async function notifyAllCMOs(connection, title, body, data = {}) {
  const messaging = getMessaging();
  if (!messaging) return;
  try {
    const [rows] = await connection.execute(
      `SELECT fcm_token FROM push_tokens WHERE user_type = 'cmo'`
    );
    for (const { fcm_token } of rows) {
      await sendPushNotification(fcm_token, title, body, data);
    }
  } catch (err) {
    console.error('notifyAllCMOs error:', err.message);
  }
}

module.exports = { sendPushNotification, notifyUsers, notifyAllCMOs };
