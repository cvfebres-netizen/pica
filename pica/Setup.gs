/* ============================================================
   SETUP / ESTRUTURA
   ============================================================ */

function criarEstruturaFolhas_() {
  Object.keys(HEADERS).forEach(function(nome) {
    const sheet = getOrCreateSheet_(nome);
    garantirCabecalhos_(sheet, HEADERS[nome]);
    formatarCabecalho_(sheet);
  });
}

function inicializarConfig_() {
  const sheet = getOrCreateSheet_(SHEETS.CONFIG);
  const mapa = obterMapaColunas_(sheet);
  const base = [
    ['APP_NOME', APP.NOME, 'Nome da aplicação'],
    ['EMPRESA', APP.EMPRESA, 'Empresa'],
    ['VERSAO', APP.VERSAO, 'Versão'],
    ['TIMEZONE', APP.TIMEZONE, 'Fuso horário'],
    ['HORARIO_SEMANA', JSON.stringify(APP.HORARIO.SEMANA), 'Horário fixo segunda a sexta'],
    ['HORARIO_SABADO', JSON.stringify(APP.HORARIO.SABADO), 'Horário fixo sábado'],
    ['HORARIO_DOMINGO', JSON.stringify(APP.HORARIO.DOMINGO), 'Domingo sem horário normal'],
    ['SESSAO_MINUTOS', APP.SEGURANCA.SESSAO_MINUTOS, 'Duração da sessão'],
    ['MAX_TENTATIVAS_LOGIN', APP.SEGURANCA.MAX_TENTATIVAS_LOGIN, 'Tentativas antes do bloqueio'],
    ['BLOQUEIO_MINUTOS', APP.SEGURANCA.BLOQUEIO_MINUTOS, 'Duração do bloqueio'],
    ['TOLERANCIA_MINUTOS', 0, 'Tolerância em minutos (nunca altera a picagem original)'],
    ['MAINTENANCE_MODE', 'false', 'true = colaboradores bloqueados, ADMIN mantém acesso']
  ];
  const dados = sheet.getDataRange().getValues();
  base.forEach(function(item) {
    let encontrado = false;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.Chave] || '') === item[0]) {
        sheet.getRange(i + 1, mapa.Valor + 1).setValue(item[1]);
        sheet.getRange(i + 1, mapa.Descricao + 1).setValue(item[2]);
        sheet.getRange(i + 1, mapa.AtualizadoEm + 1).setValue(new Date());
        encontrado = true;
        break;
      }
    }
    if (!encontrado) sheet.appendRow([item[0], item[1], item[2], new Date()]);
  });
}

function inicializarUtilizadores_() {
  const sheet = getOrCreateSheet_(SHEETS.UTILIZADORES);
  garantirColunasFolha_(sheet, HEADERS.UTILIZADORES);
  const mapa = obterMapaColunas_(sheet);
  const dados = sheet.getDataRange().getValues();
  const ids = {};
  for (let i = 1; i < dados.length; i++) ids[String(dados[i][mapa.ID] || '')] = i + 1;
  UTILIZADORES_INICIAIS.forEach(function(u) {
    if (!ids[u[0]]) {
      const agora = new Date();
      const linha = new Array(sheet.getLastColumn()).fill('');
      definirValorColuna_(linha, mapa, 'ID', u[0]);
      definirValorColuna_(linha, mapa, 'Nome', u[1]);
      definirValorColuna_(linha, mapa, 'Profissao', u[2]);
      definirValorColuna_(linha, mapa, 'Perfil', u[3]);
      definirValorColuna_(linha, mapa, 'Estado', u[4]);
      definirValorColuna_(linha, mapa, 'TentativasFalhadas', 0);
      definirValorColuna_(linha, mapa, 'CriadoEm', agora);
      definirValorColuna_(linha, mapa, 'AtualizadoEm', agora);
      sheet.appendRow(linha);
    }
  });
}

