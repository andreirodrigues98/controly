// Chaves exclusivas por projeto Firebase, ambiente e usuario autenticado.
import { firebaseConfig, controlyRuntime } from '../../firebase-config.js';
import { state } from '../state/state.js';
import { makeScopedKey } from './scoped-key-core.js';

export { makeScopedKey } from './scoped-key-core.js';

export function scopedKey(feature) {
  return makeScopedKey({
    environment: controlyRuntime.environment,
    projectId: firebaseConfig.projectId,
    uid: state.user?.uid,
    feature,
  });
}
