// Dependencies need these APIs during module evaluation, before initialize().
// Keep them scoped to the bundle; do not install a fake Node Buffer or window.
import {TextEncoder as UTF8Encoder,TextDecoder as UTF8Decoder} from 'text-encoding-utf-8';
export {atob,btoa} from './base64.js';
export const global=globalThis;
export const TextEncoder=globalThis.TextEncoder||UTF8Encoder;
export const TextDecoder=globalThis.TextDecoder||UTF8Decoder;
