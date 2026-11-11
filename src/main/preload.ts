import {contextBridge,ipcRenderer} from 'electron';import type {DesktopApi} from '../shared/types';
const api:DesktopApi={
 bufferEpisodes:ids=>ipcRenderer.invoke('buffer-episodes',ids),
 bufferState:()=>ipcRenderer.invoke('buffer-state'),retryBuffer:()=>ipcRenderer.invoke('buffer-retry'),
 cacheState:()=>ipcRenderer.invoke('cache-state'),cacheAdd:id=>ipcRenderer.invoke('cache-add',id),cacheAction:(id,action)=>ipcRenderer.invoke('cache-action',id,action),
 cacheConcurrency:value=>ipcRenderer.invoke('cache-concurrency',value),cacheDeleteWatched:()=>ipcRenderer.invoke('cache-delete-watched'),recommendations:(id,refresh)=>ipcRenderer.invoke('recommendations',id,refresh),
 cacheLimits:value=>ipcRenderer.invoke('cache-limits',value),cachePriority:(id,priority)=>ipcRenderer.invoke('cache-priority',id,priority),videoQuality:quality=>ipcRenderer.invoke('video-quality',quality),exportDiagnostics:()=>ipcRenderer.invoke('diagnostics-export'),
 cacheChooseDirectory:()=>ipcRenderer.invoke('cache-directory'),cacheOpenDirectory:()=>ipcRenderer.invoke('cache-open-directory'),cacheCloseToTray:enabled=>ipcRenderer.invoke('cache-close-to-tray',enabled),
 onBackground:listener=>{const handler=(_event:Electron.IpcRendererEvent,background:boolean)=>listener(background);ipcRenderer.on('window-background',handler);return()=>{ipcRenderer.removeListener('window-background',handler)}},
 catalog:(board,offset)=>ipcRenderer.invoke('catalog',board,offset),search:(query,offset)=>ipcRenderer.invoke('search',query,offset),importShare:text=>ipcRenderer.invoke('share',text),series:id=>ipcRenderer.invoke('series',id),playback:(id,force,quality)=>ipcRenderer.invoke('playback',id,force,quality),library:()=>ipcRenderer.invoke('library'),favorite:(work,enabled)=>ipcRenderer.invoke('favorite',work,enabled),progress:value=>ipcRenderer.invoke('progress',value),checkUpdate:()=>ipcRenderer.invoke('update'),
 updateState:()=>ipcRenderer.invoke('update-state'),downloadUpdate:()=>ipcRenderer.invoke('update-download'),installUpdate:()=>ipcRenderer.invoke('update-install'),
 onUpdate:listener=>{const handler=(_event:Electron.IpcRendererEvent,state:Parameters<typeof listener>[0])=>listener(state);ipcRenderer.on('update-status',handler);return ()=>{ipcRenderer.removeListener('update-status',handler);};},
};contextBridge.exposeInMainWorld('desktop',api);
