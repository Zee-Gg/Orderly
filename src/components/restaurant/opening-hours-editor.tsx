"use client";

import { useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  WEEKDAY_LABELS,
  WEEKDAYS,
  type DayHours,
  type OpeningHours,
  type Weekday,
} from "@/lib/opening-hours";
import { cn } from "@/lib/utils";

type Props = {
  value: OpeningHours;
  onChange: (value: OpeningHours) => void;
  /** Error messages keyed like "mon.close". */
  errors?: Record<string, string>;
  disabled?: boolean;
};

const DEFAULT_TIMES = { open: "12:00", close: "00:00" };

type OpenDay = Extract<DayHours, { closed: false }>;

function allSame(value: OpeningHours) {
  const open = WEEKDAYS.map((d) => value[d]).filter((d): d is OpenDay => !d.closed);
  return open.every((d) => d.open === open[0].open && d.close === open[0].close);
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted">
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-touch w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink focus:border-brand-700 focus:ring-2 focus:ring-brand-700/20 focus:outline-none"
      />
    </div>
  );
}

function overnightNote(day: DayHours) {
  return !day.closed && day.close < day.open ? (
    <p className="text-xs text-muted">Closes after midnight (next day)</p>
  ) : null;
}

/**
 * Weekly opening hours. "Same hours every day" shows one pair of times plus
 * day chips to mark closed days; otherwise one row per day.
 */
export function OpeningHoursEditor({ value, onChange, errors, disabled }: Props) {
  const [same, setSame] = useState(() => allSame(value));

  const firstOpen = WEEKDAYS.map((d) => value[d]).find((d): d is OpenDay => !d.closed);
  const shared: OpenDay = firstOpen ?? { closed: false, ...DEFAULT_TIMES };

  function setDay(day: Weekday, next: DayHours) {
    onChange({ ...value, [day]: next });
  }

  function setSharedTimes(times: { open: string; close: string }) {
    onChange(
      Object.fromEntries(
        WEEKDAYS.map((d) => [d, value[d].closed ? value[d] : { closed: false, ...times }]),
      ) as OpeningHours,
    );
  }

  function toggleSame(on: boolean) {
    setSame(on);
    if (on) setSharedTimes({ open: shared.open, close: shared.close });
  }

  function toggleClosed(day: Weekday) {
    const d = value[day];
    setDay(
      day,
      d.closed
        ? { closed: false, open: same ? shared.open : DEFAULT_TIMES.open, close: same ? shared.close : DEFAULT_TIMES.close }
        : { closed: true },
    );
  }

  const firstError = errors ? Object.values(errors)[0] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Switch
        checked={same}
        onCheckedChange={toggleSame}
        label="Same hours every day"
        disabled={disabled}
      />

      {same ? (
        <>
          <div className="flex gap-3">
            <TimeField
              label="Opens"
              value={shared.open}
              disabled={disabled}
              onChange={(open) => setSharedTimes({ open, close: shared.close })}
            />
            <TimeField
              label="Closes"
              value={shared.close}
              disabled={disabled}
              onChange={(close) => setSharedTimes({ open: shared.open, close })}
            />
          </div>
          {overnightNote(shared)}
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Open on</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => {
                const open = !value[d].closed;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={open}
                    disabled={disabled}
                    onClick={() => toggleClosed(d)}
                    className={cn(
                      "min-h-touch min-w-14 rounded-full border px-3 text-sm font-semibold transition-colors",
                      open
                        ? "border-brand-700 bg-brand-50 text-brand-800"
                        : "border-line-strong bg-surface text-muted line-through",
                    )}
                  >
                    {WEEKDAY_LABELS[d].slice(0, 3)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted">Tap a day to mark it closed.</p>
          </div>
        </>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
          {WEEKDAYS.map((d) => {
            const day = value[d];
            return (
              <li key={d} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">{WEEKDAY_LABELS[d]}</span>
                  <Switch
                    checked={!day.closed}
                    onCheckedChange={() => toggleClosed(d)}
                    label={day.closed ? "Closed" : "Open"}
                    disabled={disabled}
                  />
                </div>
                {!day.closed ? (
                  <>
                    <div className="flex gap-3">
                      <TimeField
                        label="Opens"
                        value={day.open}
                        disabled={disabled}
                        onChange={(open) => setDay(d, { ...day, open })}
                      />
                      <TimeField
                        label="Closes"
                        value={day.close}
                        disabled={disabled}
                        onChange={(close) => setDay(d, { ...day, close })}
                      />
                    </div>
                    {overnightNote(day)}
                    {errors?.[`${d}.close`] ? (
                      <p className="text-sm text-danger">{errors[`${d}.close`]}</p>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {same && firstError ? <p className="text-sm text-danger">{firstError}</p> : null}
    </div>
  );
}
