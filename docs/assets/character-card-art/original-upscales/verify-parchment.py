#!/usr/bin/env python3
"""Independent decoded-JPEG parchment layout QA; only report path is written.
Run with bundled Python (Pillow/numpy), e.g.:
python3 /tmp/character_parchment_jpeg_qa.py --repo /path/to/citadels-web --output /tmp/qa.json
Source JPGs are sole geometry truth. No assets or manifest are modified.
"""
from pathlib import Path
from PIL import Image
import argparse, json, numpy as np, hashlib
X=[.20,.30,.40,.50,.60,.70,.80,.88]
def runbounds(vals,lo,hi):
 # median strip color classification; vertical smoothing closes text gaps
 q=np.convolve(vals.astype(float),np.ones(13)/13,'same')>.48
 runs=[];st=None
 for y in range(lo,hi):
  if q[y] and st is None:st=y
  if (not q[y] or y==hi-1) and st is not None:
   en=y if not q[y] else y+1
   if en-st>18:runs.append((st,en))
   st=None
 if not runs:return None
 # group split blocks (<25 pixels, typography)
 merged=[]
 for a,b in runs:
  if merged and a-merged[-1][1]<25:merged[-1]=(merged[-1][0],b)
  else:merged.append((a,b))
 return max(merged,key=lambda t:t[1]-t[0])
def measure(im):
 a=np.asarray(im).astype(float);h,w=a.shape[:2];results={}
 for name,lo,hi in [('upper',0,round(h*.15)),('lower',round(h*.765),h)]:
  columns=[]
  for xr in ([.3,.4,.5,.6,.7,.8] if name=='upper' else X):
   x=round(w*xr); v=np.median(a[:,max(0,x-8):x+9,:],axis=1); r,g,b=v.T
   mask=(r>165)&(g>138)&(b>60)&(r-b>32)&(g-b>12)&(r<g*1.40)
   bounds=runbounds(mask,lo,hi)
   if name=='upper':
    rgb=np.stack([np.convolve(v[:,i],np.ones(3)/3,'same') for i in range(3)],axis=1)
    edge=np.linalg.norm(rgb[4:]-rgb[:-4],axis=1)
    nominal_bottom={.3:131,.4:124,.5:119,.6:119,.7:121,.8:123}[xr]*h/1417
    nominal_top={.3:24,.4:21,.5:19,.6:19,.7:21,.8:24}[xr]*h/1417
    def best(near,radius):
     ya=max(2,round(near-radius));yb=round(near+radius)
     return max(range(ya,yb+1),key=lambda y:edge[y-2])
    bounds=(best(nominal_top,13*h/1417),best(nominal_bottom,5*h/1417))
   columns.append({'x':x,'bounds':bounds})
  valid=[c['bounds'] for c in columns if c['bounds']]
  ytop=float(np.median([a for a,b in valid]));ybottom=float(np.median([b for a,b in valid]));
  # horizontal bounds from median color over middle quarter of body excluding text
  v=np.median(a[round(ytop+(ybottom-ytop)*.3):round(ytop+(ybottom-ytop)*.7),:,:],axis=0); r,g,b=v.T
  mask=(r>165)&(g>138)&(b>60)&(r-b>32)&(g-b>12)&(r<g*1.40)
  idx=np.where(mask)[0]; xmin=int(idx[0]) if len(idx) else None;xmax=int(idx[-1]) if len(idx) else None
  results[name]={'top':ytop,'bottom':ybottom,'center_y':(ytop+ybottom)/2,'left':xmin,'right':xmax,'center_x':(xmin+xmax)/2 if xmin is not None else None,'top_margin':ytop,'bottom_margin':h-ybottom,'columns':columns}
 return results


