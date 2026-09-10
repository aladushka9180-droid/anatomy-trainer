package ru.primetime.pro.calls;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.CallLog;
import android.provider.Settings;
import android.telephony.PhoneNumberUtils;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int CALL_LOG_PERMISSION_REQUEST = 701;
    private static final int MAX_RECENT_CALLS = 20;
    private final ExecutorService callsExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(24, 76, 112));
        configureWebView();
        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        if (savedInstanceState == null) webView.loadUrl(CallLogPolicy.START_URL);
        else webView.restoreState(savedInstanceState);
    }

    private void configureWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new CallsBridge(), "PrimeTimeAndroidCalls");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String destination = request.getUrl().toString();
                if (CallLogPolicy.isTrustedUrl(destination)) return false;
                openExternal(destination);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (CallLogPolicy.isTrustedUrl(url)) {
                    view.evaluateJavascript("window.dispatchEvent(new Event('primetime-native-ready'))", null);
                }
            }
        });
    }

    private void openExternal(String destination) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(destination));
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.external_link_error, Toast.LENGTH_SHORT).show();
        }
    }

    private boolean trustedPageIsOpen() {
        return webView != null && CallLogPolicy.isTrustedUrl(webView.getUrl());
    }

    private void startRecentCallsFlow() {
        if (!trustedPageIsOpen()) return;
        if (checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED) {
            loadRecentCalls();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle(R.string.call_log_disclosure_title)
                .setMessage(R.string.call_log_disclosure)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.continue_action, (dialog, which) ->
                        requestPermissions(new String[]{Manifest.permission.READ_CALL_LOG}, CALL_LOG_PERMISSION_REQUEST))
                .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CALL_LOG_PERMISSION_REQUEST) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            loadRecentCalls();
            return;
        }
        if (!shouldShowRequestPermissionRationale(Manifest.permission.READ_CALL_LOG)) showPermissionSettingsDialog();
        else Toast.makeText(this, R.string.call_log_denied, Toast.LENGTH_LONG).show();
    }

    private void showPermissionSettingsDialog() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.call_log_unavailable_title)
                .setMessage(R.string.call_log_unavailable)
                .setNegativeButton(android.R.string.cancel, null)
                .setPositiveButton(R.string.open_settings, (dialog, which) -> {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                })
                .show();
    }

    private void loadRecentCalls() {
        if (!trustedPageIsOpen()
                || checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return;
        callsExecutor.execute(() -> {
            List<CallEntry> entries = queryRecentIncomingCalls();
            runOnUiThread(() -> {
                if (trustedPageIsOpen() && !isFinishing() && !isDestroyed()) showRecentCalls(entries);
            });
        });
    }

    private List<CallEntry> queryRecentIncomingCalls() {
        List<CallEntry> entries = new ArrayList<>();
        Set<String> seenNumbers = new HashSet<>();
        String[] projection = {
                CallLog.Calls.NUMBER,
                CallLog.Calls.DATE,
                CallLog.Calls.TYPE
        };
        String selection = CallLog.Calls.TYPE + "=? OR " + CallLog.Calls.TYPE + "=?";
        String[] selectionArgs = {
                String.valueOf(CallLog.Calls.INCOMING_TYPE),
                String.valueOf(CallLog.Calls.MISSED_TYPE)
        };
        try (Cursor cursor = getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                CallLog.Calls.DATE + " DESC"
        )) {
            if (cursor == null) return entries;
            int numberColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER);
            int dateColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.DATE);
            int typeColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE);
            while (cursor.moveToNext() && entries.size() < MAX_RECENT_CALLS) {
                String rawNumber = cursor.getString(numberColumn);
                String normalized = CallLogPolicy.normalizeNumber(rawNumber);
                if (normalized.isEmpty() || !seenNumbers.add(normalized)) continue;
                entries.add(new CallEntry(rawNumber, cursor.getLong(dateColumn), cursor.getInt(typeColumn)));
            }
        } catch (SecurityException ignored) {
            runOnUiThread(this::showPermissionSettingsDialog);
        }
        return entries;
    }

    private void showRecentCalls(List<CallEntry> entries) {
        if (entries.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle(R.string.recent_calls_title)
                    .setMessage(R.string.no_recent_calls)
                    .setPositiveButton(android.R.string.ok, null)
                    .show();
            return;
        }
        CharSequence[] labels = new CharSequence[entries.size()];
        for (int index = 0; index < entries.size(); index++) labels[index] = entries.get(index).label();
        new AlertDialog.Builder(this)
                .setTitle(R.string.recent_calls_title)
                .setItems(labels, (dialog, index) -> deliverNumberToWeb(entries.get(index).rawNumber))
                .setNegativeButton(android.R.string.cancel, null)
                .show();
    }

    private void deliverNumberToWeb(String rawNumber) {
        if (!trustedPageIsOpen()) return;
        String script = "window.PrimeTimeReceiveRecentCall&&window.PrimeTimeReceiveRecentCall("
                + JSONObject.quote(rawNumber) + ")";
        webView.evaluateJavascript(script, null);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        callsExecutor.shutdownNow();
        if (webView != null) {
            webView.removeJavascriptInterface("PrimeTimeAndroidCalls");
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class CallsBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return true;
        }

        @JavascriptInterface
        public void openRecentCalls() {
            runOnUiThread(MainActivity.this::startRecentCallsFlow);
        }
    }

    private static final class CallEntry {
        final String rawNumber;
        final long timestamp;
        final int type;

        CallEntry(String rawNumber, long timestamp, int type) {
            this.rawNumber = rawNumber;
            this.timestamp = timestamp;
            this.type = type;
        }

        CharSequence label() {
            String formatted = PhoneNumberUtils.formatNumber(rawNumber, "RU");
            if (formatted == null || formatted.isBlank()) formatted = rawNumber;
            String kind = type == CallLog.Calls.MISSED_TYPE ? "Пропущенный" : "Входящий";
            DateFormat dateFormat = DateFormat.getDateTimeInstance(
                    DateFormat.MEDIUM,
                    DateFormat.SHORT,
                    new Locale("ru", "RU")
            );
            return formatted + "\n" + kind + " · " + dateFormat.format(new Date(timestamp));
        }
    }
}
