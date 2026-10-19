/* Respostas curtas PT-PT (e EN opcional), sem rodeios. Máx. 2 mensagens curtas.
   Agora com suporte a idiomas via src/atendimento/idiomas.js. */
const Idiomas = require('./idiomas');
const NOME = () => process.env.NOME_CLINICA || 'a clínica';
const TEL = () => process.env.TELEFONE_CLINICA || 'a clínica';
const MORADA = () => process.env.MORADA_CLINICA || 'a morada no perfil';
const HORARIO = () => process.env.HORARIO_CLINICA || 'Seg-Sex 10:00-13:00 e 14:30-19:00';
const LINK = () => process.env.LINK_AGENDAMENTO || 'https://calendar.app.google/6ZPswU6ftN2VKuUC9';

function valoresBase() {
  return {
    nome: NOME(),
    tel: TEL(),
    morada: MORADA(),
    horario: HORARIO(),
    link: LINK()
  };
}

module.exports = {
  ajuda: (lang) => Idiomas.t(lang, 'ajuda', valoresBase()),
  urgencia: (lang) => Idiomas.t(lang, 'urgencia', valoresBase()),
  sintomasLigeiros: (lang) => Idiomas.t(lang, 'sintomasLigeiros', valoresBase()),
  equipaFala: (lang) => Idiomas.t(lang, 'equipaFala', valoresBase()),
  horario: (lang) => Idiomas.t(lang, 'horario', valoresBase()),
  morada: (lang) => Idiomas.t(lang, 'morada', valoresBase()),
  precos: (lang) => Idiomas.t(lang, 'precos', valoresBase()),
  pedirDadosMarcar: (lang) => Idiomas.t(lang, 'pedirDadosMarcar', valoresBase()),
  confirmada: (ev, lang) => Idiomas.t(lang, 'confirmada', Object.assign({}, valoresBase(), { resumo: ev.resumo })),
  remarcada: (ev, lang) => 'Alterado: ' + ev.resumo + '. Para mudar de novo, diga aqui.',
  cancelada: (ev, lang) => 'Cancelado: ' + (ev.resumo || 'a sua consulta') + '. Para marcar de novo, diga aqui.',
  falhaAgenda: (lang) => Idiomas.t(lang, 'falhaAgenda', valoresBase()),
  pedidoRegistado: (oQue, lang) => Idiomas.t(lang, 'pedidoRegistado', Object.assign({}, valoresBase(), { oQue })),
  pedidoProvisorio: (ev) => 'Pré-marcado: ' + ev.resumo + '. Falta só a confirmação da clínica, avisamos já aqui.',
  avisoGestor: (p) => 'Novo pedido ' + p.tipo.toUpperCase() + ' ' + p.id + ': '
    + (p.dados ? (p.dados.animal + ' — ' + p.dados.dia + ' ' + p.dados.hora + ' — ' + p.dados.motivo + ' [' + (p.dados.servico || 'consulta') + ']') : p.texto)
    + ' | Cliente: ' + p.cliente + '. Responda OK ou NÃO.',
  recusada: (lang) => Idiomas.t(lang, 'recusada', valoresBase()),
  foraHorario: () => 'Estamos fechados. Registei o pedido, confirmamos de manhã. Urgência: ligue ' + TEL() + '.',
  contactoDireto: (servico) => 'Para ' + servico + ' contacte diretamente a clínica por chamada. Não se agenda aqui.',
  horarioPreferencial: (servico) => 'Para ' + servico + ' os horários preferenciais são início da manhã (10:00) ou início da tarde (14:30). Diga outro horário.',
  // Formulário passo a passo
  formularioInicio: (lang) => Idiomas.t(lang, 'formulInicio', valoresBase()),
  formularioFinal: (d, lang) => Idiomas.t(lang, 'formulFinal', Object.assign({}, valoresBase(), d)),
  // Histórico
  historicoVazio: (lang) => Idiomas.t(lang, 'historicoVazio', valoresBase()),
  historicoLista: (entradas, lang) => 'Últimos atendimentos:\n' + entradas.map((e) =>
    '• ' + e.dataHora.slice(0, 16) + ' — ' + e.servico + ' — ' + e.animal + ' (' + e.estado + ')'
  ).join('\n'),
  // Lista de espera
  listaEsperaAdicionada: (servico, lang) => 'Ficou na lista de espera para ' + servico + '. Avisamos quando houver vaga.',
  listaEsperaVazia: (lang) => Idiomas.t(lang, 'listaEsperaVazia', valoresBase()),
  listaEsperaLista: (entradas) => 'Lista de espera:\n' + entradas.map((e) =>
    '• ' + e.servico + ' — ' + e.animal + ' — prefere ' + e.dataPreferida + ' ' + e.horaPreferida
  ).join('\n')
};
