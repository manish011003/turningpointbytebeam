// Run: node v2/tests/regression.js   (no dependencies)
'use strict';
var fs = require('fs'), path = require('path'), assert = require('assert');
var v2 = path.join(__dirname, '..'), v1 = path.join(v2, '..');

['engine.js', 'explain.js', 'presets.js'].forEach(function (f) {
  assert.strictEqual(fs.readFileSync(path.join(v2, 'js', f), 'utf8'), fs.readFileSync(path.join(v1, 'js', f), 'utf8'),
    f + ' differs from v1');
});

var E = require('../js/engine.js'), P = require('../js/presets.js'), X = require('../js/explain.js');
var r = E.compute(P.PRESETS.truck_complete.build());
var got = {};
['keep', 'sell', 'scrap'].forEach(function (id) { got[id] = X.range(r.paths[id].low, r.paths[id].high); });
assert.deepStrictEqual(got, {
  keep: '₹18,92,000 to ₹23,86,000',
  sell: '₹11,68,000 to ₹17,54,000',
  scrap: '₹17,98,000 to ₹22,74,000'
});
assert.strictEqual(r.result.kind, 'clear');
assert.strictEqual(r.result.path, 'sell');
assert.strictEqual(E.compute(P.PRESETS.van_overlap.build()).result.kind, 'overlap');
console.log('ok: engine files identical to v1; truck totals unchanged', got);
