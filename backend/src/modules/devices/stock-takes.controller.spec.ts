import { StockTakeService } from './stock-take.service';
import { StockTakesController } from './stock-takes.controller';

describe('StockTakesController (devices api-design 25 and 26)', () => {
  it('runs a stock-take as the caller and lists past runs', async () => {
    const service = {
      run: jest.fn().mockResolvedValue({ id: 'st-1' }),
      list: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new StockTakesController(service as unknown as StockTakeService);
    const caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

    await expect(controller.run({ scannedTags: ['TL-0001'] }, caller)).resolves.toEqual({
      id: 'st-1',
    });
    expect(service.run).toHaveBeenCalledWith({ scannedTags: ['TL-0001'] }, caller);
    await controller.list({ pageNumber: 2 });
    expect(service.list).toHaveBeenCalledWith({ pageNumber: 2 });
  });
});
