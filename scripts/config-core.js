import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIELDS = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId: 'FIREBASE_APP_ID',
};

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const originalLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith('#')) continue;
    const splitAt = line.indexOf('=');
    if (splitAt < 1) throw new Error(`Linha inválida no arquivo de ambiente: ${line.slice(0, 40)}`);
    const key = line.slice(0, splitAt).trim();
    const value = line.slice(splitAt + 1).trim();
    result[key] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return result;
}

function adminWorkerUrl(values) {
  const raw = String(values.CONTROLY_ADMIN_WORKER_URL || '').trim().replace(/\/$/, '');
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('invalid');
    return parsed.origin;
  } catch { throw new Error('CONTROLY_ADMIN_WORKER_URL deve ser uma URL HTTPS válida da API, sem caminho adicional.'); }
}

function fromKeys(source) {
  const config = Object.fromEntries(Object.entries(FIELDS).map(([name, key]) => [name, source[key] || '']));
  const missing = Object.entries(config)
    .filter(([, value]) => !String(value).trim() || /COLE_AQUI|SEU_|YOUR_|EXEMPLO|PLACEHOLDER/i.test(String(value)))
    .map(([name]) => FIELDS[name]);
  if (missing.length) throw new Error(`Configuração Firebase incompleta: ${missing.join(', ')}`);
  return config;
}

export function createConfig({ environment, projectRoot, processEnvironment = {} }) {
  if (environment === 'development') {
    const filePath = resolve(projectRoot, '.env.development');
    if (!existsSync(filePath)) throw new Error('Crie .env.development a partir de .env.development.example, com um projeto Firebase exclusivo de desenvolvimento.');
    // Um ambiente dedicado exige arquivo explícito. Nunca herdamos Secrets de produção automaticamente.
    const values = parseEnvFile(filePath);
    const firebaseConfig = fromKeys(values);
    if (firebaseConfig.projectId.startsWith('demo-')) throw new Error('Para usar projeto demo, selecione --env=local.');
    if (values.CONTROLY_DEV_PROJECT_CONFIRMED !== firebaseConfig.projectId) {
      throw new Error('CONTROLY_DEV_PROJECT_CONFIRMED deve repetir exatamente o ID do projeto de desenvolvimento.');
    }
    const productionProject = processEnvironment.CONTROLY_PRODUCTION_PROJECT_ID;
    if (productionProject && productionProject === firebaseConfig.projectId) throw new Error('O projeto de desenvolvimento não pode ser igual ao de produção.');
    return { firebaseConfig, controlyRuntime: { environment: 'development', appCheckSiteKey: values.CONTROLY_APPCHECK_SITE_KEY || '', appCheckDebug: values.CONTROLY_APPCHECK_DEBUG === 'true', adminBackendEnabled: values.CONTROLY_ADMIN_BACKEND_ENABLED === 'true', adminWorkerUrl: adminWorkerUrl(values) } };
  }

  if (environment === 'production') {
    // Produção usa exclusivamente variáveis do processo (GitHub Secrets), não arquivos locais.
    const firebaseConfig = fromKeys(processEnvironment);
    if (firebaseConfig.projectId.startsWith('demo-')) throw new Error('Um projeto Firebase demo nunca pode ser publicado como produção.');
    return { firebaseConfig, controlyRuntime: { environment: 'production', appCheckSiteKey: processEnvironment.CONTROLY_APPCHECK_SITE_KEY || '', adminBackendEnabled: processEnvironment.CONTROLY_ADMIN_BACKEND_ENABLED === 'true', adminWorkerUrl: adminWorkerUrl(processEnvironment) } };
  }

  throw new Error('Ambiente inválido. Utilize development ou production.');
}

export function renderConfig(data) {
  return `// Gerado automaticamente. Não edite nem publique fora do build de produção.\nexport const firebaseConfig = ${JSON.stringify(data.firebaseConfig, null, 2)};\nexport const controlyRuntime = ${JSON.stringify(data.controlyRuntime, null, 2)};\n`;
}
