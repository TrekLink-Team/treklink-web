import React from 'react';
import { capabilityText, type VariantMedia } from './spec';
import { VariantImage } from './VariantImage';

// The parts of a device's card (CollectionView, W30, the "Contract Home" design canvas): the
// image tile with the variant's icon render from `public/variants/`, and the subtitle under the asset tag
// with the variant name and its capabilities.

export const VariantTile: React.FC<{ variant: Pick<VariantMedia, 'name' | 'imageUrl'> }> = ({ variant }) => (
  <VariantImage variant={variant} render="icon" size="md" className="h-full w-full" />
);

export const VariantSubtitle: React.FC<{ variant: VariantMedia }> = ({ variant }) => {
  const capabilities = capabilityText(variant);
  return (
    <>
      <span className="block font-semibold text-ink">{variant.name}</span>
      {capabilities && capabilities !== 'None' && <span className="block">{capabilities}</span>}
    </>
  );
};
