import { FilterChip } from '@treklink/ui';

export const AppliedFilters = () => (
  <div className="flex flex-wrap items-center gap-2">
    <FilterChip label="Status: Rented" onRemove={() => undefined} />
    <FilterChip label="Station: Sa Pa" onRemove={() => undefined} />
    <FilterChip label="Battery under 20 %" onRemove={() => undefined} />
  </div>
);
