import type { AssignmentId, SourceId } from '../../domain/ids';
import { asAssignmentId } from '../../domain/ids';
import type { Assignment, Attachment, Submission } from '../../domain/models';
import { dedupeCandidates, jaccard, tokenSet } from './dedupeKey';

/** A user-confirmed decision about two assignments, remembered forever. */
export interface MergeOverride {
  a: AssignmentId;
  b: AssignmentId;
  /** true = same homework, false = deliberately kept apart. */
  same: boolean;
}

/** A possible duplicate the user has not ruled on yet. */
export interface MergeSuggestion {
  a: AssignmentId;
  b: AssignmentId;
  reason: string;
}

export interface MergeResult {
  merged: Assignment[];
  suggestions: MergeSuggestion[];
}

/** Descriptions this similar are treated as the same assignment. */
const DESCRIPTION_SIMILARITY_THRESHOLD = 0.5;

/**
 * Collapse the same homework appearing in both Classroom and nz.ua into one item.
 *
 * There is no shared identifier between the two systems, so this is heuristic —
 * and deliberately reluctant. Only an explicit Classroom link, or a strong match
 * corroborated by the description, actually merges. Everything weaker becomes a
 * suggestion for the user to confirm once.
 */
export function mergeAssignments(
  groups: readonly (readonly Assignment[])[],
  timezone: string,
  overrides: readonly MergeOverride[] = [],
): MergeResult {
  const all = groups.flat();
  if (all.length === 0) return { merged: [], suggestions: [] };

  const union = new DisjointSet();
  for (const a of all) union.add(a.id);

  const byExplicit = new Map<string, AssignmentId>();
  const byStrong = new Map<string, Assignment[]>();
  const byWeak = new Map<string, Assignment[]>();

  for (const assignment of all) {
    for (const candidate of dedupeCandidates(assignment, timezone)) {
      if (candidate.confidence === 'explicit') {
        const existing = byExplicit.get(candidate.key);
        if (existing) union.union(existing, assignment.id);
        else byExplicit.set(candidate.key, assignment.id);
      } else if (candidate.confidence === 'strong') {
        push(byStrong, candidate.key, assignment);
      } else {
        push(byWeak, candidate.key, assignment);
      }
    }
  }

  // Strong matches still need corroboration: same subject, same due date and a
  // similar title can legitimately be two different exercises set the same week.
  for (const bucket of byStrong.values()) {
    for (const [a, b] of pairs(bucket)) {
      if (a.refs[0]?.source === b.refs[0]?.source) continue;
      if (descriptionsAgree(a, b)) union.union(a.id, b.id);
    }
  }

  const suggestions: MergeSuggestion[] = [];
  for (const bucket of byWeak.values()) {
    for (const [a, b] of pairs(bucket)) {
      if (a.refs[0]?.source === b.refs[0]?.source) continue;
      if (union.connected(a.id, b.id)) continue;
      suggestions.push({
        a: a.id,
        b: b.id,
        reason: 'Той самий предмет і той самий термін здачі',
      });
    }
  }

  // The user's explicit decision beats every heuristic, in both directions.
  const separated = new Set<string>();
  for (const override of overrides) {
    if (override.same) union.union(override.a, override.b);
    else separated.add(pairKey(override.a, override.b));
  }

  const clusters = new Map<string, Assignment[]>();
  for (const assignment of all) push(clusters, union.find(assignment.id), assignment);

  const merged = [...clusters.values()].map((cluster) => combine(cluster, separated));

  const keptApart = new Set(overrides.filter((o) => !o.same).map((o) => pairKey(o.a, o.b)));
  return {
    merged: merged.sort(byDueThenTitle),
    suggestions: suggestions.filter((s) => !keptApart.has(pairKey(s.a, s.b))),
  };
}

function descriptionsAgree(a: Assignment, b: Assignment): boolean {
  // An empty description is not evidence of difference — nz.ua often truncates.
  if (!a.description?.trim() || !b.description?.trim()) return true;
  return jaccard(tokenSet(a.description), tokenSet(b.description)) >= DESCRIPTION_SIMILARITY_THRESHOLD;
}

/**
 * Combine a cluster into one assignment.
 *
 * Field precedence is a table rather than a chain of ifs, and every winner is
 * recorded in `provenance` so a disagreement between the two systems stays visible
 * in the detail panel instead of being silently resolved.
 */
