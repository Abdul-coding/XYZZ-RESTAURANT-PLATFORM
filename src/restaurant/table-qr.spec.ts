import { customerTableUrl, tableQrPng } from './table-qr';

describe('table QR', () => {
  it('builds the customer scan URL from the app base and token', () => {
    expect(customerTableUrl('https://order.xyzz.com/', 'TBL_abc')).toBe(
      'https://order.xyzz.com/t/TBL_abc',
    );
  });

  it('falls back to the public customer host when no base URL is configured', () => {
    expect(customerTableUrl(undefined, 'TBL_abc')).toBe('https://xyzz.com/t/TBL_abc');
    expect(customerTableUrl('   ', 'TBL_abc')).toBe('https://xyzz.com/t/TBL_abc');
  });

  it('renders a PNG of the scan URL', async () => {
    const png = await tableQrPng('https://xyzz.com/t/TBL_abc');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
