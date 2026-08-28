import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsOutSimple, CalendarBlank, CaretDown, Check, Copy, Crosshair, FilePdf, Funnel, ImageSquare, MagnifyingGlass, MapPin, SquaresFour, WarningCircle, X } from "@phosphor-icons/react";
import { jsPDF } from "jspdf";
import L from "leaflet";
import proj4 from "proj4";
import "leaflet/dist/leaflet.css";
import "./export.css";

const previewFiles = ["025a3449e5134794.jpg","057b22d0d423ae4e.jpg","0be1d04780afd779.jpg","11d9afa988bac7ed.jpg","189119f430e45658.jpg","19915a5e397cd21a.jpg","1bdd8c8e4bdf6d08.jpg","30a7f071c4aade1a.jpg","34a9fe010632d11b.jpg","35d395742b999712.jpg","467967afe89627de.jpg","46d98f25db76c089.jpg","4b27395b5d4f7e51.jpg","4b35cff837d26024.jpg","4bc6abd9a6c618b9.jpg","4c47751bb40bc101.jpg","4d4c52bb940bc0dc.jpg","4d7a0759f91325cc.jpg"];
const publicAsset=path=>`${import.meta.env.BASE_URL}${path.replace(/^\//,"")}`;
const missingPreview=`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="100%" height="100%" fill="#10232f"/><path d="M420 510l120-145 92 105 72-76 116 116H420z" fill="#294656"/><circle cx="716" cy="286" r="42" fill="#ffb136"/><text x="600" y="610" fill="#adc0ca" font-family="Arial,sans-serif" font-size="32" text-anchor="middle">Preview unavailable</text></svg>')}`;
const providers = ["BEIJING","GAOFEN-1","JILIN","SUPERVIEW-NEO","ZIYUAN-1","ZIYUAN-3"];
const sensors = ["PMS1","PAN1","MUX","MSI"];
const demoScenes = previewFiles.map((file,index)=>{const day=29+(index%3),hour=String(3+(index%6)).padStart(2,"0"),provider=providers[index%providers.length],sensor=sensors[index%sensors.length];return{id:`BJ3A1_202507${day}_${hour}${String(1315+index*17).slice(-4)}_${String(index+1).padStart(3,"0")}`,provider,sensor,level:index%5===0?"L1A":"L2",acquired:`${day} Jul 2025 ${hour}:${String(13+index).slice(-2)}:15 UTC`,file:publicAsset(`previews/${file}`),size:`${(0.82+index*.09).toFixed(2)} GB`,crs:index%2?"EPSG:32648":"EPSG:4326",dimensions:index%3?"18,420 × 17,968":"20,144 × 19,872",path:`D:\\${provider}\\${index%2?"L2":"L1A"}\\${file.replace(".jpg","-FUS.tif")}`,x:10+((index*17)%66),y:12+((index*23)%52),rotation:-8+(index%5)*4};});

function normalizeScene(scene,index){
 const previewName=scene.preview?.split(/[\\/]/).pop();
 return{id:scene.id,name:scene.name,provider:scene.path?.split("/")[0]||scene.platform||"Unknown",sensor:scene.sensor||"Unknown",level:scene.processing_level||"Unknown",acquired:scene.acquired_at?new Date(scene.acquired_at).toLocaleString("en-GB",{timeZone:"UTC"})+" UTC":"Unknown",file:previewName?publicAsset(`previews/${previewName}`):missingPreview,size:`${(scene.size_bytes/1073741824).toFixed(2)} GB`,crs:scene.crs||"Unknown",dimensions:scene.width&&scene.height?`${scene.width.toLocaleString()} × ${scene.height.toLocaleString()}`:"Unknown",path:scene.path,footprint:scene.footprint,footprintCrs:scene.footprint_crs,bounds:scene.bounds,x:10+((index*17)%66),y:12+((index*23)%52),rotation:-8+(index%5)*4};
}

function footprintLatLngs(scene){
 const ring=scene.footprint?.coordinates?.[0];
 if(!ring?.length)return null;
 try{return ring.map(([x,y])=>{const sourceCrs=scene.footprintCrs||scene.crs;const [lon,lat]=sourceCrs==="EPSG:4326"||(Math.abs(x)<=180&&Math.abs(y)<=90)?[x,y]:proj4(sourceCrs,"EPSG:4326",[x,y]);return[lat,lon]}).filter(([lat,lon])=>Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180)}catch{return null}
}

