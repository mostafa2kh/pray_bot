const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

const bot = new TelegramBot(token, { polling: true });

const GROUP_ID = Number(process.env.TELEGRAM_GROUP_ID) || -1003975806017;

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
// 📊 VOTE STORAGE
// -----------------------------
let pollResults = {
    Fajr: { Yes: 0, Mosque: 0, Later: 0 },
    Dhuhr: { Yes: 0, Mosque: 0, Later: 0 },
    Asr: { Yes: 0, Mosque: 0, Later: 0 },
    Maghrib: { Yes: 0, Mosque: 0, Later: 0 },
    Isha: { Yes: 0, Mosque: 0, Later: 0 },
};

let pollMap = {};
let prayerJobs = [];

// -----------------------------
// 🕌 GET PRAYER TIMES
// -----------------------------
async function getPrayers() {
    const res = await axios.get(
        "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5"
    );
    return res.data.data.timings;
}

// -----------------------------
// ⏰ SCHEDULE PRAYERS
// -----------------------------
async function schedulePrayers() {
    prayerJobs.forEach(j => j.stop());
    prayerJobs = [];

    const t = await getPrayers();

    scheduleOne("Fajr", t.Fajr);
    scheduleOne("Dhuhr", t.Dhuhr);
    scheduleOne("Asr", t.Asr);
    scheduleOne("Maghrib", t.Maghrib);
    scheduleOne("Isha", t.Isha);

    console.log("🕌 Prayer schedule updated");
}

// -----------------------------
// 📌 SCHEDULE ONE PRAYER
// -----------------------------
function scheduleOne(name, timeStr) {
    const [hour, minute] = timeStr.split(":").map(Number);

    const remindJob = cron.schedule(
        `${minute} ${hour} * * *`,
        async () => {
            await bot.sendMessage(
                GROUP_ID,
                `⏰ ${name} prayer in 10 minutes (${to12h(timeStr)})`
            );
        },
        { timezone: "Africa/Cairo" }
    );

    const prayJob = cron.schedule(
        `${minute} ${hour} * * *`,
        async () => {
            await bot.sendMessage(
                GROUP_ID,
                `🕌 ${name} prayer time now (${to12h(timeStr)})`
            );

            const pollMsg = await bot.sendPoll(
                GROUP_ID,
                `Did you pray ${name}?`,
                ["Yes ✅", "Mosque 🕌", "Later ⏳"]
            );

            pollMap[pollMsg.poll.id] = name;
        },
        { timezone: "Africa/Cairo" }
    );

    prayerJobs.push(remindJob, prayJob);
}

// -----------------------------
// 📊 POLL ANSWERS
// -----------------------------
bot.on("poll_answer", (answer) => {
    const pollId = answer.poll_id;
    const option = answer.option_ids[0];

    const prayer = pollMap[pollId];
    if (!prayer) return;

    let choice = "";
    if (option === 0) choice = "Yes";
    else if (option === 1) choice = "Mosque";
    else if (option === 2) choice = "Later";

    pollResults[prayer][choice]++;
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

bot.onText(/\/help/, (msg) => {
    if (msg.chat.id !== GROUP_ID) return;

    bot.sendMessage(
        msg.chat.id,
        "🕌 Commands:\n/pray\n/nextprayer\n/results\n/status\n/help"
    );
});

bot.onText(/\/pray/, async (msg) => {
    if (msg.chat.id !== GROUP_ID) return;

    const t = await getPrayers();

    bot.sendMessage(
        msg.chat.id,
        `🕌 Prayer Times\n\nFajr: ${to12h(t.Fajr)}\nDhuhr: ${to12h(t.Dhuhr)}\nAsr: ${to12h(t.Asr)}\nMaghrib: ${to12h(t.Maghrib)}\nIsha: ${to12h(t.Isha)}`
    );
});

// -----------------------------
// 📊 DAILY RESET
// -----------------------------
cron.schedule("0 0 * * *", async () => {
    let text = "📊 Daily Results\n\n";

    for (let p in pollResults) {
        const r = pollResults[p];
        text += `🕌 ${p}\nYes: ${r.Yes}\nMosque: ${r.Mosque}\nLater: ${r.Later}\n\n`;
    }

    await bot.sendMessage(GROUP_ID, text);

    for (let p in pollResults) {
        pollResults[p] = { Yes: 0, Mosque: 0, Later: 0 };
    }

    await schedulePrayers();
}, { timezone: "Africa/Cairo" });

// -----------------------------
// 🚀 START
// -----------------------------
console.log("🕌 BOT RUNNING...");
schedulePrayers();
