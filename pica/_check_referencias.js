/* Deteta identificadores USADOS mas nunca DECLARADOS.
 *
 * Porquê isto existe: um erro de escrita numa variável (`acaoFiltro` em vez
 * de `accaoFiltro`) é um ReferenceError em tempo de execução. O verificador
 * de sintaxe passa — o ficheiro é sintaticamente válido — e o código só
 * falha quando alguém chega lá e abre o ecrã.
 *
 * Estratégia: recolhe todos os nomes declarados (funções, const/let/var,
 * parâmetros, catch) em todos os .gs e conta quantas vezes cada
 * identificador aparece no código já sem comentários nem strings. Um nome
 * que aparece UMA única vez e nunca é declarado é, com alta probabilidade,
 * uma referência órfã.
 */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const ficheiros = fs.readdirSync(dir).filter(function(f) { return f.endsWith('.gs'); });

/* Palavras reservadas e globais do runtime que não vamos declarar. */
const RESERVADAS = new Set(('break case catch class const continue debugger default delete do else export extends ' +
  'finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield ' +
  'async await of static get set null true false undefined NaN Infinity arguments eval').split(' '));

const GLOBEIS = new Set(['SpreadsheetApp', 'Logger', 'Utilities', 'Session', 'Lock', 'PropertiesService',
  'CacheService', 'HtmlService', 'UrlFetchApp', 'DriveApp', 'GmailApp', 'MailApp', 'ScriptApp', 'TimeZone',
  'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Error', 'Promise', 'Map', 'Set',
  'console', 'module', 'require', 'process', 'isNaN', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'toISOString', 'toLocaleDateString', 'toLocaleString', 'toFixed']);

/* Remove comentários, strings e regex literais.
 *
 * Isto tem de ser UMA PASSAGEM. A versão anterior stripava comentários
 * primeiro: um `//` dentro de uma string (uma URL, por exemplo) era comido
 * como comentário, deixava a aspa pendurada e o strip de strings engolia
 * linhas inteiras — incluindo declarações de funções, que passavam a
 * parecer órfãs. Scanner carácter a carácter resolve isso.
 */
function limpar(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let anterior = '';           // último carácter de código significativo
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    /* Comentário de bloco */
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    /* Comentário de linha */
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
      out += ' ';
      continue;
    }
    /* String (aspas simples, duplas ou template) */
    if (c === "'" || c === '"' || c === '`') {
      const delim = c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === delim) { i++; break; }
        if (src[i] === '\n' && delim !== '`') break;   // string mal fechada
        i++;
      }
      out += ' ';
      continue;
    }
    /* Regex literal: só onde faz sentido (após =, ( , return, etc.). */
    if (c === '/' && anterior && /[=(,:[!&|?{};+\-*%~^]/.test(anterior)) {
      let j = i + 1;
      let dentro = false;
      let classes = false;
      while (j < n) {
        const r = src[j];
        if (r === '\\') { j += 2; continue; }
        if (r === '\n') break;
        if (r === '[') classes = true;
        else if (r === ']') classes = false;
        else if (r === '/' && !classes) { dentro = true; j++; break; }
        j++;
      }
      if (dentro) {
        while (j < n && /[gimsuy]/.test(src[j])) j++;
        out += ' ';
        i = j;
        continue;
      }
    }
    out += c;
    if (!/\s/.test(c)) anterior = c;
    i++;
  }
  return out;
}

const fontes = {};
ficheiros.forEach(function(f) { fontes[f] = limpar(fs.readFileSync(path.join(dir, f), 'utf8')); });

/* 1. Todos os nomes declarados em qualquer ficheiro. */
const declarados = new Set();
Object.keys(fontes).forEach(function(f) {
  const s = fontes[f];
  let m;
  const padroes = [
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,                       // function foo
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,              // const foo
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g                      // catch (e)
  ];
  padroes.forEach(function(re) { while ((m = re.exec(s))) declarados.add(m[1]); });

  /* Parâmetros: tudo o que está dentro dos parênteses da assinatura. */
  function marcarParametros(texto) {
    texto.split(',').forEach(function(p) {
      const nome = p.trim().split(/[\s=:]/)[0];
      if (nome && /^[A-Za-z_$][\w$]*$/.test(nome)) declarados.add(nome);
    });
  }
  const reAssin = /function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g;
  while ((m = reAssin.exec(s))) marcarParametros(m[1]);

  /* Arrow functions: (a, b) => */
  const reArrowPar = /\(([^()]*)\)\s*=>/g;
  while ((m = reArrowPar.exec(s))) marcarParametros(m[1]);

  /* Arrow functions: a => */
  const reArrowUm = /(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = reArrowUm.exec(s))) declarados.add(m[2]);
});

/* 2. Contar ocorrências de cada identificador minúsculo, em código real.
      Ignoramos o que vem depois de um ponto (propriedades). */
const contagem = {};
Object.keys(fontes).forEach(function(f) {
  const s = fontes[f];
  const re = /(^|[^.\w$'"`])([a-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(s))) {
    const nome = m[2];
    if (RESERVADAS.has(nome)) continue;
    if (declarados.has(nome)) continue;
    if (GLOBEIS.has(nome)) continue;

    /* Chave de objeto ({ profissional: 1 }) nao e referencia: o `:` seguinte
       seguido de `{` ou `,` antes distingue-o de um ternario. */
    const depois = s.slice(re.lastIndex).match(/^\s*:/);
    const antes = s.slice(0, m.index + m[1].length).replace(/\s+$/, '').slice(-1);
    if (depois && (antes === '{' || antes === ',')) continue;

    (contagem[nome] = contagem[nome] || { n: 0, ficheiros: {} });
    contagem[nome].n++;
    contagem[nome].ficheiros[f] = (contagem[nome].ficheiros[f] || 0) + 1;
  }
});

const orfas = Object.keys(contagem).filter(function(n) { return contagem[n].n === 1; });

orfas.forEach(function(n) {
  const onde = contagem[n].ficheiros;
  const lista = Object.keys(onde).map(function(f) { return f + ' (' + onde[f] + ')'; }).join(', ');
  console.log('REFERENCIA ORFA: "' + n + '" usada 1x sem declaracao -> ' + lista);
});

console.log('Ficheiros verificados: ' + ficheiros.length);
console.log('Nomes declarados: ' + declarados.size);
console.log('Identificadores orfaos: ' + orfas.length);
console.log(orfas.length === 0
  ? 'RESULTADO: nenhuma referencia orfa'
  : 'RESULTADO: ' + orfas.length + ' referencia(s) orfa(s)');
process.exitCode = orfas.length === 0 ? 0 : 1;