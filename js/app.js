/*
 * SuprFleet Turning Point: user interface.
 *
 * Holds the app state in memory, renders the two views and passes the state
 * to TPEngine.compute(). This file never does cost arithmetic itself.
 */
(function () {
  'use strict';

  var E = window.TPEngine, P = window.TPPresets, X = window.TPExplain;

  var state = null;          // current case, shaped like a preset
  var presetId = P.DEFAULT;
  var notice = '';           // one line message shown on the inputs view
  var stepOpen = null;       // open/closed state of the three input sections
  var preconfirmed = false;  // true when a fictional example starts with confirmations set
  var lastSummary = '';      // avoids rewriting the progress summary when nothing changed

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
    var target = keys.reduce(function (o, k) { return o[k]; }, obj);
    target[last] = value;
  }
  function result() { return E.compute(state); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // Indian digit grouping for display only. The stored string is never changed.
  function fmtAmount(raw) {
    var p = E.parseAmount(raw);
    if (p.value === undefined) return raw === null || raw === undefined ? '' : String(raw);
    return p.value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  function rangeOf(key) {
    var rg = E.readRange(state.fields[key]);
    return rg.status === 'ok' ? X.range(rg.low, rg.high) : 'not entered';
  }

  var STATUS_TEXT = { ok: 'Entered', missing: 'Missing', invalid: 'Check value', unreviewed: 'Unreviewed' };

  var SUBTRACTED = E.PATHS.keep.sub.concat(E.PATHS.sell.sub, E.PATHS.scrap.sub);

  // The three input sections. keys are required inputs; conf are owner confirmations.
  var SECTIONS = [
    { id: 's1', num: 1, title: 'Vehicle and repair quote', keys: ['months', 'repair'] },
    { id: 's2', num: 2, title: 'Keeping versus replacing',
      keys: ['curRun', 'curAddRep', 'curEnd', 'newPrice', 'newRun', 'newAddRep', 'newEnd'] },
    { id: 's3', num: 3, title: 'Sell or scrap proceeds', keys: ['saleNet', 'scrapNet'] }
  ];
  function confirmations() {
    return [
      { section: 's1', label: 'Replacement duty and capacity', target: 'duty', ok: !!state.dutyConfirmed },
      { section: 's3', label: 'Sale eligibility', target: 'elig-sale-yes', ok: state.disposal.sale.eligibility === 'owner_confirmed' },
      { section: 's3', label: 'Scrap eligibility', target: 'elig-scrap-yes', ok: state.disposal.scrap.eligibility === 'owner_confirmed' }
    ];
  }

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

  function fixTarget(m) {
    if (m.key === 'months') return 'f-months';
    if (m.status === 'unreviewed') return 'proposal';
    if (m.reason === 'price type not recorded') return E.FIELDS[m.key].disposal === 'sale' ? 'pt-sale' : 'pt-scrap';
    return 'f-' + m.key + '-low';
  }

  // Short hint beside the field plus an optional expandable explanation.
  function more(title, text) {
    return text ? '<details class="more"><summary>' + esc(title) + '</summary><p>' + esc(text) + '</p></details>' : '';
  }

  // ---------- inputs view ----------

  function moneyField(key, label, hint, moreTitle, moreText) {
    var f = state.fields[key];
    var sub = SUBTRACTED.indexOf(key) >= 0;
    var monthly = !!E.FIELDS[key].monthly;
    return '' +
      '<div class="money' + (f.fixed ? ' is-fixed' : '') + (sub ? ' is-sub' : '') + '" data-money="' + key + '">' +
        '<div class="money-head">' +
          '<label class="money-label" for="f-' + key + '-low">' + esc(label) + '</label>' +
          '<span class="tag ' + (sub ? 'tag-sub' : 'tag-cost') + '">' + (sub ? '− Subtracted' : '+ Cost') + '</span>' +
        '</div>' +
        '<p class="unit" data-unit="' + key + '">' + esc(unitText(key)) + '</p>' +
        '<div class="money-inputs">' +
          '<label class="mini"><span class="mini-label lo-label">' + (f.fixed ? 'Amount (INR)' : 'Low (INR)') + '</span>' +
            '<span class="amt"><span class="cur" aria-hidden="true">₹</span><input id="f-' + key + '-low" inputmode="decimal" autocomplete="off" placeholder="unknown" data-amt="1" data-low="' + key + '" value="' + esc(fmtAmount(f.low)) + '"></span></label>' +
          '<label class="mini hi"><span class="mini-label">High (INR)</span>' +
            '<span class="amt"><span class="cur" aria-hidden="true">₹</span><input id="f-' + key + '-high" inputmode="decimal" autocomplete="off" placeholder="unknown" data-amt="1" data-high="' + key + '" value="' + esc(fmtAmount(f.high)) + '"></span></label>' +
        '</div>' +
        '<label class="fixed-toggle"><input type="checkbox" data-fixed="' + key + '"' + (f.fixed ? ' checked' : '') + '> Fixed amount (one figure, no range)</label>' +
        (monthly ? '<p class="calc" data-calc="' + key + '"></p>' : '') +
        (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
        more(moreTitle || 'What this includes', moreText) +
        '<p class="msg" data-msg="' + key + '" aria-live="polite"></p>' +
      '</div>';
  }

  function textInput(path, label, placeholder) {
    var id = 't-' + path.replace(/\./g, '-');
    return '<label class="text-field" for="' + id + '"><span>' + esc(label) + '</span>' +
      '<input id="' + id + '" data-text="' + path + '" value="' + esc(getPath(state, path)) + '" placeholder="' + esc(placeholder || '') + '"></label>';
  }

  function vehicleTable() {
    var rows = [['type', 'Vehicle type'], ['capacity', 'Capacity'], ['duty', 'Duty'], ['km', 'Expected use']];
    var sides = [['current', 'Current vehicle'], ['replacement', 'Replacement candidate']];
    return '<div class="table-wrap"><table class="veh"><caption class="sr-only">Current vehicle and replacement candidate details</caption>' +
      '<thead><tr><th scope="col"><span class="sr-only">Detail</span></th><th scope="col">Current vehicle</th><th scope="col">Replacement candidate</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th scope="row">' + r[1] + '</th>' +
          sides.map(function (s) {
            return '<td data-label="' + s[1] + '"><input aria-label="' + s[0] + ' ' + r[1] + '" data-veh="vehicles.' + s[0] + '.' + r[0] + '" value="' + esc(state.vehicles[s[0]][r[0]]) + '"></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ----- quote review: sample quote -> simulated extraction -> editable fields -> accept

  function flowSteps(p) {
    var cur = !p || p.status === 'discarded' ? 1 : (p.status === 'pending' ? 3 : 4);
    var names = ['Sample quote', 'Simulated extraction', 'Review and accept'];
    return '<ol class="flow" aria-label="Quote review steps">' + names.map(function (n, i) {
      var done = i + 1 < cur || (cur === 4);
      var here = i + 1 === cur;
      return '<li class="' + (done ? 'is-done' : '') + (here ? ' is-here' : '') + '"' + (here ? ' aria-current="step"' : '') + '>' +
        '<span class="flow-n" aria-hidden="true">' + (done ? '✓' : (i + 1)) + '</span>' + n + (done ? '<span class="sr-only"> (done)</span>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  function proposalTable(p) {
    return '<div class="proposal" id="proposal" tabindex="-1">' +
      '<p class="proposal-title"><span class="badge badge-warn">Unreviewed</span> Check each value against the source text, edit if needed, then accept.</p>' +
      '<div class="table-wrap"><table class="prop"><caption class="sr-only">Proposed fields from the sample quote</caption><thead><tr><th scope="col">Field</th><th scope="col">Proposed value</th><th scope="col">Source text in quote</th></tr></thead><tbody>' +
      p.items.map(function (it, i) {
        var valueCell = it.unsupported
          ? '<span class="muted">empty</span>'
          : '<input aria-label="' + esc(it.label) + '" data-prop="' + i + '" value="' + esc(it.value) + '">';
        var srcCell = it.unsupported ? '<span class="muted">' + esc(it.unsupported) + '</span>' : '<code>' + esc(it.sourceText) + '</code>';
        return '<tr><th scope="row">' + esc(it.label) + '</th><td>' + valueCell + '</td><td>' + srcCell + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="msg" id="prop-msg" aria-live="polite"></p>' +
      '<div class="btn-row"><button type="button" class="btn btn-primary" id="prop-accept">Accept these values</button>' +
      '<button type="button" class="btn btn-quiet" id="prop-discard">Discard proposal</button></div>' +
      '</div>';
  }

  function repairEntry() {
    return moneyField('repair', 'Repair quote used in the comparison',
      'A workshop cost estimate, not a final bill.', 'About this quote',
      'Tick Fixed amount for a single quoted figure. Use a range if the workshop gave a low and a high estimate.') +
      '<div class="two-col">' + textInput('repairMeta.workshop', 'Workshop', 'who quoted') + textInput('repairMeta.date', 'Quote date', 'YYYY-MM-DD') + '</div>';
  }

  function quoteBlock() {
    var p = state.quote.proposal;
    var open = !p || p.status === 'discarded';
    var body;
    if (p && p.status === 'pending') {
      body = proposalTable(p);
    } else if (p && p.status === 'accepted') {
      body = '<div class="accepted" id="quote-accepted" tabindex="-1">' +
        '<div class="accepted-row"><div><span class="badge badge-ok">Accepted</span> <span class="accepted-sum" data-quote-summary></span></div>' +
        '<button type="button" class="btn btn-quiet" id="quote-toggle" data-action="quote-edit" aria-expanded="false" aria-controls="quote-edit-fields">Edit</button></div>' +
        '<div id="quote-edit-fields" hidden>' + repairEntry() + '</div></div>';
    } else {
      body = (p ? '<p class="muted">Proposal discarded. Run the extraction again, or enter the repair quote yourself below.</p>' : '') +
        '<div class="btn-row"><button type="button" class="btn" id="extract">Extract fields from sample quote</button></div>' +
        '<div class="manual"><h4>Or enter the quote yourself</h4>' + repairEntry() + '</div>';
    }
    return '<div class="quote-flow">' +
      '<div class="quote-head"><h3>Repair quote</h3><span class="badge badge-demo">Simulated demo</span></div>' +
      '<p class="hint">Fictional sample quote. The extraction returns fixed demo fields: nothing is uploaded, parsed or sent to a model.</p>' +
      flowSteps(p) +
      '<details class="more quote-text"' + (open ? ' open' : '') + '><summary>Sample quote text</summary><pre class="quote">' + esc(state.quote.text) + '</pre></details>' +
      body + '</div>';
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
    return '<div class="sub-card">' +
      '<div class="sub-head"><h3>' + title + '</h3><div class="chips" data-chips="' + side + '"></div></div>' +
      moneyField(key, 'Net proceeds after known deductions', 'Leave blank if unknown. Blank is never treated as zero.') +
      '<label class="text-field" for="pt-' + side + '"><span>Price type</span><select id="pt-' + side + '" data-ptype="' + side + '">' + opts + '</select></label>' +
      '<p class="hint evidence" data-evidence="' + side + '"></p>' +
      '<div class="two-col">' +
        textInput('disposal.' + side + '.source', 'Source', 'who gave or published the figure') +
        textInput('disposal.' + side + '.date', 'Date', 'YYYY-MM-DD') +
      '</div>' +
      textInput('disposal.' + side + '.deductions', 'Known deductions (note)', 'for example towing, brokerage; unknown if not known') +
      '<fieldset class="elig"><legend>Eligibility to ' + (side === 'sale' ? 'sell' : 'scrap') + '</legend>' + elig +
      '<p class="hint">Your statement only: not legal approval, and not checked by Turning Point.</p>' +
      more('More about eligibility',
        '"Owner confirmed" records your statement that ownership, registration and any finance allow this. It is not legal approval and Turning Point does not check it.' +
        (side === 'scrap' ? ' Scrapping would go through an authorised facility, subject to its own checks.' : '')) +
      '</fieldset>' +
      '</div>';
  }

  function step(sec, body) {
    return '<details class="step" id="' + sec.id + '"' + (stepOpen[sec.id] ? ' open' : '') + '>' +
      '<summary id="sum-' + sec.id + '"><span class="step-num">' + sec.num + '</span>' +
      '<span class="step-title"><h2 class="step-name">' + sec.title + '</h2><span class="step-sum" data-stepsum="' + sec.id + '"></span></span>' +
      '<span class="step-badge" data-stepbadge="' + sec.id + '"></span></summary>' +
      '<div class="step-body">' + body + '</div></details>';
  }

  function section1() {
    return '<div class="horizon-row"><label class="text-field narrow" for="f-months"><span>Comparison period</span>' +
        '<span class="amt"><input id="f-months" inputmode="numeric" data-months="1" value="' + esc(state.months) + '" placeholder="1 to ' + E.MAX_MONTHS + '"><span class="suf">months</span></span></label>' +
      '<p class="hint">Both vehicles are costed over this same period, for the same intended work.</p></div>' +
      '<p class="msg" data-msg="months" aria-live="polite"></p>' +
      '<h3>Vehicles compared</h3>' + vehicleTable() +
      '<label class="check" for="duty"><input type="checkbox" id="duty" data-duty="1"' + (state.dutyConfirmed ? ' checked' : '') + '> ' +
      '<span>I confirm the replacement candidate can do the same duty and carry the same capacity as the current vehicle.</span></label>' +
      '<p class="hint">Your statement; Turning Point does not judge suitability. Editing the vehicle details clears it.</p>' +
      more('Why this matters', 'Without this confirmation, both replacement paths stay exploratory and are never ranked.') +
      quoteBlock();
  }

  function section2() {
    var quoteCell = '<div class="money ro" data-money="repair-ro">' +
      '<div class="money-head"><span class="money-label">Repair quote</span><span class="tag tag-cost">+ Cost</span></div>' +
      '<p class="unit">₹ once, for the whole repair</p>' +
      '<p class="ro-val" data-ro="repair"></p>' +
      '<p class="hint">Set in section 1. <button type="button" class="link" data-fix="sum-s1">Go to repair quote</button></p></div>';
    return '<p class="notice notice-scope">Cash purchase only. Finance comparison is not implemented in this prototype, to avoid misleading loan calculations.</p>' +
      '<div class="compare-cols">' +
        '<div class="col col-keep"><h3>Keep: repair the current vehicle</h3>' +
          '<p class="group">Costs over the period</p>' +
          quoteCell +
          moneyField('curRun', 'Running costs', 'Fuel or energy, driver, insurance, tyres.', 'What counts as running costs',
            'Exclude repairs, depreciation and purchase costs, so nothing is counted twice. The monthly figure is multiplied by the comparison period.') +
          moneyField('curAddRep', 'Additional repairs', 'Repairs expected after this one, beyond the quote.') +
          '<p class="group">Subtracted at the end of the period</p>' +
          moneyField('curEnd', 'End value of current vehicle', 'What it might be worth at the end of the period.') +
        '</div>' +
        '<div class="col col-new"><h3>Replace: buy the candidate for cash</h3>' +
          '<p class="group">Costs over the period</p>' +
          moneyField('newPrice', 'Cash price', 'From a dealer quote. Tick Fixed for a quoted price.') +
          moneyField('newRun', 'Running costs', 'Same scope as the current vehicle.', 'What counts as running costs',
            'Exclude repairs, depreciation and purchase costs. The monthly figure is multiplied by the comparison period.') +
          moneyField('newAddRep', 'Additional repairs', 'Repairs expected on the replacement during the period.') +
          '<p class="group">Subtracted at the end of the period</p>' +
          moneyField('newEnd', 'End value of replacement', 'Estimate it the same way as the current vehicle.') +
        '</div>' +
      '</div>' +
      '<details class="more history"><summary>Optional: past repair spending (history only, not in any total)</summary>' +
        '<label class="text-field narrow" for="t-pastSpending"><span>Past repair spending (INR)</span>' +
        '<span class="amt"><span class="cur" aria-hidden="true">₹</span><input id="t-pastSpending" inputmode="decimal" data-amt="1" data-text="pastSpending" value="' + esc(fmtAmount(state.pastSpending)) + '" placeholder="optional"></span></label>' +
        '<p class="hint">Shown for context only. It is never added to a forward cost.</p></details>';
  }

  function section3() {
    return '<p class="hint">Sale and scrap are separate alternatives. Each feeds only its own path and they are never added together. Turning Point does not generate valuations.</p>' +
      '<div class="grid-2 disposal">' + disposalBlock('sale') + disposalBlock('scrap') + '</div>';
  }

  function renderInputs() {
    var v = $('#view-inputs');
    if (stepOpen === null) {
      var r0 = result();
      stepOpen = {};
      SECTIONS.forEach(function (s, i) {
        stepOpen[s.id] = i === 0 || s.keys.some(function (k) { return (k === 'months' ? r0.months : r0.fields[k]).status !== 'ok'; });
      });
    }
    lastSummary = '';
    v.innerHTML = '' +
      '<header class="page-head">' +
        '<h1>Is this vehicle worth another repair?</h1>' +
        '<p class="page-sub"><strong>' + esc(state.vehicles.current.type) + '</strong> · Comparison period: <strong data-period></strong></p>' +
        (preconfirmed ? '<p class="note-demo">Fictional example: the owner confirmations (duty, sale and scrap eligibility) are pre-set for this demo. A new blank decision starts unconfirmed.</p>' : '') +
      '</header>' +
      '<div id="notice-slot" aria-live="polite">' + (notice ? '<p class="notice">' + esc(notice) + '</p>' : '') + '</div>' +
      '<section class="card progress" aria-labelledby="progress-h"><h2 id="progress-h" class="sr-only">Completion summary</h2><div id="progress"></div></section>' +
      step(SECTIONS[0], section1()) +
      step(SECTIONS[1], section2()) +
      step(SECTIONS[2], section3()) +
      '<div class="btn-row end"><a class="btn btn-primary" href="#comparison" data-viewbtn></a></div>';
    refreshInputStatus();
  }

  // Counts used by the completion summary and the section badges.
  function progressOf(r) {
    var out = { total: 0, done: 0, missing: [], bySec: {}, conf: confirmations() };
    SECTIONS.forEach(function (s) {
      var b = out.bySec[s.id] = { total: s.keys.length, done: 0 };
      s.keys.forEach(function (k) {
        var st = k === 'months' ? r.months : r.fields[k];
        out.total++;
        if (st.status === 'ok') { out.done++; b.done++; }
        else out.missing.push({ key: k, section: s.id, status: st.status, reason: st.message,
          label: k === 'months' ? 'Comparison period' : E.FIELDS[k].label });
      });
    });
    out.unconfirmed = out.conf.filter(function (c) { return !c.ok; });
    return out;
  }

  function progressHtml(pr) {
    var pct = Math.round(pr.done / pr.total * 100);
    var gaps = pr.missing.length, unc = pr.unconfirmed.length;
    var btn, note;
    if (gaps) {
      btn = 'View incomplete comparison';
      note = 'It will show totals only for paths with every input, and no decision.';
    } else if (unc) {
      btn = 'View comparison (exploratory)';
      note = 'All figures are entered, but unconfirmed paths are exploratory and are not ranked.';
    } else {
      btn = 'View comparison';
      note = 'All inputs are entered and confirmed.';
    }
    var html = '<div class="prog-top"><div class="prog-main">' +
      '<p class="prog-count"><strong>' + pr.done + ' of ' + pr.total + '</strong> inputs complete · <strong>' + (pr.conf.length - unc) + ' of ' + pr.conf.length + '</strong> confirmations</p>' +
      '<div class="meter" role="progressbar" aria-label="Inputs complete" aria-valuemin="0" aria-valuemax="' + pr.total + '" aria-valuenow="' + pr.done + '"><span style="width:' + pct + '%"></span></div>' +
      '</div><div class="prog-action"><a class="btn btn-primary" href="#comparison">' + btn + '</a><p class="hint">' + note + '</p></div></div>';
    if (gaps) {
      html += '<div class="gaps"><p class="label-sm">Missing or unusable inputs</p><ul>' + pr.missing.map(function (m) {
        return '<li><button type="button" class="link" data-fix="' + fixTarget(m) + '">' + esc(m.label) + '</button> <span class="muted">(' + (m.status === 'unreviewed' ? 'unreviewed' : esc(m.reason)) + '; ' + esc(SECTIONS.filter(function (s) { return s.id === m.section; })[0].title.toLowerCase()) + ')</span></li>';
      }).join('') + '</ul></div>';
    }
    if (unc) {
      html += '<div class="gaps"><p class="label-sm">Owner confirmations still needed</p><ul>' + pr.unconfirmed.map(function (c) {
        return '<li><button type="button" class="link" data-fix="' + c.target + '">' + esc(c.label) + '</button></li>';
      }).join('') + '</ul></div>';
    }
    return { html: html, btn: btn };
  }

  function chip(cls, text) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }

  // Update messages and status lines without rebuilding inputs (keeps focus while typing).
  function refreshInputStatus() {
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

    var period = $('[data-period]');
    if (period) period.textContent = r.months.status === 'ok' ? plural(r.months.value, 'month', 'months') : 'not set';

    $all('[data-unit]').forEach(function (el) { el.textContent = unitText(el.dataset.unit); });

    // Monthly running costs: show the total over the period, taken from the engine's own lines.
    $all('[data-calc]').forEach(function (el) {
      var path = el.dataset.calc === 'curRun' ? r.paths.keep : r.paths.sell;
      var line = path.lines.filter(function (l) { return l.key === el.dataset.calc; })[0];
      if (line && line.status === 'ok') el.textContent = 'Over ' + plural(r.months.value, 'month', 'months') + ': ' + X.range(line.low, line.high);
      else el.textContent = r.months.status === 'ok' ? '' : 'Enter the comparison period to see the total over the period.';
    });

    ['sale', 'scrap'].forEach(function (side) {
      var d = state.disposal[side];
      var el = $('[data-evidence="' + side + '"]');
      if (el) el.textContent = X.evidenceNote(d).join(' ');
      var chips = $('[data-chips="' + side + '"]');
      if (chips) {
        chips.innerHTML =
          (E.PRICE_TYPES[d.priceType] ? chip('badge-ok', 'Price type: ' + E.PRICE_TYPES[d.priceType]) : chip('badge-warn', 'Price type not recorded')) + ' ' +
          (d.source && d.date ? chip('badge-ok', 'Source and date recorded') : chip('badge-warn', 'Source or date missing')) + ' ' +
          (d.eligibility === 'owner_confirmed' ? chip('badge-ok', 'Owner confirmed') : chip('badge-warn', 'Unconfirmed'));
      }
    });

    var pr = progressOf(r);
    var ph = progressHtml(pr);
    var slot = $('#progress');
    if (slot && ph.html !== lastSummary) { slot.innerHTML = ph.html; lastSummary = ph.html; }
    $all('[data-viewbtn]').forEach(function (b) { b.textContent = ph.btn; });

    SECTIONS.forEach(function (s) {
      var b = pr.bySec[s.id];
      var unc = pr.unconfirmed.filter(function (c) { return c.section === s.id; }).length;
      var badge = $('[data-stepbadge="' + s.id + '"]');
      if (badge) {
        if (b.done < b.total) { badge.className = 'step-badge badge badge-bad'; badge.textContent = 'Incomplete · ' + b.done + ' of ' + b.total; }
        else if (unc) { badge.className = 'step-badge badge badge-warn'; badge.textContent = 'Needs confirmation'; }
        else { badge.className = 'step-badge badge badge-ok'; badge.textContent = 'Complete'; }
      }
    });
    var sums = {
      s1: (r.months.status === 'ok' ? plural(r.months.value, 'month', 'months') : 'Period not set') + ' · Repair quote ' + (r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high) : 'not entered'),
      s2: 'Running costs per month: keep ' + rangeOf('curRun') + ', replace ' + rangeOf('newRun'),
      s3: 'Sale ' + rangeOf('saleNet') + ' · Scrap ' + rangeOf('scrapNet')
    };
    Object.keys(sums).forEach(function (id) { var el = $('[data-stepsum="' + id + '"]'); if (el) el.textContent = sums[id]; });

    var ro = $('[data-ro="repair"]');
    if (ro) ro.textContent = r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high) : (r.fields.repair.status === 'unreviewed' ? 'Waiting for review' : 'Not entered');
    var qs = $('[data-quote-summary]');
    if (qs) {
      var meta = state.repairMeta || {};
      qs.textContent = (r.fields.repair.status === 'ok' ? X.range(r.fields.repair.low, r.fields.repair.high) : 'Amount not entered') +
        (meta.workshop ? ' · ' + meta.workshop : '') + (meta.date ? ' · ' + meta.date : '') + (meta.origin ? ' · ' + meta.origin : '');
    }
  }

  // ---------- comparison view ----------

  var KIND_LABEL = {
    clear: 'Ranges separate', overlap: 'Ranges overlap', incomplete: 'Incomplete', unconfirmed: 'Exploratory',
    unreviewed: 'Waiting for review', horizon: 'Period needed'
  };
  var KIND_BADGE = {
    clear: 'badge-ok', overlap: 'badge-info', incomplete: 'badge-bad', unconfirmed: 'badge-warn',
    unreviewed: 'badge-warn', horizon: 'badge-bad'
  };
  var PATH_BLURB = {
    keep: 'Repair the current vehicle and keep running it for the whole period.',
    sell: 'Buy the replacement candidate for cash and sell the current vehicle whole.',
    scrap: 'Buy the replacement candidate for cash and scrap the current vehicle through an authorised facility.'
  };

  function resultHeadline(r) {
    if (r.result.kind === 'clear') {
      return 'Lowest estimated cost under these assumptions: ' + r.paths[r.result.path].label;
    }
    return r.result.headline;
  }

  function chipsFor(path) {
    var c = [];
    c.push(path.complete ? '<span class="badge badge-ok">Complete</span>' : '<span class="badge badge-bad">Incomplete</span>');
    if (path.id !== 'keep') {
      c.push(path.confirmed ? '<span class="badge badge-ok">Owner confirmed</span>' : '<span class="badge badge-warn">Exploratory</span>');
    }
    return c.join(' ');
  }

  function evidenceHtml(path) {
    if (path.id === 'keep') {
      var rm = state.repairMeta || {};
      var src = [rm.workshop, rm.date, rm.origin].filter(Boolean).map(esc).join(' · ');
      return '<p>' + (src || 'No quote source recorded.') + '</p><p class="muted">A quote is a cost estimate, not a final bill.</p>';
    }
    var d = state.disposal[path.id === 'sell' ? 'sale' : 'scrap'];
    return '<p>' + esc(E.PRICE_TYPES[d.priceType] || 'Price type not recorded') +
      (d.source ? ' · ' + esc(d.source) : '') + (d.date ? ' · ' + esc(d.date) : '') + '</p>' +
      (d.deductions ? '<p class="muted">Deductions: ' + esc(d.deductions) + '</p>' : '') +
      '<p class="muted">' + esc(X.evidenceNote(d).join(' ')) + '</p>';
  }

  function pathCard(path, r) {
    var months = r.months.status === 'ok' ? r.months.value : null;
    var lastSign = '';
    var rows = path.lines.map(function (l) {
      var head = '';
      if (l.sign !== lastSign) {
        lastSign = l.sign;
        head = '<tr class="grp"><th scope="colgroup" colspan="3">' + (l.sign === '-' ? 'Subtracted at the end of the period' : 'Costs') + '</th></tr>';
      }
      var cls = l.status === 'ok' ? '' : ' class="row-missing"';
      var label = l.label + (l.monthly && months ? ' (' + months + ' months)' : '');
      var lo = l.status === 'ok' ? X.inr(l.low) : (l.status === 'unreviewed' ? 'unreviewed' : 'missing');
      var hi = l.status === 'ok' ? X.inr(l.high) : '';
      return head + '<tr' + cls + '><th scope="row">' + esc(label) + '</th><td>' + lo + '</td><td>' + hi + '</td></tr>';
    }).join('');
    var total = path.complete
      ? '<p class="total">' + X.range(path.low, path.high) + '</p>'
      : '<p class="total total-na">Total unavailable</p>';
    var missing = path.missing.length
      ? '<div class="missing"><p class="label-sm">Missing or unusable inputs</p><ul>' + path.missing.map(function (m) {
          return '<li>' + esc(m.label) + ': ' + esc(m.reason) + ' <button type="button" class="link" data-fix="' + fixTarget(m) + '">Fix</button></li>';
        }).join('') + '</ul></div>'
      : '';
    var expl = path.exploratoryReasons.length
      ? '<div class="explore"><p class="label-sm">Exploratory, not actionable</p><ul>' +
        path.exploratoryReasons.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'
      : '';
    var winner = r.result.kind === 'clear' && r.result.path === path.id;
    var blurb = PATH_BLURB[path.id] +
      (path.complete && path.low < 0 ? ' A negative figure means end value and proceeds exceed the costs entered; it is not a profit forecast.' : '');
    return '<article class="path-card' + (winner ? ' is-lower' : '') + (path.confirmed ? '' : ' is-exploratory') + '">' +
      '<header><h3>' + esc(path.label) + '</h3><div class="chips">' + chipsFor(path) + '</div></header>' +
      (winner ? '<p class="lower-tag">Lowest estimated cost under these assumptions</p>' : '') +
      '<p class="label-sm">Estimated net cost' + (months ? ' over ' + months + ' months' : '') + '</p>' + total +
      '<p class="explain">' + esc(blurb) + '</p>' +
      missing + expl +
      '<details class="more"><summary>Cost breakdown</summary><div class="table-wrap"><table class="breakdown"><thead><tr><th scope="col">Line</th><th scope="col">Low</th><th scope="col">High</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>' +
      '<details class="more"><summary>Source evidence</summary><div class="evidence-box">' + evidenceHtml(path) + '</div></details>' +
      '</article>';
  }

  // Shared scale range bars for complete paths. Position is computed from engine totals only.
  function rangeChart(r) {
    var paths = E.PATH_ORDER.map(function (id) { return r.paths[id]; });
    var done = paths.filter(function (p) { return p.complete; });
    if (!done.length) return '';
    var min = Math.min.apply(null, done.map(function (p) { return p.low; }));
    var max = Math.max.apply(null, done.map(function (p) { return p.high; }));
    if (min === max) { min -= 1; max += 1; }
    var pad = (max - min) * 0.06; min -= pad; max += pad;
    function pct(x) { return ((x - min) / (max - min) * 100).toFixed(2); }
    var rows = paths.map(function (p) {
      var bar;
      if (!p.complete) {
        bar = '<span class="bar-na">total unavailable</span>';
      } else {
        var left = pct(p.low), width = Math.max(0.8, pct(p.high) - pct(p.low));
        bar = '<span class="bar' + (p.confirmed ? '' : ' bar-explore') + '" style="left:' + left + '%;width:' + width + '%"></span>';
      }
      return '<div class="chart-row"><span class="chart-label">' + esc(p.label) +
        (p.complete && !p.confirmed ? '<span class="chart-flag">Exploratory (hatched)</span>' : '') + '</span>' +
        '<span class="chart-track" aria-hidden="true">' + bar + '</span>' +
        '<span class="chart-val">' + (p.complete ? X.range(p.low, p.high) : '') + '</span></div>';
    }).join('');
    return '<section class="card chart" aria-labelledby="chart-h"><h2 id="chart-h">Scenario ranges on one scale</h2>' +
      '<div class="chart-body">' + rows +
      '<div class="chart-row chart-axis-row" aria-hidden="true"><span class="chart-label"></span><span class="chart-axis"><span>' + X.inr(min + pad) + '</span><span>' + X.inr(max - pad) + '</span></span><span class="chart-val"></span></div>' +
      '</div>' +
      '<p class="hint">Each bar runs from a path\'s low to its high total, built from the low and high values you entered. These are scenario ranges, not confidence intervals, probabilities or forecasts.</p></section>';
  }

  function sensitivitySection(r) {
    var rows = r.sensitivity.slice(0, 6);
    if (!rows.length) return '';
    var top = rows[0];
    return '<section class="card" aria-labelledby="sens-h"><h2 id="sens-h">What could change this result?</h2>' +
      '<p class="lead">Largest calculated influence: <strong>' + esc(top.label) + '</strong> (' + esc(top.pathLabel) + '), a change of ' + X.inr(top.swing) + '.</p>' +
      '<p class="explain-plain">' + esc(X.sensitivitySentence(top)) + '</p>' +
      '<details class="more"><summary>See all calculated influences</summary>' +
      '<p class="hint">One input at a time moves from its low to its high value while the other ranges stay at their midpoints. This shows which assumptions matter most; it is not a forecast.</p>' +
      '<div class="table-wrap"><table class="sens"><thead><tr><th scope="col">Path</th><th scope="col">Input</th><th scope="col">Total with input at low</th><th scope="col">Total with input at high</th><th scope="col">Change</th></tr></thead><tbody>' +
      rows.map(function (s) {
        return '<tr><td>' + esc(s.pathLabel) + '</td><td>' + esc(s.label) + '</td><td>' + X.inr(s.totalAtLow) + '</td><td>' + X.inr(s.totalAtHigh) + '</td><td>' + X.inr(s.swing) + '</td></tr>';
      }).join('') + '</tbody></table></div></details></section>';
  }

  function renderComparison() {
    var r = result();
    var hist = E.parseAmount(state.pastSpending);
    var v = $('#view-comparison');
    v.innerHTML = '' +
      '<header class="page-head">' +
        '<h1>' + esc(resultHeadline(r)) + '</h1>' +
        '<p class="page-sub"><strong>' + esc(state.vehicles.current.type) + '</strong> · ' +
          (r.months.status === 'ok' ? 'Costed over ' + plural(r.months.value, 'month', 'months') : 'Comparison period not set') + '</p>' +
      '</header>' +
      '<section class="result kind-' + r.result.kind + '" aria-live="polite">' +
        '<p>' + chip(KIND_BADGE[r.result.kind], KIND_LABEL[r.result.kind]) + '</p>' +
        '<p>' + esc(r.result.detail) + '</p>' +
      '</section>' +
      '<div class="btn-row"><a class="btn btn-primary" href="#inputs">Edit inputs</a>' +
        '<button type="button" class="btn" data-action="breakdown">View breakdown</button></div>' +
      '<div class="paths">' + E.PATH_ORDER.map(function (id) { return pathCard(r.paths[id], r); }).join('') + '</div>' +
      rangeChart(r) +
      sensitivitySection(r) +
      '<p class="scope">Cash purchase only · Comparison tool: it does not sell, scrap or buy anything.</p>' +
      '<details class="card notes"><summary>How to read this</summary><ul>' +
        '<li>Totals are net cash outflow over the period in INR. Each path counts either sale or scrap proceeds, never both.</li>' +
        '<li>Finance comparison is not implemented.</li>' +
        '<li>Running costs exclude repairs, depreciation and purchase costs, so nothing is counted twice.</li>' +
        (hist.value !== undefined ? '<li>Past repair spending recorded as history: ' + X.inr(hist.value) + '. It is not included in any total.</li>' : '') +
        '<li>Missing values are shown as missing and never treated as zero.</li>' +
        '<li>Turning Point does not certify roadworthiness, decide eligibility, predict sale prices or carry out any sale, purchase or scrapping.</li>' +
      '</ul></details>';
  }

  function showBreakdown() {
    var all = $all('.path-card details');
    all.forEach(function (d) { d.open = true; });
    var first = $('.paths');
    if (first) first.scrollIntoView({ block: 'start' });
    if (all[0]) $('summary', all[0]).focus();
  }

  // ---------- routing ----------

  function currentView() { return location.hash === '#comparison' ? 'comparison' : 'inputs'; }

  function showView() {
    var view = currentView();
    $('#view-inputs').hidden = view !== 'inputs';
    $('#view-comparison').hidden = view !== 'comparison';
    $('#tab-inputs').classList.toggle('active', view === 'inputs');
    $('#tab-comparison').classList.toggle('active', view === 'comparison');
    $('#tab-inputs').setAttribute('aria-current', view === 'inputs' ? 'page' : 'false');
    $('#tab-comparison').setAttribute('aria-current', view === 'comparison' ? 'page' : 'false');
    if (view === 'comparison') renderComparison(); else refreshInputStatus();
  }

  function setQuoteEdit(open) {
    var btn = $('#quote-toggle'), panel = $('#quote-edit-fields');
    if (!btn || !panel) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? 'Done' : 'Edit';
  }

  function focusField(id) {
    if (location.hash !== '#inputs') location.hash = '#inputs';
    setTimeout(function () {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.closest('#quote-edit-fields')) setQuoteEdit(true);
      var d = el.closest('details');
      while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
      el.scrollIntoView({ block: 'center' });
      el.focus();
    }, 30);
  }

  // ---------- state changes ----------

  function loadPreset(id) {
    presetId = id;
    state = P.PRESETS[id].build();
    preconfirmed = confirmations().some(function (c) { return c.ok; });
    notice = '';
    stepOpen = null;
    renderInputs();
    if (currentView() === 'comparison') renderComparison();
  }

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
        setNotice('Duty confirmation cleared because the vehicle details changed. Confirm again when you are ready.');
      }
    }
    else if (d.prop !== undefined) { state.quote.proposal.items[Number(d.prop)].value = t.value; state.quote.proposal.edited = true; }
    else return;
    refreshInputStatus();
  }

  function onChange(e) {
    var t = e.target, d = t.dataset;
    if (d.fixed) {
      var f = state.fields[d.fixed];
      f.fixed = t.checked;
      if (f.fixed) f.high = f.low;
      var wrap = t.closest('.money');
      wrap.classList.toggle('is-fixed', f.fixed);
      $('.lo-label', wrap).textContent = f.fixed ? 'Amount (INR)' : 'Low (INR)';
      var hi = $('[data-high]', wrap);
      hi.value = document.activeElement === hi ? f.high : fmtAmount(f.high);
    } else if (d.duty) {
      state.dutyConfirmed = t.checked;
      if (t.checked) setNotice('');
    } else if (d.ptype) {
      state.disposal[d.ptype].priceType = t.value;
    } else if (d.elig) {
      state.disposal[d.elig].eligibility = t.value;
    } else return;
    refreshInputStatus();
  }

  // Amounts show Indian grouping when not being edited; the stored text is untouched.
  function rawOf(t) {
    var d = t.dataset;
    if (d.low) return state.fields[d.low].low;
    if (d.high) return state.fields[d.high].high;
    return getPath(state, d.text);
  }
  function onFocusIn(e) {
    var t = e.target;
    if (t.dataset && t.dataset.amt) t.value = rawOf(t);
  }
  function onFocusOut(e) {
    var t = e.target;
    if (t.dataset && t.dataset.amt) t.value = fmtAmount(rawOf(t));
  }

  function setNotice(text) {
    notice = text;
    var slot = $('#notice-slot');
    if (slot) slot.innerHTML = text ? '<p class="notice">' + esc(text) + '</p>' : '';
  }

  function extract() {
    var q = P.QUOTES[state.vehicleKind];
    state.quote.proposal = { status: 'pending', items: JSON.parse(JSON.stringify(q.proposal)) };
    renderInputs();
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
    state.repairMeta = { workshop: ws ? ws.value : '', date: dt ? dt.value : '',
      origin: state.quote.proposal.edited ? 'Owner edited after simulated extraction' : 'Accepted from simulated extraction' };
    state.quote.proposal.status = 'accepted';
    renderInputs();
    var acc = $('#quote-accepted'); if (acc) { acc.scrollIntoView({ block: 'center' }); acc.focus(); }
  }

  function discardProposal() {
    state.quote.proposal.status = 'discarded';
    renderInputs();
    var btn = $('#extract'); if (btn) btn.focus();
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('button, a, [data-action]') : e.target;
    if (!t) return;
    if (t.id === 'extract') extract();
    else if (t.id === 'prop-accept') acceptProposal();
    else if (t.id === 'prop-discard') discardProposal();
    else if (t.dataset && t.dataset.action === 'quote-edit') setQuoteEdit(t.getAttribute('aria-expanded') !== 'true');
    else if (t.dataset && t.dataset.action === 'breakdown') showBreakdown();
    else if (t.dataset && t.dataset.fix) focusField(t.dataset.fix);
  }

  // ---------- start ----------

  function init() {
    var sel = $('#preset');
    sel.innerHTML = Object.keys(P.PRESETS).map(function (id) {
      return '<option value="' + id + '">' + esc(P.PRESETS[id].label) + '</option>';
    }).join('');
    sel.value = presetId;
    sel.addEventListener('change', function () { loadPreset(sel.value); });
    $('#reset').addEventListener('click', function () { loadPreset(presetId); });

    var main = $('main');
    main.addEventListener('input', onInput);
    main.addEventListener('change', onChange);
    main.addEventListener('click', onClick);
    main.addEventListener('focusin', onFocusIn);
    main.addEventListener('focusout', onFocusOut);
    // toggle does not bubble, so listen in the capture phase.
    main.addEventListener('toggle', function (e) {
      if (e.target.classList && e.target.classList.contains('step') && stepOpen) stepOpen[e.target.id] = e.target.open;
    }, true);
    window.addEventListener('hashchange', function () { showView(); window.scrollTo(0, 0); });

    state = P.PRESETS[presetId].build();
    preconfirmed = confirmations().some(function (c) { return c.ok; });
    renderInputs();
    if (!location.hash) history.replaceState(null, '', '#inputs');
    showView();
  }

  init();
})();
