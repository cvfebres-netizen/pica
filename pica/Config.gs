/* ============================================================
   SISTEMA DE PICAGEM DE PONTO
   Centro Veterinário de Febres
   CODE.GS — FASES 1–7 REESTRUTURADAS

   PRINCÍPIOS:
   - PICAGENS são sempre a fonte factual e nunca são apagadas.
   - CORRECOES são um overlay auditado; só APROVADAS entram no cálculo.
   - CONFIG/CONFIG_SABADOS definem regras, não escalas manuais.
   - HORAS_EXTRA separa extra CALCULADA de extra APROVADA.
   - O motor central calcula normal, extra e exceções a partir das
     PICAGENS EFETIVAS.
   - Europe/Lisbon.
   ============================================================ */

const APP = {
  NOME: 'Sistema de Picagem de Ponto',
  EMPRESA: 'Centro Veterinário de Febres',
  VERSAO: '1.2.0',
  TIMEZONE: 'Europe/Lisbon',
  PRIMEIRO_DIA_SEMANA: 1,
  /* HORAS DE CONTRATO POR SEMANA — a base contra a qual se mede o
     excedente. O relatorio semanal mostra o total trabalhado, o que passa
     destas horas, e EM QUE DIAS esse excedente foi feito.

     NOTA IMPORTANTE: o horario de Config (10:00-13:00 + 14:30-19:00) da
     7h30 por dia, ou seja 37h30 em 5 dias uteis — nao 40h. As 40h sao o
     contrato; o horario e' a janela de picagem. Por isso o excedente
     semanal NAO se calcula contra `minutosPlaneados` (que daria sempre
     zero de diferenca por construcao), mas contra este valor.

     Quem|Part-time mexe aqui: e' o unico sitio do sistema que diz quantas
     horas uma semana vale. */
  HORAS_CONTRATO_SEMANA: 40,
  HORARIO: {
    SEMANA: [
      { inicio: '10:00', fim: '13:00' },
      { inicio: '14:30', fim: '19:00' }
    ],
    /* Sábado de escala = DIA NORMAL COMPLETO, não turno curto.
       O sábado não é trabalho extra: quem está de rotação faz o mesmo
       turno de um dia útil (10:00–13:00 + 14:30–19:00) e essas horas
       contam como NORMALIS. Só o que ultrapassar as 19:00 é extra.
       Antes este campo tinha só a manhã, pelo que o turno da tarde
       aparecia como 4h30 de "horas extra" indevidamente. */
    SABADO: [
      { inicio: '10:00', fim: '13:00' },
      { inicio: '14:30', fim: '19:00' }
    ],
    DOMINGO: []
  },
  /* FECHO ASSUMIDO — a hora a que um turno termina quando não há saída marcada.
     Num dia com horário (util, sábado de escala) vale o fim do turno normal
     desse dia: 13:00 de manhã, 19:00 de tarde.
     Num dia SEM horário (sábado fora da escala, domingo, feriado) não existe
     turno a que fechar, por isso assume-se o fim do turno normal da manhã —
     a única hora que a empresa conhece com segurança. Fica declarado aqui e
     não "hard-coded" no motor para se poder mudar sem tocar em código. */
  FECHO_ASSUMIDO_SEM_HORARIO: '13:00',
  /* POLÍTICA DE BLOQUEIO — ajustada para um posto partilhado.
     Não é bloqueio por muitas tentativas: numa clínica com teclado
     partilhado e passwords simples, vários erros seguidos são quase
     sempre dedos gordos, não um ataque. O que interessa é que o erro
     seja visível e que nunca haja beco sem saída.
     Como a password é mantida propositadamente em texto simples (ver
     "Passwords simples" no fim de Config.gs), a proteção real não é a
     força da password — são as sessões, a auditoria e o botão de
     desbloquear do gestor. */
  SEGURANCA: {
    SESSAO_MINUTOS: 480,
    /* Erros tolerados ANTES do primeiro bloqueio. Valor alto de
       propósito: password simples, teclado partilhado. */
    MAX_TENTATIVAS_LOGIN: 8,
    /* Primeiro bloqueio: curto. Passados 15 minutos a pessoa entra
       com a password certa e o contador zera. */
    BLOQUEIO_MINUTOS: 15,
    /* Reincidência: quem volta a falhar depois de desbloquear espera
       mais. É o que trava um ataque sem castigar um engano isolado. */
    BLOQUEIO_MINUTOS_REINCIDENTE: 60,
    /* Nº de bloqueios a partir dos quais se aplica o tempo longo. */
    BLOQUEIO_LONGO_A_PARTIR_DE: 2,
    /* Passadas 24 h sem bloqueio, a conta volta a ser tratada como
       limpa. Sem isto um episódio mau em janeiro puniria a mesma pessoa
       com uma hora de bloqueio em julho, sem qualquer relação com o dia
       de hoje. Quer-se castigar o padrão, não guardar rancor. */
    RECINCIDENCIA_ESQUECE_APOS_HORAS: 24,
    /* PODA DE SESSOES — quantos dias se guardam as sessoes JA TERMINADAS.
       A folha SESSOES e' a unica que cresce sem limite: cada login cria
       uma linha e nada a apagava. Como `obterSessaoPorToken_()` le a folha
       INTEIRA em cada pedido autenticado, o custo de um simples "picar"
       crescia para sempre (aos 20 000 registos, ~140 000 celulas por
       pedido).

       A poda e' deliberadamente estreita e nunca toca em registo de
       trabalho: apaga so linhas que ja NAO servem para nada (TERMINADA ou
       EXPIRADA) E que sejam mais velhas do que esta janela. Uma sessao
       ativa nunca e' apagada, mesmo que antiga. As PICAGENS, as JUSTIFICACOES
       e a AUDITORIA nunca sao podadas — continuam a ser a verdade factual.

       0 desliga a poda (nada e' apagado). 90 dias e' generoso e chega para
       investigar um acesso antigo. */
    SESSOES_RETENCAO_DIAS: 90
  }
};

