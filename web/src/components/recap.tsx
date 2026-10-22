// Monthly recap: five short cards about last month. All numbers come from this server.
import { useState } from 'react';
import { TrendingDown, TrendingUp, Trophy, Sparkles } from 'lucide-react';
import { useApi } from '../api.ts';
import { m, t, T } from '../i18n.ts';
import { useCategories, useSession } from '../state.tsx';
import { ErrorBox, Loading, Modal, Money, Ring } from './ui.tsx';
import { CatIcon, Monogram } from './icons.tsx';
import { Art } from './illustrations.tsx';
import { addMonths } from '../../../shared/dates.ts';

type Recap = {
  month: string; currency: string; spending: number; income: number; previousSpending: number; count: number;
  topCategory: { categoryId: number | null; spending: number } | null;
  biggestChange: { categoryId: number | null; current: number; previous: number } | null;
  topMerchant: { merchant: string; spending: number; count: number } | null;
  budgets: { kept: number; total: number };
};

export function RecapStory({ month, onClose }: { month: string; onClose: () => void }) {
  const { fmt } = useSession();
  const { byId } = useCategories();
  const r = useApi<Recap>(`/recap?month=${month}`);
  const [i, setI] = useState(0);
  const x = r.data;
  const name = (id: number | null) => (id ? byId.get(id)?.name : undefined) ?? t('Uncategorized');
  const prevName = fmt.month(addMonths(month, -1)).split(' ')[0];

  const slides = !x ? [] : [
    <>
      <Art.chart />
      <p className="recap-kicker">{t('In {month} you spent', { month: fmt.month(x.month) })}</p>
      <p className="recap-big"><Money minor={x.spending} currency={x.currency} /></p>
      {x.previousSpending > 0 && x.spending !== x.previousSpending && (
        <p className={`trend ${x.spending < x.previousSpending ? 'good' : 'bad'}`}>
          {x.spending < x.previousSpending ? <TrendingDown size={16} aria-hidden="true" /> : <TrendingUp size={16} aria-hidden="true" />}
          <T s={x.spending < x.previousSpending ? '{amount} less than in {month}' : '{amount} more than in {month}'} amount={<Money minor={Math.abs(x.spending - x.previousSpending)} currency={x.currency} />} month={prevName} />
        </p>
      )}
      <p className="muted">{t('{n} payments in and out.', { n: x.count })}</p>
    </>,
    x.topCategory ? (
      <>
        <CatIcon cat={x.topCategory.categoryId ? byId.get(x.topCategory.categoryId) : null} size={88} />
        <p className="recap-kicker">{t('Most of it went to')}</p>
        <p className="recap-big">{name(x.topCategory.categoryId)}</p>
        <p>{x.spending > 0 ? <T s="{amount}, about {pct}% of your spending." amount={<Money minor={x.topCategory.spending} currency={x.currency} />} pct={Math.round((x.topCategory.spending / x.spending) * 100)} /> : <Money minor={x.topCategory.spending} currency={x.currency} />}</p>
      </>
    ) : null,
    x.biggestChange && x.biggestChange.current !== x.biggestChange.previous ? (
      <>
        <CatIcon cat={x.biggestChange.categoryId ? byId.get(x.biggestChange.categoryId) : null} size={88} />
        <p className="recap-kicker">{t('The biggest change')}</p>
        <p className="recap-big">{name(x.biggestChange.categoryId)}</p>
        <p className={`trend ${x.biggestChange.current < x.biggestChange.previous ? 'good' : 'bad'}`}>
          <T s={x.biggestChange.current < x.biggestChange.previous ? 'Down {amount} from {month}' : 'Up {amount} from {month}'} amount={<Money minor={Math.abs(x.biggestChange.current - x.biggestChange.previous)} currency={x.currency} />} month={prevName} />
        </p>
        <p className="muted"><Money minor={x.biggestChange.previous} currency={x.currency} /> → <Money minor={x.biggestChange.current} currency={x.currency} /></p>
      </>
    ) : null,
    x.topMerchant ? (
      <>
        <Monogram name={x.topMerchant.merchant} size={88} />
        <p className="recap-kicker">{t('Your most visited place')}</p>
        <p className="recap-big">{t(x.topMerchant.merchant)}</p>
        <p><T s={x.topMerchant.count === 1 ? '{n} time, {amount} in total.' : '{n} times, {amount} in total.'} n={x.topMerchant.count} amount={<Money minor={x.topMerchant.spending} currency={x.currency} />} /></p>
      </>
    ) : null,
    <>
      {x.budgets.total ? (
        <>
          <Ring pct={(x.budgets.kept / x.budgets.total) * 100} state={x.budgets.kept === x.budgets.total ? 'ok' : x.budgets.kept * 2 >= x.budgets.total ? 'warning' : 'over'} size={130} label={t('{kept} of {total} budgets kept', { kept: x.budgets.kept, total: x.budgets.total })}>
            <strong>{x.budgets.kept}/{x.budgets.total}</strong>
          </Ring>
          <p className="recap-kicker">{t('Budgets kept')}</p>
          <p className="recap-big">{x.budgets.kept === x.budgets.total ? <><Trophy size={28} aria-hidden="true" /> {t('All of them!')}</> : t('{i} of {n}', { i: x.budgets.kept, n: x.budgets.total })}</p>
        </>
      ) : <Art.target />}
      <p className="recap-cheer"><Sparkles size={18} aria-hidden="true" /> {t(cheer(x))}</p>
    </>,
  ].filter(Boolean);
  const last = i >= slides.length - 1;

  return (
    <Modal open title={x ? `${m.recap.title}: ${fmt.month(x.month)}` : m.recap.title} onClose={onClose} footer={x && <>
      {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{m.common.back}</button>}
      <button className="btn btn-primary" data-autofocus onClick={() => (last ? onClose() : setI(i + 1))}>{last ? m.common.close : m.welcome.next}</button>
    </>}>
      {r.error && <ErrorBox error={r.error} />}
      {!x ? <Loading /> : (
        <div className="welcome recap-slide" key={i} aria-live="polite">
          <span className="sr-only">{t('Card {i} of {n}.', { i: i + 1, n: slides.length })} </span>{slides[i]}
          <div className="steps-dots" aria-hidden="true">{slides.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        </div>
      )}
    </Modal>
  );
}

function cheer(x: Recap) {
  if (x.budgets.total && x.budgets.kept === x.budgets.total) return 'You stayed inside every budget. Well done!';
  if (x.previousSpending > 0 && x.spending < x.previousSpending) return 'You spent less than the month before. Nice work!';
  if (x.income > x.spending) return 'More came in than went out. That is a good month.';
  return 'Every month is a fresh start. Small changes add up.';
}
