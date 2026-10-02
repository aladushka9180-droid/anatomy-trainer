import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
export function startServer(port=0){
  const server=createServer((request,response)=>{
    const route=new URL(request.url,'http://localhost').pathname;
    const allowed={'/':'tests/certificate-designer-fixture.html','/fixture.html':'tests/certificate-designer-fixture.html','/certificate-renderer.js':'certificate-renderer.js','/certificate-designer.js':'certificate-designer.js','/certificate-client-card.js':'certificate-client-card.js','/certificate-layout-detector.js':'certificate-layout-detector.js','/certificate-designer.css':'certificate-designer.css','/service-presets-catalog.js':'service-presets-catalog.js'};
    if(/^\/vendor\/certificate-ocr\/(tesseract\.min\.js|worker\.min\.js|tesseract-core(-simd)?(-lstm)?\.wasm\.js|(rus|eng)\.traineddata\.gz)$/.test(route))allowed[route]=route.slice(1);
    allowed['/certificate-template-library.js']='certificate-template-library.js';
    if(!allowed[route]){response.writeHead(404).end();return}
    let source=readFileSync(path.join(root,allowed[route]));
    if(route==='/'||route==='/fixture.html'){
      let image='__NO_IMAGE__';
      if(process.env.MINUTA_CERTIFICATE_TEMPLATE){const name=process.env.MINUTA_CERTIFICATE_TEMPLATE;const mime=/\.webp$/i.test(name)?'webp':/\.jpe?g$/i.test(name)?'jpeg':'png';image=`data:image/${mime};base64,${readFileSync(name).toString('base64')}`}
      source=Buffer.from(source.toString().replace('__CERTIFICATE_IMAGE__',image));
    }
    response.writeHead(200,{'Content-Type':route.endsWith('.js')?'text/javascript; charset=utf-8':route.endsWith('.css')?'text/css; charset=utf-8':route.endsWith('.gz')?'application/octet-stream':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(source);
  });
  return new Promise(resolve=>server.listen(port,'127.0.0.1',()=>resolve({server,url:`http://127.0.0.1:${server.address().port}`})));
}
if(process.argv.includes('--serve')){const result=await startServer(Number(process.argv.at(-1))||0);console.log(result.url);}
