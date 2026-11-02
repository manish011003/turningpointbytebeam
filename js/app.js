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

  var STATUS_TEXT = { ok: 'Entered', missing: 'Missing', invalid: 'Check value', unreviewed: 'Unreviewed' };

  // ---------- inputs view ----------

  function moneyField(key, label, hint) {
    var f = state.fields[key];
    return '' +
      '<div class="money' + (f.fixed ? ' is-fixed' : '') + '" data-money="' + key + '">' +
        '<div class="money-head">' +
          '<label class="money-label" for="f-' + key + '-low">' + esc(label) + '</label>' +
          '<label class="fixed-toggle"><input type="checkbox" data-fixed="' + key + '"' + (f.fixed ? ' checked' : '') + '> Fixed amount</label>' +
        '</div>' +
        '<div class="money-inputs">' +
          '<label class="mini"><span class="mini-label lo-label">' + (f.fixed ? 'Amount (INR)' : 'Low (INR)') + '</span>' +
            '<input id="f-' + key + '-low" inputmode="decimal" autocomplete="off" placeholder="unknown" data-low="' + key + '" value="' + esc(f.low) + '"></label>' +
          '<label class="mini hi"><span class="mini-label">High (INR)</span>' +
            '<input id="f-' + key + '-high" inputmode="decimal" autocomplete="off" placeholder="unknown" data-high="' + key + '" value="' + esc(f.high) + '"></label>' +
        '</div>' +
        (hint ? '<p class="hint">' + esc(hint) + '</p>' : '') +
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
    return '<div class="table-wrap"><table class="veh"><thead><tr><th scope="col"></th><th scope="col">Current vehicle</th><th scope="col">Replacement candidate</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><th scope="row">' + r[1] + '</th>' +
          ['current', 'replacement'].map(function (side) {
            return '<td><input aria-label="' + side + ' ' + r[1] + '" data-veh="vehicles.' + side + '.' + r[0] + '" value="' + esc(state.vehicles[side][r[0]]) + '"></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function proposalPanel() {
    var p = state.quote.proposal;
    if (!p) {
      return '<p class="muted">No extraction yet. You can also type the repair quote below yourself.</p>';
    }
    if (p.status === 'accepted') {
      return '<p class="ok-note">Proposed values were reviewed and accepted. The amount below is now used in the comparison and stays editable.</p>';
    }
    if (p.status === 'discarded') {
      return '<p class="muted">Proposal discarded. Enter the repair quote below yourself, or extract again.</p>';
    }
    return '<div class="proposal" id="proposal" tabindex="-1">' +
      '<p class="proposal-title"><span class="badge badge-warn">Unreviewed</span> Proposed by simulated extraction. Check each value against the source text, edit if needed, then accept.</p>' +
      '<div class="table-wrap"><table class="prop"><thead><tr><th scope="col">Field</th><th scope="col">Proposed value</th><th scope="col">Source text in quote</th></tr></thead><tbody>' +
      p.items.map(function (it, i) {
        var valueCell = it.unsupported
          ? '<span class="muted">empty</span>'
          : '<input aria-label="' + esc(it.label) + '" data-prop="' + i + '" value="' + esc(it.value) + '">';
        var srcCell = it.unsupported ? '<span class="muted">' + esc(it.unsupported) + '</span>' : '<code>' + esc(it.sourceText) + '</code>';
        return '<tr><th scope="row">' + esc(it.label) + '</th><td>' + valueCell + '</td><td>' + srcCell + '</td></tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<p class="msg" id="prop-msg"></p>' +
      '<div class="btn-row"><button type="button" class="btn" id="prop-accept">Accept these values</button>' +
      '<button type="button" class="btn btn-quiet" id="prop-discard">Discard proposal</button></div>' +
      '</div>';
  }

  function disposalBlock(side) {
    var d = state.disposal[side];
    var key = side === 'sale' ? 'saleNet' : 'scrapNet';
    var title = side === 'sale' ? 'Sell whole' : 'Scrap through an authorised facility';
    var opts = '<option value="">Not recorded</option>' + Object.keys(E.PRICE_TYPES).map(function (k) {
      return '<option value="' + k + '"' + (d.priceType === k ? ' selected' : '') + '>' + E.PRICE_TYPES[k] + '</option>';
    }).join('');
    var elig = [['unconfirmed', 'Unconfirmed'], ['owner_confirmed', 'Owner confirmed']].map(function (o) {
      return '<label class="radio"><input type="radio" name="elig-' + side + '" data-elig="' + side + '" value="' + o[0] + '"' +
        (d.eligibility === o[0] ? ' checked' : '') + '> ' + o[1] + '</label>';
    }).join('');
    return '<div class="sub-card">' +
      '<h3>' + title + '</h3>' +
      moneyField(key, 'Net proceeds after known deductions', 'Leave blank if unknown. Blank is never treated as zero.') +
      '<label class="text-field" for="pt-' + side + '"><span>Price type</span><select id="pt-' + side + '" data-ptype="' + side + '">' + opts + '</select></label>' +
      '<p class="hint evidence" data-evidence="' + side + '"></p>' +
      textInput('disposal.' + side + '.source', 'Source', 'who gave or published the figure') +
      textInput('disposal.' + side + '.date', 'Date', 'YYYY-MM-DD') +
      textInput('disposal.' + side + '.deductions', 'Known deductions (note)', 'for example towing, brokerage; unknown if not known') +
      '<fieldset class="elig"><legend>Eligibility to ' + (side === 'sale' ? 'sell' : 'scrap') + '</legend>' + elig +
      '<p class="hint">"Owner confirmed" records your statement that ownership, registration and any finance allow this. It is not legal approval and Turning Point does not check it.' +
      (side === 'scrap' ? ' Scrapping would go through an authorised facility, subject to its own checks.' : '') + '</p></fieldset>' +
      '</div>';
  }

  function renderInputs() {
    var v = $('#view-inputs');
    v.innerHTML = '' +
      '<div class="live-status" id="live-status" aria-live="polite"></div>' +
      (notice ? '<p class="notice">' + esc(notice) + '</p>' : '') +

      '<section class="card"><h2>Decision setup</h2>' +
        '<label class="text-field narrow" for="f-months"><span>Horizon (months)</span>' +
        '<input id="f-months" inputmode="numeric" data-months="1" value="' + esc(state.months) + '" placeholder="1 to ' + E.MAX_MONTHS + '"></label>' +
        '<p class="msg" data-msg="months"></p>' +
        '<p class="hint">Both vehicles are costed over the same horizon for the same intended work.</p>' +
        vehicleTable() +
        '<label class="check"><input type="checkbox" id="duty" data-duty="1"' + (state.dutyConfirmed ? ' checked' : '') + '> ' +
        'I confirm the replacement candidate can do the same duty and carry the same capacity as the current vehicle.</label>' +
        '<p class="hint">This records your statement; Turning Point does not judge suitability. Without it, both replacement paths stay exploratory. Editing the vehicle details clears it.</p>' +
      '</section>' +

      '<section class="card"><h2>Repair quote</h2>' +
        '<div class="quote-grid">' +
          '<div><p class="label-sm">Fictional sample quote</p><pre class="quote">' + esc(state.quote.text) + '</pre>' +
          '<button type="button" class="btn" id="extract">Extract sample quote (simulated)</button>' +
          '<p class="hint">Simulated: returns fixed demo fields for this sample. Nothing is uploaded, parsed or sent to a model.</p></div>' +
          '<div><p class="label-sm">Proposed fields</p><div id="proposal-slot">' + proposalPanel() + '</div></div>' +
        '</div>' +
        moneyField('repair', 'Repair quote used in the comparison', 'A quote is a cost estimate from the workshop, not a final bill. Tick Fixed for a single quoted figure.') +
        '<div class="two-col">' + textInput('repairMeta.workshop', 'Workshop', 'who quoted') + textInput('repairMeta.date', 'Quote date', 'YYYY-MM-DD') + '</div>' +
      '</section>' +

      '<section class="card"><h2>Current vehicle: repair and keep</h2>' +
        '<div class="grid-3">' +
        moneyField('curRun', 'Running costs per month', 'Fuel or energy, driver, insurance, tyres. Exclude repairs, depreciation and purchase costs.') +
        moneyField('curAddRep', 'Additional repairs over the horizon', 'Repairs expected after this one, beyond the quote.') +
        moneyField('curEnd', 'End value at the end of the horizon', 'What the vehicle might be worth then. Subtracted from the keep path.') +
        '</div>' +
        '<label class="text-field narrow" for="t-pastSpending"><span>Past repair spending (optional history, INR)</span>' +
        '<input id="t-pastSpending" inputmode="decimal" data-text="pastSpending" value="' + esc(state.pastSpending) + '" placeholder="optional"></label>' +
        '<p class="hint">History only. It is shown for context and is not added to any forward cost.</p>' +
      '</section>' +

      '<section class="card"><h2>Replacement candidate</h2>' +
        '<p class="notice notice-scope">Cash purchase only. Finance comparison is not implemented in this prototype, to avoid misleading loan calculations.</p>' +
        '<div class="grid-2">' +
        moneyField('newPrice', 'Cash price', 'From a dealer quote. Fixed for a quoted price.') +
        moneyField('newRun', 'Running costs per month', 'Same scope as the current vehicle: exclude repairs, depreciation and purchase costs.') +
        moneyField('newAddRep', 'Additional repairs over the horizon', 'Repairs expected on the replacement during the horizon.') +
        moneyField('newEnd', 'End value at the end of the horizon', 'Estimated the same way as the current vehicle end value.') +
        '</div>' +
      '</section>' +

      '<section class="card"><h2>Current vehicle: disposal if replaced</h2>' +
        '<p class="hint">Sale and scrap are separate alternatives. Each feeds only its own path and they are never added together. Turning Point does not generate valuations.</p>' +
        '<div class="grid-2 disposal">' + disposalBlock('sale') + disposalBlock('scrap') + '</div>' +
      '</section>' +

      '<div class="btn-row end"><a class="btn btn-primary" href="#comparison">See comparison</a></div>';

    refreshInputStatus();
  }

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
    ['sale', 'scrap'].forEach(function (side) {
      var el = $('[data-evidence="' + side + '"]');
      if (el) el.textContent = X.evidenceNote(state.disposal[side]).join(' ');
    });
    var live = $('#live-status');
    if (live) {
      live.className = 'live-status kind-' + r.result.kind;
      live.innerHTML = '<span><strong>Current status:</strong> ' + esc(r.result.headline) + '</span><a href="#comparison">View comparison</a>';
    }
  }

  // ---------- comparison view ----------

  function chipsFor(path) {
    var c = [];
    c.push(path.complete ? '<span class="badge badge-ok">Complete</span>' : '<span class="badge badge-bad">Incomplete</span>');
    if (path.id !== 'keep') {
      c.push(path.confirmed ? '<span class="badge badge-ok">Owner confirmed</span>' : '<span class="badge badge-warn">Exploratory</span>');
    }
    return c.join(' ');
  }

  function fixTarget(m) {
    if (m.key === 'months') return 'f-months';
    if (m.status === 'unreviewed') return 'proposal';
    if (m.reason === 'price type not recorded') return E.FIELDS[m.key].disposal === 'sale' ? 'pt-sale' : 'pt-scrap';
    return 'f-' + m.key + '-low';
  }

  function pathCard(path, r) {
    var months = r.months.status === 'ok' ? r.months.value : null;
    var rows = path.lines.map(function (l) {
      var cls = l.status === 'ok' ? '' : ' class="row-missing"';
      var label = (l.sign === '-' ? 'minus ' : '') + l.label + (l.monthly && months ? ' (' + months + ' months)' : '');
      var lo = l.status === 'ok' ? X.inr(l.low) : (l.status === 'unreviewed' ? 'unreviewed' : 'missing');
      var hi = l.status === 'ok' ? X.inr(l.high) : '';
      return '<tr' + cls + '><th scope="row">' + esc(label) + '</th><td>' + lo + '</td><td>' + hi + '</td></tr>';
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
    var evidence = '';
    if (path.id !== 'keep') {
      var side = path.id === 'sell' ? 'sale' : 'scrap';
      var d = state.disposal[side];
      evidence = '<div class="evidence-box"><p class="label-sm">Disposal evidence</p><p>' +
        esc(E.PRICE_TYPES[d.priceType] || 'Price type not recorded') +
        (d.source ? ' · ' + esc(d.source) : '') + (d.date ? ' · ' + esc(d.date) : '') + '</p>' +
        (d.deductions ? '<p class="muted">Deductions: ' + esc(d.deductions) + '</p>' : '') +
        '<p class="muted">' + esc(X.evidenceNote(d).join(' ')) + '</p></div>';
    }
    var winner = r.result.kind === 'clear' && r.result.path === path.id;
    return '<article class="path-card' + (winner ? ' is-lower' : '') + (path.confirmed ? '' : ' is-exploratory') + '">' +
      '<header><h3>' + esc(path.label) + '</h3><div class="chips">' + chipsFor(path) + '</div></header>' +
      (winner ? '<p class="lower-tag">Lower estimated cost under these assumptions</p>' : '') +
      '<p class="label-sm">Estimated net cost over the horizon</p>' + total +
      '<div class="table-wrap"><table class="breakdown"><thead><tr><th scope="col">Line</th><th scope="col">Low</th><th scope="col">High</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      missing + expl + evidence +
      '<p class="explain">' + esc(X.pathSummary(path, state, months)) + '</p>' +
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
      return '<div class="chart-row"><span class="chart-label">' + esc(p.label) + '</span>' +
        '<span class="chart-track">' + bar + '</span>' +
        '<span class="chart-val">' + (p.complete ? X.range(p.low, p.high) : '') + '</span></div>';
    }).join('');
    return '<section class="card chart"><h2>Ranges on one scale</h2>' +
      '<div class="chart-body">' + rows +
      '<div class="chart-row chart-axis-row"><span class="chart-label"></span><span class="chart-axis"><span>' + X.inr(min + pad) + '</span><span>' + X.inr(max - pad) + '</span></span><span class="chart-val"></span></div>' +
      '</div>' +
      '<p class="hint">Bars run from each path\'s low to high total. Dashed bars are exploratory. Ranges are illustrative scenarios built from the low and high values entered; they are not probabilities or forecasts.</p></section>';
  }

  function sensitivitySection(r) {
    var rows = r.sensitivity.slice(0, 6);
    if (!rows.length) return '';
    return '<section class="card"><h2>Limited sensitivity check</h2>' +
      '<p class="hint">One input at a time moves from its low to its high value while the other ranges stay at their midpoints. This shows which assumptions matter most; it is not a forecast.</p>' +
      '<div class="table-wrap"><table class="sens"><thead><tr><th scope="col">Path</th><th scope="col">Input</th><th scope="col">Total with input at low</th><th scope="col">Total with input at high</th><th scope="col">Change</th></tr></thead><tbody>' +
      rows.map(function (s) {
        return '<tr><td>' + esc(s.pathLabel) + '</td><td>' + esc(s.label) + '</td><td>' + X.inr(s.totalAtLow) + '</td><td>' + X.inr(s.totalAtHigh) + '</td><td>' + X.inr(s.swing) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="explain">' + esc(X.sensitivitySentence(rows[0])) + '</p></section>';
  }

  function renderComparison() {
    var r = result();
    var hist = E.parseAmount(state.pastSpending);
    var v = $('#view-comparison');
    v.innerHTML = '' +
      '<div class="btn-row"><a class="btn btn-quiet" href="#inputs">Back to edit inputs</a></div>' +
      '<section class="result kind-' + r.result.kind + '" aria-live="polite">' +
        '<p class="result-head">' + esc(r.result.headline) + '</p>' +
        '<p>' + esc(r.result.detail) + '</p>' +
      '</section>' +
      rangeChart(r) +
      '<div class="paths">' + E.PATH_ORDER.map(function (id) { return pathCard(r.paths[id], r); }).join('') + '</div>' +
      sensitivitySection(r) +
      '<section class="card notes"><h2>How to read this</h2><ul>' +
        '<li>Totals are net cash outflow over the horizon in INR. Each path counts either sale or scrap proceeds, never both.</li>' +
        '<li>Cash purchase only. Finance comparison is not implemented.</li>' +
        '<li>Running costs exclude repairs, depreciation and purchase costs, so nothing is counted twice.</li>' +
        (hist.value !== undefined ? '<li>Past repair spending recorded as history: ' + X.inr(hist.value) + '. It is not included in any total.</li>' : '') +
        '<li>Missing values are shown as missing and never treated as zero.</li>' +
        '<li>Turning Point does not certify roadworthiness, decide eligibility, predict sale prices or carry out any sale, purchase or scrapping.</li>' +
      '</ul></section>';
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

  function focusField(id) {
    if (location.hash !== '#inputs') location.hash = '#inputs';
    setTimeout(function () {
      var el = document.getElementById(id);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
    }, 30);
  }

  // ---------- state changes ----------

  function loadPreset(id) {
    presetId = id;
    state = P.PRESETS[id].build();
    notice = '';
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
        setNotice('Duty confirmation cleared because the vehicle details changed.');
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
      $('[data-high]', wrap).value = f.high;
    } else if (d.duty) {
      state.dutyConfirmed = t.checked;
    } else if (d.ptype) {
      state.disposal[d.ptype].priceType = t.value;
    } else if (d.elig) {
      state.disposal[d.elig].eligibility = t.value;
    } else return;
    refreshInputStatus();
  }

  function setNotice(text) {
    notice = text;
    var el = $('.notice:not(.notice-scope)');
    if (el) el.textContent = text;
    else $('#live-status').insertAdjacentHTML('afterend', '<p class="notice">' + esc(text) + '</p>');
  }

  function extract() {
    var q = P.QUOTES[state.vehicleKind];
    state.quote.proposal = { status: 'pending', items: JSON.parse(JSON.stringify(q.proposal)) };
    $('#proposal-slot').innerHTML = proposalPanel();
    refreshInputStatus();
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
    focusField('f-repair-low');
  }

  function discardProposal() {
    state.quote.proposal.status = 'discarded';
    $('#proposal-slot').innerHTML = proposalPanel();
    refreshInputStatus();
  }

  function onClick(e) {
    var t = e.target;
    if (t.id === 'extract') extract();
    else if (t.id === 'prop-accept') acceptProposal();
    else if (t.id === 'prop-discard') discardProposal();
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
    window.addEventListener('hashchange', function () { showView(); window.scrollTo(0, 0); });

    state = P.PRESETS[presetId].build();
    renderInputs();
    if (!location.hash) history.replaceState(null, '', '#inputs');
    showView();
  }

  init();
})();
