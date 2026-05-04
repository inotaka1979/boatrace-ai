// index.html の <script> ブロックを抽出して構文検証
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/g) || [];
let ok = true;
m.forEach((blk, i) => {
  const code = blk.replace(/^<script>/, '').replace(/<\/script>$/, '');
  try { new Function(code); }
  catch (e) { console.error('Block', i, 'syntax error:', e.message); ok = false; }
});
console.log(ok ? `index.html JS syntax OK (${m.length} blocks)` : 'JS SYNTAX ERRORS');
process.exit(ok ? 0 : 1);
