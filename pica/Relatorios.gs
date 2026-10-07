/* ============================================================
   RELATÓRIOS — DIÁRIO / SEMANAL / MENSAL (§57–62, §64–66, §131)
   Tudo derivado do mesmo motor calcularDia (§172–174).
   ============================================================ */

function iterarDias_(dataInicio, dataFim) {
  const dias = [];
  const d = normalizarData_(dataInicio), fim = normalizarData_(dataFim);
  /* datas invertidas ou sem sentido devolviam uma lista VAZIA: o utilizador
     via um relatorio vazio e nao percebia que tinha trocado as datas. E' um
     laco que avanca 1 dia de cada vez, portanto a unica forma de nao
     terminar e a data final estar ANTES da inicial — e' isso que se recusa. */
  if (isNaN(d.getTime()) || isNaN(fim.getTime())) throw new Error('Intervalo de datas inválido.');
  if (d.getTime() > fim.getTime()) throw new Error('Intervalo de datas inválido: a data final (' + formatarDataISO_(fim) +
    ') é anterior à inicial (' + formatarDataISO_(d) + ').');
  while (d <= fim) { dias.push(new Date(d.getTime())); d.setDate(d.getDate() + 1); }
  return dias;
}

/* Primeiro dia da semana, em numero de Date.getDay(): 0 = domingo,
   1 = segunda, ... 6 = sabado.

   Este valor vinha de Config.gs (APP.PRIMEIRO_DIA_SEMANA) mas NINGUEM o lia:
   `inicioDaSemana_` tinha a segunda-feira escrita a mao. Mudar a configuracao
   nao fazia nada e nao dava erro nenhum — o mesmo tipo de falha que uma
   variavel morta: o configuravel parecia funcionar e nao funcionava.

   Qualquer valor fora de 0..6 volta a segunda-feira, que e' o que a empresa
   usa. Valida-se porque um `undefined` aqui daria um deslocamento NaN e a
   semana comecava num dia aleatorio. */
function primeiroDiaSemana_() {
  const bruto = APP.PRIMEIRO_DIA_SEMANA;
  /* `Number(null)` e' 0 e `Number('')` e' 0: sem esta guarda, um Config.gs
     com o campo vazio ou nulo significaria DOMINGO em vez de segunda-feira.
     Um valor ausente tem de cair no padrao, nunca num dia qualquer. */
  if (bruto === null || bruto === undefined || bruto === '') return 1;
  const v = Number(bruto);
  /* Number.isFinite e nao o isFinite global: o global converte (isFinite('7')
     e' true), o que aqui daria uma segunda-feira a partir de texto. */
  return Number.isFinite(v) && v >= 0 && v <= 6 ? Math.floor(v) : 1;
}

function inicioDaSemana_(data) {
  const d = normalizarData_(data);
  /* distancia (em dias) ate ao primeiro dia da semana. Com 1 (segunda) isto
     dá (dia + 6) % 7, que e' exatamente a formula que estava aqui — por isso
     o valor por omissao nao muda nada do que ja se via. */
  const desloc = (d.getDay() - primeiroDiaSemana_() + 7) % 7;
  d.setDate(d.getDate() - desloc);
  return d;
}

/* Nome do primeiro dia, para a interface escrever "Semana (2a feira)" sem
   repetir a palavra a mao em cada filtro. */

function obterDiasTrabalhoIntervalo_(userId, dataInicio, dataFim, comExcecao) {
  return iterarDias_(dataInicio, dataFim).map(function(dia) {
    return calcularDia_(userId, dia);
  });
}

