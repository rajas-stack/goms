package com.gorms.app;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/** Hands a file GOMS saved on the phone to an app that can edit it (Word for .docx, PowerPoint for .pptx, ...).
 *  ACTION_VIEW with the MIME type, so Android only offers apps registered for that file type. */
@CapacitorPlugin(name = "FileOpener")
public class FileOpenerPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        String mimeType = call.getString("mimeType");
        if (path == null || mimeType == null) {
            call.reject("path and mimeType are required");
            return;
        }
        try {
            File file = new File(Uri.parse(path).getPath());
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent view = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, mimeType)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            // The chooser shows Android's own "No apps can perform this action" when nothing is installed for the type.
            getActivity().startActivity(Intent.createChooser(view, "Open with"));
            call.resolve();
        } catch (IllegalArgumentException e) {
            call.reject("This file is outside the folder GOMS can share.");
        }
    }
}
