# Voter Field Operations Platform

## Product Requirements and Implementation Specification

**Document status:** Initial implementation specification  
**Working product name:** BoothConnect  
**Target platforms:** iOS, Android, and responsive web administration portal  
**Primary users:** Booth volunteers, voters, administrators, and campaign managers  
**Initial release:** Mobile-first MVP with field data collection, voter self-service, campaign management, and aggregate analytics

---

## 1. Product Summary

BoothConnect is a secure field-operations and voter-engagement platform for election teams. Booth volunteers use the mobile app to visit assigned households, verify voter-list information, record permitted updates, track follow-up work, and coordinate booth activities. Voters can optionally submit or correct their own information. Administrators and campaign managers use role-specific dashboards to monitor data quality, field progress, and campaign delivery.

The platform must work reliably in low-connectivity environments, protect sensitive personal data, maintain a complete audit trail, and scale from a single constituency to larger regional deployments.

> **Important product constraint:** Political affiliation, caste/community, precise location, and similar attributes may be sensitive personal data under applicable laws and platform policies. Their collection must be legally reviewed, purpose-limited, consent-based where required, access-controlled, and disabled by default until approved. The system must not use sensitive traits to enable discriminatory treatment, voter suppression, intimidation, or manipulative microtargeting.

---

## 2. Product Goals

1. Give every authorized booth volunteer a simple, reliable view of the voters and households assigned to their booth.
2. Allow field teams to verify existing voter-list data and collect additional, legally permitted information.
3. Provide offline-first workflows for areas with weak or unavailable network connectivity.
4. Help administrators understand coverage, data completeness, changes, and operational trends.
5. Let campaign managers create, schedule, distribute, and monitor approved campaigns.
6. Give voters an optional self-service experience for reviewing and submitting their own information.
7. Maintain strong privacy, consent, security, and audit controls throughout the data lifecycle.
8. Support future non-election field operations through configurable forms, roles, territories, and workflows.

## 3. Non-Goals for the MVP

- Predicting how an individual will vote.
- Automated persuasion recommendations based on protected or sensitive attributes.
- Public access to voter records or volunteer-collected personal data.
- Facial recognition, biometric identification, or covert location tracking.
- Automated scraping of third-party social media profiles.
- Direct modification of an official government electoral roll.
- Payments, donations, or campaign-finance accounting.
- Full call-center, social media, or advertising-platform integration.

---

## 4. Guiding Principles

- **Privacy by design:** Collect the minimum data needed for a documented purpose.
- **Consent and transparency:** Clearly disclose why optional data is requested and how it will be used.
- **Offline first:** Core field tasks must remain usable without connectivity.
- **Least privilege:** Users can access only the geography, records, and actions required by their role.
- **Human accountability:** Sensitive changes and campaign decisions remain reviewable by authorized people.
- **Inclusive design:** Support accessibility, multiple languages, low digital literacy, and lower-end devices.
- **Evidence over inference:** Distinguish official source data, user-provided data, volunteer observations, and derived analytics.
- **Configurable expansion:** Avoid hard-coding geography, forms, languages, or campaign types.

---

## 5. User Personas and Permissions

### 5.1 Booth Volunteer

**Purpose:** Conduct household visits and manage booth-level field activities.

**Primary capabilities:**

- Sign in using an administrator-issued account and secure verification.
- View only assigned booth, part, household, and voter records.
- Download assigned records for offline use.
- Search and filter voters by name, voter ID, household, status, or address.
- Open a household visit and verify each listed voter.
- Update permitted fields and add structured notes.
- Record visit outcomes such as completed, unavailable, moved, follow-up required, or refused.
- Capture location only after explicit permission and only when required.
- Create booth tasks and see assigned campaign activities.
- Sync offline changes when connectivity returns.
- View personal progress and booth-level aggregate progress.

**Restrictions:**

- Cannot export bulk personal data.
- Cannot view voters outside assigned areas.
- Cannot permanently delete voter records.
- Cannot approve sensitive-data collection or create campaign targeting rules.
- Cannot overwrite official source fields without preserving their original values.

### 5.2 Voter

**Purpose:** Voluntarily review, submit, or correct personal information and manage communication preferences.

**Primary capabilities:**

- Register and verify identity using an approved verification method.
- View only their own profile and approved public campaign content.
- Submit corrections or additional information.
- Review purpose and consent text before submitting optional fields.
- Withdraw optional consent and update communication preferences.
- See submission status: pending, accepted, rejected, or more information required.
- Request data access, correction, or deletion where legally applicable.

**Restrictions:**

- Cannot browse other voters or household members unless an approved guardian/delegation flow exists.
- Self-submitted changes do not replace authoritative records without review.

