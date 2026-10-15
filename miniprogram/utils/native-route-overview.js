// Native route overview. No GPS, cloud, B1 matching, or per-frame setData.
const {buildTrailIndex}=require('./trail-progress');
const MARKER_ID=-2, TARGET_MS=15500, SEGMENTS=16;
const OVERVIEW_CONFIG=Object.freeze({
 'fj-route-008':Object.freeze({segments:SEGMENTS,targetMs:TARGET_MS,start:'track-first',end:'track-last'}),
 'fj-route-010':Object.freeze({segments:SEGMENTS,targetMs:TARGET_MS,start:'track-first',end:'track-last'})
});
function getOverviewConfig(route){return route&&Object.prototype.hasOwnProperty.call(OVERVIEW_CONFIG,route._id)?OVERVIEW_CONFIG[route._id]:null;}
const point=p=>({latitude:p.latitude,longitude:p.longitude});
const valid=p=>p && Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&!(p.latitude===0&&p.longitude===0);
const distance=(a,b)=>{const rad=Math.PI/180,x=(b.longitude-a.longitude)*rad*Math.cos((a.latitude+b.latitude)*rad/2),y=(b.latitude-a.latitude)*rad;return Math.hypot(x,y)*6371000;};
function position(index,s){if(s<=0)return point(index.segments[0].a);if(s>=index.totalTrackMeters)return point(index.segments.at(-1).b);s=Math.max(0,Math.min(index.totalTrackMeters,s));let lo=0,hi=index.segments.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(index.segments[mid].endMeters<s)lo=mid+1;else hi=mid;}
 const e=index.segments[lo],t=Math.max(0,Math.min(1,(s-e.startMeters)/e.lengthMeters));return {latitude:e.a.latitude+(e.b.latitude-e.a.latitude)*t,longitude:e.a.longitude+(e.b.longitude-e.a.longitude)*t};}
function slice(index,from,to){const pts=[position(index,from)];for(const s of index.segments)if(s.endMeters>from && s.endMeters<to)pts.push(point(s.b));pts.push(position(index,to));return pts;}
function prepare(route,raw=false){const config=getOverviewConfig(route);if(!config)throw Error('NOT_OVERVIEW_ROUTE');const index=buildTrailIndex(route);if(index.status!=='ready'||!index.segments.length)throw Error('INVALID_OVERVIEW_TRACK');const total=index.totalTrackMeters;
 const count=raw?1:config.segments, duration=raw?3000:config.targetMs;
 const pieces=Array.from({length:count},(_,i)=>({from:total*i/count,to:total*(i+1)/count,path:raw?route.track.map(point):slice(index,total*i/count,total*(i+1)/count)}));
 return {index,total,pieces,duration,raw,sourcePoints:route.track.length};}
