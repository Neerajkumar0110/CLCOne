import dayjs from "dayjs";

// Live demo runs Mon–Sat, 6:00–7:00 PM IST (backend services/sales/
// demoBookings.js). "Demo Booked" picks only the DAY; the time is fixed.
export const DEMO_TIME_LABEL = "6:00 – 7:00 PM (IST)";

const istToday = () => dayjs(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10));
const todayDemoOver = () => Date.now() >= new Date(`${istToday().format("YYYY-MM-DD")}T19:00:00+05:30`).getTime();

// DatePicker disabledDate: Sundays, past days, and today once 7 PM is gone.
export function disabledDemoDate(d) {
  if (!d) return false;
  if (d.day() === 0) return true;
  const today = istToday();
  if (d.isBefore(today, "day")) return true;
  if (d.isSame(today, "day") && todayDemoOver()) return true;
  return false;
}

// The next demo still to come: today if before 7 PM (and not Sunday), else
// the next Mon–Sat — the default when "Demo Booked" is picked with no day.
export function nextDemoSlot() {
  let d = istToday();
  while (disabledDemoDate(d)) d = d.add(1, "day");
  return toDemoSlot(d);
}

// The picked day → that day's 6:00 PM IST.
export const toDemoSlot = (d) => (d ? dayjs(`${d.format("YYYY-MM-DD")}T18:00:00+05:30`) : null);
