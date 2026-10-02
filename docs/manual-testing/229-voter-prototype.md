# #229: Voter prototype end to end: demo voter, admin label, docs

**Issue:** https://github.com/yskartheek/BoothConnect/issues/229 (epic #222)
**What changed:**

- **Seed:** the demo voter `DMO1000001` (mobile `+919999900101`, household **H NO 1-3**) now has caste / community shared with consent, so the app's Privacy tab has something to stop sharing.
- **Admin web:** on a voter's record, a value the voter shared in the app says **Shared by the voter** (was "Voter").
- **Tests:** the whole journey runs in CI twice:
  - the real API with Postgres and Redis (`apps/api/test/voter-journey.int-spec.ts`): sign in, edit the occupation, Updates, and the volunteer's next pull has the value;
  - the app against a stand-in server (`apps/mobile/test/e2e/voter_journey_test.dart`): the same, then the volunteer signs in on the same phone.
- **Docs:**
  - SETUP.md: the demo voter in section 3, and **The voter side** demo at the end of section 4;
  - the API guide: a curl example for the voter endpoints, and the consent endpoints in the endpoint table;
  - ADR-0009: why voters sign in with their voter ID and the mobile number on their record.

## Steps

1. Reset and seed the database (SETUP.md section 2), then start the API, the app on the emulator and the admin web, with this branch: `claude/issue-229-voter-prototype-wrapup`.
2. Follow **The voter side** demo in SETUP.md, at the end of section 4, steps 1–6.
   **Expect:** each step's expected result. In step 5, **Caste / community** is under **Shared with your consent** with no need to add it first.
3. In the admin web, as Demo Admin, open **Voters and households**, search for household **H NO 1-3**, and open the demo voter's record (the name from the app's Home).
   **Expect:** the occupation you set in the app, with **Shared by the voter · <the voter's name> · <today>** under it.
4. Read [ADR-0009](../adr/0009-voter-accounts-and-verification.md) and the API guide's [voter section](../api/README.md#voter-sign-in).
   **Expect:** they match what you saw: voter ID and the mobile on record, nothing revealed on a wrong attempt, the voter's own record only.

## Pass criteria

- Steps 1–4 give the expected results.

## Known issues and notes

- If you stopped sharing caste / community, it stays stopped: the seed doesn't add it again. Reset the database to get it back.
- Codes can be requested 3 times per phone and per voter ID in 10 minutes.
