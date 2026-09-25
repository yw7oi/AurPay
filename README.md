# UrPay — أور پاي 🇮🇶

**Iraqi Agentic Payments Platform** — مشاركة مسابقة زين للهاكاثون (السكشن الرابع — Bill Pay Agent).

منصة دفع عراقية بمساعد ذكي اسمه **أور** (مستوحى من مدينة أور السومرية — أول مكان سُجّل فيه تبادل في التاريخ) يدفع فواتيرك ويحوّل أموالك من محادثة واحدة، مبني على **Groq `gpt-oss-120b`** مع Function Calling حقيقي.

---

## ⚡ التشغيل السريع (ويندوز)

1. ثبّت [Python 3.10+](https://python.org) و [Node.js 18+](https://nodejs.org)
2. دبل كلك على **`start.bat`**
3. يتفتح المتصفح تلقائيًا على `http://localhost:3000`

**حساب التجربة:**

| البطاقة | PIN |
|---|---|
| `4539 1234 1234 1234` | `1234` |

> أي مستخدم من الـ 100 مستخدم العراقي المزروعين بالداتابيس يدخل بنفس الـ PIN `1234`.

### تشغيل الوكيل على Groq الحقيقية (اختياري)

```bat
set GROQ_API_KEY=gsk_...
start.bat
```

بدون المفتاح، الوكيل يعمل بطبقتين بديلتين تلقائيًا (جسر z-ai ثم المحرك المحلي) — الديمو يشتغل دائمًا.

---

## 🧱 البنية

```
my-project/
├── start.bat                        # ← تشغيل كلشي بضغطة وحدة (ويندوز)
├── db/urpay.db                      # قاعدة SQLite (تُزرع تلقائيًا)
├── mini-services/urpay-backend/     # الباكند — FastAPI (بورت 8000)
│   └── app/
│       ├── main.py                  # التطبيق + CORS + lifespan
│       ├── models.py                # users, bills, transactions, transfers, agent_msgs
│       ├── seed.py                  # 100 مستخدم عراقي واقعي + فواتير + معاملات
│       ├── security.py              # PIN PBKDF2 + JWT
│       ├── routers/                 # auth / wallet (bills+transfers) / agent / public
│       └── agent/                   # محرك الوكيل: providers (Groq→z-ai→محلي) + tools
├── src/                             # الواجهة — Next.js 16 (بورت 3000)
│   ├── app/page.tsx                 # SPA: Landing → Auth → Dashboard
│   ├── app/api/[...path]/route.ts   # بروكسي شفاف → FastAPI :8000
│   ├── app/api/internal/llm/route.ts# جسر z-ai (يستخدمه باكند الوكيل كطبقة بديلة)
│   └── components/urpay/            # landing / auth / dashboard / agent / …
└── public/UrPay-Slides.pptx         # سلايدات العرض (English) للمسابقة
```

## 🤖 وكيل الدفع (Bill Pay Agent)

سلسلة المزودات: **Groq `openai/gpt-oss-120b`** (native tool calling) ← **جسر z-ai** ← **محرك عربي محلي** (يعمل دائمًا).

الأدوات المتاحة للوكيل:

| الأداة | الوظيفة |
|---|---|
| `get_balance` | استعلام الرصيد |
| `list_bills` | عرض الفواتير (غير مدفوعة/مدفوعة) |
| `pay_bill(bill_id, pin)` | دفع فاتورة — **يتطلب PIN** |
| `search_users` | بحث عن مستلمي التحويل |
| `transfer_money(card, amount, pin)` | حوالة — **تتطلب PIN** |
| `recent_transactions` / `get_profile` | السجل والملف |

## 🛡 الأمان

- PIN يُخزّن **PBKDF2-SHA256** بملح فردي — لا نص صريح أبدًا
- جلسات **JWT** موقّعة (7 أيام)
- **كل** دفعة وتحويل — من الواجهة أو من الوكيل — تتطلب PIN
- الـ PIN يُقنَّع (••••) في سجل محادثات الوكيل

## 🔌 أهم الـ Endpoints

```
POST /api/auth/register     {first_name, father_name, family_name, age, city, card_number, pin}
POST /api/auth/login        {card_number, pin}
POST /api/auth/change-pin   {current_pin, new_pin}
GET  /api/bills?status=     unpaid|paid|all
POST /api/bills/pay         {bill_id, pin}
POST /api/bills/simulate    {category, biller_code, subscriber_no, amount}
GET  /api/transactions · /api/transactions/export (CSV)
GET  /api/users/search?q=
POST /api/transfer/request  {receiver_card, amount}
POST /api/transfer/confirm/{id}  {pin}
POST /api/topup             {amount, pin}
GET  /api/analytics         90-day categories + 6-month trend
GET  /api/budgets           per-category monthly limits + live progress
PUT  /api/budgets           {category, monthly_limit} — 0 removes
GET  /api/notifications     + /read-all, /{id}/read
POST /api/agent/chat        {message}
POST /api/agent/chat/stream SSE (tool steps + token streaming)
GET  /api/stats · /api/billers · /api/cities
```

**أدوات الوكيل الذكي (أور):** get_balance · list_bills · pay_bill (hint-guarded) ·
search_users · transfer_money · recent_transactions · topup_wallet · get_profile · set_budget ·
get_spending (تحليل الصرف الشهري + حالة الميزانيات)

**إضافات حديثة:**
- 🌐 **واجهة ثنائية اللغة (عربي ⇄ English)** — زر تبديل اللغة في الشريط العلوي والحساب،
  مع تبديل الاتجاه RTL/LTR تلقائيًا وحفظ الاختيار. الوكيل يرد بلغة رسالة المستخدم.
- 📊 **وعي الوكيل بالميزانيات** — بيانات الصرف الشهرية ضمن سياق الوكيل حتى ينبهك قبل تجاوز الحد.
- ✨ لمسات تفاعلية: اهتزاز حقل PIN عند الخطأ، إيقاف شريط الجهات عند التمرير، تاريخ اليوم في البطاقة.

## 🎨 الهوية

- **الخطوط:** Inter Tight 700 (العناوين والأرقام) + IBM Plex Sans Arabic (النصوص)
- **الألوان:** زمردي عميق `#0E7A5C` + ذهب بلاد الرافدين `#CBA135` + ورقي دافئ
- **الشعار:** مربع زمردي بحرف U ذهبي ونقطة شمس

---

> ⚠️ نسخة عرض للهاكاثون — كل البيانات تجريبية ولا تمثل أموالًا حقيقية.
