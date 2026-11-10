import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { auth } from './firebase.js';

export function watchAuth(callback) { return onAuthStateChanged(auth, callback); }

export async function login(email, password) {
  const response = await signInWithEmailAndPassword(auth, email, password);
  return response.user;
}

// Firebase sends the reset link; the app never sees or stores the old password.
export async function requestPasswordReset(email) {
  if (!auth) throw new Error('Autenticacao indisponivel.');
  auth.languageCode = 'pt';
  return sendPasswordResetEmail(auth, email.trim());
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const user = auth?.currentUser;
  if (!user || !user.email) throw new Error('Conta indisponivel ou sem e-mail.');
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

export async function logout() { await signOut(auth); }
