// Merchant normalization and built-in merchant mappings (Portugal-focused).
// Mappings are deliberately specific: word-boundary patterns on known brand names only.
// Payment processors / wallets (PayPal, MB WAY, SumUp, Stripe...) are never mapped to a category
// on their own because the underlying merchant is unknown.

export type CategoryKey =
  | 'groceries' | 'restaurants' | 'transport' | 'fuel' | 'housing' | 'utilities' | 'shopping'
  | 'entertainment' | 'subscriptions' | 'health' | 'education' | 'travel' | 'bank_fees' | 'cash'
  | 'income' | 'other' | 'uncategorized';

// Bank description noise common in Portuguese statements.
const PREFIXES = [
  /^(compra|compras|pag(amento)?|pagto|trf|transf|transferencia|dd|debito direto|deb\.? ?direto|lev(antamento)?|cmp|cpr|pos|mb|tpa)\b[ .:/-]*/i,
  /^\d{4}\s+/, // card last-4 prefix e.g. "COMPRA 4521 ..."
  /^(p\/|para|de)\s+/i,
];
const SUFFIX_NOISE = /\b(lda|sa|s\.a\.|unipessoal|lisboa|porto|pt|prt|portugal|eur)\b\.?/gi;

/** "COMPRA 4521 CONTINENTE MODELO LISBOA" -> "Continente Modelo". Display-oriented, never stored over the raw description. */
export function normalizeMerchant(description: string, counterparty?: string | null): string {
  const base = (counterparty && counterparty.trim()) || description;
  const mb = /^mb ?way\s+(p\/|para|de)\s*(.+)$/i.exec(base.trim());
  if (mb) return `MB WAY ${/^de$/i.test(mb[1]) ? 'from' : 'to'} ${mb[2].trim()}`;
  const ent = /^pag(?:amento)?\.? serv(?:i[cç]os)?\.?\s+ent(?:idade)?\.?\s*(\d{5})/i.exec(base.trim());
  if (ent) return `Payment to entity ${ent[1]}`; // Multibanco service payment: the entity number identifies the payee
  let s = base.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) for (const p of PREFIXES) s = s.replace(p, '');
  s = s.replace(/\*+/g, ' ').replace(/\b\d{5,}\b/g, '').replace(SUFFIX_NOISE, '').replace(/[ ,.-]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) s = base.trim();
  const known = matchKnownMerchant(base);
  if (known) return known.name;
  return s.toLowerCase().replace(/(^|[\s/&(-])\p{L}/gu, (c) => c.toUpperCase()).slice(0, 60);
}

/** Stable grouping key for a merchant (used by recurring detection). */
export const merchantKey = (merchant: string) => merchant.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

type Known = { name: string; re: RegExp; category: CategoryKey };
const K = (name: string, pattern: string, category: CategoryKey): Known => ({ name, re: new RegExp(`\\b(?:${pattern})\\b`, 'i'), category });

export const KNOWN_MERCHANTS: Known[] = [
  K('Continente', 'continente', 'groceries'),
  K('Pingo Doce', 'pingo doce', 'groceries'),
  K('Lidl', 'lidl', 'groceries'),
  K('Mercadona', 'mercadona', 'groceries'),
  K('Minipreço', 'minipre[cç]o', 'groceries'),
  K('Auchan', 'auchan', 'groceries'),
  K('Intermarché', 'intermarch[eé]', 'groceries'),
  K('Aldi', 'aldi', 'groceries'),
  K('Galp', 'galp', 'fuel'),
  K('Repsol', 'repsol', 'fuel'),
  K('BP', 'bp', 'fuel'),
  K('Prio', 'prio', 'fuel'),
  K('Cepsa', 'cepsa|moeve', 'fuel'),
  K('Navegante', 'navegante', 'transport'),
  K('Metro de Lisboa', 'metro(politano)? (de )?lisboa', 'transport'),
  K('CP Comboios', 'cp comboios|comboios de portugal', 'transport'),
  K('Carris', 'carris', 'transport'),
  K('Uber', 'uber(?! ?eats)', 'transport'),
  K('Bolt', 'bolt(?! ?food)', 'transport'),
  K('Via Verde', 'via verde', 'transport'),
  K('Uber Eats', 'uber ?eats', 'restaurants'),
  K('Glovo', 'glovo', 'restaurants'),
  K('Bolt Food', 'bolt ?food', 'restaurants'),
  K("McDonald's", 'mc ?donald\'?s', 'restaurants'),
  K('Telepizza', 'telepizza', 'restaurants'),
  K('Starbucks', 'starbucks', 'restaurants'),
  K('Padaria Portuguesa', 'padaria portuguesa', 'restaurants'),
  K('EDP', 'edp( comercial)?', 'utilities'),
  K('EPAL', 'epal', 'utilities'),
  K('Endesa', 'endesa', 'utilities'),
  K('Goldenergy', 'goldenergy', 'utilities'),
  K('MEO', 'meo', 'utilities'),
  K('NOS', 'nos comunicacoes|nos sgps', 'utilities'),
  K('Vodafone', 'vodafone', 'utilities'),
  K('Digi', 'digi portugal', 'utilities'),
  K('Netflix', 'netflix', 'subscriptions'),
  K('Spotify', 'spotify', 'subscriptions'),
  K('Disney+', 'disney ?plus|disney\\+', 'subscriptions'),
  K('HBO Max', 'hbo ?max|max\\.com', 'subscriptions'),
  K('Amazon Prime', 'amazon prime|prime video', 'subscriptions'),
  K('Apple', 'apple\\.com/bill|itunes', 'subscriptions'),
  K('Google Play', 'google ?play', 'subscriptions'),
  K('Steam', 'steam(games|powered)?', 'entertainment'),
  K('PlayStation Plus', 'playstation plus|ps plus', 'subscriptions'),
  K('PlayStation', 'playstation|sony interactive|psn', 'entertainment'),
  K('Nintendo eShop', 'nintendo', 'entertainment'),
  K('Xbox', 'xbox|microsoft\\*xbox', 'entertainment'),
  K('Epic Games', 'epic games', 'entertainment'),
  K('Cinemas NOS', 'cinemas nos', 'entertainment'),
  K('Worten', 'worten', 'shopping'),
  K('FNAC', 'fnac', 'shopping'),
  K('IKEA', 'ikea', 'shopping'),
  K('Zara', 'zara', 'shopping'),
  K('Primark', 'primark', 'shopping'),
  K('Decathlon', 'decathlon', 'shopping'),
  K('Amazon', 'amazon(\\.es|\\.com|\\.de)?(?! ?prime)|amzn', 'shopping'),
  K('Farmácia', 'farm[aá]cia', 'health'),
  K('Wells', 'wells', 'health'),
  K('Fitness Hut', 'fitness hut', 'health'),
  K('CUF', 'cuf', 'health'),
  K('Fidelidade', 'fidelidade', 'other'),
  K('Ryanair', 'ryanair', 'travel'),
  K('TAP Air Portugal', 'tap air|tap portugal|flytap', 'travel'),
  K('easyJet', 'easyjet', 'travel'),
  K('Booking.com', 'booking\\.com', 'travel'),
  K('Airbnb', 'airbnb', 'travel'),
  K('Udemy', 'udemy', 'education'),
  K('Coursera', 'coursera', 'education'),
  K('Bertrand', 'bertrand', 'education'),
];

