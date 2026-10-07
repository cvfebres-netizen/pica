/* ============================================================
   VERIFICACAO EM 10 PASSOS — app pica
   Uso: node _check_geral.js   (ficheiro local; nao vai para o Apps Script)
   ============================================================ */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = __dirname;
const FICHEIROS = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.gs'); });
const src = {};
FICHEIROS.forEach(function(f) { src[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

let falhas = 0;
function passo(n, titulo) { console.log('\n--- PASSO ' + n + ': ' + titulo + ' ---'); }
function ok(msg) { console.log('  OK   ' + msg); }
function erro(msg) { falhas++; console.log('  ERRO ' + msg); }

/* ---------- PASSO 1: sintaxe ---------- */
passo(1, 'Sintaxe de todos os ficheiros .gs');
FICHEIROS.forEach(function(f) {
  try { new vm.Script(src[f], { filename: f }); }
  catch (e) { erro(f + ' :: ' + e.message); }
});
if (falhas === 0) ok(FICHEIROS.length + ' ficheiros .gs com sintaxe valida');

/* ---------- PASSO 2: duplicados ---------- */
passo(2, 'Funcoes e constantes duplicadas entre ficheiros');
const funcoes = {}, constantes = {};
FICHEIROS.forEach(function(f) {
  let m;
  const reF = /^function\s+([A-Za-z0-9_$]+)/gm;
  while ((m = reF.exec(src[f]))) (funcoes[m[1]] = funcoes[m[1]] || []).push(f);
  const reC = /^(?:const|var|let)\s+([A-Z][A-Z0-9_]+)\s*=/gm;
  while ((m = reC.exec(src[f]))) (constantes[m[1]] = constantes[m[1]] || []).push(f);
});
Object.keys(funcoes).forEach(function(n) {
  if (funcoes[n].length > 1) erro('funcao ' + n + ' em ' + funcoes[n].join(' + '));
});
Object.keys(constantes).forEach(function(n) {
  if (constantes[n].length > 1) erro('constante ' + n + ' em ' + constantes[n].join(' + '));
});
ok(Object.keys(funcoes).length + ' funcoes declaradas, sem nomes repetidos');

/* ---------- PASSO 3: SHEETS ---------- */
passo(3, 'Referencias SHEETS.X apontam para chaves existentes');
const cfg = src['Config.gs'] || '';
const blocoSheets = cfg.match(/const SHEETS = \{([\s\S]*?)\n\};/);
const chavesSheets = blocoSheets ? [...blocoSheets[1].matchAll(/([A-Z_]+):/g)].map(function(m) { return m[1]; }) : [];
if (!chavesSheets.length) erro('nao foi possivel ler SHEETS em Config.gs');
const usadasSheets = new Set();
FICHEIROS.forEach(function(f) {
  let m; const re = /SHEETS\.([A-Z_]+)/g;
  while ((m = re.exec(src[f]))) usadasSheets.add(m[1]);
});
Array.from(usadasSheets).sort().forEach(function(k) {
  if (chavesSheets.indexOf(k) === -1) erro('SHEETS.' + k + ' nao existe em Config.gs');
});
if (blocoSheets) {
  blocoSheets[1].split('\n').forEach(function(l) {
    const m = l.match(/([A-Z_]+):\s*'([^']+)'/);
    if (m && m[1] !== m[2]) erro('SHEETS.' + m[1] + " = '" + m[2] + "' difere da chave (nome de folha inconsistente)");
  });
}
ok('SHEETS: ' + chavesSheets.length + ' chaves, ' + usadasSheets.size + ' usadas, todas validas');

/* ---------- PASSO 4: HEADERS ---------- */
passo(4, 'Referencias HEADERS.X e coerencia HEADERS <-> SHEETS');
const blocoHeaders = cfg.match(/const HEADERS = \{([\s\S]*?)\n\};/);
const chavesHeaders = blocoHeaders ? [...blocoHeaders[1].matchAll(/\n\s{2}([A-Z_]+):/g)].map(function(m) { return m[1]; }) : [];
if (!chavesHeaders.length) erro('nao foi possivel ler HEADERS em Config.gs');
FICHEIROS.forEach(function(f) {
  let m; const re = /HEADERS\.([A-Z_]+)/g;
  while ((m = re.exec(src[f]))) {
    if (chavesHeaders.indexOf(m[1]) === -1) erro('HEADERS.' + m[1] + ' nao existe (usado em ' + f + ')');
  }
});
chavesHeaders.forEach(function(k) {
  if (chavesSheets.indexOf(k) === -1) erro('HEADERS.' + k + ' sem SHEETS correspondente (a folha nao seria criada)');
});
ok('HEADERS: ' + chavesHeaders.length + ' folhas declaradas e coerentes');

/* ---------- PASSO 5: ENUMS ---------- */
passo(5, 'Referencias ENUMS.GRUPO.VALOR existem');
const blocoEnums = cfg.match(/const ENUMS = \{([\s\S]*?)\n\};/);
const enums = {};
if (blocoEnums) {
  let m; const reG = /([A-Z_]+):\s*\{([^}]*)\}/g;
  while ((m = reG.exec(blocoEnums[1]))) {
    enums[m[1]] = [...m[2].matchAll(/([A-Z_]+):/g)].map(function(x) { return x[1]; });
  }
}
FICHEIROS.forEach(function(f) {
  let m; const re = /ENUMS\.([A-Z_]+)\.([A-Z_]+)/g;
  while ((m = re.exec(src[f]))) {
    if (!enums[m[1]]) { erro('ENUMS.' + m[1] + ' nao existe (usado em ' + f + ')'); continue; }
    if (enums[m[1]].indexOf(m[2]) === -1) erro('ENUMS.' + m[1] + '.' + m[2] + ' nao existe (usado em ' + f + ')');
  }
});
ok('ENUMS: ' + Object.keys(enums).length + ' grupos verificados');

/* ---------- PASSO 6: funcoes internas chamadas mas nao declaradas ---------- */
passo(6, 'Funcoes internas (nome_) chamadas existem (evita ReferenceError)');
const declaradas = new Set(Object.keys(funcoes));
FICHEIROS.forEach(function(f) {
  const vistas = new Set();
  let m; const re = /\b([a-z][A-Za-z0-9_]*_)\s*\(/g;
  while ((m = re.exec(src[f]))) vistas.add(m[1]);
  Array.from(vistas).sort().forEach(function(n) {
    if (!declaradas.has(n)) erro(n + '() usado em ' + f + ' mas nao declarado');
  });
});
ok('chamadas internas verificadas (convencao com _ final)');

/* ---------- PASSO 7: colunas mapa.X ---------- */
passo(7, 'Colunas mapa.X existem em algum HEADERS');
const campos = {};
if (blocoHeaders) {
  let m; const re = /\[([^\]]*)\]/g;
  while ((m = re.exec(blocoHeaders[1]))) {
    m[1].split(',').forEach(function(c) {
      const v = c.replace(/['"\s]/g, '');
      if (v) campos[v] = true;
    });
  }
}
const usadosMapa = new Set();
FICHEIROS.forEach(function(f) {
  let m; const re = /mapa\.([A-Za-z_][A-Za-z0-9_]*)/g;
  while ((m = re.exec(src[f]))) usadosMapa.add(m[1]);
});
Array.from(usadosMapa).sort().forEach(function(c) {
  if (!campos[c]) erro('mapa.' + c + ' nao existe em nenhum cabecalho');
});
ok('colunas: ' + usadosMapa.size + ' usadas, ' + Object.keys(campos).length + ' declaradas');

/* ---------- PASSO 8: frontend <-> backend ---------- */
passo(8, 'Chamadas do frontend existem no backend');
const chamadas = new Set();
let m8; const re8 = /(?:api|backend)\s*\(\s*['"]([A-Za-z0-9_$]+)['"]/g;
while ((m8 = re8.exec(html))) chamadas.add(m8[1]);
Array.from(chamadas).sort().forEach(function(n) {
  if (!declaradas.has(n)) erro("index.html chama '" + n + "' que nao existe no backend");
});
ok(chamadas.size + ' chamadas do frontend verificadas');

/* ---------- PASSO 9: conjunto de ficheiros e manifesto ---------- */
passo(9, 'Conjunto de upload e manifesto');
if (fs.existsSync(path.join(dir, 'code.gs'))) erro('code.gs existe na pasta: risco de duplicar constantes');
else ok('code.gs ausente (sem risco de duplicacao)');
const js = JSON.parse(fs.readFileSync(path.join(dir, 'appsscript.json'), 'utf8'));
if (js.timeZone !== 'Europe/Lisbon') erro('timeZone inesperado: ' + js.timeZone);
if (js.runtimeVersion !== 'V8') erro('runtimeVersion inesperado: ' + js.runtimeVersion);
const scopes = js.oauthScopes || [];
if (scopes.indexOf('https://www.googleapis.com/auth/spreadsheets') === -1) erro('scope spreadsheets em falta');
if (scopes.indexOf('https://www.googleapis.com/auth/script.scriptapp') === -1) erro('scope script.scriptapp em falta (triggers)');
if (!FICHEIROS.some(function(f) { return /^function\s+doGet\s*\(/m.test(src[f]); })) erro('doGet nao encontrado');
if (!fs.existsSync(path.join(dir, 'index.html'))) erro('index.html em falta');
ok('manifesto valido, ' + FICHEIROS.length + ' ficheiros .gs, doGet e index.html presentes');

/* ---------- PASSO 10: residuos de complexidade de password ---------- */
passo(10, 'Sem residuos do sistema antigo de passwords');
const proibidos = /(PasswordHash|PasswordSalt|verificarPassword_|criarHashPassword_|gerarHashPassword_|gerarSalt_|criarCredencialPassword_|testeCriptografiaFase2|TokenHash)/;
FICHEIROS.concat(['index.html']).forEach(function(f) {
  const conteudo = f === 'index.html' ? html : src[f];
  conteudo.split('\n').forEach(function(l, i) {
    if (proibidos.test(l)) erro(f + ':' + (i + 1) + ' -> ' + l.trim().substring(0, 90));
  });
});
ok('nenhum resto de hash/salt/token-hash no codigo');

console.log('\n============================================');
console.log(falhas === 0 ? 'TODOS OS 10 PASSOS PASSARAM' : 'RESULTADO: ' + falhas + ' problema(s) encontrado(s)');
console.log('============================================');
process.exit(falhas === 0 ? 0 : 1);
