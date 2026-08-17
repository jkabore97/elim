package com.elim.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (getBridge() != null && getBridge().getWebView() != null) {
            // Allows playback to resume from lock-screen / notification-shade
            // controls without needing a fresh in-app tap.
            getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        // Capacitor's BridgeActivity pauses the WebView on its way through
        // super.onPause(), which suspends JS timers AND any playing media -
        // that is what silently stops a sermon the moment the app is
        // backgrounded. Immediately resuming the WebView (and its timers)
        // afterwards keeps audio alive while the app is minimized.
        //
        // Note: this does NOT override audio focus. When a phone call takes
        // exclusive audio focus, Android still pauses playback - that is
        // intended OS behaviour and not something an app can or should
        // fight. See onResume below for what happens after the call ends.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().onResume();
            getBridge().getWebView().resumeTimers();
        }
    }
}
