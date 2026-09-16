import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { app } from '../src/app.js';
import { User } from '../src/models/User.js';
import { Product } from '../src/models/Product.js';
import { Conversation } from '../src/models/Conversation.js';
import { Transaction } from '../src/models/Transaction.js';
import { Message } from '../src/models/Message.js';
import { Session } from '../src/models/Session.js';
import { tokenService } from '../src/services/tokenService.js';
import { chatService } from '../src/services/chatService.js';
import { transactionService } from '../src/services/transactionService.js';
import { migrateChatTransactions } from '../scripts/migrate-chat-transactions.js';
import { completeAccountDeletion } from '../src/services/accountService.js';

let mongo, product, conversation;
const actors = Object.fromEntries(['buyer', 'seller', 'other'].map(role => [role, new mongoose.Types.ObjectId().toString()]));
const tokens = {};
const input = { quantity: 2, expectedUnitPrice: 4.5, clientId: 'proposal-test-1' };
const review = { rating: 5, comment: 'Pontual e simpático.', clientId: 'review-test-1' };
const url = () => `/api/v1/conversations/${conversation.id}`;
const post = (actor, path, body = {}) => request(app).post(`${url()}${path}`).auth(tokens[actor], { type: 'bearer' }).send(body);
const propose = () => transactionService.propose(actors.buyer, conversation.id, input);
const act = (transaction, action, actor = ['complete', 'confirm-buyer'].includes(action) ? 'buyer' : 'seller') => transactionService.transition(actors[actor], conversation.id, transaction.id, action);
const confirmAgreement = async purchase => { await act(purchase, 'confirm-buyer'); return act(purchase, 'confirm-seller'); };
const finish = async () => { const proposal = await propose(); await act(proposal, 'accept'); await confirmAgreement(proposal); return act(proposal, 'complete'); };

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Transaction.init(), Conversation.init(), Message.init()]);
  for (const [role, id] of Object.entries(actors)) {
    await User.collection.insertOne({ _id: new mongoose.Types.ObjectId(id), name: role, email: `${role}@test.example`, status: 'active' });
  }
});
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => {
  await Promise.all([Transaction.deleteMany({}), Conversation.deleteMany({}), Message.deleteMany({}), Product.deleteMany({})]);
  await Session.deleteMany({});
  for (const [role, id] of Object.entries(actors)) {
    await User.updateOne({ _id: id }, { $set: { status: 'active', name: role, email: `${role}@test.example` }, $unset: { avatarFilename: '' } });
    const session = await Session.create({ userId: id, refreshTokenHash: 'test', expiresAt: new Date(Date.now() + 3600000) });
    tokens[role] = tokenService.generateAccessToken({ id }, session.id);
  }
  product = await Product.create({ title: 'Mix de frutas', description: 'Fruta local', price: 4.5, unit: '€/unidade', category: 'Frutas', location: 'Tomar', seller: actors.seller });
  conversation = await Conversation.create({ product: product.id, productTitle: product.title, buyer: actors.buyer, seller: actors.seller });
});

