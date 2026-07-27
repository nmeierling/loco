export const API_BASE_URL = 'https://example.test';
export const PAGE_SIZE = 20;
export const FEATURE_CHECKOUT = true;

export interface AppConfig {
  apiBaseUrl: string;
  pageSize: number;
  checkoutEnabled: boolean;
}

export function defaultConfig(): AppConfig {
  return {
    apiBaseUrl: API_BASE_URL,
    pageSize: PAGE_SIZE,
    checkoutEnabled: FEATURE_CHECKOUT,
  };
}
