/* ============================================================
   SÁBADOS / FERIADOS / AUSÊNCIAS
   ============================================================ */

/* Ordem de rotação de um grupo. Um JSON invalido aqui nao e' um detalhe
   cosmetico: com `ordem = []` o grupo deixa de rodar em silencio e TODOS os
   sabados passam a contar como SABADO_NAO_PREVISTO — as horas que deviam ser
   normais aparecem como extra, sem uma palavra no painel. O `catch (e) {}`
   engolia o erro e devolvia exactamente esse resultado.

   Por isso o JSON corrompido e' RECUSADO com uma mensagem que diz o que
   fazer. Uma celula vazia (ou ausente) continua a ser um grupo sem gente, que
   e' um estado legitimo — so o texto que existe e nao parseia e' erro. */
function lerOrdemRotacao_(valor, grupoId) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto || texto === '[]') return [];
  try {
    const parsed = JSON.parse(texto);
    if (!Array.isArray(parsed)) throw new Error('a ordem não é uma lista');
    return parsed.map(function(u) { return String(u); });
  } catch (e) {
    throw new Error('Rotação de sábado "' + grupoId + '" está corrompida: a coluna OrdemUserIDs não é uma lista válida. Corrija-a na folha CONFIG_SABADOS (' + e.message + ').');
  }
}

function obterConfiguracaoGrupoSabado_(grupoId) {
  const f = dadosFolha_(SHEETS.CONFIG_SABADOS);
  if (!f.sheet || f.valores.length < 2) return null;
  const dados = f.valores;
  const mapa = f.mapa;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][mapa.GrupoID] || '') === String(grupoId)) {
      return {
        grupoId: String(dados[i][mapa.GrupoID]),
        descricao: String(dados[i][mapa.Descricao] || ''),
        ordem: lerOrdemRotacao_(dados[i][mapa.OrdemUserIDs], dados[i][mapa.GrupoID]),
        dataInicio: valorDataISO_(dados[i][mapa.DataInicio]),
        ativo: String(dados[i][mapa.Ativo]) !== 'false'
      };
    }
  }
  return null;
}

function obterGruposSabado_() {
  const f = dadosFolha_(SHEETS.CONFIG_SABADOS);
  if (!f.sheet || f.valores.length < 2) return [];
  const dados = f.valores;
  const mapa = f.mapa;
  return dados.slice(1).filter(function(l) { return l[mapa.GrupoID]; }).map(function(l) {
    return { grupoId: String(l[mapa.GrupoID]), descricao: String(l[mapa.Descricao] || ''), ordem: lerOrdemRotacao_(l[mapa.OrdemUserIDs], l[mapa.GrupoID]), dataInicio: valorDataISO_(l[mapa.DataInicio]), ativo: String(l[mapa.Ativo]) !== 'false' };
  });
}

function obterGrupoSabadoDoUtilizador_(userId) {
  return obterGruposSabado_().find(function(g) { return g.ordem.indexOf(String(userId)) !== -1; }) || null;
}

/* A rotação tem de estar ancorada num sábado. Com a âncora noutro dia da
   semana, o primeiro sábado caía fora da rotação: a contagem só começava no
   sábado SEGUINTE e esse dia ficava sem ninguém — o collaborator que o gestor
   viu no ecrã "previsto para" simplesmente não trabalhava. */
function alancarPrimeiroSabado_(data) {
  const d = normalizarData_(data);
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return d;
}

/* Normaliza a data de início de um grupo para um sábado, em ISO. */
function ajustarDataInicioRotacao_(data) {
  return formatarDataISO_(alancarPrimeiroSabado_(data));
}

/* Índice do dia em UTC. As contas de semanas têm de ser imunes à hora de
   verão: entre duas datas locais a diferença em ms é 6d23h ou 7d1h conforme
   o calendário, e o dia UTC é sempre exacto. */
