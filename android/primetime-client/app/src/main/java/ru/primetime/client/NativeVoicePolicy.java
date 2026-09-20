package ru.primetime.client;

import android.speech.SpeechRecognizer;

final class NativeVoicePolicy {
    static final String EVENT_NAME = "primetime-native-voice";

    private NativeVoicePolicy() {}

    static boolean isValidRequestId(String value) {
        return value != null
                && value.length() >= 1
                && value.length() <= 80
                && value.matches("[A-Za-z0-9-]+");
    }

    static String normalizeTranscript(String value) {
        if (value == null) return "";
        String normalized = value.replaceAll("\\s+", " ").trim();
        return normalized.substring(0, Math.min(normalized.length(), 240));
    }

    static String errorCode(int recognizerError) {
        if (recognizerError == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
            return "permission_denied";
        }
        if (recognizerError == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED
                || recognizerError == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) {
            return "unavailable";
        }
        return "capture_failed";
    }
}
