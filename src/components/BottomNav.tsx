import React from 'react';

export interface NavItem<T extends string> {
  id: T;
  label: string;
  /** Shorter label for the bar when `label` is too long for five columns. */
  shortLabel?: string;
  icon: React.ReactNode;
}

/**
 * Primary navigation on phones and tablets: a fixed bottom tab bar, within
 * thumb reach, with every section visible at once (no hidden scrolling tabs).
 */
export function BottomNav<T extends string>({ items, active, onSelect }: {
  items: NavItem<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <nav
      aria-label="Sections"
      className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-[#09090b]/95 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid h-14" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map(item => {
          const isActive = item.id === active;
          return (
            <li key={item.id}>
              <button
                onClick={() => onSelect(item.id)}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
                  isActive ? 'text-accent' : 'text-slate-500 active:text-slate-300'
                }`}
              >
                <span className={`flex items-center justify-center w-12 h-7 rounded-full transition-colors ${isActive ? 'bg-accent/15' : ''}`}>
                  {item.icon}
                </span>
                <span className="truncate max-w-full px-1">{item.shortLabel ?? item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
