package app.accompany.learning;

import android.app.Application;

public final class PushApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        PushRuntime.initialize(this);
    }
}
