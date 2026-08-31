const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const alertTopic = process.env.MINUTA_ALERT_TOPIC || 'проверка рабочего сайта';

if (!token || !chatId) {
  console.log('Minuta alert: Telegram secrets are not configured, notification skipped');
  process.exit(0);
}

const repository = process.env.GITHUB_REPOSITORY || 'локальный запуск';
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : '';
const message = [
  `⚠️ Minuta: сбой — ${alertTopic}.`,
  `Репозиторий: ${repository}`,
  runUrl ? `Подробности: ${runUrl}` : ''
].filter(Boolean).join('\n');

let response;
try {
  response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10000)
  });
} catch (error) {
  throw new Error(`Telegram notification request failed: ${error?.message || 'network error'}`);
}

if (!response.ok) {
  const body = (await response.text()).slice(0, 300);
  throw new Error(`Telegram notification failed: ${response.status} ${body}`);
}

console.log('Minuta alert: Telegram notification sent');
