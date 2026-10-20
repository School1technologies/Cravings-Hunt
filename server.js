const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000, GST = 0.05;
const SECRET = process.env.APP_SECRET || crypto.randomBytes(24).toString('hex');
const SUPER = process.env.SUPER_PASSWORD, RZ_ID = process.env.RAZORPAY_KEY_ID, RZ_SEC = process.env.RAZORPAY_KEY_SECRET;
if (!process.env.APP_SECRET) console.warn('APP_SECRET not set: logins reset on every restart');
if (!SUPER) console.warn('SUPER_PASSWORD not set: super admin login is disabled');

/* ---------- helpers ---------- */
const uid = () => crypto.randomBytes(9).toString('base64url');
const eq = (a, b) => { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const hash = p => { const s = crypto.randomBytes(8).toString('hex'); return s + ':' + crypto.scryptSync(String(p), s, 32).toString('hex'); };
const check = (p, h) => { const [s, x] = String(h).split(':'); return !!x && eq(crypto.scryptSync(String(p), s, 32).toString('hex'), x); };
const mac = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = o => { const b = Buffer.from(JSON.stringify(o)).toString('base64url'); return b + '.' + mac(b); };
const unsign = t => { const [b, m] = String(t).split('.'); if (!b || !m || !eq(mac(b), m)) return null; try { const o = JSON.parse(Buffer.from(b, 'base64url')); return o.exp > Date.now() ? o : null; } catch { return null; } };
const bad = (m, c = 400) => { const e = new Error(m); e.code = c; return e; };
const str = (v, n = 80) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v, max) => { v = Number(v); if (!(v >= 0 && v <= max)) throw bad('Invalid number'); return Math.round(v * 100) / 100; };
const url = v => (/^https?:\/\/[^\s"'<>]{1,500}$/.test(String(v || '')) || /^\/img\/[A-Za-z0-9_-]{6,20}$/.test(String(v || ''))) ? String(v) : '';
let q = Promise.resolve();
const lock = fn => { const r = q.then(fn); q = r.catch(() => {}); return r; };

/* ---------- storage: Postgres if DATABASE_URL, else a local JSON file ---------- */
let db;
async function initDB() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
    await p.query('create table if not exists docs(coll text, id text, data jsonb not null, primary key(coll, id))');
    db = {
      get: async (c, i) => { const r = await p.query('select data from docs where coll=$1 and id=$2', [c, i]); return r.rows[0] && r.rows[0].data; },
      all: async c => (await p.query('select data from docs where coll=$1', [c])).rows.map(r => r.data),
      put: (c, i, d) => p.query('insert into docs(coll,id,data) values($1,$2,$3) on conflict(coll,id) do update set data=$3', [c, i, d]),
      del: (c, i) => p.query('delete from docs where coll=$1 and id=$2', [c, i])
    };
  } else {
    const f = process.env.DATA_FILE || path.join(__dirname, 'data.json'); let m = {};
    try { m = JSON.parse(fs.readFileSync(f)); } catch {}
    const sv = () => fs.writeFileSync(f, JSON.stringify(m));
    db = {
      get: async (c, i) => m[c + '/' + i],
      all: async c => Object.keys(m).filter(k => k.startsWith(c + '/')).map(k => m[k]),
      put: async (c, i, d) => { m[c + '/' + i] = d; sv(); },
      del: async (c, i) => { delete m[c + '/' + i]; sv(); }
    };
  }
}
const dish = (n, c, p, e, v, d, kw, i) => ({ id: uid(), name: n, cat: c, price: p, e, veg: !!v, on: true, d, img: `https://loremflickr.com/400/400/${kw}/all?lock=${i}` });
async function seed() {
  if ((await db.all('r')).length) return;
  const r = { id: uid(), slug: 'spice-route', name: 'Spice Route', pin: hash(process.env.DEMO_PIN || '1234'), active: true, plan: 'Pro', tables: 8,
    staff: [{ id: uid(), name: 'Arun' }, { id: uid(), name: 'Meena' }, { id: uid(), name: 'Karthik' }],
    menu: [dish('Paneer Tikka', 'Starters', 240, '🧀', 1, 'Charred cottage cheese, mint chutney', 'paneer,tikka', 1),
      dish('Chicken 65', 'Starters', 220, '🍗', 0, 'Crisp, curry-leaf spiced', 'fried,chicken', 2),
      dish('Masala Dosa', 'Mains', 120, '🥞', 1, 'Potato masala, sambar, chutneys', 'dosa', 3),
      dish('Butter Chicken', 'Mains', 320, '🍛', 0, 'Creamy tomato gravy', 'butter,chicken', 4),
      dish('Veg Biryani', 'Mains', 210, '🍚', 1, 'Dum-cooked with raita', 'vegetable,biryani', 5),
      dish('Chicken Biryani', 'Mains', 280, '🍲', 0, 'Seeraga samba, slow cooked', 'chicken,biryani', 6),
      dish('Garlic Naan', 'Breads', 50, '🫓', 1, 'Tandoor baked', 'naan', 7),
      dish('Filter Coffee', 'Drinks', 60, '☕', 1, 'Strong decoction, frothy milk', 'coffee', 8),
      dish('Fresh Lime Soda', 'Drinks', 70, '🍋', 1, 'Sweet or salted', 'lime,drink', 9),
      dish('Gulab Jamun', 'Desserts', 90, '🍮', 1, 'Two pieces, warm', 'gulab,jamun', 10)] };
  await db.put('r', r.id, r);
}
const pub = r => ({ id: r.id, slug: r.slug, name: r.name, active: r.active, plan: r.plan, tables: r.tables, staff: r.staff, menu: r.menu });
const totals = (s, tip = 0) => { const b = s.rounds.reduce((a, x) => a + x.items.reduce((c, i) => c + i.qty * i.price, 0), 0); const g = Math.round(b * GST * 100) / 100; return { b, g, t: Math.round((b + g + tip) * 100) / 100 }; };

