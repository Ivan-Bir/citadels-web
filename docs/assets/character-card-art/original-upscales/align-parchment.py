#!/usr/bin/env python3
"""Reproduce accepted 2_2/6_2 whole-canvas parchment alignment in a safe output directory.

Requires NumPy and Pillow. Only reads repository inputs. Existing output files and
output directories under public/ are rejected; canonical JPEGs are never changed.
"""
from pathlib import Path
import argparse
import hashlib
import io
import json
import numpy as np
from PIL import Image

SPEC = {
    '2_2': ([0,22,120,1076.5,1377,1417], [0,23,121.5,1099,1395,1417]),
    '6_2': ([0,24,121,1075.5,1373.5,1417], [0,25.5,122.5,1100,1396,1417]),
}
ASSET_DIR = Path('docs/assets/character-card-art/original-upscales')
GEOMETRY = ASSET_DIR / 'parchment-layout-source-measurements.json'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def encode(im):
 trials=[]
 for q in range(100,0,-1):
  b=io.BytesIO();im.save(b,format='JPEG',quality=q,subsampling=0,optimize=True,progressive=False);raw=b.getvalue();trials.append({'q':q,'bytes':len(raw)})
  if 200000<=len(raw)<=300000:return raw,q,trials
  if len(raw)<200000:raise RuntimeError('No integer 4:4:4 quality meets bytes')
 raise RuntimeError('quality search failed')
def remap_y_lanczos3(im,input_nodes,target_nodes):
 # The only vertical image sampling operation. All destination rows use the same
 # continuous inverse map, including source art, text, parchment and background.
 # Pixel coordinates are edge based: image domain [0,H], centers at y+0.5.
 height=im.height
 # Horizontal-only resample keeps source height; vertical remap follows once.
 x_resized=im.resize((814,height),Image.Resampling.LANCZOS)
 src=np.asarray(x_resized,dtype=np.float64)
 result=np.empty((1417,814,3),dtype=np.uint8)
 centers=np.arange(1417,dtype=np.float64)+0.5
 source_centers=np.interp(centers,target_nodes,input_nodes)*height/1417-0.5
 # Anti-alias filter support uses the input interval covered by each output pixel.
 source_left=np.interp(np.arange(1417,dtype=np.float64),target_nodes,input_nodes)*height/1417
 source_right=np.interp(np.arange(1417,dtype=np.float64)+1,target_nodes,input_nodes)*height/1417
 scales=np.maximum(1.,source_right-source_left)
 for y,(coord,scale) in enumerate(zip(source_centers,scales)):
  radius=3*scale
  indices=np.arange(int(np.floor(coord-radius)),int(np.ceil(coord+radius))+1,dtype=np.int64)
  t=(coord-indices)/scale
  weights=np.sinc(t)*np.sinc(t/3)
  weights[np.abs(t)>=3]=0
  weights/=np.sum(weights)
  row=np.tensordot(weights,src[np.clip(indices,0,height-1)],axes=(0,0))
  result[y]=np.rint(np.clip(row,0,255)).astype(np.uint8)
 return Image.fromarray(result),{'firstSourceCenter':float(source_centers[0]),'lastSourceCenter':float(source_centers[-1]),'minAntialiasScale':float(scales.min()),'maxAntialiasScale':float(scales.max())}

def produce_candidate(repo, card_id, output_dir):
    """Return one reproduced JPEG plus its encoding/checksum metadata."""
    repo = Path(repo).resolve()
    output_dir = Path(output_dir).resolve()
    if card_id not in SPEC:
        raise ValueError('Only accepted correction IDs 2_2 and 6_2 are supported')
    if output_dir.is_relative_to(repo / 'public'):
        raise ValueError('Output directory must be outside repository public/')
    geometry = json.loads((repo / GEOMETRY).read_text())
    card = next(c for c in geometry['cards'] if c['id'] == card_id)
    # Resolve the report-selected file by its basename below the repository asset
    # directory. Historical absolute paths in the report are not dependencies.
    source = repo / ASSET_DIR / Path(card['selected_image']).name
    source_bytes = source.read_bytes()
    image = Image.open(io.BytesIO(source_bytes))
    image.load()
    image = image.convert('RGB')
    input_nodes, target_nodes = SPEC[card_id]
    candidate, sampling = remap_y_lanczos3(image, input_nodes, target_nodes)
    data, quality, trials = encode(candidate)
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f'character-layout-candidate-{card_id}.jpg'
    with output.open('xb') as handle:
        handle.write(data)
    if source.read_bytes() != source_bytes:
        raise RuntimeError('Source unexpectedly changed during reproduction')
    return {
        'id': card_id, 'sourcePath': str(source.relative_to(repo)),
        'sourceSha256': sha(source_bytes), 'outputPath': str(output),
        'outputSha256': sha(data), 'bytes': len(data),
        'width': 814, 'height': 1417, 'quality': quality,
        'qualityPlusOneBytes': next(t['bytes'] for t in trials if t['q'] == quality + 1),
        'sampling': sampling,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[4])
    parser.add_argument('--output-dir', type=Path, required=True,
                        help='Separate output directory; existing JPEGs are refused')
    parser.add_argument('--id', choices=tuple(SPEC), action='append', dest='ids',
                        help='Reproduce only this ID (repeatable); default: both')
    args = parser.parse_args()
    results = [produce_candidate(args.repo, card_id, args.output_dir)
               for card_id in (args.ids or list(SPEC))]
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
