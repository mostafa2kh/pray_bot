const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

const bot = new TelegramBot(token, { polling: true });

const GROUP_ID = Number(process.env.TELEGRAM_GROUP_ID) || -1003975806017;

const POLLS_FILE = "polls.json";

// -----------------------------
// 🕐 AM/PM HELPER
// -----------------------------
function to12h(time24) {
  const [h, m] = time24.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

// -----------------------------
// 📊 LOAD RESULTS
// -----------------------------
function loadPollResults() {
  try {
    if (fs.existsSync(POLLS_FILE)) {
      return JSON.parse(fs.readFileSync(POLLS_FILE, "utf8"));
    }
  } catch (err) {
    console.log("Error reading polls.json:", err.message);
  }

  return {
    Fajr: { Yes: 0, Mosque: 0, Later: 0 },
    Dhuhr: { Yes: 0, Mosque: 0, Later: 0 },
    Asr: { Yes: 0, Mosque: 0, Later: 0 },
    Maghrib: { Yes: 0, Mosque: 0, Later: 0 },
    Isha: { Yes: 0, Mosque: 0, Later: 0 },
  };
}

let pollResults = loadPollResults();
let pollMap = {};
let prayerJobs = [];

// -----------------------------
function savePollResults() {
  try {
    fs.writeFileSync(POLLS_FILE, JSON.stringify(pollResults, null, 2));
  } catch (err) {
    console.log("Error saving polls.json:", err.message);
  }
}

function resetPollResults() {
  for (let p in pollResults) {
    pollResults[p] = { Yes: 0, Mosque: 0, Later: 0 };
  }
  savePollResults();
}

// -----------------------------
// 🕌 PRAYER API
// -----------------------------
async function getPrayers() {
  const res = await axios.get(
    "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5"
  );
  return res.data.data.timings;
}

// -----------------------------
// ⏰ SCHEDULE ALL PRAYERS
// -----------------------------
async function schedulePrayers() {
  try {
    prayerJobs.forEach(j => j.stop());
    prayerJobs = [];

    const t = await getPrayers();

    scheduleOne("Fajr", t.Fajr);
    scheduleOne("Dhuhr", t.Dhuhr);
    scheduleOne("Asr", t.Asr);
    scheduleOne("Maghrib", t.Maghrib);
    scheduleOne("Isha", t.Isha);

    console.log("🕌 Prayer schedule updated");
  } catch (err) {
    console.log("Schedule error:", err.message);
  }
}

// -----------------------------
// 🧠 FIXED SCHEDULER
// -----------------------------
function scheduleOne(name, timeStr) {
  const [hour, minute] = timeStr.split(":").map(Number);

  const totalMin = hour * 60 + minute - 10;
  const remindMin = ((totalMin % 1440) + 1440) % 1440;
  const remindHour = Math.floor(remindMin / 60);
  const remindMinute = remindMin % 60;

  // reminder job
  const remindJob = cron.schedule(
    `${remindMinute} ${remindHour} * * *`,
    async () => {
      try {
        await bot.sendMessage(
          GROUP_ID,
          `⏰ ${name} prayer in 10 minutes (${to12h(timeStr)})`
        );
      } catch (err) {
        console.log(err.message);
      }
    },
    { timezone: "Africa/Cairo" }
  );

  // prayer job
  const prayJob = cron.schedule(
    `${minute} ${hour} * * *`,
    async () => {
      try {
        await bot.sendMessage(
          GROUP_ID,
          `🕌 ${name} prayer time is now (${to12h(timeStr)})`
        );

        const pollMsg = await bot.sendPoll(
          GROUP_ID,
          `Did you pray ${name}?`,
          ["Yes ✅", "At Mosque 🕌", "Later ⏳"],
          { is_anonymous: false }
        );

        pollMap[pollMsg.poll.id] = name;
      } catch (err) {
        console.log(err.message);
      }
    },
    { timezone: "Africa/Cairo" }
  );

  prayerJobs.push(remindJob, prayJob);

  // ✅ FIXED LOG (no template nesting bug)
  const remindTime = `${String(remindHour).padStart(2, "0")}:${String(
    remindMinute
  ).padStart(2, "0")}`;

  console.log(
    `Scheduled ${name} at ${to12h(timeStr)} (reminder at ${to12h(remindTime)})`
  );
}

// -----------------------------
// 📊 POLL TRACKING
// -----------------------------
bot.on("poll_answer", (answer) => {
  const pollId = answer.poll_id;
  const option = answer.option_ids[0];

  const prayer = pollMap[pollId];
  if (!prayer) return;

  let choice = "";
  if (option === 0) choice = "Yes";
  if (option === 1) choice = "Mosque";
  if (option === 2) choice = "Later";

  if (choice && pollResults[prayer]) {
    pollResults[prayer][choice]++;
    savePollResults();
  }
});

// -----------------------------
// 🤖 COMMANDS
// -----------------------------
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id !== GROUP_ID) return;
  bot.sendMessage(msg.chat.id, "🕌 Prayer bot is ACTIVE");
});

bot.onText(/\/status/, (msg) => {
  if (msg.chat.id !== GROUP_ID) return;
  bot.sendMessage(msg.chat.id, "🕌 Bot is running");
});

bot.onText(/\/pray/, async (msg) => {
  if (msg.chat.id !== GROUP_ID) return;

  const t = await getPrayers();

  const text =
    `🕌 Prayer Times (Cairo)\n\n` +
    `🌅 Fajr: ${to12h(t.Fajr)}\n` +
    `☀️ Dhuhr: ${to12h(t.Dhuhr)}\n` +
    `🌤 Asr: ${to12h(t.Asr)}\n` +
    `🌇 Maghrib: ${to12h(t.Maghrib)}\n` +
    `🌙 Isha: ${to12h(t.Isha)}`;

  bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/results/, (msg) => {
  if (msg.chat.id !== GROUP_ID) return;

  let text = "📊 Today's Results\n\n";

  for (let prayer in pollResults) {
    const r = pollResults[prayer];
    const total = r.Yes + r.Mosque + r.Later;

    text += `🕌 ${prayer}\n`;
    text += `✅ Yes: ${r.Yes}\n`;
    text += `🕌 Mosque: ${r.Mosque}\n`;
    text += `⏳ Later: ${r.Later}\n`;
    text += `👥 Total: ${total}\n\n`;
  }

  bot.sendMessage(msg.chat.id, text);
});

// -----------------------------
// 📊 MIDNIGHT RESET + REPORT
// -----------------------------
cron.schedule(
  "0 0 * * *",
  async () => {
    let text = "📊 Daily Prayer Results\n\n";

    for (let prayer in pollResults) {
      const r = pollResults[prayer];
      const total = r.Yes + r.Mosque + r.Later;

      text += `🕌 ${prayer}\n`;
      text += `✅ Yes: ${r.Yes}\n`;
      text += `🕌 Mosque: ${r.Mosque}\n`;
      text += `⏳ Later: ${r.Later}\n`;
      text += `👥 Total: ${total}\n\n`;
    }

    await bot.sendMessage(GROUP_ID, text);

    resetPollResults();
    await schedulePrayers();

    console.log("📊 Daily report sent");
  },
  { timezone: "Africa/Cairo" }
);

// -----------------------------
// 🚀 START
// -----------------------------
console.log("🕌 BOT RUNNING...");
schedulePrayers();
