// Inline-script-free register handler so a strict CSP (script-src 'self')
// can be enforced. Loaded by html/register.html.

(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerForm');
    if (!form) {
      console.error('Register form not found');
      return;
    }

    const firstNameInput = document.getElementById('firstName');
    const lastNameInput = document.getElementById('lastName');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const bioInput = document.getElementById('bio');
    const termsCheckbox = document.getElementById('terms');
    const errorDiv = document.getElementById('errorMessage');
    const submitBtn = document.getElementById('submitBtn');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const firstName = firstNameInput.value.trim();
      const lastName = lastNameInput.value.trim();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      const confirmPassword = confirmPasswordInput.value;
      const bio = bioInput ? bioInput.value : '';

      if (!firstName || !lastName || !email || !password) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Please fill in all required fields';
        return;
      }
      if (password !== confirmPassword) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Passwords do not match';
        return;
      }
      if (password.length < 8) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Password must be at least 8 characters';
        return;
      }
      if (!termsCheckbox.checked) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'You must agree to the Terms of Service';
        return;
      }
      errorDiv.style.display = 'none';

      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Creating account...';
      submitBtn.disabled = true;

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            email,
            password,
            bio,
          }),
        });
        const data = await response.json();

        if (response.ok) {
          window.setToken(data.token);
          window.setUser(data.user);
          window.location.href = 'dashboard.html';
        } else {
          errorDiv.style.display = 'block';
          errorDiv.textContent = data.error || 'Registration failed';
          submitBtn.textContent = originalText;
          submitBtn.disabled = false;
        }
      } catch (error) {
        console.error('Register error:', error);
        errorDiv.style.display = 'block';
        errorDiv.textContent = 'Network error';
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    });
  });
})();
