# #66: Mobile sync push: uploading the changes made on the phone

**Issue:** https://github.com/yskartheek/BoothConnect/issues/66
**What changed:**

- Visits and edits saved on the phone upload to the server (`POST /v1/sync/push`) by themselves:
  - right after saving, when online;
  - when the phone is back online;
  - when the app comes back to the foreground;
  - after signing in.
- **Oldest first**, in batches of up to 50. Each change keeps its idempotency key on every attempt, so a change sent twice (say, the answer was lost) is stored once.
- **What happens to each change:**
  - stored → removed from the phone's queue; the household shows **Uploaded**;
  - someone else changed the same detail → kept, marked for the volunteer to choose (**Choose value**; the choosing screen is #67);
  - refused by the server → kept, with the reason, until **Upload now** (#67).
- **Offline or server errors:** the change waits and is tried again, 1–2 seconds later at first, doubling each time, never more than 5 minutes apart. The waits are random within that range so phones don't all retry together.
- Only one upload runs at a time. Sign-out waits for it before wiping the phone.
- The phone's copies take the server's ids once uploaded, so the next download updates them instead of adding a second copy.
- **Fixed:** the "You're offline" banner (#62) now shows in the app. The phone's connection stream allows one listener, and the sync triggers were taking it.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-66-sync-push
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. Start the API with the development seed (see the [#60 guide](60-mobile-sign-in.md)). On the emulator, sign in as `+919999900002` (Demo Volunteer A).
3. Turn on **airplane mode**.
   **Expect:** "You're offline" on Home.
4. Open **Households**, tap **H NO 1-3**, **Start visit**, then **No one home**.
   **Expect:** "Visit saved…"; the household shows **On phone**; Home shows 1 waiting to upload.
5. Close the app completely (swipe it away), then open it again, still in airplane mode.
   **Expect:** the visit is still there, **On phone**, and Home still shows 1 waiting.
6. Turn airplane mode off.
   **Expect:** within a few seconds:
   - the banner goes;
   - the household shows **Uploaded**;
   - Home shows nothing waiting.
7. Check the server:
   ```powershell
   docker compose -f infra/docker-compose.yml exec postgres psql -U boothconnect -d boothconnect -c "SELECT outcome, client_id FROM visit ORDER BY created_at DESC LIMIT 1;"
   ```
   **Expect:** one `no_one_available` visit, whose `client_id` is the phone's. There's exactly one row, even though the app may have tried more than once.
8. With the phone online, record another visit (**Refused**).
   **Expect:** it goes straight to **Uploaded**.

## Pass criteria

- Steps 1–8 give the expected results.

## Known issues and notes

- The Uploads screen (#67) will show the queue: uploading, waiting (with the next retry time), and not uploaded (with the reason). It will also have **Upload now** and the screen for choosing a value on a conflict. Until then, a refused change stays in the queue and counts as "waiting to upload" on Home.
- Signing out still wipes changes that haven't uploaded. Sign out only when Home shows nothing waiting.
