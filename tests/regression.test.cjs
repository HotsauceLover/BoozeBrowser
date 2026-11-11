const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const {webcrypto} = require('node:crypto');

// Execute the shipped script. Only the test copy exposes closure state;
// production HTML needs no test hooks, dependencies, or network services.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'The single-file application contains its script');
const source = match[1].replace(/\}\)\(\);\s*$/, 'window.__audit={state,drinks,storedDrafts,backupPayload,bartender,recipeText,reviewBackup};})();');
assert.notEqual(source, match[1], 'The test can expose the current app closure');
const KEY='bb_v04_pass1_drinks', NEW='bb_v04_new_draft', EDIT='bb_v04_edit_draft', LEGACY='bb_v04_draft';
const original={id:'fixture-original',name:'Audit Original',baseSpirit:'Rum',ingredients:'Rum\nLime',measurements:'2 oz\n1 oz',instructions:'Shake and strain.',garnish:'Lime',glass:'Rocks',whereTried:'Fixture Bar',notes:'Keep this original.',rating:4,favorite:true,recipeIncomplete:false,recipeNeededLater:false,imageType:'placeholder',placeholderType:'generic',placeholderId:'generic',createdAt:100,updatedAt:100,lastOpenedAt:0};
const incomplete={...original,id:'fixture-incomplete',name:'Audit Incomplete',favorite:false,recipeIncomplete:true,recipeNeededLater:true};
const plain=x=>JSON.parse(JSON.stringify(x));

function environment(seed=[original,incomplete], extraStorage={}, options={}){
  const values=new Map([[KEY,JSON.stringify(seed)],...Object.entries(extraStorage)]);
  const blockedWrites=new Set();
  const elements=Object.fromEntries(['app','desktop-view','toast','modal'].map(id=>{
    const classes=new Set();
    return [id,{
      innerHTML:'',textContent:'',hidden:id==='desktop-view',
      classList:{
        add:name=>classes.add(name),
        remove:name=>classes.delete(name),
        contains:name=>classes.has(name),
        toggle:(name,show)=>show?classes.add(name):classes.delete(name)
      }
    }];
  }));
  const navigationTimers=[];
  let activeForm=null;
  class FormData {constructor(form){this.form=form;}entries(){return Object.entries(this.form.values);}}
  class FileReader {readAsText(file){this.result=file.text;this.onload();}}
  class Clock extends Date {constructor(...args){super(...(args.length?args:[1700000000000]));}static now(){return 1700000000000;}}
  const context={console,JSON,Date:Clock,Object,Array,String,Number,Boolean,Math,Set,Map,Error,SyntaxError,crypto:webcrypto,
    document:{getElementById:id=>elements[id]||null,querySelector:()=>activeForm,createElement:()=>({click(){}})},
    localStorage:{
      get length(){return values.size;},
      key:index=>[...values.keys()][index]??null,
      getItem:key=>values.get(key)??null,
      setItem:(key,value)=>{
        if(blockedWrites.has(key)) throw new Error('Storage quota exceeded');
        values.set(key,String(value));
      },
      removeItem:key=>values.delete(key)
    },
    FormData,FileReader,Blob:class {},URL:{createObjectURL:()=>'',revokeObjectURL(){}},
    navigator:options.noClipboard?{}:{clipboard:{writeText:async text=>{context.copied=text;}}},
    setTimeout:(fn,delay)=>{
      if(delay===700){
        if(options.deferNavigation) navigationTimers.push(fn);
        else fn();
      }
      return 1;
    }};
  context.window=context;
  vm.createContext(context);vm.runInContext(source,context);
  return {c:context,e:elements,values,blockedWrites,a:context.__audit,setForm:form=>{activeForm=form;},finishNavigation:()=>navigationTimers.shift()?.()};
}
function form(name, extra={}){
  return {dataset:{drinkForm:'full'},values:{name,rating:'4',ingredients:'Rum',measurements:'2 oz',instructions:'Stir.',notes:'Disposable fixture',...extra},favorite:{checked:false},recipeComplete:{checked:false},reportValidity:()=>true};
}
function quickForm(name, extra={}){
  return {dataset:{drinkForm:'quick'},values:{name,rating:'4',whereTried:'',notes:'',...extra},recipeNeededLater:{checked:true},reportValidity:()=>true};
}
function typeDraft(env,f){
  env.setForm(f);
  env.c.BB.saveDraftFromForm(f);
}
function submit(env,f){
  const event={target:f,preventDefault(){}};
  if(f.dataset.drinkForm==='quick') env.c.BB.saveQuick(event);
  else env.c.BB.saveFull(event);
}
function dirty(env,name='Audit draft'){
  env.c.BB.startAdd();const f=form(name);typeDraft(env,f);return f;
}
function keepDraft(env){
  env.c.BB.nav('home');
  env.c.BB.keepDraftThenContinue();
  env.setForm(null);
}
function importBackup(env, data){env.c.BB.importJSON({target:{files:[{text:typeof data==='string'?data:JSON.stringify(data)}],value:'fixture.json'}});}

