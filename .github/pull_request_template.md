Closes #

## Summary

## Tests

## Verification

## Manual testing

## Checklist

- [ ] New or changed API endpoints are listed in `ROUTES` in
      `apps/api/test/cross-booth.int-spec.ts`. Any endpoint scoped to booths
      or areas has a cross-booth test there: another booth's records are
      404 by ID, and missing from lists and counts (plan §8).
- [ ] No real electoral-roll PDFs or voter data are committed; tests and
      guides use synthetic data only.
- [ ] Audit events and logs hold ids, counts and codes, never voter data.
- [ ] A manual-testing guide is added or updated in `docs/manual-testing/`.
