'use client';

// Tabs that behave as tabs: one tab in the Tab order (the selected one), arrows and Home/End move between
// them, and each tab names the panel it shows (tabPanel gives the panel its matching id and label).
// For a filter that narrows a list, use a group of toggle buttons instead (aria-pressed), not tabs.

import { useRef, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

export function Tabs<T extends string>({ tabs, value, onChange, label, idBase, className = '' }: { tabs: readonly TabItem<T>[]; value: T; onChange: (id: T) => void; label: string; idBase: string; className?: string }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => {
    const i = (to + tabs.length) % tabs.length;
    onChange(tabs[i].id);
    buttons.current[i]?.focus();
  };
  return (
    <div className={`dock-tabs ${className}`.trim()} role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          id={`${idBase}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={`${idBase}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className="dock-tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
            if (next === undefined) return;
            e.preventDefault();
            move(next);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** The props of the panel a tab shows. */
export function tabPanel(idBase: string, id: string) {
  return { id: `${idBase}-panel-${id}`, role: 'tabpanel', 'aria-labelledby': `${idBase}-tab-${id}` } as const;
}
