import { creationPage, validateCreationQuery } from './creation-index.mjs';

/** Rebuild the observed creation graph from a verified directory only. Never executes source. */
export function inspectPortableBundle(bundle, section='summary', offset=0, limit=50) {
  validateCreationQuery(section,offset,limit);
  const {manifest,blobs}=bundle;
  const records=[{type:'paean_creation_bundle',version:1,streams:manifest.streams}],sources=new Map();
  for(const stream of manifest.streams) {
    const file=manifest.files.find(f=>f.kind==='session'&&f.streamId===stream.id);
    const lines=blobs.get(file.id).toString('utf8').split(/\r?\n/);
    lines.forEach((line,i)=>{
      if(!line.trim())return;
      sources.set(records.length+1,{fileId:file.id,path:file.path,line:i+1});
      records.push({type:'creation_event',streamId:stream.id,event:JSON.parse(line)});
    });
  }
  for(const file of manifest.files.filter(f=>f.kind==='script')) records.push({type:'creation_script',scriptId:file.id,path:file.path,streamId:file.streamId,callId:file.callId,content:blobs.get(file.id).toString('utf8')});
  const page=creationPage(records,section,offset,limit);
  if(section==='summary')return {...page,format:'creation-bundle-v2',manifestDigest:bundle.manifestDigest,fileCount:manifest.files.length,integrityVerified:true};
  if(section==='events')for(const event of page.items)event.source=sources.get(event.record);
  if(section==='tools')for(const tool of page.items)for(const observation of [...tool.calls,...tool.results])observation.source=sources.get(observation.record);
  return page;
}