### 5.3 Administrator

**Purpose:** Configure the organization, control access, oversee data quality, and review aggregate analytics.

**Primary capabilities:**

- Manage organizations, elections, constituencies, booths, users, and assignments.
- Import voter-list data and review validation results.
- Configure permitted data fields, consent requirements, and retention rules.
- Approve or reject submitted changes.
- Monitor field progress and data-quality dashboards.
- View security events and audit history.
- Manage languages, lookup values, and form versions.
- Export authorized aggregate reports and tightly controlled record-level reports.
- Suspend accounts, revoke sessions, and initiate incident response.

### 5.4 Campaign Manager

**Purpose:** Plan and distribute approved campaign activities and content.

**Primary capabilities:**

- Create campaign briefs, content, tasks, schedules, and geographic assignments.
- Upload approved campaign assets.
- Assign campaigns to constituencies, booths, or permitted non-sensitive audience segments.
- Track delivery, completion, reach, and aggregate response.
- Pause, revise, archive, or cancel campaigns.
- Submit sensitive or high-reach campaigns for approval.

**Restrictions:**

- Cannot access unrestricted individual voter profiles by default.
- Cannot target or exclude individuals based on caste/community, religion, health, disability, sexual orientation, or other protected traits.
- Cannot send a campaign without required approval and communication consent.

### 5.5 Optional Future Personas

- Constituency coordinator
- Data reviewer
- Compliance/privacy officer
- Field supervisor
- Content approver
- Support agent
- Independent auditor

---

## 6. Core Domain Structure

The geography model must be configurable rather than tied to a single election system:

```text
Organization
└── Election or Program
    └── Region / State
        └── Constituency
            └── Booth / Polling Part
                └── Household
                    └── Voter
```

Users receive explicit assignments to one or more nodes in this hierarchy. Authorization must be enforced by the backend, not only hidden in the client interface.

---

## 7. Functional Requirements

## 7.1 Authentication and Account Management

- Support phone number or email sign-in, based on deployment configuration.
- Require one-time password or passwordless verification for field users.
- Require multi-factor authentication for administrators and campaign managers.
- Support secure session expiration, remote sign-out, device revocation, and account suspension.
- Record successful and failed authentication events.
- Prevent account sharing through policy, device/session visibility, and anomaly alerts.
- Allow a user to hold multiple roles only through explicit assignments.

### Acceptance criteria

- A suspended user immediately loses access to protected APIs.
- A volunteer cannot retrieve records outside assigned booths, even by changing request identifiers.
- Administrative accounts require MFA before accessing personal data or exports.
- All authentication and authorization failures are logged without exposing secrets.

## 7.2 Voter-List Import

Administrators must be able to import voter records from CSV or another approved structured format.

**Initial source fields:**

- Source voter ID / electoral roll number
- Full name
- Gender, as represented by the source
- Age or date/year of birth, depending on source availability
- Relationship name and type, if available
- Polling part or booth
- Serial number
- Source address
- Source revision/publication date

**Import workflow:**

1. Upload a file.
2. Select or confirm field mappings.
3. Validate required columns, formats, duplicates, and geography references.
4. Preview accepted, rejected, and warning rows.
5. Confirm import.
6. Store import job, source version, row-level result, and administrator identity.
7. Preserve previous versions for audit and reconciliation.

The application must label imported fields as **official/source data**. Field corrections are stored separately as proposed or verified values rather than destructively overwriting source data.

### Acceptance criteria

- Invalid rows do not silently enter the active voter dataset.
- Re-importing the same source file is idempotent or clearly identified as a duplicate.
- Administrators can download a rejection report without exposing records they are not authorized to access.
- Every active voter record can be traced to its import job and source version.

## 7.3 Household and Voter Records

### Household fields

- Internal household ID
- Display address
- Address components
- Booth and geography assignment
- Optional latitude and longitude with collection source and consent state
- Number of listed voters
- Number of verified residents/voters
- Primary contact preference, when voluntarily provided
- Visit status
- Last visit date
- Next follow-up date
- Assigned volunteer
- Household notes with visibility classification

### Voter fields

**Source or baseline fields:**

- Source voter ID
- Name
- Gender
- Age or permitted birth information
- Source address
- Booth and serial information

**Potential field-verification fields:**

- Current residence status
- Corrected name or spelling
- Corrected age information
- Current address
- Contact number
- Preferred language
- Work type / occupation category
- Availability or preferred contact time
- Accessibility assistance requested
- Communication opt-in status
- Interests or local issue priorities
- Volunteer-entered notes

**Restricted configurable fields:**

- Caste/community
- Political affiliation or preference
- Religion
- Precise household coordinates
- Other protected or highly sensitive information

