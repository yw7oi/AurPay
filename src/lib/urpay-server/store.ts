/* In-memory store + deterministic seed — port of app/seed.py plus the demo
 * mandate/bill provisioning from app/main.py (_ensure_demo_scheduled +
 * _ensure_demo_new_categories).
 *
 * The store lives on globalThis so it survives Next.js dev HMR reloads. On
 * the first access the full demo dataset is generated (100 users, bills,
 * cross-user transfers with ledger simulation) using the seeded PRNG, so
 * the data is identical on every process start. */

import { randomBytes } from "crypto";

import {
  AR_MONTHS, BILLERS, CITY_DISTRICTS, EMAIL_DOMAINS, FAMILY_NAMES,
  FEMALE_FIRST, MALE_FIRST, MIDDLE_NAMES, MOBILE_PREFIXES, TRANSLIT,
} from "./constants";
import { seedRng } from "./rng";
import { makePinSecret } from "./security";
import type { AgentMessageRow, BillRow, Db, UserRow } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/* ------------------------------------------------------------ primitives --- */

/** Append the Luhn check digit to a 15-digit base (seed.py luhn_complete). */
export function luhnComplete(base15: string): string {
  let total = 0;
  let alt = true;
  for (let i = base15.length - 1; i >= 0; i--) {
    let d = Number(base15[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
    alt = !alt;
  }
  return base15 + String((10 - (total % 10)) % 10);
}

const DIGITS = "0123456789".split("");
const REF_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");

function genReference(): string {
  return "UR-" + seedRng.choices(REF_ALPHABET, 8).join("");
}

function genCard(prefix: string): string {
  return luhnComplete(prefix + seedRng.choices(DIGITS, 11).join(""));
}

function genPhone(): string {
  const prefix = seedRng.choice(MOBILE_PREFIXES)[0];
  return prefix + seedRng.choices(DIGITS, 7).join("");
}

function transliterate(name: string): string {
  return (TRANSLIT[name] ?? "urpay").replace(/ /g, "");
}

/* --------------------------------------------------------------- persons --- */

type Person = {
  first_name: string;
  father_name: string;
  family_name: string;
  full_name: string;
  gender: string;
  age: number;
  city: string;
  district: string;
  phone: string;
  email: string;
  card_number: string;
  pin_salt: string;
  pin_hash: string;
  avatar_hue: number;
  is_demo: boolean;
  initial_balance: number;
};

const CITY_POPULATION = [
  "بغداد", "البصرة", "الموصل", "أربيل", "النجف", "كربلاء",
  "السليمانية", "كركوك", "بابل", "ذي قار", "الأنبار", "ديالى",
  "واسط", "ميسان", "المثنى", "صلاح الدين", "دهوك", "حلبجة",
];
const CITY_WEIGHTS = [28, 10, 9, 7, 7, 6, 6, 6, 5, 4, 4, 3, 3, 2, 2, 3, 2, 1];

type DemoSpec = {
  card_base: string; first_name: string; father_name: string;
  family_name: string; full_name: string; gender: string;
  age: number; city: string; district: string;
  phone: string; email: string;
  avatar_hue: number; is_demo: boolean; initial_balance: number;
};

function makeDemoPerson(spec: DemoSpec): Person {
  const { salt, hash } = makePinSecret("123456");
  return {
    first_name: spec.first_name,
    father_name: spec.father_name,
    family_name: spec.family_name,
    full_name: spec.full_name,
    gender: spec.gender,
    age: spec.age,
    city: spec.city,
    district: spec.district,
    phone: spec.phone,
    email: spec.email,
    card_number: luhnComplete(spec.card_base),
    pin_salt: salt,
    pin_hash: hash,
    avatar_hue: spec.avatar_hue,
    is_demo: spec.is_demo,
    initial_balance: spec.initial_balance,
  };
}

function makePerson(): Person {
  const rng = seedRng;
  const gender = rng.random() < 0.42 ? "female" : "male";
  const first = rng.choice(gender === "female" ? FEMALE_FIRST : MALE_FIRST);
  const middle = rng.choice(MIDDLE_NAMES);
  const useFamily = rng.random() < 0.38;
  // third part = grandfather (male name) or tribal family name
  let family = rng.choice(useFamily ? FAMILY_NAMES : MIDDLE_NAMES);
  // avoid identical triple parts
  if (family === middle) family = rng.choice(FAMILY_NAMES);

  const city = rng.choices(CITY_POPULATION, 1, CITY_WEIGHTS)[0];
  const districts = CITY_DISTRICTS[city];
  const district = districts ? rng.choice(districts) : "";

  const age = rng.randint(19, 64);
  const phone = genPhone();
  const firstEmail = transliterate(first);
  const lastEmail = transliterate(useFamily ? family : middle);
  const email = `${firstEmail}.${lastEmail}${rng.randint(1, 99)}@${rng.choice(EMAIL_DOMAINS)}`;
  const card = genCard(rng.choice(["4539", "4539", "4539", "5512", "5210"]));
  const { salt, hash } = makePinSecret("123456");

  return {
    first_name: first,
    father_name: middle,
    family_name: family,
    full_name: `${first} ${middle} ${family}`,
    gender,
    age,
    city,
    district,
    phone,
    email,
    card_number: card,
    pin_salt: salt,
    pin_hash: hash,
    avatar_hue: rng.choice([14, 26, 40, 88, 120, 142, 152, 168, 200, 262, 292, 330]),
    is_demo: false,
    initial_balance: rng.randrange(400_000, 4_000_000, 25_000),
  };
}

/* ----------------------------------------------------------------- bills --- */

type SeedBill = {
  category: string; biller_code: string; biller_name: string;
  subscriber_no: string; amount: number; period: string;
  due_date: number; status: string; issued_at: number; paid_at?: number;
};

/** Generate unpaid + paid bills for a seeded user (make_bills_for).
 *
 * NOTE (controlled deviation from Python): the two demo accounts only get
 * the six classic categories here, so the health & gas showcase bills are
 * deterministically provisioned by ensureDemoNewCategories below — exactly
 * like the live demo DB (the demo user "joined" before those categories
 * launched). All 98 generated users draw from the full catalog. */
function makeBillsFor(person: Person): SeedBill[] {
  const rng = seedRng;
  const bills: SeedBill[] = [];
  const now = Date.now();
  const nowMonth = new Date(now).getUTCMonth() + 1;
  const nowYear = new Date(now).getUTCFullYear();

  const allCats = Object.keys(BILLERS);
  const categories = person.is_demo
    ? allCats.filter((c) => c !== "health" && c !== "gas")
    : allCats;

  const unpaidCount = rng.randint(2, 5);
  const chosen = rng.sample(categories, Math.min(unpaidCount, categories.length));
  for (const cat of chosen) {
    const biller = rng.choice(BILLERS[cat]);
    let amount: number;
    switch (cat) {
      case "mobile": amount = rng.randrange(10_000, 60_000, 5_000); break;
      case "internet": amount = rng.randrange(25_000, 90_000, 5_000); break;
      case "traffic": amount = rng.randrange(15_000, 75_000, 5_000); break;
      case "education": amount = rng.randrange(50_000, 350_000, 25_000); break;
      case "water": amount = rng.randrange(5_000, 25_000, 1_000); break;
      case "health": amount = rng.randrange(20_000, 250_000, 5_000); break;
      case "gas": amount = rng.randrange(6_000, 30_000, 2_000); break;
      default: amount = rng.randrange(10_000, 120_000, 5_000); break;
    }

    const m = rng.randint(0, 11);
    const period = `${AR_MONTHS[(nowMonth - 1 - m + 12) % 12]} ${nowYear - (m >= nowMonth ? 1 : 0)}`;
    // overdue 45% of the time
    const due =
      rng.random() > 0.45
        ? now + rng.randint(2, 20) * DAY
        : now - rng.randint(1, 12) * DAY;
    bills.push({
      category: cat,
      biller_code: biller.code,
      biller_name: biller.name,
      subscriber_no: String(rng.randint(10_000_000, 99_999_999)),
      amount,
      period,
      due_date: due,
      status: "unpaid",
      issued_at: now - rng.randint(5, 30) * DAY,
    });
  }

  const paidCount = rng.randint(2, 4);
  for (let i = 0; i < paidCount; i++) {
    const cat = rng.choice(categories);
    const biller = rng.choice(BILLERS[cat]);
    const paidAt = now - rng.randint(3, 55) * DAY;
    const m = rng.randint(1, 3);
    const pd = new Date(paidAt);
    const pdMonth = pd.getUTCMonth() + 1;
    const period = `${AR_MONTHS[(pdMonth - 1 - m + 12) % 12]} ${pd.getUTCFullYear() - (m >= pdMonth ? 1 : 0)}`;
    const amount = rng.randrange(10_000, 90_000, 5_000);
    bills.push({
      category: cat,
      biller_code: biller.code,
      biller_name: biller.name,
      subscriber_no: String(rng.randint(10_000_000, 99_999_999)),
      amount,
      period,
      due_date: paidAt + rng.randint(5, 25) * DAY,
      status: "paid",
      issued_at: paidAt - rng.randint(5, 20) * DAY,
      paid_at: paidAt,
    });
  }
  return bills;
}

/** Top-ups + agent-bill payment events (make_extra_events). */
type SeedEvent = {
  kind: string;
  at: number;
  amount: number;
  title: string;
  subtitle?: string;
  category: string;
  direction: "in" | "out";
  user_idx: number;
  bill_id?: number;
  pair_ref?: string;
  balance_after: number;
};

function makeExtraEvents(person: Person): SeedEvent[] {
  const rng = seedRng;
  const events: SeedEvent[] = [];
  const now = Date.now();
  const count = rng.randint(1, 3);
  for (let i = 0; i < count; i++) {
    const carrier = "زين العراق Zain Iraq";
    events.push({
      kind: "topup",
      at: now - rng.randint(2, 55) * DAY,
      amount: rng.randrange(10_000, 50_000, 5_000),
      title: `شحن رصيد ${carrier}`,
      subtitle: `عبر أور پاي — رقم ${person.phone.slice(-4)}`,
      category: "mobile",
      direction: "out",
      user_idx: -1,
      balance_after: 0,
    });
  }
  return events;
}

/* ------------------------------------------------------------------ seed --- */

function emptyDb(): Db {
  return {
    users: [],
    bills: [],
    txns: [],
    transferRequests: [],
    agentMessages: [],
    budgets: [],
    notifications: [],
    scheduled: [],
    goals: [],
    favorites: [],
    seq: {
      users: 0,
      bills: 0,
      txns: 0,
      transferRequests: 0,
      agentMessages: 0,
      budgets: 0,
      notifications: 0,
      scheduled: 0,
      goals: 0,
      favorites: 0,
    },
  };
}

function seedDb(db: Db): void {
  const rng = seedRng;
  const now = Date.now();

  const demoSpecs: DemoSpec[] = [
    {
      card_base: "453912341234123", first_name: "أحمد", father_name: "علي",
      family_name: "حسين", full_name: "أحمد علي حسين", gender: "male",
      age: 27, city: "بغداد", district: "الكرادة",
      phone: "07701234567", email: "ahmed.ali@urpay.iq",
      avatar_hue: 152, is_demo: true, initial_balance: 1_850_000,
    },
    {
      card_base: "453955554444123", first_name: "زينب", father_name: "مرتضى",
      family_name: "الموسوي", full_name: "زينب مرتضى الموسوي", gender: "female",
      age: 24, city: "النجف", district: "الغريّات",
      phone: "07719876543", email: "zainab.m@urpay.iq",
      avatar_hue: 330, is_demo: true, initial_balance: 950_000,
    },
  ];

  const total = 100;
  const people: Person[] = demoSpecs.map((spec) => makeDemoPerson(spec));
  while (people.length < total) people.push(makePerson());

  /* --- insert users ---------------------------------------------------- */
  const userRows: UserRow[] = people.map((p) => ({
    id: ++db.seq.users,
    first_name: p.first_name,
    father_name: p.father_name,
    family_name: p.family_name,
    full_name: p.full_name,
    gender: p.gender,
    age: p.age,
    city: p.city,
    district: p.district,
    phone: p.phone,
    email: p.email,
    card_number: p.card_number,
    pin_salt: p.pin_salt,
    pin_hash: p.pin_hash,
    balance: p.initial_balance,
    avatar_hue: p.avatar_hue,
    is_demo: p.is_demo,
    created_at: now - rng.randint(10, 300) * DAY,
    failed_attempts: 0,
    ban_count: 0,
    locked_until: null,
  }));
  db.users.push(...userRows);

  /* --- bills + events --------------------------------------------------- */
  const allEvents: SeedEvent[] = [];

  people.forEach((person, idx) => {
    const urow = userRows[idx];
    for (const b of makeBillsFor(person)) {
      const bill: BillRow = {
        id: ++db.seq.bills,
        user_id: urow.id,
        category: b.category,
        biller_code: b.biller_code,
        biller_name: b.biller_name,
        subscriber_no: b.subscriber_no,
        amount: b.amount,
        period: b.period,
        due_date: b.due_date,
        status: b.status,
        issued_at: b.issued_at,
        paid_at: b.paid_at ?? null,
        receipt_ref: null,
      };
      db.bills.push(bill);
      if (b.status === "paid") {
        allEvents.push({
          kind: "bill_payment",
          at: b.paid_at ?? now,
          amount: b.amount,
          title: `فاتورة ${b.biller_name}`,
          subtitle: b.period,
          category: b.category,
          direction: "out",
          user_idx: idx,
          bill_id: bill.id,
          balance_after: 0,
        });
      }
    }
    for (const ev of makeExtraEvents(person)) {
      ev.user_idx = idx;
      allEvents.push(ev);
    }
  });

  /* --- cross-user transfers ---------------------------------------------- */
  const indices = Array.from({ length: total }, (_, i) => i);
  const nTransfers = 160;
  for (let i = 0; i < nTransfers; i++) {
    const [s, r] = rng.sample(indices, 2);
    const amount = rng.randrange(10_000, 150_000, 5_000);
    const at = now - rng.randint(1, 55) * DAY - rng.randint(0, 23) * HOUR;
    const pairRef = randomBytes(6).toString("hex");
    allEvents.push({
      kind: "transfer_out",
      at,
      amount,
      title: `حوالة إلى ${people[r].full_name}`,
      subtitle: `بطاقة …${people[r].card_number.slice(-4)}`,
      category: "transfer",
      direction: "out",
      user_idx: s,
      pair_ref: pairRef,
      balance_after: 0,
    });
    allEvents.push({
      kind: "transfer_in",
      at: at + 1000,
      amount,
      title: `حوالة من ${people[s].full_name}`,
      subtitle: `بطاقة …${people[s].card_number.slice(-4)}`,
      category: "transfer",
      direction: "in",
      user_idx: r,
      pair_ref: pairRef,
      balance_after: 0,
    });
  }

  /* --- run ledgers, drop overdrafting transfer pairs --------------------- */
  const ledgers = new Map<number, SeedEvent[]>();
  for (const ev of allEvents) {
    let list = ledgers.get(ev.user_idx);
    if (!list) {
      list = [];
      ledgers.set(ev.user_idx, list);
    }
    list.push(ev);
  }

  const droppedPairs = new Set<string>();
  for (const [idx, events] of ledgers) {
    events.sort((a, b) => a.at - b.at);
    let bal = people[idx].initial_balance;
    for (const ev of events) {
      if (ev.direction === "out") {
        if (bal - ev.amount < 0) {
          if (ev.pair_ref) droppedPairs.add(ev.pair_ref);
          continue;
        }
        bal -= ev.amount;
      } else {
        bal += ev.amount;
      }
      ev.balance_after = bal;
    }
  }

  /* if a pair's incoming side existed but the sender dropped it, drop it too */
  const eventsOut: SeedEvent[] = [];
  for (const [, events] of ledgers) {
    for (const ev of events) {
      if (ev.pair_ref && droppedPairs.has(ev.pair_ref)) continue;
      eventsOut.push(ev);
    }
  }

  /* recompute running balances cleanly after drops */
  const ledgers2 = new Map<number, SeedEvent[]>();
  for (const ev of eventsOut) {
    let list = ledgers2.get(ev.user_idx);
    if (!list) {
      list = [];
      ledgers2.set(ev.user_idx, list);
    }
    list.push(ev);
  }
  for (const [idx, events] of ledgers2) {
    events.sort((a, b) => a.at - b.at);
    let bal = people[idx].initial_balance;
    for (const ev of events) {
      bal += ev.direction === "out" ? -ev.amount : ev.amount;
      ev.balance_after = bal;
    }
    /* guarantee a healthy floor */
    if (bal < 50_000) {
      const rescue: SeedEvent = {
        kind: "topup",
        at: events.length > 0 ? events[0].at - HOUR : now - 56 * DAY,
        amount: 500_000,
        title: "إيداع رصيد — كاش ديبوزيت",
        subtitle: "وكالة أور پاي — بغداد",
        category: "wallet",
        direction: "in",
        user_idx: idx,
        balance_after: bal + 500_000,
      };
      events.unshift(rescue);
      bal += 500_000;
      for (const ev of events.slice(1)) {
        bal += ev.direction === "out" ? -ev.amount : ev.amount;
        ev.balance_after = bal;
      }
    }
    userRows[idx].balance = bal;
  }

  /* --- persist transactions + link paid bills ---------------------------- */
  const billReceipts = new Map<number, string>();
  for (const ev of eventsOut) {
    const ref = genReference();
    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: userRows[ev.user_idx].id,
      type: ev.kind,
      direction: ev.direction,
      amount: ev.amount,
      balance_after: ev.balance_after,
      title: ev.title,
      subtitle: ev.subtitle ?? "",
      category: ev.category,
      counterparty_id: null,
      bill_id: ev.bill_id ?? null,
      created_at: ev.at,
    });
    if (ev.kind === "bill_payment" && ev.bill_id) {
      billReceipts.set(ev.bill_id, ref);
    }
  }
  for (const [billId, ref] of billReceipts) {
    const bill = db.bills.find((b) => b.id === billId);
    if (bill) bill.receipt_ref = ref;
  }

  /* --- demo provisioning (main.py lifespan) ------------------------------- */
  ensureDemoScheduled(db);
  ensureDemoNewCategories(db);
}

