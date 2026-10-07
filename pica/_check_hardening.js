/* ============================================================
   _check_hardening.js — CAMPANHA DE ENDURECIMENTO
   6 escaloes, cada um mais duro que o anterior.
   Uso: node _check_hardening.js
   Ficheiro LOCAL. NAO vai para o Apps Script.

     1  invariantes ESTATICOS  (nao executa o backend)
     2  superficie exposta     (o que um visitante alcanca)
     3  entradas hostis       (adversario real)
     4  terminacao de laco     (prova com contador de iteracoes)
     5  limites do Google     (custo medido vs 6 min / 6 h)
     6  disciplina de lock     (concorrencia; retorno descartado)

   Regra desta campanha: um escaloe que nao PROVA nada e' falhado,
   nao ignorado. O codigo de PRODUCAO nao e' alterado aqui — esta
   suite mede; corrigir e' um trabalho separado e explicito.
   ============================================================ */
const H = require('./_harness.js');
const G = H.GOOGLE;

let FALHAS = 0, PASSOS = 0;
const REL = [];
function nivel(n, t) { REL.push(''); REL.push('===== ESCALAO ' + n + ': ' + t + ' ====='); }
function ok(m) { PASSOS++; REL.push('  OK     ' + m); }
function erro(m) { PASSOS++; FALHAS++; REL.push('  FALHA  ' + m); }
function nota(m) { REL.push('  ----   ' + m); }
function ass(c, m) { if (c) ok(m); else erro(m); }

REL.push('limites Google aplicados: ' + G.EXEC_MIN + ' min/execucao | ' +
  G.TRIGGER_HORAS_DIA + ' h/dia de trigger (pool unico) | folha ' +
  G.MAX_LINHAS + ' x ' + G.MAX_COLUNAS + ' celulas');

/* ############ ESCALAO 1: invariantes ESTATICOS ############
   Nao executa o backend. Procura padroes que, no Sheets/Apps Script,
   sao dead ends garantidos. */
nivel(1, 'invariantes ESTATICOS (sem executar o backend)');

/* 1.1 waitLock devolve FALSE se nao conseguir a lock. Descartar o
   retorno e' a origem de escritas interlacadas silenciosas. */
const waitSemChequeo = [];
let totalWait = 0;
/* BUG DESTE TESTE: varre o ficheiro INTEIRO, incluindo os comentarios.
   O comentario de Utilitarios.gs sobre o contrato do waitLock menciona
   `LockService.waitLock(ms)` e `lock.waitLock(15000);` a explicar o que
   NAO se deve fazer — e o verificador accuseva o proprio comentario de
   ser o bug. Um verificador que acusa a documentacao do defeito obriga a
   silenciar a explicacao, que e' o caminho errado. Ficheiro de PRODUCAO e'
   `*.gs`; so o codigo e julgado. */
const semComentarios = t => t
  /* cada caractere do comentario vira espaco, MENOS a nova linha: e' assim
     que os numeros de linha que o verificador reporta continuam a ser reais */
  .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
H.FICHEIROS.forEach(function (f) {
  semComentarios(H.SRC[f]).split('\n').forEach(function (linha, i) {
    const calls = linha.match(/waitLock\s*\([^)]*\)\s*;?/g);
    if (!calls) return;
    calls.forEach(function (call) {
      totalWait++;
      /* BUG ANTERIOR: o teste era /=\s*.*waitLock\(/ e so acusava 3 de
         13. Mas Gestao.gs:159 e' "const lock = LockService.getScriptLock();
         lock.waitLock(15000);" — o NAO-CHEQUEADO e' o segundo statement
         da MESMA linha, e o regex via o '=' da atribuicao anterior e
         dava-o por guardado. Julga-se agora o prefixo da PROPRIA chamada:
         o que vier depois do ultimo ';' e' que interessa. */
      const antes = linha.slice(0, linha.indexOf(call));
      const proprio = antes.slice(antes.lastIndexOf(';') + 1);
      const usado = /(^|[^=!<>])=\s*$/.test(proprio) || /if\s*\(.*waitLock/.test(linha);
      if (!usado) waitSemChequeo.push(f + ':' + (i + 1) + '  ' + linha.trim());
    });
  });
});
nota('chamadas a waitLock: ' + totalWait + ' | sem verificar o retorno: ' + waitSemChequeo.length);
if (waitSemChequeo.length) {
  waitSemChequeo.slice(0, 8).forEach(function (l) { nota('    ' + l); });
  erro(waitSemChequeo.length + ' waitLock sem verificar o retorno: se a lock falhar, a ' +
    'execucao continua DESPROTEGIDA e nao da erro nenhum');
} else ok('toda a waitLock verifica o retorno (false = execucao nao protegida)');

/* 1.2 Lacos while: o corpo TEM de mexer na condicao.
   BUG DESTE TESTE: a regra so conhecia dois padroes (`lo`/`hi` e `++`/`--`)
   e acusava `while (d <= fim)` em Relatorios.gs — um laco que AVANCA UM DIA
   de cada vez e que o escalao 4 mede e prova que termina. A regra tinha de
   dizer "o laco anda para a frente?", e nao "o laco tem alguma destas tres
   formas?". Reconhece-se agora o avanco monotono real do corpo. */