Restricted fields must be disabled by default. Enabling any restricted field requires documented legal basis, privacy review, explicit purpose, collection notice, consent behavior, retention period, role access, export policy, and audit policy. Analytics involving these fields must meet minimum cohort-size and disclosure-control rules.

### Data provenance

Every editable value must include:

- Value
- Source type: official import, voter self-submission, volunteer collection, administrator correction, or derived
- Collection timestamp
- Collector or submitting user
- Verification status
- Consent record, when applicable
- Previous value history

## 7.4 Field Visit Workflow

### Standard flow

1. Volunteer opens the assigned booth dashboard.
2. Volunteer selects a household from the list or map.
3. App shows known household members and previous visit status.
4. Volunteer starts a visit and confirms the correct household.
5. Volunteer records the household visit outcome.
6. For each available voter, the volunteer verifies baseline details and requests optional information.
7. App displays field-level purpose and consent notices where required.
8. Volunteer reviews the changes with the respondent.
9. Respondent provides confirmation through the approved method.
10. App stores the visit locally if offline and queues it for sync.
11. Backend validates changes and marks applicable records for review.
12. Volunteer sees a successful sync or an actionable conflict/error state.

### Visit outcomes

- Completed
- Partially completed
- No one available
- Refused
- Address not found
- Household moved
- Voter deceased, subject to approved handling
- Duplicate or incorrect listing
- Follow-up requested
- Unsafe or inaccessible location

### Requirements

- A refusal must be recordable without pressure or repeated required prompts.
- Volunteers must not be required to collect optional or restricted fields to complete a visit.
- Free-text notes must show a warning not to enter unnecessary sensitive information.
- A household can have multiple visits and multiple volunteers over time.
- Visit history must be immutable except through an audited correction workflow.

## 7.5 Offline-First Operation and Synchronization

- Volunteers can download only assigned records.
- Downloaded data is encrypted on the device.
- Core list, search, household, voter, visit, and form features work offline.
- Local mutations enter a durable sync queue.
- Sync retries use bounded exponential backoff.
- The interface shows offline, pending, syncing, synced, conflict, and failed states.
- Server-side authorization is re-evaluated during sync.
- Assignment revocation removes local access at the next online check and according to configured offline-expiry policy.
- Form definitions and lookup values are versioned.

### Conflict rules

- Append-only events such as visits are merged.
- Non-overlapping field changes are merged when safe.
- Concurrent edits to the same field create a reviewable conflict.
- Official source data is never silently overwritten.
- A user must see and resolve or escalate conflicts; the app must not discard changes silently.

### Acceptance criteria

- A volunteer can complete assigned visits after entering airplane mode.
- Pending changes survive app restart and device reboot.
- Repeated sync requests do not create duplicate visits or submissions.
- Failed records identify the field and reason requiring action.

## 7.6 Voter Self-Service

- Allow account creation only in supported deployments.
- Verify the voter using an approved combination of source ID, contact verification, and/or administrator review.
- Avoid exposing whether unrelated people exist in the database.
- Allow the voter to submit corrections and optional details.
- Display privacy notice, purpose, retention summary, and consent controls.
- Allow communication preference changes without requiring unrelated profile fields.
- Route material identity or address changes to a review queue.
- Notify the voter of submission status without exposing internal notes.

## 7.7 Campaign Management

### Campaign object

- Name
- Objective
- Description
- Owner
- Status: draft, pending approval, scheduled, active, paused, completed, archived
- Start and end time
- Geographic scope
- Eligible audience definition
- Channels
- Content and language variants
- Volunteer tasks
- Approval history
- Budget reference, if needed later
- Aggregate performance metrics

### Initial campaign types

- Door-to-door outreach
- Volunteer task or event
- Public meeting notification
- Voter registration or information awareness
- Issue survey
- Consent-based push notification
- Consent-based SMS integration in a later phase

### Targeting safeguards

- MVP targeting supports geography, operational status, language preference, and explicit opt-in categories.
- Individual-level sensitive-trait targeting is prohibited.
- Small groups below the configured privacy threshold cannot be previewed, exported, or analyzed.
- Every campaign must record who created, approved, modified, launched, paused, and archived it.
- Campaign content must support approval and version history.
- Opt-outs and communication-frequency limits must be enforced centrally.

## 7.8 Tasks and Booth Activities

- Campaign managers or supervisors can create booth tasks.
- Tasks include title, instructions, due date, priority, geography, assignee, campaign, checklist, and evidence requirements.
- Volunteers can accept, start, complete, or report a blocker.
- Completion can include notes or permitted media.
- Administrators can monitor overdue and completed work.
- Media upload must remove unnecessary metadata and use signed, expiring access URLs.

## 7.9 Notifications

