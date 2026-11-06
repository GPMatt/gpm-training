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
    {property_id:'33333333-3333-3333-3333-333333333333', canonical_address:'2935 Oak Valley Ave SW', af_account:'OAK'}];
  var units = {'11111111-1111-1111-1111-111111111111':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000001',unit_label_af:'4B'},{unit_id:'aaaaaaaa-0000-0000-0000-000000000002',unit_label_af:'5A'}],
    '22222222-2222-2222-2222-222222222222':[], '33333333-3333-3333-3333-333333333333':[{unit_id:'aaaaaaaa-0000-0000-0000-000000000003',unit_label_af:'204'}]};
  var db = {turns: JSON.parse(localStorage.getItem('mockTurns')||'[]'), settings: null};
  function persist(){ localStorage.setItem('mockTurns', JSON.stringify(db.turns)); }
  var api = {
    apiBoot: function(){ return {user:'spencer@greenpropertymgt.com', settings:db.settings, turns:db.turns.filter(function(t){return !t.archived;})}; },
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
