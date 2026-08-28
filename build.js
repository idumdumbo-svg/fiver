var fs = require('fs');
// Strip EVERY node export block (there is more than one), not just the first —
// a greedy "delete to end of file" here silently dropped later functions.
var lines = fs.readFileSync('logic.js', 'utf8').split('\n');
var out = [], skipping = false, stripped = 0;
for (var i = 0; i < lines.length; i++) {
  if (!skipping && /^if \(typeof module/.test(lines[i])) { skipping = true; stripped++; continue; }
  if (skipping) { if (lines[i] === '}') skipping = false; continue; }
  out.push(lines[i]);
}
if (skipping) throw new Error('unterminated module.exports block in logic.js');
if (!stripped) throw new Error('no module.exports block found — check logic.js');
var logic = out.join('\n');

// dates first (both domain modules use it), then money, then food
function moduleSource(file) {
  var lines = fs.readFileSync(file, 'utf8').split('\n');
  var keep = [], skipping = false, stripped = 0;
  for (var i = 0; i < lines.length; i++) {
    if (!skipping && /^if \(typeof module/.test(lines[i])) { skipping = true; stripped++; continue; }
    if (skipping) { if (lines[i] === '}') skipping = false; continue; }
    // the node-only require shim is dead weight in the bundle
    if (/^if \(typeof dayKey === 'undefined'/.test(lines[i])) { skipping = true; continue; }
    keep.push(lines[i]);
  }
  if (!stripped) throw new Error('no module.exports block found in ' + file);
  return keep.join('\n');
}
logic = moduleSource('dates.js') + '\n' + logic + '\n' + moduleSource('calories.js');
['roundUp','dayTotals','baselineFor','sweepOffer','dayIncome','rangeIncome',
 'netFor','totalSwept','sweptByDest','series','fmt'].forEach(function (fn) {
  if (logic.indexOf('function ' + fn + '(') === -1) throw new Error('logic.js lost ' + fn);
});
var tpl = fs.readFileSync('template.html', 'utf8');
// function form: logic.js contains "$'" which would otherwise be treated
// as a special replacement pattern and splice the file into itself
var body = tpl.replace('/*LOGIC*/', function () { return logic; });

// artifact build: no doctype/html/head/body — the viewer wraps it
fs.writeFileSync('fiver.html', body);

function document_(inner, extraHead) {
  return '<!doctype html>\n<html lang="en">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#EDF0F4" media="(prefers-color-scheme: light)">\n' +
    '<meta name="theme-color" content="#0C0F14" media="(prefers-color-scheme: dark)">\n' +
    (extraHead || '') +
    '</head>\n<body>\n' + inner + '\n</body>\n</html>\n';
}

// standalone build: one file, openable straight off disk
fs.writeFileSync('fiver-standalone.html', document_(body));

// ---- hosted build: an installable PWA ----
var pkg = {
  name: 'Fiver',
  short_name: 'Fiver',
  description: 'Round every spend up to the next five. Watch the day fill up. Keep the difference.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait',
  background_color: '#EDF0F4',
  theme_color: '#192C42',
  categories: ['finance', 'productivity'],
  icons: [
    { src: './icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: './icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: './icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
};

// one version stamp per build drives the service worker cache
var version = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

var hostedHead =
  '<link rel="manifest" href="./manifest.webmanifest">\n' +
  '<link rel="icon" href="./favicon.ico" sizes="any">\n' +
  '<link rel="icon" type="image/png" href="./icons/icon-192.png">\n' +
  '<link rel="apple-touch-icon" href="./icons/icon-180.png">\n' +
  '<meta name="apple-mobile-web-app-capable" content="yes">\n' +
  '<meta name="mobile-web-app-capable" content="yes">\n' +
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n' +
  '<meta name="apple-mobile-web-app-title" content="Fiver">\n' +
  '<meta name="description" content="' + pkg.description + '">\n' +
  '<meta name="robots" content="noindex">\n' +
  '<script>window.__FIVER_HOSTED__ = true;<\/script>\n';

fs.mkdirSync('dist/icons', { recursive: true });
// icons are committed source, not generated at build time
fs.copyFileSync('assets/favicon.ico', 'dist/favicon.ico');
fs.readdirSync('assets/icons').forEach(function (f) {
  fs.copyFileSync('assets/icons/' + f, 'dist/icons/' + f);
});
fs.writeFileSync('dist/index.html', document_(body, hostedHead));
fs.writeFileSync('dist/manifest.webmanifest', JSON.stringify(pkg, null, 2));
fs.writeFileSync('dist/sw.js',
  fs.readFileSync('sw-template.js', 'utf8').replace('__VERSION__', version));

console.log('built fiver.html (' + (body.length / 1024).toFixed(1) + ' KB), ' +
  'fiver-standalone.html, and dist/ (sw ' + version + ')');
