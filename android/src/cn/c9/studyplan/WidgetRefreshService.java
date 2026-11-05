package cn.c9.studyplan;
import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.SharedPreferences;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
public final class WidgetRefreshService extends JobService {
    private volatile HttpsURLConnection connection;
    private volatile boolean stopped;
    @Override public boolean onStartJob(JobParameters params){stopped=false;new Thread(()->{try{SharedPreferences p=TodayWidget.prefs(this);String endpoint=p.getString("endpoint",""),token=p.getString("token","");if(endpoint.isEmpty()||token.isEmpty()){TodayWidget.render(this,"请先在App连接云端");return;}HttpsURLConnection c=(HttpsURLConnection)new URL(endpoint+"/api/widget").openConnection();connection=c;c.setConnectTimeout(8000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);c.setRequestProperty("Authorization","Bearer "+token);if(c.getResponseCode()!=200)throw new java.io.IOException();java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();try(java.io.InputStream input=c.getInputStream()){byte[] chunk=new byte[8192];int size;while((size=input.read(chunk))!=-1){if(stopped||out.size()+size>32*1024*1024)throw new java.io.IOException();out.write(chunk,0,size);}}if(!stopped&&endpoint.equals(p.getString("endpoint",""))&&token.equals(p.getString("token","")))TodayWidget.save(this,new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){if(!stopped)TodayWidget.render(this,"刷新失败，保留上次内容");}finally{if(connection!=null)connection.disconnect();if(!stopped)jobFinished(params,false);}},"C9WidgetRefresh").start();return true;}
    @Override public boolean onStopJob(JobParameters params){stopped=true;if(connection!=null)connection.disconnect();return true;}
}