/* Onde ficam os dados.
 *
 * Deixa VAZIO e o setup cria uma Spreadsheet nova sozinho.
 *
 * Preenche com o ID de uma Sheet que ja exista APENAS se quiseres manter
 * dados que ja la estejam. O ID e a parte da URL entre "/d/" e "/edit":
 *   https://docs.google.com/spreadsheets/d/1AbC...XyZ/edit
 *                            ^^^^^^^^^^^^^^ este
 *
 * Este campo e lido por resolverSpreadsheet_(). Sem ele e sem uma
 * instalacao anterior, a primeira execucao de setupSistema() cria a Sheet. */
const SPREADSHEET_ID = '';

const SHEETS = {
  CONFIG: 'CONFIG',
  UTILIZADORES: 'UTILIZADORES',
  SESSOES: 'SESSOES',
  PICAGENS: 'PICAGENS',
  DIAS_TRABALHO: 'DIAS_TRABALHO',
  CONFIG_SABADOS: 'CONFIG_SABADOS',
  FERIADOS: 'FERIADOS',
  AUSENCIAS: 'AUSENCIAS',
  JUSTIFICACOES: 'JUSTIFICACOES',
  HORAS_EXTRA: 'HORAS_EXTRA',
  CORRECOES: 'CORRECOES',
  AUDITORIA: 'AUDITORIA',
  EXCECOES: 'EXCECOES',
  RESUMO_DIARIO: 'RESUMO_DIARIO',
  RESUMO_SEMANAL: 'RESUMO_SEMANAL',
  RESUMO_MENSAL: 'RESUMO_MENSAL',
  BACKUPS: 'BACKUPS',
  TESTES: 'TESTES',
  LOG_ERROS: 'LOG_ERROS'
};

const ENUMS = {
  PERFIS: { ADMIN: 'ADMIN', COLABORADOR: 'COLABORADOR' },
  ESTADOS_UTILIZADOR: { ATIVO: 'ATIVO', INATIVO: 'INATIVO' },
  TIPOS_PICAGEM: {
    ENTRADA_MANHA: 'ENTRADA_MANHA',
    SAIDA_MANHA: 'SAIDA_MANHA',
    ENTRADA_TARDE: 'ENTRADA_TARDE',
    SAIDA_TARDE: 'SAIDA_TARDE'
  },
  TIPOS_DIA: {
    UTIL: 'UTIL',
    SABADO_PREVISTO: 'SABADO_PREVISTO',
    SABADO_NAO_PREVISTO: 'SABADO_NAO_PREVISTO',
    DOMINGO: 'DOMINGO',
    FERIADO: 'FERIADO',
    FERIAS: 'FERIAS',
    AUSENCIA_JUSTIFICADA: 'AUSENCIA_JUSTIFICADA',
    AUSENCIA_NAO_JUSTIFICADA: 'AUSENCIA_NAO_JUSTIFICADA'
  },
  ESTADOS_HORA_EXTRA: {
    PENDENTE: 'PENDENTE',
    APROVADO: 'APROVADO',
    REJEITADO: 'REJEITADO',
    CANCELADO: 'CANCELADO'
  },
  ESTADOS_SESSAO: {
    ATIVA: 'ATIVA',
    TERMINADA: 'TERMINADA',
    EXPIRADA: 'EXPIRADA'
  }
};

