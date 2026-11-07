export function advanceWake(state,text){
 if(state.speaking)return {armed:false,command:null};
 const clean=text.replace(/\s+/g,'').trim();if(!clean)return {armed:!!state.armed,command:null};
 const at=clean.indexOf('小优');
 if(at>=0){const command=clean.slice(at+2).replace(/^[，。！？、,:：!?.]+/,'');return {armed:!command,command:command||null};}
 return state.armed?{armed:false,command:clean}:{armed:false,command:null};
}
export function pcm16(samples,rate){const ratio=rate/16000;const output=new Int16Array(Math.floor(samples.length/ratio));for(let i=0;i<output.length;i++){const start=Math.floor(i*ratio),end=Math.min(samples.length,Math.floor((i+1)*ratio));let sum=0;for(let j=start;j<end;j++)sum+=samples[j];const value=Math.max(-1,Math.min(1,sum/Math.max(1,end-start)));output[i]=Math.round(value*(value<0?32768:32767));}return output;}