- In-app notifications are required for MVP.
- Push notifications are optional for MVP but recommended.
- Notifications include assignment changes, sync failures, task deadlines, campaign updates, and submission decisions.
- Sensitive personal data must not appear in lock-screen notification text.
- Users can configure optional notification categories.
- Mandatory security notifications cannot be disabled.

## 7.10 Search and Filtering

Volunteer search:

- Name
- Voter ID
- Household/address
- Serial number
- Visit status
- Follow-up status

Administrator filters:

- Geography
- Assignment
- Import/source version
- Data completeness
- Verification status
- Visit outcome
- Date range
- Campaign status

Search results must honor row-level authorization before returning records or counts.

---

## 8. Analytics and Reporting

Analytics must prioritize aggregate operational insight rather than individual political profiling.

## 8.1 MVP Dashboards

### Field operations

- Assigned versus visited households
- Verified voters and completion rate
- Visit outcomes
- Pending follow-ups
- Volunteer activity over time
- Booth coverage
- Offline records awaiting sync

### Data quality

- Completeness by field and geography
- Proposed changes awaiting review
- Duplicate candidates
- Conflicting updates
- Stale records
- Import error trends
- Source versus verified-data differences

### Demographic and community overview

- Age bands
- Gender distribution as represented in source data
- Work-type distribution
- Language preferences
- Aggregated issue priorities/interests
- Household voter-count distribution

Sensitive categories must remain unavailable unless explicitly approved. Even when approved, reports must be aggregated, thresholded, logged, and protected from drill-down that could identify an individual.

### Campaign performance

- Tasks assigned and completed
- Geographic reach
- Content delivery
- Event or survey responses
- Opt-outs
- Aggregate engagement by permitted dimensions

## 8.2 Analytics Rules

- Do not expose aggregate groups smaller than the configured threshold; initial recommendation: 10.
- Apply the threshold to filters and intersections, not only the initial chart.
- Suppress or combine small categories.
- Make metric definitions and update timestamps visible.
- Label source, verified, self-submitted, and derived data.
- Separate unknown/not collected from zero/none.
- Log sensitive dashboard access and exports.
- Default exports to aggregated data.
- Prevent formula injection in CSV exports.
- Add asynchronous export generation, expiration, and download auditing.

## 8.3 Future Analytics

- Coverage forecasting
- Volunteer workload balancing
- Survey trend analysis
- Data-quality anomaly detection
- Campaign A/B evaluation using aggregate, privacy-safe outcomes
- Configurable reports for non-election field programs

Any predictive model requires a documented purpose, bias evaluation, human review, explainability, monitoring, and legal/privacy approval before release.

---

## 9. Information Architecture

## 9.1 Volunteer Mobile Navigation

Bottom navigation:

1. **Home** — progress, pending sync, today’s work, urgent notices
2. **Households** — assigned household and voter list
3. **Tasks** — booth and campaign activities
4. **Campaigns** — approved briefs and content
5. **Profile** — language, security, sync status, help

Primary floating action:

- Start or resume visit, shown only where contextually appropriate

## 9.2 Voter Mobile Navigation

1. **Home**
2. **My details**
3. **Updates**
4. **Campaign information**
5. **Privacy and settings**

## 9.3 Administrator Web Navigation

- Overview
- Geography
- Voters and households
- Field operations
- Review queue
- Campaigns
- Analytics
- Imports and exports
- Users and assignments
- Form configuration
- Privacy and consent
- Audit and security
- Settings

---

## 10. Key Screens

### Mobile

- Splash and secure sign-in
- OTP/MFA verification
- Role and assignment selector
- Volunteer home dashboard
- Booth download/sync center
- Household list
- Household map, where approved
- Household details
- Start visit
- Voter verification form
- Consent confirmation
- Visit summary
- Conflict resolution
- Task list and task details
- Campaign list and campaign brief
- Notification center
- Profile, language, privacy, and support
- Voter self-registration and identity verification
- Voter self-submission form

### Web

- Administrative overview
- Geography and booth management
- User and assignment management
- Import wizard
- Voter/household record view
- Submission review queue
- Campaign composer and approval
- Aggregate analytics dashboard
- Export center
- Consent configuration
- Audit-event explorer

---

## 11. Visual and Interaction Design

## 11.1 Design Direction: Liquid Glass

Use a contemporary liquid-glass visual language inspired by translucent layered surfaces, depth, soft refraction, and fluid motion. The design must remain readable and performant rather than applying blur to every surface.

### Visual principles

