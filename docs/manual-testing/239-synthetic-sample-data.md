# #239: Replace voter IDs, names and phone numbers that may be real

**Issue:** https://github.com/yskartheek/BoothConnect/issues/239 (related: #216)
**What changed:**

- **Design mockups** (`docs/design/*-mockups.html`): voter IDs are now `DMO9000001`–`DMO9000006`, the names next to them on the admin roll-review page are "… Demoreddy", and mobile numbers are in the demo range `99999 002xx`.
- **Docs:** the example voter ID in `docs/design/voter-roll-pdf-import.md`, the Prisma schema comment and the roll-parser README is synthetic.
- **Roll-parser tests** (`apps/roll-parser/tests/test_voters.py`): the voter-ID and name clean-up cases and the voter-box case use synthetic values. They check the same OCR corrections as before: 1 read for I, 0 for O, letters in the digit part, `]` for I.

Git history still holds the old values. Removing them means rewriting history and force-pushing `main`, which every clone then has to re-fetch. That's the owner's call, and not part of this change.

## Steps

1. Check out `claude/issue-239-synthetic-sample-data` and search the repo:
   `git grep -nE "\b[A-Z]{3}[0-9]{7}\b" -- docs apps/api/prisma apps/roll-parser/tests/test_voters.py apps/roll-parser/README.md`
   **Expect:** only synthetic IDs (`DMO…`, `DIM…`, `OMD…`) and plain placeholders (`ABC1234567`, `XYZ7654321`, `ZZZ0000000`).
2. Search for mobile numbers outside the demo range in the mockups:
   `git grep -nE "\b[6-9][0-9]{4} ?[0-9]{5}\b" -- docs/design | grep -v "99999"`
   **Expect:** no output.
3. Open `docs/design/admin-web-mockups.html`, `volunteer-app-mockups.html` and `voter-app-mockups.html` in a browser.
   **Expect:** they look as before; only the IDs, the names on the roll-review page and the phone numbers have changed.
4. Run the roll-parser tests: `cd apps/roll-parser && pnpm test`.
   **Expect:** all pass.

## Pass criteria

- Steps 1–4 give the expected results.

## Known issues and notes

- Unit tests still use the placeholder `9876543210`. They run against fakes and never send SMS, so it's left as it is.
- The cover-page text in `apps/roll-parser/tests/test_header.py` is from the owner's sample, but it holds only public constituency and polling-station details, as its comment says.
