# Commercial Calculator — IA Review, Round 2: Is "Governance" Actually Right?

**Scope:** no code. This re-examines the Governance sidebar just implemented, against a harder question than last round: not "is this cleaner than six flat tabs" (it is), but "does this reflect how the business actually thinks about this work, or does it just group screens by technical similarity dressed up as a sidebar." Answering the six questions asked, in order, then a persona walkthrough, then a recommendation — reversing part of the previous round's decision where the evidence points that way.

---

## 1. Should the application be organized around business workflows or around configuration/data types?

Workflows, primarily — and the Work/Governance split already got this half right. The part that didn't get scrutinized closely enough is **what's inside Governance**. Right now, Governance is organized by *data type* wearing workflow-shaped clothing: "Configuration" (Hierarchy, SKU Catalog) vs. "Commercial Rules" (Product Editions, Approval Matrix) vs. "Reference Data" (six lookup tables) vs. "Audit" — that's a taxonomy of *what kind of record this is*, not of *who touches it and why*. A user doesn't think "I need to edit a rule today"; they think "I need to add a SKU" or "I need to set up next quarter's discount policy" — and those two tasks, despite both currently living under "Governance," belong to different people, at wildly different frequencies, for different reasons. Grouping by data type was the mistake carried over from the original `Masters` tab into `Governance` — the label changed, the underlying organizing principle didn't.

## 2. Which screens are daily operational work, and which are only occasional configuration?

| Screen | Who | How often | Nature |
|---|---|---|---|
| Dashboard | Sales, Pre-Sales, Managers | Daily | Operational |
| Create BOQ | Sales, Pre-Sales | Every tender | Operational |
| BOQ Management + proposal detail (Overview/Approvals/Preview) | Sales, Pre-Sales, Managers | Daily-ish | Operational |
| **Hierarchy** | Commercial/Product Ops | Regularly — whenever a new product line or feature needs cataloging | **Their primary work**, not occasional |
| **SKU Catalog** | Commercial/Product Ops | Regularly — new SKU, price/cost change | **Their primary work**, not occasional |
| **Product Editions** | Commercial/Product Ops | Regularly — new bundle/edition | **Their primary work**, not occasional |
| Approval Matrix | Finance / Sales leadership | Rare — set once, revisited maybe quarterly | Genuinely occasional |
| Reference Data (Currencies, UOM, Tax Classes, Billing Types, Pre-Sales) | True admin | Rare — set up once, touched almost never | Genuinely occasional |
| Audit Log (global) | Compliance / Manager | Occasional — investigation, periodic review | Genuinely occasional |

The bolded three rows are the finding that matters. **"Occasional configuration" is the wrong description for Hierarchy/SKU Catalog/Product Editions.** They're occasional *from a salesperson's point of view* — which is exactly the point of view that got baked into the label "Governance" (a word that means "the rules other people set for me," i.e., a Sales-centric framing). From the Commercial/Product Ops person's point of view, these three screens *are* their Create-BOQ-equivalent: the thing they open regularly to do their actual job. Calling their daily tool "Governance" alongside a currency list they touch once a year is the same category error as calling Create BOQ "Governance" from a Product Ops person's point of view would be.

## 3. Does it make sense for Hierarchy and SKU Catalog to live inside "Governance," or are they core business modules that deserve their own section?

**No, and yes** — they deserve their own section. This is the central correction this round. Hierarchy and SKU Catalog aren't *rules that govern behavior* (that's what Approval Matrix is); they're the **catalog itself** — the actual definition of what AMNEX sells. Every mainstream CPQ/ERP product draws this line the same way: a distinct "Product Catalog" area, separate from "Approval Rules" and separate from "Setup/Settings" (Salesforce CPQ, SAP, NetSuite, Dynamics all do this). Folding the catalog into a "Governance" bucket alongside a five-row Pre-Sales name list is the over-grouping the fourth question is asking about, and it's real.

**Product Editions moves too, and this reverses a call I made last round.** I'd placed it with Approval Matrix under "Commercial Rules" on the reasoning that both are "rules, not flat lookups." That reasoning used the wrong axis — *rule-vs-lookup* isn't what should decide placement; *who does this and how often* is, per Question 2. By that test, Product Editions is edited by the same Commercial/Product Ops person, at the same rough cadence, as Hierarchy and SKU Catalog — it belongs with them, not with the genuinely-rare, genuinely-different-persona Approval Matrix.

## 4. If customers/clients eventually use this system too, what should each role see?

GOMS has no RBAC today — this can't be enforced yet, but the IA should already be *shaped* so that enforcement is a filter, not a redesign, once it exists.

- **Sales / Pre-Sales**: Dashboard, Create BOQ, BOQ Management. They *reference* the catalog constantly (which SKU, at what price) but never *edit* it — Create BOQ's own cascading picker already serves that reference need without sending them to a Catalog screen at all.
- **Commercial / Product Ops**: Dashboard (their own view of it — pipeline health, not personal queues), plus full access to Catalog.
- **Finance / Sales leadership (Managers)**: Dashboard, the Approvals surface (see the gap noted below), occasional access to Approval Matrix.
- **True admin**: Settings (Reference Data), Audit.
- **Customer/client** (hypothetical future): a narrow, *separate* surface — their own BOQ(s), read-only, probably just the Preview tab's content. Critically: this is easiest to build cleanly if the proposal-detail route (already built) stays self-contained and nothing from Catalog/Settings ever leaks into it. That's an argument for keeping Catalog and Settings **structurally separate** from the Work zone, not softened by convenience shortcuts later.

This is also the strongest argument for splitting Catalog out from Settings specifically: a future "give Commercial Ops broader access but keep true system settings admin-only" permission boundary lines up exactly with a Catalog/Settings split and does not line up with a single "Governance" bucket containing both.

