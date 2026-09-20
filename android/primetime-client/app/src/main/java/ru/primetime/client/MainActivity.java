package ru.primetime.client;

import android.app.Activity;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int MICROPHONE_PERMISSION_REQUEST = 4105;

    private WebView webView;
    private NativeVoiceBridge nativeVoiceBridge;
    private Runnable microphonePermissionGranted;
    private Runnable microphonePermissionDenied;
    private PermissionRequest pendingWebPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(26, 73, 89));
        configureWebView();
        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
        ));
        if (savedInstanceState == null) webView.loadUrl(NavigationPolicy.START_URL);
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
        nativeVoiceBridge = new NativeVoiceBridge(
                this,
                webView,
                this::requestMicrophonePermission
        );
        webView.addJavascriptInterface(nativeVoiceBridge, "PrimeTimeNativeVoice");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handleWebPermissionRequest(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (pendingWebPermissionRequest == request) {
                        pendingWebPermissionRequest = null;
                        clearPermissionCallbacks();
                    }
                });
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String destination = request.getUrl().toString();
                if (NavigationPolicy.isTrustedUrl(destination)) return false;
                openExternal(destination);
                return true;
            }
        });
    }

    private void handleWebPermissionRequest(PermissionRequest request) {
        String[] resources = request.getResources();
        boolean audioOnly = resources.length == 1
                && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0]);
        boolean trusted = NavigationPolicy.isTrustedOrigin(request.getOrigin().toString())
                && NavigationPolicy.isTrustedUrl(webView.getUrl());
        if (!audioOnly || !trusted || pendingWebPermissionRequest != null) {
            request.deny();
            return;
        }
        pendingWebPermissionRequest = request;
        requestMicrophonePermission(
                () -> {
                    if (pendingWebPermissionRequest != request) return;
                    pendingWebPermissionRequest = null;
                    request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                },
                () -> {
                    if (pendingWebPermissionRequest != request) return;
                    pendingWebPermissionRequest = null;
                    request.deny();
                }
        );
    }

    private void requestMicrophonePermission(Runnable onGranted, Runnable onDenied) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            onGranted.run();
            return;
        }
        if (microphonePermissionGranted != null || microphonePermissionDenied != null) {
            onDenied.run();
            return;
        }
        microphonePermissionGranted = onGranted;
        microphonePermissionDenied = onDenied;
        requestPermissions(
                new String[] { Manifest.permission.RECORD_AUDIO },
                MICROPHONE_PERMISSION_REQUEST
        );
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != MICROPHONE_PERMISSION_REQUEST) return;
        Runnable granted = microphonePermissionGranted;
        Runnable denied = microphonePermissionDenied;
        clearPermissionCallbacks();
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            if (granted != null) granted.run();
        } else if (denied != null) {
            denied.run();
        }
    }

    private void clearPermissionCallbacks() {
        microphonePermissionGranted = null;
        microphonePermissionDenied = null;
    }

    private void openExternal(String destination) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(destination)));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.external_link_error, Toast.LENGTH_SHORT).show();
        }
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
        if (nativeVoiceBridge != null) nativeVoiceBridge.destroy();
        if (pendingWebPermissionRequest != null) pendingWebPermissionRequest.deny();
        pendingWebPermissionRequest = null;
        clearPermissionCallbacks();
        if (webView != null) {
            webView.removeJavascriptInterface("PrimeTimeNativeVoice");
            webView.destroy();
        }
        super.onDestroy();
    }
}
