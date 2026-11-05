const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
// API26+ RemoteViews common supported subset. Official reference:
// https://developer.android.com/reference/android/widget/RemoteViews
const allowed=new Set(['LinearLayout','FrameLayout','RelativeLayout','GridLayout','TextView','Button','ImageView','ImageButton','ProgressBar','Chronometer','AnalogClock','ViewFlipper','ListView','GridView','StackView','AdapterViewFlipper','ViewStub']);
function validate(xml){for(const m of xml.matchAll(/<([A-Za-z][\w.]*)\b/g))assert.ok(allowed.has(m[1]),'Unsupported widget view: '+m[1]);}
for(const name of ['today_widget.xml','today_widget_row.xml'])validate(fs.readFileSync(path.join(__dirname,'res/layout',name),'utf8'));
assert.throws(()=>validate('<ScrollView/>'),/Unsupported widget view/);
console.log('Widget layout compatibility passed (unsupported ScrollView regression blocked)');

const provider=fs.readFileSync(path.join(__dirname,"res/xml/today_widget_info.xml"),"utf8");
assert.match(provider,/android:updatePeriodMillis="0"/,"系统不得额外每30分钟触发onUpdate下载；周期联网统一由JobScheduler管理");
