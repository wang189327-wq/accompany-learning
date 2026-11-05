package cn.c9.studyplan;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

public final class UpdateManager {
    private static final String MANIFEST_URL=PublicConfig.UPDATE_MANIFEST_URL;
    private final Activity activity;
    private final ExecutorService executor=Executors.newSingleThreadExecutor();
    private JSONObject latest;
    private volatile String phase="idle",error="";
    private long done=0,total=0;
    private File downloaded;
    private boolean pendingPermission;
    public UpdateManager(Activity activity){this.activity=activity;}
    private PackageInfo installed() throws Exception{return activity.getPackageManager().getPackageInfo(activity.getPackageName(),Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES);}
    private long version(PackageInfo p){return Build.VERSION.SDK_INT>=28?p.getLongVersionCode():p.versionCode;}
    private synchronized void fail(Exception e){phase="error";error=e.getMessage()==null?"更新失败，请稍后重试":e.getMessage();}
    public synchronized String state(){
        try{PackageInfo p=installed();JSONObject out=new JSONObject().put("phase",phase).put("currentName",p.versionName).put("currentCode",version(p)).put("done",done).put("total",total).put("error",error);if(latest!=null)out.put("latest",latest);return out.toString();}
        catch(Exception e){return "{\"phase\":\"error\",\"error\":\"无法读取版本\"}";}
    }
    private HttpsURLConnection connection(String address) throws Exception {
        if(MANIFEST_URL.isEmpty())throw new Exception("尚未配置更新地址，请联系此安装包的发布者");
        URL url=new URL(address);
        if(!"https".equals(url.getProtocol())||!new URL(MANIFEST_URL).getHost().equals(url.getHost())||url.getPort()!=-1||url.getUserInfo()!=null)throw new Exception("更新地址无效");
        HttpsURLConnection c=(HttpsURLConnection)url.openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(30000);c.setRequestProperty("Cache-Control","no-cache");
        if(c.getResponseCode()!=200){c.disconnect();throw new Exception("暂时无法获取更新，请检查网络后重试");}return c;
    }
    public synchronized void check(){
        if("checking".equals(phase)||"downloading".equals(phase))return;phase="checking";error="";
        executor.execute(()->{try{
            HttpsURLConnection c=connection(MANIFEST_URL);byte[] bytes;
            try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>65536)throw new Exception("更新信息无效");out.write(buffer,0,n);}bytes=out.toByteArray();}finally{c.disconnect();}
            JSONObject value=new JSONObject(new String(bytes,java.nio.charset.StandardCharsets.UTF_8));
            URL url=new URL(value.getString("url"));long size=value.getLong("bytes"),code=value.getLong("versionCode");
            if(!"https".equals(url.getProtocol())||!new URL(MANIFEST_URL).getHost().equals(url.getHost())||url.getPort()!=-1||url.getUserInfo()!=null||url.getQuery()!=null||url.getRef()!=null||!url.getPath().matches("/updates/banxue-record-v[0-9.]+\\.apk")||!value.getString("sha256").matches("[a-f0-9]{64}")||size<1||size>100*1024*1024||code<1||!value.getString("versionName").matches("[0-9.]+"))throw new Exception("更新信息无效");
            synchronized(this){latest=value;phase=code>version(installed())?"available":"current";}
        }catch(Exception e){fail(e);}});
    }
    private String digest(File file) throws Exception {MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)hash.update(b,0,n);}StringBuilder out=new StringBuilder();for(byte b:hash.digest())out.append(String.format("%02x",b&255));return out.toString();}
    private Signature[] signatures(PackageInfo p){return Build.VERSION.SDK_INT>=28&&p.signingInfo!=null?p.signingInfo.getApkContentsSigners():p.signatures;}
    private void validate(File file,JSONObject value) throws Exception {
        if(file.length()!=value.getLong("bytes")||!digest(file).equals(value.getString("sha256")))throw new Exception("安装包校验失败，请重新下载");
        PackageInfo next=activity.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES),current=installed();
        if(next==null||!activity.getPackageName().equals(next.packageName)||version(next)!=value.getLong("versionCode")||version(next)<=version(current)||!value.getString("versionName").equals(next.versionName))throw new Exception("安装包版本不匹配");
        Signature[] a=signatures(next),b=signatures(current);if(a==null||b==null||a.length!=1||b.length!=1||!Arrays.equals(a[0].toByteArray(),b[0].toByteArray()))throw new Exception("安装包签名不匹配，已停止更新");
    }
    public synchronized void download(){
        if(latest==null||"downloading".equals(phase)||"checking".equals(phase))return;
        final JSONObject value=latest;phase="downloading";done=0;error="";total=value.optLong("bytes");
        executor.execute(()->{File part=null;try{
            File folder=new File(activity.getCacheDir(),"updates");if(!folder.isDirectory()&&!folder.mkdirs())throw new Exception("无法创建更新目录");
            File target=new File(folder,"update-"+value.getLong("versionCode")+".apk");part=new File(folder,"download.part");
            HttpsURLConnection c=connection(value.getString("url"));
            try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(part)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1){synchronized(this){done+=n;if(done>total)throw new Exception("安装包大小不匹配");}out.write(b,0,n);}}finally{c.disconnect();}
            validate(part,value);if(target.exists()&&!target.delete())throw new Exception("无法替换更新缓存");if(!part.renameTo(target))throw new Exception("无法保存安装包");
            synchronized(this){downloaded=target;phase="downloaded";}
        }catch(Exception e){if(part!=null)part.delete();fail(e);}});
    }
    public void install(){activity.runOnUiThread(()->{try{
        File file;JSONObject value;synchronized(this){file=downloaded;value=latest;}if(file==null||value==null)throw new Exception("请先下载更新");validate(file,value);
        if(!activity.getPackageManager().canRequestPackageInstalls()){pendingPermission=true;phase="permission";activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));return;}
        pendingPermission=false;Intent intent=new Intent(Intent.ACTION_VIEW);intent.setDataAndType(Uri.parse("content://"+activity.getPackageName()+".updates/"+file.getName()),"application/vnd.android.package-archive");intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(intent);synchronized(this){phase="downloaded";}
    }catch(Exception e){fail(e);}});}
    public void resume(){if(pendingPermission&&activity.getPackageManager().canRequestPackageInstalls())install();}
    public void close(){executor.shutdown();}
}