function combine(cluster: readonly Assignment[], separated: Set<string>): Assignment {
  if (cluster.length === 1) return cluster[0] as Assignment;

  // Classroom first: it is the authority on whether work was actually handed in.
  const ordered = [...cluster].sort((x, y) => sourceRank(x) - sourceRank(y));
  const primary = ordered[0] as Assignment;
  const provenance: Assignment['provenance'] = {};

  const withDue = ordered.filter((a) => a.dueAt);
  // Earliest due date wins: alerting early is the safe direction to be wrong in.
  const due = withDue.sort((x, y) => (x.dueAt as string).localeCompare(y.dueAt as string))[0];

  const submission = pickSubmission(ordered);
  const description = ordered
    .filter((a) => a.description?.trim())
    .sort((x, y) => (y.description as string).length - (x.description as string).length)[0];

  const grade = ordered.find((a) => a.refs.some((r) => r.source === 'nz') && a.submission.grade)?.submission.grade
    ?? ordered.find((a) => a.submission.grade)?.submission.grade;

  if (due) provenance.dueAt = sourceOf(due);
  if (description) provenance.description = sourceOf(description);
  provenance.submission = sourceOf(submission.from);
  provenance.title = sourceOf(primary);

  return {
    ...primary,
    // The cluster id must be stable regardless of which source arrived first.
    id: asAssignmentId(clusterId(cluster)),
    dedupeKey: clusterId(cluster),
    title: primary.title,
    description: description?.description,
    dueAt: due?.dueAt,
    dueIsAllDay: due?.dueIsAllDay ?? primary.dueIsAllDay,
    assignedAt: ordered.find((a) => a.assignedAt)?.assignedAt,
    submission: grade ? { ...submission.value, grade } : submission.value,
    attachments: dedupeAttachments(ordered.flatMap((a) => a.attachments)),
    refs: ordered.flatMap((a) => a.refs),
    provenance,
    relatedIds: ordered
      .map((a) => a.id)
      .filter((id) => !separated.has(pairKey(primary.id, id)) && id !== primary.id),
  };
}

/**
 * Classroom knows the real submission state; nz.ua usually reports 'unknown'.
 * A local "done" beats both — it is the student's own answer.
 */
function pickSubmission(ordered: readonly Assignment[]): { value: Submission; from: Assignment } {
  const local = ordered.find((a) => a.submission.locallyDone);
  if (local) return { value: local.submission, from: local };

  const known = ordered.find((a) => a.submission.state !== 'unknown');
  const chosen = known ?? (ordered[0] as Assignment);
  return { value: chosen.submission, from: chosen };
}

function dedupeAttachments(attachments: readonly Attachment[]): Attachment[] {
  const seen = new Map<string, Attachment>();
  for (const attachment of attachments) {
    const key = (attachment.url ?? '').trim() || `${attachment.kind}:${attachment.title}`;
    if (!seen.has(key)) seen.set(key, attachment);
  }
  return [...seen.values()];
}

const SOURCE_PRIORITY: Record<SourceId, number> = { 'google-classroom': 0, nz: 1 };

function sourceRank(a: Assignment): number {
  return SOURCE_PRIORITY[a.refs[0]?.source ?? 'nz'] ?? 9;
}

function sourceOf(a: Assignment): SourceId {
  return a.refs[0]?.source ?? 'nz';
}

/** Order-independent so the merged id does not depend on which source synced first. */
function clusterId(cluster: readonly Assignment[]): string {
  return [...cluster.map((a) => a.id)].sort().join('+');
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function byDueThenTitle(x: Assignment, y: Assignment): number {
  if (x.dueAt && y.dueAt) return x.dueAt.localeCompare(y.dueAt) || x.title.localeCompare(y.title);
  if (x.dueAt) return -1;
  if (y.dueAt) return 1;
  return x.title.localeCompare(y.title);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

function* pairs<T>(items: readonly T[]): Generator<[T, T]> {
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) yield [items[i] as T, items[j] as T];
  }
}

/** Union-find, so merging is transitive: if A≡B and B≡C then all three collapse. */
class DisjointSet {
  private parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    let root = this.parent.get(id) ?? id;
    while (root !== this.parent.get(root)) root = this.parent.get(root) as string;
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    // Deterministic root so cluster ids do not depend on insertion order.
    const [keep, drop] = rootA < rootB ? [rootA, rootB] : [rootB, rootA];
    this.parent.set(drop, keep);
  }

  connected(a: string, b: string): boolean {
    return this.find(a) === this.find(b);
  }
}
