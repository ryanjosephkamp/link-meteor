"""Generate Link Meteor's original small raster icon without external libraries."""
from pathlib import Path
import math, struct, zlib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'src' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

def segment(x,y,ax,ay,bx,by,r):
    t=max(0,min(1,((x-ax)*(bx-ax)+(y-ay)*(by-ay))/((bx-ax)**2+(by-ay)**2)))
    return math.hypot(x-ax-t*(bx-ax),y-ay-t*(by-ay)) < r

def pixel(x,y):
    if max(abs(x-.5)-.32,0)**2+max(abs(y-.5)-.32,0)**2>.12**2: return (0,0,0,0)
    color=(37,39,34,255)
    if segment(x,y,.45,.57,.76,.22,.066) or segment(x,y,.62,.67,.82,.47,.035): color=(237,132,85,255)
    if segment(x,y,.29,.48,.54,.23,.024): color=(237,132,85,255)
    if math.hypot(x-.38,y-.64)<.184: color=(249,238,208,255)
    if math.hypot(x-.34,y-.68)<.093: color=(237,132,85,255)
    return color

def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
for size in (16,32,48,128):
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            samples=[pixel((x+(i+.5)/4)/size,(y+(j+.5)/4)/size) for j in range(4) for i in range(4)]
            raw.extend(round(sum(p[c] for p in samples)/16) for c in range(4))
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw)))+chunk(b'IEND',b'')
    (OUT / f'{size}.png').write_bytes(png)
print('Generated original 16/32/48/128px icons.')
