package ru.primetime.client;

import java.net.URI;
import java.util.Locale;

final class NavigationPolicy {
    static final String START_URL = "https://primetime-booking.primetime-booking-ru.workers.dev/";
    private static final String PRIMARY_HOST = "primetime-booking.primetime-booking-ru.workers.dev";
    private static final String LEGACY_HOST = "primetime-booking.aladushka9180.chatgpt.site";

    private NavigationPolicy() {}

    static boolean isTrustedUrl(String value) {
        if (value == null || value.isBlank()) return false;
        try {
            URI uri = URI.create(value).normalize();
            String scheme = uri.getScheme();
            String host = uri.getHost();
            String path = uri.getPath();
            int port = uri.getPort();
            return "https".equalsIgnoreCase(scheme)
                    && host != null
                    && isTrustedHost(host.toLowerCase(Locale.ROOT))
                    && uri.getUserInfo() == null
                    && (port == -1 || port == 443)
                    && path != null
                    && path.startsWith("/");
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private static boolean isTrustedHost(String host) {
        return PRIMARY_HOST.equals(host) || LEGACY_HOST.equals(host);
    }
}
