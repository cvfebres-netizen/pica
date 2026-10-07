/* ============================================================
   RESUMOS PERSISTIDOS — DIARIO / SEMANAL / MENSAL (§64–66)
   Snapshots derivados do motor; fonte de verdade = PICAGENS.
   ============================================================ */

function persistirResumoDiario_(data) {
  const d = normalizarData_(data || new Date());
  const sheet = getOrCreateSheet_(SHEETS.RESUMO_DIARIO);
  const mapa = obterMapaColunas_(sheet);
  const linhas = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  const iso = formatarDataISO_(d);
  const existentes = {};
  for (let i = 1; i < linhas.length; i++) existentes[String(linhas[i][mapa.Data] || '') + '|' + String(linhas[i][mapa.UserID] || '')] = i + 1;
  obterUtilizadoresAtivos_().forEach(function(u) {
    const r = calcularDia_(u.ID, d);
    const linha = [iso, u.ID, u.Nome, obterNomeDiaSemana_(d), r.tipoDia, JSON.stringify(r.horarioNormal), r.minutosPlaneados, r.minutosTrabalhados, r.minutosNormais, r.minutosExtra, r.extraAprovado, r.estado, r.excecoes.map(function(e) { return e.tipo; }).join(', '), new Date()];
    const chave = iso + '|' + u.ID;
    if (existentes[chave]) sheet.getRange(existentes[chave], 1, 1, linha.length).setValues([linha]);
    else sheet.appendRow(linha);
  });
  return { sucesso: true, data: iso };
}

function persistirResumoSemanal_(semanaInicio) {
  const inicio = semanaInicio ? inicioDaSemana_(semanaInicio) : inicioDaSemana_(new Date());
  const fim = new Date(inicio.getTime()); fim.setDate(fim.getDate() + 6);
  const sheet = getOrCreateSheet_(SHEETS.RESUMO_SEMANAL);
  const mapa = obterMapaColunas_(sheet);
  const linhas = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  const chaveSemana = formatarDataISO_(inicio);
  const existentes = {};
  for (let i = 1; i < linhas.length; i++) existentes[String(linhas[i][mapa.SemanaInicio] || '') + '|' + String(linhas[i][mapa.UserID] || '')] = i + 1;
  obterUtilizadoresAtivos_().forEach(function(u) {
    const dias = obterDiasTrabalhoIntervalo_(u.ID, inicio, fim);
    const t = resumirDias_(dias);
    const linha = [chaveSemana, formatarDataISO_(fim), u.ID, u.Nome, t.planeados, t.trabalhados, t.normais, t.extra, t.extraAprovados, t.diasTrabalhados, t.diasAusentes, t.excecoes, new Date()];
    const chave = chaveSemana + '|' + u.ID;
    if (existentes[chave]) sheet.getRange(existentes[chave], 1, 1, linha.length).setValues([linha]);
    else sheet.appendRow(linha);
  });
  return { sucesso: true, semanaInicio: chaveSemana, semanaFim: formatarDataISO_(fim) };
}

function persistirResumoMensal_(mes) {
  const base = mes && /^\d{4}-\d{2}$/.test(String(mes)) ? String(mes) : Utilities.formatDate(new Date(), APP.TIMEZONE, 'yyyy-MM');
  const ano = Number(base.substring(0, 4)), mm = Number(base.substring(5, 7));
  const sheet = getOrCreateSheet_(SHEETS.RESUMO_MENSAL);
  const mapa = obterMapaColunas_(sheet);
  const linhas = sheet.getLastRow() > 1 ? sheet.getDataRange().getValues() : [];
  const existentes = {};
  for (let i = 1; i < linhas.length; i++) existentes[String(linhas[i][mapa.Mes] || '') + '|' + String(linhas[i][mapa.UserID] || '')] = i + 1;
  obterUtilizadoresAtivos_().forEach(function(u) {
    const dias = obterDiasTrabalhoIntervalo_(u.ID, new Date(ano, mm - 1, 1), new Date(ano, mm, 0));
    const t = resumirDias_(dias);
    const linha = [base, u.ID, u.Nome, t.planeados, t.trabalhados, t.normais, t.extra, t.extraAprovados, t.sabados, t.domingos, t.feriados, t.ausencias, t.excecoes, new Date()];
    const chave = base + '|' + u.ID;
    if (existentes[chave]) sheet.getRange(existentes[chave], 1, 1, linha.length).setValues([linha]);
    else sheet.appendRow(linha);
  });
  return { sucesso: true, mes: base };
}

