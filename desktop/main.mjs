import {app,BrowserWindow,ipcMain,dialog,Tray,Menu,shell,safeStorage,session,nativeImage} from 'electron';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,cp,access} from 'node:fs/promises';
import {startServer} from '../server/index.mjs';
import {readJson} from '../server/storage.mjs';
import {attachVoice} from '../server/voice.mjs';
import {resolveRuntime,validatePort,navigationAllowed} from './runtime.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let win,tray,server,quitting=false;
if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>{win?.show();win?.focus();});
 app.whenReady().then(async()=>{try{
 const paths=resolveRuntime({packaged:app.isPackaged,userData:app.getPath('userData'),resources:process.resourcesPath,projectRoot:root});
 await mkdir(paths.defaultProject,{recursive:true});if(app.isPackaged){for(const item of ['skills','mcp.json']){try{await access(path.join(paths.defaultProject,item));}catch{await cp(path.join(paths.seedProject,item),path.join(paths.defaultProject,item),{recursive:true});}}}
 const config=await readJson(path.join(paths.dataDir,'config.local.json'),{});
 const secretCodec={encrypt:value=>{if(!safeStorage.isEncryptionAvailable())throw Error('Windows 密钥保护不可用，无法安全保存 API Key');return safeStorage.encryptString(value).toString('base64');},decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))};
 server=await startServer({dataDir:paths.dataDir,projectDir:paths.defaultProject,staticDir:paths.staticDir,port:validatePort(process.env.XIAOYOU_PORT||config.port||8765),openPath:async target=>{const error=await shell.openPath(target);if(error)throw Error(error);},secretCodec,voice:r=>attachVoice(r,{executable:paths.voiceExecutable,modelPath:paths.voiceModel})});
 const iconPath=app.isPackaged?path.join(process.resourcesPath,'assets','icon.ico'):path.join(root,'assets','icon.ico');
 session.defaultSession.setPermissionRequestHandler((webContents,permission,callback)=>callback(permission==='media'&&navigationAllowed(webContents.getURL(),server.url)));
 session.defaultSession.setPermissionCheckHandler((webContents,permission,origin)=>permission==='media'&&navigationAllowed(origin,server.url));
 win=new BrowserWindow({title:'小优 · 你的日常智能助手',width:1440,height:960,minWidth:780,minHeight:620,fullscreen:true,backgroundColor:'#070b14',icon:iconPath,autoHideMenuBar:true,webPreferences:{preload:path.join(root,'desktop','preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,autoplayPolicy:'no-user-gesture-required'}});
 win.webContents.on('will-navigate',(e,url)=>{if(!navigationAllowed(url,server.url))e.preventDefault();});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 const trusted=event=>{if(event.sender!==win.webContents||!navigationAllowed(event.senderFrame?.url||'',server.url))throw Error('不可信的桌面请求');};
 ipcMain.handle('toggle-fullscreen',event=>{trusted(event);win.setFullScreen(!win.isFullScreen());return win.isFullScreen();});
 ipcMain.handle('exit-fullscreen',event=>{trusted(event);win.setFullScreen(false);});
 ipcMain.handle('open-external',async(event,url)=>{trusted(event);if(url!==server.url)throw Error('仅允许打开本机网页入口');await shell.openExternal(url);});
 ipcMain.handle('open-data-dir',async event=>{trusted(event);await shell.openPath(paths.dataDir);});
 tray=new Tray(nativeImage.createFromPath(iconPath));tray.setToolTip('小优 · 你的日常智能助手');tray.setContextMenu(Menu.buildFromTemplate([{label:'显示小优',click:()=>win.show()},{label:'切换麦克风',click:()=>{win.show();win.webContents.send('mic-toggle');}},{type:'separator'},{label:'退出小优',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',()=>win.show());
 win.on('close',event=>{if(quitting)return;event.preventDefault();const choice=dialog.showMessageBoxSync(win,{type:'question',title:'小优',message:'离开之前，你希望小优怎样做？',detail:'保留后台时，已开启的语音监听继续运行，可从系统托盘唤回。',buttons:['保留后台监听','退出程序','取消'],defaultId:0,cancelId:2});if(choice===0)win.hide();if(choice===1){quitting=true;app.quit();}});
 await win.loadURL(server.url);
 }catch(e){dialog.showErrorBox('小优启动失败',e.message+'\n请检查端口占用或配置文件。');quitting=true;app.quit();}});
 app.on('before-quit',event=>{if(server){event.preventDefault();quitting=true;const s=server;server=null;void s.close().finally(()=>app.quit());}});
 app.on('window-all-closed',()=>{if(quitting)app.quit();});
}
