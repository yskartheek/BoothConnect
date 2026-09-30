# #76: Admin web, audit explorer

**Issue:** https://github.com/yskartheek/BoothConnect/issues/76
**What changed:**

- **Audit and security** in the admin portal shows the audit log, newest
  first, 50 at a time (**Show more** for older ones).
- **Filters:** who (a user of the admin's area), action (`auth.login`, or a
  prefix like `import.*`), resource type, resource id, result, and a date
  range (both days included).
  - **Apply filters** puts them in the address (`/audit?action=import.*`), so
    a reload or a shared link keeps them. **Clear** removes them.
  - A filter the API refuses says why.
- **Details** opens an event in a side panel:
  - when, the result, who (or System), the resource, the chain position, the
    session and the request;
  - the details recorded (ids, counts and codes only, as the API keeps them);
  - the chain hashes.
- **Verify chain** asks the API to re-check the hash chain for the date
  range, or the whole log without dates. It says "intact" with the number of
  events checked, or where the chain breaks.
- Reading the log is itself audited by the API (`audit.view`).

## Steps

1. Start the API and the admin web as in the [#70 guide](70-admin-sign-in.md)
   (steps 1–4). Sign in as `+919999900001` and open **Audit and security**.
   **Expect:** the latest events (your sign-in first), each with when, the
   action, who, the resource and the result.
2. Type `auth.*` in **Action** and click **Apply filters**.
   **Expect:**
   - the address ends in `?action=auth.*`;
   - only `auth.` events are listed.

   Reload the page.
   **Expect:** the same filter and results.

3. Click **Details** on an event.
   **Expect:** a side panel with its fields, the "Details recorded" (no
   names, phone numbers or voter data) and, under **Chain hashes**, its hash
   and the previous one. **Close** it.
4. Set **From** and **To** to today, apply, and click **Verify chain**.
   **Expect:** "✓ The chain is intact: N events checked, none changed."
5. Type `Bad Action` in **Action** and apply.
   **Expect:** "These filters can't be used: action must look like
   "auth.login" or "import.*"". Click **Clear**.
6. Choose yourself under **Who**, and **Failed** under **Result**.
   **Expect:** only your failed events (for example, a wrong sign-in code).
7. Run the tests:
   ```powershell
   pnpm --filter admin-web test
   pnpm --filter admin-web test:e2e
   ```
   **Expect:** all pass.

## Pass criteria

- Steps 1–7 give the expected results.

## Known issues and notes

- Verification covers every event in the date range, whatever the other
  filters (the chain can't be checked in pieces).
- **Who** lists the users of your area; events by others can be found by
  action or resource.
