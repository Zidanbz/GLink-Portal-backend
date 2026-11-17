function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function safeTemplateData(input) {
  function sanitize(value, key = '') {
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name)]));
    if (typeof value !== 'string') return value;
    if (key.includes('tanda_tangan') || key === 'paraf_hrd' || key === 'surat_dokter_base64') {
      return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : '';
    }
    if (key === 'anggaran_items' || key === 'itinerary_items') {
      try { const items = JSON.parse(value); return Array.isArray(items) ? sanitize(items) : []; }
      catch { return []; }
    }
    return escapeHtml(value);
  }
  return sanitize(input);
}
async function securePage(page) {
  await page.setJavaScriptEnabled(false);
  await page.setRequestInterception(true);
  // All logos and signatures are embedded. Block remote resources and local files
  // to prevent a submitted document from reaching cloud metadata/internal URLs.
  page.on('request', request => {
    if (request.url().startsWith('data:') || request.url() === 'about:blank') request.continue();
    else request.abort();
  });
}
module.exports = { safeTemplateData, securePage };
