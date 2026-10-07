/* ============================================================
   EXCEÇÕES / GESTÃO ADMINISTRATIVA
   ============================================================ */

function obterExcecoesDoDia_(data,userId){
  const f=dadosFolha_(SHEETS.EXCECOES);if(!f.sheet||f.valores.length<2)return [];
  const iso=formatarDataISO_(data),dados=f.valores,mapa=f.mapa;
  return dados.slice(1).filter(function(l){return valorDataISO_(l[mapa.Data])===iso&&(!userId||String(l[mapa.UserID])===String(userId));}).map(function(l){return {id:l[mapa.ID],data:l[mapa.Data],userId:l[mapa.UserID],nome:l[mapa.Nome],tipo:l[mapa.Tipo],descricao:l[mapa.Descricao],prioridade:l[mapa.Prioridade],estado:l[mapa.Estado],observacoes:l[mapa.Observacoes]};});
}

/* Só as exceções por resolver, a partir da folha em cache. A versão
   anterior lia a folha inteira de EXCECOES de novo, já depois do painel
   a ter lido — a mesma folha, duas vezes, na mesma chamada. */
function listarExcecoesPendentes_() {
  const f = dadosFolha_(SHEETS.EXCECOES);
  if (!f.sheet || f.valores.length < 2) return [];
  const mapa = f.mapa;
  return f.linhas.filter(function (l) { return String(l[mapa.Estado]) === 'PENDENTE'; }).map(function (l) {
    return { id: l[mapa.ID], data: l[mapa.Data], userId: l[mapa.UserID], nome: l[mapa.Nome], tipo: l[mapa.Tipo], descricao: l[mapa.Descricao], prioridade: l[mapa.Prioridade] };
  });
}

function obterExcecoesPendentes(token) {
  exigirAdmin_(token);
  return listarExcecoesPendentes_();
}

function decidirExcecao(token,id,estado,observacoes){
  const s=exigirAdmin_(token);
  const lock=adquirirLock_(15000);
  try{
    const info=obterLinhaPorId_(SHEETS.EXCECOES,id);if(!info)throw new Error('Exceção não encontrada.');if(String(info.values[info.mapa.Estado])!=='PENDENTE')throw new Error('Exceção já decidida.');
    const agora=new Date();info.sheet.getRange(info.row,info.mapa.Estado+1).setValue(estado);info.sheet.getRange(info.row,info.mapa.ResolvidoEm+1).setValue(agora);info.sheet.getRange(info.row,info.mapa.ResolvidoPor+1).setValue(s.userId);info.sheet.getRange(info.row,info.mapa.Observacoes+1).setValue(observacoes||'');registarAuditoriaSegura_(s,'DECIDIR_EXCECAO',id+' -> '+estado);return {sucesso:true,id:id,estado:estado};
  }finally{lock.releaseLock();}
}

function obterUtilizadoresAtivos_(){return obterUtilizadores_().filter(function(u){return u.Estado===ENUMS.ESTADOS_UTILIZADOR.ATIVO;});}


/* Separado de determinarEstadoOperacionalUtilizador_ para que o painel
   possa reaproveitar um dia JÁ calculado em vez de o pedir outra vez. */
function determinarEstadoOperacionalDe_(r) {
  /* Dia que nao calculou: mostrar "SEM_PICAGEM" seria mentira — parece
     que a pessoa nao picou nada, quando nao sabemos. O gestor tem de
     ver que o DIA esta quebrado, nao que a pessoa falhou. */
  if (r && r.erroCalculo) return 'ERRO_CALCULO';
  const p = (r && r.picagens) || [];
  if (!p.length) return 'SEM_PICAGEM';
  const ultimo = p[p.length - 1];
  if (ultimo.tipo === ENUMS.TIPOS_PICAGEM.ENTRADA_MANHA || ultimo.tipo === ENUMS.TIPOS_PICAGEM.ENTRADA_TARDE) return 'A_TRABALHAR';
  if (ultimo.tipo === ENUMS.TIPOS_PICAGEM.SAIDA_MANHA) return 'INTERVALO';
  if (ultimo.tipo === ENUMS.TIPOS_PICAGEM.SAIDA_TARDE) return 'TERMINOU';
  return 'REGISTADO';
}

