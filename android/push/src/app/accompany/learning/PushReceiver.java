package app.accompany.learning;
import android.content.Context;
import android.content.Intent;
import com.alibaba.sdk.android.push.MessageReceiver;
import com.alibaba.sdk.android.push.notification.CPushMessage;
import java.util.Map;
import org.json.JSONObject;
public final class PushReceiver extends MessageReceiver {
    @Override protected void onNotification(Context c, String title, String summary, Map<String,String> extras) { }
    @Override protected void onMessage(Context c, CPushMessage message) { }
    @Override protected void onNotificationRemoved(Context c, String id) { }
    @Override protected void onNotificationOpened(Context c, String title, String summary, String extra) {
        Intent intent = new Intent(c, MainActivity.class);
        try { JSONObject map = new JSONObject(extra); intent.putExtra("c9_push_task", map.optString("taskId")); intent.putExtra("c9_push_role", map.optString("targetRole")); } catch (Exception ignored) { }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP); c.startActivity(intent);
    }
    @Override protected void onNotificationClickedWithNoAction(Context c, String title, String summary, String extra) { onNotificationOpened(c, title, summary, extra); }
    @Override protected void onNotificationReceivedInApp(Context c, String title, String summary, Map<String,String> extras, int type, String activity, String url) { }
}
