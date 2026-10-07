/* Confirma que todas as chamadas api('...')/backend('...') do index.html existem no backend. */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

const chamadas = {};
let m;
const re = /(?:api|backend)\s*\(\s*['"]([A-Za-z0-9_$]+)['"]/g;
while ((m = re.exec(html))) chamadas[m[1]] = true;

const nomes = Object.keys(chamadas).sort();

const declaradas = {};
fs.readdirSync(dir)
  .filter(function(f) { return f.endsWith('.gs') && f !== 'code.gs'; })
  .forEach(function(f) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    let d;
    const reFun = /^function\s+([A-Za-z0-9_$]+)/gm;
    while ((d = reFun.exec(src))) declaradas[d[1]] = f;
  });

const faltam = nomes.filter(function(n) { return !declaradas[n]; });

console.log('Chamadas backend usadas pelo frontend: ' + nomes.length);
faltam.forEach(function(n) { console.log('EM FALTA NO BACKEND: ' + n); });
console.log(faltam.length === 0
  ? 'RESULTADO: todas as chamadas do frontend existem no backend'
  : 'RESULTADO: ' + faltam.length + ' chamada(s) sem funcao no backend');

/* Código de saída honesto: sem isto, uma chamada de frontend em falta
   (queixo preto em produção) imprimia o aviso e devolvia 0. */
process.exitCode = faltam.length === 0 ? 0 : 1;
