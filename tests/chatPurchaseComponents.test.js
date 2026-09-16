import { expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Exercise the actual pure JSX components with React elements and lightweight
// native hosts, using the existing Expo/Babel dependencies (no new renderer).
const mobile = fileURLToPath(new URL('../../mobile/', import.meta.url));
const nativeRequire = createRequire(path.join(mobile, 'package.json'));
const { transformSync } = nativeRequire('@babel/core');
const native = Object.fromEntries(['Text', 'View', 'Pressable', 'Modal', 'ScrollView', 'KeyboardAvoidingView'].map(name => [name, name]));
native.StyleSheet = { create: value => value, absoluteFill: {} };
native.Platform = { OS: 'ios' };
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const code = transformSync(fs.readFileSync(file, 'utf8'), { babelrc: false, configFile: false, filename: file,
    plugins: [[nativeRequire.resolve('@babel/plugin-transform-react-jsx'), { runtime: 'automatic' }], nativeRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  const module = { exports: {} };
  const require = name => {
    if (name === 'react-native') return native;
    if (name === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
    if (/\/common\/(Button|Input|Avatar|EmptyState|LoadingIndicator)$/.test(name)) return name.split('/').at(-1);
    if (name === '../../services/orderService') return { orderService: {} };
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.js`));
    return nativeRequire(name);
  };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
const TransactionCard = load(path.join(mobile, 'src/components/chat/TransactionCard.js')).default;
const PurchaseSheet = load(path.join(mobile, 'src/components/chat/PurchaseSheet.js')).default;
const { ReviewCard } = load(path.join(mobile, 'src/components/reviews/ReviewsSheet.js'));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const buttons = tree => nodes(tree).filter(node => node.type === 'Button');
const titles = tree => buttons(tree).map(node => node.props.title);
const base = { id: 'purchase', buyerId: 'buyer', sellerId: 'seller', status: 'pending', quantity: 2, productTitle: 'Mix de frutas', unitPriceSnapshot: 4.5, totalPriceSnapshot: 9, createdAt: '2026-09-15T10:00:00Z' };
const card = (userId, status = 'pending', extra = {}) => TransactionCard({ userId, buyerName: 'Bruno', sellerName: 'Tiago', event: { purchaseNumber: 1, isLatest: true, transaction: { ...base, status } }, ...extra });
const copy = tree => nodes(tree).filter(node => node.type === 'Text').flatMap(node => [node.props.children].flat()).filter(value => typeof value === 'string').join(' ');

it('abre o perfil do autor da avaliação ao tocar no nome ou avatar', () => {
  const onOpenProfile = vi.fn();
  const tree = ReviewCard({ review: { authorId: 'buyer', authorName: 'Bruno', authorAvatar: 'https://example.com/avatar.jpg', rating: 4, comment: 'Muito bom.' }, onOpenProfile });
  const link = nodes(tree).find(node => node.props?.accessibilityRole === 'link');
  expect(link.props.accessibilityLabel).toBe('Ver perfil de Bruno');
  expect(nodes(link).find(node => node.type === 'Avatar').props.uri).toBe('https://example.com/avatar.jpg');
  link.props.onPress();
  expect(onOpenProfile).toHaveBeenCalledExactlyOnceWith('buyer');
});

it('não disponibiliza navegação para autores indisponíveis', () => {
  const tree = ReviewCard({ review: { authorId: null, authorName: 'Comprador indisponível', authorAvatar: null, rating: 4, comment: '' }, onOpenProfile: vi.fn() });
  expect(nodes(tree).some(node => node.props?.accessibilityRole === 'link')).toBe(false);
  const identity = nodes(tree).find(node => node.type === 'Pressable');
  expect(identity.props.disabled).toBe(true);
  expect(identity.props.onPress).toBeUndefined();
  expect(nodes(identity).find(node => node.type === 'Avatar').props.uri).toBeNull();
});

it('mostra aceitar/recusar apenas ao vendedor e bloqueia durante um pedido', () => {
  expect(titles(card('buyer'))).toEqual([]);
  expect(titles(card('other'))).toEqual([]);
  expect(titles(card('seller'))).toEqual(['Aceitar proposta', 'Recusar']);
  expect(buttons(card('seller', 'pending', { busy: 'purchase:accept' })).every(button => button.props.disabled)).toBe(true);
  expect(buttons(card('seller', 'pending', { canInteract: false })).every(button => button.props.disabled)).toBe(true);
  expect(titles(card('seller', 'declined'))).toEqual([]);
});
it('cada participante confirma o acordo na ordem correta e só depois o comprador conclui', () => {
  expect(titles(card('buyer', 'accepted'))).toEqual(['Confirmar compra']);
  expect(titles(card('seller', 'accepted'))).toEqual([]);
  expect(titles(card('buyer', 'buyer_confirmed'))).toEqual([]);
  expect(titles(card('seller', 'buyer_confirmed'))).toEqual(['Confirmar venda']);
  expect(titles(card('buyer', 'seller_confirmed'))).toEqual(['Marcar como concluída']);
  expect(titles(card('seller', 'seller_confirmed'))).toEqual([]);
});
it('só o comprador avalia o vendedor após conclusão e não vê novamente o CTA após review', () => {
  expect(titles(card('buyer', 'completed'))).toEqual(['Avaliar vendedor']);
  expect(titles(card('seller', 'completed'))).toEqual([]);
  expect(titles(card('buyer', 'reviewed'))).toEqual([]);
  expect(titles(card('seller', 'reviewed'))).toEqual([]);
});
it('estrelas são interativas, rating é obrigatório e o botão tem loading', () => {
  const onChange = vi.fn();
  const props = { sheet: { type: 'review', rating: 0, comment: '' }, sellerName: 'Tiago', onChange };
  const initial = PurchaseSheet(props);
  expect(buttons(initial).find(button => button.props.title === 'Enviar avaliação').props.disabled).toBe(true);
  const stars = nodes(initial).filter(node => node.props?.accessibilityRole === 'radio');
  expect(stars).toHaveLength(5);
  stars[3].props.onPress(); expect(onChange).toHaveBeenCalledWith({ rating: 4 });
  const selected = PurchaseSheet({ ...props, sheet: { ...props.sheet, rating: 4 } });
  expect(buttons(selected)[0].props.disabled).toBe(false);
  expect(buttons(PurchaseSheet({ ...props, busy: true }))[0].props.loading).toBe(true);
});
it('Ainda não apenas fecha, sem invocar conclusão', () => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  const tree = PurchaseSheet({ sheet: { type: 'complete' }, onClose, onSubmit });
  buttons(tree).find(button => button.props.title === 'Ainda não').props.onPress();
  expect(onClose).toHaveBeenCalledOnce(); expect(onSubmit).not.toHaveBeenCalled();
});
it.each(['confirm-buyer', 'confirm-seller'])('a confirmação %s permite voltar sem alterar o acordo', type => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  const tree = PurchaseSheet({ sheet: { type, purchase: base }, onClose, onSubmit });
  expect(titles(tree)[0]).toBe(type === 'confirm-buyer' ? 'Confirmar compra' : 'Confirmar venda');
  buttons(tree).find(button => button.props.title === 'Ainda não').props.onPress();
  expect(onClose).toHaveBeenCalledOnce(); expect(onSubmit).not.toHaveBeenCalled();
});
it('quantidade mínima é um e envios incertos impedem alteração da proposta', () => {
  const props = { sheet: { type: 'propose', product: { title: 'Mix de frutas', price: 4.5, unit: '€/unidade' }, quantity: 1 }, onChange: vi.fn() };
  const steps = tree => nodes(tree).filter(node => ['Diminuir quantidade', 'Aumentar quantidade'].includes(node.props?.accessibilityLabel));
  expect(steps(PurchaseSheet(props))[0].props.disabled).toBe(true);
  steps(PurchaseSheet(props))[1].props.onPress(); expect(props.onChange).toHaveBeenCalledWith({ quantity: 2 });
  expect(steps(PurchaseSheet({ ...props, sheet: { ...props.sheet, quantity: 2, uncertain: true } })).every(step => step.props.disabled)).toBe(true);
});

it('recolhe compras antigas e expande os detalhes sem executar ações da compra', () => {
  const onToggle = vi.fn(), onAction = vi.fn();
  const event = { purchaseNumber: 2, isLatest: false, transaction: { ...base, status: 'reviewed', acceptedAt: base.createdAt,
    reviews: [{ reviewerId: 'buyer', rating: 4, comment: 'Tudo combinado.' }] } };
  const closed = card('buyer', 'reviewed', { event, onToggle, onAction });
  expect(copy(closed)).toContain('Finalizada');
  expect(copy(closed)).not.toContain('Percurso da compra');
  expect(copy(closed)).not.toContain('Tudo combinado.');
  const toggle = nodes(closed).find(node => node.props?.accessibilityLabel === 'Ver detalhes da compra 2');
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  toggle.props.onPress(); expect(onToggle).toHaveBeenCalledOnce(); expect(onAction).not.toHaveBeenCalled();
  const open = card('buyer', 'reviewed', { event, expanded: true });
  expect(copy(open)).toContain('Proposta aceite pelo vendedor');
  expect(copy(open)).toContain('Tudo combinado.');
  expect(nodes(open).some(node => node.props?.accessibilityLabel === 'Avaliação enviada: 4 de 5 estrelas')).toBe(true);
});
it('conserva a autoria de avaliações antigas e não apresenta comentários ocultados', () => {
  const event = { purchaseNumber: 1, transaction: { ...base, status: 'reviewed', reviews: [{ reviewerId: 'seller', rating: 5, comment: '' }] } };
  const tree = card('buyer', 'reviewed', { event, expanded: true });
  expect(nodes(tree).some(node => node.props?.accessibilityLabel === 'Avaliação recebida: 5 de 5 estrelas')).toBe(true);
  expect(copy(tree)).not.toContain('Acordo confirmado');
});
it('permite repetir apenas a última compra avaliada quando a API permite uma nova proposta', () => {
  const onRepeat = vi.fn(), onAction = vi.fn();
  const props = { canRepeat: true, onRepeat, onAction };
  const tree = card('buyer', 'reviewed', props);
  expect(titles(tree)).toEqual(['Comprar novamente']);
  buttons(tree)[0].props.onPress();
  expect(onRepeat).toHaveBeenCalledExactlyOnceWith({ ...base, status: 'reviewed' });
  expect(onAction).not.toHaveBeenCalled();
  expect(titles(card('seller', 'reviewed', props))).toEqual([]);
  expect(titles(card('buyer', 'reviewed', { ...props, canInteract: false }))).toEqual([]);
  expect(titles(card('buyer', 'reviewed', { ...props, canRepeat: false }))).toEqual([]);
  expect(titles(card('buyer', 'reviewed', { ...props, event: { purchaseNumber: 1, isLatest: false, transaction: { ...base, status: 'reviewed' } } }))).toEqual([]);
  expect(titles(card('buyer', 'completed', props))).toEqual(['Avaliar vendedor']);
  expect(buttons(card('buyer', 'reviewed', { ...props, busy: 'prepare' }))[0].props.disabled).toBe(true);
});
it.each(['pending', 'accepted', 'buyer_confirmed', 'seller_confirmed', 'completed'])('mantém só uma ação principal por participante no estado %s, mesmo com os detalhes abertos', status => {
  for (const userId of ['buyer', 'seller']) {
    const tree = card(userId, status, { expanded: true, canRepeat: true, onAction: vi.fn() });
    expect(buttons(tree).filter(node => node.props.variant !== 'secondary').length).toBeLessThanOrEqual(1);
    expect(titles(tree)).not.toContain('Comprar novamente');
    expect(titles(tree)).toEqual(titles(card(userId, status)));
  }
});
it('repetir abre uma proposta editável com o preço apresentado e permite cancelar', () => {
  const onClose = vi.fn(), onSubmit = vi.fn();
  const tree = PurchaseSheet({ sheet: { type: 'propose', repeat: true, product: { title: 'Mix de frutas', price: 6, unit: '€/unidade' }, quantity: 2 }, onClose, onSubmit });
  expect(copy(tree)).toContain('Comprar novamente');
  expect(copy(tree)).toContain('12,00');
  expect(titles(tree)).toEqual(['Enviar proposta', 'Cancelar']);
  buttons(tree)[1].props.onPress();
  expect(onClose).toHaveBeenCalledOnce(); expect(onSubmit).not.toHaveBeenCalled();
});
