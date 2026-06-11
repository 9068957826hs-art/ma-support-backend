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
const SLA_HOURS     = parseInt(process.env.SLA_HOURS || '24');

// ── FILTERS ───────────────────────────────────────────────
const CONFIDENTIAL_WORDS = [
  'invoice','payment failed','bank transfer','contract','salary',
  'legal notice','nda','confidential','refund dispute','terminate account',
  'lawsuit','solicitor','attorney','court order','direct debit dispute'
];

const MARKETING_WORDS = [
  'unsubscribe','newsletter','no-reply','noreply','do not reply',
  'donotreply','marketing','promotion','offer','discount',
  'weekly digest','monthly digest','automated message','auto-generated',
  'you are receiving this','mailing list','campaign',
  'click here to unsubscribe','manage your preferences',
  'email preferences','opt out','opt-out','view in browser',
  'view this email','update your preferences','automated notification',
  'do not reply to this','please do not reply','this is an automated',
  'to unsubscribe from'
];

const MARKETING_DOMAINS = [
  'mailchimp','sendgrid','constantcontact','hubspot','marketo',
  'klaviyo','campaignmonitor','mailgun','postmark',
  'amazonses','mandrill','sparkpost','mailerlite','activecampaign',
  'squareup.com','square.com','squ.re',
  'stripe.com','paypal.com','gocardless','worldpay','sagepay',
  'donorperfect','bloomerang','blackbaud','etapestry',
  'eventbrite','ticketmaster'
];

const IGNORE_SENDERS = [
  'receipts@square.com','notifications@squareup.com','no-reply@squareup.com',
  'hello@squareup.com','noreply@squareup.com','receipt@squareup.com',
  'no-reply@donorperfect.com','notifications@donorperfect.com',
  'receipts@stripe.com','service@paypal.com','noreply@paypal.com'
];

// ── CATEGORIES ────────────────────────────────────────────
const CATEGORIES = [
  { name:'Login & access issues',   color:'#185FA5', keywords:['login','log in','password','sign in','locked out','locked','access','2fa','two factor','reset password','cant log','account locked','username','credentials'] },
  { name:'Technical errors',         color:'#5F5E5A', keywords:['error','bug','500','crash','broken','not working','failed','exception','loading','spinning','slow','timeout','blank page','glitch'] },
  { name:'Member portal problems',   color:'#639922', keywords:['portal','dashboard','profile','update profile','edit','page not loading','display','button','wrong tier','subscription tier','account page'] },
  { name:'Email & comms issues',     color:'#A32D2D', keywords:['not receiving','not getting','spam','communication','no emails','stopped receiving','missing email','havent received'] },
  { name:'Event registration',       color:'#533AB7', keywords:['event','register','registration','ticket','booking','attend','cancel booking','waitlist','conference','webinar','workshop'] },
  { name:'Membership renewal',       color:'#993556', keywords:['renew','renewal','lapsed','lapse','expired','expire','membership due','auto renew','not renewed','renewal failed'] },
  { name:'Feature requests',         color:'#0F6E56', keywords:['feature','suggestion','would like','could you add','request','improve','bulk import','export','wish','it would be great'] },
  { name:'Billing & payments',       color:'#BA7517', keywords:['payment','charge','billing','direct debit','card','refund','overcharged','double charged','receipt','transaction','fee'] },
  { name:'Account management',       color:'#4A4A8A', keywords:['cancel','cancellation','close account','delete account','transfer','change email','update details','change address'] },
  { name:'Help & how-to questions',  color:'#6B7280', keywords:['how do i','how to','where can i','can you help','need help','need assistance','not sure','confused','wondering','is it possible','could you tell me'] }
];

const URGENT_WORDS   = ['urgent','asap','immediately','critical','broken','cannot','cant','unable','stuck','frustrated','angry','terrible','awful','unacceptable','still not','still waiting','no response'];
const POSITIVE_WORDS = ['thank','thanks','great','excellent','helpful','resolved','sorted','working','appreciate','happy','pleased','wonderful'];

