import { useEffect, useState } from 'react';
import type { Assignment } from '@shared/domain/models';
import type { AssignmentDetail } from '@shared/ipc/contract';
import { formatDue } from '@renderer/lib/format';

const STATE_LABELS: Record<string, string> = {
  unknown: 'Невідомо',
  not_started: 'Не розпочато',
  in_progress: 'У роботі',
  submitted: 'Здано',
  returned: 'Повернено на доопрацювання',
  graded: 'Оцінено',
  missing: 'Не здано',
};

const SOURCE_LABELS: Record<string, string> = {
  'google-classroom': 'Google Classroom',
  nz: 'nz.ua',
};

interface Props {
  assignment: Assignment;
  timezone: string;
  todayCivil: string;
  onClose: () => void;
}

export function DetailDrawer({ assignment, timezone, todayCivil, onClose }: Props) {
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);

  useEffect(() => {
    void window.api.data.getAssignment(assignment.id).then(setDetail);
  }, [assignment.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = detail?.assignment ?? assignment;
  const done = current.submission.locallyDone === true;
  const webUrl = current.refs.find((r) => r.webUrl)?.webUrl;

  return (
    <div className="drawer">
      <div className="drawer__header">
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Назад">
          ←
        </button>
        <span className="widget__subtitle">{detail?.course?.name ?? ''}</span>
      </div>

      <div className="drawer__body">
        <h1 className="drawer__title">{current.title}</h1>

        <div className="drawer__row">
          <span className="drawer__label">Термін</span>
          <span>{formatDue(current, todayCivil, timezone)}</span>
        </div>
        <div className="drawer__row">
          <span className="drawer__label">Статус</span>
          <span>{STATE_LABELS[current.submission.state] ?? current.submission.state}</span>
        </div>
        {current.submission.grade && (
          <div className="drawer__row">
            <span className="drawer__label">Оцінка</span>
            <span>{String(current.submission.grade.value)}</span>
          </div>
        )}
        {/* More than one source means this item was merged; showing both keeps a
            disagreement between Classroom and nz.ua visible rather than hidden. */}
        <div className="drawer__row">
          <span className="drawer__label">Джерело</span>
          <span>{current.refs.map((r) => SOURCE_LABELS[r.source] ?? r.source).join(' + ') || '—'}</span>
        </div>

        {current.description && <p className="drawer__desc">{current.description}</p>}

        {current.attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            className="attachment"
            disabled={!a.url}
            onClick={() => a.url && void window.api.system.openExternal(a.url)}
          >
            <span>{iconFor(a.kind)}</span>
            <span>{a.title}</span>
          </button>
        ))}
      </div>

      <div className="drawer__actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void window.api.alerts.markDone(current.id, !done);
            onClose();
          }}
        >
          {done ? 'Повернути в роботу' : 'Виконано'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void window.api.alerts.snooze(current.id, 60);
            onClose();
          }}
        >
          Відкласти на годину
        </button>
        {webUrl && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void window.api.system.openExternal(webUrl)}
          >
            Відкрити ↗
          </button>
        )}
      </div>
    </div>
  );
}

function iconFor(kind: string): string {
  switch (kind) {
    case 'drive':
      return '📄';
    case 'youtube':
      return '▶️';
    case 'form':
      return '📝';
    case 'link':
      return '🔗';
    default:
      return '📎';
  }
}