describe('compra dentro do chat', () => {
  it('percorre a API inteira com snapshots, timestamps, review e reputação reais', async () => {
    let response = await post('buyer', '/transactions', input);
    expect(response.status).toBe(200);
    const purchase = response.body.data;
    expect(purchase).toMatchObject({ status: 'pending', quantity: 2, unitPriceSnapshot: 4.5, totalPriceSnapshot: 9, buyerId: actors.buyer, sellerId: actors.seller });
    response = await post('seller', `/transactions/${purchase.id}/accept`);
    expect(response.status).toBe(200); expect(response.body.data.acceptedAt).toBeTruthy();
    response = await post('buyer', `/transactions/${purchase.id}/confirm-buyer`);
    expect(response.status).toBe(200); expect(response.body.data.buyerAgreementConfirmedAt).toBeTruthy();
    response = await post('seller', `/transactions/${purchase.id}/confirm-seller`);
    expect(response.status).toBe(200); expect(response.body.data.sellerAgreementConfirmedAt).toBeTruthy();
    response = await post('buyer', `/transactions/${purchase.id}/complete`);
    expect(response.status).toBe(200);
    expect(response.body.data.buyerConfirmedAt).toBe(response.body.data.completedAt);
    response = await post('buyer', `/transactions/${purchase.id}/review`, review);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'reviewed', revision: 5, reviews: [{ transactionId: purchase.id, reviewerId: actors.buyer, reviewedUserId: actors.seller, rating: 5, comment: review.comment }] });
    expect(response.body.data.reviewedAt).toBeTruthy();
    const reputation = await request(app).get('/api/v1/users/me/reputation').auth(tokens.seller, { type: 'bearer' });
    expect(reputation.body.data).toEqual({ average: 5, count: 1 });
    expect(await transactionService.reputation(actors.buyer)).toEqual({ average: null, count: 0 });
    const page = await request(app).get(`${url()}/messages`).auth(tokens.seller, { type: 'bearer' });
    expect(page.body.data.transactions).toHaveLength(1);
    expect(page.body.data.sellerReputation).toEqual({ average: 5, count: 1 });
    expect(page.body.data.items).toEqual([]); // No fabricated user messages.
    expect((await chatService.list(actors.buyer, 1, 50)).items[0].lastMessage).toBe('Transação concluída');
  });

  it('preserva a proposta recusada e permite uma nova', async () => {
    const purchase = await propose();
    const declined = await act(purchase, 'decline');
    expect(declined.status).toBe('declined'); expect(declined.declinedAt).toBeTruthy();
    const next = await transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'proposal-test-2' });
    expect(next.id).not.toBe(purchase.id);
    expect((await chatService.detail(actors.buyer, conversation.id)).transactions).toHaveLength(2);
    await expect(act(purchase, 'accept')).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });
  });

  it('mantém snapshot após alteração, desativação e eliminação física do produto', async () => {
    const purchase = await propose();
    await Product.updateOne({ _id: product.id }, { $set: { price: 10, title: 'Novo título', is_active: false } });
    await act(purchase, 'accept');
    await Product.deleteOne({ _id: product.id });
    await confirmAgreement(purchase);
    const complete = await act(purchase, 'complete');
    expect(complete).toMatchObject({ productTitle: 'Mix de frutas', unitPriceSnapshot: 4.5, totalPriceSnapshot: 9, status: 'completed' });
    expect(await propose()).toMatchObject({ id: purchase.id, status: 'completed' });
    expect((await chatService.detail(actors.buyer, conversation.id)).purchaseProduct).toBeNull();
    expect((await transactionService.review(actors.buyer, conversation.id, purchase.id, review)).status).toBe('reviewed');
  });

  it.each([{ is_active: false }, { status: 'sold' }, { status: 'deleted' }])('bloqueia novas propostas para produto indisponível: %j', async changes => {
    await Product.updateOne({ _id: product.id }, { $set: changes });
    const result = await post('buyer', '/transactions', input);
    expect(result.status).toBe(409); expect(result.body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('exige reconfirmação quando o preço atual mudou e calcula em cêntimos', async () => {
    await Product.updateOne({ _id: product.id }, { $set: { price: 0.1 } });
    const result = await post('buyer', '/transactions', input);
    expect(result.status).toBe(409); expect(result.body.error.details.price).toBe(0.1);
    expect(await Transaction.countDocuments()).toBe(0);
    const saved = await transactionService.propose(actors.buyer, conversation.id, { ...input, quantity: 3, expectedUnitPrice: 0.1 });
    expect(saved.totalPriceSnapshot).toBe(0.3);
  });

  it('preserva precisão de preços legados e arredonda apenas o total', async () => {
    await Product.updateOne({ _id: product.id }, { $set: { price: 0.015 } });
    const data = { ...input, quantity: 3, expectedUnitPrice: 0.015 };
    const saved = await transactionService.propose(actors.buyer, conversation.id, data);
    expect(saved.unitPriceSnapshot).toBe(0.015); expect(saved.totalPriceSnapshot).toBe(0.05);
    expect((await transactionService.propose(actors.buyer, conversation.id, data)).id).toBe(saved.id);
  });

  it('suspende ações com contas indisponíveis e elimina texto livre na remoção de conta', async () => {
    const purchase = await finish();
    await User.updateOne({ _id: actors.seller }, { $set: { status: 'deactivated' } });
    await expect(transactionService.review(actors.buyer, conversation.id, purchase.id, review)).rejects.toMatchObject({ code: 'CONVERSATION_UNAVAILABLE' });
    await User.updateOne({ _id: actors.seller }, { $set: { status: 'active' } });
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    await User.updateOne({ _id: actors.seller }, { $set: { status: 'deletion_pending' } });
    const context = await transactionService.context(actors.buyer, conversation.id);
    expect(context.transactions[0].productTitle).toBe('Anúncio indisponível');
    expect(context.transactions[0].reviews[0].comment).toBe('');
    await completeAccountDeletion(actors.seller);
    const saved = await Transaction.findById(purchase.id);
    expect(saved.productTitle).toBe('Anúncio indisponível'); expect(saved.reviews[0].comment).toBe('');
    expect(saved.reviews[0].rating).toBe(5); expect(saved.totalPriceSnapshot).toBe(9);
  });

  it('usa índices únicos e pedidos idempotentes sob concorrência', async () => {
    const proposals = await Promise.all(Array.from({ length: 4 }, propose));
    expect(new Set(proposals.map(item => item.id)).size).toBe(1);
    const purchase = proposals[0];
    const accepts = await Promise.all([act(purchase, 'accept'), act(purchase, 'accept')]);
    expect(accepts[0].acceptedAt).toEqual(accepts[1].acceptedAt);
    const buyers = await Promise.all([act(purchase, 'confirm-buyer'), act(purchase, 'confirm-buyer')]);
    expect(buyers[0].buyerAgreementConfirmedAt).toEqual(buyers[1].buyerAgreementConfirmedAt);
    const sellers = await Promise.all([act(purchase, 'confirm-seller'), act(purchase, 'confirm-seller')]);
    expect(sellers[0].sellerAgreementConfirmedAt).toEqual(sellers[1].sellerAgreementConfirmedAt);
    const completions = await Promise.all([act(purchase, 'complete'), act(purchase, 'complete')]);
    expect(completions[0].completedAt).toEqual(completions[1].completedAt);
    const reviews = await Promise.all([1, 2].map(() => transactionService.review(actors.buyer, conversation.id, purchase.id, review)));
    expect(reviews[0].reviewedAt).toEqual(reviews[1].reviewedAt);
    expect(reviews[0].reviews).toHaveLength(1);
    expect(await Transaction.countDocuments()).toBe(1);
    expect((await propose()).status).toBe('reviewed');
    expect((await act(purchase, 'accept')).status).toBe('reviewed');
    expect((await act(purchase, 'complete')).status).toBe('reviewed');
  });

  it('duas chaves concorrentes não criam duas transações ativas', async () => {
    const results = await Promise.allSettled([propose(), transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'another-proposal' })]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('ACTIVE_TRANSACTION_EXISTS');
    const raw = (await Transaction.findOne().lean());
    delete raw._id;
    await expect(Transaction.create({ ...raw, clientId: 'direct-duplicate' })).rejects.toMatchObject({ code: 11000 });
  });

  it('aceitar e recusar simultaneamente só permite uma decisão', async () => {
    const purchase = await propose();
    const results = await Promise.allSettled([act(purchase, 'accept'), act(purchase, 'decline')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected').reason.code).toBe('INVALID_TRANSACTION_STATE');
  });

  it('não permite uma nova compra até à avaliação e calcula média a partir das avaliações válidas', async () => {
    const purchase = await finish();
    await expect(transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'proposal-next' })).rejects.toMatchObject({ code: 'ACTIVE_TRANSACTION_EXISTS' });
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    const next = await transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'proposal-next' });
    await act(next, 'accept'); await confirmAgreement(next); await act(next, 'complete');
    await transactionService.review(actors.buyer, conversation.id, next.id, { ...review, rating: 4 });
    expect(await transactionService.reputation(actors.seller)).toEqual({ average: 4.5, count: 2 });
  });

  it('atualiza encomendas, vendas, perfil público e produtos uma única vez após avaliação', async () => {
    const purchase = await finish();
    const summary = actor => request(app).get('/api/v1/users/me/commerce').auth(tokens[actor], { type: 'bearer' });
    expect((await summary('buyer')).body.data.ordersCount).toBe(0);
    expect((await summary('seller')).body.data.salesCount).toBe(0);
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    expect((await summary('buyer')).body.data).toEqual({ ordersCount: 1, salesCount: 0, reputation: { average: null, count: 0 } });
    expect((await summary('seller')).body.data).toEqual({ ordersCount: 0, salesCount: 1, reputation: { average: 5, count: 1 } });
    const publicProfile = await request(app).get(`/api/v1/users/${actors.seller}/profile`);
    expect(publicProfile.status).toBe(200);
    expect(publicProfile.body.data).toMatchObject({ id: actors.seller, salesCount: 1, reputation: { average: 5, count: 1 } });
    expect(publicProfile.body.data).not.toHaveProperty('email'); expect(publicProfile.body.data).not.toHaveProperty('ordersCount');
    const productResponse = await request(app).get(`/api/v1/products/${product.id}`);
    expect(productResponse.body.data.seller).toMatchObject({ salesCount: 1, reputation: { average: 5, count: 1 } });
    const products = await request(app).get('/api/v1/products');
    expect(products.body.data.items[0].seller.reputation).toEqual({ average: 5, count: 1 });
    await Product.deleteMany({ seller: actors.seller });
    expect((await request(app).get(`/api/v1/users/${actors.seller}/profile`)).body.data.salesCount).toBe(1);
  });

  it('históricos privados distinguem encomendas de vendas, paginam e abrem a conversa certa', async () => {
    const purchase = await finish();
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    const next = await transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'proposal-next' });
    const history = (actor, query) => request(app).get(`/api/v1/users/me/transactions?${query}`).auth(tokens[actor], { type: 'bearer' });
    const buyer = await history('buyer', 'role=buyer&limit=1');
    expect(buyer.body.data.items[0]).toMatchObject({ id: next.id, conversationId: conversation.id, participantName: 'seller' });
    expect(buyer.body.data.pagination.total).toBe(2);
    expect((await history('buyer', 'role=buyer&limit=1&page=2')).body.data.items[0].id).toBe(purchase.id);
    expect((await history('seller', 'role=seller')).body.data.items).toHaveLength(2);
    expect((await history('buyer', 'role=seller')).body.data.items).toHaveLength(0);
    expect((await history('other', 'role=buyer')).body.data.items).toHaveLength(0);
    expect((await history('other', `role=buyer&userId=${actors.buyer}`)).status).toBe(422);
    expect((await request(app).get('/api/v1/users/me/transactions')).status).toBe(401);
    expect((await request(app).get('/api/v1/users/me/commerce')).status).toBe(401);
  });

  it('não transforma avaliações antigas do comprador em avaliações do vendedor', async () => {
    const purchase = await finish();
    const before = new Date();
    await Transaction.collection.updateOne({ _id: new mongoose.Types.ObjectId(purchase.id) }, { $set: {
      status: 'reviewed', reviewedAt: before, reviews: [{ _id: new mongoose.Types.ObjectId(), reviewer: new mongoose.Types.ObjectId(actors.seller), reviewedUser: new mongoose.Types.ObjectId(actors.buyer), rating: 4, comment: 'Avaliação antiga', createdAt: before, clientId: 'legacy-review' }]
    } });
    await migrateChatTransactions();
    const saved = await Transaction.findById(purchase.id);
    expect(String(saved.reviews[0].reviewer)).toBe(actors.seller);
    expect(String(saved.reviews[0].reviewedUser)).toBe(actors.buyer);
    expect(await transactionService.summary(actors.seller)).toEqual({ salesCount: 1, ordersCount: 0, reputation: { average: null, count: 0 } });
    await expect(transactionService.review(actors.buyer, conversation.id, purchase.id, review)).rejects.toMatchObject({ code: 'INVALID_TRANSACTION_STATE' });
  });
  it('permite avaliar compras antigas já concluídas sem inventar confirmações', async () => {
    const purchase = await propose(); await act(purchase, 'accept');
    const before = new Date();
    await Transaction.collection.updateOne({ _id: new mongoose.Types.ObjectId(purchase.id) }, { $set: { status: 'completed', buyerConfirmedAt: before, completedAt: before } });
    const saved = await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    expect(saved.status).toBe('reviewed'); expect(saved.completedAt).toEqual(before);
    expect(saved.buyerAgreementConfirmedAt).toBeUndefined(); expect(saved.sellerAgreementConfirmedAt).toBeUndefined();
    expect((await transactionService.summary(actors.seller)).salesCount).toBe(1);
  });
  it('oculta perfis indisponíveis e dados pessoais dos históricos após eliminação', async () => {
    const purchase = await finish(); await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    await User.updateOne({ _id: actors.seller }, { $set: { status: 'deletion_pending' } });
    expect((await request(app).get(`/api/v1/users/${actors.seller}/profile`)).status).toBe(404);
    const history = await request(app).get('/api/v1/users/me/transactions?role=buyer').auth(tokens.buyer, { type: 'bearer' });
    expect(history.body.data.items[0]).toMatchObject({ participantName: 'Conta eliminada', productTitle: 'Anúncio indisponível', reviews: [{ comment: '' }] });
    expect(history.body.data.items[0]).not.toHaveProperty('email');
  });
});

