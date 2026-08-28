import { initializeApp } from "firebase/app";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCBlMDHYeMK-MNd_bi0vMCd3ztgPMIggrU",
  authDomain: "elim-b1fff.firebaseapp.com",
  projectId: "elim-b1fff",
  storageBucket: "elim-b1fff.firebasestorage.app",
  messagingSenderId: "81584374169",
  appId: "1:81584374169:web:738850ef41e050ac389308",
  measurementId: "G-M16R1LH5L7"
};

const app = initializeApp(firebaseConfig);

// Keep people signed in across app restarts (the #1 complaint). The default
// getAuth() persistence can be lost in the Android WebView; naming the
// persistence chain explicitly - IndexedDB first, then localStorage, then a
// couple of fallbacks so it never fails to initialise - makes the session
// survive closing the app and works offline.
export const auth = initializeAuth(app, {
  persistence: [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ],
});

// Firestore with an on-device cache, so the feed, posts, library list and
// health tips stay readable offline once they've been seen. Reads come from
// the cache instantly and sync when the connection returns.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
// Callable Cloud Functions live in us-central1 (the default region the
// functions are deployed to). Used by the on-demand content translator.
export const functions = getFunctions(app);
export { app };

export default app;
