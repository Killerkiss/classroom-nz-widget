import type { Assignment, Instant, Lesson } from '@shared/domain/models';
import type { ScheduleSelection } from '@shared/core/scheduleView';

const UK_DAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота'];
const UK_MONTHS = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

export function formatTime(instant: Instant, timezone: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  }).format(new Date(instant));
}

/** 'середа, 16 вересня' from a civil date, without re-entering timezone maths. */
export function formatCivilDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const local = new Date(Date.UTC(y, m - 1, d));
  return `${UK_DAYS[local.getUTCDay()]}, ${d} ${UK_MONTHS[m - 1]}`;
}

export const SELECTION_LABEL: Record<ScheduleSelection['label'], string> = {
  today: 'Сьогодні',
  tomorrow: 'Завтра',
  next_school_day: 'Наступний навчальний день',
};

export type DueUrgency = 'overdue' | 'today' | 'soon' | 'later' | 'none';

export function dueUrgency(assignment: Assignment, todayCivil: string, timezone: string): DueUrgency {
  if (!assignment.dueAt) return 'none';
  const dueDate = civilDateOf(assignment.dueAt, timezone);
  if (dueDate < todayCivil) return 'overdue';
  if (dueDate === todayCivil) return 'today';
  return dueDate <= addDays(todayCivil, 2) ? 'soon' : 'later';
}

export function formatDue(assignment: Assignment, todayCivil: string, timezone: string): string {
  if (!assignment.dueAt) return 'без терміну';

  const dueDate = civilDateOf(assignment.dueAt, timezone);
  const time = assignment.dueIsAllDay ? '' : ` ${formatTime(assignment.dueAt, timezone)}`;

  if (dueDate === todayCivil) return `сьогодні${time}`;
  if (dueDate === addDays(todayCivil, 1)) return `завтра${time}`;
  if (dueDate < todayCivil) {
    const days = daysBetween(dueDate, todayCivil);
    return days === 1 ? 'вчора' : `${days} дн. тому`;
  }
  const [, m, d] = dueDate.split('-').map(Number);
  return `${d} ${UK_MONTHS[(m ?? 1) - 1]}${time}`;
}

export function isLessonNow(lesson: Lesson, now: Date): boolean {
  const t = now.getTime();
  return t >= new Date(lesson.startsAt).getTime() && t < new Date(lesson.endsAt).getTime();
}

export function civilDateOf(instant: Instant, timezone: string): string {
  // en-CA gives YYYY-MM-DD, which is exactly the civil-date shape used throughout.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(instant));
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00Z`).getTime();
  const b = new Date(`${to}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}