const hasFootprint=scene=>(footprintLatLngs(scene)?.length||0)>=3;

function SceneMap({scenes,active,focusRequest,onSelect,onPreview,onNoFootprint}){
 const elementRef=useRef(null),mapRef=useRef(null),layersRef=useRef(null),polygonsRef=useRef(new Map());
 useEffect(()=>{if(mapRef.current||!elementRef.current)return;const map=L.map(elementRef.current,{zoomControl:true,preferCanvas:true});L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);layersRef.current=L.layerGroup().addTo(map);map.setView([-1.8,113.7],7);mapRef.current=map;return()=>{map.remove();mapRef.current=null}},[]);
 useEffect(()=>{const map=mapRef.current,group=layersRef.current;if(!map||!group)return;group.clearLayers();polygonsRef.current.clear();const bounds=[];scenes.forEach(scene=>{const latlngs=footprintLatLngs(scene);if(!latlngs||latlngs.length<3)return;const polygon=L.polygon(latlngs,{color:"#21bde8",weight:1.5,fillColor:"#21bde8",fillOpacity:.07,bubblingMouseEvents:false});const popup=document.createElement("div");popup.className="scene-map-popup";const image=document.createElement("img");image.src=scene.file;image.alt=`Preview of ${scene.id}`;const title=document.createElement("strong");title.textContent=scene.name||scene.id;const meta=document.createElement("span");meta.textContent=`${scene.provider} · ${scene.sensor} · ${scene.level}`;const previewButton=document.createElement("button");previewButton.type="button";previewButton.className="map-preview-button";previewButton.textContent="View large preview";previewButton.addEventListener("click",()=>onPreview(scene));popup.append(image,title,meta,previewButton);polygon.bindTooltip(scene.name||scene.id,{sticky:true});polygon.bindPopup(popup,{maxWidth:360,minWidth:260});polygon.on("click",()=>onSelect(scene));polygon.addTo(group);polygonsRef.current.set(scene.id,polygon);bounds.push(...latlngs)});elementRef.current?.setAttribute("data-footprint-count",String(polygonsRef.current.size));if(bounds.length)map.fitBounds(bounds,{padding:[24,24],maxZoom:10})},[scenes,onSelect,onPreview]);
 useEffect(()=>{const map=mapRef.current;if(!map)return;const notify=()=>onNoFootprint();map.on("click",notify);return()=>map.off("click",notify)},[onNoFootprint]);
 useEffect(()=>{polygonsRef.current.forEach((polygon,id)=>{const selected=id===active?.id;polygon.setStyle({color:selected?"#b8e72e":"#21bde8",weight:selected?3:1.5,fillColor:selected?"#b8e72e":"#21bde8",fillOpacity:selected ? .16 : .07});if(selected)polygon.bringToFront()})},[active?.id]);
 useEffect(()=>{if(!focusRequest)return;const map=mapRef.current,polygon=polygonsRef.current.get(focusRequest.id);if(!map||!polygon)return;map.flyToBounds(polygon.getBounds(),{padding:[52,52],maxZoom:12,duration:.65});polygon.openPopup()},[focusRequest]);
 const available=scenes.filter(hasFootprint).length,unavailable=scenes.length-available;
 return <div className="map-wrap"><div ref={elementRef} className="map-stage" aria-label={`OpenStreetMap with ${available} available satellite scene footprints`}/><div className="footprint-legend" aria-label="Footprint availability legend"><span className="available"><i/> Footprint available ({available})</span><button className="unavailable" onClick={()=>onNoFootprint()}><i/> No footprint ({unavailable})</button></div></div>;
}

function SelectBox({label,value,onChange,options}){return <label className="filter-field"><span>{label}</span><div className="select-wrap"><select value={value} onChange={e=>onChange(e.target.value)}><option value="All">All {label.toLowerCase()}s</option>{options.map(o=><option key={o}>{o}</option>)}</select><CaretDown size={14} weight="bold"/></div></label>}

async function reportImage(url){
 const image=new Image();image.src=url;await image.decode();
 const max=1400,scale=Math.min(max/image.naturalWidth,max/image.naturalHeight,1),canvas=document.createElement("canvas");
 canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
 canvas.getContext("2d").drawImage(image,0,0,canvas.width,canvas.height);
 return canvas.toDataURL("image/jpeg",.82);
}

