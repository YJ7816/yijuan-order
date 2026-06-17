const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const Database = require('better-sqlite3');

// ========== CONFIG ==========
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'yijuan888';
const DB_PATH = path.join(__dirname, 'data.db');

// ========== DATABASE ==========
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    note TEXT DEFAULT '',
    items TEXT NOT NULL,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// ========== HELPERS ==========
function generateOrderNo() {
  const now = new Date();
  const date = now.toISOString().slice(2, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(/:/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `YJ${date}${time}${rand}`;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };
  return types[ext] || 'application/octet-stream';
}

// ========== SERVER ==========
const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS
    if (req.method === 'OPTIONS') {
      sendJSON(res, { ok: true });
      return;
    }

    // ===== API ROUTES =====

    // POST /api/order — Create order
    if (req.method === 'POST' && pathname === '/api/order') {
      const body = await parseBody(req);
      const { name, phone, address, note, items, total } = body;

      if (!name || !phone || !address || !items || !items.length) {
        sendJSON(res, { error: '请填写完整信息' }, 400);
        return;
      }

      const orderNo = generateOrderNo();
      const stmt = db.prepare(`
        INSERT INTO orders (order_no, customer_name, phone, address, note, items, total_price, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
      `);
      stmt.run(orderNo, name, phone, address, note || '', JSON.stringify(items), total);

      console.log(`📦 新订单 #${orderNo} — ${name} — ¥${total}`);

      sendJSON(res, {
        ok: true,
        order: { order_no: orderNo, name, phone, address, total }
      });
      return;
    }

    // GET /api/orders — List orders (admin)
    if (req.method === 'GET' && pathname === '/api/orders') {
      const status = parsed.query.status || '';
      let rows;
      if (status) {
        rows = db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC').all(status);
      } else {
        rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 50').all();
      }
      const orders = rows.map(r => ({ ...r, items: JSON.parse(r.items) }));
      sendJSON(res, { orders });
      return;
    }

    // GET /api/order/:orderNo — Single order
    if (req.method === 'GET' && pathname.startsWith('/api/order/')) {
      const orderNo = pathname.split('/api/order/')[1];
      const row = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
      if (!row) {
        sendJSON(res, { error: '订单不存在' }, 404);
        return;
      }
      sendJSON(res, { order: { ...row, items: JSON.parse(row.items) } });
      return;
    }

    // PUT /api/order/:orderNo — Update order status
    if (req.method === 'PUT' && pathname.startsWith('/api/order/')) {
      const orderNo = pathname.split('/api/order/')[1];
      const body = await parseBody(req);
      const { status } = body;

      if (!['new', 'paid', 'cooking', 'delivering', 'completed', 'cancelled'].includes(status)) {
        sendJSON(res, { error: '无效状态' }, 400);
        return;
      }

      db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_no = ?').run(status, orderNo);
      console.log(`📝 订单 #${orderNo} → ${status}`);
      sendJSON(res, { ok: true, status });
      return;
    }

    // ===== STATIC FILES =====
    let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
    
    // Don't serve server.js or package.json
    const basename = path.basename(filePath);
    if (['server.js', 'package.json', 'package-lock.json', 'data.db'].includes(basename)) {
      res.writeHead(404);
      res.end('404');
      return;
    }

    // Check if file exists
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': getContentType(filePath) });
      res.end(content);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 — 页面未找到</h1>');
    }
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n🍵 艺卷点餐系统已启动`);
  console.log(`   顾客页面: http://localhost:${PORT}`);
  console.log(`   管理后台: http://localhost:${PORT}/admin.html`);
  console.log(`   管理密码: ${ADMIN_PASSWORD}\n`);
});
