'use strict';
const TaskOrdering=(()=>{
 let orders={},draft=null,holding=null,dragging=null,timer=null,saving=false,suppressUntil=0;
 const compare=(ids=[])=>{const ranks=new Map(ids.map((id,i)=>[id,i]));return (a,b)=>(ranks.get(a.id)??Infinity)-(ranks.get(b.id)??Infinity)||b.created-a.created||a.id.localeCompare(b.id);};
 const eligible=()=>typeof role!=='undefined'&&role&&tab==='tasks'&&taskView==='agenda';
 const list=()=>tasks.filter(t=>!t.deletedAt).sort(compare(orders[role]?.ids));
 function restore(){try{orders=JSON.parse(localStorage.getItem('c9-task-orders-v1'))||{};}catch{orders={};}}
 restore();
 function set(value){orders=value||{};try{localStorage.setItem('c9-task-orders-v1',JSON.stringify(orders));}catch{}}
 function start(id){if(!eligible()||saving)return;if(typeof Cloud!=='undefined'&&!cloudFeatures.taskOrder){toast('请先更新 v1.5.1 云端接口，再设置跨设备排序');return;}draft=list().map(t=>t.id);render();suppressUntil=Date.now()+500;const card=document.querySelector('[data-order-id="'+id+'"]');card?.focus();toast('拖动同一栏内的任务，点击确认保存');}
 function controls(){return draft?'<div class="sortBar" role="status"><strong>调整任务顺序</strong><div class="actions"><button id="confirmTaskOrder" class="primary" '+(saving?'disabled':'')+'>确认</button><button id="cancelTaskOrder" '+(saving?'disabled':'')+'>取消</button></div></div>':'';}
 function move(id,target){const from=draft?.indexOf(id),to=draft?.indexOf(target);if(from<0||to<0||from===to)return;draft.splice(from,1);draft.splice(to,0,id);}
 function ordered(values){return [...values].sort(compare(draft||orders[role]?.ids));}
 function card(id){return eligible()?' data-order-id="'+id+'" '+(draft?'tabindex="0" aria-label="可拖动排序的任务"':''):'';}
 function actions(id){return draft?'<div class="sortHandles"><button data-order-move="'+id+'" data-direction="-1" aria-label="上移任务">↑</button><button data-order-move="'+id+'" data-direction="1" aria-label="下移任务">↓</button></div>':'';}
 function cancel(){draft=null;dragging=null;clearTimeout(timer);}
 async function save(){if(!draft||saving)return;saving=true;const who=role,ids=[...draft];try{let saved;if(typeof Cloud!=='undefined'){if(!cloudFeatures.taskOrder)throw Error('请先更新 v1.5.1 云端接口，再保存跨设备排序');saved=await Cloud.request('/api/preferences/order',{method:'POST',role:who,body:{ids,expected:orders[who]?.revision??null}});}else{saved={ids,revision:(orders[who]?.revision||0)+1};}orders[who]=saved;try{localStorage.setItem('c9-task-orders-v1',JSON.stringify(orders));}catch{}draft=null;render();toast('任务顺序已保存');}catch(e){toast(e.message);if(e.status===409){await refresh();toast('同一角色在另一设备更新了顺序，请取消后重新排序');}}finally{saving=false;}}
 document.addEventListener('pointerdown',e=>{if(!eligible()||saving||e.button!==0)return;const c=e.target.closest('[data-order-id]');if(!c||!draft&&e.target.closest('button,input,a'))return;holding={id:c.dataset.orderId,x:e.clientX,y:e.clientY,pointer:e.pointerId};if(draft){dragging=holding;c.classList.add('sortingDrag');e.preventDefault();}else timer=setTimeout(()=>{const active=holding;if(!active)return;start(active.id);if(draft)dragging=active;holding=null;},550);});
 document.addEventListener('pointermove',e=>{if(holding&&!draft&&Math.hypot(e.clientX-holding.x,e.clientY-holding.y)>10){clearTimeout(timer);holding=null;}if(!dragging)return;e.preventDefault();const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-order-id]'),source=document.querySelector('[data-order-id="'+dragging.id+'"]');if(target&&source&&target.closest('.taskSection')===source.closest('.taskSection')){move(dragging.id,target.dataset.orderId);const grid=source.parentNode;for(const id of draft){const child=grid.querySelector('[data-order-id="'+id+'"]');if(child)grid.append(child);}}if(e.clientY<85)window.scrollBy(0,-12);else if(e.clientY>innerHeight-100)window.scrollBy(0,12);},{passive:false});
 document.addEventListener('touchmove',e=>{if(dragging)e.preventDefault();},{passive:false});
 function release(){clearTimeout(timer);holding=null;if(dragging){dragging=null;suppressUntil=Date.now()+400;render();}}
 document.addEventListener('pointerup',release);document.addEventListener('pointercancel',release);
 document.addEventListener('contextmenu',e=>{if(e.target.closest('[data-order-id]')&&eligible())e.preventDefault();});
 document.addEventListener('click',e=>{const el=e.target.closest('button');if(el?.id==='confirmTaskOrder'){e.preventDefault();e.stopImmediatePropagation();save();return;}if(el?.id==='cancelTaskOrder'){cancel();render();e.stopImmediatePropagation();return;}if(draft||Date.now()<suppressUntil&&e.target.closest('[data-order-id]')){e.preventDefault();e.stopImmediatePropagation();if(el?.dataset.orderMove){const id=el.dataset.orderMove,card=document.querySelector('[data-order-id="'+id+'"]'),siblings=[...card.parentNode.querySelectorAll('[data-order-id]')].map(x=>x.dataset.orderId),target=siblings[siblings.indexOf(id)+Number(el.dataset.direction)];if(target){move(id,target);render();}}return;}},true);
 document.addEventListener('keydown',e=>{if(!draft&&eligible()&&e.target.closest('[data-order-id]')&&e.key===' '){e.preventDefault();start(e.target.dataset.orderId);}if(draft&&e.key==='Escape'&&!saving){cancel();render();}});
 return {compare,ordered,set,start,controls,card,actions,cancel,get active(){return !!draft;}};
})();
if(typeof module!=='undefined')module.exports=TaskOrdering;
