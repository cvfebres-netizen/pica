/* Auditoria de interligacoes: que funcoes publicas sao alcancaveis por
   google.script.run sem guarda de autorizacao no proprio corpo.

   NOTA DE CORRECCAO. A versao anterior contava funcoes ANINHADAS como se
   fossem de topo: `P` (WebApp.gs, o atalho que monta uma picagem dentro
   de `testesMotorCompleto_`) aparecia na lista de "publicas sem guarda" e
   nao tem nada de publico — vive dentro do corpo de outra funcao e o
   dispatcher nunca a alcanca. Um alarme falso nesta lista faz o relatorio
   deixar de ser lido, que e' pior do que nao ter relatorio.

   A segunda correccao: a lista de guardas nao conhecia `exigirOperacional_`,
   a guarda real de `registarPicagem`, e por isso a marcava como exposta. */
const fs = require('fs');
const path = require('path');
const d = __dirname;

const gs = fs.readdirSync(d).filter(function (f) { return f.endsWith('.gs'); }).sort();
const fontes = {};
gs.forEach(function (f) { fontes[f] = fs.readFileSync(path.join(d, f), 'utf8'); });

/* --- Leitor que sabe o que e' codigo e o que e' texto ------------------
   A versao anterior contava `{` e `}` a olho e confiava que o codigo os
   equilibrava. Um `{` dentro de uma string partia a contagem e o corpo
   da funcao era cortado a meio — o veredito passava a ser sobre um
   fragmento de texto. Aqui sao ignorados strings (', " e `), comentarios
   de linha e de bloco, e so conta o que e' mesmo codigo.

   Os LITERAL DE REGEX tambem contam como texto. `/^(\\d{1,2}):(\\d{2})$/`
   tem tres pares de chavetas que nao sao blocos: sem os tratar, a partir
   desse ponto o contador de profundidade fica errado e o corpo das
   funcoes seguintes nunca fecha — o veredito passava a ser sobre o resto
   do ficheiro, e uma funcao sem guarda aparecia como guardada. */
const ANTES_DE_REGEX = '(,=:[!&|?{};+-*%~^<>';
const PALAVRAS_ANTES_DE_REGEX = /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)\s*$/;
function indiceReal(src) {
  const mascarado = new Array(src.length).fill(true); /* true = codigo */
  let estado = 'codigo'; /* codigo | linha | bloco | sq | dq | tq | regex */
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (estado === 'codigo') {
      if (c === '/' && src[i + 1] === '/') { estado = 'linha'; mascarado[i] = false; mascarado[i + 1] = false; i++; }
      else if (c === '/' && src[i + 1] === '*') { estado = 'bloco'; mascarado[i] = false; mascarado[i + 1] = false; i++; }
      else if (c === "'" || c === '"' || c === '`') { estado = c; mascarado[i] = false; }
      else if (c === '/') {
        /* Divisao ou inicio de regex? O que vem antes diz: depois de um
           operador ou de uma palavra-chave e' regex; depois de um
           identificador, de um `)` ou de um `]` e' divisao. */
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j])) j--;
        const antes = j < 0 ? '(' : src[j];
        const eRegex = j < 0 || ANTES_DE_REGEX.indexOf(antes) >= 0 ||
          PALAVRAS_ANTES_DE_REGEX.test(src.slice(Math.max(0, j - 10), j + 1));
        if (eRegex) { estado = 'regex'; mascarado[i] = false; }
      }
    } else if (estado === 'linha') {
      /* Comentario de linha: mascara ate' ao fim da linha e volta ao codigo.
         Sem este ramo nao havia `else` que servisse: o codigo caia no
         tratamento de strings, nunca encontrava o delimitador e mascarava
         o resto do ficheiro inteiro. O verificador "passava" a ver bodies
         que nao eram o que pensava. */
      mascarado[i] = false;
      if (c === '\n') estado = 'codigo';
    } else if (estado === 'bloco') {
      if (c === '*' && src[i + 1] === '/') { mascarado[i] = false; mascarado[i + 1] = false; estado = 'codigo'; i++; }
      else mascarado[i] = false;
    } else if (estado === 'regex') {
      /* Uma classe de caracteres pode conter `/` sem fechar a regex. */
      if (c === '[') { estado = 'regexClasse'; mascarado[i] = false; }
      else if (c === '\\') { mascarado[i] = false; if (i + 1 < src.length) { mascarado[i + 1] = false; i++; } }
      else if (c === '/') { mascarado[i] = false; estado = 'codigo'; }
      else if (c === '\n') { estado = 'codigo'; } /* nao era regex: era divisao */
      else mascarado[i] = false;
    } else if (estado === 'regexClasse') {
      if (c === ']') { estado = 'regex'; mascarado[i] = false; }
      else if (c === '\\') { mascarado[i] = false; if (i + 1 < src.length) { mascarado[i + 1] = false; i++; } }
      else mascarado[i] = false;
    } else {
      if (c === '\\') { mascarado[i] = false; if (i + 1 < src.length) { mascarado[i + 1] = false; i++; } }
      else if (c === estado) { mascarado[i] = false; estado = 'codigo'; }
      else mascarado[i] = false;
    }
  }
  return mascarado;
}

