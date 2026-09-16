import type { Lesson } from '@shared/domain/models';
import { formatTime, isLessonNow } from '@renderer/lib/format';

interface Props {
  lessons: Lesson[];
  timezone: string;
  now: Date;
  /** True when no configured source can supply a timetable at all. */
  noTimetableSource: boolean;
}

export function SchedulePanel({ lessons, timezone, now, noTimetableSource }: Props) {
  return (
    <section className="section">
      <h2 className="section__title">
        Розклад
        {lessons.length > 0 && <span className="badge">{lessons.length}</span>}
      </h2>

      {lessons.length === 0 ? (
        <p className="empty">
          {noTimetableSource
            ? 'Розклад надходить із nz.ua. Google Classroom не має розкладу уроків.'
            : 'Уроків немає.'}
        </p>
      ) : (
        lessons.map((lesson) => <LessonRow key={lesson.id} lesson={lesson} timezone={timezone} now={now} />)
      )}
    </section>
  );
}

function LessonRow({ lesson, timezone, now }: { lesson: Lesson; timezone: string; now: Date }) {
  const current = isLessonNow(lesson, now);
  const meta = [lesson.room, lesson.teacher].filter(Boolean).join(' · ');

  return (
    <div className={`lesson${current ? ' lesson--now' : ''}${lesson.cancelled ? ' lesson--cancelled' : ''}`}>
      <div className="lesson__time">{formatTime(lesson.startsAt, timezone)}</div>
      <div className="lesson__rail" />
      <div style={{ minWidth: 0 }}>
        <div className="lesson__name">
          {lesson.period}. {lesson.title}
        </div>
        {meta && <div className="lesson__meta">{meta}</div>}
      </div>
      {lesson.meetLink && !lesson.cancelled && (
        <button
          type="button"
          className="meet-btn"
          onClick={() => void window.api.system.openExternal(lesson.meetLink as string)}
          title={lesson.meetLink}
        >
          Meet
        </button>
      )}
    </div>
  );
}
