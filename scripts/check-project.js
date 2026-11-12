import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const problems = [];
const required = [
  'index.html', 'styles.css', 'src/styles/app.css', 'src/app.js',
  'src/state/state.js', 'src/services/firebase.js', 'src/services/store.js',
  'worker-admin/src/index.js', 'worker-admin/wrangler.jsonc',
  '.gitignore', '.github/workflows/deploy-pages.yml',
  'termos.html', 'privacidade.html', 'src/styles/legal.css',
];
for (const file of required) if (!existsSync(resolve(root, file))) problems.push(`Arquivo ausente: ${file}`);

function walk(folder) {
  if (!existsSync(resolve(root, folder))) return;
  for (const entry of readdirSync(resolve(root, folder), { withFileTypes: true })) {
    const name = `${folder}/${entry.name}`;
    if (entry.isDirectory()) { walk(name); continue; }
    if (extname(entry.name) !== '.js') continue;
    const path = resolve(root, name);
    const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
    if (result.status) problems.push(`Sintaxe inválida: ${name}: ${result.stderr.trim()}`);
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](\.[^'"]+)['"]/g)) {
      const specifier = match[1].split('?')[0];
      const target = resolve(dirname(path), specifier);
      if (!existsSync(target) && target !== resolve(root, 'firebase-config.js')) problems.push(`Import não encontrado: ${name} → ${specifier}`);
    }
  }
}
walk('src'); walk('scripts'); walk('worker-admin/src');

// O código público não armazena nem valida as regras privadas do Firestore.
// A segurança das regras deve ser testada separadamente no emulador/Console do Firebase.
const css = readFileSync(resolve(root,'styles.css'),'utf8');
if (!css.includes('src/styles/app.css')) problems.push('CSS consolidado não referenciado.');
const github = readFileSync(resolve(root,'.gitignore'),'utf8');
if (!github.includes('*.json') || !github.includes('firebase-config.js') || !github.split(/\r?\n/).includes('*.rules')) problems.push('Proteção de credenciais incompleta.');
// .gitignore não desfaz rastreamento antigo; detectar antes da publicação.
const trackedRules = spawnSync('git', ['ls-files', '--cached', '--', '*.rules'], { cwd: root, encoding: 'utf8' });
if (trackedRules.status === 0 && trackedRules.stdout.trim()) {
  problems.push(`Regras privadas ainda rastreadas pelo Git: ${trackedRules.stdout.trim().replace(/\n/g, ', ')}. Execute git rm --cached --ignore-unmatch firestore.rules e faça commit da remoção.`);
}


// Segurança do pacote: nunca distribuir chaves ou configs locais.
for (const name of readdirSync(root)) {
  if (/^\.env\.(?!development\.example$)/.test(name) || /^firebase-adminsdk/i.test(name)) {
    console.warn(`ATENÇÃO: arquivo local privado detectado; não envie ao GitHub: ${name}`);
  }
}
if (problems.length) {
  for (const problem of problems) console.error(problem);
  process.exitCode = 1;
} else console.log('Controly: sintaxe, imports e arquivos essenciais OK. Regras Firestore: validação privada separada.');
