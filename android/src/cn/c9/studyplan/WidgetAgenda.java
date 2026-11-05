package cn.c9.studyplan;
import java.time.LocalDate;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.WeekFields;
import java.util.*;

/** Pure date/row model shared by the Android collection widget and host-side tests. */
public final class WidgetAgenda {
    public static final class Task {
        public String id,name,kind,rule,format;public boolean enabled;public long created,deletedAt,deadline,availableFrom,disabledAt;
        public List<Integer> weekDays=new ArrayList<>();public Set<String> paused=new HashSet<>();public Map<String,String> notes=new HashMap<>();
    }
    public static final class Record {public String taskId,taskName,round;public long completed;}
    public static final class Row {public String title,note,noteLabel,date;public int section;public boolean heading;Row(String title,String note,int section,boolean heading){this.title=title;this.note=note;this.section=section;this.heading=heading;}}
    public static String round(Task t,LocalDate day){if("once".equals(t.kind))return "单次";if("day".equals(t.rule))return day.toString();if("month".equals(t.rule))return day.toString().substring(0,7);return String.format(Locale.ROOT,"%04d-W%02d",day.get(WeekFields.ISO.weekBasedYear()),day.get(WeekFields.ISO.weekOfWeekBasedYear()));}
    public static List<Row> rows(List<Task> tasks,List<Record> records,LocalDate day,boolean teacher){
        long start=day.atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli(),end=start+86400000L;Map<String,Task> byId=new HashMap<>();for(Task t:tasks)byId.put(t.id,t);List<Row> pending=new ArrayList<>(),done=new ArrayList<>();
        for(Task t:tasks){String key=round(t,day);if(!t.enabled||t.deletedAt>0||t.created>=end||t.paused.contains(key))continue;if("once".equals(t.kind)){if(t.availableFrom>=end||t.deadline<start)continue;}else if("week".equals(t.rule)&&!t.weekDays.isEmpty()&&!t.weekDays.contains(day.getDayOfWeek().getValue()-1))continue;boolean completed=false;for(Record r:records)if(t.id.equals(r.taskId)&&key.equals(r.round)&&r.completed<end){completed=true;break;}if(!completed)pending.add(taskRow(t.name,t.notes.get(key),0,t.rule));}
        List<Record> ordered=new ArrayList<>(records);ordered.sort(Comparator.comparingLong(r->r.completed));for(Record r:ordered){Task t=byId.get(r.taskId);if(t!=null&&(teacher||t.deletedAt==0)&&(t.enabled||!"auto".equals(t.format)||t.disabledAt>0&&start<Instant.ofEpochMilli(t.disabledAt).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().atStartOfDay(ZoneId.of("Asia/Shanghai")).toInstant().toEpochMilli())&&r.completed>=start&&r.completed<end)done.add(taskRow(r.taskName==null?t.name:r.taskName,t.notes.get(r.round),1,t.rule));}
        List<Row> out=new ArrayList<>();out.add(new Row("待完成（"+pending.size()+"）","",0,true));if(pending.isEmpty())out.add(new Row("暂无","",0,false));else out.addAll(pending);out.add(new Row("已完成（"+done.size()+"）","",1,true));if(done.isEmpty())out.add(new Row("暂无","",1,false));else out.addAll(done);return out;
    }
    public static String noteLabel(String rule){return "week".equals(rule)?"本周备注":"month".equals(rule)?"本月备注":"day".equals(rule)?"本日备注":"备注";}
    static Row taskRow(String title,String note,int section,String rule){Row row=new Row(title,note,section,false);row.noteLabel=noteLabel(rule);return row;}
    public static List<Row> dateRows(LocalDate today,LocalDate selected){LocalDate monday=today.minusDays(today.getDayOfWeek().getValue()-1);List<Row> rows=new ArrayList<>();for(int i=0;i<7;i++){LocalDate date=monday.plusDays(i);Row row=new Row(label(date)+(date.equals(selected)?"  ✓":""),"",0,false);row.date=date.toString();rows.add(row);}return rows;}
    public static String label(LocalDate day){return day.toString()+"【周"+"一二三四五六日".charAt(day.getDayOfWeek().getValue()-1)+"】";}
    public static LocalDate selectedDate(String value,LocalDate today){try{LocalDate day=LocalDate.parse(value),monday=today.minusDays(today.getDayOfWeek().getValue()-1);return !day.isBefore(monday)&&day.isBefore(monday.plusDays(7))?day:today;}catch(Exception ignored){return today;}}
    public static LocalDate rememberedDate(String value,String selectedOn,LocalDate today){return today.toString().equals(selectedOn)?selectedDate(value,today):today;}
    public static String background(String color){switch(color){case "#edf5e9":return "widget_bg_green";case "#faf3e3":return "widget_bg_cream";case "#eaf2f8":return "widget_bg_blue";case "#f0ecf5":return "widget_bg_lavender";default:return "widget_background";}}
}
