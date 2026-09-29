# #74: Admin web, analytics explorer

**Issue:** https://github.com/yskartheek/BoothConnect/issues/74
**What changed:**

- **Analytics** in the admin portal shows any place of the admin's area,
  from the State down to a polling station. The place is in the address
  (`/analytics?node=<id>`); without one, the admin's own area opens.
- **Go to a place:** cascading dropdowns over the admin's area.
- **Breadcrumbs:** State › PC › AC › Part › Station. Places in the admin's
  area link to their analytics.
- **Cards:**
  - electors, with the gender split, the ratio and a bar chart;
  - ages, with the median, first-time voters (18–19) and a chart of the
    bands;
  - households;
  - revision changes;
  - data quality;
  - field work.

  Each figure shows its definition, and the page says when the figures were
  last updated.

- **Small groups:** a suppressed count shows "<10" (the minimum group size);
  a ratio or share built from one shows "Suppressed". Figures not collected
  yet show "Not collected". Neither is ever shown as 0, and they get no bar
  in the charts.
- **Compared with the parent:** gender ratio, median age, voters per
  household, extraction quality and visited share, next to the parent's
  (e.g. "962 vs AC 981").
- **The places below:**
  - a table of every child with its figures, the parent's total and the
    average;
  - figures more than 25% from the average are highlighted;
  - click a column to sort (suppressed and missing figures always last), or a
    name to drill down.

Test data only: the seeded demo data or synthetic rolls.

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4), on a freshly seeded database. Sign in as `+919999900001` and
   open **Analytics**.
   **Expect:**
   - "AC 101 Demo Assembly Constituency", with the breadcrumbs "State S99 …
     › PC 1 … › AC 101 …", none of them links (they're at or above the
     admin's AC);
   - the cards, each figure with its definition, and "Updated …";
   - no comparison (the PC is above the admin's area).
2. Look at small groups.
   **Expect:** any count below 10 shows "<10", with "Fewer than 10 people…"
   under it. Field work shows "Not collected" until volunteers visit. No
   suppressed or missing figure shows 0, and the charts have no bar for
   them.
3. In **Parts here**, click the **Electors** header, then click it again.
   **Expect:** highest first, then lowest first. The header says which
   (screen readers hear "sorted descending"). Parts with a suppressed figure
   stay at the bottom. Highlighted cells are more than 25% from the average.
4. Click a part's name.
   **Expect:**
   - the part's page, with "Compared with AC 101 …";
   - the breadcrumb **AC 101** is a link;
   - **Polling stations here**.

   Click a station.
   **Expect:** the station's figures and no table below them.

5. Click **AC 101** in the breadcrumbs.
   **Expect:** back at the AC.
6. **Go to a place:** choose AC 101 → a part, and click **Show**.
   **Expect:** that part.
7. Open `/analytics?node=11111111-2222-4333-8444-555555555555`.
   **Expect:** "This place isn't in your area."
8. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web test:e2e
   ```
   **Expect:** all pass.

## Pass criteria

- Steps 1–8 give the expected results.

## Known issues and notes

- The charts are simple bars (gender and age bands). The children table is
  their table view.
- An admin of an AC sees the State and PC above it in the breadcrumbs, but
  not their analytics: that is outside their area.
