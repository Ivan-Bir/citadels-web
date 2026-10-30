'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {playingRoom,district}=require('../test-support/game.cjs');
function fixture(){const x=playingRoom(); const {game}=x;
 for(const slot of Object.keys(game.state.players)){game.state.players[slot].hand=[];game.room.playerHand[slot]=0;game.room.playerDistricts[slot]=[];game.room.playerGold[slot]=20;}
 game.room.turnId=1;game.room.roundNumber=2;game.room.buildDistricts=5;game.state.alchemistCoins=0;
 return x;}
function hand(game,cards){game.state.players[0].hand=cards;game.room.playerHand[0]=cards.length;}
test('construction uses permanent discount plus every Factory but preserves nominal',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('factory'),district('factory')];
 hand(game,[{...district('museum'),buildDiscount:2}]);game.slotEventHandlers.build(0,0);
 assert.equal(game.room.playerGold[0],20); assert.equal(game.room.playerDistricts[0][2].cost,4);
 assert.equal(game.room.playerDistricts[0][2].buildDiscount,2);
});

test('city size treats each Monument as two and Catacombs as zero',()=>{
 const {game}=fixture();game.state.maxDistricts=7;
 game.room.playerDistricts[0]=[district('monument'),district('monument'),district('catacombs')];
 hand(game,[district('monument'),district('catacombs')]);
 game.state.gameRules.duplicateLimit=5;
 game.slotEventHandlers.build(0,0);
 assert.equal(game.room.playerDistricts[0].length,4); // size6, Monument not last
 game.slotEventHandlers.build(0,0);
 assert.equal(game.room.playerDistricts[0].length,5); // Catacombs size remains6
 assert.equal(game.room.ender,null);
 hand(game,[district('manor')]);game.slotEventHandlers.build(0,0);assert.equal(game.room.ender,0);
});

test('each Laboratory and Forge has its own use, rejecting replay and foreign source',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('laboratory'),district('laboratory'),district('forgery'),district('forgery')];
 hand(game,[district('manor'),district('temple'),district('church')]);
 game.slotEventHandlers['laboratory-action'](0,0,0);game.slotEventHandlers['laboratory-action'](0,0,0);
 assert.equal(game.room.playerGold[0],22);assert.equal(game.room.playerHand[0],2);
 game.slotEventHandlers['laboratory-action'](0,0,1);assert.equal(game.room.playerGold[0],24);
 game.slotEventHandlers['forgery-action'](0,2);game.slotEventHandlers['forgery-action'](0,3);
 assert.equal(game.room.playerGold[0],20);assert.equal(game.room.playerHand[0],7);
 game.slotEventHandlers['forgery-action'](0,0);assert.equal(game.room.playerGold[0],20);
 game.room.turnId++;game.slotEventHandlers['laboratory-action'](0,0,0);assert.equal(game.room.playerGold[0],22);
});

test('Workshop discounts current hand per source and preserves discount on theft',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('architects_workshop'),district('architects_workshop')];
 hand(game,[district('manor'),district('factory')]);
 game.slotEventHandlers['architects-workshop-action'](0,0);game.slotEventHandlers['architects-workshop-action'](0,0);
 game.slotEventHandlers['architects-workshop-action'](0,1);
 assert.equal(game.room.playerGold[0],14);assert.equal(game.state.alchemistCoins,0);
 assert.deepEqual(game.state.players[0].hand.map(c=>c.buildDiscount),[2,2]);
 game.room.currentPlayer=1;game.state.players[1].action='wizard-player-action';
 game.slotEventHandlers['wizard-choose-player'](1,0);game.slotEventHandlers['wizard-choose-card'](1,0);
 assert.equal(game.state.players[1].hand[0].buildDiscount,2);
});

test('Tower privately peeks before resources, cannot take a peeked card and resumes role',()=>{
 const {game,messages}=fixture();game.room.playerDistricts[0]=[district('divination_tower'),district('observatory'),district('observatory')];
 game.state.districtDeck=[district('manor'),district('temple'),district('church'),district('market'),district('castle')];
 game.state.players[0].action='warlord-action';const before=JSON.stringify(game.state.districtDeck);
 game.slotEventHandlers['divination-tower-action'](0,0);
 assert.equal(game.room.phase,3);assert.equal(game.state.players[0].choose.length,4);
 assert.equal(game.room.tookResource,false);game.slotEventHandlers['take-card'](0,0);
 assert.equal(game.room.playerHand[0],0);assert.equal(JSON.stringify(game.state.districtDeck),before);
 assert.ok(messages.filter(m=>m.event==='state').every(m=>!('choose' in m.data)));
 game.slotEventHandlers['district-peek-close'](0);
 assert.equal(game.room.phase,2);assert.equal(game.state.players[0].action,'warlord-action');
 game.slotEventHandlers['divination-tower-action'](0,0);assert.equal(game.room.phase,2);
});

