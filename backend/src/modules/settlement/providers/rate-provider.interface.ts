export interface RateProvider {
  name: string;
  /** Returns USD per 1 RIAL, or null if this provider cannot quote. */
  quote(): Promise<number | null>;
  healthy(): Promise<boolean>;
}
