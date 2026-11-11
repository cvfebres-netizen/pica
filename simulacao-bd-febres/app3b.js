function irBusca() {
  const q = document.getElementById('busca').value.trim();
  if (q.length < 2) return said('<p>Escreve pelo menos 2 letras ou digitos.</p>');
  said('<p class="mut">A buscar…</p>');
  j('/api/busca?q=' + encodeURIComponent(q)).then(mostraBusca);
}
function mostraBusca(r) {
  if (!r.ok) return said('<p>' + esc(r.erro) + '</p>');
  if (!r.grupos.length) return said('<p>Nada encontrado para <b>' + esc(r.q) + '</b>.</p>');
  miga([{ nome: 'Inicio', fn: 'inicio()' }, { nome: 'busca: ' + r.q, fn: 'nada()' }]);
  let h = '<p class="mut">' + r.grupos.reduce(function (a, g) { return a + g.total; }, 0) +
    ' resultados em ' + r.grupos.length + ' grupos para <b>' + esc(r.q) + '</b> — prime uma linha para abrir a ficha.</p>';
  r.grupos.forEach(function (g) {
    h += '<h3><span class="tag">' + esc(g.tipo) + '</span> ' + esc(g.tabela) +
      ' <span class="mut">(' + g.total + (g.total > g.resultados.length ? ', a mostrar ' + g.resultados.length : '') + ')</span></h3>';
    h += '<table><tr><th>ID</th><th>Resultado</th><th>Detalhe</th></tr>';
    g.resultados.forEach(function (x) {
      h += '<tr class="clicavel" onclick="vai(\'' + g.tipo + '\',\'' + g.tabela + '\',' + JSON.stringify(String(x.id)) + ')"><td>' + esc(x.id) + '</td><td>' + esc(x.rotulo) + '</td><td>' + esc(x.detalhe) + '</td></tr>';
    });
    h += '</table>';
  });
  said(h);
}
function irHist(antes, grupo) {
  grupo = grupo || 'todos';
  said('<p class="mut">A carregar historico…</p>');
  j('/api/historico/resumo?meses=12').then(function (res) {
    j('/api/historico?limite=50&grupo=' + grupo + (antes ? '&antes=' + encodeURIComponent(antes) : '')).then(function (r) {
      mostraHist(r, res, grupo);
    });
  });
}
function mostraHist(r, res, grupo) {
  if (!r.ok) return said('<p>' + esc(r.erro) + '</p>');
  miga([{ nome: 'Inicio', fn: 'inicio()' }, { nome: 'historico', fn: 'irHist()' }]);
  let h = '<h3>Historico geral <span class="mut">(' + r.total + ' registos — prime uma linha para abrir)</span></h3>';
  h += '<p>Grupo: ' + ['todos', 'tutores', 'animais', 'visitas', 'consultas', 'exames', 'contactos', 'faturas', 'vendas'].map(function (g) {
    return g === grupo ? '<b>' + g + '</b>' : '<a class="lig" onclick="irHist(null,\'' + g + '\')">' + g + '</a>';
  }).join(' · ') + '</p>';
  if (res && res.ok) {
    h += '<table><tr><th>Mes</th>' + Object.keys(res.grupos).map(function (g) { return '<th>' + esc(g) + '</th>'; }).join('') + '</tr>';
    res.meses.slice().reverse().forEach(function (m) {
      h += '<tr><td>' + m + '</td>' + Object.keys(res.grupos).map(function (g) { return '<td>' + res.grupos[g][m] + '</td>'; }).join('') + '</tr>';
    });
    h += '</table>';
  }
  h += '<p><button class="sec" onclick="irHist(null,\'' + grupo + '\')">Mais recentes</button> ' +
    (r.proximo_antes ? '<button onclick="irHist(\'' + r.proximo_antes + '\',\'' + grupo + '\')">Ver mais antigos ↓</button>' : '') + '</p>';
  h += '<table><tr><th>Data</th><th>Grupo</th><th>ID</th><th>Registo</th></tr>';
  r.linhas.forEach(function (l) {
    const tab = l.grupo === 'tutores' ? 'clients' : l.grupo === 'animais' ? 'animals' : l.grupo === 'visitas' ? 'visits' : l.grupo === 'consultas' ? 'appointments' : null;
    const tipo = l.grupo === 'tutores' ? 'tutor' : l.grupo === 'animais' ? 'animal' : l.grupo === 'visitas' ? 'visita' : l.grupo === 'consultas' ? 'consulta' : null;
    const clk = tab ? ' class="clicavel" onclick="vai(\'' + tipo + '\',\'' + tab + '\',' + JSON.stringify(String(l.id)) + ')"' : '';
    h += '<tr' + clk + '><td>' + esc(l.data) + '</td><td><span class="tag">' + esc(l.grupo) + '</span></td><td>' + esc(l.id) + '</td><td>' + esc(l.rotulo) + '</td></tr>';
  });
  said(h + '</table>');
}
function nada() {}
function inicio() {
  document.getElementById('miga').innerHTML = '';
  said('<p class="mut">Escreve uma pista e prime Buscar, ou abre o historico geral.</p>');
}
j('/api/estado').then(function (e) {
  document.getElementById('st').textContent = e.pronta ?
    ('Pronta: ' + e.tabelas + ' tabelas, ' + e.linhas + ' linhas (' + e.tutores + ' tutores, ' + e.animais + ' animais, ' + e.visitas + ' visitas).') :
    ('A carregar (' + (e.espera_s || 0) + 's)… recarrega a pagina.');
});
