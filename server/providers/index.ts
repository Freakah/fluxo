import type { Config } from '../config.ts';
import type { BankProvider } from './types.ts';
import { createDemoProvider } from './demo.ts';
import { loadEnableBanking } from './enablebanking.ts';
import { todayIn } from '../../shared/dates.ts';

/** Demo mode only ever gets the simulated bank; live mode only ever gets real providers. */
export function loadProviders(config: Config): Record<string, BankProvider> {
  if (config.APP_MODE === 'demo') return { demo: createDemoProvider(() => todayIn('Europe/Lisbon')) };
  const eb = loadEnableBanking(config);
  return eb ? { enablebanking: eb } : {};
}
