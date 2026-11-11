/* Servidor BD vetmanag — camada de dados (1/2).
   Garante o .sql (descomprime do .zst se preciso), carrega em memoria
   e expoe resumo / linhas / ficha de animal. Sem MySQL, sem npm. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const LOAD = require('./_sim_bd_load.js');
const P = require('./_sim_bd_parse.js');

let BD = null, PRONTO = false, ERRO = null;
const T0 = Date.now();
let IDX = { cliPorId: {}, aniPorId: {}, visPorAnimal: [], visPorId: {}, aniPorCliente: {}, colVisAni: null, colVisId: null };

function garantirSQL() {
  if (fs.existsSync(P.SQL)) return 'sql-ok';
  const zst = P.SQL + '.zst';
  if (!fs.existsSync(zst)) throw new Error('falta o dump: ' + zst);
  fs.writeFileSync(P.SQL, zlib.zstdDecompressSync(fs.readFileSync(zst)));
  return 'descomprimido-do-zst';
}
function primeira(t, cands) {
  for (let i = 0; i < cands.length; i++) if (t.colunas.indexOf(cands[i]) !== -1) return cands[i];
  return null;
}
async function iniciar() {
  try {
    const como = garantirSQL();
    console.log('BD: ' + como + ' — a carregar...');
    BD = await LOAD.carregar();
    const T = BD.tabelas;
    const tCli = T.clients, tAni = T.animals, tVis = T.visits;
    if (tCli) {
      const id = primeira(tCli, ['client_id', 'id']);
      tCli.linhas.forEach(function (l) { IDX.cliPorId[l[id]] = l; });
    }
    if (tAni) {
      const id = primeira(tAni, ['animal_id', 'id']);
      const cCli = primeira(tAni, ['animal_client_id', 'client_id']);
      tAni.linhas.forEach(function (l) { IDX.aniPorId[l[id]] = l; });
      IDX.colCliAni = cCli; IDX.idCli = tCli ? primeira(tCli, ['client_id', 'id']) : null;
    }
    if (tVis && tAni) {
      const cV = primeira(tVis, ['visit_animal_id', 'animal_id', 'appointment_animal_id']);
      IDX.colVisAni = cV;
      IDX.colVisId = primeira(tVis, ['visit_id', 'id']);
      if (cV) tVis.linhas.forEach(function (l) {
        const k = l[cV];
        (IDX.visPorAnimal[k] = IDX.visPorAnimal[k] || []).push(l);
        if (IDX.colVisId) IDX.visPorId[l[IDX.colVisId]] = l;
      });
    }
    if (tAni) {
      const cCli = primeira(tAni, ['animal_client_id', 'client_id']);
      IDX.aniPorCliente = {};
      if (cCli) tAni.linhas.forEach(function (l) {
        const k = l[cCli];
        (IDX.aniPorCliente[k] = IDX.aniPorCliente[k] || []).push(l);
      });
    }
    // FKs reais do DDL + PKs (para /api/registo navegar sem adivinhar).
    try {
      const mapa = JSON.parse(fs.readFileSync(path.join(__dirname, 'mapa.json'), 'utf8'));
      IDX.fksPorTab = {};
      IDX.pkPorTab = {};
      mapa.forEach(function (t) {
        const pk = t.cols.filter(function (c) { return /_id$|^id$/.test(c); })[0];
        if (pk) IDX.pkPorTab[t.tab] = pk;
        (t.fks || []).forEach(function (f) {
          const p = f.split('->');
          const dst = p[1].split('.');
          (IDX.fksPorTab[t.tab] = IDX.fksPorTab[t.tab] || {})[p[0]] = { tab: dst[0], col: dst[1] };
        });
      });
    } catch (e) { IDX.fksPorTab = {}; IDX.pkPorTab = {}; }
    PRONTO = true;
    console.log('BD pronta em ' + Math.round((Date.now() - T0) / 1000) + 's');
  } catch (e) { ERRO = String((e && e.stack) || e); console.error('BD FALHA: ' + ERRO); }
}
function estado() {
  if (ERRO) return { pronta: false, erro: ERRO };
  if (!PRONTO) return { pronta: false, espera_s: Math.round((Date.now() - T0) / 1000) };
  let total = 0;
  BD.ordem.forEach(function (n) { total += BD.tabelas[n].linhas.length; });
  return { pronta: true, tabelas: BD.ordem.length, linhas: total,
    tutores: (BD.tabelas.clients || { linhas: [] }).linhas.length,
    animais: (BD.tabelas.animals || { linhas: [] }).linhas.length,
    visitas: (BD.tabelas.visits || { linhas: [] }).linhas.length,
    consultas: (BD.tabelas.appointments || { linhas: [] }).linhas.length };
}
module.exports = { iniciar: iniciar, estado: estado, IDX: IDX,
  bd: function () { return BD; } };