test('Conspiracies keep latest distinct targets within capacity and never publish roles',()=>{
 const {game,messages}=fixture();game.room.characterInGame=Array.from({length:8},(_,i)=>(i+1)+'_1');game.state.playersCount=5;
 for(const i of [0,1,2])game.room.playerDistricts[i]=[district('conspirators_house')];
 for(const [slot,role] of [[0,'1_1'],[1,'2_1'],[2,'3_1']]){game.room.currentPlayer=slot;game.state.players[slot].action=null;game.slotEventHandlers['conspirators-house-action'](slot,0,role);}
 assert.deepEqual(game.state.pendingConspiracies.map(x=>x.characterId),['2_1','3_1']);
 assert.deepEqual(game.state.players[0].conspiratorTargets,[]);
 assert.deepEqual(game.room.conspiratorEffects.map(x=>x.ownerSlot),[1,2]);
 assert.ok(game.room.conspiratorEffects.every(x=>!('characterId' in x)));
 assert.equal(game.room.playerGold[2],20);
 game.room.currentPlayer=2;game.slotEventHandlers['conspirators-house-action'](2,0,'4_1');
 assert.deepEqual(game.state.pendingConspiracies.map(x=>x.characterId),['2_1','3_1']);
});

test('Judicial Chamber schedules next round, cannot repeat, and ban blocks paid and free builds',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('judicial_chamber'),district('framework')];
 game.slotEventHandlers['judicial-chamber-action'](0,0);
 assert.equal(game.state.buildingBanRound,3);assert.equal(game.room.buildingBan||false,false);
 assert.equal(game.room.nextRoundBuildingBan,true);assert.equal(game.room.playerDistricts[0][0].judicialUsed,true);
 game.room.roundNumber=3;game.slotEventHandlers['judicial-chamber-action'](0,0);assert.equal(game.state.buildingBanRound,3);
 game.room.buildingBan=true;hand(game,[district('stable'),district('necropolis')]);
 game.slotEventHandlers.build(0,0);game.slotEventHandlers['framework-action'](0,0,1);game.slotEventHandlers['build-necropolis'](0,1);
 assert.equal(game.room.playerHand[0],2);assert.equal(game.room.playerDistricts[0].length,2);
 assert.equal(game.room.playerGold[0],20);
});

test('Mirror pays its own discounted price and permanently copies independent Museum state',()=>{
 const {game,messages}=fixture();game.room.playerDistricts[0]=[district('factory')];
 const original={...district('museum'),decoration:2,exposition:[{...district('theater'),buildDiscount:1}],actionsUsed:{museum:1}};
 game.room.playerDistricts[1]=[original];hand(game,[{...district('mirror_hall'),buildDiscount:2}]);
 game.slotEventHandlers['build-mirror'](0,0,1,0);
 const copy=game.room.playerDistricts[0][1];assert.equal(game.room.playerGold[0],17);
 assert.equal(copy.type,'museum');assert.equal(copy.cost,4);assert.equal(copy.decoration,2);
 assert.deepEqual(copy.actionsUsed,{museum:1});assert.equal(copy.exposition[0].type,'theater');
 assert.notEqual(copy,original);assert.notEqual(copy.exposition[0],original.exposition[0]);
 const event=messages.filter(message=>message.event==='state' && message.data.mirrorBuild).at(-1);
 assert.deepEqual(event.data.mirrorBuild,{slot:0,instanceId:copy.instanceId});
 assert.ok(event.target.has('host'));assert.ok(event.target.has('spectator'));
 assert.notEqual(copy.instanceId,original.instanceId);assert.ok(copy.exposition[0].instanceId);
 assert.ok(!JSON.stringify(game.getSnapshot()).includes('mirrorBuild'));
 game.slotEventHandlers['take-resources'](0,'coins');
 assert.equal(messages.filter(message=>message.event==='state').at(-1).data.mirrorBuild,undefined);
 game.state.players[0].action='warlord-action';game.slotEventHandlers.destroy(0,0,1);
 assert.ok(game.state.districtDiscard.some(c=>c.type==='museum'));assert.ok(game.state.districtDiscard.some(c=>c.type==='theater'));
 assert.equal(original.exposition.length,1);assert.equal(original.decoration,2);
});

