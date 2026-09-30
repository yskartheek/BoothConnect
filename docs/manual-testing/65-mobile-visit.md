# #65: Mobile visit form: outcome, who you met, edit members, refusal

**Issue:** https://github.com/yskartheek/BoothConnect/issues/65
**What changed:**

- **Start visit** on a household opens the visit form, "Visit · _address_".
- **How did it go?** The outcomes are in plain words: Met the family, Met some members, No one home, Refused and Come back later. **More options…** shows the rarer ones (Address not found, Family has moved, …).
- **No one home** and **Refused** save the visit at once, with no more questions.
- **Who did you meet?** (for Met the family, Met some members and Come back later) is a checklist of members:
  - each row says **No changes**, **Not met**, or what changed during this visit (e.g. "Updated mobile number, occupation");
  - **Edit** opens the member's details. That screen is still a placeholder; #114 builds it.
- **Notes (optional)** warn not to record health, religion or party details.
- **Save visit** stores the visit on the phone and queues it for upload. It works fully offline. Afterwards the household shows the visit, and the upload chip says **On phone** until the upload worker (#66) sends it.
- Member edits (from #114) are saved on the phone as their own queued changes. Each keeps the value it replaced (`base_version`), so the server can tell if someone else changed it meanwhile.
- All text is in English and Telugu.

## Steps

1. Run the checks:
   ```powershell
   git checkout claude/issue-65-visit-form
   pnpm install --frozen-lockfile
   pnpm --filter mobile lint
   pnpm --filter mobile test
   ```
   **Expect:** `No issues found!` and `All tests passed!`.
2. On the emulator with the API running and the development seed loaded (see the [#60 guide](60-mobile-sign-in.md)), sign in as `+919999900002` (Demo Volunteer A). Turn on **airplane mode**.
3. Open **Households**, tap **H NO 1-3**, then **Start visit**.
   **Expect:** "Visit · H NO 1-3", the five outcomes, and **Save visit** greyed out with "Choose how the visit went to save it."
4. Tap **More options…**, then **Fewer options**.
   **Expect:** the five rarer outcomes appear, then hide again.
5. Tap **Met some members**.
   **Expect:** "Who did you meet?" with every member as **Not met**. Tick one: it says **No changes**. Tap **Edit** on a member: the "Member" page opens (placeholder until #114). Go back.
6. Type a note, then tap **Save visit**.
   **Expect:**
   - "Visit saved. It uploads when you're online.", then back on the household;
   - "Last visit _today_ · Met some members" and **On phone**.
7. Tap **Start visit** again, then **Refused**.
   **Expect:** it saves straight away and returns to the household, with "Last visit … · Refused".
8. Go back to **Households**.
   **Expect:** H NO 1-3 shows **On phone** and counts as visited.
9. Tap **Start visit**, choose an outcome, then **✕** (Cancel).
   **Expect:** back on the household; nothing new saved.
10. Turn airplane mode off.
    **Expect:** nothing uploads yet. That comes with #66; the visits stay **On phone**.

## Pass criteria

- Steps 1–9 give the expected results.

## Known issues and notes

- Uploading the queued visits and edits is #66. Until then they stay on the phone, and signing out wipes them with the rest of the phone's data.
- Editing a member's details is #114. The Edit link and the "changes made during this visit" summary are ready for it.
