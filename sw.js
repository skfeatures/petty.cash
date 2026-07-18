// 1. Import Firebase libraries directly into the background worker
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js');

// 2. Cache Versioning 
const CACHE_NAME = 'budget-store-v0'; 

// 3. Add your exact Firebase config
const firebaseConfig = {
    apiKey: "AIzaSyDVr6AE4xxwW9l1mmhDLyaE2yq3JW6CoNg",
    authDomain: "expensy-note.firebaseapp.com",
    projectId: "expensy-note",
    storageBucket: "expensy-note.firebasestorage.app",
    messagingSenderId: "1007369333200",
    appId: "1:1007369333200:web:e755f04949508cf93a71d5",
    measurementId: "G-9MBMJZ2SWE"
};

// 4. Initialize Firebase in the background
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();
const auth = firebase.auth();

// 5. Install Setup (Fixed file paths here)
self.addEventListener('install', (e) => {
    self.skipWaiting(); 
    e.waitUntil(
      caches.open(CACHE_NAME).then((cache) => {
          return cache.addAll([
              './',
              './index.html', 
              './manifest.json',
              './icon.png',
              './bookman.ttf'
          ]);
      })
    );
});

// 6. Activate Event (Cleans up old caches)
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// 7. Fetch Setup (Aggressive Network-First to Auto-Update HTML)
self.addEventListener('fetch', (event) => {
    // Check if the request is for your HTML file (navigation)
    if (event.request.mode === 'navigate') {
        event.respondWith((async () => {
            try {
                // { cache: 'no-store' } forces the app to bypass the browser's hidden HTTP cache 
                // and fetch the absolute latest index.html directly from GitHub every single time.
                const networkResponse = await fetch(event.request.url, { cache: 'no-store' });
                const cache = await caches.open(CACHE_NAME);
                event.waitUntil(cache.put(event.request, networkResponse.clone()));
                return networkResponse;
            } catch (error) {
                // If offline, safely fallback to the cached version
                const cachedResponse = await caches.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
                throw error;
            }
        })());
        return;
    }

    // For all other assets (fonts, images), use standard Network-First
    event.respondWith((async () => {
        try {
            const networkResponse = await fetch(event.request);
            const cache = await caches.open(CACHE_NAME);
            event.waitUntil(cache.put(event.request, networkResponse.clone()));
            return networkResponse;
        } catch (error) {
            const cachedResponse = await caches.match(event.request);
            if (cachedResponse) {
                return cachedResponse;
            }
            throw error;
        }
    })());
});

// 8. The Periodic Background Sync Listener
self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'auto-backup-sync') {
        console.log('Background sync woke up the app!');
        event.waitUntil(performCloudBackup());
    }
});

// 9. The Background Backup Function
async function performCloudBackup() {
    return new Promise((resolve) => {
        auth.onAuthStateChanged(user => {
            if (user) {
                console.log("User is authenticated in the background:", user.uid);
                resolve();
            } else {
                console.log("No user authenticated in background.");
                resolve();
            }
        });
    });
}