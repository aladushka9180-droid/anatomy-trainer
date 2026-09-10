# PrimeTime для Android

Компактная Android-оболочка открывает опубликованный клиентский сайт PrimeTime. Переходы на внешние сайты передаются системному браузеру.

## Сборка

Требуются JDK 17, Android SDK 35 и Gradle 8.10.2:

```text
gradle testDebugUnitTest lintDebug assembleDebug
```

Устанавливаемый APK: `app/build/outputs/apk/debug/app-debug.apk`.
