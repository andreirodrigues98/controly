import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const files = ['index.html', 'firebase-config.js', 'src/app.js', 'src/services/firebase.js', 'styles.css', 'privacidade.html', 'termos.html'];
const errors = [];
for (const file of files) {
  const path = resolve(dist, file);
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    errors.push(`Ausente ou vazio no pacote de publicação: ${file}`);
  }
}
if (errors.length === 0) {
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  const config = readFileSync(resolve(dist, 'firebase-config.js'), 'utf8');
  if (!html.includes("import('./src/app.js?v=")) errors.push('Inicialização da aplicação não encontrada no HTML público.');
  if (!config.includes('export const firebaseConfig =') || !config.includes('export const controlyRuntime =')) {
    errors.push('Configuração pública do Firebase inválida.');
  }
  if (!config.includes('"environment": "production"')) errors.push('O pacote não está configurado como produção.');
}
if (errors.length) {
  for (const error of errors) console.error(`::error::${error}`);
  process.exitCode = 1;
} else {
  console.log('Pacote GitHub Pages validado: configuração Firebase e aplicação presentes em dist/.');
}
