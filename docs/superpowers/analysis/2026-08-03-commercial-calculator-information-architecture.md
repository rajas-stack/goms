# Commercial Calculator — Information Architecture Redesign

**Scope of this document:** no code, no React, no CRUD. This is a navigation and user-journey redesign, done before any further implementation, built around one reframing: **Commercial Calculator is two different products wearing one skin** — a Governance product (rules) and an Execution product (work) — and the current navigation presents them as six equal-weight peers instead of a dominant workflow with administration tucked behind it.

---

## 1. The reframing, sharpened one step further

The Governance/Execution split is correct. One thing sharpens it further: your own ideal journey —

```
Dashboard → Create BOQ → Select Opportunity → Load Department → Load Sales Person
  → Load Budget → Load EMD → Choose Products → Configure Commercials → Review
  → Proposal Preview → Approval → Generate Proposal → Send to Customer
```

(**Proposal Preview** added per your third adjustment — inserted between Review and Approval, so the customer-facing document is seen in its actual form *before* anyone requests or grants sign-off on it, not only after.)

— treats everything from Create BOQ through Send as one continuous journey applied to a single underlying entity (a BOQ/proposal). Today's implementation splits that journey across two disconnected surfaces: a form ("Create BOQ") that ends at Save/Submit, and a separate list-and-status screen ("BOQ Management") where approval happens through a manual status button and a `window.prompt()`. There is no Preview, Generate, or Send step anywhere yet.

**Revised per your first adjustment:** Create BOQ and BOQ Management stay as two separate top-level pages, not a merged nav entry — they represent different *intentions* (starting something new vs. finding/managing something that already exists), even though both operate on the same BOQ entity and the same underlying step sequence. The distinction that matters is: **two entry points, one journey.** A user who clicks "Create BOQ" starts the journey at step one. A user who opens BOQ Management, finds a proposal already in flight, and opens it re-enters that *same* journey at whatever step it's sitting at (Review, Preview, Approval, …) — not a different, disconnected screen. The earlier structural gaps this analysis flagged (no Opportunity link, approval-as-a-label-not-a-gate, no export, and now no preview) aren't separate defects — they're literally the missing steps of this one journey, regardless of which of the two pages you entered it from.

---

## 2. Every current screen, classified

For each: who opens it, how often, what decision it supports, and whether it earns top-level nav space.