/* O painel e o resumo precisavam do MESMO calcularDia_() por utilizador.
   Antes cada um fazia a sua volta: 2 x N leituras de PICAGENS,
   EXCECOES, AUSENCIAS, FERIADOS, CONFIG_SABADOS e HORAS_EXTRA, e o
   resumo ainda apanhava a cache já limpa pelo painel. Agora calcula-se
   uma vez por utilizador e os dois blocos partilham o resultado.

   Um utilizador com dados corrompidos (uma correção aprovada órfã, uma
   hora inválida escrita à mão) fazia o calcularDia_() lançar. Como esta
   função corre para TODOS os utilizadores, isso deixava o gestor sem
   painel nenhum: nem os outros utilizadores, nem os totais — o separador
   inteiro caía por causa de UMA pessoa. Fica o registo do problema, o
   resto do painel é mostrado, e o dia fica marcado para o gestor ver. */
function calcularDiasDeUtilizadores_(utilizadores, d) {
  return utilizadores.map(function (u) {
    try {
      return { u: u, r: calcularDia_(u.ID, d) };
    } catch (erro) {
      registarErro_('calcularDiasDeUtilizadores_', erro, u.ID, {
        data: formatarDataISO_(d), nome: u.Nome, profissional: u.Profissao
      });
      return { u: u, erroDia: true, r: diaVazioComFalha_(u, d, erro) };
    }
  });
}

/* Dia "a zeros" para um utilizador cujo cálculo falhou: mantém o formato
   que o painel e o resumo esperam, para não partirem um segundo sitio. */
function diaVazioComFalha_(u, d, erro) {
  return {
    data: formatarDataISO_(d), userId: u.ID, nome: u.Nome, tipoDia: 'INDISPONIVEL',
    horarioNormal: null, picagens: [], excecoes: [],
    minutosPlaneados: 0, minutosTrabalhados: 0, minutosNormais: 0,
    minutosExtra: 0, extraAprovado: 0,
    horasPlaneadas: '0:00', horasTrabalhadas: '0:00', horasNormais: '0:00',
    horasExtra: '0:00', horasExtraAprovadas: '0:00',
    estado: 'ERRO_CALCULO', erroCalculo: String(erro && erro.message || erro)
  };
}

function obterPainelAdministrativoHoje(token, data) {
  const s = exigirAdmin_(token), d = normalizarData_(data || new Date());
  limparCacheFolhas_();
  const utilizadores = calcularDiasDeUtilizadores_(obterUtilizadoresAtivos_(), d).map(function (x) {
    const u = x.u, r = x.r;
    return { userId: u.ID, nome: u.Nome, profissao: u.Profissao, perfil: u.Perfil, tipoDia: r.tipoDia, estadoOperacional: determinarEstadoOperacionalDe_(r), horasPlaneadas: r.horasPlaneadas, horasTrabalhadas: r.horasTrabalhadas, horasNormais: r.horasNormais, horasExtra: r.horasExtra, horasExtraAprovadas: r.horasExtraAprovadas, picagens: r.picagens, excecoes: r.excecoes, estado: r.estado };
  });
  return serializarParaFrontend_({ sucesso: true, data: formatarDataISO_(d), utilizadores: utilizadores });
}

function obterResumoAdministrativoDia(token, data) {
  const s = exigirAdmin_(token), d = normalizarData_(data || new Date());
  return resumoAdministrativoDiaDe_(calcularDiasDeUtilizadores_(obterUtilizadoresAtivos_(), d), d);
}

function resumoAdministrativoDiaDe_(calculos, d) {
  let p = 0, t = 0, n = 0, e = 0, a = 0;
  const detalhes = [];
  calculos.forEach(function (x) {
    const u = x.u, r = x.r;
    p += r.minutosPlaneados; t += r.minutosTrabalhados; n += r.minutosNormais;
    e += r.minutosExtra; a += r.extraAprovado;
    detalhes.push({ userId: u.ID, nome: u.Nome, horasPlaneadas: r.horasPlaneadas, horasTrabalhadas: r.horasTrabalhadas, horasNormais: r.horasNormais, horasExtra: r.horasExtra, horasExtraAprovadas: r.horasExtraAprovadas });
  });
  return { sucesso: true, data: formatarDataISO_(d), totalHorasPlaneadas: minutosParaHora_(p), totalHorasTrabalhadas: minutosParaHora_(t), totalHorasNormais: minutosParaHora_(n), totalHorasExtra: minutosParaHora_(e), totalHorasExtraAprovadas: minutosParaHora_(a), detalhes: detalhes };
}

