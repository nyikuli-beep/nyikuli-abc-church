const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const DATA_FILE = path.join(__dirname, 'data.json');
function readData(){ try { return JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e){ return { households:[], pledges:[], contributions:[], ceremonies:[], loose:[] }; } }
function writeData(d){ fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }

const app = express();
app.use(cors());
app.use(express.json());

// optional nodemailer setup for SMTP delivery
let transporter = null;
try {
  const nodemailer = require('nodemailer');
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (host && port && user && pass) {
    transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
    transporter.verify().then(()=>console.log('SMTP transporter ready')).catch(()=>{ transporter=null; });
  }
} catch(e){ transporter = null; }

// optional Twilio setup for SMS delivery
let twilioClient = null;
let SMS_FROM = process.env.SMS_FROM;
try{
  const sid = process.env.SMS_ACCOUNT_SID;
  const token = process.env.SMS_AUTH_TOKEN;
  if (sid && token) {
    const twilio = require('twilio');
    twilioClient = twilio(sid, token);
    SMS_FROM = SMS_FROM || process.env.SMS_FROM || null;
    console.log('Twilio client configured');
  }
} catch(e){ twilioClient = null; }

// Basic auth middleware: expects Authorization: Basic base64(user:pass)
const AUTH_USER = process.env.ABC_USER || 'admin';
const AUTH_PASS = process.env.ABC_PASS || 'secret';
function requireAuth(req,res,next){
  const h = req.headers.authorization;
  if (!h) return res.status(401).json({ error: 'Missing Authorization' });
  const parts = h.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Basic') return res.status(401).json({ error: 'Bad Authorization' });
  const creds = Buffer.from(parts[1], 'base64').toString('utf8');
  const [u,p] = creds.split(':');
  if (u === AUTH_USER && p === AUTH_PASS) { return next(); }
  return res.status(403).json({ error: 'Forbidden' });
}

app.get('/api/health', (req,res)=> res.json({ ok: true }));

// Households
app.get('/api/households', requireAuth, (req,res)=>{
  const d = readData(); res.json(d.households);
});
app.post('/api/households', requireAuth, (req,res)=>{
  const d = readData(); const { head, envelope } = req.body; const id = d.households.length ? Math.max(...d.households.map(h=>h.id))+1 : 1; const h = { id, head, envelope }; d.households.push(h); writeData(d); res.json(h);
});

// Contributions
app.post('/api/contributions', requireAuth, (req,res)=>{
  const d = readData(); const { householdId, envelope, regular=0, capital=0, date } = req.body;
  const rec = { id: Date.now(), householdId, envelope, regular: Number(regular), capital: Number(capital), date: date || new Date().toISOString() };
  d.contributions.push(rec);
  // update pledge if present
  const p = d.pledges.find(x=>x.householdId === householdId);
  if (p && capital > 0){ p.remaining = Math.max(0, (p.remaining || p.original) - Number(capital)); }
  writeData(d);
  res.json(rec);
});

// Loose
app.post('/api/loose', requireAuth, (req,res)=>{
  const d = readData(); const { amount, date } = req.body; const rec = { id: Date.now(), amount: Number(amount), date: date || new Date().toISOString() }; d.loose.push(rec); writeData(d); res.json(rec);
});

// Ceremonies
app.post('/api/ceremonies/baptism', requireAuth, (req,res)=>{
  const d = readData(); const body = req.body; body.type = 'baptism'; body.id = Date.now(); d.ceremonies.push(body); writeData(d); res.json(body);
});
app.post('/api/ceremonies/wedding', requireAuth, (req,res)=>{
  const d = readData(); const body = req.body; body.type = 'wedding'; body.id = Date.now(); d.ceremonies.push(body); writeData(d); res.json(body);
});
app.post('/api/ceremonies/funeral', requireAuth, (req,res)=>{
  const d = readData(); const body = req.body; body.type = 'funeral'; body.id = Date.now(); d.ceremonies.push(body); writeData(d); res.json(body);
});

// Auth: send verification code (no auth required)
app.post('/api/auth/send-code', (req,res)=>{
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email required' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const d = readData();
  d.verifications = d.verifications || [];
  // remove old for same email
  d.verifications = d.verifications.filter(v=>v.email !== String(email).toLowerCase());
  const rec = { email: String(email).toLowerCase(), code, expires: Date.now() + (5*60*1000) };
  d.verifications.push(rec);
  writeData(d);

  // attempt to send via SMTP if configured
  if (transporter) {
    const from = process.env.SMTP_FROM || (process.env.SMTP_USER || 'no-reply@example.com');
    const mail = { from, to: email, subject: 'Your verification code', text: `Your ABC Church verification code is: ${code}` };
    transporter.sendMail(mail).then(info=>{
      return res.json({ ok:true, simulated:false, info });
    }).catch(err=>{
      // still return success but indicate simulated and include no code
      return res.json({ ok:true, simulated:true });
    });
  } else {
    // development: return simulated response including code so local UI can display it
    return res.json({ ok:true, simulated:true, code });
  }
});

