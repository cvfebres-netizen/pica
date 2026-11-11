/* Fichas completas navegaveis: tutor / animal / visita / consulta.
   Cada ficha devolve blocos com ligacoes (tipo+tabela+id) para seguir
   o caminho na BD: tutor->animais->visitas->consultas->exames->faturas. */
function ex(t, lista) {
  for (let i = 0; i < lista.length; i++) if (t.colunas.indexOf(lista[i]) !== -1) return lista[i];
  return null;
}
function lig(tipo, tab, id, rot) { return { tipo: tipo, tab: tab, id: id, rot: rot }; }
function nomeCli(IDX, id) {
  const c = IDX.cliPorId[id];
  return c ? c.client_name : '(tutor ' + id + ')';
}
function nomeAni(IDX, id) {
  const a = IDX.aniPorId[id];
  return a ? a.animal_name : '(animal ' + id + ')';
}
function fichaTutor(BD, IDX, id) {
  const c = IDX.cliPorId[id];
  if (!c) return { ok: false, erro: 'tutor ' + id + ' nao existe' };
  const T = BD.tabelas, blocos = [];
  const resumo = { nome: c.client_name, email: c.client_email || '',
    tlf: c.client_tlm || c.client_tlf || '', nif: c.client_nif || '' };
  const anis = (IDX.aniPorCliente && IDX.aniPorCliente[id]) || [];
  blocos.push({ titulo: 'Animais (' + anis.length + ')',
    linhas: anis.map(function (a) { return lig('animal', 'animals', a.animal_id, a.animal_name); }) });
  if (T.crm_clients) {
    const cid = ex(T.crm_clients, ['crm_client_id']);
    const crm = cid ? T.crm_clients.linhas.filter(function (r) { return String(r[cid]) === String(id); }).slice(-20) : [];
    if (crm.length) blocos.push({ titulo: 'Contactos CRM (' + crm.length + ')',
      linhas: crm.map(function (r) { return lig('crm', 'crm_clients', r.id_crm || r[Object.keys(r)[0]], String(r.crm_data_hora || r.created_at || '')); }) });
  }
  if (T.invoices) {
    const t = T.invoices, fc = ex(t, ['invoice_client_id', 'client_id', 'client_document_client_id']);
    const inv = fc ? t.linhas.filter(function (r) { return String(r[fc]) === String(id); }).slice(-20) : [];
    if (inv.length) blocos.push({ titulo: 'Faturas (' + inv.length + ')',
      linhas: inv.map(function (r) {
        const ic = ex(t, ['invoice_id', 'id', 'client_document_id']);
        return lig('fatura', 'invoices', r[ic], String(r.created_at || r.invoice_date || ''));
      }) });
  }
  return { ok: true, tipo: 'tutor', id: id, resumo: resumo, blocos: blocos, registo: c };
}
function fichaAnimal(BD, IDX, id) {
  const a = IDX.aniPorId[id];
  if (!a) return { ok: false, erro: 'animal ' + id + ' nao existe' };
  const T = BD.tabelas, blocos = [];
  const resumo = { nome: a.animal_name, tutor: IDX.colCliAni ? nomeCli(IDX, a[IDX.colCliAni]) : '?',
    nasc: a.animal_birth_date || '', microchip: a.animal_microchip || '', cor: a.animal_color || '' };
  if (IDX.colCliAni && a[IDX.colCliAni] != null)
    blocos.push({ titulo: 'Tutor', linhas: [lig('tutor', 'clients', a[IDX.colCliAni], nomeCli(IDX, a[IDX.colCliAni]))] });
  const vis = (IDX.visPorAnimal && IDX.visPorAnimal[id]) || [];
  if (vis.length) {
    const vc = IDX.colVisId || 'visit_id';
    blocos.push({ titulo: 'Visitas (' + vis.length + ')',
      linhas: vis.slice(-30).reverse().map(function (v) { return lig('visita', 'visits', v[vc], String(v.visit_scheduled_date || '')); }) });
  }
  if (T.animal_exams) {
    const t = T.animal_exams, ac = ex(t, ['animal_exam_animal_id', 'animal_id']);
    const exa = ac ? t.linhas.filter(function (r) { return String(r[ac]) === String(id); }) : [];
    if (exa.length) {
      const ic = ex(t, ['animal_exam_id', 'id']);
      blocos.push({ titulo: 'Exames do animal (' + exa.length + ')',
        linhas: exa.slice(-30).reverse().map(function (r) { return lig('exame', 'animal_exams', r[ic], String(r.animal_exam_data || r.created_at || '')); }) });
    }
  }
  if (T.animal_vaccines || T.vaccines || T.animal_dewormings) {
    const tv = T.animal_vaccines || T.vaccines;
    if (tv) {
      const ac2 = ex(tv, ['animal_id', 'vaccine_animal_id']);
      const vac = ac2 ? tv.linhas.filter(function (r) { return String(r[ac2]) === String(id); }) : [];
      if (vac.length) blocos.push({ titulo: 'Vacinas (' + vac.length + ')',
        linhas: vac.slice(-20).reverse().map(function (r, i) { return lig('tabela', tv === T.animal_vaccines ? 'animal_vaccines' : 'vaccines', r[ex(tv, ['id', 'vaccine_id'])] || i, String(r.created_at || '')); }) });
    }
  }
  return { ok: true, tipo: 'animal', id: id, resumo: resumo, blocos: blocos, registo: a };
}
module.exports = { fichaTutor: fichaTutor, fichaAnimal: fichaAnimal,
  lig: lig, nomeCli: nomeCli, nomeAni: nomeAni, ex: ex };
