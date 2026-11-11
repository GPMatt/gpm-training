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
    {property_id:'44444444-4444-4444-4444-444444444444', canonical_address:'90 Wealthy St SE', af_account:'11'},
    {property_id:'55555555-5555-5555-5555-555555555555', canonical_address:'600 Lyon St NE', af_account:'11'}];
  var units = {'11111111-1111-1111-1111-111111111111':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000001',unit_label_af:'4B'},{unit_id:'aaaaaaaa-0000-0000-0000-000000000002',unit_label_af:'5A'}],
    '22222222-2222-2222-2222-222222222222':[], '33333333-3333-3333-3333-333333333333':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000003',unit_label_af:'204'}],
    '44444444-4444-4444-4444-444444444444':[], '55555555-5555-5555-5555-555555555555':[]};
  // Reset the fake data: open the preview with ?reset . Fail the email stubs: localStorage.mockEmailFail = '1'.
  if (/[?&]reset/.test(location.search)) { localStorage.removeItem('mockTurns'); Object.keys(localStorage).forEach(function(k){ if(k.indexOf('p03timer:')===0) localStorage.removeItem(k); }); }
  if (/[?&]reset/.test(location.search)) localStorage.removeItem('mockSettings');
  var db = {turns: JSON.parse(localStorage.getItem('mockTurns')||'null'), settings: JSON.parse(localStorage.getItem('mockSettings')||'null')};
  function persist(){ localStorage.setItem('mockTurns', JSON.stringify(db.turns)); }
  /** Fake turns: Riley walk (Tech Prep draft, old blinds fields), Bill's property (Oak Valley, nothing filled),
   *  Wesley walk (547 Cherry, nothing filled), move-out day with 2 confirmed steps + damages to carry in. */
  function seed(){
    var E = Engine, cat = DEFAULT_SETTINGS.catalog;
    function day(n){ var d = new Date(); d.setDate(d.getDate()+n); return E.iso(d); }
    function turn(id, pid, plabel, uid, ulabel, walk, mo, mi, trades){
      var steps = E.stepsFromScope({trades:trades}, cat, 0); E.layout(steps, mo, cat);
      return {id:id, property_id:pid, property_label:plabel, unit_id:uid, unit_label:ulabel, af_wo_number:null, move_out_date:mo, move_in_date:mi,
        scope:{walk_type:walk, trades:trades, pests:'None', access:'Lockbox 1234', submitted_at:new Date().toISOString()}, steps:steps, stage:'scheduling', archived:false};
    }
    var a = turn('turn-riley', '55555555-5555-5555-5555-555555555555', '600 Lyon St NE', null, null,
      'Riley walk (Spencer + Riley)', day(12), day(30), {tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    a.tech_prep = {done_by:'Riley', tech_hours:6, bedrooms:'2', bathrooms:'1', rekey:'Re-key', keys_entry:1, blinds_count:3, blinds_sizes:'35x64, 23x64',
      checklist:{kitchen:{2:{s:'fix', note:'Disposal jammed', charge:true}, 3:{s:'ok'}}, living:{3:{s:'nc', note:'Furniture in the way'}},
        bed2:{0:{s:'fix', note:'Latch broken'}, 1:{s:'ok'}}}};
    var w = turn('turn-wesley', '11111111-1111-1111-1111-111111111111', '547 Cherry St SE', 'aaaaaaaa-0000-0000-0000-000000000002', '5A',
      'Wesley walk (Spencer + Wesley)', day(14), day(30), {tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    w.steps[0].vendor = 'Wesley';
    var b = turn('turn-bill', '33333333-3333-3333-3333-333333333333', '2935 Oak Valley Ave SW', 'aaaaaaaa-0000-0000-0000-000000000003', '204',
      "Bill's property (Spencer alone)", day(10), day(25), {tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    b.steps[0].vendor = 'Bill';
    var c = turn('turn-moveout', '22222222-2222-2222-2222-222222222222', '1414 Plainfield Ave NE', null, null,
      'Riley walk (Spencer + Riley)', day(0), day(9), {flooring:{size:'lvp'}, tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    c.steps.forEach(function(s){ if (s.key==='flooring' || s.key==='paint') { s.status='booked'; s.confirmedAt=new Date().toISOString(); } });
    c.tech_prep = {done_by:'Riley', tech_hours:8, bedrooms:'1', bathrooms:'1', submitted_at:new Date().toISOString(), email_sent_at:new Date().toISOString(),
      keys_charge:true, keys_entry:1, keys_mailbox:0, remotes_garage:0,
      checklist:{basement:{2:{s:'nc', note:'Washer area locked'}}, bed1:{3:{s:'nc', note:'Blocked by boxes'}}, kitchen:{8:{s:'fix', note:'Door handle snapped', charge:true}}}};
    c.scope.damages = [{item:'Hole in hallway wall', room:'Hallway', charge:true}, {item:'Carpet stain', room:'Bedroom'}];
    // an older turn that still has a Pre-clean step (pre-clean is no longer offered as a trade)
    var p = turn('turn-preclean', '44444444-4444-4444-4444-444444444444', '90 Wealthy St SE', null, null,
      'Cookie cutter (Spencer alone)', day(16), day(35), {preclean:{size:'std'}, tech:{size:'basic'}, paint:{size:'full'}, clean:{size:'std'}});
    return [a, b, w, c, p];
  }
  function mail(id, kind){
    if (localStorage.getItem('mockEmailFail')) throw new Error('Mail service unavailable (preview stub)');
    var t = db.turns.filter(function(x){return x.id===id;})[0]; if (!t) throw new Error('Turn not found');
    var sentAt = new Date().toISOString();
    window.mockMailCalls = (window.mockMailCalls||[]).concat([kind+':'+id]);
    if (kind==='tp') t.tech_prep.email_sent_at = sentAt;
    else if (kind==='sched') t.scope.schedule_emailed_at = sentAt;
    else if (kind==='pending') { if (!t.move_out_check || !t.move_out_check.pending_impact) throw new Error('No scope change preview saved on this turn.'); t.move_out_check.pending_impact.alert_sent_at = sentAt; }
    else { if (!t.move_out_check || !t.move_out_check.impact) throw new Error('Apply the scope changes to the schedule first, then send.'); t.move_out_check.impact.email_sent_at = sentAt; }
    persist();
    return {to:['jason@greenpropertymgt.com', 'spencer@greenpropertymgt.com'], cc:kind==='pending'||kind==='applied' ? ['matt@greenpropertymgt.com'] : [],
      subject:(kind==='tp' ? 'Turn WO description: ' : kind==='sched' ? 'Turn schedule: ' : 'Turn scope changed: ') + t.property_label + ' ' + (t.unit_label||''), sentAt:sentAt};
  }
  var api = {
    apiBoot: function(){ if (!db.turns) { db.turns = seed(); persist(); }
      return {user:'spencer@greenpropertymgt.com', settings:db.settings, turns:JSON.parse(JSON.stringify(db.turns.filter(function(t){return !t.archived;})))}; },
    apiSendTechPrepEmail: function(id){ return mail(id, 'tp'); },
    apiEmailSchedule: function(id, text){ if (!String(text||'').trim()) throw new Error('The schedule is empty.'); return mail(id, 'sched'); },
    apiTurn: function(id){ return JSON.parse(JSON.stringify(db.turns.filter(function(x){return x.id===id;})[0]||null)); },
    apiWoDescription: function(id){ var t = db.turns.filter(function(x){return x.id===id;})[0]; var lines=[]; Object.keys((t.tech_prep||{}).checklist||{}).forEach(function(r){ var st=t.tech_prep.checklist[r]; Object.keys(st).forEach(function(i){ if(st[i].s==='fix') lines.push(r+': '+(st[i].note||'item '+i)+(st[i].charge?' (Charge Tenant)':'')+'.'); }); }); return {subject:'x', paste: lines.join(String.fromCharCode(10))||'No repairs found at the PMI.', wo: t.af_wo_number||''}; },
    apiSendMoveOutEmail: function(id, mode){ if (mode!=='pending' && mode!=='applied') throw new Error('mode must be pending or applied'); return mail(id, mode); },
    apiSaveTurn: function(t){ t = JSON.parse(JSON.stringify(t)); t.updated_at = new Date().toISOString();
      if(!t.id){ t.id = 'turn-' + Math.random().toString(36).slice(2,8); db.turns.push(t); }
      else { db.turns = db.turns.map(function(x){ return x.id===t.id ? t : x; }); }
      persist();
      // localStorage.mockCalendarError = 'msg' makes every save report a Calendar sync failure (the save itself works)
      var ce = localStorage.getItem('mockCalendarError'); if (ce) { t = JSON.parse(JSON.stringify(t)); t.calendarError = ce; }
      return t; },
    apiArchiveTurn: function(id){ db.turns.forEach(function(t){ if(t.id===id) t.archived=true; }); persist(); return {}; },
    apiSaveSettings: function(v){ db.settings = v; localStorage.setItem('mockSettings', JSON.stringify(v)); return v; },
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
