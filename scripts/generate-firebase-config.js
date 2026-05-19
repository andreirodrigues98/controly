import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const envPath = resolve(projectRoot, '.env');

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) return [line, ''];
        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
  );
}

const fileEnv = parseEnvFile(envPath);
const readEnv = (key) => process.env[key] || fileEnv[key] || '';

const config = {
  apiKey: readEnv('FIREBASE_API_KEY'),
  authDomain: readEnv('FIREBASE_AUTH_DOMAIN'),
  projectId: readEnv('FIREBASE_PROJECT_ID'),
  storageBucket: readEnv('FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: readEnv('FIREBASE_MESSAGING_SENDER_ID'),
  appId: readEnv('FIREBASE_APP_ID'),
};

const missing = Object.entries(config)
  .filter(([, value]) => !value || String(value).includes('COLE_AQUI'))
  .map(([key]) => key);

if (missing.length) {
  console.error(`Configuração incompleta do Firebase. Campos faltando: ${missing.join(', ')}`);
  console.error('Crie um arquivo .env local ou configure os Secrets no GitHub.');
  process.exit(1);
}

const output = `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;
writeFileSync(resolve(projectRoot, 'firebase-config.js'), output, 'utf8');
console.log('firebase-config.js gerado com sucesso.');
