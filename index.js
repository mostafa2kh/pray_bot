const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cron = require("node-cron");

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");

const bot = new TelegramBot(token);

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
let prayerJobs = []; // track jobs so we can stop them on daily refresh

// -----------------------------
// 🕌 GET PRAYER TIMES
// -----------------------------
async function getPrayers() {
    const res = await axios.get(
        "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5",
    );
    return res.data.data.timings;
}

// -----------------------------
// ⏰ SCHEDULE PRAYERS
// -----------------------------
async function schedulePrayers() {
    try {
        // Stop old jobs before scheduling new ones
        prayerJobs.forEach(j => j.stop());
        prayerJobs = [];

        const t = await getPrayers();

        scheduleOne("Fajr", t.Fajr);
        scheduleOne("Dhuhr", t.Dhuhr);
        scheduleOne("Asr", t.Asr);
        scheduleOne("Maghrib", t.Maghrib);
        scheduleOne("Isha", t.Isha);

        console.log("🕌 Prayer schedule updated for today");
    } catch (err) {
        console.log("Schedule error:", err.message);
    }
}

// -----------------------------
// 🧠 SCHEDULE ONE PRAYER
// -----------------------------
function scheduleOne(name, timeStr) {
    const [hour, minute] = timeStr.split(":").map(Number);

    // 10-minute early reminder
    const totalMin = hour * 60 + minute - 10;
    const remindHour = Math.floor(((totalMin % 1440) + 1440) % 1440 / 60);
    const remindMin = ((totalMin % 1440) + 1440) % 1440 % 60;

    const remindJob = cron.schedule(`${remindMin} ${remindHour} * * *`, async () => {
        try {
            await bot.sendMessage(GROUP_ID, `⏰ ${name} prayer in 10 minutes (${to12h(timeStr)})`);
        } catch (err) {
            console.log(err.message);
        }
    }, { timezone: "Africa/Cairo" });

    // At prayer time — send notification + Yes/No poll
    const prayJob = cron.schedule(`${minute} ${hour} * * *`, async () => {
        try {
            await bot.sendMessage(GROUP_ID, `🕌 ${name} prayer time is now (${to12h(timeStr)})`);

            const pollMsg = await bot.sendPoll(
                GROUP_ID,
                `Did you pray ${name}?`,
                ["Yes ✅", "No ❌"],
            );

            pollMap[pollMsg.poll.id] = name;
        } catch (err) {
            console.log(err.message);
        }
    }, { timezone: "Africa/Cairo" });

    prayerJobs.push(remindJob, prayJob);

    console.log(`Scheduled ${name} at ${to12h(timeStr)} (reminder at ${to12h(`${String(remindHour).padStart(2,"0")}:${String(remindMin).padStart(2,"0")}`)})`);
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

    const text =
        `🕌 Prayer Bot — Commands\n\n` +
        `/pray — Show all of today's prayer times\n` +
        `/nextprayer — Show the next upcoming prayer\n` +
        `/results — Show today's vote counts\n` +
        `/status — Check the bot is running\n` +
        `/help — Show this help message\n\n` +
        `The bot automatically sends a message and poll at each prayer time every day 🕌`;

    bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/pray/, async (msg) => {
    if (msg.chat.id !== GROUP_ID) return;

    try {
        const t = await getPrayers();

        const text =
            `🕌 Prayer Times (Cairo)\n\n` +
            `🌅 Fajr:    ${to12h(t.Fajr)}\n` +
            `☀️ Dhuhr:   ${to12h(t.Dhuhr)}\n` +
            `🌤 Asr:     ${to12h(t.Asr)}\n` +
            `🌇 Maghrib: ${to12h(t.Maghrib)}\n` +
            `🌙 Isha:    ${to12h(t.Isha)}`;

        bot.sendMessage(msg.chat.id, text);
    } catch (err) {
        bot.sendMessage(msg.chat.id, "❌ Error getting prayer times");
    }
});

