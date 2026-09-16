import { useMemo } from 'react';
import type { Assignment } from '@shared/domain/models';
import { dueUrgency, formatDue } from '@renderer/lib/format';
import type { DueUrgency } from '@renderer/lib/format';

interface Props {
  assignments: Assignment[];
  courseNames: Map<string, string>;
  timezone: string;
  todayCivil: string;
  onOpen: (assignment: Assignment) => void;
}

const DONE_STATES = new Set(['submitted', 'graded']);

export function HomeworkPanel({ assignments, courseNames, timezone, todayCivil, onOpen }: Props) {
  const groups = useMemo(() => {
    const open = assignments.filter((a) => !isDone(a));

    const byUrgency = (u: DueUrgency) =>
      open
        .filter((a) => dueUrgency(a, todayCivil, timezone) === u)
        .sort((x, y) => (x.dueAt ?? '').localeCompare(y.dueAt ?? ''));

    return {
      overdue: byUrgency('overdue'),
      today: byUrgency('today'),
      upcoming: [...byUrgency('soon'), ...byUrgency('later')],
    };
  }, [assignments, todayCivil, timezone]);

  const total = groups.overdue.length + groups.today.length + groups.upcoming.length;

  if (total === 0) {
    return (
      <section className="section">
        <h2 className="section__title">Домашні завдання</h2>
        <p className="empty">Усе виконано. 🎉</p>
      </section>
    );
  }

  return (
    <>
      <Group
        title="Прострочено"
        danger
        items={groups.overdue}
        {...{ courseNames, timezone, todayCivil, onOpen }}
      />
      <Group title="На сьогодні" items={groups.today} {...{ courseNames, timezone, todayCivil, onOpen }} />
      <Group title="Найближчі" items={groups.upcoming} {...{ courseNames, timezone, todayCivil, onOpen }} />
    </>
  );
}

function Group({
  title,
  items,
  danger,
  courseNames,
  timezone,
  todayCivil,
  onOpen,
}: {
  title: string;
  items: Assignment[];
  danger?: boolean;
} & Omit<Props, 'assignments'>) {
  if (items.length === 0) return null;

  return (
    <section className="section">
      <h2 className="section__title">
        {title}
        <span className={`badge${danger ? ' badge--danger' : ''}`}>{items.length}</span>
      </h2>
      {items.map((a) => (
        <AssignmentRow
          key={a.id}
          assignment={a}
          courseName={courseNames.get(a.courseId)}
          timezone={timezone}
          todayCivil={todayCivil}
          onOpen={onOpen}
        />
      ))}
    </section>
  );
}

function AssignmentRow({
  assignment,
  courseName,
  timezone,
  todayCivil,
  onOpen,
}: {
  assignment: Assignment;
  courseName?: string;
  timezone: string;
  todayCivil: string;
  onOpen: (a: Assignment) => void;
}) {
  const done = isDone(assignment);
  const urgency = dueUrgency(assignment, todayCivil, timezone);
  const dueClass =
    urgency === 'overdue' ? ' hw__due--overdue' : urgency === 'today' ? ' hw__due--today' : '';

  return (
    <div className={`hw${done ? ' hw--done' : ''}`}>
      <button
        type="button"
        className={`hw__check${done ? ' hw__check--done' : ''}`}
        aria-label={done ? 'Позначити як невиконане' : 'Позначити як виконане'}
        onClick={(e) => {
          e.stopPropagation();
          void window.api.alerts.markDone(assignment.id, !done);
        }}
      >
        ✓
      </button>

      <button type="button" className="hw__main" onClick={() => onOpen(assignment)}>
        <div className="hw__title">{assignment.title}</div>
        <div className="hw__meta">
          {courseName && (
            <>
              <span>{courseName}</span>
              <span className="dot" />
            </>
          )}
          <span className={dueClass}>{formatDue(assignment, todayCivil, timezone)}</span>
          {assignment.attachments.length > 0 && (
            <>
              <span className="dot" />
              <span>📎 {assignment.attachments.length}</span>
            </>
          )}
        </div>
      </button>
    </div>
  );
}

function isDone(a: Assignment): boolean {
  return a.submission.locallyDone === true || DONE_STATES.has(a.submission.state);
}
