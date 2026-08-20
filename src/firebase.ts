import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
// Callable Cloud Functions live in us-central1 (the default region the
// functions are deployed to). Used by the on-demand content translator.
export const functions = getFunctions(app);
export { app };

export default app;
