import { Type } from '@angular/core';

export interface VizDescriptor {
  id: string;
  label: string;
  description: string;
  component: Type<unknown>;
}