function gerarResumos(token, opcoes) {
  exigirAdmin_(token);
  const o = opcoes || {};
  const diario = persistirResumoDiario_(o.data || new Date());
  const semanal = persistirResumoSemanal_(o.semanaInicio);
  const mensal = persistirResumoMensal_(o.mes);
  return { sucesso: true, diario: diario, semanal: semanal, mensal: mensal };
}

/* ============================================================
   BACKUPS (§96, §184) + MANUTENÇÃO (§135, §149)
   ============================================================ */

function resumirFolha_(sheet) {
  if (!sheet) return null;
  return { nome: sheet.getName(), linhas: Math.max(0, sheet.getLastRow() - 1), colunas: sheet.getLastColumn() };
}

function criarBackup(token, descricao) {
  const s = exigirAdmin_(token);
  const lock = adquirirLock_(30000);
  try {
    const ss = getSpreadsheet_();
    const folhas = [SHEETS.UTILIZADORES, SHEETS.PICAGENS, SHEETS.DIAS_TRABALHO, SHEETS.HORAS_EXTRA, SHEETS.AUSENCIAS, SHEETS.JUSTIFICACOES, SHEETS.CORRECOES, SHEETS.FERIADOS, SHEETS.CONFIG_SABADOS, SHEETS.EXCECOES, SHEETS.RESUMO_DIARIO, SHEETS.RESUMO_SEMANAL, SHEETS.RESUMO_MENSAL];
    const resumo = folhas.map(function(n) { return resumirFolha_(ss.getSheetByName(n)); });
    const agora = new Date();
    const id = 'BKP_' + Utilities.formatDate(agora, APP.TIMEZONE, 'yyyyMMdd_HHmmss') + '_' + String(Math.floor(Math.random() * 9000) + 1000);
    const conteudo = folhas.map(function(n) {
      const sheet = ss.getSheetByName(n);
      if (!sheet || sheet.getLastRow() < 1) return { folha: n, valores: [] };
      return { folha: n, valores: sheet.getDataRange().getValues() };
    });
    const sheet = getOrCreateSheet_(SHEETS.BACKUPS);
    const registo = { id: id, folhas: resumo, descricao: String(descricao || 'Backup manual') };
    sheet.appendRow([id, agora, 'MANUAL', String(descricao || 'Backup manual'), s.userId, 'OK', JSON.stringify(registo)]);
    registarAuditoriaSegura_(s, 'CRIAR_BACKUP', 'Backup ' + id + ' (' + (descricao || 'manual') + ')');
    return serializarParaFrontend_({ sucesso: true, id: id, folhas: resumo });
  } finally { lock.releaseLock(); }
}

function listarBackups(token, limite) {
  exigirAdmin_(token);
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.BACKUPS);
  if (!sheet || sheet.getLastRow() < 2) return { sucesso: true, backups: [], total: 0 };
  const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
  let lista = dados.slice(1).filter(function(l) { return l[mapa.ID]; }).map(function(l) {
    let detalhe = null;
    try { detalhe = JSON.parse(String(l[mapa.Dados] || 'null')); } catch (e) { detalhe = null; }
    return { id: String(l[mapa.ID]), dataHora: l[mapa.DataHora], tipo: String(l[mapa.Tipo] || ''), descricao: String(l[mapa.Descricao] || ''), criadoPor: String(l[mapa.CriadoPor] || ''), estado: String(l[mapa.Estado] || ''), folhas: detalhe && detalhe.folhas ? detalhe.folhas : [] };
  });
  lista.sort(function(a, b) { return new Date(a.dataHora) - new Date(b.dataHora); });
  if (limite) lista = lista.slice(-1 * Math.min(Number(limite) || 50, 500));
  return serializarParaFrontend_({ sucesso: true, backups: lista, total: lista.length });
}

function obterBackup(token, id) {
  exigirAdmin_(token);
  const info = obterLinhaPorId_(SHEETS.BACKUPS, id);
  if (!info) throw new Error('Backup não encontrado: ' + id);
  let detalhe = null;
  try { detalhe = JSON.parse(String(info.values[info.mapa.Dados] || 'null')); } catch (e) { detalhe = null; }
  return serializarParaFrontend_({ sucesso: true, id: String(id), descricao: String(info.values[info.mapa.Descricao] || ''), detalhe: detalhe });
}

