require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const TENANT_ID     = process.env.TENANT_ID;
const CLIENT_ID     = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const MAILBOX       = process.env.MAILBOX || 'support@membershipanywhere.com';

const CONFIDENTIAL_WORDS = [
  'invoice', 'payment failed', 'bank transfer', 'contract', 'salary',
  'legal notice', 'nda', 'confidential', 'refund dispute', 'terminate account',
  'lawsuit', 'solicitor', 'attorney', 'court order', 'direct debit dispute'
];

const CATEGORIES = [
  { name:'Login & access issues',   keywords:['login','log in','password','sign in','locked out','locked','access','2fa','two factor','reset password','cant log','account locked'] },
  { name:'Technical errors',         keywords:['error','bug','500','crash','broken','not working','failed','exception','loading','spinning','slow','timeout','blank page'] },
  { name:'Member portal problems',   keywords:['portal','dashboard','profile','update profile','edit','page not loading','display','button','wrong tier','subscription tier'] },
  { name:'Email & comms issues',     keywords:['email','newsletter','notification','not receiving','not getting','unsubscribe','spam','communication','no emails','stopped receiving'] },
  { name:'Event registration',       keywords:['event','register','registration','ticket','booking','attend','cancel booking','waitlist','conference','webinar'] },
  { name:'Membership renewal',       keywords:['renew','renewal','lapsed','lapse','expired','expire','membership due','auto renew','not renewed','renewal failed'] },
  { name:'Feature requests',         keywords:['feature','suggestion','would like','could you add','request','improve','bulk import','export','wish','it would be great'] }
];

function checkConfidential(subject, preview) {
  const text = (subject + ' ' + preview).toLowerCase();
  return CONFIDENTIAL_WORDS.some(w => text.includes(w));
}

function categorise(subject, preview) {
  const text = (subject + ' ' + preview).toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.some(k => text.includes(k))) return cat.name;
  }
  return 'General enquiry';
}

function getFromDate(period) {
  const d = new Date();
  if (period === 'today') { d.setHours(0,0,0,0); }
  else { d.setDate(d.getDate() - ({ '7':7,'30':30,'90':90,'365':365 }[period]||30)); }
  return d.toISOString();
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; }

// ── GET ACCESS TOKEN ──────────────────────────────────────
async function getAccessToken() {
  console.log('Getting access token for tenant:', TENANT_ID);
  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default'
  });
  const res  = await fetch(url, { method:'POST', body });
  const json = await res.json();
  if (json.error) {
    console.error('Token error:', json.error, json.error_description);
    throw new Error(`Token failed: ${json.error} — ${json.error_description}`);
  }
  console.log('Token acquired successfully');
  return json.access_token;
}

