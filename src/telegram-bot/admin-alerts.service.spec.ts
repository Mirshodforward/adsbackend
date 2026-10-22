import { describe, expect, it, vi } from 'vitest';
import { AdminAlertsService } from './admin-alerts.service.js';

function make(ids: string[]) {
  const bot = { sendMessage: vi.fn(async () => true) };
  const config = { get: () => ids };
  return { bot, svc: new AdminAlertsService(bot as never, config as never) };
}

describe('AdminAlertsService', () => {
  it('kalitli xabar oraliqda bir marta ketadi; clear() dan keyin yana', async () => {
    const { bot, svc } = make(['1', '2']);
    expect(await svc.send('TON kam', { key: 'ton-low' })).toBe(true);
    expect(await svc.send('TON kam', { key: 'ton-low' })).toBe(false);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2); // ikkala admin, bir marta
    svc.clear('ton-low');
    expect(await svc.send('TON kam', { key: 'ton-low' })).toBe(true);
    expect(bot.sendMessage).toHaveBeenCalledTimes(4);
  });

  it('kalitsiz xabar har safar ketadi', async () => {
    const { bot, svc } = make(['1']);
    await svc.send('a');
    await svc.send('a');
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("admin ro'yxati bo'sh — yuborilmaydi", async () => {
    const { bot, svc } = make([]);
    expect(await svc.send('a')).toBe(false);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });
});