| Screen / concept | Who | How often | Decision it supports | Admin or Execution | Verdict |
|---|---|---|---|---|---|
| **Dashboard** | Sales, pre-sales, management | Daily — the app's home | "What needs my attention right now" | Execution | **Primary page.** Already the right instinct (KPIs, queues, a small text-link row for admin surfaces) — the tab strip above it is what's undermining it by presenting those same admin surfaces as equal peers one click away. |
| **Create BOQ** | Sales, pre-sales | Every tender — the core, repeated unit of work | "What am I proposing, to whom, at what price" | Execution | **Primary page — kept separate from BOQ Management (adjustment 1).** Its own top-level entry point for *starting* a proposal, reached the way the original spec intended (a dominant "+ Create BOQ" action from the Dashboard). It should still carry the user through Review → Preview → Approval → Generate → Send as later steps of the same journey — it just isn't merged with BOQ Management's nav entry to do so. |
| **BOQ Management** | Sales, pre-sales, managers | Daily-ish — checking on things already in motion | "Where does each proposal stand, what needs action" | Execution | **Primary page, kept separate from Create BOQ (adjustment 1)** — a different intention (find/manage an existing proposal, not start a new one). Its list/search pane is exactly right and should stay a primary destination. Its detail pane, today, is a dead-end status-button screen — it should instead be the re-entry point into the *same* journey Create BOQ starts, picking up at whichever step (Review, Preview, Approval, Send) a given proposal is sitting at. |
| **SKU Catalog** | Whoever curates the price book (ops/product/finance) | Occasional — new SKU, price change | "What can we sell, and at what cost/price" | Governance | **Demoted to Administration → Configuration → Catalog.** Important, but not a daily-use surface — the Dashboard's own footer link already treats it this way; the top-level tab strip is what's fighting that. |
| **Masters (top-level tab)** | Admin/ops | Rare — setup, occasional edits | "What are the rules of the game" | Governance | **Dissolved as a top-level tab.** Everything under it becomes the Administration area, itself split into Configuration / Reference Data / Audit — see §3/§3.1. |
| — Hierarchy (Vertical/Product/Module/Feature) | Admin | Rare | Defines the catalog SKUs are generated from | Governance | **Administration → Configuration → Catalog**, alongside SKU Catalog itself. The most load-bearing governance data, but still not daily-use. |
| — SKU Categories / UOM / Billing Types / Tax Classes / Currencies | Admin | Very rare (small, low-cardinality tables) | Classification/reference only | Governance | **Administration → Reference Data**, one consolidated section. Five separate sub-tabs for tables with a handful of rows each, touched maybe quarterly, is more navigation than the content deserves. |
| — Approval Matrix | Admin (likely finance/sales leadership) | Rare to set, but high-stakes when set | Defines the discount-governance thresholds | Governance | **Administration → Configuration → Approval Matrix — kept distinct from Reference Data**, because changing it changes real financial risk exposure, unlike a UOM list. Its *output* (a line needing sign-off) should also surface as a step inside the Create BOQ journey, not only as configuration here. |
| — Product Editions + Edition↔Feature mapping | Admin | Rare | *Intended*: defines productized bundles. *Actual*: not consulted anywhere downstream (per the business-logic analysis) | Governance | **Administration → Configuration → Catalog, demoted — or hold off entirely** until the enforcement question from that earlier analysis is resolved. Placed in Configuration rather than Reference Data because it's meant to be a rule (what a bundle contains), not a flat lookup — but a dedicated tab for a rule nothing checks overstates what the screen actually does. |
| — Pre-Sales (master) | Admin | Very rare | A short list of names | Governance | **Administration → Reference Data.** A flat list with no rule attached — doesn't need its own nav slot. |
| **Audit Log (global, top-level tab)** | Admin/compliance/management | Occasional — investigation, periodic review | "What changed, by whom, why" | Governance | **Administration → Audit** — kept as its own third area, distinct from both Configuration and Reference Data (it's oversight/history, not a rule or a lookup), for the rare full-system review. |
| — Per-SKU audit history | Whoever's looking at that SKU | Occasional | Same, scoped to one SKU | Governance | **Already correctly a tab** inside the SKU detail view — no change. |
| — Per-BOQ status history | Sales/managers reviewing one proposal | Occasional | "Why is this proposal in the state it's in" | Execution-adjacent | **Currently missing.** Should be a section inside the Proposal detail view (the re-entry point described above), not something you have to leave the proposal to go find in a separate global log. |
| **SKU BOM editor** | Admin, while editing a SKU | Rare | What components a SKU mandatorily/optionally bundles | Governance | **Already correctly a tab** inside SKU detail. No change. |
| **Edition↔Feature mapping dialog** | Admin, while editing an Edition | Rare | Which features an edition includes | Governance | **Already correctly a dialog**, embedded from the Edition row. No change — though see the enforcement question above; a correctly-scoped dialog for an unused rule is still a dialog for an unused rule. |

---

## 3. Redesigned navigation

**Before** (six equal-weight tabs, governance and execution indistinguishable at a glance):

```
Dashboard | Create BOQ | BOQ Management | SKU Catalog | Masters | Audit Log
```

**After** — two zones, visually and structurally unequal on purpose. "Setup" renamed to **Administration**, matching the term this module already uses itself (the Dashboard's own footer link and the existing Masters sub-tab are both already called "Administration" — this is a rename toward existing internal convention, not a new term):

```
WORK  (primary nav — what a salesperson opens every day)
├── Dashboard          — home: queues, KPIs, "+ Create BOQ"
├── Create BOQ         — starts the journey: Opportunity → Department/Sales Person →
│                         Budget/EMD → Products → Configure Commercials → Review →
│                         Proposal Preview → Approval → Generate → Send
│                         (a separate top-level page — different intention from
│                         BOQ Management, per adjustment 1 — but the same journey)
└── BOQ Management     — finds/manages a proposal already in flight; opening one
                          re-enters the Create BOQ journey at whichever step it's
                          sitting at (Review/Preview/Approval/Send), now including
                          its status history inline, not a dead-end status screen

ADMINISTRATION  (secondary, admin-only — its own entry point, not a nav-bar peer)
├── Configuration      — rules that shape behavior:
│     ├── Catalog          Vertical → Product → Module → Feature, SKU Catalog itself,
│     │                    Product Editions + Edition↔Feature mapping
│     ├── Pricing          pricing *policy* (which price tier applies to which deal
│     │                    type/segment) — see §3.1, this is mostly not built yet
│     └── Approval Matrix  the discount-governance thresholds
├── Reference Data     — flat lookups with no attached rule:
│     Currencies, Units of Measure, Billing Types, Tax Classes, SKU Categories,
│     Pre-Sales
└── Audit              — global, cross-entity view for the rare full-system review
```

Two primary destinations instead of six. Everything an admin needs still exists — it's one level deeper, behind a single Administration entry point, matching how rarely it's actually opened relative to Dashboard/Create BOQ/BOQ Management.

### 3.1 Configuration vs. Reference Data — where the line actually falls

Your split is right and it exposes something worth naming rather than papering over: **"Catalog" and "Pricing" aren't clean today because the underlying SKU record mixes them.** A `CommercialSku` row today holds its identity/hierarchy link (Catalog concerns) and its eight price fields (Pricing concerns) as one flat record edited on one form. So, honestly:

- **Catalog** = what AMNEX sells: the Vertical/Product/Module/Feature hierarchy, the SKU Catalog's identity fields, Product Editions. This is a clean bucket.
- **Pricing**, as its own Configuration section distinct from Catalog, *should* eventually mean the **policy** of which price tier (Internal/Partner/Government/Enterprise/Corporate/List) applies to which kind of deal — that's the actual missing decision the earlier business-logic analysis flagged (six price tiers exist, nothing decides between them). Today, no such policy screen exists — the price *values* just live inside each SKU's own form. So for now, "Pricing" as a distinct Administration section is mostly aspirational: it's where that policy screen belongs once it's built, and until then the SKU Catalog form is the de facto (imperfect) home for pricing data.
- **Approval Matrix** stays its own section, not folded into either — it's a rule, but a higher-stakes one than a bundle definition, consistent with your instruction to keep it distinct.

This isn't a reason to delay the nav rename — it's a note that "Pricing" as a section will feel thin until the pricing-policy decision point gets built, and that's fine; the section existing now gives that future work a home instead of it landing back inside the SKU form by default.

---

## 4. What this reframing changes about the earlier findings

- **The Opportunity link** isn't an optional integration nicety anymore — it's the literal first step of the journey you described ("Select Opportunity"). Create BOQ can't start the way you want it to without it.
- **Approval enforcement** isn't a background validation rule — it's a named step in the journey ("Approval," now preceded by Proposal Preview). It belongs inside the same guided journey as something you do, not inside BOQ Management as a button you click past.
- **Document generation/send** isn't a "nice to have export feature" — it's the journey's actual last two steps. Without it, the journey has no ending.
- **Proposal Preview** (your third adjustment) is the missing step that makes Approval meaningful — today a document could be approved before anyone, including the approver, has seen its final customer-facing form. Sequencing Preview immediately before Approval means sign-off is always given against something real, not against a set of line items still in editable-form shape.

These were already the highest-value gaps identified earlier; this exercise confirms it from the navigation side independently: they're not missing *features*, they're missing *steps of the one workflow this module exists to support* — and now, per adjustment 1, they're steps that both top-level pages (Create BOQ and BOQ Management) lead into, not steps owned by only one of them.

---

## 5. What this document deliberately does not decide

No component boundaries, no visual design, no field-level UI. Adjustment 1 settles the question this section originally left open (Create BOQ and BOQ Management are two routes, not one merged one). What was still open — *how* those two routes share the middle-to-end steps without duplicating them — is resolved at the routing level in §6 below, since it's load-bearing enough to the IA that leaving it unresolved would make §3's nav diagram misleading. Everything below §6 is still one level short of code: no components, no field lists, no state shape.

## 6. How Create BOQ and BOQ Management share the journey

Two candidate shapes:

1. **A shared step-sequence UI mounted by both routes** — Create BOQ and BOQ Management each render the same Review/Preview/Approval/Generate/Send building block internally, passing it a BOQ id.
2. **One underlying proposal-detail route, addressed by BOQ id, that both entry points navigate *into*** — e.g. a route shaped like `.../boq/:id`. Create BOQ becomes purely the *start* of the journey (Opportunity → Customer → Products → Configure Commercials); the moment that produces a draft BOQ, it hands off by navigating to `.../boq/:id`. BOQ Management's list does the same thing when a row is opened. Review, Preview, Approval, Generate, and Send all live at that one route, entered at whichever step matches the BOQ's current status.

**Recommendation: option 2.** Option 1 means two independent places in the app can each hold their own copy of the Review/Preview/Approval/Generate/Send experience — exactly the shape that produces drift over time (this module already has one instance of that risk called out elsewhere: `Vertical` duplicated from Account Mapping's `WORK_VERTICALS` by value, kept in sync only by a same-day drift-detection test). Option 2 makes a BOQ's mid-to-late journey a property of *the record*, addressable by id, with exactly one implementation — Create BOQ and BOQ Management become two different **entry points** into it, not two different **owners** of it. This also matches how the rest of the journey already wants to behave: "re-enter this proposal at whatever step it's sitting at" is naturally a route-by-id concern, not a component-mounting concern.

This is still an IA-level call, not code — it says a BOQ has one home once it exists, reached two ways, and names the shape of that route. The next step past this document is the actual spec: the route's structure, what each step needs to load, and how status maps to which step opens by default — worth doing as a dedicated follow-up now that the shape above is settled, rather than folding it into this document.
