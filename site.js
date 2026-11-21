(function(){var h=document.documentElement,b=document.getElementById('lang');
 function set(l){h.setAttribute('data-lang',l);h.lang=l;if(b)b.textContent=l==='tr'?'EN':'TR';try{localStorage.setItem('tb_lang',l)}catch(e){}}
 var s=null;try{s=localStorage.getItem('tb_lang')}catch(e){}
 set(s||((navigator.language||'tr').toLowerCase().indexOf('tr')===0?'tr':'en'));
 if(b)b.onclick=function(){set(h.getAttribute('data-lang')==='tr'?'en':'tr')};})();
