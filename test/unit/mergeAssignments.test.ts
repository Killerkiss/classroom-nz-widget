import { describe, expect, it } from 'vitest';
import { mergeAssignments } from '@shared/core/merge/mergeAssignments';
import type { MergeOverride } from '@shared/core/merge/mergeAssignments';
import { extractClassroomAssignmentId, jaccard, tokenSet } from '@shared/core/merge/dedupeKey';
import type { Assignment } from '@shared/domain/models';
import type { SourceId } from '@shared/domain/ids';
import { asAssignmentId, asCourseId, asNativeId, asProfileId } from '@shared/domain/ids';

const TZ = 'Europe/Kyiv';
const FETCHED = '2026-09-16T09:00:00.000Z';

function make(
  source: SourceId,
  id: string,
  over: Partial<Assignment> = {},
): Assignment {
  return {
    id: asAssignmentId(id),
    dedupeKey: id,
    courseId: asCourseId('c1'),
    subjectKey: 'algebra',
    title: 'Вправи 12-18',
    dueIsAllDay: true,
    dueAt: '2026-09-17T20:59:00.000Z',
    submission: { state: 'not_started' },
    attachments: [],
    refs: [{ source, profileId: asProfileId('p1'), nativeId: asNativeId(id), fetchedAt: FETCHED }],
    provenance: {},
    ...over,
  };
}

const classroom = (id: string, over: Partial<Assignment> = {}) => make('google-classroom', id, over);
const nz = (id: string, over: Partial<Assignment> = {}) => make('nz', id, over);

describe('explicit merge via a Classroom link', () => {
  it('extracts the assignment id from a pasted link', () => {
    expect(
      extractClassroomAssignmentId('Дивіться https://classroom.google.com/c/NjY3/a/ABC123xyz/details'),
    ).toBe('ABC123xyz');
  });

  it('returns null when there is no link', () => {
    expect(extractClassroomAssignmentId('Вправи 12-18')).toBeNull();
    expect(extractClassroomAssignmentId(undefined)).toBeNull();
  });

  it('merges unconditionally, even with unrelated titles', () => {
    const a = classroom('ABC123xyz', { title: 'Квадратні рівняння' });
    const b = nz('nz-1', {
      title: 'Зовсім інша назва',
      description: 'https://classroom.google.com/c/NjY3/a/ABC123xyz',
    });

    const { merged } = mergeAssignments([[a], [b]], TZ);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.refs.map((r) => r.source).sort()).toEqual(['google-classroom', 'nz']);
  });
});

describe('strong merge needs corroboration', () => {
  it('merges when descriptions agree', () => {
    const a = classroom('c-1', { description: 'Розв’язати рівняння з підручника сторінка 45' });
    const b = nz('n-1', { description: 'розв язати рівняння підручник сторінка 45' });

    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(1);
  });

  it('merges when one description is empty', () => {
    const a = classroom('c-1', { description: 'Розв’язати рівняння' });
    const b = nz('n-1', { description: '' });

    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(1);
  });

  it('does NOT merge when descriptions clearly differ', () => {
    // Same subject, same due date, same title shape — but different work.
    const a = classroom('c-1', { description: 'Прочитати розділ про логарифми та скласти конспект' });
    const b = nz('n-1', { description: 'Підготувати доповідь про Піфагора для класу' });

    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(2);
  });

  it('does not merge different subjects', () => {
    const a = classroom('c-1', { subjectKey: 'algebra' });
    const b = nz('n-1', { subjectKey: 'physics' });
    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(2);
  });

  it('does not merge different due dates', () => {
    const a = classroom('c-1', { dueAt: '2026-09-17T20:59:00.000Z' });
    const b = nz('n-1', { dueAt: '2026-09-21T20:59:00.000Z' });
    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(2);
  });

  it('never merges two items from the same source', () => {
    const a = classroom('c-1');
    const b = classroom('c-2');
    expect(mergeAssignments([[a, b]], TZ).merged).toHaveLength(2);
  });
});

