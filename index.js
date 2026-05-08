process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

const bot = new TelegramBot(token, { polling: true });

const GROUP_ID = Number(process.env.TELEGRAM_GROUP_ID) || -1003975806017;

// -----------------------------
// 🕐 TIME FORMAT
// -----------------------------
function to12h(time24) {
    const [h, m] = time24.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, "0")} ${period}`;
}

// -----------------------------
// 📊 STATE (PERSISTENT)
// -----------------------------
const defaultResults = {
    Fajr: { Yes: 0, Mosque: 0, Later: 0 },
    Dhuhr: { Yes: 0, Mosque: 0, Later: 0 },
    Asr: { Yes: 0, Mosque: 0, Later: 0 },
    Maghrib: { Yes: 0, Mosque: 0, Later: 0 },
    Isha: { Yes: 0, Mosque: 0, Later: 0 },
};

let pollResults = defaultResults;

if (fs.existsSync("state.json")) {
    try {
        pollResults = JSON.parse(fs.readFileSync("state.json", "utf8"));
        console.log("✅ Loaded saved state");
    } catch (e) {
        console.log("State load error:", e.message);
    }
}

function saveState() {
    fs.writeFileSync("state.json", JSON.stringify(pollResults, null, 2));
}

// -----------------------------
// 🗺️ POLL MAP
// -----------------------------
let pollMap = {};
let prayerJobs = [];

// -----------------------------
// 🕌 GET PRAYERS
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
            try {
                await bot.sendMessage(
                    GROUP_ID,
                    `⏰ ${name} prayer in 10 minutes (${to12h(timeStr)})`
                );
            } catch (e) {
                console.log(e.message);
            }
        },
        { timezone: "Africa/Cairo" }
    );

    const prayJob = cron.schedule(
        `${minute} ${hour} * * *`,
        async () => {
            try {
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
            } catch (e) {
                console.log(e.message);
            }
        },
        { timezone: "Africa/Cairo" }
    );

    prayerJobs.push(remindJob, prayJob);
}

// -----------------------------
// 📊 POLL ANSWERS
// -----------------------------
bot.on("poll_answer", (answer) => {
    try {
        const pollId = answer.poll_id;
        const option = answer.option_ids[0];

        const prayer = pollMap[pollId];
        if (!prayer) return;

        let choice = "";
        if (option === 0) choice = "Yes";
        else if (option === 1) choice = "Mosque";
        else if (option === 2) choice = "Later";
        else return;

        pollResults[prayer][choice]++;
        saveState();

        console.log(`📊 ${prayer}: ${choice}`);
    } catch (e) {
        console.log(e.message);
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
        `🕌 Prayer Times\n\n` +
        `Fajr: ${to12h(t.Fajr)}\n` +
        `Dhuhr: ${to12h(t.Dhuhr)}\n` +
        `Asr: ${to12h(t.Asr)}\n` +
        `Maghrib: ${to12h(t.Maghrib)}\n` +
        `Isha: ${to12h(t.Isha)}`;

    bot.sendMessage(msg.chat.id, text);
});

// -----------------------------
// 📊 DAILY RESET (MIDNIGHT)
// -----------------------------
cron.schedule("0 0 * * *", async () => {
    let text = "📊 Daily Prayer Results\n\n";

    for (let p in pollResults) {
        const r = pollResults[p];
        const total = r.Yes + r.Mosque + r.Later;

        text += `🕌 ${p}\n`;
        text += `✅ Yes: ${r.Yes}\n`;
        text += `🕌 Mosque: ${r.Mosque}\n`;
        text += `⏳ Later: ${r.Later}\n`;
        text += `👥 Total: ${total}\n\n`;
    }

    await bot.sendMessage(GROUP_ID, text);

    // RESET
    pollResults = defaultResults;
    saveState();

    console.log("📊 Reset done");

    await schedulePrayers();
}, { timezone: "Africa/Cairo" });

// -----------------------------
// 🚀 START
// -----------------------------
console.log("🕌 BOT RUNNING...");
schedulePrayers();
