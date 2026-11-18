importScripts('vendor/ort.wasm.min.js','preprocess.js');
ort.env.wasm.wasmPaths=new URL('vendor/',self.location.href).href;
ort.env.wasm.numThreads=1;
let session;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   session=await ort.InferenceSession.create('models/fastugi-b7.onnx',{executionProviders:['wasm'],graphOptimizationLevel:'all'});
   self.postMessage({type:'ready'});return;
  }
  if(!session)throw Error('Model is not ready');
  const start=performance.now();
  const input=FastUGI.preprocess(new Uint8ClampedArray(data.pixels),data.width,data.height);
  const outputs=await session.run({image:new ort.Tensor('float32',input,[1,3,224,224])});
  self.postMessage({type:'result',anatomy:FastUGI.softmax(outputs.anatomy.data),disease:FastUGI.softmax(outputs.disease.data),milliseconds:performance.now()-start});
  Object.values(outputs).forEach(t=>t.dispose());
 }catch(e){self.postMessage({type:'error',message:String(e.message||e)});}
};
