/*
 * SuprFleet Turning Point: fictional demo presets.
 *
 * Every figure, name and quote here is invented for the demo.
 * None of it is a market valuation, a real workshop or a real vehicle.
 */
(function (root) {
  'use strict';

  function fx(v) { return { fixed: true, low: String(v), high: String(v) }; }
  function rg(lo, hi) { return { fixed: false, low: String(lo), high: String(hi) }; }
  function blank(fixed) { return { fixed: !!fixed, low: '', high: '' }; }

  // Fictional quote texts used by the simulated extraction.
  var QUOTES = {
    truck: {
      text: [
        'SHREE GANESH DIESEL WORKS (fictional workshop)',
        'Quotation No. Q-1182            Date: 28 Oct 2026',
        'Vehicle: Demo truck A (fictional)',
        '',
        'Engine overhaul, labour ................ Rs 1,10,000',
        'Parts: piston kit, liners, gasket set .. Rs 1,65,000',
        'Turbocharger recondition ............... Rs   45,000',
        '',
        'Total estimate: Rs 3,20,000 (taxes as applicable)',
        'Validity: 15 days. Additional parts found damaged',
        'during work will be charged extra.'
      ].join('\n'),
      // What the canned "extraction" proposes. sourceText must appear in the quote text.
      proposal: [
        { key: 'amount', label: 'Repair amount (INR)', value: '320000', sourceText: 'Total estimate: Rs 3,20,000 (taxes as applicable)' },
        { key: 'workshop', label: 'Workshop', value: 'Shree Ganesh Diesel Works (fictional)', sourceText: 'SHREE GANESH DIESEL WORKS (fictional workshop)' },
        { key: 'date', label: 'Quote date', value: '2026-10-28', sourceText: 'Date: 28 Oct 2026' },
        { key: 'tax', label: 'Tax amount', value: '', sourceText: '', unsupported: 'Not stated in the quote ("taxes as applicable"). Left empty.' }
      ]
    },
    van: {
      text: [
        'OM SAI AUTO GARAGE (fictional workshop)',
        'Estimate Ref. E-0457             Date: 30 Oct 2026',
        'Vehicle: Demo van B (fictional)',
        '',
        'Clutch assembly replacement ............ Rs 38,000',
        'Gearbox bearing and seal kit ........... Rs 29,000',
        'Labour ................................. Rs 18,000',
        '',
        'Grand total: Rs 85,000',
        'Estimate only. Final bill may vary after inspection.'
      ].join('\n'),
      proposal: [
        { key: 'amount', label: 'Repair amount (INR)', value: '85000', sourceText: 'Grand total: Rs 85,000' },
        { key: 'workshop', label: 'Workshop', value: 'Om Sai Auto Garage (fictional)', sourceText: 'OM SAI AUTO GARAGE (fictional workshop)' },
        { key: 'date', label: 'Quote date', value: '2026-10-30', sourceText: 'Date: 30 Oct 2026' },
        { key: 'tax', label: 'Tax amount', value: '', sourceText: '', unsupported: 'Not mentioned in the quote. Left empty.' }
      ]
    }
  };

  var VEHICLES = {
    truck: {
      current: { type: 'Rigid truck, diesel (Demo truck A)', capacity: '16 t payload', duty: 'Intercity cargo, highway', km: '9,000 km per month' },
      replacement: { type: 'Rigid truck, diesel, new (demo candidate)', capacity: '16 t payload', duty: 'Intercity cargo, highway', km: '9,000 km per month' }
    },
    van: {
      current: { type: 'Panel van, CNG (Demo van B)', capacity: '1.2 t payload', duty: 'City last mile deliveries', km: '2,600 km per month' },
      replacement: { type: 'Panel van, electric (demo candidate)', capacity: '1.2 t payload', duty: 'City last mile deliveries', km: '2,600 km per month' }
    }
  };

  function truckFields() {
    return {
      repair: fx(320000),
      curRun: rg(78000, 84000),
      curAddRep: rg(300000, 450000),
      curEnd: rg(400000, 600000),
      newPrice: fx(2850000),
      newRun: rg(52000, 56000),
      newAddRep: rg(20000, 60000),
      newEnd: rg(1800000, 2100000),
      saleNet: rg(700000, 850000),
      scrapNet: rg(180000, 220000)
    };
  }

  function vanFields() {
    return {
      repair: fx(85000),
      curRun: rg(21000, 24000),
      curAddRep: rg(40000, 90000),
      curEnd: rg(120000, 180000),
      newPrice: fx(940000),
      newRun: rg(17000, 19000),
      newAddRep: rg(10000, 30000),
      newEnd: rg(450000, 550000),
      saleNet: rg(230000, 290000),
      scrapNet: rg(60000, 80000)
    };
  }

  function truckDisposal() {
    return {
      sale: { priceType: 'buyer_offer', source: 'Fictional dealer offer, Demo Motors', date: '2026-10-29', deductions: 'Brokerage and transfer paperwork (fictional) already deducted', eligibility: 'owner_confirmed' },
      scrap: { priceType: 'modelled', source: 'Fictional scrap estimate sheet', date: '2026-10-29', deductions: 'Towing to facility (fictional) already deducted', eligibility: 'owner_confirmed' }
    };
  }

  function vanDisposal() {
    return {
      sale: { priceType: 'listing', source: 'Fictional comparable listings', date: '2026-10-31', deductions: 'Listing fee (fictional) deducted; refurbishment unknown', eligibility: 'owner_confirmed' },
      scrap: { priceType: 'owner', source: 'Owner estimate', date: '2026-10-31', deductions: 'Towing unknown', eligibility: 'owner_confirmed' }
    };
  }

  function base(vehicle) {
    return {
      months: vehicle === 'truck' ? '24' : '36',
      vehicleKind: vehicle,
      vehicles: JSON.parse(JSON.stringify(VEHICLES[vehicle])),
      dutyConfirmed: true,
      fields: vehicle === 'truck' ? truckFields() : vanFields(),
      repairMeta: { workshop: '', date: '' },
      pastSpending: '',
      disposal: vehicle === 'truck' ? truckDisposal() : vanDisposal(),
      quote: { text: QUOTES[vehicle].text, proposal: null }
    };
  }

  // Mark the repair quote as accepted from the canned extraction.
  function acceptedQuote(s) {
    var q = QUOTES[s.vehicleKind];
    s.repairMeta = { workshop: q.proposal[1].value, date: q.proposal[2].value, origin: 'Accepted from simulated extraction' };
    s.quote.proposal = { status: 'accepted', items: JSON.parse(JSON.stringify(q.proposal)) };
    return s;
  }

  var PRESETS = {
    truck_complete: {
      label: 'Truck: complete comparison',
      build: function () { var s = acceptedQuote(base('truck')); s.pastSpending = '410000'; return s; }
    },
    van_overlap: {
      label: 'Van: overlapping ranges',
      build: function () { return acceptedQuote(base('van')); }
    },
    truck_missing: {
      label: 'Truck: missing data',
      build: function () {
        var s = acceptedQuote(base('truck'));
        s.fields.curEnd = blank(false);
        s.fields.scrapNet = blank(false);
        s.disposal.scrap = { priceType: '', source: '', date: '', deductions: '', eligibility: 'owner_confirmed' };
        return s;
      }
    },
    van_unreviewed: {
      label: 'Van: unreviewed quote',
      build: function () {
        var s = base('van');
        s.fields.repair = blank(true);
        s.quote.proposal = { status: 'pending', items: JSON.parse(JSON.stringify(QUOTES.van.proposal)) };
        return s;
      }
    },
    truck_unconfirmed: {
      label: 'Truck: eligibility unconfirmed',
      build: function () {
        var s = acceptedQuote(base('truck'));
        s.disposal.scrap.eligibility = 'unconfirmed';
        return s;
      }
    },
    blank_truck: {
      label: 'Blank truck case',
      build: function () {
        var s = base('truck');
        Object.keys(s.fields).forEach(function (k) { s.fields[k] = blank(k === 'repair' || k === 'newPrice'); });
        s.months = '';
        s.dutyConfirmed = false;
        s.disposal = {
          sale: { priceType: '', source: '', date: '', deductions: '', eligibility: 'unconfirmed' },
          scrap: { priceType: '', source: '', date: '', deductions: '', eligibility: 'unconfirmed' }
        };
        return s;
      }
    }
  };

  var api = { PRESETS: PRESETS, QUOTES: QUOTES, DEFAULT: 'truck_complete' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TPPresets = api;
})(this);
