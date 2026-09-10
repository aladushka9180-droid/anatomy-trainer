package ru.primetime.pro.calls;

import java.net.URI;
import java.util.Locale;

final class CallLogPolicy {
    static final String START_URL = "https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/provider.html";
    private static final String TRUSTED_HOST = "aladushka9180-droid.github.io";
    private static final String TRUSTED_PATH = "/anatomy-trainer/minuta-online-booking/";

    private CallLogPolicy() {}

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
                    && TRUSTED_HOST.equals(host.toLowerCase(Locale.ROOT))
                    && uri.getUserInfo() == null
                    && (port == -1 || port == 443)
                    && path != null
                    && path.startsWith(TRUSTED_PATH);
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    static String normalizeNumber(String value) {
        if (value == null) return "";
        String digits = value.replaceAll("\\D", "");
        if (digits.length() == 11 && digits.charAt(0) == '8') digits = "7" + digits.substring(1);
        if (digits.length() == 10) digits = "7" + digits;
        return digits.length() >= 11 && digits.length() <= 15 && digits.charAt(0) != '0' ? digits : "";
    }
}
