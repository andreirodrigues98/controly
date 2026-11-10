import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, renderConfig } from './config-core.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

function flag(name) {
  const inline = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

const environment = flag('env') || 'development';
const output = flag('output') ? resolve(projectRoot, flag('output')) : resolve(projectRoot, 'firebase-config.js');

try {
  const data = createConfig({ environment, projectRoot, processEnvironment: process.env });
  // Nunca depositar um arquivo de produção no diretório servido localmente.
  if (environment === 'production' && output === resolve(projectRoot, 'firebase-config.js')) {
    throw new Error('Produção deve ser gerada em dist/. Use npm run build:production.');
  }
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderConfig(data), { encoding: 'utf8', mode: 0o600 });
  console.log(`Firebase configurado para ambiente ${environment}.`);
} catch (error) {
  console.error(`Falha ao gerar a configuração: ${error.message}`);
  process.exitCode = 1;
}
