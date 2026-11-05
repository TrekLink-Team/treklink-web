import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/apiClient';
import type { Page } from '../../shared/api/query';
import type { DeviceStatus } from '../../shared/ui/status';

// devices api-design 25: the result of one count (REQ-EVT-30, devices design section 11).
export interface StockTakeRun {
  id: string;
  createdAt: string;
  scannedCount: number;
  inStockConfirmed: number;
  rentedSeen: number;
  unconfirmed: { id: string; assetTag: string; status: DeviceStatus; lastSeenAt: string | null }[];
  unknownTags: string[];
}

// devices api-design 26.
export interface StockTakeSummary {
  id: string;
  takenBy: string | null;
  createdAt: string;
  scannedCount: number;
  unconfirmedCount: number;
  unknownCount: number;
}

export const STOCK_TAKE_PAGE_SIZE = 10;

// Screen 4.5: `['stock-takes', page]`, invalidated after a submit.
export const stockTakeKeys = {
  all: ['stock-takes'] as const,
  page: (pageNumber: number) => ['stock-takes', pageNumber] as const,
};

export const useStockTakes = (pageNumber: number) =>
  useQuery({
    queryKey: stockTakeKeys.page(pageNumber),
    queryFn: () =>
      apiClient<Page<StockTakeSummary>>(
        `/stock-takes?pageNumber=${pageNumber}&pageSize=${STOCK_TAKE_PAGE_SIZE}`,
      ),
  });

export const runStockTake = (scannedTags: string[]) =>
  apiClient<StockTakeRun>('/stock-takes', { method: 'POST', body: JSON.stringify({ scannedTags }) });
