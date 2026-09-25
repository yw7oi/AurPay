/**
 * Dictionary — auth view namespace (login + register forms).
 * Naming: auth.* — ar values MUST be copied verbatim from the existing UI.
 */
export const ar: Record<string, string> = {
  /* header back link */
  "auth.back.home": "العودة للرئيسية",

  /* left brand / benefits panel */
  "auth.welcome.headline": "من أور السومرية…",
  "auth.welcome.headlineGold": "أول وكيل دفع عراقي.",
  "auth.welcome.desc": "سجّل بمعلوماتك الحقيقية — اسم ثلاثي، عمر، محافظة، بطاقة — واختَر PIN يخصك. كل عملية دفع بعدين رح تطلب هالرمز.",
  "auth.welcome.benefit1": "PIN مشفّر بـ PBKDF2 — لا يُخزّن نصًا صريحًا",
  "auth.welcome.benefit2": "كل دفعة وتحويل تتطلب تأكيد الـ PIN",
  "auth.welcome.benefit3": "أور، الوكيل الذكي، ما يعرف رمزك أبدًا",

  /* tab labels */
  "auth.login.tab": "تسجيل الدخول",
  "auth.register.tab": "حساب جديد",

  /* login form */
  "auth.login.demoFill": "تعبئة الحساب التجريبي — {last4}",
  "auth.login.submit": "ادخل محفظتك",
  "auth.login.toastTitle": "هلا {name}! 🎉",
  "auth.login.toastDesc": "تم تسجيل الدخول لمحفظة أور پاي",

  /* register form */
  "auth.register.nameHint": "الاسم الثلاثي كما في البطاقة —",
  "auth.register.nameParts": "الاسم · اسم الأب · اسم الجد/العائلة",
  "auth.register.pinNoteLabel": "مهم:",
  "auth.register.pinNoteLead": "هالـ PIN رح يُطلب عند",
  "auth.register.pinNoteEvery": "كل عملية دفع وتحويل",
  "auth.register.pinNoteTail": "— حتى من المساعد أور. ما تشاركه مع أحد.",
  "auth.register.submit": "أنشئ محفظتي — مع 250,000 د.ع هدية",
  "auth.register.toastTitle": "أهلًا {name} بمحفظة أور پاي! 🎉",
  "auth.register.toastDesc": "استلمت 250,000 د.ع رصيدًا ترحيبيًا + ٣ فواتير للتجربة",

  /* field labels */
  "auth.labels.card": "رقم البطاقة",
  "auth.labels.card16": "رقم البطاقة (16 رقمًا)",
  "auth.labels.pin": "الرمز السري PIN",
  "auth.labels.pinChoose": "اختر PIN (4–6 أرقام)",
  "auth.labels.pinConfirm": "تأكيد PIN",
  "auth.labels.firstName": "الاسم",
  "auth.labels.fatherName": "اسم الأب",
  "auth.labels.familyName": "الجد / العائلة",
  "auth.labels.age": "العمر",
  "auth.labels.city": "المحافظة (السكن)",
  "auth.labels.phone": "رقم الهاتف (اختياري)",

  /* placeholders */
  "auth.placeholders.firstName": "أحمد",
  "auth.placeholders.fatherName": "علي",
  "auth.placeholders.familyName": "حسين",
  "auth.placeholders.city": "اختر محافظتك",

  /* error toasts */
  "auth.errors.loginFailed": "فشل تسجيل الدخول",
  "auth.errors.registerFailed": "فشل التسجيل",
  "auth.errors.retry": "حاول مرة أخرى",

  /* footer note */
  "auth.common.disclaimer": "بالمتابعة أنت توافق أن هذي نسخة عرض للهاكاثون — البيانات تجريبية ولا تمثل أموالًا حقيقية.",
};

export const en: Record<string, string> = {
  /* header back link */
  "auth.back.home": "Back to Home",

  /* left brand / benefits panel */
  "auth.welcome.headline": "From Sumerian Ur…",
  "auth.welcome.headlineGold": "Iraq's first agentic payment platform.",
  "auth.welcome.desc": "Sign up with your real details — triple name, age, governorate, card — and pick a PIN of your own. Every payment will then ask for this code.",
  "auth.welcome.benefit1": "PIN encrypted with PBKDF2 — never stored in plain text",
  "auth.welcome.benefit2": "Every payment and transfer requires PIN confirmation",
  "auth.welcome.benefit3": "Ur, the smart agent, never knows your code",

  /* tab labels */
  "auth.login.tab": "Sign In",
  "auth.register.tab": "Create Account",

  /* login form */
  "auth.login.demoFill": "Autofill Demo Account — {last4}",
  "auth.login.submit": "Enter Your Wallet",
  "auth.login.toastTitle": "Welcome back, {name}! 🎉",
  "auth.login.toastDesc": "You're signed in to your UrPay wallet",

  /* register form */
  "auth.register.nameHint": "Triple name as printed on your card —",
  "auth.register.nameParts": "First · Father · Grandfather/Family",
  "auth.register.pinNoteLabel": "Important:",
  "auth.register.pinNoteLead": "This PIN will be requested for",
  "auth.register.pinNoteEvery": "every payment and transfer",
  "auth.register.pinNoteTail": "— even from the Ur assistant. Never share it with anyone.",
  "auth.register.submit": "Create My Wallet — With a 250,000 IQD Gift",
  "auth.register.toastTitle": "Welcome to UrPay, {name}! 🎉",
  "auth.register.toastDesc": "You received a 250,000 IQD welcome balance + 3 sample bills to try",

  /* field labels */
  "auth.labels.card": "Card number",
  "auth.labels.card16": "Card number (16 digits)",
  "auth.labels.pin": "PIN",
  "auth.labels.pinChoose": "Choose a PIN (4–6 digits)",
  "auth.labels.pinConfirm": "Confirm PIN",
  "auth.labels.firstName": "First name",
  "auth.labels.fatherName": "Father's name",
  "auth.labels.familyName": "Grandfather / Family",
  "auth.labels.age": "Age",
  "auth.labels.city": "Governorate (residence)",
  "auth.labels.phone": "Phone number (optional)",

  /* placeholders */
  "auth.placeholders.firstName": "Ahmed",
  "auth.placeholders.fatherName": "Ali",
  "auth.placeholders.familyName": "Hussein",
  "auth.placeholders.city": "Choose your governorate",

  /* error toasts */
  "auth.errors.loginFailed": "Sign-in failed",
  "auth.errors.registerFailed": "Registration failed",
  "auth.errors.retry": "Try again",

  /* footer note */
  "auth.common.disclaimer": "By continuing you agree that this is a hackathon demo — the data is simulated and does not represent real money.",
};
