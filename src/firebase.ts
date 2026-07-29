import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCBlMDHYeMK-MNd_bi0vMCd3ztgPMIggrU",
  authDomain: "elim-b1fff.firebaseapp.com",
  projectId: "elim-b1fff",
  storageBucket: "elim-b1fff.firebasestorage.app",
  messagingSenderId: "81584374169",
  appId: "1:81584374169:web:738850ef41e050ac389308",
  measurementId: "G-M16R1LH5L7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Services we will use
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