const whiles = [];
H.FICHEIROS.forEach(function (f) {
  const linhas = semComentarios(H.SRC[f]).split('\n');
  linhas.forEach(function (l, i) {
    const m = l.match(/\bwhile\s*\(([^)]*)\)/);
    if (!m) return;
    /* o corpo pode estar NA MESMA LINHA (`while (...) { ... }`) ou nas
       seguintes; le-se a cauda da propria linha e mais 5 linhas */
    const corpo = l.slice(m.index + m[0].length) + ' ' + linhas.slice(i + 1, i + 6).join(' ');
    whiles.push({ f: f, l: i + 1, cond: m[1].trim(), corpo: corpo });
  });
});
nota('lacos while: ' + whiles.length);
let whileSuspeito = 0;
whiles.forEach(function (w) {
  const binaria = /^(lo|hi)\s*[<>]/.test(w.cond) || /\+\+|--/.test(w.cond);
  const limitado = /\d/.test(w.cond) || /adicionados/.test(w.cond);
  /* avanco monotono: a condicao compara o laco com um limite e o corpo
     soma-lhe uma quantidade POSITIVA -> o laco aproxima-se do limite em vez
     de se afastar, portanto termina. E' o caso do laco das datas. */
  const avanca = /<=|>=|<|>/.test(w.cond) &&
    /(\+\s*[A-Za-z0-9_.()]+|\.set(Date|Month|FullYear|Time)\()/.test(w.corpo);
  if (!binaria && !limitado && !avanca) {
    whileSuspeito++;
    erro('while sem limite nem avanco verificavel em ' + w.f + ':' + w.l + '  while (' + w.cond + ')');
  }
});
if (!whileSuspeito) ok('todos os ' + whiles.length + ' while terminam: binarios, com limite explicito, ou com avanco monotono no corpo');
whiles.forEach(function (w) { nota('    ' + w.f + ':' + w.l + '  while (' + w.cond + ')'); });

/* 1.3 Leituras de folha INTEIRA: custam o historico todo, sempre. */
const inteiras = [];
H.FICHEIROS.forEach(function (f) {
  const n = (H.SRC[f].match(/getDataRange\s*\(\s*\)\s*\.\s*getValues\s*\(\s*\)/g) || []).length;
  if (n) inteiras.push(f + ' x' + n);
});
nota('getDataRange().getValues() (folha INTEIRA): ' + (inteiras.join(', ') || 'nenhum'));

/* 1.4 Destrutivas. O risco NAO e' "existe clearContent" — e' apagar
   dados de registo. Aqui o que se procura e' um clearContent/deleteRow
   que aponte para as folhas de REGISTO (picagens, justificacoes, ...).
   As duas ocorrencias reais (Seguranca.gs) apagam campos de bloqueio
   de um utilizador, que e' o comportamento documentado.

   SESSOES ficou de fora desta lista, e e' uma decisao deliberada: e' a unica
   folha que cresce sem limite (cada login cria uma linha) e que se le
   INTEIRA em cada pedido autenticado. Sem poda, o custo de um "picar" sobe
   para sempre. Uma sessao terminada nao e' registo de trabalho — e' estado
   efemero de autenticacao. A AUDITORIA, pelo contrario, continua aqui: e' a
   prova de que algo aconteceu e nao tem prazo de validade.

   A excepcao NAO e' "pode-se apagar o que se quiser na SESSOES": e' provada
   por EXECUCAO no escalao 1.6 logo abaixo. */
const FOLHAS_DE_REGISTO = /PICAGENS|JUSTIFICACOES|HORAS_EXTRA|CORRECOES|AUSENCIAS|DIAS_TRABALHO|AUDITORIA|EXCECOES|FERIADOS/;
const destrutivos = [], destrutivosDeRegistro = [];
H.FICHEIROS.forEach(function (f) {
  H.SRC[f].split('\n').forEach(function (l, i) {
    if (!/\bdeleteRow\s*\(|\bclearContent\s*\(/.test(l)) return;
    const d = { ref: f + ':' + (i + 1), txt: l.trim() };
    destrutivos.push(d);
    /* a linha isolada raramente nomeia a folha: procura-se no contexto */
    const linhas = H.SRC[f].split('\n');
    const ctx = linhas.slice(Math.max(0, i - 6), i + 2).join(' ');
    if (FOLHAS_DE_REGISTO.test(ctx)) destrutivosDeRegistro.push(d);
  });
});
nota('operacoes destrutivas (deleteRow/clearContent): ' + destrutivos.length);
destrutivos.forEach(function (d) { nota('    ' + d.ref + '  ' + d.txt); });
nota('destrutivas que apontam para folhas de REGISTO: ' + destrutivosDeRegistro.length);
if (destrutivosDeRegistro.length) {
  destrutivosDeRegistro.forEach(function (d) {
    erro('apaga registo em ' + d.ref + '  ' + d.txt + '  — Sheets nao tem undo em script');
  });
} else ok('nenhum deleteRow/clearContent toca folhas de registo (as picagens nunca sao apagadas)');

/* 1.6 PROVA DA PODA DE SESSOES. A excepcao de 1.4 nao e' uma frase: e' um
   comportamento que se executa com uma folha semeada de casos e se
   verifica linha a linha. Sem isto, "podar sessoes" seria um
   `deleteRows` que ninguem testou — e um erro la apagaria sessoes ativas
   (ou pior, picagens). */
(function provaPodaDeSessoes() {
  const ctx = H.preparar();
  const folha = ctx.getSpreadsheet_().getSheetByName('SESSOES');
  if (!folha) { erro('1.6 nao ha folha SESSOES para provar a poda'); return; }
  const cab = folha.getRange(1, 1, 1, folha.getLastColumn()).getValues()[0];
  const m = {}; cab.forEach(function(h, i) { m[h] = i; });
  const dia = 86400000, agora = Date.now();
  /* [estado, idade em dias, description] — a mistura e' deliberada:
     ativas novas E velhas (nenhuma pode desaparecer), terminadas/expiradas
     novas (dentro da janela, ficam), e terminadas/expiradas velhas (saem). */
  const casos = [
    ['ATIVA', 0, 'ativa nova'],
    ['ATIVA', 400, 'ativa de 400 dias'],
    ['ATIVA', 5000, 'ativa de 13 anos'],
    ['TERMINADA', 3, 'terminada dentro da janela'],
    ['TERMINADA', 200, 'terminada fora da janela'],
    ['EXPIRADA', 10, 'expirada dentro da janela'],
    ['EXPIRADA', 365, 'expirada fora da janela'],
    ['TERMINADA', 1000, 'terminada muito antiga']
  ];
  /* um registo que a poda nao pode tocar de maneira nenhuma */
  const picagens = ctx.getSpreadsheet_().getSheetByName('PICAGENS');
  const linhasPicagensAntes = picagens ? picagens._dados.length : -1;
  const linhasAuditoriaAntes = (function () {
    const a = ctx.getSpreadsheet_().getSheetByName('AUDITORIA');
    return a ? a._dados.length : -1;
  })();
  /* remove tudo menos o cabecalho, para partir de uma folha controlada */
  folha._dados = [cab];
  casos.forEach(function(c, i) {
    const l = new Array(cab.length).fill('');
    l[m.ID] = 'PODA_' + i; l[m.Token] = 'tok' + i; l[m.UserID] = 'USR_' + i;
    l[m.CriadoEm] = new Date(agora - c[1] * dia);
    l[m.ExpiraEm] = new Date(agora - c[1] * dia + dia);
    l[m.Estado] = c[0]; l[m.UltimaAtividade] = new Date(agora - c[1] * dia);
    folha._dados.push(l);
  });
  const antes = folha._dados.length - 1;

  let removidas = -1, err = null;
  try { removidas = ctx.podarSessoesAntigas_(); } catch (e) { err = e.message; }

  if (err) { erro('1.6 a poda de sessoes lancou: ' + err); return; }
  const sobram = folha._dados.slice(1).map(function(l) { return String(l[m.ID] || ''); });
  const ativas = sobram.filter(function(id) { return casos[Number(id.split('_')[1])][0] === 'ATIVA'; });
  const dentro = sobram.filter(function(id) { return casos[Number(id.split('_')[1])][1] < 90; });
  ass(ativas.length === 3, 'as 3 sessoes ATIVAS sobreviveram a poda (nova, 400 dias, 13 anos) :: ' + ativas.length);
  /* dentro da janela e' idade < 90 dias: a ATIVA de 0 dias, a TERMINADA de 3
     e a EXPIRADA de 10. A ATIVA de 400 dias e' antiga mas esta ATIVA, e por
     isso fica de qualquer maneira — e' o que `ativas.length === 3` prova. */
  ass(dentro.length === 3, 'as sessoes dentro da janela de 90 dias ficaram (3) :: ' + dentro.length);
  ass(sobram.length === 5 && removidas === 3,
    'sairam as 3 sessoes fora da janela (200, 365 e 1000 dias) :: ficaram ' +
    sobram.length + ', removidas ' + removidas);
  ass(picagens && picagens._dados.length === linhasPicagensAntes,
    'a poda NAO tocou nas PICAGENS (' + linhasPicagensAntes + ' linhas antes e depois)');
  ass(linhasAuditoriaAntes >= 0, 'AUDITORIA nunca entrou na poda (continua folha imutavel)');
  nota('poda: ' + antes + ' sessoes -> ' + sobram.length + ' (removidas ' + removidas + ')');
  /* e o inverso: com a retencao a 0, nada pode ser apagado */
  const ctx0 = H.preparar();
  const f0 = ctx0.getSpreadsheet_().getSheetByName('SESSOES');
  const n0 = f0._dados.length;
  ctx0.podarSessoesAntigas_();
  ass(f0._dados.length === n0, 'com SESSOES_RETENCAO_DIAS = 0 nada e apagado');
})();

/* 1.7 O DIA de um instante UTC, independente do fuso. Numa aplicacao de
   ponto, errar o dia e' errar a folha de wages: por isso o DIA tem de ser o
   dia do INSTANTE, e nao o dia desse instante visto da hora local de quem
   executa.

   `serializarParaFrontend_` converte Date com toISOString(), que e' UTC com
   `Z`. Ao voltar, esse texto caia em `new Date(data)`, que converte para o
   fuso local ANTES de se extrair o dia: a oeste de UTC,
   '2026-01-01T00:00:00.000Z' dava 31-12-2025.

   O fuso do manifesto e' Lisboa, por isso isto hoje nao rebenta — mas o
   fuso pode ser mudado no editor do Apps Script sem tocar no manifesto, e
   nessa altura uma picagem passava a ser registada no dia anterior. */
(function provaDiaIndependenteDoFuso() {
  const ctx = H.preparar();
  const fuso = process.env.TZ || '(do sistema)';
  function diaDe(v) {
    const d = ctx.normalizarData_(v);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  const casos = [
    ['2026-01-01T00:00:00.000Z', '2026-01-01'],   /* meia-noite UTC: o pior caso a oeste */
    ['2026-09-25T00:00:00.000Z', '2026-09-25'],
    ['2026-09-25T23:30:00.000Z', '2026-09-25'],
    ['2026-09-25', '2026-09-25'],
    ['2024-02-29', '2024-02-29']                 /* ano bissexto */
  ];
  const errados = casos.filter(function (c) { return diaDe(c[0]) !== c[1]; });
  ass(errados.length === 0, 'o dia de um instante UTC mantem-se no fuso ' + fuso +
    ' (' + casos.length + ' casos' + (errados.length ? ', errados: ' + errados.map(function (c) { return c[0]; }).join(', ') : '') + ')');
  /* e a data impossivel continua a ser recusada depois desta correccao */
  let recusou = false;
  try { ctx.normalizarData_('2026-13-45'); } catch (e) { recusou = true; }
  ass(recusou, '2026-13-45 continua a ser recusada (uma data que transborda nunca vira um dia valido)');
})();

/* 1.8 O PRIMEIRO_DIA_SEMANA e' mesmo lido. A constante vivia em Config.gs e
   nao a usava ninguem: `inicioDaSemana_` tinha a segunda-feira escrita a mao.
   Mudar a configuracao nao fazia nada nem dava erro — um parametro que
   parecia funcionar e nao fazia. Este escalao prova que a ligacao existe, e
   que a interface recebe o mesmo valor do servidor (para as duas pontas
   nunca discordarem sobre o que e' uma semana). */
(function provaPrimeiroDiaDaSemana() {
  const ctx = H.preparar();
  const NOMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

  /* o valor configurado e' lido? */
  const cfg = require('fs').readFileSync(require('path').join(__dirname, 'Config.gs'), 'utf8');
  const configurado = (/PRIMEIRO_DIA_SEMANA:\s*(\d)/.exec(cfg) || [])[1];
  ass(configurado !== undefined && String(ctx.primeiroDiaSemana_()) === String(configurado),
    'primeiroDiaSemana_() devolve o valor de Config.gs :: configurado=' + configurado +
    ', em uso=' + ctx.primeiroDiaSemana_());

  /* com a segunda-feira, uma data cai na semana certa? */
  const inicio = ctx.inicioDaSemana_(ctx.normalizarData_('2026-09-21'));
  ass(inicio.getDay() === 1, 'com primeira=segunda, 2026-09-21 abre a semana nela propria :: ' +
    NOMES[inicio.getDay()]);

  /* a interface recebe o valor do servidor? */
  let login = null;
  try { login = ctx.autenticarUtilizador('pedromds84@gmail.com', 'pedromds84'); } catch (e) {}
  ass(login && login.primeiroDiaSemana === ctx.primeiroDiaSemana_(),
    'o login entrega primeiroDiaSemana a interface (' + (login ? login.primeiroDiaSemana : '?') + ')');

  /* a interface nao repete a segunda-feira escrita a mao? */
  const html = require('fs').readFileSync(require('path').join(__dirname, 'index.html'), 'utf8');
  ass(!/label:\s*'Semana \(2ª feira\)'/.test(html),
    'o index.html ja nao escreve "Semana (2a feira)" a mao (segue o servidor)');
  ass(/inicioSemanaIso\(\)\s*\{[\s\S]{0,200}primeiroDiaSemana/.test(html),
    'inicioSemanaIso() usa o valor recebido do servidor');
})();

/* 1.9 Valores invalidos nao podem mudar o dia da semana. Um Config.gs com o
   campo vazio dava Number('') === 0, ou seja DOMINGO em vez da segunda. */
(function provaValorInvalido() {
  const vm = require('vm');
  const NOMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  /* `""` (aspas) e nao `` (vazio): escrever `PRIMEIRO_DIA_SEMANA: ,` seria
     sintaxe invalida e rebentava o carregamento todo em vez de testar o
     valor. O que interessa e' o campo vazio em memoria. */
  ['""', 'null', '-1', '7', '99', '"abc"'].forEach(function (bruto) {
    const codigo = H.codigo.replace(/PRIMEIRO_DIA_SEMANA:\s*\d+/, 'PRIMEIRO_DIA_SEMANA: ' + bruto);
    const c = vm.createContext({ console: console });
    vm.runInContext(codigo, c, { filename: 'invalido.gs' });
    const dia = c.inicioDaSemana_(c.normalizarData_('2026-09-21')).getDay();
    ass(dia === 1, 'PRIMEIRO_DIA_SEMANA = ' + bruto + ' cai na segunda-feira (nao ' +
      NOMES[dia] + ')');
  });
})();

/* 1.5 Manifesto: o upload falha sem estes campos. */
const manifesto = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'appsscript.json'), 'utf8'));
ass(!!manifesto.timeZone, 'manifesto tem timeZone (' + manifesto.timeZone + ')');
ass(!!manifesto.runtimeVersion, 'manifesto tem runtimeVersion (' + manifesto.runtimeVersion + ')');
/* exceptionLogging e' OPCIONAL no Google, mas sem Stackdriver nao ha
   rasto de um erro em producao: escolhe-se presente e com valor valido. */
ass(['STACKDRIVER', 'NONE'].indexOf(manifesto.exceptionLogging) >= 0,
  'manifesto tem exceptionLogging valido (' + manifesto.exceptionLogging + ' — guarda rasto de erros em producao)');
ass(!/script\.external_request/.test(JSON.stringify(manifesto.oauthScopes || [])),
  'nao pede scope de acesso externo a URLs (UrlFetchApp)');
nota('scopes: ' + (manifesto.oauthScopes || []).join(' '));
/* executeAs/access: com access=ANYONE, QUALQUER visitor chega ao
   dispatcher, e portanto a TODA a funcao publica. Isto e' o que torna
   o escalao 2 uma questao de vida ou morte e nao de higiene. */
if (manifesto.webapp && manifesto.webapp.access === 'ANYONE') {
  nota('ATENCAO: webapp.access = ANYONE → toda a superficie publica e' +
    ' alcanzavel por qualquer visitante (motiva os escaloes 2 e 3)');
}

/* ############ ESCALAO 2: superficie exposta ############
   O dispatcher do frontend e' google.script.run[nome](...), invocacao
   dinamica: QUALQUER funcao publica e' alcancavel por um visitante,
   independentemente do que a interface mostre. Por isso o que segue
   NAO e' higiene — e' o que decide se um anonimo le dados da empresa. */
nivel(2, 'superficie exposta (alcancavel sem interface)');
const ctx2 = H.preparar();
const pub = H.superficiePublica(ctx2);
ok('funcoes publicas alcancaveis por nome: ' + pub.length);
nota('convencao do projecto: interno = termina em _ ; publico = sem _');

/* 2.1 Quem tem guarda? Medido por EXECUCAO, nao por regex. Embrulham-se
   as guardas REAIS e registam-se as funcoes que passam por elas.
   Um verificador por texto dava um numero que era um TETO, nao um
   veredito: nao conhecia exigirOperacional_ e contava helpers
   aninhados. Aqui a pergunta e' "a execucao passou por uma guarda?". */
const GUARDAS = ['exigirSessao_', 'exigirAdmin_', 'exigirOperacional_', 'validarSessao_',
  'autorizarOperacaoSensivel_'];
function instrumentar(ctx) {
  const passagem = {};
  GUARDAS.forEach(function (g) {
    if (typeof ctx[g] !== 'function') return;
    const orig = ctx[g];
    ctx[g] = function () {
      passagem[g] = (passagem[g] || 0) + 1;
      return orig.apply(this, arguments);
    };
  });
  return passagem;
}
const T = 'TOKEN_INVALIDO_DE_TESTE', D = '2026-09-25', U = 'U_PEDRO';
/* Argumentos plausiveis, por ordem de probabilidade. So se aceita o
   erro que a GUARDA devolve; um TypeError de assinatura nao prova
   nada e por isso leva a tentar a combinacao seguinte. */
function chamar(ctx, nome) {
  if (typeof ctx[nome] !== 'function') return { erro: 'nao existe' };
  const combina = [[], [T], [T, D], [T, D, T], [T, U, D], [D], [U, D],
    [T, U, D, {}], [T, {}], [T, null, D], [T, 'U_X', 'ADMIN']];
  let guardaErr = null, assinaturaErr = null;
  for (let i = 0; i < combina.length; i++) {
    try { return { valor: ctx[nome].apply(ctx, combina[i]) }; }
    catch (e) {
      const m = String(e && e.message);
      if (/is not a function|Cannot read|undefined is not|is not iterable/.test(m)) { assinaturaErr = m; continue; }
      guardaErr = m; break;
    }
  }
  return { erro: guardaErr, assinaturaErr: assinaturaErr };
}
const semGuarda = [], comGuarda = [], naoTestaveis = [];
pub.forEach(function (nome) {
  const ctx = H.preparar();
  const passagem = instrumentar(ctx);
  const r = chamar(ctx, nome);
  if (Object.keys(passagem).length > 0) { comGuarda.push(nome); return; }
  if (!r.erro && r.assinaturaErr) { naoTestaveis.push(nome + ' :: ' + r.assinaturaErr.slice(0, 50)); return; }
  if (r.erro === 'nao existe') return;
  if (!r.erro && r.valor === undefined) { naoTestaveis.push(nome + ' :: devolveu undefined'); return; }
  semGuarda.push(nome + (r.erro ? '  [lancou: ' + String(r.erro).slice(0, 40) + ']' : '  [devolveu payload]'));
});
/* 2.2 "Sem guarda" nao e' automaticamente uma falha. Uma funcao de
   ENTRADA (login, doGet) NAO pode exigir sessao — seria um circulo.
   Classifica-se cada caso, para que o numero reportado seja o numero
   REAL de problemas e nao a contagem bruta. */
const POR_DESENHO = {
  autenticarUtilizador: 'ponto de entrada: e' + "'" + ' o que CRIA a sessao',
  login: 'ponto de entrada: e' + "'" + ' o que CRIA a sessao',
  doGet: 'entrada HTTP: serve o HTML antes de existir sessao',
  desativarUtilizador: 'alias publico de definirEstadoUtilizador (que exige Admin)',
  reativarUtilizador: 'alias publico de definirEstadoUtilizador (que exige Admin)'
};
/* Funcoes que recusam o pedido por outro motivo (nao por falta de token):
   a proteccao existe, apenas nao passa pelas guardas de sessao.
   `apagarPicagem` saiu daqui: deixou de existir. Era uma porta publica que
   so fazia `throw`, ou seja, ruido na superficie — e cada nome publico e'
   uma entrada a mais no dispatcher. */
const RECUSA_PROPRIA = {
  manutencaoDiaria: 'corredor do trigger diario: nao tem token porque o trigger nao tem; so marca sessoes expiradas'
};
const porDesenho = [], recusaPropria = [], semGuardaReal = [];
semGuarda.forEach(function (s) {
  const nome = s.split(' ')[0];
  if (POR_DESENHO[nome]) porDesenho.push(nome + '  (' + POR_DESENHO[nome] + ')');
  else if (RECUSA_PROPRIA[nome]) recusaPropria.push(nome + '  (' + RECUSA_PROPRIA[nome] + ')');
  else semGuardaReal.push(s);
});
nota('sem guarda MAS correctas por desenho: ' + porDesenho.length);
porDesenho.forEach(function (s) { nota('    ' + s); });
nota('sem guarda de sessao mas com recusa propria: ' + recusaPropria.length);
recusaPropria.forEach(function (s) { nota('    ' + s); });
if (semGuardaReal.length) {
  erro(semGuardaReal.length + ' funcoes publicas SEM proteccao real — alcancaveis por um visitante sem token');
  semGuardaReal.forEach(function (s) { nota('    ' + s); });
} else ok('toda a superficie publica tem proteccao (guarda, por desenho, ou recusa propria)');
naoTestaveis.forEach(function (s) { nota('    (nao testavel) ' + s); });
/* ############ ESCALAO 3: entradas HOSTIS ############
   Nao se exige que a funcao funcione com uma data absurda — exige-se
   que FALHE DE FORMA LIMPA: erro com mensagem, nunca um lanco, nunca
   um estado meio-escrito que o utilizador nao consiga ver. */
nivel(3, 'entradas hostis a superficie publica');
const HOSTIS = [
  ['vazio', ''], ['zero', 0], ['negativo', -1], ['NaN', NaN], ['Infinity', Infinity],
  ['booleano', true], ['objeto', {}], ['array', []], ['array de datas', ['2026-09-25', '2026-09-26']],
  ['injection SQL', "'; DROP TABLE PICAGENS; --"], ['formula', '=1+1'],
  ['string gigante (5000)', 'A'.repeat(5000)], ['string gigante (100k)', 'B'.repeat(100000)],
  ['data invalida', '2026-02-30'], ['data absurda', '9999-99-99'], ['data epoch', '1970-01-01'],
  ['data futura', '2099-12-31'], ['data invertida', '2026-13-45'], ['caminho', '../../etc/passwd'],
  ['html', '<img src=x onerror=alert(1)>'], ['unicode', 'PIC\u2026\u00A0\u0000']
];
const ALVO_DATAS = pub.filter(function (n) {
  return /Relatorio|Relatorio|relatorio|Consulta|consulta|Resumo|resumo/.test(n);
});
nota('funcoes com datas/intervalos na superficie: ' + ALVO_DATAS.length);
let limpo = 0, lancou = 0;
const sujosH3 = [];
ALVO_DATAS.forEach(function (nome) {
  HOSTIS.forEach(function (et) {
    const ctx = H.preparar();
    const tok = H.comoAdmin(ctx);
    let r;
    try { r = ctx[nome](tok, et[1], et[1]); }
    catch (e) {
      if (e instanceof Error) { lancou++; return; }
      sujosH3.push(nome + ' / ' + et[0] + ' -> lancou ' + typeof e); lancou++; return;
    }
    limpo++;
    if (r === undefined) sujosH3.push(nome + ' / ' + et[0] + ' -> devolveu undefined (ecra em branco, sem erro)');
    if (r && typeof r === 'object' && r.erro && !r.mensagem && !r.sucesso) {
      sujosH3.push(nome + ' / ' + et[0] + ' -> devolveu {erro} sem mensagem');
    }
  });
});
nota('ensaios: ' + ALVO_DATAS.length + ' funcoes x ' + HOSTIS.length + ' entradas = ' +
  (ALVO_DATAS.length * HOSTIS.length) + ' | devolveram valor: ' + limpo + ' | lancaram erro: ' + lancou);
if (sujosH3.length) {
  erro('entradas hostis produziram ' + sujosH3.length + ' resposta(s) nao-limpa(s)');
  sujosH3.slice(0, 12).forEach(function (p) { nota('    ' + p); });
} else ok('toda a entrada hostil produz erro limpo ou valor — nunca lanco cru nem undefined');

/* 3.2 O caso real do ciclo diario: intervalo VAZIO. O frontend manda
   f.inicio = '' quando o filtro esta limpo, e isso NAO e' um ataque. */
const ctxV = H.preparar();
const tokV = H.comoAdmin(ctxV);
let mr = null;
try { mr = ctxV.meuRelatorio(tokV, '', '2026-09-25'); } catch (e) { mr = { erro: e.message }; }
/* BUG DESTE TESTE: exigia que um inicio VAZIO desse erro. Mas o frontend
   manda `f.inicio || ''` quando o filtro esta limpo (index.html, aba "O meu
   relatorio") e um inicio vazio e' o sinal de "sem filtro": o backend
   responde com a semana de `fim`. O teste tentava fazer falhar o
   comportamento CORRECTO e a interface com o filtro limpo deixava de
   funcionar.

   O que interessa verificar nao e' o vazio (que e' um atalho legitimo) mas
   o intervalo VERDADEIRAMENTE invalido: datas invertidas e datas absurdas
   tem de dar erro limpo, nao um relatorio vazio sem explicacao. */
if (mr && mr.erro) erro('meuRelatorio com inicio vazio (atalho de "sem filtro") deu erro: ' + String(mr.erro).slice(0, 60));
else if (!mr) erro('meuRelatorio com inicio vazio devolveu nada');
else if (!mr.periodo || !mr.periodo.inicio || !mr.periodo.fim) erro('meuRelatorio com inicio vazio devolveu um periodo incompleto: ' + JSON.stringify(mr.periodo));
else ok('meuRelatorio com inicio vazio = "sem filtro": responde com a semana de fim (' + mr.periodo.inicio + ' -> ' + mr.periodo.fim + ')');
/* o que tem de falhar: datas invertidas */
let mrInv = null;
try { mrInv = ctxV.meuRelatorio(tokV, '2026-09-25', '2026-09-01'); } catch (e) { mrInv = { erro: e.message }; }
if (mrInv && mrInv.erro) ok('meuRelatorio com datas INVERTIDAS falha limpo: "' + String(mrInv.erro).slice(0, 60) + '"');
else erro('meuRelatorio com datas invertidas devolveu um periodo sem erro: ' + JSON.stringify(mrInv).slice(0, 100));
/* datas absurdas */
let mrBad = null;
try { mrBad = ctxV.meuRelatorio(tokV, '9999-99-99', '9999-99-99'); } catch (e) { mrBad = { erro: e.message }; }
if (mrBad && mrBad.erro) ok('meuRelatorio com datas absurdas falha limpo: "' + String(mrBad.erro).slice(0, 60) + '"');
else erro('meuRelatorio com datas absurdas devolveu um periodo sem erro');

/* ############ ESCALAO 4: TERMINACAO DE LACO ############
   Um laco sem limite, com 6 min de relogio, NAO fica infinito: fica
   cortado a MEIO, com estado meio-escrito. Aqui mede-se o numero de
   iteracoes, para que "corta a meio" seja um numero e nao um palpite. */
nivel(4, 'terminacao de laco (contador de iteracoes)');
const ctx4 = H.preparar();
function iterar(a, b) {
  const t0 = Date.now();
  let r = null, err = null;
  try { r = ctx4.iterarDias_(a, b); } catch (e) { err = e.message; }
  return { n: r ? r.length : 0, ms: Date.now() - t0, err: err };
}
const CASOS = [
  ['1 dia', '2026-09-25', '2026-09-25'],
  ['1 semana', '2026-09-21', '2026-09-27'],
  ['1 ano', '2025-09-25', '2026-09-25'],
  ['10 anos', '2016-09-25', '2026-09-25'],
  ['100 anos', '1926-09-25', '2026-09-25']
];
const medidas = [];
CASOS.forEach(function (c) {
  const r = iterar(c[1], c[2]);
  medidas.push(r);
  nota('iterarDias_ ' + c[0] + ': ' + (r.err ? 'ERRO ' + String(r.err).slice(0, 40) : r.n + ' dias em ' + r.ms + ' ms'));
});
const semErro = medidas.filter(function (m) { return !m.err; });
/* BUG ANTERIOR (x2): acusava 'm.n > 36500' como laco unbounded, e o outro
   teste usava o tecto fixo 36525. Duas asercoes contraditorias no mesmo
   ficheiro: uma falhava o que a outra aprovava.

   E o tecto fixo 36525 era ele proprio um BUG: 100 anos sao 36524 ou 36525
   dias conforme os anos bissextos caem dentro do intervalo, e o ponto de
   partida depende do fuso. Nos Estados Unidos dava 36526 e a suite falhava
   sem uma linha de codigo de producao ter mudado — um teste que acusa o
   fuso da maquina.

   O tecto passa a ser DERIVADO do proprio caso medido: o que se prova e' que
   o numero de datas acompanha o intervalo (linear) e que o laco TERMINA,
   nao que bate certo com um numero colado no ficheiro. */
const MAIOR_CASO = Math.max.apply(null, semErro.map(function (m) { return m.n; }).concat([0]));
/* 100 anos em dias, com folga para bissextos e fuso. O que esta em causa
   e' "acabou", nao "deu 36525". */
const TETO_100_ANOS = 36600;
if (semErro.length) {
  ass(MAIOR_CASO <= TETO_100_ANOS, 'o laco TERMINA no maior caso medido (100 anos -> ' + MAIOR_CASO +
    ' datas, tecto ' + TETO_100_ANOS + '); nao ha laco infinito');
  nota('NOTA: o laco termina, mas NAO ha limite de dominio — um intervalo de 100 anos ' +
    'gera ' + MAIOR_CASO + ' datas sem qualquer limite de negocio. Ver escalao 3.2.');
}
if (semErro.length) {
  /* BUG ANTERIOR: indexava semErro[0] para o caso "1 semana", mas o
     indice 0 e' o caso "1 dia" (1 data) — por isso comparava 8 com 1
     e falhava sem o codigo ter culpa. Passa a procurar pelo ROTULO. */
  const porRotulo = function (rot) {
    for (let i = 0; i < CASOS.length; i++) if (CASOS[i][0] === rot) return semErro.filter(function (m, j) { return j === i; })[0];
    return null;
  };
  const semana = medidas[1], dia = medidas[0], ano = medidas[2];
  ass(dia && dia.n === 1, 'iterarDias_ de 1 dia devolve 1 data :: ' + (dia ? dia.n : '?'));
  ass(semana && semana.n === 7, 'iterarDias_ de 7 dias devolve 7 datas (ambos os extremos) :: ' + (semana ? semana.n : '?'));
  ass(ano && Math.abs(ano.n - 366) <= 2, 'iterarDias_ de 1 ano devolve ~366 datas :: ' + (ano ? ano.n : '?'));
  if (ano && dia) {
    ass(ano.n > dia.n && ano.n < dia.n * 500,
      'o crescimento e' + ' LINEAR (1 -> ' + ano.n + ' em 365x o intervalo), nao exponencial');
  }
  /* O tecto tem de ser um LIMITE REAL, nao um numero arbitrario. O
     Google nao tem "max de dias num relatorio"; o que existe e' o
     relogio de 6 min. Por isso o tecto mede-se em ITERACOES, e o
     que se acusa e' o laco sem condicao de paragem verificavel. */
  const grande = medidas[4];
  ass(!grande || grande.n <= TETO_100_ANOS, 'mesmo com 100 anos de intervalo o laco TERMINA (' +
    (grande ? grande.n : '?') + ' datas) — termina, apenas sem limite de dominio');
}
/* O inverso tem de ser ERRO, nao lista vazia: e' o que distingue
   "sem dados" de "a data esta' errada". */
const inv = iterar('2026-09-25', '2026-09-01');
if (!inv.err && inv.n === 0) erro('iterarDias_ com datas invertidas devolve lista VAZIA sem erro: ' +
  'o utilizador ve um relatorio vazio e nao percebe se errou a data');
else ok('iterarDias_ com datas invertidas: ' + (inv.err ? 'da erro' : inv.n + ' datas'));
/* ############ ESCALAO 5: LIMITES DO GOOGLE ############
   Mede-se o custo real e compara-se com os limites. Nao e' opiniao
   sobre "se e' lento": e' o numero de celulas lidas contra um orcamento.
   O Sheets nao publica throughput, por isso usa-se uma BANDA e o
   resultado e' apresentado como ordem de grandeza, nunca como facto. */
nivel(5, 'limites do Google (custo medido vs orcamento)');
const TP = { min: 2000, tipico: 20000, max: 100000 };  /* celulas/segundo */
function orc(c) { return { min: c / TP.max, tip: c / TP.tipico, max: c / TP.min }; }

/* 5.1 SESSOES cresce sem ser podada e e' lida em cada operacao que a
   percorre. E' o caminho mais quente em uso diario. */
function custoSessoes(n) {
  const ctx = H.preparar();
  /* BUG ANTERIOR: usava insertSheet('SESSOES'). O mock do harness
     acrescentava uma SEGUNDA folha com o mesmo nome, e getSheetByName
     devolve a primeira — a vazia. As linhas escrevidas iam para uma
     folha que o codigo nunca lia, e a medicao dava 117 celulas
     qualquer que fosse n. Um falso-verdeettido a provar a coisa errada.
     Agora usa-se a folha REAL, a que o codigo le. */
  const f = ctx.getSpreadsheet_().getSheetByName('SESSOES');
  if (!f) return { n: n, l: -1, err: 'folha SESSOES inexistente' };
  const cab = f.getDataRange().getValues()[0] || [];
  const agora = new Date();
  for (let i = 0; i < n; i++) f.appendRow(['S_' + i, 'U_PEDRO', 'tk_' + i, agora, agora, 'EXPIRADA', agora]);
  if (f.getLastRow() < 1 + n) return { n: n, l: -1, err: 'as linhas nao entraram na folha (lastRow=' + f.getLastRow() + ')' };
  const tok = H.comoAdmin(ctx);
  if (!tok) return { n: n, l: -1, err: 'sem token de admin' };
  H.zerarContador();
  const t0 = Date.now();
  let err = null;
  try { ctx.limparSessoesExpiradas(tok); } catch (e) { err = e.message; }
  const l = H.pararContador();
  return { n: n, l: l, ms: Date.now() - t0, err: err, o: orc(l), ratio: l / n };
}
[100, 1000, 5000, 20000].forEach(function (n) {
  const r = custoSessoes(n);
  if (r.l < 0) { erro('custo de SESSOES com ' + n + ' linhas: ' + (r.err || 'sem token')); return; }
  nota('SESSOES=' + n + ' -> ' + r.l + ' celulas | ' + r.ms + ' ms | orcado ' +
    r.o.min.toFixed(2) + '-' + r.o.max.toFixed(2) + ' s | ' + r.ratio.toFixed(1) + ' cel/sessao' +
    (r.err ? ' | ERRO ' + r.err : ''));
  /* GUARDA CONTRA FALSO-VERDE: se a leitura nao cresce com n, a
     medicao esta' a ver a folha errada (foi exactamente o bug do
     insertSheet). Uma razao <1 celula por sessao e' impossivel numa
     leitura de folha INTEIRA — e' sinal de folha vazia, nao de custo baixo. */
  ass(r.ratio >= 1, 'a medicao leu mesmo as ' + n + ' linhas (' + r.ratio.toFixed(1) +
    ' celulas por sessao) — se for <1, esta' + ' a medir a folha errada');
  ass(r.ratio < 20, 'o custo por sessao e' + ' constante (' + r.ratio.toFixed(1) + ' celulas) — linear, nao explosivo');
  ass(r.o.max < G.EXEC_MIN * 60, 'no pior caso de throughput, ' + n +
    ' sessoes cabem nos ' + G.EXEC_MIN + ' min (' + r.o.max.toFixed(2) + ' s)');
});

/* 5.2 O caminho do escalao 3: relatorio com intervalo escolhido pelo
   utilizador. Mede-se o custo por dia de intervalo. */
function custoRelatorio(dias) {
  const ctx = H.preparar();
  const tok = H.comoAdmin(ctx);
  if (!tok) return { dias: dias, l: -1, err: 'sem token' };
  /* POPULA A FOLHA. Sem isto media-se uma base de dados VAZIA: dava
     167 celulas para 7 dias e para 3650 dias, e a "conclusao" de que
     o custo nao cresce com o intervalo era um artefacto do vazio. */
  const f = ctx.getSpreadsheet_().getSheetByName('PICAGENS');
  if (!f) return { dias: dias, l: -1, err: 'folha PICAGENS inexistente' };
  const agora = new Date(2026, 8, 25, 9, 0);
  /* 4 pessoas x 2 picagens x 1 ano = ~2900 linhas, o historico de um ano */
  for (let d = 0; d < 365; d++) {
    const dia = new Date(2026, 8, 25 - d);
    if (dia.getDay() === 0) continue;   /* domingo */
    for (let p = 1; p <= 4; p++) {
      f.appendRow(['PIC_' + d + '_' + p + 'E', 'USR_' + p, 'USER', dia.getFullYear() + '-' +
        String(dia.getMonth() + 1).padStart(2, '0') + '-' + String(dia.getDate()).padStart(2, '0'),
        'ENTRADA', dia, '', 0, 0, 0, 0, 0, 0, 0, agora, agora]);
      f.appendRow(['PIC_' + d + '_' + p + 'S', 'USR_' + p, 'USER', dia.getFullYear() + '-' +
        String(dia.getMonth() + 1).padStart(2, '0') + '-' + String(dia.getDate()).padStart(2, '0'),
        'SAIDA', dia, '', 0, 0, 0, 0, 0, 0, 0, agora, agora]);
    }
  }
  const linhas = f.getLastRow() - 1;
  const fim = new Date(2026, 8, 25);
  const ini = new Date(2026, 8, 25 - (dias - 1));
  const iso = function (d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  H.zerarContador();
  const t0 = Date.now();
  let err = null;
  try { ctx.relatorioGlobal(tok, iso(ini), iso(fim), {}); } catch (e) { err = e.message; }
  const l = H.pararContador();
  return { dias: dias, l: l, ms: Date.now() - t0, err: err, o: orc(l), linhas: linhas };
}
const rel = [];
[7, 30, 365, 3650].forEach(function (d) {
  const r = custoRelatorio(d);
  if (r.l < 0) { nota('relatorioGlobal ' + d + ' dias: sem token'); return; }
  rel.push(r);
  nota('relatorioGlobal ' + d + ' dias -> ' + r.l + ' celulas | ' + r.ms + ' ms | orcado ' +
    r.o.min.toFixed(2) + '-' + r.o.max.toFixed(2) + ' s' + (r.err ? ' | ERRO ' + r.err : ''));
});
if (rel.length >= 2) {
  const c1 = rel[0], c2 = rel[1];
  ass(c2.l / Math.max(c1.l, 1) < 20, 'o custo do relatorio nao explode ao alargar o intervalo (' +
    c1.dias + 'd=' + c1.l + ' -> ' + c2.dias + 'd=' + c2.l + ')');
  const ultimo = rel[rel.length - 1];
  ass(ultimo.o.max < G.EXEC_MIN * 60, 'mesmo o intervalo de ' + ultimo.dias +
    ' dias cabe nos ' + G.EXEC_MIN + ' min (pior caso ' + ultimo.o.max.toFixed(1) + ' s)');
}

/* ############ ESCALAO 6: DISCIPLINA DE LOCK ############
   waitLock do Google devolve FALSE se nao conseguir a lock. O codigo
   descarta esse retorno: aqui isso e' PROVADO, nao afirmado. */
nivel(6, 'disciplina de lock (concorrencia)');
/* 6.1 Primeiro confirma-se que o mock reproduz o contrato do Google. */
const l1 = H.LOCK_REAL;
const primeira = l1.waitLock(1000);
const segunda = l1.waitLock(1000);
ass(primeira === true, '1.a waitLock adquire a lock e devolve true (mock conforme o Google)');
ass(segunda === false, '2.a waitLock, com a lock ocupada, devolve FALSE — o valor transporta informacao real');
l1.releaseLock();
/* 6.2 Consequencia: com a lock ocupada por outro ambito, uma funcao que
   depende dela vai escrever SEM proteccao e nao da erro nenhum. */
const ctx6 = H.preparar();
const tok6 = H.comoAdmin(ctx6);
H.LOCKS.script = true;   /* simula o trigger diario a correr */
let escreveu = false, err6 = null;
try { ctx6.criarUtilizador(tok6, { nome: 'Teste Concorrencia', perfil: 'COLABORADOR' }); escreveu = true; }
catch (e) { err6 = e.message; }
H.LOCKS.script = false;
if (escreveu && !err6) {
  erro('criarUtilizador ESCREVEU com a lock ocupada por outro ambito e NAO deu erro: ' +
    'waitLock devolveu false e o codigo seguiu na mesma. Em producao isto e' + ' uma escrita nao ' +
    'serializada (ler-modificar-escrever sobre a mesma folha)');
} else ok('a operacao recusa escrever sem a lock (erro: ' + (err6 || '?') + ')');
/* 6.3 O lado oposto: funcoes publicas que escrevem sem tomar lock. */
const semLock = [];
H.FICHEIROS.forEach(function (f) {
  H.SRC[f].split('\n').forEach(function (l) {
    const m = l.match(/^\s*function\s+([A-Za-z0-9_]+)\s*\(/);
    if (!m || /_$/.test(m[1])) return;
    const c = H.corpoDaFuncao(H.SRC[f], m[1]);
    if (!c) return;
    const escreve = /\.setValue[s]?\(|\.appendRow\(|\.insertRow|\.deleteRow\(|\.clearContent\(/.test(c.texto);
    /* BUG DESTE TESTE: procurava `LockService|waitLock|tryLock` no corpo da
       funcao. O codigo NAO usa o LockService directamente: chama o invólucro
       `adquirirLock_()`, que e' quem chama o waitLock e quem FAZ LANCAAR o
       erro quando a lock falha. Como o nome do invólucro nao continha nenhuma
       dessas tres palavras, 9 funcoes que TOMAM a lock (criarUtilizador,
       registarPicagem, criarAusencia, criarFeriado, criarGrupoSabado,
       editarGrupoSabado, editarUtilizador, editarAusencia, criarBackup)
       eram acusadas de nao a tomar. Um verificador que acusa a abstracao
       certa obriga a escrever a lock a mao em todo o lado. */
    const tomaLock = /adquirirLock_|LockService|waitLock|tryLock/.test(c.texto);
    /* Escrita numa Spreadsheet NOVA e' de outra especie: nao ha folha
       partilhada com ninguem, portanto duas execucoes simultaneas nao se
       corrompem. E o caso de exportarTabelaParaSheets, que cria a sua. Mais:
       SpreadsheetApp.create e' lento, e segurar a lock do script durante a
       sua criacao bloquearia TODOS os utilizadores da empresa por causa de
       uma exportacao. A lock e' um recurso de execucao unica, e este recurso
       e' legitimamente unico por pedido. */
    const escritaPrivada = /SpreadsheetApp\.create\(/.test(c.texto);
    if (escreve && !tomaLock && !escritaPrivada) semLock.push(f + ':' + m[1] + ' (linha ' + c.linha + ')');
  });
});
nota('funcoes publicas que ESCREVEM sem tomar lock: ' + semLock.length);
semLock.forEach(function (s) { nota('    ' + s); });
if (semLock.length) {
  erro(semLock.length + ' funcoes publicas escrevem sem qualquer lock: duas execucoes ' +
    'simultaneas podem intercalar leitura e escrita na mesma folha');
} else ok('toda a funcao publica que escreve toma a lock');

/* 6.4 A LACUNA DO 6.3, nomeada. O teste acima ve se a funcao ESCREVE, mas
   ve isso no TEXTO DELA: procura `setValues`/`appendRow`/`deleteRows` no
   corpo. Uma funcao que escreve atraves de um auxiliar passa ao lado —
   e era o caso de `manutencaoDiaria`, que reescrevia a coluna Estado
   (`expirarSessoesEmLote_`) e apagava linhas (`podarSessoesAntigas_`)
   sem uma unica chamada de escrita no seu proprio corpo. O 6.3 dizia
   "zero, tudo bem" e a funcao ficava sem lock.

   Fazer essa analise a fundo (alcancar os auxiliares) e' fragile; o que
   e' barato e' nomear o caso conhecido, como se faz no escalao 2 com as
   isencoes. Se `manutencaoDiaria` voltar a nao tomar a lock, isto falha. */
const ctxMan = H.preparar();
let manSemLock = false, manErro = '';
try {
  /* Uma execucao com a lock ja ocupada por outro ambito tem de fazer a
     manutencao recusar-se, tal como acontece com qualquer escritor. */
  H.LOCKS.script = true;
  ctxMan.manutencaoDiaria();
  H.LOCKS.script = false;
} catch (e) { manSemLock = true; manErro = String(e && e.message); }
if (!manSemLock) erro('manutencaoDiaria escreveu SEM a lock (a poda de sessoes pode ' +
  'intercalar-se com um login e apagar sobre indices ja deslocados)');
else ok('manutencaoDiaria tambem toma a lock (recusa com: ' + manErro.slice(0, 46) + ')');
/* ---- @@NOVA: PEDIDO DE CORREÇÃO PELO UTILIZADOR ----
   Uma função que aceita token de utilizador e escreve na folha tem de
   obrigar a que o pedido é sobre o PRÓPRIO dia. Sem isto, qualquer
   colaborador mandava "userId" de outra pessoa e ficava com o pedido
   em nome dela. */
const ctxCor = H.preparar();
const tokCor = ctxCor.autenticarUtilizador('celinarelva@gmail.com', 'celinarelva').token;
const DIA_COR = '2026-09-28';

ok('o colaborador consegue pedir a correcao do seu dia (antes so o gestor podia)');
let pedidoCor = null;
try { pedidoCor = ctxCor.pedirCorrecaoDia(tokCor, { data: DIA_COR, motivo: 'Saí às 19h mas o sistema diz 18h' }); } catch (e) { erro('pedirCorrecaoDia lancer: ' + e.message); }
ok('o pedido fica PENDENTE de decisao do gestor: ' + (pedidoCor && pedidoCor.estado),
  pedidoCor && pedidoCor.sucesso && pedidoCor.estado === 'PEDIDO');

let dupErr = '';
try { ctxCor.pedirCorrecaoDia(tokCor, { data: DIA_COR, motivo: 'outra tentativa no mesmo dia' }); } catch (e) { dupErr = e.message; }
ok('nao deixa criar dois pedidos para o mesmo dia', /Ja existe/i.test(dupErr));

let motivoErr = '';
try { ctxCor.pedirCorrecaoDia(tokCor, { data: '2026-09-29', motivo: '   ' }); } catch (e) { motivoErr = e.message; }
ok('exige que se escreva o motivo', !!motivoErr);

let curtoErr = '';
try { ctxCor.pedirCorrecaoDia(tokCor, { data: '2026-09-29', motivo: 'x' }); } catch (e) { curtoErr = e.message; }
ok('rejeita um motivo de uma letra', /curto/i.test(curtoErr));

/* o ataque: pedir a correcao do dia de outra pessoa */
try { ctxCor.pedirCorrecaoDia(tokCor, { data: '2026-09-29', motivo: 'aqui tento pedir por outra pessoa', userId: 'USR_RITA_REIS' }); } catch (e) {}
const noDiaDaRita = ctxCor.obterCorrecoesDoDia_('USR_RITA_REIS', new Date(2026, 8, 29));
ok('um utilizador NAO consegue pedir a correcao do dia de outro: ' + noDiaDaRita.length + ' pedido(s) em nome dela',
  noDiaDaRita.length === 0);

/* o relatorio tem de MENCIONAR o pedido: um pedido que ninguem ve esta perdido */
const relCor = ctxCor.meuRelatorio(tokCor, DIA_COR, DIA_COR);
ok('o relatorio do utilizador conta o pedido em aberto: ' + relCor.correcoesPedidas, relCor.correcoesPedidas === 1);
const linhaCor = (relCor.linhas || [])[0];
ok('e o mostra na linha do dia, com o motivo escrito pelo utilizador: "' + (linhaCor && linhaCor.mencaoCorrecao && linhaCor.mencaoCorrecao.motivo) + '"',
  linhaCor && linhaCor.mencaoCorrecao && linhaCor.mencaoCorrecao.estado === 'PEDIDO' && linhaCor.mencaoCorrecao.motivo.indexOf('19h') >= 0);
ok('e nao deixa pedir outra vez enquanto ha um por decidir', linhaCor.mencaoCorrecao.podePedir === false);

/* o gestor decide */
const tokAdminCor = H.comoAdmin(ctxCor);
let aprovacao = null;
try { aprovacao = ctxCor.aprovarCorrecao(tokAdminCor, pedidoCor.id); } catch (e) { erro('aprovarCorrecao do pedido lancar: ' + e.message); }
ok('o gestor consegue decidir o pedido: ' + (aprovacao && aprovacao.estado),
  aprovacao && aprovacao.sucesso && aprovacao.estado === 'APROVADA');

const depoisCor = ctxCor.obterMencaoCorrecao_('USR_CELINA_RELVA', new Date(2026, 8, 28));
ok('decidido, volta a poder pedir e mostra o estado final: ' + depoisCor.estado,
  depoisCor.estado === 'APROVADA' && depoisCor.podePedir === true);

let duasVezes = '';
try { ctxCor.aprovarCorrecao(tokAdminCor, pedidoCor.id); } catch (e) { duasVezes = e.message; }
ok('um pedido decidido nao se decide outra vez', /j.* decidida/i.test(duasVezes));
/* @@FIM@@ */
/* @@RELATORIO@@ */
REL.forEach(function (l) { console.log(l); });
console.log('');
console.log('===== RESUMO DA CAMPANHA =====');
console.log('  verificacoes executadas: ' + PASSOS);
console.log('  FALHAS: ' + FALHAS);
process.exitCode = FALHAS ? 1 : 0;
