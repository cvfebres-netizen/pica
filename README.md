# pica — Sistema de Picagem de Ponto

Aplicação web para registo e controlo das picagens de ponto do **Centro
Veterinário de Febres**. Corre como Web App do Google Apps Script, com os
dados numa Google Sheet.

Versão em produção: **1.2.0**.

## Estrutura

| Pasta | O que é |
|---|---|
| [`pica/`](pica/) | Código-fonte, testes e documentação — **fonte única da verdade** |
| [`picadeploy/`](picadeploy/) | Pasta gerada para `clasp push` — **não editar manualmente** |

## Começar

- Documentação completa: [`pica/LEIA-ME.md`](pica/LEIA-ME.md)
- Instalação passo a passo: [`pica/PASSO_A_PASO.txt`](pica/PASSO_A_PASO.txt)

### Correr os testes (13 suites + simulação, offline)

```bash
cd pica
node _verificacao_final.js
```

Todos os suites devem terminar com código de saída **0**.

### Sincronizar a pasta de deploy

Depois de mexer em qualquer `.gs` ou no `index.html`:

```bash
node pica/_sincronizar.js
node pica/_verificacao_final.js
```

`pica` é a fonte; `picadeploy` é gerado e comparado byte a byte em cada
verificação.

### Publicar no Apps Script

```bash
cd picadeploy
clasp push
```

(O `scriptId` vai em `picadeploy/.clasp.json`, que não é versionado — ver
`.gitignore`.)
