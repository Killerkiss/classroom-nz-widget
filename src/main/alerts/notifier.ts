import { Notification } from 'electron';
import type { AlertDecision } from '@shared/core/alerts/types';
import type { AppSettings } from '@shared/domain/settings';
import { formatIn } from '@shared/core/timezone';

const UK = {
  due_soon: 'Завдання на завтра',
  due_today: 'Завдання на сьогодні',
  overdue: 'Прострочене завдання',
} as const;

const EN = {
  due_soon: 'Homework due tomorrow',
  due_today: 'Homework due today',
  overdue: 'Overdue homework',
} as const;

export interface Notifier {
  show(decision: AlertDecision, settings: AppSettings, onClick: () => void): void;
}

export class ElectronNotifier implements Notifier {
  show(decision: AlertDecision, settings: AppSettings, onClick: () => void): void {
    if (!Notification.isSupported()) return;

    const strings = settings.locale === 'en' ? EN : UK;
    const due = decision.dueAt
      ? formatIn(new Date(decision.dueAt), settings.schedule.timezone, 'd MMM, HH:mm')
      : null;

    const notification = new Notification({
      title: strings[decision.reason],
      body: due ? `${decision.assignmentTitle} — ${due}` : decision.assignmentTitle,
      urgency: decision.reason === 'overdue' ? 'critical' : 'normal',
    });

    notification.on('click', onClick);
    notification.show();
  }
}
