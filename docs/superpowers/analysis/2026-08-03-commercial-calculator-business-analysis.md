# Commercial Calculator — Business Analysis (Reverse Engineering)

**Purpose of this document:** answer "what should the Commercial Calculator actually be, and why?" — before any further code, UI, or architecture work. This is a critical audit of what exists today against three ground truths, ranked by authority:

1. **The FRS** (`GOMS_Product_Commercial_SKU_Management_FRS.docx`) — 38 numbered requirements, `PCS-001`…`PCS-038`. This is the only document that actually came from the business. It is terse — one line per requirement, no elaboration.
2. **The design spec** (`docs/superpowers/specs/2026-08-03-commercial-calculator-design.md`) — an *interpretation* of the FRS, produced during this project, that added structure, naming, and scope the FRS never stated (e.g. the entire BOQ lifecycle state machine, the Dashboard, the Masters CRUD engine, "Pre-Sales" as a role).
3. **The shipped code** — which in a few places has already drifted from both #1 and #2, and in several places builds real UI for a data shape that nothing downstream ever reads.

Where these three disagree, this document says so explicitly, and labels every capability with where it actually came from: **FRS**, **Spec** (introduced during design, not in the FRS text), or **Code** (introduced during implementation, not even in the spec).

---

## Phase 1 — Reverse-Engineering Every Entity, Field, Master, Relationship, Calculation, Screen, Workflow, Lifecycle, and Rule

### 1.1 The 12 Masters

