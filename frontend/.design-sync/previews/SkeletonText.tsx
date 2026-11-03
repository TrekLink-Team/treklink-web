import { SkeletonText } from '@treklink/ui';

export const Paragraph = () => (
  <div className="max-w-md rounded-card border border-line bg-surface p-4">
    <SkeletonText />
  </div>
);

export const Lines = () => (
  <div className="grid max-w-xl grid-cols-2 gap-4">
    <SkeletonText lines={2} />
    <SkeletonText lines={5} />
  </div>
);
