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

// FAQ templates — auto-filled based on real email patterns
const FAQ_TEMPLATES = {
  'Login & access issues': [
    { q:'How do I reset my password?', a:'Go to the login page and click "Forgot password". An email will arrive within a few minutes — check your spam folder too. If nothing arrives, contact support@membershipanywhere.com and we will reset it manually.' },
    { q:'My account is locked — how do I get back in?', a:'Accounts lock after several failed login attempts. Wait 15 minutes and try again, or contact support@membershipanywhere.com to unlock it immediately.' },
    { q:'I am not receiving my 2FA code — what do I do?', a:'Check your phone signal and request a new code. If you have changed your phone number, contact support so we can update your 2FA settings.' }
  ],
  'Technical errors': [
    { q:'The portal is showing an error — what should I do?', a:'Try a hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac). If the issue continues, try a different browser or clear your cache. Include any error code when contacting support.' },
    { q:'A page is not loading — how do I fix this?', a:'First try refreshing the page. If it persists, clear your browser cache and cookies and try again. If still not working, contact support with the URL of the page and what browser you are using.' }
  ],
  'Member portal problems': [
    { q:'My portal is showing the wrong membership tier — why?', a:'This can happen after an upgrade if the system has not refreshed yet. Log out, wait 5 minutes, and log back in. If still incorrect contact support with your payment confirmation.' },
    { q:'I cannot save changes to my profile — what do I do?', a:'Make sure all required fields are filled in correctly. Try a different browser. If the issue persists contact support@membershipanywhere.com with a screenshot of the error.' }
  ],
  'Email & comms issues': [
    { q:'Why am I not receiving emails from you?', a:'Check your spam or junk folder first. Add support@membershipanywhere.com to your safe senders list. If you still do not receive emails, contact us and we will check your communication preferences.' },
    { q:'How do I unsubscribe from newsletters?', a:'Click the unsubscribe link at the bottom of any newsletter email. Changes take effect within 24 hours. You can also update your preferences in your member portal under Account Settings.' }
  ],
  'Event registration': [
    { q:'How do I cancel or transfer my event booking?', a:'Email support@membershipanywhere.com with your booking reference. Refunds are available up to 7 days before the event. We can also transfer your place to a colleague at any time.' },
    { q:'The event registration page is not working — what do I do?', a:'Try refreshing the page or using a different browser. If registrations are full the page may show as unavailable. Contact support to be added to the waitlist.' }
  ],
  'Membership renewal': [
    { q:'My membership says lapsed but I renewed — why?', a:'Payment processing can take up to 1 hour to update your status. Refresh your portal after 1 hour. If still showing lapsed, contact support with your payment confirmation and we will update it manually.' },
    { q:'How do I set up automatic renewal?', a:'Log into your member portal, go to Account Settings, and enable Auto-renew. Your membership will automatically renew before expiry and you will receive an email confirmation.' }
  ],
  'Feature requests': [
    { q:'How do I submit a feature request or suggestion?', a:'We love hearing from members! Email your suggestion to support@membershipanywhere.com with the subject line "Feature Request". Our team reviews all suggestions regularly.' }
  ]
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

// ── FIXED DATE FILTER — uses proper ISO format ────────────
function getFromDate(period) {
  const d = new Date();
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
  } else {
    const days = { '7':7, '30':30, '90':90, '365':365 }[period] || 30;
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
  }
  // Graph API needs this exact format: 2026-06-01T00:00:00Z
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; }
function buildCategories(emails) {
  const counts = {};
  emails.forEach(e => { counts[e.category] = (counts[e.category]||0)+1; });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,count])=>({name,count}));
}

// ── BUILD FAQ FROM REAL EMAIL PATTERNS ───────────────────
function buildFAQ(categories) {
  const faqs = [];
  // Add FAQ items for each category that has actual emails
  for (const cat of categories) {
    const templates = FAQ_TEMPLATES[cat.name];
    if (templates) {
      templates.forEach(t => faqs.push({ ...t, category: cat.name, count: cat.count }));
    }
  }
  // Sort by most common issue first
  faqs.sort((a,b) => b.count - a.count);
  // Remove duplicates and limit to 12
  return faqs.slice(0, 12);
}

// ── GET ACCESS TOKEN ──────────────────────────────────────
async function getAccessToken() {
  const url  = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default'
  });
  const res  = await fetch(url, { method:'POST', body });
  const json = await res.json();
  if (json.error) throw new Error(`Token failed: ${json.error} — ${json.error_description}`);
  return json.access_token;
}

// ── FETCH EMAILS — with proper pagination ─────────────────
async function fetchFromGraph(period) {
  const token = await getAccessToken();
  const since = getFromDate(period);

  console.log(`Fetching emails since: ${since} for period: ${period}`);

  // Use $filter with correct date format
  const filter  = `receivedDateTime ge ${since}`;
  const select  = 'subject,from,receivedDateTime,bodyPreview';
  const orderby = 'receivedDateTime desc';
  
  let url = `https://graph.microsoft.com/v1.0/users/${MAILBOX}/messages`
          + `?$filter=${encodeURIComponent(filter)}`
          + `&$select=${select}`
          + `&$orderby=${encodeURIComponent(orderby)}`
          + `&$top=100`;

  const emails  = [];
  let   skipped = 0;
  let   pages   = 0;

  // Handle pagination — fetch all pages
  while (url && pages < 10) {
    const res  = await fetch(url, { headers:{ Authorization:`Bearer ${token}` } });
    const json = await res.json();

    if (json.error) {
      console.error('Graph error:', JSON.stringify(json.error));
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }

    console.log(`Page ${pages+1}: got ${json.value?.length || 0} emails`);

    for (const m of (json.value || [])) {
      const subject = m.subject     || '(no subject)';
      const preview = m.bodyPreview || '';
      const from    = m.from?.emailAddress?.address || 'unknown';
      const date    = (m.receivedDateTime || '').split('T')[0];

      if (checkConfidential(subject, preview)) { skipped++; continue; }

      emails.push({ subject, from, date, category: categorise(subject, preview) });
    }

    // Get next page if exists
    url = json['@odata.nextLink'] || null;
    pages++;
  }

  console.log(`Total emails fetched: ${emails.length}, skipped: ${skipped}`);
  return { emails, skipped };
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
  const categories = buildCategories(emails);
  return { source:'demo', period, total:emails.length, skipped:Math.floor(take*0.15), categories, emails, faq: buildFAQ(categories) };
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

app.get('/debug', async (req, res) => {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) return res.json({ status:'no credentials' });
  try {
    const token = await getAccessToken();
    const r = await fetch(`https://graph.microsoft.com/v1.0/users/${MAILBOX}`, { headers:{ Authorization:`Bearer ${token}` } });
    const j = await r.json();
    res.json({ tokenOk:true, mailboxCheck:j });
  } catch(e) { res.json({ tokenOk:false, error:e.message }); }
});

app.get('/emails', async (req, res) => {
  const period = req.query.period || '30';
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) return res.json(getDemoData(period));
  try {
    const { emails, skipped } = await fetchFromGraph(period);
    const categories = buildCategories(emails);
    const faq        = buildFAQ(categories);
    res.json({ source:'live', period, total:emails.length, skipped, categories, emails, faq });
  } catch(err) {
    console.error('Final error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MA Support Backend running on port ${PORT}`);
  console.log(`Mailbox: ${MAILBOX}`);
  console.log(`Mode: ${(TENANT_ID && CLIENT_ID && CLIENT_SECRET) ? 'LIVE — Microsoft 365 connected' : 'DEMO'}`);
});
