package cn.c9.studyplan;

import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.WeekFields;
import org.json.JSONArray;
import org.json.JSONObject;

public final class TodayWidget extends AppWidgetProvider {
    static final String PREF="c9-today-widget",REFRESH="cn.c9.studyplan.REFRESH_TODAY";
    static final String DATE_MENU="cn.c9.studyplan.WIDGET_DATE_MENU",DATE_PICK="cn.c9.studyplan.WIDGET_DATE_PICK";
    static final String DAY_RESET="cn.c9.studyplan.WIDGET_NEW_DAY";
    static SharedPreferences prefs(Context c){return c.getSharedPreferences(PREF,Context.MODE_PRIVATE);}
    static int resource(Context c,String kind,String name){return c.getResources().getIdentifier(name,kind,c.getPackageName());}
    static void configure(Context c,String endpoint,String token,String role){
        try{java.net.URI uri=new java.net.URI(endpoint);if(!"https".equals(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||token.length()<32||!("teacher".equals(role)||"student".equals(role)))return;
            SharedPreferences p=prefs(c);boolean changed=!endpoint.equals(p.getString("endpoint",""))||!token.equals(p.getString("token",""));SharedPreferences.Editor e=p.edit().putString("endpoint",endpoint).putString("token",token).putString("role",role);if(changed)e.remove("data").remove("updated");e.apply();schedule(c,false);render(c,null);
        }catch(Exception ignored){}
    }
    static void save(Context c,String json){try{JSONObject in=new JSONObject(json),out=new JSONObject();JSONArray records=new JSONArray(),items=in.optJSONArray("records");if(items==null)return;for(int i=0;i<items.length();i++){JSONObject r=items.getJSONObject(i),v=new JSONObject();for(String k:new String[]{"taskId","taskName","round","completed","late"})if(r.has(k))v.put(k,r.get(k));records.put(v);}out.put("tasks",in.optJSONArray("tasks"));out.put("records",records);prefs(c).edit().putString("data",out.toString()).putLong("updated",System.currentTimeMillis()).apply();render(c,null);}catch(Exception ignored){}
    }
    static void schedule(Context c,boolean immediate){if(AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TodayWidget.class)).length==0)return;JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(scheduler==null)return;ComponentName component=new ComponentName(c,WidgetRefreshService.class);if(!immediate){JobInfo pending=scheduler.getPendingJob(9330);if(pending!=null&&pending.getIntervalMillis()==12*60*60*1000L)return;}JobInfo.Builder builder=new JobInfo.Builder(immediate?9331:9330,component).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(false);if(immediate)builder.setMinimumLatency(0).setOverrideDeadline(0);else builder.setPeriodic(12*60*60*1000L);scheduler.schedule(builder.build());}
    @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){render(c,null);schedule(c,true);schedule(c,false);}
    @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);if(DATE_MENU.equals(intent.getAction())||DATE_PICK.equals(intent.getAction())){int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);boolean exists=false;for(int widget:AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TodayWidget.class)))if(widget==id)exists=true;if(!exists)return;LocalDate today=LocalDate.now(ZoneId.of("Asia/Shanghai"));SharedPreferences.Editor edit=prefs(c).edit();if(DATE_MENU.equals(intent.getAction()))edit.putBoolean("dateMenu:"+id,!prefs(c).getBoolean("dateMenu:"+id,false));else{String value=intent.getStringExtra("date");LocalDate chosen=WidgetAgenda.selectedDate(value,today);edit.putString("selectedDate:"+id,chosen.toString()).putString("selectedOn:"+id,today.toString()).putBoolean("dateMenu:"+id,false);}edit.apply();render(c,null);}else if(REFRESH.equals(intent.getAction())){int id=intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);resetDate(c,id);render(c,"正在刷新…");schedule(c,true);}else if(DAY_RESET.equals(intent.getAction())||Intent.ACTION_DATE_CHANGED.equals(intent.getAction())||Intent.ACTION_TIME_CHANGED.equals(intent.getAction())||Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())){render(c,null);schedule(c,false);}}
    @Override public void onDisabled(Context c){JobScheduler s=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(s!=null){s.cancel(9330);s.cancel(9331);}android.app.AlarmManager alarm=(android.app.AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(alarm!=null)alarm.cancel(dayAlarm(c));}

    static PendingIntent dayAlarm(Context c){return PendingIntent.getBroadcast(c,937,new Intent(c,TodayWidget.class).setAction(DAY_RESET),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    static void scheduleMidnight(Context c){android.app.AlarmManager alarm=(android.app.AlarmManager)c.getSystemService(Context.ALARM_SERVICE);if(alarm!=null)alarm.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP,LocalDate.now(ZoneId.of("Asia/Shanghai")).plusDays(1).atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli(),dayAlarm(c));}
    static void resetDate(Context c,int id){SharedPreferences.Editor edit=prefs(c).edit();if(id==AppWidgetManager.INVALID_APPWIDGET_ID){for(int widget:AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,TodayWidget.class)))edit.remove("selectedDate:"+widget).remove("selectedOn:"+widget).remove("dateMenu:"+widget);}else edit.remove("selectedDate:"+id).remove("selectedOn:"+id).remove("dateMenu:"+id);edit.apply();}
    static void background(Context c,String color){String name=WidgetAgenda.background(color);if(!name.equals(prefs(c).getString("backgroundResource","widget_background"))){prefs(c).edit().putString("backgroundResource",name).apply();render(c,null);}}
    static LocalDate date(Context c,int widgetId){return WidgetAgenda.rememberedDate(prefs(c).getString("selectedDate:"+widgetId,""),prefs(c).getString("selectedOn:"+widgetId,""),LocalDate.now(ZoneId.of("Asia/Shanghai")));}
    @Override public void onDeleted(Context c,int[] ids){SharedPreferences.Editor edit=prefs(c).edit();for(int id:ids)edit.remove("selectedDate:"+id).remove("selectedOn:"+id).remove("dateMenu:"+id);edit.apply();}
    static java.util.List<WidgetAgenda.Row> rows(Context c,int widgetId){
        try{JSONObject data=new JSONObject(prefs(c).getString("data","{}"));JSONArray tasks=data.optJSONArray("tasks"),records=data.optJSONArray("records");java.util.List<WidgetAgenda.Task> ts=new java.util.ArrayList<>();java.util.List<WidgetAgenda.Record> rs=new java.util.ArrayList<>();
            if(tasks!=null)for(int i=0;i<tasks.length();i++){JSONObject x=tasks.getJSONObject(i);WidgetAgenda.Task t=new WidgetAgenda.Task();t.id=x.optString("id");t.name=x.optString("name");t.kind=x.optString("kind");t.rule=x.optString("rule");t.enabled=x.optBoolean("enabled");t.format=x.optString("format");t.disabledAt=x.optLong("disabledAt",x.optLong("updated",x.optLong("created")));t.created=x.optLong("created");t.deletedAt=x.optLong("deletedAt");t.availableFrom=x.isNull("availableFrom")?t.created:x.optLong("availableFrom");t.deadline=x.optLong("deadline");JSONArray days=x.optJSONArray("weekDays");if(days!=null)for(int j=0;j<days.length();j++)t.weekDays.add(days.getInt(j));JSONArray paused=x.optJSONArray("pausedRounds");if(paused!=null)for(int j=0;j<paused.length();j++)t.paused.add(paused.getString(j));JSONObject notes=x.optJSONObject("roundNotes");if(notes!=null){java.util.Iterator<String> keys=notes.keys();while(keys.hasNext()){String key=keys.next();if(notes.opt(key) instanceof String)t.notes.put(key,notes.getString(key));}}ts.add(t);}
            if(records!=null)for(int i=0;i<records.length();i++){JSONObject x=records.getJSONObject(i);WidgetAgenda.Record r=new WidgetAgenda.Record();r.taskId=x.optString("taskId");r.taskName=x.isNull("taskName")?null:x.optString("taskName");r.round=x.optString("round");r.completed=x.optLong("completed");rs.add(r);}return WidgetAgenda.rows(ts,rs,date(c,widgetId),"teacher".equals(prefs(c).getString("role","student")));
        }catch(Exception e){java.util.List<WidgetAgenda.Row> out=new java.util.ArrayList<>();out.add(new WidgetAgenda.Row("请打开App同步日程","",0,false));return out;}
    }
    static void render(Context c,String status){
        try{SharedPreferences p=prefs(c);AppWidgetManager manager=AppWidgetManager.getInstance(c);int[] ids=manager.getAppWidgetIds(new ComponentName(c,TodayWidget.class));if(ids.length==0)return;
            int listId=resource(c,"id","widget_list");
            for(int id:ids){LocalDate day=date(c,id);Intent open=new Intent(c,MainActivity.class).putExtra("showToday",true).putExtra("widgetDate",day.toString()).setData(android.net.Uri.parse("c9widget://open/"+id)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);PendingIntent rowsOpen=PendingIntent.getActivity(c,935,open,PendingIntent.FLAG_UPDATE_CURRENT|(android.os.Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0));Intent choose=new Intent(c,TodayWidget.class).setAction(DATE_MENU).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(android.net.Uri.parse("c9widget://date-menu/"+id));PendingIntent titleOpen=PendingIntent.getBroadcast(c,936,choose,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Intent refresh=new Intent(c,TodayWidget.class).setAction(REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(android.net.Uri.parse("c9widget://refresh/"+id));PendingIntent refreshAction=PendingIntent.getBroadcast(c,934,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);RemoteViews view=new RemoteViews(c.getPackageName(),resource(c,"layout","today_widget"));view.setInt(resource(c,"id","widget_root"),"setBackgroundResource",resource(c,"drawable",p.getString("backgroundResource","widget_background")));view.setTextViewText(resource(c,"id","widget_title"),WidgetAgenda.label(day));long updated=p.getLong("updated",0);String stamp=updated==0?"请先在App连接云端":"更新于 "+java.time.Instant.ofEpochMilli(updated).atZone(ZoneId.of("Asia/Shanghai")).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"));view.setTextViewText(resource(c,"id","widget_status"),status==null?stamp:status+" · "+stamp);view.setOnClickPendingIntent(resource(c,"id","widget_title"),titleOpen);
view.setOnClickPendingIntent(resource(c,"id","widget_refresh"),refreshAction);
                Intent adapter=new Intent(c,TodayWidgetListService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);adapter.setData(android.net.Uri.parse("c9widget://agenda/"+id));view.setRemoteAdapter(listId,adapter);boolean dateMenu=p.getBoolean("dateMenu:"+id,false);Intent datePick=new Intent(c,TodayWidget.class).setAction(DATE_PICK).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id).setData(android.net.Uri.parse("c9widget://date-template/"+id));PendingIntent dateSelect=PendingIntent.getBroadcast(c,939,datePick,PendingIntent.FLAG_UPDATE_CURRENT|(android.os.Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0));view.setPendingIntentTemplate(listId,dateMenu?dateSelect:rowsOpen);manager.updateAppWidget(id,view);}
            manager.notifyAppWidgetViewDataChanged(ids,listId);scheduleMidnight(c);
        }catch(Exception ignored){}
    }
}
