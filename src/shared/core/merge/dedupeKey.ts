import type { Assignment, CivilDate } from '../../domain/models';
import { civilDateIn } from '../timezone';

/**
 * How confident we are that two assignments are the same piece of homework.
 *
 * Conservative on purpose: a false merge *hides a real assignment*, which is the
 * one failure mode that actually gets a student in trouble. Showing the same
 * homework twice is merely untidy.
 */
export type DedupeConfidence = 'explicit' | 'strong' | 'weak';

export interface DedupeCandidate {
  key: string;
  confidence: DedupeConfidence;
}

/** Ukrainian and English filler words, dropped before comparing titles. */
const STOPWORDS = new Set([
  'та', 'і', 'й', 'в', 'у', 'на', 'з', 'із', 'до', 'по', 'для', 'від', 'про', 'за',
  'the', 'a', 'an', 'of', 'to', 'for', 'and', 'in', 'on',
  'вправа', 'вправи', 'завдання', 'homework', 'hw', 'дз',
]);

const CLASSROOM_LINK = /classroom\.google\.com\/c\/[\w-]+\/a\/([\w-]+)/i;

/**
 * Pull a Classroom assignment id out of free text.
 *
 * When a teacher pastes the Classroom link into the nz.ua homework, we get an
 * exact identity for free — by far the most reliable signal available.
 */
export function extractClassroomAssignmentId(text: string | undefined): string | null {
  if (!text) return null;
  return CLASSROOM_LINK.exec(text)?.[1] ?? null;
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

/** A short, stable fingerprint of a title — digits preserved, since they carry meaning. */
export function titleFingerprint(title: string): string {
  return normalizeTitle(title).slice(0, 32);
}

export function tokenSet(text: string | undefined): Set<string> {
  if (!text) return new Set();
  return new Set(normalizeTitle(text).split(' ').filter(Boolean));
}

/** Jaccard similarity of two token sets: |A ∩ B| / |A ∪ B|. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function dueCivilDate(a: Assignment, timezone: string): CivilDate | 'none' {
  return a.dueAt ? civilDateIn(new Date(a.dueAt), timezone) : 'none';
}

/**
 * Derive the candidate keys for an assignment, strongest first.
 *
 * `explicit` merges unconditionally. `strong` merges only after a description check
 * (see mergeAssignments). `weak` never merges on its own — it becomes a suggestion
 * the user confirms once.
 */
export function dedupeCandidates(a: Assignment, timezone: string): DedupeCandidate[] {
  const candidates: DedupeCandidate[] = [];

  const linked = extractClassroomAssignmentId(a.description) ?? extractClassroomAssignmentId(a.title);
  if (linked) candidates.push({ key: `cr:${linked}`, confidence: 'explicit' });

  // The assignment's own Classroom id is the same identity seen from the other side.
  const ownClassroomRef = a.refs.find((r) => r.source === 'google-classroom');
  if (ownClassroomRef) candidates.push({ key: `cr:${ownClassroomRef.nativeId}`, confidence: 'explicit' });

  const due = dueCivilDate(a, timezone);
  candidates.push({
    key: `s:${a.subjectKey}|${due}|${titleFingerprint(a.title)}`,
    confidence: 'strong',
  });
  candidates.push({ key: `w:${a.subjectKey}|${due}`, confidence: 'weak' });

  return candidates;
}
