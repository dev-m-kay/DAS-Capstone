const token = localStorage.getItem("token");

const authHeaders = () => ({
  Authorization: `Bearer ${token}`
});

// Submit form 
async function handleSubmission(e) {
  e.preventDefault();

  const formData = new FormData();

  formData.append("title", document.getElementById("title").value);
  formData.append("genre", document.getElementById("genre").value);
  formData.append("word_count", document.getElementById("wordCount").value);
  formData.append("bio", document.getElementById("bio").value);
  formData.append("notes", document.getElementById("notes").value);

  const files = document.getElementById("files").files;

  for (let file of files) {
    formData.append("files", file);
  }

  try {
    const res = await fetch("/api/submissions", {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    alert(`Submitted! ID: ${data.submission.submission_id}`);
    window.location.href = "dashboard.html";

  } catch (err) {
    alert(err.message);
  }
}

async function loadMySubmissions() {
  const res = await fetch("/api/submissions/mine", {
    headers: authHeaders()
  });

  const data = await res.json();

  const tbody = document.getElementById("my-submissions-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  data.forEach(sub => {
    const row = `
      <tr>
        <td>${sub.submission_id}</td>
        <td>${sub.title}</td>
        <td>${sub.genre}</td>
        <td>${sub.status}</td>
        <td>
          <a href="submission-detail.html?id=${sub.id}">View</a>
        </td>
      </tr>
    `;
    tbody.innerHTML += row;
  });
}

async function loadDashboard() {
  const res = await fetch("/api/submissions/mine", {
    headers: authHeaders()
  });

  const data = await res.json();

  const tbody = document.getElementById("dashboard-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  data.slice(0, 5).forEach(sub => {
    tbody.innerHTML += `
      <tr>
        <td>${sub.title}</td>
        <td>${sub.status}</td>
        <td>
          <a href="submission-detail.html?id=${sub.id}">View</a>
        </td>
      </tr>
    `;
  });
}

async function loadSubmissionDetail() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");

  if (!id) return;

  const res = await fetch(`/api/submissions/${id}`, {
    headers: authHeaders()
  });

  const sub = await res.json();

  document.getElementById("title").innerText = sub.title;
  document.getElementById("genre").innerText = sub.genre;
  document.getElementById("status").innerText = sub.status;

  // FILES
  const filesRes = await fetch(`/api/submissions/${id}/files`, {
    headers: authHeaders()
  });

  const files = await filesRes.json();

  const list = document.getElementById("file-list");

  if (list) {
    list.innerHTML = "";

    files.forEach(f => {
      list.innerHTML += `
        <li>
          <a href="/uploads/${f.filename}" download>
            ${f.original_name}
          </a>
        </li>
      `;
    });
  }
}

async function updateStatus(id, status) {
  await fetch(`/api/submissions/${id}/status`, {
    method: "PUT",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  loadMySubmissions();
  loadDashboard();
  loadSubmissionDetail();
});