package io.github.avtorhanov.taglist;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/**
 * Минимальный провайдер файлов (замена androidx FileProvider без сторонних библиотек).
 * Отдаёт файлы из cache/share (для «Поделиться») и cache/camera (снимок для OCR).
 * content://<applicationId>.share/<папка>/<имя файла>
 */
public class ShareProvider extends ContentProvider {

    static final String[] ALLOWED_DIRS = {"share", "camera"};

    @Override
    public boolean onCreate() {
        return true;
    }

    static Uri uriFor(String authority, String dir, String name) {
        return new Uri.Builder().scheme("content").authority(authority)
                .appendPath(dir).appendPath(name).build();
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        if (getContext() == null || uri.getPathSegments().size() != 2) throw new FileNotFoundException(String.valueOf(uri));
        String dir = uri.getPathSegments().get(0);
        String name = uri.getPathSegments().get(1);
        boolean allowed = false;
        for (String d : ALLOWED_DIRS) if (d.equals(dir)) allowed = true;
        if (!allowed || name.contains("/") || name.contains("..")) throw new FileNotFoundException(String.valueOf(uri));
        File base = new File(getContext().getCacheDir(), dir);
        File f = new File(base, name);
        try {
            if (!f.getCanonicalPath().startsWith(base.getCanonicalPath() + File.separator)) throw new FileNotFoundException(String.valueOf(uri));
        } catch (IOException e) {
            throw new FileNotFoundException(String.valueOf(uri));
        }
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        int m = ParcelFileDescriptor.parseMode(mode);
        if ((m & ParcelFileDescriptor.MODE_WRITE_ONLY) != 0 || (m & ParcelFileDescriptor.MODE_READ_WRITE) != 0) {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            m |= ParcelFileDescriptor.MODE_CREATE;
        }
        return ParcelFileDescriptor.open(f, m);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public String getType(Uri uri) {
        String name = uri.getLastPathSegment() == null ? "" : uri.getLastPathSegment();
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            String ext = name.substring(dot + 1).toLowerCase();
            if ("json".equals(ext)) return "application/json";
            String t = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
            if (t != null) return t;
        }
        return "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
