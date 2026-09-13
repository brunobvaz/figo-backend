import { afterEach, expect, it, vi } from 'vitest';
import { scheduleLoadingReveal } from '../../mobile/src/utils/delayedLoading.js';
afterEach(() => vi.useRealTimers());
it('só revela após 250 ms', () => {
 vi.useFakeTimers(); const reveal = vi.fn(); const cancel = scheduleLoadingReveal(reveal);
 vi.advanceTimersByTime(249); expect(reveal).not.toHaveBeenCalled();
 vi.advanceTimersByTime(1); expect(reveal).toHaveBeenCalledTimes(1); cancel();
});
it('não revela se o pedido terminar ou desmontar antes do limite', () => {
 vi.useFakeTimers(); const reveal = vi.fn(); const cancel = scheduleLoadingReveal(reveal);
 vi.advanceTimersByTime(100); cancel(); vi.advanceTimersByTime(1000); expect(reveal).not.toHaveBeenCalled();
});
