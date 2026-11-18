/* Tensor-first RGB bicubic antialias resize, matching PyTorch's AA kernel.
 * Do not replace with Canvas drawImage resizing: it changes model inputs. */
(function(root){
'use strict';
const N=224, mean=[.5187,.2813,.2154], std=[.2786,.1975,.1759];
const f=Math.fround;
function cubic(x){x=Math.abs(x);return x<1?f(f(f(f(1.5*x)-2.5)*x)*x+1):x<2?f(f(f(f(f(-.5*x)+2.5)*x)-4)*x+2):0;}
function weights(size){const scale=f(size/N), support=f(2*Math.max(scale,1)), factor=f(1/Math.max(scale,1));
 return Array.from({length:N},(_,i)=>{const center=f((i+.5)*scale), lo=Math.max(0,Math.trunc(f(center-support)+.5)), hi=Math.min(size,Math.trunc(f(center+support)+.5));
 const w=[];let sum=0;for(let j=lo;j<hi;j++){const v=cubic(f((f(j-center)+.5)*factor));w.push(v);sum=f(sum+v);}return {lo,w:Float32Array.from(w,v=>f(v/sum))};});}
function preprocess(rgba,width,height,channels=4){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>12000||height>12000||width*height>24000000||rgba.length!==width*height*channels)throw Error('Image dimensions unsupported (maximum 24 megapixels).');
 const wx=weights(width), wy=weights(height), tmp=new Float32Array(height*N*3), output=new Float32Array(3*N*N);
 for(let y=0;y<height;y++)for(let x=0;x<N;x++)for(let c=0;c<3;c++){
  let s=0;const {lo,w}=wx[x];for(let k=0;k<w.length;k++)s=Math.fround(s+Math.fround(Math.fround(rgba[(y*width+lo+k)*channels+c]/255)*w[k]));tmp[(y*N+x)*3+c]=s;
 }
 for(let y=0;y<N;y++)for(let x=0;x<N;x++)for(let c=0;c<3;c++){
  let s=0;const {lo,w}=wy[y];for(let k=0;k<w.length;k++)s=Math.fround(s+Math.fround(tmp[((lo+k)*N+x)*3+c]*w[k]));output[c*N*N+y*N+x]=Math.fround(Math.fround(s-Math.fround(mean[c]))/Math.fround(std[c]));
 }return output;
}
function softmax(values){if(!values.length||!Array.from(values).every(Number.isFinite))throw Error('Invalid model output');const m=Math.max(...values),e=Array.from(values,v=>Math.exp(v-m)),s=e.reduce((a,b)=>a+b,0);return e.map(v=>v/s);}
root.FastUGI={preprocess,softmax};if(typeof module!=='undefined')module.exports=root.FastUGI;
})(globalThis);
