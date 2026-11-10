/** Foto pequena para avatar, sem Storage e sem enviar o arquivo original. */
export function isAllowedAvatarFile(file) {
  return Boolean(file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) && file.size > 0 && file.size <= 6 * 1024 * 1024);
}
export async function compressAvatarFile(file) {
  if (!isAllowedAvatarFile(file)) throw new Error('Escolha uma foto JPG, PNG ou WebP de até 6 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Não foi possível abrir a imagem.'));
      image.src = url;
    });
    const side = 180;
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Seu navegador não conseguiu processar a foto.');
    // Corta para formato quadrado central, sem distorcer.
    const crop = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - crop) / 2;
    const sy = (image.naturalHeight - crop) / 2;
    context.drawImage(image, sx, sy, crop, crop, 0, 0, side, side);
    let result = canvas.toDataURL('image/jpeg', 0.76);
    if (result.length > 72000) result = canvas.toDataURL('image/jpeg', 0.56);
    if (result.length > 72000) throw new Error('A foto ficou grande demais. Escolha outra imagem.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}


/** Traduz falhas de upload para mensagens compreensíveis, sem exibir detalhes internos ao usuário. */
export function avatarUploadErrorMessage(error) {
  const code = String(error?.code || '');
  if (code === 'permission-denied' || code === 'firestore/permission-denied') {
    return 'Sua conta não tem permissão para salvar a foto. Entre em contato com o suporte.';
  }
  if (code === 'not-found' || code === 'firestore/not-found') {
    return 'Seu perfil ainda não está disponível. Entre novamente e tente salvar a foto.';
  }
  if (code === 'unavailable' || code === 'firestore/unavailable' || code === 'deadline-exceeded') {
    return 'Não foi possível conectar para salvar a foto. Verifique a conexão e tente novamente.';
  }
  if (code === 'resource-exhausted' || code === 'firestore/resource-exhausted') {
    return 'O serviço está ocupado no momento. Tente salvar a foto novamente em instantes.';
  }
  if (code === 'unauthenticated' || code === 'firestore/unauthenticated') {
    return 'Sua sessão precisa ser renovada. Entre novamente para alterar a foto.';
  }
  // As mensagens produzidas pelo próprio processamento de imagens são seguras e específicas.
  if (typeof error?.message === 'string' && [
    'Escolha uma foto JPG, PNG ou WebP de até 6 MB.',
    'Não foi possível abrir a imagem.',
    'Seu navegador não conseguiu processar a foto.',
    'A foto ficou grande demais. Escolha outra imagem.',
    'A imagem não atende aos limites permitidos.',
  ].includes(error.message)) return error.message;
  return 'Não foi possível salvar a foto. Tente novamente com outra imagem.';
}
