package ru.primetime.pro.calls;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class CallLogPolicyTest {
    @Test
    public void trustsOnlyPrimeTimeProductionPath() {
        assertTrue(CallLogPolicy.isTrustedUrl(CallLogPolicy.START_URL));
        assertTrue(CallLogPolicy.isTrustedUrl(CallLogPolicy.START_URL + "?view=bookings"));
        assertFalse(CallLogPolicy.isTrustedUrl("http://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/provider.html"));
        assertFalse(CallLogPolicy.isTrustedUrl("https://aladushka9180-droid.github.io.evil.example/anatomy-trainer/minuta-online-booking/provider.html"));
        assertFalse(CallLogPolicy.isTrustedUrl("https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/../index.html"));
        assertFalse(CallLogPolicy.isTrustedUrl("https://user@aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/provider.html"));
    }

    @Test
    public void normalizesRussianNumbersWithoutAcceptingShortValues() {
        assertEquals("79990509525", CallLogPolicy.normalizeNumber("8 (999) 050-95-25"));
        assertEquals("79990509525", CallLogPolicy.normalizeNumber("9990509525"));
        assertEquals("", CallLogPolicy.normalizeNumber("95-25"));
        assertEquals("", CallLogPolicy.normalizeNumber("Скрытый номер"));
    }
}
