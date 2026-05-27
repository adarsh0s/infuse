'use strict';
const http  = require('http');
const https = require('https');
const os    = require('os');
const PORT  = 8080;

// Follow redirects and return final URL
function resolve(inputUrl, depth) {
  if (!depth) depth = 0;
  if (depth > 10) return Promise.resolve(inputUrl);
  return new Promise((resolvePromise, reject) => {
    let parsed;
    try { parsed = new URL(inputUrl); } catch(e) { return reject(new Error('Invalid URL')); }
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'Referer': 'https://a.111477.xyz/',
      }
    }, res => {
      res.resume();
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location;
        const next = loc.startsWith('http') ? loc : (parsed.origin + loc);
        resolve(next, depth + 1).then(resolvePromise).catch(reject);
      } else {
        resolvePromise(inputUrl);
      }
    });
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// Stream proxy with Range support
function proxy(targetUrl, clientReq, clientRes) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch(e) {
    clientRes.writeHead(400); clientRes.end('Bad URL'); return;
  }
  
  // Extract clean filename for HTTP headers
  let filename = 'video.mkv';
  try { filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'video.mkv'); } catch(e) {}

  const headers = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': '*/*',
    'Referer': 'https://a.111477.xyz/',
    'Connection': 'keep-alive',
  };
  if (clientReq.headers['range']) headers['Range'] = clientReq.headers['range'];

  const upReq = https.request({
    hostname: parsed.hostname, port: 443,
    path: parsed.pathname + parsed.search,
    method: 'GET', headers,
  }, upRes => {
    const out = {
      'Content-Type':  upRes.headers['content-type']  || 'video/x-matroska',
      'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`, // Forces Infuse to see the real name
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    };
    if (upRes.headers['content-length']) out['Content-Length'] = upRes.headers['content-length'];
    if (upRes.headers['content-range'])  out['Content-Range']  = upRes.headers['content-range'];
    clientRes.writeHead(upRes.statusCode, out);
    upRes.pipe(clientRes);
    clientReq.on('close', () => upReq.destroy());
  });
  upReq.setTimeout(30000, () => upReq.destroy());
  upReq.on('error', err => {
    if (!clientRes.headersSent) { clientRes.writeHead(502); clientRes.end(err.message); }
  });
  upReq.end();
}

const UI = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Infuse Proxy</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0e0e10; color: #f0f0f0; font-family: ui-monospace, monospace;
         padding: 24px 16px; max-width: 600px; margin: 0 auto; }
  h1 { font-size: 16px; color: #4f9eff; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #666; margin-bottom: 24px; line-height: 1.6; }
  label { display: block; font-size: 11px; color: #666; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .5px; }
  textarea { width: 100%; background: #18181c; border: 1px solid rgba(255,255,255,.1);
             border-radius: 10px; padding: 12px; font-family: inherit; font-size: 12px;
             color: #f0f0f0; resize: vertical; min-height: 90px; outline: none; line-height: 1.5; }
  textarea:focus { border-color: #4f9eff; }
  select { width: 100%; background: #18181c; border: 1px solid rgba(255,255,255,.1);
           border-radius: 10px; padding: 12px; font-family: inherit; font-size: 12px;
           color: #f0f0f0; outline: none; margin-bottom: 16px; appearance: none; }
  select:focus { border-color: #4f9eff; }
  .go { display: block; width: 100%; background: #4f9eff; color: #000;
        border: none; border-radius: 10px; padding: 14px; font-size: 13px; font-weight: 700;
        cursor: pointer; font-family: inherit; }
  .go:active { opacity: .85; }
  .card { margin-top: 20px; background: #1a1a1e; border: 1px solid rgba(255,255,255,.08);
          border-radius: 12px; overflow: hidden; display: none; }
  .card.show { display: block; }
  .section { padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.06); }
  .section:last-child { border-bottom: none; }
  .slabel { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .7px; margin-bottom: 8px; }
  .urlbox { background: #111; border-radius: 7px; padding: 10px 12px; font-size: 11px;
            word-break: break-all; color: #34d399; line-height: 1.5; margin-bottom: 10px; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { padding: 9px 16px; border-radius: 8px; font-size: 12px; font-weight: 700;
         cursor: pointer; font-family: inherit; border: none; }
  .bi { background: #4f9eff; color: #000; }
  .bc { background: #222; color: #f0f0f0; border: 1px solid rgba(255,255,255,.1); }
  .bc.ok { color: #34d399; border-color: #34d399; }
  .msg { padding: 20px 16px; font-size: 12px; color: #666; text-align: center; }
  .err { color: #f87171; }
  .note { font-size: 11px; color: #444; line-height: 1.8; margin-top: 24px;
          padding-top: 20px; border-top: 1px solid rgba(255,255,255,.06); }
  .note b { color: #888; }
</style>
</head>
<body>
<h1>&#9654; Infuse Proxy</h1>
<p class="sub">Paste a file URL from a.111477.xyz.<br>Get a streaming link that works in Infuse.</p>

<label>Server IP Address</label>
<select id="ipSelect"></select>

<label>Paste file URL</label>
<textarea id="inp" placeholder="https://a.111477.xyz/tvs/Show/Season/Episode.mkv"></textarea>
<button class="go" id="goBtn">Generate Link</button>

<div class="card" id="card">
  <div class="msg" id="msg">Working...</div>
  <div id="out"></div>
</div>

<p class="note">
  <b>Steps:</b><br>
  1. Open a.111477.xyz in your browser &amp; find the file<br>
  2. Long-press the filename &rarr; Copy Link<br>
  3. Paste above &rarr; Generate Link<br>
  4. Tap <b>Open in Infuse</b>
</p>

<script>
// Load dynamic IPs passed from the Node backend
const availableIps = /*__IPS__*/;
const sel = document.getElementById('ipSelect');

