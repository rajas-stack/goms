# Insights

The sidebar opens `/insights`. Existing `/analytics` bookmarks still work. The original Sales Team Insights and Relationship Analytics are retained alongside the eight requested views. No sample opportunities or screenshot totals are seeded into the application.

## Sample Data

Open `/insights?demo=1`, or enable the Sample data switch, to explore the eight new views with 192 synthetic records across 24 months. The shared calculation/filtering engine powers all demo metrics, charts, trends, prior-period comparisons, states, teams, competitors, forecast, drill-through and pagination. A Sample data badge and sample-prefixed export filenames distinguish these from live records.

Sample records exist only in memory: demo mode disables live Insights queries and never inserts or edits database/IndexedDB records. Import switches to live data before opening the existing authentication-protected import flow; it never imports into sample records. Opportunity names, statuses and actions open read-only sample Overview, General and Competition previews instead of nonexistent Bid Tracker URLs. Refresh regenerates the date-relative sample set. Clear filters retains sample mode; switching data sources resets incompatible filters. Switch Sample data off to return to live statistics. The two retained legacy analytics views continue to use their existing real data sources.

For the requested visual-review phase, an initial visit with no saved data-source choice starts with clearly labeled samples. The sample/live preference is remembered in this browser when reopening Insights from the sidebar, including an explicit choice to return to live data. `?demo=1` explicitly selects samples; `?demo=0` explicitly selects live records. The toolbar always identifies the current data source. This preference stores no business records.

The stage chart follows the supplied visual reference: paired dark-blue/cyan gradient columns, top value labels, vertical/horizontal grid lines, independent value/count axes and a two-series swatch legend. Column widths remain bounded with a single stage. On mobile, the plot scrolls inside its panel to keep labels readable. A stage with no usable recorded value says Not recorded, rather than inventing an amount or presenting missing data as a priced zero. Existing project stage names are retained.

## Chart Micro-Interactions

The eight Insights views and the retained Sales Team/Relationship chart primitives share contextual previews. Stage columns use a 300/25 spring to scale to 1.04; donut segments move outward 4-5px; horizontal bars gain 12% visual height. Unrelated marks dim to 0.55. Trend points reveal a marker and tracking line, areas brighten, and states gain a navy fill/border. KPI sparklines reveal period/value markers without scaling their cards.

Hover and keyboard focus show one translucent, blur-backed tooltip at a time with exact existing values. Desktop tooltips sit beside the entire plot (right first, then left), leaving its marks unobstructed. Narrow screens fall back below/above the plot, bounded to the viewport. Tooltips ignore pointer events and dismiss on Escape, scrolling, outside taps, data replacement or unmount. Touch retains chart drill/filter actions; individual sparkline points can be tapped to inspect values. On a focused headline button, Left/Right inspect monthly sparkline periods and Enter retains the record drill. Reduced-motion settings remove scaling, translation and CSS transitions. No new chart engine, business calculations, data changes, card shadows or fabricated statistics are introduced.

Chart marks share color-independent glossy materials: illuminated caps, reflected highlights, deeper bases and fading area fills. Bars retain their existing series/background colors; donuts, lines, sparklines and map states use local SVG paint definitions with unique IDs. Theme tokens soften the base shade and strengthen readable edges in night mode without changing the application theme or coloring chart cards. Reflections and depth are confined to chart marks; the dashboard surfaces remain shadow-free.

## Screenshot Coverage And Sources

| Design element | Implemented behavior and source |
| --- | --- |
| Insights sidebar / mobile menu | Opens the permission-gated Insights page; active module is indicated |
| Overview, Sales, Presales, Bids, Revenue, Competitors, Team, Forecast | Separate working views with URL-persisted navigation; existing analytics remain available |
| Search, account menu, Import | Existing application shell and import flow; Insights also filters opportunity names, departments and owners |
| Export | CSV of the current filtered, authorized records; uses the existing formula-safe CSV and platform download utilities |
| Period / vertical / state filters | Last 3/6/12/24 calendar months or all time; values from actual records; Central Ministries (state 0) remains distinct from All States |
| Total Pipeline | Recorded INR value of open, nonarchived opportunities with bids, deduplicated by opportunity ID |
| Weighted Pipeline | The same open records multiplied by their persisted opportunity stage's configured probability |
| Bid Win Rate | Won / (won + lost); dropped and undecided records are not losses; no decided outcomes displays Not available |
| Active Opportunities | Open opportunity and bid stages; archived or closed bid rows excluded |
| KPI sparklines / period deltas | Monthly creation-cohort metrics and comparison with the preceding creation cohort; not historical point-in-time snapshots |
| Opportunity Pipeline by Stage | Actual Bid Tracker stages, current value and count, including closed stages; dual independent axes; Both/Value/Count controls and source-record drill-through |
| Pipeline by Vertical | Donut and legend from active pipeline; each segment/legend opens its records |
| Pipeline by Department | Ranked active-pipeline bars, percentages, Top/Top 10/All selection and source records |
| Opportunity Trend | Monthly/quarterly creation events and current won/lost outcomes on recorded closure dates, in value or count; older opportunities closed in the period are retained for drill-through |
| Geographic Distribution | Existing India state GeoJSON projected with D3; state shapes apply filters, ranked bars open records; no geography is fabricated |
| Recent Opportunities | Only rows in Opportunity > Bid Tracker, in opportunity creation order, with department, value, bid stage and the shared attention flag; Pipeline/Campaign rows do not enter this list |
| Recent status / opportunity link | Opens that exact bid's Overview; uses the same attention computation as the grid and detail header |
| Recent View All / row menu | Searchable, paged record dialog; Overview, General and Competition links use existing bid routes |
| Individual bid screenshot | Reuses the existing department/logo/city header, opportunity title, attention badge and Master Grid link |
| Key Insights strip | Deterministic period comparison, win-rate/outcome summary, at-risk value/count and highest-valued active opportunity; source-record links, not an unimplemented AI claim |

