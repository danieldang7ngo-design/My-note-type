'use strict';
/* Generates mcq/preview/preview_mcq.html from the shipped mcq files, so the
   human-review gate always exercises the exact release bundle (CSS, templates,
   modules). Run:
     node mcq/preview/build-preview.js                 (from source tree)
     HNA_ROOT=<staged dir> node mcq/preview/build-preview.js   (from publish/)
   Output: preview_mcq.html (in this folder) — a self-contained page. Never
   edit it by hand; regenerate instead. */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.HNA_ROOT || path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'preview_mcq.html');

const TEMPLATES = ['Front.html', 'Back.html'];

/* Everything the templates reference — stylesheet <link href>s and module
   <script src>s — is DISCOVERED by reading the templates themselves, so
   adding or removing an asset needs no edit here and the preview's asset list
   can never drift from the shipped bundle. */
function discoverAssets() {
  const css = [];
  const js = [];
  const linkRe = /<link\b[^>]*\bhref="([^"]+)"/gi;
  const srcRe = /<script\b[^>]*\bsrc="([^"]+)"/gi;
  TEMPLATES.forEach((name) => {
    const html = fs.readFileSync(path.join(ROOT, name), 'utf8');
    let m;
    while ((m = linkRe.exec(html))) if (css.indexOf(m[1]) === -1) css.push(m[1]);
    while ((m = srcRe.exec(html))) if (js.indexOf(m[1]) === -1) js.push(m[1]);
  });
  return { css: css, js: js };
}

/* "_mcq_storage.js" -> "storage" (the HNA_MODS key / MOD_ORDER name). */
function moduleKey(file) {
  return path.basename(file).replace(/\.[^.]+$/, '').split('_').filter(Boolean).pop();
}

const assets = discoverAssets();

/* Freshness gate: if preview_mcq.html already exists and is newer than every
   input (the shipped CSS/templates/modules AND this generator), the artifact
   reflects the current sources — skip the rewrite so preview_mcq.html's mtime
   stays a truthful "last build" stamp. tests/pre-flight.js asserts the
   artifact is never older than the working sources. */
if (fs.existsSync(OUT)) {
  const outM = fs.statSync(OUT).mtimeMs;
  const names = [].concat(assets.css, TEMPLATES, assets.js);
  let stale = false;
  names.forEach((name) => {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p) && fs.statSync(p).mtimeMs > outM) stale = true;
  });
  if (!stale && fs.statSync(__filename).mtimeMs <= outM) {
    console.log('preview_mcq.html is up to date (newer than all inputs) — skipping regeneration');
    process.exit(0);
  }
}

function embed(name) {
  const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
  return JSON.stringify(src).replace(/<\/script>/g, '<\\/script>');
}

const cssContent = assets.css.map(embed).join('\n');
const frontContent = embed(TEMPLATES[0]);
const backContent = embed(TEMPLATES[1]);
const modsObj = assets.js.map(function (f) {
  return '  ' + JSON.stringify(moduleKey(f)) + ': ' + embed(f);
}).join(',\n');
const modOrder = JSON.stringify(assets.js.map(moduleKey));

const preview = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HNA MCQ — Preview</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #1a2026; font-family: Segoe UI, Arial, sans-serif; }
  #toolbar { position: fixed; top: 0; left: 0; right: 0; z-index: 999; display: flex; flex-wrap: wrap;
             gap: 6px; align-items: center; padding: 8px 12px; background: #2a323b; color: #dfe6ec;
             border-bottom: 1px solid #000; font-size: 13px; }
  #toolbar .sep { width: 1px; height: 22px; background: #4a545e; margin: 0 6px; }
  #toolbar button { background: #3a4652; color: #e8eef4; border: 1px solid #55636f; border-radius: 4px;
                    padding: 4px 10px; font-size: 12px; cursor: pointer; }
  #toolbar button:hover { background: #46576a; }
  #toolbar button.on { background: #1e6f4c; border-color: #2f9d6e; }
  #stageWrap { position: fixed; top: 52px; left: 0; right: 0; bottom: 0; overflow: auto; padding: 16px; }
  #stage { display: block; margin: 0 auto; width: 100%; height: calc(100vh - 86px); border: 1px solid #3a4652;
           background: #fff; box-shadow: 0 4px 24px rgba(0,0,0,.5); }
  #stage.w375 { width: 375px; }
</style>
</head>
<body>

<div id="toolbar">
  <button id="bFront" class="on">Mặt Trước</button>
  <button id="bBack">Mặt Sau</button>
  <div class="sep"></div>
  <button id="bNight">Chế độ Tối (Dark Mode)</button>
  <div class="sep"></div>
  <button data-w="375">Mobile</button>
  <button data-w="0" class="on">Desktop (100%)</button>
  <div class="sep"></div>
  <button id="bReload">Xáo trộn lại (Shuffle New)</button>
</div>

<div id="stageWrap">
  <iframe id="stage" title="HNA MCQ preview"></iframe>
</div>

<script>
var HNA_CSS = ` + cssContent + `;
var TPL_FRONT = ` + frontContent + `;
var TPL_BACK = ` + backContent + `;
var HNA_MODS = {
` + modsObj + `
};