// ── HELPERS ───────────────────────────────────────────────
function isConfidential(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  return CONFIDENTIAL_WORDS.some(function(w){return text.includes(w);});
}

function isMarketing(subject, preview, from) {
  const text   = (subject+' '+preview).toLowerCase();
  const sender = (from||'').toLowerCase();
  if (IGNORE_SENDERS.some(function(s){return sender===s;})) return true;
  if (MARKETING_DOMAINS.some(function(d){return sender.includes(d);})) return true;
  if (MARKETING_WORDS.some(function(w){return text.includes(w);})) return true;
  if (/^(re:|fwd:|fw:)?\s*(newsletter|update|digest|bulletin|announcement|receipt|order confirmation)/i.test(subject)) return true;
  return false;
}

function categorise(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  for (var i=0;i<CATEGORIES.length;i++) {
    for (var j=0;j<CATEGORIES[i].keywords.length;j++) {
      if (text.includes(CATEGORIES[i].keywords[j])) return CATEGORIES[i].name;
    }
  }
  return 'General enquiry';
}

function getSentiment(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  if (URGENT_WORDS.some(function(w){return text.includes(w);}))   return 'urgent';
  if (POSITIVE_WORDS.some(function(w){return text.includes(w);})) return 'positive';
  return 'neutral';
}

function getFromDate(period) {
  var d = new Date();
  if (period==='today') { d.setHours(0,0,0,0); }
  else { var days={'7':7,'30':30,'90':90,'365':365}[period]||30; d.setDate(d.getDate()-days); d.setHours(0,0,0,0); }
  return d.toISOString().split('.')[0]+'Z';
}

function getCustomDate(dateStr) {
  var d = new Date(dateStr);
  d.setHours(0,0,0,0);
  return d.toISOString().split('.')[0]+'Z';
}

function getPrevFromDate(period) {
  var d = new Date();
  var days={'today':1,'7':7,'30':30,'90':90,'365':365}[period]||30;
  d.setDate(d.getDate()-days*2); d.setHours(0,0,0,0);
  return d.toISOString().split('.')[0]+'Z';
}

function hoursBetween(a, b) {
  return Math.round(Math.abs(new Date(b)-new Date(a))/3600000);
}

function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgoStr(n) { var d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().split('T')[0]; }

function buildCategories(emails) {
  var counts={};
  emails.forEach(function(e){ counts[e.category]=(counts[e.category]||0)+1; });
  return Object.entries(counts).sort(function(a,b){return b[1]-a[1];}).map(function(entry){
    var cat=CATEGORIES.find(function(c){return c.name===entry[0];});
    return { name:entry[0], count:entry[1], color:(cat?cat.color:'#888780') };
  });
}

function buildHeatmap(emails) {
  var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var counts={};
  days.forEach(function(d){ counts[d]={}; for(var h=0;h<24;h++) counts[d][h]=0; });
  emails.forEach(function(e) {
    if(!e.datetime) return;
    var dt=new Date(e.datetime);
    var day=days[dt.getDay()]; var hr=dt.getHours();
    counts[day][hr]=(counts[day][hr]||0)+1;
  });
  return days.map(function(d) {
    var total=Object.values(counts[d]).reduce(function(a,b){return a+b;},0);
    var peakHr=Object.entries(counts[d]).sort(function(a,b){return b[1]-a[1];})[0];
    return { day:d, total:total, peakHour:peakHr?parseInt(peakHr[0]):9 };
  });
}

function buildWeeklyTrend(emails) {
  var weeks={};
  emails.forEach(function(e) {
    var d=new Date(e.date); var day=d.getDay();
    var diff=d.getDate()-day+(day===0?-6:1);
    var monday=new Date(d.setDate(diff));
    var key=monday.toISOString().split('T')[0];
    weeks[key]=(weeks[key]||0)+1;
  });
  return Object.entries(weeks).sort(function(a,b){return a[0]>b[0]?1:-1;}).map(function(e){return{week:e[0],count:e[1]};});
}