## 5. Are we over-grouping unrelated concepts under a single "Governance" section?

Yes. Listed out, "Governance" currently holds: the product taxonomy, the price book, bundle definitions, discount policy, five unrelated lookup tables (currency/tax/UOM/billing-type/pre-sales), and a change-history log. Six meaningfully different concerns, unified only by *not being one of the three Work tabs* — an organizing principle defined by exclusion, not by a positive shared identity. Told "click Governance," a new user has no way to predict whether they'll find the price book or a currency list. That's the actual failure mode Question 6 is pointing at, and it's independent of how clean the sidebar mechanics are underneath it.

## 6. Is there a better navigation structure?

Yes — and it's simpler than adding a fourth nested layer. Drop the "Governance" umbrella entirely. Split its contents into **two peer top-level tabs**, sitting alongside Dashboard/Create BOQ/BOQ Management, not nested under either of them:

```
[Dashboard] [Create BOQ] [BOQ Management]  |  [Catalog] [Settings]
```

- **Catalog** — Hierarchy, SKU Catalog, Product Editions. Commercial/Product Ops's regular workspace — the "what we sell" module.
- **Settings** — Approval Matrix, Reference Data (Currencies/UOM/Tax Classes/Billing Types/Pre-Sales), Audit Log. Genuinely rare, genuinely policy/admin.

Why this beats the nested Governance structure:

- **No umbrella-term problem.** Last round spent real effort finding a word that wouldn't collide with a sub-group name ("Administration" vs. "Configuration" vs. "Governance"). That problem only exists because there's a wrapper tab that needs a name distinct from its children. Remove the wrapper — "Catalog" and "Settings" are self-explanatory as peers, no collision possible, no bikeshedding needed.
- **One fewer click for the people who actually live in Catalog.** Commercial/Product Ops currently reaches SKU Catalog via Governance → Configuration → SKU Catalog. Under this structure it's one click: Catalog → SKU Catalog. For the persona whose *primary* job this is, that's not a nitpick.
- **Matches the "understand immediately" bar.** Five self-descriptive labels beat four labels where one ("Governance") requires a click-through to learn what's behind it. Nominally one more top-level item; net less cognitive load, which is the actual measure of simplicity that matters here.
- **Still visually de-emphasized without being hidden.** Catalog and Settings can sit after a small visual gap in the tab strip, or in a slightly muted style, so Dashboard/Create BOQ/BOQ Management still read as "the app" at a glance — without requiring an extra click to discover what's behind a vague label. This preserves the primary-vs-secondary instinct from last round's design while dropping the parts that weren't working.
- **Scales cleanly by the same rule that fixed Product Editions.** Every hypothetical future screen (Pricing Policies, Proposal Templates, Workflow Rules, Notifications) has one unambiguous question to answer — *who does this, how often* — and that question routes it correctly: Pricing Policy → Settings (rare, Finance-set). Proposal Templates → Settings for editing; selected inline in Create BOQ, not a nav destination. Workflow Rules → Settings. This is a more reliable routing rule than "is it a rule or a lookup," which is what produced the Product Editions misplacement last round.
- **Audit stays inside Settings** rather than becoming a fourth top-level zone — it's low-frequency for everyone and doesn't carry enough independent weight to justify its own tab; folding it into Settings keeps the top-level count at five instead of six. (Judgment call, not a forced one — if Audit usage turns out to be more manager-driven than expected, it could earn its own slot later.)

---

## Persona walkthrough (sanity check against the proposed structure)

- **Sales person**: lives in Dashboard/Create BOQ/BOQ Management. Never opens Catalog or Settings. Sees prices via Create BOQ's own picker, never needs to "go somewhere else" to reference the catalog.
- **Pre-Sales engineer**: same three tabs as Sales; occasionally opens Catalog *read-only* (checking a SKU's BOM or an Edition's feature set before advising Sales) — one click away now instead of two, and no need to learn what "Governance" contains first.
- **Commercial/Product Ops**: Catalog is effectively their Create-BOQ-equivalent — their name for "my work" is now visible on the tab bar instead of buried behind a Sales-centric label.
- **Manager**: Dashboard (pipeline, KPIs), BOQ Management/proposal detail (the Approvals tab built last phase), occasional Settings → Approval Matrix visits. **Gap worth naming, not fixed by this reorg**: there's no single cross-BOQ "things waiting on my approval" queue today — a manager has to open each BOQ individually and check its Approvals tab. Dashboard's existing "Pending Approvals" group lists BOQs by document status, not by unresolved line-level approvals specifically. Worth a future look, not a nav-structure problem to solve here.
- **True admin**: Settings only, essentially never anywhere else.
- **Hypothetical customer**: a narrow, separate surface outside this whole structure entirely — reinforcing that Catalog/Settings should stay cleanly out of the Work zone's own routes (which they already are, structurally).

---

## What changes vs. what was right last round

**Keep:** the Work/non-Work split at the top level; the underlying data-driven sidebar mechanism (a plain nav-group array + a lookup-map for content, so adding a future screen is still two data entries, never new tab-strip code); Reference Data as one consolidated group rather than five sub-tabs; Audit as its own group rather than merged into a lookup table.

**Change:** drop the single "Governance" tab. Split it into two top-level peers, **Catalog** and **Settings**, each internally using the same sidebar pattern already built. Move **Product Editions** from where it sits today (grouped with Approval Matrix) into **Catalog**, alongside Hierarchy and SKU Catalog — reversing last round's "rule vs. lookup" placement logic in favor of the "who does this, how often" test this round applied consistently.

This is a recommendation, not an implementation — no code changes have been made. Ready to write the implementation plan once this structure is confirmed.