var SAMPLE = {
  Question: '<p>DeepSeek-R1 đạt hiệu năng tương đương mô hình toán học và lập trình nào sau đây?</p>',
  'Correct-answer': 'OpenAI o1 - Mô hình ngôn ngữ khổng lồ với khả năng chain-of-thought mạnh mẽ, vượt trội trong giải quyết các tác vụ đa bước toán học phức tạp.',
  'Distraction-1': 'Claude 3.5 Sonnet - Mô hình của Anthropic với khả năng coding và xử lý ngữ cảnh cực kỳ ấn tượng, được giới lập trình đánh giá rất cao.',
  'Distraction-2': 'Gemini 1.5 Pro - Mô hình của Google với cửa sổ ngữ cảnh cực lớn, có thể xử lý hàng triệu token và hiểu sâu các cấu trúc dữ liệu đa phương thức.',
  'Distraction-3': 'Llama 3.1 405B - Mô hình mã nguồn mở lớn nhất hiện nay của Meta, đạt ngưỡng sức mạnh tương đương các mô hình đóng hàng đầu.',
  Explanation: 'DeepSeek-R1 là mô hình suy luận mã nguồn mở đạt điểm benchmark cạnh tranh trực tiếp với OpenAI o1.',
  Audio_Question: '[sound:mcq-question.mp3]',
  ID: 'MCQ-042',
  Tags_Custom: 'AI, LLM'
};

function render(tpl, data) {
  var prev;
  do {
    prev = tpl;
    tpl = tpl.replace(/\\{\\{#([^}]+)\\}\\}([\\s\\S]*?)\\{\\{\\/\\1\\}\\}/g, function (m, k, inner) {
      var v = data[k];
      return (v !== undefined && v !== null && v !== '') ? render(inner, data) : '';
    });
  } while (tpl !== prev);
  tpl = tpl.replace(/\\{\\{([^}]+)\\}\\}/g, function (m, k) {
    return (data[k] !== undefined ? String(data[k]) : '');
  });
  return tpl;
}

function splitTemplate(tpl) {
  var html = tpl
    .replace(/<link\\s+[^>]*href="[^"]*"[^>]*>/g, '')
    .replace(/<script\\s+src="[^"]*"[^>]*><\\/script>/g, '');
  var inline = [];
  html = html.replace(/<script>([\\s\\S]*?)<\\/script>/g, function (m, body) {
    inline.push(body);
    return '';
  });
  return { html: html, inline: inline };
}

var stage = document.getElementById('stage');
var face = 'front';
var MOD_ORDER = ` + modOrder + `;
var nightModeOverride = false;

// Preview-only emulation of Anki's [sound:] -> replay-button conversion, so
// audio fields show the real shipped icon instead of raw token text.
function toReplayButtons(html) {
  return html.replace(/\\[sound:([^\\]]+)\\]/g, function (m, f) {
    return '<a class="replay-button soundLink" href="#" onclick="return false" aria-label="replay">[sound:' + f + ']</a>';
  });
}

function buildDoc() {
  var tpl = face === 'front' ? TPL_FRONT : TPL_BACK;
  var parts = splitTemplate(render(tpl, SAMPLE));
  parts.html = toReplayButtons(parts.html);
  var modsHtml = MOD_ORDER.map(function (name) {
    return '<script>' + HNA_MODS[name] + '<\\/script>';
  }).join('\\n');
  
  var mockAnkiFlip = '<script>window.pycmd = function(arg) { if(arg==="ans") window.parent.postMessage("flip", "*"); };<\\/script>';
  
  return '<!DOCTYPE html><html class="' + (nightModeOverride ? 'night-mode' : '') + '"><head><meta charset="utf-8">' +
    '<style>' + HNA_CSS + ' #qa .sound a.replay-button.soundLink { color: transparent; font-size: 0; }</style></head><body ' + (nightModeOverride ? 'class="night-mode"' : '') + '>' +
    '<div id="qa">' + parts.html + '</div>' + mockAnkiFlip + modsHtml +
    '<script>' + parts.inline.join(';\\n') + '<\\/script>' +
    '</body></html>';
}

function renderStage() {
  stage.srcdoc = buildDoc();
}

window.addEventListener('message', function(e) {
  if (e.data === 'flip') {
    face = 'back';
    document.getElementById('bFront').classList.remove('on');
    document.getElementById('bBack').classList.add('on');
    renderStage();
  }
});

document.getElementById('bFront').onclick = function() { face = 'front'; this.classList.add('on'); document.getElementById('bBack').classList.remove('on'); renderStage(); };
document.getElementById('bBack').onclick = function() { face = 'back'; this.classList.add('on'); document.getElementById('bFront').classList.remove('on'); renderStage(); };
document.getElementById('bNight').onclick = function() {
  nightModeOverride = !nightModeOverride;
  this.classList.toggle('on', nightModeOverride);
  renderStage();
};
document.getElementById('bReload').onclick = function() { renderStage(); };

document.querySelectorAll('button[data-w]').forEach(btn => {
  btn.onclick = function() {
    document.querySelectorAll('button[data-w]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    let v = parseInt(btn.getAttribute('data-w'));
    stage.className = v === 0 ? '' : 'w' + v;
  };
});

renderStage();
</script>
</body>
</html>`;

fs.writeFileSync(OUT, preview);
console.log('Preview built successfully at ' + OUT);