// Auth: send phone OTP
app.post('/api/auth/send-otp', (req,res)=>{
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'phone required' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const d = readData();
  d.phoneVerifications = d.phoneVerifications || [];
  d.phoneVerifications = d.phoneVerifications.filter(v=>v.phone !== String(phone));
  const rec = { phone: String(phone), code, expires: Date.now() + (5*60*1000) };
  d.phoneVerifications.push(rec);
  writeData(d);

  if (twilioClient && SMS_FROM) {
    // attempt to send via Twilio
    twilioClient.messages.create({ body: `Your ABC Church OTP: ${code}`, from: SMS_FROM, to: phone })
      .then(m=> res.json({ ok:true, simulated:false, sid: m.sid }))
      .catch(err=> res.json({ ok:true, simulated:true }));
  } else {
    // development fallback: include code in response
    return res.json({ ok:true, simulated:true, code });
  }
});

// Auth: sign in
app.post('/api/auth/signin', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  if (email === AUTH_USER && password === AUTH_PASS) {
    return res.status(200).json({ message: 'Sign in successful' });
  }

  return res.status(401).json({ message: 'Invalid credentials.' });
});

// Auth: verify phone OTP
app.post('/api/auth/verify-otp', (req,res)=>{
  const { phone, code } = req.body || {};
  if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });
  const d = readData(); d.phoneVerifications = d.phoneVerifications || [];
  const rec = d.phoneVerifications.find(v=>v.phone === String(phone));
  if (!rec) return res.status(400).json({ ok:false, reason: 'no_code' });
  if (Date.now() > rec.expires) return res.status(400).json({ ok:false, reason: 'expired' });
  if (String(code).trim() !== String(rec.code)) return res.status(400).json({ ok:false, reason: 'mismatch' });
  d.phoneVerifications = d.phoneVerifications.filter(v=>v.phone !== String(phone));
  writeData(d);
  return res.json({ ok:true });
});

// Auth: verify code
app.post('/api/auth/verify-code', (req,res)=>{
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ error: 'email and code required' });
  const d = readData(); d.verifications = d.verifications || [];
  const rec = d.verifications.find(v=>v.email === String(email).toLowerCase());
  if (!rec) return res.status(400).json({ ok:false, reason: 'no_code' });
  if (Date.now() > rec.expires) return res.status(400).json({ ok:false, reason: 'expired' });
  if (String(code).trim() !== String(rec.code)) return res.status(400).json({ ok:false, reason: 'mismatch' });
  // success: remove verification and respond ok
  d.verifications = d.verifications.filter(v=>v.email !== String(email).toLowerCase());
  writeData(d);
  return res.json({ ok:true });
});

// Reports: tax by year
app.get('/api/reports/tax/:year', requireAuth, (req,res)=>{
  const year = Number(req.params.year);
  const d = readData();
  const sums = {};
  d.contributions.forEach(c=>{
    const dt = new Date(c.date);
    if (dt.getFullYear() !== year) return;
    if (!c.householdId) return;
    sums[c.householdId] = (sums[c.householdId]||0) + (Number(c.regular||0) + Number(c.capital||0));
  });
  const rows = d.households.map(h=>({ envelope: h.envelope||'', head: h.head||'', total: (sums[h.id]||0) }));
  res.json({ year, rows });
});

// Monthly report summary
app.get('/api/reports/monthly', requireAuth, (req,res)=>{
  const { month } = req.query; // expect YYYY-MM
  if (!month) return res.status(400).json({ error: 'month required (YYYY-MM)' });
  const [y,m] = month.split('-').map(Number);
  const d = readData();
  const contributions = d.contributions.filter(c=>{ const dt=new Date(c.date); return dt.getFullYear()===y && (dt.getMonth()+1)===m; });
  const ceremonies = d.ceremonies.filter(c=>{ const dt=new Date(c.date); return dt.getFullYear()===y && (dt.getMonth()+1)===m; });
  res.json({ month, contributions, ceremonies });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('ABC-IS API listening on', PORT));
