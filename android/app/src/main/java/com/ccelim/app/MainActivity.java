package com.ccelim.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Lets media start without requiring a separate user gesture per
        // element, which matters for resuming playback from lock-screen /
        // notification-shade controls (registered via MediaSession on the web
        // side - see src/mediaSession.ts).
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }
}