- Use translucent glass for navigation bars, modal sheets, selected cards, and contextual controls.
- Place glass surfaces over calm gradients or subtle color fields.
- Use controlled background blur, thin luminous borders, soft inner highlights, and restrained shadows.
- Use larger rounded corners and fluid transitions between related screens.
- Keep data-heavy tables and forms on more opaque surfaces for clarity.
- Adapt tint and contrast to light/dark theme and background content.
- Use meaningful depth to indicate hierarchy, not decoration alone.

### Suggested design tokens

```text
Radius:
  small: 12
  medium: 18
  large: 24
  sheet: 28

Spacing:
  4, 8, 12, 16, 24, 32, 48

Glass light:
  fill: rgba(255, 255, 255, 0.62)
  border: rgba(255, 255, 255, 0.55)
  highlight: rgba(255, 255, 255, 0.72)

Glass dark:
  fill: rgba(22, 27, 36, 0.68)
  border: rgba(255, 255, 255, 0.14)
  highlight: rgba(255, 255, 255, 0.10)

Brand colors:
  primary: deep indigo or civic blue
  secondary: cyan/teal
  accent: warm amber
  success: green
  warning: amber
  danger: red
```

Final colors must pass WCAG contrast requirements; token values are starting points, not approval to use low-contrast text.

### Motion

- Use spring-based transitions for sheets and card expansion.
- Use subtle shared-element transitions from household list to details.
- Show sync through a compact, non-blocking animated state.
- Respect reduced-motion settings.
- Keep standard interaction transitions near 150–300 ms.
- Avoid decorative motion during rapid field-data entry.

### Platform adaptation

- Use native-feeling navigation and controls on both iOS and Android.
- Adopt platform-provided glass/material capabilities where stable.
- Provide a reduced-transparency fallback.
- Avoid expensive full-screen blur on lower-end devices.
- Test outdoors, in bright light, and with battery-saving modes.

## 11.2 Accessibility

- Meet WCAG 2.2 AA for applicable mobile and web experiences.
- Support screen readers, keyboard navigation on web, dynamic text, and font scaling.
- Minimum touch target: 44 × 44 points on iOS and 48 × 48 dp on Android.
- Never communicate status using color alone.
- Ensure forms have persistent labels, clear errors, and recovery guidance.
- Support reduced motion, increased contrast, and reduced transparency.
- Localize dates, numbers, names, and address presentation.
- Design for one-handed use and low-literacy workflows.

---

## 12. Data Model

The following is a conceptual model; implementation names may follow repository conventions.

### Core entities

```text
Organization
- id
- name
- status
- default_language
- policy_configuration
- created_at

ElectionProgram
- id
- organization_id
- name
- type
- start_date
- end_date
- status

GeographyNode
- id
- program_id
- parent_id
- type
- code
- name
- metadata

User
- id
- organization_id
- name
- phone/email
- status
- preferred_language
- mfa_state

RoleAssignment
- id
- user_id
- role
- geography_node_id
- valid_from
- valid_until
- granted_by

Household
- id
- geography_node_id
- display_address
- structured_address
- location
- location_precision
- location_source
- location_consent_id
- source_version_id
- status

Voter
- id
- household_id
- source_voter_id
- source_data
- current_verified_data
- verification_status
- record_status

FieldValue
- id
- entity_type
- entity_id
- field_definition_id
- value_encrypted_or_typed
- source_type
- verification_status
- consent_id
- collected_by
- collected_at
- supersedes_id

Visit
- id
- household_id
- volunteer_id
- started_at
- completed_at
- outcome
- form_version_id
- sync_client_id
- notes

Submission
- id
- submitter_id
- subject_voter_id
- source_type
- status
- reviewed_by
- reviewed_at

Consent
- id
- subject_id
- purpose
- notice_version
- status
- captured_method
- captured_by
- captured_at
- withdrawn_at

Campaign
- id
- organization_id
- owner_id
- objective
- status
- geography_scope
- audience_definition
- starts_at
- ends_at

CampaignContent
- id
- campaign_id
- language
- version
- channel
- content_reference
- approval_status

Task
- id
- campaign_id
- geography_node_id
- assignee_id
- status
- due_at
- completion_data

ImportJob
- id
- source_version_id
- uploaded_by
- file_reference
- mapping
- status
- row_counts
- checksum

AuditEvent
- id
- actor_id
- action
- resource_type
- resource_id
- result
- timestamp
- device_or_session_id
- metadata
```

### Data handling requirements

- Use stable opaque IDs; never expose sequential database IDs publicly.
- Encrypt sensitive fields and all backups.
- Separate source values from collected or corrected values.
- Prefer structured categories over free text.
- Store timestamps in UTC and render in the user’s locale.
- Soft-delete or archive records according to policy; preserve required audit history.
- Define a retention policy by entity and purpose.
- Use database constraints for referential integrity and uniqueness.

---

