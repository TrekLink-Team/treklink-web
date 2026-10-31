import React, { useEffect, useId, useState } from 'react';
import { useAccounts } from '../../entities/account/api';
import { Input } from '../../shared/ui';

const DEBOUNCE_MS = 250;
const RESULTS = 8;

// A typeahead over the TrekLink accounts (auth api-design 09, `q` matches name or email). It resolves to
// an account id; typing again clears the choice, so the id never outlives the text that named it.
// Up and Down move through the matches, Enter picks the highlighted one and Escape closes the list.
export const AccountPicker: React.FC<{
  id: string;
  /** The chosen account id, or empty. */
  value: string;
  /**
   * What to call `value` when it was set from outside, a link for example. The picker looks the id up in
   * the TrekLink accounts when this is absent, and shows the id itself only when neither knows it.
   */
  label?: string;
  onChange: (accountId: string) => void;
  invalid?: boolean;
  'aria-describedby'?: string;
}> = ({ id, value, label, onChange, invalid, 'aria-describedby': describedBy }) => {
  const listId = useId();
  // Null until the user types or picks: the box then shows the name of `value`.
  const [typed, setTyped] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const known = useAccounts({}, 1, {
    enabled: Boolean(value) && typed === null && !label,
    pageSize: 100,
  });
  const named = label ?? known.data?.items.find((account) => account.id === value)?.fullName;
  const text = typed ?? (value ? (named ?? value) : '');

  useEffect(() => {
    if (typed === null) return;
    const timer = setTimeout(() => setQuery(typed.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const searching = open && query.length >= 2 && !value;
  const found = useAccounts({ q: query }, 1, { enabled: searching, pageSize: RESULTS });
  const items = searching ? (found.data?.items ?? []) : [];
  const expanded = searching && items.length > 0;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const pick = (index: number) => {
    const account = items[index];
    if (!account) return;
    setTyped(account.fullName);
    setOpen(false);
    setActive(-1);
    onChange(account.id);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((now) => (now + 1) % items.length);
    } else if (event.key === 'ArrowUp' && items.length > 0) {
      event.preventDefault();
      setActive((now) => (now <= 0 ? items.length - 1 : now - 1));
    } else if (event.key === 'Enter' && expanded && active >= 0) {
      // Picks the highlighted match instead of submitting the filter form.
      event.preventDefault();
      pick(active);
    }
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-describedby={describedBy}
        invalid={invalid}
        autoComplete="off"
        value={text}
        placeholder="Name or email"
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
          setActive(-1);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching accounts"
        hidden={!expanded}
        className="absolute z-raised mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface shadow-overlay"
      >
        {items.map((account, index) => (
          <li
            key={account.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            className={`flex cursor-pointer flex-col px-3 py-2 hover:bg-sunken ${index === active ? 'bg-sunken' : ''}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => pick(index)}
          >
            <span className="text-body">{account.fullName}</span>
            <span className="text-body-sm text-ink-muted">{account.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
