/* Static catalogs: billers, categories, Iraqi cities and seed data pools.
 * Ported 1:1 from mini-services/urpay-backend/app/constants.py */

export const CITIES: string[] = [
  "بغداد", "البصرة", "الموصل", "أربيل", "النجف", "كربلاء", "السليمانية",
  "كركوك", "بابل", "ذي قار", "الأنبار", "ديالى", "واسط", "ميسان",
  "المثنى", "صلاح الدين", "دهوك", "حلبجة",
];

export type CategoryMetaRow = {
  key: string;
  ar: string;
  en: string;
  icon: string;
  desc: string;
};

export const CATEGORIES: CategoryMetaRow[] = [
  { key: "electricity", ar: "كهرباء", en: "Electricity", icon: "zap",
    desc: "فواتير وزارة الكهرباء لكل المحافظات" },
  { key: "water", ar: "ماء", en: "Water", icon: "droplets",
    desc: "أجور الماء والصحيّة العامة" },
  { key: "internet", ar: "إنترنت", en: "Internet", icon: "wifi",
    desc: "اشتراكات الشركات المحلية ومزودي الإنترنت" },
  { key: "mobile", ar: "اتصالات", en: "Mobile", icon: "smartphone",
    desc: "شحن رصيد وباقات شركة زين" },
  { key: "education", ar: "تعليم", en: "Education", icon: "graduation-cap",
    desc: "رسوم جامعية ومدارس ومعاهد" },
  { key: "traffic", ar: "مرور", en: "Traffic", icon: "car-front",
    desc: "مخالفات وسداد ضروع المرور" },
  { key: "health", ar: "صحة", en: "Health", icon: "heart-pulse",
    desc: "مستشفيات ومراكز فحوصات خاصة" },
  { key: "gas", ar: "غاز", en: "Gas", icon: "flame",
    desc: "تعبئة أسطوانات الغاز وخدماتها" },
];

export type BillerRow = { code: string; name: string };

export const BILLERS: Record<string, BillerRow[]> = {
  electricity: [
    { code: "MOE-BGD-R", name: "وزارة الكهرباء — بغداد الرصافة" },
    { code: "MOE-BGD-K", name: "وزارة الكهرباء — بغداد الكرخ" },
    { code: "MOE-BSR", name: "وزارة الكهرباء — البصرة" },
    { code: "MOE-NSR", name: "وزارة الكهرباء — النجف" },
    { code: "MOE-NIN", name: "وزارة الكهرباء — نينوى" },
    { code: "MOE-ERB", name: "وزارة الكهرباء — أربيل" },
    { code: "MOE-KRK", name: "وزارة الكهرباء — كركوك" },
    { code: "MOE-BAB", name: "وزارة الكهرباء — بابل" },
    { code: "MOE-DYA", name: "وزارة الكهرباء — ديالى" },
    { code: "MOE-WAS", name: "وزارة الكهرباء — واسط" },
    { code: "MOE-DHQ", name: "وزارة الكهرباء — ذي قار" },
    { code: "MOE-KRB", name: "وزارة الكهرباء — كربلاء" },
    { code: "MOE-ANB", name: "وزارة الكهرباء — الأنبار" },
    { code: "MOE-MYS", name: "وزارة الكهرباء — ميسان" },
    { code: "MOE-SLD", name: "وزارة الكهرباء — صلاح الدين" },
    { code: "MOE-DHU", name: "وزارة الكهرباء — دهوك" },
  ],
  water: [
    { code: "MOW-BGD", name: "ماء بغداد — عامة الماء" },
    { code: "MOW-BSR", name: "ماء البصرة" },
    { code: "MOW-NIN", name: "ماء نينوى" },
    { code: "MOW-BAB", name: "ماء بابل" },
    { code: "MOW-ERB", name: "ماء أربيل" },
    { code: "MOW-NSR", name: "ماء النجف" },
    { code: "MOW-DHQ", name: "ماء ذي قار" },
    { code: "MOW-KRK", name: "ماء كركوك" },
    { code: "MOW-SLD", name: "ماء صلاح الدين" },
    { code: "MOW-SLM", name: "ماء السليمانية" },
    { code: "MOW-MYS", name: "ماء ميسان" },
    { code: "MOW-DYA", name: "ماء ديالى" },
  ],
  internet: [
    { code: "NET-TARIN", name: "تارين للاتصالات Tarin" },
    { code: "NET-HILAL", name: "هلال نت HilalNet" },
    { code: "NET-EARTHLINK", name: "إيرثلينك EarthLink" },
    { code: "NET-IQNET", name: "آي كيو نت IQNet" },
    { code: "NET-NEWBAGHDAD", name: "بغداد الجديدة للاتصالات" },
    { code: "NET-HILI", name: "هيلي للاتصالات Hili" },
    { code: "NET-NOORSAT", name: "نور سات NoorSat" },
    { code: "NET-FURAT", name: "الفرات للاتصالات Al-Furat" },
    { code: "NET-URNET", name: "أور نت UrNet" },
    { code: "NET-HALASAT", name: "هلا سات Halasat" },
    { code: "NET-NEWROZ", name: "نيروز تليكوم Newroz Telecom" },
  ],
  mobile: [
    { code: "TEL-ZAIN", name: "زين العراق Zain Iraq" },
  ],
  education: [
    { code: "EDU-UOB", name: "جامعة بغداد" },
    { code: "EDU-UOT", name: "جامعة التكنولوجيا" },
    { code: "EDU-UOBC", name: "جامعة البصرة" },
    { code: "EDU-UMQ", name: "جامعة القادسية" },
    { code: "EDU-MOE", name: "وزارة التربية — رسوم مدرسية" },
    { code: "EDU-UMST", name: "جامعة المستنصرية" },
    { code: "EDU-UOM", name: "جامعة الموصل" },
    { code: "EDU-UOD", name: "جامعة دهوك" },
    { code: "EDU-MTU", name: "الجامعة التقنية الوسطى" },
    { code: "EDU-BHD", name: "معهد بغداد العالي" },
    { code: "EDU-UOS", name: "جامعة السليمانية" },
    { code: "EDU-UOMS", name: "جامعة ميسان" },
    { code: "EDU-UOTK", name: "جامعة تكريت" },
    { code: "EDU-UOK", name: "جامعة الكوفة" },
  ],
  traffic: [
    { code: "TRF-MOI", name: "المديرية العامة للمرور — مخالفات" },
    { code: "TRF-BGD", name: "مرور بغداد — ضروع" },
    { code: "TRF-BSR", name: "مرور البصرة" },
    { code: "TRF-NIN", name: "مرور نينوى" },
    { code: "TRF-KRK", name: "مرور كركوك" },
    { code: "TRF-DVR", name: "دائرة تسجيل السيارات — ضروط" },
    { code: "TRF-ERB", name: "مرور أربيل" },
    { code: "TRF-DHQ", name: "مرور ذي قار" },
    { code: "TRF-BAB", name: "مرور بابل" },
  ],
  health: [
    { code: "HLT-IBNSINA", name: "مستشفى ابن سينا التعليمي" },
    { code: "HLT-KARAMA", name: "مستشفى الكرامة التعليمي" },
    { code: "HLT-BGDLAB", name: "مركز بغداد للفحوصات الطبية" },
    { code: "HLT-RAHMA", name: "مستشفى الرحمة التخصصي" },
    { code: "HLT-NOOR", name: "مستشفى النور التخصصي" },
    { code: "HLT-HAYATDENT", name: "مركز حياة لطب الأسنان" },
  ],
  gas: [
    { code: "GAS-NAT", name: "الشركة العامة لتعبئة الغاز" },
    { code: "GAS-BGD", name: "غاز بغداد — نقاط البيع" },
    { code: "GAS-BSR", name: "غاز البصرة" },
    { code: "GAS-NIN", name: "غاز نينوى" },
  ],
};

