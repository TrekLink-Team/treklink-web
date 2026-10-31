import React, { useEffect, useId, useState } from 'react';
import { useAccounts } from '../../entities/account/api';
import { Input } from '../../shared/ui';

const DEBOUNCE_MS = 250;
const RESULTS = 8;

// A typeahead over the TrekLink accounts (auth api-design 09, `q` matches name or email). It resolves to
// an account id; typing again clears the choice, so the id never outlives the text that named it.
export const AccountPicker: React.FC<{
  id: string;
  /** The chosen account id, or empty. */
  value: string;
  /** The text to show for `value` when the picker mounts with one already chosen. */
  initialLabel?: string;
  onChange: (accountId: string) => void;
  invalid?: boolean;
  'aria-describedby'?: string;
}> = ({ id, value, initialLabel, onChange, invalid, 'aria-describedby': describedBy }) => {
  const listId = useId();
  const [text, setText] = useState(initialLabel ?? (value ? value : ''));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const searching = open && query.length >= 2 && !value;
  const found = useAccounts({ q: query }, 1, { enabled: searching, pageSize: RESULTS });
  const items = searching ? (found.data?.items ?? []) : [];

  const pick = (accountId: string, label: string) => {
    setText(label);
    setOpen(false);
    onChange(accountId);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={searching && items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={describedBy}
        invalid={invalid}
        autoComplete="off"
        value={text}
        placeholder="Name or email"
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Matching accounts"
        hidden={!(searching && items.length > 0)}
        className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-control border border-line bg-surface shadow-lg"
      >
        {items.map((account) => (
          <li key={account.id} role="option" aria-selected={account.id === value}>
            <button
              type="button"
              className="flex w-full flex-col px-3 py-2 text-left hover:bg-sunken focus-visible:bg-sunken"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(account.id, account.fullName)}
            >
              <span className="text-body">{account.fullName}</span>
              <span className="text-body-sm text-ink-muted">{account.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