describe('avaliações públicas do vendedor', () => {
  const listing = (query = '', seller = actors.seller) => request(app).get(`/api/v1/users/${seller}/reviews${query ? `?${query}` : ''}`);
  const reviewed = async () => {
    const purchase = await finish();
    await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    return Transaction.findById(purchase.id).lean();
  };

  it('publica apenas a avaliação após conclusão, sem dados privados da compra', async () => {
    const purchase = await finish();
    expect((await listing()).body.data).toEqual({ items: [], reputation: { average: null, count: 0 }, pagination: { page: 1, limit: 20, total: 0 } });
    const saved = await transactionService.review(actors.buyer, conversation.id, purchase.id, review);
    await Product.deleteMany({});
    const response = await listing();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      items: [{ id: saved.reviews[0].id, rating: 5, comment: review.comment, createdAt: saved.reviews[0].createdAt.toISOString(), authorName: 'buyer', authorId: actors.buyer, authorAvatarFilename: null }],
      reputation: { average: 5, count: 1 }, pagination: { page: 1, limit: 20, total: 1 }
    });
    expect((await listing('', actors.buyer)).body.data.items).toEqual([]);
  });

  it('inclui o avatar atual e o acesso ao perfil público do autor, mesmo sem anúncios', async () => {
    await reviewed();
    await User.updateOne({ _id: actors.buyer }, { $set: { avatarFilename: 'buyer-current.jpg', name: 'Comprador Atual' } });
    const item = (await listing()).body.data.items[0];
    expect(item).toMatchObject({ authorId: actors.buyer, authorName: 'Comprador Atual', authorAvatarFilename: 'buyer-current.jpg' });
    const profile = await request(app).get(`/api/v1/users/${item.authorId}/profile`);
    expect(profile.status).toBe(200);
    expect(profile.body.data).toMatchObject({ id: actors.buyer, name: 'Comprador Atual', avatarFilename: 'buyer-current.jpg' });
    expect(item).not.toHaveProperty('email'); expect(item).not.toHaveProperty('conversationId');
  });

  it('pagina com ordem estável e inclui avaliações sem comentário na mesma média do perfil', async () => {
    const original = await reviewed();
    const date = new Date('2026-09-16T12:00:00Z');
    const ids = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await Transaction.collection.updateOne({ _id: original._id }, { $set: { 'reviews.0.createdAt': date, 'reviews.0._id': ids[0] } });
    for (const [index, rating] of [4, 2].entries()) await Transaction.collection.insertOne({
      ...original, _id: new mongoose.Types.ObjectId(), clientId: `another-purchase-${index}`,
      reviews: [{ ...original.reviews[0], _id: ids[index + 1], createdAt: date, rating, comment: '' }]
    });
    const first = (await listing('limit=2')).body.data;
    const second = (await listing('limit=2&page=2')).body.data;
    expect(first.items.map(item => item.id)).toEqual([String(ids[2]), String(ids[1])]);
    expect(second.items.map(item => item.id)).toEqual([String(ids[0])]);
    expect(first.items.every(item => item.comment === '')).toBe(true);
    expect(first.pagination).toEqual({ page: 1, limit: 2, total: 3 });
    expect(first.reputation).toEqual({ average: 3.7, count: 3 });
    expect(first.reputation).toEqual((await request(app).get(`/api/v1/users/${actors.seller}/profile`)).body.data.reputation);
    expect((await listing('page=3&limit=2')).body.data.items).toEqual([]);
  });

  it('exclui reviews antigas vendedor → comprador, inválidas, incompletas e de outros vendedores', async () => {
    const original = await reviewed();
    const buyer = new mongoose.Types.ObjectId(actors.buyer), seller = new mongoose.Types.ObjectId(actors.seller), other = new mongoose.Types.ObjectId(actors.other);
    const variants = [
      { reviews: [{ ...original.reviews[0], reviewer: seller, reviewedUser: buyer }] },
      { reviews: [{ ...original.reviews[0], reviewer: other }] },
      { reviews: [{ ...original.reviews[0], reviewedUser: other }] },
      { reviews: [{ ...original.reviews[0], rating: 3.5 }] },
      { reviews: [{ ...original.reviews[0], rating: 0 }] },
      { reviews: [{ ...original.reviews[0], rating: 6 }] },
      { seller: other, reviews: [{ ...original.reviews[0], reviewedUser: other }] },
      { buyer: seller, reviews: [{ ...original.reviews[0], reviewer: seller }] },
      { completedAt: null }, { reviewedAt: null }, { status: 'completed' }
    ];
    for (const [index, changes] of variants.entries()) await Transaction.collection.insertOne({
      ...original, _id: new mongoose.Types.ObjectId(), conversation: new mongoose.Types.ObjectId(), clientId: `excluded-purchase-${index}`, ...changes
    });
    const response = (await listing()).body.data;
    expect(response.items).toHaveLength(1);
    expect(response.reputation).toEqual(await transactionService.reputation(actors.seller));
    expect(response.reputation).toEqual({ average: 5, count: 1 });
  });

  it.each(['deleted', 'deletion_pending', 'deactivated', 'suspended'])('oculta identidade, avatar e acesso ao perfil de autor %s', async status => {
    await reviewed();
    await User.updateOne({ _id: actors.buyer }, { $set: { status, avatarFilename: 'private-avatar.jpg' } });
    const response = (await listing()).body.data;
    expect(response.items[0]).toMatchObject({ authorName: 'Comprador indisponível', authorId: null, authorAvatarFilename: null,
      comment: ['deleted', 'deletion_pending'].includes(status) ? '' : review.comment, rating: 5 });
    expect(response.reputation).toEqual({ average: 5, count: 1 });
    expect(JSON.stringify(response)).not.toContain(actors.buyer);
    expect(JSON.stringify(response)).not.toContain('private-avatar.jpg');
  });

  it('valida a paginação e só permite consultar vendedores ativos', async () => {
    for (const query of ['page=0', 'page=1.5', 'limit=0', 'limit=51', 'limit=x', 'page=10001', `buyerId=${actors.buyer}`]) {
      expect((await listing(query)).status).toBe(422);
    }
    expect((await listing('', 'invalid')).status).toBe(422);
    expect((await listing('', new mongoose.Types.ObjectId())).status).toBe(404);
    await User.updateOne({ _id: actors.seller }, { $set: { status: 'deletion_pending' } });
    expect((await listing()).status).toBe(404);
  });
});

