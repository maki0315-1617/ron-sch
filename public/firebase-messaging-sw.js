importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.17.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBn0mED4M3cUFV0a75ZnKU0aS0FVwGBsL0',
  authDomain: 'makino-ron.firebaseapp.com',
  projectId: 'makino-ron',
  storageBucket: 'makino-ron.firebasestorage.app',
  messagingSenderId: '993887680290',
  appId: '1:993887680290:web:26bcfcfc900e7cf445177b',
});

const messaging = firebase.messaging();
const BADGE_DB_NAME = 'notification-badge-db';
const BADGE_STORE_NAME = 'badge-state';
const BADGE_KEY = 'count';
let badgeOperation = Promise.resolve();

const withBadgeLock = (action) => {
  const next = badgeOperation.then(action, action);
  badgeOperation = next.catch(() => {});
  return next;
};

const openBadgeDb = () => {
  return new Promise((resolve, reject) => {
   const request = indexedDB.open(BADGE_DB_NAME, 1);

   request.onupgradeneeded = () => {
     const database = request.result;
     if (!database.objectStoreNames.contains(BADGE_STORE_NAME)) {
       database.createObjectStore(BADGE_STORE_NAME);
     }
   };

   request.onsuccess = () => resolve(request.result);
   request.onerror = () => reject(request.error);
  });
};

const readBadgeCount = async () => {
  const database = await openBadgeDb();
  return new Promise((resolve, reject) => {
   const transaction = database.transaction(BADGE_STORE_NAME, 'readonly');
   const store = transaction.objectStore(BADGE_STORE_NAME);
   const request = store.get(BADGE_KEY);

   request.onsuccess = () => resolve(Number(request.result || 0));
   request.onerror = () => reject(request.error);
   transaction.oncomplete = () => database.close();
   transaction.onerror = () => {
     database.close();
     reject(transaction.error);
   };
  });
};

const writeBadgeCount = async (count) => {
  const database = await openBadgeDb();
  return new Promise((resolve, reject) => {
   const transaction = database.transaction(BADGE_STORE_NAME, 'readwrite');
   transaction.objectStore(BADGE_STORE_NAME).put(Number(count) || 0, BADGE_KEY);
   transaction.oncomplete = () => {
     database.close();
     resolve(Number(count) || 0);
   };
   transaction.onerror = () => {
     database.close();
     reject(transaction.error);
   };
  });
};

const incrementBadgeCount = async () => {
  return withBadgeLock(async () => {
    const nextCount = (await readBadgeCount()) + 1;
    await writeBadgeCount(nextCount);
    return nextCount;
  });
};

const decrementBadgeCount = async () => {
  return withBadgeLock(async () => {
    const nextCount = Math.max((await readBadgeCount()) - 1, 0);
    await writeBadgeCount(nextCount);
    return nextCount;
  });
};

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'スケジュール通知';
  const body = payload.notification?.body || '予定の開始時間です。';

  incrementBadgeCount().then((badgeCount) => {
   if ('setAppBadge' in self.registration) {
     self.registration.setAppBadge(badgeCount).catch(() => {});
   }
  }).catch(() => {});

  self.registration.showNotification(title, {
   body,
   icon: '/favicon.ico',
   data: payload.data || {},
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const badgeCount = await decrementBadgeCount().catch(() => 0);
    if ('setAppBadge' in self.registration && badgeCount > 0) {
      await self.registration.setAppBadge(badgeCount).catch(() => {});
    } else if ('clearAppBadge' in self.registration) {
      await self.registration.clearAppBadge().catch(() => {});
    }

    const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clientList.length > 0) {
      clientList.forEach((client) => client.postMessage({ type: 'notification-clicked' }));
      clientList[0].focus();
      return;
    }

    await clients.openWindow('/');
  })());
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'get-badge-count') return;

  event.waitUntil((async () => {
    const badgeCount = await readBadgeCount().catch(() => 0);
    if (event.source) {
      event.source.postMessage({ type: 'badge-count', count: badgeCount });
    }
  })());
});
