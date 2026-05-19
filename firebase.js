import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

function hasPlaceholderConfig(config) {
  return Object.values(config).some((value) => String(value).includes("COLE_AQUI") || String(value).includes("SEU_"));
}

export const firebaseIsConfigured = !hasPlaceholderConfig(firebaseConfig);

export const app = firebaseIsConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn("Falha ao ativar persistência do login:", error);
  });
}
