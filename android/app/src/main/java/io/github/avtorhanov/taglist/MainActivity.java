package io.github.avtorhanov.taglist;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.os.ext.SdkExtensions;
import android.provider.ContactsContract;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.text.InputType;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Tag list для Android: веб-приложение из assets/www в WebView.
 *
 * Сеть: страница открывается с локального «адреса» https://appassets.androidplatform.net/
 * (файлы отдаются из APK, в интернет запрос не уходит). Наружу разрешён только
 * https://api.ocr.space/ — распознавание тегов на фото. Любые другие адреса блокируются.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/index.html";
    static final String[] ALLOWED_REMOTE_HOSTS = {"api.ocr.space"};

    static final int RC_FILE = 101;
    static final int RC_CAMERA = 102;
    static final int RC_SAVE = 103;
    static final int RC_CONTACT = 104; // v102: выбор исполнителя для отчёта из контактов
    // v114: разрешение камеры. С объявленным CAMERA системная камера (ACTION_IMAGE_CAPTURE) тоже
    // требует выданного разрешения, поэтому оно запрашивается и перед ней.
    static final int RC_PERM_CAMERA = 105; // системная камера (OCR, снимок к тегу)
    static final int RC_PERM_WEBCAM = 106; // камера внутри страницы (серийная съёмка фото к тегу)
    PermissionRequest pendingWebPermission;
    static final long MAX_OPEN_BYTES = 10L * 1024 * 1024;

    static final String STATE_PENDING_SAVE = "taglist.pendingSavePath";

    WebView web;
    // v107: язык системных окон и уведомлений — как у интерфейса (кнопка RU/EN, AndroidApp.setLanguage).
    volatile boolean langEn;
    ValueCallback<Uri[]> fileCallback;
    // v121: выбор только картинок — результат готовится в фоне (уменьшение до ~8 Мп, поворот по EXIF).
    boolean fileImagesOnly;
    static final int PICK_IMAGES_MAX = 9;           // как OCR_BATCH_MAX в js/app.js
    static final long PICK_STORE_PIXELS = 8_000_000L; // как OCR_STORE_PIXELS в js/app.js
    static final String PICK_DIR = "pick";
    Uri cameraUri;
    File cameraFile;
    // Содержимое файла, ожидающее выбора места сохранения. Дублируется во временный
    // файл: если Android выгрузит приложение, пока открыт системный диалог
    // «Сохранить», данные не потеряются и документ не останется пустым.
    byte[] pendingSaveBytes;
    File pendingSaveFile;
    boolean pageReady;
    String pendingOpenText;
    String pendingOpenName;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        langEn = "en".equals(getSharedPreferences("taglist", MODE_PRIVATE).getString("lang", "ru"));
        cleanupCache("share", 24L * 3600 * 1000);
        cleanupCache("camera", 24L * 3600 * 1000);
        cleanupCache("save", 24L * 3600 * 1000);
        cleanupCache(PICK_DIR, 24L * 3600 * 1000);
        if (savedInstanceState != null) {
            String path = savedInstanceState.getString(STATE_PENDING_SAVE);
            if (path != null) {
                File f = new File(path);
                if (f.isFile()) pendingSaveFile = f;
            }
        }
        // v99: при запуске — цвет заставки; тему приложения затем выставляет страница (setThemeColor).
        applySystemBars("#0B1728", false);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1728"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // нужно, чтобы WebView прочитал выбранный файл/снимок (content://)
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100); // размер шрифта меняется кнопками A−/A+ в самом приложении
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(false); // не обращаться к Google Safe Browsing
        s.setUserAgentString(s.getUserAgentString() + " TagListAndroid/" + versionName());

        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            // Скачивание обрабатывается в JS (Bridge.saveBase64).
        });

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
        handleIncomingIntent(getIntent());
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    @Override
    protected void onPause() {
        if (web != null) web.evaluateJavascript("try{flushSave()}catch(e){}", null);
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
        if (pendingSaveFile != null) outState.putString(STATE_PENDING_SAVE, pendingSaveFile.getAbsolutePath());
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("AndroidApp");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript("(function(){try{return window.__tagListBack&&window.__tagListBack()?'1':'0'}catch(e){return '0'}})()", value -> {
            if (!"\"1\"".equals(value)) moveTaskToBack(true);
        });
    }

    // ---------------------------------------------------------------- local "server" + network allowlist

    class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
            if (("https".equals(scheme) || "http".equals(scheme)) && HOST.equals(host)) {
                return serveAsset(u);
            }
            if ("https".equals(scheme) && isAllowedRemote(host)) {
                return null; // OCR — обычный сетевой запрос
            }
            if ("data".equals(scheme) || "blob".equals(scheme)) return null;
            return blocked();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
            if (HOST.equals(host)) return false;
            // Внешние ссылки внутри приложения не открываются (приложение работает офлайн).
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            pageReady = true;
            deliverPendingOpen();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // Движок WebView упал (нехватка памяти) — пересоздаём экран, данные в localStorage сохраняются.
            if (web != null) {
                ((android.view.ViewGroup) web.getParent()).removeView(web);
                web.destroy();
                web = null;
            }
            recreate();
            return true;
        }
    }

    static boolean isAllowedRemote(String host) {
        for (String h : ALLOWED_REMOTE_HOSTS) if (h.equals(host)) return true;
        return false;
    }

    WebResourceResponse blocked() {
        Map<String, String> h = new HashMap<>();
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", h,
                new ByteArrayInputStream(new byte[0]));
    }

    WebResourceResponse serveAsset(Uri u) {
        String path = u.getEncodedPath();
        try {
            path = path == null ? "/" : URLDecoder.decode(path.replace("+", "%2B"), "UTF-8");
        } catch (Exception e) {
            path = "/";
        }
        if (path.isEmpty() || "/".equals(path)) path = "/index.html";
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        if (path.contains("..") || path.contains("\\")) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
        }
        try {
            InputStream in = getAssets().open("www" + path);
            String mime = mimeFor(path);
            String enc = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json") ? "utf-8" : null;
            return new WebResourceResponse(mime, enc, 200, "OK", h, in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", h, new ByteArrayInputStream(new byte[0]));
        }
    }

    static String mimeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- file chooser, camera, JS dialogs

    class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;

            boolean imagesOnly = true;
            String[] accept = params.getAcceptTypes();
            boolean anyAccept = false;
            if (accept != null) {
                for (String a : accept) {
                    if (a == null || a.trim().isEmpty()) continue;
                    anyAccept = true;
                    for (String part : a.split(",")) {
                        String t = part.trim().toLowerCase(Locale.ROOT);
                        if (!t.isEmpty() && !t.startsWith("image/")) imagesOnly = false;
                    }
                }
            }
            if (!anyAccept) imagesOnly = false;

            if (imagesOnly && params.isCaptureEnabled()) {
                if (!hasCameraPermission()) {
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, RC_PERM_CAMERA);
                    return true; // камера запустится после ответа (onRequestPermissionsResult)
                }
                if (launchCamera()) return true;
            }

            fileImagesOnly = imagesOnly;
            boolean multiple = params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
            // v121: несколько фото — системный выбор фото Android (Android 13+, а на 11–12 — через
            // обновление Google Play). Он всегда возвращает все отмеченные фото с правом на чтение.
            // Раньше выбор шёл через «Выбрать с помощью…» (ACTION_GET_CONTENT), и часть галерей
            // отдавала доступ только к первому фото — из 9 выбранных добавлялось одно.
            if (imagesOnly && hasSystemPhotoPicker()) {
                Intent pick = new Intent(MediaStore.ACTION_PICK_IMAGES);
                if (multiple) {
                    int max = PICK_IMAGES_MAX;
                    try { max = Math.min(max, MediaStore.getPickImagesMaxLimit()); } catch (Throwable ignored) { }
                    if (max > 1) pick.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, max);
                }
                try {
                    startActivityForResult(pick, RC_FILE);
                    return true;
                } catch (ActivityNotFoundException | SecurityException ignored) {
                    // нет системного выбора фото — обычный выбор ниже
                }
            }
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(imagesOnly ? "image/*" : "*/*");
            if (multiple) {
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(Intent.createChooser(pick, imagesOnly ? tr("Выбери фото", "Choose a photo") : tr("Выбери файл", "Choose a file")), RC_FILE);
            } catch (ActivityNotFoundException e) {
                finishFileChooser(null);
                toast(tr("Не найдено приложение для выбора файла", "No app found to pick a file"));
            }
            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            if (isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            if (isFinishing()) { result.cancel(); return true; }
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton("OK", (d, w) -> result.confirm())
                    .setNegativeButton(tr("Отмена", "Cancel"), (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            if (isFinishing()) { result.cancel(); return true; }
            final EditText input = new EditText(MainActivity.this);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            input.setText(defaultValue == null ? "" : defaultValue);
            input.setSelectAllOnFocus(true);
            int pad = (int) (20 * getResources().getDisplayMetrics().density);
            android.widget.FrameLayout box = new android.widget.FrameLayout(MainActivity.this);
            box.setPadding(pad, pad / 2, pad, 0);
            box.addView(input);
            new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setView(box)
                    .setPositiveButton("OK", (d, w) -> result.confirm(input.getText().toString()))
                    .setNegativeButton(tr("Отмена", "Cancel"), (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .show();
            return true;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // v114: странице приложения разрешена только камера (серийная съёмка фото к тегу). Микрофон — нет.
            runOnUiThread(() -> {
                String host = request.getOrigin() == null ? "" : String.valueOf(request.getOrigin().getHost());
                boolean video = false;
                for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) video = true;
                if (!video || !HOST.equals(host)) { request.deny(); return; }
                if (hasCameraPermission()) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    if (pendingWebPermission != null) pendingWebPermission.deny();
                    pendingWebPermission = request;
                    requestPermissions(new String[]{Manifest.permission.CAMERA}, RC_PERM_WEBCAM);
                }
            });
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            return false;
        }
    }

    boolean hasCameraPermission() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (requestCode == RC_PERM_CAMERA) {
            if (!(granted && launchCamera())) {
                finishFileChooser(null);
                if (!granted) toast(tr("Нет разрешения на камеру", "No camera permission"));
            }
        } else if (requestCode == RC_PERM_WEBCAM) {
            PermissionRequest r = pendingWebPermission;
            pendingWebPermission = null;
            if (r == null) return;
            if (granted) r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else r.deny();
        }
    }

    boolean launchCamera() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) return false;
            String name = "photo-" + System.currentTimeMillis() + ".jpg";
            cameraFile = new File(dir, name);
            cameraUri = ShareProvider.uriFor(getPackageName() + ".share", "camera", name);
            Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            cam.setClipData(ClipData.newRawUri("photo", cameraUri));
            cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(cam, RC_CAMERA);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            cameraUri = null;
            cameraFile = null;
            return false;
        }
    }

    static boolean hasSystemPhotoPicker() {
        if (Build.VERSION.SDK_INT >= 33) return true;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                return SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R) >= 2;
            } catch (Throwable ignored) {
                return false;
            }
        }
        return false;
    }

    /**
     * v121: выбранные фото готовятся в фоне, по одному: уменьшение до ~8 Мп, поворот по EXIF, JPEG
     * в cache/pick. Страница получает уже лёгкие файлы — 9 снимков по 50 Мп больше не читаются и не
     * раскодируются целиком внутри WebView (долгая загрузка, нехватка памяти). Если фото не удалось
     * раскодировать (редкий формат), странице уходит исходный адрес — как раньше.
     */
    void prepareImagesAsync(final Uri[] picked) {
        final int n = picked.length;
        if (web != null) web.evaluateJavascript("window.__tagListPhotosPreparing&&window.__tagListPhotosPreparing(" + n + ")", null);
        new Thread(() -> {
            Uri[] out = new Uri[n];
            File dir = new File(getCacheDir(), PICK_DIR);
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            long stamp = System.currentTimeMillis();
            for (int i = 0; i < n; i++) {
                Uri prepared = null;
                try {
                    prepared = prepareImage(picked[i], dir, "photo-" + stamp + "-" + (i + 1) + ".jpg");
                } catch (Throwable e) { // OutOfMemoryError тоже: тогда фото уходит как есть
                    prepared = null;
                }
                out[i] = prepared != null ? prepared : picked[i];
            }
            runOnUiThread(() -> finishFileChooser(out));
        }, "pick-images").start();
    }

    Uri prepareImage(Uri src, File dir, String name) throws IOException {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        try (InputStream in = getContentResolver().openInputStream(src)) {
            if (in == null) return null;
            BitmapFactory.decodeStream(in, null, bounds);
        }
        int w = bounds.outWidth, h = bounds.outHeight;
        if (w <= 0 || h <= 0) return null;

        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try (InputStream in = getContentResolver().openInputStream(src)) {
            if (in != null) orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (Exception ignored) { }

        // Раскодировать с прореживанием (степень двойки) не меньше нужного, затем уменьшить точно.
        int sample = 1;
        while ((long) (w / (sample * 2)) * (h / (sample * 2)) >= PICK_STORE_PIXELS) sample *= 2;
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap bmp;
        try (InputStream in = getContentResolver().openInputStream(src)) {
            if (in == null) return null;
            bmp = BitmapFactory.decodeStream(in, null, opts);
        }
        if (bmp == null) return null;

        Matrix m = new Matrix();
        double k = Math.min(1.0, Math.sqrt((double) PICK_STORE_PIXELS / ((double) bmp.getWidth() * bmp.getHeight())));
        if (k < 1.0) m.postScale((float) k, (float) k);
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: m.postRotate(90); break;
            case ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); break;
            case ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: m.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: m.postScale(1, -1); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: m.postRotate(90); m.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: m.postRotate(270); m.postScale(-1, 1); break;
            default: break;
        }
        if (!m.isIdentity()) {
            Bitmap t = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (t != bmp) bmp.recycle();
            bmp = t;
        }
        // Прозрачный PNG (скриншот) — на белом фоне, иначе в JPEG прозрачное станет чёрным.
        if (bmp.hasAlpha()) {
            Bitmap white = Bitmap.createBitmap(bmp.getWidth(), bmp.getHeight(), Bitmap.Config.ARGB_8888);
            android.graphics.Canvas c = new android.graphics.Canvas(white);
            c.drawColor(Color.WHITE);
            c.drawBitmap(bmp, 0, 0, null);
            bmp.recycle();
            bmp = white;
        }
        File f = new File(dir, name);
        boolean ok;
        try (OutputStream os = new FileOutputStream(f)) {
            ok = bmp.compress(Bitmap.CompressFormat.JPEG, 92, os);
        } finally {
            bmp.recycle();
        }
        if (!ok || f.length() == 0) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
            return null;
        }
        return ShareProvider.uriFor(getPackageName() + ".share", PICK_DIR, name);
    }

    void finishFileChooser(Uri[] result) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == RC_CAMERA) {
            boolean ok = resultCode == RESULT_OK && cameraFile != null && cameraFile.length() > 0;
            finishFileChooser(ok ? new Uri[]{cameraUri} : null);
        } else if (requestCode == RC_FILE) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null && data.getClipData().getItemCount() > 0) {
                    ArrayList<Uri> list = new ArrayList<>();
                    for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                        Uri item = data.getClipData().getItemAt(i).getUri();
                        if (item != null) list.add(item);
                    }
                    result = list.toArray(new Uri[0]);
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            if (result != null && result.length > 0 && fileImagesOnly) {
                prepareImagesAsync(result);
                return;
            }
            finishFileChooser(result);
        } else if (requestCode == RC_CONTACT) {
            // v102: имя выбранного контакта уходит в окно «Отчёт» (исполнители).
            // ACTION_PICK даёт временный доступ только к выбранному контакту — разрешение READ_CONTACTS не нужно.
            final Uri contact = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
            if (contact == null || web == null) return;
            String name = null;
            try (Cursor c = getContentResolver().query(contact, new String[]{ContactsContract.Contacts.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) name = c.getString(0);
            } catch (Exception ignored) {
            }
            if (name == null || name.trim().isEmpty()) {
                jsToast(tr("Не удалось прочитать имя контакта", "Could not read the contact name"));
                return;
            }
            web.evaluateJavascript("window.__tagListContactPicked&&window.__tagListContactPicked(" + JSONObject.quote(name.trim()) + ")", null);
        } else if (requestCode == RC_SAVE) {
            final byte[] memory = pendingSaveBytes;
            final File stored = pendingSaveFile;
            pendingSaveBytes = null;
            pendingSaveFile = null;
            final Uri target = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
            if (target == null) {
                deleteQuietly(stored); // пользователь отменил сохранение
                return;
            }
            // Запись — в фоне: большой JSON и облачные папки не подвешивают экран.
            new Thread(() -> {
                byte[] bytes = memory;
                if (bytes == null && stored != null) {
                    try {
                        bytes = readFile(stored);
                    } catch (IOException ignored) {
                        bytes = null;
                    }
                }
                deleteQuietly(stored);
                if (bytes == null) {
                    // Данные потеряны вместе с процессом — не оставляем пустой файл.
                    deleteDocumentQuietly(target);
                    jsToast(tr("Сохранение прервано системой. Нажми «Сохранить» ещё раз.", "Saving was interrupted by the system. Tap “Save” again."));
                    return;
                }
                int result = writeDocument(target, bytes);
                if (result == WRITE_OK) {
                    jsToast(tr("Файл сохранён", "File saved"));
                } else if (result == WRITE_UNVERIFIED) {
                    jsToast(tr("Файл записан, но папка не подтвердила размер. Проверь файл или используй «Отправить».", "File written, but the folder did not confirm its size. Check the file or use “Send”."));
                } else {
                    deleteDocumentQuietly(target);
                    jsToast(tr("Не удалось записать файл в эту папку. Выбери другую (например, «Загрузки») или используй «Отправить».", "Could not write the file to this folder. Choose another (e.g. Downloads) or use “Send”."));
                }
            }).start();
        }
    }

    static final int WRITE_OK = 0;
    static final int WRITE_UNVERIFIED = 1;
    static final int WRITE_FAILED = 2;

    /**
     * Записывает данные в документ, выбранный через системный диалог «Сохранить».
     * Разные хранилища поддерживают разные режимы: «wt» (с обрезкой) есть не везде,
     * «w» на Android 10+ не обрезает файл, но новый документ и так пуст.
     * После записи сверяем размер: 0 байт при непустых данных = запись не удалась.
     */
    int writeDocument(Uri uri, byte[] bytes) {
        boolean written = false;
        for (String mode : new String[]{"wt", "w", "rwt"}) {
            try {
                try (OutputStream out = getContentResolver().openOutputStream(uri, mode)) {
                    if (out == null) continue;
                    out.write(bytes);
                    out.flush();
                    if (out instanceof FileOutputStream) {
                        try {
                            ((FileOutputStream) out).getFD().sync();
                        } catch (Exception ignored) {
                        }
                    }
                }
                written = true;
                long size = documentSize(uri);
                if (size < 0 || size == bytes.length || bytes.length == 0) return WRITE_OK;
                // Хранилище сообщило другой размер — пробуем следующий режим записи.
            } catch (Exception ignored) {
                // Режим не поддерживается этим хранилищем — пробуем следующий.
            }
        }
        return written ? WRITE_UNVERIFIED : WRITE_FAILED;
    }

    long documentSize(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
        } catch (Exception ignored) {
        }
        return -1;
    }

    void deleteDocumentQuietly(Uri uri) {
        try {
            DocumentsContract.deleteDocument(getContentResolver(), uri);
        } catch (Exception ignored) {
        }
    }

    static void deleteQuietly(File f) {
        if (f != null && f.exists()) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    static byte[] readFile(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) Math.max(0, Math.min(f.length(), MAX_OPEN_BYTES)));
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    // ---------------------------------------------------------------- JS bridge (window.AndroidApp)

    class Bridge {
        @JavascriptInterface
        public boolean shareFile(String name, String mime, String text, String title) {
            return shareBytes(name, mime, text == null ? new byte[0] : text.getBytes(StandardCharsets.UTF_8), title, null);
        }

        @JavascriptInterface
        public boolean shareBase64(String name, String mime, String base64, String title, String text) {
            try {
                return shareBytes(name, mime, Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT), title, text);
            } catch (IllegalArgumentException e) {
                return false;
            }
        }

        // v113: несколько фото отчёта одним «Поделиться». json — массив {name, mime, data (base64)}.
        // Фото кладутся в cache/share и отдаются через ShareProvider, как и одиночный файл.
        @JavascriptInterface
        public boolean shareFiles(String title, String text, String json) {
            try {
                JSONArray list = new JSONArray(json == null ? "[]" : json);
                File dir = new File(getCacheDir(), "share");
                if (!dir.exists() && !dir.mkdirs()) return false;
                ArrayList<Uri> uris = new ArrayList<>();
                String mime = null;
                for (int i = 0; i < list.length() && i < 30; i++) {
                    JSONObject o = list.getJSONObject(i);
                    String fileName = safeName(o.optString("name", "file"), "file");
                    byte[] bytes = Base64.decode(o.optString("data", ""), Base64.DEFAULT);
                    try (FileOutputStream out = new FileOutputStream(new File(dir, fileName))) {
                        out.write(bytes);
                    }
                    uris.add(ShareProvider.uriFor(getPackageName() + ".share", "share", fileName));
                    String m = o.optString("mime", "application/octet-stream");
                    mime = (mime == null || mime.equals(m)) ? m : "*/*";
                }
                if (uris.isEmpty()) return false;
                Intent send = new Intent(uris.size() > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND);
                send.setType(mime == null ? "*/*" : mime);
                if (uris.size() > 1) send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                else send.putExtra(Intent.EXTRA_STREAM, uris.get(0));
                ClipData clip = ClipData.newRawUri("photos", uris.get(0));
                for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
                send.setClipData(clip);
                if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
                if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                return startChooser(send, title);
            } catch (org.json.JSONException | IOException | IllegalArgumentException e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean shareText(String title, String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
            if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            return startChooser(send, title);
        }

        @JavascriptInterface
        public void saveFile(String name, String mime, String text) {
            requestSave(name, mime, text == null ? new byte[0] : text.getBytes(StandardCharsets.UTF_8));
        }

        @JavascriptInterface
        public void saveBase64(String name, String mime, String base64) {
            try {
                requestSave(name, mime, Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT));
            } catch (IllegalArgumentException e) {
                jsToast(tr("Не удалось сохранить файл", "Could not save the file"));
            }
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip() || cm.getPrimaryClip() == null) return "";
                ClipData clip = cm.getPrimaryClip();
                if (clip.getItemCount() == 0) return "";
                CharSequence t = clip.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        // v102: системный выбор контакта (окно «Отчёт» → «+ Из контактов»).
        @JavascriptInterface
        public boolean pickContact() {
            runOnUiThread(() -> {
                try {
                    startActivityForResult(new Intent(Intent.ACTION_PICK, ContactsContract.Contacts.CONTENT_URI), RC_CONTACT);
                } catch (ActivityNotFoundException e) {
                    jsToast(tr("На телефоне нет приложения «Контакты» — впишите имя вручную", "No Contacts app on the phone — type the name"));
                }
            });
            return true;
        }

        @JavascriptInterface
        public void setThemeColor(String hex, boolean light) {
            runOnUiThread(() -> applySystemBars(hex, light));
        }

        @JavascriptInterface
        public void ready() {
            runOnUiThread(() -> {
                pageReady = true;
                deliverPendingOpen();
            });
        }

        @JavascriptInterface
        public String appVersion() {
            return versionName();
        }

        // v107: язык интерфейса (кнопка RU/EN) — для системных окон и уведомлений приложения.
        @JavascriptInterface
        public void setLanguage(String lang) {
            langEn = "en".equals(lang);
            getSharedPreferences("taglist", MODE_PRIVATE).edit().putString("lang", langEn ? "en" : "ru").apply();
        }
    }

    static String safeName(String name, String fallback) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-").trim();
        if (n.isEmpty() || n.startsWith(".")) n = fallback + n;
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n;
    }

    boolean shareBytes(String name, String mime, byte[] bytes, String title, String text) {
        try {
            File dir = new File(getCacheDir(), "share");
            if (!dir.exists() && !dir.mkdirs()) return false;
            String fileName = safeName(name, "file");
            File f = new File(dir, fileName);
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(bytes);
            }
            Uri uri = ShareProvider.uriFor(getPackageName() + ".share", "share", fileName);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
            if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text);
            send.setClipData(ClipData.newRawUri(fileName, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return startChooser(send, title);
        } catch (IOException e) {
            return false;
        }
    }

    boolean startChooser(Intent send, String title) {
        final Intent chooser = Intent.createChooser(send, title == null || title.isEmpty() ? tr("Отправить", "Send") : title);
        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        runOnUiThread(() -> {
            try {
                startActivity(chooser);
            } catch (ActivityNotFoundException e) {
                toast(tr("Нет приложений для отправки", "No apps to send with"));
            }
        });
        return true;
    }

    void requestSave(String name, String mime, byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            jsToast(tr("Нет данных для сохранения", "No data to save"));
            return;
        }
        // Копия на диске переживёт выгрузку приложения, пока открыт системный диалог.
        File stored = null;
        try {
            File dir = new File(getCacheDir(), "save");
            if (dir.exists() || dir.mkdirs()) {
                stored = new File(dir, "pending-" + System.currentTimeMillis() + ".bin");
                try (FileOutputStream out = new FileOutputStream(stored)) {
                    out.write(bytes);
                }
            }
        } catch (IOException e) {
            deleteQuietly(stored);
            stored = null; // остаётся копия в памяти
        }
        final File pendingFile = stored;
        runOnUiThread(() -> {
            deleteQuietly(pendingSaveFile); // предыдущий незавершённый запрос
            pendingSaveBytes = bytes;
            pendingSaveFile = pendingFile;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
            i.putExtra(Intent.EXTRA_TITLE, safeName(name, "file"));
            try {
                startActivityForResult(i, RC_SAVE);
            } catch (ActivityNotFoundException e) {
                pendingSaveBytes = null;
                deleteQuietly(pendingSaveFile);
                pendingSaveFile = null;
                toast(tr("Не найдено приложение для сохранения файлов", "No app found to save files"));
            }
        });
    }

    // ---------------------------------------------------------------- open .json from other apps

    void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Parcelable p = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (p instanceof Uri) uri = (Uri) p;
        }
        if (uri == null) return;
        final Uri source = uri;
        new Thread(() -> {
            try {
                String name = displayName(source);
                String text = readText(source);
                runOnUiThread(() -> {
                    pendingOpenText = text;
                    pendingOpenName = name;
                    deliverPendingOpen();
                });
            } catch (Exception e) {
                runOnUiThread(() -> toast(tr("Не удалось открыть файл", "Could not open the file")));
            }
        }).start();
        // Не обрабатывать тот же файл повторно при пересоздании экрана.
        intent.setAction(Intent.ACTION_MAIN);
        intent.setData(null);
    }

    void deliverPendingOpen() {
        if (!pageReady || web == null || pendingOpenText == null) return;
        String js = "window.__tagListOpenState&&window.__tagListOpenState(" + JSONObject.quote(pendingOpenText)
                + "," + JSONObject.quote(pendingOpenName == null ? "state.json" : pendingOpenName) + ")";
        pendingOpenText = null;
        pendingOpenName = null;
        web.evaluateJavascript(js, null);
    }

    String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "state.json" : last;
    }

    String readText(Uri uri) throws IOException {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            if (in == null) throw new IOException("no stream");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_OPEN_BYTES) throw new IOException("too large");
                out.write(buf, 0, n);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    // ---------------------------------------------------------------- helpers

    @SuppressWarnings("deprecation")
    void applySystemBars(String hex, boolean light) {
        int color;
        try {
            color = Color.parseColor(hex);
        } catch (Exception e) {
            color = Color.parseColor("#F5F7FA");
        }
        Window w = getWindow();
        w.setStatusBarColor(color);
        w.setNavigationBarColor(color);
        View decor = w.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= 26) {
            if (light) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
        if (web != null) web.setBackgroundColor(color);
    }

    void cleanupCache(String dirName, long maxAgeMs) {
        File dir = new File(getCacheDir(), dirName);
        File[] files = dir.listFiles();
        if (files == null) return;
        long now = System.currentTimeMillis();
        for (File f : files) {
            if (now - f.lastModified() > maxAgeMs) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    String versionName() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return pi.versionName == null ? "1" : pi.versionName;
        } catch (Exception e) {
            return "1";
        }
    }

    String tr(String ru, String en) {
        return langEn ? en : ru;
    }

    void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    void jsToast(String msg) {
        runOnUiThread(() -> {
            // Пока страница загружается (например, после пересоздания экрана), JS-уведомление
            // может потеряться — показываем системное.
            if (web != null && pageReady) web.evaluateJavascript("try{showToast(" + JSONObject.quote(msg) + ")}catch(e){}", null);
            else Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        });
    }
}
