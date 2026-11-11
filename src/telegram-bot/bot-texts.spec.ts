import {
  BOT_LANGS,
  botCommands,
  botLang,
  botProfile,
  fallbackMessage,
  helpMessage,
  menuKeyboard,
  parseCommand,
  startMessage,
} from './bot-texts.js';

describe('bot-texts', () => {
  it('Telegram tili → bot tili', () => {
    expect(botLang('ru')).toBe('ru');
    expect(botLang('en-US')).toBe('en');
    expect(botLang('uz')).toBe('uz');
    expect(botLang('tr')).toBe('uz');
    expect(botLang(undefined)).toBe('uz');
  });

  it('buyruqni ajratadi', () => {
    expect(parseCommand('/start')).toBe('start');
    expect(parseCommand('/start ref_123')).toBe('start');
    expect(parseCommand('/HELP@Osontarget_bot')).toBe('help');
    expect(parseCommand('salom')).toBeNull();
    expect(parseCommand('/')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it("Telegram chegaralariga sig'adi", () => {
    for (const lang of BOT_LANGS) {
      const p = botProfile(lang);
      // setMyDescription ≤ 512, setMyShortDescription ≤ 120 belgi.
      expect([...p.description].length).toBeLessThanOrEqual(512);
      expect([...p.shortDescription].length).toBeLessThanOrEqual(120);
      for (const c of botCommands(lang)) {
        expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
        expect(c.description.length).toBeGreaterThan(0);
        expect(c.description.length).toBeLessThanOrEqual(256);
      }
      // sendMessage ≤ 4096 belgi.
      for (const text of [
        startMessage(lang, 'A'.repeat(200)),
        startMessage(lang, 'Ali', { clientId: 12345678, freeUzs: 1e9 }),
        helpMessage(lang),
        fallbackMessage(lang),
      ]) {
        expect(text.length).toBeLessThanOrEqual(4096);
      }
    }
  });

  it("ism 64 belgigacha qisqartiriladi, bo'sh ism — ismsiz salom", () => {
    expect(startMessage('uz', 'A'.repeat(200))).toContain(
      `<b>${'A'.repeat(64)}</b>`,
    );
    expect(startMessage('uz', '  ')).toMatch(/^👋 Assalomu alaykum!\n/);
  });

  it('menyu: kabinet sahifalari Mini App orqali, sayt tilga mos', () => {
    const kb = menuKeyboard('en', 'https://osontarget.uz');
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toContainEqual({
      text: '💳 Top up balance',
      web_app: {
        url: 'https://osontarget.uz/app?next=%2Fdashboard%2Fbalance%2Ftopup',
      },
    });
    expect(buttons).toContainEqual({
      text: '🌐 Website',
      url: 'https://osontarget.uz/en',
    });
    // Har qatorda ko'pi bilan 2 tugma — telefonda matn kesilmasin.
    for (const row of kb.inline_keyboard)
      expect(row.length).toBeLessThanOrEqual(2);
  });
});
