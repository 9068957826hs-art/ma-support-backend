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
  'invoice','payment failed','bank transfer','contract','salary',
  'legal notice','nda','confidential','refund dispute','terminate account',
  'lawsuit','solicitor','attorney','court order','direct debit dispute'
];

const MARKETING_WORDS = [
  'unsubscribe','newsletter','no-reply','noreply','do not reply',
  'donotreply','marketing','promotion','offer','discount','sale',
  'weekly digest','monthly digest','automated message','auto-generated',
  'you are receiving this','mailing list','bulk','campaign',
  'special offer','click here to unsubscribe','manage your preferences',
  'email preferences','opt out','opt-out'
];

const MARKETING_DOMAINS = [
  'mailchimp','sendgrid','constantcontact','hubspot','marketo',
  'salesforce','klaviyo','campaignmonitor','mailgun','postmark',
  'amazonses','mandrill','sparkpost'
];

const CATEGORIES = [
  { name:'Login & access issues',  color:'#185FA5', keywords:['login','log in','password','sign in','locked out','locked','access','2fa','two factor','reset password','cant log','account locked','username','credentials'] },
  { name:'Technical errors',        color:'#5F5E5A', keywords:['error','bug','500','crash','broken','not working','failed','exception','loading','spinning','slow','timeout','blank page','glitch'] },
  { name:'Member portal problems',  color:'#639922', keywords:['portal','dashboard','profile','update profile','edit','page not loading','display','button','wrong tier','subscription tier','account page'] },
  { name:'Email & comms issues',    color:'#A32D2D', keywords:['not receiving','not getting','spam','communication','no emails','stopped receiving','missing email','havent received'] },
  { name:'Event registration',      color:'#533AB7', keywords:['event','register','registration','ticket','booking','attend','cancel booking','waitlist','conference','webinar','workshop'] },
  { name:'Membership renewal',      color:'#993556', keywords:['renew','renewal','lapsed','lapse','expired','expire','membership due','auto renew','not renewed','renewal failed'] },
  { name:'Feature requests',        color:'#0F6E56', keywords:['feature','suggestion','would like','could you add','request','improve','bulk import','export','wish','it would be great'] },
  { name:'Billing & payments',      color:'#BA7517', keywords:['payment','charge','billing','direct debit','card','refund','overcharged','double charged','receipt','transaction','fee'] },
  { name:'Account management',      color:'#4A4A8A', keywords:['cancel','cancellation','close account','delete account','transfer','change email','update details','change address'] }
];

// Sentiment keywords
const URGENT_WORDS   = ['urgent','asap','immediately','critical','broken','cannot','cant','unable','stuck','frustrated','angry','terrible','awful','unacceptable','still not'];
const POSITIVE_WORDS = ['thank','thanks','great','excellent','helpful','resolved','sorted','working','appreciate','happy','pleased','wonderful'];

function isConfidential(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  return CONFIDENTIAL_WORDS.some(w=>text.includes(w));
}

function isMarketing(subject, preview, from) {
  const text   = (subject+' '+preview).toLowerCase();
  const sender = (from||'').toLowerCase();
  if (MARKETING_WORDS.some(w=>text.includes(w))) return true;
  if (MARKETING_DOMAINS.some(d=>sender.includes(d))) return true;
  if (/^(re:|fwd:|fw:)?\s*(newsletter|update|digest|bulletin|announcement)/i.test(subject)) return true;
  return false;
}

function categorise(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  for (var i=0;i<CATEGORIES.length;i++) {
    var cat = CATEGORIES[i];
    for (var j=0;j<cat.keywords.length;j++) {
      if (text.includes(cat.keywords[j])) return cat.name;
    }
  }
  return 'General enquiry';
}

function getSentiment(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  if (URGENT_WORDS.some(w=>text.includes(w)))   return 'urgent';
  if (POSITIVE_WORDS.some(w=>text.includes(w))) return 'positive';
  return 'neutral';
}

function getFromDate(period) {
  var d = new Date();
  if (period==='today') { d.setHours(0,0,0,0); }
  else { var days={'7':7,'30':30,'90':90,'365':365}[period]||30; d.setDate(d.getDate()-days); d.setHours(0,0,0,0); }
  return d.toISOString().split('.')[0]+'Z';
}

