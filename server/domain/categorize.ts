import { AMBIGUOUS, DESCRIPTION_RULES, categoryFromMcc, matchKnownMerchant, type CategoryKey } from './merchants.ts';

export const DEFAULT_CATEGORIES: { key: CategoryKey; name: string; color: string }[] = [
  { key: 'groceries', name: 'Groceries', color: '#2e7d32' },
  { key: 'restaurants', name: 'Restaurants & cafés', color: '#ef6c00' },
  { key: 'transport', name: 'Transport', color: '#1565c0' },
  { key: 'fuel', name: 'Fuel', color: '#6d4c41' },
  { key: 'housing', name: 'Housing', color: '#5e35b1' },
  { key: 'utilities', name: 'Utilities', color: '#00838f' },
  { key: 'shopping', name: 'Shopping', color: '#c2185b' },
  { key: 'entertainment', name: 'Entertainment & gaming', color: '#7b1fa2' },
  { key: 'subscriptions', name: 'Subscriptions', color: '#ad1457' },
  { key: 'health', name: 'Health', color: '#d32f2f' },
  { key: 'education', name: 'Education', color: '#283593' },
  { key: 'travel', name: 'Travel', color: '#0277bd' },
  { key: 'bank_fees', name: 'Bank fees', color: '#546e7a' },
  { key: 'cash', name: 'Cash withdrawals', color: '#827717' },
  { key: 'income', name: 'Income', color: '#388e3c' },
  { key: 'other', name: 'Other', color: '#757575' },
  { key: 'uncategorized', name: 'Uncategorized', color: '#9e9e9e' },
];

/** Portuguese names for the default categories, used when the interface language changes. */
export const PT_CATEGORY_NAMES: Record<CategoryKey, string> = {
  groceries: 'Supermercado', restaurants: 'Restaurantes e cafés', transport: 'Transportes', fuel: 'Combustível', housing: 'Casa',
  utilities: 'Água, luz e gás', shopping: 'Compras', entertainment: 'Lazer e jogos', subscriptions: 'Subscrições', health: 'Saúde',
  education: 'Educação', travel: 'Viagens', bank_fees: 'Comissões bancárias', cash: 'Levantamentos', income: 'Rendimentos',
  other: 'Outros', uncategorized: 'Sem categoria',
};

export type TxType = 'expense' | 'income' | 'refund' | 'transfer';
export type Source = 'rule' | 'merchant' | 'mcc' | 'bank_code' | 'description' | 'none';
export type Confidence = 'high' | 'medium' | 'low' | 'none';

export type Rule = {
  id: number; priority: number; enabled: number; field: 'merchant' | 'description';
  match_type: 'equals' | 'contains' | 'starts_with'; pattern: string; direction: 'any' | 'out' | 'in';
  account_id: number | null; category_id: number;
};

export type TxInput = {
  amount_minor: number; description: string; counterparty: string | null; merchant: string;
  mcc: string | null; bank_code: string | null; account_id: number;
};

export type Classification = { categoryId: number | null; source: Source; confidence: Confidence; ruleId: number | null; type: TxType };

const REFUND_WORDS = /\b(devolu[cç][aã]o|estorno|reembolso|refund|reversal|anula[cç][aã]o|chargeback)\b/i;
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function ruleMatches(rule: Rule, tx: TxInput): boolean {
  if (!rule.enabled) return false;
  if (rule.account_id !== null && rule.account_id !== tx.account_id) return false;
  if (rule.direction === 'out' && tx.amount_minor >= 0) return false;
  if (rule.direction === 'in' && tx.amount_minor <= 0) return false;
  const hay = fold(rule.field === 'merchant' ? tx.merchant : `${tx.description} ${tx.counterparty ?? ''}`);
  const needle = fold(rule.pattern);
  if (!needle) return false;
  if (rule.match_type === 'equals') return hay === needle;
  if (rule.match_type === 'starts_with') return hay.startsWith(needle);
  return hay.includes(needle);
}

/** Rules are tried by ascending priority, then oldest first. */
export const sortRules = (rules: Rule[]) => [...rules].sort((a, b) => a.priority - b.priority || a.id - b.id);

/**
 * Automatic classification. Precedence (user overrides are applied on top at read time):
 * user rules -> known merchant / MCC / bank code -> description keywords -> uncategorized.
 */
export function classify(tx: TxInput, sortedRules: Rule[], cat: (k: CategoryKey) => number): Classification {
  const text = `${tx.description} ${tx.counterparty ?? ''}`;
  const known = matchKnownMerchant(text);
  const incoming = tx.amount_minor > 0;
  const type: TxType = !incoming ? 'expense' : REFUND_WORDS.test(text) || (known && known.category !== 'income') ? 'refund' : 'income';

  const rule = sortedRules.find((r) => ruleMatches(r, tx));
  if (rule) return { categoryId: rule.category_id, source: 'rule', confidence: 'high', ruleId: rule.id, type };

  const ambiguous = AMBIGUOUS.test(text);
  if (known) return { categoryId: cat(known.category), source: 'merchant', confidence: ambiguous ? 'medium' : 'high', ruleId: null, type };

  const mcc = categoryFromMcc(tx.mcc);
  if (mcc) return { categoryId: cat(mcc), source: 'mcc', confidence: 'medium', ruleId: null, type };

  if (tx.bank_code && /CWDL/.test(tx.bank_code) && !incoming) return { categoryId: cat('cash'), source: 'bank_code', confidence: 'high', ruleId: null, type };

  for (const d of DESCRIPTION_RULES) {
    if (ambiguous && d.category !== 'bank_fees') continue; // a fee charged on an MB WAY transfer is still a fee
    if (d.direction === 'in' && !incoming) continue;
    if (d.direction === 'out' && incoming && type !== 'refund') continue;
    if (d.re.test(text)) return { categoryId: cat(d.category), source: 'description', confidence: d.category === 'income' ? 'medium' : 'low', ruleId: null, type };
  }
  if (type === 'income') return { categoryId: cat('income'), source: 'none', confidence: 'low', ruleId: null, type };
  return { categoryId: cat('uncategorized'), source: 'none', confidence: 'none', ruleId: null, type };
}
