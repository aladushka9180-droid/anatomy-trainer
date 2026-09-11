import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const module = readFileSync(new URL('integration-management.js', root), 'utf8');
const payment = readFileSync(new URL('payment-management.js', root), 'utf8');
const transfer = readFileSync(new URL('client-import.js', root), 'utf8');
const styles = readFileSync(new URL('provider-integrations.css', root), 'utf8');
const worker = readFileSync(new URL('sw.js', root), 'utf8');

assert.match(html, /value="paymentProviderPanel">Оплата и сервисы</);
assert.match(html, /data-section-target="paymentProviderPanel">Оплата и сервисы</);
assert.match(html, /id="providerIntegrationsDisclosure"[\s\S]*DIKIDI и YCLIENTS/);
assert.match(html, /data-provider-integration-form="dikidi"/);
assert.match(html, /data-provider-integration-form="yclients"/);
assert.match(html, /Подключение не запускает рабочую синхронизацию/);
const integrationMarkup = html.match(/id="providerIntegrationsDisclosure"[\s\S]*?<\/details>\s*<\/section>/)?.[0] || '';
assert.doesNotMatch(integrationMarkup, /Secret Key|API[- ]?ключ|токен/i);
assert.match(html, /provider-integrations\.css\?v=\d+/);
assert.match(html, /integration-management\.js\?v=\d+/);
assert.match(html, /id="paymentSandboxDisclosure"[\s\S]*Без списаний и данных карты/);
assert.match(html, /id="clientTransferExportButton"/);
assert.match(html, /id="clientTransferRollbackButton"/);

assert.match(module, /get_minuta_provider_connector_read_model_v144/);
assert.match(module, /configure_minuta_integration_connection_v142/);
assert.match(module, /p_environment:'testing'/);
assert.match(module, /p_enabled:false/);
assert.match(module, /\['owner', 'admin'\]/);
assert.match(module, /String\(value\.organizationId \|\| ''\) !== String\(organizationId \|\| ''\)/);
assert.match(module, /!validWorkspace\(result\.data, organizationId\)/);
assert.doesNotMatch(module, /secret_ref|api_key/i);
assert.match(module, /organization\?\.id === organizationId/);
assert.match(provider, /integrationController\.setOrganization\(organization\)/);
assert.match(provider, /integrationController\.reset\(\)/);
assert.match(provider, /getSandboxBookings:[\s\S]*totalPriceRub/);
assert.match(payment, /apply_minuta_payment_sandbox_v144/);
assert.match(payment, /get_minuta_payment_sandbox_journal_v144/);
assert.match(payment, /p_purpose:pending\.purpose/);
assert.doesNotMatch(payment.match(/async function runSandboxCommand[\s\S]*?\n    }\n    function setBusy/)?.[0] || '', /functions\.invoke|yookassa/i);
assert.match(transfer, /clientTransferExportButton/);
assert.match(transfer, /clientTransferRollbackButton/);
assert.match(transfer, /downloadProviderTransferExport/);
assert.match(transfer, /rollback_minuta_provider_transfer_v144/);
assert.match(worker, /provider-integrations\.css\?v=\d+/);
assert.match(worker, /integration-management\.js\?v=\d+/);

assert.match(styles, /grid-template-columns:\s*repeat\(2/);
assert.match(styles, /@media \(max-width: 760px\)[\s\S]*grid-template-columns:\s*1fr/);
assert.match(styles, /min-height:\s*44px/);

console.log('PrimeTime Pro integrations v144 static checks passed');
