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
const logger = require('../monitor/logger');
const metricas = require('../monitor/metricas');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* Autenticação básica simples: usuário/senha via .env (PAINEL_USER, PAINEL_PASS).
   Se não estiverem definidos, o painel fica aberto (modo desenvolvimento local). */
const PAINEL_USER = process.env.PAINEL_USER || null;
const PAINEL_PASS = process.env.PAINEL_PASS || null;

function autenticado(req, res, next) {
  if (!PAINEL_USER || !PAINEL_PASS) return next(); // sem credenciais definidas → modo aberto
  const auth = req.headers.authorization;
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic realm="Painel Clínica"');
    return res.status(401).send('Autenticação necessária.');
  }
  const base64 = auth.replace(/^Basic\s+/, '');
  const creds = Buffer.from(base64, 'base64').toString('utf-8');
  const [user, pass] = creds.split(':');
  if (user === PAINEL_USER && pass === PAINEL_PASS) return next();
  res.status(403).send('Acesso negado.');
}
app.use(autenticado);

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
  pendentes.aprovar(req.params.id, { resumo: 'Aprovado via painel web' }, 'painel_web');
  res.redirect('/');
});

// Recusar pendente
app.post('/pendente/:id/recusar', (req, res) => {
  pendentes.recusar(req.params.id, 'painel_web');
  res.redirect('/');
});

// Endpoint /health para monitorização (uptime, dados, env)
const BOOT = Date.now();
app.get('/health', (req, res) => {
  const dadosExist = fs.existsSync(path.join(__dirname, '..', 'dados'));
  const logsExist = fs.existsSync(path.join(__dirname, '..', 'logs'));
  res.type('application/json').send(JSON.stringify({
    status: 'ok',
    uptimeMs: Date.now() - BOOT,
    porta: p,
    dados: dadosExist ? 'ok' : 'missing',
    logs: logsExist ? 'ok' : 'missing',
    env: {
      NOME_CLINICA: !!process.env.NOME_CLINICA,
      TELEFONE_CLINICA: !!process.env.TELEFONE_CLINICA,
      NUMERO_GESTOR: !!process.env.NUMERO_GESTOR,
      PAINEL_USER: !!process.env.PAINEL_USER,
      GOOGLE_CALENDAR_ID: !!process.env.GOOGLE_CALENDAR_ID
    }
  }, null, 1));
});
app.get('/metrics', (req, res) => {
  const m = metricas.resumo();
  let linhas = '<table><tr><th>Dia</th><th>Métrica</th><th>Valor</th></tr>';
  for (const dia of Object.keys(m).sort()) {
    for (const k of Object.keys(m[dia])) {
      linhas += '<tr><td>' + dia + '</td><td>' + k + '</td><td>' + m[dia][k] + '</td></tr>';
    }
  }
  linhas += '</table>';
  res.send(htmlCabecalho('Métricas')
    + '<nav><a href=\"/\">Dashboard</a> | <a href=\"/historico\">Histórico</a> | <a href=\"/lista-espera\">Lista de Espera</a> | <a href=\"/metrics\">Métricas</a></nav>'
    + '<h2>Métricas por dia</h2>' + (Object.keys(m).length ? linhas : '<p>Sem métricas ainda.</p>')
    + htmlRodape());
});

function iniciar(porta) {
  const p = porta || parseInt(process.env.PORT || '3000', 10);
  app.listen(p, () => console.log('Painel web a ouvir em http://localhost:' + p));
  return app;
}

module.exports = { iniciar, app };