## Additional Views

- **Sales:** opportunities by their resolved sales owner, trend and recent records.
- **Presales:** assigned presales workload, current bid stages and recent records. Existing solution-lead ownership is the fallback when no presales assignment exists.
- **Bids:** stage distribution, actual attention-status distribution and bid navigation.
- **Revenue:** won opportunity value and won value by department, with closure trends. This is not invoiced, collected or recognized revenue; no ledger exists in the current source data.
- **Competitors:** entered competitor names in each bid's saved Competition grid, associated opportunity exposure and competition-coverage counts. Exposure is not a prediction of a competitor's win probability.
- **Team:** recorded bid-team, presales and sales-owner workload, with value/count modes and record links.
- **Forecast:** nominal/weighted open pipeline grouped by recorded due quarter and sales owner. This is a stage-probability estimate, not an invented sales target or time-series prediction. Undated records remain Unscheduled.

## Backend And Data Rules

`insights.dashboard` requires both Operational analytics read permission and access to an opportunity sheet. It calls the real `bids.listForGrid` procedure with its full registered path, retaining the existing sheet mask before joining any additional data. SQL enrichment queries use only authorized IDs and parameterized arrays. There are no per-row network/database queries.

Shared calculations live in `packages/domain/src/insights.ts`; local IndexedDB and remote PostgreSQL modes use the same definitions. The query refreshes when the page remounts, the window regains focus, every minute while open, and on explicit refresh. Existing permission-tree nodes are preserved and all new tabs are registered in the generated manifest.

Money is normalized to INR crore using recorded units. Blank/invalid amounts, unknown units and non-INR currencies are excluded from monetary totals, but remain visible in counts; no exchange rate or estimated price is invented. Unknown stage weights contribute zero to weighted value. Values and stages are current facts: earlier value revisions and full historical stage snapshots cannot be reconstructed from the available grid data. All-time trend rendering is bounded to the latest 60 calendar months.

Date filtering selects opportunity creation cohorts. Current calendar-month cohorts run through the displayed as-of date; the preceding cohort contains the prior calendar periods. Stage charts include closed records, while pipeline headline, vertical, department and state visuals exclude them. Current-year/period changes are not claimed to be audited historical pipeline growth. Risk means an open record whose existing attention flag is not On Track; Overdue, Due Soon and Review Pending retain their distinct labels.

## Verification

- 20 shared metric regressions cover units, invalid prices/currency, probabilities, wins/losses, state 0, filters, archived/duplicate records, creation cohorts, closure events, attention, forecast grouping and competition parsing.
- Five API unit tests cover authorization requirements, denied/empty grid reads, restricted enrichment IDs, full nested policy path, conversions and input limits.
- Two disposable-PostgreSQL tests exercise the real router with RBAC enforcement, compare the resulting status with the real grid, and reject anonymous/no-role callers.
- 18 dashboard component tests cover the eight views, retained analytics, headline statistics, panels, filters, navigation, the Bid Tracker-only recent list, CSV/import/refresh, empty/loading/error states and permission-hidden tabs.
- 16 Chromium smoke tests pass across all requested visuals/views and their interactions, including desktop/mobile/night screenshots, period persistence, every headline and insight, source-record drill-through, row navigation, export/import and the sidebar/mobile menu.
- Sample mode adds two dataset regressions, two component tests and two browser workflows for live-query isolation, restoration of live totals, sample previews, all eight views, pagination, filters, export and responsive layout.
- The reference-style stage chart adds three component regressions for gradient series/value labels, unpriced versus zero amounts, integer count axes and keyboard drill-through. Two dashboard tests cover the two-series legend and remembered sample/live preference; a browser visual regression captures the stage panel on desktop/mobile and checks reopening Insights.
- The complete logic/domain suite passed all 1,241 tests. Five additional browser regressions passed for both URLs, the new rail entry, Account Mapping navigation and global search.
- Micro-interaction regressions cover exact tooltips, focus/hover parity, zero-value inspection, source-record activation, single-tooltip ownership, Escape/scroll/data-change cleanup, KPI period keys, retained analytics, mobile touch and reduced-motion behavior. Desktop/mobile screenshots capture active tooltips.

Browser data is confined to disposable local browser contexts. Fixture opportunities never enter production seed data or the application database. Detailed test output and screenshots are under `E:\goms\.goms-sync\insights-*`. No APK build or manual GitHub publication is part of this feature.