function guardarConfiguracaoSabados_() {
  const sheet = getOrCreateSheet_(SHEETS.CONFIG_SABADOS);
  const mapa = obterMapaColunas_(sheet);
  const dados = sheet.getDataRange().getValues();
  ROTACAO_SABADOS_INICIAL.forEach(function(g) {
    let linhaExistente = -1;
    for (let i = 1; i < dados.length; i++) {
      if (String(dados[i][mapa.GrupoID] || '') === g.grupoId) {
        linhaExistente = i + 1;
        break;
      }
    }
    /* dataInicio automática: sem ela a rotação fica inativa e TODOS os
       sábados passam a SABADO_NAO_PREVISTO — as horas que deviam ser
       normais (10:00–13:00) contam-se como extra. Seed vazio => próximo
       sábado; linha existente vazia => reparada (setup idempotente). */
    const dataInicio = ajustarDataInicioRotacao_(String(g.dataInicio || '').trim() || proximoSabadoIso_());
    if (linhaExistente === -1) {
      sheet.appendRow([g.grupoId, g.descricao, JSON.stringify(g.ordem), dataInicio, g.ativo, new Date()]);
    } else if (!String(dados[linhaExistente - 1][mapa.DataInicio] || '').trim()) {
      sheet.getRange(linhaExistente, mapa.DataInicio + 1).setValue(dataInicio);
    }
  });
}

function protegerCabecalhos_() {
  Object.keys(SHEETS).forEach(function(k) {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS[k]);
    if (!sheet) return;
    try {
      const range = sheet.getRange(1, 1, 1, sheet.getLastColumn());
      const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
      const exists = protections.some(function(p) { return p.getRange().getA1Notation() === range.getA1Notation(); });
      if (!exists) {
        const p = range.protect().setDescription('Cabeçalhos protegidos');
        p.setWarningOnly(true);
      }
    } catch (e) {}
  });
}

/* Formato de célula por cabeçalho: datas como datas, horas como horas,
   minutos como inteiros e IDs como texto (evita o Sheets converter
   PIC_... ou 2026-09-18 em número/data). */
var FORMATOS_COLUNAS = {
  DATA_HORA: 'yyyy-mm-dd hh:mm:ss',
  DATA: 'yyyy-mm-dd',
  HORA: 'hh:mm',
  MINUTOS: '0',
  TEXTO: '@'
};

function formatoDaColuna_(cabecalho) {
  var h = String(cabecalho || '').trim();

  if (!h) return '';

  if (/^(DataHora|CriadoEm|AtualizadoEm|ExpiraEm|UltimaAtividade|BloqueadoAte|DataCriacao|DataAprovacao|DataAplicacao|ResolvidoEm)$/.test(h)) {
    return FORMATOS_COLUNAS.DATA_HORA;
  }

  if (/^(Data|DataInicio|DataFim|SemanaInicio|SemanaFim)$/.test(h)) {
    return FORMATOS_COLUNAS.DATA;
  }

  if (/^(InicioExtra|FimExtra|HorasPlaneadas|HorasTrabalhadas|HorasNormais|HorasExtra|HorasExtraAprovadas)$/.test(h)) {
    return FORMATOS_COLUNAS.HORA;
  }

  if (/^Minutos/.test(h)) {
    return FORMATOS_COLUNAS.MINUTOS;
  }

  if (/^(ID|UserID|PicagemID|GrupoID|ExcecaoID|SessaoID)$/.test(h)) {
    return FORMATOS_COLUNAS.TEXTO;
  }

  return '';
}

function aplicarFormatos_() {
  Object.keys(SHEETS).forEach(function(k) {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS[k]);
    if (!sheet) return;

    const colunas = sheet.getLastColumn();
    if (colunas < 1) return;

    /* Larguras de todas as colunas com conteúdo
       (antes só as 12 primeiras, o que deixava
       DIAS_TRABALHO/CORRECOES sem formatação). */
    sheet.autoResizeColumns(1, colunas);

    const cabecalhos = sheet.getRange(1, 1, 1, colunas).getValues()[0];
    const linhas = Math.max(sheet.getMaxRows() - 1, 1);

    cabecalhos.forEach(function(h, i) {
      const formato = formatoDaColuna_(h);
      if (!formato) return;
      try {
        sheet.getRange(2, i + 1, linhas, 1).setNumberFormat(formato);
      } catch (e) {}
    });
  });
}

