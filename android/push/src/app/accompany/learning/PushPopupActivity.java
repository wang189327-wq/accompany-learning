package app.accompany.learning;
import android.content.Intent;
import com.alibaba.sdk.android.push.AndroidPopupActivity;
import java.util.Map;
public final class PushPopupActivity extends AndroidPopupActivity {
    @Override protected void onSysNoticeOpened(String title, String summary, Map<String,String> extras) {
        Intent intent = new Intent(this, MainActivity.class);
        if (extras != null) { intent.putExtra("c9_push_task", extras.get("taskId")); intent.putExtra("c9_push_role", extras.get("targetRole")); }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent); finish();
    }
    @Override public void onNotPushData(Intent intent) { startActivity(new Intent(this, MainActivity.class)); finish(); }
    @Override public void onParseFailed(Intent intent) { startActivity(new Intent(this, MainActivity.class)); finish(); }
}
