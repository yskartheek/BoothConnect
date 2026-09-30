// GENERATED FILE. Do not edit by hand.
// Source: packages/i18n/locales/*.json
// Regenerate: pnpm --filter @boothconnect/i18n build:mobile

import 'generated/app_localizations.dart';

/// The label for a `visitOutcome` code from the API, or null if it is unknown.
String? visitOutcomeLabel(AppLocalizations l10n, String code) {
  switch (code) {
    case 'completed':
      return l10n.visitOutcomeCompleted;
    case 'partially_completed':
      return l10n.visitOutcomePartiallyCompleted;
    case 'no_one_available':
      return l10n.visitOutcomeNoOneAvailable;
    case 'refused':
      return l10n.visitOutcomeRefused;
    case 'address_not_found':
      return l10n.visitOutcomeAddressNotFound;
    case 'household_moved':
      return l10n.visitOutcomeHouseholdMoved;
    case 'voter_deceased':
      return l10n.visitOutcomeVoterDeceased;
    case 'duplicate_or_incorrect_listing':
      return l10n.visitOutcomeDuplicateOrIncorrectListing;
    case 'follow_up_requested':
      return l10n.visitOutcomeFollowUpRequested;
    case 'unsafe_or_inaccessible':
      return l10n.visitOutcomeUnsafeOrInaccessible;
  }
  return null;
}

/// The label for a `syncState` code from the API, or null if it is unknown.
String? syncStateLabel(AppLocalizations l10n, String code) {
  switch (code) {
    case 'pending':
      return l10n.syncStatePending;
    case 'syncing':
      return l10n.syncStateSyncing;
    case 'synced':
      return l10n.syncStateSynced;
    case 'conflict':
      return l10n.syncStateConflict;
    case 'failed':
      return l10n.syncStateFailed;
  }
  return null;
}

/// The label for a `gender` code from the API, or null if it is unknown.
String? genderLabel(AppLocalizations l10n, String code) {
  switch (code) {
    case 'female':
      return l10n.genderFemale;
    case 'male':
      return l10n.genderMale;
    case 'third_gender':
      return l10n.genderThirdGender;
  }
  return null;
}

/// The label for a `field` code from the API, or null if it is unknown.
String? fieldLabel(AppLocalizations l10n, String code) {
  switch (code) {
    case 'name':
      return l10n.fieldName;
    case 'age':
      return l10n.fieldAge;
    case 'gender':
      return l10n.fieldGender;
    case 'mobile_number':
      return l10n.fieldMobileNumber;
    case 'occupation':
      return l10n.fieldOccupation;
    case 'additional_info':
      return l10n.fieldAdditionalInfo;
    case 'caste_community':
      return l10n.fieldCasteCommunity;
    case 'address':
      return l10n.fieldAddress;
    case 'household_location':
      return l10n.fieldHouseholdLocation;
  }
  return null;
}

/// The label for a `error` code from the API, or null if it is unknown.
String? errorMessage(AppLocalizations l10n, String code) {
  switch (code) {
    case 'VALIDATION_FAILED':
      return l10n.errorValidationFailed;
    case 'MALFORMED_JSON':
      return l10n.errorMalformedJson;
    case 'BAD_REQUEST':
      return l10n.errorBadRequest;
    case 'UNAUTHENTICATED':
      return l10n.errorUnauthenticated;
    case 'FORBIDDEN':
      return l10n.errorForbidden;
    case 'NOT_FOUND':
      return l10n.errorNotFound;
    case 'METHOD_NOT_ALLOWED':
      return l10n.errorMethodNotAllowed;
    case 'CONFLICT':
      return l10n.errorConflict;
    case 'UNIQUE_VIOLATION':
      return l10n.errorUniqueViolation;
    case 'FOREIGN_KEY_VIOLATION':
      return l10n.errorForeignKeyViolation;
    case 'PAYLOAD_TOO_LARGE':
      return l10n.errorPayloadTooLarge;
    case 'UNSUPPORTED_MEDIA_TYPE':
      return l10n.errorUnsupportedMediaType;
    case 'UNPROCESSABLE':
      return l10n.errorUnprocessable;
    case 'RATE_LIMITED':
      return l10n.errorRateLimited;
    case 'OTP_INVALID':
      return l10n.errorOtpInvalid;
    case 'OTP_LOCKED':
      return l10n.errorOtpLocked;
    case 'IDEMPOTENCY_KEY_REQUIRED':
      return l10n.errorIdempotencyKeyRequired;
    case 'IDEMPOTENCY_KEY_REUSED':
      return l10n.errorIdempotencyKeyReused;
    case 'IDEMPOTENCY_IN_PROGRESS':
      return l10n.errorIdempotencyInProgress;
    case 'FIELD_UNKNOWN':
      return l10n.errorFieldUnknown;
    case 'FIELD_DISABLED':
      return l10n.errorFieldDisabled;
    case 'CONSENT_REQUIRED':
      return l10n.errorConsentRequired;
    case 'INVALID_VALUE':
      return l10n.errorInvalidValue;
    case 'BASE_VERSION_INVALID':
      return l10n.errorBaseVersionInvalid;
    case 'INTERNAL_ERROR':
      return l10n.errorInternalError;
    case 'SERVICE_UNAVAILABLE':
      return l10n.errorServiceUnavailable;
  }
  return null;
}
