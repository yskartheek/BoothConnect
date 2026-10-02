# ADR-0009: Voters sign in with their voter ID and the mobile number on their record, in the same app

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** Product owner (yskartheek)
- **Related:** epic #222 (#223–#229), ADR-0003, ADR-0004, ADR-0005, ADR-0008, `apps/api/src/auth/otp.service.ts`, `apps/api/src/voter-self/`

## Context

The prototype needed a voter side: a voter sees their entry on the roll,
shares or corrects a few details (mobile number, occupation, additional
info), sees what happened to their record, and can stop sharing a detail
they consented to. The product owner chose **one shared app** for
volunteers and voters, rather than a second app.

Two questions had to be answered:

1. **Who is this person?** The roll is public: anyone can read a voter's
   name, age, relative's name, house number and voter ID (EPIC), which is
   also printed on their card. Anything on the roll proves nothing.
2. **What may they do?** A voter must reach their own record and nothing
   else, never another voter's, never staff screens, even on a phone a
   volunteer also uses.

There is no SMS provider yet (plan §11), and no budget or legal basis for
identity checks such as Aadhaar e-KYC in the prototype.

## Decision

**A voter signs in with their EPIC and a one-time code sent to the mobile
number on their record: a current `mobile_number` value collected by their
booth volunteer, or shared by the voter. The session is the voter's, for
that record only.**

- **Matching:** a code is sent only when exactly one active voter has that
  EPIC (spaces and case ignored) **and** the phone is that voter's current
  mobile number. Several family members may share one phone; the EPIC says
  which of them is signing in.
- **Nothing is revealed:** asking for a code is always **202**; a wrong
  code, an unknown EPIC and a phone not on the record are all the same
  **401 `OTP_INVALID`**. Requests are rate-limited per phone and per EPIC,
  matched or not.
- **The account:** the first sign-in creates a user for the phone. The link
  to the voter is kept on the **session** (`session.voter_id`), not on the
  user: one phone can sign in as different family members, and a staff
  member's phone signing in as a voter gets a voter session without staff
  rights (their own sign-in keeps those).
- **Scope:** a voter session has the `voter` role and no booths
  (ADR-0004). The `/voter/me…` endpoints take the voter from the session,
  never from the request, and follow the record across roll revisions.
- **Writes:** a voter's details are current at once, as
  `voter_self_submitted` (ADR-0003, ADR-0005), and only the shareable
  details. Official roll data and restricted fields can't be changed
  (ADR-0008); the voter can only withdraw a consent.
- **On the phone:** the voter side is online only. Only the tokens and the
  session kind are stored; the volunteer's offline database is untouched.

## Alternatives considered

| Option                                                   | Why not                                                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EPIC with name, age or relative's name                   | All of it is on the public roll: anyone holding the roll could sign in as anyone.                                                                                              |
| Any phone number, verified by code, then "claim" an EPIC | The code proves the phone, not the person: nothing ties the phone to the voter.                                                                                                |
| Aadhaar e-KYC or DigiLocker                              | Strong identity, but regulated, paid and slow to integrate, with its own legal review. Not for a prototype; worth revisiting before production.                                |
| A permanent link from the user to the voter              | Breaks for shared family phones and when a new roll replaces the record; a per-session link handles both.                                                                      |
| A separate voter app                                     | Twice the release and store work. The product owner chose one app; the two sides are kept apart by the session kind and the router, and the voter side stores nothing locally. |

## Consequences

- **Only voters with a mobile number on record can sign in.** Today that
  means a volunteer has recorded it on a visit. A voter not yet visited
  can't use the app; that's acceptable for the prototype.
- **Whoever holds that phone can act as the voter**, if they know the EPIC.
  On a shared family phone, a relative can see and change the voter's
  shared details. Changes are audited and listed in the voter's Updates;
  official data can't be changed. A volunteer who records a wrong number
  gives that number's owner the same access: phone numbers need care on
  the doorstep.
- **A real SMS provider is needed before production.** Until then codes are
  only logged (`OTP_DEV_MODE`) or not sent at all. The seed's phone numbers
  are made up but look real: a real sender must never run against a
  database holding the development seed.
- **What would make this wrong:** if numbers on record turn out to be often
  wrong or shared beyond families, or the legal review (spec §22) asks for
  stronger identity, add an identity check (e.g. DigiLocker) on top. The
  per-session link means existing sessions don't need to change.
