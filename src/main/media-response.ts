import { stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { extname } from 'node:path'
export async function mediaResponse(path:string,range:string|null,method='GET') {
  const {size}=await stat(path)
  const types:Record<string,string>={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo'}
  const headers=new Headers({'Content-Type':types[extname(path).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*'})
  let start=0,end=size-1,status=200
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range)
    if(match&&(match[1]||match[2])) {
      start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]))
      end=match[1]&&match[2]?Math.min(size-1,Number(match[2])):size-1
      status=206
    }else start=-1
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start){headers.set('Content-Range',`bytes */${size}`);return new Response(null,{status:416,headers})}
    headers.set('Content-Range',`bytes ${start}-${end}/${size}`)
  }
  headers.set('Content-Length',String(Math.max(0,end-start+1)))
  if(method==='HEAD'||size===0)return new Response(null,{status,headers})
  return new Response(Readable.toWeb(createReadStream(path,{start,end})) as ReadableStream,{status,headers})
}
