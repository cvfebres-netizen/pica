/* Suporte a múltiplos idiomas (PT-PT por defeito; EN/ES/FR opcionais).
   Deteta idioma pelo prefixo da mensagem (/pt, /en) ou pelo locale do cliente.
   Guardado em src/dados/idiomas-clientes.json para persistir escolha. */
const fs = require('fs');
const path = require('path');

const EXTRA_ES = require('./idiomas-es');
const EXTRA_FR = require('./idiomas-fr');

const FICHA = path.join(__dirname, '..', 'dados', 'idiomas-clientes.json');

const TEXTOS = {
  'pt-PT': {
    ajuda: 'Olá, {nome}. Quer marcar consulta? Diga: animal, motivo e dia/hora. Ou marque aqui: {link}',
    urgencia: '🚨 EMERGÊNCIA. Ligue já para {tel} ou desloque-se imediatamente à clínica: {morada}. Não espere.',
    sintomasLigeiros: 'Lamento que o seu animal não se esteja a sentir bem. Como sou uma inteligência artificial, não posso diagnosticar nem medicar. Para a segurança dele, precisa de ser avaliado por um veterinário. Há quantos dias o sintoma se manifesta? Posso ajudar a marcar uma consulta.',
    horario: '{horario}. Marque aqui: {link}',
    morada: '{morada}. Marque aqui: {link}',
    precos: 'Preço depende do ato. Consulta base e vacinas têm tabela na clínica. Diga o motivo que confirmo.',
    pedirDadosMarcar: 'Claro. Diga: nome do animal, motivo e dia/hora que prefere. Ou marque direto aqui: {link}',
    confirmada: 'Marcado: {resumo}. {morada}. Traga boletim. Para mudar, diga aqui.',
    recusada: 'A clínica não conseguiu esse horário. Diga outra dia/hora que tratamos.',
    falhaAgenda: 'Não consegui na agenda. Ligue {tel} que tratamos já.',
    pedidoRegistado: 'Pedido de {oQue} registado. Confirmamos já de seguida aqui.',
    formulInicio: 'Vou ajudar a marcar. Diga o seu nome:',
    formulFinal: 'Resumo da marcação:\nNome: {nome}\nTelefone: {telefone}\nAnimal: {animal} ({especie})\nServiço: {servico}\nDia/hora: {dataHora}\n\nResponda SIM para confirmar ou NÃO para recomeçar.',
    pendentes: 'Pendentes:\n{lista}\nResponda OK ou NÃO.',
    semPendentes: 'Sem pendentes.',
    listaEsperaVazia: 'Lista de espera vazia.',
    historicoVazio: 'Sem histórico de atendimentos ainda.',
    naoPercebi: 'Não percebi bem. Pode repetir com outras palavras?',
    menu: 'Olá, {nome} 👋 Sou o assistente do {nome}. Escolha uma opção: 1 - Marcar consulta | 2 - Horário e morada | 3 - Preços e serviços | 4 - Falar com a equipa. Responda com o número ou escreva o que precisa.',
    presencaPergunta: 'Olá! Lembrete: tem {resumo} na {nome}. Vem à consulta? Responda SIM para confirmar ou NÃO se não puder vir.',
    presencaOk: 'Presença confirmada. Até já! Traga o boletim do animal.',
    presencaFalta: 'Obrigado por avisar. Ficou registado que não vem. Para remarcar, diga aqui.',
    catalogoIntro: 'Serviços do {nome}:',
    semHistoricoAnimal: 'Não encontrei atendimentos para esse animal.',
    idiomaOk: 'Idioma alterado.',
    foraHorarioReal: 'Estamos fechados agora ({horario}). Registei o seu pedido e confirmamos de manhã. Urgência: ligue {tel}.',
    equipaFala: 'A nossa equipa vai falar consigo diretamente por aqui. Obrigado.'
  },
  'en': {
    ajuda: 'Hello, {nome}. Want to book an appointment? Say: animal, reason and day/time. Or book here: {link}',
    urgencia: '🚨 EMERGENCY. Call {tel} now or go immediately to the clinic: {morada}. Do not wait.',
    sintomasLigeiros: "I'm sorry your pet isn't feeling well. As an AI, I cannot diagnose or medicate. For their safety, they need to be assessed by a veterinarian. How many days has the symptom been present? Can I help you book an appointment?",
    horario: '{horario}. Book here: {link}',
    morada: '{morada}. Book here: {link}',
    precos: 'Price depends on the procedure. Base consultation and vaccines have a price list at the clinic. Tell me the reason and I will confirm.',
    pedirDadosMarcar: 'Sure. Say: animal name, reason and preferred day/time. Or book directly here: {link}',
    confirmada: 'Booked: {resumo}. {morada}. Bring the health record. To change, say it here.',
    recusada: 'The clinic could not get that slot. Tell me another day/time and we will take care of it.',
    falhaAgenda: 'I could not get it in the agenda. Call {tel} and we will take care of it.',
    pedidoRegistado: '{oQue} request registered. We confirm shortly here.',
    formulInicio: 'I will help you book. Tell me your name:',
    formulFinal: 'Booking summary:\nName: {nome}\nPhone: {telefone}\nAnimal: {animal} ({especie})\nService: {servico}\nDay/time: {dataHora}\n\nReply YES to confirm or NO to start over.',
    pendentes: 'Pending:\n{lista}\nReply OK or NO.',
    semPendentes: 'No pending requests.',
    listaEsperaVazia: 'Waiting list empty.',
    historicoVazio: 'No attendance history yet.',
    naoPercebi: 'I did not understand well. Can you repeat with other words?',
    menu: 'Hello, {nome} - I am the {nome} assistant. Choose an option: 1 - Book an appointment | 2 - Hours and address | 3 - Prices and services | 4 - Talk to the team. Reply with the number or write what you need.',
    presencaPergunta: 'Hello! Reminder: you have {resumo} at {nome}. Are you coming? Reply YES to confirm or NO if you cannot come.',
    presencaOk: 'Attendance confirmed. See you soon! Bring the animal health record.',
    presencaFalta: 'Thank you for letting us know. Recorded that you are not coming. To rebook, say it here.',
    catalogoIntro: '{nome} services:',
    semHistoricoAnimal: 'I found no appointments for that animal.',
    idiomaOk: 'Language changed.',
    foraHorarioReal: 'We are closed now ({horario}). I registered your request and we confirm in the morning. Emergency: call {tel}.',
    equipaFala: 'Our team will talk to you directly here. Thank you.'
  }
};

