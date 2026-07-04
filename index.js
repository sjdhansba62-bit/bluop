import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// SOCKS5 Configuration
// ─────────────────────────────────────────────
const SOCKS5_PROXY = process.env.SOCKS5_PROXY || 'socks5://1:1@38.255.51.201:1080';
const GROWTOPIA_BASE = 'https://login.growtopiagame.com';

function getAgent() {
  try {
    return new SocksProxyAgent(SOCKS5_PROXY);
  } catch (e) {
    console.error('[SOCKS5] Failed to create agent:', e.message);
    return undefined;
  }
}

// ─────────────────────────────────────────────
// Reverse Proxy Helper
// ─────────────────────────────────────────────
function proxyRequest(targetUrl, req, res) {
  let agent;
  try {
    agent = getAgent();
  } catch (e) {
    return res.status(500).send('Failed to initialize proxy agent.');
  }

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

  try {
    const proxyReq = https.request(targetUrl, options, (proxyRes) => {
      const forwardHeaders = {};
      const allowedHeaders = [
        'content-type', 'cache-control', 'set-cookie',
        'content-encoding', 'transfer-encoding',
      ];
      for (const h of allowedHeaders) {
        if (proxyRes.headers[h]) forwardHeaders[h] = proxyRes.headers[h];
      }

      if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
        const location = proxyRes.headers['location'] || '/';
        return res.redirect(proxyRes.statusCode, location);
      }

      res.writeHead(proxyRes.statusCode, forwardHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('[ProxyError]', err.message);
      if (!res.headersSent) {
        res.status(502).send(`Proxy error: ${err.message}`);
      }
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy(new Error('Proxy request timeout'));
    });

    if (req.method === 'POST' && req.body) {
      const body = new URLSearchParams(req.body).toString();
      proxyReq.write(body);
    }

    proxyReq.end();
  } catch (err) {
    console.error('[ProxyRequest Exception]', err.message);
    if (!res.headersSent) {
      res.status(500).send(`Internal proxy error: ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────
// Routes
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
// Proxy Routes (via SOCKS5)
// ─────────────────────────────────────────────

app.all('/proxy/growid/login', (req, res) => {
  const token = req.query.token || req.body?.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/player/growid/login?token=${token}`;
  console.log(`[SOCKS5] GrowID login → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

app.all('/proxy/google/redirect', (req, res) => {
  const token = req.query.token || req.body?.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/google/redirect?token=${token}`;
  console.log(`[SOCKS5] Google login → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

app.all('/proxy/growid/frame', (req, res) => {
  const token = req.query.token || '';
  const targetUrl = `${GROWTOPIA_BASE}/player/growid/login?token=${token}`;
  console.log(`[SOCKS5] GrowID frame → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

app.all('/proxy/gt/*path', (req, res) => {
  const subPath = req.params.path;
  const query = Object.keys(req.query).length
    ? '?' + new URLSearchParams(req.query).toString()
    : '';
  const targetUrl = `${GROWTOPIA_BASE}/${subPath}${query}`;
  console.log(`[SOCKS5] General proxy → ${targetUrl}`);
  proxyRequest(targetUrl, req, res);
});

app.get('/proxy/test', async (_req, res) => {
  try {
    const agent = getAgent();
    const ip = await new Promise((resolve, reject) => {
      const r = https.get('https://api.ipify.org?format=json', { agent }, (resp) => {
        let body = '';
        resp.on('data', (c) => (body += c));
        resp.on('end', () => {
          try { resolve(JSON.parse(body).ip); }
          catch (e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(new Error('timeout')));
    });
    res.json({ status: 'ok', proxy: SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@'), ip_via_proxy: ip });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ─────────────────────────────────────────────
// 404 & Error Handler
// ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).send('<h1 style="color:red; text-align:center;"><i>Page Not Found <br> (404)</i></h1>');
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('An error occurred:', err.message);
  res.status(500).send('Something went wrong.');
});

// ─────────────────────────────────────────────
// Export untuk Vercel + listen lokal
// ─────────────────────────────────────────────
export default app;

if (process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`SOCKS5 Proxy: ${SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@')}`);
  });
}