const UTILIZADORES_INICIAIS = [
  ['USR_PEDRO_SILVA', 'Pedro Silva', 'Gestor', 'ADMIN', 'ATIVO'],
  ['USR_HUGO_SILVA', 'Hugo Silva', 'Gestor', 'ADMIN', 'ATIVO'],
  ['USR_CELINA_RELVA', 'Celina Relva', 'Veterinária', 'COLABORADOR', 'ATIVO'],
  ['USR_RITA_REIS', 'Rita Reis', 'Enfermeira', 'COLABORADOR', 'ATIVO']
];

/* Credenciais iniciais (email + password em texto simples).
   Editáveis aqui. Formato: [userId, email, password, perfil].

   >> ESTES SÃO OS LOGINS E PASSWORDS DEFINITIVOS DA EMPRESA. <<
   São os que já foram fornecidos e devem ser mantidos tal e qual. Não os
   altere, não os gere automaticamente e não os substitua por outros valores:
   o utilizador entra com o email e a password que já conhece. A regra de
   passwords é propositadamente simples (4 a 64 carateres, sem símbolos
   obrigatórios) para não haver rejeições nem tentativas falhadas. Se um
   utilizador esquecer a password, use 'Repor password' no Painel (ou
   definirPasswordUtilizador no editor) em vez de mudar esta lista.

   Usadas por instalarSistemaComCredenciais() e também para autorizar
   as funções sensíveis (password/email): quando chamadas a partir do
   editor, exigem que a conta Google ativa seja um dos ADMIN desta lista.
   Se usar outra conta Google para instalar, junte o email dela aqui. */
const CREDENCIAIS_INICIAIS = [
  ['USR_PEDRO_SILVA', 'pedromds84@gmail.com', 'pedromds84', 'ADMIN'],
  ['USR_HUGO_SILVA', 'hugofds@outlook.com', '6y6na6cu', 'ADMIN'],
  ['USR_CELINA_RELVA', 'celinarelva@gmail.com', 'celinarelva', 'COLABORADOR'],
  ['USR_RITA_REIS', 'aror.arita8@hotmail.com', 'ritareis', 'COLABORADOR']
];

const ROTACAO_SABADOS_INICIAL = [
  {
    grupoId: 'GRUPO_VETERINARIOS',
    descricao: 'Veterinários',
    ordem: ['USR_PEDRO_SILVA', 'USR_CELINA_RELVA'],
    // '' = automático: o setupSistema() preenche o próximo sábado
    // (proximoSabadoIso_). Sem dataInicio a rotação fica inativa e
    // todas as horas de sábado contam como extra em vez de normais.
    dataInicio: '',
    ativo: true
  },
  {
    grupoId: 'GRUPO_ENFERMAGEM',
    descricao: 'Enfermagem/Gestão',
    ordem: ['USR_HUGO_SILVA', 'USR_RITA_REIS'],
    dataInicio: '',
    ativo: true
  }
];