function resumirDias_(dias) {
  const t = { planeados: 0, trabalhados: 0, normais: 0, extra: 0, extraAprovados: 0, diasTrabalhados: 0, diasAusentes: 0, sabados: 0, domingos: 0, feriados: 0, ausencias: 0, excecoes: 0 };
  dias.forEach(function(r) {
    t.planeados += r.minutosPlaneados; t.trabalhados += r.minutosTrabalhados;
    t.normais += r.minutosNormais; t.extra += r.minutosExtra; t.extraAprovados += r.extraAprovado;
    t.excecoes += (r.excecoes || []).length;
    if (r.minutosTrabalhados > 0) t.diasTrabalhados++;
    if (r.ausencia) { t.diasAusentes++; t.ausencias++; }
    if (r.tipoDia === ENUMS.TIPOS_DIA.SABADO_PREVISTO || r.tipoDia === ENUMS.TIPOS_DIA.SABADO_NAO_PREVISTO) t.sabados++;
    if (r.tipoDia === ENUMS.TIPOS_DIA.DOMINGO) t.domingos++;
    if (r.tipoDia === ENUMS.TIPOS_DIA.FERIADO) t.feriados++;
  });
  return t;
}

function formatarResumo_(t) {
  return {
    horasPlaneadas: minutosParaHora_(t.planeados), horasTrabalhadas: minutosParaHora_(t.trabalhados),
    horasNormais: minutosParaHora_(t.normais), horasExtra: minutosParaHora_(t.extra),
    horasExtraAprovadas: minutosParaHora_(t.extraAprovados), diasTrabalhados: t.diasTrabalhados,
    diasAusentes: t.diasAusentes, sabados: t.sabados, domingos: t.domingos,
    feriados: t.feriados, ausencias: t.ausencias, excecoes: t.excecoes
  };
}

function resolverUtilizadoresRelatorio_(s, userId) {
  if (s.perfil === ENUMS.PERFIS.ADMIN) {
    return userId ? [obterUtilizadorPorId_(userId)].filter(function(u) { return !!u; }) : obterUtilizadoresAtivos_();
  }
  if (userId && String(userId) !== String(s.userId)) throw new Error('Sem autorização.');
  return [obterUtilizadorPorId_(s.userId)];
}

function consultaDiaria(token, data, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const d = normalizarData_(data || new Date());
  const utilizadores = resolverUtilizadoresRelatorio_(s, f.userId);
  let linhas = utilizadores.map(function(u) {
    const r = calcularDia_(u.ID, d);
    return { userId: u.ID, nome: u.Nome, profissao: u.Profissao, data: r.data, diaSemana: obterNomeDiaSemana_(d), tipoDia: r.tipoDia, previsto: r.horasPlaneadas, realizado: r.horasTrabalhadas, normal: r.horasNormais, extra: r.horasExtra, extraAprovada: r.horasExtraAprovadas, estado: r.estado, excecoes: r.excecoes.map(function(e) { return e.tipo; }) };
  });
  if (f.tipoDia) linhas = linhas.filter(function(l) { return l.tipoDia === String(f.tipoDia); });
  if (f.estado) linhas = linhas.filter(function(l) { return l.estado === String(f.estado); });
  if (f.comExtra) linhas = linhas.filter(function(l) { return l.extra !== '00:00'; });
  if (f.comExcecoes) linhas = linhas.filter(function(l) { return l.excecoes.length > 0; });
  return serializarParaFrontend_({ sucesso: true, data: formatarDataISO_(d), linhas: linhas, total: linhas.length });
}

function relatorioIndividual(token, userId, dataInicio, dataFim) {
  const s = exigirSessao_(token);
  const alvo = (s.perfil === ENUMS.PERFIS.ADMIN && userId) ? String(userId) : String(s.userId);
  const user = obterUtilizadorPorId_(alvo);
  if (!user) throw new Error('Utilizador não encontrado: ' + alvo);
  const fim = dataFim ? normalizarData_(dataFim) : normalizarData_(new Date());
  const inicio = dataInicio ? normalizarData_(dataInicio) : inicioDaSemana_(fim);
  validarIntervaloDatas_(inicio, fim);
  const dias = obterDiasTrabalhoIntervalo_(alvo, inicio, fim);
  const linhas = dias.map(function(r) {
    return { data: r.data, diaSemana: obterNomeDiaSemana_(r.data), tipoDia: r.tipoDia, previsto: r.horasPlaneadas, realizado: r.horasTrabalhadas, normal: r.horasNormais, extra: r.horasExtra, extraAprovada: r.horasExtraAprovadas, estado: r.estado, excecoes: r.excecoes.map(function(e) { return e.tipo; }), mencaoCorrecao: r.mencaoCorrecao };
  });
  /* Quantos dias do período têm pedido de correção por decidir. Sem este
     número no topo, quem abre o relatório tem de os caçar linha a linha. */
  const pedidosEmAberto = dias.filter(function (r) { return r.mencaoCorrecao && r.mencaoCorrecao.estado === 'PEDIDO'; }).length;
  const totais = formatarResumo_(resumirDias_(dias));
  totais.correcoesPedidas = pedidosEmAberto;
  return serializarParaFrontend_({ sucesso: true, utilizador: { id: user.ID, nome: user.Nome, profissao: user.Profissao, perfil: user.Perfil }, periodo: { inicio: formatarDataISO_(inicio), fim: formatarDataISO_(fim) }, linhas: linhas, totais: totais, correcoesPedidas: pedidosEmAberto });
}

