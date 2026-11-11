/* Fichas visita / consulta / exame (2a metade de _srv_fichas.js). */
const BASE = require('./_srv_fichas.js');
function fichaVisita(BD, IDX, id) {
  const T = BD.tabelas;
  const t = T.visits;
  if (!t) return { ok: false, erro: 'sem tabela visits' };
  const idC = BASE.ex(t, ['visit_id', 'id']);
  const v = t.linhas.filter(function (r) { return String(r[idC]) === String(id); })[0];
  if (!v) return { ok: false, erro: 'visita ' + id + ' nao existe' };
  const blocos = [];
  const aid = IDX.colVisAni ? v[IDX.colVisAni] : null;
  const resumo = { data: v.visit_scheduled_date || '', entrada: v.visit_entrance_time || '', fim: v.visit_end_time || '',
    animal: aid != null ? BASE.nomeAni(IDX, aid) : '?' };
  if (aid != null) {
    blocos.push({ titulo: 'Animal', linhas: [BASE.lig('animal', 'animals', aid, BASE.nomeAni(IDX, aid))] });
    const a = IDX.aniPorId[aid];
    if (a && IDX.colCliAni && a[IDX.colCliAni] != null)
      blocos.push({ titulo: 'Tutor', linhas: [BASE.lig('tutor', 'clients', a[IDX.colCliAni], BASE.nomeCli(IDX, a[IDX.colCliAni]))] });
  }
  if (T.appointments) {
    const ta = T.appointments, vc = BASE.ex(ta, ['appointment_visit_id', 'visit_id']);
    const cons = vc ? ta.linhas.filter(function (r) { return String(r[vc]) === String(id); }) : [];
    if (cons.length) {
      const ic = BASE.ex(ta, ['appointment_id', 'id']);
      blocos.push({ titulo: 'Consultas (' + cons.length + ')',
        linhas: cons.map(function (r) { return BASE.lig('consulta', 'appointments', r[ic], String(r.appointment_treatment || r.created_at || '')); }) });
    }
  }
  return { ok: true, tipo: 'visita', id: id, resumo: resumo, blocos: blocos, registo: v };
}
function fichaConsulta(BD, IDX, id) {
  const T = BD.tabelas;
  const t = T.appointments;
  if (!t) return { ok: false, erro: 'sem tabela appointments' };
  const idC = BASE.ex(t, ['appointment_id', 'id']);
  const c = t.linhas.filter(function (r) { return String(r[idC]) === String(id); })[0];
  if (!c) return { ok: false, erro: 'consulta ' + id + ' nao existe' };
  const blocos = [];
  const resumo = { motivo: c.appointment_treatment || '', data: c.created_at || '', medico: c.appointment_doctor_id || '' };
  const vc = BASE.ex(t, ['appointment_visit_id', 'visit_id']);
  let aid = null;
  if (vc && c[vc] != null) {
    blocos.push({ titulo: 'Visita', linhas: [BASE.lig('visita', 'visits', c[vc], 'visita ' + c[vc])] });
    const vv = T.visits && IDX.visPorId ? IDX.visPorId[c[vc]] : null;
    aid = vv && IDX.colVisAni ? vv[IDX.colVisAni] : null;
  }
  ['appointment_physical_exams|appointment_id|exame fisico',
   'appointment_complementar_exams|appointment_id|exame complementar',
   'appointment_products|appointment_products_appointment_id|produtos',
   'appointment_prescriptions|appointment_prescription_appointment_id|receitas',
   'appointment_pics_lesion|appointment_pics_lesion_appointment_id|fotos lesao'
  ].forEach(function (spec) {
    const p = spec.split('|'), tt = T[p[0]];
    if (!tt || tt.colunas.indexOf(p[1]) === -1) return;
    const rs = tt.linhas.filter(function (r) { return String(r[p[1]]) === String(id); });
    if (rs.length) {
      const ic = BASE.ex(tt, [p[0] + '_id', 'id', Object.keys(rs[0])[0]]);
      blocos.push({ titulo: p[2] + ' (' + rs.length + ')',
        linhas: rs.slice(-20).map(function (r) { return BASE.lig('tabela', p[0], r[ic], String(r.created_at || r[ic])); }) });
    }
  });
  if (aid != null) blocos.push({ titulo: 'Animal', linhas: [BASE.lig('animal', 'animals', aid, BASE.nomeAni(IDX, aid))] });
  return { ok: true, tipo: 'consulta', id: id, resumo: resumo, blocos: blocos, registo: c };
}
module.exports = { fichaVisita: fichaVisita, fichaConsulta: fichaConsulta };
