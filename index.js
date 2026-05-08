import fs from "fs";
import TelegramBot from "node-telegram-bot-api";

// ================== CONFIG ==================
const TOKEN = "YOUR_BOT_TOKEN";
const CHAT_ID = "YOUR_CHAT_ID";

// ================== BOT ==================
const bot = new TelegramBot(TOKEN, { polling: true });

// Track already sent prayers (to avoid spam)
let sentToday = {};

// Load prayer times
function loadPrayers() {
  if (!fs.existsSync("prayer.json")) return null;
  return JSON.parse(fs.readFileSync("prayer.json"));
}

// Reset at midnight
function resetDaily() {
  sentToday = {};
  console.log("Daily reset done");
}

// Get current time HH:MM
function getCurrentTime() {
  const now = new Date();
  return now.toTimeString().slice(0, 5);
}

// Check prayers every 30 seconds
function checkPrayerTimes() {
  const prayers = loadPrayers();
  if (!prayers) return;

  const nowTime = getCurrentTime();

  for (const [name, time] of Object.entries(prayers)) {
    if (time === nowTime && !sentToday[name]) {
      bot.sendMessage(CHAT_ID, `🕌 It's time for ${name} prayer`);
      sentToday[name] = true;
    }
  }
}

// ================== RUN LOOP ==================
setInterval(checkPrayerTimes, 30000);

// Reset at midnight logic
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    resetDaily();
  }
}, 60000);

console.log("Prayer bot is running...");