/** categories the user can set a monthly spending limit on */
export const BUDGETABLE_CATEGORIES: string[] = [
  "electricity", "water", "internet", "mobile", "education", "traffic",
  "transfer", "health", "gas",
];

/** Arabic labels for every spendable category (incl. non-bill ones) */
export const CATEGORY_AR: Record<string, string> = {
  electricity: "كهرباء",
  water: "ماء",
  internet: "إنترنت",
  mobile: "اتصالات",
  education: "تعليم",
  traffic: "مرور",
  health: "صحة",
  gas: "غاز",
  transfer: "تحويلات",
  wallet: "محفظة",
  topup: "تعبئة",
  savings: "توفير",
  other: "أخرى",
};

export const AR_MONTHS: string[] = [
  "كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول",
];

/** short month labels used by the analytics chart (analytics.py) */
export const AR_MONTHS_SHORT: string[] = [
  "ك2", "شباط", "آذار", "نيسان", "أيار", "حزيران",
  "تموز", "آب", "أيلول", "ت1", "ت2", "ك1",
];

/* ---------------------------------------------------------------------------
 * Seed pools — realistic Iraqi names
 * ------------------------------------------------------------------------- */
export const MALE_FIRST: string[] = [
  "علي", "حسين", "أحمد", "محمد", "مصطفى", "عبدالله", "يوسف", "حسن", "كرار",
  "كريم", "عمر", "حيدر", "سجاد", "عمار", "مرتضى", "رياض", "سلام", "ياسر",
  "مروان", "سيف", "أمير", "حازم", "طارق", "وليد", "زهير", "فراس", "بشار",
  "مهند", "براء", "مالك", "عثل", "نبيل", "سعد", "ثائر", "مالك",
];

