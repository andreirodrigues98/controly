import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  connectFirestoreEmulator,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import { firebaseConfig, controlyRuntime } from '../../firebase-config.js';
import { assertSafeRuntime } from '../security/runtime-guards.js';

assertSafeRuntime(controlyRuntime, window.location.hostname, firebaseConfig.projectId);

export const firebaseIsConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
export const app = firebaseIsConfigured ? initializeApp(firebaseConfig) : null;

// App Check is opt-in: configure site key in a SEPARATE Firebase project, monitor metrics,
// then enable enforcement in Firebase console only after validation. Never enable debug in prod.
export const appCheck = app && controlyRuntime.appCheckSiteKey && controlyRuntime.environment !== 'local'
  ? (() => {
      if (controlyRuntime.environment === 'development' && controlyRuntime.appCheckDebug) {
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      return initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(controlyRuntime.appCheckSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    })()
  : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;

if (auth && db && controlyRuntime.environment === 'local') {
  // Essas conexões precisam ocorrer antes de qualquer login, consulta ou gravação.
  connectAuthEmulator(auth, controlyRuntime.authEmulator, { disableWarnings: true });
  connectFirestoreEmulator(db, controlyRuntime.firestoreEmulatorHost, controlyRuntime.firestoreEmulatorPort);
  console.info('Controly em ambiente LOCAL: Authentication e Firestore emulados.');
}

if (auth) {
  setPersistence(auth, browserLocalPersistence).catch((error) => {
    console.warn('Falha ao ativar persistência do login:', error);
  });
}