const HEADERS = {
  CONFIG: ['Chave', 'Valor', 'Descricao', 'AtualizadoEm'],
  UTILIZADORES: ['ID', 'Nome', 'Profissao', 'Perfil', 'Estado', 'Email', 'Password', 'TentativasFalhadas', 'BloqueadoAte', 'CriadoEm', 'AtualizadoEm', 'UltimoLogin', 'PasswordAlteracaoPendente', 'Bloqueios', 'UltimoBloqueioEm'],
  SESSOES: ['ID', 'Token', 'UserID', 'CriadoEm', 'ExpiraEm', 'Estado', 'UltimaAtividade'],
  PICAGENS: ['ID', 'Data', 'DataHora', 'UserID', 'Nome', 'Tipo', 'Origem', 'Dispositivo', 'Latitude', 'Longitude', 'CriadoEm'],
  DIAS_TRABALHO: ['ID', 'Data', 'UserID', 'Nome', 'TipoDia', 'HorarioPlaneado', 'MinutosPlaneados', 'MinutosTrabalhados', 'MinutosNormais', 'MinutosExtra', 'MinutosExtraAprovados', 'HorasPlaneadas', 'HorasTrabalhadas', 'HorasNormais', 'HorasExtra', 'HorasExtraAprovadas', 'Estado', 'Excecoes', 'AtualizadoEm'],
  CONFIG_SABADOS: ['GrupoID', 'Descricao', 'OrdemUserIDs', 'DataInicio', 'Ativo', 'AtualizadoEm'],
  FERIADOS: ['ID', 'Data', 'Descricao', 'Ativo', 'CriadoPor', 'CriadoEm', 'AtualizadoEm'],
  AUSENCIAS: ['ID', 'DataInicio', 'DataFim', 'UserID', 'Nome', 'Tipo', 'Estado', 'Motivo', 'CriadoPor', 'CriadoEm', 'AtualizadoEm'],
  JUSTIFICACOES: ['ID', 'DataCriacao', 'Data', 'UserID', 'Nome', 'Tipo', 'Descricao', 'ExcecaoID', 'Estado', 'CriadoPor', 'AprovadoPor', 'DataAprovacao', 'Observacoes', 'AtualizadoEm'],
  HORAS_EXTRA: ['ID', 'Data', 'UserID', 'Nome', 'TipoDia', 'InicioExtra', 'FimExtra', 'MinutosExtra', 'HorasExtra', 'Origem', 'Estado', 'Justificacao', 'AprovadoPor', 'DataAprovacao', 'Observacoes', 'CriadoEm', 'AtualizadoEm'],
  CORRECOES: ['ID', 'DataCriacao', 'Data', 'UserID', 'Nome', 'PicagemID', 'TipoCorrecao', 'ValorOriginal', 'ValorNovo', 'TipoOriginal', 'TipoNovo', 'Motivo', 'Estado', 'CriadoPor', 'AplicadoPor', 'DataAplicacao', 'Observacoes', 'AtualizadoEm'],
  AUDITORIA: ['ID', 'DataHora', 'Acao', 'SessaoID', 'UserID', 'Descricao', 'IP', 'UserAgent', 'Dados'],
  EXCECOES: ['ID', 'Data', 'UserID', 'Nome', 'Tipo', 'Descricao', 'Prioridade', 'Estado', 'CriadoEm', 'ResolvidoEm', 'ResolvidoPor', 'Observacoes'],
  RESUMO_DIARIO: ['Data', 'UserID', 'Nome', 'DiaSemana', 'TipoDia', 'HorarioPlaneado', 'MinutosPlaneados', 'MinutosTrabalhados', 'MinutosNormais', 'MinutosExtra', 'MinutosExtraAprovados', 'Estado', 'Excecoes', 'AtualizadoEm'],
  RESUMO_SEMANAL: ['SemanaInicio', 'SemanaFim', 'UserID', 'Nome', 'MinutosPlaneados', 'MinutosTrabalhados', 'MinutosNormais', 'MinutosExtra', 'MinutosExtraAprovados', 'DiasTrabalhados', 'DiasAusentes', 'Excecoes', 'AtualizadoEm'],
  RESUMO_MENSAL: ['Mes', 'UserID', 'Nome', 'MinutosPlaneados', 'MinutosTrabalhados', 'MinutosNormais', 'MinutosExtra', 'MinutosExtraAprovados', 'Sabados', 'Domingos', 'Feriados', 'Ausencias', 'Excecoes', 'AtualizadoEm'],
  BACKUPS: ['ID', 'DataHora', 'Tipo', 'Descricao', 'CriadoPor', 'Estado', 'Dados'],
  TESTES: ['ID', 'DataHora', 'Teste', 'Resultado', 'Esperado', 'Observacoes'],
  LOG_ERROS: ['ID', 'DataHora', 'Funcao', 'Mensagem', 'Stack', 'UserID', 'Dados']
};

