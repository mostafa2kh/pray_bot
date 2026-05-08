import fetch from "node-fetch";
import fs from "fs";

const city = "Qalyubia";
const country = "Egypt";

// Aladhan API
const url = `https://api.aladhan.com/v1/timingsByCity?city=${city}&country=${country}&method=5`;

async function update() {
  const res = await fetch(url);
  const data = await res.json();

  const timings = data.data.timings;

  const prayerTimes = {
    Fajr: timings.Fajr,
    Dhuhr: timings.Dhuhr,
    Asr: timings.Asr,
    Maghrib: timings.Maghrib,
    Isha: timings.Isha
  };

  fs.writeFileSync("prayer.json", JSON.stringify(prayerTimes, null, 2));

  console.log("Prayer times updated:", prayerTimes);
}

update();
