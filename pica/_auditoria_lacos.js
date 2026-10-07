/* AUDITORIA DE LACOS E RECURSAO.
   A suite de hardening mede `iterarDias_` e conta os `while`. O que nao
   cobre: `for` sem tecto, `do...while`, e sobretudo a RECURSAO — uma funcao
   que chama a si propria nao tem laco nenhum e nao aparece em contagem
   nenhuma, mas rebenta a execucao. Imprime; nao falha por si. */
const fs = require('fs'), path = require('path');
const d = __dirname;
const gs = fs.readdirSync(d).filter(function (f) { return f.endsWith('.gs'); }).sort();
const fontes = {};
gs.forEach(function (f) { fontes[f] = fs.readFileSync(path.join(d, f), 'utf8'); });

/* Codigo vs texto. Sem isto um `{` numa string desalinha a contagem
   (foi o defeito que corrigimos na auditoria de interligacoes). */
function indiceReal(src) {
  const m = new Array(src.length).fill(true);
  let e = 'codigo';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (e === 'codigo') {
      if (c === '/' && src[i + 1] === '/') { e = 'linha'; m[i] = m[i + 1] = false; i++; }
      else if (c === '/' && src[i + 1] === '*') { e = 'bloco'; m[i] = m[i + 1] = false; i++; }
      else if (c === "'" || c === '"' || c === '`') { e = c; m[i] = false; }
      else if (c === '/') {
        let j = i - 1; while (j >= 0 && /\s/.test(src[j])) j--;
        const a = j < 0 ? '(' : src[j];
        if (j < 0 || '(,=:[!&|?{};+-*%~^<>'.indexOf(a) >= 0 ||
            /\b(return|typeof|case|in|of|new|delete|void|do|else|yield|await)\s*$/.test(src.slice(Math.max(0, j - 10), j + 1))) { e = 'regex'; m[i] = false; }
      }
    } else if (e === 'linha') { m[i] = false; if (c === '\n') e = 'codigo'; }
    else if (e === 'bloco') { if (c === '*' && src[i + 1] === '/') { m[i] = m[i + 1] = false; e = 'codigo'; i++; } else m[i] = false; }
    else if (e === 'regex') {
      if (c === '[') e = 'regexClasse';
      else if (c === '\\') { m[i] = false; if (i + 1 < src.length) { m[i + 1] = false; i++; } }
      else if (c === '/') { m[i] = false; e = 'codigo'; }
      else if (c === '\n') e = 'codigo';
      else m[i] = false;
    } else if (e === 'regexClasse') {
      if (c === ']') e = 'regex';
      else if (c === '\\') { m[i] = false; if (i + 1 < src.length) { m[i + 1] = false; i++; } }
      else m[i] = false;
    } else {
      if (c === '\\') { m[i] = false; if (i + 1 < src.length) { m[i + 1] = false; i++; } }
      else if (c === e) { m[i] = false; e = 'codigo'; }
      else m[i] = false;
    }
  }
  return m;
}

/* Funcoes de topo com o intervalo do corpo e a profundidade das chaves. */
function varrer(f) {
  const src = fontes[f], cod = indiceReal(src);
  const prof = new Array(src.length).fill(0);
  let p = 0;
  for (let i = 0; i < src.length; i++) { prof[i] = p; if (cod[i] && src[i] === '{') p++; else if (cod[i] && src[i] === '}') p--; }
  const ln = new Array(src.length).fill(1);
  for (let i = 0; i < src.length; i++) ln[i + 1] = ln[i] + (src[i] === '\n' ? 1 : 0);
  const out = [];
  const re = /(?:^|[\s;{}()=,])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    let abre = -1;
    for (let a = m.index + m[0].length - 1; a < src.length; a++) if (cod[a] && src[a] === '(') { abre = a; break; }
    if (abre < 0) continue;
    let nv = 0, k = abre;
    for (; k < src.length; k++) { if (!cod[k]) continue; if (src[k] === '(') nv++; else if (src[k] === ')') { nv--; if (!nv) break; } }
    let corpo = -1;
    for (k = k + 1; k < src.length; k++) if (cod[k] && src[k] === '{') { corpo = k; break; }
    if (corpo < 0) continue;
    let nv2 = 0, fim = src.length - 1;
    for (let i = corpo; i < src.length; i++) { if (!cod[i]) continue; if (src[i] === '{') nv2++; else if (src[i] === '}') { nv2--; if (!nv2) { fim = i; break; } } }
    out.push({ f: f, nome: m[1], ini: corpo, fim: fim, prof: prof[corpo], linha: ln[m.index] });
  }
  return out;
}

const todas = [];
gs.forEach(function (f) { varrer(f).forEach(function (x) { todas.push(x); }); });
const topo = todas.filter(function (x) { return x.prof === 0; });
const aninhadas = todas.filter(function (x) { return x.prof > 0; });
const porNome = {};
topo.forEach(function (x) { if (!porNome[x.nome]) porNome[x.nome] = x; });

function codigoDe(x) {
  const src = fontes[x.f], cod = indiceReal(src);
  let s = '';
  for (let i = x.ini; i <= x.fim; i++) s += cod[i] ? src[i] : ' ';
  return s;
}