export function App(){
 const[catalogScenes,setCatalogScenes]=useState([]),scenes=catalogScenes.length?catalogScenes:demoScenes;
 const[query,setQuery]=useState(""),[provider,setProvider]=useState("All"),[sensor,setSensor]=useState("All"),[level,setLevel]=useState("All"),[active,setActive]=useState(demoScenes[12]),[mapFocus,setMapFocus]=useState(null),[previewScene,setPreviewScene]=useState(null),[selected,setSelected]=useState(new Set([demoScenes[12].id])),[tab,setTab]=useState("Overview"),[onlyVisible,setOnlyVisible]=useState(false),[copied,setCopied]=useState(false),[exporting,setExporting]=useState(false),[pdfReady,setPdfReady]=useState(null),[mapNotice,setMapNotice]=useState(null);
 const sceneStripRef=useRef(null),cardRefs=useRef(new Map());
 useEffect(()=>{fetch(publicAsset("data/catalog.json"),{cache:"no-store"}).then(response=>response.ok?response.json():Promise.reject()).then(data=>{const next=(data.scenes||[]).map(normalizeScene);if(next.length){setCatalogScenes(next);setActive(next[0]);setSelected(new Set([next[0].id]))}}).catch(()=>{})},[]);
 const providerOptions=useMemo(()=>[...new Set(scenes.map(scene=>scene.provider).filter(Boolean))].sort(),[scenes]);
 const sensorOptions=useMemo(()=>[...new Set(scenes.map(scene=>scene.sensor).filter(Boolean))].sort(),[scenes]);
 const levelOptions=useMemo(()=>[...new Set(scenes.map(scene=>scene.level).filter(Boolean))].sort(),[scenes]);
 const filtered=useMemo(()=>scenes.filter(s=>{const q=query.trim().toLowerCase();return(!q||`${s.id} ${s.name} ${s.provider} ${s.sensor} ${s.level} ${s.path}`.toLowerCase().includes(q))&&(provider==="All"||s.provider===provider)&&(sensor==="All"||s.sensor===sensor)&&(level==="All"||s.level===level)}).slice(0,onlyVisible?8:scenes.length),[scenes,query,provider,sensor,level,onlyVisible]);
 useEffect(()=>{setActive(null);setTab("Overview")},[query,provider,sensor,level,onlyVisible]);
 useEffect(()=>{if(!active?.id)return;const card=cardRefs.current.get(active.id);if(card)card.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"})},[active?.id]);
 const showNoFootprint=useCallback(scene=>setMapNotice(scene?`No footprint available for ${scene.name||scene.id}. The preview and metadata are still available.`:"No footprint is available at this map location. Select a blue footprint or choose a scene card."),[]);
 const selectMapScene=useCallback(scene=>{setMapNotice(null);setActive(scene)},[]);
 const selectCard=scene=>{setActive(scene);if(hasFootprint(scene)){setMapNotice(null);setMapFocus({id:scene.id,requestId:Date.now()})}else showNoFootprint(scene)};
 const toggle=id=>setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
 useEffect(()=>{if(!previewScene)return;const close=event=>{if(event.key==="Escape")setPreviewScene(null)};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close)},[previewScene]);
 useEffect(()=>{if(!mapNotice)return;const timeout=setTimeout(()=>setMapNotice(null),5000);return()=>clearTimeout(timeout)},[mapNotice]);
 const clear=()=>{setProvider("All");setSensor("All");setLevel("All");setQuery("");setOnlyVisible(false);setActive(null)};
 const copyPath=async()=>{await navigator.clipboard?.writeText(active.path);setCopied(true);setTimeout(()=>setCopied(false),1400)};
 const exportReport=async(selectedOnly)=>{
  const reportScenes=selectedOnly?filtered.filter(s=>selected.has(s.id)):filtered;
  if(!reportScenes.length)return;
  const pdfWindow=window.open("","_blank");
  setExporting(true);
  try{
   const pdf=new jsPDF({unit:"mm",format:"a4",orientation:"portrait"});
   for(let i=0;i<reportScenes.length;i++){
    const scene=reportScenes[i];if(i)pdf.addPage();
    pdf.setFillColor(7,19,29);pdf.rect(0,0,210,34,"F");pdf.setTextColor(184,231,46);pdf.setFontSize(18);pdf.text("Kalteng Satellite Catalog",15,16);
    pdf.setTextColor(185,199,207);pdf.setFontSize(9);pdf.text(`Mission Control report  •  25 Aug 2026  •  Scene ${i+1} of ${reportScenes.length}`,15,25);
    const data=await reportImage(scene.file);pdf.addImage(data,"JPEG",15,43,180,116,undefined,"FAST");
    pdf.setTextColor(15,35,48);pdf.setFontSize(14);pdf.text(scene.id,15,174);
    pdf.setFontSize(10);const rows=[["Provider",scene.provider],["Sensor",scene.sensor],["Processing level",scene.level],["Acquisition",scene.acquired],["CRS",scene.crs],["Dimensions",scene.dimensions],["File size",scene.size]];
    rows.forEach(([key,value],row)=>{const y=187+row*9;pdf.setTextColor(100,115,124);pdf.text(key,15,y);pdf.setTextColor(20,38,48);pdf.text(value,62,y)});
    pdf.setTextColor(100,115,124);pdf.text("Source path",15,255);pdf.setTextColor(20,38,48);pdf.setFontSize(8);pdf.text(pdf.splitTextToSize(scene.path,180),15,262);
   }
   const name=`kalteng-satellite-catalog-${selectedOnly?"selected":"filtered"}.pdf`,url=URL.createObjectURL(pdf.output("blob"));
   if(pdfReady?.url)URL.revokeObjectURL(pdfReady.url);setPdfReady({url,name});
   const link=document.createElement("a");link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
   if(pdfWindow)pdfWindow.location.href=url;
  }catch(error){pdfWindow?.close();throw error}finally{setExporting(false)}
 };
 return <main className="app-shell">
  <header className="topbar"><div className="brand"><div className="brand-mark"><Crosshair size={24} weight="duotone"/></div><div><strong>Kalteng Satellite Catalog</strong><span>Mission Control</span></div></div><label className="search"><MagnifyingGlass size={20}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search scenes by ID, sensor, provider or metadata…"/>{query&&<button onClick={()=>setQuery("")} aria-label="Clear search"><X size={16}/></button>}</label><div className="top-actions">{pdfReady&&<a className="pdf-ready" href={pdfReady.url} target="_blank" rel="noreferrer"><Check weight="bold"/> PDF ready — open</a>}<span className="generated">Generated: 25 Aug 2026</span><button className="outline-btn" onClick={()=>exportReport(false)} disabled={exporting}><FilePdf size={18}/> {exporting?"Creating PDF…":"Export PDF"}</button></div></header>
  <aside className="filters"><div className="aside-title"><span><Funnel size={16}/> Filters</span><button onClick={clear}>Clear all</button></div><SelectBox label="Provider" value={provider} onChange={setProvider} options={providerOptions}/><SelectBox label="Sensor" value={sensor} onChange={setSensor} options={sensorOptions}/><label className="filter-field"><span>Acquisition date</span><button className="date-control"><CalendarBlank size={16}/> 01 Jan — 25 Aug 2026</button></label><SelectBox label="Processing level" value={level} onChange={setLevel} options={levelOptions}/><div className="filter-status"><Check size={15} weight="bold"/> Cards and footprints update together</div><label className="toggle-row"><button className={`toggle ${onlyVisible?"on":""}`} onClick={()=>setOnlyVisible(!onlyVisible)} aria-label="Limit results to eight scenes"><i/></button><span>Limit results to 8</span></label></aside>
  <section className="workspace"><SceneMap scenes={filtered} active={active} focusRequest={mapFocus} onSelect={selectMapScene} onPreview={setPreviewScene} onNoFootprint={showNoFootprint}/><div className="results-head"><strong>{filtered.length} scenes</strong><span>Sorted by acquisition date <CaretDown size={13}/></span></div><div className="scene-strip" ref={sceneStripRef}>{filtered.map(s=><article ref={node=>{if(node)cardRefs.current.set(s.id,node);else cardRefs.current.delete(s.id)}} key={s.id} className={`scene-card ${hasFootprint(s)?"has-footprint":"no-footprint"} ${active?.id===s.id?"active":""}`} onClick={()=>selectCard(s)}><span className="footprint-status">{hasFootprint(s)?"Footprint":"No footprint"}</span><button className={`select-dot ${selected.has(s.id)?"selected":""}`} onClick={e=>{e.stopPropagation();toggle(s.id)}} aria-label="Select scene">{selected.has(s.id)&&<Check size={12} weight="bold"/>}</button><button className="card-preview-button" onClick={e=>{e.stopPropagation();setPreviewScene(s)}} aria-label={`View large preview of ${s.id}`}><ImageSquare size={16}/></button><img src={s.file} alt={`Preview of ${s.id}`} loading="lazy"/><div><strong>{s.id}</strong><span>{s.sensor} · {s.level}</span><span>{s.acquired.split(" UTC")[0]}</span></div></article>)}</div></section>
  <aside className="details">{active?<><div className="detail-title"><div><strong>{active.id}</strong><span>{active.provider} · {active.level}</span></div><button onClick={()=>setActive(null)} aria-label="Close details"><X/></button></div><img className="hero-preview" src={active.file} alt={`Selected scene ${active.id}`}/><button className="detail-preview-button" onClick={()=>setPreviewScene(active)}><ArrowsOutSimple size={17}/> View large preview</button><div className="tabs">{["Overview","Metadata","Location"].map(n=><button key={n} className={tab===n?"active":""} onClick={()=>setTab(n)}>{n}</button>)}</div>{tab==="Overview"&&<dl className="metadata"><div><dt>Scene ID</dt><dd>{active.id}</dd></div><div><dt>Provider</dt><dd>{active.provider}</dd></div><div><dt>Sensor</dt><dd>{active.sensor}</dd></div><div><dt>Acquisition</dt><dd>{active.acquired}</dd></div><div><dt>Processing level</dt><dd>{active.level}</dd></div><div><dt>File size</dt><dd>{active.size}</dd></div></dl>}{tab==="Metadata"&&<dl className="metadata"><div><dt>Format</dt><dd>{active.path?.split(".").pop()?.toUpperCase()||"Unknown"}</dd></div><div><dt>CRS</dt><dd>{active.crs}</dd></div><div><dt>Dimensions</dt><dd>{active.dimensions}</dd></div><div><dt>Preview</dt><dd>4096 px JPEG</dd></div></dl>}{tab==="Location"&&<div className={`location-panel ${hasFootprint(active)?"available":"unavailable"}`}><MapPin size={26} weight="duotone"/><div><strong>{hasFootprint(active)?"Footprint available":"No footprint available"}</strong><span>{hasFootprint(active)?"Geometry is shown on the map":"This source has no usable geospatial geometry"}</span></div></div>}<div className="source-path"><span>Source path</span><p>{active.path}</p><button onClick={copyPath}>{copied?<Check/>:<Copy/>} {copied?"Copied":"Copy path"}</button></div><button className={`primary-action ${selected.has(active.id)?"selected":""}`} onClick={()=>toggle(active.id)}><SquaresFour size={18}/>{selected.has(active.id)?"Remove from report":"Add to report"}</button><div className="selection-summary"><span>{selected.size} selected</span><button onClick={()=>exportReport(true)} disabled={!selected.size||exporting}><FilePdf/> {exporting?"Creating…":"Export selected"}</button></div></>:<div className="details-empty"><Crosshair size={36} weight="duotone"/><strong>No scene selected</strong><span>Select a filtered footprint or scene card to inspect its information.</span></div>}</aside>
  {mapNotice&&<div className="map-notice" role="status" aria-live="polite"><WarningCircle size={22} weight="fill"/><span>{mapNotice}</span><button onClick={()=>setMapNotice(null)} aria-label="Dismiss notification"><X size={16}/></button></div>}
  {previewScene&&<div className="lightbox" role="dialog" aria-modal="true" aria-label={`Large preview of ${previewScene.id}`} onMouseDown={event=>{if(event.target===event.currentTarget)setPreviewScene(null)}}><div className="lightbox-panel"><div className="lightbox-head"><div><strong>{previewScene.name||previewScene.id}</strong><span>{previewScene.provider} · {previewScene.sensor} · {previewScene.level}</span></div><button onClick={()=>setPreviewScene(null)} aria-label="Close large preview"><X size={24}/></button></div><div className="lightbox-image"><img src={previewScene.file} alt={`Large satellite preview of ${previewScene.id}`}/></div><div className="lightbox-actions"><span><ArrowsOutSimple size={17}/> High-resolution catalog preview</span><button onClick={()=>toggle(previewScene.id)}><SquaresFour size={17}/>{selected.has(previewScene.id)?"Remove from PDF report":"Add to PDF report"}</button></div></div></div>}
 </main>
}
