import express from 'express';
import path from 'path';
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';

const __dirname = path.resolve();
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─────────────────────────────────────────────
// SOCKS5 Configuration
// ─────────────────────────────────────────────
const SOCKS5_PROXY = process.env.SOCKS5_PROXY || 'socks5://1:1@38.255.51.201:1080';

const GROWTOPIA_BASE = 'https://login.growtopiagame.com';

function getAgent() {
  return SOCKS5_PROXY ? new SocksProxyAgent(SOCKS5_PROXY) : undefined;
}

// ─────────────────────────────────────────────
// Reverse Proxy Helper
// Fetch dari Growtopia via SOCKS5 lalu pipe ke client
// ─────────────────────────────────────────────
function proxyRequest(targetUrl, req, res) {
  const agent = getAgent();

  const options = {
    agent,
    method: req.method,
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      'Accept': req.headers['accept'] || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'en-US,en;q=0.9',
      'Referer': GROWTOPIA_BASE,
      'Origin': GROWTOPIA_BASE,
    },
  };

  const proxyReq = https.request(targetUrl, options, (proxyRes) => {
    // Teruskan status & headers penting
    const forwardHeaders = {};
    const allowedHeaders = [
      'content-type', 'cache-control', 'set-cookie',
      'content-encoding', 'transfer-encoding',
    ];
    for (const h of allowedHeaders) {
      if (proxyRes.headers[h]) forwardHeaders[h] = proxyRes.headers[h];
    }

    // Kalau ada redirect dari Growtopia, teruskan ke client
    if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
      const location = proxyRes.headers['location'] || '/';
      return res.redirect(proxyRes.statusCode, location);
    }

    res.writeHead(proxyRes.statusCode, forwardHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[ProxyError]', err.message);
    res.status(502).send(`Proxy error: ${err.message}`);
  });

  proxyReq.setTimeout(15000, () => {
    proxyReq.destroy(new Error('Proxy request timeout'));
  });

  // Forward body kalau POST
  if (req.method === 'POST' && req.body) {
    const body = new URLSearchParams(req.body).toString();
    proxyReq.write(body);
  }

  proxyReq.end();
}

// ─────────────────────────────────────────────
// Routes: Existing
// ─────────────────────────────────────────────

app.post('/player/growid/checktoken', (_req, res) => {
  res.json({
    status: 'redirect',
    message: 'Token is invalid.',
    token: '',
    url: '',
    accountType: 'growtopia',
    accountAge: 2,
  });
});

app.get('/', (_req, res) => {
  res.redirect('/player/login/dashboard');
});

app.all('/player/login/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'html', 'login.html'));
});

// ─────────────────────────────────────────────
// Routes: GrowID Login via SOCKS5
// Dipanggil dari login.html saat klik "Growtopia Login"
// GET /proxy/growid/login?token=...
// ─────────────────────────────────────────────
app.all('/proxy/growid/login', (req, res) => {
  const token = req.query.token || req.body?.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/player/growid/login?token=${encodeURIComponent(token)}`;
  console.log(`[SOCKS5] GrowID login → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

// ─────────────────────────────────────────────
// Routes: Google Login via SOCKS5
// GET /proxy/google/redirect?token=...
// ─────────────────────────────────────────────
app.all('/proxy/google/redirect', (req, res) => {
  const token = req.query.token || req.body?.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/google/redirect?token=${encodeURIComponent(token)}`;
  console.log(`[SOCKS5] Google login → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

// ─────────────────────────────────────────────
// Routes: Redirect.html — iframe via SOCKS5
// GET /proxy/growid/frame?token=...
// ─────────────────────────────────────────────
app.all('/proxy/growid/frame', (req, res) => {
  const token = req.query.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/player/growid/login?token=${encodeURIComponent(token)}`;
  console.log(`[SOCKS5] GrowID frame → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

// ─────────────────────────────────────────────
// Routes: Proxy umum untuk path Growtopia lainnya
// GET /proxy/gt/*  → https://login.growtopiagame.com/*
// ─────────────────────────────────────────────
app.all('/proxy/gt/*', (req, res) => {
  const subPath = req.params[0];
  const query = Object.keys(req.query).length
    ? '?' + new URLSearchParams(req.query).toString()
    : '';
  const targetUrl = `${GROWTOPIA_BASE}/${subPath}${query}`;
  console.log(`[SOCKS5] General proxy → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

// ─────────────────────────────────────────────
// Routes: Test & Status
// ─────────────────────────────────────────────
app.get('/proxy/test', async (_req, res) => {
  try {
    const agent = getAgent();
    const ip = await new Promise((resolve, reject) => {
      const r = https.get('https://api.ipify.org?format=json', { agent }, (resp) => {
        let body = '';
        resp.on('data', (c) => (body += c));
        resp.on('end', () => resolve(JSON.parse(body).ip));
      });
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(new Error('timeout')));
    });
    res.json({ status: 'ok', proxy: SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@'), ip_via_proxy: ip });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/proxy/status', (_req, res) => {
  res.json({
    proxy_enabled: !!SOCKS5_PROXY,
    proxy: SOCKS5_PROXY ? SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@') : null,
  });
});

// ─────────────────────────────────────────────
// 404 & Error Handler
// ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).send('<h1 style="color:red; text-align:center;"><i>Page Not Found <br> (404)</i></h1>');
});

app.use((err, _req, res, _next) => {
  console.error('An error occurred:', err.message);
  res.status(500).send('Something went wrong.');
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  const safeProxy = SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@');
  console.log(`SOCKS5 Proxy aktif: ${safeProxy}`);
});
