# #213: Consent withdrawal by staff, and erasure (proposed)

**Issue:** https://github.com/yskartheek/BoothConnect/issues/213
**What changed:**

- **Admin web:** a voter's record has a **Consents** section showing:
  - what each consent covers;
  - when and how it was given, and who recorded it;
  - whether it was withdrawn, when and by whom.

  **Withdraw** (after a confirmation) records a withdrawal the voter asked for.

- **API:** volunteers and admins can list a voter's consents and withdraw one, for voters in their area. The voter's own app (#225) uses the same code.
- **What a withdrawal does:**
  - the covered value disappears from the record and from volunteers' phones;
  - recording it again needs a new consent, and it's then saved normally (before, it ended up as a conflict with the hidden value);
  - it's audited as `consent.withdraw`, with who and on whose behalf.
- **Erasure:** not built. Values are append-only, and erasure waits on the retention decision. ADR-0010 proposes how it would work.

## Steps

1. Reset and seed the database (SETUP.md section 2), then start the API, the admin web and the app on the emulator, with this branch: `claude/issue-213-consent-withdrawal`.
2. In the admin web, sign in as Demo Admin. Open **Voters and households**, search for household **H NO 1-3**, and open its first member (the demo voter, `DMO1000001`).
   **Expect:**
   - **Caste/community** has a value in the fields table;
   - **Consents** lists **Caste/community**, **Given**, "… in person, verbally · recorded by Demo Volunteer A", and a **Withdraw** button.
3. Tap **Withdraw**, then **Cancel**.
   **Expect:** nothing changes.
4. Tap **Withdraw**, then **Withdraw** in the dialog.
   **Expect:** the consent shows **Withdrawn**, "Withdrawn … by Demo Admin", and no button. In the fields table, **Caste/community** is **Not set**.
5. Open **Audit and security**.
   **Expect:** a `consent.withdraw` event by Demo Admin.
6. On the emulator, sign in as Demo Volunteer A (`9999900002`), sync, and open **H NO 1-3** → the first member.
   **Expect:** no caste / community value.
7. Still as the volunteer: in **Caste / community**, tick **Voter agrees to share this**, type a value, and **Save**. Sync.
   **Expect:** it saves and uploads without a conflict. In the admin web, refresh the voter: the new value, and a second consent, **Given**, recorded by Demo Volunteer A.
8. Sign out, sign in as the voter (**Voter**, `DMO1000001`, `9999900101`), and open **Privacy**.
   **Expect:** the first consent "You stopped sharing on …", and the new one with **Stop sharing**.

## Pass criteria

- Steps 1–8 give the expected results.

## Known issues and notes

- A volunteer can withdraw a consent from the API too (`POST /v1/voters/{id}/consents/{consentId}/withdraw`); the mobile app doesn't have a button for it yet.
- Household location consents (for a house's location) are not listed here; this covers a voter's own consents.
- Erasure: see [ADR-0010](../adr/0010-erasure-of-personal-data.md) (proposed). Nothing is erased yet; withdrawal stops the use of the data.