/* Declaracoes de funcao com a profundidade de chaves a que aparecem:
   0 = topo do ficheiro (superficie); > 0 = aninhada (nao e' superficie). */
function varrer(ficheiro) {
  const src = fontes[ficheiro];
  const codigo = indiceReal(src);
  /* prof[i] = numero de chaves que ABREM ANTES da posicao i, ou seja a
     profundidade a que o codigo esta. Registar depois de incrementar punha
     o `{` do corpo de uma funcao de topo a contar 1, e ate as 234 funcoes
     pareciam aninhadas — a superficie saia vazia e o relatorio dizia
     "TOTAL SEM GUARDA: 0", que e' o pior resultado possivel: parece
     limpo quando nao foi medido nada. */
  const prof = new Array(src.length).fill(0);
  let profAtual = 0;
  for (let i = 0; i < src.length; i++) {
    prof[i] = profAtual;
    if (codigo[i] && src[i] === '{') profAtual++;
    else if (codigo[i] && src[i] === '}') profAtual--;
  }
  const linhaDe = new Array(src.length).fill(1);
  for (let i = 0; i < src.length; i++) linhaDe[i + 1] = linhaDe[i] + (src[i] === '\n' ? 1 : 0);

  const achadas = [];
  const re = /(?:^|[\s;{}()=,])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    const nome = m[1];
    /* A abre dos parametros: o primeiro `(` de CODIGO depois do nome.
       Procurar com indexOf marcava o `(` de uma anotacao de comentario
       anterior, e o calculo da profundidade do corpo saia errado — o que
       fez TODAS as 234 funcoes parecerem aninhadas. */
    let abre = -1;
    for (let a = m.index + m[0].length - 1; a < src.length; a++) {
      if (codigo[a] && src[a] === '(') { abre = a; break; }
    }
    if (abre < 0) continue;
    let nivel = 0, k = abre;
    for (; k < src.length; k++) {
      if (!codigo[k]) continue;
      if (src[k] === '(') nivel++;
      else if (src[k] === ')') { nivel--; if (nivel === 0) break; }
    }
    let corpoAbre = -1;
    for (k = k + 1; k < src.length; k++) {
      if (codigo[k] && src[k] === '{') { corpoAbre = k; break; }
    }
    if (corpoAbre < 0) continue;
    achadas.push({ ficheiro: ficheiro, nome: nome, corpoAbre: corpoAbre,
      profundidade: prof[corpoAbre], linha: linhaDe[m.index] });
  }
  return achadas;
}

const todas = [];
gs.forEach(function (f) { varrer(f).forEach(function (x) { todas.push(x); }); });

