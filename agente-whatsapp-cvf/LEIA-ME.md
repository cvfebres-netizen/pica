# Agente WhatsApp — Clínica Veterinária (CVF)

Agente de atendimento por mensagem para o WhatsApp Business da clínica.
Responde a clientes, gere agendamentos e interliga com o Google Calendar.
**100% gratuito, sem mensalidades, sem Cloud API paga.**

---

## 1. Como funciona (resumo simples)

```
Cliente escreve no WhatsApp Business
        │ QR/pareamento local (sem browser pesado)
        ▼
  gateway-baileys (Node.js no PC da clínica)
        │ texto limpo
        ▼
  atendimento (regras simples + IA opcional)
        │ intenção: marcar / remarcar / cancelar / dúvida / urgência
        ▼
  agenda (Google Calendar gratuito)
        │ cria / move / apaga evento
        ▼
  Resposta curta de volta no WhatsApp
```

## 2. Porquê esta interligação (e não a Cloud API)

| Opção | Custo 2026 | Veredicto |
|---|---|---|
| **Baileys (gateway local, QR)** | **0 € para sempre** | **Escolhido.** Biblioteca MIT, sem browser, sessão guardada no PC, funciona com conta Business normal. |
| whatsapp-web.js | 0 € | Rejeitado: exige Chromium por sessão, pesado e quebra quando o WhatsApp Web muda. |
| WhatsApp Cloud API oficial | Grátis só até 1.000 respostas/mês; depois paga + BSP + inbox | Rejeitado: desde out/2026 a Meta cobra respostas de serviço e templates. |

