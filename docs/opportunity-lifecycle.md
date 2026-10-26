# Opportunity lifecycle

The sequence is Campaign → Pipeline / Funnel → Pipeline / Backup → Pipeline / Commit → Live Bid.
Moves go one stage forward or backward. Each opportunity keeps its existing opportunity and bid record IDs.

Each workspace contains its own fields and those of earlier stages. Future-stage columns and tender sections
are omitted from the column picker, saved views and detail page. Links from an earlier-stage list open that
stage's workspace; a link inside it opens the opportunity's current workspace.

An opportunity stays in every list it has reached, including after a backward move. Its Current stage column
identifies its present position. The furthest reached stage controls list membership; the current stage controls
which data is displayed or editable. Returning backward retains all saved later-stage data, and advancing again
reveals it. Master contains one row per opportunity, and dashboard totals continue counting the current stage
so earlier-list membership does not inflate totals.

Starter fields, to be refined with the sales team:

| Stage | Additional information |
| --- | --- |
| Campaign | Lead source, client need, key stakeholder, engagement notes |
| Funnel | Proposed solution, budget, qualification evidence, expected RFP date |
| Backup | Solution fit, buying process, competitive position, risks |
| Commit | Forecast close date, commitment evidence, resource/partner plan, bid handover |
| Live Bid | Existing tender synopsis, compliance, commercial information, milestones and submission workflow |

Common client, ownership and next-action information stays on the existing opportunity. Earlier custom
columns carry forward too; the existing shared Pipeline custom-column set starts at Funnel. New selectable
reference lists must use Settings > Masters.

Sales details are saved in `bids.lifecycle_data`. Writes merge individual fields under the API's row lock and
are audited. `bids.lifecycle_reached_sheet` retains the furthest stage; the migration recovers it from existing
sheet-move audit history. The local repository also recovers this history when hydrating an older snapshot.
Existing imports and direct-entry opportunities retain their current stage. This change adds no speculative
qualification gate: the sales team will define mandatory fields and approval criteria later.
