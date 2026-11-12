/**
 * Unified Telegram Bot Service Wrapper
 * Delegates cleanly to the single canonical engine in `src/telegram.js`.
 */

const telegram = require('../telegram');

module.exports = {
  initTelegramBot: telegram.initTelegramBot,
  initTelegram: telegram.initTelegram,
  sendTelegramMessage: telegram.sendTelegramMessage,
  sendTelegramAlert: telegram.sendTelegramAlert,
  handleBotCommand: telegram.handleBotCommand,
  handleCallbackQuery: telegram.handleCallbackQuery,
  registerBotCommands: telegram.registerBotCommands,
  getBotInstance: telegram.getBotInstance,
};
