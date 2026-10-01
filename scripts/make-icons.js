// node scripts/make-icons.js  → renders icons/icon-192.png and icon-512.png from icons/icon.svg (needs playwright-core + Chromium)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '../icons/icon.svg'), 'utf8');
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const size of [192, 512]) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    await p.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
    await p.screenshot({ path: path.join(__dirname, `../icons/icon-${size}.png`) });
  }
  await b.close();
})();
