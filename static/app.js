/* ============================= API HELPERS ============================= */
async function api(path, options){
  const res = await fetch(path, Object.assign({
    headers: {'Content-Type':'application/json'},
    credentials: 'same-origin'
  }, options));
  let body = null;
  try{ body = await res.json(); }catch(e){ /* no body */ }
  if(!res.ok){
    const err = new Error((body && body.error) || 'Something went wrong.');
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}
const apiGet = (path)=> api(path);
const apiPost = (path, data)=> api(path, {method:'POST', body: JSON.stringify(data||{})});
const apiPatch = (path, data)=> api(path, {method:'PATCH', body: JSON.stringify(data||{})});
const apiDelete = (path)=> api(path, {method:'DELETE'});

const CONTENT_TYPES = ['Static','Reel','Carousel'];
const POSTING_TYPES = ['Story','Feed'];

let DB = { users: [], clients: [], tasks: [] };
let session = null;
let ui = { tab:'dashboard', clientId:null, navOpen:false, taskFilter:'all', taskClientFilter:'all', dashboardFilter:null, loginErr:null, loginBusy:false };
let modal = null;
let toastMsg = null;

function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(d){ if(!d) return '—'; const dt=new Date(d+'T00:00:00'); if(isNaN(dt)) return d; return dt.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function daysDiff(iso){ if(!iso) return NaN; const dt=new Date(iso+'T00:00:00'); const t=new Date(todayISO()+'T00:00:00'); return Math.round((dt-t)/86400000); }
function escapeHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function showToast(msg){ toastMsg = msg; render(); setTimeout(()=>{ toastMsg=null; render(); }, 2600); }

/* ============================= STATE LOADING ============================= */
async function refreshState(){
  const data = await apiGet('/api/state');
  session = data.me;
  DB.users = data.users; DB.clients = data.clients; DB.tasks = data.tasks;
}

/* ============================= DERIVED HELPERS ============================= */
function clientsForUser(){
  if(session.role==='admin') return DB.clients;
  if(session.role==='manager') return DB.clients.filter(c=>c.managerIds.includes(session.id));
  if(session.role==='designer') return DB.clients.filter(c=>c.designerIds.includes(session.id));
  return [];
}
function tasksForClient(clientId){ return DB.tasks.filter(t=>t.clientId===clientId); }
function tasksForUser(){
  const ids = clientsForUser().map(c=>c.id);
  return DB.tasks.filter(t=>ids.includes(t.clientId));
}
function userById(id){ return DB.users.find(u=>u.id===id); }
function clientById(id){ return DB.clients.find(c=>c.id===id); }
function managerList(){ return DB.users.filter(u=>u.role==='manager'); }
function designerList(){ return DB.users.filter(u=>u.role==='designer'); }
function namesForIds(ids){ return (ids||[]).map(id=>userById(id)).filter(Boolean).map(u=>u.name); }

// Every task belonging to any client this manager/designer is assigned to.
function tasksForAssignee(userId, role){
  const clientIds = DB.clients.filter(c => role==='manager' ? c.managerIds.includes(userId) : c.designerIds.includes(userId)).map(c=>c.id);
  return DB.tasks.filter(t=>clientIds.includes(t.clientId));
}

function statusPill(task){
  if(task.status==='Completed') return '<span class="pill pill-completed">Completed</span>';
  const d = daysDiff(task.deadline);
  if(isNaN(d)) return '<span class="pill pill-pending">Pending</span>';
  if(d<0) return '<span class="pill pill-overdue">Overdue</span>';
  if(d<=2) return '<span class="pill pill-soon">Due soon</span>';
  return '<span class="pill pill-pending">Pending</span>';
}
function deadlineTag(task){
  const d = daysDiff(task.deadline);
  let style='';
  if(task.status!=='Completed' && !isNaN(d)){
    if(d<0) style='color:var(--danger)';
    else if(d<=2) style='color:#9a6b12';
  }
  return `<span class="deadline-tag" style="${style}">${fmtDate(task.deadline)}</span>`;
}

/* ============================= RENDER: LOGIN ============================= */
function renderLogin(){
  const cells = Array.from({length:35}).map((_,i)=>{
    const r = Math.random();
    const cls = r<0.18 ? 'fill' : (r<0.34 ? 'fill2' : '');
    return `<div class="cell ${cls}" style="animation-delay:${(i*18)}ms"></div>`;
  }).join('');
  return `
  <div class="login-wrap">
    <div class="login-visual">
      <div class="brandmark">
        <div class="co">Prevoir Infotech</div>
        <div class="tag">Content Operations</div>
      </div>
      <div class="calendar-grid">${cells}</div>
      <div class="quote">One place to brief, design and ship every client's content — from the manager's plan to the designer's last "Completed".</div>
    </div>
    <div class="login-form-side">
      <div class="login-card">
        <h1>Sign in</h1>
        <p class="sub">Use the login issued to you by your admin.</p>
        ${ui.loginErr ? `<div class="error-msg">${escapeHtml(ui.loginErr)}</div>` : ''}
        <form id="loginForm">
          <div class="field"><label>Username</label><input type="text" name="username" autocomplete="username" required /></div>
          <div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required /></div>
          <button class="btn btn-primary btn-block" type="submit" ${ui.loginBusy?'disabled':''}>${ui.loginBusy?'Signing in…':'Sign in'}</button>
        </form>
        <div class="hint-box">First time here? Sign in as admin with <b>admin</b> / <b>admin123</b>, then create manager and designer logins from the Admin dashboard — and change this password right away.</div>
      </div>
    </div>
  </div>`;
}

/* ============================= SIDEBAR / NAV ============================= */
const ICONS = {
  dashboard:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="8.5" r="2.6"/><path d="M15 14.2c2.9.4 5.5 2.4 5.5 5.8"/></svg>',
  brush:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20c1-4 3-6 8-11l3 3c-5 5-7 7-11 8Z"/><path d="M14.5 4.5 19.5 9.5"/><path d="M17 3.2c1.3-1 2.8-.2 3.8.8s1.8 2.5.8 3.8"/></svg>',
  clients:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>',
  tasks:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l2 2 4-4"/><rect x="3" y="3" width="18" height="18" rx="2.5"/></svg>',
  logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
  clock:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  key:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="15" r="4"/><path d="M11 12 20 3M20 3h-4M20 3v4"/></svg>'
};
function navItemsFor(role){
  if(role==='admin') return [
    ['dashboard','Dashboard','dashboard'],
    ['managers','Managers','brush'],
    ['designers','Designers','users'],
    ['clients','Clients','clients'],
    ['alltasks','All Tasks','tasks'],
  ];
  if(role==='manager') return [
    ['dashboard','Dashboard','dashboard'],
    ['myclients','My Clients','clients'],
  ];
  return [
    ['dashboard','My Pending Tasks','clock'],
    ['myclients','My Clients','clients'],
  ];
}
function renderSidebar(){
  const items = navItemsFor(session.role).map(([key,label,icon])=>{
    const active = ui.tab===key ? 'active':'';
    return `<div class="nav-item ${active}" data-nav="${key}">${ICONS[icon]}<span>${label}</span></div>`;
  }).join('');
  const roleLabel = session.role==='admin'?'Admin':session.role==='manager'?'Manager':'Designer';
  return `
  <div class="sidebar">
    <div class="brand">Prevoir Infotech<small>Task Manager</small></div>
    <div>${items}</div>
    <div class="sidebar-foot">
      <div class="who"><b>${escapeHtml(session.name)}</b>${escapeHtml(session.username)}<span class="badge-role">${roleLabel}</span></div>
      <div class="nav-item" data-action="changepw">${ICONS.key}<span>Change password</span></div>
      <div class="nav-item" data-action="logout">${ICONS.logout}<span>Log out</span></div>
    </div>
  </div>`;
}

/* ============================= APP SHELL ============================= */
function renderApp(){
  const titleMap = {
    dashboard: session.role==='designer' ? 'My Pending Tasks' : 'Dashboard',
    managers:'Managers', designers:'Designers', clients:'Clients', alltasks:'All Tasks', myclients:'My Clients'
  };
  return `
  <div class="app ${ui.navOpen?'nav-open':''}">
    ${renderSidebar()}
    <div class="main">
      <div class="topbar">
        <div>
          <button class="mobile-toggle" data-action="togglenav">☰</button>
          <h2 style="display:inline-block; margin-left:8px;">${titleMap[ui.tab] || ''}</h2>
          <div class="path">Prevoir Infotech / ${titleMap[ui.tab] || ''}</div>
        </div>
      </div>
      ${renderTab()}
    </div>
  </div>
  ${modal ? renderModal() : ''}
  ${toastMsg ? `<div class="toast">${escapeHtml(toastMsg)}</div>` : ''}
  `;
}
function renderTab(){
  if(ui.tab==='dashboard') return session.role==='designer' ? renderDesignerPending() : renderDashboard();
  if(ui.tab==='managers') return renderUserList('manager');
  if(ui.tab==='designers') return renderUserList('designer');
  if(ui.tab==='clients') return renderAdminClients();
  if(ui.tab==='alltasks') return renderAllTasks();
  if(ui.tab==='myclients') return ui.clientId ? renderClientDetail(ui.clientId) : renderMyClients();
  return '';
}

/* ============================= DASHBOARDS ============================= */
function renderDashboard(){
  if(session.role==='admin'){
    const totalTasks = DB.tasks.length;
    const pending = DB.tasks.filter(t=>t.status!=='Completed').length;
    const completed = DB.tasks.filter(t=>t.status==='Completed').length;
    const overdue = DB.tasks.filter(t=>t.status!=='Completed' && daysDiff(t.deadline)<0).length;
    const recentClients = [...DB.clients].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,6);
    return `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${managerList().length}</div><div class="lbl">Managers</div></div>
      <div class="stat-card"><div class="num">${designerList().length}</div><div class="lbl">Designers</div></div>
      <div class="stat-card"><div class="num">${DB.clients.length}</div><div class="lbl">Clients</div></div>
      <div class="stat-card primary clickable" data-action="gotoalltasks" data-filter="pending"><div class="num">${pending}</div><div class="lbl">Pending tasks</div></div>
      <div class="stat-card success clickable" data-action="gotoalltasks" data-filter="completed"><div class="num">${completed}</div><div class="lbl">Completed tasks</div></div>
      <div class="stat-card danger clickable" data-action="gotoalltasks" data-filter="overdue"><div class="num">${overdue}</div><div class="lbl">Overdue</div></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Recently added clients</h3><span class="breadcrumb-link" data-nav="clients">View all clients →</span></div>
      <div class="panel-body pad0">
        ${recentClients.length ? `<table><thead><tr><th>Client</th><th>Managers</th><th>Designers</th><th>Tasks</th></tr></thead><tbody>
          ${recentClients.map(c=>{
            const mgrNames = namesForIds(c.managerIds); const desNames = namesForIds(c.designerIds);
            return `<tr class="row-hover"><td><b>${escapeHtml(c.name)}</b></td><td>${mgrNames.length?escapeHtml(mgrNames.join(', ')):'<span class="muted">Unassigned</span>'}</td><td>${desNames.length?escapeHtml(desNames.join(', ')):'<span class="muted">Unassigned</span>'}</td><td>${tasksForClient(c.id).length}</td></tr>`;
          }).join('')}
        </tbody></table>` : `<div class="empty-state"><b>No clients yet</b>Create your first client from the Clients tab.</div>`}
      </div>
    </div>`;
  }
  if(session.role==='manager'){
    const myClients = clientsForUser();
    const myTasks = tasksForUser();
    const totalCount = myTasks.length;
    const pending = myTasks.filter(t=>t.status!=='Completed').length;
    const completed = myTasks.filter(t=>t.status==='Completed').length;
    const overdue = myTasks.filter(t=>t.status!=='Completed' && daysDiff(t.deadline)<0).length;

    const filterFns = {
      all: t=>true,
      pending: t=>t.status!=='Completed',
      overdue: t=>t.status!=='Completed' && daysDiff(t.deadline)<0,
      completed: t=>t.status==='Completed',
    };
    const filterLabels = { all:'All tasks', pending:'Pending tasks', overdue:'Overdue tasks', completed:'Completed tasks' };

    let panelTitle, listRows;
    if(ui.dashboardFilter && filterFns[ui.dashboardFilter]){
      panelTitle = filterLabels[ui.dashboardFilter];
      listRows = myTasks.filter(filterFns[ui.dashboardFilter]).sort((a,b)=>(a.deadline||'').localeCompare(b.deadline||''));
    } else {
      panelTitle = 'Upcoming deadlines';
      listRows = myTasks.filter(t=>t.status!=='Completed').sort((a,b)=>(a.deadline||'').localeCompare(b.deadline||'')).slice(0,8);
    }

    return `
    <div class="stat-grid">
      <div class="stat-card"><div class="num">${myClients.length}</div><div class="lbl">My clients</div></div>
      <div class="stat-card clickable ${ui.dashboardFilter==='all'?'active-stat':''}" data-action="dashfilter" data-filter="all"><div class="num">${totalCount}</div><div class="lbl">All tasks</div></div>
      <div class="stat-card primary clickable ${ui.dashboardFilter==='pending'?'active-stat':''}" data-action="dashfilter" data-filter="pending"><div class="num">${pending}</div><div class="lbl">Pending tasks</div></div>
      <div class="stat-card danger clickable ${ui.dashboardFilter==='overdue'?'active-stat':''}" data-action="dashfilter" data-filter="overdue"><div class="num">${overdue}</div><div class="lbl">Overdue tasks</div></div>
      <div class="stat-card success clickable ${ui.dashboardFilter==='completed'?'active-stat':''}" data-action="dashfilter" data-filter="completed"><div class="num">${completed}</div><div class="lbl">Completed tasks</div></div>
    </div>
    <div class="panel">
      <div class="panel-head">
        <h3>${panelTitle}</h3>
        ${ui.dashboardFilter ? `<span class="breadcrumb-link" data-action="cleardashfilter">← Back to upcoming deadlines</span>` : `<span class="breadcrumb-link" data-nav="myclients">Go to my clients →</span>`}
      </div>
      <div class="panel-body pad0">${renderTaskTableRows(listRows, false, false, true)}</div>
    </div>`;
  }
  return '';
}
function renderDesignerPending(){
  const myTasks = tasksForUser().filter(t=>t.status!=='Completed').sort((a,b)=>(a.deadline||'').localeCompare(b.deadline||''));
  const overdue = myTasks.filter(t=>daysDiff(t.deadline)<0).length;
  return `
  <div class="stat-grid">
    <div class="stat-card"><div class="num">${clientsForUser().length}</div><div class="lbl">My clients</div></div>
    <div class="stat-card primary"><div class="num">${myTasks.length}</div><div class="lbl">Pending tasks</div></div>
    <div class="stat-card danger"><div class="num">${overdue}</div><div class="lbl">Overdue</div></div>
  </div>
  <div class="panel">
    <div class="panel-head"><h3>All pending tasks, soonest deadline first</h3></div>
    <div class="panel-body pad0">${renderTaskTableRows(myTasks, true, false, true)}</div>
  </div>`;
}

/* ============================= TASK TABLE (shared) ============================= */
function renderTaskTableRows(tasks, showComplete, allowEdit, showClient){
  if(!tasks.length) return `<div class="empty-state"><b>Nothing here</b>Tasks will show up once they're added.</div>`;
  return `<table><thead><tr>
    ${showClient?'<th>Client</th>':''}
    <th>Date</th><th>Type</th><th>Posting</th><th>Objective</th><th>Caption</th><th>Reference</th><th>Deadline</th><th>Remark</th><th>Status</th>${(showComplete||allowEdit)?'<th></th>':''}
  </tr></thead><tbody>
  ${tasks.map(t=>{
    const c = clientById(t.clientId);
    return `<tr class="row-hover">
      ${showClient?`<td><b>${c?escapeHtml(c.name):'—'}</b></td>`:''}
      <td class="mono">${fmtDate(t.date)}</td>
      <td><span class="type-tag">${escapeHtml(t.contentType||'—')}</span></td>
      <td>${escapeHtml(t.postingType||'—')}</td>
      <td class="cell-wrap">${escapeHtml(t.objective||'—')}</td>
      <td class="cell-wrap">${escapeHtml(t.caption||'—')}</td>
      <td class="cell-wrap">${t.reference?`<span class="muted">${escapeHtml(t.reference)}</span>`:'—'}</td>
      <td>${deadlineTag(t)}</td>
      <td class="cell-wrap">${escapeHtml(t.remark||'—')}</td>
      <td>${statusPill(t)}</td>
      ${showComplete||allowEdit ? `<td style="white-space:nowrap;">
        ${showComplete && t.status!=='Completed' ? `<button class="btn btn-sm btn-accent" data-action="complete" data-id="${t.id}">Mark complete</button>` : ''}
        ${allowEdit ? `<button class="btn btn-sm btn-ghost" data-action="edittask" data-id="${t.id}">Edit</button> <button class="btn btn-sm btn-danger" data-action="deletetask" data-id="${t.id}">Delete</button>` : ''}
      </td>` : ''}
    </tr>`;
  }).join('')}
  </tbody></table>`;
}

/* ============================= ADMIN: USERS ============================= */
function renderUserList(role){
  const list = DB.users.filter(u=>u.role===role);
  const label = role==='manager'?'Manager':'Designer';
  return `
  <div class="panel">
    <div class="panel-head"><h3>${label}s (${list.length})</h3><button class="btn btn-primary btn-sm" data-action="newuser" data-role="${role}">+ Add ${label}</button></div>
    <div class="panel-body pad0">
      ${list.length? `<table><thead><tr><th>Name</th><th>Username</th><th>Clients</th><th>Total tasks</th><th>Pending</th><th>Overdue</th><th>Status</th><th></th></tr></thead><tbody>
        ${list.map(u=>{
          const cnt = DB.clients.filter(c=> role==='manager' ? c.managerIds.includes(u.id) : c.designerIds.includes(u.id)).length;
          const stats = tasksForAssignee(u.id, role);
          const pending = stats.filter(t=>t.status!=='Completed').length;
          const overdue = stats.filter(t=>t.status!=='Completed' && daysDiff(t.deadline)<0).length;
          return `<tr class="row-hover">
            <td><b>${escapeHtml(u.name)}</b></td>
            <td class="mono">${escapeHtml(u.username)}</td>
            <td>${cnt}</td>
            <td>${stats.length}</td>
            <td>${pending}</td>
            <td style="${overdue?'color:var(--danger); font-weight:600;':''}">${overdue}</td>
            <td>${u.active===false? '<span class="pill pill-neutral">Inactive</span>' : '<span class="pill pill-completed">Active</span>'}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-action="resetpw" data-id="${u.id}">Reset password</button>
              <button class="btn btn-sm ${u.active===false?'btn-accent':'btn-danger'}" data-action="toggleactive" data-id="${u.id}">${u.active===false?'Activate':'Deactivate'}</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody></table>` : `<div class="empty-state"><b>No ${label.toLowerCase()}s yet</b>Add one to start assigning clients.</div>`}
    </div>
  </div>`;
}

/* ============================= ADMIN: CLIENTS ============================= */
function renderAdminClients(){
  return `
  <div class="panel">
    <div class="panel-head"><h3>All clients (${DB.clients.length})</h3><button class="btn btn-primary btn-sm" data-action="newclient">+ Add client</button></div>
    <div class="panel-body pad0">
      ${DB.clients.length? `<table><thead><tr><th>Client</th><th>Managers</th><th>Designers</th><th>Tasks</th><th>Pending</th><th></th></tr></thead><tbody>
        ${DB.clients.map(c=>{
          const t = tasksForClient(c.id);
          const pending = t.filter(x=>x.status!=='Completed').length;
          return `<tr class="row-hover">
            <td><b>${escapeHtml(c.name)}</b></td>
            <td>
              <select class="multi-select" multiple size="${Math.min(Math.max(managerList().length,2),4)}" data-client="${c.id}" data-field="managerIds">
                ${managerList().map(m=>`<option value="${m.id}" ${c.managerIds.includes(m.id)?'selected':''}>${escapeHtml(m.name)}</option>`).join('')}
              </select>
            </td>
            <td>
              <select class="multi-select" multiple size="${Math.min(Math.max(designerList().length,2),4)}" data-client="${c.id}" data-field="designerIds">
                ${designerList().map(d=>`<option value="${d.id}" ${c.designerIds.includes(d.id)?'selected':''}>${escapeHtml(d.name)}</option>`).join('')}
              </select>
            </td>
            <td>${t.length}</td>
            <td>${pending}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" data-action="viewclient" data-id="${c.id}">View tasks</button>
              <button class="btn btn-sm btn-danger" data-action="deleteclient" data-id="${c.id}">Delete</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody></table>` : `<div class="empty-state"><b>No clients yet</b>Add a client, then assign managers and designers.</div>`}
    </div>
    <div class="panel-body" style="border-top:1px solid var(--line);"><span class="disclose">Hold Ctrl (Windows) or ⌘ (Mac) while clicking to select or deselect multiple managers/designers for a client.</span></div>
  </div>`;
}
function renderAllTasks(){
  const clientOpts = DB.clients.map(c=>`<option value="${c.id}" ${String(ui.taskClientFilter)===String(c.id)?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  let list = DB.tasks;
  if(ui.taskClientFilter!=='all') list = list.filter(t=>String(t.clientId)===String(ui.taskClientFilter));
  if(ui.taskFilter==='pending') list = list.filter(t=>t.status!=='Completed');
  if(ui.taskFilter==='completed') list = list.filter(t=>t.status==='Completed');
  if(ui.taskFilter==='overdue') list = list.filter(t=>t.status!=='Completed' && daysDiff(t.deadline)<0);
  list = [...list].sort((a,b)=>(a.deadline||'').localeCompare(b.deadline||''));
  return `
  <div class="panel">
    <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
      <h3>All tasks (${list.length})</h3>
      <div class="toolbar">
        <select id="filterClient"><option value="all">All clients</option>${clientOpts}</select>
        <select id="filterStatus">
          <option value="all" ${ui.taskFilter==='all'?'selected':''}>All statuses</option>
          <option value="pending" ${ui.taskFilter==='pending'?'selected':''}>Pending</option>
          <option value="completed" ${ui.taskFilter==='completed'?'selected':''}>Completed</option>
          <option value="overdue" ${ui.taskFilter==='overdue'?'selected':''}>Overdue</option>
        </select>
      </div>
    </div>
    <div class="panel-body pad0">${renderTaskTableRows(list, false, false, true)}</div>
  </div>`;
}

/* ============================= MANAGER / DESIGNER: MY CLIENTS ============================= */
function renderMyClients(){
  const list = clientsForUser();
  if(!list.length) return `<div class="panel"><div class="panel-body"><div class="empty-state"><b>No clients assigned yet</b>Ask your admin to assign a client to you.</div></div></div>`;
  return `<div class="client-grid">
    ${list.map(c=>{
      const t = tasksForClient(c.id);
      const pending = t.filter(x=>x.status!=='Completed').length;
      const overdue = t.filter(x=>x.status!=='Completed' && daysDiff(x.deadline)<0).length;
      const otherNames = session.role==='manager' ? namesForIds(c.designerIds) : namesForIds(c.managerIds);
      const otherLabel = session.role==='manager' ? 'Designers' : 'Managers';
      return `<div class="client-card" data-action="openclient" data-id="${c.id}">
        <h4>${escapeHtml(c.name)}</h4>
        <div class="sub">${otherLabel}: ${otherNames.length? escapeHtml(otherNames.join(', ')) : 'Unassigned'}</div>
        <div class="mini-stats">
          <span><b>${t.length}</b> tasks</span>
          <span><b>${pending}</b> pending</span>
          <span style="${overdue?'color:var(--danger)':''}"><b>${overdue}</b> overdue</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderClientDetail(clientId){
  const c = clientById(clientId);
  if(!c) return `<div class="empty-state"><b>Client not found</b></div>`;
  const tasks = [...tasksForClient(clientId)].sort((a,b)=>(a.deadline||'').localeCompare(b.deadline||''));
  const isManager = session.role==='manager' || session.role==='admin';
  const mgrNames = namesForIds(c.managerIds); const desNames = namesForIds(c.designerIds);
  return `
  <div style="margin-bottom:14px;"><span class="breadcrumb-link" data-nav="myclients">← All clients</span></div>
  <div class="panel">
    <div class="panel-head" style="flex-wrap:wrap; gap:10px;">
      <div>
        <h3>${escapeHtml(c.name)}</h3>
        <div class="path" style="margin-top:4px;">Managers: ${mgrNames.length?escapeHtml(mgrNames.join(', ')):'—'} · Designers: ${desNames.length?escapeHtml(desNames.join(', ')):'—'}</div>
      </div>
      ${isManager ? `<div class="toolbar">
        <a class="btn btn-ghost btn-sm" href="/api/template.xlsx">Download Excel template</a>
        <button class="btn btn-ghost btn-sm" data-action="importexcel" data-id="${c.id}">Import Excel</button>
        <button class="btn btn-primary btn-sm" data-action="newtask" data-id="${c.id}">+ Add task</button>
      </div>` : ''}
    </div>
    <div class="panel-body pad0">${renderTaskTableRows(tasks, session.role==='designer', isManager, false)}</div>
  </div>
  <input type="file" id="excelInput" accept=".xlsx,.xls,.csv" style="display:none" data-client="${c.id}" />
  `;
}

/* ============================= MODALS ============================= */
function renderModal(){
  if(modal.type==='newuser') return modalNewUser();
  if(modal.type==='newclient') return modalNewClient();
  if(modal.type==='resetpw') return modalResetPw();
  if(modal.type==='changepw') return modalChangePw();
  if(modal.type==='newtask') return modalTaskForm();
  if(modal.type==='edittask') return modalTaskForm(true);
  if(modal.type==='importresult') return modalImportResult();
  return '';
}
function modalNewUser(){
  const role = modal.payload.role;
  const label = role==='manager'?'manager':'designer';
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>Add ${label}</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <form id="newUserForm">
      <div class="modal-body">
        ${modal.payload.err?`<div class="error-msg">${escapeHtml(modal.payload.err)}</div>`:''}
        <div class="field"><label>Full name</label><input name="name" required /></div>
        <div class="field"><label>Username</label><input name="username" required /></div>
        <div class="field"><label>Temporary password</label><input name="password" required /></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="closemodal">Cancel</button><button type="submit" class="btn btn-primary">Create login</button></div>
      </form>
    </div>
  </div>`;
}
function modalNewClient(){
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>Add client</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <form id="newClientForm">
      <div class="modal-body">
        ${modal.payload.err?`<div class="error-msg">${escapeHtml(modal.payload.err)}</div>`:''}
        <div class="field"><label>Client name</label><input name="name" required /></div>
        <div class="field"><label>Assign manager(s)</label>
          <select name="managerIds" multiple size="${Math.min(Math.max(managerList().length,2),5)}">${managerList().map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label>Assign designer(s)</label>
          <select name="designerIds" multiple size="${Math.min(Math.max(designerList().length,2),5)}">${designerList().map(d=>`<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('')}</select>
        </div>
        <div class="disclose">Hold Ctrl (Windows) or ⌘ (Mac) to select more than one.</div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="closemodal">Cancel</button><button type="submit" class="btn btn-primary">Create client</button></div>
      </form>
    </div>
  </div>`;
}
function modalResetPw(){
  const u = userById(modal.payload.id);
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>Reset password — ${escapeHtml(u.name)}</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <form id="resetPwForm">
      <div class="modal-body">
        ${modal.payload.err?`<div class="error-msg">${escapeHtml(modal.payload.err)}</div>`:''}
        <div class="field"><label>New password</label><input name="password" required /></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="closemodal">Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>
      </form>
    </div>
  </div>`;
}
function modalChangePw(){
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>Change your password</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <form id="changePwForm">
      <div class="modal-body">
        ${modal.payload.err?`<div class="error-msg">${escapeHtml(modal.payload.err)}</div>`:''}
        <div class="field"><label>Current password</label><input type="password" name="currentPassword" required /></div>
        <div class="field"><label>New password</label><input type="password" name="newPassword" required /></div>
        <div class="field"><label>Confirm new password</label><input type="password" name="confirmPassword" required /></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="closemodal">Cancel</button><button type="submit" class="btn btn-primary">Update password</button></div>
      </form>
    </div>
  </div>`;
}
function modalTaskForm(isEdit){
  const t = isEdit ? DB.tasks.find(x=>x.id===modal.payload.id) : null;
  const v = (f, d)=> t ? (t[f]||'') : (d||'');
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>${isEdit?'Edit task':'Add task'}</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <form id="taskForm">
      <div class="modal-body">
        <div class="grid-2">
          <div class="field"><label>Date</label><input type="date" name="date" value="${v('date', todayISO())}" required /></div>
          <div class="field"><label>Deadline</label><input type="date" name="deadline" value="${v('deadline')}" required /></div>
          <div class="field"><label>Type</label><select name="contentType">${CONTENT_TYPES.map(ct=>`<option ${v('contentType')===ct?'selected':''}>${ct}</option>`).join('')}</select></div>
          <div class="field"><label>Posting type</label><select name="postingType">${POSTING_TYPES.map(pt=>`<option ${v('postingType')===pt?'selected':''}>${pt}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Objective</label><input name="objective" value="${escapeHtml(v('objective'))}" /></div>
        <div class="field"><label>Details</label><textarea name="details" rows="3">${escapeHtml(v('details'))}</textarea></div>
        <div class="field"><label>Caption</label><textarea name="caption" rows="2">${escapeHtml(v('caption'))}</textarea></div>
        <div class="field"><label>Reference</label><input name="reference" value="${escapeHtml(v('reference'))}" placeholder="link or note" /></div>
        <div class="field"><label>Remark</label><input name="remark" value="${escapeHtml(v('remark'))}" /></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="closemodal">Cancel</button><button type="submit" class="btn btn-primary">${isEdit?'Save changes':'Add task'}</button></div>
      </form>
    </div>
  </div>`;
}
function modalImportResult(){
  const {added, skipped, error, skippedRows, detectedHeaders} = modal.payload;
  if(error){
    return `<div class="modal-overlay" data-action="closemodal">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-head"><h3>Import didn't go through</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
        <div class="modal-body">
          <div class="error-msg">${escapeHtml(error)}</div>
          ${detectedHeaders && detectedHeaders.length ? `<p style="font-size:13px; color:var(--ink-soft);">Columns found in your file: ${detectedHeaders.map(h=>`<span class="type-tag" style="margin:2px 4px 2px 0; display:inline-block;">${escapeHtml(h)}</span>`).join('')}</p>
          <p style="font-size:12.5px; color:var(--ink-faint);">Rename your date columns to include the word "Date" and "Deadline", or start from <a href="/api/template.xlsx">the template</a>.</p>` : ''}
        </div>
        <div class="modal-foot"><button class="btn btn-primary" data-action="closemodal">Got it</button></div>
      </div>
    </div>`;
  }
  return `<div class="modal-overlay" data-action="closemodal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-head"><h3>Import complete</h3><button class="modal-close" data-action="closemodal">&times;</button></div>
      <div class="modal-body">
        <p><b>${added}</b> task(s) imported.</p>
        ${skipped?`<p style="font-size:13px; color:var(--ink-soft);">${skipped} row(s) skipped — couldn't read a valid Date or Deadline${skippedRows&&skippedRows.length?` (spreadsheet row${skippedRows.length>1?'s':''} ${skippedRows.slice(0,10).join(', ')}${skippedRows.length>10?'…':''})`:''}. Accepted formats: <span class="mono">22-07-2026</span>, <span class="mono">22/07/2026</span>, <span class="mono">2026-07-22</span>, or <span class="mono">22 Jul 2026</span>.</p>`:''}
        ${(!added && !skipped)?`<p style="font-size:13px; color:var(--ink-soft);">No data rows were found below the header row.</p>`:''}
      </div>
      <div class="modal-foot"><button class="btn btn-primary" data-action="closemodal">Done</button></div>
    </div>
  </div>`;
}

/* ============================= MAIN RENDER ============================= */
function render(){
  const root = document.getElementById('root');
  root.innerHTML = session ? renderApp() : renderLogin();
  bindEvents();
}

/* ============================= EVENTS ============================= */
function bindEvents(){
  const root = document.getElementById('root');

  const loginForm = document.getElementById('loginForm');
  if(loginForm){
    loginForm.addEventListener('submit', async e=>{
      e.preventDefault();
      const fd = new FormData(loginForm);
      ui.loginErr = null; ui.loginBusy = true; render();
      try{
        await apiPost('/api/login', {username: fd.get('username').trim(), password: fd.get('password')});
        await refreshState();
        ui = {tab:'dashboard', clientId:null, navOpen:false, taskFilter:'all', taskClientFilter:'all', dashboardFilter:null};
        render();
      }catch(err){
        ui.loginErr = err.message; ui.loginBusy = false; render();
      }
    });
  }

  root.querySelectorAll('[data-nav]').forEach(el=>{
    el.addEventListener('click', ()=>{ ui.tab = el.getAttribute('data-nav'); ui.clientId=null; ui.navOpen=false; render(); });
  });

  root.querySelectorAll('[data-action="togglenav"]').forEach(el=> el.addEventListener('click', ()=>{ ui.navOpen=!ui.navOpen; render(); }));
  root.querySelectorAll('[data-action="logout"]').forEach(el=> el.addEventListener('click', async ()=>{
    try{ await apiPost('/api/logout'); }catch(e){}
    session=null; DB={users:[],clients:[],tasks:[]}; ui={tab:'dashboard'}; render();
  }));
  root.querySelectorAll('[data-action="closemodal"]').forEach(el=> el.addEventListener('click', ()=>{ modal=null; render(); }));

  root.querySelectorAll('[data-action="newuser"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'newuser', payload:{role:el.getAttribute('data-role')}}; render(); }));
  root.querySelectorAll('[data-action="newclient"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'newclient', payload:{}}; render(); }));
  root.querySelectorAll('[data-action="resetpw"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'resetpw', payload:{id:Number(el.getAttribute('data-id'))}}; render(); }));
  root.querySelectorAll('[data-action="changepw"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'changepw', payload:{}}; render(); }));
  root.querySelectorAll('[data-action="newtask"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'newtask', payload:{clientId:Number(el.getAttribute('data-id'))}}; render(); }));
  root.querySelectorAll('[data-action="edittask"]').forEach(el=> el.addEventListener('click', ()=>{ modal={type:'edittask', payload:{id:Number(el.getAttribute('data-id'))}}; render(); }));

  root.querySelectorAll('[data-action="openclient"]').forEach(el=> el.addEventListener('click', ()=>{ ui.clientId = Number(el.getAttribute('data-id')); render(); }));
  root.querySelectorAll('[data-action="viewclient"]').forEach(el=> el.addEventListener('click', ()=>{ ui.tab='myclients'; ui.clientId = Number(el.getAttribute('data-id')); render(); }));

  root.querySelectorAll('[data-action="dashfilter"]').forEach(el=> el.addEventListener('click', ()=>{
    const f = el.getAttribute('data-filter');
    ui.dashboardFilter = ui.dashboardFilter===f ? null : f;
    render();
  }));
  root.querySelectorAll('[data-action="cleardashfilter"]').forEach(el=> el.addEventListener('click', ()=>{ ui.dashboardFilter=null; render(); }));
  root.querySelectorAll('[data-action="gotoalltasks"]').forEach(el=> el.addEventListener('click', ()=>{
    ui.tab='alltasks'; ui.taskFilter = el.getAttribute('data-filter'); ui.taskClientFilter='all'; render();
  }));

  root.querySelectorAll('[data-action="toggleactive"]').forEach(el=> el.addEventListener('click', async ()=>{
    try{
      const data = await apiPost(`/api/users/${el.getAttribute('data-id')}/toggle-active`);
      await refreshState(); showToast(`${data.user.name} ${data.user.active?'activated':'deactivated'}`); render();
    }catch(err){ showToast(err.message); }
  }));
  root.querySelectorAll('[data-action="deleteclient"]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Delete this client and all its tasks? This cannot be undone.')) return;
    try{ await apiDelete(`/api/clients/${el.getAttribute('data-id')}`); await refreshState(); showToast('Client deleted'); render(); }
    catch(err){ showToast(err.message); }
  }));
  root.querySelectorAll('[data-action="deletetask"]').forEach(el=> el.addEventListener('click', async ()=>{
    if(!confirm('Delete this task?')) return;
    try{ await apiDelete(`/api/tasks/${el.getAttribute('data-id')}`); await refreshState(); showToast('Task deleted'); render(); }
    catch(err){ showToast(err.message); }
  }));
  root.querySelectorAll('[data-action="complete"]').forEach(el=> el.addEventListener('click', async ()=>{
    try{ await apiPatch(`/api/tasks/${el.getAttribute('data-id')}`, {status:'Completed'}); await refreshState(); showToast('Marked as completed'); render(); }
    catch(err){ showToast(err.message); }
  }));

  root.querySelectorAll('select.multi-select').forEach(el=> el.addEventListener('change', async ()=>{
    const field = el.getAttribute('data-field');
    const values = Array.from(el.selectedOptions).map(o=>o.value);
    try{
      await apiPatch(`/api/clients/${el.getAttribute('data-client')}`, {[field]: values});
      await refreshState(); showToast('Assignment updated'); render();
    }catch(err){ showToast(err.message); render(); }
  }));

  const filterClient = document.getElementById('filterClient');
  if(filterClient) filterClient.addEventListener('change', ()=>{ ui.taskClientFilter = filterClient.value; render(); });
  const filterStatus = document.getElementById('filterStatus');
  if(filterStatus) filterStatus.addEventListener('change', ()=>{ ui.taskFilter = filterStatus.value; render(); });

  root.querySelectorAll('[data-action="importexcel"]').forEach(el=> el.addEventListener('click', ()=>{ document.getElementById('excelInput').click(); }));
  const excelInput = document.getElementById('excelInput');
  if(excelInput) excelInput.addEventListener('change', handleExcelImport);

  const newUserForm = document.getElementById('newUserForm');
  if(newUserForm) newUserForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(newUserForm);
    try{
      await apiPost('/api/users', {name: fd.get('name').trim(), username: fd.get('username').trim(), password: fd.get('password'), role: modal.payload.role});
      await refreshState(); modal=null; showToast('Login created'); render();
    }catch(err){ modal.payload.err = err.message; render(); }
  });

  const newClientForm = document.getElementById('newClientForm');
  if(newClientForm) newClientForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const managerIds = Array.from(newClientForm.querySelector('[name="managerIds"]').selectedOptions).map(o=>o.value);
    const designerIds = Array.from(newClientForm.querySelector('[name="designerIds"]').selectedOptions).map(o=>o.value);
    const name = new FormData(newClientForm).get('name').trim();
    try{
      await apiPost('/api/clients', {name, managerIds, designerIds});
      await refreshState(); modal=null; showToast('Client created'); render();
    }catch(err){ modal.payload.err = err.message; render(); }
  });

  const resetPwForm = document.getElementById('resetPwForm');
  if(resetPwForm) resetPwForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(resetPwForm);
    try{
      await apiPost(`/api/users/${modal.payload.id}/reset-password`, {password: fd.get('password')});
      modal=null; showToast('Password updated'); render();
    }catch(err){ modal.payload.err = err.message; render(); }
  });

  const changePwForm = document.getElementById('changePwForm');
  if(changePwForm) changePwForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(changePwForm);
    const newPw = fd.get('newPassword'); const confirmPw = fd.get('confirmPassword');
    if(newPw !== confirmPw){ modal.payload.err = 'New password and confirmation do not match.'; render(); return; }
    try{
      await apiPost('/api/me/change-password', {currentPassword: fd.get('currentPassword'), newPassword: newPw});
      modal=null; showToast('Password updated'); render();
    }catch(err){ modal.payload.err = err.message; render(); }
  });

  const taskForm = document.getElementById('taskForm');
  if(taskForm) taskForm.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(taskForm);
    const fields = ['date','deadline','contentType','postingType','objective','details','caption','reference','remark'];
    const payload = {}; fields.forEach(f=> payload[f]=fd.get(f));
    try{
      if(modal.type==='edittask'){
        await apiPatch(`/api/tasks/${modal.payload.id}`, payload);
      } else {
        await apiPost(`/api/clients/${modal.payload.clientId}/tasks`, payload);
      }
      await refreshState(); modal=null; showToast('Task saved'); render();
    }catch(err){ showToast(err.message); }
  });
}

/* ============================= EXCEL IMPORT ============================= */
async function handleExcelImport(e){
  const file = e.target.files[0];
  const clientId = e.target.getAttribute('data-client');
  if(!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try{
    const res = await fetch(`/api/clients/${clientId}/import`, {method:'POST', body:fd, credentials:'same-origin'});
    const data = await res.json();
    if(!res.ok){ modal = {type:'importresult', payload:{added:0, skipped:0, error: data.error || 'Import failed.'}}; render(); return; }
    if(data.error){ modal = {type:'importresult', payload:data}; render(); return; }
    await refreshState();
    modal = {type:'importresult', payload:data};
    render();
  }catch(err){
    modal = {type:'importresult', payload:{added:0, skipped:0, error:'Could not reach the server — check your connection and try again.'}};
    render();
  }
  e.target.value = '';
}

/* ============================= BOOT ============================= */
(async function boot(){
  try{
    const me = await apiGet('/api/me');
    if(me.user){
      await refreshState();
    }
  }catch(e){ /* not signed in */ }
  render();
})();
