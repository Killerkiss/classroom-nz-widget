/**
 * Branded id types. These are all strings at runtime; the brands exist so that a
 * course id can never be passed where an assignment id is expected.
 */
declare const brand: unique symbol;
type Brand<T, B> = T & { readonly [brand]: B };

/** A configured account. One per Google or nz.ua login. */
export type ProfileId = Brand<string, 'ProfileId'>;
/** An id as the upstream system knows it, before we namespace it. */
export type NativeId = Brand<string, 'NativeId'>;
/** Our namespaced id: `${source}:${profileId}:${nativeId}`. */
export type CourseId = Brand<string, 'CourseId'>;
/** For assignments this is the dedupe key, so a merged item keeps one stable id. */
export type AssignmentId = Brand<string, 'AssignmentId'>;
export type LessonId = Brand<string, 'LessonId'>;

export const asProfileId = (s: string): ProfileId => s as ProfileId;
export const asNativeId = (s: string): NativeId => s as NativeId;
export const asCourseId = (s: string): CourseId => s as CourseId;
export const asAssignmentId = (s: string): AssignmentId => s as AssignmentId;
export const asLessonId = (s: string): LessonId => s as LessonId;

/** Where a piece of data came from. */
export type SourceId = 'google-classroom' | 'nz';

export const namespacedId = (source: SourceId, profileId: ProfileId, nativeId: string): string =>
  `${source}:${profileId}:${nativeId}`;