/* --- 1. Lacos -------------------------------------------------------- */
const lacos = [];
topo.forEach(function (x) {
  const c = codigoDe(x);
  [[/\bwhile\s*\(/g, 'while'], [/\bdo\s*\{/g, 'do-while'],
   [/\bfor\s*\(/g, 'for'], [/\bfor\s*\(\s*(?:var|let|const)?\s*[A-Za-z_$][\w$]*\s+(?:of|in)\s/g, 'for-of/in']
  ].forEach(function (par) {
    const re = par[0]; let m;
    while ((m = re.exec(c))) {
      const ini = x.ini + m.index;
      const linha = (fontes[x.f].slice(0, ini).match(/\n/g) || []).length + 1;
      /* A condicao vai do primeiro `(` DEPOIS da palavra ate ao parente
         fechado, contando aninhamento. Comecar no inicio do casamento dava
         condicoes sem sentido (uma `while` reportava o `return` do fim da
         funcao) — e um relatorio errado e' pior do que nenhum. */
      let k = ini, pr = 0, cond = '', aberto = false;
      for (; k < c.length; k++) {
        const ch = c[k];
        if (ch === '(') { if (!aberto) { aberto = true; continue; } pr++; }
        else if (ch === ')') {
          if (!aberto) continue;
          if (!pr) break;
          pr--;
        }
        if (aberto) cond += ch;
      }
      lacos.push({ f: x.f, funcao: x.nome, tipo: par[1], linha: linha,
        cond: cond.replace(/\s+/g, ' ').trim().slice(0, 66) });
    }
  });
});

/* Um laco so termina se alguma coisa mudar no corpo: avanco ou saida. */
const AVANCO = /\+\+|--|\.push\(|\.pop\(|\.shift\(|\.splice\(|\breturn\b|\bbreak\b/;
const semAvanco = lacos.filter(function (l) {
  const c = codigoDe(porNome[l.funcao]);
  const i = c.search(new RegExp('\\b' + l.tipo.split(' ')[0]));
  return !AVANCO.test(i >= 0 ? c.slice(i) : c);
});

/* --- 2. Recursao ------------------------------------------------------ */
const grafo = {};
topo.forEach(function (x) {
  const s = new Set(), re = /\b([A-Za-z_$][\w$]*)\s*\(/g; let m;
  while ((m = re.exec(codigoDe(x)))) if (porNome[m[1]] && m[1] !== x.nome) s.add(m[1]);
  grafo[x.nome] = s;
});
const directa = topo.filter(function (x) {
  return new RegExp('\\b' + x.nome.replace(/\$/g, '\\$') + '\\s*\\(').test(codigoDe(x));
});

const ciclos = [], pilha = [], fechados = new Set();
function dfs(n) {
  if (pilha.indexOf(n) >= 0) {
    const i = pilha.indexOf(n), c = pilha.slice(i).concat([n]), k = c.slice().sort().join('>');
    if (!ciclos.some(function (z) { return z.k === k; })) ciclos.push({ k: k, c: c });
    return;
  }
  if (fechados.has(n)) return;
  pilha.push(n);
  (grafo[n] || []).forEach(dfs);
  pilha.pop();
  if (!pilha.length) fechados.add(n);
}
Object.keys(grafo).forEach(dfs);

/* --- Relatorio -------------------------------------------------------- */
const T = '  ';
console.log('AUDITORIA DE LACOS E RECURSAO');
console.log(T + 'ficheiros .gs: ' + gs.length + ' | funcoes de topo: ' + topo.length + ' | aninhadas: ' + aninhadas.length);

console.log('\n--- 1. LACOS ---');
const cont = {};
lacos.forEach(function (l) { cont[l.tipo] = (cont[l.tipo] || 0) + 1; });
Object.keys(cont).sort().forEach(function (k) { console.log(T + k + ': ' + cont[k]); });
console.log(T + 'total: ' + lacos.length);
lacos.forEach(function (l) {
  console.log(T + '  ' + l.tipo.padEnd(11) + l.funcao.padEnd(28) + 'L' + l.linha + '  cond: ' + l.cond);
});

console.log('\n--- 2. RECURSAO DIRECTA ---');
if (!directa.length) console.log(T + 'nenhuma');
directa.forEach(function (x) { console.log(T + '* ' + x.nome + '  (' + x.f + ':' + x.linha + ')'); });

console.log('\n--- 3. RECURSAO INDIRECTA (ciclos) ---');
if (!ciclos.length) console.log(T + 'nenhum');
ciclos.forEach(function (c) { console.log(T + '* ' + c.c.join(' -> ')); });

console.log('\n--- 4. LACOS SEM AVANCO VISIVEL NO CORPO ---');
console.log(T + '(heuristica: ++/--/push/pop/shift/splice/return/break)');
if (!semAvanco.length) console.log(T + 'nenhum');
semAvanco.forEach(function (l) { console.log(T + '* ' + l.tipo + ' em ' + l.funcao + ' (L' + l.linha + ')  cond: ' + l.cond); });

console.log('\nVEREDITO: ' + (directa.length || ciclos.length ? 'HA RECURSAO — ver acima' : 'nenhuma recursao directa nem indirecta'));
process.exitCode = 0;