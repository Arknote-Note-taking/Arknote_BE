const fs = require('fs');
const path = require('path');

const NOTIFS_FILE = path.join(__dirname, '../data/notifications.json');

// Ensure directory and file exist
const initFile = () => {
  const dir = path.dirname(NOTIFS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(NOTIFS_FILE)) {
    fs.writeFileSync(NOTIFS_FILE, JSON.stringify([]));
  }
};

const readLocalNotifications = () => {
  initFile();
  try {
    const data = fs.readFileSync(NOTIFS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('[NotificationStorage] Failed to read local notifications file:', e);
    return [];
  }
};

const writeLocalNotifications = (notifs) => {
  initFile();
  try {
    fs.writeFileSync(NOTIFS_FILE, JSON.stringify(notifs, null, 2));
  } catch (e) {
    console.error('[NotificationStorage] Failed to write local notifications file:', e);
  }
};

const saveLocalNotification = (notif) => {
  const list = readLocalNotifications();
  // Avoid duplicate check
  if (list.some(n => n.id === notif.id)) return notif;
  // Prepend new notification
  const updated = [notif, ...list].slice(0, 100); // Limit to 100 on disk
  writeLocalNotifications(updated);
  return notif;
};

module.exports = {
  readLocalNotifications,
  writeLocalNotifications,
  saveLocalNotification
};
