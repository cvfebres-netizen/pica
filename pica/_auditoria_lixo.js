/* ==========================================================================
   INSPECCAO DE LIMPEZA: procura CODIGO MORTO e SOBRAS em todos os ficheiros.

   Nao e' uma suite de comportamento — e' uma busca por coisas que nao
   servem para nada: funcoes que ninguem chama, constantes por usar,
   marcadores de trabalho a meio, `console.log` esquecidos e blocos de
   codigo comentados.

   REGRA QUE TORNA ISTO HONESTO: "ninguem chama" tem de significar mesmo.
   Uma funcao pode ser chamada de fora sem aparecer como `nome(`:
     - pelo dispatcher do Apps Script, quando o frontend pede `api('nome')`;
     - pelo Google, quando e' o handler de um trigger (newTrigger('nome'));
     - por testes, que lhe chamam pelo nome.
   Por isso as tres portas sao contadas como chamadas legitimas, e o que
   sobra precisa de ser justificado a mao — nunca apagado em silencio.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const d = __dirname;

const PRODUCAO = fs.readdirSync(d).filter(function (f) {
  return f.endsWith('.gs') || f === 'index.html' || f === 'appsscript.json';
}).sort();
const TESTES = fs.readdirSync(d).filter(function (f) { return /^_.*\.js$/.test(f); }).sort();

const fontes = {};
PRODUCAO.concat(TESTES).forEach(function (f) { fontes[f] = fs.readFileSync(path.join(d, f), 'utf8'); });

const gs = PRODUCAO.filter(function (f) { return f.endsWith('.gs'); });
const todo = gs.concat(['index.html']).map(function (f) { return fontes[f]; }).join('\n');
const testes = TESTES.map(function (f) { return fontes[f]; }).join('\n');

/* --- 1. Funcoes declaradas e onde sao referenciadas ------------------- */
const declaradas = [];
gs.forEach(function (f) {
  const s = fontes[f];
  const re = /^[ \t]*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m;
  while ((m = re.exec(s))) {
    declaradas.push({ ficheiro: f, nome: m[1], linha: s.slice(0, m.index).split('\n').length,
      aninhada: /^[ \t]+/.test(m[0]) });
  }
});

/* Uma referencia conta como CHAMADA quando e' seguida de `(` — ou quando o
   nome aparece dentro de aspas. O segundo caso e' o que faltava antes: o
   frontend nao chama `api('registarPicagem', ...)` em codigo, passa o
   NOME como texto, e o dispatcher resolve. Sem contar as aspas, 45
   funcoes de producao apareciam como "que ninguem chama" — todas as que a
   interface usa. O mesmo vale para `newTrigger('manutencaoDiaria')`. */
