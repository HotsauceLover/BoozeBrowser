const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');

// Execute the shipped script. Only the test copy exposes closure state;
// production HTML needs no test hooks, dependencies, or network services.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(match, 'The single-file application contains its script');
const source = match[1].replace(/\}\)\(\);\s*$/, 'window.__audit={state,drinks,getDraft,backupPayload,bartender,recipeText,reviewBackup};})();');
assert.notEqual(source, match[1], 'The test can expose the current app closure');
const KEY='bb_v04_pass1_drinks', NEW='bb_v04_new_draft', EDIT='bb_v04_edit_draft', LEGACY='bb_v04_draft';
const original={id:'fixture-original',name:'Audit Original',baseSpirit:'Rum',ingredients:'Rum\nLime',measurements:'2 oz\n1 oz',instructions:'Shake and strain.',garnish:'Lime',glass:'Rocks',whereTried:'Fixture Bar',notes:'Keep this original.',rating:4,favorite:true,recipeIncomplete:false,recipeNeededLater:false,imageType:'placeholder',placeholderType:'generic',placeholderId:'generic',createdAt:100,updatedAt:100,lastOpenedAt:0};
const incomplete={...original,id:'fixture-incomplete',name:'Audit Incomplete',favorite:false,recipeIncomplete:true,recipeNeededLater:true};
const plain=x=>JSON.parse(JSON.stringify(x));

function environment(seed=[original,incomplete], extraStorage={}, options={}){
  const values=new Map([[KEY,JSON.stringify(seed)],...Object.entries(extraStorage)]);
  const elements=Object.fromEntries(['app','toast','modal'].map(id=>[id,{innerHTML:'',textContent:'',classList:{add(){},remove(){}}}]));
  let activeForm=null;
  class FormData {constructor(form){this.form=form;}entries(){return Object.entries(this.form.values);}}
  class FileReader {readAsText(file){this.result=file.text;this.onload();}}
  class Clock extends Date {constructor(...args){super(...(args.length?args:[1700000000000]));}static now(){return 1700000000000;}}
  const context={console,JSON,Date:Clock,Object,Array,String,Number,Boolean,Math,Set,Map,Error,SyntaxError,
    document:{getElementById:id=>elements[id]||null,querySelector:()=>activeForm,createElement:()=>({click(){}})},
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},
    FormData,FileReader,Blob:class {},URL:{createObjectURL:()=>'',revokeObjectURL(){}},
    navigator:options.noClipboard?{}:{clipboard:{writeText:async text=>{context.copied=text;}}},
    setTimeout:(fn,delay)=>{if(delay===700)fn();return 1;}};
  context.window=context;
  vm.createContext(context);vm.runInContext(source,context);
  return {c:context,e:elements,values,a:context.__audit,setForm:form=>{activeForm=form;}};
}
function form(name, extra={}){
  return {dataset:{drinkForm:'full',formMode:'new'},values:{name,rating:'4',ingredients:'Rum',measurements:'2 oz',instructions:'Stir.',notes:'Disposable fixture',...extra},favorite:{checked:false},recipeComplete:{checked:false},reportValidity:()=>true};
}
function dirty(env,name='Audit draft'){
  env.c.BB.startAdd();const f=form(name);env.setForm(f);env.c.BB.saveDraftFromForm(f);return f;
}
function importBackup(env, data){env.c.BB.importJSON({target:{files:[{text:typeof data==='string'?data:JSON.stringify(data)}],value:'fixture.json'}});}

