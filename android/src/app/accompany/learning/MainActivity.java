package app.accompany.learning;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGES = 91, SAVE_PERMISSION = 92, SAVE_DOCUMENT = 93;
    private static final String HOME = "https://localhost/index.html";
    private static final Set<String> ASSETS = AssetList.NAMES;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingDocument;
    private final PhotoBridge photos = new PhotoBridge();
    private final UpdateManager updates = new UpdateManager(this);

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
        getWindow().setNavigationBarColor(Color.WHITE);
        if(Build.VERSION.SDK_INT>=29)getWindow().setNavigationBarContrastEnforced(false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view,insets)->{
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bar = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(bar.left,bar.top,bar.right,bar.bottom);
                return WindowInsets.CONSUMED;
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            }
            return insets.consumeSystemWindowInsets();
        });
        root.requestApplyInsets();
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setTextZoom(100);
        web.setBackgroundColor(Color.rgb(243,246,243));
        web.addJavascriptInterface(photos,"C9Android");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !"localhost".equals(uri.getHost()) || !"/index.html".equals(uri.getPath());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"localhost".equals(uri.getHost())) return null;
                String name = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
                if (!"https".equals(uri.getScheme()) || !"GET".equals(request.getMethod()) || !(ASSETS.contains(name) || name.matches("pdf-(cmaps|fonts|wasm)/[a-zA-Z0-9_.-]+") && !name.contains("..")))
                    return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",null,new ByteArrayInputStream(new byte[0]));
                try {
                    Map<String,String> headers = new HashMap<>();
                    headers.put("Cache-Control","no-store");
                    headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; font-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; connect-src https:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                    return new WebResourceResponse(name.endsWith("html")?"text/html":name.endsWith(".wasm")?"application/wasm":name.startsWith("pdf-")&&!name.endsWith(".js")?"application/octet-stream":"application/javascript","UTF-8",200,"OK",headers,getAssets().open(name));
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain","UTF-8",500,"Asset Error",null,new ByteArrayInputStream("界面文件加载失败".getBytes(StandardCharsets.UTF_8)));
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                String[] accept=params.getAcceptTypes();
                boolean onlyImages=accept!=null && accept.length==1 && "image/*".equals(accept[0]);
                pick.setType(onlyImages?"image/*":"*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
                pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(pick,PICK_IMAGES); }
                catch (Exception e) { fileCallback.onReceiveValue(null);fileCallback=null;notifyUser("无法打开选图窗口，请检查手机的文件管理应用"); }
                return true;
            }
            @Override public boolean onJsConfirm(WebView view,String url,String message,JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Accompany Learning").setMessage(message)
                    .setPositiveButton("确定",(dialog,which)->result.confirm())
                    .setNegativeButton("取消",(dialog,which)->result.cancel())
                    .setOnCancelListener(dialog->result.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("知道了",(dialog,which)->result.confirm())
                    .setOnCancelListener(dialog->result.confirm()).show();
                return true;
            }
        });
        web.loadUrl(HOME);
    }

    @Override protected void onActivityResult(int request,int result,Intent data) {
        super.onActivityResult(request,result,data);
        if(request==SAVE_DOCUMENT){
            synchronized(photos){
                PhotoJob job=photos.jobs.get(pendingDocument);pendingDocument=null;
                if(job==null)return;
                if(result!=RESULT_OK||data==null||data.getData()==null){job.error="已取消保存";return;}
                try{job.uri=data.getData();job.stream=getContentResolver().openOutputStream(job.uri);if(job.stream==null)throw new IllegalStateException();}
                catch(Exception e){job.error="无法写入所选位置";photos.cleanup(job);}
            }
            return;
        }
        if (request != PICK_IMAGES || fileCallback == null) return;
        ArrayList<Uri> chosen = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) for (int i=0;i<clip.getItemCount();i++) {
                Uri uri = clip.getItemAt(i).getUri();if (uri != null && "content".equals(uri.getScheme())) chosen.add(uri);
            }
            else if (data.getData()!=null && "content".equals(data.getData().getScheme())) chosen.add(data.getData());
        }
        fileCallback.onReceiveValue(chosen.isEmpty()?null:chosen.toArray(new Uri[0]));fileCallback=null;
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(request,permissions,results);
        if (request == SAVE_PERMISSION) notifyUser(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED?"已授权，请再次点击保存图片":"没有保存图片权限，可稍后重新授权");
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("typeof C9HandleBack==='function' && C9HandleBack()",result->{if (!"true".equals(result)) moveTaskToBack(true);});
    }
    @Override protected void onPause() { super.onPause();web.onPause(); }
    @Override protected void onResume() { super.onResume();if(web!=null){updates.resume();web.onResume();web.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))",null);} }
    @Override protected void onDestroy() {
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        updates.close();photos.closeAll();web.removeJavascriptInterface("C9Android");web.destroy();super.onDestroy();
    }
    private void notifyUser(String message) { runOnUiThread(()->Toast.makeText(this,message,Toast.LENGTH_LONG).show()); }

    private final class PhotoJob {
        OutputStream stream;Uri uri;File file;String mime,error;long bytes;
    }
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(web!=null)web.evaluateJavascript("document.dispatchEvent(new Event('c9-widget-open'))",null);}
    public final class PhotoBridge {
        @JavascriptInterface public void widgetConfigure(String endpoint,String token,String role){TodayWidget.configure(MainActivity.this,endpoint,token,role);}
        @JavascriptInterface public void widgetBackground(String color){TodayWidget.background(MainActivity.this,color);}
        @JavascriptInterface public void widgetSnapshot(String data){TodayWidget.save(MainActivity.this,data);}
        @JavascriptInterface public String widgetOpenDate(){String date=getIntent().getStringExtra("widgetDate");getIntent().removeExtra("widgetDate");return date==null?"":date;}
        @JavascriptInterface public boolean consumeWidgetOpen(){boolean open=getIntent().getBooleanExtra("showToday",false);getIntent().removeExtra("showToday");return open;}
        private final Map<String,PhotoJob> jobs = new HashMap<>();
        @JavascriptInterface public String updateState(){return updates.state();}
        @JavascriptInterface public void checkUpdate(){updates.check();}
        @JavascriptInterface public void downloadUpdate(){updates.download();}
        @JavascriptInterface public void installUpdate(){updates.install();}
        private String error(String message) { return "{\"error\":"+JSONObject.quote(message)+"}"; }
        @JavascriptInterface public synchronized String beginFile(String inputName,String type){
            if(pendingDocument!=null)return error("请先完成当前文件保存");
            PhotoJob job=new PhotoJob();job.mime=type==null?"application/octet-stream":type;
            String name=inputName==null?"学习资料":inputName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
            String id=UUID.randomUUID().toString();jobs.put(id,job);pendingDocument=id;
            runOnUiThread(()->{try{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(job.mime);intent.putExtra(Intent.EXTRA_TITLE,name);startActivityForResult(intent,SAVE_DOCUMENT);}catch(Exception e){synchronized(photos){job.error="无法打开文件保存窗口";pendingDocument=null;}}});
            return "{\"id\":"+JSONObject.quote(id)+"}";
        }
        @JavascriptInterface public synchronized String fileState(String id){PhotoJob job=jobs.get(id);if(job==null)return error("文件保存已中断");if(job.error!=null)return error(job.error);return "{\"ready\":"+(job.stream!=null)+"}";}
        @JavascriptInterface public synchronized String finishFile(String id){PhotoJob job=jobs.remove(id);if(job==null)return error("文件保存已中断");try{if(job.bytes==0||job.stream==null)throw new IllegalStateException();job.stream.close();job.stream=null;return "{}";}catch(Exception e){cleanup(job);return error("文件保存失败");}}
        @JavascriptInterface public synchronized String beginPhoto(String inputName,String type) {
            if (Build.VERSION.SDK_INT<29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)!=PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(()->requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE},SAVE_PERMISSION));
                return error("请允许保存图片权限，授权后再次点击保存");
            }
            if(type==null||!type.startsWith("image/"))return error("请选择有效图片");
            PhotoJob job = new PhotoJob();job.mime=type;
            String safe = inputName==null?"作业图片.jpg":inputName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]","_");
            if(safe.length()>100)safe=safe.substring(safe.length()-100);
            String name="C9-"+System.currentTimeMillis()+"-"+safe;
            try {
                if (Build.VERSION.SDK_INT>=29) {
                    ContentValues values=new ContentValues();
                    values.put(MediaStore.Images.Media.DISPLAY_NAME,name);
                    values.put(MediaStore.Images.Media.MIME_TYPE,type);
                    values.put(MediaStore.Images.Media.RELATIVE_PATH,Environment.DIRECTORY_PICTURES+"/Accompany Learning");
                    values.put(MediaStore.Images.Media.IS_PENDING,1);
                    job.uri=getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);
                    if(job.uri==null)throw new IllegalStateException();
                    job.stream=getContentResolver().openOutputStream(job.uri);
                } else {
                    File folder=new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),"Accompany Learning");
                    if(!folder.isDirectory()&&!folder.mkdirs())throw new IllegalStateException();
                    job.file=new File(folder,name);job.stream=new FileOutputStream(job.file);
                }
                if(job.stream==null)throw new IllegalStateException();
                String id=UUID.randomUUID().toString();jobs.put(id,job);return "{\"id\":"+JSONObject.quote(id)+"}";
            } catch (Exception e) { cleanup(job);return error("无法保存图片，请检查手机存储空间"); }
        }
        @JavascriptInterface public synchronized String photoChunk(String id,String encoded) {
            PhotoJob job=jobs.get(id);if(job==null)return error("图片保存已中断，请重试");
            try { byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);job.stream.write(bytes);job.bytes+=bytes.length;return "{}"; }
            catch(Exception e){jobs.remove(id);cleanup(job);return error("保存图片失败，请检查手机存储空间");}
        }
        @JavascriptInterface public synchronized String finishPhoto(String id) {
            PhotoJob job=jobs.remove(id);if(job==null)return error("图片保存已中断，请重试");
            try {
                if(job.bytes==0)throw new IllegalStateException();
                job.stream.close();job.stream=null;
                if(Build.VERSION.SDK_INT>=29){ContentValues values=new ContentValues();values.put(MediaStore.Images.Media.IS_PENDING,0);if(getContentResolver().update(job.uri,values,null,null)==0)throw new IllegalStateException();}
                else android.media.MediaScannerConnection.scanFile(MainActivity.this,new String[]{job.file.getAbsolutePath()},new String[]{job.mime},null);
                return "{}";
            }catch(Exception e){cleanup(job);return error("图片保存失败，请重试");}
        }
        @JavascriptInterface public synchronized void cancelPhoto(String id) { PhotoJob job=jobs.remove(id);if(job!=null)cleanup(job); }
        private void cleanup(PhotoJob job) {
            try{if(job.stream!=null)job.stream.close();}catch(Exception ignored){}
            try{if(job.uri!=null)getContentResolver().delete(job.uri,null,null);}catch(Exception ignored){}
            if(job.file!=null)job.file.delete();
        }
        synchronized void closeAll(){for(PhotoJob job:jobs.values())cleanup(job);jobs.clear();}
    }
}