/* Corredor do trigger diario. O trigger corre como o utilizador que o
   criou e NAO tem token de sessao, por isso nao pode exigir uma. O que
   impede um visitante de o chamar e' a propria natureza da operacao: apenas
   marca como terminadas as sessoes cujo prazo ja passou e poda as
   velhas — nao apaga picagens, nao altera estados, nao devolve dados de
   ninguem.

   Toma a lock mesmo assim, ao contrario do que o comentario de
   `limparSessoesExpiradas` (Gestao.gs) fazia crer. A razao: esta funcao
   REESCREVE a coluna Estado e apaga linhas com `deleteRows`. Duas
   execucoes a intercalar — o trigger das 3h e o "Limpar sessoes"
   carregado por um gestor ao mesmo tempo — podiam ler a folha em
   simultaneo e apagar sobre indices ja deslocados. A lock dura o tempo
   de UMA `setValues` mais os blocos apagados: milissegundos. E' a mesma
   razao pela qual as outras 27 funcoes que escrevem a tomam. */
function manutencaoDiaria() {
  const lock = adquirirLock_(15000);
  try {
    limparSessoesInterno_();
    podarSessoesAntigas_();
    return { sucesso: true, dataHora: new Date() };
  } finally { lock.releaseLock(); }
}

/* Poda as sessoes que ja NAO servem para nada: terminadas ou expiradas ha
   mais tempo do que APP.SEGURANCA.SESSOES_RETENCAO_DIAS.

   Porque e' preciso: SESSOES era a unica folha que crescia sem limite (cada
   login acrescentava uma linha). E `obterSessaoPorToken_()` le a folha
   INTEIRA em cada pedido autenticado, porque precisa de procurar o token —
   por isso o custo de um "picar" crescia sem parar.

  Porque e' seguro:
     - NUNCA apaga uma sessao ATIVA, nem que seja antiga. Uma sessao ativa
       e' o unico registo de "esta pessoa esta autenticada agora".
     - NUNCA toca em PICAGENS, JUSTIFICACOES, CORRECOES, AUDITORIA, etc.
       A AUDITORIA, em particular, e' a prova de que algo aconteceu e
       continua a nao ter prazo de validade.
     - Apaga por BLOCOS CONTIGUOS de linhas, com um deleteRows por bloco.
       Apagar linha a linha deslocaria todos os indices a cada passo e
       custaria uma chamada ao servidor por linha.
     - 0 em SESSOES_RETENCAO_DIAS desliga isto. */
function podarSessoesAntigas_() {
  const dias = Number(APP.SEGURANCA.SESSOES_RETENCAO_DIAS);
  if (!dias || dias <= 0) return 0;
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    const limite = Date.now() - dias * 86400000;

    /* Apaga de cima para baixo: assim os indices das linhas que ainda ficam
       nao mudam enquanto se avanca. */
    let removidas = 0, inicio = -1;
    for (let i = dados.length - 1; i >= 1; i--) {
      const estado = String(dados[i][mapa.Estado] || '');
      const ativa = estado === ENUMS.ESTADOS_SESSAO.ATIVA;
      const quando = new Date(dados[i][mapa.ExpiraEm] || dados[i][mapa.CriadoEm]);
      const velha = !isNaN(quando.getTime()) && quando.getTime() < limite;
      const cortar = !ativa && velha;

      if (cortar) {
        if (inicio < 0) inicio = i;            /* extremos sao indices de DADOS */
        continue;
      }
      /* Fecha o bloco. Como se desce, `inicio` e' o indice de DADOS mais
         baixo do bloco e `i` o mais alto. O indice de dados k corresponde a
         linha k+1 da folha, portanto o bloco ocupa as linhas (i+2) ate
         (inicio+1): comeca em `i + 2` e tem `inicio - i` linhas.

         Os dois numeros ja erraram uma vez cada: o inicio
         era `inicio + 1` (comecava uma linha abaixo e deixava de fora a
         ultima) e a contagem era `i - inicio` (negativa). A prova por
         execucao 1.6 e' que apanhou os dois. */
      if (inicio >= 0) {
        sheet.deleteRows(i + 2, inicio - i);
        removidas += (inicio - i);
        inicio = -1;
      }
    }
    /* Bloco que desceu ate ao topo dos dados (a linha 1 e' o cabecalho e
       nunca entra: comeca-se em i == 1, que da' linha 2 da folha). */
    if (inicio >= 0) {
      sheet.deleteRows(2, inicio);
      removidas += inicio;
    }
    if (removidas) marcarFolhasAlteradas_();
    return removidas;
  } catch (e) { return 0; }
}

