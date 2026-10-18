import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisJob, BatchExportJob, ClipFramingSettings, EditorSettings, PickedVideo, ProjectCategory, TrackingJob } from '../../../shared/contracts'
import { defaultFaceCam, useEditor } from '../state/editor'
import { interpolateFraming } from '../../../shared/framing'
const stamp=(v:number)=>`${Math.floor(v/60).toString().padStart(2,'0')}:${Math.floor(v%60).toString().padStart(2,'0')}`
export function Editor({source,language,onBack,projectId,initialSettings,category,categorySaving,categoryError,onCategoryChange}:{source:PickedVideo;language:'ar'|'en';onBack:()=>void;projectId:string;initialSettings:EditorSettings;category:ProjectCategory;categorySaving:boolean;categoryError:string|null;onCategoryChange:(category:ProjectCategory)=>void}) {
  const ar=language==='ar', e=useEditor(), video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),faceCamDrag=useRef<{x:number;y:number}|null>(null),trackingDrag=useRef<{x:number;y:number}|null>(null)
  const [trackingBox,setTrackingBox]=useState<{x:number;y:number;width:number;height:number}|null>(null),[trackingDraft,setTrackingDraft]=useState<{x:number;y:number;width:number;height:number}|null>(null),[trackingSelecting,setTrackingSelecting]=useState(false),[trackingJob,setTrackingJob]=useState<TrackingJob|null>(null),[trackingStarting,setTrackingStarting]=useState(false)
  const appliedTracking=useRef('')
  const [faceCamDraft,setFaceCamDraft]=useState<{x:number;y:number;width:number;height:number}|null>(null)
  const getVideoPoint=(event:React.PointerEvent<HTMLDivElement>)=>{
    const box=stage.current?.getBoundingClientRect(),v=video.current
    if(!box||!v?.videoWidth||!v.videoHeight)return null
    const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),width=v.videoWidth*scale,height=v.videoHeight*scale
    return {x:Math.max(0,Math.min(1,(event.clientX-box.left-(box.width-width)/2)/width)),y:Math.max(0,Math.min(1,(event.clientY-box.top-(box.height-height)/2)/height))}
  }
  const categoryNames:Record<ProjectCategory,string>=ar?{general:'عام',gaming:'ألعاب',podcast:'بودكاست',interview:'مقابلة',reaction:'رد فعل',education:'تعليمي'}:{general:'General',gaming:'Gaming',podcast:'Podcast',interview:'Interview',reaction:'Reaction',education:'Educational'}
  const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[buffering,setBuffering]=useState(false)
  const [analysisJob,setAnalysisJob]=useState<AnalysisJob|null>(()=>initialSettings.analysis?{id:'restored',status:'complete',progress:1,range:initialSettings.analysis.range,sceneChanges:initialSettings.analysis.sceneChanges,suggestions:initialSettings.analysis.suggestions}:null),[analysisStart,setAnalysisStart]=useState(initialSettings.analysis?.range.start??0),[analysisEnd,setAnalysisEnd]=useState(initialSettings.analysis?.range.end??60),[analysisStarting,setAnalysisStarting]=useState(false),[selectedClips,setSelectedClips]=useState<string[]>(initialSettings.analysis?.selectedIds??[]),[analysisDirty,setAnalysisDirty]=useState(false)
  const [activeClipId,setActiveClipId]=useState<string|null>(null),[clipFramingHistory,setClipFramingHistory]=useState<Array<{id:string;value:ClipFramingSettings}>>([]),[clipFramingFuture,setClipFramingFuture]=useState<Array<{id:string;value:ClipFramingSettings}>>([])
  const analysisSnapshotRef=useRef<EditorSettings['analysis']>(initialSettings.analysis)
  const activeSuggestion=analysisJob?.suggestions.find(item=>item.id===activeClipId)
  const sharedFraming:ClipFramingSettings={cropX:e.cropX,cropY:e.cropY,zoom:e.zoom,keyframes:e.keyframes,trackingLosses:e.trackingLosses,faceCam:e.faceCam}
  const currentClipFraming=activeSuggestion?.framing??sharedFraming
  const currentFaceCam=currentClipFraming.faceCam
  const currentKeyframes=currentClipFraming.keyframes
  const currentTrackingLosses=currentClipFraming.trackingLosses
  const currentFraming=useMemo(()=>interpolateFraming(time,currentKeyframes,{cropX:currentClipFraming.cropX,cropY:currentClipFraming.cropY,zoom:currentClipFraming.zoom}),[time,currentKeyframes,currentClipFraming.cropX,currentClipFraming.cropY,currentClipFraming.zoom])
  const currentKeyframe=currentKeyframes.find(frame=>Math.abs(frame.time-time)<.06)
  const visibleKeyframes=currentKeyframes.length>80?currentKeyframes.filter(frame=>Math.abs(frame.time-time)<=15):currentKeyframes
  const faceCamPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(busy||(!trackingSelecting&&!currentFaceCam.enabled))return
    const point=getVideoPoint(event);if(!point)return
    if(trackingSelecting){trackingDrag.current=point;event.currentTarget.setPointerCapture(event.pointerId);setTrackingDraft({x:point.x,y:point.y,width:0,height:0});return}
    faceCamDrag.current=point;event.currentTarget.setPointerCapture(event.pointerId);setFaceCamDraft({x:point.x,y:point.y,width:0,height:0})
  }
  const faceCamPointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    const trackingOrigin=trackingDrag.current;if(trackingOrigin){const point=getVideoPoint(event);if(!point)return;setTrackingDraft({x:Math.min(trackingOrigin.x,point.x),y:Math.min(trackingOrigin.y,point.y),width:Math.abs(point.x-trackingOrigin.x),height:Math.abs(point.y-trackingOrigin.y)});return}
    const origin=faceCamDrag.current;if(!origin)return
    const point=getVideoPoint(event);if(!point)return
    setFaceCamDraft({x:Math.min(origin.x,point.x),y:Math.min(origin.y,point.y),width:Math.abs(point.x-origin.x),height:Math.abs(point.y-origin.y)})
  }
  const faceCamPointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{
    const tracking=trackingDraft;trackingDrag.current=null
    if(tracking){setTrackingDraft(null);if(tracking.width>=.02&&tracking.height>=.02)setTrackingBox(tracking)}
    const draft=faceCamDraft;faceCamDrag.current=null;setFaceCamDraft(null)
    if(draft&&draft.width>=.02&&draft.height>=.02)updateFaceCam({...currentFaceCam,x:draft.x,y:draft.y,width:draft.width,height:draft.height})
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const faceCamRect=faceCamDraft||currentFaceCam
  const sourceBoxStyle=(rect:{x:number;y:number;width:number;height:number}={...currentFaceCam,...(faceCamDraft||{})})=>{
    const box=stage.current?.getBoundingClientRect(),v=video.current
    if(!box||!v?.videoWidth||!v.videoHeight)return {}
    const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),width=v.videoWidth*scale,height=v.videoHeight*scale
    return {left:`${(box.width-width)/2+rect.x*width}px`,top:`${(box.height-height)/2+rect.y*height}px`,width:`${rect.width*width}px`,height:`${rect.height*height}px`}
  }
  const [batchJob,setBatchJob]=useState<BatchExportJob|null>(null),[batchStarting,setBatchStarting]=useState(false)
  const [previewUrl,setPreviewUrl]=useState(source.mediaUrl)
  const attemptedPreview=useRef(false),resumeTime=useRef(0)
  const preparing=e.previewStarting||e.previewJob?.status==='running'
  const analyzing=analysisStarting||analysisJob?.status==='running'
  const trackingBusy=trackingStarting||trackingJob?.status==='running'
  const batchBusy=batchStarting||batchJob?.status==='running'
  const busy=preparing||analyzing||trackingBusy||e.exportChoosing||e.job?.status==='running'||batchBusy,ready=e.mediaStatus==='ready'
  const saveSnapshot=async(snapshot:EditorSettings)=>{
    const complete={...snapshot,...(analysisSnapshotRef.current?{analysis:analysisSnapshotRef.current}:{})}
    const result=await window.youcut.saveProject(projectId,complete)
    useEditor.getState().markSaved(snapshot)
    if(JSON.stringify(analysisSnapshotRef.current)===JSON.stringify(complete.analysis))setAnalysisDirty(false)
    if(result.backupWarning)useEditor.getState().setMessage(ar?'تم حفظ المشروع، لكن مجلد النسخ الاحتياطي غير متاح.':'Project saved, but the backup folder is unavailable.')
  }
  const writeSuggestionFraming=(id:string,value:ClipFramingSettings)=>setAnalysisJob(current=>current?{...current,suggestions:current.suggestions.map(item=>item.id===id?{...item,framing:value}:item)}:current)
  const applyClipFraming=(value:ClipFramingSettings,recordHistory=true)=>{
    if(!activeSuggestion)return
    if(recordHistory)setClipFramingHistory(current=>[...current,{id:activeSuggestion.id,value:currentClipFraming}].slice(-100))
    setClipFramingFuture([]);writeSuggestionFraming(activeSuggestion.id,value)
  }
  const updateFaceCam=(faceCam:ClipFramingSettings['faceCam'])=>{
    if(activeSuggestion)applyClipFraming({...currentClipFraming,faceCam})
    else e.setFaceCam(faceCam)
  }
  const undoClipFraming=()=>{
    if(!activeSuggestion)return
    const previous=clipFramingHistory.at(-1)
    if(!previous||previous.id!==activeSuggestion.id)return
    setClipFramingHistory(current=>current.slice(0,-1));setClipFramingFuture(current=>[...current,{id:activeSuggestion.id,value:currentClipFraming}].slice(-100));writeSuggestionFraming(activeSuggestion.id,previous.value)
  }
  const redoClipFraming=()=>{
    if(!activeSuggestion)return
    const next=clipFramingFuture.at(-1)
    if(!next||next.id!==activeSuggestion.id)return
    setClipFramingFuture(current=>current.slice(0,-1));setClipFramingHistory(current=>[...current,{id:activeSuggestion.id,value:currentClipFraming}].slice(-100));writeSuggestionFraming(activeSuggestion.id,next.value)
  }
  useEffect(()=>{useEditor.getState().reset();useEditor.getState().hydrate(initialSettings);setTime(initialSettings.start);setPlaying(false);setPreviewUrl(source.mediaUrl);attemptedPreview.current=false;return()=>{void window.youcut.cancelPreview(source.mediaUrl).catch(()=>{})}},[source.mediaUrl,projectId])
  useEffect(()=>{
    const saveBeforeClose=()=>{const state=useEditor.getState();if(state.dirty||analysisDirty)window.youcut.flushProject(projectId,{start:state.start,end:state.end,cropX:state.cropX,cropY:state.cropY,zoom:state.zoom,keyframes:state.keyframes,trackingLosses:state.trackingLosses,muted:state.muted,fps:state.fps,faceCam:state.faceCam,...(analysisSnapshotRef.current?{analysis:analysisSnapshotRef.current}:{})})}
    window.addEventListener('beforeunload',saveBeforeClose)
    return()=>{window.removeEventListener('beforeunload',saveBeforeClose);saveBeforeClose()}
  },[projectId,analysisDirty])
  useEffect(()=>{
    if(!e.hydrated||(!e.dirty&&!analysisDirty)||busy)return
    const snapshot:EditorSettings={start:e.start,end:e.end,cropX:e.cropX,cropY:e.cropY,zoom:e.zoom,keyframes:e.keyframes,trackingLosses:e.trackingLosses,muted:e.muted,fps:e.fps,faceCam:e.faceCam,...(analysisSnapshotRef.current?{analysis:analysisSnapshotRef.current}:{})}
    const timer=setTimeout(()=>{
      e.setSaveStatus('saving')
      void saveSnapshot(snapshot).catch(error=>{e.setSaveStatus('error');e.setMessage(error instanceof Error?error.message:'Project save failed.')})
    },5000)
    return()=>clearTimeout(timer)
  },[projectId,e.hydrated,e.dirty,e.start,e.end,e.cropX,e.cropY,e.zoom,e.keyframes,e.trackingLosses,e.muted,e.fps,e.faceCam,busy,analysisDirty])
  useEffect(()=>{
    if(e.mediaStatus!=='loading')return
    const timer=setTimeout(()=>{if(video.current?.readyState===0)e.setMediaError()},30000)
    return()=>clearTimeout(timer)
  },[e.mediaStatus,source.mediaUrl])
  useEffect(()=>{
    let frame=0
    const draw=()=>{
      const v=video.current,c=canvas.current
      if(v&&c&&v.readyState>=2&&v.videoWidth&&v.videoHeight) {
        const w=Math.min(v.videoWidth,v.videoHeight*9/16),h=Math.min(v.videoHeight,v.videoWidth*16/9)
        const context=c.getContext('2d')
        if(context){
          const cropWidth=w/currentFraming.zoom,cropHeight=h/currentFraming.zoom
          context.drawImage(v,(v.videoWidth-cropWidth)*currentFraming.cropX,(v.videoHeight-cropHeight)*currentFraming.cropY,cropWidth,cropHeight,0,0,c.width,c.height)
          if(currentFaceCam.enabled){
            const sx=v.videoWidth*currentFaceCam.x,sy=v.videoHeight*currentFaceCam.y,sw=v.videoWidth*currentFaceCam.width,sh=v.videoHeight*currentFaceCam.height
            let dw=c.width*currentFaceCam.size,dh=dw/(sw/sh)
            const maxHeight=c.height*currentFaceCam.size
            if(dh>maxHeight){dh=maxHeight;dw=dh*(sw/sh)}
            const dx=(c.width-dw)*currentFaceCam.positionX,dy=(c.height-dh)*currentFaceCam.positionY
            context.save();context.shadowColor='#0009';context.shadowBlur=12;context.drawImage(v,sx,sy,sw,sh,dx,dy,dw,dh);context.shadowBlur=0;context.strokeStyle='#f1d28f';context.lineWidth=3;context.strokeRect(dx,dy,dw,dh);context.restore()
          }
        }
      }
      frame=requestAnimationFrame(draw)
    };draw();return()=>cancelAnimationFrame(frame)
  },[currentFraming.cropX,currentFraming.cropY,currentFraming.zoom,currentFaceCam,source.mediaUrl])
  useEffect(()=>{
    if(e.job?.status!=='running')return
    let alive=true
    const timer=setInterval(()=>{void window.youcut.getExportJob().then(job=>{if(alive)e.setJob(job)}).catch(()=>{if(alive)e.setMessage(ar?'تعذر قراءة حالة التصدير.':'Cannot read export status.')})},400)
    return()=>{alive=false;clearInterval(timer)}
  },[e.job?.status,ar])
  useEffect(()=>{
    if(batchJob?.status!=='running')return
    let alive=true
    const timer=setInterval(()=>{void window.youcut.getBatchExportJob().then(job=>{if(alive&&job)setBatchJob(job)}).catch(error=>{if(alive)e.setMessage(error instanceof Error?error.message:'Batch export status is unavailable.')})},350)
    return()=>{alive=false;clearInterval(timer)}
  },[batchJob?.status])
  useEffect(()=>{
    if(e.previewJob?.status!=='running')return
    let alive=true
    const timer=setInterval(()=>{void window.youcut.getPreviewJob(source.mediaUrl).then(job=>{
      if(!alive||!job)return
      e.setPreviewJob(job)
      if(job.status==='complete'&&job.mediaUrl){setPreviewUrl(job.mediaUrl);e.setMessage(ar?'تم تجهيز معاينة متوافقة. التصدير سيستخدم الفيديو الأصلي.':'Compatible preview ready. Exports use the original video.')}
      if(job.status==='cancelled'||job.status==='error')e.setMediaError()
    }).catch(()=>{if(alive)e.setMessage(ar?'تعذر قراءة حالة تجهيز المعاينة.':'Cannot read preview preparation status.')})},400)
    return()=>{alive=false;clearInterval(timer)}
  },[e.previewJob?.status,source.mediaUrl,ar])
  useEffect(()=>{
    if(analysisJob?.status!=='running')return
    let alive=true
    const timer=setInterval(()=>{void window.youcut.getAnalysisJob().then(job=>{if(alive&&job)setAnalysisJob(job)}).catch(error=>{if(alive)setAnalysisJob(current=>current?{...current,status:'error',error:error instanceof Error?error.message:'Analysis status is unavailable.'}:current)})},400)
    return()=>{alive=false;clearInterval(timer)}
  },[analysisJob?.status])
  useEffect(()=>{
    if(analysisJob?.status!=='complete')return
    analysisSnapshotRef.current={range:analysisJob.range,sceneChanges:analysisJob.sceneChanges,suggestions:analysisJob.suggestions,selectedIds:selectedClips.filter(id=>analysisJob.suggestions.some(item=>item.id===id))}
    setAnalysisDirty(true)
  },[analysisJob?.status,analysisJob?.id,analysisJob?.suggestions,selectedClips])
  useEffect(()=>{
    if(trackingJob?.status!=='running')return
    let alive=true
    const timer=setInterval(()=>{void window.youcut.getTrackingJob().then(job=>{if(alive&&job)setTrackingJob(job)}).catch(error=>{if(alive)setTrackingJob(current=>current?{...current,status:'error',error:error instanceof Error?error.message:'Tracking status is unavailable.'}:current)})},400)
    return()=>{alive=false;clearInterval(timer)}
  },[trackingJob?.status])
  useEffect(()=>{
    if(trackingJob?.status!=='complete'||appliedTracking.current===trackingJob.id||!trackingJob.keyframes.length)return
    appliedTracking.current=trackingJob.id
    const from=trackingJob.keyframes[0].time,to=trackingJob.keyframes.at(-1)!.time
    const nextFrames=[...currentKeyframes.filter(frame=>frame.time<from-.001||frame.time>to+.001),...trackingJob.keyframes]
    const nextLosses=[...currentTrackingLosses.filter(value=>value<from-.001||value>to+.001),...trackingJob.lostAt]
    if(activeSuggestion)applyClipFraming({...currentClipFraming,keyframes:nextFrames,trackingLosses:nextLosses})
    else e.replaceKeyframes(nextFrames,nextLosses)
    setTrackingSelecting(false)
  },[trackingJob?.status,trackingJob?.id,activeClipId,currentKeyframes,currentTrackingLosses])
  const startAnalysis=async()=>{
    if(analyzing||e.job?.status==='running')return
    if(analysisEnd<=analysisStart||analysisEnd-analysisStart>300){e.setMessage(ar?'اختر جزءًا لا يتجاوز خمس دقائق.':'Choose an analysis range up to five minutes.');return}
    setAnalysisStarting(true);setAnalysisJob(null);setSelectedClips([]);setActiveClipId(null);e.setMessage(null)
    try{setAnalysisJob(await window.youcut.startAnalysis(source.mediaUrl,analysisStart,analysisEnd))}
    catch(error){setAnalysisJob({id:'failed',status:'error',progress:0,range:{start:analysisStart,end:analysisEnd},sceneChanges:[],suggestions:[],error:error instanceof Error?error.message:'Scene analysis failed.'})}
    finally{setAnalysisStarting(false)}
  }
  const startTracking=async()=>{
    const v=video.current,box=trackingBox
    if(!box||!v?.videoWidth||!v.videoHeight||trackingBusy||busy)return
    const start=time
    if(start<(activeSuggestion?.start??e.start)||start>=(activeSuggestion?.end??e.end)){e.setMessage(ar?'حرّك المؤشر إلى داخل المقطع قبل بدء التتبع.':'Move the playhead inside the clip before tracking.');return}
    setTrackingStarting(true);setTrackingJob(null);e.setMessage(null);v.pause()
    try{setTrackingJob(await window.youcut.startTracking({mediaUrl:source.mediaUrl,start,end:activeSuggestion?.end??e.end,region:box,sourceWidth:v.videoWidth,sourceHeight:v.videoHeight,zoom:currentFraming.zoom}))}
    catch(error){setTrackingJob({id:'failed',status:'error',progress:0,keyframes:[],lostAt:[],error:error instanceof Error?error.message:'Object tracking failed.'})}
    finally{setTrackingStarting(false)}
  }
  const preparePreview=async()=>{
    if(preparing||e.job?.status==='running')return
    attemptedPreview.current=true;resumeTime.current=video.current?.currentTime||0
    video.current?.pause();e.setPreviewStarting(true);e.setMessage(null)
    try{e.setPreviewJob(await window.youcut.preparePreview(source.mediaUrl))}
    catch(error){e.setMessage(error instanceof Error?error.message:'Preview preparation failed.');e.setMediaError()}
    finally{e.setPreviewStarting(false)}
  }
  const mediaError=()=>{
    const code=video.current?.error?.code
    e.setMediaError();setBuffering(false)
    if(!attemptedPreview.current&&previewUrl===source.mediaUrl&&(code===3||code===4))void preparePreview()
    else if(code===2)e.setMessage(ar?'تعذر قراءة الملف المحلي. تأكد أنه متاح ثم أعد المحاولة.':'The local file could not be read. Check it is available and retry.')
  }
  const seek=(value:number)=>{if(video.current&&Number.isFinite(value)){video.current.currentTime=Math.max(0,Math.min(e.duration,value));setTime(video.current.currentTime)}}
  const changeFraming=(field:'cropX'|'cropY'|'zoom',value:number)=>{
    const next={...currentFraming,[field]:field==='zoom'?Math.max(1,Math.min(3,value)):Math.max(0,Math.min(1,value))}
    if(activeSuggestion){
      if(currentKeyframes.length){const frames=currentKeyframes.slice(),index=frames.findIndex(frame=>Math.abs(frame.time-time)<.06),keyframe={time,cropX:next.cropX,cropY:next.cropY,zoom:next.zoom};if(index>=0)frames[index]=keyframe;else frames.push(keyframe);frames.sort((a,b)=>a.time-b.time);applyClipFraming({...currentClipFraming,keyframes:frames})}
      else applyClipFraming({...currentClipFraming,[field]:next[field]})
    }
    else if(e.keyframes.length)e.upsertKeyframe({time,cropX:next.cropX,cropY:next.cropY,zoom:next.zoom})
    else if(field==='zoom')e.setZoom(next.zoom)
    else e.setCrop(field,next[field])
  }
  const addOrUpdateKeyframe=()=>{
    const point={time,cropX:currentFraming.cropX,cropY:currentFraming.cropY,zoom:currentFraming.zoom}
    if(activeSuggestion){const frames=currentKeyframes.slice(),index=frames.findIndex(frame=>Math.abs(frame.time-time)<.06);if(index>=0)frames[index]=point;else frames.push(point);frames.sort((a,b)=>a.time-b.time);applyClipFraming({...currentClipFraming,keyframes:frames})}
    else e.upsertKeyframe(point)
  }
  const removeCurrentKeyframe=()=>{
    if(activeSuggestion)applyClipFraming({...currentClipFraming,keyframes:currentKeyframes.filter(frame=>Math.abs(frame.time-time)>=.06)})
    else e.removeKeyframe(time)
  }
  const undoFraming=()=>activeSuggestion?undoClipFraming():e.undoKeyframe()
  const redoFraming=()=>activeSuggestion?redoClipFraming():e.redoKeyframe()
  const play=async()=>{
    const v=video.current;if(!v)return
    if(!v.paused){v.pause();return}
    const clipStart=activeSuggestion?.start??e.start,clipEnd=activeSuggestion?.end??e.end
    if(v.currentTime<clipStart||v.currentTime>=clipEnd)seek(clipStart)
    try{await v.play()}catch{e.setMessage(ar?'تعذر تشغيل الفيديو. جرّب ملف MP4 بترميز H.264.':'Cannot play this video. Try an H.264 MP4 file.')}
  }
  const timelineKeyDown=(event:React.KeyboardEvent<HTMLInputElement>)=>{
    if(event.code==='Space'||event.key===' '||event.key.toLowerCase()==='space'){event.preventDefault();event.stopPropagation();if(ready&&!busy)void play()}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();if(ready&&!busy)seek((video.current?.currentTime||time)+(event.key==='ArrowRight'?1:-1))}
  }
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.altKey)return
      const target=event.target
      const timelineFocused=target instanceof HTMLInputElement&&target.id==='playhead'
      if(target instanceof HTMLElement&&(target.isContentEditable||(/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)&&!timelineFocused)))return
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();if(event.shiftKey)redoFraming();else undoFraming();return}
      if(event.ctrlKey||event.metaKey)return
      if(event.key.toLowerCase()==='k'){if(ready&&!busy&&time>=(activeSuggestion?.start??e.start)&&time<=(activeSuggestion?.end??e.end)){event.preventDefault();addOrUpdateKeyframe()}return}
      if(event.code==='Space'||event.key===' '||event.key.toLowerCase()==='space') {event.preventDefault();if(ready&&!busy)void play()}
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight') {
        if(!ready||busy)return
        event.preventDefault();seek((video.current?.currentTime||time)+(event.key==='ArrowRight'?1:-1))
      }
    }
    window.addEventListener('keydown',onKeyDown)
    return()=>window.removeEventListener('keydown',onKeyDown)
  },[ready,busy,time,e.start,e.end,e.keyframes,e.cropX,e.cropY,e.zoom,activeSuggestion?.id,activeSuggestion?.start,activeSuggestion?.end,currentKeyframes])
  const exportVideo=async()=>{
    if(busy||!ready)return
    video.current?.pause();e.setChoosing(true);e.setMessage(null);e.setJob(null)
    const selectedIndex=analysisJob?.suggestions.findIndex(item=>item.id===activeSuggestion?.id)??-1
    const fileName=activeSuggestion?.name?.trim()|| (activeSuggestion?`${ar?'مقطع':'Clip'} ${selectedIndex+1}`:undefined)
    const options={mediaUrl:source.mediaUrl,start:activeSuggestion?.start??e.start,end:activeSuggestion?.end??e.end,...(fileName?{fileName}:{}),cropX:currentClipFraming.cropX,cropY:currentClipFraming.cropY,zoom:currentClipFraming.zoom,keyframes:currentKeyframes,muted:e.muted,fps:e.fps,faceCam:currentFaceCam}
    try{const job=await window.youcut.startExport(options);e.setJob(job);if(!job)e.setMessage(ar?'تم إلغاء اختيار مكان الحفظ.':'Destination selection cancelled.')}
    catch(error){e.setMessage(error instanceof Error?error.message:'Export failed.')}
    finally{e.setChoosing(false)}
  }
  const exportSelectedClips=async()=>{
    if(busy||!ready||!analysisJob||selectedClips.length===0)return
    const selected=analysisJob.suggestions.filter(item=>selectedClips.includes(item.id))
    if(selected.length===0)return
    video.current?.pause();setBatchStarting(true);setBatchJob(null);e.setMessage(null)
    try{
      const job=await window.youcut.startBatchExport({mediaUrl:source.mediaUrl,clips:selected.map((item,index)=>({id:item.id,name:item.name?.trim()||`${ar?'مقطع':'Clip'} ${index+1}`,start:item.start,end:item.end,...(item.framing?{framing:item.framing}:{})})),cropX:e.cropX,cropY:e.cropY,zoom:e.zoom,keyframes:e.keyframes,muted:e.muted,fps:e.fps,faceCam:e.faceCam})
      setBatchJob(job)
      if(!job)e.setMessage(ar?'تم إلغاء اختيار مجلد التصدير.':'Batch export folder selection was cancelled.')
    }catch(error){e.setMessage(error instanceof Error?error.message:'Batch export failed to start.')}
    finally{setBatchStarting(false)}
  }
  const updateSuggestion=(id:string,field:'start'|'end',value:number)=>{
    if(!Number.isFinite(value)||!analysisJob||analysisJob.status!=='complete')return
    const suggestions=analysisJob.suggestions.map(item=>{
      if(item.id!==id)return item
      const next={...item,[field]:Math.max(analysisJob.range.start,Math.min(analysisJob.range.end,value))}
      if(next.end-next.start<1)return item
      return next
    })
    setAnalysisJob({...analysisJob,suggestions})
  }
  const updateSuggestionName=(id:string,name:string|undefined)=>{
    if(!analysisJob||analysisJob.status!=='complete')return
    setAnalysisJob(current=>current?{...current,suggestions:current.suggestions.map(item=>item.id===id?{...item,name:name?.slice(0,80)}:item)}:current)
  }
  const suggestionName=(item:{name?:string},index:number)=>item.name?.trim()||`${ar?'مقطع':'Clip'} ${index+1}`
  const setClipSelected=(id:string,selected:boolean)=>setSelectedClips(current=>selected?[...new Set([...current,id])]:current.filter(value=>value!==id))
  return <div className="editor-page fade-in">
    <div className="editor-heading"><button className="back-button" disabled={busy} onClick={onBack}>← {ar?'تغيير الفيديو':'Change video'}</button><strong>{source.name}</strong><button className="button-primary" disabled={!ready||busy||e.end-e.start>300} aria-busy={busy} onClick={()=>void exportVideo()}>{busy&&<span className="spinner"/>} {e.exportChoosing?(ar?'اختار مكان الحفظ…':'Choose destination…'):e.job?.status==='running'?(ar?'جارٍ التصدير…':'Exporting…'):(ar?'تصدير MP4':'Export MP4')}</button></div>
    <div className="project-category-control"><label htmlFor="project-category-editor">{ar?'فئة المشروع':'Project category'}</label><select id="project-category-editor" value={category} disabled={categorySaving||busy} onChange={event=>onCategoryChange(event.target.value as ProjectCategory)}>{(['general','gaming','podcast','interview','reaction','education'] as ProjectCategory[]).map(value=><option key={value} value={value}>{categoryNames[value]}</option>)}</select>{categorySaving&&<span className="spinner" role="status" aria-label={ar?'جارٍ الحفظ':'Saving'}/ >}{categoryError&&<span className="error-message" role="alert">{categoryError}</span>}</div>
    <div className="editor-previews"><section><h2>{ar?'الفيديو الأصلي':'Source'}</h2><div className={`video-stage ${currentFaceCam.enabled||trackingSelecting?'facecam-selecting':''}`} ref={stage}><video ref={video} src={previewUrl} crossOrigin="anonymous" preload="metadata" muted={e.muted} playsInline onLoadedMetadata={event=>{const duration=event.currentTarget.duration;e.loaded(duration);if(!initialSettings.analysis){setAnalysisStart(0);setAnalysisEnd(Math.min(60,duration))}else{setAnalysisStart(Math.min(initialSettings.analysis.range.start,Math.max(0,duration-1)));setAnalysisEnd(Math.min(initialSettings.analysis.range.end,duration))}if(resumeTime.current>0){event.currentTarget.currentTime=Math.min(resumeTime.current,duration);resumeTime.current=0}setBuffering(false)}} onCanPlay={()=>setBuffering(false)} onWaiting={()=>setBuffering(true)} onPlaying={()=>{setPlaying(true);setBuffering(false)}} onPause={()=>setPlaying(false)} onError={mediaError} onTimeUpdate={event=>{const v=event.currentTarget;setTime(v.currentTime);if(v.currentTime>=(activeSuggestion?.end??useEditor.getState().end)&&!v.paused)v.pause()}}/><div className={`facecam-selection-layer ${currentFaceCam.enabled||trackingSelecting?'active':''}`} onPointerDown={faceCamPointerDown} onPointerMove={faceCamPointerMove} onPointerUp={faceCamPointerUp} onPointerCancel={faceCamPointerUp}>{currentFaceCam.enabled&&<div className="facecam-selection-box" style={sourceBoxStyle()}><i/><i/><i/><i/></div>}{(trackingBox||trackingDraft)&&<div className="tracking-selection-box" style={sourceBoxStyle(trackingDraft||trackingBox!)}><i/><i/><i/><i/></div>}</div>{(e.mediaStatus==='loading'||buffering||preparing)&&<div className="video-overlay" role="status"><span className="spinner"/>{preparing?(ar?'جارٍ تجهيز نسخة معاينة متوافقة…':'Preparing a compatible preview…'):(ar?'جارٍ قراءة الفيديو…':'Loading video…')}</div>}</div>{e.mediaStatus==='error'&&!preparing&&<div className="error-message" role="alert"><p>{ar?'المعاينة لم تعمل لهذا الفيديو. يمكنك تجهيز نسخة متوافقة، أو الرجوع واختيار ملف آخر.':'This video could not be previewed. Prepare a compatible preview or choose another file.'}</p><button className="button-secondary" onClick={()=>void preparePreview()}>{ar?'تجهيز معاينة متوافقة / إعادة المحاولة':'Prepare compatible preview / Retry'}</button></div>}</section><section className="result-preview"><h2>{ar?'النتيجة · 9:16':'Result · 9:16'}</h2><canvas ref={canvas} width={360} height={640}/></section></div>
    {preparing&&<section className="operation-status" role="status" aria-live="polite"><progress max={1} value={e.previewJob?.progress||0}/><span>{ar?'تجهيز معاينة متوافقة':'Preparing compatible preview'} · {Math.floor((e.previewJob?.progress||0)*100)}%</span><button className="button-secondary" onClick={()=>void window.youcut.cancelPreview(source.mediaUrl).catch(()=>e.setMessage(ar?'تعذر الإلغاء.':'Could not cancel.'))}>{ar?'إلغاء التجهيز':'Cancel preparation'}</button><small>{ar?'ملف مؤقت للعرض فقط. يظل الأصل بجودته للتصدير. قد يستغرق الفيديو الطويل وقتًا.':'Temporary playback copy only. Original quality is retained for export. Long videos may take time.'}</small></section>}
    <section className="scene-analysis"><div><h2>{ar?'اقتراح مشاهد':'Scene suggestions'}</h2><p>{ar?'تحليل محلي لتغيرات الصورة فقط؛ لا يكتشف الضحك أو معنى الكلام بعد.':'Local visual scene-change analysis only; it does not detect laughter or meaning yet.'}</p></div><label>{ar?'من الثانية':'Start (s)'}<input type="number" min={0} max={e.duration} step={1} value={analysisStart} disabled={analyzing||!ready} onChange={event=>{const value=Math.max(0,Math.min(analysisEnd-1,e.duration,Number(event.target.value)));setAnalysisStart(value)}}/></label><label>{ar?'إلى الثانية':'End (s)'}<input type="number" min={analysisStart+1} max={e.duration} step={1} value={analysisEnd} disabled={analyzing||!ready} onChange={event=>{const value=Math.max(analysisStart+1,Math.min(e.duration,analysisStart+300,Number(event.target.value)));setAnalysisEnd(value)}}/></label><button className="button-secondary" disabled={!ready||busy} onClick={()=>void startAnalysis()}>{analyzing&&<span className="spinner"/>}{analyzing?(ar?'جارٍ التحليل…':'Analyzing…'):(ar?'حلّل المشاهد':'Analyze scenes')}</button>{analyzing&&<button className="text-button" onClick={()=>void window.youcut.cancelAnalysis()}>{ar?'إلغاء':'Cancel'}</button>}{analysisJob?.status==='running'&&<progress max={1} value={analysisJob.progress}/>}</section>
    {analysisJob?.status==='complete'&&<section className="scene-results" aria-live="polite"><strong>{ar?`تم فحص ${analysisJob.sceneChanges.length} تغيّرًا في المشهد`:`Found ${analysisJob.sceneChanges.length} scene changes`}</strong>{activeSuggestion&&<div className="clip-framing-banner"><span>{ar?`تعدّل الآن كادر المقطع ${analysisJob.suggestions.findIndex(item=>item.id===activeSuggestion.id)+1}. تغييرات القص والتتبع وكاميرا الوجه تخص هذا المقطع.`:`Editing clip ${analysisJob.suggestions.findIndex(item=>item.id===activeSuggestion.id)+1}. Crop, tracking, and Face Cam changes apply only to this clip.`}</span><button className="text-button" disabled={busy} onClick={()=>setActiveClipId(null)}>{ar?'العودة للكادر العام':'Use shared framing'}</button></div>}{analysisJob.suggestions.length?analysisJob.suggestions.map((item,index)=><div key={item.id} className={`scene-suggestion ${activeClipId===item.id?'active':''}`}><label className="scene-suggestion-select"><input type="checkbox" checked={selectedClips.includes(item.id)} disabled={busy} onChange={event=>setClipSelected(item.id,event.target.checked)}/><span>{suggestionName(item,index)} · {stamp(item.start)} – {stamp(item.end)}</span><small>{ar?`نشاط بصري · ${item.score}%`:`Visual activity · ${item.score}%`}</small></label><label className="suggestion-name">{ar?'اسم المقطع':'Clip name'}<input type="text" maxLength={80} value={item.name??suggestionName(item,index)} disabled={busy} onChange={event=>updateSuggestionName(item.id,event.target.value)} onBlur={()=>updateSuggestionName(item.id,item.name?.trim()||undefined)}/></label><label className="suggestion-time">{ar?'البداية':'Start'}<input type="number" min={analysisJob.range.start} max={item.end-1} step={.1} value={item.start} disabled={busy} onChange={event=>updateSuggestion(item.id,'start',Number(event.target.value))}/></label><label className="suggestion-time">{ar?'النهاية':'End'}<input type="number" min={item.start+1} max={analysisJob.range.end} step={.1} value={item.end} disabled={busy} onChange={event=>updateSuggestion(item.id,'end',Number(event.target.value))}/></label><button className="text-button" disabled={busy} onClick={()=>{setActiveClipId(item.id);seek(item.start)}}>{ar?(activeClipId===item.id?'محدد للتحرير':'تحرير ومعاينة'):(activeClipId===item.id?'Editing':'Edit & preview')}</button></div>):<p>{ar?'لم تظهر تغيّرات مشهد كافية لصنع اقتراحات في هذا الجزء.':'No strong scene changes were found in this range.'}</p>}{analysisJob.suggestions.length>0&&<div className="batch-select-actions"><span>{ar?`تم اختيار ${selectedClips.length} مقاطع · التعديلات تحفظ تلقائيًا`:`${selectedClips.length} clips selected · edits save automatically`}</span><button className="button-primary" disabled={busy||selectedClips.length===0} onClick={()=>void exportSelectedClips()}>{batchStarting&&<span className="spinner"/>}{ar?`تصدير المحدد (${selectedClips.length})`:`Export selected (${selectedClips.length})`}</button></div>}</section>}{analysisJob?.status==='error'&&<p className="error-message" role="alert">{analysisJob.error}</p>}
    {batchStarting&&<section className="batch-export-results" role="status" aria-live="polite"><span className="spinner"/>{ar?'اختار مجلدًا لحفظ المقاطع المحددة…':'Choose a folder for the selected clips…'}</section>}
    {batchJob&&<section className="batch-export-results" aria-live="polite"><header><div><strong>{batchJob.status==='running'?(ar?'جارٍ تصدير المجموعة':'Exporting selected clips'):batchJob.status==='cancelled'?(ar?'تم إلغاء المجموعة':'Batch cancelled'):(ar?'اكتمل التصدير':'Batch export finished')}</strong><small dir="ltr">{Math.round(batchJob.progress*100)}% · {batchJob.outputDirectory}</small></div><progress max={1} value={batchJob.progress}/>{batchJob.status==='running'&&<button className="button-secondary" onClick={()=>void window.youcut.cancelBatchExport()}>{ar?'إلغاء المجموعة':'Cancel batch'}</button>}</header><div className="batch-export-items">{batchJob.items.map((item,index)=><article className={`batch-export-item ${item.status}`} key={item.id}><div><strong>{item.name}</strong><small dir="ltr">{stamp(item.start)} – {stamp(item.end)} · {item.status==='running'?`${Math.floor(item.progress*100)}%`:item.status==='complete'?(ar?'اكتمل':'Complete'):item.status==='error'?(ar?'فشل':'Failed'):item.status==='cancelled'?(ar?'ملغى':'Cancelled'):(ar?'في الانتظار':'Queued')}</small>{item.path&&<small dir="ltr">{item.path}</small>}{item.error&&<small className="error-message">{item.error}</small>}</div>{item.status==='running'&&<progress max={1} value={item.progress}/ >}{item.status==='error'&&batchJob.status!=='running'&&<button className="text-button" onClick={()=>void window.youcut.retryBatchExportItem(index).then(setBatchJob).catch(error=>e.setMessage(error instanceof Error?error.message:'Clip retry failed.'))}>{ar?'إعادة المحاولة':'Retry'}</button>}</article>)}</div></section>}
    {e.previewJob?.status==='error'&&<p className="error-message" role="alert">{e.previewJob.error}</p>}
    <section className="editor-controls"><div className="playback-row"><button className="button-secondary" disabled={!ready} onClick={()=>void play()}>{playing?(ar?'إيقاف مؤقت':'Pause'):(ar?'تشغيل المقطع':'Play clip')}</button><span dir="ltr">{stamp(time)} / {stamp(e.duration)}</span></div>
    <label className="field-label" htmlFor="playhead">{ar?'المسطرة — اضغط أو اسحب للتحريك · مسافة تشغيل/إيقاف · الأسهم تحريك ثانية':'Timeline — click or drag to seek · Space play/pause · Arrow keys step 1 second'}</label><div className="timeline-with-keyframes"><input id="playhead" className="timeline-seek" type="range" min={0} max={e.duration||1} step={0.01} value={time} disabled={!ready} onChange={event=>seek(Number(event.target.value))} onKeyDown={timelineKeyDown}/><div className="keyframe-markers" aria-label={ar?'نقاط تحريك الكادر':'Framing keyframes'}>{currentKeyframes.map((frame,index)=><button type="button" key={`key-${frame.time}`} className="keyframe-marker" style={{left:`${Math.max(0,Math.min(100,frame.time/(e.duration||1)*100))}%`}} title={`${stamp(frame.time)} · ${ar?'نقطة تحريك':'Framing keyframe'} ${index+1}`} aria-label={`${ar?'الانتقال لنقطة':'Go to keyframe'} ${stamp(frame.time)}`} onClick={()=>seek(frame.time)}>◆</button>)}{currentTrackingLosses.map((lost,index)=><button type="button" key={`lost-${lost}-${index}`} className="tracking-loss-marker" style={{left:`${Math.max(0,Math.min(100,lost/(e.duration||1)*100))}%`}} title={`${stamp(lost)} · ${ar?'فقد التتبع':'Tracking lost'}`} aria-label={`${ar?'موضع فقد التتبع':'Tracking loss'} ${stamp(lost)}`} onClick={()=>seek(lost)}>!</button>)}</div></div>
    <div className="keyframe-toolbar"><span>{ar?`${currentKeyframes.length} نقاط · ${currentKeyframe?'نقطة عند المؤشر':'تحريك يدوي للكادر'}`:`${currentKeyframes.length} points · ${currentKeyframe?'keyframe at playhead':'manual framing'}`}</span><div><button className="button-secondary" disabled={!ready||busy||time<(activeSuggestion?.start??e.start)||time>(activeSuggestion?.end??e.end)} onClick={addOrUpdateKeyframe}>{ar?(currentKeyframe?'تحديث النقطة':'إضافة نقطة · K'):(currentKeyframe?'Update point':'Add point · K')}</button><button className="text-button" disabled={!currentKeyframe||busy} onClick={()=>removeCurrentKeyframe()}>{ar?'حذف':'Delete'}</button><button className="text-button" disabled={!(activeSuggestion?clipFramingHistory.some(item=>item.id===activeSuggestion.id):e.keyframeHistory.length)||busy} onClick={undoFraming} title={ar?'تراجع عن تعديل النقاط':'Undo keyframe edit'}>↶</button><button className="text-button" disabled={!(activeSuggestion?clipFramingFuture.some(item=>item.id===activeSuggestion.id):e.keyframeFuture.length)||busy} onClick={redoFraming} title={ar?'إعادة تعديل النقاط':'Redo keyframe edit'}>↷</button></div></div>
    <section className="tracking-controls"><div><strong>{ar?'تتبّع عنصر':'Track an object'}</strong><p>{ar?'قف عند ظهور العنصر، ارسم مربعًا حوله، ثم ابدأ التتبع حتى نهاية المقطع.':'Pause where the target is visible, draw a box around it, then track to the clip end.'}</p></div><button className={trackingSelecting?'button-primary':'button-secondary'} disabled={!ready||busy} onClick={()=>{setTrackingSelecting(value=>!value);setTrackingDraft(null);if(!trackingSelecting)video.current?.pause()}}>{trackingSelecting?(ar?'إلغاء التحديد':'Cancel selection'):(ar?'ارسم مربع العنصر':'Draw target box')}</button><button className="button-primary" disabled={!ready||busy||!trackingBox} onClick={()=>void startTracking()}>{trackingStarting&&<span className="spinner"/>}{trackingBusy?(ar?'جارٍ التتبع…':'Tracking…'):(ar?'تتبّع من المؤشر':'Track from playhead')}</button>{trackingBusy&&<><progress max={1} value={trackingJob?.progress||0}/><button className="text-button" onClick={()=>void window.youcut.cancelTracking()}>{ar?'إلغاء':'Cancel'}</button></>}{trackingJob?.status==='error'&&<p className="error-message" role="alert">{trackingJob.error}</p>}{trackingJob?.status==='complete'&&<p className={trackingJob.lostAt.length?'tracking-warning':'tracking-success'} role="status">{trackingJob.keyframes.length-trackingJob.lostAt.length} {ar?'عينة تم تتبعها':'samples tracked'} · {trackingJob.lostAt.length} {ar?'موضع يحتاج مراجعة':'samples need review'}</p>}</section>
    {currentKeyframes.length>0&&<div className="keyframe-list" aria-label={ar?'قائمة نقاط تحريك الكادر':'Framing keyframe list'}>{visibleKeyframes.map(frame=><button className={`keyframe-chip ${currentKeyframe?.time===frame.time?'active':''}`} type="button" key={frame.time} onClick={()=>seek(frame.time)}><span dir="ltr">{stamp(frame.time)}</span><small>{ar?`نقطة ${currentKeyframes.indexOf(frame)+1}`:`Point ${currentKeyframes.indexOf(frame)+1}`} · {Math.round(frame.zoom*100)}%</small></button>)}</div>}
    <fieldset disabled={!ready||busy} className="trim-fields"><legend>{ar?'تحديد المقطع':'Clip selection'}</legend><label>{ar?'البداية بالثواني':'Start (seconds)'}<input type="number" min={0} max={e.end-.1} step={.1} value={Number(e.start.toFixed(2))} onChange={event=>{const value=Number(event.target.value);e.trim(value,e.end);seek(value)}}/><input aria-label={ar?'سحب بداية المقطع':'Drag clip start'} type="range" min={0} max={e.duration||1} step={.1} value={e.start} onChange={event=>{const value=Math.min(Number(event.target.value),e.end-.1);e.trim(value,e.end);seek(value)}}/><button className="text-button" onClick={()=>e.trim(time,e.end)}>{ar?'اجعل البداية هنا':'Set start here'}</button></label><label>{ar?'النهاية بالثواني':'End (seconds)'}<input type="number" min={e.start+.1} max={e.duration} step={.1} value={Number(e.end.toFixed(2))} onChange={event=>e.trim(e.start,Number(event.target.value))}/><input aria-label={ar?'سحب نهاية المقطع':'Drag clip end'} type="range" min={0} max={e.duration||1} step={.1} value={e.end} onChange={event=>e.trim(e.start,Math.max(Number(event.target.value),e.start+.1))}/><button className="text-button" onClick={()=>e.trim(e.start,time)}>{ar?'اجعل النهاية هنا':'Set end here'}</button></label><div><strong>{(e.end-e.start).toFixed(1)} {ar?'ثانية':'seconds'}</strong><p>{ar?'حد المقطع 5 دقائق':'Up to 5 minutes per clip'}</p></div></fieldset>
    <fieldset disabled={!ready||busy} className="crop-fields"><legend>{ar?'موضع القص الرأسي — معاينة مباشرة':'Vertical framing — live preview'}</legend><label>{ar?'أفقي':'Horizontal'}<input type="range" min={0} max={1} step={.001} value={currentFraming.cropX} onChange={event=>changeFraming('cropX',Number(event.target.value))}/></label><label>{ar?'رأسي':'Vertical'}<input type="range" min={0} max={1} step={.001} value={currentFraming.cropY} onChange={event=>changeFraming('cropY',Number(event.target.value))}/></label><label>{ar?'تكبير':'Zoom'}<input type="range" min={1} max={3} step={.01} value={currentFraming.zoom} onChange={event=>changeFraming('zoom',Number(event.target.value))}/><span>{Math.round(currentFraming.zoom*100)}%</span></label><label className="mute-control"><input type="checkbox" checked={e.muted} onChange={event=>e.setMuted(event.target.checked)}/>{ar?'كتم الصوت':'Mute audio'}</label><label>FPS <select value={e.fps} onChange={event=>e.setFps(Number(event.target.value) as 30|60)}><option value={30}>30</option><option value={60}>60</option></select></label></fieldset>
    <fieldset disabled={!ready||busy} className="facecam-fields"><legend>{ar?'كاميرا الوجه':'Face Cam'}</legend><label className="facecam-enable"><input type="checkbox" checked={currentFaceCam.enabled} onChange={event=>updateFaceCam({...currentFaceCam,enabled:event.target.checked})}/>{ar?'إظهار كاميرا الوجه':'Show face camera'}</label>{currentFaceCam.enabled&&<><p>{ar?'اسحب مستطيلًا حول كاميرا الوجه داخل الفيديو الأصلي، أو اضبط حجمه من أدوات التحديد.':'Drag a rectangle around the face camera in the source video, or adjust its size below.'}</p><label>{ar?'عرض المنطقة':'Region width'}<input type="range" min={.02} max={1-currentFaceCam.x} step={.01} value={currentFaceCam.width} onChange={event=>updateFaceCam({...currentFaceCam,width:Number(event.target.value)})}/></label><label>{ar?'ارتفاع المنطقة':'Region height'}<input type="range" min={.02} max={1-currentFaceCam.y} step={.01} value={currentFaceCam.height} onChange={event=>updateFaceCam({...currentFaceCam,height:Number(event.target.value)})}/></label><label>{ar?'حجمها في الناتج':'Overlay size'}<input type="range" min={.1} max={.6} step={.01} value={currentFaceCam.size} onChange={event=>updateFaceCam({...currentFaceCam,size:Number(event.target.value)})}/></label><label>{ar?'مكان الظهور':'Placement'}<select value={currentFaceCam.placement} onChange={event=>{const placement=event.target.value as 'top'|'bottom'|'custom';updateFaceCam({...currentFaceCam,placement,positionY:placement==='top'?.05:placement==='bottom'?.88:currentFaceCam.positionY})}}><option value="top">{ar?'أعلى':'Top'}</option><option value="bottom">{ar?'أسفل':'Bottom'}</option><option value="custom">{ar?'مخصص':'Custom'}</option></select></label>{currentFaceCam.placement==='custom'&&<><label>{ar?'أفقي':'Horizontal'}<input type="range" min={0} max={1} step={.01} value={currentFaceCam.positionX} onChange={event=>updateFaceCam({...currentFaceCam,positionX:Number(event.target.value)})}/></label><label>{ar?'رأسي':'Vertical'}<input type="range" min={0} max={1} step={.01} value={currentFaceCam.positionY} onChange={event=>updateFaceCam({...currentFaceCam,positionY:Number(event.target.value)})}/></label></>}</>}</fieldset>
    {currentTrackingLosses.length>0&&<p className="tracking-warning" role="status">{ar?`هناك ${currentTrackingLosses.length} موضع فقد تتبع على المسطرة؛ اضغط العلامة الحمراء لمراجعته.`:`${currentTrackingLosses.length} tracking gaps are marked on the timeline. Select a red marker to review it.`}</p>}
    <p className="link-help">{ar?'التتبع التجريبي يتبع النمط المرئي داخل المربع؛ راجع العلامات الحمراء وصحح المواضع يدويًا بنقاط Keyframes.':'Experimental tracking follows the visual pattern inside the box. Review red markers and correct gaps with manual keyframes.'}</p>
    </section>
    <div className="project-save-status" role="status" aria-live="polite">{e.saveStatus==='saving'?(ar?'جارٍ حفظ المشروع…':'Saving project…'):e.saveStatus==='error'?(<><span className="error-message">{ar?'تعذر حفظ المشروع':'Project could not be saved'}</span><button className="text-button" onClick={()=>{const state=useEditor.getState(),snapshot:EditorSettings={start:state.start,end:state.end,cropX:state.cropX,cropY:state.cropY,zoom:state.zoom,keyframes:state.keyframes,trackingLosses:state.trackingLosses,muted:state.muted,fps:state.fps,faceCam:state.faceCam};state.setSaveStatus('saving');void saveSnapshot(snapshot).catch(error=>{state.setSaveStatus('error');state.setMessage(error instanceof Error?error.message:'Project save failed.')})}}>{ar?'إعادة المحاولة':'Retry'}</button></>):e.dirty||analysisDirty?(ar?'تعديلات غير محفوظة · الحفظ بعد 5 ثوانٍ':'Unsaved changes · saving in 5 seconds'):(ar?'تم حفظ التعديلات':'Changes saved')}</div>
    {(e.job||e.message||e.exportChoosing)&&<section className="operation-status export-progress" role="status" aria-live="polite">{e.exportChoosing&&<span>{ar?'نافذة اختيار مكان الحفظ مفتوحة.':'The destination dialog is open.'}</span>}{e.job?.status==='running'&&<><progress max={1} value={e.job.progress}/><span>{Math.floor(e.job.progress*100)}%</span><button className="button-secondary" onClick={()=>void window.youcut.cancelExport()}>{ar?'إلغاء التصدير':'Cancel export'}</button></>}{e.job?.status==='complete'&&<span>{ar?'تم حفظ الفيديو: ':'Video saved: '}{e.job.path}</span>}{e.job?.status==='cancelled'&&<span>{ar?'تم إلغاء التصدير.':'Export cancelled.'}</span>}{e.job?.status==='error'&&<span className="error-message">{e.job.error}</span>}{e.message&&<span>{e.message}</span>}</section>}
  </div>
}
