import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase.js";

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  const response = await signInWithEmailAndPassword(auth, email, password);
  return response.user;
}

export async function logout() {
  await signOut(auth);
}
