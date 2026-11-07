const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('xiaoyou',{
 toggleFullscreen:()=>ipcRenderer.invoke('toggle-fullscreen'),
 exitFullscreen:()=>ipcRenderer.invoke('exit-fullscreen'),
 openExternal:url=>ipcRenderer.invoke('open-external',url),
 openDataDir:()=>ipcRenderer.invoke('open-data-dir'),
 onMicToggle:callback=>{const listener=()=>callback();ipcRenderer.on('mic-toggle',listener);return()=>ipcRenderer.removeListener('mic-toggle',listener);},
});