test('Alpha identity agrees across title, status and JSON export',()=>{
  const e=environment();const backup=e.a.backupPayload();
  assert.match(html,/<title>[^<]*Alpha 3<\/title>/);
  assert.equal(backup.version,'v0.5.0-alpha.3');
  assert.equal(backup.build,'Build '+backup.version);
  assert.match(e.e.app.innerHTML,/Build v0\.5\.0-alpha\.3/);
});
test('opening an edit then Add creates a different identity and preserves the original',()=>{
  const e=environment();e.a.state.selectedId=original.id;e.c.BB.editSelected();e.c.BB.startAdd();
  submit(e,form('New drink'));
  const saved=e.a.drinks().find(d=>d.name==='New drink');
  assert.notEqual(saved.id,original.id);assert.equal(e.a.drinks().find(d=>d.id===original.id).name,original.name);
});
test('editing updates one record and preserves creation time',()=>{
  const e=environment();e.a.state.selectedId=original.id;e.c.BB.editSelected();
  submit(e,form('Revised',{id:incomplete.id}));
  const saved=e.a.drinks().find(d=>d.name==='Revised');
  assert.equal(saved.id,original.id);assert.equal(saved.createdAt,original.createdAt);assert.equal(e.a.drinks().length,2);
  assert.deepEqual(plain(e.a.drinks().find(d=>d.id===incomplete.id)),incomplete);
});
test('rapid creates cannot share the same timestamp-based ID',()=>{
  const e=environment();e.c.BB.startAdd();submit(e,form('One'));const one=e.a.state.selectedId;
  e.c.BB.startAdd();submit(e,form('Two'));const two=e.a.state.selectedId;
  assert.notEqual(one,two);assert.equal(new Set(e.a.drinks().map(d=>d.id)).size,4);
});
test('two Quick Adds and an edit recover after reload and updating the original keeps both Quick Adds',()=>{
  const e=environment();
  for(const name of ['First bar drink','Second bar drink']){
    e.c.BB.startQuick();
    typeDraft(e,quickForm(name));
    keepDraft(e);
  }
  e.c.BB.open(original.id);
  e.c.BB.editSelected();
  const edited=form(original.name,{notes:'Updated after reopening'});
  typeDraft(e,edited);
  const reload=environment(undefined,Object.fromEntries(e.values));
  assert.match(reload.e.app.innerHTML,/Drafts \(3\)/);
  const edit=reload.a.storedDrafts().find(d=>d.drinkId===original.id);
  reload.c.BB.continueDraft(edit.id);
  assert.match(reload.e.app.innerHTML,/Updated after reopening/);
  submit(reload,edited);
  assert.equal(reload.a.drinks().length,2);
  assert.equal(reload.a.drinks().find(d=>d.id===original.id).notes,'Updated after reopening');
  assert.deepEqual(plain(reload.a.storedDrafts().map(d=>d.fields.name).sort()),['First bar drink','Second bar drink']);
  reload.c.BB.nav('home');
  const [first,second]=reload.a.storedDrafts();
  reload.c.BB.deleteDraft(first.id);
  assert.match(reload.e.app.innerHTML,/Drafts \(1\)/);
  reload.c.BB.continueDraft(second.id);
  assert.match(reload.e.app.innerHTML,/Quick Add/);
  assert.equal(reload.a.state.draft.fields.name,second.fields.name);
});
for(const mode of ['new','edit'])test('legacy '+mode+' draft migrates without losing text',()=>{
  const draft=mode==='edit'?{...original,notes:'Legacy edit'}:{name:'Legacy new',mode:'full'};
  const e=environment([original],{[LEGACY]:JSON.stringify(draft)});
  const [recovered]=e.a.storedDrafts();
  const {id,mode:oldMode,...fields}=draft;
  assert.deepEqual(plain(recovered.fields),fields);
  assert.equal(recovered.drinkId,id??null);assert.equal(e.values.has(LEGACY),false);
});
test('old draft slots coexist after migration and a second reload',()=>{
  const e=environment(undefined,{
    [NEW]:JSON.stringify({id:original.id,name:'Alpha 1 Quick Add',mode:'quick',rating:0,placeholderType:'color',placeholderId:'purple',recipeNeededLater:false}),
    [EDIT]:JSON.stringify({...original,notes:'Alpha 1 edit'}),
    [LEGACY]:JSON.stringify({name:'Earlier new drink',mode:'full'})
  });
  const reload=environment(undefined,Object.fromEntries(e.values));
  assert.equal(reload.a.storedDrafts().length,3);
  const quick=reload.a.storedDrafts().find(d=>d.mode==='quick');
  assert.equal(quick.drinkId,null);
  assert.equal(quick.fields.id,undefined);
  assert.equal(quick.fields.rating,0);
  assert.equal(quick.fields.placeholderId,'purple');
  assert.equal(quick.fields.recipeNeededLater,false);
  const edit=reload.a.storedDrafts().find(d=>d.drinkId===original.id);
  assert.equal(edit.fields.notes,'Alpha 1 edit');
  for(const key of [NEW,EDIT,LEGACY]) assert.equal(reload.values.has(key),false);
});
test('Save Drink commits once and continues to the requested destination',()=>{
  const e=environment();dirty(e);e.c.BB.nav('favorites');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.state.screen,'favorites');assert.equal(e.a.drinks().length,3);assert.equal(e.a.storedDrafts().length,0);
});
test('Discard continues without adding a saved drink',()=>{
  const e=environment();dirty(e);e.c.BB.nav('home');e.c.BB.discardThenContinue();
  assert.equal(e.a.state.screen,'home');assert.equal(e.a.drinks().length,2);assert.equal(e.a.storedDrafts().length,0);
});
test('Keep Editing retains the draft and cancels the pending destination',()=>{
  const e=environment();dirty(e);e.c.BB.back();e.c.BB.keepEditing();
  assert.equal(e.a.state.screen,'add');assert.equal(e.a.storedDrafts().length,1);assert.equal(e.a.state.hasUnsaved,true);assert.equal(e.a.state.pendingNav,null);
  assert.equal(e.a.state.history.at(-1),'home');
});
test('canceling an edit preserves an unrelated recovered new draft',()=>{
  const newDraft={name:'Do not remove',mode:'full'};const e=environment(undefined,{[NEW]:JSON.stringify(newDraft)});
  e.c.BB.open(original.id);e.c.BB.editSelected();typeDraft(e,form('Edited'));
  e.c.BB.cancelEdit();e.c.BB.discardThenContinue();
  assert.equal(e.a.state.screen,'home');assert.equal(e.a.storedDrafts().length,1);
  assert.equal(e.a.storedDrafts()[0].fields.name,newDraft.name);
});
test('saving from a warning cannot create a nameless drink',()=>{
  const e=environment();dirty(e,'   ');e.c.BB.nav('home');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.drinks().length,2);assert.equal(e.a.storedDrafts().length,1);assert.equal(e.a.state.screen,'add');assert.match(e.e.toast.textContent,/drink name/);
});
test('Minimize and Restore preserve the bartender card, selected drink and Back history',()=>{
  const e=environment();
  e.c.BB.open(incomplete.id);
  e.c.BB.bartender(incomplete.id);
  const history=plain(e.a.state.history);
  e.c.BB.minimize();
  assert.equal(e.e['desktop-view'].hidden,false);
  assert.equal(e.e.app.classList.contains('app-minimized'),true);
  e.c.BB.reopen();
  assert.equal(e.e['desktop-view'].hidden,true);
  assert.equal(e.e.app.classList.contains('app-minimized'),false);
  assert.equal(e.a.state.screen,'bartender');
  assert.equal(e.a.state.selectedId,incomplete.id);
  assert.match(e.e.app.innerHTML,/Audit Incomplete/);
  assert.deepEqual(plain(e.a.state.history),history);
  e.c.BB.back();
  assert.equal(e.a.state.screen,'detail');
  assert.equal(e.a.state.selectedId,incomplete.id);
});
test('restoring a dirty edit preserves its target, draft and leave-form warning',()=>{
  const e=environment();
  e.c.BB.open(original.id);
  e.c.BB.editSelected();
  const f=form(original.name,{notes:'First edit note'});
  typeDraft(e,f);
  const draftId=e.a.state.draft.id;
  f.values.notes='Latest edit note';
  e.c.BB.minimize();
  e.c.BB.reopen();
  assert.equal(e.a.state.screen,'add');
  assert.equal(e.a.state.draft.id,draftId);
  assert.equal(e.a.state.draft.drinkId,original.id);
  assert.equal(e.a.storedDrafts()[0].fields.notes,'Latest edit note');
  assert.equal(e.a.drinks().find(d=>d.id===original.id).notes,original.notes);
  e.c.BB.nav('home');
  assert.match(e.e.modal.innerHTML,/Unsaved cocktail data detected/);
});
test('the restored placeholder picker still applies to the active Quick Add',()=>{
  const e=environment();
  e.c.BB.startQuick();
  typeDraft(e,quickForm('Picker after Restore'));
  const draftId=e.a.state.draft.id;
  e.c.BB.choosePlaceholder();
  e.setForm(null);
  e.c.BB.minimize();
  e.c.BB.reopen();
  assert.equal(e.a.state.screen,'placeholder');
  e.c.BB.pickPlaceholder('color','purple');
  assert.equal(e.a.state.screen,'quick');
  assert.equal(e.a.state.draft.id,draftId);
  assert.equal(e.a.storedDrafts()[0].fields.placeholderId,'purple');
  assert.match(e.e.app.innerHTML,/Picker after Restore/);
});
test('desktop shortcuts open their destinations and leave unfinished drinks recoverable',()=>{
  const e=environment();
  dirty(e,'Left on the desktop');
  e.c.BB.minimize();
  e.c.BB.openDesktopShortcut('backup');
  assert.equal(e.e['desktop-view'].hidden,true);
  assert.equal(e.a.state.screen,'backup');
  assert.equal(e.a.storedDrafts()[0].fields.name,'Left on the desktop');
  e.c.BB.minimize();
  e.c.BB.openDesktopShortcut('home');
  assert.equal(e.a.state.screen,'home');
  assert.match(e.e.app.innerHTML,/<details class="draft-banner" open/);
  assert.match(e.e.app.innerHTML,/Left on the desktop/);
});
test('a page that finishes loading while minimized is ready on Restore',()=>{
  const e=environment(undefined,{}, {deferNavigation:true});
  e.c.BB.open(incomplete.id);
  assert.equal(e.a.state.screen,'loading');
  e.c.BB.minimize();
  e.finishNavigation();
  assert.equal(e.e['desktop-view'].hidden,false);
  e.c.BB.reopen();
  assert.equal(e.a.state.screen,'detail');
  assert.match(e.e.app.innerHTML,/Audit Incomplete/);
});
test('a draft storage error leaves the current form visible',()=>{
  const e=environment();
  dirty(e,'Keep the form open');
  e.blockedWrites.add('bb_v05_draft:'+e.a.state.draft.id);
  e.c.BB.minimize();
  assert.equal(e.e['desktop-view'].hidden,true);
  assert.equal(e.e.app.classList.contains('app-minimized'),false);
  assert.equal(e.a.state.screen,'add');
  assert.match(e.e.toast.textContent,/Could not save this draft/);
});
test('Close still asks for confirmation after resolving unsaved changes',()=>{
  const e=environment();dirty(e);e.c.BB.close();e.c.BB.discardThenContinue();
  assert.match(e.e.modal.innerHTML,/Close Bradley/);assert.notEqual(e.a.state.screen,'closed');
  e.c.BB.confirmClose();assert.equal(e.a.state.screen,'closed');
  e.c.BB.reopen();assert.equal(e.a.state.screen,'home');
});
test('canceling Close after Discard cannot expose discarded form content',()=>{
  const e=environment();dirty(e,'Discard this form');e.c.BB.close();e.c.BB.discardThenContinue();e.c.BB.keepEditing();
  assert.equal(e.a.state.screen,'home');assert.equal(e.a.drinks().length,2);assert.equal(e.a.storedDrafts().length,0);assert.doesNotMatch(e.e.app.innerHTML,/Discard this form/);
});
test('Save from the placeholder picker commits the draft and continues',()=>{
  const e=environment();const f=dirty(e,'Picker draft');
  e.c.document.querySelector=()=>e.a.state.screen==='placeholder'?null:f;
  e.c.BB.choosePlaceholder();assert.equal(e.a.state.screen,'placeholder');
  e.c.BB.nav('favorites');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.state.screen,'favorites');assert.equal(e.a.drinks().filter(d=>d.name==='Picker draft').length,1);assert.equal(e.a.storedDrafts().length,0);
});
test('opening the same drink resumes its edit while another drink keeps its own edit',()=>{
  const e=environment();
  for(const drink of [original,incomplete]){
    e.c.BB.open(drink.id);
    e.c.BB.editSelected();
    typeDraft(e,form(drink.name,{notes:'Edited '+drink.id}));
    keepDraft(e);
  }
  e.c.BB.open(original.id);
  e.c.BB.editSelected();
  assert.match(e.e.app.innerHTML,/Edited fixture-original/);
  assert.equal(e.a.state.draft.drinkId,original.id);
  e.c.BB.cancelEdit();
  assert.equal(e.a.storedDrafts().length,2);
  assert.equal(e.a.storedDrafts().find(d=>d.drinkId===incomplete.id).fields.notes,'Edited '+incomplete.id);
});
test('returning from placeholders and switching to Full Add preserve one draft and its fields',()=>{
  const e=environment();
  e.c.BB.startQuick();
  const f=quickForm('Convertible drink',{rating:'0',notes:'Keep this note'});
  typeDraft(e,f);
  const draftId=e.a.state.draft.id;
  e.c.BB.choosePlaceholder();
  e.c.BB.back();
  assert.equal(e.a.state.screen,'quick');
  assert.match(e.e.app.innerHTML,/Keep this note/);
  e.c.BB.choosePlaceholder();
  e.c.BB.pickPlaceholder('color','purple');
  e.c.BB.switchQuickToFull();
  const [draft]=e.a.storedDrafts();
  assert.equal(e.a.storedDrafts().length,1);
  assert.equal(draft.id,draftId);
  assert.equal(draft.mode,'full');
  assert.equal(draft.fields.placeholderId,'purple');
  assert.match(e.e.app.innerHTML,/<option value="0" selected>/);
  assert.match(e.e.app.innerHTML,/Recipe is complete/);
  const full=form(f.values.name,{rating:'0',notes:f.values.notes});
  full.recipeComplete.checked=true;
  typeDraft(e,full);
  keepDraft(e);
  e.c.BB.continueDraft(draftId);
  assert.match(e.e.app.innerHTML,/name="recipeComplete" checked/);
  submit(e,full);
  const saved=e.a.drinks().find(d=>d.name===f.values.name);
  assert.equal(saved.recipeIncomplete,false);
  assert.equal(saved.placeholderId,'purple');
  assert.equal(saved.rating,0);
});
test('opening and leaving untouched forms creates no draft',()=>{
  const e=environment();
  e.c.BB.startQuick();
  e.c.BB.choosePlaceholder();
  e.c.BB.back();
  e.c.BB.switchQuickToFull();
  e.c.BB.cancelEdit();
  assert.equal(e.a.state.screen,'home');
  assert.equal(e.a.storedDrafts().length,0);
});
test('a recovered edit with no original can be saved as a separate drink',()=>{
  const e=environment([incomplete],{[EDIT]:JSON.stringify(original)});
  assert.match(e.e.app.innerHTML,/Continue as New Drink/);
  e.c.BB.continueDraft(e.a.storedDrafts()[0].id);
  assert.match(e.e.app.innerHTML,/Add a New Drink/);
  submit(e,form(original.name));
  assert.equal(e.a.drinks().length,2);
  assert.notEqual(e.a.drinks().find(d=>d.name===original.name).id,original.id);
  assert.deepEqual(plain(e.a.drinks().find(d=>d.id===incomplete.id)),incomplete);
});
test('a failed save keeps the active draft for retry',()=>{
  const e=environment();
  const f=dirty(e,'Retry this drink');
  e.blockedWrites.add(KEY);
  submit(e,f);
  assert.equal(e.a.state.screen,'add');
  assert.equal(e.a.drinks().length,2);
  assert.equal(e.a.storedDrafts()[0].fields.name,'Retry this drink');
  assert.match(e.e.toast.textContent,/Could not save this drink/);
  e.blockedWrites.delete(KEY);
  submit(e,f);
  assert.equal(e.a.drinks().filter(d=>d.name==='Retry this drink').length,1);
  assert.equal(e.a.storedDrafts().length,0);
});
test('Copy Recipe has a valid handler and copies complete Unicode/quoted text',async()=>{
  const drink={...original,name:'Bradley’s "After Dark"',notes:'Less sweet. "Please" & thanks.',instructions:'Shake, then strain.\nEnjoy!'};
  const e=environment([drink]);e.a.state.selectedId=drink.id;
  const markup=e.a.bartender();const handler=markup.match(/onclick="(BB\.copyRecipe[^\"]*)"/)[1];
  await vm.runInContext(handler,e.c);
  for(const part of [drink.name,drink.notes,drink.instructions,drink.garnish,drink.glass,'Rum — 2 oz'])assert.ok(e.c.copied.includes(part),part);
});
test('Copy Recipe offers selectable text when clipboard access is unavailable',async()=>{
  const e=environment(undefined,{}, {noClipboard:true});await e.c.BB.copyRecipe();
  assert.match(e.e.modal.innerHTML,/readonly/);assert.match(e.e.modal.innerHTML,/Shake and strain/);
});
test('opening a zero-star drink for editing preserves zero',()=>{
  const e=environment([{...original,rating:0}]);e.a.state.selectedId=original.id;e.c.BB.editSelected();
  assert.match(e.e.app.innerHTML,/<option value="0" selected>/);
});
test('resuming a zero-star Quick Add draft preserves zero',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Unrated draft',mode:'quick',rating:0})});
  e.c.BB.continueDraft(e.a.storedDrafts()[0].id);assert.match(e.e.app.innerHTML,/<option value="0" selected>/);
  submit(e,quickForm('Unrated draft',{rating:'0'}));
  const saved=e.a.drinks().find(d=>d.name==='Unrated draft');
  assert.equal(saved.rating,0);
  assert.equal(saved.recipeNeededLater,true);
  assert.equal(saved.ingredients,'');
});
test('current and legacy valid backups preserve saved record content',()=>{
  for(const payload of [{version:'v0.4.2.6',drinks:[original,incomplete]},[original,incomplete]]){
    const e=environment([]);importBackup(e,payload);assert.equal(e.a.state.pendingImportReview.issues.length,0);e.c.BB.confirmImport();
    assert.deepEqual(plain(e.a.drinks()),[original,incomplete]);
  }
});
test('a name-only record is ready even without recipe details',()=>{
  const e=environment();importBackup(e,{drinks:[{name:'Remember this drink'}]});
  assert.equal(e.a.state.pendingImportReview.issues.length,0);assert.equal(e.a.state.pendingImport.length,1);
});
test('a mixed backup previews invalid names without replacing the collection',()=>{
  const e=environment();const before=e.values.get(KEY);importBackup(e,{drinks:[original,{id:'bad',name:123}]});
  assert.equal(e.a.state.pendingImportReview.issues.length,1);assert.match(e.e.modal.innerHTML,/Entries needing review/);
  e.c.BB.confirmImport();assert.equal(e.values.get(KEY),before);
});
test('incompatible recipe fields are flagged before import',()=>{
  const e=environment();importBackup(e,{drinks:[{...original,ingredients:['Rum','Lime']}]});
  assert.equal(e.a.state.pendingImportReview.issues.length,1);assert.equal(e.a.drinks().length,2);
});
test('ratings outside 0–5 are flagged while a numeric zero survives import',()=>{
  const e=environment();importBackup(e,{drinks:[{...original,rating:6}]});assert.equal(e.a.state.pendingImportReview.issues.length,1);
  importBackup(e,{drinks:[{...original,rating:'0'}]});assert.equal(e.a.state.pendingImportReview.issues.length,0);e.c.BB.confirmImport();assert.equal(e.a.drinks()[0].rating,0);
});
test('duplicate internal IDs are disclosed and repaired without merging drinks',()=>{
  const e=environment();const before=e.values.get(KEY);importBackup(e,{drinks:[{...original,name:'One'},{...original,name:'Two'}]});
  assert.equal(e.a.state.pendingImportReview.repairs.length,1);assert.equal(new Set(e.a.state.pendingImport.map(d=>d.id)).size,2);assert.equal(e.values.get(KEY),before);
  e.c.BB.confirmImport();assert.deepEqual(e.a.drinks().map(d=>d.name).join(','),'One,Two');
});
test('two drinks with the same name remain separate records',()=>{
  const e=environment();importBackup(e,{drinks:[original,{...original,id:'other'}]});e.c.BB.confirmImport();assert.equal(e.a.drinks().length,2);
});
test('missing or unsafe IDs receive disclosed safe IDs',()=>{
  const e=environment();importBackup(e,{drinks:[{name:'Missing ID'},{name:'Quoted ID',id:"bad'id"}]});
  assert.equal(e.a.state.pendingImportReview.repairs.length,2);
  for(const d of e.a.state.pendingImport)assert.match(d.id,/^[A-Za-z0-9_-]+$/);
});
test('unreadable JSON clears stale preview state and leaves saved data intact',()=>{
  const e=environment();const before=e.values.get(KEY);importBackup(e,{drinks:[original]});importBackup(e,'{broken');
  assert.equal(e.a.state.pendingImport,null);assert.equal(e.values.get(KEY),before);assert.match(e.e.toast.textContent,/not readable JSON/);
});
test('an empty exported archive waits for confirmation and then restores empty',()=>{
  const empty=environment([]).a.backupPayload();const e=environment();importBackup(e,empty);
  assert.match(e.e.modal.innerHTML,/This backup is empty/);assert.equal(e.a.drinks().length,2);
  e.c.BB.confirmImport();assert.equal(e.a.drinks().length,0);
});
test('Cancel Import preserves current records and drafts',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Keep draft',mode:'full'})});const before=e.values.get(KEY);
  importBackup(e,{drinks:[original]});e.c.BB.keepEditing();assert.equal(e.values.get(KEY),before);assert.equal(e.a.storedDrafts().length,1);assert.equal(e.a.state.pendingImport,null);
});
test('import cannot silently clear stored drafts',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Keep draft',mode:'full'}),[EDIT]:JSON.stringify(original)});const before=e.values.get(KEY);
  importBackup(e,{drinks:[original]});e.c.BB.confirmImport();
  assert.equal(e.values.get(KEY),before);
  assert.equal(e.a.storedDrafts().length,2);
  assert.match(e.e.modal.innerHTML,/Save or discard unfinished drinks/);
  assert.match(e.e.modal.innerHTML,/Keep draft \(Add Drink\)/);
  assert.match(e.e.modal.innerHTML,/Audit Original \(Edit Drink\)/);
  e.c.BB.reviewDraftBeforeImport();
  assert.equal(e.a.state.screen,'home');
  assert.match(e.e.app.innerHTML,/<details class="draft-banner" open/);
});
test('Save First opens the draft while preserving the current archive',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Keep draft',mode:'full'})});const before=e.values.get(KEY);
  importBackup(e,{drinks:[original]});e.c.BB.confirmImport();e.c.BB.reviewDraftBeforeImport();
  assert.equal(e.a.state.screen,'add');assert.equal(e.a.state.draft.fields.name,'Keep draft');assert.equal(e.values.get(KEY),before);assert.equal(e.a.state.pendingImport,null);
});
test('Discard Drafts and Import clears drafts only after the backup is saved',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Draft',mode:'full'}),[EDIT]:JSON.stringify(original)});
  importBackup(e,{drinks:[{...original,name:'Imported'}]});e.c.BB.confirmImport();
  e.blockedWrites.add(KEY);
  e.c.BB.discardDraftsAndImport();
  assert.equal(e.a.storedDrafts().length,2);
  assert.deepEqual(plain(e.a.drinks()),[original,incomplete]);
  e.blockedWrites.delete(KEY);
  e.c.BB.discardDraftsAndImport();
  assert.equal(e.a.storedDrafts().length,0);assert.equal(e.a.drinks()[0].name,'Imported');assert.equal(e.a.drinks().length,1);
});
test('deleting a saved drink removes only its edit draft and cleans recent drinks and exports',()=>{
  const e=environment(undefined,{
    bb_v04_recent:JSON.stringify([original.id]),
    [NEW]:JSON.stringify({name:'Keep new draft',mode:'full'}),
    [EDIT]:JSON.stringify(original),
    [LEGACY]:JSON.stringify(incomplete)
  });
  e.c.BB.confirmDeleteDrink(original.id);
  assert.equal(e.a.drinks().some(d=>d.id===original.id),false);assert.deepEqual(JSON.parse(e.values.get('bb_v04_recent')),[]);
  assert.deepEqual(plain(e.a.storedDrafts().map(d=>d.fields.name).sort()),['Audit Incomplete','Keep new draft']);
  assert.equal(e.a.backupPayload().drinks.some(d=>d.id===original.id),false);
});

if(process.env.BOOZEBROWSER_BACKUP_PATH)test('supplied user backup restores without changing drink records',()=>{
  const backup=JSON.parse(fs.readFileSync(process.env.BOOZEBROWSER_BACKUP_PATH,'utf8'));
  const e=environment([]);importBackup(e,backup);assert.equal(e.a.state.pendingImportReview.issues.length,0);e.c.BB.confirmImport();
  assert.deepEqual(plain(e.a.drinks()),backup.drinks);
});
