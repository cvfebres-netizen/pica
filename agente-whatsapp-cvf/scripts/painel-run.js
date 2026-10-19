/* Arranque do painel web como processo dedicado (pm2: cvf-painel). */
const { iniciar } = require('../src/web/panel');
iniciar();