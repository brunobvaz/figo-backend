import { describe, expect, it } from 'vitest';
import { mergeTransactions, purchaseHistory, purchaseTimeline, reputationLabel } from '../../mobile/src/utils/chatTransactions.js';

const pending = { id: 'purchase-1', status: 'pending', revision: 0, createdAt: '2026-09-15T10:00:00.000Z' };
const accepted = { ...pending, status: 'accepted', revision: 1, acceptedAt: '2026-09-15T10:02:00.000Z' };
const complete = { ...accepted, status: 'completed', revision: 2, completedAt: '2026-09-15T10:05:00.000Z' };
const reviewed = { ...complete, status: 'reviewed', revision: 3, reviewedAt: '2026-09-15T10:08:00.000Z' };
const nextPurchase = { ...pending, id: 'purchase-2', createdAt: '2026-09-16T10:00:00.000Z' };

describe('histórico de compras agrupado no chat', () => {
  it('não regride após polls tardios e mantém um único cartão com a mesma chave', () => {
    expect(mergeTransactions([reviewed], [pending, accepted, complete])).toEqual([reviewed]);
    const purchases = mergeTransactions(mergeTransactions([], [pending]), [reviewed, reviewed]);
    const timeline = purchaseTimeline([], purchases, false);
    expect(timeline).toEqual(purchaseTimeline([], [reviewed], false));
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe(purchaseTimeline([], [pending], false)[0].id);
    expect(timeline[0].transaction.status).toBe('reviewed');
  });
  it('preserva todas as mensagens e posiciona a compra na última etapa persistida', () => {
    const messages = [{ id: 'm1', createdAt: '2026-09-15T10:01:00.000Z' }, { id: 'm2', createdAt: '2026-09-15T10:04:00.000Z' }];
    const timeline = purchaseTimeline(messages, [complete], false);
    expect(timeline.map(item => item.id)).toEqual(['m1', 'm2', 'transaction:purchase-1']);
    expect(timeline.slice(0, 2)).toEqual(messages);
    expect(timeline[2].createdAt).toBe(complete.completedAt);
    expect(purchaseTimeline([], [accepted], false)[0].createdAt).toBe(accepted.acceptedAt);
  });
  it('revela compras antigas com a paginação sem alterar a numeração ou o histórico', () => {
    const messages = [{ id: 'm', createdAt: '2026-09-16T09:00:00.000Z' }];
    const purchases = [nextPurchase, reviewed];
    const page = purchaseTimeline(messages, purchases, true);
    expect(page.map(item => item.id)).toEqual(['m', 'transaction:purchase-2']);
    expect(page[1].purchaseNumber).toBe(2);
    const all = purchaseTimeline(messages, purchases, false);
    expect(all.map(item => item.id)).toEqual(['transaction:purchase-1', 'm', 'transaction:purchase-2']);
    expect(all[2]).toEqual(page[1]);
    expect(all[0].history).toEqual(purchaseHistory(reviewed));
    expect(all[0].isLatest).toBe(false);
  });
  it.each([pending, reviewed])('mantém a última compra $status acessível se as mensagens recentes forem posteriores', purchase => {
    const messages = [{ id: 'new', createdAt: '2026-09-17T10:00:00.000Z' }];
    const timeline = purchaseTimeline(messages, [purchase], true);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].isLatest).toBe(true);
    expect(timeline[0].transaction).toEqual(purchase);
  });
  it('conserva recusas e distingue propostas sucessivas mesmo com datas iguais', () => {
    const declined = { ...pending, status: 'declined', declinedAt: '2026-09-15T10:03:00.000Z' };
    const second = { ...nextPurchase, createdAt: pending.createdAt };
    const timeline = purchaseTimeline([], [second, declined], false);
    expect(new Set(timeline.map(item => item.id)).size).toBe(2);
    expect(timeline.find(item => item.transaction.id === declined.id)).toMatchObject({ purchaseNumber: 1, isLatest: false, history: [{ stage: 'proposal' }, { stage: 'declined' }] });
    expect(timeline.find(item => item.transaction.id === second.id)).toMatchObject({ purchaseNumber: 2, isLatest: true });
  });
  it('guarda as confirmações nos detalhes sem inventar etapas de compras antigas', () => {
    const purchase = { ...reviewed, revision: 5, buyerAgreementConfirmedAt: '2026-09-15T10:03:00.000Z', sellerAgreementConfirmedAt: '2026-09-15T10:04:00.000Z' };
    const timeline = purchaseTimeline([], mergeTransactions([purchase], [accepted, purchase]), false);
    expect(timeline).toHaveLength(1);
    expect(timeline[0].history.map(event => event.stage)).toEqual(['proposal', 'accepted', 'buyer_confirmed', 'seller_confirmed', 'completed', 'reviewed']);
    expect(timeline[0].history[2].createdAt).toBe(purchase.buyerAgreementConfirmedAt);
    expect(purchaseHistory(reviewed).map(event => event.stage)).toEqual(['proposal', 'accepted', 'completed', 'reviewed']);
    expect(purchaseHistory({ ...complete, completedAt: null, buyerConfirmedAt: complete.completedAt }).at(-1)).toEqual({ stage: 'completed', createdAt: complete.completedAt });
  });
  it('mostra média e contagem reais em português', () => {
    expect(reputationLabel({ average: 4.8, count: 12 })).toBe('★ 4,8 · 12 avaliações');
    expect(reputationLabel({ average: 5, count: 1 })).toBe('★ 5,0 · 1 avaliação');
    expect(reputationLabel({ average: null, count: 0 })).toContain('Ainda sem avaliações');
  });
});
