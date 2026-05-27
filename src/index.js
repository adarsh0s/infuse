// Follow redirects and return final URL
async function resolve(inputUrl, depth = 0) {
  if (depth > 10) return inputUrl;
  
  try {
    const response = await fetch(inputUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept': '*/*',
        'Referer': 'https://a.111477.xyz/',
      },
      redirect: 'manual' // Prevents auto-following so we can track the chain
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get('location');
      if (loc) {
        const parsed = new URL(inputUrl);
        const next = loc.startsWith('http') ? loc : (parsed.origin + loc);
        return resolve(next, depth + 1);
      }
    }
    
    return inputUrl;
  } catch (e) {
    throw new Error('Resolve error: ' + e.message);
  }
}

// Stream proxy with Range support
async function proxy(targetUrl, request) {
  let parsed;
  try { 
    parsed = new URL(targetUrl); 
  } catch(e) {
    return new Response('Bad URL', { status: 400 });
  }
  
  // Extract clean filename for HTTP headers
  let filename = 'video.mkv';
  try { filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'video.mkv'); } catch(e) {}

  const headers = new Headers({
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Accept': '*/*',
    'Referer': 'https://a.111477.xyz/'
  });

  // Pass along Range headers if Infuse requests chunks
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);

  try {
    const upRes = await fetch(targetUrl, {
      method: 'GET', 
      headers
    });

    const outHeaders = new Headers({
      'Content-Type':  upRes.headers.get('content-type')  || 'video/x-matroska',
      'Content-Disposition': `inline; filename="${filename.replace(/"/g, '')}"`, 
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });

    const cl = upRes.headers.get('content-length');
    if (cl) outHeaders.set('Content-Length', cl);
    
    const cr = upRes.headers.get('content-range');
    if (cr) outHeaders.set('Content-Range', cr);

    return new Response(upRes.body, {
      status: upRes.status,
      headers: outHeaders
    });
  } catch (e) {
    return new Response(e.message, { status: 502 });
  }
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
  opt.textContent = ip === 'localhost' ? 'localhost (This device only)' : ip + ' (Cloudflare Edge)';
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

export default {
  async fetch(request, env, ctx) {
    let u;
    try {
      u = new URL(request.url);
    } catch (e) {
      return new Response(null, { status: 400 });
    }

    // UI (Only loads if there is no target URL parameter)
    if (u.pathname === '/' && !u.searchParams.has('u')) {
      // In Cloudflare, we don't have local network IPs.
      // We just use the worker's own public hostname.
      const ips = [u.hostname];
      const finalUI = UI.replace('/*__IPS__*/', JSON.stringify(ips));
      return new Response(finalUI, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Resolve redirects
    if (u.pathname === '/api/resolve') {
      const target = u.searchParams.get('u');
      if (!target) {
        return new Response('missing u', { status: 400 });
      }
      
      try {
        const finalUrl = await resolve(target);
        return new Response(JSON.stringify({ finalUrl }), {
          headers: { 
            'Content-Type': 'application/json', 
            'Access-Control-Allow-Origin': '*' 
          }
        });
      } catch (err) {
        return new Response(JSON.stringify({ finalUrl: target, note: err.message }), {
          headers: { 
            'Content-Type': 'application/json', 
            'Access-Control-Allow-Origin': '*' 
          }
        });
      }
    }

    // Stream proxy (Triggers on ANY path as long as it contains the '?u=' parameter)
    if (u.searchParams.has('u')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: { 
            'Access-Control-Allow-Origin': '*', 
            'Access-Control-Allow-Headers': 'Range' 
          }
        });
      }
      
      const target = u.searchParams.get('u');
      if (!target) {
        return new Response('missing u', { status: 400 });
      }
      
      return proxy(target, request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
