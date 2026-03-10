import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBy-7UYnVgJIr00sPHM_qSYo9EIwlI9q9M",
  authDomain: "image-url-b925f.firebaseapp.com",
  projectId: "image-url-b925f",
  storageBucket: "image-url-b925f.firebasestorage.app",
  messagingSenderId: "183201943616",
  appId: "1:183201943616:web:c0727a81e773aedf880fa5",
  measurementId: "G-KW6CJ11D4G"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
