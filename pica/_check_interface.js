/* Coerencia entre o HTML estatico e o JS do index.html.
   1) acoes data-action <-> ACTIONS
   2) separadores TAB_ORDER <-> TABS (e loaders declarados)
   3) ids usados pelo JS <-> ids presentes no HTML
   4) funcoes/constantes duplicadas no JS inline
   5) sintaxe do bloco <script> (compilado, nao executado)
   6) balanco das tags principais do HTML                              */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let erros = 0;
let avisos = 0;
const erro = function (msg) { erros++; console.log('  ERRO  ' + msg); };
const aviso = function (msg) { avisos++; console.log('  AVISO ' + msg); };
const ok = function (msg) { console.log('  OK    ' + msg); };

/* ---------- 0. bloco <script> ---------- */
const mScript = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!mScript) { erro('bloco <script> nao encontrado'); process.exit(1); }
const js = mScript[1];

/* ---------- 1. acoes ---------- */
const acoesUsadas = new Set();
let m;

let re = /data-action="([^"'<>]+)"/g;
while ((m = re.exec(html))) acoesUsadas.add(m[1]);

/* acoes definidas em listas de botoes: { a: 'x.y', l: 'Texto' } */
re = /\ba:\s*'([^']+)',\s*l:\s*'/g;
while ((m = re.exec(js))) acoesUsadas.add(m[1]);

/* acoes de linhas de tabela: { label: ..., action: 'x.y', ... } */
re = /action:\s*'([^']+)'/g;
while ((m = re.exec(js))) acoesUsadas.add(m[1]);

const blocoActions = /const ACTIONS = \{([\s\S]*?)\n\};/.exec(js);
const acoesDeclaradas = new Set();
if (blocoActions) {
  re = /^\s*'([^']+)':\s*function/gm;
  while ((m = re.exec(blocoActions[1]))) acoesDeclaradas.add(m[1]);
}

const acoesSemHandler = [...acoesUsadas].filter(function (a) { return !acoesDeclaradas.has(a); });
const acoesSemUso = [...acoesDeclaradas].filter(function (a) { return !acoesUsadas.has(a); });
if (acoesSemHandler.length) erro('acoes usadas sem handler em ACTIONS: ' + acoesSemHandler.join(', '));
else ok('todas as ' + acoesUsadas.size + ' acoes tem handler em ACTIONS');
if (acoesSemUso.length) aviso('handlers nunca usados (codigo morto?): ' + acoesSemUso.join(', '));
else ok('sem handlers mortos (' + acoesDeclaradas.size + ' declarados)');

/* ---------- 2. separadores ---------- */
const idsOrdem = [...js.matchAll(/\{ id: '([a-zA-Z]+)', label: '/g)].map(function (x) { return x[1]; });
const blocoTabs = /const TABS = \{([\s\S]*?)\n\};/.exec(js);
const entradasTabs = blocoTabs
  ? [...blocoTabs[1].matchAll(/^\s{2}([a-zA-Z]+):\s*(loadTab\w+),?\s*$/gm)]
  : [];
const idsTabs = entradasTabs.map(function (x) { return x[1]; });
const funcoesLoaders = entradasTabs.map(function (x) { return x[2]; });

const semTab = idsOrdem.filter(function (t) { return idsTabs.indexOf(t) === -1; });
const semOrdem = idsTabs.filter(function (t) { return idsOrdem.indexOf(t) === -1; });
if (semTab.length) erro('separadores em TAB_ORDER sem loader em TABS: ' + semTab.join(', '));
else ok('os ' + idsOrdem.length + ' separadores de TAB_ORDER tem loader');
if (semOrdem.length) erro('loaders em TABS fora de TAB_ORDER: ' + semOrdem.join(', '));
else ok('sem loaders fora da ordem');

const semDeclaracao = funcoesLoaders.filter(function (f) {
  return !new RegExp('^function ' + f + '\\b', 'm').test(js);
});
if (semDeclaracao.length) erro('loaders referidos mas nao declarados: ' + semDeclaracao.join(', '));
else ok('todos os loaders estao declarados');

/* ---------- 3. ids ---------- */
const idsDom = new Set([...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(function (x) { return x[1]; }));
const idsJs = new Set();

re = /\$\(['"]([A-Za-z0-9_-]+)['"]\)/g;
while ((m = re.exec(js))) idsJs.add(m[1]);

re = /(?:show|hide)\(['"]([A-Za-z0-9_-]+)['"]\)/g;
while ((m = re.exec(js))) idsJs.add(m[1]);

re = /\$\$\(['"]#([A-Za-z0-9_-]+)/g;
while ((m = re.exec(js))) idsJs.add(m[1]);

const idsSemDom = [...idsJs].filter(function (i) { return !idsDom.has(i); });
if (idsSemDom.length) erro('ids usados pelo JS e ausentes no HTML: ' + idsSemDom.join(', '));
else ok('os ' + idsJs.size + ' ids usados pelo JS existem no HTML');

/* ---------- 4. duplicados no JS ---------- */
const funs = {};
const consts = {};
re = /^function\s+([A-Za-z0-9_$]+)/gm;
while ((m = re.exec(js))) (funs[m[1]] = funs[m[1]] || []).push(1);
re = /^(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=/gm;
while ((m = re.exec(js))) (consts[m[1]] = consts[m[1]] || []).push(1);

const dupFun = Object.keys(funs).filter(function (n) { return funs[n].length > 1; });
const dupConst = Object.keys(consts).filter(function (n) { return consts[n].length > 1; });
if (dupFun.length) erro('funcoes duplicadas no JS: ' + dupFun.join(', '));
else ok(Object.keys(funs).length + ' funcoes no JS, sem nomes repetidos');
if (dupConst.length) erro('constantes duplicadas no JS: ' + dupConst.join(', '));
else ok(Object.keys(consts).length + ' constantes no JS, sem nomes repetidos');

/* ---------- 5. sintaxe do JS ---------- */
try {
  new vm.Script(js, { filename: 'index.html:<script>' });
  ok('bloco <script> compila sem erro de sintaxe');
} catch (e) {
  erro('erro de sintaxe no JS: ' + e.message);
}

/* ---------- 6. balanco de tags ---------- */
['div', 'section', 'table', 'form', 'main', 'nav', 'tbody', 'thead'].forEach(function (tag) {
  const abre = (html.match(new RegExp('<' + tag + '[\\s>]', 'g')) || []).length;
  const fecha = (html.match(new RegExp('</' + tag + '>', 'g')) || []).length;
  if (abre !== fecha) erro('tags <' + tag + '>: ' + abre + ' abertas / ' + fecha + ' fechadas');
});

console.log('----');
console.log(erros === 0 ? 'RESULTADO: interface coerente' : 'RESULTADO: ' + erros + ' problema(s)');
if (avisos) console.log('(avisos: ' + avisos + ')');
process.exit(erros === 0 ? 0 : 1);
