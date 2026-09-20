package ru.primetime.client;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.speech.SpeechRecognizer;

import org.junit.Test;

public final class NativeVoicePolicyTest {
    @Test
    public void acceptsOnlyBoundedOpaqueRequestIds() {
        assertTrue(NativeVoicePolicy.isValidRequestId("pt-lw3d-abc123"));
        assertFalse(NativeVoicePolicy.isValidRequestId(""));
        assertFalse(NativeVoicePolicy.isValidRequestId("bad request"));
        assertFalse(NativeVoicePolicy.isValidRequestId("x".repeat(81)));
    }

    @Test
    public void normalizesAndBoundsTranscript() {
        assertEquals("массаж спины завтра", NativeVoicePolicy.normalizeTranscript("  массаж   спины завтра "));
        assertEquals(240, NativeVoicePolicy.normalizeTranscript("я".repeat(300)).length());
    }

    @Test
    public void mapsPermissionAndLanguageErrorsWithoutExposingPlatformDetails() {
        assertEquals(
                "permission_denied",
                NativeVoicePolicy.errorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)
        );
        assertEquals(
                "unavailable",
                NativeVoicePolicy.errorCode(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)
        );
        assertEquals("capture_failed", NativeVoicePolicy.errorCode(SpeechRecognizer.ERROR_NO_MATCH));
    }
}