export function matchKnownMerchant(text: string): Known | undefined {
  return KNOWN_MERCHANTS.find((k) => k.re.test(text));
}

// Processors/wallets: the description alone does not identify what was bought.
export const AMBIGUOUS = /\b(paypal|mb ?way|sumup|stripe|revolut|adyen|klarna|wise|zettle)\b/i;

// Conservative description keywords (Portuguese bank wording). Lower confidence than merchant mappings.
export const DESCRIPTION_RULES: { re: RegExp; category: CategoryKey; direction?: 'in' | 'out' }[] = [
  { re: /\b(comiss[aã]o|comissoes|manuten[cç][aã]o de conta|imposto (do )?selo|despesas de manuten)\b/i, category: 'bank_fees', direction: 'out' },
  { re: /\b(lev(antamento)?\.? (atm|multibanco)|levantamento|atm withdrawal)\b/i, category: 'cash', direction: 'out' },
  { re: /\b(renda|condom[ií]nio|presta[cç][aã]o habita[cç][aã]o)\b/i, category: 'housing', direction: 'out' },
  { re: /\b(sal[aá]rio|vencimento|ordenado|payroll)\b/i, category: 'income', direction: 'in' },
  { re: /\b(restaurante|pastelaria|caf[eé]|snack[- ]bar|cervejaria|tasca|marisqueira)\b/i, category: 'restaurants', direction: 'out' },
  { re: /\b(supermercado|mercearia|talho|frutaria)\b/i, category: 'groceries', direction: 'out' },
  { re: /\b(parque|estacionamento|portagem|parking)\b/i, category: 'transport', direction: 'out' },
  { re: /\b(hotel|hostel|alojamento)\b/i, category: 'travel', direction: 'out' },
  { re: /\b(propinas|escola|universidade|faculdade)\b/i, category: 'education', direction: 'out' },
  { re: /\b(cl[ií]nica|hospital|dentista|consulta)\b/i, category: 'health', direction: 'out' },
];

// ISO 18245 merchant category codes (coarse, well-known ranges only).
export function categoryFromMcc(mcc?: string | null): CategoryKey | undefined {
  if (!mcc || !/^\d{4}$/.test(mcc)) return;
  const n = +mcc;
  if (n === 5411 || n === 5422 || n === 5441 || n === 5451 || n === 5499) return 'groceries';
  if (n === 5812 || n === 5813 || n === 5814) return 'restaurants';
  if (n === 5541 || n === 5542 || n === 5983) return 'fuel';
  if (n === 4111 || n === 4121 || n === 4131 || n === 4784 || n === 7523) return 'transport';
  if ((n >= 3000 && n <= 3350) || n === 4511 || n === 4411 || (n >= 3501 && n <= 3999) || n === 7011 || n === 4722) return 'travel';
  if (n === 4900) return 'utilities';
  if (n === 5912 || n === 8011 || n === 8021 || n === 8062 || n === 8099) return 'health';
  if (n === 6011) return 'cash';
  if (n === 8211 || n === 8220 || n === 8299 || n === 5942) return 'education';
  if (n === 5815 || n === 5816 || n === 5817 || n === 5818) return 'entertainment';
}
