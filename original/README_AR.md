# CosmoVital — Integrated Frontend

**الحالة:** Frontend كامل للتجربة والعرض، بدون Backend أو API أو ملفات NASA حقيقية.

## تشغيل الموقع

1. فك ضغط ZIP بالكامل، ولا تنقل ملفات JavaScript من مكانها.
2. افتح فولدر `CosmoVital_Integrated_Frontend` في VS Code.
3. شغّل **Live Preview** أو **Live Server** وافتح `index.html`.
4. اضغط Explore health dashboard لفتح `dashboard.html`.
5. لا تفتح `dashboard.html` كملف `file://` في المتصفح؛ الاستيراد بـ `type="module"` يحتاج سيرفر محلي.

## طريقة التجربة

- **Next demo sample:** ينتقل بين 3 مجموعات قراءات افتراضية، ويضيف نقطة للرسوم.
- **Reset demo:** يسترجع أول قراءة وتاريخ الرسوم الأولي.
- **Daily health check-in:** أدخل نبضك وأكسجينك وساعات نومك ودرجة حرارتك كأمثلة، واضغط Save. ضغط الدم، السكر، المزاج، HRV وEDA اختياريون.
- **Trends:** 5 رسوم من ملفات زميلك `health-charts.js` / `.css`. مكتبة Chart.js تُستخدم إذا اتصل الإنترنت، وفي حالة عدم توفرها يعمل الرسم الاحتياطي المحلي `vendor/chart-fallback.js`.
- **Request crew review:** ينشئ طلب مراجعة داخل واجهة التنبيهات المحلية فقط، ولا يرسل شيء لأي شخص.
- **Load example alerts:** يجرب حالات التنبيه؛ **Simulate resolution** يغير حالة مثال من Active إلى Resolved. زر Acknowledge لا يعني Resolve.
- **Mission scenario:** يغير النص التثقيفي عن بيئة الرحلة فقط.

## ربط الملفات

| الملف | الوظيفة |
|---|---|
| `index.html` | الصفحة الرئيسية وتعريف بالمشروع ومخاطر الفضاء |
| `dashboard.html` | الكروت والنموذج والمخططات والتنبيهات والإرشادات |
| `stylee.css` | الهوية البصرية والـResponsive Layout |
| `script.js` | منطق العرض والإدخال والأزرار والتوصيل بموديولات زميلك |
| `health-charts.js` | كود زميلك الأصلي الخاص بالرسم؛ مستورد مباشرة | 
| `health-charts.css` | تنسيق الموديول الأصلي |
| `alert-manager.js` | كود زميلك الأصلي الخاص بتنبيهات Active/Resolved/Acknowledge |
| `alert-manager.css` | تنسيق التنبيهات الأصلي |
| `vendor/chart-fallback.js` | بديل رسوم محلي لو Chart.js CDN مش متاح |
| `reference_demos/` | صفحات العرض الأصلية اللي كانت منفصلة، محفوظة للرجوع إليها |
| `original_backup/` | النسخة القديمة من مشروعك محفوظة بدون تعديل |
| `DATA_CONTRACT.md` | شكل الداتا المتوقع لمناقشته عند وصول الـDatasets |

## التعديل والدمج في `script.js`

1. `initialSamples` = 3 عينات Demo للكروت.
2. `makeHistory()` = تاريخ افتراضي متولد للرسوم، ليس من NASA.
3. `initializeCharts()` = اتصال مباشر مع موديول زميلك: `createHealthCharts()`.
4. `initializeAlerts()` = إنشاء `HealthAlertManager()` بالموديول الأصلي.
5. `renderReadings()` = يعرض الأرقام وحالة Demo وأشرطة العرض.
6. `handleCheckin()` = يستقبل بيانات المستخدم ويضيف نقاط للرسوم.
7. `loadDemoAlerts()` / `resolveDemoAlert()` = أمثلة للـAlert Manager.
8. `requestCrewReview()` = طلب محلي للتجربة، لا يُرسل لطبيب.
9. `start()` = يربط كل الأزرار فور تحميل الصفحة.

## مهم في العرض على المقيمين

- **القيم الموجودة بالفعل ليست بيانات ناسا، ولا بيانات رائد فضاء حقيقية.**
- **البرنامج لا يُشخّص، ولا يُحدد تلقائيًا Normal/Critical، ولا ينصح بعلاج.**
- إرشادات التطبيق عامة للاستخدام تحت إشراف فريق طبي/بروتوكول المهمة.
- أي موعد لإتاحة ملفات البيانات الجديدة يحتاج تأكيدًا من صفحة Resources الرسمية؛ لم يتم توصيل Dataset محدد حتى الآن.
- البحث العلمي الذي يستند إليه الوصف: https://www.nasa.gov/hrp/hazards/
- التحدي: https://www.spaceappschallenge.org/2026/challenges/create-health-monitoring-software-for-astronauts-on-space-missions/

## عند وصول الداتا

راجع `DATA_CONTRACT.md` مع الفريق قبل كتابة Backend: نوع الملف، الوحدات، التوقيت، مصدر القياس، الصلاحيات، والمعنى الطبي. بعد اعتماد المخطط يمكن توصيل بيانات حقيقية بدل مولدات الـDemo، من غير إعادة بناء الواجهة.