export const FEMALE_FIRST: string[] = [
  "زينب", "فاطمة", "مريم", "نور", "رغد", "سارة", "هدى", "دعاء", "شهد",
  "آيات", "رسل", "بنان", "ملاك", "زهراء", "سكينة", "رهف", "شيماء",
  "أمنة", "بيداء", "وجدان", "سجى", "تيما", "لينا", "عالية", "سماح",
  "فائزة", "أمل", "يارا", "جنى", "سندس", "بارقة", "خلود",
];

export const MIDDLE_NAMES: string[] = [
  "كاظم", "جاسم", "صالح", "مهدي", "راضي", "حميد", "عبد الرحمن", "لطيف",
  "فاضل", "عباس", "موسى", "جعفر", "خليل", "إبراهيم", "صباح", "ستار",
  "منذر", "عادل", "باسم", "حمزة", "عقيل", "جواد", "سعيد", "حبيب",
  "قاسم", "عامر", "زامل", "خالد", "طارق", "نوري", "جلال", "رفعت",
];

export const FAMILY_NAMES: string[] = [
  "العبيدي", "الجبوري", "التميمي", "الدليمي", "العزاوي", "الكعبي",
  "الموسوي", "الحكيم", "الشمري", "العاني", "الجاف", "الساعدي",
  "الحسيني", "النعيمي", "الخفاجي", "العليوي", "المالكي", "العمارلي",
  "الراوي", "الحديثي", "الجميلي", "الفهداوي", "الحلبوسي", "الزيباري",
  "الربيعي", "اللامي", "السامرائي", "الكرباسي", "النعمة", "الأمين",
];

export const EMAIL_DOMAINS: string[] = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
];

export const CITY_DISTRICTS: Record<string, string[]> = {
  "بغداد": ["الكرادة", "الأعظمية", "الجادرية", "المنصور", "زيونة", "الحرية", "البياع", "الفضل", "البواب", "شعب"],
  "البصرة": ["الجزائر", "الطويسة", "العشار", "البراضعية", "القرنة", "الزبير"],
  "الموصل": ["المنصور", "الشعلة", "النبي يونس", "الدواسة", "الساحة", "الزهور"],
  "أربيل": ["عنكاوا", "شورجة", "مزوري", "إمام عباس"],
  "النجف": ["الغريّات", "الحيدرية", "الرميثة", "الكوفة", "المشخاب"],
  "كربلاء": ["باب بغداد", "العطارات", "الحسينية", "الحر"],
  "السليمانية": ["باخترا", "شورش", "زيوية", "رانيّة"],
  "كركوك": ["شورجة", "راهوة", "التقريعات"],
};

/** [prefix, carrier] — realistic Iraqi mobile prefixes */
export const MOBILE_PREFIXES: [string, string][] = [
  ["0770", "زين"], ["0771", "زين"], ["0772", "زين"], ["0773", "زين"],
  ["0780", "زين"], ["0781", "زين"], ["0782", "زين"], ["0783", "زين"],
  ["0774", "آسياسيل"], ["0775", "آسياسيل"], ["0776", "آسياسيل"], ["0777", "آسياسيل"],
  ["0750", "كورك"], ["0751", "كورك"], ["0752", "كورك"], ["0753", "كورك"],
];

export const TRANSLIT: Record<string, string> = {
  "علي": "ali", "حسين": "hussein", "أحمد": "ahmed", "محمد": "mohammed",
  "مصطفى": "mustafa", "عبدالله": "abdullah", "يوسف": "yousif", "حسن": "hassan",
  "كرار": "krar", "كريم": "karim", "عمر": "omar", "حيدر": "haider",
  "سجاد": "sajad", "عمار": "ammar", "مرتضى": "murtadha", "رياض": "riyadh",
  "سلام": "salam", "ياسر": "yasser", "مروان": "marwan", "سيف": "saif",
  "أمير": "ameer", "حازم": "hazim", "طارق": "tareq", "وليد": "waleed",
  "زهير": "zuhair", "فراس": "firas", "بشار": "bashaar", "مهند": "muhannad",
  "براء": "baraa", "مالك": "malik", "عثل": "athel", "نبيل": "nabil",
  "سعد": "saad", "ثائر": "thaer", "زينب": "zainab", "فاطمة": "fatima",
  "مريم": "maryam", "نور": "noor", "رغد": "raghad", "سارة": "sara",
  "هدى": "huda", "دعاء": "duaa", "شهد": "shahd", "آيات": "ayat",
  "رسل": "rasl", "بنان": "banan", "ملاك": "malak", "زهراء": "zahraa",
  "سكينة": "sukaina", "رهف": "rahaf", "شيماء": "shima", "أمنة": "amna",
  "بيداء": "baida", "وجدان": "wijdan", "سجى": "saja", "تيما": "tayma",
  "لينا": "lina", "عالية": "alia", "سماح": "samah", "فائزة": "faiza",
  "أمل": "amal", "يارا": "yara", "جنى": "jana", "سندس": "sundus",
  "بارقة": "barqa", "خلود": "khulood",
};

/** IQD credited to newly registered users (demo wallet) — config.py */
export const WELCOME_BALANCE = 250_000;
