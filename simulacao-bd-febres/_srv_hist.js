/* Historico geral: linha do tempo unificada + resumo mensal por grupo.
   Usa created_at (ou a data da visita) para ordenar o que entrou na BD. */
const GRUPOS = [
  { tab: 'clients', grupo: 'tutores', datas: ['created_at'], ids: ['client_id', 'id'], rots: ['client_name', 'name'] },
  { tab: 'animals', grupo: 'animais', datas: ['created_at'], ids: ['animal_id', 'id'], rots: ['animal_name', 'name'] },
  { tab: 'visits', grupo: 'visitas', datas: ['visit_scheduled_date', 'created_at'], ids: ['visit_id', 'id'], rots: ['visit_scheduled_date'] },
  { tab: 'appointments', grupo: 'consultas', datas: ['created_at'], ids: ['appointment_id', 'id'], rots: ['appointment_treatment'] },
  { tab: 'animal_exams', grupo: 'exames', datas: ['animal_exam_data', 'created_at'], ids: ['animal_exam_id', 'id'], rots: ['animal_exam_obs', 'animal_exam_data'] },
  { tab: 'appointment_complementar_exams', grupo: 'exames', datas: ['appointment_complementar_exam_date', 'created_at'], ids: ['appointment_complementar_exam_id', 'id'], rots: ['appointment_complementar_exam_obs'] },
  { tab: 'appointment_physical_exams', grupo: 'exames', datas: ['created_at'], ids: ['appointment_physical_exam_id', 'id'], rots: ['created_at'] },
  { tab: 'crm_clients', grupo: 'contactos', datas: ['crm_data_hora', 'created_at'], ids: ['id_crm', 'id'], rots: ['crm_contacto_motivo'] },
  { tab: 'invoices', grupo: 'faturas', datas: ['created_at', 'invoice_date'], ids: ['invoice_id', 'id'], rots: ['created_at'] },
  { tab: 'sales', grupo: 'vendas', datas: ['created_at', 'sale_date'], ids: ['sale_id', 'id'], rots: ['created_at'] }
];
function ms(v) {
  if (v == null || v === '' || v === '0000-00-00' || v === '0000-00-00 00:00:00') return 0;
  const t = Date.parse(String(v).replace(' ', 'T'));
  return isNaN(t) ? 0 : t;
}
function isoLocal(m) {
  const x = new Date(m);
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate()) + ' ' + p(x.getHours()) + ':' + p(x.getMinutes());
}
let CACHE = null;
function dados(BD) {
  if (CACHE && CACHE.n === BD.ordem.length) return CACHE.d;
  const T = BD.tabelas, ev = [];
  GRUPOS.forEach(function (g) {
    const t = T[g.tab];
    if (!t || !t.linhas.length) return;
    function ex(l) {
      for (let i = 0; i < l.length; i++) if (t.colunas.indexOf(l[i]) !== -1) return l[i];
      return null;
    }
    const dC = ex(g.datas), idC = ex(g.ids), rC = ex(g.rots);
    if (!dC || !idC) return;
    t.linhas.forEach(function (r) {
      const m = ms(r[dC]);
      if (!m) return;
      ev.push({ d: m, grupo: g.grupo, id: r[idC], rot: String(rC && r[rC] != null ? r[rC] : '').slice(0, 80) });
    });
  });
  ev.sort(function (a, b) { return b.d - a.d; });
  const d = { ev: ev };
  CACHE = { n: BD.ordem.length, d: d };
  return d;
}
function lista(BD, grupo, antes, limite) {
  if (!BD) return { ok: false, erro: 'BD ainda a carregar; recarrega.' };
  const ev = dados(BD).ev;
  const am = antes ? ms(antes) : Infinity;
  const lim = Math.min(200, Math.max(1, Number(limite) || 50));
  let k = 0;
  if (am !== Infinity) { while (k < ev.length && ev[k].d >= am) k++; }
  const out = [];
  for (; k < ev.length && out.length < lim; k++) {
    const e = ev[k];
    if (grupo && grupo !== 'todos' && e.grupo !== grupo) continue;
    out.push({ data: isoLocal(e.d), grupo: e.grupo, id: e.id, rotulo: e.rot });
  }
  return { ok: true, total: ev.length, devolvidos: out.length,
    proximo_antes: out.length ? out[out.length - 1].data : null, linhas: out };
}
function resumo(BD, meses) {
  if (!BD) return { ok: false, erro: 'BD ainda a carregar; recarrega.' };
  const ev = dados(BD).ev;
  const n = Math.min(36, Math.max(1, Number(meses) || 12));
  const chaves = [];
  const agora = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    chaves.push(x.getFullYear() + '-' + (x.getMonth() < 9 ? '0' : '') + (x.getMonth() + 1));
  }
  const grupos = {};
  GRUPOS.forEach(function (g) {
    grupos[g.grupo] = {};
    chaves.forEach(function (c) { grupos[g.grupo][c] = 0; });
  });
  ev.forEach(function (e) {
    const x = new Date(e.d);
    const c = x.getFullYear() + '-' + (x.getMonth() < 9 ? '0' : '') + (x.getMonth() + 1);
    if (grupos[e.grupo] && grupos[e.grupo][c] !== undefined) grupos[e.grupo][c]++;
  });
  return { ok: true, meses: chaves, grupos: grupos };
}
module.exports = { lista: lista, resumo: resumo };