bot.onText(/\/nextprayer/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const res = await axios.get(
            "https://api.aladhan.com/v1/timingsByCity?city=Cairo&country=Egypt&method=5",
        );

        const t = res.data.data.timings;

        const cairoTime = new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" });
        const cairoDate = new Date(cairoTime);
        const nowMin = cairoDate.getHours() * 60 + cairoDate.getMinutes();

        const prayers = [
            { name: "Fajr", time: t.Fajr },
            { name: "Dhuhr", time: t.Dhuhr },
            { name: "Asr", time: t.Asr },
            { name: "Maghrib", time: t.Maghrib },
            { name: "Isha", time: t.Isha },
        ];

        const prayerMinutes = prayers.map((p) => {
            const [h, m] = p.time.split(":").map(Number);
            return { ...p, min: h * 60 + m };
        });

        let next = prayerMinutes.find((p) => p.min > nowMin);
        if (!next) next = prayerMinutes[0];

        await bot.sendMessage(
            chatId,
            `🕌 Next Prayer:\n\n➡️ ${next.name}\n🕒 ${to12h(next.time)}`,
        );
    } catch (err) {
        console.log(err.message);
        bot.sendMessage(chatId, "❌ Error getting prayer time");
    }
});

bot.onText(/\/results/, (msg) => {
    if (msg.chat.id !== GROUP_ID) return;

    let text = "📊 Today's Prayer Results\n\n";

    for (let prayer in pollResults) {
        const r = pollResults[prayer];
        const total = r.Yes + r.Mosque + r.Later;

        text += `🕌 ${prayer}\n`;
        text += `✅ Yes: ${r.Yes}\n`;
        text += `🏠 Mosque: ${r.Mosque}\n`;
        text += `⏳ Later: ${r.Later}\n`;
        text += `👥 Total: ${total}\n\n`;
    }

    bot.sendMessage(msg.chat.id, text);
});

// -----------------------------
// 📊 DAILY REPORT + RESET (Cairo midnight)
// -----------------------------
cron.schedule("0 0 * * *", async () => {
    let text = "📊 Daily Prayer Results\n\n";

    for (let prayer in pollResults) {
        const r = pollResults[prayer];
        const total = r.Yes + r.Mosque + r.Later;

        text += `🕌 ${prayer}\n✅ Yes: ${r.Yes}\n🏠 Mosque: ${r.Mosque}\n⏳ Later: ${r.Later}\n👥 Total: ${total}\n\n`;
    }

    await bot.sendMessage(GROUP_ID, text);

    for (let p in pollResults) {
        pollResults[p] = { Yes: 0, Mosque: 0, Later: 0 };
    }

    console.log("📊 Daily report sent & votes reset");

    // Refresh prayer times for the new day
    await schedulePrayers();
}, { timezone: "Africa/Cairo" });

// -----------------------------
// 🚀 START BOT
// -----------------------------
const commands = [
    { command: "pray", description: "Show today's prayer times" },
    { command: "nextprayer", description: "Show the next upcoming prayer" },
    { command: "results", description: "Show today's vote results" },
    { command: "status", description: "Check bot is running" },
    { command: "help", description: "Show all available commands" },
    { command: "start", description: "Start the bot" },
];

async function registerCommands() {
    try {
        await bot.setMyCommands(commands);
        await bot.setMyCommands(commands, { scope: { type: "all_private_chats" } });
        await bot.setMyCommands(commands, { scope: { type: "all_group_chats" } });
        await bot.setMyCommands(commands, { scope: { type: "all_chat_administrators" } });
        await bot.setMyCommands(commands, { scope: { type: "chat", chat_id: GROUP_ID } });
        console.log("✅ Commands registered");
    } catch (err) {
        console.log("Command registration error:", err.message);
    }
}

console.log("🕌 BOT RUNNING...");
registerCommands();
schedulePrayers();
