// Animate the approved masthead's lime light while leaving its lettering fixed.
// Requires an installed ffmpeg. No downloads or project dependencies.
// Usage: node scripts/make-readme-animation.mjs
import {spawn, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {once} from 'node:events';

const root=resolve(import.meta.dirname,'..');
const width=768,height=512,frames=48,fps=16;
const source=resolve(root,'assets/brand/readme-meteor.png');
const output=resolve(root,'assets/brand/readme-meteor.gif');
const decoded=spawnSync('ffmpeg',['-v','error','-threads','1','-i',source,'-vf',`scale=${width}:${height}:flags=lanczos`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:width*height*3+1024*1024});
if(decoded.status!==0)throw new Error(decoded.stderr?.toString()||'ffmpeg decode failed');
const original=decoded.stdout;
if(original.length!==width*height*3)throw new Error('Unexpected decoded dimensions');
const field=new Float32Array(width*height*3);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const i=(y*width+x)*3,r=original[i],g=original[i+1],b=original[i+2];
 // Color mask excludes neutral background and the entire wordmark area.
 const fade=Math.max(0,Math.min(1,(width*.59-x)/20));
 field[i]=fade*Math.max(0,Math.min(1,(g-Math.max(r*.94,b)*1.08-14)/110));
 field[i+1]=(x-y)*.037;
 field[i+2]=(x+y)*.051;
}
const encoder=spawn('ffmpeg',['-v','error','-threads','1','-filter_complex_threads','1','-y','-f','rawvideo','-pixel_format','rgb24','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-filter_complex','[0:v]split[a][b];[a]palettegen=stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle','-loop','0',output],{stdio:['pipe','inherit','inherit']});
const done=once(encoder,'close');
const sample=(x,y,c)=>{
 x=Math.max(0,Math.min(width-1.001,x));y=Math.max(0,Math.min(height-1.001,y));
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,i=(iy*width+ix)*3+c;
 return (original[i]*(1-fx)+original[i+3]*fx)*(1-fy)+(original[i+width*3]*(1-fx)+original[i+width*3+3]*fx)*fy;
};
for(let frame=0;frame<frames;frame++){
 const phase=frame/frames*Math.PI*2,out=Buffer.from(original);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*3,m=field[i];if(m<.005)continue;
  const u=field[i+1],v=field[i+2];
  const flow=(Math.sin(u-phase*2)-Math.sin(u))*.8+(Math.sin(v+u*.7-phase*3)-Math.sin(v+u*.7))*.35;
  const ripple=(Math.sin(v-phase)-Math.sin(v))*.6;
  const dx=m*(flow+ripple)*1.25,dy=m*(flow-ripple)*.9;
  const light=1+m*(Math.sin(u*1.8-phase*2)-Math.sin(u*1.8))*.045;
  for(let c=0;c<3;c++)out[i+c]=Math.max(0,Math.min(255,Math.round(sample(x+dx,y+dy,c)*light)));
 }
 if(!encoder.stdin.write(out))await once(encoder.stdin,'drain');
}
encoder.stdin.end();
const [code]=await done;
if(code!==0)throw new Error(`ffmpeg exited ${code}`);
console.log(JSON.stringify({output,width,height,frames,fps,seconds:frames/fps,loop:true}));
