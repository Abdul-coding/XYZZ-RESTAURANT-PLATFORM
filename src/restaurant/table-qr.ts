import { toBuffer } from 'qrcode';

const DEFAULT_CUSTOMER_APP_URL = 'https://xyzz.com';

export function customerTableUrl(appBaseUrl: string | undefined, qrToken: string) {
  const base = (appBaseUrl?.trim() || DEFAULT_CUSTOMER_APP_URL).replace(/\/+$/, '');
  return `${base}/t/${qrToken}`;
}

export function tableQrPng(url: string) {
  return toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 512,
  });
}