function buildTrend(curr, prev) {
  var c={}, p={};
  curr.forEach(function(e){c[e.category]=(c[e.category]||0)+1;});
  prev.forEach(function(e){p[e.category]=(p[e.category]||0)+1;});
  return CATEGORIES.map(function(cat){
    var cv=c[cat.name]||0, pv=p[cat.name]||0;
    var change=pv===0?(cv>0?100:0):Math.round(((cv-pv)/pv)*100);
    return {name:cat.name,color:cat.color,current:cv,previous:pv,change:change};
  }).filter(function(t){return t.current>0||t.previous>0;}).sort(function(a,b){return b.current-a.current;});
}

// ── MEMBER STRUGGLE TRACKER ───────────────────────────────
function buildMemberProfiles(emails) {
  var profiles={};
  emails.forEach(function(e) {
    var sender=e.from.toLowerCase();
    if(!profiles[sender]) {
      profiles[sender]={
        email:    sender,
        name:     e.fromName||sender.split('@')[0],
        count:    0,
        urgent:   0,
        categories:{},
        latest:   '',
        oldest:   '',
        unreplied:0,
        avgReplyHours: null,
        replyTimes: []
      };
    }
    var p=profiles[sender];
    p.count++;
    if(e.sentiment==='urgent') p.urgent++;
    p.categories[e.category]=(p.categories[e.category]||0)+1;
    if(!p.latest||e.date>p.latest) p.latest=e.date;
    if(!p.oldest||e.date<p.oldest) p.oldest=e.date;
    if(e.replyStatus==='unreplied'||e.replyStatus==='overdue') p.unreplied++;
    if(e.replyHours!=null) p.replyTimes.push(e.replyHours);
  });

  // Calculate risk score and avg reply time
  return Object.values(profiles).map(function(p) {
    if(p.replyTimes.length>0) {
      p.avgReplyHours=Math.round(p.replyTimes.reduce(function(a,b){return a+b;},0)/p.replyTimes.length);
    }
    // Risk: high volume + urgent + unreplied = high risk
    p.riskScore = Math.min(100, (p.count*5) + (p.urgent*20) + (p.unreplied*15));
    p.riskLevel = p.riskScore>=60?'high':p.riskScore>=30?'medium':'low';
    p.topIssue  = Object.entries(p.categories).sort(function(a,b){return b[1]-a[1];})[0]?.[0]||'General';
    delete p.replyTimes;
    return p;
  }).sort(function(a,b){return b.riskScore-a.riskScore;}).slice(0,30);
}

// ── RESPONSE TIME ANALYSIS ────────────────────────────────
function buildResponseStats(emails) {
  var replied   = emails.filter(function(e){return e.replyStatus==='replied';});
  var overdue   = emails.filter(function(e){return e.replyStatus==='overdue';});
  var waiting   = emails.filter(function(e){return e.replyStatus==='waiting';});
  var replyTimes= replied.map(function(e){return e.replyHours;}).filter(function(h){return h!=null;});

  var avgReply  = replyTimes.length ? Math.round(replyTimes.reduce(function(a,b){return a+b;},0)/replyTimes.length) : null;
  var under4h   = replyTimes.filter(function(h){return h<=4;}).length;
  var under24h  = replyTimes.filter(function(h){return h<=24;}).length;
  var over24h   = replyTimes.filter(function(h){return h>24;}).length;

  // By category
  var byCat={};
  replied.forEach(function(e) {
    if(e.replyHours==null) return;
    if(!byCat[e.category]) byCat[e.category]={times:[],color:''};
    byCat[e.category].times.push(e.replyHours);
    var cat=CATEGORIES.find(function(c){return c.name===e.category;});
    if(cat) byCat[e.category].color=cat.color;
  });

  var categoryStats=Object.entries(byCat).map(function(entry){
    var times=entry[1].times;
    var avg=Math.round(times.reduce(function(a,b){return a+b;},0)/times.length);
    return {name:entry[0],avgHours:avg,count:times.length,color:entry[1].color};
  }).sort(function(a,b){return b.avgHours-a.avgHours;});

  return {
    totalReplied:  replied.length,
    totalOverdue:  overdue.length,
    totalWaiting:  waiting.length,
    avgReplyHours: avgReply,
    under4h:       under4h,
    under24h:      under24h,
    over24h:       over24h,
    slaHours:      SLA_HOURS,
    categoryStats: categoryStats,
    overdueEmails: overdue.slice(0,20)
  };
}

