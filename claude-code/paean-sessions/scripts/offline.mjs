import { creationScanner, validateCreationQuery } from './creation-index.mjs';
import { streamFiles } from './multi-file.mjs';

/** Rebuild the observed graph one file at a time. No database, network or execution. */
export function inspectPortableBundle(bundle, section='summary', offset=0, limit=50) {
  validateCreationQuery(section,offset,limit);
  const {manifest,blobs}=bundle,scripts=manifest.files.filter(f=>f.kind==='script').map(f=>({...f,type:'creation_script',scriptId:f.id}));
  if(section==='scripts')return {section,total:scripts.length,offset,nextOffset:offset+limit<scripts.length?offset+limit:null,items:scripts.slice(offset,offset+limit).map(f=>({...f,content:blobs.get(f.id).toString('utf8')}))};
  const scan=creationScanner(manifest.streams,scripts,section,offset,limit);let record=2;
  for(const stream of manifest.streams)for(const file of streamFiles(manifest,stream.id)) {
    const lines=blobs.get(file.id).toString('utf8').split(/\r?\n/);
    for(let i=0;i<lines.length;i++) {
      if(!lines[i].trim())continue;
      scan.add({streamId:stream.id,record:record++,event:JSON.parse(lines[i]),source:{fileId:file.id,path:file.path,line:i+1}});
    }
  }
  const inspection=scan.finish();
  if(section==='summary')return {...inspection.summary,manifestDigest:bundle.manifestDigest,fileCount:manifest.files.length,integrityVerified:true};
  const rows=inspection[section],total=section==='events'?inspection.summary.eventCount:rows.length;
  return {section,total,offset,nextOffset:offset+limit<total?offset+limit:null,items:section==='events'?rows:rows.slice(offset,offset+limit)};
}
