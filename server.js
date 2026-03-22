require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Database Connection (individual params — avoids URL-encoding issues) ────
const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    ssl: { rejectUnauthorized: false },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const { rows } = await pool.query(
            'SELECT user_id FROM sessions WHERE token = $1', [token]
        );
        if (!rows.length) return res.status(401).json({ error: 'Unauthorized' });
        req.userId = rows[0].user_id;
        next();
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Username and password required' });
    try {
        const id = uuidv4();
        await pool.query(
            'INSERT INTO users (id, username, password) VALUES ($1, $2, $3)',
            [id, username, password]
        );
        const token = uuidv4();
        await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, id]);
        res.json({ token, user: { id, username } });
    } catch (err) {
        if (err.code === '23505') return res.status(409).json({ error: 'Username already taken' });
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE LOWER(username) = LOWER($1) AND password = $2',
            [username, password]
        );
        if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
        const user = rows[0];
        const token = uuidv4();
        await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1, $2)', [token, user.id]);
        res.json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/logout', requireAuth, async (req, res) => {
    const token = req.headers['authorization'];
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
    const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.userId]);
    res.json(rows[0]);
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.get('/api/users', requireAuth, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, username FROM users WHERE id != $1 ORDER BY username', [req.userId]
    );
    res.json(rows);
});

// ─── Posts ────────────────────────────────────────────────────────────────────
app.get('/api/posts', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT
        p.id, p.content, p.created_at,
        u.id   AS author_id,   u.username   AS author_username,
        qp.id  AS qp_id,       qp.content   AS qp_content,
        qu.id  AS qu_id,       qu.username  AS qu_username,
        COUNT(l.user_id)::int                AS likes,
        BOOL_OR(l.user_id = $1)             AS liked_by_me
      FROM posts p
      JOIN users u   ON u.id  = p.author_id
      LEFT JOIN posts qp ON qp.id = p.quoted_post_id
      LEFT JOIN users qu ON qu.id = qp.author_id
      LEFT JOIN likes l  ON l.post_id = p.id
      GROUP BY p.id, u.id, qp.id, qu.id
      ORDER BY p.created_at DESC
    `, [req.userId]);
        res.json(rows.map(r => ({
            id: r.id, content: r.content, createdAt: r.created_at,
            author: { id: r.author_id, username: r.author_username },
            quotedPost: r.qp_id ? {
                id: r.qp_id, content: r.qp_content,
                author: { id: r.qu_id, username: r.qu_username }
            } : null,
            likes: r.likes, likedByMe: r.liked_by_me,
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/posts', requireAuth, async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim())
        return res.status(400).json({ error: 'Content required' });
    try {
        const id = uuidv4();
        await pool.query(
            'INSERT INTO posts (id, author_id, content) VALUES ($1, $2, $3)',
            [id, req.userId, content.trim()]
        );
        const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.userId]);
        res.json({ id, content: content.trim(), createdAt: new Date(), author: rows[0], quotedPost: null, likes: 0, likedByMe: false });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/posts/:id/quote', requireAuth, async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim())
        return res.status(400).json({ error: 'Comment required when quoting' });
    try {
        const orig = await pool.query('SELECT id FROM posts WHERE id = $1', [req.params.id]);
        if (!orig.rows.length) return res.status(404).json({ error: 'Post not found' });
        const id = uuidv4();
        await pool.query(
            'INSERT INTO posts (id, author_id, content, quoted_post_id) VALUES ($1,$2,$3,$4)',
            [id, req.userId, content.trim(), req.params.id]
        );
        const { rows } = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.userId]);
        res.json({ id, content: content.trim(), createdAt: new Date(), author: rows[0], quotedPost: null, likes: 0, likedByMe: false });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── Likes ────────────────────────────────────────────────────────────────────
app.post('/api/posts/:id/like', requireAuth, async (req, res) => {
    const { id: postId } = req.params;
    const userId = req.userId;
    try {
        const exists = await pool.query(
            'SELECT 1 FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]
        );
        if (exists.rows.length) {
            await pool.query('DELETE FROM likes WHERE user_id = $1 AND post_id = $2', [userId, postId]);
        } else {
            await pool.query('INSERT INTO likes (user_id, post_id) VALUES ($1, $2)', [userId, postId]);
        }
        const { rows } = await pool.query('SELECT COUNT(*)::int AS likes FROM likes WHERE post_id = $1', [postId]);
        res.json({ likes: rows[0].likes, likedByMe: !exists.rows.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── Messages ─────────────────────────────────────────────────────────────────
app.get('/api/messages/:userId', requireAuth, async (req, res) => {
    try {
        const { rows } = await pool.query(`
      SELECT m.id, m.content, m.created_at,
        fu.id AS from_id, fu.username AS from_username,
        tu.id AS to_id,   tu.username AS to_username
      FROM messages m
      JOIN users fu ON fu.id = m.from_id
      JOIN users tu ON tu.id = m.to_id
      WHERE (m.from_id = $1 AND m.to_id = $2)
         OR (m.from_id = $2 AND m.to_id = $1)
      ORDER BY m.created_at ASC
    `, [req.userId, req.params.userId]);
        res.json(rows.map(r => ({
            id: r.id, content: r.content, createdAt: r.created_at,
            from: { id: r.from_id, username: r.from_username },
            to: { id: r.to_id, username: r.to_username },
        })));
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/messages', requireAuth, async (req, res) => {
    const { toId, content } = req.body;
    if (!toId || !content || !content.trim())
        return res.status(400).json({ error: 'toId and content required' });
    try {
        const recip = await pool.query('SELECT id, username FROM users WHERE id = $1', [toId]);
        if (!recip.rows.length) return res.status(404).json({ error: 'Recipient not found' });
        const id = uuidv4();
        await pool.query(
            'INSERT INTO messages (id, from_id, to_id, content) VALUES ($1,$2,$3,$4)',
            [id, req.userId, toId, content.trim()]
        );
        const sender = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.userId]);
        res.json({ id, content: content.trim(), createdAt: new Date(), from: sender.rows[0], to: recip.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// ─── Fallback ─────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
pool.query('SELECT 1')
    .then(() => {
        console.log('✅ Connected to Supabase PostgreSQL');
        app.listen(PORT, () => console.log(`🚀 Twitter app running at http://localhost:${PORT}`));
    })
    .catch(err => {
        console.error('❌ DB connection failed:', err.message);
        process.exit(1);
    });
