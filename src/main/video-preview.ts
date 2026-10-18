import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { findFfmpeg, probeMedia } from './video-export'
import type { PreviewJob } from '../shared/contracts'
export function previewArguments(input:string,output:string) {
  return ['-hide_banner','-nostdin','-n','-i',input,'-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",'-c:v','libx264','-preset','ultrafast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-b:a','128k','-movflags','+faststart','-progress','pipe:1','-nostats',output]
}
export class PreviewRunner {
  job:PreviewJob|null=null
  source:string|null=null
  output:string|null=null
  private child:ChildProcess|null=null
  private cancelled=false
  private files=new Set<string>()
  private cache=new Map<string,string>()
  async start(input:string,directory:string) {
    if(this.job?.status==='running')throw new Error('Preview preparation is already running.')
    const job:PreviewJob={id:randomUUID(),status:'running',progress:0}
    this.job=job;this.source=input;this.output=null;this.cancelled=false
    void(async()=>{
      let temp:string|null=null
      try {
        const details=await stat(input),key=`${input}|${details.size}|${details.mtimeMs}`
        const cached=this.cache.get(key)
        if(cached) { try { await stat(cached);this.output=cached;job.status='complete';job.progress=1;return } catch { this.cache.delete(key) } }
        await mkdir(directory,{recursive:true})
        temp=join(directory,`preview-${job.id}.mp4`);this.files.add(temp)
        const executable=await findFfmpeg(),info=await probeMedia(executable,input)
        if(this.cancelled){job.status='cancelled';return}
        await new Promise<void>((resolve,reject)=>{
          const child=spawn(executable,previewArguments(input,temp!),{windowsHide:true});this.child=child
          let pending='',diagnostic=''
          child.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop()||'';for(const line of lines){const match=/^out_time_us=(\d+)/.exec(line);if(match)job.progress=Math.min(.99,Number(match[1])/1000000/info.duration)}})
          child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk).slice(-1200)})
          child.on('error',()=>reject(new Error('FFmpeg could not start.')))
          child.on('close',code=>code===0?resolve():reject(new Error(`Could not prepare this video. ${diagnostic.slice(-400)}`)))
        })
        if(this.cancelled){job.status='cancelled';return}
        const prepared=await probeMedia(executable,temp)
        if(Math.abs(prepared.duration-info.duration)>Math.max(1,info.duration*.01))throw new Error('Preview duration does not match the source.')
        if(this.cancelled){job.status='cancelled';return}
        this.output=temp;this.cache.set(key,temp);job.progress=1;job.status='complete'
      }catch(error){job.status=this.cancelled?'cancelled':'error';if(!this.cancelled)job.error=error instanceof Error?error.message:'Preview preparation failed.'}
      finally{this.child=null;if(temp&&job.status!=='complete'){await rm(temp,{force:true}).catch(()=>{});this.files.delete(temp)}}
    })()
    return {...job}
  }
  cancel(){if(this.job?.status==='running'){this.cancelled=true;this.child?.kill()}}
  async dispose(){this.cancel();while(this.job?.status==='running')await new Promise(resolve=>setTimeout(resolve,50));await Promise.allSettled([...this.files].map(path=>rm(path,{force:true})));this.files.clear();this.cache.clear()}
}