// ── FETCH EMAILS FROM GRAPH ───────────────────────────────
async function fetchFromGraph(period) {
  const token  = await getAccessToken();
  const since  = getFromDate(period);
  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
  const url    = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages?$filter=${filter}&$select=subject,from,receivedDateTime,bodyPreview&$orderby=receivedDateTime desc&$top=200`;

  console.log(`Fetching emails for mailbox: ${MAILBOX}, period: ${period}`);

  const res  = await fetch(url, { headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' } });
  const json = await res.json();

  // Log full error detail so we can see exactly what Microsoft says
  if (json.error) {
    console.error('Graph API full error:', JSON.stringify(json.error));
    throw new Error(`${json.error.code}: ${json.error.message}`);
  }

  console.log(`Fetched ${json.value?.length || 0} emails`);

  const emails  = [];
  let   skipped = 0;

  for (const m of (json.value||[])) {
    const subject = m.subject     || '(no subject)';
    const preview = m.bodyPreview || '';
    const from    = m.from?.emailAddress?.address || 'unknown';
    const date    = (m.receivedDateTime||'').split('T')[0];
    if (checkConfidential(subject, preview)) { skipped++; continue; }
    emails.push({ subject, from, date, category: categorise(subject, preview) });
  }

  return { emails, skipped };
}

function buildCategories(emails) {
  const counts = {};
  emails.forEach(e => { counts[e.category] = (counts[e.category]||0)+1; });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
}

// ── DEMO DATA ─────────────────────────────────────────────
const DEMO_POOL = [
  { subject:'Cannot log into my member portal',      from:'j.smith@email.com',   category:'Login & access issues' },
  { subject:'Event registration page not loading',   from:'member@company.com',  category:'Technical errors' },
  { subject:'Not receiving newsletter emails',       from:'alice@org.net',       category:'Email & comms issues' },
  { subject:'Feature request — bulk CSV import',     from:'admin@assoc.com',     category:'Feature requests' },
  { subject:'Membership renewal not processing',     from:'b.jones@email.com',   category:'Membership renewal' },
  { subject:'2FA code not arriving by SMS',          from:'c.brown@org.uk',      category:'Login & access issues' },
  { subject:'Error 500 when editing profile',        from:'d.wilson@member.org', category:'Technical errors' },
  { subject:'Event calendar not showing new events', from:'i.clark@member.net',  category:'Event registration' },
  { subject:'Account locked after failed logins',    from:'k.allen@org.com',     category:'Login & access issues' },
  { subject:'Portal shows wrong subscription tier',  from:'f.martin@club.com',   category:'Member portal problems' },
  { subject:'Password reset email not received',     from:'g.lee@email.com',     category:'Login & access issues' },
  { subject:'How to add multiple staff members?',    from:'h.white@co.org',      category:'Feature requests' },
  { subject:'Renewal reminder was not sent',         from:'r.patel@org.uk',      category:'Membership renewal' },
  { subject:'Login page not loading on mobile',      from:'m.ng@email.com',      category:'Login & access issues' },
  { subject:'Email notifications stopped working',   from:'t.ford@assoc.com',    category:'Email & comms issues' }
];

function getDemoData(period) {
  const take = { today:5,'7':10,'30':15,'90':12,'365':15 }[period]||15;
  const maxD = { today:0,'7':7,'30':30,'90':90,'365':365 }[period]||30;
  const emails = DEMO_POOL.slice(0,take).map((e,i)=>({
    ...e, date: i===0 ? todayStr() : daysAgoStr(Math.min(i*Math.floor(maxD/take),maxD))
  }));
  return { source:'demo', period, total:emails.length, skipped:Math.floor(take*0.15), categories:buildCategories(emails), emails };
}

// ── ROUTES ────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:  'ok',
    service: 'MA Support Analyzer Backend',
    mailbox: MAILBOX,
    mode:    (TENANT_ID && CLIENT_ID && CLIENT_SECRET) ? 'live' : 'demo'
  });
});

// ── DEBUG ROUTE — shows exact Microsoft error ─────────────
app.get('/debug', async (req, res) => {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    return res.json({ status: 'no credentials set' });
  }
  try {
    const token = await getAccessToken();
    // Try to get mailbox info
    const url = `https://graph.microsoft.com/v1.0/users/${MAILBOX}`;
    const r   = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    const j   = await r.json();
    res.json({ tokenOk: true, mailboxCheck: j });
  } catch(e) {
    res.json({ tokenOk: false, error: e.message });
  }
});

app.get('/emails', async (req, res) => {
  const period = req.query.period || '30';
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    return res.json(getDemoData(period));
  }
  try {
    const { emails, skipped } = await fetchFromGraph(period);
    res.json({ source:'live', period, total:emails.length, skipped, categories:buildCategories(emails), emails });
  } catch(err) {
    console.error('Final error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MA Support Backend running on port ${PORT}`);
  console.log(`Mailbox: ${MAILBOX}`);
  console.log(`Mode: ${(TENANT_ID && CLIENT_ID && CLIENT_SECRET) ? 'LIVE' : 'DEMO'}`);
});
