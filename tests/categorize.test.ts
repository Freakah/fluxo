import { describe, it, expect } from 'vitest';
import { classify, sortRules, type Rule, type TxInput } from '../server/domain/categorize.ts';
import { normalizeMerchant, type CategoryKey } from '../server/domain/merchants.ts';

const ids: Record<string, number> = {};
const cat = (k: CategoryKey) => (ids[k] ??= Object.keys(ids).length + 1);
const t = (description: string, amount = -1000, extra: Partial<TxInput> = {}): TxInput => ({ amount_minor: amount, description, counterparty: null, merchant: normalizeMerchant(description), mcc: null, bank_code: null, account_id: 1, ...extra });
const rule = (p: Partial<Rule>): Rule => ({ id: 1, priority: 100, enabled: 1, field: 'description', match_type: 'contains', pattern: 'x', direction: 'any', account_id: null, category_id: 999, ...p });

describe('categorization precedence', () => {
  it('user rules beat known merchants', () => {
    const r = classify(t('COMPRA 4521 CONTINENTE'), [rule({ pattern: 'continente', category_id: 777 })], cat);
    expect(r).toMatchObject({ categoryId: 777, source: 'rule', confidence: 'high', ruleId: 1 });
  });
  it('lower priority number wins; disabled rules are ignored', () => {
    const rules = sortRules([rule({ id: 1, priority: 50, pattern: 'lidl', category_id: 1 }), rule({ id: 2, priority: 10, pattern: 'lidl', category_id: 2 }), rule({ id: 3, priority: 1, pattern: 'lidl', category_id: 3, enabled: 0 })]);
    expect(classify(t('LIDL LISBOA'), rules, cat).categoryId).toBe(2);
  });
  it('rules respect direction, account and accent/case folding', () => {
    expect(classify(t('Farmácia Estação', 500), [rule({ pattern: 'FARMACIA', direction: 'out', category_id: 5 })], cat).source).not.toBe('rule');
    expect(classify(t('Farmácia Estação'), [rule({ pattern: 'FARMACIA', direction: 'out', category_id: 5 })], cat).categoryId).toBe(5);
    expect(classify(t('Farmácia Estação'), [rule({ pattern: 'FARMACIA', account_id: 2, category_id: 5 })], cat).source).not.toBe('rule');
  });
  it('known merchants, then MCC, then bank code, then description keywords, then uncategorized', () => {
    expect(classify(t('DD EDP COMERCIAL'), [], cat)).toMatchObject({ categoryId: cat('utilities'), source: 'merchant', confidence: 'high' });
    expect(classify(t('LOJA XPTO', -1000, { mcc: '5411' }), [], cat)).toMatchObject({ categoryId: cat('groceries'), source: 'mcc', confidence: 'medium' });
    expect(classify(t('XPTO', -2000, { bank_code: 'PMNT-CCRD-CWDL' }), [], cat)).toMatchObject({ categoryId: cat('cash'), source: 'bank_code' });
    expect(classify(t('PASTELARIA DO BAIRRO'), [], cat)).toMatchObject({ categoryId: cat('restaurants'), source: 'description', confidence: 'low' });
    expect(classify(t('PAG SERV ENT 21025 REF 482913571'), [], cat)).toMatchObject({ categoryId: cat('uncategorized'), source: 'none', confidence: 'none' });
  });
  it('treats payment processors cautiously', () => {
    expect(classify(t('PAYPAL *NETFLIX'), [], cat)).toMatchObject({ categoryId: cat('subscriptions'), confidence: 'medium' });
    expect(classify(t('MBWAY P/ 912***523'), [], cat).categoryId).toBe(cat('uncategorized'));
    expect(classify(t('SUMUP *RESTAURANTE O ZE'), [], cat).categoryId).toBe(cat('uncategorized'));
  });
  it('avoids overly broad matching (word boundaries)', () => {
    expect(classify(t('PRIORIDADE LDA'), [], cat).categoryId).toBe(cat('uncategorized'));
    expect(classify(t('UBER EATS PT'), [], cat).categoryId).toBe(cat('restaurants'));
    expect(classify(t('UBER BV TRIP'), [], cat).categoryId).toBe(cat('transport'));
  });
  it('types: expense, income, refund — never transfer from wording alone', () => {
    expect(classify(t('TRF SALARIO EMPRESA', 200000), [], cat)).toMatchObject({ type: 'income', categoryId: cat('income') });
    expect(classify(t('DEVOLUCAO ZARA CHIADO', 4999), [], cat)).toMatchObject({ type: 'refund', categoryId: cat('shopping') });
    expect(classify(t('ESTORNO COMPRA', 1000), [], cat).type).toBe('refund');
    expect(classify(t('TRANSFERENCIA P/ JOAO', -5000), [], cat).type).toBe('expense');
    expect(classify(t('TRANSFERENCIA DE JOAO', 5000), [], cat).type).toBe('income');
  });
  it('normalizes merchant names for display without losing the raw description', () => {
    expect(normalizeMerchant('COMPRA 4521 CONTINENTE BOM DIA')).toBe('Continente');
    expect(normalizeMerchant('MBWAY P/ 912***523')).toBe('MB WAY to 912***523');
    expect(normalizeMerchant('COMPRA 4521 LOJA DO BAIRRO UNIP')).toBe('Loja Do Bairro Unip');
  });
  it('handles Millennium bcp statement wording', () => {
    expect(normalizeMerchant('TRF MB WAY P  ANA SILVA')).toBe('MB WAY to ANA SILVA');
    expect(normalizeMerchant('TRF MB WAY DE  ANA SILVA')).toBe('MB WAY from ANA SILVA');
    expect(normalizeMerchant('MB WAY PEDRO')).not.toMatch(/^MB WAY to/);
    expect(normalizeMerchant('TRF. P O JOAO SOUSA')).toBe('Transfer from JOAO SOUSA');
    expect(classify(t('COMPRA 1234 UBER EATS HELP.UBER.COMNH'), [], cat).categoryId).toBe(cat('restaurants'));
    expect(classify(t('COMPRA 1234 MCDONAL D VILA DO COPORTO'), [], cat).categoryId).toBe(cat('restaurants'));
    expect(classify(t('COMPRA 1234 APPLE.COM BILL CORK IR'), [], cat).categoryId).toBe(cat('subscriptions'));
    expect(classify(t('PAG BXVAL- 1234 VIAVERDE'), [], cat).categoryId).toBe(cat('transport'));
    expect(classify(t('COMPRA 1234 EST SERVICO POSTO XPTO'), [], cat).categoryId).toBe(cat('fuel'));
    expect(classify(t('COMPRA 1234 XPTO BURGERSPORTO'), [], cat).categoryId).toBe(cat('restaurants'));
    expect(classify(t('COMPRA 1234 BARBEARIA XPTO'), [], cat).categoryId).toBe(cat('uncategorized'));
    for (const d of ['COM.MAN.CONTA PACOTE MILLENNIUM GO 072026', 'CUSTO DE SERVICO INTERNACIONAL', 'COMISSAO TRF MBWAY 10.00 APP MB WAY'])
      expect(classify(t(d), [], cat).categoryId).toBe(cat('bank_fees'));
    expect(classify(t('COMPRA 1234 HIPAY LEVALLOIS-PERRET'), [], cat).categoryId).toBe(cat('uncategorized'));
  });
});
