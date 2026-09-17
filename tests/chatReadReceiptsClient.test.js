import { expect, it } from 'vitest';
import { visibleChatReceipts } from '../../mobile/src/utils/chatReadReceipts.js';

const message = { id: 'message', senderId: 'other', readAt: null };
const purchase = ids => ({ id: 'transaction:purchase', kind: 'transaction', transaction: { id: 'purchase', unreadEventIds: ids } });
const tokens = timeline => timeline.map((item, index) => ({ item, index, isViewable: true }));
const receipts = (visible, timeline, pending = new Set(), acknowledged = new Set()) => visibleChatReceipts(visible, timeline, 'me', pending, acknowledged);

it('reconhece texto e várias novidades do cartão visível na mesma confirmação', () => {
  const timeline = [message, purchase(['proposal', 'confirmation'])];
  expect(receipts(tokens(timeline), timeline)).toEqual({ messageIds: ['message'], transactionEventIds: ['proposal', 'confirmation'],
    keys: ['message:message', 'transaction:proposal', 'transaction:confirmation'] });
});

it('reconhece uma nova etapa no mesmo cartão sem precisar de sair da conversa', () => {
  const old = [purchase(['proposal'])];
  const current = [purchase(['proposal', 'confirmation'])];
  expect(receipts(tokens(old), current, new Set(), new Set(['transaction:proposal'])).transactionEventIds).toEqual(['confirmation']);
});

it('espera pela visibilidade atualizada quando o cartão muda de posição', () => {
  const old = [purchase(['proposal']), message];
  const current = [message, purchase(['proposal', 'confirmation'])];
  expect(receipts(tokens(old), current).keys).toEqual([]);
  expect(receipts([tokens(current)[1]], current).transactionEventIds).toEqual(['proposal', 'confirmation']);
});

it('ignora cartões fora do ecrã, mensagens próprias e recibos pendentes ou já confirmados', () => {
  const timeline = [message, { ...message, id: 'own', senderId: 'me' }, purchase(['pending', 'seen', 'new'])];
  const visible = tokens(timeline);
  expect(receipts(visible.slice(0, 2), timeline).transactionEventIds).toEqual([]);
  expect(receipts(visible, timeline, new Set(['transaction:pending']), new Set(['transaction:seen']))).toMatchObject({ messageIds: ['message'], transactionEventIds: ['new'] });
  expect(receipts(visible.map(token => ({ ...token, isViewable: false })), timeline).keys).toEqual([]);
});

it('mantém compatibilidade com compras antigas e limita os lotes de leitura', () => {
  const legacy = purchase(undefined);
  expect(receipts(tokens([legacy]), [legacy]).keys).toEqual([]);
  const timeline = [purchase(Array.from({ length: 105 }, (_, index) => String(index)))];
  expect(receipts(tokens(timeline), timeline).transactionEventIds).toHaveLength(100);
});