function getPrevFromDate(period) {
  var d = new Date();
  var days = {'today':1,'7':7,'30':30,'90':90,'365':365}[period]||30;
  d.setDate(d.getDate() - days*2);
  d.setHours(0,0,0,0);
  return d.toISOString().split('.')[0]+'Z';
}

function buildCategories(emails) {
  var counts={};
  emails.forEach(function(e){ counts[e.category]=(counts[e.category]||0)+1; });
  return Object.entries(counts).sort(function(a,b){return b[1]-a[1];})
    .map(function(entry){
      var cat = CATEGORIES.find(function(c){return c.name===entry[0];});
      return { name:entry[0], count:entry[1], color:(cat?cat.color:'#888') };
    });
}

// Build heatmap — count emails per day of week and hour
function buildHeatmap(emails) {
  var days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var counts = {};
  days.forEach(function(d){ counts[d]={}; for(var h=0;h<24;h++) counts[d][h]=0; });
  emails.forEach(function(e) {
    if (!e.datetime) return;
    var dt = new Date(e.datetime);
    var day = days[dt.getDay()];
    var hr  = dt.getHours();
    counts[day][hr]=(counts[day][hr]||0)+1;
  });
  // Summarise by day
  var summary = days.map(function(d) {
    var total = Object.values(counts[d]).reduce(function(a,b){return a+b;},0);
    var peakHr = Object.entries(counts[d]).sort(function(a,b){return b[1]-a[1];})[0];
    return { day:d, total:total, peakHour:peakHr?parseInt(peakHr[0]):9, hourly:counts[d] };
  });
  return summary;
}

// Build weekly trend — emails per week
function buildWeeklyTrend(emails) {
  var weeks = {};
  emails.forEach(function(e) {
    var d = new Date(e.date);
    // Get week start (Monday)
    var day = d.getDay();
    var diff = d.getDate() - day + (day===0?-6:1);
    var monday = new Date(d.setDate(diff));
    var key = monday.toISOString().split('T')[0];
    weeks[key] = (weeks[key]||0)+1;
  });
  return Object.entries(weeks).sort(function(a,b){return a[0]>b[0]?1:-1;})
    .map(function(entry){ return { week:entry[0], count:entry[1] }; });
}

// Build category trend — current vs previous period
function buildTrend(currentEmails, previousEmails) {
  var curr={}, prev={};
  currentEmails.forEach(function(e){ curr[e.category]=(curr[e.category]||0)+1; });
  previousEmails.forEach(function(e){ prev[e.category]=(prev[e.category]||0)+1; });
  return CATEGORIES.map(function(cat) {
    var c = curr[cat.name]||0;
    var p = prev[cat.name]||0;
    var change = p===0 ? (c>0?100:0) : Math.round(((c-p)/p)*100);
    return { name:cat.name, color:cat.color, current:c, previous:p, change:change };
  }).filter(function(t){ return t.current>0||t.previous>0; })
    .sort(function(a,b){ return b.current-a.current; });
}

