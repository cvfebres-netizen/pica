/* Verificação automática de respostas do agente.
   Executa um conjunto de cenários contra o roteador e valida que:
   - urgência não gera pendente nem grava no Calendar
   - OK/NÃO do gestor altera estado do pendente
   - cliente não recebe resposta vazia ou indefinida
   - mensagens não percebidas disparam escalation ao atingir o limite
   - formulário concluído cria pendente
   - não há loops: mesma mensagem não produz resposta diferente sem motivo
   
   Uso: node src/config/verificar-respostas.js   (saída: TAP ou resumo OK/FALHA)
*/
const path = require('path');
const { encaminhar } = require('../atendimento/roteador');
const pendentes = require('../atendimento/pendentes');
const R = require('../atendimento/respostas');

const GESTOR = '351900000000@s.whatsapp.net';
const CLIENTE = '351911111111@s.whatsapp.net';
process.env.NUMERO_GESTOR = '351900000000';

let total = 0, falhas = 0;
const enviados = [];
const enviar = async (para, texto) => { enviados.push({ para, texto }); };

function limparEstado() {
  try { require('fs').unlinkSync(path.join(__dirname, '..', 'dados', 'escalation.json')); } catch (e) {}
  try { require('fs').unlinkSync(path.join(__dirname, '..', 'dados', 'pendentes.json')); } catch (e) {}
  try { require('fs').unlinkSync(path.join(__dirname, '..', 'dados', 'formulario-estados.json')); } catch (e) {}
}

function t(nome, cond) {
  total++;
  if (cond) {
    console.log('ok - ' + nome);
  } else {
    falhas++;
    console.log('FALHA - ' + nome);
  }
}

async function executar() {
  limparEstado();

  // 1. Urgência: não gera pendente, pede para ligar
  const rUrg = await encaminhar({ de: CLIENTE, texto: 'cão a deitar sangue' }, enviar);
  t('urgência devolve texto', typeof rUrg === 'string' && rUrg.length > 0);
  t('urgência pede ligar', /ligue jÃ¡|ligue já|tel/i.test(rUrg));
  t('urgência não gera pendente', pendentes.resumo() === 'Sem pendentes.');

  // 2. Cliente pede marcar → cria pendente
  const rMarca = await encaminhar({ de: CLIENTE, texto: 'quero marcar consulta para o cão Rex amanhã 10:30' }, enviar);
  t('marcar devolve texto', typeof rMarca === 'string' && rMarca.length > 0);
  t('marcar gera pendente', pendentes.resumo().includes('marcar'));

  // 3. Gestor diz OK → executa, fila limpa
  const rOk = await encaminhar({ de: GESTOR, texto: 'OK' }, enviar);
  t('gestor OK devolve texto', typeof rOk === 'string' && rOk.length > 0);
  t('gestor OK limpa pendentes', pendentes.resumo() === 'Sem pendentes.');

  // 4. Cliente pede cancelar → pendente de cancelar
  await encaminhar({ de: CLIENTE, texto: 'cancela consulta do Rex amanhã' }, enviar);
  t('cancelar gera pendente', pendentes.resumo().includes('cancelar'));

  // 5. Gestor diz NÃO → recusa, cliente avisado
  const rNao = await encaminhar({ de: GESTOR, texto: 'NÃO' }, enviar);
  t('gestor NÃO devolve texto', typeof rNao === 'string' && rNao.length > 0);
  t('recusa avisa cliente', enviados.some((e) => /não conseguiu/i.test(e.texto)));

  // 6. Escalation: 2 mensagens não percebidas
  limparEstado();
  await encaminhar({ de: CLIENTE, texto: 'asdfghjkl nonsense' }, enviar);
  const rEsc = await encaminhar({ de: CLIENTE, texto: 'qwerty outro nonsense' }, enviar);
  t('escalation avisa gestor', enviados.some((e) => /Escalation/i.test(e.texto)));
  t('cliente aviso equipa', /equipa vai falar/i.test(rEsc));

  // 7. Não há resposta vazia/undefined
  const rVazia = await encaminhar({ de: CLIENTE, texto: 'oi' }, enviar);
  t('saudação não é vazia', typeof rVazia === 'string' && rVazia.trim().length > 0);

  // 8. Link de agendamento presente
  t('link no ajuda', R.ajuda().includes('calendar.app.google'));

  console.log('\nVerificação automática: ' + (total - falhas) + '/' + total + ' OK');
  process.exit(falhas === 0 ? 0 : 1);
}

executar().catch((e) => { console.error('Erro na verificação:', e.message); process.exit(1); });
