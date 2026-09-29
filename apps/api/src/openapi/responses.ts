/**
 * Every type the API returns, by the name the OpenAPI spec uses (#52).
 * Routes name one of these with `@ApiResult('Name')`; the export turns
 * each into a JSON schema. Add a response type here when you add a route.
 */
import type { Page } from '../common/pagination';
import type { GeographyNodeView } from '../geography/geography.service';
import type { HouseholdSummary } from '../households/households.service';
import type { UploadTicket } from '../imports/imports.service';
import type { MutationResult } from '../sync/push.service';

export type {
  AnalyticsSummary,
  ChildrenBreakdown,
  Revisions,
} from '../analytics/analytics.service';
export type { AuditEventsPage } from '../audit/audit-events.service';
export type { TokenPair } from '../auth/dto';
export type { ApiErrorBody } from '../common/errors/app.exception';
export type { ConflictResolved } from '../conflicts/conflicts.service';
export type { GeographyNodeDetail } from '../geography/geography.service';
export type { MasterImportReport, MasterNodeView } from '../geography/master-data.service';
export type { HealthReport } from '../health/health.service';
export type {
  HouseholdCreated,
  HouseholdUpdated,
  MemberCreated,
} from '../households/household-writes.service';
export type { HouseholdDetail } from '../households/households.service';
export type { BatchConfirmResult, ConfirmQueued } from '../imports/confirm.service';
export type { BatchView, UploadCompleted } from '../imports/imports.service';
export type { BatchDetail, FilePreview, ReviewRow } from '../imports/review.service';
export type { SyncPage } from '../sync/sync.service';
export type { Me } from '../users/me.service';
export type { VisitCreated } from '../visits/visits.service';
export type { MemberEdited } from '../voters/voter-writes.service';
export type { VoterDetail } from '../voters/voters.service';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a named Page<T> for the spec
export interface GeographyNodePage extends Page<GeographyNodeView> {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- a named Page<T> for the spec
export interface HouseholdPage extends Page<HouseholdSummary> {}
export interface SyncPushResult {
  results: MutationResult[];
}
export interface UploadTickets {
  uploads: UploadTicket[];
}
