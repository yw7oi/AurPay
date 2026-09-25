/**
 * Dictionary — landing page namespace.
 * OWNED BY: landing conversion task (5-c-1). Add keys here, do not create other dict files.
 * Naming: landing.* — ar values MUST be copied verbatim from the existing UI.
 */
export const ar: Record<string, string> = {
  /* ------------------------------ nav ------------------------------ */
  "landing.nav.features": "المزايا",
  "landing.nav.categories": "الفواتير",
  "landing.nav.agent": "المساعد أور",
  "landing.nav.security": "الأمان",
  "landing.nav.aria": "القائمة الرئيسية",
  "landing.nav.login": "تسجيل الدخول",
  "landing.nav.openWallet": "افتح محفظتك",

  /* ------------------------------ hero ----------------------------- */
  "landing.hero.badge": "أول محفظة عراقية بمساعد ذكي — Bill Pay Agent",
  "landing.hero.title1": "كل فواتيرك…",
  "landing.hero.title2": "بمحادثة وحدة.",
  "landing.hero.desc1": "أور پاي محفظة دفع عراقية بمساعد ذكي اسمه",
  "landing.hero.descBold": "أور",
  "landing.hero.desc2":
    "— مستوحى من مدينة أور السومرية، أول مكان سُجّل فيه تبادل في التاريخ. قلله «ادفع فاتورة الكهرباء» وبيسألك PIN وبيخلصها.",
  "landing.hero.ctaOpen": "افتح محفظتك مجانًا",
  "landing.hero.ctaDemo": "جرّب الحساب التجريبي",
  "landing.hero.demoCard": "بطاقة التجربة:",

  /* hero — phone demo chat script */
  "landing.hero.chat.q1": "شكد رصيدي؟",
  "landing.hero.chat.a1": "رصيدك الحالي: 1,750,000 د.ع 💰",
  "landing.hero.chat.q2": "ادفع فاتورة الكهرباء",
  "landing.hero.chat.a2": "فاتورة وزارة الكهرباء — بغداد بمبلغ 45,000 د.ع.\nأرسل PIN لإتمام الدفع.",
  "landing.hero.chat.q3": "PIN: 1234",
  "landing.hero.chat.a3": "✅ تم الدفع! الرصيد الآن: 1,705,000 د.ع",

  /* hero — floating cards */
  "landing.hero.card1Title": "تم دفع فاتورة كهرباء",
  "landing.hero.card1Amount": "45,000 د.ع · UR-8XK2F3",
  "landing.hero.card2Label": "رصيدك الحالي",
  "landing.hero.card2Value": "1,750,000 د.ع",

  /* hero — phone chrome */
  "landing.hero.chatHeader": "أور · المساعد الذكي",
  "landing.hero.chatStatus": "متصل — Groq gpt-oss-120b",
  "landing.hero.receipt": "إيصال دفع",
  "landing.hero.paid": "مدفوعة",
  "landing.hero.receiptBiller": "وزارة الكهرباء — بغداد",
  "landing.hero.receiptAmount": "45,000 د.ع",
  "landing.hero.receiptDate": "شباط ٢٠٢٦",
  "landing.hero.placeholder": "اكتب لأور…",

  /* ------------------------------ stats ---------------------------- */
  "landing.stats.users": "مستخدم بالمنصة",
  "landing.stats.bills": "فاتورة اندفعت",
  "landing.stats.volume": "حجم التحويلات",
  "landing.stats.volumeFallback": "33 مليون د.ع",

  /* ---------------------------- features --------------------------- */
  "landing.features.kicker": "ليش أور پاي؟",
  "landing.features.title": "مصممة للعراق… مو قالب جاهز",
  "landing.features.sub":
    "كل تفصيلة مبنية على واقع الدفع اليومي: أسماء ثلاثية، محافظة، بطاقة، PIN — ووكيل ذكي يفهم لهجتك.",
  "landing.features.f1.title": "مساعد يفهم لهجتك",
  "landing.features.f1.desc": "«شكد رصيدي؟»، «ادفع الكهرباء»، «حوّل ٢٥ الف على بطاقة صديقي» — أور يفهم وينفّذ.",
  "landing.features.f2.title": "كل دفعة بـ PIN",
  "landing.features.f2.desc": "لا تكتمل أي عملية دفع أو تحويل بدون رمزك السري — حتى لو طلبها الوكيل الذكي.",
  "landing.features.f3.title": "إيصالات مرجعية",
  "landing.features.f3.desc": "كل عملية لها رقم مرجعي UR-XXXXXXXX وتاريخ ورصيد ما بعد العملية — موثقة بالسجل.",
  "landing.features.f4.title": "بيانات عراقية",
  "landing.features.f4.desc": "محافظات، أسماء ثلاثية، بطاقات بصيغة Luhn صحيحة، وشركات حقيقية — مو بيانات وهمية.",
  "landing.features.f5.title": "تحويلات فورية",
  "landing.features.f5.desc": "حوّل لأي مستخدم برقم بطاقته، والتأكيد بخطوتين مع طلب PIN — بأسلوب الحوالات المحلية.",
  "landing.features.f6.title": "سرعة Groq",
  "landing.features.f6.desc": "الوكيل يعمل على Groq gpt-oss-120b بوصول أقل من ثانية — محادثة مالية حقيقية.",

  /* --------------------------- categories -------------------------- */
  "landing.categories.kicker": "الفواتير",
  "landing.categories.title": "٦ أصناف… تغطي يومك",
  "landing.categories.sub":
    "من وزارة الكهرباء إلى باقات تارين — كل الفواتير بمكان واحد، وكل دفعة برقم مرجعي وإيصال.",
  "landing.categories.electricity.desc": "وزارة الكهرباء — كل المحافظات",
  "landing.categories.water.desc": "أجور الماء والصحيّة",
  "landing.categories.internet.desc": "تارين، هلال نت، إيرثلينك…",
  "landing.categories.mobile.desc": "زين، آسياسيل، كورك",
  "landing.categories.education.desc": "رسوم جامعية ومدارس",
  "landing.categories.traffic.desc": "مخالفات وضروع المرور",

  /* ----------------------------- agent ----------------------------- */
  "landing.agent.title1": "قابل",
  "landing.agent.titleBold": "أور",
  "landing.agent.title2": "— وكيلك المالي الذكي",
  "landing.agent.desc1": "الوكيل مبني على Groq بنسخة",
  "landing.agent.desc2":
    "مع Function Calling حقيقي: يقرأ فواتيرك، يتحقق من رصيدك، يطلب الـ PIN، وينفّذ الدفع — وكل خطوة موثقة برقم مرجعي.",
  "landing.agent.s1.title": "يفهم الطلب",
  "landing.agent.s1.desc": "يحلل رسالتك بالعربي أو الإنجليزي ويستخرج القصد والمبلغ والجهة.",
  "landing.agent.s2.title": "يتحقق",
  "landing.agent.s2.desc": "يجلب فواتيرك غير المدفوعة ورصيدك من قاعدة البيانات قبل أي تنفيذ.",
  "landing.agent.s3.title": "يطلب PIN",
  "landing.agent.s3.desc": "الوكيل لا يملك رمزك — يطلبه منك ويقننه بحقل مشفّر قبل التنفيذ.",
  "landing.agent.s4.title": "ينفّذ ويوثّق",
  "landing.agent.s4.desc": "ينفّذ الدفع عبر أدوات حقيقية ويرجّع لك إيصالًا برقم مرجعي.",
  "landing.agent.statUsers": "مستخدم مسجّل",
  "landing.agent.statTxns": "معاملة منفّذة",
  "landing.agent.statBills": "فاتورة مدفوعة",
  "landing.agent.statVolume": "حجم التداول",
  "landing.agent.iqdUnit": "د.ع",
  "landing.agent.flow.user": '"ادفع فاتورة الكهرباء"',
  "landing.agent.flow.agent": '"تم الدفع! الرصيد الآن 1,705,000 د.ع"',
  "landing.agent.flow.hint":
    "نفس الأدوات متاحة للوكيل عبر Function Calling على Groq، مع طبقات بديلة تضمن استمرار الخدمة.",

  /* ------------------------------ how ------------------------------ */
  "landing.how.kicker": "٣ خطوات",
  "landing.how.title": "من التسجيل… للدفعة الأولى",
  "landing.how.sub": "تسجيلك ياخذ دقيقة: اسم ثلاثي، عمر، محافظة، رقم بطاقة، وPIN — وبس.",
  "landing.how.s1.title": "سجّل بمعلوماتك",
  "landing.how.s1.desc": "الاسم الثلاثي، العمر، المحافظة، رقم البطاقة، وPIN — بدون أيميل أو تعقيد.",
  "landing.how.s2.title": "استلم رصيدك الترحيبي",
  "landing.how.s2.desc": "250,000 د.ع رصيد تجريبي + ٣ فواتير جاهزة لتجربة المساعد أور مباشرة.",
  "landing.how.s3.title": "خلّي أور يدفع",
  "landing.how.s3.desc": "افتح المحادثة واكتب «ادفع فاتورة الإنترنت» — وشوف الوكيل يشتغل.",

  /* ---------------------------- security --------------------------- */
  "landing.security.kicker": "الأمان",
  "landing.security.title": "فلوسك… محروسة بـ PIN",
  "landing.security.sub": "ما تكمل أي دفعة بدون رمز PIN — نفس الرمز اللي تختاره وقت التسجيل، مشفّر بـ PBKDF2.",
  "landing.security.s1.title": "PIN مشفّر",
  "landing.security.s1.desc": "رمزك يُخزّن كـ PBKDF2-SHA256 مع ملح فردي — لا يُخزّن نصًا صريحًا أبدًا.",
  "landing.security.s2.title": "تفويض JWT",
  "landing.security.s2.desc": "كل طلب API محمي برمز جلسة موقّع، وينتهي تلقائيًا بعد ٧ أيام.",
  "landing.security.s3.title": "تقنين الوكيل",
  "landing.security.s3.desc": "الوكيل لا ينفّذ شيئًا بدون PIN، وتُقنَّن الأرقام في سجل المحادثة قبل التخزين.",

  /* ------------------------------ cta ------------------------------ */
  "landing.cta.title1": "من أور السومرية…",
  "landing.cta.title2": "إلى جيبك.",
  "landing.cta.desc":
    "جاهز تجرب؟ افتح محفظتك بدقيقة، أو ادخل بالحساب التجريبي وشوف كيف أور يدفع فاتورة كهرباء من محادثة وحدة.",
  "landing.cta.openWallet": "افتح محفظتك",
  "landing.cta.demo": "جرّب الحساب التجريبي",

  /* ----------------------------- footer ---------------------------- */
  "landing.footer.about":
    "أور پاي — منصة دفع عراقية بمساعد ذكي. مشاركة مسابقة (Zain Hackathon · Section 4 — Bill Pay Agent).",
  "landing.footer.copyright": "© 2026 UrPay — نسخة عرض للهاكاثون، البيانات تجريبية.",
  "landing.footer.slides": "سلايدات العرض (EN)",
};

