/* Formulário de agendamento passo a passo (FSM).
   Fluxo: nome → telefone → animal → espécie → serviço → data/hora → confirmação → concluído.
   Estado por cliente guardado em src/dados/formulario-estados.json.
   Quando concluído, cria um PENDENTE para aprovação do gestor. */
const fs = require('fs');
const path = require('path');
const servicos = require('./servicos');
const pendentes = require('./pendentes');

const FICHA = path.join(__dirname, '..', 'dados', 'formulario-estados.json');

const ETAPAS = [
  'nome', 'telefone', 'animal', 'especie', 'servico', 'dataHora', 'confirmacao'
];

function ler() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardar(estados) { fs.writeFileSync(FICHA, JSON.stringify(estados, null, 1)); }

function chaveCliente(jid) { return String(jid).replace(/\D/g, ''); }

function estadoInicial() {
  return { etapa: 'nome', dados: {} };
}

function listaServicos() {
  const linhas = servicos
    .filter((s) => s.agendamentoDireto !== false)
    .map((s) => '• ' + s.id + ' — ' + s.preco + ' (' + s.duracaoMin + ' min)');
  return 'Serviços disponíveis:\n' + linhas.join('\n') + '\n\nDiga o nome do serviço (ex: consulta, banho, tosquia).';
}

function processar({ de, texto }) {
  const c = chaveCliente(de);
  const estados = ler();
  let est = estados[c];

  if (!est) {
    const t = (texto || '').toLowerCase();
    const começar = /(formul|marcar|agendar|novo|preencher|dados)/i.test(t);
    if (!começar) return null;
    est = estadoInicial();
    estados[c] = est;
    guardar(estados);
    return { resposta: 'Vamos preencher os dados da consulta. Como se chama (o(a) dono(a))?', concluiu: false, pendente: null };
  }

  return avanca(est, texto, c, de, estados);
}


function avanca(est, texto, c, de, estados) {
  const etapa = est.etapa;
  const d = est.dados;
  const t = (texto || '').trim();

  if (etapa === 'nome') {
    d.nome = t;
    est.etapa = 'telefone';
    guardar(estados);
    return { resposta: 'Qual o seu telefone de contacto?', concluiu: false, pendente: null };
  }
  if (etapa === 'telefone') {
    d.telefone = t;
    est.etapa = 'animal';
    guardar(estados);
    return { resposta: 'Qual o nome do animal?', concluiu: false, pendente: null };
  }
  if (etapa === 'animal') {
    d.animal = t;
    est.etapa = 'especie';
    guardar(estados);
    return { resposta: 'Qual a espécie do animal? (cão, gato, outro)', concluiu: false, pendente: null };
  }
  if (etapa === 'especie') {
    d.especie = t;
    est.etapa = 'servico';
    guardar(estados);
    return { resposta: listaServicos(), concluiu: false, pendente: null };
  }
  if (etapa === 'servico') {
    const s = servicos.detetarServico(t);
    if (!s || s.agendamentoDireto === false) {
      return { resposta: 'Não reconheci esse serviço. ' + listaServicos(), concluiu: false, pendente: null };
    }
    d.servico = s.id;
    d.duracaoMin = s.duracaoMin;
    est.etapa = 'dataHora';
    guardar(estados);
    return { resposta: 'Qual dia e hora prefere? (ex: amanhã 10:30 ou 12/05 14h)', concluiu: false, pendente: null };
  }
  if (etapa === 'dataHora') {
    d.dataHora = t;
    est.etapa = 'confirmacao';
    guardar(estados);
    return {
      resposta: 'Confirma os dados:\n'
        + 'Nome: ' + d.nome + '\n'
        + 'Telefone: ' + d.telefone + '\n'
        + 'Animal: ' + d.animal + ' (' + d.especie + ')\n'
        + 'Serviço: ' + d.servico + '\n'
        + 'Dia/hora: ' + d.dataHora + '\n\n'
        + 'Responda SIM para confirmar ou NÃO para recomeçar.',
      concluiu: false, pendente: null
    };
  }
  if (etapa === 'confirmacao') {
    const sim = /^(sim|s|ok|confirmo|confirma)$/i.test(t);
    const nao = /^(nao|não|n|cancela|recomeçar|recomecar)$/i.test(t);
    if (sim) {
      const p = pendentes.criar({
        tipo: 'marcar',
        cliente: de,
        texto: 'Formulário: ' + d.nome + ' — ' + d.animal + ' — ' + d.servico + ' — ' + d.dataHora,
        dados: {
          nome: d.nome,
          telefone: d.telefone,
          animal: d.animal,
          especie: d.especie,
          servico: d.servico,
          dia: d.dataHora,
          hora: '',
          motivo: 'Agendamento via formulário WhatsApp',
          servicoId: d.servico,
          duracaoMin: d.duracaoMin
        }
      });
      delete estados[c];
      guardar(estados);
      return {
        resposta: 'Dados enviados para confirmação da clínica. Aguarde a nossa resposta (OK/NÃO).',
        concluiu: true, pendente: p
      };
    }
    if (nao) {
      delete estados[c];
      guardar(estados);
      return { resposta: 'Recomeçamos. Como se chama (o(a) dono(a))?', concluiu: false, pendente: null };
    }
    return { resposta: 'Responda SIM para confirmar ou NÃO para recomeçar.', concluiu: false, pendente: null };
  }

  delete estados[c];
  guardar(estados);
  return { resposta: 'Algo correu mal. Recomeçamos. Como se chama?', concluiu: false, pendente: null };
}

function temFormularioAberto(jid) {
  const c = chaveCliente(jid);
  const estados = ler();
  return !!estados[c];
}

function estado(jid) {
  const c = chaveCliente(jid);
  const estados = ler();
  return estados[c] || null;
}

function cancelar(jid) {
  const c = chaveCliente(jid);
  const estados = ler();
  if (estados[c]) { delete estados[c]; guardar(estados); return true; }
  return false;
}

module.exports = { processar, temFormularioAberto, estado, cancelar, ETAPAS };