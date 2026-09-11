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
    <div className="card stat-card p-4">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${accent}`}>{value}</p>
    </div>
  );
}

export function EmptyState({
  icon = "AN",
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
    <div className="paper-empty grid place-items-center p-10 text-center">
      <div className="grid size-14 place-items-center border border-slate-900 bg-[#d3942b] font-serif text-xl font-black text-slate-900" aria-hidden>
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-black">{title}</h3>
      {desc && <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