test('end payouts all use the same initial hand/gold and effective city size',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('poor_house'),district('poor_house'),district('park'),district('park'),district('artisans_court'),district('artisans_court'),district('catacombs')];
 game.state.turnStartCitySize=7;game.room.playerGold[0]=0;game.room.tookResource=true;
 game.state.characterRoles={};game.state.currentIndCharacter=1;game.room.currentCharacter='1_1';game.room.ender=0;
 game.slotEventHandlers['end-turn'](0);
 assert.equal(game.room.playerGold[0],4);assert.equal(game.room.playerHand[0],4);
});
test('income counts premium basic and each magic school, resources use each mine/observatory',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('citadel'),district('prison'),district('school_of_magic'),district('school_of_magic')];
 game.room.incomeAction=true;game.slotEventHandlers['take-income'](0);assert.equal(game.room.playerGold[0],25);
 game.room.playerDistricts[0]=[district('gold_mine'),district('gold_mine')];game.slotEventHandlers['take-resources'](0,'coins');assert.equal(game.room.playerGold[0],29);
 game.room.tookResource=false;game.room.playerDistricts[0]=[district('observatory'),district('observatory')];game.slotEventHandlers['take-resources'](0,'card');assert.equal(game.state.players[0].choose.length,4);
});

test('live score uses new bonuses and each scoring instance without a color for Bridge',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('stone_bridge'),district('catacombs'),{...district('winery'),wineAge:5},district('dragon_gate'),district('dragon_gate')];
 game.slotEventHandlers['take-resources'](0,'coins');
 assert.equal(game.room.playerScore[0],33); // nominal20 + fixed13
});
test('specific Framework and Arsenal sources are consumed, preserving another copy',()=>{
 const {game}=fixture();const f0={...district('framework'),decoration:1},f1={...district('framework'),decoration:2};
 game.room.playerDistricts[0]=[f0,f1];hand(game,[district('manor')]);
 game.slotEventHandlers['framework-action'](0,0,1);assert.equal(game.room.playerDistricts[0][0],f0);
 assert.equal(game.room.playerDistricts[0].length,2);assert.equal(game.room.playerGold[0],20);
 const a0={...district('arsenal'),decoration:1},a1={...district('arsenal'),decoration:2};game.room.playerDistricts[0]=[a0,a1];game.room.playerDistricts[1]=[district('church')];
 game.slotEventHandlers['arsenal-destroy'](0,1,0,1);assert.equal(game.room.playerDistricts[0][0],a0);assert.equal(game.room.playerDistricts[0].length,1);
});

test('Mirror rejects own city, Theater, excess duplicates and last Monument; ordinary mode stays Mirror',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('manor')];game.room.playerDistricts[1]=[district('theater'),district('manor'),district('monument')];hand(game,[district('mirror_hall')]);
 for(const [slot,index] of [[0,0],[1,0],[1,1]])game.slotEventHandlers['build-mirror'](0,0,slot,index);
 assert.equal(game.room.playerHand[0],1);assert.equal(game.room.playerGold[0],20);
 game.state.maxDistricts=3;game.slotEventHandlers['build-mirror'](0,0,1,2);assert.equal(game.room.playerHand[0],1);
 game.slotEventHandlers['build-mirror'](0,0);assert.equal(game.room.playerDistricts[0][1].type,'mirror_hall');
 assert.equal(game.room.playerGold[0],14);
});
test('exact copy keeps mature wine and used Chamber, ordinary reconstruction resets them',()=>{
 const {game}=fixture();game.room.playerDistricts[1]=[{...district('winery'),wineAge:5},{...district('judicial_chamber'),judicialUsed:true}];
 hand(game,[district('mirror_hall'),district('mirror_hall')]);game.slotEventHandlers['build-mirror'](0,0,1,0);game.slotEventHandlers['build-mirror'](0,0,1,1);
 assert.equal(game.room.playerDistricts[0][0].wineAge,5);assert.equal(game.room.playerDistricts[0][1].judicialUsed,true);
 game.room.playerDistricts[0]=[];game.room.playerGold[0]=20;hand(game,[{...district('winery'),wineAge:5},{...district('judicial_chamber'),judicialUsed:true}]);
 game.slotEventHandlers.build(0,0);game.slotEventHandlers.build(0,0);
 assert.equal(game.room.playerDistricts[0][0].wineAge,0);assert.equal(game.room.playerDistricts[0][1].judicialUsed,false);
});
test('empty peek is unavailable and a short peek does not shuffle discard',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('divination_tower')];game.state.districtDeck=[];game.state.districtDiscard=[district('manor')];
 game.slotEventHandlers['divination-tower-action'](0,0);assert.equal(game.room.phase,2);assert.equal(game.room.playerDistricts[0][0].actionsUsed,undefined);
 game.state.districtDeck=[district('church')];game.slotEventHandlers['divination-tower-action'](0,0);
 assert.equal(game.state.players[0].choose.length,1);game.slotEventHandlers['district-peek-close'](0);
 assert.equal(game.state.districtDeck.length,1);assert.equal(game.state.districtDiscard.length,1);
});