function usos(nome) {
  const re = new RegExp('\\b' + nome.replace(/\$/g, '\\$') + '\\b', 'g');
  let total = 0, chamadas = 0;
  [todo, testes].forEach(function (corpo) {
    let m;
    while ((m = re.exec(corpo))) {
      total++;
      const depois = corpo.slice(m.index + nome.length, m.index + nome.length + 3);
      const antes = corpo.slice(Math.max(0, m.index - 2), m.index);
      const comoTexto = /^\s*\(/.test(depois) || /['"]$/.test(antes);
      if (comoTexto) chamadas++;
    }
  });
  return { total: total, chamadas: chamadas };
}

const semChamada = declaradas.filter(function (x) { return usos(x.nome).chamadas <= 1; });

/* --- 2. Variaveis de topo declaradas e nunca usadas ------------------ */
const semUso = [];
gs.forEach(function (f) {
  const s = fontes[f];
  const re = /^(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/gm;
  let m;
  while ((m = re.exec(s))) {
    if (usos(m[1]).total <= 1) {
      semUso.push({ ficheiro: f, nome: m[1], linha: s.slice(0, m.index).split('\n').length });
    }
  }
});
/* --- 3. Sobras de trabalho -------------------------------------------
   O marcador `TODO` SO conta quando e' marcador de trabalho, isto e'
   seguido de `:` ou no inicio de um comentario. Sem esse cuidado, a
   palavra portuguesa "TODO" (= tudo) denunciava o codigo inteiro:
   "TODO o custo", "TODO o site", "TESTES DE COBERTURA DO TODO". Um
   verificador que grita com a propria lingua deixa de ser lido — e
   foi assim que 6 achados falsos apareceram na primeira passagem. */
const MARCADORES = /\b(FIXME|XXX|HACK)\b|(?:^|[/*]\s)TODO[:(]|\bDEBUG\s*[:=]/g;
const sobra = [];
const consola = [];
Object.keys(fontes).forEach(function (f) {
  if (f === 'appsscript.json') return;
  if (f === path.basename(__filename)) return; /* o proprio verificador nao se denuncia a si */
  fontes[f].split('\n').forEach(function (ln, i) {
    const mm = ln.match(MARCADORES);
    if (mm) sobra.push({ ficheiro: f, linha: i + 1, tipo: mm[0].trim(), texto: ln.trim().slice(0, 78) });
    /* console.log dentro de um .gs ia parar ao editor do Apps Script: ruido. */
    if (/\bconsole\.(log|debug|dir|table)\s*\(/.test(ln) && f.endsWith('.gs')) {
      consola.push({ ficheiro: f, linha: i + 1, texto: ln.trim().slice(0, 78) });
    }
    if (/\bdebugger\s*;/.test(ln)) {
      sobra.push({ ficheiro: f, linha: i + 1, tipo: 'debugger', texto: ln.trim().slice(0, 78) });
    }
  });
});

/* --- 4. Blocos de codigo comentado ----------------------------------- */
const comentados = [];
gs.forEach(function (f) {
  const linhas = fontes[f].split('\n');
  let bloco = [], inicio = 0;
  linhas.forEach(function (ln, i) {
    const t = ln.trim();
    const eCodigo = /^\/\*+\s*(const|let|var|function|if|for|while|return|try|catch|switch)\b/.test(t) ||
      /^\/\*+\s*\};?\s*$/.test(t);
    if (eCodigo) {
      if (!bloco.length) inicio = i + 1;
      bloco.push(t);
    } else if (bloco.length) {
      if (bloco.length >= 3) comentados.push({ ficheiro: f, linha: inicio, n: bloco.length, amostra: bloco[0].slice(0, 58) });
      bloco = [];
    }
  });
});

/* --- Relatorio -------------------------------------------------------- */
const T = '  ';
const secao = function (titulo, itens, formato) {
  console.log('\n--- ' + titulo + ' ---');
  if (!itens.length) { console.log(T + 'nenhum'); return; }
  itens.forEach(formato);
};

console.log('INSPECCAO DE LIMPEZA');
console.log(T + 'ficheiros de producao: ' + PRODUCAO.length + ' | de teste: ' + TESTES.length +
  ' | funcoes declaradas: ' + declaradas.length);

secao('1. FUNCOES QUE NINGUEM CHAMA', semChamada, function (x) {
  console.log(T + '* ' + x.nome + '  (' + x.ficheiro + ':' + x.linha + ')' + (x.aninhada ? '  [aninhada]' : ''));
});
secao('2. VARIAVEIS DE TOPO DECLARADAS E NUNCA USADAS', semUso, function (x) {
  console.log(T + '* ' + x.nome + '  (' + x.ficheiro + ':' + x.linha + ')');
});
secao('3. MARCADORES DE TRABALHO EM ABERTO', sobra, function (x) {
  console.log(T + '[' + x.tipo + '] ' + x.ficheiro + ':' + x.linha + '  ' + x.texto);
});
secao('4. console.log DENTRO DE CODIGO DE PRODUCAO', consola, function (x) {
  console.log(T + x.ficheiro + ':' + x.linha + '  ' + x.texto);
});
secao('5. BLOCOS DE CODIGO COMENTADOS (3+ linhas)', comentados, function (x) {
  console.log(T + x.ficheiro + ':' + x.linha + '  (' + x.n + ' linhas)  ' + x.amostra);
});

console.log('\nTOTAL DE ACHADOS: ' +
  (semChamada.length + semUso.length + sobra.length + consola.length + comentados.length));

/* Sai sempre com 0: isto e' INSPECCAO, nao um gate. Apagar codigo por causa
   de um relatorio automatico seria o oposto do que se quer — cada achado
   tem de ser julgado antes de mexer. */
process.exitCode = 0;