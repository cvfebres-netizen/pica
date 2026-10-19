/* PM2: correr o bot + painel com reinício automático (VPS / Raspberry Pi).
   Uso:
     npm i -g pm2
     pm2 start ecosystem.config.js
     pm2 save
     pm2 startup   (seguir as instruções para arrancar no boot)
   Lembretes/follow-ups continuam via cron do SO: 0 9 * * * + 0 * * * * (2h).
   Exemplo cron (crontab -e):
     0 9 * * * cd /caminho/agente-whatsapp-cvf && npm run lembretes >> src/logs/cron.log 2>&1
*/
module.exports = {
  apps: [
    {
      name: 'cvf-whatsapp',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '30s',
      exp_backoff_restart_delay: 10000
    },
    {
      name: 'cvf-painel',
      script: 'scripts/painel-run.js',
      instances: 1,
      autorestart: true,
      env: { PORT: 3000 }
    }
  ]
};