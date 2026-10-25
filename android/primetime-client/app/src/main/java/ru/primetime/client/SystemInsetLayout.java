package ru.primetime.client;

import android.content.Context;
import android.graphics.Insets;
import android.os.Build;
import android.view.WindowInsets;
import android.widget.FrameLayout;

/** Keeps the WebView above navigation controls in Android 15's edge-to-edge window. */
final class SystemInsetLayout extends FrameLayout {
    SystemInsetLayout(Context context) {
        super(context);
    }

    @Override
    public WindowInsets onApplyWindowInsets(WindowInsets insets) {
        // Older Android versions already fit the activity inside the system bars.
        if (Build.VERSION.SDK_INT < 35) return super.onApplyWindowInsets(insets);

        int excludedTypes = WindowInsets.Type.navigationBars() | WindowInsets.Type.ime();
        Insets excluded = insets.getInsets(excludedTypes);
        setPadding(excluded.left, 0, excluded.right, excluded.bottom);
        // The native container owns these insets; do not apply them again in WebView.
        return new WindowInsets.Builder(insets)
                .setInsets(excludedTypes, Insets.NONE)
                .build();
    }
}
