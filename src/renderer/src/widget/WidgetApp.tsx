import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Assignment } from '@shared/domain/models';
import { useSettings, useSnapshot, useValidUntil } from '@renderer/state/useSnapshot';
import { SELECTION_LABEL, civilDateOf, formatCivilDate } from '@renderer/lib/format';
import { SchedulePanel } from './panels/SchedulePanel';
import { HomeworkPanel } from './panels/HomeworkPanel';
import { DetailDrawer } from '../widget/components/DetailDrawer';

export function WidgetApp() {
  const { snapshot, refreshing, refresh } = useSnapshot();
  const settings = useSettings();
  const [selected, setSelected] = useState<Assignment | null>(null);
  const [tick, setTick] = useState(0);

  // The selection expires at a known instant, so re-ask main then rather than poll.
  const onExpire = useCallback(() => {
    setTick((t) => t + 1);
    void window.api.data.getSnapshot();
    refresh();
  }, [refresh]);
  useValidUntil(snapshot?.selection.validUntil, onExpire);

  // Open the item a notification was clicked for.
  useEffect(
    () =>
      window.api.on('navigate', (event) => {
        const match = snapshot?.assignments.find((a) => a.id === event.id);
        if (match) setSelected(match);
      }),
    [snapshot],
  );

  const timezone = settings?.schedule.timezone ?? 'Europe/Kyiv';
  const now = useMemo(() => new Date(), [tick, snapshot?.generatedAt]);
  const todayCivil = civilDateOf(now.toISOString(), timezone);

  const courseNames = useMemo(
    () => new Map((snapshot?.courses ?? []).map((c) => [c.id, c.name])),
    [snapshot?.courses],
  );

  const lessonsForDay = useMemo(
    () => (snapshot?.lessons ?? []).filter((l) => l.date === snapshot?.selection.date),
    [snapshot?.lessons, snapshot?.selection],
  );

  if (!snapshot || !settings) {
    // Cache-backed, so this is a single frame at most — never a visible spinner.
    return <div className="widget" />;
  }

  const hasAccounts = settings.profiles.length > 0;
  const hasTimetableSource = settings.profiles.some((p) => p.source === 'nz' && p.enabled);
  const errored = snapshot.health.some((h) => h.status !== 'ok');

  return (
    <div className="widget">
      <header className="widget__header">
        <span
          className={`status-dot status-dot--${errored ? 'error' : snapshot.stale ? 'stale' : 'ok'}`}
          title={errored ? 'Проблема з джерелом даних' : snapshot.stale ? 'Дані застаріли' : 'Дані актуальні'}
        />
        <div>
          <div className="widget__title">{SELECTION_LABEL[snapshot.selection.label]}</div>
          <div className="widget__subtitle">{formatCivilDate(snapshot.selection.date)}</div>
        </div>

        <div className="widget__actions">
          <button
            type="button"
            className={`icon-btn${refreshing ? ' icon-btn--spin' : ''}`}
            onClick={refresh}
            aria-label="Оновити"
            title="Оновити"
          >
            ↻
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void window.api.window.openSettings()}
            aria-label="Налаштування"
            title="Налаштування"
          >
            ⚙
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => void window.api.window.hideWidget()}
            aria-label="Сховати"
            title="Сховати"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="widget__body">
        {!hasAccounts ? (
          <div className="empty">
            <p>Ще не підключено жодного акаунта.</p>
            <button type="button" className="btn" onClick={() => void window.api.window.openSettings()}>
              Підключити Google Classroom
            </button>
          </div>
        ) : (
          <>
            {snapshot.stale && (
              <div className="stale-banner">
                <span>⚠</span>
                <span>Дані можуть бути застарілими</span>
              </div>
            )}

            {settings.appearance.showSchedulePanel && (
              <SchedulePanel
                lessons={lessonsForDay}
                timezone={timezone}
                now={now}
                noTimetableSource={!hasTimetableSource}
              />
            )}

            {settings.appearance.showHomeworkPanel && (
              <HomeworkPanel
                assignments={snapshot.assignments}
                courseNames={courseNames}
                timezone={timezone}
                todayCivil={todayCivil}
                onOpen={setSelected}
              />
            )}
          </>
        )}
      </div>

      {selected && (
        <DetailDrawer
          assignment={selected}
          timezone={timezone}
          todayCivil={todayCivil}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
