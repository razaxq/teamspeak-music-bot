import { describe, it, expect, vi } from 'vitest';
import { BotManager } from './manager.js';

describe('BotManager shutdown waits for real disconnects', () => {
  it('waits for all protocol teardowns, including when one fails', async () => {
    let finish!: () => void;
    const disconnect = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const rejected = vi.fn(async () => { throw new Error('socket already closed'); });
    const bots = new Map([['slow', { disconnect }], ['failed', { disconnect: rejected }]]);
    const context = { bots } as unknown as BotManager;
    let done = false;
    const shutdown = BotManager.prototype.shutdown.call(context).then(() => { done = true; });
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(rejected).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    expect(bots.size).toBe(2);
    finish();
    await shutdown;
    expect(done).toBe(true);
    expect(bots.size).toBe(0);
  });
});
