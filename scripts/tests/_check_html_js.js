// PE-5: assets/app.js (外部化された JS) の構文をチェック
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'app.js'), 'utf8');
let ok = true;
try {
  new Function(code);
  console.log('assets/app.js syntax OK (' + code.length + ' chars)');
} catch (e) {
  console.error('JS SYNTAX ERROR:', e.message);
  ok = false;
}
process.exit(ok ? 0 : 1);
