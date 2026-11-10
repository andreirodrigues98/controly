/** Categorias são opcionais: um treino sem categoria continua sendo um registro válido. */
export const WORKOUT_TYPE_KEYS = Object.freeze(['gym', 'running', 'cardio', 'other']);
export function selectedWorkoutTypes(primary = '', extraTypes = []) {
  const values = [primary, ...(Array.isArray(extraTypes) ? extraTypes : [])];
  return [...new Set(values.filter((type) => WORKOUT_TYPE_KEYS.includes(type)))];
}
