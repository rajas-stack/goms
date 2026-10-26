# Live Bids context menus

Right-click a cell to open its opportunity, copy its value or bid link, filter the column,
or edit the cell (unlocking the grid when needed). Empty and read-only cells omit
irrelevant actions. Live bids also link directly to General, RFP Timeline and Communication.

Stage actions use the row's actual current stage, including rows retained in later lists
after reversal. Only adjacent moves appear, labelled Advance to / Move back to.
Source and destination permissions must both allow the move. Archived rows offer Unarchive;
they omit stage moves and editing. Archive errors and clipboard failures are shown. Delete
retains its existing confirmation. Menus support keyboard navigation and internal scrolling.

## Changing a custom column's data type

Right-click the column header or a cell and select Change data type. The header dropdown
also offers it. Column-management permission is required. The dialog edits dropdown choices
as well as the data type. Changes apply to the column across all opportunities and views.
Built-in and master-backed fields retain their defined types.

| Change | Existing values |
| --- | --- |
| Number ↔ Amount | Retained |
| Single ↔ multiple dropdown | Retained; multiple-to-single requires at most one choice per cell |
| Text, URL, email, phone within that family | Retained and validated for the target type |
| Same type; add/remove/reorder choices | Retained, including retired choices already stored |
| Between other type families | Reset in this column; old values remain in audit history |

The API migrates the definition and all values in one transaction and serializes cell writes
with type changes. Invalid compatible conversions roll back the entire change. The local
repository validates the entire change before applying it. A stale dialog rejects changes
if another session has changed the type. Current-view filters on the changed column clear
after a type change so incompatible old filters do not hide the grid's rows.
