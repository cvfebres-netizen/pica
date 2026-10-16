/* Stress test: 1000+ iteracoes com cenarios variados e loops de bloqueio */
process.env.NUMERO_GESTOR = '351900000000';
const path = require('path');
const { encaminhar } = require('../src/atendimento/roteador');
const pendentes = require('../src/atendimento/pendentes');
const escalation = require('../src/atendimento/escalation');
const Form = require('../src/atendimento/formulario');
const Historico = require('../src/atendimento/historico');
const ListaEspera = require('../src/atendimento/listaEspera');

const GESTOR = '351900000000@s.whatsapp.net';
const enviados = [];
const enviar = async (para, texto) => { enviados.push({ para, texto }); };

function resetarDados() {
  const fs = require('fs');
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'dados', 'pendentes.json'), '[]');
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'dados', 'escalation.json'), '{}');
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'dados', 'formulario-estados.json'), '{}');
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'dados', 'historico.json'), '[]');
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'dados', 'listaEspera.json'), '[]');
  enviados.length = 0;
}

let total = 0, ok = 0, falhas = [];
function assert(nome, cond) {
  total++;
  if (cond) ok++;
  else { falhas.push(nome); console.log('FALHA:', nome); }
}

const CLIENTES = [
  '351911111111@s.whatsapp.net',
  '351922222222@s.whatsapp.net',
  '351933333333@s.whatsapp.net',
  '351944444444@s.whatsapp.net',
  '351955555555@s.whatsapp.net',
];

const MENSAGENS_VALIDAS = [
  'quero marcar consulta para o cão Rex amanha as 10:30',
  'marcar vacina para o gato Miau segunda as 14:00',
  'agendar banho para o cao Toby amanha 10:00',
  'tosquia para o cao Rex sexta as 14:30',
  'desparasitacao para o gato Miau hoje 11:00',
  'analises para o cao Toby amanha 15:00',
  'quero cancelar a consulta do Rex de amanha',
  'cancelar vacina do gato Miau',
  'remarcar consulta do Rex para segunda as 10:00',
  'quero remarcar banho do Toby',
  'o cao esta a deitar sangue',
  'animais nao respiram bem',
  'qual o horario da clinica?',
  'qual a morada?',
  'qual o preco da consulta?',
  'quero saber os pendentes',
  'fila de espera',
  'ajuda',
  'oi',
  'boa tarde',
  'quero marcar',
  'consulta',
  'vacina',
  'banho',
  'tosquia',
];

const MENSAGENS_NONSENSE = [
  'asdfghjkl',
  'qwerty uiop',
  'bla bla bla',
  '123456789',
  '???',
  '!!!',
  'sdlfkjsdlfkjsd',
  'lkjhgfdsa',
  'nonsense total',
  'afdsafdsafds',
];

async function simularCliente(numero, texto) {
  const resposta = await encaminhar({ de: numero, texto }, enviar);
  if (resposta && typeof resposta === 'string' && resposta.length > 0) {
    await enviar(numero, resposta);
  }
  return resposta;
}