describe('weak matches are suggested, never merged', () => {
  it('keeps them separate and offers a suggestion', () => {
    const a = classroom('c-1', { title: 'Квадратні рівняння', description: 'сторінка 45' });
    const b = nz('n-1', { title: 'Читати параграф 12', description: 'зовсім інше завдання тут' });

    const { merged, suggestions } = mergeAssignments([[a], [b]], TZ);
    // Hiding a real assignment is the failure that matters; showing two is not.
    expect(merged).toHaveLength(2);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ a: 'c-1', b: 'n-1' });
  });
});

describe('user overrides beat every heuristic', () => {
  it('merges a pair the user confirmed', () => {
    const a = classroom('c-1', { title: 'Квадратні рівняння', description: 'сторінка 45' });
    const b = nz('n-1', { title: 'Читати параграф 12', description: 'інше завдання' });
    const overrides: MergeOverride[] = [{ a: asAssignmentId('c-1'), b: asAssignmentId('n-1'), same: true }];

    expect(mergeAssignments([[a], [b]], TZ, overrides).merged).toHaveLength(1);
  });

  it('stops suggesting a pair the user rejected', () => {
    const a = classroom('c-1', { title: 'Квадратні рівняння', description: 'сторінка 45' });
    const b = nz('n-1', { title: 'Читати параграф 12', description: 'інше завдання' });
    const overrides: MergeOverride[] = [{ a: asAssignmentId('c-1'), b: asAssignmentId('n-1'), same: false }];

    const { merged, suggestions } = mergeAssignments([[a], [b]], TZ, overrides);
    expect(merged).toHaveLength(2);
    expect(suggestions).toHaveLength(0);
  });
});

describe('field precedence when combining', () => {
  it('takes submission state from Classroom, which actually knows', () => {
    const a = classroom('c-1', { submission: { state: 'submitted' } });
    const b = nz('n-1', { submission: { state: 'unknown' } });

    const merged = mergeAssignments([[a], [b]], TZ).merged[0];
    expect(merged?.submission.state).toBe('submitted');
    expect(merged?.provenance.submission).toBe('google-classroom');
  });

  it('takes the grade from nz.ua, the official journal', () => {
    const a = classroom('c-1', { submission: { state: 'graded', grade: { value: 95, scale: 'points' } } });
    const b = nz('n-1', { submission: { state: 'graded', grade: { value: 11, scale: 'nz12' } } });

    expect(mergeAssignments([[a], [b]], TZ).merged[0]?.submission.grade?.value).toBe(11);
  });

  it('takes the earliest due date, so alerts fire early rather than late', () => {
    const a = classroom('c-1', { dueAt: '2026-09-17T20:59:00.000Z', description: 'x' });
    const b = nz('n-1', { dueAt: '2026-09-17T09:00:00.000Z', description: 'x' });

    const merged = mergeAssignments([[a], [b]], TZ).merged[0];
    expect(merged?.dueAt).toBe('2026-09-17T09:00:00.000Z');
    expect(merged?.provenance.dueAt).toBe('nz');
  });

  it('takes the longest description, since nz.ua truncates', () => {
    // Similar enough to merge; one simply carries more detail.
    const a = classroom('c-1', { description: 'Розв’язати рівняння сторінка 45' });
    const b = nz('n-1', { description: 'Розв’язати рівняння сторінка 45 повністю' });

    const { merged } = mergeAssignments([[a], [b]], TZ);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.description).toContain('повністю');
    expect(merged[0]?.provenance.description).toBe('nz');
  });

  it('refuses to merge when descriptions are too dissimilar to trust', () => {
    // Same subject, same due date, same title — but one is a summary and the other
    // a truncation of something else. Showing two beats hiding one.
    const a = classroom('c-1', { description: 'Коротко' });
    const b = nz('n-1', { description: 'Коротко, але значно детальніше з усіма поясненнями' });

    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(2);
  });

  it('lets a local "done" win over the provider state', () => {
    const a = classroom('c-1', { submission: { state: 'missing' } });
    const b = nz('n-1', { submission: { state: 'unknown', locallyDone: true } });

    expect(mergeAssignments([[a], [b]], TZ).merged[0]?.submission.locallyDone).toBe(true);
  });

  it('unions attachments and drops duplicates by url', () => {
    const a = classroom('c-1', {
      description: 'x',
      attachments: [{ id: '1', kind: 'link', title: 'Файл', url: 'https://d/1' }],
    });
    const b = nz('n-1', {
      description: 'x',
      attachments: [
        { id: '2', kind: 'link', title: 'Той самий', url: 'https://d/1' },
        { id: '3', kind: 'link', title: 'Інший', url: 'https://d/2' },
      ],
    });

    expect(mergeAssignments([[a], [b]], TZ).merged[0]?.attachments).toHaveLength(2);
  });
});

