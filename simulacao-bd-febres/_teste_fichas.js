/* Teste fichas completas. Uso: node _teste_fichas.js */
function j(u) { return fetch(u).then(function (r) { return r.json(); }); }
j('http://127.0.0.1:4100/api/estado').then(function (e) {
  if (!e.pronta) { console.log('BD a carregar, tenta outra vez'); process.exit(1); }
  return Promise.all([
    j('http://127.0.0.1:4100/api/busca?q=' + encodeURIComponent('vacina')),
    j('http://127.0.0.1:4100/api/ficha/tutor/545'),
    j('http://127.0.0.1:4100/api/ficha/animal/3'),
    j('http://127.0.0.1:4100/api/historico?limite=3&grupo=exames'),
    j('http://127.0.0.1:4100/api/registo?tab=animal_exams&id=1')
  ]);
}).then(function (x) {
  console.log('busca vacina: ' + x[0].grupos.map(function (g) { return g.tipo + '=' + g.total; }).join(', '));
  console.log('ficha tutor545: ' + x[1].resumo.nome + ' | blocos=' + x[1].blocos.map(function (b) { return b.titulo; }).join(' / '));
  console.log('ficha animal3: ' + x[2].resumo.nome + ' tutor=' + x[2].resumo.tutor + ' | blocos=' + x[2].blocos.map(function (b) { return b.titulo; }).join(' / '));
  console.log('hist exames total=' + x[3].total + ' ex=' + (x[3].linhas[0] ? x[3].linhas[0].data + ' ' + x[3].linhas[0].rotulo : '?'));
  if (x[4].ok) console.log('registo animal_exams#1: ' + x[4].colunas.length + ' cols, ' + x[4].ligacoes.length + ' ligacoes');
  else console.log('registo animal_exams#1: ' + x[4].erro);
  return j('http://127.0.0.1:4100/api/ficha/visita/1').then(function (v) {
    console.log('ficha visita1: ' + v.resumo.animal + ' | blocos=' + (v.blocos || []).map(function (b) { return b.titulo; }).join(' / '));
    console.log('FIM-OK');
  });
}).catch(function (e) { console.log('ERRO ' + (e && e.message)); process.exit(1); });
