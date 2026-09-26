// Animate flowing light in the approved masthead while leaving its lettering fixed.
// Requires an installed ffmpeg. No downloads or project dependencies.
// Usage: node scripts/make-readme-animation.mjs
import {spawn, spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {once} from 'node:events';

const root=resolve(import.meta.dirname,'..');
const width=768,height=512,frames=60,fps=20;
const source=resolve(root,'assets/brand/readme-meteor.png');
const output=resolve(root,'assets/brand/readme-meteor.gif');
const decoded=spawnSync('ffmpeg',['-v','error','-threads','1','-i',source,'-vf',`scale=${width}:${height}:flags=lanczos`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:width*height*3+1024*1024});
if(decoded.status!==0)throw new Error(decoded.stderr?.toString()||'ffmpeg decode failed');
const original=decoded.stdout;
if(original.length!==width*height*3)throw new Error('Unexpected decoded dimensions');
const field=new Float32Array(width*height*3);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const i=(y*width+x)*3,g=original[i+1],b=original[i+2];
 // Include the pale yellow-green head, not only the saturated green filaments.
 // The spatial mask keeps the wordmark and the floor reflection entirely still.
 const fade=Math.max(0,Math.min(1,(width*.59-x)/20))*Math.max(0,Math.min(1,(height*.84-y)/16));
 field[i]=fade*Math.max(0,Math.min(1,(g-b-20)/95));
 field[i+1]=(x-y)*.028;
 field[i+2]=(x+y)*.043;
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
  // Several CSS pixels of fluid motion remain visible at a phone-sized width.
  // Integer phase harmonics make the last-to-first transition continuous.
  const flow=(Math.sin(u-phase*2)-Math.sin(u))*.8+(Math.sin(v+u*.7-phase*3)-Math.sin(v+u*.7))*.35;
  const ripple=(Math.sin(v-phase)-Math.sin(v))*.65;
  const dx=m*(flow+ripple)*5,dy=m*(flow-ripple)*3.6;
  const light=1+m*(Math.sin(u*1.4-phase*2)-Math.sin(u*1.4))*.17;
  for(let c=0;c<3;c++)out[i+c]=Math.max(0,Math.min(255,Math.round(sample(x+dx,y+dy,c)*light)));
 }
 if(!encoder.stdin.write(out))await once(encoder.stdin,'drain');
}
encoder.stdin.end();
const [code]=await done;
if(code!==0)throw new Error(`ffmpeg exited ${code}`);
console.log(JSON.stringify({output,width,height,frames,fps,seconds:frames/fps,loop:true}));