/* ============================================================
   EXCEDENTE — TOTAL, DIAS E HORAS EXTRAORDINÁRIAS
   ============================================================
   Duas coisas diferentes, que nao se podem baralhar:

   1. EXCEDENTE DIÁRIO — no dia em que se trabalhou mais do que o horario
      do dia (7h30 num dia util). E' o "houve pressa nesse dia".

   2. EXCEDENTE SEMANAL — o que a semana passa das 40h de contrato. Sao as
      HORAS EXTRAORDINÁRIAS, e sao as que entram no BANCO DE HORAS: nao se
      contam como extra do dia, entram no saldo.

   O excedente semanal nao se mede contra `minutosPlaneados`: esse da
   7h30 x 5 = 37h30, e uma semana normal daria sempre 37h30 de "excedente".
   Mede-se contra APP.HORAS_CONTRATO_SEMANA (as 40h do contrato). */
function minutosContratoSemana_() {
  const h = Number(APP.HORAS_CONTRATO_SEMANA);
  /* Number.isFinite, e nao o isFinite global: o global converte, e um valor
     em texto passaria a ser aceite como numero de horas. */
  return (Number.isFinite(h) && h > 0) ? Math.round(h * 60) : 2400; /* 40h por omissao */
}

function resumirExcedenteSemanal_(dias, totais) {
  const contrato = minutosContratoSemana_();
  const trabalhado = totais && typeof totais.trabalhados === 'number' ? totais.trabalhados : 0;

  /* Os dias que GERARAM o excedente, por ordem cronologica. */
  const diasExcedente = [];
  let extraDiario = 0;
  dias.forEach(function (r) {
    const planeado = Number(r.minutosPlaneados) || 0;
    const feito = Number(r.minutosTrabalhados) || 0;
    const extraMotor = Number(r.minutosExtra) || 0;
    /* O que passou do horario do dia. Usa o motor quando ele diz alguma
       coisa; se nao apanhou (ex.: horario normal vazio), cai na diferenca
       direta para o dia nao se perder. */
    const acima = Math.max(extraMotor, feito - planeado, 0);
    extraDiario += acima;
    if (acima <= 0) return;
    diasExcedente.push({
      data: r.data,
      diaSemana: obterNomeDiaSemana_(r.data),
      tipoDia: r.tipoDia,
      minutosPlaneados: planeado,
      minutosTrabalhados: feito,
      minutosExcedente: acima,
      horasExcedente: minutosParaHora_(acima)
    });
  });

  /* Excedente SEMANAL: o que passou das 40h. Nunca negativo — quem faz
     menos que o contrato esta em dia, nao "a dever". */
  const excedenteSemanal = Math.max(0, trabalhado - contrato);
  return {
    horasContrato: minutosParaHora_(contrato),
    horasTrabalhadas: minutosParaHora_(trabalhado),
    excedenteHoras: minutosParaHora_(excedenteSemanal),
    excedenteMinutos: excedenteSemanal,
    /* o que da para colocar no BANCO DE HORAS */
    horasExtraordinarias: minutosParaHora_(excedenteSemanal),
    excedenteDiarioHoras: minutosParaHora_(extraDiario),
    diasExcedente: diasExcedente,
    diasComExcedente: diasExcedente.length
  };
}

