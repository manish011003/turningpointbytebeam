/*
 * SuprFleet Turning Point v2: user interface.
 *
 * One in-memory case, five routes (#home plus four stages). This file never does cost
 * arithmetic: every total, status and sensitivity figure comes from TPEngine.compute().
 * Layout code below only maps engine totals to chart positions.
 */
(function () {
  'use strict';

  var E = window.TPEngine, P = window.TPPresets, X = window.TPExplain;

  var STAGES = ['start', 'quote', 'assumptions', 'compare'];
  var STAGE = {
    start:       { n: 1, name: 'Start',          title: 'Start a decision',   next: 'Continue to repair quote' },
    quote:       { n: 2, name: 'Repair quote',   title: 'Review repair quote', next: 'Continue to assumptions' },
    assumptions: { n: 3, name: 'Assumptions',    title: 'Complete assumptions', next: 'View comparison' },
    compare:     { n: 4, name: 'Compare',        title: 'Compare options',    next: '' }
  };

  var state = null;        // current case, shaped like a preset
  var mode = null;         // 'example' | 'blank' | null
  var exampleId = 'guided';
  var guide = { dismissed: false, done: {}, base: null };
  var pendingAfter = null; // run after the next route render (used by jump links)
  var cache = { stepper: '', guide: '', gaps: '' };

  // ---------- helpers ----------

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, rootEl) { return (rootEl || document).querySelector(sel); }
  function $all(sel, rootEl) { return Array.prototype.slice.call((rootEl || document).querySelectorAll(sel)); }
  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o ? o[k] : undefined; }, obj); }
  function setPath(obj, path, value) {
    var keys = path.split('.'), last = keys.pop();
    keys.reduce(function (o, k) { return o[k]; }, obj)[last] = value;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function result() { return E.compute(state); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function periodText(r) { return r.months.status === 'ok' ? plural(r.months.value, 'month', 'months') : 'not set'; }

  // Indian digit grouping for display only. The stored string is never changed.
  function fmtAmount(raw) {
    var p = E.parseAmount(raw);
    if (p.value === undefined) return raw === null || raw === undefined ? '' : String(raw);
    return p.value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function rangeOf(r, key) {
    var st = r.fields[key];
    return st.status === 'ok' ? X.range(st.low, st.high) : 'not entered';
  }
  function vehicleName() { return (state.vehicles.current.type || '').trim() || 'Vehicle not named'; }

  var SUBTRACTED = E.PATHS.keep.sub.concat(E.PATHS.sell.sub, E.PATHS.scrap.sub);
  var STATUS_TEXT = { ok: 'Entered', missing: 'Missing', invalid: 'Check value', unreviewed: 'Unreviewed' };

  function unitText(key) {
    var m = E.readMonths(state.months);
    var span = m.status === 'ok' ? m.value + '-month period' : 'whole period';
    switch (key) {
      case 'curRun': case 'newRun': return '₹ per month';
      case 'curAddRep': case 'newAddRep': return '₹ in total over the ' + span;
      case 'curEnd': case 'newEnd': return '₹ value at the end of the ' + span;
      case 'newPrice': return '₹ paid once';
      case 'repair': return '₹ once, for the whole repair';
      default: return '₹ received once';
    }
  }

  function confirmations() {
    return [
      { label: 'Replacement duty and capacity', target: 'duty', ok: !!state.dutyConfirmed },
      { label: 'Sale eligibility', target: 'elig-sale-yes', ok: state.disposal.sale.eligibility === 'owner_confirmed' },
      { label: 'Scrap eligibility', target: 'elig-scrap-yes', ok: state.disposal.scrap.eligibility === 'owner_confirmed' }
    ];
  }

  function fixTarget(m) {
    if (m.key === 'months') return 'f-months';
    if (m.status === 'unreviewed') return 'proposal';
    if (m.reason === 'price type not recorded') return E.FIELDS[m.key].disposal === 'sale' ? 'pt-sale' : 'pt-scrap';
    return 'f-' + m.key + '-low';
  }
  function routeFor(id) {
    if (id === 'f-months' || id === 'duty' || /^t-vehicles/.test(id)) return 'start';
    if (id === 'proposal' || id === 'extract' || /^f-repair-/.test(id)) return 'quote';
    return 'assumptions';
  }
  function reasonTarget(text) {
    if (/duty/i.test(text)) return 'duty';
    return /^Sale/.test(text) ? 'elig-sale-yes' : 'elig-scrap-yes';
  }

  // ---------- state ----------

  function blankState() {
    var fields = {};
    Object.keys(E.FIELDS).forEach(function (k) { fields[k] = { fixed: true, low: '', high: '' }; });
    function side() { return { type: '', capacity: '', duty: '', km: '' }; }
    function disp() { return { priceType: '', source: '', date: '', deductions: '', eligibility: 'unconfirmed' }; }
    return {
      months: '', vehicleKind: null,
      vehicles: { current: side(), replacement: side() },
      dutyConfirmed: false, fields: fields,
      repairMeta: { workshop: '', date: '' }, pastSpending: '',
      disposal: { sale: disp(), scrap: disp() },
      quote: { text: '', proposal: null }
    };
  }

  // Truck example where the owner still has to review and accept the quote themselves.
  function guidedTruck() {
    var s = P.PRESETS.truck_complete.build();
    s.fields.repair = { fixed: true, low: '', high: '' };
    s.repairMeta = { workshop: '', date: '' };
    s.quote.proposal = null;
    return s;
  }
  var EXAMPLES = [{ id: 'guided', label: 'Truck: guided start (quote not yet accepted)', build: guidedTruck }]
    .concat(Object.keys(P.PRESETS).filter(function (id) { return id !== 'blank_truck'; }).map(function (id) {
      return { id: id, label: P.PRESETS[id].label, build: P.PRESETS[id].build };
    }));
  function exampleById(id) { return EXAMPLES.filter(function (e) { return e.id === id; })[0]; }

  function loadExample(id) {
    exampleId = id;
    mode = 'example';
    state = exampleById(id).build();
    guide.base = null;
    cache = { stepper: '', guide: '', gaps: '' };
  }
  function startExample() {
    guide = { dismissed: false, done: {}, base: null };
    loadExample('guided');
    navigate('start');
  }
  function startBlank() {
    mode = 'blank';
    state = blankState();
    guide = { dismissed: true, done: {}, base: null };
    cache = { stepper: '', guide: '', gaps: '' };
    navigate('start');
  }

  // ---------- quote model (all derived from state, so nothing goes stale) ----------

  function proposalItem(key) {
    var p = state.quote.proposal;
    return p && p.items ? p.items.filter(function (i) { return i.key === key; })[0] : null;
  }
  function extractedItem(key) {
    var q = state.vehicleKind && P.QUOTES[state.vehicleKind];
    return q ? q.proposal.filter(function (i) { return i.key === key; })[0] : null;
  }
  // 'none' | 'pending' | 'accepted' | 'manual'. 'edited' is true when the live values differ from what was accepted.
  function quoteInfo(r) {
    var p = state.quote.proposal;
    var repairOk = r.fields.repair.status === 'ok';
    if (p && p.status === 'pending') return { kind: 'pending' };
    if (p && p.status === 'accepted') {
      var amt = proposalItem('amount'), ws = proposalItem('workshop'), dt = proposalItem('date');
      var accepted = E.parseAmount(amt && amt.value);
      var meta = state.repairMeta || {};
      var edited = !(repairOk && accepted.value !== undefined && r.fields.repair.low === accepted.value && r.fields.repair.high === accepted.value) ||
        (ws && meta.workshop !== ws.value) || (dt && meta.date !== dt.value);
      return { kind: 'accepted', edited: !!edited, editedBefore: !!p.edited };
    }
    if (repairOk || (state.repairMeta && (state.repairMeta.workshop || state.repairMeta.date))) return { kind: 'manual' };
    return { kind: 'none' };
  }
  function quoteOrigin(q) {
    if (q.kind === 'accepted') {
      if (q.edited) return 'Edited by owner since simulated extraction';
      return q.editedBefore ? 'Accepted after owner edits to the extracted values' : 'Accepted from simulated extraction';
    }
    return q.kind === 'manual' ? 'Entered by owner' : '';
  }

  // ---------- shared form pieces ----------

  function more(title, text) {
    return text ? '<details class="more"><summary>' + esc(title) + '</summary><p>' + esc(text) + '</p></details>' : '';
  }

  function amtInput(key, side, label, ctx) {
    var f = state.fields[key];
    var attr = side === 'low' ? 'data-low' : 'data-high';
    return '<label class="mini' + (side === 'high' ? ' hi' : '') + '"><span class="mini-label">' + label + '</span>' +
      '<span class="amt"><span class="cur" aria-hidden="true">₹</span>' +
      '<input id="f-' + key + '-' + side + '" inputmode="decimal" autocomplete="off" placeholder="unknown" data-amt="1" ' + attr + '="' + key + '"' +
      ' aria-label="' + esc(ctx + ', ' + (side === 'high' ? 'high' : (f.fixed ? 'amount' : 'low')) + ', rupees') + '"' +
      ' value="' + esc(fmtAmount(side === 'low' ? f.low : f.high)) + '"></span></label>';
  }

  // One amount: a single exact figure by default, with a switch to enter a low to high range.
  function moneyField(key, ctx, hint) {
    var f = state.fields[key];
    var monthly = !!E.FIELDS[key].monthly;
    return '<div class="money' + (f.fixed ? ' is-fixed' : '') + '" data-money="' + key + '">' +
      '<div class="amts">' + amtInput(key, 'low', f.fixed ? 'Amount' : 'Low', ctx) + amtInput(key, 'high', 'High', ctx) + '</div>' +
      '<p class="unit" data-unit="' + key + '">' + esc(unitText(key)) + '</p>' +
      '<label class="range-toggle"><input type="checkbox" data-range="' + key + '"' + (f.fixed ? '' : ' checked') +
        ' aria-label="' + esc('Enter a range for ' + ctx) + '"> Enter a range</label>' +
      (monthly ? '<p class="calc" data-calc="' + key + '"></p>' : '') +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
      '<p class="hint rnote" data-rnote="' + key + '"></p>' +
      '<p class="msg" data-msg="' + key + '" aria-live="polite"></p>' +
      '</div>';
  }

  function textInput(path, label, placeholder) {
    var id = 't-' + path.replace(/\./g, '-');
    return '<label class="text-field" for="' + id + '"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" data-text="' + path + '" value="' + esc(getPath(state, path)) + '" placeholder="' + esc(placeholder || '') + '"></label>';
  }

  function badge(cls, text) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }
  function toneOf(cls) { return cls.replace('badge-', 'tone-'); }

  // ---------- shell: header controls, stepper, pager ----------

  function renderControls() {
    var c = $('#controls');
    if (!mode) { c.hidden = true; c.innerHTML = ''; return; }
    c.hidden = false;
    if (mode === 'example') {
      c.innerHTML = '<span class="modechip">Fictional example</span>' +
        '<label for="example" class="sr-only">Example case</label>' +
        '<select id="example">' + EXAMPLES.map(function (e) {
          return '<option value="' + e.id + '"' + (e.id === exampleId ? ' selected' : '') + '>' + esc(e.label) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="btn btn-quiet btn-sm" data-action="reset">Reset example</button>' +
        (guide.dismissed ? '<button type="button" class="btn btn-quiet btn-sm" data-action="guide-show">Show walkthrough</button>' : '');
    } else {
      c.innerHTML = '<span class="modechip">Blank decision</span>' +
        '<button type="button" class="btn btn-quiet btn-sm" data-action="reset">Clear all inputs</button>';
    }
  }

  function stageStatuses(r) {
    var q = quoteInfo(r);
    var out = {};
    var vOk = state.vehicles.current.type.trim() && state.vehicles.replacement.type.trim();
    if (r.months.status !== 'ok') out.start = ['Period needed', 'tone-bad'];
    else if (!vOk) out.start = ['Add vehicles', 'tone-warn'];
    else if (!state.dutyConfirmed) out.start = ['Confirm duty', 'tone-warn'];
    else out.start = ['Complete', 'tone-ok'];

    if (q.kind === 'pending') out.quote = ['Review needed', 'tone-warn'];
    else if (q.kind === 'accepted' && r.fields.repair.status === 'ok') out.quote = [q.edited ? 'Accepted, edited' : 'Accepted', 'tone-ok'];
    else if (r.fields.repair.status === 'ok') out.quote = ['Entered', 'tone-ok'];
    else if (r.fields.repair.status === 'invalid') out.quote = ['Check value', 'tone-bad'];
    else out.quote = ['Not set', 'tone-bad'];

    var gaps = missingAssumptions(r);
    var unc = confirmations().slice(1).filter(function (c) { return !c.ok; });
    if (gaps.length) out.assumptions = [gaps.length + ' missing', 'tone-bad'];
    else if (unc.length) out.assumptions = ['Confirm eligibility', 'tone-warn'];
    else out.assumptions = ['Complete', 'tone-ok'];

    out.compare = [KIND_LABEL[r.result.kind], KIND_TONE[r.result.kind]];
    return out;
  }

  var ASSUMPTION_KEYS = ['curRun', 'curAddRep', 'curEnd', 'newPrice', 'newRun', 'newAddRep', 'newEnd', 'saleNet', 'scrapNet'];
  function missingAssumptions(r) {
    return ASSUMPTION_KEYS.filter(function (k) { return r.fields[k].status !== 'ok'; }).map(function (k) {
      return { key: k, status: r.fields[k].status, reason: r.fields[k].message, label: E.FIELDS[k].label };
    });
  }

  function renderStepper(r, route) {
    var nav = $('#stepper');
    if (route === 'home') { nav.hidden = true; return; }
    nav.hidden = false;
    var st = stageStatuses(r);
    var html = '<ol>' + STAGES.map(function (id) {
      var here = id === route;
      return '<li><a href="#' + id + '"' + (here ? ' aria-current="step"' : '') + ' class="' + (here ? 'is-here' : '') + '">' +
        '<span class="sn" aria-hidden="true">' + STAGE[id].n + '</span>' +
        '<span class="st"><span class="sname">' + STAGE[id].name + '</span>' +
        '<span class="sstat ' + st[id][1] + '">' + esc(st[id][0]) + '</span></span></a></li>';
    }).join('') + '</ol>';
    var key = route + html;
    if (cache.stepper !== key) { nav.innerHTML = html; cache.stepper = key; }
  }

  function pager(route) {
    var i = STAGES.indexOf(route);
    var back = i === 0 ? '<a class="btn btn-quiet" href="#home">Back to start screen</a>'
      : '<a class="btn btn-quiet" href="#' + STAGES[i - 1] + '">Back: ' + STAGE[STAGES[i - 1]].name.toLowerCase() + '</a>';
    var next = i < STAGES.length - 1
      ? '<a class="btn btn-primary" href="#' + STAGES[i + 1] + '" data-next>' + STAGE[route].next + '</a>'
      : '<a class="btn btn-primary" href="#assumptions">Edit assumptions</a>';
    return '<div class="pager">' + back + next + '</div>';
  }

  function stageHead(route, sub) {
    var s = STAGE[route];
    return '<header class="page-head"><p class="kicker">Stage ' + s.n + ' of 4 · ' + s.name + '</p>' +
      '<h1 id="h1" tabindex="-1">' + s.title + '</h1>' + (sub ? '<p class="lede">' + sub + '</p>' : '') + '</header>';
  }

  // ---------- home ----------

  function renderHome() {
    var cont = state
      ? '<div class="resume"><span>You have a ' + (mode === 'example' ? 'fictional example' : 'blank decision') + ' in progress.</span>' +
        '<a class="btn btn-primary" href="#start">Continue current decision</a></div>'
      : '';
    return '<header class="page-head home-head"><h1 id="h1" tabindex="-1">Compare three cost ranges for one vehicle</h1>' +
      '<p class="lede">Repair and keep, replace and sell whole, or replace and scrap. You enter the figures; ' +
      'Turning Point totals them as ranges and shows where the evidence is thin. It does not tell you what to do.</p></header>' + cont +
      '<div class="start-cards">' +
        '<section class="card start-card"><h2>Explore a fictional example</h2>' +
          '<p>A truck case with invented figures. An optional walkthrough shows how to review a quote, edit an input and see the ranges move.</p>' +
          '<button type="button" class="btn btn-primary" data-action="start-example">Explore a fictional example</button></section>' +
        '<section class="card start-card"><h2>Start a blank decision</h2>' +
          '<p>Nothing is pre-filled and no confirmations are set. You can still try the simulated quote extraction with a fictional sample.</p>' +
          '<button type="button" class="btn btn-primary btn-alt" data-action="start-blank">Start a blank decision</button></section>' +
      '</div>' +
      '<ol class="journey" aria-label="The four stages"><li><strong>Start</strong> vehicle, duty, period</li>' +
        '<li><strong>Repair quote</strong> review and accept</li><li><strong>Assumptions</strong> costs and disposal evidence</li>' +
        '<li><strong>Compare</strong> three ranges</li></ol>';
  }

  // ---------- stage 1: start ----------

  function vehicleTable() {
    var rows = [['type', 'Vehicle type'], ['capacity', 'Capacity'], ['duty', 'Intended duty'], ['km', 'Expected use']];
    var sides = [['current', 'Current vehicle'], ['replacement', 'Replacement candidate']];
    return '<div class="table-wrap"><table class="veh"><caption class="sr-only">Current vehicle and replacement candidate details</caption>' +
      '<thead><tr><th scope="col"><span class="sr-only">Detail</span></th><th scope="col">Current vehicle</th><th scope="col">Replacement candidate</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th scope="row">' + r[1] + '</th>' + sides.map(function (s) {
          return '<td data-label="' + s[1] + '"><input aria-label="' + s[1] + ': ' + r[1] + '" data-veh="vehicles.' + s[0] + '.' + r[0] +
            '" value="' + esc(state.vehicles[s[0]][r[0]]) + '"></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderStart() {
    var pre = mode === 'example' && confirmations().some(function (c) { return c.ok; });
    return stageHead('start', 'Which vehicle, what work must it do, and over how long are you comparing?') +
      (pre ? '<p class="note-demo">Fictional example: the owner confirmations (duty, sale and scrap eligibility) are pre-set for this demo. A blank decision starts unconfirmed.</p>' : '') +
      '<section class="card"><h2>Comparison period</h2>' +
        '<label class="text-field narrow" for="f-months"><span>Both vehicles are costed over this same period</span>' +
        '<span class="amt"><input id="f-months" inputmode="numeric" data-months="1" value="' + esc(state.months) + '" placeholder="1 to ' + E.MAX_MONTHS + '"><span class="suf">months</span></span></label>' +
        '<p class="msg" data-msg="months" aria-live="polite"></p></section>' +
      '<section class="card"><h2>Vehicles and intended duty</h2>' + vehicleTable() +
        '<label class="check" for="duty"><input type="checkbox" id="duty" data-duty="1"' + (state.dutyConfirmed ? ' checked' : '') + '> ' +
        '<span>I confirm the replacement candidate can do the same duty and carry the same capacity as the current vehicle.</span></label>' +
        '<p class="hint">Your statement; Turning Point does not judge suitability. Editing the vehicle details clears it.</p>' +
        '<p class="msg" id="duty-note" aria-live="polite"></p>' +
        more('Why this matters', 'Without this confirmation, both replacement options stay exploratory and are never highlighted as lower.') +
      '</section>' + pager('start');
  }

  // ---------- stage 2: repair quote ----------

  function flowSteps(p) {
    var cur = !p || p.status === 'discarded' ? 1 : (p.status === 'pending' ? 3 : 4);
    var names = ['Sample quote', 'Simulated extraction', 'Owner review'];
    return '<ol class="flow" aria-label="Quote review steps">' + names.map(function (n, i) {
      var done = i + 1 < cur || cur === 4, here = i + 1 === cur;
      return '<li class="' + (done ? 'is-done' : '') + (here ? ' is-here' : '') + '"' + (here ? ' aria-current="step"' : '') + '>' +
        '<span class="flow-n" aria-hidden="true">' + (done ? '✓' : (i + 1)) + '</span>' + n + (done ? '<span class="sr-only"> (done)</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  function proposalTable(p) {
    return '<div class="proposal" id="proposal" tabindex="-1">' +
      '<p class="proposal-title">' + badge('badge-warn', 'Unreviewed') + ' Check each value against the source text, edit if needed, then accept.</p>' +
      '<div class="table-wrap"><table class="prop"><caption class="sr-only">Proposed fields from the sample quote</caption><thead><tr><th scope="col">Field</th><th scope="col">Proposed value</th><th scope="col">Source text in quote</th></tr></thead><tbody>' +
      p.items.map(function (it, i) {
        var valueCell = it.unsupported ? '<span class="muted">empty</span>'
          : '<input aria-label="' + esc(it.label) + '" data-prop="' + i + '" value="' + esc(it.value) + '">';
        var srcCell = it.unsupported ? '<span class="muted">' + esc(it.unsupported) + '</span>' : '<code>' + esc(it.sourceText) + '</code>';
        return '<tr><th scope="row">' + esc(it.label) + '</th><td data-label="Proposed value">' + valueCell + '</td><td data-label="Source text">' + srcCell + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="msg" id="prop-msg" aria-live="polite"></p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary" id="prop-accept">Accept these values</button>' +
      '<button type="button" class="btn btn-quiet" id="prop-discard">Discard proposal</button></div></div>';
  }

  function repairEntry() {
    return moneyField('repair', 'Repair quote used in the comparison', 'A workshop cost estimate, not a final bill.') +
      '<div class="two-col">' + textInput('repairMeta.workshop', 'Workshop', 'who quoted') + textInput('repairMeta.date', 'Quote date', 'YYYY-MM-DD') + '</div>';
  }

  function sourcePanel() {
    var p = state.quote.proposal;
    var rows = ['amount', 'workshop', 'date'].map(function (k) {
      var it = extractedItem(k) || proposalItem(k);
      var label = it ? it.label : k;
      var src = it ? '<code>' + esc(it.sourceText) + '</code>' : '';
      var ext = it ? esc(k === 'amount' ? fmtAmount(it.value) : it.value) : '';
      return '<tr><th scope="row">' + esc(label) + '</th><td data-label="Extracted from sample">' + ext + '</td>' +
        '<td data-label="Current value" data-cur="' + k + '"></td><td data-label="Source text">' + src + '</td></tr>';
    }).join('');
    return '<div id="quote-source" hidden><div class="table-wrap"><table class="prop src"><caption class="sr-only">Extracted values compared with current values</caption>' +
      '<thead><tr><th scope="col">Field</th><th scope="col">Extracted</th><th scope="col">Current</th><th scope="col">Source text</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<details class="more"><summary>Full sample quote text</summary><pre class="quote">' + esc(state.quote.text) + '</pre></details>' +
      '<p class="hint">Simulated extraction: fixed demo fields. Nothing was uploaded or read, and no model was called.</p></div>';
  }

  function renderQuote() {
    var p = state.quote.proposal;
    var r = result();
    var q = quoteInfo(r);
    var body;
    if (!state.quote.text && q.kind !== 'accepted') {
      body = '<section class="card"><h2>Sample quote</h2>' +
        '<p>This decision has no quote yet. Load a fictional sample to try the simulated extraction, or enter the repair cost yourself.</p>' +
        '<div class="btn-row"><button type="button" class="btn" data-sample="truck">Load fictional truck quote</button>' +
        '<button type="button" class="btn" data-sample="van">Load fictional van quote</button></div></section>' +
        '<section class="card"><h2>Or enter the quote yourself</h2>' + repairEntry() + '</section>';
    } else if (p && p.status === 'accepted') {
      body = '<section class="card accepted" id="quote-accepted" tabindex="-1">' +
        '<div class="accepted-row"><div><p class="acc-badges">' + badge('badge-ok', 'Accepted') + ' <span data-quote-flag></span></p>' +
        '<p class="acc-sum" data-quote-summary></p><p class="hint" data-quote-origin></p></div>' +
        '<div class="btn-row tight"><button type="button" class="btn btn-quiet" data-action="quote-edit" aria-expanded="false" aria-controls="quote-edit-fields">Edit</button>' +
        '<button type="button" class="btn btn-quiet" data-action="quote-source" aria-expanded="false" aria-controls="quote-source">View source</button></div></div>' +
        '<div id="quote-edit-fields" hidden>' + repairEntry() + '</div>' + sourcePanel() + '</section>';
    } else {
      body = '<section class="card">' + flowSteps(p) +
        '<details class="more quote-text" open><summary>Sample quote text</summary><pre class="quote">' + esc(state.quote.text) + '</pre></details>' +
        (p && p.status === 'discarded' ? '<p class="muted">Proposal discarded. Run the extraction again, or enter the repair quote yourself below.</p>' : '') +
        (p && p.status === 'pending' ? proposalTable(p)
          : '<div class="btn-row"><button type="button" class="btn btn-primary" id="extract">Run simulated extraction</button></div>') +
        '</section>' +
        (p && p.status === 'pending' ? '' : '<section class="card"><h2>Or enter the quote yourself</h2>' + repairEntry() + '</section>');
    }
    return stageHead('quote', 'Check what the simulated extraction proposes before any amount is used.') +
      '<p class="sim-note">' + badge('badge-demo', 'Simulated demo') + ' Fictional sample quote with fixed demo fields. Nothing is uploaded, read or sent to a model.</p>' +
      body + pager('quote');
  }

  // ---------- stage 3: assumptions ----------

  function costRow(label, role, keys, hint, moreTitle, moreText) {
    function cell(col, key, ctx) {
      return '<div class="acell" data-col="' + col + '">' + (key ? moneyField(key, ctx) : '<p class="na">Not applicable</p>') + '</div>';
    }
    return '<div class="arow"><div class="alabel"><h3>' + label + '</h3><p class="role">' + role + '</p>' +
      (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') + more(moreTitle, moreText) + '</div>' +
      cell('Repair and keep', keys[0], label + ', current vehicle') + cell('Replace', keys[1], label + ', replacement') + '</div>';
  }

  function disposalBlock(side) {
    var d = state.disposal[side];
    var key = side === 'sale' ? 'saleNet' : 'scrapNet';
    var title = side === 'sale' ? 'Sell whole' : 'Scrap through an authorised facility';
    var opts = '<option value="">Not recorded</option>' + Object.keys(E.PRICE_TYPES).map(function (k) {
      return '<option value="' + k + '"' + (d.priceType === k ? ' selected' : '') + '>' + E.PRICE_TYPES[k] + '</option>';
    }).join('');
    var elig = [['unconfirmed', 'Unconfirmed', 'no'], ['owner_confirmed', 'Owner confirmed', 'yes']].map(function (o) {
      return '<label class="radio"><input type="radio" id="elig-' + side + '-' + o[2] + '" name="elig-' + side + '" data-elig="' + side + '" value="' + o[0] + '"' +
        (d.eligibility === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>';
    }).join('');
    return '<section class="card dispo"><div class="sub-head"><h3>' + title + '</h3><div class="chips" data-chips="' + side + '"></div></div>' +
      '<p class="role">Subtracts from the replacement options only</p>' +
      moneyField(key, 'Net proceeds, ' + (side === 'sale' ? 'sale' : 'scrap'), 'After known deductions. Leave blank if unknown; blank is never treated as zero.') +
      '<label class="text-field" for="pt-' + side + '"><span>Price type</span><select id="pt-' + side + '" data-ptype="' + side + '">' + opts + '</select></label>' +
      '<p class="hint evidence" data-evidence="' + side + '"></p>' +
      '<div class="two-col">' + textInput('disposal.' + side + '.source', 'Source', 'who gave or published the figure') +
        textInput('disposal.' + side + '.date', 'Date', 'YYYY-MM-DD') + '</div>' +
      textInput('disposal.' + side + '.deductions', 'Known deductions (note)', 'for example towing, brokerage') +
      '<fieldset class="elig"><legend>Eligibility to ' + (side === 'sale' ? 'sell' : 'scrap') + '</legend>' + elig +
      '<p class="hint">Your statement only: not legal approval, and not checked by Turning Point.' +
        (side === 'scrap' ? ' Scrapping would go through an authorised facility, subject to its own checks.' : '') + '</p></fieldset></section>';
  }

  function renderAssumptions() {
    var run = 'Fuel or energy, driver, insurance, tyres.';
    return stageHead('assumptions', 'Costs for each option, then the evidence behind what the current vehicle would fetch.') +
      '<div id="gaps"></div>' +
      '<section class="card"><h2>Costs over the comparison period</h2>' +
      '<div class="arows"><div class="arow arow-head" aria-hidden="true"><span></span><span>Repair and keep</span><span>Replace</span></div>' +
      costRow('Running costs', 'Adds to cost · entered per month', ['curRun', 'newRun'], run, 'What counts as running costs',
        'Exclude repairs, depreciation and purchase costs, so nothing is counted twice. The monthly figure is multiplied by the comparison period.') +
      costRow('Additional repairs', 'Adds to cost · whole period', ['curAddRep', 'newAddRep'], 'Repairs expected beyond the quote (current) or during the period (replacement).') +
      costRow('End value', 'Subtracts · value at end of period', ['curEnd', 'newEnd'], 'Estimate both the same way.') +
      costRow('Replacement cash price', 'Adds to cost · paid once', [null, 'newPrice'], 'From a dealer quote. Cash purchase only.') +
      '<div class="arow"><div class="alabel"><h3>Repair quote</h3><p class="role">Adds to cost · paid once</p></div>' +
        '<div class="acell" data-col="Repair and keep"><p class="ro-val" data-ro="repair"></p>' +
        '<a class="btn btn-quiet btn-sm" href="#quote">Edit repair quote</a></div>' +
        '<div class="acell" data-col="Replace"><p class="na">Not applicable</p></div></div>' +
      '</div></section>' +
      '<h2 class="section-h">Disposal evidence for the current vehicle</h2>' +
      '<p class="hint section-hint">Sale and scrap are separate alternatives. Each feeds only its own option and they are never added together. Turning Point does not generate valuations.</p>' +
      '<div class="grid-2">' + disposalBlock('sale') + disposalBlock('scrap') + '</div>' +
      '<details class="card more history"><summary>Optional: past repair spending (history only, not in any total)</summary>' +
        '<label class="text-field narrow" for="t-pastSpending"><span>Past repair spending (INR)</span>' +
        '<span class="amt"><span class="cur" aria-hidden="true">₹</span><input id="t-pastSpending" inputmode="decimal" data-amt="1" data-text="pastSpending" value="' + esc(fmtAmount(state.pastSpending)) + '" placeholder="optional"></span></label>' +
        '<p class="hint">Shown for context only. It is never added to a forward cost.</p></details>' +
      pager('assumptions');
  }

  function gapsHtml(r) {
    var gaps = missingAssumptions(r);
    var unc = confirmations().slice(1).filter(function (c) { return !c.ok; });
    if (r.fields.repair.status !== 'ok') {
      gaps.unshift({ key: 'repair', status: r.fields.repair.status, reason: r.fields.repair.message, label: E.FIELDS.repair.label });
    }
    if (!gaps.length && !unc.length) return '<p class="allset">' + badge('badge-ok', 'All inputs entered and confirmed') + '</p>';
    var html = '<section class="card gaps"><h2>Still needed</h2><p class="hint">You can view the comparison now; missing items show as missing and are never treated as zero.</p><ul>';
    gaps.forEach(function (m) {
      html += '<li><button type="button" class="link" data-jump="' + fixTarget(m) + '">' + esc(m.label) + '</button> <span class="muted">' +
        (m.status === 'unreviewed' ? 'unreviewed' : esc(m.reason)) + '</span></li>';
    });
    unc.forEach(function (c) {
      html += '<li><button type="button" class="link" data-jump="' + c.target + '">' + esc(c.label) + '</button> <span class="muted">not confirmed by owner</span></li>';
    });
    return html + '</ul></section>';
  }

  // ---------- stage 4: compare ----------

  var KIND_LABEL = {
    clear: 'Ranges separate', overlap: 'Ranges overlap', incomplete: 'Incomplete', unconfirmed: 'Exploratory',
    unreviewed: 'Quote unreviewed', horizon: 'Period needed'
  };
  var KIND_TONE = {
    clear: 'tone-ok', overlap: 'tone-info', incomplete: 'tone-bad', unconfirmed: 'tone-warn', unreviewed: 'tone-warn', horizon: 'tone-bad'
  };

  function statusBlock(r) {
    var res = r.result, list = E.PATH_ORDER.map(function (id) { return r.paths[id]; });
    var names = function (arr) { return arr.map(function (p) { return p.label; }).join(' and '); };
    var detail, action = '';
    switch (res.kind) {
      case 'clear':
        detail = 'The whole range of that option sits below the other two. This compares the figures entered; it is not advice to repair, buy, sell or scrap.'; break;
      case 'overlap':
        detail = 'At least two ranges overlap, so the figures entered do not separate the options.'; break;
      case 'incomplete':
        detail = names(list.filter(function (p) { return !p.complete; })) + ' ' + (list.filter(function (p) { return !p.complete; }).length > 1 ? 'are' : 'is') + ' missing inputs. Other totals are shown where complete.';
        action = '<a class="btn btn-quiet btn-sm" href="#assumptions">Complete missing inputs</a>'; break;
      case 'unconfirmed':
        detail = 'Totals are shown, but ' + names(list.filter(function (p) { return !p.confirmed; })) + ' ' + (list.filter(function (p) { return !p.confirmed; }).length > 1 ? 'are' : 'is') + ' not confirmed by the owner, so no option is highlighted.'; break;
      case 'unreviewed':
        detail = 'Accept or edit the proposed quote values before the amount is used.';
        action = '<a class="btn btn-quiet btn-sm" href="#quote">Review quote</a>'; break;
      default:
        detail = 'Enter a comparison period of 1 to ' + E.MAX_MONTHS + ' months to see totals.';
        action = '<a class="btn btn-quiet btn-sm" href="#start">Set period</a>';
    }
    return '<section class="status kind-' + res.kind + '" aria-live="polite"><p class="status-kind">' + badge('badge-' + KIND_TONE[res.kind].slice(5), KIND_LABEL[res.kind]) + '</p>' +
      '<h2 class="status-head">' + esc(res.headline) + '</h2><p class="status-detail">' + esc(detail) + '</p>' + action + '</section>';
  }

  function arithmeticTable(path, months) {
    var last = '';
    var rows = path.lines.map(function (l) {
      var head = '';
      if (l.sign !== last) {
        last = l.sign;
        head = '<tr class="grp"><th scope="colgroup" colspan="4">' + (l.sign === '-' ? 'Subtracted' : 'Costs') + '</th></tr>';
      }
      var basis = '';
      if (l.status === 'ok') basis = l.monthly ? X.range(l.perMonthLow, l.perMonthHigh) + ' per month × ' + months + ' months' : 'whole period';
      var lo = l.status === 'ok' ? X.inr(l.low) : (l.status === 'unreviewed' ? 'unreviewed' : 'missing');
      var hi = l.status === 'ok' ? X.inr(l.high) : '';
      return head + '<tr' + (l.status === 'ok' ? '' : ' class="row-missing"') + '><th scope="row">' + esc(l.label) + '</th><td class="basis">' + esc(basis) + '</td><td>' + lo + '</td><td>' + hi + '</td></tr>';
    }).join('');
    var total = path.complete
      ? '<tr class="tot"><th scope="row">Estimated net cost</th><td class="basis">costs minus subtracted</td><td>' + X.inr(path.low) + '</td><td>' + X.inr(path.high) + '</td></tr>' : '';
    return '<div class="table-wrap"><table class="breakdown"><caption class="sr-only">' + esc(path.label) + ' arithmetic</caption>' +
      '<thead><tr><th scope="col">Line</th><th scope="col">Basis</th><th scope="col">Low</th><th scope="col">High</th></tr></thead><tbody>' + rows + total + '</tbody></table></div>' +
      (path.complete && path.low < 0 ? '<p class="hint">A negative figure means end value and proceeds exceed the costs entered. It is not a profit forecast.</p>' : '') +
      '<p class="hint">Low total uses every low cost and every high subtracted amount; high total is the reverse.</p>';
  }

  function evidenceHtml(path, r) {
    if (path.id === 'keep') {
      var rm = state.repairMeta || {};
      var q = quoteInfo(r);
      var src = [rm.workshop, rm.date].filter(Boolean).map(esc).join(' · ');
      var hist = E.parseAmount(state.pastSpending);
      return '<p>' + (src || 'No quote source recorded.') + (quoteOrigin(q) ? ' · ' + esc(quoteOrigin(q)) : '') + '</p>' +
        '<p class="muted">A quote is a cost estimate, not a final bill.</p>' +
        (hist.value !== undefined ? '<p class="muted">Past repair spending recorded as history: ' + X.inr(hist.value) + '. It is not in any total.</p>' : '');
    }
    var d = state.disposal[path.id === 'sell' ? 'sale' : 'scrap'];
    return '<p>' + esc(E.PRICE_TYPES[d.priceType] || 'Price type not recorded') + (d.source ? ' · ' + esc(d.source) : '') + (d.date ? ' · ' + esc(d.date) : '') + '</p>' +
      (d.deductions ? '<p class="muted">Deductions: ' + esc(d.deductions) + '</p>' : '') +
      '<p class="muted">' + esc(X.evidenceNote(d).join(' ')) + '</p>';
  }

  var PATH_SHORT = {
    keep: 'Repair the current vehicle and keep running it.',
    sell: 'Buy the replacement for cash; sell the current vehicle whole.',
    scrap: 'Buy the replacement for cash; scrap the current vehicle.'
  };

  function optionCard(path, r) {
    var months = r.months.status === 'ok' ? r.months.value : null;
    var lower = r.result.kind === 'clear' && r.result.path === path.id;
    var st = [];
    st.push(path.complete ? '<li class="tone-ok">✓ Complete</li>'
      : '<li class="tone-bad">✕ Incomplete: ' + plural(path.missing.length, 'input', 'inputs') + ' missing</li>');
    if (path.id !== 'keep') {
      st.push(path.confirmed ? '<li class="tone-ok">✓ Owner confirmed</li>' : '<li class="tone-warn">! Not confirmed: exploratory</li>');
    }
    var miss = path.missing.length ? '<div class="fixes"><p class="label-sm">Missing</p><ul>' + path.missing.map(function (m) {
      return '<li>' + esc(m.label) + ' <span class="muted">(' + esc(m.reason) + ')</span> <button type="button" class="link" data-jump="' + fixTarget(m) + '">Fix</button></li>';
    }).join('') + '</ul></div>' : '';
    var expl = path.exploratoryReasons.length ? '<div class="fixes"><p class="label-sm">Unconfirmed</p><ul>' + path.exploratoryReasons.map(function (x) {
      return '<li>' + esc(x) + ' <button type="button" class="link" data-jump="' + reasonTarget(x) + '">Confirm</button></li>';
    }).join('') + '</ul></div>' : '';
    return '<article class="option' + (lower ? ' is-lower' : '') + (path.confirmed ? '' : ' is-exploratory') + '">' +
      '<h3>' + esc(path.label) + '</h3><p class="blurb">' + PATH_SHORT[path.id] + '</p>' +
      (lower ? '<p class="lower-tag">Lower estimated cost under these assumptions</p>' : '') +
      '<p class="label-sm">Estimated net cost' + (months ? ' over ' + months + ' months' : '') + '</p>' +
      (path.complete ? '<p class="total">' + X.range(path.low, path.high) + '</p>' : '<p class="total total-na">Total unavailable</p>') +
      '<ul class="stat">' + st.join('') + '</ul>' + miss + expl +
      '<details class="more"><summary>Arithmetic</summary>' + arithmeticTable(path, months) + '</details>' +
      '<details class="more"><summary>Price evidence and sources</summary><div class="evidence-box">' + evidenceHtml(path, r) + '</div></details>' +
      '</article>';
  }

  // Shared-scale range bars. Positions only map engine totals to percentages.
  function rangeChart(r) {
    var paths = E.PATH_ORDER.map(function (id) { return r.paths[id]; });
    var done = paths.filter(function (p) { return p.complete; });
    if (!done.length) return '<section class="card chart"><h2>Cost ranges on one scale</h2><p class="muted">No option has every input yet, so there is nothing to plot.</p></section>';
    var min = Math.min.apply(null, done.map(function (p) { return p.low; }));
    var max = Math.max.apply(null, done.map(function (p) { return p.high; }));
    var lo0 = min, hi0 = max;
    if (min === max) { min -= 1; max += 1; }
    var pad = (max - min) * 0.04; min -= pad; max += pad;
    function pct(x) { return (x - min) / (max - min) * 100; }
    var rows = paths.map(function (p) {
      var bar;
      if (!p.complete) bar = '<span class="bar-na">not plotted</span>';
      else bar = '<span class="bar' + (p.confirmed ? '' : ' bar-explore') + '" style="left:' + pct(p.low).toFixed(2) + '%;width:' + Math.max(0.8, pct(p.high) - pct(p.low)).toFixed(2) + '%"></span>';
      return '<div class="chart-row"><span class="chart-label">' + esc(p.label) +
        (p.complete && !p.confirmed ? '<span class="chart-flag">Exploratory (hatched)</span>' : '') + '</span>' +
        '<span class="chart-track" aria-hidden="true">' + bar + '</span>' +
        '<span class="chart-val">' + (p.complete ? X.range(p.low, p.high) : 'Total unavailable') + '</span></div>';
    }).join('');
    return '<section class="card chart"><h2>Cost ranges on one scale</h2><div class="chart-body" role="group" aria-label="Estimated cost ranges of the three options on one shared scale">' + rows +
      '<div class="chart-row chart-axis-row" aria-hidden="true"><span class="chart-label"></span><span class="chart-axis"><span>' + X.inr(lo0) + '</span><span>' + X.inr(hi0) + '</span></span><span class="chart-val"></span></div></div>' +
      '<p class="hint">Each bar runs from an option\'s low to its high total. Scenario ranges built from the values entered, not confidence intervals or forecasts.</p></section>';
  }

  function sensRow(s) {
    return '<li class="srow"><div class="sname"><strong>' + esc(s.label) + '</strong><span class="muted">' + esc(s.pathLabel) + '</span></div>' +
      '<div class="smove">Total moves from <strong>' + X.inr(s.totalAtLow) + '</strong> to <strong>' + X.inr(s.totalAtHigh) + '</strong><span class="muted"> · change ' + X.inr(s.swing) + '</span></div>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-jump="' + (s.key === 'repair' ? 'f-repair-low' : 'f-' + s.key + '-low') + '">Edit this input</button></li>';
  }

  function sensitivitySection(r) {
    var rows = r.sensitivity;
    var body;
    if (!rows.length) {
      body = '<p class="muted">Shown once at least one option is complete and has an input entered as a range. Complete the missing inputs, or use “Enter a range” on an uncertain figure.</p>';
    } else {
      body = '<p class="hint">Each input moves alone from its low to its high value while the others stay at their midpoints, ordered by effect on the total. It shows which assumptions matter most; it is not a forecast.</p>' +
        '<ol class="sens">' + rows.slice(0, 5).map(sensRow).join('') + '</ol>' +
        (rows.length > 5 ? '<details class="more"><summary>Show ' + (rows.length - 5) + ' more</summary><ol class="sens">' + rows.slice(5).map(sensRow).join('') + '</ol></details>' : '');
    }
    return '<section class="card"><h2>What could change this result?</h2>' + body + '</section>';
  }

  function renderCompare() {
    var r = result();
    guide.done.inspect = guide.done.inspect || mode === 'example';
    return '<header class="page-head"><p class="kicker">Stage 4 of 4 · Compare options</p>' +
      '<h1 id="h1" tabindex="-1">' + esc(vehicleName()) + '</h1>' +
      '<p class="lede">' + (r.months.status === 'ok' ? 'Costed over ' + plural(r.months.value, 'month', 'months') : 'Comparison period not set') + ' · cash purchase</p></header>' +
      statusBlock(r) + rangeChart(r) +
      '<div class="options">' + E.PATH_ORDER.map(function (id) { return optionCard(r.paths[id], r); }).join('') + '</div>' +
      sensitivitySection(r) + pager('compare');
  }

  // ---------- guided walkthrough ----------

  function snapshotTotals(r) {
    function t(p) { return p.complete ? X.range(p.low, p.high) : 'incomplete'; }
    return { keep: t(r.paths.keep), sell: t(r.paths.sell), scrap: t(r.paths.scrap) };
  }

  function guideUpdate(r) {
    if (mode !== 'example') return [];
    if (!guide.base && r.fields.repair.status === 'ok') {
      guide.base = { repair: clone(state.fields.repair), saleNet: clone(state.fields.saleNet), totals: snapshotTotals(r) };
    }
    var q = quoteInfo(r);
    if (q.kind === 'accepted') guide.done.accept = true;
    if (guide.base) {
      var changed = JSON.stringify([state.fields.repair.low, state.fields.repair.high]) !== JSON.stringify([guide.base.repair.low, guide.base.repair.high]) ||
        JSON.stringify([state.fields.saleNet.low, state.fields.saleNet.high]) !== JSON.stringify([guide.base.saleNet.low, guide.base.saleNet.high]);
      if (changed && r.fields.repair.status === 'ok') guide.done.edit = true;
    }
    if (r.fields.saleNet.status === 'missing' && !r.paths.sell.complete) guide.done.unknown = true;
    if (r.result.kind === 'overlap') guide.done.overlap = true;
    var now = snapshotTotals(r);
    var b = guide.base ? guide.base.totals : null;
    var editNote = '';
    if (b && guide.done.edit) {
      editNote = ' Repair and keep: was ' + b.keep + ', now ' + now.keep + '. Replace and sell: was ' + b.sell + ', now ' + now.sell + '.';
    }
    return [
      { id: 'accept', title: 'Review and accept the sample quote', text: 'Run the simulated extraction, check each value against its source text, then accept.', go: 'quote', goLabel: 'Go to repair quote' },
      { id: 'inspect', title: 'Inspect the three options', text: 'Open the comparison and read the ranges, statuses and arithmetic.', go: 'compare', goLabel: 'Open comparison' },
      { id: 'edit', title: 'Edit a repair cost or sale estimate', text: 'Change either figure and watch the totals recalculate.' + editNote, go: 'assumptions', goLabel: 'Edit sale estimate', jump: 'f-saleNet-low' },
      { id: 'unknown', title: 'Make the sale price unknown', text: 'Clear the net sale proceeds. Replace and sell becomes incomplete instead of treating the gap as zero.', go: 'assumptions', goLabel: 'Go to sale proceeds', jump: 'f-saleNet-low' },
      { id: 'overlap', title: 'See overlapping ranges', text: 'Load the van example, whose ranges overlap. This replaces the current example data.', load: 'van_overlap', goLabel: 'Load van example' }
    ];
  }

  function renderGuide(r, route) {
    var slot = $('#guide-slot');
    if (mode !== 'example' || guide.dismissed || route === 'home') {
      if (slot.innerHTML !== '') slot.innerHTML = '';
      cache.guide = '';
      return;
    }
    var steps = guideUpdate(r);
    var next = steps.filter(function (s) { return !guide.done[s.id]; })[0];
    var doneCount = steps.filter(function (s) { return guide.done[s.id]; }).length;
    function act(s) {
      return s.load ? '<button type="button" class="btn btn-quiet btn-sm" data-load="' + s.load + '">' + s.goLabel + '</button>'
        : '<button type="button" class="btn btn-quiet btn-sm" data-go="' + s.go + '"' + (s.jump ? ' data-jump="' + s.jump + '"' : '') + '>' + s.goLabel + '</button>';
    }
    var html = '<aside class="guide" aria-label="Guided walkthrough"><div class="guide-head"><div><p class="guide-title">Guided walkthrough <span class="badge badge-demo">Fictional · optional</span></p>' +
      '<p class="hint">' + doneCount + ' of ' + steps.length + ' steps done. Uses the real controls; the guide never enters or accepts anything for you.</p></div>' +
      '<div class="btn-row tight"><button type="button" class="btn btn-quiet btn-sm" data-action="reset">Restart</button>' +
      '<button type="button" class="btn btn-quiet btn-sm" data-action="guide-skip">Skip walkthrough</button></div></div>' +
      (next ? '<div class="gnext"><span class="gmark">Next</span><div><strong>' + esc(next.title) + '</strong><p>' + esc(next.text) + '</p>' + act(next) + '</div></div>'
        : '<p class="gnext-done">All steps done. Reset the example to try again.</p>') +
      '<details class="more"><summary>All steps</summary><ol class="gsteps">' +
      steps.map(function (s) {
        var done = !!guide.done[s.id];
        return '<li class="' + (done ? 'is-done' : '') + '"><span class="gmark">' + (done ? '✓ Done' : 'Not yet') + '</span>' +
          '<div><strong>' + esc(s.title) + '</strong><p>' + esc(s.text) + '</p>' + act(s) + '</div></li>';
      }).join('') + '</ol></details></aside>';
    if (cache.guide !== html) { slot.innerHTML = html; cache.guide = html; }
  }

  // ---------- live status updates (no rebuild, so typing keeps focus) ----------

  function chip(cls, text) { return badge(cls, text); }

  function refresh() {
    var route = currentRoute();
    var r = result();
    Object.keys(E.FIELDS).forEach(function (key) {
      var el = $('[data-msg="' + key + '"]');
      if (!el) return;
      var st = r.fields[key];
      el.className = 'msg st-' + st.status;
      el.textContent = st.status === 'ok' ? '' : STATUS_TEXT[st.status] + ': ' + st.message;
    });
    var m = $('[data-msg="months"]');
    if (m) { m.className = 'msg st-' + r.months.status; m.textContent = r.months.status === 'ok' ? '' : r.months.message; }

    $all('[data-unit]').forEach(function (el) { el.textContent = unitText(el.dataset.unit); });
    $all('[data-calc]').forEach(function (el) {
      var path = el.dataset.calc === 'curRun' ? r.paths.keep : r.paths.sell;
      var line = path.lines.filter(function (l) { return l.key === el.dataset.calc; })[0];
      if (line && line.status === 'ok') el.textContent = 'Over ' + plural(r.months.value, 'month', 'months') + ': ' + X.range(line.low, line.high);
      else el.textContent = r.months.status === 'ok' ? '' : 'Enter the comparison period to see the total over the period.';
    });

    ['sale', 'scrap'].forEach(function (side) {
      var d = state.disposal[side];
      var ev = $('[data-evidence="' + side + '"]');
      if (ev) ev.textContent = X.evidenceNote(d).join(' ');
      var chips = $('[data-chips="' + side + '"]');
      if (chips) {
        chips.innerHTML =
          (E.PRICE_TYPES[d.priceType] ? chip('badge-ok', '✓ ' + E.PRICE_TYPES[d.priceType]) : chip('badge-warn', '! Price type not recorded')) + ' ' +
          (d.source && d.date ? chip('badge-ok', '✓ Source and date') : chip('badge-warn', '! Source or date missing')) + ' ' +
          (d.eligibility === 'owner_confirmed' ? chip('badge-ok', '✓ Owner confirmed') : chip('badge-warn', '! Unconfirmed'));
      }
    });

    var ro = $('[data-ro="repair"]');
    if (ro) ro.textContent = r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high)
      : (r.fields.repair.status === 'unreviewed' ? 'Waiting for review' : 'Not entered');

    var q = quoteInfo(r);
    var qs = $('[data-quote-summary]');
    if (qs) {
      var meta = state.repairMeta || {};
      qs.textContent = (r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high) : 'Amount not entered') +
        (meta.workshop ? ' · ' + meta.workshop : '') + (meta.date ? ' · ' + meta.date : '');
      var og = $('[data-quote-origin]'); if (og) og.textContent = quoteOrigin(q);
      var fl = $('[data-quote-flag]');
      if (fl) fl.innerHTML = q.edited ? badge('badge-warn', '! Edited since extraction') : '';
    }
    $all('[data-cur]').forEach(function (td) {
      var meta = state.repairMeta || {};
      var k = td.dataset.cur, cur, same;
      if (k === 'amount') { cur = r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high) : 'not entered'; }
      else cur = (k === 'workshop' ? meta.workshop : meta.date) || 'not entered';
      var accepted = proposalItem(k);
      var acc = accepted ? (k === 'amount' ? X.inr(Number(accepted.value)) : accepted.value) : '';
      same = k === 'amount' ? cur === acc : cur === acc;
      td.textContent = cur + (same ? '' : ' (changed)');
    });

    var gaps = $('#gaps');
    if (gaps) { var gh = gapsHtml(r); if (gh !== cache.gaps) { gaps.innerHTML = gh; cache.gaps = gh; } }

    var next = $('[data-next]');
    if (next && route === 'assumptions') {
      var incomplete = missingAssumptions(r).length || r.fields.repair.status !== 'ok';
      next.textContent = incomplete ? 'View incomplete comparison' : 'View comparison';
    }

    renderStepper(r, route);
    renderGuide(r, route);
  }

  // ---------- routing ----------

  function currentRoute() {
    var h = location.hash.replace('#', '');
    if (h === 'home' || STAGES.indexOf(h) >= 0) return h;
    return 'home';
  }

  function render() {
    var route = currentRoute();
    if (route !== 'home' && !state) { location.replace('#home'); return; }
    var view = $('#view');
    var html;
    if (route === 'home') html = renderHome();
    else if (route === 'start') html = renderStart();
    else if (route === 'quote') html = renderQuote();
    else if (route === 'assumptions') html = renderAssumptions();
    else html = renderCompare();
    view.innerHTML = html;
    cache.gaps = '';
    cache.stepper = '';
    renderControls();
    document.title = (route === 'home' ? 'Turning Point' : STAGE[route].name + ' · Turning Point') + ' (prototype v2)';
    refresh();
    window.scrollTo(0, 0);
    var h1 = $('#h1'); if (h1) h1.focus({ preventScroll: true });
    if (pendingAfter) { var fn = pendingAfter; pendingAfter = null; setTimeout(fn, 20); }
  }

  function navigate(route, after) {
    pendingAfter = after || null;
    if (currentRoute() === route && location.hash === '#' + route) render();
    else location.hash = '#' + route;
  }

  function setQuoteEdit(open) {
    var btn = $('[data-action="quote-edit"]'), panel = $('#quote-edit-fields');
    if (!btn || !panel) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Done editing' : 'Edit';
  }
  function setQuoteSource(open) {
    var btn = $('[data-action="quote-source"]'), panel = $('#quote-source');
    if (!btn || !panel) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Hide source' : 'View source';
  }

  function focusId(id) {
    var el = document.getElementById(id);
    if (!el) { var h = $('#h1'); if (h) h.focus(); return; }
    if (el.closest('#quote-edit-fields')) setQuoteEdit(true);
    var d = el.closest('details');
    while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
    el.scrollIntoView({ block: 'center' });
    el.focus();
  }
  function jump(id) {
    var route = routeFor(id);
    navigate(route, function () { focusId(id); });
  }

  // ---------- events ----------

  function onInput(e) {
    var t = e.target, d = t.dataset;
    if (d.low) { state.fields[d.low].low = t.value; if (state.fields[d.low].fixed) state.fields[d.low].high = t.value; }
    else if (d.high) { state.fields[d.high].high = t.value; }
    else if (d.months) { state.months = t.value; }
    else if (d.text) { setPath(state, d.text, t.value); }
    else if (d.veh) {
      setPath(state, d.veh, t.value);
      if (state.dutyConfirmed) {
        state.dutyConfirmed = false;
        var box = $('#duty'); if (box) box.checked = false;
        var n = $('#duty-note'); if (n) n.textContent = 'Duty confirmation cleared because the vehicle details changed. Confirm again when you are ready.';
      }
    }
    else if (d.prop !== undefined) { state.quote.proposal.items[Number(d.prop)].value = t.value; state.quote.proposal.edited = true; }
    else return;
    refresh();
  }

  function onChange(e) {
    var t = e.target, d = t.dataset;
    if (d.range) {
      var f = state.fields[d.range];
      var wrap = t.closest('.money');
      var note = $('[data-rnote="' + d.range + '"]', wrap);
      var lowEl = $('[data-low]', wrap), hiEl = $('[data-high]', wrap);
      if (!t.checked) {
        // Back to one exact figure. The low figure is used; the range is kept in case the owner switches back.
        var lo = E.parseAmount(f.low), hi = E.parseAmount(f.high);
        f.stash = { low: f.low, high: f.high };
        f.fixed = true;
        f.high = f.low;
        note.textContent = (lo.value !== undefined && hi.value !== undefined && lo.value !== hi.value)
          ? 'Using the low figure ₹' + fmtAmount(f.low) + ' as one amount. Your high figure ₹' + fmtAmount(f.stash.high) + ' is kept if you switch back to a range.' : '';
      } else {
        f.fixed = false;
        f.high = f.stash && f.stash.low === f.low ? f.stash.high : f.low;
        note.textContent = '';
      }
      wrap.classList.toggle('is-fixed', f.fixed);
      $('.mini-label', wrap).textContent = f.fixed ? 'Amount' : 'Low';
      lowEl.setAttribute('aria-label', lowEl.getAttribute('aria-label').replace(/, (amount|low), rupees$/, ', ' + (f.fixed ? 'amount' : 'low') + ', rupees'));
      hiEl.value = fmtAmount(f.high);
    } else if (d.duty) {
      state.dutyConfirmed = t.checked;
      var dn = $('#duty-note'); if (dn && t.checked) dn.textContent = '';
    } else if (d.ptype) {
      state.disposal[d.ptype].priceType = t.value;
    } else if (d.elig) {
      state.disposal[d.elig].eligibility = t.value;
    } else if (t.id === 'example') {
      loadExample(t.value);
      render();
      return;
    } else return;
    refresh();
  }

  function rawOf(t) {
    var d = t.dataset;
    if (d.low) return state.fields[d.low].low;
    if (d.high) return state.fields[d.high].high;
    return getPath(state, d.text);
  }
  function onFocusIn(e) { var t = e.target; if (t.dataset && t.dataset.amt) t.value = rawOf(t); }
  function onFocusOut(e) { var t = e.target; if (t.dataset && t.dataset.amt) t.value = fmtAmount(rawOf(t)); }

  function extract() {
    var q = P.QUOTES[state.vehicleKind];
    state.quote.proposal = { status: 'pending', items: clone(q.proposal) };
    render();
    var panel = $('#proposal'); if (panel) panel.focus();
  }

  function acceptProposal() {
    var items = state.quote.proposal.items;
    var amount = items.filter(function (i) { return i.key === 'amount'; })[0];
    var parsed = E.parseAmount(amount.value);
    var msg = $('#prop-msg');
    if (parsed.empty || parsed.error) {
      msg.className = 'msg st-invalid';
      msg.textContent = 'The repair amount must be a number of rupees, 0 or more, before it can be accepted.';
      return;
    }
    state.fields.repair = { fixed: true, low: String(parsed.value), high: String(parsed.value) };
    var ws = items.filter(function (i) { return i.key === 'workshop'; })[0];
    var dt = items.filter(function (i) { return i.key === 'date'; })[0];
    state.repairMeta = { workshop: ws ? ws.value : '', date: dt ? dt.value : '' };
    state.quote.proposal.status = 'accepted';
    render();
    var acc = $('#quote-accepted'); if (acc) acc.focus();
  }

  function onClick(e) {
    var link = e.target.closest ? e.target.closest('a[data-limits]') : null;
    if (link) {
      e.preventDefault();
      var det = $('#limits'); det.open = true;
      det.scrollIntoView({ block: 'center' });
      $('summary', det).focus();
      return;
    }
    var t = e.target.closest ? e.target.closest('button, [data-action]') : null;
    if (!t) return;
    var d = t.dataset;
    if (t.id === 'extract') extract();
    else if (t.id === 'prop-accept') acceptProposal();
    else if (t.id === 'prop-discard') { state.quote.proposal.status = 'discarded'; render(); var b = $('#extract'); if (b) b.focus(); }
    else if (d.sample) {
      state.vehicleKind = d.sample;
      state.quote.text = P.QUOTES[d.sample].text;
      state.quote.proposal = null;
      render();
      var ex = $('#extract'); if (ex) ex.focus();
    }
    else if (d.action === 'start-example') startExample();
    else if (d.action === 'start-blank') startBlank();
    else if (d.action === 'quote-edit') setQuoteEdit(t.getAttribute('aria-expanded') !== 'true');
    else if (d.action === 'quote-source') setQuoteSource(t.getAttribute('aria-expanded') !== 'true');
    else if (d.action === 'guide-skip') { guide.dismissed = true; renderControls(); renderGuide(result(), currentRoute()); }
    else if (d.action === 'guide-show') { guide.dismissed = false; renderControls(); refresh(); }
    else if (d.action === 'reset') {
      if (mode === 'blank') {
        if (!window.confirm('Clear everything entered in this blank decision?')) return;
        state = blankState();
      } else { guide = { dismissed: guide.dismissed, done: {}, base: null }; loadExample(exampleId); }
      render();
    }
    else if (d.load) { loadExample(d.load); navigate('compare'); }
    else if (d.go) { if (d.jump) jump(d.jump); else navigate(d.go); }
    else if (d.jump) jump(d.jump);
  }

  // ---------- start ----------

  function init() {
    var main = $('main'), controls = $('#controls');
    [main, controls].forEach(function (el) {
      el.addEventListener('input', onInput);
      el.addEventListener('change', onChange);
      el.addEventListener('focusin', onFocusIn);
      el.addEventListener('focusout', onFocusOut);
    });
    main.addEventListener('click', onClick);
    document.querySelector('.topbar').addEventListener('click', onClick);
    window.addEventListener('hashchange', render);
    if (!location.hash) history.replaceState(null, '', '#home');
    render();
  }

  init();
})();
