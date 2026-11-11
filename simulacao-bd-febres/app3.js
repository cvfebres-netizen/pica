/* Explorador completo: busca global, fichas ligadas, tabelas clicaveis. */
function j(u) { return fetch(u).then(function (r) { return r.json(); }); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function said(h) { document.getElementById('saida').innerHTML = h; }
const ROTA_FICHA = { tutor: 'tutor', animal: 'animal', visita: 'visita', consulta: 'consulta' };
function vai(tipo, tab, id) {
  if (ROTA_FICHA[tipo]) return abrirFicha(tipo, id);
  abrirRegisto(tab, id);
}
function miga(caminho) {
  document.getElementById('miga').innerHTML = caminho.map(function (c, i) {
    return (i ? ' › ' : '') + '<a onclick="' + c.fn + '">' + esc(c.nome) + '</a>';
  }).join('');
}
function celLig(x) {
  return '<a class="lig" onclick="vai(\'' + x.tipo + '\',\'' + x.tab + '\',' + JSON.stringify(String(x.id)) + ')">' + esc(x.rot || x.id) + '</a>';
}
function blocoLiga(b) {
  let h = '<h3>' + esc(b.titulo) + '</h3><table><tr><th>Tipo</th><th>Registo</th></tr>';
  b.linhas.forEach(function (x) {
    h += '<tr class="clicavel" onclick="vai(\'' + x.tipo + '\',\'' + x.tab + '\',' + JSON.stringify(String(x.id)) + ')"><td><span class="tag">' + esc(x.tipo) + '</span></td><td>' + esc(x.rot || x.id) + ' <span class="mut">#' + esc(x.id) + '</span></td></tr>';
  });
  return h + '</table>';
}
function fichaHTML(f) {
  let h = '<h2><span class="tag">' + esc(f.tipo) + '</span> #' + esc(f.id) + '</h2>';
  h += '<table><tr><th>Campo</th><th>Valor</th></tr>';
  Object.keys(f.resumo).forEach(function (k) { h += '<tr><td>' + esc(k) + '</td><td>' + esc(f.resumo[k]) + '</td></tr>'; });
  h += '</table>';
  f.blocos.forEach(function (b) { h += blocoLiga(b); });
  h += '<h3>Registo completo</h3><p><button class="sec" onclick="abrirRegisto(\'' + fichaTab(f.tipo) + '\',' + JSON.stringify(String(f.id)) + ')">Ver todos os campos</button></p>';
  return h;
}
function fichaTab(tipo) {
  return tipo === 'tutor' ? 'clients' : tipo === 'animal' ? 'animals' : tipo === 'visita' ? 'visits' : 'appointments';
}
function abrirFicha(tipo, id, volta) {
  said('<p class="mut">A abrir ficha…</p>');
  j('/api/ficha/' + tipo + '/' + encodeURIComponent(id)).then(function (f) {
    if (!f.ok) return said('<p>' + esc(f.erro) + '</p>');
    miga([{ nome: 'Inicio', fn: 'inicio()' }, { nome: f.tipo + ' #' + f.id, fn: 'abrirFicha(\'' + tipo + '\',' + JSON.stringify(String(id)) + ')' }]);
    said(fichaHTML(f));
    window.scrollTo(0, 0);
  });
}
function abrirRegisto(tab, id) {
  said('<p class="mut">A abrir registo…</p>');
  j('/api/registo?tab=' + encodeURIComponent(tab) + '&id=' + encodeURIComponent(id)).then(function (r) {
    if (!r.ok) return said('<p>' + esc(r.erro) + '</p>');
    miga([{ nome: 'Inicio', fn: 'inicio()' }, { nome: tab + ' #' + id, fn: 'abrirRegisto(\'' + tab + '\',' + JSON.stringify(String(id)) + ')' }]);
    let h = '<h2>' + esc(tab) + ' #' + esc(id) + '</h2>';
    if (r.ligacoes.length) {
      h += '<p><b>Seguir:</b> ' + r.ligacoes.map(function (l) {
        return '<a class="lig" onclick="abrirRegisto(\'' + l.tab + '\',' + JSON.stringify(String(l.id)) + ')">' + esc(l.coluna + ' → ' + l.tab + ' #' + l.id + (l.rot ? ' (' + l.rot + ')' : '')) + '</a>';
      }).join(' · ') + '</p>';
    }
    h += '<table><tr><th>Coluna</th><th>Valor</th></tr>';
    r.colunas.forEach(function (c) {
      const v = r.registo[c];
      const l = r.ligacoes.filter(function (x) { return x.coluna === c; })[0];
      h += '<tr><td>' + esc(c) + '</td><td>' + (l ? '<a class="lig" onclick="abrirRegisto(\'' + l.tab + '\',' + JSON.stringify(String(l.id)) + ')">' + esc(v) + ' →</a>' : esc(v)) + '</td></tr>';
    });
    said(h + '</table>');
    window.scrollTo(0, 0);
  });
}
