// pm2: `pm2 startOrReload ecosystem.config.cjs` (deploy.sh shuni chaqiradi).
// Qolgan sozlamalar .env'da — Nest uni ishchi papkadan o'qiydi.
module.exports = {
  apps: [
    {
      name: 'osontarget-api',
      script: 'dist/main.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        // Biznes vaqti — Toshkent. Sozlanmasa "bugun" va oy chegaralari 5 soat siljiydi.
        TZ: 'Asia/Tashkent',
      },
      // Server kichik va boshqa ilovalar bilan umumiy: xotira oqib ketsa,
      // qo'shnilarni bo'g'ib qo'yish o'rniga jarayon qayta ishga tushadi.
      max_memory_restart: '300M',
      time: true,
    },
  ],
};
