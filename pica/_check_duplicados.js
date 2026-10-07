/* Deteta funções e constantes duplicadas entre os ficheiros .gs. */
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const ficheiros = fs.readdirSync(dir).filter(function(f) {
  return f.endsWith('.gs') && f !== 'code.gs';
});

const funcoes = {};
const constantes = {};

ficheiros.forEach(function(f) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');

  let m;
  const reFun = /^function\s+([A-Za-z0-9_$]+)/gm;
  while ((m = reFun.exec(src))) {
    (funcoes[m[1]] = funcoes[m[1]] || []).push(f);
  }

  const reConst = /^(?:const|var|let)\s+([A-Z][A-Z0-9_]+)\s*=/gm;
  while ((m = reConst.exec(src))) {
    (constantes[m[1]] = constantes[m[1]] || []).push(f);
  }
});

const dupFun = Object.keys(funcoes).filter(function(n) { return funcoes[n].length > 1; });
const dupConst = Object.keys(constantes).filter(function(n) { return constantes[n].length > 1; });

dupFun.forEach(function(n) { console.log('FUNCAO DUPLICADA: ' + n + ' -> ' + funcoes[n].join(', ')); });
dupConst.forEach(function(n) { console.log('CONSTANTE DUPLICADA: ' + n + ' -> ' + constantes[n].join(', ')); });

console.log('Ficheiros verificados: ' + ficheiros.length);
console.log('Funcoes declaradas: ' + Object.keys(funcoes).length);
console.log('Constantes declaradas: ' + Object.keys(constantes).length);
const total = dupFun.length + dupConst.length;
console.log(total === 0
  ? 'RESULTADO: sem duplicados entre os ' + ficheiros.length + ' ficheiros'
  : 'RESULTADO: ' + total + ' duplicado(s) encontrados');

/* O código de saída é o que interessa numa verificação automática.
   Sem isto a consola imprimia o duplicado e o processo devolvia 0:
   o pipeline dava "verde" com funções repetidas no mesmo ficheiro —
   o que, em Apps Script, faz a ÚLTIMA definição ganhar em silêncio. */
process.exitCode = total === 0 ? 0 : 1;