// ── INSIGHTS ──────────────────────────────────────────────
function buildInsights(emails, categories, trend, period, responseStats) {
  var insights=[], total=emails.length;

  if(categories[0]) {
    var top=categories[0], pct=Math.round(top.count/total*100);
    insights.push({type:'warning',icon:'ti-alert-triangle',
      title:top.name+' is your biggest issue',
      detail:top.count+' emails ('+pct+'%) are about '+top.name.toLowerCase()+'. This is your highest friction area.',
      action:'Click to filter and review these emails',filterCat:top.name});
  }

  // Overdue emails insight
  if(responseStats&&responseStats.totalOverdue>0) {
    insights.push({type:'danger',icon:'ti-clock-exclamation',
      title:responseStats.totalOverdue+' emails overdue (no reply after '+SLA_HOURS+'h)',
      detail:responseStats.totalOverdue+' members are waiting longer than '+SLA_HOURS+' hours for a response. This directly risks member satisfaction and renewals.',
      action:'Click to see overdue emails',filterStatus:'overdue'});
  }

  // Slow response time
  if(responseStats&&responseStats.avgReplyHours!=null&&responseStats.avgReplyHours>12) {
    insights.push({type:'warning',icon:'ti-hourglass',
      title:'Average reply time is '+responseStats.avgReplyHours+' hours',
      detail:'Members are waiting an average of '+responseStats.avgReplyHours+' hours for a response. Best practice is under 4 hours for support emails.',
      action:'Check category response times in the Reply Tracker tab'});
  }

  // Biggest spike
  var spike=trend.filter(function(t){return t.change>30&&t.current>2;}).sort(function(a,b){return b.change-a.change;})[0];
  if(spike) {
    insights.push({type:'danger',icon:'ti-trending-up',
      title:spike.name+' up '+spike.change+'% vs previous period',
      detail:'Jumped from '+spike.previous+' to '+spike.current+' tickets. Something may have changed or broken.',
      action:'Click to review these emails',filterCat:spike.name});
  }

  // Biggest improvement
  var drop=trend.filter(function(t){return t.change<-20&&t.previous>2;}).sort(function(a,b){return a.change-b.change;})[0];
  if(drop) {
    insights.push({type:'success',icon:'ti-trending-down',
      title:drop.name+' down '+Math.abs(drop.change)+'% — improvement!',
      detail:'Tickets dropped from '+drop.previous+' to '+drop.current+'. Whatever you fixed is working.',
      action:'Document what changed so you can apply the same fix elsewhere'});
  }

  // High risk members
  var urgent=emails.filter(function(e){return e.sentiment==='urgent';});
  if(urgent.length>0) {
    insights.push({type:'danger',icon:'ti-flame',
      title:urgent.length+' urgent or frustrated emails',
      detail:'These members used words like "urgent", "broken", "still waiting". They need priority attention to prevent churn.',
      action:'Click to filter urgent emails',filterSentiment:'urgent'});
  }

  // Feature requests
  var features=categories.find(function(c){return c.name==='Feature requests';});
  if(features&&features.count>=3) {
    insights.push({type:'info',icon:'ti-bulb',
      title:features.count+' members requested new features',
      detail:'Review these to find quick wins that could reduce future support volume.',
      action:'Click to see feature requests',filterCat:'Feature requests'});
  }

  return insights.slice(0,6);
}

