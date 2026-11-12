import type { ReactNode } from 'react';

interface ProfileSectionCardProps {
  id: string;
  title: string;
  icon: ReactNode;
  /** Badge shown on the right of the header. */
  badge?: ReactNode;
  tone?: 'default' | 'danger';
  gap?: 'gap-4' | 'gap-5';
  children: ReactNode;
}

export function ProfileSectionCard({
  id,
  title,
  icon,
  badge,
  tone = 'default',
  gap = 'gap-5',
  children,
}: ProfileSectionCardProps) {
  const isDanger = tone === 'danger';
  return (
    <div
      id={id}
      className={`scroll-mt-24 sm:scroll-mt-28 bg-white rounded-2xl border shadow-xs p-6 flex flex-col ${gap} ${
        isDanger ? 'border-danger-border' : 'border-border'
      }`}
    >
      <div
        className={`flex items-center justify-between border-b pb-3.5 ${
          isDanger ? 'border-danger-light' : 'border-border-subtle'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs ${
              isDanger ? 'bg-danger-subtle text-danger' : 'bg-brand-subtle text-brand'
            }`}
          >
            {icon}
          </div>
          <h2 className={`text-sm font-bold ${isDanger ? 'text-danger' : 'text-ink'}`}>{title}</h2>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}
