import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState} from 'react';
import type {ReactNode} from 'react';

type FrameHandoff={attach:(stage:HTMLDivElement)=>void;watch:(video:HTMLVideoElement)=>()=>void};
const HandoffContext=createContext<FrameHandoff|null>(null);

// Keep the decoded picture outside the lifetime of an episode-keyed Player.
// A new URL / canplay event is not proof that the compositor has a new frame.
export function useFrameHandoff(video:{current:HTMLVideoElement|null}){
 const handoff=useContext(HandoffContext);
 const detach=useRef<(()=>void)|undefined>(undefined);
 const videoRef=useCallback((element:HTMLVideoElement|null)=>{
  detach.current?.();detach.current=undefined;video.current=element;
  if(element&&handoff)detach.current=handoff.watch(element);
 },[handoff,video]);
 const stageRef=useCallback((element:HTMLDivElement|null)=>{if(element)handoff?.attach(element)},[handoff]);
 return {videoRef,stageRef};
}

// The fullscreen target must survive episode-keyed Player replacements.
export function PlayerSurface({episodeId,children}:{episodeId:string;children:ReactNode}){
 const surface=useRef<HTMLDivElement>(null);
 const handoff=useMemo<FrameHandoff>(()=>{
  // Reparent this one canvas into the incoming stage; never stretch a video frame.
  const canvas=document.createElement('canvas');canvas.className='player-handoff';canvas.hidden=true;canvas.setAttribute('aria-hidden','true');
  let generation=0;
  return {
   attach(stage){stage.append(canvas)},
   watch(video){
    const owner=++generation;let presented=false,disposed=false;
    const frame=video.requestVideoFrameCallback(()=>{
     if(disposed||owner!==generation)return;
     presented=true;canvas.hidden=true;surface.current?.removeAttribute('data-frame-held');
    });
    return()=>{
     disposed=true;video.cancelVideoFrameCallback(frame);
     if(owner!==generation||!presented||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
     try{
      canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const context=canvas.getContext('2d');if(!context)return;
      context.drawImage(video,0,0);canvas.hidden=false;surface.current?.setAttribute('data-frame-held','true');
     }catch{
      // A protected or unavailable frame must not leave an empty retained layer.
      canvas.hidden=true;surface.current?.removeAttribute('data-frame-held');
     }
    };
   },
  };
 },[]);
 const [fullscreen,setFullscreen]=useState(false);
 const [playing,setPlaying]=useState(false);
 const [hidden,setHidden]=useState(false);
 const [activity,setActivity]=useState(0);
 const [overControls,setOverControls]=useState(false);
 const [keyboardControls,setKeyboardControls]=useState(false);
 const [dragging,setDragging]=useState(false);
 function reveal(){setHidden(false);setActivity(value=>value+1);}
 useEffect(()=>{
  const changed=()=>{setFullscreen(document.fullscreenElement===surface.current);reveal();};
  document.addEventListener('fullscreenchange',changed);
  const released=()=>setDragging(false);window.addEventListener('pointerup',released);window.addEventListener('pointercancel',released);
  return ()=>{document.removeEventListener('fullscreenchange',changed);window.removeEventListener('pointerup',released);window.removeEventListener('pointercancel',released);};
 },[]);
 useEffect(()=>{setPlaying(false);setHidden(false);setOverControls(false);setKeyboardControls(false);setDragging(false);},[episodeId]);
 useEffect(()=>{
  if(!fullscreen||!playing||overControls||keyboardControls||dragging){setHidden(false);return;}
  const timer=window.setTimeout(()=>setHidden(true),2500);
  return ()=>window.clearTimeout(timer);
 },[fullscreen,playing,activity,overControls,keyboardControls,dragging]);
 const inControls=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('.player-controls');
 return <div ref={surface} className={`player-surface${fullscreen&&hidden?' controls-hidden':''}`}
  onPointerMove={event=>{reveal();setOverControls(inControls(event.target));}}
  onPointerLeave={()=>setOverControls(false)}
  onPointerDown={event=>{reveal();setKeyboardControls(false);if(inControls(event.target))setDragging(true);}}
  onKeyDownCapture={event=>{reveal();if(event.key==='Tab'||inControls(event.target))setKeyboardControls(true);}}
  onBlurCapture={event=>{if(!inControls(event.relatedTarget))setKeyboardControls(false);}}
  onPlayCapture={()=>setPlaying(true)} onPauseCapture={()=>setPlaying(false)} onEndedCapture={()=>setPlaying(false)}>
  <HandoffContext.Provider value={handoff}>{children}</HandoffContext.Provider>
 </div>;
}