// Generate AI-style insights from real data
function buildInsights(emails, categories, trend, period) {
  var insights = [];
  var totalCurrent = emails.length;

  // Insight 1 — Top issue
  if (categories[0]) {
    var top = categories[0];
    var pct = Math.round((top.count/totalCurrent)*100);
    insights.push({
      type:    'warning',
      icon:    'ti-alert-triangle',
      title:   top.name+' is your biggest issue',
      detail:  top.count+' emails ('+pct+'% of all support) are about '+top.name.toLowerCase()+'. This is where the most member friction is happening.',
      action:  'Review the most recent '+Math.min(top.count,10)+' emails in this category to identify the root cause.'
    });
  }

  // Insight 2 — Biggest spike
  var biggestSpike = trend.filter(function(t){return t.change>30&&t.current>2;})
    .sort(function(a,b){return b.change-a.change;})[0];
  if (biggestSpike) {
    insights.push({
      type:   'danger',
      icon:   'ti-trending-up',
      title:  biggestSpike.name+' up '+biggestSpike.change+'% vs previous period',
      detail: 'You received '+biggestSpike.current+' tickets this period vs '+biggestSpike.previous+' last period. This spike needs attention — something may have changed or broken.',
      action: 'Check if any system changes, updates, or events happened at the start of this period.'
    });
  }

  // Insight 3 — Biggest improvement
  var biggestDrop = trend.filter(function(t){return t.change<-20&&t.previous>2;})
    .sort(function(a,b){return a.change-b.change;})[0];
  if (biggestDrop) {
    insights.push({
      type:   'success',
      icon:   'ti-trending-down',
      title:  biggestDrop.name+' down '+Math.abs(biggestDrop.change)+'% — great progress!',
      detail: 'Tickets dropped from '+biggestDrop.previous+' to '+biggestDrop.current+'. Whatever you fixed is working.',
      action: 'Document what was changed so you can apply the same approach to other categories.'
    });
  }

  // Insight 4 — Urgent emails
  var urgent = emails.filter(function(e){return e.sentiment==='urgent';});
  if (urgent.length > 0) {
    var urgentPct = Math.round((urgent.length/totalCurrent)*100);
    insights.push({
      type:   'danger',
      icon:   'ti-flame',
      title:  urgent.length+' urgent/frustrated emails ('+urgentPct+'%)',
      detail: 'These members used words like "urgent", "broken", "still not resolved", or expressed frustration. They need priority attention.',
      action: 'Filter the email log by sentiment to see these emails first and prioritise responses.'
    });
  }

  // Insight 5 — Feature requests volume
  var features = categories.find(function(c){return c.name==='Feature requests';});
  if (features && features.count >= 3) {
    insights.push({
      type:   'info',
      icon:   'ti-bulb',
      title:  features.count+' members requested new features',
      detail: 'Feature requests are a signal of engaged members who want more from the platform. Review these to identify quick wins.',
      action: 'Click "Feature requests" in the category list to see exactly what members are asking for.'
    });
  }

  // Insight 6 — Volume recommendation
  var avgPerDay = totalCurrent / ({'today':1,'7':7,'30':30,'90':90,'365':365}[period]||30);
  if (avgPerDay > 5) {
    insights.push({
      type:   'warning',
      icon:   'ti-mail-opened',
      title:  'High support volume — '+avgPerDay.toFixed(1)+' emails per day',
      detail: 'At this volume, consider building self-service resources. The top 3 categories account for most tickets — an FAQ page or help centre could reduce this significantly.',
      action: 'Export the auto-generated FAQ from the FAQ tab and publish it to your website.'
    });
  }

  // Always add a positive insight if things look healthy
  if (insights.length < 3 && totalCurrent < 20) {
    insights.push({
      type:   'success',
      icon:   'ti-circle-check',
      title:  'Support volume is healthy',
      detail: 'Low ticket volume suggests members are finding what they need. Keep monitoring for any spikes.',
      action: 'Continue reviewing weekly to catch issues early.'
    });
  }

  return insights.slice(0,5);
}

