// ─── State ───
let currentSectionId = null;
let currentSectionTitle = null;
let currentQuote = null;
let currentVoteType = null;

// ─── Sidebar toggle (pill arrow) ───
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const toggle = document.getElementById('sidebar-toggle');
  const paper = document.getElementById('paper-container');
  const collapsed = sidebar.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed', collapsed);
  toggle.innerHTML = collapsed ? '&#9654;' : '&#9664;';
  paper.classList.toggle('sidebar-open', !collapsed);
}

// ─── TOC scroll ───
function scrollToSection(id) {
  const el = document.getElementById('section-' + id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.boxShadow = '0 0 0 3px #f57c00';
    setTimeout(() => el.style.boxShadow = '', 1500);
  }
}

// ─── Thread modal ───
function openThread(sectionId, title, quote) {
  currentSectionId = sectionId;
  currentSectionTitle = title;
  currentQuote = quote || null;
  currentVoteType = null;

  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-comment-text').value = '';
  document.getElementById('vote-form').style.display = 'none';

  const quoteEl = document.getElementById('modal-quote');
  if (quote) {
    quoteEl.textContent = '"' + quote + '"';
    quoteEl.style.display = 'block';
  } else {
    quoteEl.style.display = 'none';
  }

  // Load thread content
  fetch('/thread/' + sectionId)
    .then(r => r.text())
    .then(html => {
      document.getElementById('modal-body').innerHTML = html;
      // Update status badge
      const block = document.querySelector('[data-section-id="' + sectionId + '"]');
      const badge = block ? block.querySelector('.badge') : null;
      const modalBadge = document.getElementById('modal-status-badge');
      if (badge && modalBadge) {
        modalBadge.textContent = badge.textContent;
        modalBadge.className = badge.className;
      }
    });

  document.getElementById('modal').style.display = 'block';
  document.getElementById('modal-overlay').style.display = 'block';
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('modal-overlay').style.display = 'none';
  document.getElementById('float-btn').style.display = 'none';
  currentSectionId = null;
  currentVoteType = null;
}

// ─── Comments ───
function submitComment() {
  const text = document.getElementById('modal-comment-text').value.trim();
  if (!text) return;

  fetch('/thread/' + currentSectionId + '/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'body_md=' + encodeURIComponent(text)
  }).then(() => {
    document.getElementById('modal-comment-text').value = '';
    openThread(currentSectionId, currentSectionTitle, currentQuote);
  });
}

// ─── Voting ───
function showVoteForm(type) {
  currentVoteType = type;
  const form = document.getElementById('vote-form');
  form.style.display = 'block';
  document.getElementById('vote-reason').value = '';
  document.getElementById('vote-reason').placeholder =
    type === 'accept' ? 'Why are you accepting this section?' : 'Why are you rejecting this section?';
  document.getElementById('vote-reason').focus();

  // Replace buttons with submit
  const btns = document.querySelector('.compose-btns');
  const submitBtn = document.getElementById('vote-submit-btn');
  if (!submitBtn) {
    const btn = document.createElement('button');
    btn.id = 'vote-submit-btn';
    btn.className = type === 'accept' ? 'btn-accept' : 'btn-reject';
    btn.textContent = type === 'accept' ? 'Confirm Accept' : 'Confirm Reject';
    btn.onclick = submitVote;
    btns.insertBefore(btn, btns.firstChild);
  } else {
    submitBtn.className = type === 'accept' ? 'btn-accept' : 'btn-reject';
    submitBtn.textContent = type === 'accept' ? 'Confirm Accept' : 'Confirm Reject';
    submitBtn.style.display = '';
  }
}

function submitVote() {
  const reason = document.getElementById('vote-reason').value.trim();
  if (!reason) {
    document.getElementById('vote-reason').style.borderColor = '#c62828';
    return;
  }

  fetch('/vote/' + currentSectionId, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'vote=' + encodeURIComponent(currentVoteType) + '&reason=' + encodeURIComponent(reason)
  }).then(() => {
    document.getElementById('vote-form').style.display = 'none';
    const submitBtn = document.getElementById('vote-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
    htmx.trigger(document.body, 'sectionUpdated');
    openThread(currentSectionId, currentSectionTitle, currentQuote);
  });
}

