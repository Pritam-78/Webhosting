const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer  = require('multer');
const { Pool } = require('pg');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = 5000;
const JWT_SECRET     = process.env.JWT_SECRET || 'htmlhost_jwt_secret_2024_secure';
const ADMIN_PASSWORD = 'pritam@ixA';
const SITE_LIMIT     = 5;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    '0.0.0.0'
  );
}

function generateSlug() {
  return uuidv4().replace(/-/g, '').substring(0, 10);
}

async function shortenURL(longUrl) {
  return new Promise((resolve) => {
    const encoded = encodeURIComponent(longUrl);
    const req = https.get(
      `https://tinyurl.com/api-create.php?url=${encoded}`,
      { timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          const short = data.trim();
          resolve(short.startsWith('http') ? short : longUrl);
        });
      }
    );
    req.on('error',   () => resolve(longUrl));
    req.on('timeout', () => { req.destroy(); resolve(longUrl); });
  });
}

// ─── IP Ban Middleware ─────────────────────────────────────────────────────────

async function ipBanMiddleware(req, res, next) {
  // Skip static assets
  if (req.path.startsWith('/styles') || req.path.startsWith('/app.js') ||
      req.path.startsWith('/favicon') || req.path.match(/\.(css|js|png|ico|woff)$/)) {
    return next();
  }
  try {
    const ip = getClientIP(req);
    const result = await pool.query('SELECT reason FROM banned_ips WHERE ip_address = $1', [ip]);
    if (result.rows.length > 0) {
      const reason = result.rows[0].reason || 'No reason provided';
      return res.status(403).send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>403 — Access Denied</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',system-ui,sans-serif;background:#06060f;color:#fff;min-height:100vh;
    display:flex;align-items:center;justify-content:center;padding:24px;
    background-image:radial-gradient(ellipse 70% 50% at 50% 20%,rgba(240,68,68,0.12) 0%,transparent 70%)}
  .card{max-width:480px;width:100%;text-align:center}
  .icon{width:80px;height:80px;border-radius:24px;background:rgba(240,68,68,0.12);
    border:1px solid rgba(240,68,68,0.3);display:flex;align-items:center;justify-content:center;
    font-size:2rem;margin:0 auto 28px;box-shadow:0 0 40px rgba(240,68,68,0.2)}
  .code{font-size:5rem;font-weight:900;letter-spacing:-0.04em;
    background:linear-gradient(135deg,#f04444,#f97316);
    -webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:8px}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:12px;color:#fff}
  p{color:#6060a0;line-height:1.65;font-size:0.9rem;margin-bottom:20px}
  .reason{background:rgba(240,68,68,0.08);border:1px solid rgba(240,68,68,0.2);
    border-radius:10px;padding:12px 16px;font-size:0.82rem;color:#fca5a5;margin-bottom:28px}
  .reason strong{display:block;color:#f87171;margin-bottom:4px;font-size:0.75rem;
    text-transform:uppercase;letter-spacing:0.06em}
  .meta{font-size:0.75rem;color:#3a3a5c;border-top:1px solid rgba(255,255,255,0.05);
    padding-top:20px;margin-top:8px}
</style></head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <div class="code">403</div>
    <h1>Access Denied</h1>
    <p>Your IP address has been blocked from accessing this platform. If you believe this is an error, please contact the administrator.</p>
    <div class="reason"><strong>Block Reason</strong>${reason}</div>
    <div class="meta">IP: ${ip} &nbsp;·&nbsp; HTMLhost Security System</div>
  </div>
</body></html>`);
    }
    next();
  } catch (err) {
    console.error('IP ban check error:', err.message);
    next();
  }
}

app.use(ipBanMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    if (!decoded.admin) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const ip = getClientIP(req);

    const existing = await pool.query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'already_registered',
        message: 'You are already registered with this email.',
        name: existing.rows[0].name
      });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, name, last_ip, last_seen) VALUES ($1,$2,$3,$4,NOW()) RETURNING id, email, name',
      [email.toLowerCase(), hash, name || null, ip]
    );
    const user = result.rows[0];
    await pool.query(
      'INSERT INTO user_activity (user_id, email, ip_address, action) VALUES ($1,$2,$3,$4)',
      [user.id, user.email, ip, 'register']
    );
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name }, needsName: !user.name });
  } catch (err) {
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const ip = getClientIP(req);

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await pool.query(
        'INSERT INTO user_activity (user_id, email, ip_address, action) VALUES ($1,$2,$3,$4)',
        [user.id, user.email, ip, 'login_failed']
      );
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    await pool.query('UPDATE users SET last_ip=$1, last_seen=NOW() WHERE id=$2', [ip, user.id]);
    await pool.query(
      'INSERT INTO user_activity (user_id, email, ip_address, action) VALUES ($1,$2,$3,$4)',
      [user.id, user.email, ip, 'login']
    );

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name }, needsName: !user.name });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/auth/name', authMiddleware, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
    const result = await pool.query(
      'UPDATE users SET name=$1 WHERE id=$2 RETURNING id, email, name',
      [name.trim(), req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Name update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Sites Routes ─────────────────────────────────────────────────────────────

async function checkSiteLimit(userId, res) {
  const count = await pool.query('SELECT COUNT(*) FROM sites WHERE user_id=$1', [userId]);
  if (parseInt(count.rows[0].count) >= SITE_LIMIT) {
    res.status(429).json({
      error: 'limit_reached',
      message: `Hosting Limit Reached (Max ${SITE_LIMIT} sites). Please delete an existing site to create a new one.`
    });
    return false;
  }
  return true;
}

app.post('/api/sites', authMiddleware, async (req, res) => {
  try {
    const { name, html_content } = req.body;
    if (!name || !html_content) return res.status(400).json({ error: 'Name and HTML content required' });

    if (!(await checkSiteLimit(req.user.id, res))) return;

    let slug = generateSlug();
    for (let i = 0; i < 5; i++) {
      const check = await pool.query('SELECT id FROM sites WHERE slug=$1', [slug]);
      if (check.rows.length === 0) break;
      slug = generateSlug();
    }
    const result = await pool.query(
      'INSERT INTO sites (user_id, name, slug, html_content) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, name.trim(), slug, html_content]
    );
    const site    = result.rows[0];
    const longUrl = `${req.protocol}://${req.get('host')}/site/${site.slug}`;
    const shortUrl = await shortenURL(longUrl);
    res.json({ site, short_url: shortUrl, long_url: longUrl });
  } catch (err) {
    console.error('Create site error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/sites/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    if (!(await checkSiteLimit(req.user.id, res))) return;

    const name = req.body.name || req.file.originalname.replace(/\.(html|htm)$/i, '');
    const html_content = req.file.buffer.toString('utf-8');
    const slug = generateSlug();
    const result = await pool.query(
      'INSERT INTO sites (user_id, name, slug, html_content) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user.id, name.trim(), slug, html_content]
    );
    const site    = result.rows[0];
    const longUrl = `${req.protocol}://${req.get('host')}/site/${site.slug}`;
    const shortUrl = await shortenURL(longUrl);
    res.json({ site, short_url: shortUrl, long_url: longUrl });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sites', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, published_at, status FROM sites WHERE user_id=$1 ORDER BY published_at DESC',
      [req.user.id]
    );
    res.json({ sites: result.rows });
  } catch (err) {
    console.error('Get sites error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/sites/:id', authMiddleware, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const userResult = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    const siteResult = await pool.query(
      'DELETE FROM sites WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (siteResult.rows.length === 0) return res.status(404).json({ error: 'Site not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete site error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Announcement Routes ───────────────────────────────────────────────────────

app.get('/api/announcements/active', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, title, content, type FROM announcements WHERE is_active=true ORDER BY updated_at DESC LIMIT 1'
    );
    res.json({ announcement: result.rows[0] || null });
  } catch (err) {
    console.error('Get announcement error:', err.message);
    res.json({ announcement: null });
  }
});

app.get('/api/admin/announcements', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
    res.json({ announcements: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/announcements', adminAuth, async (req, res) => {
  try {
    const { title, content, type, is_active } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
    if (is_active) await pool.query('UPDATE announcements SET is_active=false');
    const result = await pool.query(
      'INSERT INTO announcements (title, content, type, is_active) VALUES ($1,$2,$3,$4) RETURNING *',
      [title.trim(), content.trim(), type || 'info', !!is_active]
    );
    res.json({ announcement: result.rows[0] });
  } catch (err) {
    console.error('Create announcement error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/announcements/:id', adminAuth, async (req, res) => {
  try {
    const { title, content, type, is_active } = req.body;
    if (is_active) await pool.query('UPDATE announcements SET is_active=false');
    const result = await pool.query(
      'UPDATE announcements SET title=$1, content=$2, type=$3, is_active=$4, updated_at=NOW() WHERE id=$5 RETURNING *',
      [title.trim(), content.trim(), type || 'info', !!is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ announcement: result.rows[0] });
  } catch (err) {
    console.error('Update announcement error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/announcements/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete announcement error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── IP Ban Routes ─────────────────────────────────────────────────────────────

app.get('/api/admin/banned-ips', adminAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banned_ips ORDER BY banned_at DESC');
    res.json({ bannedIPs: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/banned-ips', adminAuth, async (req, res) => {
  try {
    const { ip_address, reason } = req.body;
    if (!ip_address) return res.status(400).json({ error: 'IP address required' });
    const result = await pool.query(
      'INSERT INTO banned_ips (ip_address, reason) VALUES ($1,$2) ON CONFLICT (ip_address) DO UPDATE SET reason=$2, banned_at=NOW() RETURNING *',
      [ip_address.trim(), reason?.trim() || 'Blocked by admin']
    );
    res.json({ bannedIP: result.rows[0] });
  } catch (err) {
    console.error('Ban IP error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/banned-ips/:id', adminAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM banned_ips WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Unban IP error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Admin Stats & Activity ────────────────────────────────────────────────────

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, sites, bannedIPs, userList] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM sites'),
      pool.query('SELECT COUNT(*) FROM banned_ips'),
      pool.query(`
        SELECT u.id, u.email, u.name, u.created_at, u.last_ip, u.last_seen,
               COUNT(s.id) as site_count
        FROM users u LEFT JOIN sites s ON s.user_id = u.id
        GROUP BY u.id, u.email, u.name, u.created_at, u.last_ip, u.last_seen
        ORDER BY u.last_seen DESC NULLS LAST
      `)
    ]);
    res.json({
      totalUsers:   parseInt(users.rows[0].count),
      totalSites:   parseInt(sites.rows[0].count),
      totalBanned:  parseInt(bannedIPs.rows[0].count),
      users:        userList.rows
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/activity', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM user_activity ORDER BY created_at DESC LIMIT 100'
    );
    res.json({ activity: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/user/:id/sites', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT s.*, u.email FROM sites s JOIN users u ON u.id=s.user_id WHERE s.user_id=$1 ORDER BY s.published_at DESC',
      [req.params.id]
    );
    res.json({ sites: result.rows });
  } catch (err) {
    console.error('Admin user sites error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Hosted Site Serving ──────────────────────────────────────────────────────

app.get('/site/:slug', async (req, res) => {
  try {
    const result = await pool.query('SELECT html_content FROM sites WHERE slug=$1', [req.params.slug]);
    if (result.rows.length === 0) {
      return res.status(404).send(`<!DOCTYPE html><html><head><title>404 — HTMLhost</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,sans-serif;background:#08080f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:12px}
h1{font-size:5rem;font-weight:800;background:linear-gradient(135deg,#7c6fff,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p{color:#6060a0}a{color:#7c6fff;text-decoration:none}a:hover{text-decoration:underline}</style></head>
<body><h1>404</h1><p>This page doesn't exist or was removed.</p><a href="/">← Back to HTMLhost</a></body></html>`);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(result.rows[0].html_content);
  } catch (err) {
    console.error('Serve site error:', err.message);
    res.status(500).send('Server error');
  }
});

// ─── Admin Page ───────────────────────────────────────────────────────────────

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '4h' });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Access Denied' });
  }
});

app.get('/pkpadminweb', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTMLhost running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('uncaughtException',  (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (r)   => console.error('Unhandled rejection:', r));