/* Contagens de pendentes: uma leitura por folha em vez de
   getLastRow() + getDataRange() + getMapaColunas() (duas leituras). */
function contarPendentes_(nomeFolha) {
  const f = dadosFolha_(nomeFolha);
  if (!f.sheet || f.valores.length < 2) return 0;
  return f.linhas.filter(function (l) { return String(l[f.mapa.Estado] || '') === 'PENDENTE'; }).length;
}
function obterPendentesAdministrativos(token) {
  exigirAdmin_(token);
  return { horasExtra: contarPendentes_(SHEETS.HORAS_EXTRA), justificacoes: contarPendentes_(SHEETS.JUSTIFICACOES), correcoes: contarPendentes_(SHEETS.CORRECOES), excecoes: contarPendentes_(SHEETS.EXCECOES) };
}

/* (a versão antiga, inline e sem cache, foi removida: duplicava a
   função acima e, em JavaScript, a ÚLTIMA declaração ganha — ou seja,
   era a versão lenta que continuava a ser executada.) */

/* O separador "Painel" pede isto e é o ecrã que o gestor abre mais vezes.
   Antes chamava obterPainelAdministrativoHoje() + obterResumoAdministrativoDia()
   e cada um calculava o dia de TODOS os utilizadores: o dobro do trabalho.
   Aqui calcula-se uma única vez e os dois blocos saem da mesma lista.
   As contagens de pendentes e as exceções vêm da mesma cache de folhas. */
function obterDashboardAdministrativo(token, data) {
  exigirAdmin_(token);
  const d = normalizarData_(data || new Date());
  limparCacheFolhas_();
  const calculos = calcularDiasDeUtilizadores_(obterUtilizadoresAtivos_(), d);

  const painel = calculos.map(function (x) {
    const u = x.u, r = x.r;
    return { userId: u.ID, nome: u.Nome, profissao: u.Profissao, perfil: u.Perfil, tipoDia: r.tipoDia, estadoOperacional: determinarEstadoOperacionalDe_(r), horasPlaneadas: r.horasPlaneadas, horasTrabalhadas: r.horasTrabalhadas, horasNormais: r.horasNormais, horasExtra: r.horasExtra, horasExtraAprovadas: r.horasExtraAprovadas, picagens: r.picagens, excecoes: r.excecoes, estado: r.estado, erroCalculo: r.erroCalculo || '' };
  });

  const resumo = resumoAdministrativoDiaDe_(calculos, d);
  const pendentes = { horasExtra: contarPendentes_(SHEETS.HORAS_EXTRA), justificacoes: contarPendentes_(SHEETS.JUSTIFICACOES), correcoes: contarPendentes_(SHEETS.CORRECOES), excecoes: contarPendentes_(SHEETS.EXCECOES) };
  const excecoesPendentes = listarExcecoesPendentes_();

  return serializarParaFrontend_({ sucesso: true, data: formatarDataISO_(d), painel: painel, resumo: resumo, pendentes: pendentes, excecoesPendentes: excecoesPendentes });
}

function obterResumoColaborador(token,userId,data){const s=exigirSessao_(token);if(s.perfil!==ENUMS.PERFIS.ADMIN&&String(s.userId)!==String(userId))throw new Error('Sem autorização.');const u=obterUtilizadorPorId_(userId);if(!u)throw new Error('Utilizador não encontrado.');return serializarParaFrontend_({sucesso:true,utilizador:u,dia:calcularDia_(userId,data||new Date())});}

/* ============================================================
   FUNÇÕES DE DIAGNÓSTICO / TESTES
   ============================================================ */

function testeCalculoInterno_(descricao,picagens,horario,esperadoNormal,esperadoExtra){
  const intervalos=construirIntervalosTrabalho_(picagens),c=calcularNormalEExtra_(intervalos,horario),ok=c.minutosNormais===esperadoNormal&&c.minutosExtra===esperadoExtra;return {teste:descricao,resultado:ok?'OK':'FALHOU',esperado:'normal '+esperadoNormal+' / extra '+esperadoExtra,obtido:'normal '+c.minutosNormais+' / extra '+c.minutosExtra};
}


