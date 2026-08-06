import { DisplayMetric } from './tree';

export interface Filters {
  name: string;
  path: string;
  metric: DisplayMetric;
}

export const DEFAULT_FILTERS: Filters = {
  name: '',
  path: '',
  metric: 'loc',
};
