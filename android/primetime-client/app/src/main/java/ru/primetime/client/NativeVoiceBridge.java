package ru.primetime.client;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;

final class NativeVoiceBridge {
    interface MicrophonePermissionRequester {
        void request(Runnable onGranted, Runnable onDenied);
    }

    private static final long CAPTURE_TIMEOUT_MS = 18_000L;

    private final MainActivity activity;
    private final WebView webView;
    private final MicrophonePermissionRequester permissionRequester;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private String activeRequestId;
    private Runnable captureTimeout;

    NativeVoiceBridge(
            MainActivity activity,
            WebView webView,
            MicrophonePermissionRequester permissionRequester
    ) {
        this.activity = activity;
        this.webView = webView;
        this.permissionRequester = permissionRequester;
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && SpeechRecognizer.isOnDeviceRecognitionAvailable(activity);
    }

    @JavascriptInterface
    public void start(String requestId) {
        if (!NativeVoicePolicy.isValidRequestId(requestId)) return;
        activity.runOnUiThread(() -> startOnUiThread(requestId));
    }

    @JavascriptInterface
    public void stop(String requestId) {
        if (!NativeVoicePolicy.isValidRequestId(requestId)) return;
        activity.runOnUiThread(() -> {
            if (requestId.equals(activeRequestId)) closeRecognizer(true);
        });
    }

    private void startOnUiThread(String requestId) {
        if (!NavigationPolicy.isTrustedUrl(webView.getUrl())) return;
        if (!isAvailable()) {
            emitError(requestId, "unavailable");
            return;
        }
        if (activeRequestId != null) {
            emitError(requestId, "capture_failed");
            return;
        }
        emit(requestId, "requesting_permission", null, null);
        permissionRequester.request(
                () -> beginRecognition(requestId),
                () -> emitError(requestId, "permission_denied")
        );
    }

    private void beginRecognition(String requestId) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                || !NavigationPolicy.isTrustedUrl(webView.getUrl())
                || !isAvailable()) {
            emitError(requestId, "unavailable");
            return;
        }
        try {
            recognizer = SpeechRecognizer.createOnDeviceSpeechRecognizer(activity);
            activeRequestId = requestId;
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override
                public void onReadyForSpeech(Bundle params) {
                    emit(requestId, "listening", null, null);
                }

                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float rmsdB) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}

                @Override
                public void onError(int error) {
                    if (!requestId.equals(activeRequestId)) return;
                    String code = NativeVoicePolicy.errorCode(error);
                    closeRecognizer(false);
                    emitError(requestId, code);
                }

                @Override
                public void onResults(Bundle results) {
                    if (!requestId.equals(activeRequestId)) return;
                    ArrayList<String> candidates = results == null
                            ? null
                            : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    String transcript = NativeVoicePolicy.normalizeTranscript(
                            candidates == null || candidates.isEmpty() ? "" : candidates.get(0)
                    );
                    closeRecognizer(false);
                    if (transcript.isEmpty()) emitError(requestId, "capture_failed");
                    else emit(requestId, "result", transcript, null);
                }

                @Override public void onPartialResults(Bundle partialResults) {}
                @Override public void onEvent(int eventType, Bundle params) {}
            });

            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
            );
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            captureTimeout = () -> {
                if (!requestId.equals(activeRequestId)) return;
                closeRecognizer(true);
                emitError(requestId, "capture_failed");
            };
            handler.postDelayed(captureTimeout, CAPTURE_TIMEOUT_MS);
            recognizer.startListening(intent);
        } catch (RuntimeException ignored) {
            closeRecognizer(true);
            emitError(requestId, "capture_failed");
        }
    }

    private void emitError(String requestId, String code) {
        emit(requestId, "error", null, code);
    }

    private void emit(String requestId, String status, String transcript, String error) {
        if (!NavigationPolicy.isTrustedUrl(webView.getUrl())) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("requestId", requestId);
            detail.put("status", status);
            if (transcript != null) detail.put("transcript", transcript);
            if (error != null) detail.put("error", error);
        } catch (JSONException ignored) {
            return;
        }
        String script = "window.dispatchEvent(new CustomEvent("
                + JSONObject.quote(NativeVoicePolicy.EVENT_NAME)
                + ",{detail:" + detail + "}));";
        webView.evaluateJavascript(script, null);
    }

    private void closeRecognizer(boolean cancel) {
        if (captureTimeout != null) handler.removeCallbacks(captureTimeout);
        captureTimeout = null;
        SpeechRecognizer active = recognizer;
        recognizer = null;
        activeRequestId = null;
        if (active == null) return;
        try {
            if (cancel) active.cancel();
        } catch (RuntimeException ignored) {
            // The recognizer has already reached a terminal state.
        }
        active.destroy();
    }

    void destroy() {
        closeRecognizer(true);
    }
}
