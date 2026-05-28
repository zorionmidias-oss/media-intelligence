'use strict';

async function apiFetch(path, options) {
  options = options || {};
  const res = await fetch(path, Object.assign({}, options, {
    credentials: 'same-origin',
    headers: Object.assign({ 'Content-Type': 'application/json' }, options.headers || {}),
  }));
  if (res.status === 401) { window.location.href = '/login.html'; return null; }
  const data = await res.json();
  if (!res.ok) throw new Error(data && (data.error || data.erro) || 'HTTP ' + res.status);
  return data;
}

window.apiFetch = apiFetch;
