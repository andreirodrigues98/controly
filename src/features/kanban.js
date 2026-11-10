/** Apresentação das mesmas entidades em quadros, sem coleções adicionais. */
export const READING_COLUMNS = [
  { id: 'Quero ler', title: 'Quero ler', subtitle: 'Sua lista de próximas leituras' },
  { id: 'Lendo', title: 'Lendo', subtitle: 'Livros em andamento' },
  { id: 'Pausado', title: 'Pausados', subtitle: 'Para retomar depois' },
  { id: 'Concluído', title: 'Concluídos', subtitle: 'Leituras finalizadas' },
  { id: 'Abandonado', title: 'Arquivados', subtitle: 'Leituras interrompidas' },
];
export const FINANCE_COLUMNS = [
  { id: 'spent', label: 'A pagar', flowType: 'expense', status: 'pending' },
  { id: 'receivable', label: 'A receber', flowType: 'income', status: 'pending' },
  { id: 'paid', label: 'Pago', flowType: 'expense', status: 'paid' },
  { id: 'received', label: 'Recebido', flowType: 'income', status: 'received' },
];
export function allowedFinanceDrop(entry, columnId) {
  const target = FINANCE_COLUMNS.find((column) => column.id === columnId);
  return Boolean(entry && target && target.flowType === entry.flowType);
}
export function readingMoveNeedsReset(book, status) {
  const read = Math.max(0, Number(book?.pagesRead) || 0);
  const total = Math.max(0, Number(book?.totalPages) || 0);
  // Conclusão integral não pode virar "Lendo" ou "Pausado" sem recomeçar de propósito.
  return (status === 'Quero ler' && read > 0) ||
    (total > 0 && read >= total && status !== 'Concluído');
}

export function nextReadingProgress(book, status, idFactory = () => '', options = {}) {
  if (!READING_COLUMNS.some((column) => column.id === status)) throw new Error('Etapa de leitura inválida.');
  const oldPages = Math.max(0, Number(book?.pagesRead) || 0);
  const totalPages = Math.max(0, Number(book?.totalPages) || 0);
  if (readingMoveNeedsReset(book, status) && !options.resetProgress) {
    throw new Error('Confirme o reinício da leitura antes de alterar uma etapa com progresso registrado.');
  }
  const pagesRead = status === 'Concluído' && totalPages > 0 ? totalPages
    : (options.resetProgress ? 0 : oldPages);
  const readingLog = Array.isArray(book?.readingLog) ? [...book.readingLog] : [];
  // Alterar status não pode apagar páginas ou histórico; conclusão com total definido finaliza o progresso.
  if (pagesRead !== oldPages) readingLog.unshift({ id: idFactory(), date: new Date().toISOString().slice(0, 10), pagesRead, delta: pagesRead - oldPages });
  return { status, pagesRead, readingLog: readingLog.slice(0, 90) };
}