/** Give the demo user two showcase scheduled mandates (main.py). */
function ensureDemoScheduled(db: Db): void {
  const demo = db.users.find((u) => u.is_demo);
  if (!demo) return;
  if (db.scheduled.some((sp) => sp.user_id === demo.id && sp.status === "pending")) {
    return;
  }

  const zainab = db.users.find((u) => u.is_demo && u.full_name.includes("زينب"));

  const now = Date.now();
  const nd = new Date(now);
  let y = nd.getUTCFullYear();
  let m = nd.getUTCMonth() + 2;
  if (m > 12) {
    y += 1;
    m = 1;
  }
  const firstNextMonth = Date.UTC(y, m - 1, 1, 9, 0, 0);

  db.scheduled.push({
    id: ++db.seq.scheduled,
    user_id: demo.id,
    kind: "bill",
    category: "electricity",
    biller_code: "MOE-BGD-R",
    biller_name: "وزارة الكهرباء — بغداد الرصافة",
    subscriber_no: "77881234",
    amount: 45_000,
    frequency: "monthly",
    next_run_at: firstNextMonth,
    last_run_at: null,
    status: "pending",
    created_at: now,
    receiver_card: "",
    receiver_name: "",
  });
  if (zainab) {
    const nextRun = Date.UTC(
      nd.getUTCFullYear(),
      nd.getUTCMonth(),
      Math.min(nd.getUTCDate() + 3, 28),
      9,
      0,
      0,
    );
    db.scheduled.push({
      id: ++db.seq.scheduled,
      user_id: demo.id,
      kind: "transfer",
      category: "",
      biller_code: "",
      biller_name: "",
      subscriber_no: "",
      receiver_card: zainab.card_number,
      receiver_name: zainab.full_name,
      amount: 100_000,
      frequency: "once",
      next_run_at: nextRun,
      last_run_at: null,
      status: "pending",
      created_at: now,
    });
  }
}