Object.assign(TEXTOS, EXTRA_ES, EXTRA_FR);

const POR_DEFEITO = 'pt-PT';

function lerIdiomas() {
  try {
    if (!fs.existsSync(FICHA)) return {};
    return JSON.parse(fs.readFileSync(FICHA, 'utf8'));
  } catch (e) { return {}; }
}
function guardarIdiomas(obj) { fs.writeFileSync(FICHA, JSON.stringify(obj, null, 1)); }
function chaveCliente(jid) { return String(jid).replace(/\D/g, ''); }

function detectar(texto, jid) {
  const t = (texto || '').trim();
  if (/^\/en/i.test(t)) return 'en';
  if (/^\/pt/i.test(t)) return 'pt-PT';
  if (/^\/es/i.test(t)) return 'es';
  if (/^\/fr/i.test(t)) return 'fr';
  const idiomas = lerIdiomas();
  return idiomas[chaveCliente(jid)] || POR_DEFEITO;
}

function guardarIdioma(jid, lang) {
  const idiomas = lerIdiomas();
  idiomas[chaveCliente(jid)] = lang;
  guardarIdiomas(idiomas);
}

function t(lang, chave, valores = {}) {
  const dicionario = TEXTOS[lang] || TEXTOS[POR_DEFEITO];
  let frase = dicionario[chave] || TEXTOS[POR_DEFEITO][chave] || chave;
  for (const [k, v] of Object.entries(valores)) {
    frase = frase.replace(new RegExp('\\{' + k + '\\}', 'g'), v);
  }
  return frase;
}

const SUPORTADOS = Object.keys(TEXTOS);
module.exports = { detectar, guardarIdioma, t, TEXTOS, POR_DEFEITO, SUPORTADOS };
