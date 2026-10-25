package ru.primetime.client;

import static org.junit.Assert.assertEquals;

import android.graphics.Insets;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class SystemInsetLayoutTest {
    private SystemInsetLayout content() {
        SystemInsetLayout content = new SystemInsetLayout(RuntimeEnvironment.getApplication());
        content.addView(new View(content.getContext()), new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        return content;
    }

    private WindowInsets insets(Insets navigation, Insets keyboard) {
        return new WindowInsets.Builder()
                .setInsets(WindowInsets.Type.navigationBars(), navigation)
                .setInsets(WindowInsets.Type.ime(), keyboard)
                .build();
    }

    private void layout(SystemInsetLayout content, int width, int height) {
        content.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
        content.layout(0, 0, width, height);
    }

    @Test
    public void threeButtonNavigationAndGestureNavigationLeaveUsableContentAboveControls() {
        SystemInsetLayout content = content();
        for (int reserved : new int[] {48, 24, 0}) {
            WindowInsets remainder = content.dispatchApplyWindowInsets(
                    insets(Insets.of(0, 0, 0, reserved), Insets.NONE));
            layout(content, 390, 844);
            assertEquals(844 - reserved, content.getChildAt(0).getBottom());
            assertEquals(0, remainder.getInsets(WindowInsets.Type.navigationBars()).bottom);
        }
    }

    @Test
    public void keyboardReservesItsAreaOnceAndRestoresNavigationSpaceOnClose() {
        SystemInsetLayout content = content();
        WindowInsets open = insets(Insets.of(0, 0, 0, 48), Insets.of(0, 0, 0, 320));
        content.dispatchApplyWindowInsets(open);
        content.dispatchApplyWindowInsets(open);
        layout(content, 390, 844);
        assertEquals(524, content.getChildAt(0).getBottom());
        content.dispatchApplyWindowInsets(insets(Insets.of(0, 0, 0, 48), Insets.NONE));
        layout(content, 390, 844);
        assertEquals(796, content.getChildAt(0).getBottom());
    }

    @Test
    public void rotatedNavigationControlsAreExcludedAtTheSide() {
        SystemInsetLayout content = content();
        content.dispatchApplyWindowInsets(insets(Insets.of(0, 0, 48, 0), Insets.NONE));
        layout(content, 844, 390);
        assertEquals(796, content.getChildAt(0).getRight());
        assertEquals(390, content.getChildAt(0).getBottom());
    }

    @Test
    @Config(sdk = 34)
    public void olderAndroidKeepsItsExistingDecorManagedViewport() {
        SystemInsetLayout content = content();
        content.dispatchApplyWindowInsets(insets(Insets.of(0, 0, 0, 48), Insets.NONE));
        layout(content, 390, 844);
        assertEquals(844, content.getChildAt(0).getBottom());
    }
}