| Master | Source | Why it exists / business problem | Who uses it, when | What depends on it | If removed | Required or nice-to-have? |
|---|---|---|---|---|---|---|
| **Verticals** | FRS implicit (`PCS-004`) + **Spec/Code redefined 2026-08-03** | The top of the product hierarchy, and the dimension sales already organizes around (Traffic, Transit, Smart City, …). Originally spec'd as an *empty, independently admin-populated* master; corrected same-day to be seeded from Account Mapping's `WORK_VERTICALS` — the same list every `Opportunity.vertical` free-text field already uses. | Everyone building a BOQ (Create BOQ's first cascading filter); Masters admin rarely, since the set rarely changes. | Products (FK), SKU code generation, Create BOQ's product/module/feature cascade, Dashboard-adjacent reporting (none exists yet by vertical). | The entire commercial catalog loses its top-level grouping; SKU codes lose their first segment; the Create BOQ picker has nothing to cascade from. | **Required** — FRS `PCS-004` names it explicitly as the top of a mandatory hierarchy. |
| **Products (CommercialProduct)** | FRS (`PCS-005`) + **Spec/Code seeded 2026-08-03** with AMNEX's real 23-product lineup | AMNEX's actual product lines (Locomate, Outline, Agrogate, …), one level below Vertical. Was spec'd empty; corrected same-day because an empty hierarchy made the redesigned Create BOQ picker unusable in a demo/first-use sense. | Same as Verticals — a filter step in Create BOQ and the Hierarchy admin screen. | Modules (FK), SKU code's second segment. | Products collapse into Verticals; SKU codes lose their second segment; no way to group Modules/Features by product line. | **Required** — `PCS-005`. |
| **Modules (ProductModule)** | FRS (`PCS-006`) | A Product's internal decomposition (e.g. Locomate → Ticketing, ETA Engine). Left empty by design — genuinely product-team-specific data nobody has entered yet. | Admin populates once per Product; Create BOQ's third cascade step. | Features (FK), SKU code's third segment. | Products and Features would need a direct FK, losing one level of granularity the FRS explicitly asks for. | **Required** — `PCS-006`, and structurally necessary since `CommercialProduct`→`ProductFeature` isn't a direct relationship anywhere in the code. |
| **Features (ProductFeature)** | FRS (`PCS-007`, `PCS-009`) | The actual sellable unit of granularity — a SKU is generated from exactly one Feature. Carries `status: existing\|modified\|new`, which is the one piece of hierarchy metadata the FRS calls out by name (`PCS-009`). | Sales/pre-sales, indirectly, every time they pick a line item in Create BOQ (the picker resolves Feature → SKU). Admin, when standing up a new Feature before a SKU can be created for it. | SKU code generation (4th segment + status suffix), audit trail (`PCS-010`: status changes require a reason). | No SKU could ever be created — this is the leaf that everything else hangs off. | **Required** — the single most load-bearing master in the system. |
| **SKU Categories** | FRS (`PCS-015`/`PCS-016`, 12 named defaults) | Classifies *what kind* of line item a SKU is (Software vs Hardware vs Training vs Professional Services, …) independent of the product hierarchy. | SKU creation (required field); SKU Catalog filter. | Nothing downstream computes differently by category — it's a descriptive/filter tag only. | SKU Catalog loses its category filter and category column; no calculation changes. | **Required by FRS name** (`PCS-016` lists all 12 by name) but **functionally decorative** today — no cost/pricing/approval/tax logic branches on category. |
| **Units of Measure** | FRS implicit under `PCS-017`'s field list ("UOM") | Answers "per what" (License, User, Month, Instance, Device, GB) — meaningful mostly for Subscription/Usage-Based billing types. | SKU creation (required); shown on SKU detail. | Nothing computationally — quantity × price math doesn't consult UOM at all; it's a label. | SKU detail loses a label; no calculation changes. | **Nice-to-have today, required-by-name in FRS** — present because `PCS-017` lists it as a Commercial Master column, but the system would compute identically without it. |
| **Product Editions** | FRS (`PCS-018`/`PCS-019`) | Standard/Professional/Enterprise/Government/OEM/Custom — meant to represent *productized bundles* of features (`PCS-019`: "each edition shall define a predefined set of modules/features"). | SKU creation (`editionId`, defaults to Standard); the one hand-written admin screen (`EditionFeatureMappingDialog`) lets an admin declare which Features belong to an Edition and whether each is mandatory/optional. | Nothing. **This is the analysis's first major finding: `PCS-019` is fully modeled (`ProductEditionFeature` junction) and fully built (a dedicated dialog, with its own tests) but the mapping it captures is never read anywhere else in the system** — not by SKU creation (which lets you pick *any* Feature regardless of the SKU's Edition), not by Create BOQ, not by any validation rule. | No behavior changes anywhere in the app today. | **`PCS-019` calls it required; the shipped implementation makes it inert** — see Phase 5. |
| **Billing Types** | FRS implicit under `PCS-017` | One-Time / Subscription / Usage-Based / Milestone-Based / Perpetual License — describes the commercial model of a SKU. | SKU creation (required field); shown on SKU detail. | Nothing computationally — no line-item math, invoicing schedule, or recurring-revenue logic reads it. | SKU detail loses a label. | **Required by FRS name, decorative in implementation** — same pattern as UOM. This is meaningful data with zero current consumers; see Phase 6. |
| **Tax Classes** | FRS (`PCS-017` "GST") — **generalized in Spec/Code beyond "GST"** | The FRS says "GST"; the implementation generalizes to a `ratePct`-bearing "Tax Class" (GST 18/12/5%, Exempt, Nil-Rated) — a sensible, minor widening since India has multiple GST slabs and exempt categories, not one flat "GST" toggle. | SKU creation (required); the rate is **snapshotted onto the BOQ line item at add-time** (`taxPct`) so a later rate-master edit never silently changes an already-quoted line. | Line total calculation (`quantity × unitPrice × (1-discount) × (1+tax)`), margin is computed pre-tax so tax doesn't affect margin. | Every line total loses its tax component; margin math is unaffected (already pre-tax). | **Required** — direct FRS ask, correctly implemented with sensible snapshot semantics. |
| **Approval Matrix** | FRS (`PCS-030`) | Configurable discount bands (0–10% auto, 10–25% Sales Head, 25–50% Regional Head, 50–90% CEO) — the FRS's entire discount-governance model in one master. | Every line added to a BOQ is auto-classified against this table (`resolveApprovalBand`). | `approvalStatus` on each line item; the "Approval Summary" section of Create BOQ; the Dashboard's implicit "Pending Approval" bucket. | Every discount would be auto-approved with no governance signal at all — this master is the entire enforcement mechanism the FRS asks for in `PCS-029`/`PCS-030`. | **Required** — but see Phase 4: the *signal* this master produces (`pending` vs `auto_approved`) is **never actually enforced** anywhere; a BOQ can be moved to `approved` at the document level with pending lines still unresolved. |
| **Currencies** | FRS (`PCS-027` "support multiple currencies") | INR (base), USD, EUR, GBP, each with a symbol, decimal places, and an `exchangeRate` relative to the base. | SKU creation (a SKU's prices are denominated in one currency); BOQ's `currency` field is denormalized from the *first* line's SKU currency at creation time. | Nothing consumes `exchangeRate` anywhere in the codebase — grep confirms it's written at seed time and read only by the Masters CRUD form, never by any calculation. | No visible behavior change — multi-currency BOQs already silently mis-total today (see Phase 4); removing FX conversion entirely would just make that honest. | **Required by FRS name, but the "support" is incomplete** — currencies can be tagged on a SKU, but nothing converts, blocks, or warns when a BOQ mixes SKUs in different currencies. |
| **Pre-Sales** | **Not in the FRS at all — introduced in the Spec** | A role (pre-sales engineer) the stakeholder wanted attached to a BOQ, with explicit note in the spec that "no Account Mapping equivalent exists." | Create BOQ's "Pre-Sales" dropdown (optional). | Nothing downstream — it's a label on the BOQ header, shown in the preview, never used in any calculation, approval, or reporting. | A BOQ loses one attribution field; no other behavior changes. | **Nice-to-have** — legitimate real-world need (pre-sales support tenders) but zero FRS backing and zero downstream consumption today; pure metadata. |
| **BU Sales** *(not a stored master)* | **Spec correction, §6.1.1** | Originally almost became a 13th master; corrected when it was discovered `SalesPosting.designation` in Account Mapping already encodes this (e.g. `"BU Sales Agriculture"`). Filtered from existing `salesPersons` by a substring match on designation. | Create BOQ's "BU Sales" dropdown. | Nothing downstream beyond attribution — same as Pre-Sales. | Same as Pre-Sales — a label disappears. | **Nice-to-have, correctly implemented as reuse rather than a duplicate list** — the one master-avoidance decision that is unambiguously right. |

### 1.2 CommercialSku — the Commercial/SKU Master unified table

The FRS treats "SKU Management" (`PCS-011`–014) and "Commercial Master" (`PCS-017`) as separate requirement *categories*, but `PCS-017`'s own field list already includes "SKU Code" — so the spec correctly merged them into one `CommercialSku` table rather than two normalized ones. Fields, grouped:

- **Identity** (`skuCode`, `name`, `categoryId`, `featureId`, `editionId`, `uomId`, `currencyId`, `taxClassId`, `billingTypeId`, `activeFrom/Till`, `lifecycleStatus`, `isSellable`) — **Required, FRS `PCS-011`–017.** `skuCode` is generated (`{Vertical}-{Product}-{Module}-{Feature}-{STATUS}`, `PCS-012`) and is the only immutable, uniqueness-enforced field in the whole module (`PCS-013`).
- **Cost Management** (8 fields: base software, implementation/MM, integration, third-party, hardware, cloud, support, training) — **Required, FRS `PCS-020`–025**, each explicitly named. These exist to answer "what does this cost AMNEX to deliver" — pure internal data, never customer-facing, and the only input to margin.
- **Pricing Levels** (7 fields: internal, floor, partner, government, enterprise, corporate, list) — **Required by FRS name (`PCS-026`)**, but **only `listPrice` and `floorPrice` are ever read by any calculation in the codebase.** `listPrice` is the only price a BOQ line ever uses; `floorPrice` is only consulted as the *default* for `minimumAllowedPrice` at SKU-creation time. Internal/Partner/Government/Enterprise/Corporate are captured, displayed on the SKU's Pricing tab, and never read again. This is this analysis's second major finding — detailed in Phase 3 and Phase 5.
- **Discount governance** (`minimumAllowedPrice`, `maximumDiscountPercent`) — **Code-introduced, not named in the FRS**, but a reasonable operationalization of `PCS-028` ("0–90% discount") and `PCS-029` ("validate against approval hierarchy") at the SKU level: a floor price no discount can cross, and a per-SKU discount ceiling that can only tighten the global 90%. Actually enforced (`addBoqLineItemLogic` throws if breached) — one of the module's few *hard* business rules.

### 1.3 CommercialBomItem (Commercial BOM)

**FRS `PCS-032`/`PCS-033`.** A parent SKU can declare other SKUs as mandatory or optional components (e.g. a software SKU that mandatorily needs an Implementation SKU, optionally needs a Training SKU). Edited per-SKU from the SKU Catalog's "BOM" tab (no longer a standalone module tab, per the 2026-08-03 redesign). **Used for:** the SKU Catalog's "Usage Count" column (how many other SKUs reference this one as a component) — that's it. **Not used for:** Create BOQ does not read a SKU's BOM when it's added to a proposal — adding "Locomate Core" to a BOQ does not pull in its mandatory components, expand a bundle, or warn that a mandatory dependency is missing. **This means `PCS-032`'s data model exists, but the actual business behavior it implies — a bundle automatically carrying its mandatory pieces into a quote — is not implemented.** Required by FRS name; partially implemented in effect.

### 1.4 CommercialBoq + CommercialBoqLineItem

This is the module's actual deliverable — the FRS's "Quote Composition" (`PCS-034`/035), renamed "BOQ" during design because, per the spec, "there is no 'Quote' terminology anywhere in the shipped module" (a deliberate stakeholder naming choice, not an FRS term — **Spec-introduced**).

- **`boqNumber`** — generated, year-scoped, immutable across all revisions (`PCS`-adjacent, not literally named in the FRS, which never mentions numbering at all — **Spec-introduced**, and a sensible one: every real quote/PO system numbers documents this way).
- **`opportunityName`** — **deliberately decoupled** from Account Mapping's existing `Opportunity.opportunityName`. This is the analysis's third major finding, expanded in Phase 4: a BOQ today has *no relationship whatsoever* to the sales pipeline that presumably produced the tender in the first place.
- **Customer block** (`customerName/Organization/Address/Gst/Contact`) — **free text, Code-introduced** beyond the spec's original `customerName`-only design, because no customer master exists anywhere in GOMS. Every BOQ re-types the same customer from scratch; nothing dedupes "Municipal Corporation of X" typed three different ways across three BOQs.
- **Budget/EMD fields** — **deliberately mirror** `Opportunity.valueAmount/valueUnit/budgetKnown` and `.emdAmount/emdUnit`, down to the exact conditional UI (`budgetKnown === 'no'` disables Budget Amount and reveals EMD-derived estimation) — corrected same-day (commit `814e989d`) specifically because the first draft didn't actually match Account Mapping's real behavior. Good reuse of *logic*, but note: these are **independent free-text fields re-entered per BOQ**, not read from the linked Opportunity (because there is no link).
- **`salesPersonId`/`buSalesPersonId`/`preSalesId`** — real FKs into Account Mapping's `salesPersons` (except Pre-Sales, which is this module's own new master). Correctly reused, per the spec's explicit "this is new code, so it gets the proper reference from day one" rationale — a real improvement over `Opportunity.salesPersonEmail`'s legacy free-text pattern.
- **Lifecycle** (`status`, `boqVersion`, `revisionNumber`, `parentBoqId`) — see §1.6.
- **`currency`/`grandTotal`** — denormalized/cached at generation and every line-change, "not authoritative" per the spec's own comment (i.e. trusted only as a display cache, always derivable from line items). `currency` is set once from the *first* line's SKU currency and never revisited — see Phase 4 for why that's a real bug, not just a simplification.

