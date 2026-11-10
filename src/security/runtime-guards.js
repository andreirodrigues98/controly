// Verificado ANTES de inicializar o Firebase para evitar conexão acidental ao ambiente errado.
export function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname).toLowerCase());
}

export function assertSafeRuntime(runtime, hostname, projectId) {
  const environment = runtime?.environment;
  const isLocalBrowser = isLoopbackHost(hostname);

  if (environment === 'local') {
    if (!isLocalBrowser || projectId !== 'demo-controly-local') {
      throw new Error('Configuração local bloqueada: somente localhost e o projeto demo são permitidos.');
    }
    if (runtime.authEmulator !== 'http://127.0.0.1:9099' || runtime.firestoreEmulatorHost !== '127.0.0.1' || runtime.firestoreEmulatorPort !== 8080) {
      throw new Error('Configuração de emuladores locais inesperada.');
    }
  } else if (environment === 'development') {
    if (!isLocalBrowser || String(projectId).startsWith('demo-')) {
      throw new Error('Projeto remoto de desenvolvimento permitido apenas em localhost e com ID não demo.');
    }
  } else if (environment === 'live-preview') {
    if (!isLocalBrowser || String(projectId).startsWith('demo-') || runtime.confirmedProjectId !== projectId || runtime.livePreviewAcknowledged !== true || runtime.appCheckDebug) {
      throw new Error('Visualizacao com Firebase real bloqueada: somente localhost e confirmacao explicita do projeto sao permitidos.');
    }
  } else if (environment === 'production') {
    if (isLocalBrowser || String(projectId).startsWith('demo-') || runtime.appCheckDebug) {
      throw new Error('Configuração de produção bloqueada em localhost ou projeto demo.');
    }
  } else {
    throw new Error('Ambiente de execução inválido ou ausente.');
  }
}
