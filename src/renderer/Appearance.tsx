import {useEffect,useRef} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import type {UiTheme} from './ui-theme';
import {UI_THEMES} from './ui-theme';

export function AppearanceDialog({theme,onChange,onClose}:{theme:UiTheme;onChange:(theme:UiTheme)=>void;onClose:()=>void}){
 const active=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const previous=document.activeElement;
  const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}};
  window.addEventListener('keydown',handler);
  return()=>{window.removeEventListener('keydown',handler);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus()};
 },[onClose]);
 useEffect(()=>{active.current?.focus()},[theme]);
 const current=UI_THEMES.find(item=>item.key===theme)??UI_THEMES[0];
 function trap(event:ReactKeyboardEvent<HTMLElement>){
  if(event.key!=='Tab')return;
  const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if(!buttons.length)return;
  const first=buttons[0],last=buttons[buttons.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 return <div className="modal-backdrop appearance-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="appearance-modal" role="dialog" aria-modal="true" aria-labelledby="appearance-title" onKeyDown={trap}>
   <button className="modal-close icon-button" aria-label="关闭外观设置" onClick={onClose}>×</button>
   <span className="eyebrow">APPEARANCE</span>
   <h2 id="appearance-title">选择界面风格</h2>
   <p className="appearance-lead">换一种气质，功能和观看记录都不会变。选择会保存在本机，随时可以回到默认的「宣纸书卷」。</p>
   <div className="appearance-grid" role="radiogroup" aria-label="界面风格">
    {UI_THEMES.map(option=>{
     const selected=option.key===theme;
     return <button key={option.key} ref={selected?active:undefined} className={`appearance-option ${selected?'selected':''}`} role="radio" aria-checked={selected} onClick={()=>onChange(option.key)}>
      <span className={`theme-preview preview-${option.key}`} aria-hidden="true">
       <span className="tp-bar"><i/><i/><i/><b/></span>
       <span className="tp-hero"><span className="tp-title">漫剧</span><span className="tp-lines"><i/><i/></span></span>
       <span className="tp-posters"><i/><i/><i/><i/></span>
      </span>
      <span className="appearance-copy">
       <span className="appearance-name">{option.name}{selected&&<span className="appearance-current">使用中</span>}</span>
       <span className="appearance-en">{option.en}</span>
       <span className="appearance-desc">{option.description}</span>
      </span>
     </button>;
    })}
   </div>
   <div className="appearance-footer">
    <button className="secondary-button appearance-reset" disabled={theme==='paper'} onClick={()=>onChange('paper')}>{theme==='paper'?'当前已是默认外观':'恢复默认「宣纸书卷」'}</button>
    <button className="primary-button" onClick={onClose}>完成</button>
   </div>
   <p className="appearance-note">当前：{current.name} · 只影响配色与排版，不会改变播放、缓存或观看记录。</p>
  </section>
 </div>;
}