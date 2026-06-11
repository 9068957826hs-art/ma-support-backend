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

// ── SKIP THESE — confidential or marketing ───────────────
const CONFIDENTIAL_WORDS = [
  'invoice', 'payment failed', 'bank transfer', 'contract', 'salary',
  'legal notice', 'nda', 'confidential', 'refund dispute', 'terminate account',
  'lawsuit', 'solicitor', 'attorney', 'court order', 'direct debit dispute'
];

// Marketing/automated emails to ignore
const MARKETING_WORDS = [
  'unsubscribe', 'newsletter', 'no-reply', 'noreply', 'do not reply',
  'donotreply', 'marketing', 'promotion', 'offer', 'discount', 'sale',
  'weekly digest', 'monthly digest', 'automated message', 'auto-generated',
  'you are receiving this', 'mailing list', 'bulk', 'campaign',
  'special offer', 'click here to unsubscribe', 'manage your preferences',
  'email preferences', 'opt out', 'opt-out'
];

// Also skip if sent FROM these domains (bulk senders)
const MARKETING_DOMAINS = [
  'mailchimp', 'sendgrid', 'constantcontact', 'hubspot', 'marketo',
  'salesforce', 'klaviyo', 'campaignmonitor', 'mailgun', 'postmark',
  'amazonses', 'mandrill', 'sparkpost'
];

const CATEGORIES = [
  { name:'Login & access issues',  keywords:['login','log in','password','sign in','locked out','locked','access','2fa','two factor','reset password','cant log','account locked','username','credentials'] },
  { name:'Technical errors',        keywords:['error','bug','500','crash','broken','not working','failed','exception','loading','spinning','slow','timeout','blank page','glitch','issue with'] },
  { name:'Member portal problems',  keywords:['portal','dashboard','profile','update profile','edit','page not loading','display','button','wrong tier','subscription tier','account page','settings page'] },
  { name:'Email & comms issues',    keywords:['not receiving','not getting','spam','communication','no emails','stopped receiving','missing email','havent received','haven\'t received'] },
  { name:'Event registration',      keywords:['event','register','registration','ticket','booking','attend','cancel booking','waitlist','conference','webinar','workshop'] },
  { name:'Membership renewal',      keywords:['renew','renewal','lapsed','lapse','expired','expire','membership due','auto renew','not renewed','renewal failed','membership expired'] },
  { name:'Feature requests',        keywords:['feature','suggestion','would like','could you add','request','improve','bulk import','export','wish','it would be great','can you please add','is it possible to'] },
  { name:'Billing & payments',      keywords:['payment','charge','billing','direct debit','card','refund','overcharged','double charged','receipt','transaction','fee','cost','price'] },
  { name:'Account management',      keywords:['cancel','cancellation','close account','delete account','transfer','change email','update details','change address','update my account'] }
];

function isConfidential(subject, preview, from) {
  const text = (subject + ' ' + preview).toLowerCase();
  return CONFIDENTIAL_WORDS.some(function(w) { return text.includes(w); });
}

function isMarketing(subject, preview, from) {
  const text   = (subject + ' ' + preview).toLowerCase();
  const sender = (from || '').toLowerCase();

  // Check marketing words in content
  if (MARKETING_WORDS.some(function(w) { return text.includes(w); })) return true;

  // Check if sent from a marketing platform domain
  if (MARKETING_DOMAINS.some(function(d) { return sender.includes(d); })) return true;

  // Skip if subject looks like a bulk send
  if (/^(fw:|fwd:|re:)?\s*(newsletter|update|digest|bulletin|announcement)/i.test(subject)) return true;

  return false;
}

function categorise(subject, preview) {
  const text = (subject + ' ' + preview).toLowerCase();
  for (var i = 0; i < CATEGORIES.length; i++) {
    var cat = CATEGORIES[i];
    for (var j = 0; j < cat.keywords.length; j++) {
      if (text.includes(cat.keywords[j])) return cat.name;
    }
  }
  return 'General enquiry';
}

function getFromDate(period) {
  var d = new Date();
  if (period === 'today') {
    d.setHours(0, 0, 0, 0);
  } else {
    var days = { '7':7, '30':30, '90':90, '365':365 }[period] || 30;
    d.setDate(d.getDate() - days);
    d.setHours(0, 0, 0, 0);
  }
  return d.toISOString().split('.')[0] + 'Z';
}