function buildFAQ(emails, categories) {
  var faqs=[], seen={};
  var byCategory={};
  emails.forEach(function(e){ if(!byCategory[e.category])byCategory[e.category]=[]; byCategory[e.category].push(e); });
  categories.forEach(function(cat) {
    var catEmails=byCategory[cat.name]||[];
    if(!catEmails.length) return;
    var subjectCounts={};
    catEmails.forEach(function(e){
      var clean=e.subject.replace(/^(re:|fwd:|fw:)\s*/gi,'').replace(/\s+/g,' ').trim().toLowerCase();
      subjectCounts[clean]=(subjectCounts[clean]||0)+1;
    });
    Object.entries(subjectCounts).sort(function(a,b){return b[1]-a[1];}).slice(0,2).forEach(function(entry){
      var subject=entry[0],count=entry[1];
      if(subject.length<10||seen[subject]) return;
      seen[subject]=true;
      var q=subject.charAt(0).toUpperCase()+subject.slice(1);
      if(!q.endsWith('?'))q+='?';
      faqs.push({q:q,a:getFAQAnswer(cat.name,subject),category:cat.name,count:count});
    });
  });
  faqs.sort(function(a,b){return b.count-a.count;});
  return faqs.slice(0,12);
}

function getFAQAnswer(category, subject) {
  var s=subject.toLowerCase();
  if(category==='Login & access issues'){
    if(s.includes('password')||s.includes('reset')) return 'Go to the login page and click "Forgot password". An email arrives within a few minutes — check spam too. Contact support if nothing arrives.';
    if(s.includes('locked')) return 'Accounts lock after several failed attempts. Wait 15 minutes or contact support@membershipanywhere.com to unlock immediately.';
    return 'Contact support@membershipanywhere.com with your username and we will help you regain access quickly.';
  }
  if(category==='Technical errors') return 'Try a hard refresh (Ctrl+Shift+R). If it continues try a different browser. Contact support with any error code you see.';
  if(category==='Member portal problems') return 'Log out, wait 5 minutes, and log back in. If still incorrect contact support with a screenshot.';
  if(category==='Email & comms issues') return 'Check spam and add support@membershipanywhere.com to safe senders. Contact us if still not receiving emails.';
  if(category==='Event registration') return 'Contact support@membershipanywhere.com with your booking reference. Refunds available up to 7 days before the event.';
  if(category==='Membership renewal') return 'Allow 1 hour for payment to process. If still showing lapsed contact support with your payment confirmation.';
  if(category==='Billing & payments') return 'Contact support@membershipanywhere.com with your membership number and billing details. We respond within 1 business day.';
  if(category==='Feature requests') return 'Email support@membershipanywhere.com with subject "Feature Request". We review all suggestions regularly.';
  return 'Contact support@membershipanywhere.com with full details and we will respond within 1 business day.';
}

// ── MICROSOFT GRAPH AUTH ──────────────────────────────────
async function getAccessToken() {
  var url  = 'https://login.microsoftonline.com/'+TENANT_ID+'/oauth2/v2.0/token';
  var body = new URLSearchParams({grant_type:'client_credentials',client_id:CLIENT_ID,client_secret:CLIENT_SECRET,scope:'https://graph.microsoft.com/.default'});
  var res  = await fetch(url,{method:'POST',body:body});
  var json = await res.json();
  if(json.error) throw new Error('Token failed: '+json.error);
  return json.access_token;
}

// ── FETCH SENT ITEMS to check replies ─────────────────────
async function fetchSentItems(token, fromDate) {
  var filter  = 'sentDateTime ge '+fromDate;
  var url     = 'https://graph.microsoft.com/v1.0/users/'+MAILBOX+'/mailFolders/SentItems/messages'
              + '?$filter='+encodeURIComponent(filter)
              + '&$select=subject,toRecipients,sentDateTime,conversationId'
              + '&$top=999';
  var sent=[], page=0;
  while(url&&page<5) {
    page++;
    var res=await fetch(url,{headers:{Authorization:'Bearer '+token}});
    var json=await res.json();
    if(json.error){console.error('Sent items error:',json.error.message);break;}
    (json.value||[]).forEach(function(m){
      sent.push({
        subject:      m.subject||'',
        sentAt:       m.sentDateTime||'',
        conversationId: m.conversationId||'',
        toEmails:     (m.toRecipients||[]).map(function(r){return(r.emailAddress&&r.emailAddress.address)||'';})
      });
    });
    url=json['@odata.nextLink']||null;
  }
  console.log('Fetched '+sent.length+' sent items');
  return sent;
}

