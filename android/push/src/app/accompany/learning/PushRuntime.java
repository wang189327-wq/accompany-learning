package app.accompany.learning;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;
import com.alibaba.sdk.android.push.CommonCallback;
import com.alibaba.sdk.android.push.noonesdk.PushServiceFactory;
import com.alibaba.sdk.android.push.huawei.HuaWeiRegister;
import com.alibaba.sdk.android.push.register.VivoRegister;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.JSONObject;

public final class PushRuntime {
    private static Application application;
    private static final ExecutorService network = Executors.newSingleThreadExecutor();
    private static volatile String status = "尚未启用";
    private static volatile boolean registering;
    private static volatile boolean registered;
    private static volatile boolean vendorRegistrationFailed;
    private static int registrationFailures;
    private static boolean registrationStarted;
    private static SharedPreferences prefs() { return application.getSharedPreferences("c9_system_push", 0); }
    public static void initialize(Application app) {
        application = app;
        if (!BuildConfig.PUSH_CONFIGURED) { status = "推送平台尚未配置"; return; }
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel("c9_messages", "作业消息", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("新作业、提交和截止提醒"); channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
        PushServiceFactory.init(app);
        if (prefs().getBoolean("enabled", false)) register();
    }
    // The SDK retries registration itself. Only reset after its terminal failure;
    // a cached device ID must not be mistaken for a registered current process.
    private static synchronized void register() {
        if (!BuildConfig.PUSH_CONFIGURED || registering) return;
        if (registered) {
            bind(true);
            return;
        }
        if (registrationStarted && registrationFailures < 2) {
            status = "通知通道正在自动重试";
            return;
        }
        if (registrationStarted) PushServiceFactory.getPushControlService().reset();
        registrationStarted = true;
        registrationFailures = 0;
        registering = true;
        status = "正在注册通知通道";
        PushServiceFactory.getCloudPushService().register(application, new CommonCallback() {
            @Override public void onSuccess(String value) {
                synchronized (PushRuntime.class) {
                    registered = true;
                    registering = false;
                    registrationFailures = 0;
                }
                vendorRegistrationFailed = false;
                try {
                    HuaWeiRegister.register(application);
                    if (BuildConfig.VIVO_PUSH_CONFIGURED) VivoRegister.register(application);
                } catch (RuntimeException failure) {
                    vendorRegistrationFailed = true;
                }
                String deviceId = PushServiceFactory.getCloudPushService().getDeviceId();
                if (deviceId == null || deviceId.isEmpty()) {
                    status = "通知通道未返回设备编号，请稍后重启应用";
                    return;
                }
                prefs().edit().putString("deviceId", deviceId).apply();
                bind(true);
            }
            @Override public void onFailed(String code, String message) {
                synchronized (PushRuntime.class) {
                    if ("PUSH_20110".equals(code)) {
                        status = "等待通知SDK完成注册";
                        return;
                    }
                    if (registered) return;
                    registrationFailures++;
                    registering = registrationFailures < 2;
                    status = (registering ? "通知通道正在自动重试" : "通知注册失败，请点启用／重试")
                        + "（" + code + "）";
                }
            }
        });
    }
    public static void install(Activity activity, WebView web) {
        web.addJavascriptInterface(new Bridge(activity), "C9Push");
        JSONObject event = new JSONObject();
        try {
            Intent intent = activity.getIntent();
            if (!intent.hasExtra("c9_push_task")) return;
            event.put("taskId", intent.getStringExtra("c9_push_task"));
            event.put("targetRole", intent.getStringExtra("c9_push_role"));
            activity.getIntent().removeExtra("c9_push_task");
        } catch (Exception ignored) { return; }
        final String payload = event.toString();
        Runnable open = new Runnable() {
            int attempts;
            @Override public void run() {
                if (activity.isFinishing() || attempts++ > 60) return;
                web.evaluateJavascript("typeof C9OpenPush==='function' && C9OpenPush(" + payload + ")", result -> {
                    if (!"true".equals(result)) web.postDelayed(this, 500);
                });
            }
        };
        web.postDelayed(open, 1000);
    }
    private static JSONObject request(boolean enabled) throws Exception {
        SharedPreferences p = prefs();
        String endpoint = p.getString("endpoint", ""), token = p.getString("token", ""), role = p.getString("role", "");
        URI uri = new URI(endpoint);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null)
            throw new IOException("请先保存有效云端连接");
        String installation = p.getString("installation", ""), secret = p.getString("secret", "");
        if (installation.isEmpty()) { installation = UUID.randomUUID().toString(); secret = UUID.randomUUID().toString(); p.edit().putString("installation", installation).putString("secret", secret).apply(); }
        JSONObject body = new JSONObject();
        body.put("installationId", installation); body.put("bindingSecret", secret);
        body.put("deviceId", p.getString("deviceId", "")); body.put("applicationId", application.getPackageName()); body.put("enabled", enabled);
        URL url = new URI("https", null, uri.getHost(), uri.getPort(), "/api/push/devices", null, null).toURL();
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("X-C9-Role", role); connection.setRequestProperty("Content-Type", "application/json");
        try {
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            if (connection.getResponseCode() != 200) throw new IOException("推送绑定失败，请检查云端配置");
            try (InputStream in = connection.getInputStream(); ByteArrayOutputStream responseBytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = in.read(buffer)) != -1) { responseBytes.write(buffer, 0, count); if (responseBytes.size() > 65536) throw new IOException("响应过大"); }
                return new JSONObject(new String(responseBytes.toByteArray(), StandardCharsets.UTF_8));
            }
        } finally { connection.disconnect(); }
    }
    private static void performBinding(boolean enabled) {
            try {
                if (prefs().getString("role", "").isEmpty() || prefs().getString("deviceId", "").isEmpty()) { status = "等待云端连接和角色"; return; }
                JSONObject result = request(enabled);
                if (enabled && !result.optBoolean("configured")) throw new IOException("云端尚未配置推送服务");
                prefs().edit().putBoolean("enabled", enabled).putLong("lastBound", System.currentTimeMillis()).apply(); status = enabled ? (vendorRegistrationFailed ? "本机已绑定，厂商通道注册异常，请检查配置" : "本机推送已绑定") : "本机推送已停止";
            } catch (Exception e) { status = "通知绑定未完成，请检查云端配置和网络后重试"; }
    }
    private static void bind(boolean enabled) {
        network.execute(() -> performBinding(enabled));
    }
    public static final class Bridge {
        private final Activity activity;
        Bridge(Activity activity) { this.activity = activity; }
        @JavascriptInterface public void configure(String endpoint, String token, String role) {
            if (!"teacher".equals(role) && !"student".equals(role)) return;
            network.execute(() -> {
                SharedPreferences p = prefs();
                boolean changed = !endpoint.equals(p.getString("endpoint", "")) || !role.equals(p.getString("role", "")) || !token.equals(p.getString("token", ""));
                // Serialize connection changes so an old queued change cannot unsubscribe a newer binding.
                if (p.getBoolean("enabled", false) && !endpoint.equals(p.getString("endpoint", ""))) {
                    try { request(false); }
                    catch (Exception e) { status = "旧连接推送尚未解除，请联网后重试"; return; }
                }
                p.edit().putString("endpoint", endpoint).putString("token", token).putString("role", role).apply();
                if (p.getBoolean("enabled", false) && (changed || System.currentTimeMillis() - p.getLong("lastBound", 0) > 300000)) {
                    if (!registered) activity.runOnUiThread(PushRuntime::register);
                    else performBinding(true);
                }
            });
        }
        @JavascriptInterface public void openSettings() {
            activity.runOnUiThread(this::showSettings);
        }
        private void showSettings() {
            new AlertDialog.Builder(activity).setTitle("消息通知").setMessage(status + (application.getSystemService(NotificationManager.class).areNotificationsEnabled() ? "" : "\n系统通知权限已关闭") + "\n关闭应用后通知由系统推送通道送达，横幅和锁屏样式取决于系统设置。")
                .setPositiveButton("启用／重试", (dialog, which) -> {
                    if (!BuildConfig.PUSH_CONFIGURED) { Toast.makeText(activity, "请先完成 EMAS 和厂商通道配置后重新构建", Toast.LENGTH_LONG).show(); return; }
                    if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)
                        activity.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 196);
                    prefs().edit().putBoolean("enabled", true).apply(); register();
                }).setNeutralButton("设备／系统设置", (dialog, which) -> new AlertDialog.Builder(activity).setItems(new String[]{"打开系统通知设置", "复制推送设备信息"}, (menu, item) -> {
                    if (item == 0) activity.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.getPackageName()));
                    else {
                        String regId = "未注册";
                        try {
                            Class<?> type = Class.forName("com.vivo.push.PushClient");
                            Object client = type.getMethod("getInstance", Context.class).invoke(null, application);
                            regId = String.valueOf(type.getMethod("getRegId").invoke(client));
                        } catch (Exception ignored) { }
                        String info = "package=" + application.getPackageName() + "\nEMAS deviceId=" + prefs().getString("deviceId", "未注册") + "\nvivo regId=" + regId;
                        android.content.ClipboardManager clipboard = activity.getSystemService(android.content.ClipboardManager.class);
                        clipboard.setPrimaryClip(ClipData.newPlainText("推送设备信息", info));
                        Toast.makeText(activity, "设备信息已复制，请粘贴到厂商测试设备配置处", Toast.LENGTH_LONG).show();
                    }
                }).show())
                .setNegativeButton("停止本机推送", (dialog, which) -> { Toast.makeText(activity, "正在请求停止，请稍后重新打开查看状态", Toast.LENGTH_LONG).show(); bind(false); }).show();
        }
    }
}
