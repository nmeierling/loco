import { Type } from '@angular/core';

export interface VizDescriptor {
  id: string;
  label: string;
  description: string;
  component: Type<unknown>;
  /**
   * Selects this viz on startup. Registration order drives the chip order, so this
   * lets the default be something other than the leftmost chip.
   */
  isDefault?: boolean;
}