function buildCategories(emails) {
  var counts = {};
  emails.forEach(function(e) {
    counts[e.category] = (counts[e.category] || 0) + 1;
  });
  return Object.entries(counts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .map(function(entry) { return { name: entry[0], count: entry[1] }; });
}

// ── BUILD FAQ FROM ACTUAL EMAIL SUBJECTS ─────────────────
// Groups real subjects by category and picks the most common ones
function buildFAQ(emails, categories) {
  var faqs = [];
  var seen = {};

  // Group emails by category
  var byCategory = {};
  emails.forEach(function(e) {
    if (!byCategory[e.category]) byCategory[e.category] = [];
    byCategory[e.category].push(e);
  });

  // For each category build FAQ from real subjects
  categories.forEach(function(cat) {
    var catEmails = byCategory[cat.name] || [];
    if (catEmails.length === 0) return;

    // Count subject frequency (cleaned up)
    var subjectCounts = {};
    catEmails.forEach(function(e) {
      // Clean subject — remove Re:, Fwd: etc
      var clean = e.subject
        .replace(/^(re:|fwd:|fw:)\s*/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      subjectCounts[clean] = (subjectCounts[clean] || 0) + 1;
    });

    // Sort by frequency
    var sortedSubjects = Object.entries(subjectCounts)
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 2); // top 2 per category

    sortedSubjects.forEach(function(entry) {
      var subject = entry[0];
      var count   = entry[1];

      // Skip if too short or already seen
      if (subject.length < 10 || seen[subject]) return;
      seen[subject] = true;

      // Capitalise first letter
      var question = subject.charAt(0).toUpperCase() + subject.slice(1);
      if (!question.endsWith('?')) question += '?';

      faqs.push({
        q:        question,
        a:        getFAQAnswer(cat.name, subject),
        category: cat.name,
        count:    count
      });
    });
  });

  faqs.sort(function(a, b) { return b.count - a.count; });
  return faqs.slice(0, 12);
}

// Smart answer generator based on category + subject keywords
function getFAQAnswer(category, subject) {
  var s = subject.toLowerCase();

  if (category === 'Login & access issues') {
    if (s.includes('password') || s.includes('reset')) return 'Go to the login page and click "Forgot password". An email will arrive within a few minutes — check your spam folder too. If nothing arrives contact support@membershipanywhere.com and we will reset it manually.';
    if (s.includes('locked') || s.includes('lock')) return 'Accounts lock after several failed login attempts. Wait 15 minutes and try again, or contact support@membershipanywhere.com to unlock it immediately.';
    if (s.includes('2fa') || s.includes('two factor')) return 'Check your phone signal and request a new code. If you have changed your phone number contact support so we can update your 2FA settings.';
    return 'Please contact support@membershipanywhere.com with your username and we will help you regain access as quickly as possible.';
  }
  if (category === 'Technical errors') {
    if (s.includes('load') || s.includes('loading')) return 'Try a hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac). If the issue continues try a different browser or clear your cache. Contact support with any error code you see.';
    return 'Try refreshing the page or using a different browser. If the error persists please contact support@membershipanywhere.com with a screenshot and the steps to reproduce the issue.';
  }
  if (category === 'Member portal problems') {
    if (s.includes('tier') || s.includes('subscription')) return 'This can happen after an upgrade if the system has not refreshed. Log out, wait 5 minutes, and log back in. If still incorrect contact support with your payment confirmation.';
    return 'Try logging out and back in. If the issue persists please contact support@membershipanywhere.com with a screenshot of what you are seeing.';
  }
  if (category === 'Email & comms issues') {
    return 'Check your spam or junk folder first. Add support@membershipanywhere.com to your safe senders list. If you still do not receive emails contact us and we will check your communication preferences.';
  }
  if (category === 'Event registration') {
    if (s.includes('cancel') || s.includes('refund')) return 'Email support@membershipanywhere.com with your booking reference. Refunds are available up to 7 days before the event. We can also transfer your place to a colleague.';
    return 'Contact support@membershipanywhere.com with the event name and your membership details and we will get your registration sorted.';
  }
  if (category === 'Membership renewal') {
    if (s.includes('lapsed') || s.includes('expired')) return 'Payment processing can take up to 1 hour to update your status. Refresh your portal after 1 hour. If still showing lapsed contact support with your payment confirmation and we will update it manually.';
    return 'Log into your member portal and go to Account Settings to manage your renewal. Contact support@membershipanywhere.com if you need any assistance.';
  }
  if (category === 'Billing & payments') {
    return 'For any billing questions please contact support@membershipanywhere.com with your membership number and details of the query. We aim to respond within 1 business day.';
  }
  if (category === 'Account management') {
    return 'You can manage most account settings by logging into your member portal and going to Account Settings. For anything you cannot change yourself contact support@membershipanywhere.com.';
  }
  if (category === 'Feature requests') {
    return 'Thank you for the suggestion! We love hearing from members. Please email support@membershipanywhere.com with the subject line "Feature Request" and describe what you would like to see added.';
  }
  return 'Please contact support@membershipanywhere.com with full details and we will get back to you within 1 business day.';
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) {
  var d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

async function getAccessToken() {
  var url  = 'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token';
  var body = new URLSearchParams({
    grant_type: 'client_credentials', client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default'
  });
  var res  = await fetch(url, { method:'POST', body:body });
  var json = await res.json();
  if (json.error) throw new Error('Token failed: ' + json.error);
  console.log('Token acquired successfully');
  return json.access_token;
}

async function fetchFromGraph(period) {
  var token = await getAccessToken();
  var since = getFromDate(period);
  console.log('Fetching period: ' + period + ' since: ' + since);

  var filter  = 'receivedDateTime ge ' + since;
  var baseUrl = 'https://graph.microsoft.com/v1.0/users/' + MAILBOX + '/messages'
              + '?$filter=' + encodeURIComponent(filter)
              + '&$select=subject,from,receivedDateTime,bodyPreview'
              + '&$orderby=' + encodeURIComponent('receivedDateTime desc')
              + '&$top=999';

  var emails       = [];
  var skipped      = 0;
  var marketing    = 0;
  var url          = baseUrl;
  var page         = 0;

  while (url) {
    page++;
    var res  = await fetch(url, { headers:{ Authorization:'Bearer ' + token } });
    var json = await res.json();

    if (json.error) {
      console.error('Graph error:', JSON.stringify(json.error));
      throw new Error(json.error.code + ': ' + json.error.message);
    }

    var items = json.value || [];
    console.log('Page ' + page + ': ' + items.length + ' emails');

    items.forEach(function(m) {
      var subject = m.subject     || '(no subject)';
      var preview = m.bodyPreview || '';
      var from    = (m.from && m.from.emailAddress) ? m.from.emailAddress.address : 'unknown';
      var date    = m.receivedDateTime ? m.receivedDateTime.split('T')[0] : '';

      if (isConfidential(subject, preview, from)) { skipped++; return; }
      if (isMarketing(subject, preview, from))    { marketing++; return; }

      emails.push({ subject:subject, from:from, date:date, category:categorise(subject, preview) });
    });

    url = json['@odata.nextLink'] || null;
    if (page >= 20) { url = null; }
  }

  console.log('TOTAL: ' + emails.length + ' support, ' + skipped + ' confidential, ' + marketing + ' marketing filtered');
  return { emails:emails, skipped:skipped, marketing:marketing };
}

// Demo data
var DEMO_POOL = [
  { subject:'Cannot log into my member portal',      from:'j.smith@email.com',   category:'Login & access issues' },
  { subject:'Event registration page not loading',   from:'member@company.com',  category:'Technical errors' },
  { subject:'Feature request bulk CSV import',       from:'admin@assoc.com',     category:'Feature requests' },
  { subject:'Membership renewal not processing',     from:'b.jones@email.com',   category:'Membership renewal' },
  { subject:'2FA code not arriving by SMS',          from:'c.brown@org.uk',      category:'Login & access issues' },
  { subject:'Error 500 when editing profile',        from:'d.wilson@member.org', category:'Technical errors' },
  { subject:'Event calendar not showing new events', from:'i.clark@member.net',  category:'Event registration' },
  { subject:'Account locked after failed logins',    from:'k.allen@org.com',     category:'Login & access issues' },
  { subject:'Portal shows wrong subscription tier',  from:'f.martin@club.com',   category:'Member portal problems' },
  { subject:'Password reset email not received',     from:'g.lee@email.com',     category:'Login & access issues' }
];

function getDemoData(period) {
  var take = { today:5,'7':10,'30':10,'90':10,'365':10 }[period]||10;
  var maxD = { today:0,'7':7,'30':30,'90':90,'365':365 }[period]||30;
  var emails = DEMO_POOL.slice(0,take).map(function(e,i) {
    return Object.assign({},e,{ date: i===0 ? todayStr() : daysAgoStr(Math.min(i*Math.floor(maxD/take),maxD)) });
  });
  var categories = buildCategories(emails);
  return { source:'demo', period:period, total:emails.length, skipped:1, marketing:3, categories:categories, emails:emails, faq:buildFAQ(emails,categories) };
}

// Routes
app.get('/', function(req,res) {
  res.json({ status:'ok', mailbox:MAILBOX, mode:(TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'live':'demo' });
});

app.get('/debug', async function(req,res) {
  if (!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET) return res.json({ status:'no credentials' });
  try {
    var token = await getAccessToken();
    var r = await fetch('https://graph.microsoft.com/v1.0/users/'+MAILBOX, { headers:{ Authorization:'Bearer '+token } });
    res.json({ tokenOk:true, mailboxCheck: await r.json() });
  } catch(e) { res.json({ tokenOk:false, error:e.message }); }
});

app.get('/emails', async function(req,res) {
  var period = req.query.period || '30';
  if (!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET) return res.json(getDemoData(period));
  try {
    var result     = await fetchFromGraph(period);
    var categories = buildCategories(result.emails);
    var faq        = buildFAQ(result.emails, categories);
    res.json({ source:'live', period:period, total:result.emails.length, skipped:result.skipped, marketing:result.marketing, categories:categories, emails:result.emails, faq:faq });
  } catch(err) {
    console.error('Error:', err.message);
    res.status(500).json({ error:err.message });
  }
});

app.listen(PORT, function() {
  console.log('MA Support Backend running on port ' + PORT);
  console.log('Mailbox: ' + MAILBOX);
  console.log('Mode: ' + ((TENANT_ID&&CLIENT_ID&&CLIENT_SECRET) ? 'LIVE' : 'DEMO'));
});