// ─── Inline editing ───
function startEdit(sectionId) {
  const body = document.querySelector('#section-' + sectionId + ' .section-body');
  const editor = document.getElementById('editor-' + sectionId);
  if (!body || !editor) return;
  body.style.display = 'none';
  editor.style.display = 'block';
  const textarea = document.getElementById('editor-textarea-' + sectionId);
  if (textarea) textarea.focus();
}

function cancelEdit(sectionId) {
  const body = document.querySelector('#section-' + sectionId + ' .section-body');
  const editor = document.getElementById('editor-' + sectionId);
  if (body) body.style.display = '';
  if (editor) editor.style.display = 'none';
}

function saveEdit(sectionId) {
  const textarea = document.getElementById('editor-textarea-' + sectionId);
  if (!textarea) return;
  const heading = document.querySelector('#section-' + sectionId + ' .section-heading');
  const titleSpans = heading ? heading.childNodes : [];
  let title = '';
  for (const n of titleSpans) {
    if (n.nodeType === 3 && n.textContent.trim()) {
      title = n.textContent.trim();
      break;
    }
  }
  // Fallback: get from the heading text
  if (!title && heading) {
    title = heading.textContent.replace(/\d+\.\s*/, '').replace(/DRAFT|UNDER_REVIEW|APPROVED.*/i, '').trim();
  }

  fetch('/plan/section/' + sectionId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'title=' + encodeURIComponent(title) + '&body_md=' + encodeURIComponent(textarea.value)
  }).then(r => r.text()).then(html => {
    const block = document.getElementById('section-' + sectionId);
    if (block) {
      block.outerHTML = html;
      htmx.process(document.getElementById('section-' + sectionId));
    }
  });
}

function insertMd(sectionId, before, after) {
  const textarea = document.getElementById('editor-textarea-' + sectionId);
  if (!textarea) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);
  textarea.value = text.substring(0, start) + before + selected + after + text.substring(end);
  textarea.focus();
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selected.length;
}

function editFromModal() {
  closeModal();
  if (currentSectionId) startEdit(currentSectionId);
}

// ─── Text selection → floating comment button ───
document.addEventListener('mouseup', (e) => {
  const paper = document.getElementById('paper');
  if (!paper) return;
  if (!paper.contains(e.target)) return;

  const selection = window.getSelection();
  const text = selection.toString().trim();
  const floatBtn = document.getElementById('float-btn');
  if (!floatBtn) return;

  if (text.length > 5) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    floatBtn.style.display = 'block';
    floatBtn.style.top = (rect.top + window.scrollY - 40) + 'px';
    floatBtn.style.left = (rect.left + rect.width / 2 - 50) + 'px';
    floatBtn._selectedText = text;

    let el = range.startContainer;
    while (el && !el.dataset?.sectionId) el = el.parentElement;
    floatBtn._sectionId = el?.dataset?.sectionId;
    const heading = el?.querySelector('.section-heading');
    floatBtn._sectionTitle = heading ? heading.textContent.replace(/\d+\.\s*/, '').replace(/DRAFT|UNDER.*/i, '').split('\n')[0].trim() : 'Section';
  } else {
    floatBtn.style.display = 'none';
  }
});

function commentOnSelection() {
  const floatBtn = document.getElementById('float-btn');
  if (!floatBtn) return;
  openThread(floatBtn._sectionId, floatBtn._sectionTitle, floatBtn._selectedText);
  floatBtn.style.display = 'none';
}

document.addEventListener('mousedown', (e) => {
  const floatBtn = document.getElementById('float-btn');
  if (floatBtn && e.target !== floatBtn) {
    setTimeout(() => {
      const sel = window.getSelection().toString().trim();
      if (sel.length <= 5) floatBtn.style.display = 'none';
    }, 200);
  }
});

// ─── Deep link scroll on load ───
document.addEventListener('DOMContentLoaded', () => {
  const hash = window.location.hash;
  if (hash && hash.startsWith('#section-')) {
    const el = document.getElementById(hash.substring(1));
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.style.boxShadow = '0 0 0 3px #f57c00';
        setTimeout(() => el.style.boxShadow = '', 1500);
      }, 300);
    }
  }
});

// ─── Escape to close modal ───
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});