// Populate dropdown
availableIps.forEach(ip => {
  const opt = document.createElement('option');
  opt.value = ip;
  opt.textContent = ip === 'localhost' ? 'localhost (This device only)' : ip + ' (Network WiFi)';
  if (location.hostname === ip) opt.selected = true; // Auto-select current access IP
  sel.appendChild(opt);
});

if (sel.value === 'localhost' && availableIps.length > 1) {
  sel.value = availableIps[1]; 
}

document.getElementById('goBtn').onclick = run;
document.getElementById('inp').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run(); }
});

document.getElementById('inp').addEventListener('paste', () => setTimeout(run, 80));

async function run() {
  const raw = document.getElementById('inp').value.trim();
  if (!raw) return;
  const card = document.getElementById('card');
  const msg  = document.getElementById('msg');
  const out  = document.getElementById('out');
  card.classList.add('show');
  msg.textContent = 'Resolving URL\u2026';
  msg.className = 'msg';
  out.innerHTML = '';

  try {
    const r = await fetch('/api/resolve?u=' + encodeURIComponent(raw));
    if (!r.ok) throw new Error('Server error ' + r.status);
    const d = await r.json();
    if (d.error) { msg.textContent = d.error; msg.className = 'msg err'; return; }

    msg.style.display = 'none';
    const final = d.finalUrl;
    
    // Extract real filename and explicitly decode it to fix the %2520 double-encoding bug
    let filename = 'video.mkv';
    try {
      const parsedPath = new URL(final).pathname;
      const rawName = parsedPath.substring(parsedPath.lastIndexOf('/') + 1);
      filename = decodeURIComponent(rawName) || 'video.mkv';
    } catch(e) {}

    const selectedIp = sel.value;
    const port = location.port ? ':' + location.port : '';
    const activeHost = location.protocol + '//' + selectedIp + port;
    
    // Completely removed '/stream' from the path. It's now just the filename.
    const proxyUrl = activeHost + '/' + encodeURIComponent(filename) + '?u=' + encodeURIComponent(final);

    out.innerHTML =
      makeSection('Direct URL (try this first)', final,
        makeBtn('bi', 'Open in Infuse', 'infuse://x-callback-url/play?url=' + encodeURIComponent(final)),
        makeBtn('bc', 'Copy', final, true)) +
      makeSection('Proxy URL (if direct fails)', proxyUrl,
        makeBtn('bi', 'Open via Proxy in Infuse', 'infuse://x-callback-url/play?url=' + encodeURIComponent(proxyUrl)),
        makeBtn('bc', 'Copy', proxyUrl, true));

    // Events
    out.querySelectorAll('[data-href]').forEach(b => {
      b.addEventListener('click', () => { location.href = b.dataset.href; });
    });
    out.querySelectorAll('[data-copy]').forEach(b => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.copy).then(() => {
          const prev = b.textContent;
          b.textContent = 'Copied!'; b.classList.add('ok');
          setTimeout(() => { b.textContent = prev; b.classList.remove('ok'); }, 1500);
        });
      });
    });
  } catch(e) {
    msg.textContent = 'Error: ' + e.message;
    msg.className = 'msg err';
  }
}

function makeSection(label, urlText, ...buttons) {
  return '<div class="section"><div class="slabel">' + label + '</div>'
    + '<div class="urlbox">' + esc(urlText) + '</div>'
    + '<div class="btns">' + buttons.join('') + '</div></div>';
}

function makeBtn(cls, label, value, isCopy) {
  if (isCopy) return '<button class="btn ' + cls + '" data-copy="' + esc(value) + '">' + label + '</button>';
  return '<button class="btn ' + cls + '" data-href="' + esc(value) + '">' + label + '</button>';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`;

http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, 'http://x'); } catch(e) {
    res.writeHead(400); res.end(); return;
  }

  // UI (Only loads if there is no target URL parameter)
  if (u.pathname === '/' && !u.searchParams.has('u')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const nets = os.networkInterfaces();
    const ips = ['localhost'];
    for (const name of Object.keys(nets)) {
      for (const n of nets[name]) {
        if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
      }
    }
    const finalUI = UI.replace('/*__IPS__*/', JSON.stringify(ips));
    return res.end(finalUI);
  }

  // Resolve redirects
  if (u.pathname === '/api/resolve') {
    const target = u.searchParams.get('u');
    if (!target) { res.writeHead(400); return res.end('missing u'); }
    resolve(target)
      .then(finalUrl => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ finalUrl }));
      })
      .catch(err => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ finalUrl: target, note: err.message }));
      });
    return;
  }

  // Stream proxy (Triggers on ANY path now, as long as it contains the '?u=' parameter)
  if (u.searchParams.has('u')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range' });
      return res.end();
    }
    const target = u.searchParams.get('u');
    if (!target) { res.writeHead(400); return res.end('missing u'); }
    proxy(target, req, res);
    return;
  }

  res.writeHead(404); res.end();

}).listen(PORT, '0.0.0.0', () => {
  console.log('\n  ▶  Infuse Proxy is running!\n');
  console.log('  Open in your browser:');
  console.log('  http://localhost:' + PORT + '\n');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log('  http://' + n.address + ':' + PORT + '  (same WiFi)');
      }
    }
  }
  console.log('');
});
