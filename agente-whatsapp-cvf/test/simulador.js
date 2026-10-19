/* Simulador: testa fluxo COM APROVAÇÃO sem WhatsApp nem Google.
   1. Cliente pede → PENDENTE + aviso ao gestor
   2. Gestor diz OK → grava (aqui simulado) + confirma ao cliente */
process.env.NUMERO_GESTOR = '351900000000';
process.env.HORARIO_VERIFICAR = '0';
const path = require('path');
const { encaminhar } = require('../src/atendimento/roteador');
const pendentes = require('../src/atendimento/pendentes');
const R = require('../src/atendimento/respostas');

const GESTOR = '351900000000@s.whatsapp.net';
const CLIENTE = '351911111111@s.whatsapp.net';
const enviados = [];
const enviar = async (para, texto) => { enviados.push({ para, texto }); };

(async () => {
  let ok = 0, total = 0;
  const t = async (nome, cond) => { total++; if (cond) ok++; else console.log('FALHOU:', nome); };

  // 1. Cliente pede marcação → pendente, nada gravado ainda
  const r1 = await encaminhar({ de: CLIENTE, texto: 'quero marcar consulta para o cão Rex amanhã às 10:30' }, enviar);
  await t('cliente recebe pedido registado', /registado/i.test(r1));
  await t('gestor avisado', enviados.some((e) => /NOVO PEDIDO|Novo pedido/i.test(e.texto)));
  await t('há 1 pendente', pendentes.resumo().includes('marcar'));

  // 2. Gestor diz OK → executa (falha agenda sem token, mas fluxo correto)
  const r2 = await encaminhar({ de: GESTOR, texto: 'OK' }, enviar);
  await t('gestor recebe resposta', typeof r2 === 'string' && r2.length > 0);
  await t('fila limpa', pendentes.resumo() === 'Sem pendentes.');

  // 3. Novo pedido + gestor diz NÃO → cliente avisado de recusa
  await encaminhar({ de: CLIENTE, texto: 'quero cancelar a consulta do Rex de amanhã' }, enviar);
  const r3 = await encaminhar({ de: GESTOR, texto: 'NÃO' }, enviar);
  await t('recusa avisa cliente', enviados.some((e) => /não conseguiu/i.test(e.texto)));
  await t('gestor recebe confirmação', /Recusado/i.test(r3));

  // 4. Urgência passa à frente, sem pendente
  const r4 = await encaminhar({ de: CLIENTE, texto: 'o cão está a deitar sangue' }, enviar);
  await t('urgência manda ligar', /Ligue já/i.test(r4));

  // 5. Link de agendamento presente nas respostas
  await t('link no ajuda', R.ajuda().includes('calendar.app.google'));

  // 6. Escalation: 2 mensagens não percebidas → avisa gestor
  const fs = require('fs');
  const escFicha = path.join(__dirname, '..', 'src', 'dados', 'escalation.json');
  try { fs.unlinkSync(escFicha); } catch (e) {}
  await encaminhar({ de: CLIENTE, texto: 'asdfghjkl nonsense' }, enviar);
  const rEsc = await encaminhar({ de: CLIENTE, texto: 'qwerty outro nonsense' }, enviar);
  await t('escalation avisa gestor', enviados.some((e) => /Escalation/i.test(e.texto)));
  await t('cliente avido que equipa fala', /equipa vai falar/i.test(rEsc));

  console.log('\nSIMULADOR APROVAÇÃO: ' + ok + '/' + total + ' OK');
  process.exit(ok === total ? 0 : 1);
})();