function consultaSemanal(token, semanaInicio, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const inicio = semanaInicio ? inicioDaSemana_(semanaInicio) : inicioDaSemana_(new Date());
  const fim = new Date(inicio.getTime()); fim.setDate(fim.getDate() + 6);
  const utilizadores = resolverUtilizadoresRelatorio_(s, f.userId);
  const linhas = utilizadores.map(function(u) {
    const dias = obterDiasTrabalhoIntervalo_(u.ID, inicio, fim);
    const t = resumirDias_(dias);
    const porDia = {};
    dias.forEach(function(r) { porDia[r.data] = { normal: r.horasNormais, extra: r.horasExtra, estado: r.estado }; });
    const excedente = resumirExcedenteSemanal_(dias, t);
    return Object.assign({ userId: u.ID, nome: u.Nome, profissao: u.Profissao }, formatarResumo_(t), { dias: porDia, excedente: excedente });
  });
  return serializarParaFrontend_({
    sucesso: true, semanaInicio: formatarDataISO_(inicio), semanaFim: formatarDataISO_(fim),
    horasContrato: APP.HORAS_CONTRATO_SEMANA,
    linhas: linhas, total: linhas.length
  });
}

function consultaMensal(token, mes, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const base = mes && /^\d{4}-\d{2}$/.test(String(mes)) ? String(mes) : Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM');
  const ano = Number(base.substring(0, 4)), mm = Number(base.substring(5, 7));
  const inicio = new Date(ano, mm - 1, 1), fim = new Date(ano, mm, 0);
  const utilizadores = resolverUtilizadoresRelatorio_(s, f.userId);
  const linhas = utilizadores.map(function(u) {
    const dias = obterDiasTrabalhoIntervalo_(u.ID, inicio, fim);
    return Object.assign({ userId: u.ID, nome: u.Nome, profissao: u.Profissao }, formatarResumo_(resumirDias_(dias)));
  });
  return serializarParaFrontend_({ sucesso: true, mes: base, linhas: linhas, total: linhas.length });
}

function relatorioGlobal(token, dataInicio, dataFim, filtros) {
  const s = exigirSessao_(token), f = filtros || {};
  const fim = dataFim ? normalizarData_(dataFim) : normalizarData_(new Date());
  const inicio = dataInicio ? normalizarData_(dataInicio) : inicioDaSemana_(fim);
  validarIntervaloDatas_(inicio, fim);
  const utilizadores = resolverUtilizadoresRelatorio_(s, f.userId);
  const linhas = utilizadores.map(function(u) {
    const dias = obterDiasTrabalhoIntervalo_(u.ID, inicio, fim);
    return Object.assign({ userId: u.ID, nome: u.Nome, profissao: u.Profissao }, formatarResumo_(resumirDias_(dias)));
  });
  return serializarParaFrontend_({ sucesso: true, periodo: { inicio: formatarDataISO_(inicio), fim: formatarDataISO_(fim) }, linhas: linhas, total: linhas.length });
}

function relatorioExtras(token, dataInicio, dataFim, filtros) {
  exigirSessao_(token);
  const lista = listarHorasExtraInterno_(token, Object.assign({}, filtros || {}, { dataInicio: dataInicio ? formatarDataISO_(normalizarData_(dataInicio)) : undefined, dataFim: dataFim ? formatarDataISO_(normalizarData_(dataFim)) : undefined }));
  return serializarParaFrontend_({ sucesso: true, linhas: lista, total: lista.length, totalMinutos: lista.reduce(function(t, x) { return t + (Number(x.minutos) || 0); }, 0) });
}