test('Wizard borrowed Mirror keeps its extra build permission when transformed',()=>{
 const {game}=fixture();game.room.currentCharacter='3_2';game.room.buildDistricts=0;game.state.players[0].action=null;
 game.room.playerDistricts[1]=[district('church')];hand(game,[{...district('mirror_hall'),wizard:true}]);
 game.slotEventHandlers['build-mirror'](0,0,1,0);assert.equal(game.room.playerDistricts[0][0].type,'church');assert.equal(game.room.buildDistricts,0);
});

test('district actions cannot interrupt the bewitched resource handover',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('architects_workshop'),district('divination_tower')];hand(game,[district('manor')]);
 game.room.witched=game.room.currentCharacter;game.room.witchedstate=2;game.room.buildDistricts=-1;
 game.slotEventHandlers['architects-workshop-action'](0,0);game.slotEventHandlers['divination-tower-action'](0,1);
 assert.equal(game.room.playerGold[0],20);assert.equal(game.room.phase,2);assert.equal(game.state.players[0].hand[0].buildDiscount,undefined);
});

test('alternative payments build the selected hand instance with its own discount',()=>{
 const {game}=fixture();hand(game,[district('den_of_thieves'),{...district('den_of_thieves'),buildDiscount:4},district('manor')]);
 game.slotEventHandlers['build-den-of-thieves'](0,[2],1);
 assert.equal(game.room.playerGold[0],19);assert.equal(game.room.playerDistricts[0][0].buildDiscount,4);
 assert.equal(game.state.players[0].hand[0].buildDiscount,undefined);
 game.room.playerDistricts[0]=[district('manor')];hand(game,[district('necropolis'),{...district('necropolis'),buildDiscount:3}]);
 game.slotEventHandlers['build-necropolis'](0,0,1);
 assert.equal(game.room.playerDistricts[0][0].buildDiscount,3);assert.equal(game.state.players[0].hand[0].buildDiscount,undefined);
});

test('pending Chamber attribution survives destruction and snapshot restoration',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('judicial_chamber'),district('arsenal')];game.room.playerDistricts[1]=[district('manor')];
 game.slotEventHandlers['judicial-chamber-action'](0,0);
 assert.deepEqual(game.room.buildingBanSources,[{ownerSlot:0,sourceSlot:0,sourceIndex:0,round:3}]);
 game.slotEventHandlers['arsenal-destroy'](0,0,0,1);
 assert.deepEqual(game.room.buildingBanSources,[{ownerSlot:0,sourceSlot:null,sourceIndex:null,round:3}]);
 const restored=fixture().game;restored.setSnapshot(JSON.parse(JSON.stringify(game.getSnapshot())));
 assert.deepEqual(restored.room.buildingBanSources,[{ownerSlot:0,sourceSlot:null,sourceIndex:null,round:3}]);
 assert.equal(restored.room.nextRoundBuildingBan,true);
});
test('killed Emperor cannot activate districts during the out-of-turn crown response',()=>{
 const {game}=fixture();game.room.currentCharacter='0';game.state.players[0].action='emperor-nores-action';
 game.room.playerDistricts[0]=[district('architects_workshop'),district('divination_tower'),district('judicial_chamber')];hand(game,[district('manor')]);
 game.slotEventHandlers['architects-workshop-action'](0,0);game.slotEventHandlers['divination-tower-action'](0,1);game.slotEventHandlers['judicial-chamber-action'](0,2);
 assert.equal(game.room.playerGold[0],20);assert.equal(game.room.phase,2);assert.equal(game.room.nextRoundBuildingBan,false);
});