/* Uma sessao de administrador obtida por instalarSistemaComCredenciais.
   Fica numa variavel do ambito e NAO num parametro: o dispatcher
   (google.script.run) transformaria qualquer objeto em parametro, e um
   `executor` como argumento seria um nome de privilegio que qualquer pagina
   poderia forjar. So se aproveita na MESMA execucao em que foi gerado, e
   consumido de imediato. */
var _EXECUTOR_INSTALACAO = null;
function setupSistema(autorizacao) {
  /* O instalador escreve em 19 folhas e recria a estrutura. Com
     `webapp.access = ANYONE`, um visitante sem sessao podia chegar aqui pelo
     dispatcher (google.script.run chama qualquer funcao publica por nome) e
     reexecutar a instalacao por baixo de quem esta a usar o sistema.
     So instala quem tem uma sessao de administrador, ou a conta Google de um
     administrador no editor (o `arranque` de instalarSistemaComCredenciais).

     Excecao: quando o proprio instalarSistemaComCredenciais ja autorizou
     NESTA execucao, nao se volta a exigir. Numa instalacao de arranque nao ha
     ainda Spreadsheet nenhuma, e por isso a autorizacao nao tem como se
     provar lendo as folhas — o `arranque` de la trata disso. */
  const a = (autorizacao && typeof autorizacao === 'object') ? autorizacao : (autorizacao ? { token: autorizacao } : {});
  if (_EXECUTOR_INSTALACAO) {
    var s = _EXECUTOR_INSTALACAO;
    _EXECUTOR_INSTALACAO = null;
  } else {
    s = autorizarOperacaoSensivel_('INSTALACAO', a);
  }
  const lock = adquirirLock_(30000);
  try {
    /* PRIMEIRO: obter — ou criar — a Spreadsheet.
       Num projeto importado por ZIP o script é standalone e
       getActiveSpreadsheet() devolve null. Como criarEstruturaFolhas_()
       já chama getSpreadsheet_(), resolver isto aqui é obrigatório:
       numa instalação nova não existe ID nenhum para abrir. */
    const alvo = resolverSpreadsheet_();

    configurarTimezone_();
    criarEstruturaFolhas_();
    inicializarConfig_();
    inicializarUtilizadores_();
    guardarConfiguracaoSabados_();
    aplicarFormatos_();
    protegerCabecalhos_();

    /* O trigger diario de manutencao e' parte da instalacao, nao um extra
       opcional. Sem ele a folha SESSOES nao tem tecto: nunca sao marcadas
       as expiradas em lote nem podadas as velhas. Chama-se aqui porque
       `setupSistema()` e' o unico ponto por onde passam os dois caminhos
       de instalacao (o `instalarSistemaComCredenciais()` chama este), e
       por isso nao ha forma de instalar o sistema sem o trigger. */
    const trigger = garantirTriggerManutencao_();

    SpreadsheetApp.flush();

    return serializarParaFrontend_(
      Object.assign({}, diagnosticoSetup_(alvo), {
        triggerManutencao: trigger.criado
          ? 'criado (diario, 3h)'
          : trigger.motivo
      })
    );
  } finally {
    lock.releaseLock();
  }
}

function diagnosticoSetup_(alvo) {
  const resultado = {
    sucesso: true,
    folhas: {},
    versao: APP.VERSAO,
    spreadsheetId: alvo ? alvo.id : '',
    spreadsheetUrl: alvo ? alvo.url : '',
    spreadsheetOrigem: alvo ? alvo.origem : ''
  };
  Object.keys(SHEETS).forEach(function(k) {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS[k]);
    resultado.folhas[SHEETS[k]] = !!sheet;
    if (!sheet) resultado.sucesso = false;
  });
  return resultado;
}

