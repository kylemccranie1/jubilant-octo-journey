// Copies the web game into ./www (Capacitor's webDir).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
for (const f of ['index.html', 'style.css', 'manifest.json', 'sw.js', 'js', 'icons']) {
  fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });
}
console.log('built → www/');