function limparSessoesInterno_() {
  try {
    const sheet = getSpreadsheet_().getSheetByName(SHEETS.SESSOES);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const dados = sheet.getDataRange().getValues(), mapa = obterMapaColunas_(sheet);
    return expirarSessoesEmLote_(sheet, mapa, dados);
  } catch (e) { return 0; }
}

/* Marca como EXPIRADAS as sessoes ATIVAS cujo prazo ja passou, com UMA
   unica escrita.

   ANTES: um `setValue` por sessao expirada. A folha SESSOES nunca e' podada
   (so muda de estado), por isso cresce sem limite; com 20 000 sessoes eram
   20 001 idas e voltas ao servidor. Cada `setValue` e' uma chamada de rede
   (dezenas de ms): dava para varios MINUTOS, e a execucao morre aos 6. Pior:
   a versao com lock segurava a lock do script esse tempo todo e bloqueava
   o login de toda a gente.

   Agora le-se a coluna Estado e reescreve-se de uma vez, preservando o valor
   das linhas que nao mudam. Uma leitura + UMA escrita, em vez de N. */
function expirarSessoesEmLote_(sheet, mapa, dados) {
  if (!dados || dados.length < 2) return 0;
  const valores = [];
  let marcadas = 0, mudou = false;
  for (let i = 1; i < dados.length; i++) {
    const atual = dados[i][mapa.Estado];
    let novo = atual;
    if (String(atual || '') === ENUMS.ESTADOS_SESSAO.ATIVA) {
      const expira = new Date(dados[i][mapa.ExpiraEm]);
      if (isNaN(expira.getTime()) || expira.getTime() <= Date.now()) {
        novo = ENUMS.ESTADOS_SESSAO.EXPIRADA;
        marcadas++;
      }
    }
    if (novo !== atual) mudou = true;
    valores.push([novo]);
  }
  if (!mudou) return 0;
  sheet.getRange(2, mapa.Estado + 1, valores.length, 1).setValues(valores);
  return marcadas;
}

/* Garante que existe UM trigger diario de manutencao. Idempotente: le
   primeiro os triggers do projecto e so cria quando falta.

   POR QUE ESTA FUNCAO EXISTE SEPARADA. `instalarTriggers()` nao tinha
   NENHUMA chamada em todo o codigo de producao: era um botao que ninguem
   premia. O trigger das 3h nunca chegava a ser criado, e com ele caia
   tudo o que a LEIA-ME promete: sem `limparSessoesInterno_` as sessoes
   expiradas nunca eram marcadas em lote, e sem `podarSessoesAntigas_` a
   folha SESSOES continuava a crescer sem tecto — que era exactamente o
   problema que a poda se propoe resolver. O teste de simulacao passava
   porque chamava `instalarTriggers` a mao; o que nao se via era que a
   instalacao normal nao o fazia.

   Por isso o `setupSistema()` chama esta funcao: e' o unico sitio por
   onde passam os dois caminhos de instalacao, e portanto nao ha forma de
   instalar o sistema sem o trigger. */
function garantirTriggerManutencao_() {
  try {
    const existentes = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    if (existentes.indexOf('manutencaoDiaria') >= 0) return { criado: false, motivo: 'ja existia' };
    ScriptApp.newTrigger('manutencaoDiaria').timeBased().everyDays(1).atHour(3).create();
    return { criado: true, motivo: 'criado' };
  } catch (e) {
    /* Sem permissao para criar triggers nao e' motivo para abortar a
       instalacao: as folhas, os utilizadores e os logins ja ficaram
       gestos. Fica registado no diagnostico para se poder repetir a mao. */
    return { criado: false, motivo: 'nao criado: ' + (e && e.message ? e.message : 'erro desconhecido') };
  }
}

function instalarTriggers(token) {
  exigirAdmin_(token);
  return serializarParaFrontend_(Object.assign({ sucesso: true }, garantirTriggerManutencao_()));
}

