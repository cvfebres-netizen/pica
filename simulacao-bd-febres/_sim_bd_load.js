/* SIMULACAO BD vetmanag (parte 2/3): carrega o dump em memoria. */
const fs = require('fs');
const readline = require('readline');
const P = require('./_sim_bd_parse.js');
function parseColunas(ddl) {
  const cols = [];
  const corpo = ddl.slice(ddl.indexOf('(') + 1, ddl.lastIndexOf(')'));
  let nivel = 0, atual = '', emStr = false;
  for (let i = 0; i < corpo.length; i++) {
    const ch = corpo[i];
    if (ch === "'" && corpo[i - 1] !== '\\') emStr = !emStr;
    if (!emStr) {
      if (ch === '(') nivel++;
      if (ch === ')') nivel--;
      if (ch === ',' && nivel === 0) {
        const m = atual.trim().match(/^`([^`]+)`/);
        if (m) cols.push(m[1]);
        atual = '';
        continue;
      }
    }
    atual += ch;
  }
  const m = atual.trim().match(/^`([^`]+)`/);
  if (m) cols.push(m[1]);
  return cols;
}
async function carregar() {
  const tabelas = {};
  const ordem = [];
  function reg(n) {
    if (!tabelas[n]) { tabelas[n] = { colunas: [], linhas: [] }; ordem.push(n); }
    return tabelas[n];
  }
  const rl = readline.createInterface({ input: fs.createReadStream(P.SQL, { encoding: 'utf8' }), crlfDelay: Infinity });
  let tab = null, emDdl = false, bufDdl = '', emIns = false, bufIns = '';
  function flush() {
    if (!tab || !bufIns) { bufIns = ''; return; }
    const t = reg(tab);
    const idx = bufIns.replace(/;\s*$/, '').indexOf('VALUES');
    if (idx === -1) { bufIns = ''; return; }
    P.partirTuplos(bufIns.slice(idx + 6).trim()).forEach(function (tp) {
      try {
        const v = P.parseTuplo(tp);
        const o = {};
        v.forEach(function (x, i) { o[t.colunas[i] || ('c' + i)] = x; });
        t.linhas.push(o);
      } catch (e) { /* ignora tuplo mau */ }
    });
    bufIns = '';
  }
  for await (const linha of rl) {
    if (emDdl) {
      bufDdl += '\n' + linha;
      if (/\)\s*ENGINE=/.test(linha)) {
        emDdl = false;
        const m = bufDdl.match(/CREATE TABLE\s+`([^`]+)`/);
        if (m) reg(m[1]).colunas = parseColunas(bufDdl);
        bufDdl = '';
      }
      continue;
    }
    if (emIns) {
      bufIns += (bufIns ? '\n' : '') + linha;
      if (/;\s*$/.test(linha)) { flush(); emIns = false; tab = null; }
      continue;
    }
    let m = linha.match(/^CREATE TABLE\s+`([^`]+)`/);
    if (m) {
      const t = reg(m[1]);
      tab = m[1];
      if (/\)\s*ENGINE=/.test(linha)) t.colunas = parseColunas(linha);
      else { emDdl = true; bufDdl = linha; }
      continue;
    }
    m = linha.match(/^INSERT INTO\s+`([^`]+)`/);
    if (m) {
      tab = m[1];
      reg(tab);
      bufIns = linha;
      if (/;\s*$/.test(linha)) { flush(); tab = null; }
      else emIns = true;
    }
  }
  return { tabelas: tabelas, ordem: ordem };
}
module.exports = { carregar: carregar };
