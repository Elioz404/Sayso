// A shop's rules per action: what an agent does on its own, what waits for the owner's OK, what is blocked.
// No hooks: the Rules page shows the rules in force with it, and the editor shows a draft before saving.

import type { ActionRules } from '@/core/guard/rules-by-action.ts';

export function RulesTable({ rows, label = 'Your rules, per action' }: { rows: ActionRules[]; label?: string }) {
  return (
    <div className="rules-table" role="table" aria-label={label}>
      <div className="rules-tr rules-th" role="row">
        <span role="columnheader">Action</span>
        <span role="columnheader">On its own</span>
        <span role="columnheader">Needs your OK</span>
        <span role="columnheader">Blocked</span>
      </div>
      {rows.map((r) => (
        <div className="rules-tr" role="row" key={r.kind}>
          <b role="rowheader">{r.label}</b>
          <span role="cell" data-label="On its own">
            {r.alone}
          </span>
          <span role="cell" data-label="Needs your OK">
            {r.ask.length ? r.ask.map((c) => <span key={c}>{c}</span>) : <span className="muted">Nothing</span>}
          </span>
          <span role="cell" data-label="Blocked">
            {r.block.length ? r.block.map((c) => <span key={c}>{c}</span>) : <span className="muted">Nothing</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
