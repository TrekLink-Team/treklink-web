import { Skeleton } from '@treklink/ui';

export const Shapes = () => (
  <div className="flex max-w-md flex-col gap-3">
    <div className="flex items-center gap-3">
      <Skeleton rounded="full" className="h-10 w-10" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
    <Skeleton rounded="panel" className="h-32 w-full" />
  </div>
);

export const TableRows = () => (
  <div role="status" aria-label="Loading devices" className="flex max-w-xl flex-col gap-2">
    {[0, 1, 2, 3].map((row) => (
      <Skeleton key={row} className="h-10 w-full" />
    ))}
  </div>
);