function relatorioIntegridade(token, dataInicio, dataFim, filtros) {
  const s = exigirAdmin_(token), f = filtros || {};
  const fim = dataFim ? normalizarData_(dataFim) : normalizarData_(new Date());
  const inicio = dataInicio ? normalizarData_(dataInicio) : inicioDaSemana_(fim);
  validarIntervaloDatas_(inicio, fim);
  const alvo = f.userId ? String(f.userId) : null;
  const utilizadores = alvo ? [obterUtilizadorPorId_(alvo)].filter(function(u) { return !!u; }) : obterUtilizadoresAtivos_();
  const diasIncompletos = [], sequenciasInvalidas = [], faltasPicagem = [];
  utilizadores.forEach(function(u) {
    iterarDias_(inicio, fim).forEach(function(dia) {
      const r = calcularDia_(u.ID, dia);
      if (r.estado === 'INCOMPLETO') diasIncompletos.push({ userId: u.ID, nome: u.Nome, data: r.data, excecoes: r.excecoes.map(function(e) { return e.tipo; }) });
      if (!r.validacaoPicagens.valido) sequenciasInvalidas.push({ userId: u.ID, nome: u.Nome, data: r.data, problemas: r.validacaoPicagens.problemas });
      if (r.minutosPlaneados > 0 && !r.picagens.length) faltasPicagem.push({ userId: u.ID, nome: u.Nome, data: r.data, tipoDia: r.tipoDia });
    });
  });
  const excecoes = listarExcecoes(token, { dataInicio: formatarDataISO_(inicio), dataFim: formatarDataISO_(fim), userId: alvo || undefined });
  return serializarParaFrontend_({ sucesso: true, periodo: { inicio: formatarDataISO_(inicio), fim: formatarDataISO_(fim) }, diasIncompletos: diasIncompletos, sequenciasInvalidas: sequenciasInvalidas, faltasPicagem: faltasPicagem, excecoes: excecoes.excecoes });
}

function meuRelatorio(token, dataInicio, dataFim) {
  const s = exigirSessao_(token);
  return relatorioIndividual(token, s.userId, dataInicio, dataFim);
}

function minhaSemana(token, semanaInicio) {
  const s = exigirSessao_(token);
  return consultaSemanal(token, semanaInicio, { userId: s.userId });
}

function meuMes(token, mes) {
  const s = exigirSessao_(token);
  return consultaMensal(token, mes, { userId: s.userId });
}

/* ============================================================
   EXPORTAÇÃO (Excel / Google Sheets)
   Cria uma folha nova com os dados da tabela visível no Painel.
   Sem scopes extra: usa SpreadsheetApp.create (scope spreadsheets).
   No Sheets: Ficheiro → Transferir → Microsoft Excel (.xlsx) ou PDF.
   ============================================================ */

const LIMITE_LINHAS_EXPORT = 5000;

function exportarTabelaParaSheets(token, dados) {
  const s = exigirSessao_(token), d = dados || {};

  const cabecalhos = (d.cabecalhos || []).map(function(h) { return String(h); });
  if (!cabecalhos.length) throw new Error('Nada para exportar (sem colunas).');

  const linhas = (d.linhas || []).slice(0, LIMITE_LINHAS_EXPORT).map(function(l) {
    const origem = Array.isArray(l) ? l : [];
    return cabecalhos.map(function(_, i) {
      const v = origem[i];
      return v === undefined || v === null ? '' : String(v);
    });
  });

  const titulo = String(d.titulo || 'Exportação').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60).trim() || 'Exportação';
  const nome = APP.EMPRESA + ' — ' + titulo + ' — ' + formatarDataISO_(new Date());

  const ss = SpreadsheetApp.create(nome);
  const sheet = ss.getSheets()[0];
  const totalLinhas = linhas.length + 1;

  if (totalLinhas > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), totalLinhas - sheet.getMaxRows());
  if (cabecalhos.length > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), cabecalhos.length - sheet.getMaxColumns());

  sheet.getRange(1, 1, totalLinhas, cabecalhos.length).setValues([cabecalhos].concat(linhas));
  sheet.getRange(1, 1, 1, cabecalhos.length).setFontWeight('bold');
  try { sheet.setFrozenRows(1); } catch (e) {}

  registarAuditoriaSegura_(s, 'EXPORTAR_TABELA', nome + ' (' + linhas.length + ' linhas)');
  return { sucesso: true, nome: nome, url: ss.getUrl(), linhas: linhas.length };
}