**Line item fields** (`quantity`, `unitPrice`, `discountPct`, `taxPct`, `lineTotal`, `approverName/Date/Remarks/Status`) — every calculation field here is exercised by real logic (`addBoqLineItemLogic`/`updateBoqLineItemLogic`); the four **approval fields are the FRS's `PCS-031`** ("store approver, approval date and remarks") **and are the analysis's fourth major finding: the schema and repository logic fully support setting them, but no screen in the shipped UI ever lets a user set them.** `updateBoqLineItemLogic` and its `useBoqLineItemMutations` hook exist, are tested, and have zero UI callers. A line can be flagged `pending` by the approval matrix and then sit there forever — see Phase 4/5.

### 1.5 CommercialAuditLog

**FRS `PCS-010`/`PCS-036`.** Append-only, written for: feature status changes (with mandatory reason), SKU lifecycle/cost/price changes (with mandatory reason), SKU/BOQ creation, and BOQ status transitions (with mandatory reason). **Not written for:** any other master's create/update (e.g. changing a Tax Class's rate, editing a Currency's exchange rate, editing a SKU Category's name) — which is actually *correct* per a literal reading of the FRS (`PCS-010` says Feature status specifically, `PCS-036` says "SKU, pricing and discount changes" specifically) but worth stating plainly: **general master-data edits are untracked, on purpose, matching what was actually asked for** — not a gap.

### 1.6 Lifecycles

- **SKU lifecycle** (`draft → active → inactive → retired`) — **FRS `PCS-037`** ("allow activation/deactivation"). Simple, unenforced-transition (any status can move to any other — no `SKU_TRANSITIONS` guard exists, unlike BOQ). Delete guard (`PCS-038`, "prevent deletion of SKUs referenced by quotations") is implemented and checked against both BOM items and BOQ line items.
- **BOQ lifecycle** (`draft → submitted → under_review → approved/rejected → archived`, plus `cancelled` from any non-terminal state) — **entirely Spec-introduced; the FRS never describes a quote/BOQ lifecycle at all**, only that SKUs are "exposed for quotation" (`PCS-034`). This is the single largest piece of *invented* business process in the whole module — a reasonable, ERP-conventional one, but one the business never actually specified in the FRS and that this analysis cannot verify matches AMNEX's real internal review process (does "Regional Head" actually sign off electronically today? does "under review" correspond to a real step, or was it added for CPQ-pattern completeness?). Flagged for stakeholder confirmation in Phase 4/6.

---

## Phase 2 — Data Lineage: Tender Receipt to Deal Close

Grouping fields by identical lineage rather than listing all 60+ individually — most cost/price/master fields share one lineage pattern.

### 2.1 The intended journey vs. the actual journey

**FRS-implied journey:** a tender arrives → it's quoted from this module's catalog (`PCS-002`/`003`: "single source of truth… all quotations shall consume commercial data from this module") → discounts flow through approval → a deal closes.

**Actual traced journey today:**

```
Opportunity created in Account Mapping (existing, separate record)
        │  ⚠ NO LINK — opportunityName/budget/EMD/customer are re-typed from scratch
        ▼
Create BOQ (Commercial Calculator)
  ├─ Opportunity Info: opportunityName (NEW, own uniqueness scope), department (FK reuse),
  │    vertical (FK, master), budget/EMD (mirrored logic, re-entered), salesPerson/buSales/preSales (FK reuse/new)
  ├─ Customer Info: customerName/org/address/GST/contact — ALL free text, no master, no reuse
  ├─ Commercial Configuration: Vertical → Product → Module → Feature cascade
  │    resolves to exactly one active+sellable SKU (by featureId) → user sets Qty + Discount%
  │    → line's unitPrice is HARD-CODED to sku.listPrice (no tier choice) → tax% read from sku.taxClassId
  │    → approval band resolved from discount% (informational only at this stage)
  └─ Save Draft | Save & Submit → CommercialBoq + CommercialBoqLineItem[] persisted
        │
        ▼
BOQ Management: manual status transitions (draft→submitted→under_review→approved/rejected→archived),
   each requiring a free-text reason typed into a window.prompt(), written to CommercialAuditLog
        │  ⚠ NO gate checks whether any line is still `pending` approval before the whole BOQ moves to `approved`
        │  ⚠ NO export/print/PDF — nothing customer-facing is ever produced
        ▼
"approved" or "rejected" — dead end.
  ⚠ Nothing writes back to the Opportunity (no stage change, no won/lost signal).
  ⚠ No invoicing, delivery, or actuals-vs-quoted tracking exists (arguably correctly out of scope for Phase 1-3,
    but "deal closed" per the user's framing has no representation anywhere in this module).
```

