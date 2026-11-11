/* Busca inteligente global: uma caixa para qualquer pista.
   Tolera acentos, maiusculas/minusculas, palavras por qualquer ordem,
   IDs numericos, telefones, NIFs e microchips. Sem MySQL, sem deps. */
function norm(s) {
  return String(s == null ? '' : s).toLowerCase();
}
const DIACRITICOS = /[\u0300-\u036f]/g;
function semAcentos(s) { return norm(s).normalize('NFD').replace(DIACRITICOS, ''); }
const CONF_FIXA = [
  { tab: 'clients', tipo: 'tutor', id: ['client_id', 'id'], rot: ['client_name', 'name'],
    cols: ['client_name', 'client_email', 'client_tlf', 'client_tlm', 'client_tlm2', 'client_nif', 'client_foreign_nif', 'client_address'] },
  { tab: 'animals', tipo: 'animal', id: ['animal_id', 'id'], rot: ['animal_name', 'name'],
    cols: ['animal_name', 'animal_microchip', 'animal_color', 'animal_reference', 'animal_passport', 'animal_buletin'] },
  { tab: 'users', tipo: 'equipa', id: ['id'], rot: ['name'],
    cols: ['name', 'email', 'tlf'] },
  { tab: 'visits', tipo: 'visita', id: ['visit_id', 'id'], rot: ['visit_scheduled_date'],
    cols: ['visit_scheduled_date', 'visit_entrance_time'] },
  { tab: 'appointments', tipo: 'consulta', id: ['appointment_id', 'id'], rot: ['appointment_treatment', 'appointment_reason'],
    cols: ['appointment_treatment', 'appointment_reason', 'appointment_diagnosis', 'created_at'] },
  { tab: 'animal_exams', tipo: 'exame', id: ['animal_exam_id', 'id'], rot: ['animal_exam_data', 'animal_exam_obs'],
    cols: ['animal_exam_obs', 'animal_exam_data'] },
  { tab: 'appointment_biochemistry', tipo: 'exame-bioquimica', id: ['appointment_biochemistry_id', 'id'], rot: ['created_at'], cols: ['created_at'] },
  { tab: 'appointment_hemogram', tipo: 'exame-hemograma', id: ['appointment_hemogram_id', 'id'], rot: ['created_at'], cols: ['created_at'] },
  { tab: 'appointment_complementar_exams', tipo: 'exame-complementar', id: ['appointment_complementar_exam_id', 'id'], rot: ['appointment_complementar_exam_obs'],
    cols: ['appointment_complementar_exam_obs', 'appointment_complementar_exam_date'] },
  { tab: 'appointment_physical_exams', tipo: 'exame-fisico', id: ['appointment_physical_exam_id', 'id'], rot: ['created_at'], cols: ['created_at'] },
  { tab: 'appointment_prescriptions', tipo: 'receita', id: ['id'], rot: ['created_at'], cols: ['created_at'] },
  { tab: 'crm_clients', tipo: 'contacto', id: ['id_crm', 'id'], rot: ['crm_contacto_motivo'],
    cols: ['crm_contacto_motivo', 'crm_obs', 'crm_contacto', 'crm_data_hora'] },
  { tab: 'invoices', tipo: 'fatura', id: ['invoice_id', 'id', 'client_document_id'], rot: ['created_at', 'invoice_date'],
    cols: ['created_at', 'invoice_date', 'invoice_number'] },
  { tab: 'sales', tipo: 'venda', id: ['sale_id', 'id'], rot: ['sale_product_description', 'created_at'],
    cols: ['sale_product_description', 'created_at', 'sale_date'] },
  { tab: 'products_info', tipo: 'produto', id: ['product_info_id', 'id'], rot: ['product_info_description'],
    cols: ['product_info_description', 'product_info_description2', 'product_info_code', 'product_barcode'] }
];
function confAuto(BD) {
  // Qualquer outra tabela com texto: pesquisavel por defeito (rotulo = 1a coluna de texto).
  const T = BD.tabelas, fixas = {};
  CONF_FIXA.forEach(function (c) { fixas[c.tab] = 1; });
  const out = CONF_FIXA.slice();
  BD.ordem.forEach(function (n) {
    if (fixas[n]) return;
    const t = T[n];
    if (!t.linhas.length) return;
    const idC = ['id', n + '_id', n.replace(/s$/, '') + '_id'].filter(function (x) { return t.colunas.indexOf(x) !== -1; })[0]
      || t.colunas.filter(function (x) { return /_id$|^id$/.test(x); })[0];
    if (!idC) return;
    const txt = t.colunas.filter(function (x) { return /name|description|obs|motivo|reason|treatment|diagnos|number|email|phone|tlf|address|code|bar/i.test(x); }).slice(0, 6);
    if (!txt.length) return;
    out.push({ tab: n, tipo: 'registo', id: [idC], rot: txt.slice(0, 1), cols: txt });
  });
  return out;
}
let CACHE = null;
function construir(BD) {
  const T = BD.tabelas;
  const ix = { tabelas: [], aniPorCliente: {}, visPorId: {} };
  confAuto(BD).forEach(function (c) {
    const t = T[c.tab];
    if (!t || !t.linhas.length) return;
    function ex(l) {
      for (let i = 0; i < l.length; i++) if (t.colunas.indexOf(l[i]) !== -1) return l[i];
      return null;
    }
    const idC = ex(c.id), rotC = ex(c.rot);
    const cols = c.cols.filter(function (x) { return t.colunas.indexOf(x) !== -1; });
    if (!idC || (!rotC && !cols.length)) return;
    ix.tabelas.push({ tipo: c.tipo, tab: c.tab, idC: idC, rotC: rotC,
      rows: t.linhas.map(function (r) {
        return { r: r, idv: r[idC], blob: semAcentos(cols.map(function (x) { return r[x]; }).join(' ')) };
      }) });
  });
  if (T.animals) {
    const a = T.animals;
    const cC = ['animal_client_id', 'client_id'].filter(function (x) { return a.colunas.indexOf(x) !== -1; })[0];
    if (cC) a.linhas.forEach(function (r) {
      const k = r[cC];
      (ix.aniPorCliente[k] = ix.aniPorCliente[k] || []).push(r);
    });
  }
  if (T.visits) {
    const v = T.visits;
    const idV = v.colunas.indexOf('visit_id') !== -1 ? 'visit_id' : 'id';
    v.linhas.forEach(function (r) { ix.visPorId[r[idV]] = r; });
  }
  return ix;
}
function ficha(tb, r, IDX, ix) {
  const id = r[tb.idC];
  const rot = tb.rotC && r[tb.rotC] != null ? String(r[tb.rotC]).slice(0, 80) : '';
  if (tb.tipo === 'animal') {
    const cli = IDX.colCliAni ? IDX.cliPorId[r[IDX.colCliAni]] : null;
    return { id: id, rotulo: rot, detalhe: 'tutor: ' + (cli ? cli.client_name : '?') };
  }
  if (tb.tipo === 'tutor') {
    const anis = ix.aniPorCliente[id] || [];
    return { id: id, rotulo: rot,
      detalhe: anis.length + ' animais' + (anis.length ? ': ' + anis.slice(0, 4).map(function (a) { return a.animal_name; }).join(', ') : '') };
  }
  if (tb.tipo === 'visita' || tb.tipo === 'consulta') {
    let aid = null;
    if (tb.tipo === 'visita') aid = IDX.colVisAni ? r[IDX.colVisAni] : null;
    else {
      const vc = Object.keys(r).filter(function (k) { return /visit_id/i.test(k); })[0];
      const v = vc ? ix.visPorId[r[vc]] : null;
      aid = v && IDX.colVisAni ? v[IDX.colVisAni] : null;
    }
    const a = aid != null ? IDX.aniPorId[aid] : null;
    return { id: id, rotulo: rot, detalhe: a ? ('animal: ' + a.animal_name) : '' };
  }
  return { id: id, rotulo: rot, detalhe: '' };
}
function buscar(BD, IDX, q, porTipo) {
  if (!BD) return { ok: false, erro: 'BD ainda a carregar; recarrega.' };
  if (!CACHE || CACHE.n !== BD.ordem.length) CACHE = { n: BD.ordem.length, d: construir(BD) };
  const ix = CACHE.d;
  const toks = semAcentos(q).split(/[^a-z0-9]+/).filter(function (t) { return t; });
  if (!toks.length || semAcentos(q).replace(/[^a-z0-9]/g, '').length < 2)
    return { ok: false, erro: 'escreve pelo menos 2 letras ou digitos' };
  const qq = q.trim();
  const numerica = /^[0-9]+$/.test(qq);
  const maxT = Math.min(20, Math.max(1, Number(porTipo) || 8));
  const grupos = [];
  ix.tabelas.forEach(function (tb) {
    const hits = [];
    for (let i = 0; i < tb.rows.length; i++) {
      const e = tb.rows[i];
      let score = -1;
      if (numerica && String(e.idv) === qq) score = 1000;
      else {
        let s = 0, tudo = true;
        for (let j = 0; j < toks.length; j++) {
          const pos = e.blob.indexOf(toks[j]);
          if (pos === -1) { tudo = false; break; }
          s += (pos === 0 ? 50 : (pos < 25 ? 10 : 1));
        }
        if (tudo) score = s;
      }
      if (score >= 0) hits.push({ e: e, score: score });
    }
    if (!hits.length) return;
    hits.sort(function (a, b) { return b.score - a.score; });
    grupos.push({ tipo: tb.tipo, tabela: tb.tab, total: hits.length,
      resultados: hits.slice(0, maxT).map(function (h) { return ficha(tb, h.e.r, IDX, ix); }) });
  });
  return { ok: true, q: q, grupos: grupos };
}
module.exports = { buscar: buscar };