## 13. Suggested Technical Architecture

The implementation agent may adjust technology choices after confirming team skills and hosting constraints.

## 13.1 Recommended Stack

### Mobile

- **Flutter** for a single iOS/Android codebase and controlled custom visual rendering.
- Riverpod or Bloc for predictable state management.
- GoRouter for navigation.
- Drift/SQLite for encrypted offline data and queued mutations.
- Platform secure storage for tokens and encryption keys.
- Firebase Cloud Messaging and Apple Push Notification service through a notification backend.

**Alternative:** React Native with Expo Development Builds if the team is stronger in TypeScript. Do not use a purely web-wrapped application for the field workflow.

### Administration web app

- Next.js with TypeScript
- Accessible component primitives
- Responsive dashboard and table components
- Shared API schema/types generated from the backend contract

### Backend

- NestJS with TypeScript or another team-standard typed backend framework
- REST API with OpenAPI documentation
- PostgreSQL with row-level authorization strategy
- PostGIS only if approved location features require it
- Redis-backed jobs/queues for imports, exports, notifications, and analytics refresh
- S3-compatible object storage for import files and approved media

### Infrastructure

- Containerized services
- Separate development, staging, and production environments
- Infrastructure as code
- Managed secrets
- Central logs, metrics, traces, and alerts
- Automated database backups and restore testing
- CDN/WAF for public web endpoints

## 13.2 Logical Components

```text
Flutter Mobile Apps
        |
Next.js Admin Portal
        |
API Gateway / Backend
        |
------------------------------------------------
Identity | Voter Data | Field Ops | Campaigns
Consent  | Imports    | Analytics | Audit
------------------------------------------------
        |
PostgreSQL | Object Storage | Queue | Notifications
```

## 13.3 API Requirements

- Version APIs from the first release.
- Use request IDs and structured error responses.
- Validate all input on the server.
- Enforce object- and geography-level authorization on every request.
- Support pagination, field filtering, and bounded query sizes.
- Use idempotency keys for visits, submissions, imports, and sync operations.
- Return explicit conflict responses for concurrent edits.
- Never expose internal stack traces to clients.
- Generate and maintain an OpenAPI specification.

### Example endpoint groups

```text
/v1/auth
/v1/me
/v1/assignments
/v1/geographies
/v1/households
/v1/voters
/v1/visits
/v1/submissions
/v1/sync
/v1/tasks
/v1/campaigns
/v1/imports
/v1/analytics
/v1/exports
/v1/consents
/v1/audit-events
```

---

## 14. Security, Privacy, and Compliance

This section is a release requirement, not future hardening.

### Security controls

- Encrypt traffic with modern TLS.
- Encrypt databases, backups, object storage, and offline mobile data.
- Store credentials and tokens only in platform secure storage.
- Use short-lived access tokens and rotated refresh tokens.
- Require MFA for privileged users.
- Enforce least-privilege role and geography access.
- Rate-limit authentication, search, export, and verification endpoints.
- Protect against enumeration of voters and accounts.
- Detect rooted/jailbroken devices according to risk policy without relying on it as the sole control.
- Redact personal data from logs, analytics SDKs, crash reports, and notifications.
- Scan uploaded files and restrict type and size.
- Maintain append-only, tamper-evident audit records for sensitive operations.
- Review dependencies and mobile/web security before release.
- Create incident response, breach notification, and credential-revocation procedures.

### Privacy controls

- Maintain a field-level data inventory and purpose.
- Collect optional data only after the required notice/consent.
- Record consent version, time, method, purpose, and withdrawal.
- Allow collection forms to omit fields that are not approved in a jurisdiction.
- Apply retention and deletion rules automatically.
- Provide data-subject request workflows where applicable.
- Use minimum cohort sizes and disclosure controls in analytics.
- Disable third-party advertising trackers.
- Do not sell or share personal data for unrelated purposes.
- Complete jurisdiction-specific legal and election-law review before deployment.

### Audit events

At minimum, log:

- Sign-in and sign-out
- Failed authentication
- Role and assignment changes
- Record view of restricted data
- Create/update/review actions
- Consent capture and withdrawal
- Import and export
- Campaign approval and launch
- Sensitive analytics access
- Account suspension
- Security configuration changes

Audit events must identify actor, action, target, time, result, and relevant session/device context without logging secret values.

---

## 15. Internationalization

- Build localization into the first release.
- Support English plus configurable regional languages.
- Keep all UI text outside source code in localization resources.
- Allow campaign content and consent notices to have independently approved language versions.
- Support Unicode names and addresses.
- Do not assume Western first-name/last-name formats.
- Support locale-aware date, time, number, and address formats.
- Provide language switching without signing out.

---

