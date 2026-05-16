const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'htmlhost_jwt_secret_2024_secure';
const ADMIN_PASSWORD = 'pritam@ixA';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function generateSlug() {
  return uuidv4().replace(/-/g, '').substring(0, 10);
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

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
      'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email.toLowerCase(), hash, name || null]
    );
    const user = result.rows[0];
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

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid email or password' });

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

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
      'UPDATE users SET name = $1 WHERE id = $2 RETURNING id, email, name',
      [name.trim(), req.user.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Name update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Sites Routes ─────────────────────────────────────────────────────────────

app.post('/api/sites', authMiddleware, async (req, res) => {
  try {
    const { name, html_content } = req.body;
    if (!name || !html_content) return res.status(400).json({ error: 'Name and HTML content required' });

    let slug = generateSlug();
    for (let i = 0; i < 5; i++) {
      const check = await pool.query('SELECT id FROM sites WHERE slug = $1', [slug]);
      if (check.rows.length === 0) break;
      slug = generateSlug();
    }

    const result = await pool.query(
      'INSERT INTO sites (user_id, name, slug, html_content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name.trim(), slug, html_content]
    );
    res.json({ site: result.rows[0] });
  } catch (err) {
    console.error('Create site error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/sites/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const name = req.body.name || req.file.originalname.replace(/\.(html|htm)$/i, '');
    const html_content = req.file.buffer.toString('utf-8');
    const slug = generateSlug();

    const result = await pool.query(
      'INSERT INTO sites (user_id, name, slug, html_content) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.id, name.trim(), slug, html_content]
    );
    res.json({ site: result.rows[0] });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/sites', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, slug, published_at, status FROM sites WHERE user_id = $1 ORDER BY published_at DESC',
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

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const valid = await bcrypt.compare(password, userResult.rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect password' });

    const siteResult = await pool.query(
      'DELETE FROM sites WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (siteResult.rows.length === 0) return res.status(404).json({ error: 'Site not found' });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete site error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Hosted Site Serving ──────────────────────────────────────────────────────

app.get('/site/:slug', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT html_content FROM sites WHERE slug = $1',
      [req.params.slug]
    );
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

// ─── Admin Routes ─────────────────────────────────────────────────────────────

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

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '2h' });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ success: false, error: 'Access Denied' });
  }
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const [users, sites, userList] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM sites'),
      pool.query(`SELECT u.id, u.email, u.name, u.created_at, COUNT(s.id) as site_count
        FROM users u LEFT JOIN sites s ON s.user_id = u.id
        GROUP BY u.id, u.email, u.name, u.created_at
        ORDER BY u.created_at DESC`)
    ]);
    res.json({
      totalUsers: parseInt(users.rows[0].count),
      totalSites: parseInt(sites.rows[0].count),
      users: userList.rows
    });
  } catch (err) {
    console.error('Admin stats error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/user/:id/sites', adminAuth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT s.*, u.email FROM sites s JOIN users u ON u.id = s.user_id WHERE s.user_id = $1 ORDER BY s.published_at DESC',
      [req.params.id]
    );
    res.json({ sites: result.rows });
  } catch (err) {
    console.error('Admin user sites error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Pages ───────────────────────────────────────────────────────────────────

app.get('/pkpadminweb', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ───────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`HTMLhost running on http://0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