/* ---------- live updates (Server-Sent Events) ---------- */
const subs = {};
const emit = (...cs) => cs.forEach(k => (subs[k] || []).forEach(r => r.write('data: x\n\n')));

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); next(); });
app.use('/api/admin/upload', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));
const wrap = fn => (req, res) => fn(req, res).catch(e => { if (!e.code) console.error(e); res.status(e.code || 500).json({ error: e.code ? e.message : 'Something went wrong. Please try again.' }); });
const need = role => (req, res, next) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); const o = m && unsign(m[1]); if (!o || o.role !== role) return res.status(401).json({ error: 'Please sign in again' }); req.auth = o; next(); };
const tries = {};
const limit = req => { const n = Date.now(), a = (tries[req.ip] = (tries[req.ip] || []).filter(t => n - t < 9e5)); if (a.length >= 10) throw bad('Too many attempts. Try again in 15 minutes.', 429); a.push(n); };
const mutR = (rid, fn) => lock(async () => { const r = await db.get('r', rid); if (!r) throw bad('Restaurant not found', 404); const out = await fn(r); await db.put('r', rid, r); emit(rid); return out; });
const byId = async (c, id) => { const x = await db.get(c, String(id)); if (!x) throw bad('Not found', 404); return x; };

app.get('/api/health', (req, res) => res.json({ ok: true, payments: RZ_ID && RZ_SEC ? 'razorpay' : 'demo' }));
app.get('/api/stream', (req, res) => {
  const ch = String(req.query.ch || '').slice(0, 40);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders(); res.write('retry: 3000\n\n');
  (subs[ch] = subs[ch] || new Set()).add(res);
  const hb = setInterval(() => res.write(': hb\n\n'), 25000);
  req.on('close', () => { clearInterval(hb); subs[ch].delete(res); });
});

