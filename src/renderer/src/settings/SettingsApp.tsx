import { useCallback, useEffect, useState } from 'react';
import type { AppSettings, DeepPartial } from '@shared/domain/settings';
import type { ProfileSummary, SecretBackendInfo } from '@shared/ipc/contract';

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [accounts, setAccounts] = useState<ProfileSummary[]>([]);
  const [backend, setBackend] = useState<SecretBackendInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void window.api.settings.get().then(setSettings);
    void window.api.auth.status().then(setAccounts);
    void window.api.auth.secretBackend().then(setBackend);
  }, []);

  useEffect(reload, [reload]);

  const patch = useCallback((p: DeepPartial<AppSettings>) => {
    void window.api.settings.patch(p).then(setSettings);
  }, []);

  if (!settings) return null;

  const addGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.api.auth.addGoogleAccount();
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <h1>Налаштування</h1>

      {error && <div className="err">{error}</div>}

      <section className="card">
        <h2>Акаунти</h2>

        {/* On Linux without a keyring, safeStorage silently falls back to a
            hardcoded key. Say so rather than implying secrets are protected. */}
        {backend && !backend.isEncryptedAtRest && backend.warning && (
          <div className="warn">{backend.warning}</div>
        )}

        {accounts.length === 0 && <p className="muted">Ще не підключено жодного акаунта.</p>}

        {accounts.map((account) => (
          <div className="account" key={account.id}>
            <span className={`status-dot status-dot--${account.status === 'authenticated' ? 'ok' : 'error'}`} />
            <span className="account__name">
              {account.displayName}
              <span className="field__hint">
                {account.status === 'authenticated' ? 'Підключено' : 'Потрібен повторний вхід'}
              </span>
            </span>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void window.api.auth.signOut(account.id).then(reload)}
            >
              Від'єднати
            </button>
          </div>
        ))}

        <div className="field">
          <span className="field__label">
            Google Classroom
            <span className="field__hint">Домашні завдання, терміни та статус здачі.</span>
          </span>
          <button type="button" className="btn" onClick={addGoogle} disabled={busy}>
            {busy ? 'Вхід…' : 'Підключити'}
          </button>
        </div>

        <div className="field">
          <span className="field__label">
            nz.ua
            <span className="field__hint">Розклад уроків і журнал. Буде додано в наступному етапі.</span>
          </span>
          <button type="button" className="btn btn--ghost" disabled>
            Незабаром
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Розклад</h2>

        <Number
          label="Показувати завтрашній день після"
          hint="О цій годині віджет перемикається з сьогоднішнього розкладу на завтрашній."
          suffix=":00"
          min={0}
          max={23}
          value={settings.schedule.flipHour}
          onChange={(flipHour) => patch({ schedule: { flipHour } })}
        />

        <Toggle
          label="У п'ятницю ввечері показувати понеділок"
          hint="Пропускати вихідні замість показу порожньої суботи."
          checked={settings.schedule.skipWeekendsToNextSchoolDay}
          onChange={(skipWeekendsToNextSchoolDay) => patch({ schedule: { skipWeekendsToNextSchoolDay } })}
        />

        <div className="field">
          <span className="field__label">
            Часовий пояс школи
            <span className="field__hint">Усі дати рахуються за цим поясом, а не за поясом комп'ютера.</span>
          </span>
          <input
            type="text"
            value={settings.schedule.timezone}
            onChange={(e) => patch({ schedule: { timezone: e.target.value } })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Нагадування</h2>

        <Toggle
          label="Увімкнути нагадування"
          checked={settings.alerts.enabled}
          onChange={(enabled) => patch({ alerts: { enabled } })}
        />

        <Number
          label="Починати о"
          suffix=":00"
          min={0}
          max={23}
          value={settings.alerts.startHour}
          onChange={(startHour) => patch({ alerts: { startHour } })}
        />

        <Number
          label="Повторювати кожні"
          suffix="хв"
          min={15}
          max={240}
          step={15}
          value={settings.alerts.repeatEveryMinutes}
          onChange={(repeatEveryMinutes) => patch({ alerts: { repeatEveryMinutes } })}
        />

        <Number
          label="Максимум нагадувань за вечір"
          hint="Занадто часті сповіщення швидко вимикають — тому за замовчуванням чотири."
          min={1}
          max={12}
          value={settings.alerts.maxAlertsPerEvening}
          onChange={(maxAlertsPerEvening) => patch({ alerts: { maxAlertsPerEvening } })}
        />

        <Number
          label="Нагадувати за скільки днів до терміну"
          suffix="дн."
          min={0}
          max={7}
          value={settings.alerts.leadDays}
          onChange={(leadDays) => patch({ alerts: { leadDays } })}
        />

        <Toggle
          label="Нагадувати про прострочене"
          checked={settings.alerts.alertOnOverdue}
          onChange={(alertOnOverdue) => patch({ alerts: { alertOnOverdue } })}
        />

        <div className="field">
          <span className="field__label">
            Тиша з
            <span className="field__hint">Нагадування в цей проміжок пропускаються.</span>
          </span>
          <input
            type="time"
            value={settings.alerts.quietHours?.start ?? '22:00'}
            onChange={(e) =>
              patch({
                alerts: {
                  quietHours: { start: e.target.value, end: settings.alerts.quietHours?.end ?? '07:00' },
                },
              })
            }
          />
          <input
            type="time"
            value={settings.alerts.quietHours?.end ?? '07:00'}
            onChange={(e) =>
              patch({
                alerts: {
                  quietHours: { start: settings.alerts.quietHours?.start ?? '22:00', end: e.target.value },
                },
              })
            }
          />
        </div>
      </section>

      <section className="card">
        <h2>Вигляд</h2>

        <div className="field">
          <span className="field__label">Тема</span>
          <select
            value={settings.appearance.theme}
            onChange={(e) => patch({ appearance: { theme: e.target.value as AppSettings['appearance']['theme'] } })}
          >
            <option value="system">Як у системі</option>
            <option value="dark">Темна</option>
            <option value="light">Світла</option>
          </select>
        </div>

        <Number
          label="Прозорість"
          suffix="%"
          min={30}
          max={100}
          step={5}
          value={Math.round(settings.appearance.opacity * 100)}
          onChange={(v) => patch({ appearance: { opacity: v / 100 } })}
        />

        <Toggle
          label="Показувати розклад"
          checked={settings.appearance.showSchedulePanel}
          onChange={(showSchedulePanel) => patch({ appearance: { showSchedulePanel } })}
        />

        <Toggle
          label="Показувати домашні завдання"
          checked={settings.appearance.showHomeworkPanel}
          onChange={(showHomeworkPanel) => patch({ appearance: { showHomeworkPanel } })}
        />

        <Toggle
          label="Пропускати кліки крізь віджет"
          hint="Віджет стає некликабельним, як шпалери. Керування — через значок у треї."
          checked={settings.appearance.clickThrough}
          onChange={(v) => void window.api.window.setClickThrough(v).then(reload)}
        />
      </section>

      <section className="card">
        <h2>Оновлення</h2>

        <Number
          label="Оновлювати кожні"
          suffix="хв"
          min={1}
          max={180}
          value={settings.sync.refreshIntervalMinutes}
          onChange={(refreshIntervalMinutes) => patch({ sync: { refreshIntervalMinutes } })}
        />

        <Toggle
          label="Оновлювати після пробудження комп'ютера"
          checked={settings.sync.syncOnResume}
          onChange={(syncOnResume) => patch({ sync: { syncOnResume } })}
        />

        <Toggle
          label="Запускати разом із системою"
          checked={settings.launchAtLogin}
          onChange={(launchAtLogin) => patch({ launchAtLogin })}
        />
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Number({
  label,
  hint,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  suffix?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {hint && <span className="field__hint">{hint}</span>}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const next = globalThis.Number(e.target.value);
          if (!globalThis.isNaN(next) && next >= min && next <= max) onChange(next);
        }}
      />
      {suffix && <span className="muted">{suffix}</span>}
    </label>
  );
}
