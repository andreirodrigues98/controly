/** Regras de teclado compartilhadas entre formulários. Nenhum atalho confirma ações destrutivas. */
export function shouldSubmitModalFormOnEnter({ key = '', tag = '', inputType = '', ctrlKey = false, metaKey = false, altKey = false, shiftKey = false, isComposing = false, defaultPrevented = false, editable = false } = {}) {
  if (key !== 'Enter' || isComposing || defaultPrevented || altKey || shiftKey) return false;
  if (editable) return false;
  const type = String(inputType).toLowerCase();
  const node = String(tag).toUpperCase();
  const shortcut = Boolean(ctrlKey || metaKey);
  if (node === 'TEXTAREA') return shortcut;
  if (node !== 'INPUT') return false;
  if (!['text', 'email', 'search', 'tel', 'url', 'number', 'password'].includes(type)) return false;
  return true;
}