/* Corpo por contagem de chaves sobre o INDICE REAL: equilibra-se porque
   strings, comentarios e regexes ja nao contam.

   Devolve null se o corpo NAO fechar. Isso e' deliberado: antes, um corpo
   que nao fechava devolveva "o resto do ficheiro", e como o resto do
   ficheiro costuma chamar guardas, uma funcao sem proteccao aparecia
   como PROTEGADA. O erro nao era gritante — era um falso "tudo bem".
   Um corpo que nao fecha e' uma falha do verificador e tem de se ver. */
function corpo(f) {
  const src = fontes[f.ficheiro];
  const codigo = indiceReal(src);
  let nivel = 0;
  for (let i = f.corpoAbre; i < src.length; i++) {
    if (!codigo[i]) continue;
    if (src[i] === '{') nivel++;
    else if (src[i] === '}') { nivel--; if (nivel === 0) return src.slice(f.corpoAbre, i + 1); }
  }
  return null;
}

/* As guardas REAIS. `exigirOperacional_` estava em falta e e' a que
   protege `registarPicagem`: o colaborador tem de estar ATIVO para picar,
   e' uma verificacao de estado, por isso tem nome proprio e nao e' sinonimo
   de exigirSessao_. A lista e' a mesma de _check_hardening.js. */
const GUARDA = /exigirSessao_|exigirAdmin_|exigirOperacional_|validarSessao_|autorizarOperacaoSensivel_/;

/* Alias de uma linha: delega noutra funcao. Se o alvo tem guarda, e' seguro.
   O `{` inicial do corpo e' tolerado porque `corpo()` devolve o corpo JA
   com as chaves — sem isso nenhum alias era reconhecido e todos apareciam
   como "sem guarda". */