### 2.2 Field-by-field lineage (grouped)

| Field group | First created | Edited | Read | Used in calculation | Shown in UI | Duplicated elsewhere? | Actually used? |
|---|---|---|---|---|---|---|---|
| Hierarchy masters (Vertical/Product/Module/Feature) | Seeded at migration, or Masters/Hierarchy admin screen | Same screen; `changeReason` required only for Feature `status` | SKU creation form, Create BOQ cascade, SKU-code generation | SKU code string concatenation only | Hierarchy tree, SKU picker, SKU detail | Vertical duplicates Account Mapping's `WORK_VERTICALS` **by value**, not by reference — a second edit surface for conceptually the same list | Yes, fully |
| SKU cost fields (8) | SKU creation form | SKU edit form (`changeReason` required) | Margin calculations (SKU-level and BOQ-level) | `skuTotalUnitCost`, `computeSkuMarginPercent`, `computeBoqMarginPercent` | SKU Catalog "Costs" tab only — **never shown to whoever is building or reviewing a BOQ** | No | Yes, but only as an internal margin input never surfaced during the actual sales workflow |
| SKU price fields — `listPrice`, `floorPrice` | SKU creation form | SKU edit form | `listPrice`: BOQ line unit price (hard-coded), margin math. `floorPrice`: default for `minimumAllowedPrice` at creation only | Line total, margin, discount-floor validation | SKU Pricing tab, Create BOQ's picker (list price shown pre-add) | No | Yes |
| SKU price fields — internal/partner/government/enterprise/corporate (5) | SKU creation form | SKU edit form (`changeReason` required — so the audit machinery treats them as important) | Nowhere | Nowhere | SKU Pricing tab only | No | **No — write-only data.** Entered, audited on change, displayed on one detail tab, never read by any pricing or approval decision. |
| `discountPct` (line) | Create BOQ picker | Not editable after creation via any shipped UI (`updateBoqLineItemLogic` exists, unreachable) | Approval band resolution, line total | Line total, approval status | Line row, BOQ Preview, Approval Summary | No | Yes for creation; the update path is dead code from the UI's perspective |
| `taxPct` (line) | Snapshotted from `sku.taxClassId` at line-add time | Never (by design — "never retroactively changes") | Line total | Line total | Line row | No (deliberately, correctly, a point-in-time snapshot) | Yes |
| `approverName/Date/Remarks` (line) | Nowhere — no UI field ever sets them | Nowhere | Nowhere reads them for a decision | Nowhere | Nowhere (BOQ Management shows the *document's* status, never a line's approval fields) | No | **No — fully dead. FRS `PCS-031`'s literal ask has no UI at all.** |
| `approvalStatus` (line) | Set automatically at line-add from the Approval Matrix band | Recomputed automatically if `discountPct` changes via the (unreachable) update path | Approval Summary display | Nothing gates on it | Approval Summary (informational) | No | **Half-used** — computed and shown, never enforced |
| Budget/EMD | Create BOQ form | Not editable after BOQ creation | Nowhere computationally — display only | Nowhere | BOQ Preview | **Yes — re-entry of the same concept already captured (differently) on the linked-in-spirit-only `Opportunity`** | Display only |
| Customer block | Create BOQ form | Not editable after creation via shipped UI | Nowhere computationally | Nowhere | BOQ header, BOQ Management list/search | **Potentially — same customer likely already exists as an Employee/Department contact in Account Mapping, with no dedupe** | Display + search only |
| `currency`/`exchangeRate` | Currency master seed; `currency` denormalized at BOQ creation from first line's SKU | `exchangeRate` editable in Masters | `currency`: never re-derived after creation even as more lines are added. `exchangeRate`: never read by anything | Nowhere | BOQ list/detail (`currency` label next to totals) | No | **`exchangeRate`: fully dead. `currency`: read once, potentially wrong the moment a second SKU in a different currency is added — see Phase 4.** |
| `boqVersion`/`revisionNumber`/`parentBoqId` | BOQ creation / `reviseBoqLogic` | `reviseBoqLogic` only | BOQ Management detail (version label, Revise button gating) | Nothing computational | BOQ detail header | No | Yes |

---

## Phase 3 — Every Calculation, and Why It Exists

