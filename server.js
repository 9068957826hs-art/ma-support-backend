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

// ── CONFIDENTIAL — skip these entirely ───────────────────
const CONFIDENTIAL_WORDS = [
  'invoice','bank transfer','contract','salary','legal notice',
  'nda','confidential','refund dispute','terminate account',
  'lawsuit','solicitor','attorney','court order'
];

// ── PLATFORM / AUTOMATED EMAIL FILTERS ───────────────────
// These are NOT client emails — skip them all

const PLATFORM_DOMAINS = [
  // Donor/CRM platforms
  'donorperfect.com','donorperfect.net','dpgrowth.com',
  'blackbaud.com','blackbaudhq.com','blackbaudcloud.com',
  'neoncrm.com','neonsoftware.com','neonone.com',
  'salesforce.com','exacttarget.com','pardot.com',
  'bloomerang.co','bloomerang.com',
  'raiser.com','raisersedge.com',
  'etapestry.com','etap.com',
  'giftworks.com','frontstream.com',
  'membersuite.com','memberclicks.com','memberplanet.com',
  'wildapricot.com','growthzone.com','yourcause.com',
  'classy.org','funraise.org','networkforgood.com',
  'givingfuel.com','qgiv.com','mightycause.com',
  // Payment platforms
  'squareup.com','square.com','squ.re',
  'stripe.com','paypal.com','gocardless.com',
  'worldpay.com','sagepay.com','opayo.com',
  'braintreegateway.com','authorize.net',
  // Email/marketing platforms
  'mailchimp.com','sendgrid.net','sendgrid.com',
  'constantcontact.com','hubspot.com','marketo.com',
  'klaviyo.com','campaignmonitor.com','mailgun.org',
  'postmarkapp.com','amazonses.com','mandrill.com',
  'sparkpostmail.com','mailerlite.com','activecampaign.com',
  'getresponse.com','aweber.com','drip.com',
  // Auth/security automated emails
  'accounts.google.com','login.microsoftonline.com',
  'notifications.google.com','no-reply.accounts.google.com',
  // Event platforms
  'eventbrite.com','ticketmaster.com','bookwhen.com',
  'eventsquid.com','cvent.com','regonline.com',
  // Training/webinar platforms
  'zoom.us','gotomeeting.com','gotowebinar.com',
  'webex.com','teams.microsoft.com',
  // Generic automated senders
  'noreply.','no-reply.','donotreply.','do-not-reply.',
  'notifications.','alerts.','mailer.','bounce.',
  'automated.','system.','support-noreply.'
];

