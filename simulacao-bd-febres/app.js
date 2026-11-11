/* Pagina: busca inteligente + historico em tabela. */
function j(u) { return fetch(u).then(function (r) { return r.json(); }); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function said(html) { document.getElementById('saida').innerHTML = html; }
function irBusca() {
  const q = document.getElementById('busca').value.trim();
  if (q.length < 2) return said('<p>Escreve pelo menos 2 letras ou digitos.</p>');
  said('<p class="mut">A buscar…</p>');
  j('/api/busca?q=' + encodeURIComponent(q)).then(mostraBusca);
}
function mostraBusca(r) {
  if (!r.ok) return said('<p>' + esc(r.erro) + '</p>');
  if (!r.grupos.length) return said('<p>Nada encontrado para <b>' + esc(r.q) + '</b>.</p>');
  let h = '<p class="mut">' + r.grupos.reduce(function (a, g) { return a + g.total; }, 0) +
    ' resultados em ' + r.grupos.length + ' grupos para <b>' + esc(r.q) + '</b></p>';
  r.grupos.forEach(function (g) {
    h += '<h3><span class="tag">' + esc(g.tipo) + '</span> ' + esc(g.tabela) +
      ' <span class="mut">(' + g.total + (g.total > g.resultados.length ? ', a mostrar ' + g.resultados.length : '') + ')</span></h3>';
    h += '<table><tr><th>ID</th><th>Resultado</th><th>Detalhe</th>';
    if (g.tipo === 'animal') h += '<th></th>';
    h += '</tr>';
    g.resultados.forEach(function (x) {
      h += '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.rotulo) + '</td><td>' + esc(x.detalhe) + '</td>';
      if (g.tipo === 'animal') h += '<td><button class="sec" onclick="ficha(' + Number(x.id) + ')">Ficha</button></td>';
      h += '</tr>';
    });
    h += '</table>';
  });
  said(h);
}
function ficha(id) {
  said('<p class="mut">A abrir ficha…</p>');
  j('/api/animal/' + id).then(function (r) {
    if (!r.animal) return said('<p>' + esc(r.erro || 'sem dados') + '</p>');
    let h = '<h3>Ficha do animal #' + esc(r.animal.animal_id) + ' — ' + esc(r.animal.animal_name) + '</h3>';
    h += '<p class="mut">Tutor: <b>' + esc(r.tutor ? r.tutor.client_name : '?') + '</b>' +
      (r.tutor ? ' (id ' + esc(r.tutor.client_id) + ', ' + esc(r.tutor.client_tlm || r.tutor.client_tlf || '') + ')' : '') + '</p>';
    h += '<table><tr><th>Campo</th><th>Valor</th></tr>';
    ['animal_birth_date', 'animal_sex', 'animal_color', 'animal_microchip', 'animal_breed_id', 'animal_weight', 'animal_sterilized'].forEach(function (c) {
      h += '<tr><td>' + c + '</td><td>' + esc(r.animal[c]) + '</td></tr>';
    });
    h += '</table><h3>Ultimas visitas (' + r.visitas.length + ')</h3>';
    h += '<table><tr><th>Data</th><th>Entrada</th><th>Fim</th></tr>';
    r.visitas.forEach(function (v) {
      h += '<tr><td>' + esc(v.visit_scheduled_date) + '</td><td>' + esc(v.visit_entrance_time) + '</td><td>' + esc(v.visit_end_time) + '</td></tr>';
    });
    said(h + '</table>');
  });
}
function irHist(antes) {
  said('<p class="mut">A carregar historico…</p>');
  j('/api/historico/resumo?meses=12').then(function (res) {
    j('/api/historico?limite=50' + (antes ? '&antes=' + encodeURIComponent(antes) : '')).then(function (r) {
      mostraHist(r, res);
    });
  });
}
function mostraHist(r, res) {
  if (!r.ok) return said('<p>' + esc(r.erro) + '</p>');
  let h = '<h3>Historico geral <span class="mut">(' + r.total + ' registos com data — do mais recente para o mais antigo)</span></h3>';
  if (res && res.ok) {
    h += '<table><tr><th>Mes</th>' + Object.keys(res.grupos).map(function (g) { return '<th>' + esc(g) + '</th>'; }).join('') + '</tr>';
    res.meses.slice().reverse().forEach(function (m) {
      h += '<tr><td>' + m + '</td>' + Object.keys(res.grupos).map(function (g) { return '<td>' + res.grupos[g][m] + '</td>'; }).join('') + '</tr>';
    });
    h += '</table>';
  }
  h += '<p><button class="sec" onclick="irHist()">Mais recentes</button> ' +
    (r.proximo_antes ? '<button onclick="irHist(\'' + r.proximo_antes + '\')">Ver mais antigos ↓</button>' : '') + '</p>';
  h += '<table><tr><th>Data</th><th>Grupo</th><th>ID</th><th>Registo</th></tr>';
  r.linhas.forEach(function (l) {
    h += '<tr><td>' + esc(l.data) + '</td><td><span class="tag">' + esc(l.grupo) + '</span></td><td>' + esc(l.id) + '</td><td>' + esc(l.rotulo) + '</td></tr>';
  });
  said(h + '</table>');
}
j('/api/estado').then(function (e) {
  document.getElementById('st').textContent = e.pronta ?
    ('Pronta: ' + e.tabelas + ' tabelas, ' + e.linhas + ' linhas (' + e.tutores + ' tutores, ' + e.animais + ' animais, ' + e.visitas + ' visitas).') :
    ('A carregar (' + (e.espera_s || 0) + 's)… recarrega a pagina.');
});
