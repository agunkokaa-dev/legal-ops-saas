import type { Renewal } from '../page';

interface UpcomingRenewalsProps {
  renewals: Renewal[];
}

function urgencyColor(urgency: Renewal['urgency']) {
  if (urgency === 'critical') {
    return 'text-red-400';
  }
  if (urgency === 'warning') {
    return 'text-yellow-400';
  }
  return 'text-emerald-400';
}

function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function UpcomingRenewals({ renewals }: UpcomingRenewalsProps) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Upcoming Renewals</h3>
        <span className="text-xs text-text-muted">Next 90 days</span>
      </div>

      {renewals.length === 0 ? (
        <p className="py-4 text-center text-xs text-text-muted">No renewals due</p>
      ) : (
        <div className="space-y-4">
          {renewals.slice(0, 4).map((renewal) => (
            <div key={renewal.id} className="min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {renewal.counterparty || renewal.title}
                  </p>
                  <p className="truncate text-xs text-text-muted">{renewal.title}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-text-muted">{formatDate(renewal.end_date)}</p>
                  <p className={`text-xs font-medium ${urgencyColor(renewal.urgency)}`}>
                    in {renewal.days_left} days
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 border-t border-surface-border pt-3">
        <p className="text-xs text-text-muted">
          {renewals.length} renewal{renewals.length !== 1 ? 's' : ''} this quarter
        </p>
      </div>
    </div>
  );
}
