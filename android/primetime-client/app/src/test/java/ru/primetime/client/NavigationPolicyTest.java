package ru.primetime.client;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NavigationPolicyTest {
    @Test
    public void trustsOnlyPrimeTimeProductionHosts() {
        assertTrue(NavigationPolicy.isTrustedUrl(NavigationPolicy.START_URL));
        assertTrue(NavigationPolicy.isTrustedUrl("https://primetime-booking.primetime-booking-ru.workers.dev/favorites"));
        assertTrue(NavigationPolicy.isTrustedUrl("https://primetime-booking.aladushka9180.chatgpt.site/bookings"));
        assertFalse(NavigationPolicy.isTrustedUrl("http://primetime-booking.primetime-booking-ru.workers.dev/"));
        assertFalse(NavigationPolicy.isTrustedUrl("https://primetime-booking.primetime-booking-ru.workers.dev.evil.example/"));
        assertFalse(NavigationPolicy.isTrustedUrl("https://user@primetime-booking.primetime-booking-ru.workers.dev/"));
    }
}
