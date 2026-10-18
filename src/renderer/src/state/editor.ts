import { create } from 'zustand'
import type { EditorSettings, ExportJob, FaceCamSettings, PreviewJob } from '../../../shared/contracts'
export const defaultFaceCam:FaceCamSettings={enabled:false,x:.68,y:.62,width:.24,height:.28,size:.3,placement:'bottom',positionX:.5,positionY:.88}
export const useEditor = create<{
  duration:number; start:number; end:number; cropX:number; cropY:number; muted:boolean; fps:30|60; faceCam:FaceCamSettings
  previewJob:PreviewJob|null; previewStarting:boolean; setPreviewJob:(job:PreviewJob|null)=>void; setPreviewStarting:(value:boolean)=>void
  mediaStatus:'loading'|'ready'|'error'; job:ExportJob|null; exportChoosing:boolean; message:string|null; saveStatus:'saved'|'saving'|'error'; hydrated:boolean; dirty:boolean
  reset:()=>void; hydrate:(settings:EditorSettings)=>void; loaded:(duration:number)=>void; trim:(start:number,end:number)=>void
  setCrop:(axis:'cropX'|'cropY',value:number)=>void; setMuted:(value:boolean)=>void; setFps:(value:30|60)=>void
  setFaceCam:(faceCam:FaceCamSettings)=>void
  setMediaError:()=>void; setJob:(job:ExportJob|null)=>void; setChoosing:(value:boolean)=>void; setMessage:(value:string|null)=>void; setSaveStatus:(value:'saved'|'saving'|'error')=>void; markSaved:(settings:EditorSettings)=>void
}>((set,get)=>({
  previewJob:null,previewStarting:false,duration:0,start:0,end:0,cropX:.5,cropY:.5,muted:false,fps:30,faceCam:{...defaultFaceCam},mediaStatus:'loading',job:null,exportChoosing:false,message:null,saveStatus:'saved',hydrated:false,dirty:false,
  reset:()=>set({previewJob:null,previewStarting:false,duration:0,start:0,end:0,cropX:.5,cropY:.5,muted:false,fps:30,faceCam:{...defaultFaceCam},mediaStatus:'loading',job:null,exportChoosing:false,message:null,saveStatus:'saved',hydrated:false,dirty:false}),
  hydrate:(settings)=>set({...settings,faceCam:settings.faceCam||{...defaultFaceCam},hydrated:true,dirty:false}),
  loaded:(duration)=>{if(Number.isFinite(duration)&&duration>0){const previous=get();set({duration,start:Math.min(previous.start,Math.max(0,duration-.1)),end:Math.min(previous.end>0?previous.end:60,duration),mediaStatus:'ready'})}else set({mediaStatus:'error'})},
  setPreviewJob:(previewJob)=>set({previewJob}),setPreviewStarting:(previewStarting)=>set({previewStarting}),
  trim:(start,end)=>{if(get().job?.status==='running'||get().exportChoosing)return; const d=get().duration;if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start&&end<=d)set({start,end,dirty:true})},
  setCrop:(axis,value)=>{if(get().job?.status!=='running'&&!get().exportChoosing)set({[axis]:Math.max(0,Math.min(1,value)),dirty:true})},
  setFaceCam:(faceCam)=>{if(get().job?.status!=='running'&&!get().exportChoosing)set({faceCam:{...faceCam},dirty:true})},
  setMuted:(muted)=>set({muted,dirty:true}),setFps:(fps)=>set({fps,dirty:true}),setMediaError:()=>set({mediaStatus:'error'}),
  setJob:(job)=>set({job}),setChoosing:(exportChoosing)=>set({exportChoosing}),setMessage:(message)=>set({message}),setSaveStatus:(saveStatus)=>set({saveStatus}),markSaved:(settings)=>{const current=get();if(JSON.stringify({start:current.start,end:current.end,cropX:current.cropX,cropY:current.cropY,muted:current.muted,fps:current.fps,faceCam:current.faceCam})===JSON.stringify(settings))set({dirty:false,saveStatus:'saved'})},
}))
