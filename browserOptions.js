const fs = require('fs');

function browserOptions() {
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const executablePath = process.env.CHROME_EXECUTABLE_PATH || candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath || !fs.existsSync(executablePath)) {
    throw new Error('Chrome tidak ditemukan. Atur CHROME_EXECUTABLE_PATH ke executable Chrome/Chromium.');
  }
  return {
    executablePath,
    headless: true,
    // Sandbox tetap aktif. Perbaiki dukungan sandbox OS jika Chrome gagal berjalan.
    args: ['--font-render-hinting=medium'],
  };
}

module.exports = { browserOptions };