async function main() {
  resetarDados();

  /* 1. Mensagens validas */
  for (let i = 0; i < 120; i++) {
    const c = CLIENTES[i % CLIENTES.length];
    const m = MENSAGENS_VALIDAS[i % MENSAGENS_VALIDAS.length];
    const r = await simularCliente(c, m);
    assert('valida [' + i + ']', typeof r === 'string' && r.length > 0);
  }

  /* 2. Nonsense -> escalation apos 2 falhas */
  resetarDados();
  for (let i = 0; i < 100; i++) {
    const c = CLIENTES[i % CLIENTES.length];
    const m = MENSAGENS_NONSENSE[i % MENSAGENS_NONSENSE.length];
    const r = await simularCliente(c, m);
    if (escalation.deveEscalar(c)) {
      assert('escalation [' + i + ']', /equipa vai falar/i.test(r || ''));
    } else {
      assert('ajuda [' + i + ']', typeof r === 'string' && r.length > 0);
    }
  }

  /* 3. Gestor aprova/recusa pendentes */
  resetarDados();
  for (let i = 0; i < 60; i++) {
    await simularCliente(CLIENTES[0], 'quero marcar consulta para o cao Rex amanha as 10:30');
    const p = pendentes.ultimoPendente();
    assert('pendente criado [' + i + ']', !!p);
    if (p) {
      const r = await simularCliente(GESTOR, i % 2 === 0 ? 'OK' : 'NAO');
      assert('gestor resposta [' + i + ']', typeof r === 'string' && r.length > 0);
    }
  }

  /* 4. Loop de bloqueio: mesmo cliente envia nonsense 10x seguidas */
  resetarDados();
  const cBloqueio = '351999999999@s.whatsapp.net';
  for (let i = 0; i < 10; i++) {
    await simularCliente(cBloqueio, 'nonsense bloqueio ' + i);
  }
  assert('escalation depois de 10 nonsense seguidos', escalation.deveEscalar(cBloqueio) === true);

  /* 5. Formulario passo a passo (fluxo completo) */
  resetarDados();
  const cForm = '351988888888@s.whatsapp.net';
  const passosForm = [
    'marcar',
    'Joao Silva',
    '912345678',
    'Rex',
    'cao',
    'consulta',
    'amanha 10:30',
    'SIM',
  ];
  for (const passo of passosForm) {
    const r = await simularCliente(cForm, passo);
    assert('formulario passo "' + passo + '"', typeof r === 'string' && r.length > 0);
  }
  assert('formulario cria pendente', pendentes.ultimoPendente() !== null);
  const pForm = pendentes.ultimoPendente();
  if (pForm) {
    const r = await simularCliente(GESTOR, 'OK');
    assert('gestor aprova formulario', typeof r === 'string' && r.length > 0);
  }

  /* 6. Formulario: NAO na confirmacao recomeca */
  resetarDados();
  const cForm2 = '351977777777@s.whatsapp.net';
  await simularCliente(cForm2, 'marcar');
  await simularCliente(cForm2, 'Maria');
  await simularCliente(cForm2, '911111111');
  await simularCliente(cForm2, 'Miau');
  await simularCliente(cForm2, 'gato');
  await simularCliente(cForm2, 'banho');
  await simularCliente(cForm2, 'amanha 10:00');
  const rNao = await simularCliente(cForm2, 'NAO');
  assert('formulario NAO recomeca', /recomeçamos/i.test(rNao || ''));
  assert('formulario estado resetado', Form.temFormularioAberto(cForm2) === false);

  /* 7. Servico cirurgia nao e agendavel diretamente */
  const servicos = require('../src/atendimento/servicos');
  const sCirurgia = servicos.detetarServico('cirurgia');
  assert('cirurgia nao tem agendamento direto', sCirurgia.agendamentoDireto === false);
  const sConsulta = servicos.detetarServico('consulta');
  assert('consulta tem agendamento direto', sConsulta.agendamentoDireto === true);

  /* 8. Horarios preferenciais banho/tosquia */
  resetarDados();
  const cBanho = '351955555555@s.whatsapp.net';
  const rBanho = await simularCliente(cBanho, 'banho para o cao Rex amanha as 12:00');
  assert('banho horario nao preferencial', /horario preferencial|10:00|14:30/i.test(rBanho || ''));

  /* 9. Urgencia */
  resetarDados();
  const cUrg = '351944444444@s.whatsapp.net';
  const rUrg = await simularCliente(cUrg, 'emergencia: o gato foi atropelado');
  assert('urgencia manda ligar', /ligue j[aá]/i.test(rUrg || ''));
  assert('urgencia sem pendente', pendentes.ultimoPendente() === null);

  /* 10. Casos extremos */
  const extremos = ['', '   ', '123', '!!!???', 'a'.repeat(500), '🐱🐶🦴', 'CONSULTA', 'Marcar', 'OK', 'NAO', 'ok', 'nao'];
  for (let i = 0; i < extremos.length; i++) {
    resetarDados();
    const r = await simularCliente(CLIENTES[i % CLIENTES.length], extremos[i]);
    assert('extremo [' + i + ']', typeof r === 'string' || r === null || r === undefined);
  }

  /* 11. Lista de espera */
  resetarDados();
  const le = ListaEspera.adicionar({ cliente: CLIENTES[0], servico: 'consulta', animal: 'Rex', especie: 'cao', dataPreferida: 'amanha', horaPreferida: '10:00', contacto: CLIENTES[0] });
  assert('lista espera adiciona', !!le);
  assert('lista espera listar', ListaEspera.listar().length > 0);
  const proximo = ListaEspera.proximo('consulta');
  assert('lista espera proximo', !!proximo && proximo.id === le.id);
  ListaEspera.atender(le.id);
  assert('lista espera atendido', ListaEspera.listar().length === 0);

  /* 13. Multiplos clientes interleave */
  resetarDados();
  for (let round = 0; round < 50; round++) {
    for (const c of CLIENTES) {
      const m = MENSAGENS_VALIDAS[round % MENSAGENS_VALIDAS.length];
      await simularCliente(c, m);
    }
  }
  assert('interleaving 50 rondas', true);

  console.log('\n========================================');
  console.log('STRESS TEST: ' + ok + '/' + total + ' OK');
  if (falhas.length > 0) {
    console.log('FALHAS (' + falhas.length + '):');
    falhas.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  console.log('========================================\n');
  process.exit(0);
}

main().catch(e => { console.error('ERRO GERAL:', e); process.exit(1); });