test('Cardinal can finance the original Mirror while copying a target district',()=>{
 const {game,messages}=fixture();game.room.currentCharacter='5_3';game.state.players[0].action='cardinal-action';game.room.playerGold[0]=0;
 game.room.playerDistricts[1]=[{...district('museum'),decoration:2,exposition:[district('manor')]}];
 hand(game,[district('mirror_hall'),...Array.from({length:6},()=>district('market'))]);
 game.slotEventHandlers['cardinal-sell'](0,2,0,[1,2,3,4,5,6],1,0);
 assert.equal(game.room.playerDistricts[0][0].type,'museum');assert.equal(game.room.playerDistricts[0][0].decoration,2);
 assert.equal(game.room.playerGold[2],14);assert.equal(game.room.playerHand[2],6);assert.equal(game.room.playerHand[0],0);
 assert.deepEqual(messages.filter(message=>message.event==='state').at(-1).data.mirrorBuild,
  {slot:0,instanceId:game.room.playerDistricts[0][0].instanceId});
 assert.ok(!JSON.stringify(game.getSnapshot()).includes('mirrorBuild'));
});

test('Mirror never signals failed construction or construction without a copied effect',()=>{
 const {game,messages}=fixture();hand(game,[district('mirror_hall')]);
 game.room.playerDistricts[1]=[district('museum')];game.room.playerGold[0]=0;
 game.slotEventHandlers['build-mirror'](0,0,1,0);
 assert.equal(game.room.playerDistricts[0].length,0);
 game.room.playerGold[0]=20;game.slotEventHandlers['build-mirror'](0,0,0,0);
 game.slotEventHandlers['build-mirror'](0,0);
 assert.equal(game.room.playerDistricts[0][0].type,'mirror_hall');
 assert.ok(messages.filter(message=>message.event==='state').every(message=>!message.data.mirrorBuild));
 const cardinal=fixture();cardinal.game.room.currentCharacter='5_3';cardinal.game.state.players[0].action='cardinal-action';
 cardinal.game.room.playerGold[0]=0;cardinal.game.room.playerGold[2]=0;
 cardinal.game.room.playerDistricts[1]=[district('museum')];
 hand(cardinal.game,[district('mirror_hall'),...Array.from({length:6},()=>district('market'))]);
 cardinal.game.slotEventHandlers['cardinal-sell'](0,2,0,[1,2,3,4,5,6],1,0);
 assert.equal(cardinal.game.room.playerDistricts[0].length,0);
 assert.ok(cardinal.messages.every(message=>!message.data || !message.data.mirrorBuild));
 cardinal.game.room.playerGold[2]=20;
 cardinal.game.slotEventHandlers['cardinal-sell'](0,2,0,[1,2,3,4,5,6]);
 assert.equal(cardinal.game.room.playerDistricts[0][0].type,'mirror_hall');
 assert.ok(cardinal.messages.filter(message=>message.event==='state').every(message=>!message.data.mirrorBuild));
});
test('restored peek timeout preserves deck, discard and used source',async t=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('divination_tower')];game.state.districtDeck=[district('church'),district('manor')];game.state.districtDiscard=[district('market')];
 game.slotEventHandlers['divination-tower-action'](0,0);
 game.room.timer={kind:'main',ownerSlot:0,character:'8_1',endsAt:Date.now()-1};
 const snapshot=JSON.parse(JSON.stringify(game.getSnapshot()));const restored=fixture().game;t.after(()=>restored.clearTurnTimer());
 restored.setSnapshot(snapshot);await new Promise(resolve=>setTimeout(resolve,35));
 assert.deepEqual(restored.state.districtDeck.map(c=>c.type),['church','manor']);assert.deepEqual(restored.state.districtDiscard.map(c=>c.type),['market']);
 assert.equal(restored.room.playerHand[0],0);assert.equal(restored.room.playerDistricts[0][0].actionsUsed.divination_tower,1);
 assert.notEqual(restored.room.phase,3);
});

test('Chamber highlight follows the activated instance after transfer while preserving its initiator',()=>{
 const {game}=fixture();game.room.playerDistricts[0]=[district('judicial_chamber')];game.room.playerDistricts[1]=[district('manor')];
 game.slotEventHandlers['judicial-chamber-action'](0,0);
 const chamber=game.room.playerDistricts[0].pop();game.room.playerDistricts[1].push(chamber);
 game.updateBuildingBans();
 assert.deepEqual(game.room.buildingBanSources,[{ownerSlot:0,sourceSlot:1,sourceIndex:1,round:3}]);
 assert.equal(game.room.nextRoundBuildingBan,true);
 const restored=fixture().game;restored.setSnapshot(JSON.parse(JSON.stringify(game.getSnapshot())));
 assert.deepEqual(restored.room.buildingBanSources,game.room.buildingBanSources);
});
