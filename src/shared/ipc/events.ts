import type { AssignmentId, ProfileId, SourceId } from '../domain/ids';
import type { AppSettings } from '../domain/settings';
import type { AlertReason } from '../core/alerts/types';
import type { AuthStatus, ProviderHealth, Snapshot } from './contract';

/** Pushes from main. One channel, demultiplexed by `type` in the preload bridge. */
export type MainEvent =
  | { type: 'snapshot:updated'; snapshot: Snapshot }
  | { type: 'sync:started'; source: SourceId }
  | { type: 'sync:finished'; source: SourceId; health: ProviderHealth }
  | { type: 'settings:changed'; settings: AppSettings }
  | { type: 'auth:changed'; profileId: ProfileId; status: AuthStatus }
  | { type: 'alert:fired'; assignmentId: AssignmentId; reason: AlertReason }
  | { type: 'navigate'; view: 'assignment'; id: AssignmentId };
