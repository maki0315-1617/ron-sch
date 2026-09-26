import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBn0mED4M3cUFV0a75ZnKU0aS0FVwGBsL0',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'makino-ron.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'makino-ron',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'makino-ron.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '993887680290',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:993887680290:web:26bcfcfc900e7cf445177b'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// 確認メール等のテンプレートを日本語にする
auth.languageCode = 'ja';

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  console.warn('Firestoreの永続キャッシュを初期化できないため、通常のFirestoreへ切り替えます:', error);
  db = getFirestore(app);
}

export { db };

const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY || 'BNcjJ-d0kaK0xHGvtpfWlSd8WRl0TbJ2GrsgZTWifSn2uy5NbAJxmwuY_mTvvj6b6am7GRkKbvXlQ_NC9ZbTaWA';
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