function numeroDiaUtc_(data) {
  const d = normalizarData_(data);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

/* Quantos sábados passaram desde a âncora. A versão anterior avançava 7 em
   7 dias num ciclo — 600 voltas para uma âncora de 2015, dentro de um cálculo
   feito por TODOS os utilizadores, todos os dias. Agora é uma subtração. */
function calcularNumeroSabados_(dataInicio, dataAtual) {
  const inicio = alancarPrimeiroSabado_(dataInicio);
  const atual = alancarPrimeiroSabado_(dataAtual);
  if (atual < inicio) return -1;
  return Math.round((numeroDiaUtc_(atual) - numeroDiaUtc_(inicio)) / 7);
}

function calcularMembroRotacaoSabado_(grupoId, dataSabado) {
  const grupo = obterConfiguracaoGrupoSabado_(grupoId);
  if (!grupo || !grupo.ativo || !grupo.ordem.length || !grupo.dataInicio) return null;
  const numero = calcularNumeroSabados_(grupo.dataInicio, dataSabado);
  if (numero < 0) return null;
  return grupo.ordem[numero % grupo.ordem.length];
}

function verificarSabadoPrevisto_(userId, data) {
  if (!isSabado_(data)) return false;
  const grupo = obterGrupoSabadoDoUtilizador_(userId);
  if (!grupo) return false;
  return calcularMembroRotacaoSabado_(grupo.grupoId, data) === String(userId);
}

function obterInformacaoSabado_(userId, data) {
  const grupo = obterGrupoSabadoDoUtilizador_(userId);
  return { ehSabado: isSabado_(data), previsto: verificarSabadoPrevisto_(userId, data), grupoId: grupo ? grupo.grupoId : '', membro: grupo ? calcularMembroRotacaoSabado_(grupo.grupoId, data) : null };
}

function obterRotacaoSabadoParaData_(data) {
  if (!isSabado_(data)) return [];
  return obterGruposSabado_().map(function(g) { return { grupoId: g.grupoId, descricao: g.descricao, userId: calcularMembroRotacaoSabado_(g.grupoId, data) }; });
}

function validarConfiguracaoSabados_() {
  return obterGruposSabado_().map(function(g) {
    return { grupoId: g.grupoId, valido: !!g.ordem.length && !!g.dataInicio, dataInicio: g.dataInicio || '' };
  });
}

function obterFeriadoPorData_(data) {
  const f = dadosFolha_(SHEETS.FERIADOS);
  if (!f.sheet || f.valores.length < 2) return null;
  const iso = formatarDataISO_(data);
  const dados = f.valores;
  const mapa = f.mapa;
  for (let i = 1; i < dados.length; i++) {
    if (valorDataISO_(dados[i][mapa.Data]) === iso && String(dados[i][mapa.Ativo]) !== 'false') return { id: dados[i][mapa.ID], data: iso, descricao: dados[i][mapa.Descricao] };
  }
  return null;
}

function obterAusenciaPorData_(userId, data) {
  const f = dadosFolha_(SHEETS.AUSENCIAS);
  if (!f.sheet || f.valores.length < 2) return null;
  const d = normalizarData_(data);
  const dados = f.valores;
  const mapa = f.mapa;
  for (let i = 1; i < dados.length; i++) {
    if (String(dados[i][mapa.UserID]) !== String(userId)) continue;
    if (String(dados[i][mapa.Estado] || '') === 'CANCELADA') continue;
    const inicio = normalizarData_(dados[i][mapa.DataInicio]);
    const fim = normalizarData_(dados[i][mapa.DataFim]);
    if (d >= inicio && d <= fim) return { id: dados[i][mapa.ID], tipo: dados[i][mapa.Tipo], estado: dados[i][mapa.Estado], motivo: dados[i][mapa.Motivo] };
  }
  return null;
}

function determinarTipoDia_(userId, data) {
  const ausencia = obterAusenciaPorData_(userId, data);
  if (ausencia) {
    if (String(ausencia.Tipo).toUpperCase() === 'FERIAS') return ENUMS.TIPOS_DIA.FERIAS;
    if (String(ausencia.Tipo).toUpperCase() === 'JUSTIFICADA') return ENUMS.TIPOS_DIA.AUSENCIA_JUSTIFICADA;
    return ENUMS.TIPOS_DIA.AUSENCIA_NAO_JUSTIFICADA;
  }
  if (obterFeriadoPorData_(data)) return ENUMS.TIPOS_DIA.FERIADO;
  if (isDomingo_(data)) return ENUMS.TIPOS_DIA.DOMINGO;
  if (isSabado_(data)) return verificarSabadoPrevisto_(userId, data) ? ENUMS.TIPOS_DIA.SABADO_PREVISTO : ENUMS.TIPOS_DIA.SABADO_NAO_PREVISTO;
  return ENUMS.TIPOS_DIA.UTIL;
}

function obterHorarioNormal_(tipoDia) {
  if (tipoDia === ENUMS.TIPOS_DIA.UTIL) return APP.HORARIO.SEMANA.slice();
  if (tipoDia === ENUMS.TIPOS_DIA.SABADO_PREVISTO) return APP.HORARIO.SABADO.slice();
  return [];
}

