import { useEffect, useRef, useState } from 'react'
import type { AnalysisJob, BatchExportJob, EditorSettings, PickedVideo, ProjectCategory } from '../../../shared/contracts'
import { defaultFaceCam, useEditor } from '../state/editor'
const stamp=(v:number)=>`${Math.floor(v/60).toString().padStart(2,'0')}:${Math.floor(v%60).toString().padStart(2,'0')}`
export function Editor({source,language,onBack,projectId,initialSettings,category,categorySaving,categoryError,onCategoryChange}:{source:PickedVideo;language:'ar'|'en';onBack:()=>void;projectId:string;initialSettings:EditorSettings;category:ProjectCategory;categorySaving:boolean;categoryError:string|null;onCategoryChange:(category:ProjectCategory)=>void}) {
  const ar=language==='ar', e=useEditor(), video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),stage=useRef<HTMLDivElement>(null),faceCamDrag=useRef<{x:number;y:number}|null>(null)
  const [faceCamDraft,setFaceCamDraft]=useState<{x:number;y:number;width:number;height:number}|null>(null)
  const getVideoPoint=(event:React.PointerEvent<HTMLDivElement>)=>{
    const box=stage.current?.getBoundingClientRect(),v=video.current
    if(!box||!v?.videoWidth||!v.videoHeight)return null
    const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),width=v.videoWidth*scale,height=v.videoHeight*scale
    return {x:Math.max(0,Math.min(1,(event.clientX-box.left-(box.width-width)/2)/width)),y:Math.max(0,Math.min(1,(event.clientY-box.top-(box.height-height)/2)/height))}
  }
  const faceCamPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!e.faceCam.enabled||busy)return
    const point=getVideoPoint(event);if(!point)return
    faceCamDrag.current=point;event.currentTarget.setPointerCapture(event.pointerId);setFaceCamDraft({x:point.x,y:point.y,width:0,height:0})
  }
  const faceCamPointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    const origin=faceCamDrag.current;if(!origin)return
    const point=getVideoPoint(event);if(!point)return
    setFaceCamDraft({x:Math.min(origin.x,point.x),y:Math.min(origin.y,point.y),width:Math.abs(point.x-origin.x),height:Math.abs(point.y-origin.y)})
  }
  const faceCamPointerUp=(event:React.PointerEvent<HTMLDivElement>)=>{
    const draft=faceCamDraft;faceCamDrag.current=null;setFaceCamDraft(null)
    if(draft&&draft.width>=.02&&draft.height>=.02)e.setFaceCam({...e.faceCam,x:draft.x,y:draft.y,width:draft.width,height:draft.height})
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const faceCamRect=faceCamDraft||e.faceCam
  const sourceBoxStyle=()=>{
    const box=stage.current?.getBoundingClientRect(),v=video.current
    if(!box||!v?.videoWidth||!v.videoHeight)return {}
    const scale=Math.min(box.width/v.videoWidth,box.height/v.videoHeight),width=v.videoWidth*scale,height=v.videoHeight*scale
    return {left:`${(box.width-width)/2+faceCamRect.x*width}px`,top:`${(box.height-height)/2+faceCamRect.y*height}px`,width:`${faceCamRect.width*width}px`,height:`${faceCamRect.height*height}px`}
  }
  const categoryNames:Record<ProjectCategory,string>=ar?{general:'عام',gaming:'ألعاب',podcast:'بودكاست',interview:'مقابلة',reaction:'رد فعل',education:'تعليمي'}:{general:'General',gaming:'Gaming',podcast:'Podcast',interview:'Interview',reaction:'Reaction',education:'Educational'}
  const [time,setTime]=useState(0),[playing,setPlaying]=useState(false),[buffering,setBuffering]=useState(false)
  const [analysisJob,setAnalysisJob]=useState<AnalysisJob|null>(null),[analysisStart,setAnalysisStart]=useState(0),[analysisEnd,setAnalysisEnd]=useState(60),[analysisStarting,setAnalysisStarting]=useState(false),[selectedClips,setSelectedClips]=useState<string[]>([])
  const [batchJob,setBatchJob]=useState<BatchExportJob|null>(null),[batchStarting,setBatchStarting]=useState(false)
  const [previewUrl,setPreviewUrl]=useState(source.mediaUrl)
  const attemptedPreview=useRef(false),resumeTime=useRef(0)
  const preparing=e.previewStarting||e.previewJob?.status==='running'
  const analyzing=analysisStarting||analysisJob?.status==='running'
  const batchBusy=batchStarting||batchJob?.status==='running'
  const busy=preparing||analyzing||e.exportChoosing||e.job?.status==='running'||batchBusy,ready=e.mediaStatus==='ready'
  const saveSnapshot=async(snapshot:EditorSettings)=>{
    const result=await window.youcut.saveProject(projectId,snapshot)
    useEditor.getState().markSaved(snapshot)
    if(result.backupWarning)useEditor.getState().setMessage(ar?'تم حفظ المشروع، لكن مجلد النسخ الاحتياطي غير متاح.':'Project saved, but the backup folder is unavailable.')
  }
  useEffect(()=>{useEditor.getState().reset();useEditor.getState().hydrate(initialSettings);setTime(initialSettings.start);setPlaying(false);setPreviewUrl(source.mediaUrl);attemptedPreview.current=false;return()=>{void window.youcut.cancelPreview(source.mediaUrl).catch(()=>{})}},[source.mediaUrl,projectId])
  useEffect(()=>{
    const saveBeforeClose=()=>{const state=useEditor.getState();if(state.dirty)window.youcut.flushProject(projectId,{start:state.start,end:state.end,cropX:state.cropX,cropY:state.cropY,muted:state.muted,fps:state.fps,faceCam:state.faceCam})}
    window.addEventListener('beforeunload',saveBeforeClose)
    return()=>{window.removeEventListener('beforeunload',saveBeforeClose);saveBeforeClose()}
  },[projectId])
  useEffect(()=>{
    if(!e.hydrated||!e.dirty||busy)return
    const snapshot:EditorSettings={start:e.start,end:e.end,cropX:e.cropX,cropY:e.cropY,muted:e.muted,fps:e.fps,faceCam:e.faceCam}
    const timer=setTimeout(()=>{
      e.setSaveStatus('saving')
      void saveSnapshot(snapshot).catch(error=>{e.setSaveStatus('error');e.setMessage(error instanceof Error?error.message:'Project save failed.')})
    },5000)
    return()=>clearTimeout(timer)
  },[projectId,e.hydrated,e.dirty,e.start,e.end,e.cropX,e.cropY,e.muted,e.fps,e.faceCam,busy])
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
          context.drawImage(v,(v.videoWidth-w)*e.cropX,(v.videoHeight-h)*e.cropY,w,h,0,0,c.width,c.height)
          if(e.faceCam.enabled){
            const sx=v.videoWidth*e.faceCam.x,sy=v.videoHeight*e.faceCam.y,sw=v.videoWidth*e.faceCam.width,sh=v.videoHeight*e.faceCam.height
            let dw=c.width*e.faceCam.size,dh=dw/(sw/sh)
            const maxHeight=c.height*e.faceCam.size
            if(dh>maxHeight){dh=maxHeight;dw=dh*(sw/sh)}
            const dx=(c.width-dw)*e.faceCam.positionX,dy=(c.height-dh)*e.faceCam.positionY
            context.save();context.shadowColor='#0009';context.shadowBlur=12;context.drawImage(v,sx,sy,sw,sh,dx,dy,dw,dh);context.shadowBlur=0;context.strokeStyle='#f1d28f';context.lineWidth=3;context.strokeRect(dx,dy,dw,dh);context.restore()
          }
        }
      }
      frame=requestAnimationFrame(draw)
    };draw();return()=>cancelAnimationFrame(frame)
  },[e.cropX,e.cropY,e.faceCam,source.mediaUrl])
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
  const startAnalysis=async()=>{
    if(analyzing||e.job?.status==='running')return
    if(analysisEnd<=analysisStart||analysisEnd-analysisStart>300){e.setMessage(ar?'اختر جزءًا لا يتجاوز خمس دقائق.':'Choose an analysis range up to five minutes.');return}
    setAnalysisStarting(true);setAnalysisJob(null);setSelectedClips([]);e.setMessage(null)
    try{setAnalysisJob(await window.youcut.startAnalysis(source.mediaUrl,analysisStart,analysisEnd))}
    catch(error){setAnalysisJob({id:'failed',status:'error',progress:0,range:{start:analysisStart,end:analysisEnd},sceneChanges:[],suggestions:[],error:error instanceof Error?error.message:'Scene analysis failed.'})}
    finally{setAnalysisStarting(false)}
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
  const play=async()=>{
    const v=video.current;if(!v)return
    if(!v.paused){v.pause();return}
    if(v.currentTime<e.start||v.currentTime>=e.end)seek(e.start)
    try{await v.play()}catch{e.setMessage(ar?'تعذر تشغيل الفيديو. جرّب ملف MP4 بترميز H.264.':'Cannot play this video. Try an H.264 MP4 file.')}
  }
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey)return
      const target=event.target
      if(target instanceof HTMLElement&&(target.isContentEditable||/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)))return
      if(event.code==='Space') {event.preventDefault();if(ready&&!busy)void play()}
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight') {
        if(!ready||busy)return
        event.preventDefault();seek((video.current?.currentTime||time)+(event.key==='ArrowRight'?1:-1))
      }
    }
    window.addEventListener('keydown',onKeyDown)
    return()=>window.removeEventListener('keydown',onKeyDown)
  },[ready,busy,time,e.start,e.end])
  const exportVideo=async()=>{
    if(busy||!ready)return
    video.current?.pause();e.setChoosing(true);e.setMessage(null);e.setJob(null)
    try{const job=await window.youcut.startExport({mediaUrl:source.mediaUrl,start:e.start,end:e.end,cropX:e.cropX,cropY:e.cropY,muted:e.muted,fps:e.fps,faceCam:e.faceCam});e.setJob(job);if(!job)e.setMessage(ar?'تم إلغاء اختيار مكان الحفظ.':'Destination selection cancelled.')}
    catch(error){e.setMessage(error instanceof Error?error.message:'Export failed.')}
    finally{e.setChoosing(false)}
  }
  const exportSelectedClips=async()=>{
    if(busy||!ready||!analysisJob||selectedClips.length===0)return
    const selected=analysisJob.suggestions.filter(item=>selectedClips.includes(item.id))
    if(selected.length===0)return
    video.current?.pause();setBatchStarting(true);setBatchJob(null);e.setMessage(null)
    try{
      const job=await window.youcut.startBatchExport({mediaUrl:source.mediaUrl,clips:selected.map((item,index)=>({id:item.id,name:`Clip ${index+1}`,start:item.start,end:item.end})),cropX:e.cropX,cropY:e.cropY,muted:e.muted,fps:e.fps,faceCam:e.faceCam})
      setBatchJob(job)
      if(!job)e.setMessage(ar?'تم إلغاء اختيار مجلد التصدير.':'Batch export folder selection was cancelled.')
    }catch(error){e.setMessage(error instanceof Error?error.message:'Batch export failed to start.')}
    finally{setBatchStarting(false)}
  }
  return <div className="editor-page fade-in">
    <div className="editor-heading"><button className="back-button" disabled={busy} onClick={onBack}>← {ar?'تغيير الفيديو':'Change video'}</button><strong>{source.name}</strong><button className="button-primary" disabled={!ready||busy||e.end-e.start>300} aria-busy={busy} onClick={()=>void exportVideo()}>{busy&&<span className="spinner"/>} {e.exportChoosing?(ar?'اختار مكان الحفظ…':'Choose destination…'):e.job?.status==='running'?(ar?'جارٍ التصدير…':'Exporting…'):(ar?'تصدير MP4':'Export MP4')}</button></div>
    <div className="project-category-control"><label htmlFor="project-category-editor">{ar?'فئة المشروع':'Project category'}</label><select id="project-category-editor" value={category} disabled={categorySaving||busy} onChange={event=>onCategoryChange(event.target.value as ProjectCategory)}>{(['general','gaming','podcast','interview','reaction','education'] as ProjectCategory[]).map(value=><option key={value} value={value}>{categoryNames[value]}</option>)}</select>{categorySaving&&<span className="spinner" role="status" aria-label={ar?'جارٍ الحفظ':'Saving'}/ >}{categoryError&&<span className="error-message" role="alert">{categoryError}</span>}</div>
    <div className="editor-previews"><section><h2>{ar?'الفيديو الأصلي':'Source'}</h2><div className={`video-stage ${e.faceCam.enabled?'facecam-selecting':''}`} ref={stage}><video ref={video} src={previewUrl} crossOrigin="anonymous" preload="metadata" muted={e.muted} playsInline onLoadedMetadata={event=>{const duration=event.currentTarget.duration;e.loaded(duration);setAnalysisStart(0);setAnalysisEnd(Math.min(60,duration));if(resumeTime.current>0){event.currentTarget.currentTime=Math.min(resumeTime.current,duration);resumeTime.current=0}setBuffering(false)}} onCanPlay={()=>setBuffering(false)} onWaiting={()=>setBuffering(true)} onPlaying={()=>{setPlaying(true);setBuffering(false)}} onPause={()=>setPlaying(false)} onError={mediaError} onTimeUpdate={event=>{const v=event.currentTarget;setTime(v.currentTime);if(v.currentTime>=useEditor.getState().end&&!v.paused)v.pause()}}/><div className={`facecam-selection-layer ${e.faceCam.enabled?'active':''}`} onPointerDown={faceCamPointerDown} onPointerMove={faceCamPointerMove} onPointerUp={faceCamPointerUp} onPointerCancel={faceCamPointerUp}>{e.faceCam.enabled&&<div className="facecam-selection-box" style={sourceBoxStyle()}><i/><i/><i/><i/></div>}</div>{(e.mediaStatus==='loading'||buffering||preparing)&&<div className="video-overlay" role="status"><span className="spinner"/>{preparing?(ar?'جارٍ تجهيز نسخة معاينة متوافقة…':'Preparing a compatible preview…'):(ar?'جارٍ قراءة الفيديو…':'Loading video…')}</div>}</div>{e.mediaStatus==='error'&&!preparing&&<div className="error-message" role="alert"><p>{ar?'المعاينة لم تعمل لهذا الفيديو. يمكنك تجهيز نسخة متوافقة، أو الرجوع واختيار ملف آخر.':'This video could not be previewed. Prepare a compatible preview or choose another file.'}</p><button className="button-secondary" onClick={()=>void preparePreview()}>{ar?'تجهيز معاينة متوافقة / إعادة المحاولة':'Prepare compatible preview / Retry'}</button></div>}</section><section className="result-preview"><h2>{ar?'النتيجة · 9:16':'Result · 9:16'}</h2><canvas ref={canvas} width={360} height={640}/></section></div>
    {preparing&&<section className="operation-status" role="status" aria-live="polite"><progress max={1} value={e.previewJob?.progress||0}/><span>{ar?'تجهيز معاينة متوافقة':'Preparing compatible preview'} · {Math.floor((e.previewJob?.progress||0)*100)}%</span><button className="button-secondary" onClick={()=>void window.youcut.cancelPreview(source.mediaUrl).catch(()=>e.setMessage(ar?'تعذر الإلغاء.':'Could not cancel.'))}>{ar?'إلغاء التجهيز':'Cancel preparation'}</button><small>{ar?'ملف مؤقت للعرض فقط. يظل الأصل بجودته للتصدير. قد يستغرق الفيديو الطويل وقتًا.':'Temporary playback copy only. Original quality is retained for export. Long videos may take time.'}</small></section>}
    <section className="scene-analysis"><div><h2>{ar?'اقتراح مشاهد':'Scene suggestions'}</h2><p>{ar?'تحليل محلي لتغيرات الصورة فقط؛ لا يكتشف الضحك أو معنى الكلام بعد.':'Local visual scene-change analysis only; it does not detect laughter or meaning yet.'}</p></div><label>{ar?'من الثانية':'Start (s)'}<input type="number" min={0} max={e.duration} step={1} value={analysisStart} disabled={analyzing||!ready} onChange={event=>{const value=Math.max(0,Math.min(analysisEnd-1,e.duration,Number(event.target.value)));setAnalysisStart(value)}}/></label><label>{ar?'إلى الثانية':'End (s)'}<input type="number" min={analysisStart+1} max={e.duration} step={1} value={analysisEnd} disabled={analyzing||!ready} onChange={event=>{const value=Math.max(analysisStart+1,Math.min(e.duration,analysisStart+300,Number(event.target.value)));setAnalysisEnd(value)}}/></label><button className="button-secondary" disabled={!ready||busy} onClick={()=>void startAnalysis()}>{analyzing&&<span className="spinner"/>}{analyzing?(ar?'جارٍ التحليل…':'Analyzing…'):(ar?'حلّل المشاهد':'Analyze scenes')}</button>{analyzing&&<button className="text-button" onClick={()=>void window.youcut.cancelAnalysis()}>{ar?'إلغاء':'Cancel'}</button>}{analysisJob?.status==='running'&&<progress max={1} value={analysisJob.progress}/>}</section>
    {analysisJob?.status==='complete'&&<section className="scene-results" aria-live="polite"><strong>{ar?`تم فحص ${analysisJob.sceneChanges.length} تغيّرًا في المشهد`:`Found ${analysisJob.sceneChanges.length} scene changes`}</strong>{analysisJob.suggestions.length?analysisJob.suggestions.map((item,index)=><div key={item.id} className="scene-suggestion"><label className="scene-suggestion-select"><input type="checkbox" checked={selectedClips.includes(item.id)} disabled={busy} onChange={()=>setSelectedClips(current=>current.includes(item.id)?current.filter(id=>id!==item.id):[...current,item.id])}/><span>{ar?`مقطع ${index+1} · ${stamp(item.start)} – ${stamp(item.end)}`:`Clip ${index+1} · ${stamp(item.start)} – ${stamp(item.end)}`}</span><small>{ar?`نشاط بصري · ${item.score}%`:`Visual activity · ${item.score}%`}</small></label><button className="text-button" disabled={busy} onClick={()=>{e.trim(item.start,item.end);seek(item.start)}}>{ar?'معاينة':'Preview'}</button></div>):<p>{ar?'لم تظهر تغيّرات مشهد كافية لصنع اقتراحات في هذا الجزء.':'No strong scene changes were found in this range.'}</p>}{analysisJob.suggestions.length>0&&<div className="batch-select-actions"><span>{ar?`تم اختيار ${selectedClips.length} مقاطع`:`${selectedClips.length} clips selected`}</span><button className="button-primary" disabled={busy||selectedClips.length===0} onClick={()=>void exportSelectedClips()}>{batchStarting&&<span className="spinner"/>}{ar?`تصدير المحدد (${selectedClips.length})`:`Export selected (${selectedClips.length})`}</button></div>}</section>}{analysisJob?.status==='error'&&<p className="error-message" role="alert">{analysisJob.error}</p>}
    {batchStarting&&<section className="batch-export-results" role="status" aria-live="polite"><span className="spinner"/>{ar?'اختار مجلدًا لحفظ المقاطع المحددة…':'Choose a folder for the selected clips…'}</section>}
    {batchJob&&<section className="batch-export-results" aria-live="polite"><header><div><strong>{batchJob.status==='running'?(ar?'جارٍ تصدير المجموعة':'Exporting selected clips'):batchJob.status==='cancelled'?(ar?'تم إلغاء المجموعة':'Batch cancelled'):(ar?'اكتمل التصدير':'Batch export finished')}</strong><small dir="ltr">{Math.round(batchJob.progress*100)}% · {batchJob.outputDirectory}</small></div><progress max={1} value={batchJob.progress}/>{batchJob.status==='running'&&<button className="button-secondary" onClick={()=>void window.youcut.cancelBatchExport()}>{ar?'إلغاء المجموعة':'Cancel batch'}</button>}</header><div className="batch-export-items">{batchJob.items.map((item,index)=><article className={`batch-export-item ${item.status}`} key={item.id}><div><strong>{item.name}</strong><small dir="ltr">{stamp(item.start)} – {stamp(item.end)} · {item.status==='running'?`${Math.floor(item.progress*100)}%`:item.status==='complete'?(ar?'اكتمل':'Complete'):item.status==='error'?(ar?'فشل':'Failed'):item.status==='cancelled'?(ar?'ملغى':'Cancelled'):(ar?'في الانتظار':'Queued')}</small>{item.path&&<small dir="ltr">{item.path}</small>}{item.error&&<small className="error-message">{item.error}</small>}</div>{item.status==='running'&&<progress max={1} value={item.progress}/ >}{item.status==='error'&&batchJob.status!=='running'&&<button className="text-button" onClick={()=>void window.youcut.retryBatchExportItem(index).then(setBatchJob).catch(error=>e.setMessage(error instanceof Error?error.message:'Clip retry failed.'))}>{ar?'إعادة المحاولة':'Retry'}</button>}</article>)}</div></section>}
    {e.previewJob?.status==='error'&&<p className="error-message" role="alert">{e.previewJob.error}</p>}
    <section className="editor-controls"><div className="playback-row"><button className="button-secondary" disabled={!ready} onClick={()=>void play()}>{playing?(ar?'إيقاف مؤقت':'Pause'):(ar?'تشغيل المقطع':'Play clip')}</button><span dir="ltr">{stamp(time)} / {stamp(e.duration)}</span></div>
    <label className="field-label" htmlFor="playhead">{ar?'المسطرة — اضغط أو اسحب للتحريك · مسافة تشغيل/إيقاف · الأسهم تحريك ثانية':'Timeline — click or drag to seek · Space play/pause · Arrow keys step 1 second'}</label><input id="playhead" className="timeline-seek" type="range" min={0} max={e.duration||1} step={0.01} value={time} disabled={!ready} onChange={event=>seek(Number(event.target.value))}/>
    <fieldset disabled={!ready||busy} className="trim-fields"><legend>{ar?'تحديد المقطع':'Clip selection'}</legend><label>{ar?'البداية بالثواني':'Start (seconds)'}<input type="number" min={0} max={e.end-.1} step={.1} value={Number(e.start.toFixed(2))} onChange={event=>{const value=Number(event.target.value);e.trim(value,e.end);seek(value)}}/><input aria-label={ar?'سحب بداية المقطع':'Drag clip start'} type="range" min={0} max={e.duration||1} step={.1} value={e.start} onChange={event=>{const value=Math.min(Number(event.target.value),e.end-.1);e.trim(value,e.end);seek(value)}}/><button className="text-button" onClick={()=>e.trim(time,e.end)}>{ar?'اجعل البداية هنا':'Set start here'}</button></label><label>{ar?'النهاية بالثواني':'End (seconds)'}<input type="number" min={e.start+.1} max={e.duration} step={.1} value={Number(e.end.toFixed(2))} onChange={event=>e.trim(e.start,Number(event.target.value))}/><input aria-label={ar?'سحب نهاية المقطع':'Drag clip end'} type="range" min={0} max={e.duration||1} step={.1} value={e.end} onChange={event=>e.trim(e.start,Math.max(Number(event.target.value),e.start+.1))}/><button className="text-button" onClick={()=>e.trim(e.start,time)}>{ar?'اجعل النهاية هنا':'Set end here'}</button></label><div><strong>{(e.end-e.start).toFixed(1)} {ar?'ثانية':'seconds'}</strong><p>{ar?'حد المقطع 5 دقائق':'Up to 5 minutes per clip'}</p></div></fieldset>
    <fieldset disabled={!ready||busy} className="crop-fields"><legend>{ar?'موضع القص الرأسي — معاينة مباشرة':'Vertical framing — live preview'}</legend><label>{ar?'أفقي':'Horizontal'}<input type="range" min={0} max={1} step={.001} value={e.cropX} onChange={event=>e.setCrop('cropX',Number(event.target.value))}/></label><label>{ar?'رأسي':'Vertical'}<input type="range" min={0} max={1} step={.001} value={e.cropY} onChange={event=>e.setCrop('cropY',Number(event.target.value))}/></label><label className="mute-control"><input type="checkbox" checked={e.muted} onChange={event=>e.setMuted(event.target.checked)}/>{ar?'كتم الصوت':'Mute audio'}</label><label>FPS <select value={e.fps} onChange={event=>e.setFps(Number(event.target.value) as 30|60)}><option value={30}>30</option><option value={60}>60</option></select></label></fieldset>
    <fieldset disabled={!ready||busy} className="facecam-fields"><legend>{ar?'كاميرا الوجه':'Face Cam'}</legend><label className="facecam-enable"><input type="checkbox" checked={e.faceCam.enabled} onChange={event=>e.setFaceCam({...e.faceCam,enabled:event.target.checked})}/>{ar?'إظهار كاميرا الوجه':'Show face camera'}</label>{e.faceCam.enabled&&<><p>{ar?'اسحب مستطيلًا حول كاميرا الوجه داخل الفيديو الأصلي، أو اضبط حجمه من أدوات التحديد.':'Drag a rectangle around the face camera in the source video, or adjust its size below.'}</p><label>{ar?'عرض المنطقة':'Region width'}<input type="range" min={.02} max={1-e.faceCam.x} step={.01} value={e.faceCam.width} onChange={event=>e.setFaceCam({...e.faceCam,width:Number(event.target.value)})}/></label><label>{ar?'ارتفاع المنطقة':'Region height'}<input type="range" min={.02} max={1-e.faceCam.y} step={.01} value={e.faceCam.height} onChange={event=>e.setFaceCam({...e.faceCam,height:Number(event.target.value)})}/></label><label>{ar?'حجمها في الناتج':'Overlay size'}<input type="range" min={.1} max={.6} step={.01} value={e.faceCam.size} onChange={event=>e.setFaceCam({...e.faceCam,size:Number(event.target.value)})}/></label><label>{ar?'مكان الظهور':'Placement'}<select value={e.faceCam.placement} onChange={event=>{const placement=event.target.value as 'top'|'bottom'|'custom';e.setFaceCam({...e.faceCam,placement,positionY:placement==='top'?.05:placement==='bottom'?.88:e.faceCam.positionY})}}><option value="top">{ar?'أعلى':'Top'}</option><option value="bottom">{ar?'أسفل':'Bottom'}</option><option value="custom">{ar?'مخصص':'Custom'}</option></select></label>{e.faceCam.placement==='custom'&&<><label>{ar?'أفقي':'Horizontal'}<input type="range" min={0} max={1} step={.01} value={e.faceCam.positionX} onChange={event=>e.setFaceCam({...e.faceCam,positionX:Number(event.target.value)})}/></label><label>{ar?'رأسي':'Vertical'}<input type="range" min={0} max={1} step={.01} value={e.faceCam.positionY} onChange={event=>e.setFaceCam({...e.faceCam,positionY:Number(event.target.value)})}/></label></>}</>}</fieldset>
    <p className="link-help">{ar?'تكوين Face Cam يدوي وثابت محفوظ داخل المشروع؛ تتبع الوجه أو الهدف وتصحيحه بمفاتيح الحركة ما زال ضمن الخطة. تحليل تغيّر المشاهد متاح أعلاه.':'Face Cam region and placement are saved as a static manual composition. Automatic tracking and keyframe corrections remain planned. Visual scene analysis is available above.'}</p>
    </section>
    <div className="project-save-status" role="status" aria-live="polite">{e.saveStatus==='saving'?(ar?'جارٍ حفظ المشروع…':'Saving project…'):e.saveStatus==='error'?(<><span className="error-message">{ar?'تعذر حفظ المشروع':'Project could not be saved'}</span><button className="text-button" onClick={()=>{const state=useEditor.getState(),snapshot:EditorSettings={start:state.start,end:state.end,cropX:state.cropX,cropY:state.cropY,muted:state.muted,fps:state.fps,faceCam:state.faceCam};state.setSaveStatus('saving');void saveSnapshot(snapshot).catch(error=>{state.setSaveStatus('error');state.setMessage(error instanceof Error?error.message:'Project save failed.')})}}>{ar?'إعادة المحاولة':'Retry'}</button></>):e.dirty?(ar?'تعديلات غير محفوظة · الحفظ بعد 5 ثوانٍ':'Unsaved changes · saving in 5 seconds'):(ar?'تم حفظ التعديلات':'Changes saved')}</div>
    {(e.job||e.message||e.exportChoosing)&&<section className="operation-status export-progress" role="status" aria-live="polite">{e.exportChoosing&&<span>{ar?'نافذة اختيار مكان الحفظ مفتوحة.':'The destination dialog is open.'}</span>}{e.job?.status==='running'&&<><progress max={1} value={e.job.progress}/><span>{Math.floor(e.job.progress*100)}%</span><button className="button-secondary" onClick={()=>void window.youcut.cancelExport()}>{ar?'إلغاء التصدير':'Cancel export'}</button></>}{e.job?.status==='complete'&&<span>{ar?'تم حفظ الفيديو: ':'Video saved: '}{e.job.path}</span>}{e.job?.status==='cancelled'&&<span>{ar?'تم إلغاء التصدير.':'Export cancelled.'}</span>}{e.job?.status==='error'&&<span className="error-message">{e.job.error}</span>}{e.message&&<span>{e.message}</span>}</section>}
  </div>
}