## 16. Non-Functional Requirements

### Performance

- App cold start target: under 3 seconds on supported mid-range devices.
- Common offline searches: under 500 ms for an assigned booth dataset.
- API read target: p95 under 750 ms, excluding large reports/imports.
- Form save response: under 1 second when online; immediate local acknowledgement when offline.
- Long-running imports and exports must run asynchronously.

### Reliability

- No acknowledged field update may be silently lost.
- Sync operations must be idempotent.
- Production backend target availability: 99.9%, subject to final service objectives.
- Backups must have documented RPO/RTO targets and tested restoration.

### Scalability assumptions for initial architecture

- 100,000 voters per constituency
- 5,000 concurrent field users during peak periods
- 10 million voter records across multiple deployments
- Burst-heavy sync after connectivity returns
- Large import and aggregate analytics workloads separated from interactive APIs

These are design assumptions and must be replaced by validated deployment forecasts before production sizing.

### Observability

- Structured application logs
- API latency and error metrics
- Sync success/failure metrics
- Import/export job metrics
- Queue depth and processing delay
- Authentication and authorization anomaly alerts
- Mobile crash and performance monitoring with personal-data redaction

---

## 17. MVP Scope

### Included

- Organization, geography, booth, and user setup
- Role-based authentication and authorization
- Voter-list CSV import
- Booth volunteer assignments
- Household and voter search/list/details
- Configurable voter verification form
- Field visits and outcomes
- Offline storage and synchronization
- Voter self-submission with review
- Administrator review queue
- Booth tasks
- Basic campaign creation and geographic distribution
- In-app notifications
- Field progress, data-quality, and aggregate demographic dashboards
- Consent, audit, localization foundation, and privacy controls

### Deferred

- SMS/WhatsApp integrations
- Donations and payments
- Advanced predictive analytics
- Advertising-platform integrations
- Complex survey builder
- Call-center integration
- Cross-organization data sharing
- Full no-code workflow builder
- Biometric verification

---

## 18. Delivery Plan

### Phase 0: Discovery and Governance

- Confirm countries/jurisdictions and legal basis.
- Approve allowed and prohibited fields.
- Define consent, retention, export, and deletion policies.
- Validate source voter-list format and quality.
- Interview representatives of all four personas.
- Finalize identity-verification approach.
- Define MVP languages and accessibility needs.
- Threat-model field devices, APIs, imports, exports, and campaign workflows.

### Phase 1: Foundation

- Create repositories and CI/CD.
- Establish design tokens and component library.
- Build identity, roles, geography, and assignments.
- Create database schema and migrations.
- Add audit-event framework and observability.
- Implement import pipeline.

### Phase 2: Field Operations

- Build volunteer mobile navigation.
- Implement household and voter lists.
- Implement visit and verification forms.
- Add local encrypted database and sync queue.
- Implement conflicts and assignment revocation.
- Add task management.

### Phase 3: Administration and Analytics

- Build review queue.
- Add field-progress and data-quality dashboards.
- Add aggregate demographic reporting.
- Add controlled exports.
- Add privacy and consent administration.

### Phase 4: Voter and Campaign Experience

- Add voter registration and self-submission.
- Add campaign composer, approvals, content, and geographic assignment.
- Add in-app and push notifications.
- Add aggregate campaign reporting.

### Phase 5: Hardening and Pilot

- Security and privacy review
- Accessibility audit
- Load and sync testing
- Backup and recovery exercise
- Device and low-connectivity testing
- Volunteer training and pilot
- Pilot feedback, defect correction, and production readiness review

---

## 19. MVP Epics and User Stories

### Epic A: Access and Assignment

- As a volunteer, I can securely sign in and see only my assigned booth.
- As an administrator, I can assign a user to a booth for a defined period.
- As an administrator, I can revoke access and invalidate active sessions.

### Epic B: Data Import

- As an administrator, I can map and validate a voter-list CSV before importing it.
- As an administrator, I can see accepted, warning, and rejected row counts.
- As an auditor, I can trace each record to a source import.

### Epic C: Household Visit

- As a volunteer, I can find a household and start a visit offline.
- As a volunteer, I can verify voters and record optional information with the appropriate notice.
- As a volunteer, I can record refusal or follow-up without completing optional fields.
- As a supervisor, I can see aggregate visit progress.

### Epic D: Synchronization

- As a volunteer, I can see whether changes are pending, synced, conflicted, or failed.
- As a volunteer, I do not lose completed visits when the app restarts.
- As a reviewer, I can resolve conflicting field changes.

### Epic E: Voter Self-Service

- As a voter, I can verify my account without learning whether unrelated voters are registered.
- As a voter, I can submit a correction and see its status.
- As a voter, I can withdraw optional communication consent.

