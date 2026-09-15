import { describe, expect, it } from 'vitest';
import { mergeMessages } from '../../mobile/src/utils/chatMessages.js';

describe('estado de mensagens no mobile', () => {
  const message = { id: 'server-1', senderId: 'buyer', clientId: 'retry-1', text: 'Olá', createdAt: '2026-09-07T10:00:00.000Z' };
  it('substitui a mensagem pendente ou falhada pela confirmação sem duplicar', () => {
    const pending = { ...message, id: 'pending-1', status: 'failed' };
    const confirmed = mergeMessages([pending], [message]);
    expect(confirmed).toEqual([message]);
    expect(mergeMessages(confirmed, [message])).toEqual([message]);
  });
  it('mantém mensagens de autores diferentes com o mesmo clientId', () => {
    const reply = { ...message, id: 'server-2', senderId: 'seller' };
    expect(mergeMessages([message], [reply])).toHaveLength(2);
  });
  it('junta páginas sobrepostas em ordem cronológica e atualiza a leitura', () => {
    const earlier = { ...message, id: 'server-0', clientId: 'earlier', createdAt: '2026-09-07T09:00:00.000Z' };
    const read = { ...message, readAt: '2026-09-07T10:01:00.000Z' };
    expect(mergeMessages([message], [earlier, read])).toEqual([earlier, read]);
  });
});

it('apaga o conteúdo do autor eliminado em páginas antigas e respostas tardias', async () => {
  const { redactRemovedParticipant } = await import('../../mobile/src/utils/chatMessages.js');
  const participant = { id: 'seller', status: 'deleted' };
  const old = { id: '1', clientId: '1', senderId: 'seller', text: 'Texto antigo privado', createdAt: '2026-01-01' };
  const own = { ...old, id: '2', senderId: 'buyer', text: 'Meu texto' };
  const redacted = redactRemovedParticipant([old, own], participant);
  expect(redacted.map(row => row.text)).toEqual(['Mensagem removida', 'Meu texto']);
  expect(redactRemovedParticipant(mergeMessages(redacted, [old]), participant)[0].text).toBe('Mensagem removida');
  expect(redactRemovedParticipant([old], { id: 'seller', status: 'deactivated' })).toEqual([old]);
});
