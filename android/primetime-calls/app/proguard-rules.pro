# The JavaScript bridge methods must keep their annotated names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