Fonte: comparativo [Baileys vs whatsapp-web.js 2026](https://wapito.com/compare/baileys-vs-whatsapp-web-js/) e [guia de preços 2026](https://respond.io/blog/whatsapp-business-api-pricing).

Risco honesto: gateway local é não-oficial. Ritmo humano, só responde a quem escreve primeiro, sem spam — assim o número não é banido.

## 3. Estrutura

```
agente-whatsapp-cvf/
├── LEIA-ME.md              ← este ficheiro
├── todo.txt                ← estado do projeto
├── package.json            ← dependências (baileys + googleapis)
├── .env.exemplo            ← configurar sem expor segredos
├── scripts/
│   ├── instalar.bat        ← instalação standalone (1 clique, Windows)
│   ├── backup-dados.js     ← backup automático dos JSON de dados
│   └── lembretes-diarios.js← envia lembretes e encerra (cron)
├── src/
│   ├── prompts/
│   │   └── centro-veterinario-de-febres.md ← persona e regras de triagem da clínica
│   ├── index.js            ← arranque: valida env + gateway + atendimento
│   ├── config/
│   │   ├── env.js          ← valida variáveis obrigatórias na inicialização
│   │   └── verificar-respostas.js ← testes automáticos de respostas (14 cenários)
│   ├── gateway/
│   │   └── baileys-gateway.js  ← liga ao WhatsApp via QR, recebe/envia
│   ├── monitor/
│   │   ├── logger.js       ← logger diário rotativo (ficheiro + consola)
│   │   └── metricas.js     ← contadores JSON por dia
│   ├── atendimento/
│   │   ├── roteador.js     ← intenções + reagendamento sugestivo + idiomas
│   │   ├── respostas.js    ← textos curtos PT-PT / EN
│   │   ├── idiomas.js      ← suporte a múltiplos idiomas (PT-PT / EN)
│   │   ├── formulario.js   ← FSM passo a passo (nome→telefone→animal→...)
│   │   ├── pendentes.js    ← fila de aprovação do gestor
│   │   ├── historico.js    ← histórico de atendimentos
│   │   ├── listaEspera.js  ← lista de espera com sugestões de horário
│   │   ├── escalation.js   ← avisa gestor após N mensagens não percebidas
│   │   └── transcricao.js  ← transcrição de áudio (stub whisper/OpenAI)
│   ├── agenda/
│   │   ├── google-calendar.js  ← cria/move/apaga consultas (múltiplos calendários)
│   │   └── lembretes.js    ← lembrete 24h + confirmação 2h antes
│   ├── web/
│   │   └── panel.js        ← painel web: /, /historico, /lista-espera, /metrics, /health
│   └── dados/
│       └── memoria.json    ← conversas em curso (nada de base paga)
├── test/
│   └── simulador.js        ← testa sem WhatsApp nem Google (11/11 OK)
└── docs/
    └── ligacao-passo-a-passo.md ← ligar Business + Calendar
```

## 4. Instalação (PC da clínica, 1 vez)

1. Instalar Node.js LTS (nodejs.org).
2. Abrir terminal nesta pasta: `npm install` (ou duplo-clique em `scripts/instalar.bat`).
   O instalador valida a sintaxe de todos os ficheiros JS e cria o `.env`.
3. Copiar `.env.exemplo` para `.env` e preencher (ver docs).
   Obrigatório: `NOME_CLINICA`, `TELEFONE_CLINICA`, `NUMERO_GESTOR`, `GOOGLE_CALENDAR_ID`.
   Opcional mas recomendado: `PAINEL_USER`, `PAINEL_PASS` (painel web protegido).
4. Ligar Google Calendar (1 vez, grátis): `npm run ligar-google` → abre browser → login → aceita → guarda token.
5. Arrancar: `npm start` → aparece **QR no terminal** → no telemóvel Business: **Definições → Aparelhos ligados → Ligar aparelho** → lê o QR.
6. Opcional: iniciar painel web `npm run painel` e testar `http://localhost:3000/health`.
7. Pronto. O PC fica ligado no horário da clínica com o terminal aberto.

Detalhe completo em `docs/ligacao-passo-a-passo.md`.

## 5. O que o agente faz (sem rodeios)

- Cumprimenta e pergunta: animal, motivo, dia/hora preferida. Suporte a PT-PT e EN (escreva `/pt` ou `/en`).
- **Marca/remarca/cancela SEMPRE com OK do gestor, e tudo aparece no Calendar:**
  cliente pede → entra logo como **⏳ PROVISÓRIO** no Google Calendar
  (transparente, mostra-se "livre") + gestor recebe aviso no WhatsApp →
  gestor responde **OK** (passa a ✅ CONFIRMADO, opaco) ou **NÃO**
  (provisório apagado, cliente avisado para escolher outra hora).
- Se o horário pedir já estiver ocupado, o bot coloca o cliente na **lista de espera** e sugere horários alternativos (±1h, ±2h).
- O gestor vê a fila com a palavra `pendentes`.
- **Lembretes automáticos:** 24h antes da consulta e confirmação 2h antes (cron às 09:00 ou via `npm run lembretes`).
- Dúvidas simples: horário, morada, preço base, o que trazer.
  Sempre com o link de agendamento: `LINK_AGENDAMENTO`.
- **Urgência** (sangue, não respira, envenenamento, acidente): manda ligar já para a clínica, não agenda nem espera OK.
- Fora de horário: regista pedido e diz que confirmam de manhã.
- Tudo em PT-PT, mensagens curtas (≤ 2 SMS), sem rodeios.
- **Verificação automática:** `node src/config/verificar-respostas.js` (14 cenários de resposta).
- **Backup automático:** `node scripts/backup-dados.js` (cópia dos JSON de dados com timestamp).

## 6. Custos reais

| Item | Custo |
|---|---|
| Baileys + Node.js | 0 € (MIT) |
| Google Calendar API | 0 € (dentro das quotas gratuitas) |
| IA (Ollama local, opcional) | 0 € |
| PC da clínica + internet | já existe |
| **Total** | **0 €/mês** |

## 7. Limites e regras

- Só responde a quem escreve primeiro (anti-ban).
- 1 mensagem de cada vez, sem spam nem difusão.
- Lembra: é assistente, não veterinário — não diagnostica.
- Logs só locais (`src/dados/`), sem cloud paga.
