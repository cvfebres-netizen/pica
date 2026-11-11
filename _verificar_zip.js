// Verificacao final do zip de deploy: tem de bater certo com o disco.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repo = 'c:/Users/CVF/Desktop/GitHub Projects/1';
const site = path.join(repo, 'cvf_website');
const zip = path.join(repo, 'CVF_Website_deploy.zip');

console.log('=== 1. Zip existe e esta fresco ===');
const st = fs.statSync(zip);
console.log('  ficheiro :', path.basename(zip));
console.log('  tamanho  :', st.size, 'B');
console.log('  modificado:', st.mtime.toISOString());

console.log('\n=== 2. Conteudo do zip ===');
let lista;
try {
  lista = execSync(`pwsh -NoProfile -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::OpenRead('${zip}').Entries | ForEach-Object { $_.FullName }"`, { encoding: 'utf8' })
    .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} catch (e) {
  console.log('  ERRO a ler o zip:', e.message);
  process.exit(1);
}
lista.forEach((f) => console.log('   ', f));
console.log('  total entradas:', lista.length);

console.log('\n=== 3. Zip vs disco (byte a byte) ===');
const tmp = path.join(require('os').tmpdir(), 'cvf_zip_check');
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execSync(`pwsh -NoProfile -Command "Expand-Archive -LiteralPath '${zip}' -DestinationPath '${tmp}' -Force"`);

let divergentes = 0, iguais = 0, soNoZip = 0, soNoDisco = 0;
const andados = new Set();
function walk(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(base, abs).replace(/\\/g, '/');
    if (e.isDirectory()) walk(abs, base);
    else {
      andados.add(rel);
      const noDisco = path.join(site, rel);
      if (!fs.existsSync(noDisco)) { console.log('  SO NO ZIP :', rel); soNoZip++; continue; }
      const a = fs.readFileSync(abs), b = fs.readFileSync(noDisco);
      if (a.equals(b)) { iguais++; }
      else {
        console.log('  DIVERGE   :', rel, `(zip ${a.length}B vs disco ${b.length}B)`);
        divergentes++;
      }
    }
  }
}
walk(tmp, tmp);
for (const f of lista) {
  if (f.endsWith('/')) continue;
  if (!andados.has(f)) { console.log('  SO NO DISCO (nao extraido):', f); }
}
// ficheiros do site que deviam estar no zip e nao estao
const essenciais = ['index.html', '404.html', 'robots.txt', 'sitemap.xml',
  'site.webmanifest', '.htaccess', '.nojekyll',
  'css/style.css', 'js/main.js',
  'assets/cvf-logo.svg', 'assets/cvf-mark.svg', 'assets/favicon.svg'];
console.log('\n=== 4. Ficheiros essenciais ===');
for (const f of essenciais) {
  const ok = lista.includes(f);
  console.log(`   ${ok ? 'OK   ' : 'FALTA'}  ${f}`);
  if (!ok) soNoDisco++;
}

console.log('\n=== 5. Documentacao interna NAO pode ir ===');
const doc = lista.filter((f) => /README|TODO|DESIGN|\.md$|_preparar|_audit|_test_|_build_|_sincronizar|_verificacao/i.test(f));
if (doc.length) { console.log('  FALHA, foi documentacao:', doc.join(', ')); } else { console.log('  OK    nenhuma documentacao interna no zip'); }

console.log('\n=== RESULTADO ===');
console.log(`  iguais: ${iguais} | divergentes: ${divergentes} | so no zip: ${soNoZip} | essenciais em falta: ${soNoDisco}`);
const ok = divergentes === 0 && soNoZip === 0 && soNoDisco === 0 && doc.length === 0;
console.log(ok ? '  ZIP CORRETO E SINCRONIZADO' : '  ZIP COM PROBLEMAS');
process.exit(ok ? 0 : 1);