describe('structural guarantees', () => {
  it('is idempotent — merging a merged result changes nothing', () => {
    const a = classroom('c-1', { description: 'однакове завдання тут' });
    const b = nz('n-1', { description: 'однакове завдання тут' });

    const once = mergeAssignments([[a], [b]], TZ).merged;
    const twice = mergeAssignments([once], TZ).merged;
    expect(twice).toHaveLength(1);
    expect(twice[0]?.id).toBe(once[0]?.id);
  });

  it('produces the same id regardless of source arrival order', () => {
    const a = classroom('c-1', { description: 'x' });
    const b = nz('n-1', { description: 'x' });

    expect(mergeAssignments([[a], [b]], TZ).merged[0]?.id).toBe(
      mergeAssignments([[b], [a]], TZ).merged[0]?.id,
    );
  });

  it('is transitive across three sources', () => {
    const a = classroom('ABC1', { description: 'x' });
    const b = nz('n-1', { description: 'https://classroom.google.com/c/X/a/ABC1' });
    const c = nz('n-2', { description: 'https://classroom.google.com/c/X/a/ABC1' });

    expect(mergeAssignments([[a], [b, c]], TZ).merged).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(mergeAssignments([], TZ)).toEqual({ merged: [], suggestions: [] });
    expect(mergeAssignments([[], []], TZ).merged).toEqual([]);
  });

  it('sorts by due date, undated last', () => {
    const a = classroom('c-1', { subjectKey: 'physics', dueAt: '2026-09-20T10:00:00.000Z' });
    const b = classroom('c-2', { subjectKey: 'algebra', dueAt: '2026-09-18T10:00:00.000Z' });
    const c = classroom('c-3', { subjectKey: 'biology', dueAt: undefined });

    expect(mergeAssignments([[a, b, c]], TZ).merged.map((x) => x.id)).toEqual(['c-2', 'c-1', 'c-3']);
  });

  it('keeps undated items from merging with dated ones', () => {
    const a = classroom('c-1', { dueAt: undefined });
    const b = nz('n-1', { dueAt: '2026-09-17T20:59:00.000Z' });
    expect(mergeAssignments([[a], [b]], TZ).merged).toHaveLength(2);
  });
});

describe('jaccard', () => {
  it('scores identical sets as 1 and disjoint as 0', () => {
    expect(jaccard(tokenSet('привіт світ'), tokenSet('привіт світ'))).toBe(1);
    expect(jaccard(tokenSet('привіт'), tokenSet('бувай'))).toBe(0);
  });

  it('treats two empty sets as identical', () => {
    expect(jaccard(new Set(), new Set())).toBe(1);
  });

  it('scores partial overlap between 0 and 1', () => {
    const score = jaccard(tokenSet('алгебра рівняння сторінка'), tokenSet('алгебра рівняння конспект'));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});