describe('autorização e validação', () => {
  it('exige as duas confirmações sequenciais por participantes diferentes antes da conclusão', async () => {
    const purchase = await propose();
    const action = (actor, name) => post(actor, `/transactions/${purchase.id}/${name}`);
    expect((await action('buyer', 'confirm-buyer')).status).toBe(409);
    expect((await action('seller', 'confirm-seller')).status).toBe(409);
    await act(purchase, 'accept');
    expect((await action('buyer', 'complete')).status).toBe(409);
    expect((await action('seller', 'confirm-buyer')).status).toBe(403);
    expect((await action('seller', 'confirm-seller')).status).toBe(409);
    expect((await action('buyer', 'confirm-buyer')).body.data.status).toBe('buyer_confirmed');
    expect((await action('buyer', 'complete')).status).toBe(409);
    expect((await action('buyer', 'confirm-seller')).status).toBe(403);
    expect((await post('buyer', `/transactions/${purchase.id}/review`, review)).status).toBe(409);
    expect((await action('seller', 'confirm-seller')).body.data.status).toBe('seller_confirmed');
    expect((await action('seller', 'complete')).status).toBe(403);
    expect((await action('buyer', 'complete')).body.data.status).toBe('completed');
    expect((await action('buyer', 'confirm-buyer')).body.data.status).toBe('completed');
    expect((await action('seller', 'confirm-seller')).body.data.status).toBe('completed');
  });
  it.each(['buyer_confirmed', 'seller_confirmed'])('o índice continua a bloquear propostas duplicadas no estado %s', async status => {
    const purchase = await propose(); await act(purchase, 'accept'); await act(purchase, 'confirm-buyer');
    if (status === 'seller_confirmed') await act(purchase, 'confirm-seller');
    expect((await transactionService.context(actors.buyer, conversation.id)).canPropose).toBe(false);
    await expect(transactionService.propose(actors.buyer, conversation.id, { ...input, clientId: 'new-active-proposal' })).rejects.toMatchObject({ code: 'ACTIVE_TRANSACTION_EXISTS' });
    const duplicate = (await Transaction.findById(purchase.id)).toObject(); delete duplicate._id;
    await expect(Transaction.create({ ...duplicate, clientId: 'direct-new-proposal' })).rejects.toMatchObject({ code: 11000 });
  });
  it('exige sessão e impede vendedor/terceiros de criarem ou consultarem propostas', async () => {
    expect((await request(app).post(`${url()}/transactions`).send(input)).status).toBe(401);
    expect((await post('seller', '/transactions', input)).status).toBe(403);
    expect((await post('other', '/transactions', input)).status).toBe(404);
    expect((await request(app).get(`${url()}/messages`).auth(tokens.other, { type: 'bearer' })).status).toBe(404);
  });
  it('impede autoaceitação, recusa pelo comprador, conclusão pelo vendedor e acesso de terceiros', async () => {
    const purchase = await propose();
    for (const action of ['accept', 'decline']) expect((await post('buyer', `/transactions/${purchase.id}/${action}`)).status).toBe(403);
    expect((await post('buyer', `/transactions/${purchase.id}/complete`)).status).toBe(409);
    await act(purchase, 'accept');
    expect((await post('seller', `/transactions/${purchase.id}/complete`)).status).toBe(403);
    for (const action of ['accept', 'decline', 'confirm-buyer', 'confirm-seller', 'complete', 'review']) {
      expect((await post('other', `/transactions/${purchase.id}/${action}`, action === 'review' ? review : {})).status).toBe(404);
    }
  });
  it('impede review antecipada, autoavaliação, direção inversa e segunda review', async () => {
    const purchase = await propose();
    expect((await post('buyer', `/transactions/${purchase.id}/review`, review)).status).toBe(409);
    await act(purchase, 'accept');
    expect((await post('buyer', `/transactions/${purchase.id}/review`, review)).status).toBe(409);
    await confirmAgreement(purchase);
    await act(purchase, 'complete');
    expect((await post('seller', `/transactions/${purchase.id}/review`, review)).status).toBe(403);
    expect((await post('buyer', `/transactions/${purchase.id}/review`, review)).status).toBe(200);
    for (const body of [{ ...review, clientId: 'new-review-id' }, { ...review, rating: 1 }]) {
      const result = await post('buyer', `/transactions/${purchase.id}/review`, body);
      expect(result.status).toBe(409); expect(result.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
    }
    expect((await Transaction.findById(purchase.id)).reviews).toHaveLength(1);
  });
  it('valida quantidade, campos de preço/estado e reutilização da chave', async () => {
    for (const body of [{ ...input, quantity: 0 }, { ...input, quantity: 1.5 }, { ...input, quantity: 10000 }, { ...input, quantity: '2' }, { ...input, totalPriceSnapshot: 0.01 }, { ...input, seller: actors.other }, { ...input, status: 'reviewed' }]) {
      expect((await post('buyer', '/transactions', body)).status).toBe(422);
    }
    const purchase = await propose();
    expect((await post('buyer', '/transactions', { ...input, quantity: 3 })).body.error.code).toBe('PROPOSAL_ID_REUSED');
    expect((await post('seller', `/transactions/${purchase.id}/accept`, { status: 'reviewed' })).status).toBe(422);
    expect((await post('buyer', `/transactions/${purchase.id}/cancel`)).status).toBe(404);
  });
  it.each([0, 6, 1.5, '5', null])('rejeita classificação inválida %j', async rating => {
    const purchase = await finish();
    expect((await post('buyer', `/transactions/${purchase.id}/review`, { ...review, rating })).status).toBe(422);
    expect((await Transaction.findById(purchase.id)).status).toBe('completed');
  });
  it('guarda comentário opcional vazio e rejeita campos de identidade e comentários excessivos', async () => {
    const purchase = await finish();
    for (const body of [{ ...review, reviewer: actors.buyer }, { ...review, reviewedUser: actors.seller }, { ...review, comment: 'a'.repeat(2001) }]) expect((await post('buyer', `/transactions/${purchase.id}/review`, body)).status).toBe(422);
    expect((await post('buyer', `/transactions/${purchase.id}/review`, { rating: 3, clientId: review.clientId })).body.data.reviews[0].comment).toBe('');
  });
  it('não permite usar uma transaction de outra conversa', async () => {
    const purchase = await propose();
    const otherConversation = await Conversation.create({ product: new mongoose.Types.ObjectId(), buyer: actors.buyer, seller: actors.seller, productTitle: 'Outro' });
    await expect(transactionService.transition(actors.seller, otherConversation.id, purchase.id, 'accept')).rejects.toMatchObject({ statusCode: 404 });
  });
  it('migração é repetível e preserva o histórico', async () => {
    await propose();
    await Transaction.collection.createIndex({ conversation: 1 }, { name: 'one_active_transaction_per_conversation', unique: true,
      partialFilterExpression: { status: { $in: ['pending', 'accepted', 'completed'] } } });
    await migrateChatTransactions(); await migrateChatTransactions();
    expect(await Transaction.countDocuments()).toBe(1);
    expect((await Transaction.collection.indexes()).find(index => index.name === 'one_active_chat_purchase_v2').unique).toBe(true);
  });
});