/** Showcase bills for the health & gas categories + classic re-stock (main.py). */
function ensureDemoNewCategories(db: Db): void {
  const demo = db.users.find((u) => u.is_demo);
  if (!demo) return;

  const now = Date.now();
  const year = new Date(now).getUTCFullYear();
  const hasHealth = db.bills.some(
    (b) => b.user_id === demo.id && b.category === "health",
  );
  if (!hasHealth) {
    db.bills.push({
      id: ++db.seq.bills,
      user_id: demo.id,
      category: "health",
      biller_code: "HLT-KARAMA",
      biller_name: "مستشفى الكرامة التعليمي",
      subscriber_no: "55210077",
      amount: 65_000,
      period: `زيارة ${year}`,
      due_date: now + 4 * DAY,
      status: "unpaid",
      issued_at: now,
      paid_at: null,
      receipt_ref: null,
    });
    db.bills.push({
      id: ++db.seq.bills,
      user_id: demo.id,
      category: "health",
      biller_code: "HLT-BGDLAB",
      biller_name: "مركز بغداد للفحوصات الطبية",
      subscriber_no: "88341002",
      amount: 38_000,
      period: `فحوصات ${year}`,
      due_date: now + 9 * DAY,
      status: "unpaid",
      issued_at: now,
      paid_at: null,
      receipt_ref: null,
    });
  }
  const hasGas = db.bills.some(
    (b) => b.user_id === demo.id && b.category === "gas",
  );
  if (!hasGas) {
    db.bills.push({
      id: ++db.seq.bills,
      user_id: demo.id,
      category: "gas",
      biller_code: "GAS-BGD",
      biller_name: "غاز بغداد — نقاط البيع",
      subscriber_no: "33019045",
      amount: 12_000,
      period: `أسطوانات ${year}`,
      due_date: now + 6 * DAY,
      status: "unpaid",
      issued_at: now,
      paid_at: null,
      receipt_ref: null,
    });
  }

  /* keep classic unpaid bills stocked for the demo (QA rounds pay them) */
  const unpaidTotal = db.bills.filter(
    (b) => b.user_id === demo.id && b.status === "unpaid",
  ).length;
  if (unpaidTotal < 5) {
    const specs: [string, string, string, string, number, number, string][] = [
      ["electricity", "MOE-BGD-R", "وزارة الكهرباء — بغداد الرصافة",
        "77881234", 58_000, 3, "حصة أيلول"],
      ["internet", "NET-TARIN", "تارين للاتصالات Tarin",
        "44550132", 45_000, 6, "اشتراك أيلول"],
      ["water", "MOW-BGD", "ماء بغداد — عامة الماء",
        "99112008", 9_500, 8, "قراءة أيلول"],
    ];
    for (const [cat, code, name, subNo, amount, dueDays, periodLabel] of specs) {
      const hasCatUnpaid = db.bills.some(
        (b) => b.user_id === demo.id && b.category === cat && b.status === "unpaid",
      );
      if (!hasCatUnpaid) {
        db.bills.push({
          id: ++db.seq.bills,
          user_id: demo.id,
          category: cat,
          biller_code: code,
          biller_name: name,
          subscriber_no: subNo,
          amount,
          period: `${periodLabel} ${year}`,
          due_date: now + dueDays * DAY,
          status: "unpaid",
          issued_at: now,
          paid_at: null,
          receipt_ref: null,
        });
      }
    }
  }
}

