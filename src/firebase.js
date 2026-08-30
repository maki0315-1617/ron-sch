import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
let messagingPromise = null;

const resolveMessaging = async () => {
  if (messagingPromise) return messagingPromise;

  messagingPromise = (async () => {
    if (typeof window === 'undefined') return null;
    const supported = await isSupported();
    if (!supported) return null;
    return getMessaging(app);
  })();

  return messagingPromise;
};

export const getFcmToken = async (serviceWorkerRegistration) => {
  const messaging = await resolveMessaging();
  if (!messaging) return null;
  if (!vapidKey) {
    throw new Error('VITE_FIREBASE_VAPID_KEY が未設定です。');
  }
  return getToken(messaging, { vapidKey, serviceWorkerRegistration });
};

export const deleteFcmToken = async () => {
  const messaging = await resolveMessaging();
  if (!messaging) return false;
  return deleteToken(messaging);
};

export const subscribeForegroundNotifications = async (listener) => {
  const messaging = await resolveMessaging();
  if (!messaging) return () => {};
  return onMessage(messaging, listener);
};