function testesMotorCompleto_(){
  const d=new Date(2026,8,18),sem=APP.HORARIO.SEMANA,sab=APP.HORARIO.SABADO;const out=[];
  function P(tipo,h,m){return {tipo:tipo,dataHora:criarDataHora_(d,h,m)};}
  out.push(testeCalculoInterno_('Normal completo',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',14,30),P('SAIDA_TARDE',19,0)],sem,450,0));
  out.push(testeCalculoInterno_('Entrada antecipada',[P('ENTRADA_MANHA',9,40),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',14,30),P('SAIDA_TARDE',19,0)],sem,450,20));
  out.push(testeCalculoInterno_('Saída tardia',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',14,30),P('SAIDA_TARDE',19,25)],sem,450,25));
  out.push(testeCalculoInterno_('Intervalo trabalhado',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',13,45),P('SAIDA_TARDE',19,0)],sem,450,45));
  out.push(testeCalculoInterno_('Sábado previsto',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0)],sab,180,0));
  out.push(testeCalculoInterno_('Sábado previsto turno completo',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',14,30),P('SAIDA_TARDE',19,0)],sab,450,0));
  out.push(testeCalculoInterno_('Sábado previsto até às 20:00',[P('ENTRADA_MANHA',10,0),P('SAIDA_MANHA',13,0),P('ENTRADA_TARDE',14,30),P('SAIDA_TARDE',20,0)],sab,450,60));
  return out;
}

function diagnosticoCompleto(token){
  exigirAdmin_(token);
  return {versao:APP.VERSAO,setup:diagnosticoSetup_(),sabados:validarConfiguracaoSabados_(),testes:testesMotorCompleto_()};
}

/* ============================================================
   WEB APP — PONTO DE ENTRADA MÍNIMO
   ============================================================ */

function doGet(e) {
  try {
    /* NÃO se volta a inyectar aqui um <meta viewport>: o que for
       acrescentado pelo servidor GANHA ao <meta> do Index.html, e a
       versão antiga trazia `maximum-scale=1, user-scalable=no` — ou
       seja, voltava a bloquear o zoom em iPhone e Android, e não
       ativava o viewport-fit=cover de que dependem as zonas seguras.
       A única regra de viewport é a do Index.html. */
    return criarTemplateInterface_()
      .evaluate()
      .setTitle(APP.NOME)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (erro) {
    registarErro_('doGet', erro, '', { versao: APP.VERSAO });
    return HtmlService.createHtmlOutput(
      '<!doctype html><html lang="pt"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>' + escapeHtmlServer_(APP.NOME) + '</title></head><body style="font-family:sans-serif;padding:24px"><h2>' + escapeHtmlServer_(APP.EMPRESA) + '</h2><p>Erro ao carregar a interface. Verifique se o ficheiro Index.html existe no projeto.</p></body></html>'
    ).setTitle(APP.NOME);
  }
}

/**
 * Cria o template da interface aceitando o ficheiro como
 * 'Index' (convenção do Apps Script) ou 'index'.
 * Evita o erro de arranque quando o ficheiro HTML é criado
 * com maiúscula/minúscula diferente.
 */
function criarTemplateInterface_() {
  const nomes = ['Index', 'index'];
  let ultimoErro = null;

  for (let i = 0; i < nomes.length; i++) {
    try {
      return HtmlService.createTemplateFromFile(nomes[i]);
    } catch (erro) {
      ultimoErro = erro;
    }
  }

  throw ultimoErro || new Error('Ficheiro Index.html não encontrado no projeto.');
}

function escapeHtmlServer_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* Alias publico usado pela interface (o frontend chama
   `api('getDashboardAdministrativo')`). Os restantes aliases que aqui
   estavam — getEstadoHoje, getMeuDia, getResumoColaborador e
   getPendentesAdministrativos — nao eram chamados nem pela interface nem
   pelo resto do codigo: eram nomes duplicados de funcoes que ja existem com
   o nome certo. Cada alias publico e uma porta de entrada a mais no dispatcher
   (`google.script.run` alcanca qualquer nome), por isso fica so o que se usa. */
function getDashboardAdministrativo(token, data) { return obterDashboardAdministrativo(token, data); }

