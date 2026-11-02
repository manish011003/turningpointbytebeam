/*
 * SuprFleet Turning Point: calculation engine.
 *
 * Pure, deterministic functions. No DOM, no network, no randomness.
 * This file is the only place where arithmetic on costs happens.
 * Works in the browser (window.TPEngine) and in Node (module.exports) for tests.
 */
(function (root) {
  'use strict';

  var MAX_MONTHS = 120; // prototype bound: up to 10 years

  // Every money input. All amounts are INR. "monthly" fields are multiplied by the horizon.
  var FIELDS = {
    repair:    { label: 'Repair quote', short: 'Repair quote' },
    curRun:    { label: 'Current vehicle running costs per month', short: 'Running costs', monthly: true },
    curAddRep: { label: 'Current vehicle additional repairs over horizon', short: 'Additional repairs' },
    curEnd:    { label: 'Current vehicle end value', short: 'End value of current vehicle' },
    newPrice:  { label: 'Replacement cash price', short: 'Replacement cash price' },
    newRun:    { label: 'Replacement running costs per month', short: 'Running costs', monthly: true },
    newAddRep: { label: 'Replacement additional repairs over horizon', short: 'Additional repairs' },
    newEnd:    { label: 'Replacement end value', short: 'End value of replacement' },
    saleNet:   { label: 'Net sale proceeds (current vehicle, sold whole)', short: 'Net sale proceeds', disposal: 'sale' },
    scrapNet:  { label: 'Net scrap proceeds (current vehicle, scrapped)', short: 'Net scrap proceeds', disposal: 'scrap' }
  };

  // Each path adds some fields and subtracts others. Sale and scrap proceeds never appear together.
  var PATHS = {
    keep:  { label: 'Repair and keep',        add: ['repair', 'curRun', 'curAddRep'],    sub: ['curEnd'] },
    sell:  { label: 'Replace and sell whole', add: ['newPrice', 'newRun', 'newAddRep'], sub: ['newEnd', 'saleNet'] },
    scrap: { label: 'Replace and scrap',      add: ['newPrice', 'newRun', 'newAddRep'], sub: ['newEnd', 'scrapNet'] }
  };
  var PATH_ORDER = ['keep', 'sell', 'scrap'];

  var PRICE_TYPES = {
    buyer_offer: 'Buyer offer',
    listing: 'Listing asking price',
    modelled: 'Modelled estimate',
    owner: 'Owner estimate'
  };

  function round2(x) { return Math.round(x * 100) / 100; }

  // Parse one amount typed by the user. Blank is "empty", never zero.
  // Accepts Indian digit grouping ("3,20,000") and a leading rupee sign.
  function parseAmount(raw) {
    if (raw === null || raw === undefined) return { empty: true };
    var s = String(raw).replace(/[₹,\s]/g, '');
    if (s === '') return { empty: true };
    if (!/^-?\d+(\.\d+)?$/.test(s)) return { error: 'not a number' };
    var n = Number(s);
    if (!isFinite(n)) return { error: 'not a number' };
    if (n < 0) return { error: 'cannot be negative' };
    return { value: n };
  }

  // Read a low/high range. A fixed amount uses one value for both ends.
  // Returns { status: 'ok'|'missing'|'invalid', low, high, message }.
  function readRange(field) {
    field = field || {};
    var lo = parseAmount(field.low);
    if (field.fixed) {
      if (lo.empty) return { status: 'missing', message: 'no value entered' };
      if (lo.error) return { status: 'invalid', message: 'amount ' + lo.error };
      return { status: 'ok', low: lo.value, high: lo.value };
    }
    var hi = parseAmount(field.high);
    if (lo.empty && hi.empty) return { status: 'missing', message: 'no value entered' };
    if (lo.error) return { status: 'invalid', message: 'low value ' + lo.error };
    if (hi.error) return { status: 'invalid', message: 'high value ' + hi.error };
    if (lo.empty || hi.empty) return { status: 'invalid', message: 'enter both low and high (use the same value, or tick Fixed, for a fixed amount)' };
    if (lo.value > hi.value) return { status: 'invalid', message: 'low value is above high value' };
    return { status: 'ok', low: lo.value, high: hi.value };
  }

  // Horizon in whole months, 1 to MAX_MONTHS.
  function readMonths(raw) {
    var s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (s === '') return { status: 'missing', message: 'enter a horizon in months' };
    if (!/^\d+$/.test(s)) return { status: 'invalid', message: 'horizon must be a whole number of months' };
    var n = Number(s);
    if (n < 1 || n > MAX_MONTHS) return { status: 'invalid', message: 'horizon must be between 1 and ' + MAX_MONTHS + ' months' };
    return { status: 'ok', value: n };
  }

  // Status of every field, including the review gate on the repair quote
  // and the price type requirement on disposal values.
  function isQuotePending(input) {
    if (input.quotePending) return true;
    var p = input.quote && input.quote.proposal;
    return !!(p && p.status === 'pending');
  }

  function fieldStatuses(input) {
    var out = {};
    var pending = isQuotePending(input);
    Object.keys(FIELDS).forEach(function (key) {
      var r = readRange(input.fields && input.fields[key]);
      var def = FIELDS[key];
      if (key === 'repair' && r.status === 'missing' && pending) {
        r = { status: 'unreviewed', message: 'proposed by simulated extraction, waiting for owner review' };
      }
      if (def.disposal && r.status === 'ok') {
        var ev = (input.disposal && input.disposal[def.disposal]) || {};
        if (!PRICE_TYPES[ev.priceType]) {
          r = { status: 'missing', message: 'price type not recorded', low: r.low, high: r.high };
        }
      }
      out[key] = r;
    });
    return out;
  }

  // Low and high contribution of one field to a path, before sign.
  function lineAmounts(key, st, months) {
    var m = FIELDS[key].monthly ? months : 1;
    return { low: round2(st.low * m), high: round2(st.high * m) };
  }

  // Interval arithmetic:
  //   low total  = sum of LOW costs  - sum of HIGH amounts subtracted
  //   high total = sum of HIGH costs - sum of LOW amounts subtracted
  function pathTotal(pathId, values, months) {
    var p = PATHS[pathId];
    var low = 0, high = 0;
    p.add.forEach(function (k) { var a = lineAmounts(k, values[k], months); low += a.low; high += a.high; });
    p.sub.forEach(function (k) { var a = lineAmounts(k, values[k], months); low -= a.high; high -= a.low; });
    return { low: round2(low), high: round2(high) };
  }

  function exploratoryReasons(pathId, input) {
    var reasons = [];
    if (pathId === 'keep') return reasons;
    if (!input.dutyConfirmed) reasons.push('Equivalent duty and capacity of the replacement not confirmed by the owner');
    var side = pathId === 'sell' ? 'sale' : 'scrap';
    var ev = (input.disposal && input.disposal[side]) || {};
    if (ev.eligibility !== 'owner_confirmed') {
      reasons.push(side === 'sale' ? 'Sale eligibility unconfirmed' : 'Scrap eligibility unconfirmed');
    }
    return reasons;
  }

  function computePath(pathId, statuses, months, monthsOk, input) {
    var p = PATHS[pathId];
    var missing = [];
    var lines = [];
    p.add.concat(p.sub).forEach(function (k) {
      var st = statuses[k];
      var sign = p.add.indexOf(k) >= 0 ? '+' : '-';
      if (st.status !== 'ok') {
        missing.push({ key: k, label: FIELDS[k].label, reason: st.message, status: st.status });
        lines.push({ key: k, label: FIELDS[k].short, sign: sign, low: null, high: null, status: st.status });
        return;
      }
      if (FIELDS[k].monthly && !monthsOk) {
        missing.push({ key: 'months', label: 'Horizon', reason: 'needed to total monthly running costs', status: 'invalid' });
        lines.push({ key: k, label: FIELDS[k].short, sign: sign, low: null, high: null, status: 'invalid' });
        return;
      }
      var a = lineAmounts(k, st, months);
      lines.push({ key: k, label: FIELDS[k].short, sign: sign, low: a.low, high: a.high, status: 'ok',
        monthly: !!FIELDS[k].monthly, perMonthLow: st.low, perMonthHigh: st.high });
    });
    var complete = missing.length === 0;
    var total = complete ? pathTotal(pathId, statuses, months) : null;
    var reasons = exploratoryReasons(pathId, input);
    return {
      id: pathId, label: p.label, complete: complete, missing: missing, lines: lines,
      low: total ? total.low : null, high: total ? total.high : null,
      confirmed: reasons.length === 0, exploratoryReasons: reasons
    };
  }

  // One at a time sensitivity: hold every other range input at its midpoint and
  // move one input from its low to its high value. A limited check, not a forecast.
  function sensitivity(paths, statuses, months) {
    var rows = [];
    PATH_ORDER.forEach(function (pid) {
      var path = paths[pid];
      if (!path.complete) return;
      var p = PATHS[pid];
      var mid = {};
      p.add.concat(p.sub).forEach(function (k) {
        var m = (statuses[k].low + statuses[k].high) / 2;
        mid[k] = { low: m, high: m };
      });
      p.add.concat(p.sub).forEach(function (k) {
        var st = statuses[k];
        if (st.low === st.high) return;
        var atLow = Object.assign({}, mid); atLow[k] = { low: st.low, high: st.low };
        var atHigh = Object.assign({}, mid); atHigh[k] = { low: st.high, high: st.high };
        var tLow = pathTotal(pid, atLow, months).low;
        var tHigh = pathTotal(pid, atHigh, months).low;
        rows.push({ path: pid, pathLabel: p.label, key: k, label: FIELDS[k].label,
          totalAtLow: tLow, totalAtHigh: tHigh, swing: round2(Math.abs(tHigh - tLow)) });
      });
    });
    rows.sort(function (a, b) { return b.swing - a.swing; });
    return rows;
  }

  function decide(paths, monthsSt, input) {
    var list = PATH_ORDER.map(function (id) { return paths[id]; });
    if (monthsSt.status !== 'ok') {
      return { kind: 'horizon', headline: 'Enter a valid horizon', detail: monthsSt.message + '. No totals or ranking until then.' };
    }
    var fieldsRepair = paths.keep.missing.filter(function (m) { return m.status === 'unreviewed'; });
    if (fieldsRepair.length) {
      return { kind: 'unreviewed', headline: 'Repair quote waiting for review',
        detail: 'The simulated extraction has proposed values. Accept or edit them before the amount is used. No ranking until then.' };
    }
    var incomplete = list.filter(function (p) { return !p.complete; });
    if (incomplete.length) {
      return { kind: 'incomplete', headline: 'Comparison incomplete: no ranking',
        detail: incomplete.map(function (p) { return p.label; }).join(', ') + (incomplete.length > 1 ? ' are' : ' is') +
          ' missing inputs. Missing values are not treated as zero.' };
    }
    var exploratory = list.filter(function (p) { return !p.confirmed; });
    if (exploratory.length) {
      return { kind: 'unconfirmed', headline: 'Exploratory only: no ranking',
        detail: 'Totals are shown, but ' + exploratory.map(function (p) { return p.label; }).join(' and ') +
          (exploratory.length > 1 ? ' are' : ' is') + ' not confirmed by the owner, so no path is ranked.' };
    }
    var winner = null;
    list.forEach(function (p) {
      var below = list.every(function (o) { return o === p || p.high < o.low; });
      if (below) winner = p;
    });
    if (winner) {
      return { kind: 'clear', path: winner.id, headline: 'Lower estimated cost under these assumptions: ' + winner.label,
        detail: 'Its whole range sits below the ranges of the other two paths. This compares the figures entered; it is not a recommendation to repair, buy, sell or scrap.' };
    }
    return { kind: 'overlap', headline: 'No clear cost advantage under these assumptions.',
      detail: 'At least two path ranges overlap, so the figures entered do not separate them. The sensitivity check shows which inputs would narrow the ranges most.' };
  }

  // Main entry point.
  // input = { months, fields: {key: {low, high, fixed}}, dutyConfirmed,
  //           quote: { proposal: { status: 'pending'|'accepted'|'discarded' } } (or quotePending: true),
  //           disposal: { sale: {priceType, eligibility}, scrap: {...} } }
  // The app's own state object can be passed directly.
  function compute(input) {
    input = input || {};
    var monthsSt = readMonths(input.months);
    var monthsOk = monthsSt.status === 'ok';
    var months = monthsOk ? monthsSt.value : null;
    var statuses = fieldStatuses(input);
    var paths = {};
    PATH_ORDER.forEach(function (id) { paths[id] = computePath(id, statuses, months, monthsOk, input); });
    return {
      months: monthsSt,
      fields: statuses,
      paths: paths,
      result: decide(paths, monthsSt, input),
      sensitivity: monthsOk ? sensitivity(paths, statuses, months) : []
    };
  }

  var api = {
    FIELDS: FIELDS, PATHS: PATHS, PATH_ORDER: PATH_ORDER, PRICE_TYPES: PRICE_TYPES, MAX_MONTHS: MAX_MONTHS,
    parseAmount: parseAmount, readRange: readRange, readMonths: readMonths, compute: compute
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPEngine = api;
})(this);
