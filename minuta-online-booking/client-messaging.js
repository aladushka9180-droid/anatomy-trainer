(function initClientMessaging() {
  'use strict';

  const dialog = document.querySelector('#clientMessagingDialog');
  if (!dialog) return;

  const textArea = dialog.querySelector('#clientMessagingText');
  const status = dialog.querySelector('#clientMessagingStatus');
  const nameNode = dialog.querySelector('#clientMessagingName');
  const phoneNode = dialog.querySelector('#clientMessagingPhone');
  const emailButton = dialog.querySelector('[data-message-channel="email"]');
  let recipient = { name:'Клиент', phone:'', email:'', presets:{} };

  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('8')) digits = `7${digits.slice(1)}`;
    return digits;
  }

  async function copyText(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      const field = document.createElement('textarea');
      field.value = value;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.append(field);
      field.select();
      const copied = document.execCommand('copy');
      field.remove();
      return copied;
    }
  }

  function setStatus(message) { status.textContent = message; }

  function openWebLink(url) {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function selectPreset(kind) {
    dialog.querySelectorAll('[data-message-preset]').forEach(button => button.classList.toggle('active', button.dataset.messagePreset === kind));
    if (kind !== 'custom' && recipient.presets[kind]) textArea.value = recipient.presets[kind];
    if (kind === 'custom') textArea.focus();
  }

  function open(button) {
    const phone = normalizePhone(button.dataset.clientPhone);
    if (!phone) return;
    recipient = {
      name:button.dataset.clientName || 'Клиент',
      phone,
      email:String(button.dataset.clientEmail || '').trim(),
      presets:{
        confirmation:button.dataset.messageConfirmation || '',
        reminder:button.dataset.messageReminder || '',
        reschedule:button.dataset.messageReschedule || '',
        cancellation:button.dataset.messageCancellation || ''
      }
    };
    nameNode.textContent = recipient.name;
    phoneNode.textContent = `+${recipient.phone}`;
    emailButton.hidden = !recipient.email;
    dialog.querySelectorAll('[data-message-preset]').forEach(buttonNode => {
      if (buttonNode.dataset.messagePreset !== 'custom') buttonNode.disabled = !recipient.presets[buttonNode.dataset.messagePreset];
    });
    const initialPreset = recipient.presets.reminder ? 'reminder' : recipient.presets.confirmation ? 'confirmation' : 'custom';
    textArea.value = recipient.presets[initialPreset] || `Здравствуйте, ${recipient.name}!`;
    selectPreset(initialPreset);
    setStatus('После перехода проверьте отправку в приложении.');
    dialog.showModal();
  }

  async function openChannel(channel) {
    const message = textArea.value.trim();
    const phone = recipient.phone;
    if (!phone) return;
    if (channel === 'whatsapp') openWebLink(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`);
    if (channel === 'telegram') {
      const telegramMessage = message.startsWith('@') ? ` ${message}` : message;
      openWebLink(`https://t.me/+${phone}?text=${encodeURIComponent(telegramMessage)}`);
    }
    if (channel === 'sms') {
      const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?';
      window.location.assign(`sms:+${phone}${separator}body=${encodeURIComponent(message)}`);
    }
    if (channel === 'email' && recipient.email) openWebLink(`mailto:${encodeURIComponent(recipient.email)}?subject=${encodeURIComponent('Сообщение о записи')}&body=${encodeURIComponent(message)}`);
    if (channel === 'max' || channel === 'vk') {
      const copiedPhone = copyText(`+${phone}`);
      if (channel === 'max') openWebLink(`https://max.ru/:share?text=${encodeURIComponent(message)}`);
      else openWebLink('https://vk.com/im');
      const copied = await copiedPhone;
      setStatus(copied
        ? `${channel === 'max' ? 'MAX открыт с готовым сообщением. ' : 'VK открыт. '}Номер клиента скопирован для поиска.`
        : `${channel === 'max' ? 'MAX открыт с готовым сообщением. ' : 'VK открыт. '}Найдите клиента по номеру.`);
      return;
    }
    setStatus(`Открыто в ${channel === 'whatsapp' ? 'WhatsApp' : channel === 'telegram' ? 'Telegram' : channel === 'sms' ? 'SMS' : 'почте'}. Проверьте отправку.`);
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-message-client]');
    if (trigger) { event.preventDefault(); open(trigger); return; }
    const close = event.target.closest('[data-close-client-messaging]');
    if (close) { dialog.close(); return; }
    const preset = event.target.closest('[data-message-preset]');
    if (preset) { selectPreset(preset.dataset.messagePreset); return; }
    const channel = event.target.closest('[data-message-channel]');
    if (channel) void openChannel(channel.dataset.messageChannel);
  });

  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  textArea.addEventListener('input', () => selectPreset('custom'));
  dialog.querySelector('#copyClientMessage').addEventListener('click', async () => setStatus(await copyText(textArea.value) ? 'Текст скопирован.' : 'Не удалось скопировать текст.'));
  dialog.querySelector('#copyClientPhone').addEventListener('click', async () => setStatus(await copyText(`+${recipient.phone}`) ? 'Номер скопирован.' : 'Не удалось скопировать номер.'));
})();
