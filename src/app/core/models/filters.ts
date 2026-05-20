import { MetricKind } from './tree';

export interface Filters {
  name: string;
  path: string;
  metric: MetricKind;
}

export const DEFAULT_FILTERS: Filters = {
  name: '',
  path: '',
  metric: 'loc',
};
