import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig, renderConfig } from './config-core.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'dist');

try {
  // Configuracao de producao validada ANTES de criar um pacote publicavel.
  const config = createConfig({ environment: 'production', projectRoot: root, processEnvironment: process.env });
  const required = ['index.html', 'styles.css', 'manifest.json'];
  for (const file of required) if (!existsSync(resolve(root, file))) throw new Error(`Arquivo inexistente: ${file}`);

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const file of required) cpSync(resolve(root, file), resolve(destination, file));
  cpSync(resolve(root, '.nojekyll'), resolve(destination, '.nojekyll'));
  cpSync(resolve(root, 'src'), resolve(destination, 'src'), { recursive: true });
  cpSync(resolve(root, 'img'), resolve(destination, 'img'), { recursive: true });
  writeFileSync(resolve(destination, 'firebase-config.js'), renderConfig(config), { encoding: 'utf8', mode: 0o600 });
  console.log('Pacote de producao montado em dist/ (apenas arquivos publicos).');
} catch (error) {
  // Build invalido NUNCA deixa um artefato de producao anterior disponivel.
  rmSync(destination, { recursive: true, force: true });
  console.error(`Build bloqueado: ${error.message}`);
  process.exitCode = 1;
}