### Epic F: Campaigns

- As a campaign manager, I can create an approved campaign for selected geographies.
- As a volunteer, I can see the latest approved brief and assigned activities.
- As an administrator, I can audit campaign creation, approval, and distribution.

### Epic G: Analytics

- As an administrator, I can compare booth coverage and completion.
- As an administrator, I can identify missing or conflicting data.
- As a campaign manager, I can see aggregate campaign delivery without accessing prohibited individual profiles.

---

## 20. Definition of Done

A feature is complete only when:

- Product acceptance criteria are met.
- Backend authorization is tested, including cross-booth access attempts.
- Offline and sync behavior is tested where applicable.
- Loading, empty, error, denied, conflict, and retry states are implemented.
- Accessibility checks pass.
- Localization keys are present and no user-facing strings are hard-coded.
- Audit events are generated for sensitive operations.
- Personal data does not leak into logs, analytics, or notifications.
- Automated unit, integration, and end-to-end tests cover critical paths.
- API and user documentation are updated.
- Monitoring and support diagnostics are available.
- Security/privacy review requirements for the feature are satisfied.

---

## 21. Required Test Scenarios

1. Volunteer signs in, downloads a booth, goes offline, completes visits, restarts the app, and syncs later.
2. Volunteer attempts to retrieve a voter from another booth through a modified API request and is denied.
3. Two users edit the same voter field and receive a reviewable conflict.
4. Duplicate sync requests create only one visit.
5. Assignment is revoked while the device is offline and local access expires according to policy.
6. Voter self-registration does not disclose unrelated account or voter existence.
7. Optional consent is declined and the visit can still be completed.
8. Consent is withdrawn and future communications stop.
9. An import contains malformed, duplicate, and unknown-geography rows.
10. Analytics filters would create a cohort below the privacy threshold and the result is suppressed.
11. Campaign manager attempts sensitive-trait targeting and the system rejects it.
12. CSV export values beginning with spreadsheet formulas are neutralized.
13. A lost device session is revoked and cannot sync or retrieve records.
14. Screen reader and large-text users can complete the primary visit flow.
15. Reduced-transparency and reduced-motion settings produce a clear, usable interface.

---

## 22. Open Decisions Before Production

These should not block initial scaffolding, but must be resolved before relevant features are finalized:

- Deployment country and applicable election/privacy laws
- Exact voter-list source format and licensing/usage restrictions
- Approved identity-verification methods
- Whether voters and volunteers use one app or separate branded apps
- Approved fields, especially caste/community, affiliation, and precise location
- Required languages
- Minimum supported iOS/Android versions
- Hosting region and data-residency requirements
- Retention periods
- Analytics cohort threshold
- Review process for volunteer and voter updates
- Approved notification channels
- Organization and tenancy model
- Expected deployment scale and peak concurrency

---

## 23. Implementation Agent Brief

Use the following instructions to begin implementation:

> Build the MVP described in this document as a production-oriented monorepo. Start with the foundation rather than implementing every feature at once. Use Flutter for iOS/Android, Next.js with TypeScript for the administration portal, a typed NestJS REST API, PostgreSQL, and an OpenAPI contract unless the repository already specifies alternatives.
>
> First deliver:
>
> 1. Monorepo structure, local development environment, linting, formatting, testing, and CI.
> 2. Shared product design tokens, including accessible liquid-glass light/dark themes and reduced-transparency behavior.
> 3. Backend modules and migrations for organizations, geography, users, role assignments, households, voters, imports, visits, consent, and audit events.
> 4. Authentication interfaces and backend authorization enforcing role and geography scope.
> 5. Seed data for one organization, constituency, booth, administrator, volunteer, households, and voters.
> 6. A volunteer mobile vertical slice: sign-in placeholder, assigned household list, voter details, visit form, local persistence, queued sync, and visible sync state.
> 7. An administrator web vertical slice: sign-in placeholder, CSV import preview, booth progress, voter record review, and audit-event view.
> 8. Automated tests for cross-booth authorization, import validation, offline queue persistence, sync idempotency, and audit-event creation.
> 9. Setup documentation, architecture decisions, environment-variable template, API documentation, and commands to run all applications.
>
> Keep restricted fields disabled in seed data and configuration. Do not implement individual political profiling or sensitive-trait campaign targeting. Represent official imported values separately from proposed and verified values. Use idempotency keys for sync writes, return explicit conflicts, and never silently discard field changes. Implement error, empty, denied, offline, retry, and loading states in the first vertical slice.
>
> Before coding, produce a short implementation plan that maps directories, modules, database entities, API endpoints, and the first vertical slice. Then implement it incrementally and run the smallest relevant tests after each milestone.

