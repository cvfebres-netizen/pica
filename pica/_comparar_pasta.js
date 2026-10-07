/* Compara byte a byte as duas copias do codigo de producao: a pasta pica
   (fonte) e a pasta picadeploy (a que se carrega no Apps Script).
   Sai com codigo 1 se divergirem — e o que impede publicar uma versao
   antiga por cima da corrigida. */
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PICA = __dirname;
const DEPLOY = path.join(RAIZ, 'picadeploy');

let divergencias = 0;
function divergir(msg) { divergencias++; console.log('DIVERGENCIA  ' + msg); }

/* A lista de producao vem do proprio disco: qualquer .gs novo na pasta de
   fonte tem de estar na pasta de upload, e vice-versa. */
const ESPERADOS = fs.readdirSync(PICA)
  .filter(function (f) { return f.endsWith('.gs') || f === 'index.html' || f === 'appsscript.json'; })
  .sort();

/* ---- picadeploy: a pasta que se carrega no Apps Script ----
   Esta comparacao e a mais importante: e o que impede carregar uma versao
   antiga por cima da corrigida, que foi o que aconteceu antes. */
console.log('=== picadeploy (' + DEPLOY + ') ===');
if (!fs.existsSync(DEPLOY)) {
  divergir('a pasta picadeploy nao existe — correr: node _sincronizar.js');
} else {
  const naPasta = fs.readdirSync(DEPLOY);

  /* Subpastas: o Apps Script so aceita ficheiros na raiz e o `clasp push`
     nao as envia. Denunciam lixo esquecido. */
  naPasta.forEach(function (f) {
    if (fs.statSync(path.join(DEPLOY, f)).isDirectory()) divergir('picadeploy tem a subpasta ' + f);
  });

  /* Nada a mais: um ficheiro extra seria enviado ao Apps Script e, se for um
     .gs, duplicaria funcoes. O `.clasp.json` e a ligacao ao projecto. */
  naPasta.forEach(function (f) {
    if (f === '.clasp.json') return;
    if (!fs.statSync(path.join(DEPLOY, f)).isFile()) return;
    if (ESPERADOS.indexOf(f) === -1) divergir('no picadeploy mas nao em pica: ' + f);
  });

  ESPERADOS.forEach(function (f) {
    const d = path.join(DEPLOY, f);
    if (!fs.existsSync(d)) return divergir('ausente no picadeploy: ' + f);
    const igual = fs.readFileSync(path.join(PICA, f)).equals(fs.readFileSync(d));
    console.log((igual ? '  OK         ' : '  DIFERENTE  ') + f);
    if (!igual) divergir('picadeploy desatualizado: ' + f);
  });
}

console.log('\nDIVERGENCIAS: ' + divergencias);
if (divergencias) {
  console.log('Correcao: a pasta pica e a fonte. Correr  node _sincronizar.js');
  process.exit(1);
}
console.log('As duas copias estao identicas. Pasta a carregar: ' + DEPLOY);