test('Alpha identity agrees across title, status and JSON export',()=>{
  const e=environment();const backup=e.a.backupPayload();
  assert.match(html,/<title>[^<]*Alpha 1<\/title>/);
  assert.equal(backup.version,'v0.5.0-alpha.1');
  assert.equal(backup.build,'Build '+backup.version);
  assert.match(e.e.app.innerHTML,/Build v0\.5\.0-alpha\.1/);
});
test('opening an edit then Add creates a different identity and preserves the original',()=>{
  const e=environment();e.a.state.selectedId=original.id;e.c.BB.editSelected();e.c.BB.startAdd();
  const saved=e.c.BB.saveFullFromForm(form('New drink'));
  assert.notEqual(saved.id,original.id);assert.equal(e.a.drinks().find(d=>d.id===original.id).name,original.name);
});
test('editing updates one record and preserves creation time',()=>{
  const e=environment();e.a.state.selectedId=original.id;e.c.BB.editSelected();
  const f=form('Revised',{id:original.id});f.dataset.formMode='edit';
  const saved=e.c.BB.saveFullFromForm(f);
  assert.equal(saved.id,original.id);assert.equal(saved.createdAt,original.createdAt);assert.equal(e.a.drinks().length,2);
});
test('rapid creates cannot share the same timestamp-based ID',()=>{
  const e=environment();const one=e.c.BB.saveFullFromForm(form('One'));const two=e.c.BB.saveFullFromForm(form('Two'));
  assert.notEqual(one.id,two.id);assert.equal(new Set(e.a.drinks().map(d=>d.id)).size,4);
});
test('saving an edit draft retains the independent new-drink draft',()=>{
  const e=environment();dirty(e);const before=e.values.get(NEW);
  e.a.state.selectedId=original.id;e.c.BB.editSelected();const f=form('Edited draft',{id:original.id});f.dataset.formMode='edit';e.c.BB.saveDraftFromForm(f);
  assert.equal(e.values.get(NEW),before);assert.equal(JSON.parse(e.values.get(EDIT)).id,original.id);
});
for(const mode of ['new','edit'])test('legacy '+mode+' draft migrates without losing text',()=>{
  const draft=mode==='edit'?{...original,notes:'Legacy edit'}:{name:'Legacy new',mode:'full'};
  const e=environment([original],{[LEGACY]:JSON.stringify(draft)});
  assert.deepEqual(JSON.parse(e.values.get(mode==='edit'?EDIT:NEW)),draft);assert.equal(e.values.has(LEGACY),false);
});
test('Save Drink commits once and continues to the requested destination',()=>{
  const e=environment();dirty(e);e.c.BB.nav('favorites');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.state.screen,'favorites');assert.equal(e.a.drinks().length,3);assert.equal(e.values.has(NEW),false);
});
test('Discard continues without adding a saved drink',()=>{
  const e=environment();dirty(e);e.c.BB.nav('home');e.c.BB.discardThenContinue();
  assert.equal(e.a.state.screen,'home');assert.equal(e.a.drinks().length,2);assert.equal(e.values.has(NEW),false);
});
test('Keep Editing retains the draft and cancels the pending destination',()=>{
  const e=environment();dirty(e);e.c.BB.nav('home');e.c.BB.keepEditing();
  assert.equal(e.a.state.screen,'add');assert.ok(e.values.has(NEW));assert.equal(e.a.state.hasUnsaved,true);assert.equal(e.a.state.pendingNav,null);
});
test('canceling an edit preserves an unrelated recovered new draft',()=>{
  const newDraft={name:'Do not remove',mode:'full'};const e=environment(undefined,{[NEW]:JSON.stringify(newDraft)});
  e.a.state.selectedId=original.id;e.c.BB.editSelected();const f=form('Edited',{id:original.id});f.dataset.formMode='edit';e.setForm(f);e.c.BB.saveDraftFromForm(f);
  e.c.BB.cancelEdit();e.c.BB.discardThenContinue();
  assert.equal(e.a.state.screen,'home');assert.deepEqual(JSON.parse(e.values.get(NEW)),newDraft);assert.equal(e.values.has(EDIT),false);
});
test('saving from a warning cannot create a nameless drink',()=>{
  const e=environment();dirty(e,'   ');e.c.BB.nav('home');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.drinks().length,2);assert.ok(e.values.has(NEW));assert.equal(e.a.state.screen,'add');assert.match(e.e.toast.textContent,/drink name/);
});
test('Close still asks for confirmation after resolving unsaved changes',()=>{
  const e=environment();dirty(e);e.c.BB.close();e.c.BB.discardThenContinue();
  assert.match(e.e.modal.innerHTML,/Close Bradley/);assert.notEqual(e.a.state.screen,'closed');
  e.c.BB.confirmClose();assert.equal(e.a.state.screen,'closed');
});
test('canceling Close after Discard cannot expose discarded form content',()=>{
  const e=environment();dirty(e,'Discard this form');e.c.BB.close();e.c.BB.discardThenContinue();e.c.BB.keepEditing();
  assert.equal(e.a.state.screen,'home');assert.equal(e.a.drinks().length,2);assert.equal(e.values.has(NEW),false);assert.doesNotMatch(e.e.app.innerHTML,/Discard this form/);
});
test('Save from the placeholder picker commits the draft and continues',()=>{
  const e=environment();const f=dirty(e,'Picker draft');
  e.c.document.querySelector=()=>e.a.state.screen==='placeholder'?null:f;
  e.c.BB.choosePlaceholder();assert.equal(e.a.state.screen,'placeholder');
  e.c.BB.nav('favorites');e.c.BB.saveDraftThenContinue();
  assert.equal(e.a.state.screen,'favorites');assert.equal(e.a.drinks().filter(d=>d.name==='Picker draft').length,1);assert.equal(e.values.has(NEW),false);
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
  e.c.BB.continueDraft('new');assert.match(e.e.app.innerHTML,/<option value="0" selected>/);
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
  importBackup(e,{drinks:[original]});e.c.BB.keepEditing();assert.equal(e.values.get(KEY),before);assert.ok(e.values.has(NEW));assert.equal(e.a.state.pendingImport,null);
});
test('import cannot silently clear stored drafts',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Keep draft',mode:'full'})});const before=e.values.get(KEY);
  importBackup(e,{drinks:[original]});e.c.BB.confirmImport();assert.equal(e.values.get(KEY),before);assert.ok(e.values.has(NEW));assert.match(e.e.modal.innerHTML,/Save or discard unfinished drinks/);
});
test('Save First opens the draft while preserving the current archive',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Keep draft',mode:'full'})});const before=e.values.get(KEY);
  importBackup(e,{drinks:[original]});e.c.BB.confirmImport();e.c.BB.reviewDraftBeforeImport();
  assert.equal(e.a.state.screen,'add');assert.equal(e.a.state.draft.name,'Keep draft');assert.equal(e.values.get(KEY),before);assert.equal(e.a.state.pendingImport,null);
});
test('explicit Discard Drafts and Import clears drafts and replaces the collection',()=>{
  const e=environment(undefined,{[NEW]:JSON.stringify({name:'Draft',mode:'full'}),[EDIT]:JSON.stringify(original)});
  importBackup(e,{drinks:[{...original,name:'Imported'}]});e.c.BB.confirmImport();e.c.BB.discardDraftsAndImport();
  assert.equal(e.values.has(NEW),false);assert.equal(e.values.has(EDIT),false);assert.equal(e.a.drinks()[0].name,'Imported');assert.equal(e.a.drinks().length,1);
});
test('deletion cleans favorites/recent/export while retaining a new draft',()=>{
  const e=environment(undefined,{bb_v04_recent:JSON.stringify([original.id]),[NEW]:JSON.stringify({name:'Keep new draft',mode:'full'})});
  e.c.BB.confirmDeleteDrink(original.id);
  assert.equal(e.a.drinks().some(d=>d.id===original.id),false);assert.deepEqual(JSON.parse(e.values.get('bb_v04_recent')),[]);assert.ok(e.values.has(NEW));
  assert.equal(e.a.backupPayload().drinks.some(d=>d.id===original.id),false);
});

if(process.env.BOOZEBROWSER_BACKUP_PATH)test('supplied user backup restores without changing drink records',()=>{
  const backup=JSON.parse(fs.readFileSync(process.env.BOOZEBROWSER_BACKUP_PATH,'utf8'));
  const e=environment([]);importBackup(e,backup);assert.equal(e.a.state.pendingImportReview.issues.length,0);e.c.BB.confirmImport();
  assert.deepEqual(plain(e.a.drinks()),backup.drinks);
});
