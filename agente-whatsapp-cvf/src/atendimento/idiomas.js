/* Suporte a múltiplos idiomas (PT-PT por defeito, EN opcional).
   Deteta idioma pelo prefixo da mensagem (/pt, /en) ou pelo locale do cliente.
   Guardado em src/dados/idiomas-clientes.json para persistir escolha. */
const fs = require('fs');
const path = require('path');

const FICHA = path.join(__dirname, '..', 'dados', 'idiomas-clientes.json');

const TEXTOS = {
  'pt-PT': {
    ajuda: 'Olá, {nome}. Quer marcar consulta? Diga: animal, motivo e dia/hora. Ou marque aqui: {link}',
    urgencia: 'É urgente. Ligue já para {tel}. Não espere aqui.',
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
    equipaFala: 'A nossa equipa vai falar consigo diretamente por aqui. Obrigado.'
  },
  'en': {
    ajuda: 'Hello, {nome}. Want to book an appointment? Say: animal, reason and day/time. Or book here: {link}',
    urgencia: 'It is urgent. Call {tel} now. Do not wait here.',
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
    equipaFala: 'Our team will talk to you directly here. Thank you.'
  }
};

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

module.exports = { detectar, guardarIdioma, t, TEXTOS, POR_DEFEITO };
