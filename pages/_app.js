import "@/styles/globals.css";
import { useRouter } from "next/router";
import { useEffect } from "react";
require("dotenv").config();

// ── Global fetch interceptor: auto-attach JWT + API base URL to all /api/ calls ──
if (typeof window !== 'undefined') {
  const _originalFetch = window.fetch;
  const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';
  window.fetch = function (url, options = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      const token = localStorage.getItem('token');
      if (token) options.headers = { ...options.headers, Authorization: token };
      if (API_BASE) url = API_BASE + url;
    }
    return _originalFetch(url, options);
  };
}

function parseJWT(token) {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch {
    return null;
  }
}

function getUserIdFromPayload(payload) {
  switch (payload?.role) {
    case 'cmo':       return payload.cmo_id;
    case 'pharmacy':  return payload.pharmacy_id;
    case 'doctor':    return payload.doctor_id;
    case 'patient':   return payload.opd_id;
    case 'warehouse': return payload.warehouse_id;
    default:          return null;
  }
}

let _pushRegistered = false;
let _pushInProgress = false;

async function registerPushNotifications() {
  if (_pushRegistered || _pushInProgress) return;
  _pushInProgress = true;
  try {
    const token = localStorage.getItem('token');
    if (!token) { _pushInProgress = false; return; }

    const payload = parseJWT(token);
    const user_type = payload?.role;
    const user_id = getUserIdFromPayload(payload);
    if (!user_type || !user_id) { _pushInProgress = false; return; }

    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) { _pushInProgress = false; return; }

    const { PushNotifications } = await import('@capacitor/push-notifications');

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') { _pushInProgress = false; return; }

    // Add listeners BEFORE calling register() to avoid missing the event
    PushNotifications.addListener('registration', async (tokenData) => {
      _pushRegistered = true;
      _pushInProgress = false;
      try {
        await fetch('/api/savePushToken', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_type, user_id, fcm_token: tokenData.value }),
        });
      } catch (e) {
        console.error('Failed to save push token:', e);
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Push registration error:', err);
      _pushRegistered = false;
      _pushInProgress = false;
    });

    await PushNotifications.register();

  } catch (e) {
    console.error('Push notification setup error:', e);
    _pushInProgress = false;
  }
}

export default function App({ Component, pageProps }) {
  const router = useRouter();

  useEffect(() => {
    registerPushNotifications();

    const handleStorageChange = (e) => {
      if (e.key === 'token') registerPushNotifications();
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    registerPushNotifications();
  }, [router.pathname]);

  const logout = () => {
    _pushRegistered = false;
    _pushInProgress = false;
    localStorage.removeItem("token");
    router.push("/");
  };

  return <Component {...pageProps} logout={logout} />;
}