// ── MATCH REPLIES TO INBOUND EMAILS ──────────────────────
function matchReplies(inboundEmails, sentItems, now) {
  // Index sent items by conversationId and recipient
  var sentByConv={};
  var sentByRecip={};
  sentItems.forEach(function(s) {
    if(s.conversationId) {
      if(!sentByConv[s.conversationId])sentByConv[s.conversationId]=[];
      sentByConv[s.conversationId].push(s);
    }
    s.toEmails.forEach(function(email){
      if(!sentByRecip[email])sentByRecip[email]=[];
      sentByRecip[email].push(s);
    });
  });

  return inboundEmails.map(function(email) {
    var reply=null;
    // Try conversation match first
    if(email.conversationId&&sentByConv[email.conversationId]) {
      var candidates=sentByConv[email.conversationId].filter(function(s){return s.sentAt>email.datetime;});
      if(candidates.length) reply=candidates.sort(function(a,b){return a.sentAt>b.sentAt?1:-1;})[0];
    }
    // Fall back to recipient match
    if(!reply&&sentByRecip[email.from]) {
      var candidates2=sentByRecip[email.from].filter(function(s){return s.sentAt>email.datetime;});
      if(candidates2.length) reply=candidates2.sort(function(a,b){return a.sentAt>b.sentAt?1:-1;})[0];
    }

    var hoursWaiting=hoursBetween(email.datetime, now);
    var replyStatus, replyHours=null;

    if(reply) {
      replyHours  = hoursBetween(email.datetime, reply.sentAt);
      replyStatus = 'replied';
    } else if(hoursWaiting>SLA_HOURS) {
      replyStatus = 'overdue';
    } else {
      replyStatus = 'waiting';
    }

    return Object.assign({},email,{replyStatus:replyStatus,replyHours:replyHours,hoursWaiting:hoursWaiting});
  });
}

// ── FETCH EMAILS ──────────────────────────────────────────
async function fetchEmailsForPeriod(token, fromDate, toDate) {
  var filter='receivedDateTime ge '+fromDate;
  if(toDate) filter+=' and receivedDateTime lt '+toDate;
  var url='https://graph.microsoft.com/v1.0/users/'+MAILBOX+'/messages'
        + '?$filter='+encodeURIComponent(filter)
        + '&$select=subject,from,receivedDateTime,bodyPreview,conversationId'
        + '&$orderby='+encodeURIComponent('receivedDateTime desc')
        + '&$top=999';
  var emails=[],skipped=0,marketing=0,page=0;
  while(url) {
    page++;
    var res=await fetch(url,{headers:{Authorization:'Bearer '+token}});
    var json=await res.json();
    if(json.error) throw new Error(json.error.code+': '+json.error.message);
    console.log('Page '+page+': '+(json.value||[]).length+' emails');
    (json.value||[]).forEach(function(m){
      var subject=m.subject||'(no subject)';
      var preview=m.bodyPreview||'';
      var from=(m.from&&m.from.emailAddress)?m.from.emailAddress.address:'unknown';
      var fromName=(m.from&&m.from.emailAddress)?m.from.emailAddress.name||'':'';
      var date=m.receivedDateTime?m.receivedDateTime.split('T')[0]:'';
      var datetime=m.receivedDateTime||'';
      var convId=m.conversationId||'';
      if(isConfidential(subject,preview)){skipped++;return;}
      if(isMarketing(subject,preview,from)){marketing++;return;}
      emails.push({subject:subject,from:from,fromName:fromName,date:date,datetime:datetime,conversationId:convId,category:categorise(subject,preview),sentiment:getSentiment(subject,preview)});
    });
    url=json['@odata.nextLink']||null;
    if(page>=20){url=null;}
  }
  console.log('Total: '+emails.length+' support, '+skipped+' confidential, '+marketing+' marketing');
  return {emails:emails,skipped:skipped,marketing:marketing};
}

