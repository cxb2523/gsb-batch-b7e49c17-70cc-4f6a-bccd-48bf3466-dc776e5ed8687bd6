import {useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import type {KeyboardEvent} from 'react';
import type {UpdateState} from '../shared/types';

export function UpdatePrompt({state,onLater,onDownload}:{state:UpdateState;onLater:()=>void;onDownload:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),later=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const previous=document.activeElement;const element=dialog.current;element?.showModal();later.current?.focus();return()=>{element?.close();if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()}},[]);
 function keyboard(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onLater();return}
  if(event.key!=='Tab')return;
  const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');if(!buttons?.length)return;
  const first=buttons[0],last=buttons[buttons.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 return createPortal(<dialog ref={dialog} className="update-prompt-host" aria-labelledby="update-prompt-title" aria-describedby="update-prompt-description" onKeyDown={keyboard} onCancel={event=>{event.preventDefault();onLater()}}><section className="update-prompt">
  <button className="modal-close icon-button" aria-label="暂不更新并关闭提示" onClick={onLater}>×</button>
  <div className="update-prompt-icon" aria-hidden="true">↑</div><span className="eyebrow">APP UPDATE</span><h2 id="update-prompt-title">发现新版本</h2>
  <p id="update-prompt-description">红果漫剧有新版本可用，是否现在下载更新？</p>
  <div className="update-prompt-versions"><span>当前版本 {state.currentVersion}</span><b>新版本 {state.nextVersion}</b></div>
  <p className="update-prompt-note">点击“立即更新”才下载安装包。下载完成后，由你确认重启安装；收藏和观看进度会保留。</p>
  <div className="update-prompt-actions"><button ref={later} className="secondary-button" onClick={onLater}>暂不更新</button><button className="primary-button" onClick={onDownload}>立即更新</button></div>
 </section></dialog>,document.body);
}
