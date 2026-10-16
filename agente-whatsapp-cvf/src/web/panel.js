/* Painel web para o gestor: ver pendentes, aprovar/recusar, histórico e lista de espera.
   Corre em paralelo com o gateway WhatsApp (porta 3000 por defeito).
   Endpoints:
     GET  /                 — dashboard (pendentes + lista de espera)
     GET  /historico        — histórico de atendimentos
     GET  /lista-espera     — lista de espera
     POST /pendente/:id/aprovar
     POST /pendente/:id/recusar */
const express = require('express');
const path = require('path');
const pendentes = require('../atendimento/pendentes');
const Historico = require('../atendimento/historico');
const ListaEspera = require('../atendimento/listaEspera');
const R = require('../atendimento/respostas');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function htmlCabecalho(titulo) {
  return '<!DOCTYPE html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + (process.env.NOME_CLINICA || 'CVF') + ' — ' + titulo + '</title>'
    + '<style>body{font-family:sans-serif;margin:20px;background:#f5f5f5}table{border-collapse:collapse;width:100%;background:#fff}'
    + 'th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#2c3e50;color:#fff}'
    .trim() + '</style></head><body>';
}
function htmlRodape() {
  return '<p><a href="/">◀ Voltar</a></p></body></html>';
}
function botaoAcao(id, tipo) {
  return '<form method="post" style="display:inline" onsubmit="return confirm(\'Tem certeza?\')">'
    + '<input type="hidden" name="id" value="' + id + '">'
    + (tipo === 'marcar'
      ? '<button style="background:#27ae60;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer">✔ OK</button> '
      : '')
    + '<button style="background:#c0392b;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer">✖ NÃO</button>'
    + '</form>';
}

// Dashboard: pendentes + lista de espera
app.get('/', (req, res) => {
  const lista = pendentes.resumo().split('\n').filter(Boolean);
  const espera = ListaEspera.listar();
  let pendentesHtml = '<ul>';
  const todas = pendentes.ler ? pendentes.ler() : [];
  // pendentes.js não exporta ler, então usamos o resumo como texto
  pendentesHtml += '<li>' + lista.join('</li><li>') + '</li>';
  pendentesHtml += '</ul>';
  let esperaHtml = '<ul>';
  for (const e of espera) {
    esperaHtml += '<li>' + e.id + ' | ' + e.servico + ' | ' + e.animal + ' | prefere ' + e.dataPreferida + ' ' + e.horaPreferida + '</li>';
  }
  esperaHtml += '</ul>';
  res.send(htmlCabecalho('Dashboard')
    + '<h1>' + (process.env.NOME_CLINICA || 'CVF') + ' — Gestão de Agendamentos</h1>'
    + '<nav><a href="/">Dashboard</a> | <a href="/historico">Histórico</a> | <a href="/lista-espera">Lista de Espera</a></nav>'
    + '<h2>Pendentes de aprovação</h2>' + pendentesHtml
    + '<h2>Lista de Espera</h2>' + (espera.length ? esperaHtml : '<p>' + R.listaEsperaVazia() + '</p>')
    + htmlRodape());
});

// Histórico
app.get('/historico', (req, res) => {
  const h = Historico.todos();
  let linhas = '<table><tr><th>Data/Hora</th><th>Serviço</th><th>Animal</th><th>Estado</th><th>Cliente</th></tr>';
  for (const e of h) {
    linhas += '<tr><td>' + e.dataHora.slice(0, 16) + '</td><td>' + e.servico + '</td><td>' + e.animal + '</td><td>' + e.estado + '</td><td>' + e.cliente + '</td></tr>';
  }
  linhas += '</table>';
  res.send(htmlCabecalho('Histórico')
    + '<nav><a href="/">Dashboard</a> | <a href="/historico">Histórico</a> | <a href="/lista-espera">Lista de Espera</a></nav>'
    + '<h2>Histórico de Atendimentos</h2>' + (h.length ? linhas : '<p>' + R.historicoVazio() + '</p>')
    + htmlRodape());
});

// Lista de espera
app.get('/lista-espera', (req, res) => {
  const eLista = ListaEspera.listar();
  let linhas = '<table><tr><th>ID</th><th>Serviço</th><th>Animal</th><th>Prefere</th><th>Criado em</th><th>Ação</th></tr>';
  for (const e of eLista) {
    linhas += '<tr><td>' + e.id + '</td><td>' + e.servico + '</td><td>' + e.animal + '</td><td>' + e.dataPreferida + ' ' + e.horaPreferida + '</td><td>' + e.criadoEm.slice(0, 16) + '</td>'
      + '<td><form method="post" style="display:inline" action="/lista-espera/atender/' + e.id + '"><button>Atendido</button></form></td></tr>';
  }
  linhas += '</table>';
  res.send(htmlCabecalho('Lista de Espera')
    + '<nav><a href="/">Dashboard</a> | <a href="/historico">Histórico</a> | <a href="/lista-espera">Lista de Espera</a></nav>'
    + '<h2>Lista de Espera</h2>' + (eLista.length ? linhas : '<p>' + R.listaEsperaVazia() + '</p>')
    + htmlRodape());
});

// Atender (remover da lista de espera)
app.post('/lista-espera/atender/:id', (req, res) => {
  ListaEspera.atender(req.params.id);
  res.redirect('/lista-espera');
});

// Aprovar pendente
app.post('/pendente/:id/aprovar', (req, res) => {
  pendentes.aprovar(req.params.id, { resumo: 'Aprovado via painel web' });
  res.redirect('/');
});

// Recusar pendente
app.post('/pendente/:id/recusar', (req, res) => {
  pendentes.recusar(req.params.id);
  res.redirect('/');
});

function iniciar(porta) {
  const p = porta || parseInt(process.env.PORT || '3000', 10);
  app.listen(p, () => console.log('Painel web a ouvir em http://localhost:' + p));
  return app;
}

module.exports = { iniciar, app };
