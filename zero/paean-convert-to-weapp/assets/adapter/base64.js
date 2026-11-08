const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function btoa(input){
  const s=String(input);let out='';
  for(let i=0;i<s.length;i+=3){const a=s.charCodeAt(i),b=s.charCodeAt(i+1),c=s.charCodeAt(i+2);if(a>255||b>255||c>255)throw new Error('InvalidCharacterError');const n=(a<<16)|((b||0)<<8)|(c||0);out+=alphabet[n>>>18&63]+alphabet[n>>>12&63]+(i+1<s.length?alphabet[n>>>6&63]:'=')+(i+2<s.length?alphabet[n&63]:'=');}
  return out;
}
export function atob(input){
  let s=String(input).replace(/[\t\n\f\r ]/g,'');if(s.length%4===0)s=s.replace(/==?$/,'');if(s.length%4===1||/[^A-Za-z0-9+/]/.test(s))throw new Error('InvalidCharacterError');let out='',bits=0,value=0;for(const c of s){value=(value<<6)|alphabet.indexOf(c);bits+=6;if(bits>=8){bits-=8;out+=String.fromCharCode(value>>>bits&255);}}return out;
}
export function decodeBase64(input){return Uint8Array.from(atob(input),c=>c.charCodeAt(0)).buffer;}