/* ----- customer ----- */
app.get('/api/table', wrap(async (req, res) => {
  const r = (await db.all('r')).find(x => x.slug === String(req.query.slug));
  if (!r || !r.active) throw bad('This restaurant is not available right now', 404);
  const t = parseInt(req.query.table, 10);
  if (!(t >= 1 && t <= r.tables)) throw bad('This table does not exist. Scan the QR on your table again.', 404);
  let s = req.query.sid ? await db.get('s', String(req.query.sid)) : null;
  if (s && (s.rid !== r.id || s.table !== t)) s = null;
  if (!s) s = await lock(async () => {
    let x = (await db.all('s')).find(z => z.rid === r.id && z.table === t && !z.paid);
    if (!x) { x = { id: uid(), rid: r.id, table: t, rounds: [], paid: false, ts: Date.now() }; await db.put('s', x.id, x); }
    return x;
  });
  res.json({ rs: [pub(r)], ss: [s] });
}));
app.post('/api/order', wrap(async (req, res) => {
  const out = await lock(async () => {
    const s = await byId('s', req.body.sid); if (s.paid) throw bad('This bill is already paid');
    const r = await byId('r', s.rid); if (!r.active) throw bad('This restaurant is not available right now');
    const list = Array.isArray(req.body.items) ? req.body.items.slice(0, 40) : [];
    const items = list.map(i => { const d = r.menu.find(x => x.id === i.id); const qty = parseInt(i.qty, 10); if (!d || !d.on || !(qty >= 1 && qty <= 50)) throw bad('A dish in your tray is no longer available'); return { id: d.id, name: d.name, price: d.price, qty }; });
    if (!items.length) throw bad('Your tray is empty');
    s.rounds.push({ id: uid(), items, status: 'new', ts: Date.now() }); s.pending = null;
    await db.put('s', s.id, s); emit(r.id, s.id); return { ok: true };
  });
  res.json(out);
}));
app.post('/api/pay/create', wrap(async (req, res) => {
  const out = await lock(async () => {
    const s = await byId('s', req.body.sid); if (s.paid) throw bad('This bill is already paid'); if (!s.rounds.length) throw bad('Nothing to pay yet');
    const r = await byId('r', s.rid);
    const tip = Math.round(num(req.body.tip || 0, 100000)), staff = str(req.body.staff, 40);
    if (tip > 0 && !r.staff.some(x => x.id === staff)) throw bad('Choose who the tip is for');
    const paise = Math.round(totals(s, tip).t * 100);
    s.pending = { tip, staff: tip > 0 ? staff : '', paise };
    if (RZ_ID && RZ_SEC) {
      const z = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(RZ_ID + ':' + RZ_SEC).toString('base64') }, body: JSON.stringify({ amount: paise, currency: 'INR', receipt: s.id.slice(0, 40) }) });
      const o = await z.json(); if (!z.ok) throw bad('Payment provider error. Please try again.', 502);
      s.pending.orderId = o.id; await db.put('s', s.id, s);
      return { mode: 'razorpay', sid: s.id, key: RZ_ID, order: o };
    }
    await db.put('s', s.id, s); return { mode: 'demo', sid: s.id };
  });
  res.json(out);
}));
app.post('/api/pay/confirm', wrap(async (req, res) => {
  const out = await lock(async () => {
    const b = req.body, s = await byId('s', b.sid); if (s.paid) return { ok: true }; if (!s.pending) throw bad('Start the payment again');
    let method = ['UPI', 'Card', 'Net banking'].includes(b.method) ? b.method : 'UPI';
    if (RZ_ID && RZ_SEC) {
      const good = mac0(s.pending.orderId + '|' + b.razorpay_payment_id, RZ_SEC);
      if (!s.pending.orderId || b.razorpay_order_id !== s.pending.orderId || !eq(good, b.razorpay_signature)) throw bad('Payment could not be verified', 402);
      method = 'Razorpay';
    }
    s.paid = true; s.paidAt = Date.now(); s.method = method; s.tip = s.pending.tip; s.tipStaff = s.pending.staff; s.pending = null;
    s.rounds.forEach(x => x.status = 'served'); await db.put('s', s.id, s); emit(s.rid, s.id); return { ok: true };
  });
  res.json(out);
}));
const mac0 = (m, k) => crypto.createHmac('sha256', k).update(m).digest('hex');

/* ----- restaurant admin ----- */
app.post('/api/admin/login', wrap(async (req, res) => {
  limit(req);
  const r = (await db.all('r')).find(x => x.slug === str(req.body.slug, 60).toLowerCase());
  if (!r || !check(req.body.pin, r.pin)) throw bad('Wrong restaurant ID or PIN', 401);
  res.json({ token: sign({ role: 'admin', rid: r.id, exp: Date.now() + 12 * 36e5 }), rid: r.id });
}));
const A = need('admin');
app.get('/api/admin/state', A, wrap(async (req, res) => {
  const r = await byId('r', req.auth.rid);
  res.json({ rs: [pub(r)], ss: (await db.all('s')).filter(x => x.rid === r.id) });
}));
app.post('/api/admin/menu', A, wrap(async (req, res) => {
  const b = req.body, name = str(b.name); if (!name) throw bad('Enter a dish name');
  await mutR(req.auth.rid, r => { if (r.menu.length >= 300) throw bad('Menu limit reached'); r.menu.push({ id: uid(), name, cat: str(b.cat, 40) || 'Other', price: num(b.price, 100000), e: str(b.e, 8) || '🍽️', veg: !!b.veg, on: true, d: str(b.d, 140), img: url(b.img) }); });
  res.json({ ok: true });
}));
app.post('/api/admin/menu/:id', A, wrap(async (req, res) => {
  await mutR(req.auth.rid, r => { const d = r.menu.find(x => x.id === req.params.id); if (!d) throw bad('Dish not found', 404);
    if ('price' in req.body) d.price = num(req.body.price, 100000); if ('on' in req.body) d.on = !!req.body.on; if ('img' in req.body) d.img = url(req.body.img); });
  res.json({ ok: true });
}));
app.delete('/api/admin/menu/:id', A, wrap(async (req, res) => { await mutR(req.auth.rid, r => { r.menu = r.menu.filter(x => x.id !== req.params.id); }); res.json({ ok: true }); }));
app.post('/api/admin/tables', A, wrap(async (req, res) => {
  const n = parseInt(req.body.n, 10); if (!(n >= 1 && n <= 200)) throw bad('Enter 1 to 200 tables');
  await mutR(req.auth.rid, r => { r.tables = n; }); res.json({ ok: true });
}));
app.post('/api/admin/staff', A, wrap(async (req, res) => {
  const name = str(req.body.name, 40); if (!name) throw bad('Enter a name');
  await mutR(req.auth.rid, r => { if (r.staff.length >= 100) throw bad('Staff limit reached'); r.staff.push({ id: uid(), name }); }); res.json({ ok: true });
}));
app.delete('/api/admin/staff/:id', A, wrap(async (req, res) => { await mutR(req.auth.rid, r => { r.staff = r.staff.filter(x => x.id !== req.params.id); }); res.json({ ok: true }); }));
const mutS = (req, fn) => lock(async () => {
  const s = await byId('s', req.body.sid); if (s.rid !== req.auth.rid) throw bad('Not found', 404);
  fn(s); await db.put('s', s.id, s); emit(s.rid, s.id);
});
app.post('/api/admin/status', A, wrap(async (req, res) => {
  await mutS(req, s => { const x = s.rounds.find(y => y.id === req.body.xid); if (!x) throw bad('Order not found', 404); const nx = { new: 'preparing', preparing: 'ready', ready: 'served' }[x.status]; if (nx) x.status = nx; });
  res.json({ ok: true });
}));
app.post('/api/admin/cash', A, wrap(async (req, res) => {
  await mutS(req, s => { if (s.paid) return; s.paid = true; s.paidAt = Date.now(); s.method = 'Cash'; s.tip = 0; s.tipStaff = ''; s.pending = null; s.rounds.forEach(x => x.status = 'served'); });
  res.json({ ok: true });
}));

