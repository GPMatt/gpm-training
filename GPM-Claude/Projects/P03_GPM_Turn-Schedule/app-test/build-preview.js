// Builds a local preview of the web app with a fake google.script.run (in-memory data).
// Run: node app-test/build-preview.js <out.html>
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../app');
let html = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');
html = html.replace(/<\?!= include\('(\w+)'\) \?>/g, (_, f) => fs.readFileSync(path.join(dir, f + '.html'), 'utf8'));
const mock = `<script>
(function(){
  var props = [
    {property_id:'11111111-1111-1111-1111-111111111111', canonical_address:'547 Cherry St SE', af_account:'11'},
    {property_id:'22222222-2222-2222-2222-222222222222', canonical_address:'1414 Plainfield Ave NE', af_account:'11'},
    {property_id:'33333333-3333-3333-3333-333333333333', canonical_address:'2935 Oak Valley Ave SW', af_account:'OAK'},
    {property_id:'44444444-4444-4444-4444-444444444444', canonical_address:'90 Wealthy St SE', af_account:'11'}];
  var units = {'11111111-1111-1111-1111-111111111111':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000001',unit_label_af:'4B'},{unit_id:'aaaaaaaa-0000-0000-0000-000000000002',unit_label_af:'5A'}],
    '22222222-2222-2222-2222-222222222222':[], '33333333-3333-3333-3333-333333333333':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000003',unit_label_af:'204'}],
    '44444444-4444-4444-4444-444444444444':[]};
  // Reset the fake data: open the preview with ?reset . Fail the email stubs: localStorage.mockEmailFail = '1'.
  if (/[?&]reset/.test(location.search)) { localStorage.removeItem('mockTurns'); Object.keys(localStorage).forEach(function(k){ if(k.indexOf('p03timer:')===0) localStorage.removeItem(k); }); }
  var db = {turns: JSON.parse(localStorage.getItem('mockTurns')||'null'), settings: null};
  function persist(){ localStorage.setItem('mockTurns', JSON.stringify(db.turns)); }
  /** Three fake turns: Riley walk (Tech Prep draft), Bill's property (nothing filled), move-out day with 2 confirmed steps. */
  function seed(){
    var E = Engine, cat = DEFAULT_SETTINGS.catalog;
    function day(n){ var d = new Date(); d.setDate(d.getDate()+n); return E.iso(d); }
    function turn(id, pid, plabel, uid, ulabel, walk, mo, mi, trades){
      var steps = E.stepsFromScope({trades:trades}, cat, 0); E.layout(steps, mo, cat);
      return {id:id, property_id:pid, property_label:plabel, unit_id:uid, unit_label:ulabel, af_wo_number:null, move_out_date:mo, move_in_date:mi,
        scope:{walk_type:walk, trades:trades, pests:'None', access:'Lockbox 1234', submitted_at:new Date().toISOString()}, steps:steps, stage:'scheduling', archived:false};
    }
    var a = turn('turn-riley', '11111111-1111-1111-1111-111111111111', '547 Cherry St SE', 'aaaaaaaa-0000-0000-0000-000000000001', '4B',
      'Riley walk (Spencer + Riley)', day(12), day(30), {tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    a.tech_prep = {done_by:'Riley', tech_hours:6, bedrooms:'2', bathrooms:'1', rekey:'Re-key', keys_entry:1,
      checklist:{kitchen:{2:{s:'fix', note:'Disposal jammed', charge:true}, 3:{s:'ok'}}, living:{3:{s:'nc', note:'Furniture in the way'}}}};
    var b = turn('turn-bill', '33333333-3333-3333-3333-333333333333', '2935 Oak Valley Ave SW', 'aaaaaaaa-0000-0000-0000-000000000003', '204',
      "Bill's property (Spencer alone)", day(10), day(25), {tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    b.steps[0].vendor = 'Bill';
    var c = turn('turn-moveout', '22222222-2222-2222-2222-222222222222', '1414 Plainfield Ave NE', null, null,
      'Riley walk (Spencer + Riley)', day(0), day(9), {flooring:{size:'lvp'}, tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    c.steps.forEach(function(s){ if (s.key==='flooring' || s.key==='paint') { s.status='booked'; s.confirmedAt=new Date().toISOString(); } });
    c.tech_prep = {done_by:'Riley', tech_hours:8, bedrooms:'1', bathrooms:'1', submitted_at:new Date().toISOString(), email_sent_at:new Date().toISOString(),
      checklist:{basement:{2:{s:'nc', note:'Washer area locked'}}, bed1:{3:{s:'nc', note:'Blocked by boxes'}}}};
    return [a, b, c];
  }
  function mail(id, kind){
    if (localStorage.getItem('mockEmailFail')) throw new Error('Mail service unavailable (preview stub)');
    var t = db.turns.filter(function(x){return x.id===id;})[0]; if (!t) throw new Error('Turn not found');
    var bill = /Bill/.test(t.scope.walk_type||''), sentAt = new Date().toISOString();
    window.mockMailCalls = (window.mockMailCalls||[]).concat([kind+':'+id]);
    if (kind==='tp') t.tech_prep.email_sent_at = sentAt;
    else if (kind==='alert') t.move_out_check.pending_impact.alert_sent_at = sentAt;
    else t.move_out_check.impact.email_sent_at = sentAt;
    persist();
    return {to:['spencer@greenpropertymgt.com', bill ? 'bill@greenpropertymgt.com' : 'riley@greenpropertymgt.com'], cc:['jason@greenpropertymgt.com'],
      subject:(kind==='tp' ? 'Turn WO description: ' : 'Turn scope changed: ') + t.property_label + ' ' + (t.unit_label||''), sentAt:sentAt};
  }
  var api = {
    apiBoot: function(){ if (!db.turns) { db.turns = seed(); persist(); }
      return {user:'spencer@greenpropertymgt.com', settings:db.settings, turns:JSON.parse(JSON.stringify(db.turns.filter(function(t){return !t.archived;})))}; },
    apiSendTechPrepEmail: function(id){ return mail(id, 'tp'); },
    apiSendMoveOutEmail: function(id){ return mail(id, 'mo'); },
    apiSendMoveOutAlert: function(id){ return mail(id, 'alert'); },
    apiSaveTurn: function(t){ t = JSON.parse(JSON.stringify(t)); t.updated_at = new Date().toISOString();
      if(!t.id){ t.id = 'turn-' + Math.random().toString(36).slice(2,8); db.turns.push(t); }
      else { db.turns = db.turns.map(function(x){ return x.id===t.id ? t : x; }); }
      persist(); return t; },
    apiArchiveTurn: function(id){ db.turns.forEach(function(t){ if(t.id===id) t.archived=true; }); persist(); return {}; },
    apiSaveSettings: function(v){ db.settings = v; return v; },
    apiProperties: function(){ return props; },
    apiUnits: function(id){ return units[id]||[]; }
  };
  function runner(){ var ok, fail; var r = {
    withSuccessHandler:function(f){ok=f;return r;}, withFailureHandler:function(f){fail=f;return r;} };
    Object.keys(api).forEach(function(k){ r[k] = function(){ var a=arguments; setTimeout(function(){ try{ ok && ok(api[k].apply(null,a)); }catch(e){ fail && fail(e); } }, 30); }; });
    return r; }
  window.google = {script:{get run(){ return runner(); }}};
})();
</script>`;
html = html.replace('<?!= include', '').replace(/(<script>\s*\/\*\*\s*\n \* Defaults)/, mock + '$1');
fs.writeFileSync(process.argv[2] || path.join(__dirname, 'preview.html'), html);
console.log('wrote', process.argv[2] || 'preview.html');
