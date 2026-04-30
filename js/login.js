// Inline-script-free login handler so a strict CSP (script-src 'self') can
// be enforced. Loaded by html/index.html.

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    if (!form) {
      console.error('Login form not found');
      return;
    }

    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const errorDiv = document.getElementById('errorMessage');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const email = emailInput.value;
      const password = passwordInput.value;

      if (!email || !password) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Please enter both email and password';
        return;
      }
      errorDiv.style.display = 'none';

      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Signing in...';
      submitBtn.disabled = true;

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await response.json();

        if (response.ok) {
          window.setToken(data.token);
          window.setUser(data.user);
          const dest = (data.user && data.user.role === 'admin')
            ? 'admin.html'
            : 'dashboard.html';
          window.location.href = dest;
        } else {
          errorDiv.style.display = 'block';
          errorDiv.textContent = data.error || 'Login failed';
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }
      } catch (error) {
        console.error('Login error:', error);
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Network error';
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  });
})();