/* ----- super admin ----- */
app.post('/api/super/login', wrap(async (req, res) => {
  limit(req);
  if (!SUPER || !eq(req.body.password || '', SUPER)) throw bad('Wrong password', 401);
  res.json({ token: sign({ role: 'super', exp: Date.now() + 8 * 36e5 }) });
}));
const SA = need('super');
app.get('/api/super/state', SA, wrap(async (req, res) => res.json({ rs: (await db.all('r')).map(pub).map(r => ({ ...r, menu: [] })), ss: (await db.all('s')).filter(s => s.paid) })));
app.post('/api/super/rest', SA, wrap(async (req, res) => {
  const name = str(req.body.name), pin = str(req.body.pin, 40); if (!name || pin.length < 4) throw bad('Enter a name and a PIN of at least 4 characters');
  await lock(async () => {
    const all = await db.all('r'); let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || uid().toLowerCase();
    while (all.some(x => x.slug === slug)) slug += '-' + uid().slice(0, 2).toLowerCase();
    const r = { id: uid(), slug, name, pin: hash(pin), active: true, plan: req.body.plan === 'Pro' ? 'Pro' : 'Basic', tables: 5, staff: [], menu: [] };
    await db.put('r', r.id, r);
  });
  res.json({ ok: true });
}));
app.post('/api/super/rest/:id', SA, wrap(async (req, res) => { await mutR(req.params.id, r => { r.active = !!req.body.active; }); res.json({ ok: true }); }));
app.delete('/api/super/rest/:id', SA, wrap(async (req, res) => {
  await lock(async () => { await db.del('r', req.params.id); for (const s of await db.all('s')) if (s.rid === req.params.id) await db.del('s', s.id); });
  res.json({ ok: true });
}));
app.post('/api/super/impersonate/:id', SA, wrap(async (req, res) => { const r = await byId('r', req.params.id); res.json({ token: sign({ role: 'admin', rid: r.id, exp: Date.now() + 2 * 36e5 }) }); }));

/* ----- dish photos: stored in the database so they survive redeploys ----- */
app.post('/api/admin/upload', A, wrap(async (req, res) => {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) throw bad('Upload a JPG, PNG or WebP photo');
  if (m[2].length > 700000) throw bad('This photo is too large. Try a smaller one.');
  const id = uid(); await db.put('i', id, { rid: req.auth.rid, type: 'image/' + m[1], b64: m[2] });
  res.json({ url: '/img/' + id });
}));
app.get('/img/:id', wrap(async (req, res) => {
  const i = await db.get('i', String(req.params.id)); if (!i) throw bad('Not found', 404);
  res.set({ 'Content-Type': i.type, 'Cache-Control': 'public, max-age=31536000, immutable' }); res.send(Buffer.from(i.b64, 'base64'));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(express.static(path.join(__dirname, 'public')));
initDB().then(seed).then(() => app.listen(PORT, () => console.log('Cravings Hunt running on port ' + PORT))).catch(e => { console.error(e); process.exit(1); });