/* --------------------------------------------------------------- access --- */

const globalStore = globalThis as unknown as { __urpayDb?: Db };

/** Get the singleton in-memory database (seeds on first access). */
export function getDb(): Db {
  if (!globalStore.__urpayDb) {
    const db = emptyDb();
    seedDb(db);
    globalStore.__urpayDb = db;
  }
  return globalStore.__urpayDb;
}

/* ------------------------------------------- agent-message helpers (2-b) --- */

/** Append an agent chat message (used by the agent routes in Task 2-b). */
export function addAgentMessage(
  db: Db,
  userId: number,
  role: "user" | "assistant",
  content: string,
  provider = "",
): AgentMessageRow {
  const row: AgentMessageRow = {
    id: ++db.seq.agentMessages,
    user_id: userId,
    role,
    content,
    provider,
    created_at: Date.now(),
  };
  db.agentMessages.push(row);
  return row;
}

/** Clear a user's agent chat history (in place); returns the number removed. */
export function clearAgentMessages(db: Db, userId: number): number {
  let removed = 0;
  for (let i = db.agentMessages.length - 1; i >= 0; i--) {
    if (db.agentMessages[i].user_id === userId) {
      db.agentMessages.splice(i, 1);
      removed += 1;
    }
  }
  return removed;
}
