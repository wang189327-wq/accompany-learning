package app.accompany.learning;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.*;

public final class TodayWidgetListService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent){return new Factory(getApplicationContext(),intent.getIntExtra(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_ID,0));}
    static final class Factory implements RemoteViewsFactory {
        private final Context context;private final int widgetId;private List<WidgetAgenda.Row> rows=new ArrayList<>();Factory(Context context,int widgetId){this.context=context;this.widgetId=widgetId;}
        public void onCreate(){onDataSetChanged();}public void onDestroy(){rows.clear();}
        public void onDataSetChanged(){rows=TodayWidget.prefs(context).getBoolean("dateMenu:"+widgetId,false)?WidgetAgenda.dateRows(java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai")),TodayWidget.date(context,widgetId)):TodayWidget.rows(context,widgetId);}
        public int getCount(){return rows.size();}public int getViewTypeCount(){return 1;}public boolean hasStableIds(){return false;}public long getItemId(int position){return position;}public RemoteViews getLoadingView(){return null;}
        public RemoteViews getViewAt(int position){if(position<0||position>=rows.size())return null;WidgetAgenda.Row row=rows.get(position);RemoteViews view=new RemoteViews(context.getPackageName(),TodayWidget.resource(context,"layout","today_widget_row"));int title=TodayWidget.resource(context,"id","widget_row_title"),note=TodayWidget.resource(context,"id","widget_row_note");view.setTextViewText(title,row.title);view.setTextViewTextSize(title,TypedValue.COMPLEX_UNIT_SP,14);view.setTextColor(title,Color.parseColor(row.heading?(row.section==0?"#855c10":"#267144"):"#203431"));view.setInt(title,"setPaintFlags",android.graphics.Paint.ANTI_ALIAS_FLAG|android.graphics.Paint.SUBPIXEL_TEXT_FLAG|android.graphics.Paint.FAKE_BOLD_TEXT_FLAG);boolean hasNote=row.note!=null&&!row.note.trim().isEmpty();view.setTextViewText(note,hasNote?row.noteLabel+"："+row.note:"");view.setTextColor(note,Color.BLACK);view.setInt(note,"setPaintFlags",android.graphics.Paint.ANTI_ALIAS_FLAG|android.graphics.Paint.SUBPIXEL_TEXT_FLAG);view.setViewVisibility(note,hasNote?View.VISIBLE:View.GONE);view.setOnClickFillInIntent(TodayWidget.resource(context,"id","widget_row"),row.date==null?new Intent().putExtra("showToday",true):new Intent().putExtra("date",row.date));return view;}
    }
}
