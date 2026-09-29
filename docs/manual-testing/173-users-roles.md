# #173: Users and role assignments

**Issue:** https://github.com/yskartheek/BoothConnect/issues/173
**What changed:**

- Admins can add people and give them roles in their own area (the nodes
  of their admin assignments, and everything below them):
  - `GET /v1/users` lists the users of the area; `GET /v1/users/<id>`
    shows one;
  - `POST /v1/users` adds a user with their first role;
  - `POST /v1/role-assignments` gives a role;
  - `DELETE /v1/role-assignments/<id>` ends one, keeping it in the history.
- An admin can only give roles at or below their own node. Volunteers are
  assigned to polling stations. An admin can't end their own admin role.
- The first admin of a deployment (or a State admin, above everyone's area)
  is set up on the server with `pnpm --filter api admin:grant`.
- Everything is in the audit log, with ids only.
- The admin web's Users page is built in #176
  ([guide](176-users-page.md)).

Use made-up names and phone numbers only.

## Steps

1. Prepare as for #36: `pnpm infra:up`, `pnpm --filter api db:deploy`,
   `pnpm --filter api db:seed`, then `pnpm --filter api dev` with
   `OTP_DEV_MODE=true`, and the `SignIn` helper from the #36 guide. Then:
   ```powershell
   $ad = SignIn "+919999900001"
   function Send($method, $path, $body) {
     $headers = $ad + @{ 'Idempotency-Key' = [guid]::NewGuid().ToString() }
     try {
       Invoke-RestMethod -Method $method "$api$path" -Headers $headers -ContentType "application/json" -Body ($body | ConvertTo-Json)
     } catch {
       Write-Host "HTTP $($_.Exception.Response.StatusCode.value__): $(($_.ErrorDetails.Message | ConvertFrom-Json).message)"
     }
   }
   $booth1 = ((Invoke-RestMethod "$api/me" -Headers (SignIn "+919999900002")).assignments[0]).node.id
   $part1 = (Invoke-RestMethod "$api/geographies/$booth1" -Headers $ad).parentId
   ```
2. List the users of the admin's area (AC 101):
   ```powershell
   (Invoke-RestMethod "$api/users" -Headers $ad).items |
     Format-Table name, phone, @{ n = 'roles'; e = { ($_.assignments | Where-Object active | ForEach-Object { "$($_.role) $($_.node.type) $($_.node.code)" }) -join ', ' } }
   ```
   **Expect:** Demo Admin (admin ac 101), Demo Volunteer A (volunteer
   polling_station 1) and Demo Volunteer B (volunteer polling_station 2).
3. Add a volunteer on booth 1:
   ```powershell
   $new = Send Post "/users" @{ name = "Test Volunteer"; phone = "+919999900150"; role = "volunteer"; geographyNodeId = $booth1 }
   $new.created; $new.assignment.node.code
   ```
   **Expect:** `True` and `1`.
4. Sign in as the new volunteer (the code is in the API log) and look at
   their households:
   ```powershell
   $nv = SignIn "+919999900150"
   (Invoke-RestMethod "$api/households?limit=200" -Headers $nv).items.Count
   ```
   **Expect:** booth 1's households (more than 0).
5. Rules:
   ```powershell
   Send Post "/role-assignments" @{ userId = $new.user.id; role = "volunteer"; geographyNodeId = $part1 }
   Send Post "/users" @{ name = "X"; phone = "919999"; role = "volunteer"; geographyNodeId = $booth1 }
   $own = ((Invoke-RestMethod "$api/me" -Headers $ad).assignments | Where-Object role -eq 'admin')[0].id
   Send Delete "/role-assignments/$own" $null
   ```
   **Expect:**
   - `HTTP 422: A volunteer is assigned to a polling station`;
   - `HTTP 400` (the phone isn't in international format);
   - `HTTP 422: You can't end your own admin role; ask another admin`.
6. End the new volunteer's role, then look again as them:
   ```powershell
   $ended = Send Delete "/role-assignments/$($new.assignment.id)" $null
   $ended.active
   (Invoke-RestMethod "$api/households" -Headers $nv).items.Count
   ```
   **Expect:** `False`, then 0. The role is still in their history:
   `(Invoke-RestMethod "$api/users/$($new.user.id)" -Headers $ad).assignments`.
7. Set up a State admin from the server. In a second window, from the
   repository root:
   ```powershell
   pnpm --filter api build
   pnpm --filter api admin:grant --phone +919999900151 --name "Test State Admin" --node S99
   ```
   **Expect:** "Admin role granted: user … (new), assignment …". Running it
   again says "already an admin there; nothing changed".
8. The audit log:
   ```powershell
   (Invoke-RestMethod "$api/audit-events?action=role.*" -Headers $ad).items +
   (Invoke-RestMethod "$api/audit-events?action=user.*" -Headers $ad).items |
     Format-Table seq, action, @{ n = 'actor'; e = { $_.actor.name } }, @{ n = 'metadata'; e = { $_.metadata | ConvertTo-Json -Compress } }
   ```
   **Expect:** `user.create` and `role.grant` from step 3, `role.end` from
   step 6, and `user.create` and `role.grant` from step 7 with no actor and
   `"via":"admin:grant"`. No names or phone numbers.
9. Run the tests:
   ```powershell
   pnpm --filter api test:int -- test/user-admin.int-spec.ts
   ```
   **Expect:** 9 pass.

## Pass criteria

- Steps 2–9 give the expected results.

## Known issues and notes

- A user can't be suspended or renamed yet. Ending all of someone's roles
  removes their access to data.
- To start again, run `pnpm --filter api db:reset` and seed again.
