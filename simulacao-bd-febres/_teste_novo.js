/* Teste rapido: busca inteligente + historico. Uso: node _teste_novo.js */
function j(u) { return fetch(u).then(function (r) { return r.json(); }); }
Promise.all([
  j('http://127.0.0.1:4100/api/estado'),
  j('http://127.0.0.1:4100/api/busca?q=' + encodeURIComponent('silva')),
  j('http://127.0.0.1:4100/api/busca?q=' + encodeURIComponent('932290927')),
  j('http://127.0.0.1:4100/api/busca?q=' + encodeURIComponent('620098100757015')),
  j('http://127.0.0.1:4100/api/busca?q=' + encodeURIComponent('545')),
  j('http://127.0.0.1:4100/api/historico?limite=5'),
  j('http://127.0.0.1:4100/api/historico/resumo?meses=3')
]).then(function (x) {
  console.log('estado pronta=' + x[0].pronta);
  console.log('busca silva: ' + x[1].grupos.map(function (g) { return g.tipo + '=' + g.total; }).join(', '));
  console.log('busca telefone: ' + x[2].grupos.map(function (g) { return g.tipo + '=' + g.total; }).join(', '));
  console.log('busca microchip: ' + x[3].grupos.map(function (g) { return g.tipo + '(' + g.resultados.length + ')=' + (g.resultados[0] ? g.resultados[0].rotulo : '?'); }).join(', '));
  console.log('busca id 545: ' + (x[4].grupos || []).map(function (g) { return g.tipo + '#' + (g.resultados[0] ? g.resultados[0].id : '?'); }).join(', '));
  console.log('historico total=' + x[5].total + ' primeira=' + x[5].linhas[0].data + ' ' + x[5].linhas[0].grupo + ' ' + x[5].linhas[0].rotulo);
  console.log('resumo meses=' + x[6].meses.join(','));
  console.log('FIM-OK');
}).catch(function (e) { console.log('ERRO ' + e.message); process.exit(1); });
