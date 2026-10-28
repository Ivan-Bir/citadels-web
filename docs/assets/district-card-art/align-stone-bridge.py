"""Archived REJECTED v4 attempt: title relocation created visible artifacts.
Do not reuse for the next correction: extend approved v1 below instead.
"""
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
import json

folder = Path(__file__).resolve().parent
source = folder / 'stone-bridge-v1.png'
output = folder / 'stone-bridge-v4-aligned.png'
original = Image.open(source).convert('RGB')
assert original.size == (996, 1580)
a = np.array(original)
# Restrict the edit mask to the existing name, away from the ability and ribbon edges.
x0, y0, x1, y1 = 205, 1465, 830, 1546
roi = a[y0:y1, x0:x1]
ink = np.all(roi < 110, axis=2)
mask = np.array(Image.fromarray(ink.astype('uint8') * 255).filter(ImageFilter.MaxFilter(5))) > 0
paper = roi.copy()
# Reconstruct only the covered parchment pixels from their same-row neighbours.
for y in range(mask.shape[0]):
    xs = np.flatnonzero(mask[y])
    if not len(xs):
        continue
    groups = np.split(xs, np.where(np.diff(xs) != 1)[0] + 1)
    for group in groups:
        left, right = max(0, int(group[0])-1), min(mask.shape[1]-1, int(group[-1])+1)
        assert not mask[y,left] and not mask[y,right]
        for x in group:
            t = (x-left)/(right-left)
            paper[y,x] = np.round((1-t)*roi[y,left].astype(float)+t*roi[y,right].astype(float))
alpha = np.clip(1 - roi[:,:,0].astype(float)/np.maximum(paper[:,:,0],1),0,1)
alpha[~mask] = 0
alpha = Image.fromarray(np.round(alpha*255).astype('uint8'))
ys,xs=np.where(np.array(alpha)>20)
alpha=alpha.crop((int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1))
clean = a.copy()
clean[y0:y1,x0:x1] = paper
base = Image.fromarray(clean).resize((707,1121),Image.Resampling.LANCZOS)
unmodified = original.resize((707,1121),Image.Resampling.LANCZOS)
# Keep the approved scene and ability unchanged; translate the lower name ribbon only.
strip_top, shift = 1000, 22
ribbon = base.crop((0,strip_top,707,1121))
result = base.copy()
# The original last row is uncovered dark background, not parchment.
edge = np.array(original.crop((0,1579,996,1580)).resize((707,1),Image.Resampling.LANCZOS))[0].astype(float)
neutral = np.median(edge,axis=0)
pad_height = 1121-(strip_top-shift)
background_rows = np.empty((pad_height,707,3),dtype='uint8')
for row in range(pad_height):
    blend = max(0,min(1,(row-(1121-strip_top))/max(1,shift-1)))
    background_rows[row] = np.round((1-blend)*edge + blend*neutral)
background = Image.fromarray(background_rows)
result.paste(background,(0,strip_top-shift))
result.paste(ribbon,(0,strip_top-shift))
# Preserve the exact generated glyph shapes; size/position the ink, not its text box.
height = 55
for _ in range(12):
    glyph = alpha.resize((round(alpha.width*height/alpha.height),height),Image.Resampling.LANCZOS)
    gy,gx=np.where(np.array(glyph)>=160)
    core_height=int(gy.max()-gy.min()+1)
    if core_height == 53:
        break
    height += 53-core_height
else:
    raise RuntimeError('Cannot reach the target ink height')
px=(707-glyph.width)//2
py=1024-int(gy.min())
result.paste((0,0,0),(px,py,px+glyph.width,py+glyph.height),glyph)
assert result.size==(707,1121)
assert np.array_equal(np.array(result)[:strip_top-shift], np.array(unmodified)[:strip_top-shift])
result.save(output)
meta={
    'source':'stone-bridge-v1.png','artifact':output.name,
    'method':'user-authorized deterministic PNG edit; no new generation',
    'dimensions':{'width':707,'height':1121},
    'references':['public/cards/monument.jpg','public/cards/harbor.jpg'],
    'nameInkTop':1024,'nameInkBaseline':1076,'nameInkHeight':53,
    'ribbonTranslationPx':-shift,'newBottomBackgroundPx':shift,
    'unchangedAreaAfterUniformResize':[0,0,707,strip_top-shift],
    'glyphs':'reused from approved v1, no font substitution',
    'status':'rejected-by-user'
}
(folder/'stone-bridge-v4-aligned-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(meta,ensure_ascii=False))
