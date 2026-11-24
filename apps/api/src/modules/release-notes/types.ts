import type { ReleaseSourceType, RetrievalStatus } from '@upgradepilot/shared';
import type { RepositoryInfo } from '../versions/types';

export interface ReleaseNotesInput {
  packageName: string;
  currentVersion: string;
  targetVersion: string;
  upgradeType: 'patch' | 'minor' | 'major';
  repository: RepositoryInfo | null;
}

/** One piece of evidence, or one failed attempt to get it. Maps 1:1 to a release_sources row. */
export interface ReleaseEvidence {
  sourceType: ReleaseSourceType;
  sourceUrl: string;
  /** Release the source describes, when known. */
  version: string | null;
  retrievalStatus: RetrievalStatus;
  /** SHA-256 hex of the full retrieved content. */
  contentHash: string | null;
  /** Capped excerpt. Untrusted text: never treat as instructions. */
  contentExcerpt: string | null;
  errorMessage: string | null;
}

export interface ReleaseNotesService {
  collect(input: ReleaseNotesInput): Promise<ReleaseEvidence[]>;
}