// ── DEMO DATA ─────────────────────────────────────────────
var DEMO_POOL = [
  {subject:'Cannot log into member portal',       from:'j.smith@email.com',   fromName:'James Smith',    category:'Login & access issues',  sentiment:'urgent'},
  {subject:'Event registration page not loading', from:'member@company.com',  fromName:'Sarah Chen',     category:'Technical errors',        sentiment:'neutral'},
  {subject:'Feature request bulk CSV import',     from:'admin@assoc.com',     fromName:'Admin Team',     category:'Feature requests',        sentiment:'neutral'},
  {subject:'Membership renewal not processing',   from:'b.jones@email.com',   fromName:'Bob Jones',      category:'Membership renewal',      sentiment:'urgent'},
  {subject:'2FA code not arriving by SMS',        from:'c.brown@org.uk',      fromName:'Carol Brown',    category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Error 500 when editing profile',      from:'d.wilson@member.org', fromName:'David Wilson',   category:'Technical errors',        sentiment:'neutral'},
  {subject:'Account locked after failed logins',  from:'k.allen@org.com',     fromName:'Kate Allen',     category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Portal shows wrong subscription tier',from:'f.martin@club.com',   fromName:'Frank Martin',   category:'Member portal problems',  sentiment:'neutral'},
  {subject:'Password reset email not received',   from:'g.lee@email.com',     fromName:'Grace Lee',      category:'Login & access issues',   sentiment:'neutral'},
  {subject:'Renewal reminder was not sent',       from:'r.patel@org.uk',      fromName:'Raj Patel',      category:'Membership renewal',      sentiment:'neutral'},
  {subject:'Login page not loading on mobile',    from:'m.ng@email.com',      fromName:'Michelle Ng',    category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Email notifications stopped working', from:'t.ford@assoc.com',    fromName:'Tom Ford',       category:'Email & comms issues',    sentiment:'neutral'},
  {subject:'Cannot update billing details',       from:'s.jones@email.com',   fromName:'Susan Jones',    category:'Billing & payments',      sentiment:'neutral'},
  {subject:'Request to add bulk member import',   from:'h.white@co.org',      fromName:'Helen White',    category:'Feature requests',        sentiment:'positive'},
  {subject:'Still waiting for help with login',   from:'j.smith@email.com',   fromName:'James Smith',    category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Cannot access my account again',      from:'j.smith@email.com',   fromName:'James Smith',    category:'Login & access issues',   sentiment:'urgent'},
  {subject:'How do I update my membership tier?', from:'b.jones@email.com',   fromName:'Bob Jones',      category:'Help & how-to questions', sentiment:'neutral'},
  {subject:'Membership renewal not processing',   from:'b.jones@email.com',   fromName:'Bob Jones',      category:'Membership renewal',      sentiment:'urgent'}
];

function getDemoData(period,fromDate,toDate) {
  var take={'today':5,'7':10,'30':18,'90':15,'365':18}[period]||18;
  var maxD={'today':0,'7':7,'30':30,'90':90,'365':365}[period]||30;
  var now=new Date().toISOString();
  var emails=DEMO_POOL.slice(0,take).map(function(e,i){
    var dt=new Date(Date.now()-i*Math.floor(86400000*maxD/take));
    var replyStatus=i%3===0?'replied':i%3===1?'waiting':'overdue';
    var replyHours=replyStatus==='replied'?Math.floor(Math.random()*20)+1:null;
    return Object.assign({},e,{
      date:dt.toISOString().split('T')[0],
      datetime:dt.toISOString(),
      conversationId:'conv-'+i,
      replyStatus:replyStatus,
      replyHours:replyHours,
      hoursWaiting:Math.floor(Math.random()*48)
    });
  });
  var prevEmails=DEMO_POOL.slice(0,Math.max(1,take-4)).map(function(e,i){
    return Object.assign({},e,{date:daysAgoStr(maxD+i),datetime:new Date(Date.now()-(maxD+i)*86400000).toISOString(),replyStatus:'replied',replyHours:Math.floor(Math.random()*20)+1,hoursWaiting:0});
  });
  var categories=buildCategories(emails);
  var trend=buildTrend(emails,prevEmails);
  var responseStats=buildResponseStats(emails);
  var memberProfiles=buildMemberProfiles(emails);
  var insights=buildInsights(emails,categories,trend,period,responseStats);
  return {source:'demo',period:period,total:emails.length,skipped:1,marketing:3,categories:categories,emails:emails,trend:trend,heatmap:buildHeatmap(emails),weekly:buildWeeklyTrend(emails),insights:insights,faq:buildFAQ(emails,categories),responseStats:responseStats,memberProfiles:memberProfiles};
}

// ── ROUTES ────────────────────────────────────────────────
app.get('/',function(req,res){
  res.json({status:'ok',mailbox:MAILBOX,mode:(TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'live':'demo',slaHours:SLA_HOURS});
});

app.get('/debug',async function(req,res){
  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET)return res.json({status:'no credentials'});
  try{var token=await getAccessToken();var r=await fetch('https://graph.microsoft.com/v1.0/users/'+MAILBOX,{headers:{Authorization:'Bearer '+token}});res.json({tokenOk:true,mailboxCheck:await r.json()});}
  catch(e){res.json({tokenOk:false,error:e.message});}
});

app.get('/emails',async function(req,res){
  var period   = req.query.period||'30';
  var fromDate = req.query.from||null;
  var toDate   = req.query.to||null;

  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET) return res.json(getDemoData(period,fromDate,toDate));

  try{
    var token   = await getAccessToken();
    var now     = new Date().toISOString();
    var currFrom= fromDate ? getCustomDate(fromDate) : getFromDate(period);
    var currTo  = toDate   ? getCustomDate(toDate)   : null;
    var prevFrom= getPrevFromDate(period);

    console.log('Fetching period:',period,'from:',currFrom,'to:',currTo||'now');
    var curr=await fetchEmailsForPeriod(token,currFrom,currTo);
    var prev=await fetchEmailsForPeriod(token,prevFrom,currFrom);

    // Fetch sent items to check replies
    console.log('Fetching sent items...');
    var sentItems=await fetchSentItems(token,prevFrom);

    // Match replies to inbound emails
    var emailsWithReply=matchReplies(curr.emails,sentItems,now);

    var categories   =buildCategories(emailsWithReply);
    var trend        =buildTrend(emailsWithReply,prev.emails);
    var responseStats=buildResponseStats(emailsWithReply);
    var memberProfiles=buildMemberProfiles(emailsWithReply);
    var insights     =buildInsights(emailsWithReply,categories,trend,period,responseStats);
    var faq          =buildFAQ(emailsWithReply,categories);

    res.json({
      source:'live',period:period,total:emailsWithReply.length,
      skipped:curr.skipped,marketing:curr.marketing,
      categories:categories,emails:emailsWithReply,
      trend:trend,heatmap:buildHeatmap(emailsWithReply),
      weekly:buildWeeklyTrend(emailsWithReply),
      insights:insights,faq:faq,
      responseStats:responseStats,
      memberProfiles:memberProfiles
    });
  }catch(err){
    console.error('Error:',err.message);
    res.status(500).json({error:err.message});
  }
});

app.listen(PORT,function(){
  console.log('MA Support Backend running on port '+PORT);
  console.log('Mailbox: '+MAILBOX);
  console.log('SLA: '+SLA_HOURS+' hours');
  console.log('Mode: '+((TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'LIVE':'DEMO'));
});