def lower(im,is_source=False,top_hint=None):
 a=np.asarray(im).astype(float);h,w=a.shape[:2]
 def edge(v):
  rgb=np.stack([np.convolve(v[:,i],np.ones(3)/3,'same') for i in range(3)],axis=1)
  dif=rgb[4:]-rgb[:-4];return np.linalg.norm(dif,axis=1),dif.mean(axis=1)
 v=np.median(a[:,round(w*.15):round(w*.85)],axis=1);e,dy=edge(v)
 def best(e,dy,lo,hi,direction):return max(range(round(lo),round(hi)+1),key=lambda y:e[y-2]*(1 if dy[y-2]*direction>0 else .03))
 toplo,tophi=(max(h*.74,top_hint-18),min(h*.79,top_hint+18)) if top_hint is not None else (h*(.765 if is_source else .74),h*.79)
 globaltop=best(e,dy,toplo,tophi,1);globalbottom=best(e,dy,h*.945,h*.995,-1)
 columns=[]
 for xr in X:
  x=round(w*xr);v=np.median(a[:,x-8:x+9],axis=1);e,dy=edge(v)
  top=best(e,dy,globaltop-7,globaltop+7,1);bottom=best(e,dy,globalbottom-8,globalbottom+8,-1)
  columns.append({'x':x,'x_fraction':xr,'bounds':[top,bottom]})
 top=float(np.median([c['bounds'][0] for c in columns]));bottom=float(np.median([c['bounds'][1] for c in columns]))
 # Horizontal bounds use the actual steep outer edge rather than brightness threshold on dark scroll roll.
 y0,y1=round(top+(bottom-top)*.2),round(top+(bottom-top)*.8)
 v=np.median(a[y0:y1],axis=0);rgb=np.stack([np.convolve(v[:,i],np.ones(3)/3,'same') for i in range(3)],axis=1);ex=np.linalg.norm(rgb[4:]-rgb[:-4],axis=1)
 left=max(range(round(w*.005),round(w*.07)),key=lambda x:ex[x-2]);right=max(range(round(w*.94),round(w*.998)),key=lambda x:ex[x-2]);
 return {'top':top,'bottom':bottom,'center_y':(top+bottom)/2,'left':left,'right':right,'center_x':(left+right)/2,'top_margin':top,'bottom_margin':h-bottom,'columns':columns,'whole_strip_top':globaltop,'whole_strip_bottom':globalbottom}
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--repo',type=Path,default=Path('/Users/i.biryukov/Documents/vk_dev/citadels-web'))
 parser.add_argument('--output',type=Path,required=True)
 parser.add_argument('--overrides-json',type=Path,help='Optional JSON object mapping character id to absolute candidate JPEG path; canonical JPEGs remain unchanged')
 args=parser.parse_args();repo=args.repo.resolve();folder=repo/'docs/assets/character-card-art/original-upscales'
 manifest=json.loads((folder/'manifest.json').read_text());cards=manifest['cards'];target_size=(814,1417)
 overrides=json.loads(args.overrides_json.read_text()) if args.overrides_json is not None else {}
 if not isinstance(overrides,dict):raise SystemExit('--overrides-json must contain an object mapping character id to absolute JPEG path')
 valid_ids={c['id'] for c in cards}
 for override_id,override_path in overrides.items():
  if override_id not in valid_ids:raise SystemExit(f'Unknown override id: {override_id}')
  if not isinstance(override_path,str) or not Path(override_path).is_absolute():raise SystemExit(f'Override must be absolute path: {override_id}')
 def jpeg_path(card):return Path(overrides[card['id']]) if card['id'] in overrides else repo/'public/characters'/f"{card['id']}-upscaled.jpg"
 def display_path(path):
  try:return str(path.relative_to(repo))
  except ValueError:return str(path)

 rows=[];missing=[]
 for card in cards:
  jp=jpeg_path(card)
  if not jp.exists():missing.append(str(jp))
 if missing:raise SystemExit('Missing JPEGs; QA not run: '+', '.join(missing))
 for card in cards:
  sp=repo/card['source'];jp=jpeg_path(card)
  with Image.open(sp) as opened:source_size=opened.size;src=opened.convert('RGB').resize(target_size,Image.Resampling.LANCZOS)
  with Image.open(jp) as opened:
   fmt=opened.format;jpeg_size=opened.size;jpeg=opened.convert('RGB')
  if jpeg_size!=target_size:raise SystemExit(f"Wrong dimensions {card['id']}: {jpeg_size}; expected {target_size}")
  if fmt!='JPEG':raise SystemExit(f"Wrong format {card['id']}: {fmt}")
  sm=measure(src);jm=measure(jpeg);sm['lower']=lower(src,True);jm['lower']=lower(jpeg,top_hint=sm['lower']['top'])
  for m in [sm,jm]:
   for key in ['left','right','center_x']:m['upper'][key]=None
  deltas={};residuals=[]
  for area in ['upper','lower']:
   deltas[area]={key:float(jm[area][key]-sm[area][key]) if sm[area][key] is not None else None for key in ['top','bottom','center_y','left','right','center_x']}
   deltas[area]['center_y_percent_height']=deltas[area]['center_y']/target_size[1]*100
   columns=[]
   for sc,jc in zip(sm[area]['columns'],jm[area]['columns']):
    ds=[jc['bounds'][i]-sc['bounds'][i] for i in [0,1]];residuals.extend(ds)
    columns.append({'x':sc['x'],'top_delta':ds[0],'bottom_delta':ds[1]})
   deltas[area]['columns']=columns
  pooled=[deltas[area][key] for area in ['upper','lower'] for key in ['top','bottom']]
  maxpooled=float(max(np.abs(pooled)));p90=float(np.quantile(np.abs(residuals),.9));maxcol=float(max(np.abs(residuals)))
  row={'id':card['id'],'name':card['name'],'source':card['source'],'source_dimensions':list(source_size),'jpeg':display_path(jp),'is_override':card['id'] in overrides,'jpeg_dimensions':list(jpeg_size),'jpeg_sha256':hashlib.sha256(jp.read_bytes()).hexdigest(),'normalized_measurement_dimensions':list(target_size),'source_measurements':sm,'decoded_jpeg_measurements':jm,'deltas':deltas,'max_abs_median_edge_delta_px':maxpooled,'p90_abs_column_edge_delta_px':p90,'max_abs_column_edge_delta_px':maxcol,'strict_pass':maxpooled<=3 and p90<=5,'confidence':{'vertical_uncertainty_px':3,'lower_top_search_hint_source_px':sm['lower']['top'],'lower_top_search_radius_px':18,'lower_top_near_search_boundary':abs(jm['lower']['top']-sm['lower']['top'])>=14,'horizontal_uncertainty_px':10,'note':'Natural edge irregularity retained. Upper boundaries use6 constrained edge profiles; lower boundaries use full-width median directional edge and8 column profiles. Source6_2/3_3 upper lower-scroll edge is low-contrast; visual review advised if near threshold. Horizontal shadow-roll contour estimates are diagnostic and are not a pass criterion.'}}
  rows.append(row)
 summary={}
 for area in ['upper','lower']:
  for key in ['top','bottom','center_y']:
   values=[r['deltas'][area][key] for r in rows]
   summary[area+'_'+key]={'mean_abs_px':float(np.mean(np.abs(values))),'max_abs_px':float(max(np.abs(values))),'mean_signed_px':float(np.mean(values))}
 summary['count']=len(rows);summary['strict_pass_count']=sum(r['strict_pass'] for r in rows);summary['strict_exceptions']=[r['id'] for r in rows if not r['strict_pass']]
 report={'overrides':overrides,'scope':'Independent measurements of actual decoded production JPEGs against original JPGs. Selected generatedPNG and predicted affine deltas are not used for measured boundaries.','method':'Both compared at814x1417 (source9_1 is normalized from951x1654); Lanczos for source resizing. Parchment vertical geometry via RGB edge/color profiles,6 columns upper ribbon and8 lower scroll. Full-width median edge excludes highlights/faces. JPEG lower-top search uses original lower-top +/-18px to avoid unrelated golden tabletop (6_2); a measured boundary near that window edge requires visual review. Positive delta means down/right. Upper top andbottom, lower top andbottom are separately measured.','criterion':{'max_abs_median_edge_delta_px':3,'p90_abs_column_edge_delta_px':5,'rationale':'Strict operational placement tolerance, not pixel-identical natural parchment edges. Measurement uncertainty about2-3px vertically. Horizontal bounds excluded due dark roll contour ambiguity.'},'summary':summary,'cards':rows,'limitations':['Automated actual-JPEG measurement needs visual check on strict exceptions, particularly2_2 and6_2.','A passing edge placement result does not certify artwork, typography, JPEG quality, color, or cropped content.','Dark folded scroll right edges can change contour selection; horizontal differences do not establish actual translation.']}
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'output':str(args.output),'summary':summary},ensure_ascii=False))
 for r in rows:
  if not r['strict_pass']:print(json.dumps({'id':r['id'],'max_abs_median_edge_delta_px':r['max_abs_median_edge_delta_px'],'p90_abs_column_edge_delta_px':r['p90_abs_column_edge_delta_px'],'upper':{k:v for k,v in r['deltas']['upper'].items() if k!='columns'},'lower':{k:v for k,v in r['deltas']['lower'].items() if k!='columns'}},ensure_ascii=False))
if __name__=='__main__':main()