const PLATFORM_SUBJECT_PATTERNS = [
  // DonorPerfect specific
  /donorperfect/i,
  /complete your daily fundraising/i,
  /training opportunities/i,
  /using donorperfect/i,
  // Generic marketing/automated
  /convert more.*donor/i,
  /get \d+ free training/i,
  /is your strategy keeping up/i,
  /secure link to log in/i,
  /click here to (sign in|log in|verify)/i,
  /your (daily|weekly|monthly) (digest|summary|report|update)/i,
  /automated (message|notification|email)/i,
  /do not reply to this/i,
  /you('re| are) receiving this/i,
  /unsubscribe|opt.out/i,
  /view (this email|in browser)/i,
  /manage (your )?(preferences|subscription)/i,
  /fundraising (tip|strategy|best practice)/i,
  /webinar (reminder|registration|recording)/i,
  /(case|ticket) #\d+ (created|updated|closed|resolved)/i,
  /your (account|password|login) (has been|was) (created|reset|updated)/i,
  /confirm your (email|account|subscription)/i,
  /receipt for your (payment|purchase|order)/i,
  /order confirmation/i,
  /invoice #/i,
  /payment (received|processed|failed|declined)/i,
  /\[automated\]|\[system\]|\[notification\]/i
];

const CONFIDENTIAL_SUBJECT_PATTERNS = [
  /\bnda\b/i, /non.disclosure/i, /legal notice/i,
  /cease and desist/i, /without prejudice/i
];

// ── ISSUE CATEGORIES (based on real MA client emails) ─────
const CATEGORIES = [
  {
    name:  'Login & access issues',
    color: '#185FA5',
    keywords: ['login','log in','log out','password','sign in','locked out','locked','access','2fa',
               'two factor','reset password','cant log','account locked','username','credentials',
               'authentication','cannot access','unable to access','secure link','session']
  },
  {
    name:  'Technical errors',
    color: '#5F5E5A',
    keywords: ['error','bug','500','401','403','404','crash','broken','not working','failed',
               'exception','loading','spinning','slow','timeout','blank page','glitch',
               'version','connecting','connection','issue connecting','upgrade','v16','v15',
               'compatibility','not loading','keeps crashing','freezing','frozen']
  },
  {
    name:  'Member portal problems',
    color: '#639922',
    keywords: ['portal','dashboard','profile','update profile','edit','page not loading',
               'display','button','wrong tier','subscription tier','simplified view',
               'reciprocal','logo','view','layout','screen','interface','member card',
               'membership card','download card','card','certificate','badge']
  },
  {
    name:  'Data & records issues',
    color: '#7B3F00',
    keywords: ['lost','missing','data','record','information','deleted','gone','disappeared',
               'lost information','lost data','missing record','cannot find','not showing',
               'history','import','export','database','sync','synchronise','update records']
  },
  {
    name:  'Email & comms issues',
    color: '#A32D2D',
    keywords: ['not receiving','not getting','communication','no emails','stopped receiving',
               'missing email','havent received','email notification','newsletter subscription',
               'confirmation email','welcome email','renewal reminder','email not sent']
  },
  {
    name:  'Event registration',
    color: '#533AB7',
    keywords: ['event','register','registration','ticket','booking','attend','cancel booking',
               'waitlist','conference','webinar','workshop','seminar','session','programme']
  },
  {
    name:  'Membership renewal',
    color: '#993556',
    keywords: ['renew','renewal','lapsed','lapse','expired','expire','membership due',
               'auto renew','not renewed','renewal failed','membership expir','dues',
               'annual fee','membership fee','subscription renewal']
  },
  {
    name:  'Billing & payments',
    color: '#BA7517',
    keywords: ['payment','charge','billing','direct debit','card','refund','overcharged',
               'double charged','transaction','fee','cost','price','invoice','receipt',
               'payment failed','payment not','cannot pay','unable to pay']
  },
  {
    name:  'Feature requests',
    color: '#0F6E56',
    keywords: ['feature','suggestion','would like','could you add','request','improve',
               'bulk import','export','wish','it would be great','can you add','is it possible',
               'enhancement','new feature','add the ability','would be helpful']
  },
  {
    name:  'Account management',
    color: '#4A4A8A',
    keywords: ['cancel','cancellation','close account','delete account','transfer',
               'change email','update details','change address','update my account',
               'merge accounts','duplicate','organisation details','contact details']
  },
  {
    name:  'General support query',
    color: '#6B7280',
    keywords: ['how do i','how to','where can i','can you help','need help','need assistance',
               'not sure','confused','wondering','is it possible','could you tell me',
               'question','query','enquiry','inquiry','support qs','help with']
  }
];

// Pain point mapping — maps categories to business pain areas
const PAIN_AREAS = [
  { name:'Platform stability',     icon:'ti-bug',          categories:['Technical errors'],                          description:'Members experiencing bugs, errors and version issues' },
  { name:'Access & authentication',icon:'ti-lock',         categories:['Login & access issues'],                     description:'Members unable to log in or access their accounts' },
  { name:'Data integrity',         icon:'ti-database',     categories:['Data & records issues'],                     description:'Lost, missing or incorrect member data and records' },
  { name:'Member self-service',    icon:'ti-user-circle',  categories:['Member portal problems','Account management'],description:'Members struggling to use the portal and manage their accounts' },
  { name:'Financial operations',   icon:'ti-credit-card',  categories:['Billing & payments','Membership renewal'],   description:'Payment failures, renewal issues and billing queries' },
  { name:'Communications',         icon:'ti-mail',         categories:['Email & comms issues'],                      description:'Members not receiving emails, confirmations or notifications' },
  { name:'Events management',      icon:'ti-calendar',     categories:['Event registration'],                        description:'Issues with event registration and booking' },
  { name:'Product development',    icon:'ti-bulb',         categories:['Feature requests'],                          description:'Feature gaps identified by members — roadmap input' }
];

const URGENT_WORDS   = ['urgent','asap','immediately','critical','broken','cannot','cant','unable',
                         'stuck','frustrated','angry','terrible','awful','unacceptable','still not',
                         'still waiting','no response','weeks','days waiting','escalate'];
const POSITIVE_WORDS = ['thank','thanks','great','excellent','helpful','resolved','sorted',
                         'working','appreciate','happy','pleased','wonderful','perfect','brilliant'];

// ── HELPERS ───────────────────────────────────────────────
function isConfidential(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  return CONFIDENTIAL_WORDS.some(w=>text.includes(w)) ||
         CONFIDENTIAL_SUBJECT_PATTERNS.some(p=>p.test(subject));
}

function isPlatformEmail(subject, preview, from) {
  const sender = (from||'').toLowerCase();
  // Check sender domain against platform list
  if (PLATFORM_DOMAINS.some(d=>sender.includes(d))) return true;
  // Check subject against platform patterns
  if (PLATFORM_SUBJECT_PATTERNS.some(p=>p.test(subject))) return true;
  // Check preview for unsubscribe/automated signals
  const prev = (preview||'').toLowerCase();
  if (prev.includes('unsubscribe') || prev.includes('you are receiving this') || prev.includes('opt out')) return true;
  return false;
}

function categorise(subject, preview) {
  const text = (subject+' '+preview).toLowerCase();
  for (var i=0;i<CATEGORIES.length;i++) {
    for (var j=0;j<CATEGORIES[i].keywords.length;j++) {
      if (text.includes(CATEGORIES[i].keywords[j])) return CATEGORIES[i].name;
    }
  }
  return 'General support query';
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

function getCustomDate(dateStr) {
  var d = new Date(dateStr); d.setHours(0,0,0,0);
  return d.toISOString().split('.')[0]+'Z';
}

function getPrevFromDate(period) {
  var d = new Date();
  var days={'today':1,'7':7,'30':30,'90':90,'365':365}[period]||30;
  d.setDate(d.getDate()-days*2); d.setHours(0,0,0,0);
  return d.toISOString().split('.')[0]+'Z';
}

function hoursBetween(a,b) {
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

// ── PAIN POINTS ───────────────────────────────────────────
function buildPainPoints(emails, categories) {
  var catMap={};
  categories.forEach(function(c){ catMap[c.name]=c.count; });

  return PAIN_AREAS.map(function(area) {
    var total=0, areaEmails=[];
    area.categories.forEach(function(catName){
      total+=(catMap[catName]||0);
      areaEmails=areaEmails.concat(emails.filter(function(e){return e.category===catName;}));
    });
    // Top subjects in this area
    var subjectCounts={};
    areaEmails.forEach(function(e){
      var clean=e.subject.replace(/^(re:|fwd:|fw:)\s*/gi,'').trim();
      subjectCounts[clean]=(subjectCounts[clean]||0)+1;
    });
    var topSubjects=Object.entries(subjectCounts)
      .sort(function(a,b){return b[1]-a[1];})
      .slice(0,5)
      .map(function(entry){return{subject:entry[0],count:entry[1]};});

    var urgent=areaEmails.filter(function(e){return e.sentiment==='urgent';}).length;
    var severity=total===0?'none':total<5?'low':total<15?'medium':total<30?'high':'critical';

    return {
      name:        area.name,
      icon:        area.icon,
      description: area.description,
      categories:  area.categories,
      total:       total,
      urgent:      urgent,
      severity:    severity,
      topSubjects: topSubjects,
      emails:      areaEmails.slice(0,20)
    };
  }).filter(function(p){return p.total>0;})
    .sort(function(a,b){return b.total-a.total;});
}

// ── FAQ from real client email subjects ───────────────────
function buildFAQ(emails, categories) {
  if (emails.length < 5) return [];

  var faqs=[], seen={};
  var byCategory={};
  emails.forEach(function(e){
    if(!byCategory[e.category]) byCategory[e.category]=[];
    byCategory[e.category].push(e);
  });

  categories.forEach(function(cat) {
    var catEmails=byCategory[cat.name]||[];
    if(catEmails.length<2) return; // Only generate FAQ if at least 2 emails in category

    var subjectCounts={};
    catEmails.forEach(function(e){
      var clean=e.subject
        .replace(/^(re:|fwd:|fw:|re\[2\]:|re\[3\]:)\s*/gi,'')
        .replace(/\s+/g,' ').trim();
      if(clean.length>8) subjectCounts[clean]=(subjectCounts[clean]||0)+1;
    });

    Object.entries(subjectCounts)
      .sort(function(a,b){return b[1]-a[1];})
      .slice(0,2)
      .forEach(function(entry){
        var subject=entry[0], count=entry[1];
        var key=subject.toLowerCase();
        if(key.length<8||seen[key]) return;
        seen[key]=true;

        // Turn subject into a question
        var q=subject.charAt(0).toUpperCase()+subject.slice(1);
        if(!q.match(/\?$/)) q=q+'?';
        // Remove trailing punctuation before adding ?
        q=q.replace(/[.!,]+\?$/,'?');

        faqs.push({
          q:        q,
          a:        getFAQAnswer(cat.name, subject),
          category: cat.name,
          count:    count,
          realSubject: true
        });
      });
  });

  faqs.sort(function(a,b){return b.count-a.count;});
  return faqs.slice(0,15);
}

function getFAQAnswer(category, subject) {
  var s=subject.toLowerCase();
  if(category==='Login & access issues'){
    if(s.includes('password')||s.includes('reset')) return 'Go to the login page and click "Forgot password". An email arrives within a few minutes — check spam. Contact support@membershipanywhere.com if nothing arrives.';
    if(s.includes('locked')) return 'Accounts lock after several failed attempts. Wait 15 minutes or contact support@membershipanywhere.com to unlock immediately.';
    if(s.includes('2fa')||s.includes('two factor')) return 'Check your phone signal and request a new code. If you changed your number contact support to update your 2FA settings.';
    return 'Contact support@membershipanywhere.com with your username and we will help you regain access as quickly as possible.';
  }
  if(category==='Technical errors'){
    if(s.includes('401')) return 'A 401 error means your session has expired or you are not authorised. Please log out, clear your browser cache (Ctrl+Shift+Delete), and log back in. If the issue persists contact support with the URL where you see the error.';
    if(s.includes('version')||s.includes('v16')||s.includes('connecting')) return 'If you are having trouble connecting after an update, please clear your browser cache and try again. If the issue continues, contact support@membershipanywhere.com with your browser version and operating system.';
    return 'Try a hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac). If the error continues try a different browser. Contact support with any error code or message you see.';
  }
  if(category==='Member portal problems'){
    if(s.includes('card')||s.includes('certificate')) return 'To download your membership card: log into your member portal, go to My Profile, and click Download Membership Card. If you cannot see this option contact support@membershipanywhere.com.';
    if(s.includes('logo')||s.includes('display')||s.includes('view')) return 'If a logo or display element is not appearing correctly, try refreshing the page. If the issue persists contact support with a screenshot so we can investigate.';
    return 'Log out, wait 5 minutes, and log back in. If the issue persists contact support@membershipanywhere.com with a screenshot of what you are seeing.';
  }
  if(category==='Data & records issues') return 'Please contact support@membershipanywhere.com immediately with as much detail as possible — the member name, date, and what data appears to be missing. We will investigate and restore records where possible.';
  if(category==='Email & comms issues') return 'Check your spam or junk folder and add support@membershipanywhere.com to your safe senders list. If you are still not receiving emails contact us and we will check your communication preferences.';
  if(category==='Event registration') return 'Contact support@membershipanywhere.com with the event name and your membership details. For cancellations please include your booking reference — refunds are available up to 7 days before the event.';
  if(category==='Membership renewal') return 'Allow 1 hour for payment to update your membership status. If still showing lapsed after 1 hour, contact support with your payment confirmation and we will update it manually.';
  if(category==='Billing & payments') return 'Contact support@membershipanywhere.com with your membership number and details of the billing query. We respond within 1 business day. Please do not send card details by email.';
  if(category==='Feature requests') return 'Thank you for the suggestion! Email support@membershipanywhere.com with the subject "Feature Request" and describe what you would like added. Our product team reviews all suggestions.';
  return 'Contact support@membershipanywhere.com with full details of your query and we will respond within 1 business day.';
}

function buildHeatmap(emails) {
  var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var counts={};
  days.forEach(function(d){ counts[d]={}; for(var h=0;h<24;h++) counts[d][h]=0; });
  emails.forEach(function(e) {
    if(!e.datetime) return;
    var dt=new Date(e.datetime); var day=days[dt.getDay()]; var hr=dt.getHours();
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

function buildTrend(curr,prev) {
  var c={},p={};
  curr.forEach(function(e){c[e.category]=(c[e.category]||0)+1;});
  prev.forEach(function(e){p[e.category]=(p[e.category]||0)+1;});
  return CATEGORIES.map(function(cat){
    var cv=c[cat.name]||0,pv=p[cat.name]||0;
    var change=pv===0?(cv>0?100:0):Math.round(((cv-pv)/pv)*100);
    return {name:cat.name,color:cat.color,current:cv,previous:pv,change:change};
  }).filter(function(t){return t.current>0||t.previous>0;}).sort(function(a,b){return b.current-a.current;});
}

function buildResponseStats(emails) {
  var replied  =emails.filter(function(e){return e.replyStatus==='replied';});
  var overdue  =emails.filter(function(e){return e.replyStatus==='overdue';});
  var waiting  =emails.filter(function(e){return e.replyStatus==='waiting';});
  var times    =replied.map(function(e){return e.replyHours;}).filter(function(h){return h!=null;});
  var avg      =times.length?Math.round(times.reduce(function(a,b){return a+b;},0)/times.length):null;
  var byCat={};
  replied.forEach(function(e){
    if(e.replyHours==null) return;
    if(!byCat[e.category]) byCat[e.category]={times:[],color:''};
    byCat[e.category].times.push(e.replyHours);
    var cat=CATEGORIES.find(function(c){return c.name===e.category;});
    if(cat) byCat[e.category].color=cat.color;
  });
  var categoryStats=Object.entries(byCat).map(function(entry){
    var t=entry[1].times;
    return {name:entry[0],avgHours:Math.round(t.reduce(function(a,b){return a+b;},0)/t.length),count:t.length,color:entry[1].color};
  }).sort(function(a,b){return b.avgHours-a.avgHours;});
  return {totalReplied:replied.length,totalOverdue:overdue.length,totalWaiting:waiting.length,avgReplyHours:avg,slaHours:SLA_HOURS,categoryStats:categoryStats,overdueEmails:overdue.slice(0,20)};
}

function buildMemberProfiles(emails) {
  var profiles={};
  emails.forEach(function(e){
    var sender=e.from.toLowerCase();
    if(!profiles[sender]){profiles[sender]={email:sender,name:e.fromName||sender.split('@')[0],count:0,urgent:0,categories:{},latest:'',oldest:'',unreplied:0,replyTimes:[]};}
    var p=profiles[sender];
    p.count++;
    if(e.sentiment==='urgent') p.urgent++;
    p.categories[e.category]=(p.categories[e.category]||0)+1;
    if(!p.latest||e.date>p.latest) p.latest=e.date;
    if(!p.oldest||e.date<p.oldest) p.oldest=e.date;
    if(e.replyStatus==='unreplied'||e.replyStatus==='overdue') p.unreplied++;
    if(e.replyHours!=null) p.replyTimes.push(e.replyHours);
  });
  return Object.values(profiles).map(function(p){
    if(p.replyTimes.length>0) p.avgReplyHours=Math.round(p.replyTimes.reduce(function(a,b){return a+b;},0)/p.replyTimes.length);
    p.riskScore=Math.min(100,(p.count*5)+(p.urgent*20)+(p.unreplied*15));
    p.riskLevel=p.riskScore>=60?'high':p.riskScore>=30?'medium':'low';
    p.topIssue=Object.entries(p.categories).sort(function(a,b){return b[1]-a[1];})[0]?.[0]||'General';
    delete p.replyTimes;
    return p;
  }).sort(function(a,b){return b.riskScore-a.riskScore;}).slice(0,30);
}

function buildInsights(emails,categories,trend,period,responseStats) {
  var insights=[],total=emails.length;
  if(!total) return [];

  if(categories[0]){
    var top=categories[0],pct=Math.round(top.count/total*100);
    insights.push({type:'warning',icon:'ti-alert-triangle',title:top.name+' is your biggest issue',detail:top.count+' emails ('+pct+'%) are about '+top.name.toLowerCase()+'. This is your highest friction area right now.',action:'Click to filter and review these emails',filterCat:top.name});
  }
  if(responseStats&&responseStats.totalOverdue>0){
    insights.push({type:'danger',icon:'ti-clock-exclamation',title:responseStats.totalOverdue+' emails overdue — no reply after '+SLA_HOURS+'h',detail:'These members are waiting. Every hour without a reply increases the risk of member churn and escalation.',action:'Go to Reply Tracker tab to see overdue emails',filterStatus:'overdue'});
  }
  if(responseStats&&responseStats.avgReplyHours!=null&&responseStats.avgReplyHours>12){
    insights.push({type:'warning',icon:'ti-hourglass',title:'Average reply time is '+responseStats.avgReplyHours+' hours',detail:'Members are waiting an average of '+responseStats.avgReplyHours+' hours. Best practice for membership organisations is under 4 hours.',action:'Check Reply Tracker for slowest categories'});
  }
  var spike=trend.filter(function(t){return t.change>30&&t.current>2;}).sort(function(a,b){return b.change-a.change;})[0];
  if(spike){
    insights.push({type:'danger',icon:'ti-trending-up',title:spike.name+' up '+spike.change+'% vs previous period',detail:'Jumped from '+spike.previous+' to '+spike.current+' tickets. Something may have changed or broken.',action:'Click to review these emails',filterCat:spike.name});
  }
  var drop=trend.filter(function(t){return t.change<-20&&t.previous>2;}).sort(function(a,b){return a.change-b.change;})[0];
  if(drop){
    insights.push({type:'success',icon:'ti-trending-down',title:drop.name+' down '+Math.abs(drop.change)+'% — improvement!',detail:'Tickets dropped from '+drop.previous+' to '+drop.current+'. Whatever you fixed is working.',action:'Document what changed so you can apply the same fix elsewhere'});
  }
  var urgent=emails.filter(function(e){return e.sentiment==='urgent';});
  if(urgent.length>0){
    insights.push({type:'danger',icon:'ti-flame',title:urgent.length+' urgent or frustrated emails',detail:'Members used words like "urgent", "broken", "still waiting". These need priority responses to prevent churn.',action:'Click to filter urgent emails',filterSentiment:'urgent'});
  }
  return insights.slice(0,6);
}

async function getAccessToken() {
  var url  ='https://login.microsoftonline.com/'+TENANT_ID+'/oauth2/v2.0/token';
  var body =new URLSearchParams({grant_type:'client_credentials',client_id:CLIENT_ID,client_secret:CLIENT_SECRET,scope:'https://graph.microsoft.com/.default'});
  var res  =await fetch(url,{method:'POST',body:body});
  var json =await res.json();
  if(json.error) throw new Error('Token failed: '+json.error);
  return json.access_token;
}

async function fetchSentItems(token,fromDate) {
  var filter='sentDateTime ge '+fromDate;
  var url='https://graph.microsoft.com/v1.0/users/'+MAILBOX+'/mailFolders/SentItems/messages'
        +'?$filter='+encodeURIComponent(filter)
        +'&$select=subject,toRecipients,sentDateTime,conversationId&$top=999';
  var sent=[],page=0;
  while(url&&page<5){
    page++;
    var res=await fetch(url,{headers:{Authorization:'Bearer '+token}});
    var json=await res.json();
    if(json.error){console.error('Sent items error:',json.error.message);break;}
    (json.value||[]).forEach(function(m){
      sent.push({subject:m.subject||'',sentAt:m.sentDateTime||'',conversationId:m.conversationId||'',toEmails:(m.toRecipients||[]).map(function(r){return(r.emailAddress&&r.emailAddress.address)||'';})});
    });
    url=json['@odata.nextLink']||null;
  }
  return sent;
}

function matchReplies(inbound,sent,now) {
  var byConv={},byRecip={};
  sent.forEach(function(s){
    if(s.conversationId){if(!byConv[s.conversationId])byConv[s.conversationId]=[];byConv[s.conversationId].push(s);}
    s.toEmails.forEach(function(e){if(!byRecip[e])byRecip[e]=[];byRecip[e].push(s);});
  });
  return inbound.map(function(email){
    var reply=null;
    if(email.conversationId&&byConv[email.conversationId]){
      var c=byConv[email.conversationId].filter(function(s){return s.sentAt>email.datetime;});
      if(c.length) reply=c.sort(function(a,b){return a.sentAt>b.sentAt?1:-1;})[0];
    }
    if(!reply&&byRecip[email.from]){
      var c2=byRecip[email.from].filter(function(s){return s.sentAt>email.datetime;});
      if(c2.length) reply=c2.sort(function(a,b){return a.sentAt>b.sentAt?1:-1;})[0];
    }
    var hoursWaiting=hoursBetween(email.datetime,now);
    var replyStatus,replyHours=null;
    if(reply){replyHours=hoursBetween(email.datetime,reply.sentAt);replyStatus='replied';}
    else if(hoursWaiting>SLA_HOURS){replyStatus='overdue';}
    else{replyStatus='waiting';}
    return Object.assign({},email,{replyStatus:replyStatus,replyHours:replyHours,hoursWaiting:hoursWaiting});
  });
}

async function fetchEmailsForPeriod(token,fromDate,toDate) {
  var filter='receivedDateTime ge '+fromDate;
  if(toDate) filter+=' and receivedDateTime lt '+toDate;
  var url='https://graph.microsoft.com/v1.0/users/'+MAILBOX+'/messages'
        +'?$filter='+encodeURIComponent(filter)
        +'&$select=subject,from,receivedDateTime,bodyPreview,conversationId'
        +'&$orderby='+encodeURIComponent('receivedDateTime desc')
        +'&$top=999';
  var emails=[],skipped=0,platform=0,page=0;
  while(url){
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
      if(isPlatformEmail(subject,preview,from)){platform++;return;}
      emails.push({subject:subject,from:from,fromName:fromName,date:date,datetime:datetime,conversationId:convId,category:categorise(subject,preview),sentiment:getSentiment(subject,preview)});
    });
    url=json['@odata.nextLink']||null;
    if(page>=20){url=null;}
  }
  console.log('TOTAL: '+emails.length+' client emails, '+skipped+' confidential, '+platform+' platform/automated filtered');
  return {emails:emails,skipped:skipped,platform:platform};
}

// Demo data using real-style MA subjects
var DEMO_POOL=[
  {subject:'Re: Reciprocal Logo on Simplified View',    from:'admin@museum.org',      fromName:'Jane Morris',    category:'Member portal problems', sentiment:'neutral'},
  {subject:'Issue Connecting to Version 16',             from:'it@naturalhistory.org', fromName:'Tom Baker',      category:'Technical errors',        sentiment:'urgent'},
  {subject:'Idaho Museum — lost member information',     from:'mgr@idahomuseum.org',   fromName:'Sarah Lee',      category:'Data & records issues',   sentiment:'urgent'},
  {subject:'Re: JFGM Support Qs',                        from:'contact@jfgm.org',      fromName:'JFGM Admin',     category:'General support query',   sentiment:'neutral'},
  {subject:'Download membership card on a computer?',    from:'member@artclub.com',    fromName:'Paul Chen',      category:'Member portal problems',  sentiment:'neutral'},
  {subject:'Re: 401 Error for MY Museum',                from:'tech@mymuseum.org',     fromName:'Alex Wright',    category:'Technical errors',        sentiment:'urgent'},
  {subject:'Cannot log into member portal',              from:'j.smith@org.com',       fromName:'James Smith',    category:'Login & access issues',   sentiment:'urgent'},
  {subject:'Membership renewal not processing',          from:'b.jones@club.org',      fromName:'Bob Jones',      category:'Membership renewal',      sentiment:'urgent'},
  {subject:'How do I register for the conference?',      from:'member@society.org',    fromName:'Carol White',    category:'Event registration',      sentiment:'neutral'},
  {subject:'Payment failed — cannot complete renewal',   from:'treasurer@assoc.com',   fromName:'David Kim',      category:'Billing & payments',      sentiment:'urgent'},
  {subject:'Member records missing after import',        from:'admin@heritage.org',    fromName:'Emma Davis',     category:'Data & records issues',   sentiment:'urgent'},
  {subject:'Portal not loading on mobile',               from:'user@gallery.org',      fromName:'Frank Hall',     category:'Technical errors',        sentiment:'neutral'},
  {subject:'Request — bulk member import feature',       from:'admin@network.org',     fromName:'Grace Liu',      category:'Feature requests',        sentiment:'positive'},
  {subject:'Welcome email not received',                 from:'new@member.org',        fromName:'Henry Park',     category:'Email & comms issues',    sentiment:'neutral'},
  {subject:'Account locked after password reset',        from:'user@foundation.org',   fromName:'Irene Taylor',   category:'Login & access issues',   sentiment:'urgent'}
];

function getDemoData(period,fromDate,toDate){
  var take={'today':5,'7':10,'30':15,'90':15,'365':15}[period]||15;
  var maxD={'today':0,'7':7,'30':30,'90':90,'365':365}[period]||30;
  var now=new Date().toISOString();
  var emails=DEMO_POOL.slice(0,take).map(function(e,i){
    var dt=new Date(Date.now()-i*Math.floor(86400000*maxD/take));
    var rs=i%3===0?'replied':i%3===1?'waiting':'overdue';
    return Object.assign({},e,{date:dt.toISOString().split('T')[0],datetime:dt.toISOString(),conversationId:'conv-'+i,replyStatus:rs,replyHours:rs==='replied'?Math.floor(Math.random()*20)+1:null,hoursWaiting:Math.floor(Math.random()*48)});
  });
  var prevEmails=DEMO_POOL.slice(0,Math.max(1,take-4)).map(function(e,i){
    return Object.assign({},e,{date:daysAgoStr(maxD+i),datetime:new Date(Date.now()-(maxD+i)*86400000).toISOString(),replyStatus:'replied',replyHours:Math.floor(Math.random()*20)+1,hoursWaiting:0});
  });
  var categories=buildCategories(emails);
  var trend=buildTrend(emails,prevEmails);
  var responseStats=buildResponseStats(emails);
  var memberProfiles=buildMemberProfiles(emails);
  var painPoints=buildPainPoints(emails,categories);
  var insights=buildInsights(emails,categories,trend,period,responseStats);
  var faq=buildFAQ(emails,categories);
  return {source:'demo',period:period,total:emails.length,skipped:1,platform:8,categories:categories,emails:emails,trend:trend,heatmap:buildHeatmap(emails),weekly:buildWeeklyTrend(emails),insights:insights,faq:faq,responseStats:responseStats,memberProfiles:memberProfiles,painPoints:painPoints};
}

app.get('/',function(req,res){res.json({status:'ok',mailbox:MAILBOX,mode:(TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'live':'demo',slaHours:SLA_HOURS});});

app.get('/debug',async function(req,res){
  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET) return res.json({status:'no credentials'});
  try{var token=await getAccessToken();var r=await fetch('https://graph.microsoft.com/v1.0/users/'+MAILBOX,{headers:{Authorization:'Bearer '+token}});res.json({tokenOk:true,mailboxCheck:await r.json()});}
  catch(e){res.json({tokenOk:false,error:e.message});}
});

app.get('/emails',async function(req,res){
  var period  =req.query.period||'30';
  var fromDate=req.query.from||null;
  var toDate  =req.query.to||null;
  if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET) return res.json(getDemoData(period,fromDate,toDate));
  try{
    var token   =await getAccessToken();
    var now     =new Date().toISOString();
    var currFrom=fromDate?getCustomDate(fromDate):getFromDate(period);
    var currTo  =toDate?getCustomDate(toDate):null;
    var prevFrom=getPrevFromDate(period);
    console.log('Period:',period,'from:',currFrom,'to:',currTo||'now');
    var curr=await fetchEmailsForPeriod(token,currFrom,currTo);
    var prev=await fetchEmailsForPeriod(token,prevFrom,currFrom);
    console.log('Fetching sent items...');
    var sentItems=await fetchSentItems(token,prevFrom);
    var emailsWithReply=matchReplies(curr.emails,sentItems,now);
    var categories   =buildCategories(emailsWithReply);
    var trend        =buildTrend(emailsWithReply,prev.emails);
    var responseStats=buildResponseStats(emailsWithReply);
    var memberProfiles=buildMemberProfiles(emailsWithReply);
    var painPoints   =buildPainPoints(emailsWithReply,categories);
    var insights     =buildInsights(emailsWithReply,categories,trend,period,responseStats);
    var faq          =buildFAQ(emailsWithReply,categories);
    res.json({source:'live',period:period,total:emailsWithReply.length,skipped:curr.skipped,platform:curr.platform,categories:categories,emails:emailsWithReply,trend:trend,heatmap:buildHeatmap(emailsWithReply),weekly:buildWeeklyTrend(emailsWithReply),insights:insights,faq:faq,responseStats:responseStats,memberProfiles:memberProfiles,painPoints:painPoints});
  }catch(err){
    console.error('Error:',err.message);
    res.status(500).json({error:err.message});
  }
});

app.listen(PORT,function(){
  console.log('MA Support Backend running on port '+PORT);
  console.log('Mailbox: '+MAILBOX);
  console.log('SLA: '+SLA_HOURS+'h | Mode: '+((TENANT_ID&&CLIENT_ID&&CLIENT_SECRET)?'LIVE':'DEMO'));
});