export const en: Record<string, string> = {
  /* ------------------------------ nav ------------------------------ */
  "landing.nav.features": "Features",
  "landing.nav.categories": "Bills",
  "landing.nav.agent": "Ur Assistant",
  "landing.nav.security": "Security",
  "landing.nav.aria": "Main menu",
  "landing.nav.login": "Sign In",
  "landing.nav.openWallet": "Open Your Wallet",

  /* ------------------------------ hero ----------------------------- */
  "landing.hero.badge": "Iraq's First Smart-Agent Wallet — Bill Pay Agent",
  "landing.hero.title1": "Every bill.",
  "landing.hero.title2": "One conversation.",
  "landing.hero.desc1": "UrPay is an Iraqi payments wallet with a smart agent named",
  "landing.hero.descBold": "Ur",
  "landing.hero.desc2":
    "— inspired by the Sumerian city of Ur, the first place an exchange was ever recorded. Just say “Pay my electricity bill” and it asks for your PIN and gets it done.",
  "landing.hero.ctaOpen": "Open Your Free Wallet",
  "landing.hero.ctaDemo": "Try the Demo Account",
  "landing.hero.demoCard": "Demo card:",

  /* hero — phone demo chat script */
  "landing.hero.chat.q1": "What's my balance?",
  "landing.hero.chat.a1": "Your current balance: 1,750,000 IQD 💰",
  "landing.hero.chat.q2": "Pay my electricity bill",
  "landing.hero.chat.a2":
    "Ministry of Electricity — Baghdad bill for 45,000 IQD.\nSend your PIN to complete the payment.",
  "landing.hero.chat.q3": "PIN: 1234",
  "landing.hero.chat.a3": "✅ Paid! Your balance is now: 1,705,000 IQD",

  /* hero — floating cards */
  "landing.hero.card1Title": "Electricity bill paid",
  "landing.hero.card1Amount": "45,000 IQD · UR-8XK2F3",
  "landing.hero.card2Label": "Your current balance",
  "landing.hero.card2Value": "1,750,000 IQD",

  /* hero — phone chrome */
  "landing.hero.chatHeader": "Ur · Smart Assistant",
  "landing.hero.chatStatus": "Online — Groq gpt-oss-120b",
  "landing.hero.receipt": "Payment Receipt",
  "landing.hero.paid": "Paid",
  "landing.hero.receiptBiller": "Ministry of Electricity — Baghdad",
  "landing.hero.receiptAmount": "45,000 IQD",
  "landing.hero.receiptDate": "Feb 2026",
  "landing.hero.placeholder": "Message Ur…",

  /* ------------------------------ stats ---------------------------- */
  "landing.stats.users": "Platform users",
  "landing.stats.bills": "Bills paid",
  "landing.stats.volume": "Transfer volume",
  "landing.stats.volumeFallback": "IQD 33M",

  /* ---------------------------- features --------------------------- */
  "landing.features.kicker": "Why UrPay?",
  "landing.features.title": "Built for Iraq… Not a Template",
  "landing.features.sub":
    "Every detail is built on the reality of daily payments: triple names, governorate, card, PIN — and a smart agent that understands your dialect.",
  "landing.features.f1.title": "An Agent That Speaks Your Dialect",
  "landing.features.f1.desc":
    "“What's my balance?”, “Pay the electricity bill”, “Send 25k to my friend's card” — Ur understands and executes.",
  "landing.features.f2.title": "Every Payment Requires a PIN",
  "landing.features.f2.desc":
    "No payment or transfer goes through without your secret code — even when the smart agent initiates it.",
  "landing.features.f3.title": "Referenced Receipts",
  "landing.features.f3.desc":
    "Every transaction gets a UR-XXXXXXXX reference number, a timestamp, and the post-transaction balance — fully logged.",
  "landing.features.f4.title": "Real Iraqi Data",
  "landing.features.f4.desc":
    "Governorates, triple names, Luhn-valid cards, and real companies — not mock data.",
  "landing.features.f5.title": "Instant Transfers",
  "landing.features.f5.desc":
    "Send to any user by card number with two-step confirmation and a PIN prompt — in the style of local transfers.",
  "landing.features.f6.title": "Groq Speed",
  "landing.features.f6.desc":
    "The agent runs on Groq gpt-oss-120b with sub-second responses — a real financial conversation.",

  /* --------------------------- categories -------------------------- */
  "landing.categories.kicker": "Bills",
  "landing.categories.title": "6 Categories… Covering Your Day",
  "landing.categories.sub":
    "From the Ministry of Electricity to Tareen internet packages — every bill in one place, every payment with a reference number and receipt.",
  "landing.categories.electricity.desc": "Ministry of Electricity — all governorates",
  "landing.categories.water.desc": "Water and sewerage fees",
  "landing.categories.internet.desc": "Tareen, Hilal Net, EarthLink…",
  "landing.categories.mobile.desc": "Zain, Asiacell, Korek",
  "landing.categories.education.desc": "University and school fees",
  "landing.categories.traffic.desc": "Traffic fines and fees",

  /* ----------------------------- agent ----------------------------- */
  "landing.agent.title1": "Meet",
  "landing.agent.titleBold": "Ur",
  "landing.agent.title2": "— Your Smart Financial Agent",
  "landing.agent.desc1": "The agent is built on Groq, running",
  "landing.agent.desc2":
    "with real Function Calling: it reads your bills, checks your balance, asks for your PIN, and executes the payment — every step logged with a reference number.",
  "landing.agent.s1.title": "Understands the Request",
  "landing.agent.s1.desc":
    "It parses your message in Arabic or English and extracts the intent, amount, and counterparty.",
  "landing.agent.s2.title": "Verifies",
  "landing.agent.s2.desc": "It pulls your unpaid bills and balance from the database before executing anything.",
  "landing.agent.s3.title": "Asks for Your PIN",
  "landing.agent.s3.desc":
    "The agent never holds your code — it asks you for it and masks it in a secured field before executing.",
  "landing.agent.s4.title": "Executes and Logs",
  "landing.agent.s4.desc": "It runs the payment through real tools and returns a receipt with a reference number.",
  "landing.agent.statUsers": "Registered users",
  "landing.agent.statTxns": "Transactions executed",
  "landing.agent.statBills": "Bills paid",
  "landing.agent.statVolume": "Total volume",
  "landing.agent.iqdUnit": "IQD",
  "landing.agent.flow.user": '"Pay my electricity bill"',
  "landing.agent.flow.agent": '"Paid! Balance is now 1,705,000 IQD"',
  "landing.agent.flow.hint":
    "The same tools are available to the agent through Function Calling on Groq, with fallback layers that keep the service running.",

  /* ------------------------------ how ------------------------------ */
  "landing.how.kicker": "3 Steps",
  "landing.how.title": "From Sign-Up… to Your First Payment",
  "landing.how.sub":
    "Sign-up takes a minute: triple name, age, governorate, card number, and a PIN — that's it.",
  "landing.how.s1.title": "Register With Your Details",
  "landing.how.s1.desc": "Triple name, age, governorate, card number, and a PIN — no email, no hassle.",
  "landing.how.s2.title": "Receive Your Welcome Balance",
  "landing.how.s2.desc": "A 250,000 IQD demo balance + 3 ready bills to try the Ur assistant right away.",
  "landing.how.s3.title": "Let Ur Pay",
  "landing.how.s3.desc": "Open the chat and type “Pay my internet bill” — and watch the agent go to work.",

  /* ---------------------------- security --------------------------- */
  "landing.security.kicker": "Security",
  "landing.security.title": "Your Money… Guarded by a PIN",
  "landing.security.sub":
    "No payment goes through without your PIN — the same code you choose at sign-up, encrypted with PBKDF2.",
  "landing.security.s1.title": "Encrypted PIN",
  "landing.security.s1.desc":
    "Your code is stored as PBKDF2-SHA256 with a unique salt — never in plain text.",
  "landing.security.s2.title": "JWT Authorization",
  "landing.security.s2.desc":
    "Every API call is protected by a signed session token that expires automatically after 7 days.",
  "landing.security.s3.title": "Agent Guardrails",
  "landing.security.s3.desc":
    "The agent executes nothing without your PIN, and numbers are masked in the chat log before storage.",

  /* ------------------------------ cta ------------------------------ */
  "landing.cta.title1": "From Sumerian Ur…",
  "landing.cta.title2": "to your pocket.",
  "landing.cta.desc":
    "Ready to try it? Open your wallet in a minute, or sign in with the demo account and watch Ur pay an electricity bill in a single conversation.",
  "landing.cta.openWallet": "Open Your Wallet",
  "landing.cta.demo": "Try the Demo Account",

  /* ----------------------------- footer ---------------------------- */
  "landing.footer.about":
    "UrPay — an Iraqi payments platform with a smart agent. A hackathon entry (Zain Hackathon · Section 4 — Bill Pay Agent).",
  "landing.footer.copyright": "© 2026 UrPay — a hackathon demo build; all data is sample data.",
  "landing.footer.slides": "Presentation Slides (EN)",
};