| Calculation | Why it exists | Who needs it | Who sees it | Internal or customer-facing | Business decision it supports |
|---|---|---|---|---|---|
| **Cost** (`skuTotalUnitCost` = sum of 8 cost fields) | AMNEX needs to know its own delivery cost, separate from any price it charges | Finance/product ops setting SKU prices | Internal only (SKU Catalog "Costs" tab) | **Internal** | "Can we afford to discount this far and still be profitable?" |
| **List Price** | The FRS's default, undiscounted, quotable price | Everyone building a BOQ | Effectively customer-facing (it's the *only* price tier that ever reaches a quote) | **Both** — internal reference and the de facto customer price before discount | The number every quote actually starts from |
| **Internal / Partner / Government / Enterprise / Corporate Price** | Presumably: different customer segments should see different starting prices (a government tender vs. an OEM partner vs. a large enterprise deal shouldn't all start from the same number) | Nobody today — see Phase 2 | Nobody — captured, never surfaced in the quoting flow | **Intended: customer-facing per-segment. Actual: neither — dead data.** | **None currently** — the business decision these fields imply ("which price ladder applies to this deal") is never actually made anywhere in the software. This is the clearest single symptom that the *pricing model* was designed more richly than the *quoting workflow* that was supposed to consume it. |
| **Margin** — SKU-level (`computeSkuMarginPercent`) and BOQ-level (`computeBoqMarginPercent`) | Always derived, never stored, per the spec's explicit "avoid staleness" principle — the single best-executed calculation in the module | SKU-level: whoever is pricing a SKU. BOQ-level: whoever is reviewing a proposal, and the Dashboard's "Average Margin" KPI | **Internal only** — never shown to a customer, correctly | Whether a proposed deal is profitable enough to submit/approve | Two different margins exist on purpose — SKU margin is at list price with no discount; BOQ margin is realized margin after the actual discount was applied — and they're computed with genuinely different formulas that happen to converge at 0% discount. This is correct and well-reasoned. |
| **Tax** (`taxPct`, snapshotted per line) | GST must be shown per line and included in the total the customer will actually be asked to pay | Finance, customer | **Customer-facing** (it's part of the number the customer sees) | The GST class chosen at line-add time, frozen for that line forever | Ensures a later GST rate change never rewrites a historical quote's tax burden |
| **Discount** (`discountPct`, clamped `[0, min(90, sku.maximumDiscountPercent)]`) | The FRS's `PCS-028` — sales needs room to negotiate, within a ceiling | Sales/pre-sales at negotiation time | **Customer-facing** (the discounted price is what they're offered) | Line total, approval band | "How much can we give away and still trigger the right sign-off" |
| **Approval Matrix** (band lookup by discount%) | The FRS's `PCS-029`/`030` — discounts above a threshold need a human decision from someone with authority | Sales Head / Regional Head / CEO, in theory | **Internal only** | Line's `approvalStatus` | *Intended*: gate whether a deal can proceed. *Actual*: a label with no gate — see Phase 4. |
| **Commercial Value** (Dashboard's "Total Commercial Value") | A single pipeline-health number for management | Management | **Internal only** (Dashboard KPI) | Sum of `grandTotal` across BOQs *not* in draft/cancelled/rejected/archived | "How much revenue is actively moving through the pipeline right now" |
| **Grand Total** (BOQ-level) | The number a customer is actually asked to pay | Sales, customer, finance | **Customer-facing** (conceptually — though nothing ever prints it to an actual customer-facing document, see Phase 6) | Sum of all line totals | The bottom line of the deal |
| **Budget** (mirrors `Opportunity.valueAmount/Unit/Known`) | Tracks what the customer said they can spend, independent of what AMNEX is proposing to charge | Sales, at qualification time | **Internal** (a negotiating reference, never shown to the customer) | Nothing computational — purely informational, re-entered from the Opportunity's own equivalent field | "Is our proposal even in the customer's stated range" — a sanity check that today requires a human to eyeball Budget against Grand Total; no automated flag exists if a BOQ's total wildly exceeds the stated budget |
| **EMD** (Earnest Money Deposit) | A government-tender-specific concept — the deposit a bidder puts up, used here (per Account Mapping's existing pattern) as a proxy to *estimate* the budget when it isn't confirmed | Sales, at qualification time, government/tender deals specifically | **Internal** | `formatBudgetRange` derives an estimated budget range from EMD, mirroring Account Mapping's existing logic exactly | Same purpose as Budget — a sizing signal, not consumed downstream |

---

## Phase 4 — Validating the Business Logic (Challenging Every Assumption)

Going feature by feature, asking whether a real salesperson/pre-sales/finance/management/customer would actually encounter this the way it's built.

**1. Would a salesperson actually use six of the seven price fields?** No — as shown in Phases 2–3, five of the seven pricing tiers are entered once at SKU setup and never touched again by anyone building an actual proposal. Either the quoting flow is missing a "which price tier applies" step (the FRS's PCS-026 arguably implies exactly that — why maintain a Government price if a government tender never actually uses it?), or those fields shouldn't exist yet. Today they add real data-entry burden (SKU creation asks for 7 numbers where the workflow uses 1) with zero payoff.

**2. Would finance actually accept a BOQ that mixes currencies?** No, and today nothing stops it. `currency` is denormalized from the *first* line's SKU at creation and never revisited; a second line added in a different currency silently gets summed into `grandTotal` as if it were the same currency, under a label that only describes the first line. This is a real correctness bug, not a simplification — it will produce a wrong number the moment a multi-currency BOQ is built, and multi-currency is exactly the scenario the Currencies master exists to support.

**3. Would management actually trust "Pending Approval" as a real gate?** No. The Approval Matrix correctly classifies a line as `pending` when its discount exceeds an auto-approve threshold — but `updateBoqStatusLogic` never checks line-level `approvalStatus` before allowing the *document* to move to `approved`. A user can add a 70%-discount line (flagged `pending`, `CEO` band), never set an approver, and still click "Approved" on the whole BOQ with an arbitrary typed-in reason. The FRS's `PCS-029` ("validate discounts against approval hierarchy") is not actually validated — it's displayed.

**4. Would a salesperson actually re-type the same customer for every BOQ?** Probably not happily, and it will produce data quality problems (the same government department entered three slightly different ways across three BOQs, with no dedupe, no link to the Employee/contact records Account Mapping already has for that department). This was an explicit, acknowledged simplification in the spec ("no customer master exists… revisit only if requested") — reasonable for a first cut, but worth flagging now since duplicate/inconsistent customer data compounds the longer it's deferred.

**5. Would a salesperson actually accept that a BOQ has nothing to do with their Opportunity?** This is the biggest open question. Today, a salesperson builds an Opportunity in Account Mapping to track a tender through its pipeline stages, and *separately* builds a BOQ in Commercial Calculator to price it — with no link between the two, and no shared identity even for "opportunity name" (both entities have a field of that exact name, scoped to different uniqueness domains, on purpose). A salesperson has to remember to do both, keep budget/EMD/customer consistent by hand across both, and there is no way to see "which BOQs exist for this Opportunity" or "which Opportunity does this BOQ belong to" anywhere in the UI. The spec left `linkedOpportunityId` as an explicit unbuilt seam — this is the single highest-leverage integration gap in the module, and it's a business-process gap, not just a technical one.

**6. Would a customer ever see any of this?** No document is ever produced. There's no "print," "export," or "generate PDF" anywhere in the module — the BOQ, once approved, exists only as rows in an in-memory table. If the entire point of an FRS titled "Commercial & SKU Management" whose category `PCS-034/035` is literally "Quote Composition" is to produce something a salesperson sends to a customer, **that artifact doesn't exist yet.** Everything upstream of it (catalog, pricing, discount, approval) is built; the actual deliverable is not.

**7. Would pre-sales/sales actually want the BOM's mandatory components enforced?** The Commercial BOM captures "if you sell X, Y is mandatory" — but Create BOQ doesn't consult it. A user can add "Locomate Core" without its mandatory Implementation component ever being suggested or required. This makes `PCS-032`'s Commercial BOM a pure catalog/reference feature today rather than an enforced bundling rule.

**8. Does the BOQ lifecycle (7 states, with the "Regional Head"/"CEO" approval-level labels baked into the Approval Matrix's seed data) actually reflect AMNEX's real internal review process?** This analysis cannot confirm or deny that — it was authored during design, not sourced from the FRS, and should be validated with whoever actually runs discount approvals today before more workflow is built on top of it.

---

## Phase 5 — Dead / Partial / Duplicated Functionality

| Feature | Why it exists | Actually used? | Partially implemented? | Duplicated? | Unnecessary? | Recommendation |
|---|---|---|---|---|---|---|
| Internal / Partner / Government / Enterprise / Corporate SKU prices | FRS `PCS-026` names them | **No** — never read by any calculation or UI flow past the SKU form | — | — | Not unnecessary in concept, but currently pure overhead | **Redesign**: add a price-tier selector to Create BOQ's line picker so these fields actually drive a decision, or **Remove** down to List+Floor until that's built |
| `ProductEditionFeature` mapping + `EditionFeatureMappingDialog` | FRS `PCS-019` | **No** — fully built (own dialog, own tests, own repository logic) but never consulted by SKU creation or Create BOQ | Yes — data model + admin UI exist, enforcement doesn't | No | No | **Redesign**: either make a SKU's `featureId` choices actually constrained by its Edition's mapped features, or **Remove** the dialog until that enforcement is built — an admin screen that changes nothing is worse than no screen, because it implies a guarantee that doesn't exist |
| Per-line `approverName`/`approvalDate`/`approvalRemarks` + `updateBoqLineItemLogic` | FRS `PCS-031`, "High" priority | **No** — zero UI writes these fields; the mutation hook exists and is untested-by-UI | Yes — schema, repository logic, and a React Query hook exist; no screen calls them | No | No — this is the FRS's most concrete, explicit ask in the whole Approval category | **Redesign, priority**: build the actual per-line approve/reject action (set approver, date, remarks; transition `approvalStatus`) — this is the single most under-built high-priority FRS requirement in the module |
| BOQ-level `approved` transition with unresolved `pending` lines | Spec-introduced lifecycle | Reachable today with no guard | Yes | No | No | **Redesign**: block (or at minimum warn loudly on) a document-level `approved` transition while any line is still `pending` |
| `exchangeRate` on Currency | FRS `PCS-027` | **No** — never read | — | — | Not unnecessary in concept | **Redesign**: either implement real FX conversion for mixed-currency BOQs, or constrain a BOQ to one currency at line-add time (cheaper, safer near-term fix) |
| Commercial BOM mandatory/optional components not auto-applied in Create BOQ | FRS `PCS-032`/`033` | Reference-only | Yes | No | No | **Redesign**: when a SKU with mandatory BOM components is added to a BOQ, surface/require them |
| Customer free-text block, no master, no dedupe | Spec-acknowledged gap | Yes, but low quality over time | By design for Phase 1-3 | Risk of duplicating Account Mapping's Employee/contact data | No | **Defer**, but flag: revisit once repeat customers across BOQs become common enough to hurt search/reporting |
| BOQ ↔ Opportunity, `linkedOpportunityId` | Spec-left seam | **No** — not built | Explicitly deferred | Two "opportunity name" concepts, no shared identity | No | **Redesign, priority**: this is the module's biggest structural gap for real adoption — see Phase 6 |
| No BOQ export/print/PDF | Implied by FRS's "Quote Composition" framing | **No** — doesn't exist | Fully missing | No | No — arguably the actual point of the module | **Redesign, priority**: without this, nothing produced by the module ever reaches a customer |
| SKU Categories / UOM / Billing Type as descriptive-only masters | FRS names them explicitly | Yes, as filters/labels | Correctly scoped — FRS never asks them to drive calculations | No | No | **Keep** — these are legitimately just classification masters; not everything needs to compute something |
| Duplicate BOQ action | **Code-introduced**, not in FRS or original spec | Yes, wired and used | No | No | No | **Keep** — a genuinely useful, low-risk addition (start a new proposal from a similar past one) |
| Pre-Sales / BU Sales attribution fields | Spec-introduced (Pre-Sales) / Spec-corrected reuse (BU Sales) | Display-only, never drives logic | By design | No | No | **Keep** — legitimate attribution/accountability data even without downstream computation |
| `Vertical`/`Product` re-seeded as a second copy of Account Mapping data | Corrected 2026-08-03 fix | Yes | A guard (`if VERTICALS.length !== WORK_VERTICALS.length…`) catches drift at import time, but the two lists are still maintained by hand in two places | **Yes — genuinely duplicated data**, mitigated by a drift-detection assertion rather than a single source of truth | No | **Redesign, longer-term**: once Account Mapping migrates into `src/modules/`, Vertical should probably become one shared reference, not two hand-synced lists with a test as the only safety net |

---

## Phase 6 — Validating Against Reality: What Would a From-Scratch Design Look Like?

**If AMNEX were building this today, with no existing code to anchor on:**

**I would build the catalog exactly as it is.** The Vertical→Product→Module→Feature hierarchy, generated/immutable SKU codes, cost-vs-price separation, and derived-never-stored margin are all textbook-correct CPQ (Configure-Price-Quote) patterns, and the FRS asks for precisely this. No changes here.

**I would not build six pricing tiers before building the one workflow step that chooses between them.** Right now the module has more pricing *data* than pricing *decisions*. I'd either cut Internal/Partner/Government/Enterprise/Corporate down to just List + Floor until a real "which tier applies to this deal" step exists in Create BOQ, or build that step now, before more SKUs get seeded with numbers nobody will ever look at again.

**I would build the Opportunity↔BOQ link before building more BOQ lifecycle.** The module's stated purpose (`PCS-002`/003: "single source of truth… all quotations shall consume commercial data from this module") only matters if BOQs are reachable from the sales process that creates the need for them. Today a salesperson has to remember two separate systems hold two separate truths about the same deal. This is under-engineered relative to everything else in the module, and it's the thing that most determines whether this tool gets adopted or bypassed.

**I would build the actual per-line approval action before adding more lifecycle states around it.** `PCS-031` is explicit and "High" priority; today it's the least-built high-priority requirement in the FRS. A CEO-level discount sitting silently `pending` forever, with a document that can still be marked `approved` around it, is worse than not tracking approval status at all — it creates the appearance of governance without the substance.

**I would build a document export before calling the workflow "done."** A CPQ tool that ends at "BOQ approved," a row in a table, with nothing a human can hand to a customer, hasn't finished the job the FRS implies. This is likely the single most visible gap to a real user: they go through the whole guided workflow and get… nothing to send.

**I would treat the Approval Matrix's org labels (Sales Head / Regional Head / CEO) as a hypothesis, not a fact**, and confirm them against whoever actually signs off on discounts at AMNEX today before building more automation on top of them.

**Over-engineered relative to what's actually consumed today:** the six-tier pricing model; the Product Edition↔Feature mandatory/optional mapping; full multi-currency support without conversion; the BOQ `boqVersion`/`revisionNumber`/`duplicate` three-way distinction (useful, but more nuance than most early adopters will exercise before the simpler features above exist).

**Under-engineered relative to the FRS's own stated priorities:** the per-line approval action (`PCS-031`, High); enforcement of the approval hierarchy at the document level (`PCS-029`, High); any link back to the sales pipeline that originates the tender in the first place; any customer-facing output artifact at all.

**Missing outright:** a way to know, for an approved BOQ, whether the deal was actually won — the module's notion of "done" is a status label, not a business outcome.

---

## Summary — What Should the Commercial Calculator Actually Be?

A centralized catalog (Vertical→Product→Module→Feature→SKU, with cost/price/tax/discount data) that produces **one governed, exportable proposal document per tender**, linked to the Opportunity that created the need for it, with discount approval that is actually enforced rather than merely labeled. Today's implementation has built the catalog extremely well, has built more pricing *data* than the workflow uses, and has left the two things that make this a *complete* commercial process — real approval enforcement and a link to the sales pipeline plus an actual output document — as the biggest open gaps. Those three items (approval enforcement, Opportunity linkage, document export) are the highest-value next investments; the six-tier pricing model and the Edition/Feature mapping are the biggest candidates for either being cut back or finally being wired up to a real decision point.

---

## Phase 7 — Control Classification: Informational, Advisory, or Enforced

For every control that falls out of the FRS's 38 requirements — including the ones the FRS never states explicitly but that are a direct logical consequence of one it does — three levels are possible:

- **Inform** — display the fact; never interrupt the user.
- **Advisory** — warn, but let the user proceed anyway (an override, not a gate).
- **Enforced** — block the action until the condition is satisfied. No override.

Legend for the "why" behind each call:

- **✅** — the FRS text itself justifies this level with little room for a different reading (it uses "shall," "prevent," "validate," or names the exact concept), **and** its stated priority (High/Medium) is noted where it strengthens or weakens the case.
- **⚠️** — the FRS is silent on this exact control; this is a design recommendation, not a requirement. Flagged for business confirmation, not treated as settled.
- **?** — genuinely unresolved even as a recommendation; a business decision is needed before this can be classified at all.

### Module scope

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Quote/BOQ line items must come from the catalog, never free-text/off-catalog entries |  |  | ✅ | `PCS-002`/`003` (both High): "act as the single source of truth," "**all** quotations shall consume commercial data from this module." Explicit "shall," no qualifier — this is the FRS's foundational control. |

### Product Hierarchy

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Product must reference a valid Vertical; Module a valid Product; Feature a valid Module | | | ✅ | `PCS-005`/`006`/`007` (all High): "each X **belongs to one** Y." A referential rule stated this plainly can't be advisory — "belongs to one" that can be skipped isn't a rule. |
| Deleting a hierarchy node that still has children underneath it | | | ✅ | Not literally stated, but the only reading of `PCS-005`–`007` that stays true over time — if a Vertical can be deleted while Products still point to it, "belongs to one Vertical" becomes false the moment it happens. ⚠️ in the sense that the *delete guard* itself isn't named in the FRS, but ✅ that some guard is required to keep 005–007 true. |
| Hierarchy stays configurable without a code deployment | N/A — architectural constraint on the *system*, not a runtime control on a *user action*. `PCS-008`, High, is a build-time requirement, not something with an Inform/Advisory/Enforced axis. |

### Product Status

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Feature status change (`existing→modified→new`) requires a captured reason | | | ⚠️ | `PCS-010` (**Medium**, notably lower than most of this FRS) says "maintain audit trail for status changes" — it requires the *trail to exist*, not literally that the change be *blocked* absent a reason. Recommending Enforced anyway, because an audit entry with no reason isn't really an audit trail — but the Medium priority and the FRS's phrasing ("maintain," not "prevent"/"validate") mean this is a design call, not a hard FRS mandate. |

### SKU Management

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| A commercially sellable line item cannot exist without a generated SKU | | | ✅ | `PCS-011`, High: "shall generate a unique SKU for **every** commercially sellable line item." |
| SKU code must match the `Vertical-Product-Module-Feature-Status` format | | | ✅ | `PCS-012`, High, "shall be" — moot as a runtime control since the code is system-generated, never user-typed, but the generation logic itself must not deviate. |
| Duplicate SKU codes | | | ✅ | `PCS-013`, High: "**Prevent** duplicate SKU codes" — the FRS's own verb is the enforcement level. |
| SKU without a hierarchy link | | | ✅ | `PCS-014`, High: "**Link every** SKU to the product hierarchy." |

### Commercial Master (SKU field completeness)

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| SKU marked sellable/active without all `PCS-017` fields populated (Category, Edition, UOM, Currency, GST, Billing Type, Effective Date) | | ? | ? | `PCS-017` (High) says "maintain" these fields — it never says they're mandatory *before* a SKU can be sold, nor does it define what "sellable" requires. Genuinely unresolved without asking the business how strict the price book needs to be before something can go live. |

### Product Editions

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| A SKU's Feature must belong to its assigned Edition's predefined feature set | | ⚠️ | ⚠️ | `PCS-019` (**Medium**): "each edition **shall define** a predefined set of modules/features." That mandates the *definition* exist (✅ for capturing the mapping at all) but never says catalog/quote assignment must be *restricted* to it. If Editions are meant to be fixed packages (consistent with naming tiers like Government/OEM/Custom in `PCS-018`), this should Enforce; if they're just an informational grouping, Advisory suffices. Medium priority suggests the business itself didn't see this as critical — leaning Advisory, but flagged for confirmation. |
| A mandatory feature of an Edition is missing from a SKU/quote built under that Edition | | ⚠️ | ⚠️ | Same reasoning and same open question as above — depends on the same clarification. |

### Cost Management

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| SKU saved or made sellable with cost fields left at zero/unpopulated | | ⚠️ | | `PCS-020`–`025` (High/Medium) require costs to be *maintained separately*, not that they be non-zero before sale. Recommending Advisory (flag an unusually-zero cost SKU) rather than Enforced, since some line items (e.g. a bundled freebie) may legitimately have zero cost — blocking those would be wrong. |

### Pricing

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| List Price at or below total cost (negative/zero margin) | | ⚠️ | | Not addressed anywhere in the FRS. A loss-leader SKU may be intentional, so blocking is too strong — but letting it pass silently hides a real financial decision. Pure design recommendation. |
| Discounted unit price falls below the Floor Price | | | ✅ | `PCS-026` (High) names "Floor" as one of the maintained price tiers by name. A "floor" that can be crossed isn't a floor — the term itself carries the enforcement level; FRS doesn't spell out the mechanism, but the concept has no other coherent reading. |
| Government/Partner/Enterprise/Corporate price tier not selected for a matching customer/deal type | | ⚠️ | | `PCS-026` maintains these tiers but never states a rule for *which* deal type must use *which* tier. Requires clarification of AMNEX's actual pricing policy before this can be more than a soft nudge. |
| A single quote/BOQ mixes SKUs priced in different currencies | | ⚠️ | ⚠️ | `PCS-027` (**Medium**) says "support multiple currencies" — it addresses the catalog supporting several currencies overall, not a single quote spanning them with conversion (no FX-conversion requirement exists anywhere in the FRS). Leaning Enforced as the safer design default (block mixed-currency lines in one document) over building real currency conversion nobody asked for — but this is a recommendation, not a requirement, and the Medium priority suggests multi-currency wasn't a top business concern to begin with. |

### Discount & Approval

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Discount percentage outside the configured 0–90% band | | | ✅ | `PCS-028`, High: "support configurable discounts **from 0% to 90%**" — a ceiling stated this specifically is a hard bound, not a suggestion. |
| Discount above its approval-matrix threshold finalized without the required sign-off | | | ✅ | `PCS-029`, High: "**Validate** discounts against approval hierarchy." "Validate" is enforcement language, not a display verb — this is the FRS's central control and the clearest ✅ in the whole document. |
| Approver / approval date / remarks missing when a line requires approval | | | ✅ | `PCS-031`, High: "**Store** approver, approval date and remarks." Directly required for `PCS-029`'s validation to mean anything — without these fields populated there's nothing to validate against. |
| Whole document advanced to "Approved" while any line still shows unresolved approval | | | ✅ | Not itself an FRS line — the document-level lifecycle (draft/submitted/under review/approved/…) is entirely a design-spec addition, not FRS-specified at all. But *given* that lifecycle exists, letting it bypass an unresolved `PCS-029` control defeats a High-priority FRS requirement. Flagging both halves honestly: the lifecycle itself is unrequested scope; the gate on it, if the lifecycle exists, should be Enforced. |

### Commercial BOM

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Mandatory BOM component missing when the parent SKU is added to a quote | | ⚠️ | ? | `PCS-032`, Medium: "support… mandatory and optional components." "Mandatory" is suggestive, but the FRS never states what happens *at quote time* if a mandatory component isn't included — genuinely open until the business says whether "mandatory" means "required in the catalog record" or "required in every quote." |
| Optional BOM component (`PCS-033`: Integrations/Third Party/Hardware/Cloud/Support) included or excluded | ✅ | | | By definition — the FRS's own word for these is "optional" (`PCS-033`, Medium). No gate of any kind is coherent here; Inform is the only sensible level. |

### Quote Composition

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Line item references an inactive or non-sellable SKU | | | ✅ | `PCS-034`, High: "expose **active** SKUs for quotation." The word "active" is a scoping rule — inactive SKUs are excluded from quotation by definition, not merely discouraged. |
| Line item missing Quantity, Price, Discount, or Tax before counting toward the Total | | | ✅ | `PCS-035`, High: "shall support multiple SKU line items with Quantity, Price, Discount, Tax **and** Total" — lists these as the required shape of a valid line, not optional detail. |
| BOQ total exceeds the customer's stated budget | | ⚠️ | | Matches the example given: "Budget" isn't mentioned anywhere in the FRS at all — it's mirrored in from Account Mapping's `Opportunity` data, not an FRS concept. Purely a design recommendation; Advisory is the least-surprising default since a stated budget is a negotiating data point, not a legal ceiling on what AMNEX may propose. |
| A quote/BOQ exists with no link to a tracked Opportunity/tender | | ⚠️ | | Not addressable from the FRS at all — the FRS never mentions a separate tender-tracking concept; this only matters because Account Mapping happens to have one. Zero FRS grounding, flagged purely because it's the integration gap raised in Phase 4/6. |

### Audit

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| SKU/pricing/discount change saved without a captured reason | | | ✅ | `PCS-036`, High: "Maintain audit logs for SKU, pricing and discount changes." As with `PCS-010`, the FRS mandates the *log*, not explicitly a *block* absent a reason — but at High priority, and given a reasonless audit entry provides no real audit value, this is the one Medium/High-priority pair where the recommendation is confident enough for a full ✅ rather than a hedge. |

### Administration

| Control | Inform | Advisory | Enforced | Notes |
|---|---|---|---|---|
| Deactivating a SKU currently referenced by an open (non-final) quote | | ⚠️ | | `PCS-037`, High: "**Allow** activation/deactivation of SKUs" — phrased as a granted permission, not a restriction. No FRS basis for blocking this; a soft courtesy warning is the most this control deserves. |
| Deleting a SKU referenced by any quotation | | | ✅ | `PCS-038`, High: "**Prevent** deletion of SKUs referenced by quotations." The single most literally-worded Enforced control in the entire FRS — explicit verb, explicit condition, no hedging possible. |

### What this table shows in aggregate

The FRS is confident and explicit (✅, Enforced) almost exclusively where it uses "shall," "prevent," or "validate," and almost always at **High** priority: catalog integrity, SKU uniqueness/linkage, the 0–90% discount ceiling, the approval-hierarchy validation, active-SKU-only quoting, line-item completeness, and the SKU delete guard. Every place this table lands on Advisory or a genuine "?" is either a **Medium**-priority FRS item (Editions, multi-currency, Commercial BOM) or a concept the FRS never mentions at all (Budget, Opportunity linkage, mixed currency, margin floors). That split is itself informative: **the FRS's own priority ratings already predict which controls deserve a hard gate and which don't** — the controls this analysis's Phase 4/5 found un-enforced in the shipped module (`PCS-029`/`031`'s approval gate, the Floor Price gate) are exactly the High-priority, "shall/validate/prevent"-worded ones, not the ambiguous ones. The gap isn't a judgment-call area being under-built — it's the FRS's most explicit, highest-priority requirements being the ones left as labels instead of gates.
