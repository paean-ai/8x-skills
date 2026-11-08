// Linkedom's on* setters register their function through addEventListener.
// Plain adapter window objects do not, so call their property only if absent.
export function invokeListeners(target,event,capture,registered,remove,report){
  const snapshot=[...registered],property=target['on'+event.type];
  for(const listener of snapshot){
    if(listener.capture!==capture)continue;
    if(listener.once)remove(listener);
    try{typeof listener.fn==='function'?listener.fn.call(target,event):listener.fn.handleEvent(event);}catch(error){report(error);}
    if(event.immediate)break;
  }
  if(!capture&&!event.immediate&&typeof property==='function'&&!snapshot.some(l=>!l.capture&&l.fn===property)){
    try{property.call(target,event);}catch(error){report(error);}
  }
}
