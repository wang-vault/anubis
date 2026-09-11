export function StatCard({
  label,
  value,
  accent = "text-slate-900",
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}

export function EmptyState({
  icon = "🗂️",
  title,
  desc,
  action,
}: {
  icon?: string;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card grid place-items-center p-10 text-center">
      <div className="text-4xl" aria-hidden>{icon}</div>
      <h3 className="mt-3 text-base font-semibold">{title}</h3>
      {desc && <p className="mt-1 max-w-sm text-sm text-slate-500">{desc}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
