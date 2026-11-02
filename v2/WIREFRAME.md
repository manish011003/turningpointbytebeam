# Turning Point v2: screen and step map

The v1 prototype in the project root is unchanged. This folder is the redesign.
`js/engine.js`, `js/explain.js` and `js/presets.js` are byte-identical copies of v1
(checked by `v2/tests/regression.js`). Only `index.html`, `styles.css` and `js/app.js` are new.

## Journey

```
 #home ──► #start ──► #quote ──► #assumptions ──► #compare
              ▲___________ Back / Edit / stepper links, any order ___________│
```

One in-memory case. Every stage is reachable at any time from the stepper; nothing is
cleared by moving around. "Continue" is the one primary action per stage and is never disabled:
an incomplete comparison can always be opened and shows what is missing.

## Shell (all stages except home)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Turning Point   [Fictional data] [Cash only]   Example ▾  Reset  Home │  discreet labels
├──────────────────────────────────────────────────────────────────────┤
│ ①Start      ②Repair quote     ③Assumptions      ④Compare             │  stepper = nav
│  Complete    Review needed     3 missing         Incomplete          │  text status
├──────────────────────────────────────────────────────────────────────┤
│ [Guided walkthrough, example only, skippable, collapsible]           │
│ ... stage content ...                                                │
│ [← Back]                                        [Continue to … →]    │
├──────────────────────────────────────────────────────────────────────┤
│ ▸ Limitations (expander)                                             │
└──────────────────────────────────────────────────────────────────────┘
```

## #home  Start a decision

```
 Compare three cost ranges for one vehicle.
 ┌─────────────────────────┐ ┌─────────────────────────┐
 │ Explore a fictional     │ │ Start a blank decision  │
 │ example   (optional     │ │ Nothing pre-filled, no  │
 │ guided walkthrough)     │ │ confirmations set.      │
 │ [Explore example]       │ │ [Start blank]           │
 └─────────────────────────┘ └─────────────────────────┘
 [Continue current decision]  (only if a case exists)
```

## ① #start  Vehicle, duty, horizon

```
 Comparison period  [ 24 ] months
 ┌ Detail ───────┬ Current vehicle ┬ Replacement candidate ┐   stacks on mobile
 │ Type          │ [          ]    │ [                  ]  │
 │ Capacity      │ ...                                     │
 │ Intended duty │ ...                                     │
 │ Expected use  │ ...                                     │
 └───────────────┴─────────────────┴───────────────────────┘
 [ ] I confirm the replacement can do the same duty and capacity
 Primary: Continue to repair quote
```

## ② #quote  Repair quote

```
 Sample quote ─► Simulated extraction ─► Owner review          (3 mini steps)
 State A  no proposal : sample quote text, [Run simulated extraction]
                        or "enter the quote yourself" (amount, workshop, date)
          blank case  : choose a fictional sample first
 State B  pending     : proposed fields table (editable) + source text
                        [Accept these values] [Discard]
 State C  accepted    : ✔ ₹3,20,000 · workshop · date · origin   [Edit] [View source]
                        Edit  → amount/range, workshop, date
                        View source → proposed vs current value, source text, quote
                        amount changed after acceptance → "Edited since extraction"
 Primary: Continue to assumptions
```

## ③ #assumptions  Current costs, replacement costs, disposal evidence

```
 Aligned rows, one column per option          (mobile: each cell becomes a card)
 ┌ Line (unit)               ┬ Repair and keep ┬ Replace ──────┐
 │ Running costs, ₹ / month  │ [   ]           │ [   ]          │  "Over 24 months: …"
 │ Additional repairs, total │ [   ]           │ [   ]          │
 │ End value (subtracted)    │ [   ]           │ [   ]          │
 │ Cash price, paid once     │  –              │ [   ]          │
 │ Repair quote              │ read-only+Edit  │  –             │
 └───────────────────────────┴─────────────────┴────────────────┘
 Each amount: one exact figure by default, "Enter a range" switch.
 Disposal evidence:  [Sell whole card] [Scrap card]
   net proceeds · price type · source · date · deductions · eligibility
 ▸ Optional: past repair spending (history only)
 Primary: View comparison  (or "View incomplete comparison")
```

## ④ #compare  Compare options

```
 <Vehicle> · <N months>
 Status line (e.g. "No clear cost advantage under these assumptions.")
 ┌ one shared-scale range chart: 3 bars, hatched = exploratory, text for n/a ┐
 ┌ Repair & keep ┐ ┌ Replace & sell whole ┐ ┌ Replace & scrap ┐
 │ ₹a to ₹b      │ │ ₹a to ₹b             │ │ Total unavailable│
 │ Complete ·    │ │ Exploratory:         │ │ Missing: net     │
 │ Quote only    │ │ eligibility          │ │ scrap [Fix]      │
 │ ▸ Arithmetic  │ │ ▸ Arithmetic         │ │ ▸ Arithmetic     │
 │ ▸ Evidence    │ │ ▸ Evidence           │ │ ▸ Evidence       │
 └───────────────┘ └──────────────────────┘ └──────────────────┘
 What could change this result?
   input · path · total at low → high · change   [Edit input]  → jumps to field
 Highlight "Lower estimated cost under these assumptions" only when the engine
 says ranges separate AND all paths are complete and confirmed.
```

## Guided walkthrough (example only)

Banner, "Fictional example, invented figures". Skip / Resume / Reset. Steps tick off from
real state, never by the guide acting:
1. Review and accept the sample quote.
2. Open Compare and inspect the three paths.
3. Edit the repair cost or sale estimate; guide shows before and after from the engine.
4. Clear the net sale proceeds; Replace and sell becomes incomplete.
5. Load the van example to see overlapping ranges.
