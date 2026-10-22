# Financial calculation rules

These rules are implemented once in `server/domain/aggregate.ts` (and `budgets.ts`) and used by the
dashboard, budgets, reports, notifications and recurring estimates. Tests: `tests/budgets.test.ts`, `tests/sync.test.ts`.

## Representation
- Amounts are **signed integer minor units** (cents for EUR) with an ISO 4217 currency. Negative = money leaving the account.
- Provider amounts (decimal strings) are parsed exactly (`shared/money.ts`); malformed or over-precise values are rejected, never rounded.
- No floating-point arithmetic is used for stored amounts or totals. Display formatting passes exact decimal strings to `Intl.NumberFormat`.
- **Different currencies are never added together.** Totals are grouped by currency; the UI shows the main currency (Settings) and lists others separately. No currency conversion is performed.

## Dates and months
- Months are assigned by **booking date** (the bank’s calendar date, `YYYY-MM-DD`). No timezone conversion is applied to bank dates.
- “This month” / “today” are resolved in the user’s time zone (default Europe/Lisbon), e.g. 23:30 UTC on 31 March is already April in Lisbon.
- The value date is shown when supplied but not used for reports.

## What counts
| Item | Spending | Income | Shown as |
|---|---|---|---|
| Posted expense | adds | – | – |
| Posted refund (incoming, refund-like) | **subtracts** in the month it posts, in its category | – | “Refund” badge |
| Posted income | – | adds | – |
| Pending outgoing | – | – | “Pending” total, separately |
| Pending no longer reported | – | – | “No longer pending”, flagged |
| Verified own-account transfer | – | – | “Transfer” badge |
| Excluded transaction | – | – | stays in lists/exports, marked excluded |
| Account with “Include in totals” off | – | – | still listed |

- **Net cash flow** = income − spending for the period. It is not a balance.
- **Bank balance** is shown exactly as reported, with its type (e.g. “Available (interim)”) and time. It is never computed by Fluxo. If not provided, the UI says so.
- **Budget remaining** = budget − posted spending. It is not a balance and not a “safe to spend” figure.

## Refunds
Positive amounts are refunds when the description contains refund wording (devolução, estorno, reembolso, refund, reversal, anulação, chargeback) or the counterparty is a known merchant. Refunds take the merchant’s category and reduce that category’s spending in the month they post. If the refund posts in a later month than the purchase, that month’s category spending can be **negative**; reports explain this. Users can override the type.

## Transfers
A transfer is recognised only when two of the user’s own connected accounts show opposite, equal amounts in the same currency within 3 days, with exactly one best match. The word “transfer” alone never makes a transfer. Users can mark or unmark transfers (type override); overriding one side breaks the pair.

**Credit cards**: when both the current account and the card account are connected, the card repayment pairs with the card’s incoming payment and is excluded, while individual card purchases count. If only the current account is connected, the repayment counts as spending (the card purchases are invisible) — mark it as a transfer if you prefer.

## Budgets
- One optional total monthly budget plus optional category budgets. Category budgets are limits within the total, **not added** to it.
- Only posted spending counts; pending is shown as “+ X pending”.
- A change made during a month applies to the **whole current month** and later months; past months keep their recorded budget. Removing a budget works the same way.
- Alerts at configurable thresholds (default 80 % and 100 %), once per budget, month and threshold.
- No rollover.

## Recurring estimates
Grouped by normalized merchant and currency over ~15 months. Median interval must fall in a band (weekly 5–9 days, monthly 26–35, quarterly 80–100, yearly 350–380) with ≥ 75 % of gaps in band; ≥ 3 occurrences (2 for yearly). Amount spread > 15 % = variable. Everyday categories with variable amounts, cash withdrawals and MB WAY person-to-person payments are not suggested. Monthly equivalents: weekly × 52 / 12, quarterly / 3, yearly / 12 (rounded to the cent). All values are estimates.
