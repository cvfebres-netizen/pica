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
├── prompts/
│   └── agente-atendimento.md   ← prompt do agente (colar na IA)
├── src/
│   ├── index.js            ← arranque: gateway + atendimento + agenda
│   ├── gateway/
│   │   └── baileys-gateway.js  ← liga ao WhatsApp via QR, recebe/envia
│   ├── atendimento/
│   │   ├── roteador.js     ← entende a intenção (marcar/remarcar/cancelar/urgência)
│   │   └── respostas.js    ← textos curtos em PT-PT
│   ├── agenda/
│   │   └── google-calendar.js  ← cria/move/apaga consultas
│   └── dados/
│       └── memoria.json    ← conversas em curso (nada de base paga)
├── test/
│   └── simulador.js        ← testa sem WhatsApp nem Google
├── scripts/
│   └── instalar.bat        ← instala tudo no PC com 1 clique
└── docs/
    └── ligacao-passo-a-passo.md ← ligar Business + Calendar
```

## 4. Instalação (PC da clínica, 1 vez)

1. Instalar Node.js LTS (nodejs.org).
2. Abrir terminal nesta pasta: `npm install`.
3. Copiar `.env.exemplo` para `.env` e preencher (ver docs).
4. Ligar Google Calendar (1 vez, grátis): `npm run ligar-google` → abre browser → login → aceita → guarda token.
5. Arrancar: `npm start` → aparece **QR no terminal** → no telemóvel Business: **Definições → Aparelhos ligados → Ligar aparelho** → lê o QR.
6. Pronto. O PC fica ligado no horário da clínica com o terminal aberto.

Detalhe completo em `docs/ligacao-passo-a-passo.md`.

## 5. O que o agente faz (sem rodeios)

- Cumprimenta e pergunta: animal, motivo, dia/hora preferida.
- **Marca/remarca/cancela SEMPRE com OK do gestor, e tudo aparece no Calendar:**
  cliente pede → entra logo como **⏳ PROVISÓRIO** no Google Calendar
  (transparente, mostra-se "livre") + gestor recebe aviso no WhatsApp →
  gestor responde **OK** (passa a ✅ CONFIRMADO, opaco) ou **NÃO**
  (provisório apagado, cliente avisado para escolher outra hora).
- O gestor vê a fila com a palavra `pendentes`.
- Dúvidas simples: horário, morada, preço base, o que trazer.
  Sempre com o link de agendamento: `LINK_AGENDAMENTO`.
- **Urgência** (sangue, não respira, envenenamento, acidente): manda ligar já para a clínica, não agenda nem espera OK.
- Fora de horário: regista pedido e diz que confirmam de manhã.
- Tudo em PT-PT, mensagens curtas (≤ 2 SMS), sem rodeios.

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
