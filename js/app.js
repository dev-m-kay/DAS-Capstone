/* ============================================
   KCR Submission Manager — Shared JavaScript
   ============================================ */


function getToken() {
  return localStorage.getItem('authToken');
}

function setToken(token) {
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

function getUser(){
  const userStr = localStorage.getItem('user');
  if(userStr) {
    try{
      return JSON.parse(userStr);
    } catch (e) {
      return null;
    }
  }
  return null;
}

function setUser (user){
  if (user){
    localStorage.setItem('user', JSON.stringify(user));
  } else{
    localStorage.removeItem('user');
  }
}


function signOut(){
  console.log('Signing out...');
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

async function apiFetch(url, options = {}){
  const token = getToken();
  const headers = {
    'Content-Type' : 'application/json',
    ...options.headers
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const config = {
    ...options,
    headers
  };

  try{
    const response = await fetch(url, config);

    if (response.status === 401) {
      const path = window.location.pathname;
      if (!path.endsWith('/index.html') && !path.endsWith('/register.html')) {
        signOut();
      }
      throw new Error('Unauthorized');
    }
    return response;
  } catch (error) {
    console.error('API fetch error:', error);
    throw error;
  }
}

async function requireAuth(){
  const token = getToken();

  const publicPages = ['/index.html', '/register.html', '/', '/index', '/register'];
  const currentPage = window.location.pathname;

  console.log('requireAuth - Current page:', currentPage);
  console.log('requireAuth - Has token:', !!token);

  if (publicPages.includes(currentPage)){
    console.log('Public page, no auth required');
    return null;
  }

  if(!token){
    console.log('No token found, redirecting to login');
    window.location.href = '/index.html'
    return null;
  }

  try{
    console.log('Verifying token with server...');
    const response = await fetch('/api/auth/me',{
      method: 'GET',
      headers:{
        'Authorization': `Bearer ${token}`
      }
    });
    if (response.ok){
      const userData = await response.json();
      console.log('Token valid, user:', userData);
      setUser(userData);
      return userData;
    } else{
      console.log('Token invalid, redirecting to login');
      setToken(null);
      setUser(null);
      window.location.href = '/index.html';
      return null;
    }

  } catch (error){
    console.error('Auth verification failed:' ,error);
    window.location.href = '/index.html';
    return null;
  }
}

function displayUserName(user){
  if (!user) return;

  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  const displayName = fullName || user.email || 'user';

  const userNameElements = document.querySelectorAll('.user-name');
  userNameElements.forEach(el =>{
    el.textContent = displayName;
  });

  const sidebarName = document.querySelector('.sidebar-footer .name');
  if(sidebarName){
    sidebarName.textContent = displayName;
  }

  const userAvatar = document.querySelector('.avatar');
  if (userAvatar && user.first_name){
    userAvatar.textContent = user.first_name.charAt(0).toUpperCase();
  }
}

function displayUserRole(user){
  if (!user || !user.role) return;

  const roleDisplay = user.role.charAt(0).toUpperCase() + user.role.slice(1);

  const userRoleElements = document.querySelectorAll('.user-role');
  userRoleElements.forEach(el => {
    el.textContent = roleDisplay;
  });

  const sidebarRole = document.querySelector('.sidebar-footer .role');
  if(sidebarRole){
    sidebarRole.textContent = roleDisplay;
  }
}

function renderNavigationByRole(role, containerId = 'sidebarNav'){
  const navContainer = document.getElementById(containerId);
  if(!navContainer) return;

  let navSections = [];

  const mainSection = {
    section: "Main",
    links:[
      {href: "dashboard.html", text: "Dashboard"},
      {href: "submissions.html", text: "My Submissions"},
      {href: "submit.html", text: "New Submission"}
    ]
  };
  navSections.push(mainSection);
      
  // Review section - ONLY for reviewers, editors, and admins
  const reviewSection = {
    section: "Review",
      links: [
        { href: "review-queue.html", text: "Review Queue" },
        { href: "messages.html", text: "Messages" }
    ]
  };
    
    // Admin section - ONLY for admins
  const adminSection = {
    section: "Administration",
    links: [
      { href: "admin.html", text: "Admin Panel" }
    ]
  };
    
    // Conditionally add sections based on role
  if (role === 'reviewer' || role === 'editor' || role === 'admin') {
    navSections.push(reviewSection);
  }
    
  if (role === 'admin') {
    navSections.push(adminSection);
  }

  const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';
  
  let html = '';
    for (const section of navSections) {
      html += `<div class="nav-section">${section.section}</div>`;
      for (const link of section.links) {
        const activeClass = link.href === currentPage ? 'active' : '';
        html += `<a href="${link.href}" class="${activeClass}">${link.text}</a>`;
      }
    }
    
    navContainer.innerHTML = html;


}

function populateSidebar(user){
  if (!user) return;

  displayUserName(user);
  displayUserRole(user);

  renderNavigationByRole(user.role, 'sidebarNav');
}

//Make functions global
window.signOut = signOut;
window.getToken = getToken;
window.setToken = setToken;
window.getUser = getUser;
window.setUser = setUser;
window.apiFetch = apiFetch;
window.requireAuth = requireAuth;
window.renderNavigationByRole = renderNavigationByRole;
window.populateSidebar = populateSidebar;
window.displayUserName = displayUserName;
window.displayUserRole = displayUserRole;

document.addEventListener('DOMContentLoaded', async () => {

  console.log('DOMContentLoaded - Initializing app...');

  const user = await requireAuth();
  if(user){
    populateSidebar(user);
  }

  // --- Mobile sidebar toggle (CSP-friendly: no inline onclick) ---
  const sidebar = document.getElementById('sidebar');
  document.querySelectorAll('.hamburger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (sidebar) sidebar.classList.toggle('open');
    });
  });
  if (sidebar) {
    document.addEventListener('click', (e) => {
      const hamburger = e.target.closest('.hamburger');
      if (
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !hamburger
      ) {
        sidebar.classList.remove('open');
      }
    });
  }

  // --- Generic Sign Out wiring (any element with [data-action="signout"]) ---
  document.querySelectorAll('[data-action="signout"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      signOut();
    });
  });

  // --- Generic modal-close wiring (any element with [data-action="close-modal"]) ---
  document.querySelectorAll('[data-action="close-modal"]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const overlay = el.closest('.modal-overlay');
      if (overlay) overlay.classList.remove('show');
    });
  });

  // --- Active nav highlighting ---
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.sidebar-nav a').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPage) {
      link.classList.add('active');
    } else if (link.classList.contains('active') && href !== currentPage) {
      link.classList.remove('active');
    }
  });

  // --- Search filter (client-side demo) ---
  document.querySelectorAll('.search-input input').forEach(input => {
    input.addEventListener('input', () => {
      const query = input.value.toLowerCase();
      const table = input.closest('.page-content')?.querySelector('tbody');
      if (!table) return;
      table.querySelectorAll('tr').forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
      });
    });
  });

  // --- Filter selects (demo: show alert with selection) ---
  document.querySelectorAll('.filter-select').forEach(select => {
    select.addEventListener('change', () => {
      // In a real app this would filter the data
      console.log('Filter changed:', select.value);
    });
  });

  // --- "Select all" checkbox in admin tables ---
  document.querySelectorAll('thead input[type="checkbox"]').forEach(selectAll => {
    selectAll.addEventListener('change', () => {
      const tbody = selectAll.closest('table').querySelector('tbody');
      tbody.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = selectAll.checked;
      });
    });
  });

  // --- Close modals on overlay click ---
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('show');
      }
    });
  });

  // --- Close modals on Escape key ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.show').forEach(m => m.classList.remove('show'));
    }
  });

  // --- Notification bell click (demo) ---
  const bell = document.querySelector('.notification-bell .btn-icon');
  if (bell) {
    bell.addEventListener('click', () => {
      alert('Notifications panel would open here.');
    });
  }
  console.log('App initialization complete');
});
