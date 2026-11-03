import { useState } from 'react';
import { Pagination } from '@treklink/ui';

export const Paged = () => {
  const [page, setPage] = useState(4);
  return (
    <div className="max-w-3xl rounded-panel border border-line bg-surface">
      <Pagination pageNumber={page} totalPages={12} totalItems={287} pageSize={25} onPage={setPage} />
    </div>
  );
};

export const WithPageSize = () => {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  return (
    <div className="max-w-3xl rounded-panel border border-line bg-surface">
      <Pagination
        pageNumber={page}
        totalPages={Math.ceil(287 / size)}
        totalItems={287}
        pageSize={size}
        onPage={setPage}
        pageSizes={[10, 25, 50]}
        onPageSize={setSize}
      />
    </div>
  );
};