const DELEGACAO = /^\s*\{?\s*(?:return\s+)?([A-Za-z_$][\w$]*)\s*\(/;

const topo = todas.filter(function (x) { return x.profundidade === 0; });
const aninhadas = todas.filter(function (x) { return x.profundidade > 0; });

const porNome = {};
topo.forEach(function (x) { if (!porNome[x.nome]) porNome[x.nome] = x; });

const publicas = topo.filter(function (x) { return !x.nome.endsWith('_'); })
  .map(function (x) { return x.nome; }).sort();

const semGuarda = [];
const delegadas = [];
const semLeitura = []; /* corpos que nao fecharam: o verificador nao os leu */

publicas.forEach(function (nome) {
  const f = porNome[nome];
  const c = corpo(f);
  if (c === null) { semLeitura.push(f); return; }
  if (!c) return;
  if (GUARDA.test(c)) return;
  const m = DELEGACAO.exec(c);
  if (m && porNome[m[1]]) {
    const cAlvo = corpo(porNome[m[1]]);
    delegadas.push({ nome: nome, alvo: m[1], alvoTemGuarda: !!cAlvo && GUARDA.test(cAlvo) });
    if (cAlvo && GUARDA.test(cAlvo)) return;
  }
  semGuarda.push({ nome: nome, ficheiro: f.ficheiro, linha: f.linha, corpo: c });
});

console.log('Ficheiros .gs: ' + gs.length +
  ' | funcoes de topo: ' + topo.length +
  ' | aninhadas (fora de superficie): ' + aninhadas.length +
  ' | publicas: ' + publicas.length);

console.log('\n--- ALIASES QUE DELEGAM ---');
delegadas.forEach(function (x) {
  console.log('  ' + x.nome + ' -> ' + x.alvo + (x.alvoTemGuarda ? '  [alvo COM guarda]' : '  [alvo SEM guarda]'));
});

/* --- Veredito, e nao so uma lista ------------------------------------
   Uma funcao sem guarda nao e' automaticamente um defeito: `doGet` tem de
   servir o HTML antes de existir sessao, e `autenticarUtilizador` e' o que
   CRIA a sessao — exigir-lhe um token seria um circulo. Sao as mesmas
   isencoes de _check_hardening.js, e sao uma lista NOMEADA: um nome novo
   nao entra na isencao por acaso — tem de ser escrito a mao e justificado. */
const POR_DESENHO = {
  autenticarUtilizador: 'ponto de entrada: e' + "'" + ' o que CRIA a sessao',
  doGet: 'entrada HTTP: serve o HTML antes de existir sessao'
};
const RECUSA_PROPRIA = {
  apagarPicagem: 'recusa por desenho: as picagens originais nao se apagam',
  manutencaoDiaria: 'corredor do trigger diario: nao tem token porque o trigger nao tem'
};

const porDesenho = [], recusaPropria = [], semProteccao = [];
semGuarda.forEach(function (x) {
  if (POR_DESENHO[x.nome]) porDesenho.push(x);
  else if (RECUSA_PROPRIA[x.nome]) recusaPropria.push(x);
  else semProteccao.push(x);
});

console.log('\n--- PUBLICAS SEM GUARDA DE AUTORIZACAO ---');
console.log('  sem guarda MAS correctas por desenho: ' + porDesenho.length);
porDesenho.forEach(function (x) { console.log('    ' + x.nome + '  — ' + POR_DESENHO[x.nome]); });
console.log('  sem guarda de sessao mas com recusa propria: ' + recusaPropria.length);
recusaPropria.forEach(function (x) { console.log('    ' + x.nome + '  — ' + RECUSA_PROPRIA[x.nome]); });
console.log('  SEM PROTECCAO REAL (alcancaveis por um visitante sem token): ' + semProteccao.length);
semProteccao.forEach(function (x) {
  console.log('    * ' + x.nome + '  (' + x.ficheiro + ':' + x.linha + ')');
  console.log('        ' + x.corpo.replace(/\s+/g, ' ').slice(0, 190));
});

/* As aninhadas sao listadas de proposito: nao sao superficie publica, e
   e' ver isso escrito que impede uma delas de voltar a ser levantada como
   falsa exposta (foi assim que `P` nasceu como alarme). */
if (aninhadas.length) {
  console.log('\n--- ANINHADAS (fora de superficie, so para conferencia) ---');
  console.log('  ' + aninhadas.map(function (x) { return x.nome; }).sort().join(', '));
}

console.log('\nTOTAL SEM GUARDA: ' + semGuarda.length +
  ' | sem proteccao real: ' + semProteccao.length);

/* Sai com codigo 1 quando ha mesmo uma porta aberta, ou quando o
   verificador NAO CONSEGUEU ler um corpo — um corpo ilegido e' um
   veredicto desconhecido, nunca um "ok". E' o que permite meter esta
   auditoria na verificacao final, onde antes nao estava. */
if (semLeitura.length) {
  console.log('\n!! CORPOS QUE O VERIFICADOR NAO CONSEGUIU FECHAR (' + semLeitura.length + '):');
  semLeitura.forEach(function (x) {
    console.log('   ' + x.nome + '  (' + x.ficheiro + ':' + x.linha + ')');
  });
}
if (semProteccao.length || semLeitura.length) {
  if (semProteccao.length) {
    console.log('DIAGNOSTICO: ' + semProteccao.length +
      ' funcao(oes) publica(s) sem proteccao. A superficie com webapp.access=ANYONE ' +
      'e' + "'" + ' alcancavel por qualquer visitante.');
  }
  if (semLeitura.length) {
    console.log('DIAGNOSTICO: ' + semLeitura.length +
      ' corpo(s) nao lidos — o veredicto dessas funcoes e' + "'" + ' DESCONHECIDO, nao "ok".');
  }
  process.exitCode = 1;
} else {
  console.log('DIAGNOSTICO: os ' + publicas.length +
    ' nomes publicos foram todos lidos e todos tem proteccao ' +
    '(guarda, alias com guarda, por desenho ou recusa propria).');
}
