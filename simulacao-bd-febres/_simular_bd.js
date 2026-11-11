/* SIMULACAO BD vetmanag (parte 3/3): cenarios sobre o dump real.
   Uso: node _simular_bd.js (nao precisa MySQL nem internet). */
const LOAD = require('./_sim_bd_load.js');
let falhas = 0;
const registo = [];
function titulo(t) { registo.push('\n--- ' + t + ' ---'); }
function ok(cond, msg) {
  if (cond) registo.push('  OK   ' + msg);
  else { falhas++; registo.push('  ERRO ' + msg); }
}
function nota(m) { registo.push('  ....  ' + m); }
function col(t, cands) {
  for (let i = 0; i < cands.length; i++) if (t.colunas.indexOf(cands[i]) !== -1) return cands[i];
  return null;
}
function ex(t, c, n) {
  const s = {};
  t.linhas.forEach(function (l) { const v = l[c]; if (v !== null && v !== undefined && v !== '') s[v] = 1; });
  return Object.keys(s).slice(0, n || 5);
}
LOAD.carregar().then(function (bd) {
  const T = bd.tabelas, nomes = bd.ordem;
  let total = 0;
  nomes.forEach(function (n) { total += T[n].linhas.length; });
  titulo('CENARIO 1 — inventario');
  ok(nomes.length > 0, 'tabelas: ' + nomes.length);
  ok(total > 0, 'linhas totais: ' + total);
  const vazias = nomes.filter(function (n) { return T[n].linhas.length === 0; });
  nota('vazias (' + vazias.length + '): ' + vazias.slice(0, 20).join(', '));
  titulo('CENARIO 2 — clinicas');
  ['subclinics', 'clinics'].forEach(function (n) {
    if (T[n]) {
      const cn = col(T[n], ['subclinic_name', 'name', 'clinic_name']);
      nota(n + ': ' + T[n].linhas.length + (cn ? ' ex: ' + ex(T[n], cn).join(' | ') : ''));
    }
  });
  ok(!!(T.subclinics || T.clinics), 'tabela de clinicas presente');
  titulo('CENARIO 3 — tutores');
  const tCli = T.clients || T.clientes || T.tutores;
  if (tCli) {
    const cn = col(tCli, ['client_name', 'name', 'nome']);
    nota('linhas: ' + tCli.linhas.length + (cn ? ' ex: ' + ex(tCli, cn).join(' | ') : ''));
    ok(tCli.linhas.length > 0, 'tutores carregados');
  } else ok(false, 'sem tabela clients/clientes/tutores');
  titulo('CENARIO 4 — animais');
  const tAni = T.animals || T.animais || T.pets;
  if (tAni) {
    const cn = col(tAni, ['animal_name', 'name', 'nome']);
    nota('linhas: ' + tAni.linhas.length + (cn ? ' ex: ' + ex(tAni, cn).join(' | ') : ''));
    ok(tAni.linhas.length > 0, 'animais carregados');
  } else ok(false, 'sem tabela animals/animais/pets');
  titulo('CENARIO 5 — consultas');
  ['visits', 'appointments', 'consultas'].forEach(function (n) {
    if (T[n]) nota(n + ': ' + T[n].linhas.length);
  });
  ok(!!(T.visits || T.appointments || T.consultas), 'consultas presentes');
  titulo('CENARIO 6 — equipa');
  const tU = T.users || T.utilizadores;
  if (tU) {
    const cn = col(tU, ['name', 'username', 'email', 'nome']);
    nota('linhas: ' + tU.linhas.length + (cn ? ' ex: ' + ex(tU, cn).join(' | ') : ''));
    ok(tU.linhas.length > 0, 'equipa carregada');
  } else ok(false, 'sem tabela users');
  titulo('CENARIO 7 — cadeia tutor->animal->visita');
  const tVis = T.visits || T.appointments;
  if (tCli && tAni && tVis) {
    const cA = col(tAni, ['animal_client_id', 'client_id', 'tutor_id', 'owner_id']);
    const cV = col(tVis, ['visit_animal_id', 'animal_id', 'appointment_animal_id']);
    const iC = col(tCli, ['client_id', 'id']);
    const iA = col(tAni, ['animal_id', 'id']);
    if (cA && cV && iC && iA) {
      const sC = {}, sA = {};
      tCli.linhas.forEach(function (l) { sC[l[iC]] = 1; });
      tAni.linhas.forEach(function (l) { sA[l[iA]] = 1; });
      const aOk = tAni.linhas.filter(function (l) { return sC[l[cA]] !== undefined; }).length;
      const vOk = tVis.linhas.filter(function (l) { return sA[l[cV]] !== undefined; }).length;
      ok(aOk > 0, 'animais com tutor: ' + aOk + '/' + tAni.linhas.length);
      ok(vOk > 0, 'visitas com animal: ' + vOk + '/' + tVis.linhas.length);
    } else nota('chaves fora do esperado; ver esquema');
  } else nota('faltam tabelas para a cadeia');
  titulo('CENARIO 8 — top tabelas');
  nomes.map(function (n) { return { n: n, l: T[n].linhas.length }; })
    .sort(function (a, b) { return b.l - a.l; }).slice(0, 15)
    .forEach(function (t) { nota(t.n + ': ' + t.l); });
  console.log(registo.join('\n'));
  console.log('\nFALHAS:' + falhas);
  console.log(falhas === 0 ? 'TODOS OS CENARIOS PASSARAM' : 'SIMULACAO COM FALHAS');
  process.exitCode = falhas ? 1 : 0;
}).catch(function (e) {
  console.error('FALHA: ' + (e && e.stack || e));
  process.exit(1);
});