// Projection is only a native-event identity filter; it never changes B1 or Track.
function eventProgress(p,edges,lower,upper){let best=null;const rad=Math.PI/180;
 for(const e of edges){if(e.to<lower||e.from>upper)continue;const scale=Math.cos((e.a.latitude+e.b.latitude+p.latitude)/3*rad),dx=(e.b.longitude-e.a.longitude)*scale,dy=e.b.latitude-e.a.latitude,px=(p.longitude-e.a.longitude)*scale,py=p.latitude-e.a.latitude;
  const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1))),meters=e.from+(e.to-e.from)*t;if(meters<lower||meters>upper)continue;
  const d=distance(p,{latitude:e.a.latitude+dy*t,longitude:e.a.longitude+(e.b.longitude-e.a.longitude)*t});if(d<=15&&(!best||d<best.d-0.001||Math.abs(d-best.d)<=0.001&&meters<best.meters))best={d,meters};
 }return best;
}
function create(route,ctx,options={}){
 if(!ctx||!['moveAlong','addMarkers','removeMarkers'].every(k=>typeof ctx[k]==='function'))throw Error('NATIVE_API_UNAVAILABLE');
 const now=options.now||Date.now,schedule=options.setTimeout||setTimeout,cancel=options.clearTimeout||clearTimeout,notify=options.onState||(()=>{});
 // Geometric evidence policy, not B1/GPS accuracy. 3m is far below a 1.6km segment;
 // ordered 15m witnesses tolerate map interpolation without accepting a midpoint as an end.
 const endpointMeters=options.endpointMeters===undefined?3:options.endpointMeters;
 if(!Number.isFinite(endpointMeters)||endpointMeters<=0||endpointMeters>3)throw Error('INVALID_ENDPOINT_TOLERANCE');
 const clickedAt=Number.isFinite(options.clickedAt)?options.clickedAt:now();let plan=prepare(route,options.raw);
 const fallbackEnabled=options.strictEndpointFallback===true&&route._id==='fj-route-010'&&!options.raw;
 const meta={routeId:route._id,raw:plan.raw,total:plan.total,count:plan.pieces.length,sourcePoints:plan.sourcePoints};
 let state='idle',token=0,part=0,cursor=0,current=null,watchdog=null,handoff=null,finishAt=null,pauseRequestedAt=null,pauseStartedAt=null,pausedMs=0,disposed=false,eventCapability=false,addPending=false,disposeDone=null;
 const stats={fallbackConfirmations:0,lastFallbackSegment:null,lastFallbackWitness:null,lastFailureState:null,lastConfirmedState:null,moveCalls:0,addCalls:0,removeCalls:0,events:0,incomingEvents:0,eventDetailFields:[],eventMarkerMatches:false,eventCoordinatesValid:false,eventStatusType:null,eventStatusRecognized:false,moveSuccessCount:0,moveCompleteCount:0,moveSuccessAfterMs:null,moveCompleteAfterMs:null,completedSegments:0,nativeDistance:0,earlySuccess:0,lateCallbacks:0,lastError:null,pauseConfirmed:false,resumeCount:0,maxSubmittedPoints:0,callbackMaxSyncMs:0,terminalCount:0,lastTerminalAfterSubmitMs:null,rejectedTerminal:0,completionEvidence:null,lastTerminalEndDistanceMeters:null,lastConfirmedSegment:null,eventCapability:false};
 const snapshot=()=>({runId:options.runId||'ROUTE_OVERVIEW',source:'ROUTE_OVERVIEW',status:state,routeId:meta.routeId,pathMode:meta.raw?'RAW_7035_CAPABILITY_SAMPLE':'RAW_SEGMENTED_OVERVIEW',sourcePoints:meta.sourcePoints,segmentCount:meta.count,completedSegments:stats.completedSegments,progressRatio:cursor/meta.total,elapsedMs:now()-clickedAt,activeElapsedMs:(finishAt===null?now():finishAt)-clickedAt-pausedMs-(pauseStartedAt===null?0:now()-pauseStartedAt),finishedElapsedMs:finishAt===null?null:finishAt-clickedAt-pausedMs,pauseMode:'SEGMENT_BOUNDARY_USER_ACCEPTED',precisionRuntimeTrial:10,precisionTypeConfirmed:false,firstSegmentOnly:!!options.firstSegmentOnly,...stats,currentSegment:current?part:null,currentApiAccepted:!!(current&&current.accepted),currentApiComplete:!!(current&&current.apiComplete),currentWitnessCount:current?current.stage:0,nativePixels:'USER_OBSERVATION_REQUIRED',b1Matched:false,actualOutdoorCompleted:false,strictEndpointFallbackEnabled:fallbackEnabled,currentSegmentState:current?safeState(current):null});
 const publish=()=>notify(snapshot());
 function safeState(c){return Object.freeze({routeId:meta.routeId,segmentZeroBased:part,segmentHuman:part+1,apiAccepted:c.accepted,apiComplete:c.apiComplete,orderedStage:c.stage,orderedProgressRatio:c.progress/c.length,terminalCandidates:c.terminalCandidates,terminalAccepted:c.terminal,confirmed:c.confirmed,strictFallbackEligible:c.strictFallback,strictFallbackLimitMeters:c.strictFallback?c.nearLimit:null,strictFallbackWitness:c.nearWitness});}
 function clear(){if(watchdog!==null)cancel(watchdog);watchdog=null;if(handoff!==null)cancel(handoff);handoff=null;}
 function remove(done){stats.removeCalls++;try{ctx.removeMarkers({markerIds:[MARKER_ID],success(){if(done)done(null);},fail(){stats.lastError=stats.lastError||'NATIVE_REMOVE_FAILED';if(done)done('NATIVE_REMOVE_FAILED');}});}catch(_){stats.lastError=stats.lastError||'NATIVE_REMOVE_FAILED';if(done)done('NATIVE_REMOVE_FAILED');}}
 function error(code){if(disposed||state==='error')return;stats.lastFailureState=current?safeState(current):null;token++;clear();current=null;state='error';stats.lastError=code;remove();publish();}
 function arm(){watchdog=schedule(()=>{if(!disposed&&!['finished','paused'].includes(state))error('NATIVE_REPLAY_TIMEOUT');},plan.raw?6000:20000);}
 function alive(c){return !disposed&&current===c&&c.token===token&&['playing','pausing'].includes(state);}
 function queueTravel(){const mine=token;if(handoff!==null)return;handoff=schedule(()=>{handoff=null;if(disposed||mine!==token)return;if(state==='pausing'){pauseBoundary();return;}if(state==='playing')travel();},0);}
 function pauseBoundary(){state='paused';pauseStartedAt=now();stats.pauseConfirmed=true;stats.pauseBoundaryLatencyMs=now()-pauseRequestedAt;clear();publish();}
 function confirm(c,evidence){if(!alive(c)||c.confirmed)return;c.confirmed=true;stats.lastConfirmedState=safeState(c);stats.completionEvidence=evidence;stats.lastConfirmedSegment=part;cursor=plan.pieces[part].to;part++;stats.completedSegments++;token++;current=null;
  if(part===plan.pieces.length){state='finished';finishAt=now();clear();publish();return;}
  if(state==='pausing'||options.firstSegmentOnly&&part===1){pauseBoundary();return;}queueTravel();
 }
 function consider(c){if(!alive(c)||!c.accepted)return;
  if(eventCapability){
   if(c.terminal&&c.stage===4){confirm(c,'NATIVE_TERMINAL_WITH_ORDERED_TRAVEL');return;}
   // Only010 segment15: ordered native endpoint observations plus both API signals.
   if(c.strictFallback&&c.apiComplete&&c.stage===4&&c.nearWitness&&c.nearWitness.token===c.token&&c.terminalCandidates===0){
    stats.fallbackConfirmations++;stats.lastFallbackSegment=part;stats.lastFallbackWitness=c.nearWitness;
    confirm(c,'NATIVE_NEAR_ENDPOINT_WITNESS_WITH_API_COMPLETE');
   }return;
  }
  // Empirical no-event DevTools compatibility only. API complete + success are not
  // an official physical-end contract. An early acceptance never advances; timeout fails.
  if(c.apiComplete&&now()-c.at>=c.ms*0.8)confirm(c,'DELAYED_API_CALLBACK_EMPIRICAL_NO_EVENTS');
 }
 function issue(path,ms){const c={token:++token,at:now(),ms,accepted:false,apiComplete:false,confirmed:false,stage:0,terminal:false,previous:null,
   witnesses:[0,0.1,0.5,0.9].map(r=>position(plan.index,cursor+(plan.pieces[part].to-cursor)*r)),end:path.at(-1)};
  let meters=0;c.edges=path.slice(1).map((b,i)=>{const a=path[i],from=meters;meters+=distance(a,b);return {a,b,from,to:meters};});c.length=meters;c.strictFallback=fallbackEnabled&&part===14;c.nearLimit=Math.min(1,c.length*0.0001);c.nearWitness=null;c.terminalCandidates=0;c.validEvents=0;c.progress=0;c.maxGap=Math.max(...c.edges.map(e=>e.to-e.from));
  current=c;stats.moveCalls++;stats.maxSubmittedPoints=Math.max(stats.maxSubmittedPoints,path.length);const began=now();
  try{ctx.moveAlong({markerId:MARKER_ID,path,autoRotate:false,duration:Math.max(1,Math.round(ms)),precision:10,
   success(){if(!alive(c)){stats.lateCallbacks++;return;}if(c.accepted)return;c.accepted=true;stats.moveSuccessCount++;stats.moveSuccessAfterMs=now()-c.at;if(now()-c.at<ms*0.8)stats.earlySuccess++;consider(c);},
   complete(){if(!alive(c)){stats.lateCallbacks++;return;}if(c.apiComplete)return;c.apiComplete=true;stats.moveCompleteCount++;stats.moveCompleteAfterMs=now()-c.at;consider(c);},
   fail(){if(alive(c))error('NATIVE_MOVE_REJECTED');}});
  }catch(_){error('NATIVE_MOVE_EXCEPTION');}stats.callbackMaxSyncMs=Math.max(stats.callbackMaxSyncMs,now()-began);
 }
 function travel(){if(disposed||state!=='playing'||current)return;const piece=plan.pieces[part];if(!piece){error('INVALID_NATIVE_SEGMENT');return;}const remaining=piece.to-cursor;
  if(remaining<=0){error('INVALID_NATIVE_SEGMENT');return;}issue(plan.raw&&cursor===0?piece.path:slice(plan.index,cursor,piece.to),plan.duration*remaining/plan.total);
 }
 function start(){if(disposed||state!=='idle')return snapshot();state='starting';publish();const mine=++token;stats.addCalls++;addPending=true;arm();
  try{ctx.addMarkers({clear:false,markers:[{id:MARKER_ID,...position(plan.index,0),iconPath:'/assets/map/simulation.png',width:22,height:22,anchor:{x:0.5,y:0.5},zIndex:10,callout:{content:'速览位置（非GPS）',display:'ALWAYS'}}],
   success(){if(!addPending){stats.lateCallbacks++;return;}addPending=false;if(disposed){stats.lateCallbacks++;remove(disposeDone);disposeDone=null;return;}if(mine!==token){stats.lateCallbacks++;remove();return;}state='playing';publish();travel();},fail(){if(!addPending)return;addPending=false;if(disposed){remove(disposeDone);disposeDone=null;return;}if(mine===token)error('NATIVE_ADD_FAILED');}});}catch(_){addPending=false;error('NATIVE_ADD_EXCEPTION');}return snapshot();
 }
 function event(e){const c=current;if(!c||!alive(c))return;const d=e&&e.detail||e;if(c.strictFallback){c.nearWitness=null;if(d&&d.animationStatus==='complete')c.terminalCandidates++;}stats.incomingEvents++;stats.eventDetailFields=d&&typeof d==='object'?Object.keys(d).slice(0,20):[];
  stats.eventMarkerMatches=!!d&&Number(d.markerId)===MARKER_ID;stats.eventCoordinatesValid=!!valid(d);stats.eventStatusType=d?typeof d.animationStatus:null;stats.eventStatusRecognized=!!d&&['interpolating','complete'].includes(d.animationStatus);
  if(!stats.eventMarkerMatches||!stats.eventCoordinatesValid||!stats.eventStatusRecognized)return;
  eventCapability=true;stats.eventCapability=true;stats.events++;if(c.strictFallback)c.validEvents++;const p=point(d);if(c.previous)stats.nativeDistance+=distance(c.previous,p);c.previous=p;
  // Only interpolating observations establish new segment travel. A late prior terminal
  // at a shared boundary cannot supply even the new start witness.
  if(d.animationStatus==='interpolating'){
   if(c.stage===0){if(distance(p,c.witnesses[0])<=15)c.stage=1;}
   else {const q=eventProgress(p,c.edges,Math.max(0,c.progress-15),Math.min(c.length,c.progress+c.maxGap+30));
    if(q&&q.meters>=c.progress){c.progress=q.meters;const thresholds=[0,0.1,0.5,0.9];if(c.stage<4&&c.progress/c.length>=thresholds[c.stage])c.stage++;
     if(c.strictFallback&&c.stage===4){const endMeters=distance(p,c.end),remainingMeters=c.length-c.progress;
      if(endMeters<=c.nearLimit&&remainingMeters<=c.nearLimit&&q.d<=c.nearLimit)c.nearWitness=Object.freeze({token:c.token,segmentZeroBased:part,eventAfterSubmitMs:now()-c.at,eventNumber:c.validEvents,limitMeters:c.nearLimit,endpointDistanceMeters:endMeters,remainingOrderedMeters:remainingMeters,pathProjectionDistanceMeters:q.d,orderedProgressRatio:c.progress/c.length,orderedStage:c.stage});
     }
    }
   }
  }
  if(d.animationStatus==='interpolating'&&c.strictFallback)consider(c);
  if(d.animationStatus==='complete'){stats.terminalCount++;stats.lastTerminalAfterSubmitMs=now()-c.at;const endDistance=distance(p,c.end);stats.lastTerminalEndDistanceMeters=endDistance;
   if(c.stage===4&&endDistance<=endpointMeters){c.terminal=true;consider(c);}else stats.rejectedTerminal++;
  }
 }
 function pause(){if(disposed||state!=='playing')return snapshot();state='pausing';pauseRequestedAt=now();stats.pauseConfirmed=false;if(!current){pauseBoundary();return snapshot();}publish();return snapshot();}
 function resume(){if(disposed||state!=='paused')return snapshot();pausedMs+=now()-pauseStartedAt;pauseStartedAt=null;state='playing';stats.resumeCount++;arm();publish();queueTravel();return snapshot();}
 function dispose(done){if(disposed){if(done)done(addPending?'NATIVE_REMOVE_PENDING':null);return;}disposed=true;token++;clear();state='disposed';current=null;disposeDone=done||null;if(!addPending){remove(disposeDone);disposeDone=null;}plan=null;}
 return {start,pause,resume,dispose,event,getSnapshot:snapshot};
}
function enabledRoute(route){return !!getOverviewConfig(route);}
function install(definition,wx,runId){
 function applicable(page){return enabledRoute(page.data.route);}
 function publish(page,s){if(page._unloaded||page._hidden)return;page.setData({overviewState:{status:s.status,text:({idle:'尚未开始',starting:'正在创建原生动画',playing:'路线速览播放中',pausing:'正在暂停：当前短段走完即停',paused:'已暂停',finished:s.pathMode==='RAW_7035_CAPABILITY_SAMPLE'?'3秒原生样本结束（非最终验收）':'路线速览完成',error:'路线速览暂不可用，请重新播放'}[s.status]||'已停止'),message:s.lastError||'',raw:s.pathMode==='RAW_7035_CAPABILITY_SAMPLE'}});}
 function stop(page){page._nativeOverviewVersion=(page._nativeOverviewVersion||0)+1;if(page._nativeCleanupTimer!=null){clearTimeout(page._nativeCleanupTimer);page._nativeCleanupTimer=null;}const session=page._nativeOverview;page._nativeOverview=null;if(session){session.dispose();page._nativeOverviewLast=session.getSnapshot();}}
 const load=definition.loadRoute;definition.loadRoute=async function(...args){stop(this);const pending=load.apply(this,args),version=this._loadVersion;const result=await pending;if(!this._unloaded&&version===this._loadVersion)this.setData({overviewMode:applicable(this),overviewState:{status:'idle',text:'尚未开始',message:'',raw:false}});return result;};
 function begin(page,raw=false,firstSegmentOnly=false){if(page._hidden||page._unloaded||page.data.mapRenderError||page.data.status!=='success')return;
 const clickedAt=Date.now(),route=page.data.route,previous=page._nativeOverview;page._nativeOverview=null;
 const v=page._nativeOverviewVersion=(page._nativeOverviewVersion||0)+1;
 if(page._nativeCleanupTimer!=null){clearTimeout(page._nativeCleanupTimer);page._nativeCleanupTimer=null;}
 const current=()=>!page._hidden&&!page._unloaded&&page._nativeOverviewVersion===v&&page.data.route===route;
 const launch=()=>{if(!current())return;try{const ctx=wx.createMapContext('route-map',page);page._nativeOverview=create(route,ctx,{raw,runId,clickedAt,firstSegmentOnly,strictEndpointFallback:route._id==='fj-route-010',onState:s=>publish(page,s)});page._nativeOverview.start();}
 catch(e){page._nativeOverviewLast={runId,source:'ROUTE_OVERVIEW',status:'error',errorCode:e.message};publish(page,{status:'error',lastError:e.message});}};
 if(!previous){launch();return;}
 const timer=setTimeout(()=>{if(current()){page._nativeCleanupTimer=null;page._nativeOverviewVersion++;publish(page,{status:'error',lastError:'NATIVE_REMOVE_TIMEOUT'});}},1500);page._nativeCleanupTimer=timer;
 previous.dispose(error=>{clearTimeout(timer);if(page._nativeCleanupTimer===timer)page._nativeCleanupTimer=null;if(!current())return;if(error)publish(page,{status:'error',lastError:error});else launch();});
 page._nativeOverviewLast=previous.getSnapshot();
 }
 for(const [name,action] of [['onSimulationStartTap','start'],['onSimulationPauseTap','pause'],['onSimulationResumeTap','resume'],['onSimulationRestartTap','restart']]){
  const old=definition[name];definition[name]=function(event){if(!applicable(this))return old.call(this,event);
   const raw=event&&event.currentTarget&&event.currentTarget.dataset.raw==='true';
   if(action==='start'){if(this._nativeOverview&&['starting','playing','pausing'].includes(this._nativeOverview.getSnapshot().status))return;begin(this,raw,event&&event.currentTarget&&event.currentTarget.dataset.first==='true');}
   else if(action==='restart')begin(this,raw,event&&event.currentTarget&&event.currentTarget.dataset.first==='true');else if(this._nativeOverview)this._nativeOverview[action]();};}
 definition.onNativeOverviewPoint=function(e){if(this._nativeOverview)this._nativeOverview.event(e);};
 for(const name of ['onHide','onUnload','onBackTap','onMapError']){const old=definition[name];definition[name]=function(...args){stop(this);if(name!=='onUnload'){publish(this,{status:name==='onMapError'?'error':'idle',lastError:name==='onMapError'?'NATIVE_MAP_ERROR':''});}return old.apply(this,args);};}
 definition.getPlanBSummary=function(){return this._nativeOverview?this._nativeOverview.getSnapshot():this._nativeOverviewLast||{runId,status:'not_started'};};
 return definition;
}
module.exports={prepare,position,slice,create,install,enabledRoute,getOverviewConfig,OVERVIEW_CONFIG,MARKER_ID,TARGET_MS};
