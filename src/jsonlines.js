// Newline-delimited JSON over a socket (used between the app and the elevated admin helper).
function send(socket, msg) {
  if (socket && !socket.destroyed && socket.writable) socket.write(JSON.stringify(msg) + '\n');
}

// Calls onMessage for every complete JSON line. A line that is not valid JSON is ignored.
// A buffer that grows past maxBytes without a newline closes the socket.
function lineReader(socket, onMessage, maxBytes = 8 * 1024 * 1024) {
  let buf = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      onMessage(msg);
    }
    if (buf.length > maxBytes) socket.destroy();
  });
}

module.exports = { send, lineReader };