function buildFAQ(emails, categories) {
  var faqs=[], seen={};
  var byCategory={};
  emails.forEach(function(e){ if(!byCategory[e.category])byCategory[e.category]=[]; byCategory[e.category].push(e); });
  categories.forEach(function(cat) {
    var catEmails=byCategory[cat.name]||[];
    if(catEmails.length===0) return;
    var subjectCounts={};
    catEmails.forEach(function(e){
      var clean=e.subject.replace(/^(re:|fwd:|fw:)\s*/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
      subjectCounts[clean]=(subjectCounts[clean]||0)+1;
    });
    Object.entries(subjectCounts).sort(function(a,b){return b[1]-a[1];}).slice(0,2).forEach(function(entry){
      var subject=entry[0], count=entry[1];
      if(subject.length<10||seen[subject]) return;
      seen[subject]=true;
      var question=subject.charAt(0).toUpperCase()+subject.slice(1);
      if(!question.endsWith('?'))question+='?';
      faqs.push({ q:question, a:getFAQAnswer(cat.name,subject), category:cat.name, count:count });
    });
  });
  faqs.sort(function(a,b){return b.count-a.count;});
  return faqs.slice(0,12);
}

function getFAQAnswer(category, subject) {
  var s=subject.toLowerCase();
  if(category==='Login & access issues'){
    if(s.includes('password')||s.includes('reset')) return 'Go to the login page and click "Forgot password". An email arrives within a few minutes — check spam too. Contact support@membershipanywhere.com if nothing arrives.';
    if(s.includes('locked')) return 'Accounts lock after several failed attempts. Wait 15 minutes and try again, or contact support@membershipanywhere.com to unlock immediately.';
    if(s.includes('2fa')||s.includes('two factor')) return 'Check your signal and request a new code. If you changed your number contact support to update your 2FA settings.';
    return 'Contact support@membershipanywhere.com with your username and we will help you regain access quickly.';
  }
  if(category==='Technical errors') return 'Try a hard refresh (Ctrl+Shift+R). If it continues try a different browser or clear your cache. Contact support with any error code you see.';
  if(category==='Member portal problems') return 'Log out, wait 5 minutes, and log back in. If still incorrect contact support@membershipanywhere.com with a screenshot.';
  if(category==='Email & comms issues') return 'Check your spam folder and add support@membershipanywhere.com to safe senders. Contact us if still not receiving emails.';
  if(category==='Event registration') return 'Contact support@membershipanywhere.com with your booking reference. Refunds available up to 7 days before the event.';
  if(category==='Membership renewal') return 'Allow 1 hour for payment to process. If still showing lapsed contact support with your payment confirmation.';
  if(category==='Billing & payments') return 'Contact support@membershipanywhere.com with your membership number and billing details. We respond within 1 business day.';
  if(category==='Feature requests') return 'Email support@membershipanywhere.com with subject "Feature Request". We review all suggestions regularly.';
  return 'Contact support@membershipanywhere.com with full details and we will get back to you within 1 business day.';
}

function todayStr(){return new Date().toISOString().split('T')[0];}
function daysAgoStr(n){var d=new Date();d.setDate(d.getDate()-n);return d.toISOString().split('T')[0];}

async function getAccessToken(){
  var url='https://login.microsoftonline.com/'+TENANT_ID+'/oauth2/v2.0/token';
  var body=new URLSearchParams({grant_type:'client_credentials',client_id:CLIENT_ID,client_secret:CLIENT_SECRET,scope:'https://graph.microsoft.com/.default'});
  var res=await fetch(url,{method:'POST',body:body});
  var json=await res.json();
  if(json.error)throw new Error('Token failed: '+json.error);
  return json.access_token;
}

async function fetchEmailsForPeriod(token, fromDate, toDate) {
  var filter = 'receivedDateTime ge '+fromDate;
  if (toDate) filter += ' and receivedDateTime lt '+toDate;
  var url = 'https://graph.microsoft.com/v1.0/users/'+MAILBOX+'/messages'
          + '?$filter='+encodeURIComponent(filter)
          + '&$select=subject,from,receivedDateTime,bodyPreview'
          + '&$orderby='+encodeURIComponent('receivedDateTime desc')
          + '&$top=999';
  var emails=[], skipped=0, marketing=0, page=0;
  while(url){
    page++;
    var res=await fetch(url,{headers:{Authorization:'Bearer '+token}});
    var json=await res.json();
    if(json.error) throw new Error(json.error.code+': '+json.error.message);
    console.log('Page '+page+': '+( json.value||[]).length+' emails');
    (json.value||[]).forEach(function(m){
      var subject=m.subject||'(no subject)';
      var preview=m.bodyPreview||'';
      var from=(m.from&&m.from.emailAddress)?m.from.emailAddress.address:'unknown';
      var date=m.receivedDateTime?m.receivedDateTime.split('T')[0]:'';
      var datetime=m.receivedDateTime||'';
      if(isConfidential(subject,preview)){skipped++;return;}
      if(isMarketing(subject,preview,from)){marketing++;return;}
      emails.push({subject:subject,from:from,date:date,datetime:datetime,category:categorise(subject,preview),sentiment:getSentiment(subject,preview)});
    });
    url=json['@odata.nextLink']||null;
    if(page>=20){url=null;}
  }
  return {emails:emails,skipped:skipped,marketing:marketing};
}

// Demo data
var DEMO_EMAILS = [
  {subject:'Cannot log into member portal',        from:'j.smith@email.com',   category:'Login & access issues',  sentiment:'urgent'},
  {subject:'Event registration page not loading',  from:'member@company.com',  category:'Technical errors',        sentiment:'neutral'},
  {subject:'Feature request bulk CSV import',      from:'admin@assoc.com',     category:'Feature requests',        sentiment:'neutral'},
  {subject:'Membership renewal not processing',    from:'b.jones@email.com',   category:'Membership renewal',      sentiment:'urgent'},
  {subject:'2FA code not arriving',                from:'c.brown@org.uk',      category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Error 500 when editing profile',       from:'d.wilson@member.org', category:'Technical errors',        sentiment:'neutral'},
  {subject:'Account locked after failed logins',   from:'k.allen@org.com',     category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Portal shows wrong subscription tier', from:'f.martin@club.com',   category:'Member portal problems',  sentiment:'neutral'},
  {subject:'Password reset email not received',    from:'g.lee@email.com',     category:'Login & access issues',   sentiment:'neutral'},
  {subject:'Renewal reminder was not sent',        from:'r.patel@org.uk',      category:'Membership renewal',      sentiment:'neutral'},
  {subject:'Login page not loading on mobile',     from:'m.ng@email.com',      category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Email notifications stopped working',  from:'t.ford@assoc.com',    category:'Email & comms issues',    sentiment:'neutral'},
  {subject:'Cannot update billing details',        from:'s.jones@email.com',   category:'Billing & payments',      sentiment:'neutral'},
  {subject:'Request to add bulk member import',    from:'h.white@co.org',      category:'Feature requests',        sentiment:'positive'},
  {subject:'Thank you for resolving my issue',     from:'happy@member.com',    category:'General enquiry',         sentiment:'positive'}
];

function getDemoData(period){
  var take={'today':5,'7':10,'30':15,'90':12,'365':15}[period]||15;
  var maxD={'today':0,'7':7,'30':30,'90':90,'365':365}[period]||30;
  var emails=DEMO_EMAILS.slice(0,take).map(function(e,i){
    return Object.assign({},e,{date:i===0?todayStr():daysAgoStr(Math.min(i*Math.floor(maxD/take),maxD)),datetime:new Date(Date.now()-i*86400000*Math.floor(maxD/take)).toISOString()});
  });
  var prevEmails=DEMO_EMAILS.slice(0,Math.max(1,take-3)).map(function(e,i){
    return Object.assign({},e,{date:daysAgoStr(maxD+i),datetime:new Date(Date.now()-(maxD+i)*86400000).toISOString()});
  });
  var categories=buildCategories(emails);
  var trend=buildTrend(emails,prevEmails);
  var heatmap=buildHeatmap(emails);
  var weekly=buildWeeklyTrend(emails);
  var insights=buildInsights(emails,categories,trend,period);
  var faq=buildFAQ(emails,categories);
  return {source:'demo',period:period,total:emails.length,skipped:1,marketing:3,categories:categories,emails:emails,trend:trend,heatmap:heatmap,weekly:weekly,insights:insights,faq:faq};
}

app.get('/',function(req,res){res.json({status:'ok',mailbox:MAILBOX,mode:(TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'live':'demo'});});

app.get('/debug',async function(req,res){
  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET)return res.json({status:'no credentials'});
  try{var token=await getAccessToken();var r=await fetch('https://graph.microsoft.com/v1.0/users/'+MAILBOX,{headers:{Authorization:'Bearer '+token}});res.json({tokenOk:true,mailboxCheck:await r.json()});}
  catch(e){res.json({tokenOk:false,error:e.message});}
});

app.get('/emails',async function(req,res){
  var period=req.query.period||'30';
  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET)return res.json(getDemoData(period));
  try{
    var token=await getAccessToken();
    var currFrom=getFromDate(period);
    var prevFrom=getPrevFromDate(period);
    console.log('Fetching current period: '+period+' from '+currFrom);
    var curr=await fetchEmailsForPeriod(token,currFrom,null);
    console.log('Fetching previous period from '+prevFrom+' to '+currFrom);
    var prev=await fetchEmailsForPeriod(token,prevFrom,currFrom);
    console.log('Current: '+curr.emails.length+' Previous: '+prev.emails.length);
    var categories=buildCategories(curr.emails);
    var trend=buildTrend(curr.emails,prev.emails);
    var heatmap=buildHeatmap(curr.emails);
    var weekly=buildWeeklyTrend(curr.emails);
    var insights=buildInsights(curr.emails,categories,trend,period);
    var faq=buildFAQ(curr.emails,categories);
    res.json({source:'live',period:period,total:curr.emails.length,skipped:curr.skipped,marketing:curr.marketing,categories:categories,emails:curr.emails,trend:trend,heatmap:heatmap,weekly:weekly,insights:insights,faq:faq});
  }catch(err){
    console.error('Error:',err.message);
    res.status(500).json({error:err.message});
  }
});

app.listen(PORT,function(){
  console.log('MA Support Backend running on port '+PORT);
  console.log('Mailbox: '+MAILBOX);
  console.log('Mode: '+((TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'LIVE':'DEMO'));
});
