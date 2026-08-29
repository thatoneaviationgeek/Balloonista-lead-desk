(function(){
"use strict";
  var LEADS = [], app = document.getElementById('app');
  var filters = { agent:'All', fit:'All', status:'Open', q:'' };
  var FIT_ORDER = { High:0, Medium:1, Low:2 };

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function statusOf(l){ return l.status || 'New'; }

  function matches(l){
    if (filters.agent !== 'All' && l.agent !== filters.agent) return false;
    if (filters.fit !== 'All' && l.fit !== filters.fit) return false;
    var st = statusOf(l);
    if (filters.status === 'Open' && st !== 'New') return false;
    if (filters.status === 'Approved' && st !== 'Approved') return false;
    if (filters.status === 'Rejected' && st !== 'Rejected') return false;
    if (filters.q){
      var hay = (l.title+' '+l.what+' '+l.where+' '+l.contact+' '+l.role+' '+l.entity).toLowerCase();
      if (hay.indexOf(filters.q.toLowerCase()) === -1) return false;
    }
    return true;
  }
  function countBy(fn){ var n=0; for (var i=0;i<LEADS.length;i++) if (fn(LEADS[i])) n++; return n; }
  function chip(group, value, label, count){
    var on = filters[group] === value;
    return '<button class="chip" type="button" data-group="'+group+'" data-value="'+esc(value)+'" aria-pressed="'+on+'">'
      + esc(label) + (count == null ? '' : '<span class="c">'+count+'</span>') + '</button>';
  }
  function card(l){
    var st = statusOf(l), done = st !== 'New';
    var showAddr = l.address && l.address !== '—';
    var showEnt  = l.entity && l.entity !== '—';
    var gapC = /^GAP/.test(l.contact || '');
    return '<article class="card'+(done?' done':'')+'">'
      + '<div class="card-top"><h3>'+esc(l.title)+'</h3>'
        + '<span class="tag t-agent">'+esc(l.agent)+'</span>'
        + '<span class="tag t-'+String(l.fit).toLowerCase()+'">'+esc(l.fit)+' fit</span>'
        + (done ? '<span class="tag t-'+st.toLowerCase()+'">'+esc(st)+'</span>' : '')
      + '</div>'
      + '<p class="what">'+esc(l.what)+'</p>'
      + '<dl class="d">'
        + '<dt>Where</dt><dd>'+esc(l.where)+'</dd>'
        + '<dt>Contact</dt><dd'+(gapC?' class="gap"':'')+'>'+esc(l.contact)+'</dd>'
        + (l.role && l.role !== '—' ? '<dt>Role / route</dt><dd>'+esc(l.role)+'</dd>' : '')
        + (showEnt ? '<dt>Hiring entity</dt><dd>'+esc(l.entity)+'</dd>' : '')
        + (showAddr ? '<dt>Write to</dt><dd>'+esc(l.address)+'</dd>' : '')
        + '<dt>Source</dt><dd><a href="'+esc(l.src)+'" target="_blank" rel="noopener noreferrer">View source</a></dd>'
      + '</dl></article>';
  }
  var AGENT_LABEL = { Film:'Film & TV', Retail:'Retail', Events:'Events', Channel:'Channel' };
  function agentChips(){
    var seen = [], i;
    for (i = 0; i < LEADS.length; i++){
      if (seen.indexOf(LEADS[i].agent) === -1) seen.push(LEADS[i].agent);
    }
    seen.sort();
    return seen.map(function(a){
      return chip('agent', a, AGENT_LABEL[a] || a, countBy(function(l){ return l.agent === a; }));
    }).join('');
  }

  function render(){
    var shown = LEADS.filter(matches).sort(function(a,b){
      var d = FIT_ORDER[a.fit] - FIT_ORDER[b.fit];
      return d !== 0 ? d : String(a.title).localeCompare(String(b.title));
    });
    var open = countBy(function(l){ return statusOf(l) === 'New'; });
    var appr = countBy(function(l){ return statusOf(l) === 'Approved'; });
    var high = countBy(function(l){ return l.fit === 'High' && statusOf(l) === 'New'; });
    var html = '<div class="stats">'
      + '<div class="stat"><div class="n">'+LEADS.length+'</div><div class="l">Leads found</div></div>'
      + '<div class="stat flag"><div class="n">'+high+'</div><div class="l">High fit, unreviewed</div></div>'
      + '<div class="stat"><div class="n">'+open+'</div><div class="l">Awaiting review</div></div>'
      + '<div class="stat"><div class="n">'+appr+'</div><div class="l">Approved</div></div>'
      + '</div>'
      + '<div class="controls">'
      + '<div class="row"><span class="lbl">Scanner</span>'
        + chip('agent','All','All', LEADS.length)
        + agentChips()
      + '</div>'
      + '<div class="row"><span class="lbl">Fit</span>'
        + chip('fit','All','All') + chip('fit','High','High')
        + chip('fit','Medium','Medium') + chip('fit','Low','Low')
      + '</div>'
      + '<div class="row"><span class="lbl">Status</span>'
        + chip('status','Open','To review') + chip('status','Approved','Approved')
        + chip('status','Rejected','Rejected') + chip('status','All','Everything')
        + '<input type="search" id="q" placeholder="Search name, contact, place…" value="'+esc(filters.q)+'" aria-label="Search leads">'
      + '</div></div>'
      + '<div class="list">'
      + (shown.length ? shown.map(card).join('') : '<p class="empty">Nothing matches those filters.</p>')
      + '</div>';
    app.innerHTML = html;
    var q = document.getElementById('q');
    if (q && filters.q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }
  app.addEventListener('click', function(e){
    var c = e.target.closest('.chip');
    if (c){ filters[c.dataset.group] = c.dataset.value; render(); }
  });
  app.addEventListener('input', function(e){
    if (e.target.id === 'q'){ filters.q = e.target.value; render(); }
  });

  fetch('./' + (document.body.dataset.leads || 'leads-uk.json') + '?v=' + Date.now())
    .then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
    .then(function(data){
      LEADS = data.leads || [];
      var u = document.getElementById('m-updated');
      if (u) u.textContent = 'Data refreshed ' + (data.updated || 'unknown');
      render();
    })
    .catch(function(){
      app.innerHTML = '<div class="banner"><strong>Could not load the leads.</strong> '
        + 'If you are opening this file directly from your computer, the browser blocks it reading leads.json. '
        + 'Serve the folder instead (<code>npx serve</code>) or open the deployed link.</div>';
    });
})();
