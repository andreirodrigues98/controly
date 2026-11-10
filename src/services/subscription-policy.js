// Coleções assinadas somente enquanto a seção necessita de dados atualizados.
// Ao navegar para outra tela, a interface conserva o último estado local e revalida os dados.
export const COLLECTIONS_BY_SECTION = Object.freeze({
  dashboard: ['activities','tasks','habits','routines','events','goals','subjects','studySessions','readingItems','workouts','financeEntries','financeCards'],
  activities: ['activities','tasks','habits','routines'],
  calendar: ['activities','tasks','habits','routines','events','goals','subjects','workouts','financeEntries','financeCards'],
  goals: ['goals','activities','readingItems','workouts','subjects','studySessions','financeEntries'],
  studies: ['subjects','studySessions','studyMaterials'],
  reading: ['readingItems'],
  workouts: ['workouts'],
  finance: ['financeCards','financeEntries'],
  notes: ['notes'],
  search: ['activities','tasks','habits','routines','events','goals','subjects','studySessions','studyMaterials','readingItems','workouts','financeEntries','financeCards','notes','trash'],
  trash: ['trash'],
  settings: [],
});
export function collectionsForSection(section) {
  return [...new Set(COLLECTIONS_BY_SECTION[section] || COLLECTIONS_BY_SECTION.dashboard)];
}
