import express from 'express';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';

const __dirname = path.resolve();
const app = express();

app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─────────────────────────────────────────────
// SOCKS5 Configuration
// Set via environment variable:
//   SOCKS5_PROXY=socks5://user:pass@host:port
//   SOCKS5_PROXY=socks5://host:port  (tanpa auth)
// Kalau tidak di-set, request langsung (no proxy)
// ─────────────────────────────────────────────
const SOCKS5_PROXY = process.env.SOCKS5_PROXY || 'socks5://1:1@38.255.51.201:1080';

/**
 * Buat HTTPS agent dengan SOCKS5 proxy (jika dikonfigurasi)
 * Kalau tidak ada proxy, return undefined (default agent)
 */
function getAgent() {
  if (SOCKS5_PROXY) {
    return new SocksProxyAgent(SOCKS5_PROXY);
  }
  return undefined;
}

/**
 * Helper: lakukan HTTPS GET request via SOCKS5 (atau langsung)
 * @param {string} url - URL yang ingin di-request
 * @returns {Promise<{statusCode, headers, body}>}
 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const agent = getAgent();
    const options = { agent };

    const req = https.get(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({ statusCode: res.statusCode, headers: res.headers, body })
      );
    });

    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timeout'));
    });
  });
}

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────

app.post('/player/growid/checktoken', (req, res) => {
  res.json({
    status: 'redirect',
    message: 'Token is invalid.',
    token: '',
    url: '',
    accountType: 'growtopia',
    accountAge: 2,
  });
});

app.get('/', (req, res) => {
  res.redirect('/player/login/dashboard');
});

app.all('/player/login/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'html', 'login.html'));
});

// ─────────────────────────────────────────────
// Endpoint: Test koneksi SOCKS5 proxy
// GET /proxy/test
// ─────────────────────────────────────────────
app.get('/proxy/test', async (req, res) => {
  if (!SOCKS5_PROXY) {
    return res.status(200).json({
      status: 'no_proxy',
      message: 'SOCKS5_PROXY tidak dikonfigurasi. Request berjalan langsung.',
    });
  }

  try {
    const result = await httpsGet('https://api.ipify.org?format=json');
    const ip = JSON.parse(result.body).ip;
    res.json({
      status: 'ok',
      proxy: SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@'), // sembunyikan password
      ip_via_proxy: ip,
      message: 'Koneksi SOCKS5 berhasil.',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      proxy: SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@'),
      message: `Koneksi SOCKS5 gagal: ${err.message}`,
    });
  }
});

// ─────────────────────────────────────────────
// Endpoint: Info status proxy
// GET /proxy/status
// ─────────────────────────────────────────────
app.get('/proxy/status', (req, res) => {
  res.json({
    proxy_enabled: !!SOCKS5_PROXY,
    proxy: SOCKS5_PROXY
      ? SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@')
      : null,
  });
});

// ─────────────────────────────────────────────
// 404 & Error Handler
// ─────────────────────────────────────────────
app.use((req, res, next) => {
  res
    .status(404)
    .send(
      '<h1 style="color:red; text-align:center;"><i>Page Not Found <br> (404)</i></h1>'
    );
});

app.use((err, req, res, next) => {
  console.error('An error occurred:', err.message);
  res.status(500).send('Something went wrong.');
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (SOCKS5_PROXY) {
    const safeProxy = SOCKS5_PROXY.replace(/:[^:@]+@/, ':***@');
    console.log(`SOCKS5 Proxy aktif: ${safeProxy}`);
  } else {
    console.log('SOCKS5 Proxy: tidak dikonfigurasi (direct connection)');
  }
});
