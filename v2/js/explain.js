/*
 * SuprFleet Turning Point: deterministic explanation templates.
 *
 * Sentences are filled only from engine output and the owner's own records.
 * No generated text, no model calls, no advice.
 */
(function (root) {
  'use strict';

  var E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.TPEngine;

  // INR with Indian digit grouping. Negative values use a true minus sign.
  function inr(n) {
    if (n === null || n === undefined || isNaN(n)) return 'unknown';
    var sign = n < 0 ? '−' : '';
    var abs = Math.round(Math.abs(n));
    return sign + '₹' + abs.toLocaleString('en-IN');
  }

  function range(lo, hi) {
    if (lo === null || hi === null) return 'unknown';
    return lo === hi ? inr(lo) : inr(lo) + ' to ' + inr(hi);
  }

  function evidenceNote(ev) {
    ev = ev || {};
    var notes = [];
    switch (ev.priceType) {
      case 'buyer_offer': notes.push('Buyer offer for this vehicle; check its validity date and conditions.'); break;
      case 'listing': notes.push('Listing asking price for a comparable vehicle. It is not a completed sale price.'); break;
      case 'modelled': notes.push('Modelled estimate. Weaker evidence than an offer for this vehicle.'); break;
      case 'owner': notes.push("Owner's own estimate."); break;
      default: notes.push('Price type not recorded, so this value is not used.');
    }
    if (!ev.source || !ev.date) notes.push('Source or date not recorded.');
    return notes;
  }

  // One short paragraph per path, in three parts: records, assumptions, gaps.
  function pathSummary(path, state, months) {
    var parts = [];
    if (path.complete) {
      parts.push(path.label + ': estimated net cost ' + range(path.low, path.high) + ' over ' + months + ' months.');
    } else {
      parts.push(path.label + ': total unavailable.');
    }
    var used = path.lines.filter(function (l) { return l.status === 'ok'; });
    if (used.length) {
      parts.push('Uses ' + used.map(function (l) {
        var amt = l.monthly ? range(l.perMonthLow, l.perMonthHigh) + ' per month' : range(l.low, l.high);
        return (l.sign === '-' ? 'minus ' : '') + l.label.toLowerCase() + ' ' + amt;
      }).join(', ') + '.');
    }
    if (path.id === 'keep' && state.repairMeta && state.repairMeta.workshop) {
      parts.push('Repair quote recorded from ' + state.repairMeta.workshop +
        (state.repairMeta.date ? ', dated ' + state.repairMeta.date : '') + '; a quote is a cost estimate, not a final bill.');
    }
    if (path.missing.length) {
      parts.push('Missing: ' + path.missing.map(function (m) { return m.label.toLowerCase() + ' (' + m.reason + ')'; }).join('; ') + '.');
    }
    if (path.exploratoryReasons.length) {
      parts.push('Exploratory: ' + path.exploratoryReasons.join('; ') + '.');
    }
    if (path.complete && path.low < 0) {
      parts.push('A negative figure means the estimated end value and proceeds exceed the costs entered for this horizon. It is not a profit forecast.');
    }
    return parts.join(' ');
  }

  function sensitivitySentence(row) {
    return 'Moving ' + row.label.toLowerCase() + ' from its low to its high value changes ' + row.pathLabel.toLowerCase() +
      ' from ' + inr(row.totalAtLow) + ' to ' + inr(row.totalAtHigh) + ', with other ranges held at their midpoints.';
  }

  var api = { inr: inr, range: range, evidenceNote: evidenceNote, pathSummary: pathSummary, sensitivitySentence: sensitivitySentence };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPExplain = api;
})(this);
