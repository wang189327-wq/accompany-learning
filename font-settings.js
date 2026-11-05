'use strict';
(()=>{
 const key='c9-font-size-v1',sizes={small:13,standard:15,large:18,extraLarge:21};
 const select=document.getElementById('fontSizeSelect'),hint=document.getElementById('fontSaveHint');
 function valid(value){return Object.prototype.hasOwnProperty.call(sizes,value);}
 function apply(value){const mode=valid(value)?value:'standard';document.documentElement.style.fontSize=sizes[mode]+'px';select.value=mode;}
 let saved;try{saved=localStorage.getItem(key);}catch{}
 apply(saved);
 select.addEventListener('change',()=>{
  apply(select.value);
  try{localStorage.setItem(key,select.value);hint.textContent='已保存，下次打开仍使用此文字大小。';}
  catch{hint.textContent='文字大小已调整，此设备暂时无法保存设置。';}
 });
 document.getElementById('fontSettings').addEventListener('click',()=>document.getElementById('fontDialog').showModal());
})();
