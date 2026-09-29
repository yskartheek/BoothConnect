# #176: Admin web, Users page

**Issue:** https://github.com/yskartheek/BoothConnect/issues/176
**What changed:**

- **Users and assignments** in the admin portal manages the people of the
  admin's area:
  - a list with each person's active roles, filtered by area or booth
    (cascading dropdowns that start at the admin's own nodes), role, name or
    phone, and "Only people with an active role";
  - **Open** shows a person's role history in the area (active, ended, or
    starting later). **Give a role** adds one, and **End role** ends one after
    a confirmation;
  - **Add a user** adds someone with their first role.
- The admin's own admin role has no **End role** button; the API refuses it.
- Messages the API gives for a refused change (422) are shown as they are.
- The browser tests now include axe accessibility checks (#77 extends them
  to every page).

Use made-up names and phone numbers only.

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4), on a freshly seeded database. Sign in as `+919999900001` and
   open **Users and assignments**.
   **Expect:** Demo Admin (Admin · AC 101), Demo Volunteer A (Volunteer ·
   Polling station 1) and Demo Volunteer B (Volunteer · Polling station 2).
2. Filter:
   - **Your area**: only "All of my area" and "AC 101 Demo Assembly
     Constituency" are offered. Choose AC 101, then Part 1, then Polling
     station 1.
     **Expect:** only Demo Volunteer A.
   - Set **Your area** back to "All of my area", choose **Role**: Admin.
     **Expect:** only Demo Admin. Set it back to "Any role".
   - Type `volunteer b` in **Name or phone**.
     **Expect:** only Demo Volunteer B. Clear it.
3. Click **Add a user**. Name `Test Volunteer`, phone `+919999900150`, role
   Volunteer, **Your area** AC 101, and click **Add user**.
   **Expect:** "Volunteers are assigned to a polling station."
4. Choose Part 1 and Polling station 1, and click **Add user**.
   **Expect:**
   - "Test Volunteer was added.";
   - they're in the list as "Volunteer · Polling station 1 …";
   - their details open, with the role Active, given by Demo Admin.
5. Sign in to the API as the new volunteer and count their households. Use
   the `SignIn` helper from the [#36 guide](36-geographies.md); the code is
   in the API log.
   ```powershell
   $nv = SignIn "+919999900150"
   (Invoke-RestMethod "$api/households?limit=200" -Headers $nv).items.Count
   ```
   **Expect:** booth 1's households (more than 0).
6. Click **Add a user** again: any name, phone `+919999900150`, role Campaign
   manager, place AC 101 → Part 1, and **Add user**.
   **Expect:** "Test Volunteer already had an account in your organization,
   and got the new role." The history shows both roles.
7. Under **Give a role**, choose Campaign manager, AC 101 → Part 1, and
   **Give role**.
   **Expect:** "The user already has this role on this node then" (the API's
   own message).
8. Click **End role** on the Volunteer row.
   **Expect:** a dialog: "Test Volunteer stops being Volunteer at Polling
   station 1 … now. The role stays in their history." Click **Cancel**:
   nothing changes. Click **End role** again, then **End role** in the
   dialog.
   **Expect:**
   - the Volunteer row shows **Ended**, with today's date under "Until", and
     no button;
   - the Campaign manager role is still Active.
9. Click **Close**, then **Open** on Demo Admin.
   **Expect:** their Admin role (given by "Server setup") has no **End role**
   button.
10. The audit log:
    ```powershell
    $ad = SignIn "+919999900001"
    (Invoke-RestMethod "$api/audit-events?action=role.*" -Headers $ad).items +
    (Invoke-RestMethod "$api/audit-events?action=user.*" -Headers $ad).items |
      Format-Table action, @{ n = 'metadata'; e = { $_.metadata | ConvertTo-Json -Compress } }
    ```
    **Expect:** `user.create`, two `role.grant` and one `role.end`, with ids
    and roles only: no names or phone numbers.
11. Sign out, and sign in as the volunteer `+919999900002`.
    **Expect:** "No access": the portal is for admins.
12. Run the tests:
    ```powershell
    pnpm --filter admin-web test
    pnpm --filter admin-web test:e2e
    ```
    **Expect:** all pass: 83 component tests and 24 browser tests (the
    browser tests use a stand-in API; five check the Users page, with axe
    accessibility checks).

## Pass criteria

- Steps 1–12 give the expected results.

## Known issues and notes

- A user can't be renamed or suspended yet, as in the
  [#173 guide](173-users-roles.md).
- **Your area** lists the admin's own admin nodes. An admin of a State picks
  a PC and AC below it, then the part and station.
- Dates are whole days on this computer's clock: a role starts as its start
  date begins, and ends as its end date begins.
- To start again, seed a fresh database.
