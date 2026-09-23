import type { Trend, ZoneStatus } from '@uptc/shared';
import type { ReactNode } from 'react';
import { cx, fmtDelta } from '../../lib/format';
import { STATUS_META, TREND_META } from '../../lib/visual';

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-line bg-panel', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status, size = 'sm' }: { status: ZoneStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs',
      )}
      style={{
        color: meta.ink,
        borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 14%, transparent)`,
      }}
    >
      <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.4} aria-hidden />
      {meta.label}
    </span>
  );
}

export function TrendIndicator({ trend, delta, compact = false }: { trend: Trend; delta?: number; compact?: boolean }) {
  const meta = TREND_META[trend];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={meta.label}>
      <Icon size={14} strokeWidth={2.2} aria-hidden className={trend === 'STABLE' ? 'text-ink-3' : 'text-ink'} />
      {!compact && <span>{meta.label}</span>}
      {delta !== undefined && <span className="tabular text-ink-2">({fmtDelta(delta)})</span>}
    </span>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-bg p-0.5">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cx(
            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            opt.value === value ? 'bg-panel-3 text-ink' : 'text-ink-2 hover:text-ink',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Meter({
  value,
  color,
  height = 6,
  label,
}: {
  value: number;
  color: string;
  height?: number;
  label?: string;
}) {
  return (
    <div
      className="w-full overflow-hidden rounded-full bg-panel-3"
      style={{ height }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}
      />
    </div>
  );
}

export function KeyValue({ label, value, mono = false }: { label: ReactNode; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-ink-2">{label}</dt>
      <dd className={cx('text-right text-ink tabular', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-3">{children}</p>;
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  active,
  title,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  disabled?: boolean;
  active?: boolean;
  title?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'border-car/60 bg-car/15 text-ink hover:bg-car/25',
        variant === 'danger' && 'border-crit/60 bg-crit/15 text-ink hover:bg-crit/25',
        variant === 'ghost' && 'border-transparent text-ink-2 hover:bg-panel-2 hover:text-ink',
        variant === 'default' && 'border-line-2 bg-panel-2 text-ink hover:border-ink-3',
        active && 'border-ink-2 bg-panel-3',
      )}
    >
      {children}
    </button>
  );
}
