/**
 * Interim adult first-aid guidance, not a diagnosis or a mission medical protocol.
 * Pure: no browser state, network, DOM, or mutation. Inputs are observations,
 * not authenticated sensor readings. Warning symptoms always outrank numbers.
 */
import { METRICS } from './core.js';

const pair = (en, ar) => [en, ar];
export const SYMPTOM_QUESTIONS = Object.freeze([
  Object.freeze({ key: 'breathing', label: pair('Any severe breathing difficulty or chest warning signs now?', 'هل توجد صعوبة شديدة في التنفس أو علامات خطر بالصدر الآن؟'), hint: pair('Gasping, unable to speak full words, chest tightness or pain, blue/grey lips, or sudden confusion.', 'لهاث، عدم القدرة على الكلام، ضيق أو ألم بالصدر، ازرقاق أو رمادية الشفاه، أو ارتباك مفاجئ.') }),
  Object.freeze({ key: 'stroke', label: pair('Any sudden face, arm, speech, or vision change?', 'هل حدث تغيّر مفاجئ في الوجه أو الذراع أو الكلام أو الرؤية؟'), hint: pair('Face drooping, arm weakness, speech difficulty, or sudden vision changes—even if they have already stopped.', 'تدلّي الوجه، ضعف الذراع، صعوبة الكلام، أو تغيّر مفاجئ في الرؤية، حتى لو اختفت الأعراض بالفعل.') }),
  Object.freeze({ key: 'unresponsive', label: pair('Is the person unresponsive AND not breathing normally?', 'هل الشخص لا يستجيب ولا يتنفس بشكل طبيعي معًا؟'), hint: pair('Both conditions together. Gasping is not normal breathing. If unsure, seek emergency help and follow the dispatcher.', 'الشرطان معًا. الشهقات ليست تنفسًا طبيعيًا. عند الشك اطلب مساعدة الطوارئ واتبع تعليمات المُرسل.') }),
  Object.freeze({ key: 'unconsciousBreathing', label: pair('Is the person unresponsive BUT breathing normally?', 'هل الشخص لا يستجيب لكنه يتنفس بشكل طبيعي؟'), hint: pair('They cannot be woken, but breathing appears normal. This still needs emergency help. Tell the dispatcher if you are unsure about the breathing.', 'لا يمكن إيقاظه، لكن التنفس يبدو طبيعيًا. الحالة ما زالت تحتاج الطوارئ. أخبر مُرسل الطوارئ إذا كنت غير متأكد من التنفس.') })
]);

const REFERENCES = Object.freeze({
  breathing: { label: 'NHS · Shortness of breath', url: 'https://www.nhs.uk/symptoms/shortness-of-breath/' },
  stroke: { label: 'NHS · Stroke symptoms', url: 'https://www.nhs.uk/conditions/stroke/symptoms/' },
  cpr: { label: 'St John Ambulance · CPR', url: 'https://www.sja.org.uk/first-aid-advice/cpr/' },
  recovery: { label: 'St John Ambulance · Recovery position', url: 'https://www.sja.org.uk/first-aid-advice/recovery-position/' },
  oxygen: { label: 'MedlinePlus · Pulse oximetry', url: 'https://medlineplus.gov/lab-tests/pulse-oximetry/' },
  bp: { label: 'American Heart Association · Blood pressure readings', url: 'https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings' },
  cold: { label: 'NHS · Hypothermia', url: 'https://www.nhs.uk/conditions/hypothermia/' },
  fever: { label: 'NHS · Adult fever', url: 'https://www.nhs.uk/symptoms/fever-in-adults/' },
  highFever: { label: 'MedlinePlus · Fever', url: 'https://medlineplus.gov/ency/article/003090.htm' },
  heart: { label: 'American Heart Association · Resting heart rate', url: 'https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates' },
  sleep: { label: 'CDC · Adult sleep', url: 'https://www.cdc.gov/sleep/about/index.html' },
  wellbeing: { label: 'NASA · Human spaceflight hazards', url: 'https://www.nasa.gov/hrp/hazards/' }
});
const LEVEL_WEIGHT = { info: 0, review: 1, urgent: 2, emergency: 3 };

/**
 * @param {object|null} record Canonical core.js observation, or null.
 * @param {object} answers Each symptom key: 'yes', 'no', or 'unknown'.
 * @param {number} now Epoch milliseconds; injectable for deterministic tests.
 */
export function buildGuidance(record = null, answers = {}, now = Date.now()) {
  answers = answers && typeof answers === 'object' ? answers : {};
  const response = key => ['yes', 'no'].includes(answers[key]) ? answers[key] : 'unknown';
  const symptomsComplete = SYMPTOM_QUESTIONS.every(q => response(q.key) !== 'unknown');
  const allSymptomsNo = SYMPTOM_QUESTIONS.every(q => response(q.key) === 'no');
  const positiveSymptoms = SYMPTOM_QUESTIONS.filter(q => response(q.key) === 'yes').map(q => q.key);
  const symptomEmergency = positiveSymptoms.length > 0;
  const raw = record?.values && typeof record.values === 'object' ? record.values : {};
  const values = Object.fromEntries(Object.keys(METRICS).filter(key => typeof raw[key] === 'number' && Number.isFinite(raw[key])).map(key => [key, raw[key]]));
  const observations = Object.entries(values).map(([key, value]) => ({ key, value, unit: METRICS[key].unit }));
  const has = key => Object.prototype.hasOwnProperty.call(values, key);
  const stamp = typeof record?.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  const recordTimestamp = Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
  const historical = Number.isFinite(stamp) && now - stamp > 24 * 60 * 60 * 1000;
  let level = 'info';
  const reasonCodes = [], sources = [], steps = [], avoid = [];
  const elevate = next => { if (LEVEL_WEIGHT[next] > LEVEL_WEIGHT[level]) level = next; };
  const reason = code => { if (!reasonCodes.includes(code)) reasonCodes.push(code); };
  const source = key => { if (!sources.some(item => item.url === REFERENCES[key].url)) sources.push({ ...REFERENCES[key] }); };
  const step = (enTitle, arTitle, enBody, arBody) => steps.push({ title: pair(enTitle, arTitle), body: pair(enBody, arBody) });

  if (!symptomsComplete) reason('symptoms-unknown');
  if (historical) reason('record-historical');
  if (record && !recordTimestamp) reason('record-timestamp-unknown');
  if (!observations.length) reason('no-observations');
  for (const key of positiveSymptoms) {
    elevate('emergency'); reason(`symptom-${key}`);
    source(key === 'unresponsive' ? 'cpr' : key === 'unconsciousBreathing' ? 'recovery' : key);
  }

  const veryLowOxygen = has('oxygen') && values.oxygen <= 88;
  const lowOxygen = has('oxygen') && values.oxygen > 88 && values.oxygen <= 92;
  const cold = has('temp') && values.temp < 35;
  const highFever = has('temp') && values.temp >= 40.6;
  const veryHighBP = (has('sys') && values.sys >= 180) || (has('dia') && values.dia >= 120);
  if (veryLowOxygen) { elevate('emergency'); reason('oxygen-emergency'); source('oxygen'); }
  else if (lowOxygen) { elevate('urgent'); reason('oxygen-urgent'); source('oxygen'); }
  else if (has('oxygen') && values.oxygen < 95) { elevate('review'); reason('oxygen-review'); source('oxygen'); }
  if (cold) { elevate('emergency'); reason('temperature-low'); source('cold'); }
  else if (highFever) { elevate('urgent'); reason('temperature-high'); source('highFever'); }
  else if (has('temp') && values.temp >= 38) { elevate('review'); reason('temperature-review'); source('fever'); }
  if (veryHighBP) { elevate('urgent'); reason('blood-pressure-urgent'); source('bp'); }
  else if ((has('sys') && values.sys >= 130) || (has('dia') && values.dia >= 80)) { elevate('review'); reason('blood-pressure-review'); source('bp'); }
  if (record?.context === 'resting' && has('heart') && (values.heart < 60 || values.heart > 100)) { elevate('review'); reason('heart-review'); source('heart'); }
  if (has('sleep') && values.sleep < 7) { elevate('review'); reason('sleep-review'); source('sleep'); }
  if (has('mood') && values.mood <= 2) { elevate('review'); reason('mood-review'); source('wellbeing'); }
  if (['glucose', 'hrv', 'eda'].some(has)) reason('uninterpreted-observations');

  const oldOnly = historical && !symptomEmergency;
  if (level === 'emergency') {
    // No recheck delay or drinking advice is emitted in any emergency branch.
    step('Get emergency help now', 'اطلب مساعدة الطوارئ الآن',
      oldOnly ? 'This past reading cannot establish your current condition. If the problem is current or unresolved, call local emergency services on Earth or the crew medical lead under the mission emergency protocol now. Do not wait for this form or another measurement.' : 'Call local emergency services on Earth or the crew medical lead under the mission emergency protocol now. Do not wait to finish this form or recheck a device. Ask another person to call if possible.',
      oldOnly ? 'القراءة القديمة لا تحدد حالتك الآن. إذا كانت المشكلة مستمرة أو لم تُحل، اتصل بطوارئ بلدك على الأرض أو مسؤول طب الطاقم حسب بروتوكول طوارئ المهمة الآن. لا تنتظر استكمال النموذج أو قياسًا آخر.' : 'اتصل بطوارئ بلدك على الأرض أو مسؤول طب الطاقم حسب بروتوكول طوارئ المهمة الآن. لا تنتظر استكمال النموذج أو إعادة فحص الجهاز. اطلب من شخص آخر الاتصال إن أمكن.');
    if (response('unresponsive') === 'yes' && response('unconsciousBreathing') === 'yes') {
      step('Clarify breathing with the emergency dispatcher', 'تحقّق من التنفس مع مُرسل الطوارئ',
        'The answers conflict about normal breathing. Put the emergency call on speaker and tell the dispatcher. Check breathing with their help. Only if the person is unresponsive and not breathing normally, start CPR and follow dispatcher and AED instructions. If normal breathing is present, follow airway and safe recovery-position instructions instead. Stop CPR if normal breathing returns, help takes over, or the dispatcher directs you.',
        'الإجابات متعارضة بخصوص التنفس الطبيعي. فعّل مكبر الصوت وأخبر مُرسل الطوارئ وتحقق من التنفس بمساعدته. فقط إذا كان الشخص لا يستجيب ولا يتنفس طبيعيًا، ابدأ الإنعاش واتبع تعليمات المُرسل وجهاز الصدمات. إذا كان التنفس طبيعيًا فاتبع تعليمات مجرى الهواء ووضع الإفاقة الآمن بدلًا من ذلك. أوقف الإنعاش إذا عاد التنفس الطبيعي أو تولّى المختصون المساعدة أو وجّهك المُرسل.');
    } else if (response('unresponsive') === 'yes') {
      step('Follow dispatcher CPR and AED instructions', 'اتبع تعليمات الإنعاش واستخدام جهاز الصدمات',
        'The person is unresponsive and not breathing normally. Put the emergency call on speaker, start CPR and follow the dispatcher’s instructions. Ask someone to bring an AED if available and follow its voice prompts. Continue until normal breathing returns, help takes over, or the dispatcher tells you otherwise.',
        'الشخص لا يستجيب ولا يتنفس طبيعيًا. فعّل مكبر الصوت بمكالمة الطوارئ وابدأ الإنعاش القلبي الرئوي حسب تعليمات المُرسل. اطلب إحضار جهاز صدمات آلي إن وُجد واتبع تعليماته الصوتية. استمر حتى يعود التنفس الطبيعي أو يتولى المختصون المساعدة أو يوجّهك المُرسل بخلاف ذلك.');
    } else if (response('unconsciousBreathing') === 'yes') {
      step('Follow dispatcher airway and recovery-position guidance', 'اتبع تعليمات مجرى الهواء ووضع الإفاقة',
        'Tell the emergency dispatcher that the person is unresponsive but breathing normally. Follow their instructions to keep the airway open and use the recovery position if safe. Report any suspected injury and do not force movement. Stay with the person and monitor breathing. CPR is not indicated while breathing remains normal; if normal breathing stops, follow dispatcher instructions for CPR and an AED.',
        'أخبر مُرسل الطوارئ أن الشخص لا يستجيب لكنه يتنفس طبيعيًا. اتبع تعليماته لإبقاء مجرى الهواء مفتوحًا ووضع الإفاقة إذا كان آمنًا. أخبره بأي إصابة مشتبه بها ولا تفرض حركة. ابقَ مع الشخص وراقب التنفس. لا يُجرى الإنعاش أثناء استمرار التنفس الطبيعي؛ إذا توقف التنفس الطبيعي فاتبع تعليمات المُرسل للإنعاش وجهاز الصدمات.');
    } else {
      step('Stop exertion and stay with someone', 'أوقف المجهود وخليك مع شخص آخر',
        'If the concern is current, stop activity and rest in a safe, supported position. Ask someone to stay with you and follow the emergency team’s instructions. Do not drive yourself to medical care.',
        'إذا كانت المشكلة موجودة الآن، أوقف النشاط واسترح في وضع آمن ومدعوم. اطلب بقاء شخص معك واتبع تعليمات فريق الطوارئ. لا تقد السيارة بنفسك للوصول للرعاية.');
    }
    if (veryLowOxygen) step('Check sensor placement only while help is being arranged', 'تحقّق من تثبيت الحساس فقط أثناء ترتيب المساعدة',
      'If the concern is current and another person can check without delaying help, confirm the sensor is positioned correctly and keep the hand warm and still. Follow the device instructions. Do not interrupt or postpone the emergency call for a device check; an apparently improved number does not cancel warning symptoms.',
      'إذا كانت المشكلة حالية ويمكن لشخص آخر الفحص دون تأخير المساعدة، تأكد من تثبيت الحساس بشكل صحيح وحافظ على اليد دافئة وثابتة. اتبع تعليمات الجهاز. لا تقطع مكالمة الطوارئ أو تؤجلها لفحص الجهاز؛ تحسّن الرقم ظاهريًا لا يلغي علامات الخطر.');
    if (response('stroke') === 'yes') step('Report when the signs started', 'اذكر وقت بداية العلامات',
      'Tell the emergency team when the sudden face, arm, speech, or vision changes began or when the person was last known well. Signs that stopped still need emergency assessment.',
      'اذكر لفريق الطوارئ وقت بداية التغيّر المفاجئ بالوجه أو الذراع أو الكلام أو الرؤية، أو آخر وقت كان فيه الشخص بحالته المعتادة. اختفاء العلامات لا يلغي الحاجة لتقييم طارئ.');
    if (cold) {
      step('Protect from further cooling', 'احمِ الشخص من مزيد من البرودة',
        'If this is current, move to shelter if safe, replace wet clothing with dry coverings, and wrap in a dry blanket, including the head. Keep any necessary CPR and emergency assistance first. Do not delay help to confirm the temperature.',
        'إذا كانت الحالة مستمرة، انتقل لمأوى إن كان آمنًا، واستبدل الملابس المبللة بأغطية جافة، ولفّ الجسم والرأس ببطانية جافة. تظل الأولوية لأي إنعاش مطلوب والمساعدة الطارئة. لا تؤخر المساعدة لتأكيد الحرارة.');
      avoid.push(pair('Do not use a hot bath or direct heat, rub the body, or give alcohol.', 'لا تستخدم حمامًا ساخنًا أو حرارة مباشرة، ولا تفرك الجسم أو تعطِ كحولًا.'));
    }
  } else {
    if (level === 'urgent') step('Contact medical help promptly', 'تواصل سريعًا مع المسؤول الطبي',
      oldOnly ? 'This past reading does not establish your current condition. If it is current or unresolved, promptly contact your clinician or crew medical lead. If any warning symptom is present now, use emergency services or the mission emergency protocol immediately.' : 'Promptly contact your clinician or crew medical lead. If any warning symptom is present now, use emergency services or the mission emergency protocol immediately. Do not postpone contact while collecting more measurements.',
      oldOnly ? 'القراءة القديمة لا تحدد حالتك الآن. إذا كانت المشكلة مستمرة أو لم تُحل فتواصل سريعًا مع طبيبك أو مسؤول طب الطاقم. عند وجود أي عرض خطر الآن، استخدم الطوارئ أو بروتوكول طوارئ المهمة فورًا.' : 'تواصل سريعًا مع طبيبك أو مسؤول طب الطاقم. عند وجود أي عرض خطر الآن، استخدم الطوارئ أو بروتوكول طوارئ المهمة فورًا. لا تؤجل التواصل لجمع قياسات إضافية.');
    else step('Check current symptoms and arrange review', 'راجع الأعراض الحالية ورتّب المتابعة',
      level === 'review' ? 'Review this observation with your clinician or crew medical lead. If severe breathing difficulty, chest warning signs, sudden face/arm/speech/vision changes, or unresponsiveness with either normal or abnormal breathing occur, seek emergency help immediately.' : 'No automatic escalation was identified from the available numbers. This is not medical clearance: missing measurements and unknown symptoms have not been assessed. Seek medical advice for symptoms or concerns, regardless of a device reading.',
      level === 'review' ? 'راجع التسجيل مع طبيبك أو مسؤول طب الطاقم. إذا ظهرت صعوبة شديدة في التنفس أو علامات خطر بالصدر أو تغيّر مفاجئ بالوجه أو الذراع أو الكلام أو الرؤية، أو غياب استجابة مع تنفس طبيعي أو غير طبيعي، اطلب الطوارئ فورًا.' : 'لم تحدد الأرقام المتاحة تصعيدًا آليًا. هذا ليس تصريحًا طبيًا بالسلامة: القياسات المفقودة والأعراض غير المعروفة لم يتم تقييمها. اطلب المشورة الطبية عند وجود أعراض أو قلق مهما كانت قراءة الجهاز.');

    if (!symptomsComplete) step('Unknown does not mean absent', 'غير معروف لا يعني غير موجود',
      'One or more symptom answers are unknown. Check whether any warning signs are present while arranging appropriate medical contact. Do not assume there are no symptoms and do not delay help to complete the questions.',
      'إجابة واحدة أو أكثر عن الأعراض غير معروفة. تحقق من وجود علامات خطر أثناء ترتيب التواصل الطبي المناسب. لا تفترض غياب الأعراض ولا تؤخر المساعدة لاستكمال الأسئلة.');

    if (lowOxygen || reasonCodes.includes('oxygen-review')) step('Check the sensor without delaying contact', 'تحقق من الحساس دون تأخير التواصل',
      'If this reading is current, keep the hand warm and still, check sensor placement and wait only for the device to show a stable reading while medical contact is being arranged. Follow the device instructions. Skin pigmentation, cold skin, circulation and nail products can affect accuracy; symptoms take priority.',
      'إذا كانت القراءة حالية، اجعل اليد دافئة وثابتة وتحقق من تثبيت الحساس وانتظر استقرار قراءة الجهاز فقط أثناء ترتيب التواصل الطبي. اتبع تعليمات الجهاز. لون الجلد والبرودة والدورة الدموية ومنتجات الأظافر قد تؤثر على الدقة؛ الأعراض لها الأولوية.');
    if (veryHighBP) {
      step('Understand the blood-pressure trigger', 'افهم حدّ تنبيه الضغط',
        'The app conservatively prompts at 180 mmHg systolic OR 120 mmHg diastolic or above. The AHA source uses higher than 180 and/or 120. Either number matters; a single reading does not diagnose a condition.',
        'التطبيق يصعّد احتياطيًا عند ١٨٠ ملم زئبق انقباضي أو ١٢٠ انبساطي أو أكثر. مرجع جمعية القلب الأمريكية يستخدم أعلى من ١٨٠ و/أو ١٢٠. كل رقم مهم؛ قراءة واحدة لا تشخّص حالة.');
      if (allSymptomsNo) step('Repeat only while arranging medical contact', 'أعد القياس فقط أثناء ترتيب التواصل الطبي',
        'Only because all warning-symptom question answers are explicitly no: if the reading is current, you may wait at least 1 minute and repeat blood pressure while arranging medical contact. If it remains very high, urgent medical contact is needed. Any new warning symptom means emergency help now; do not wait to repeat.',
        'فقط لأن إجابات كل أسئلة علامات الخطر هي «لا»: إذا كانت القراءة حالية يمكنك الانتظار دقيقة واحدة على الأقل ثم إعادة الضغط أثناء ترتيب التواصل الطبي. إذا ظل مرتفعًا جدًا فالتواصل الطبي العاجل مطلوب. ظهور أي علامة خطر يستلزم الطوارئ فورًا؛ لا تنتظر إعادة القياس.');
    } else if (reasonCodes.includes('blood-pressure-review')) step('Record blood pressure in context', 'سجّل ضغط الدم مع ظروف القياس',
      'Use an approved cuff and the measurement method recommended by your medical team. Record both pressure numbers and the time. Discuss repeated changes rather than treating a single reading as a diagnosis.',
      'استخدم جهاز ضغط معتمدًا وطريقة القياس التي يوصي بها الفريق الطبي. سجّل الرقمين والوقت. ناقش التغيّرات المتكررة بدل اعتبار قراءة واحدة تشخيصًا.');
    if (highFever || reasonCodes.includes('temperature-review')) {
      step('Rest and record the temperature method', 'استرح وسجّل طريقة قياس الحرارة',
        'If this is current, stop strenuous activity, rest and note the thermometer method and symptoms for your medical contact. A reading at or above 40.6°C needs prompt clinician contact; do not wait for it to rise further.',
        'إذا كانت الحالة حالية، أوقف النشاط المجهد واسترح وسجّل طريقة استخدام الترمومتر والأعراض لإبلاغ المسؤول الطبي. القراءة عند ٤٠٫٦°م أو أكثر تحتاج تواصلًا طبيًا سريعًا؛ لا تنتظر زيادة الحرارة.');
      if (allSymptomsNo) step('Fluids only when alert and swallowing safely', 'السوائل فقط مع اليقظة والبلع الآمن',
        'Only if fully alert, able to swallow normally and there are no warning symptoms: you may sip water while resting, within any fluid limits already prescribed by your clinician. If alertness or swallowing is uncertain, do not drink and ask the medical team for guidance.',
        'فقط إذا كنت يقظًا تمامًا وتستطيع البلع طبيعيًا ولا توجد علامات خطر: يمكنك رشف الماء أثناء الراحة في حدود أي قيود سوائل وصفها طبيبك مسبقًا. إذا كانت اليقظة أو القدرة على البلع غير مؤكدة، لا تشرب واطلب توجيه الفريق الطبي.');
    }
    if (reasonCodes.includes('heart-review')) step('Explain the heart-rate context', 'وضّح ظروف قياس النبض',
      'The broad resting adult reference is 60–100 bpm. Fitness, medicines and personal baseline affect it. Tell the medical lead that this was recorded at rest, and report symptoms and changes from your usual readings.',
      'المرجع العام لنبض البالغين في الراحة ٦٠–١٠٠ نبضة/دقيقة. اللياقة والأدوية والخط الأساسي الشخصي يؤثرون عليه. أخبر المسؤول الطبي أن القياس في الراحة واذكر الأعراض والتغيّر عن المعتاد.');
    if (reasonCodes.includes('sleep-review')) step('Plan a sleep check-in', 'رتّب متابعة النوم',
      'Record actual sleep and interruptions, and discuss persistent short sleep or fatigue with the crew or clinician. At least seven hours is a broad adult reference, not an individual prescription.',
      'سجّل النوم الفعلي والانقطاعات وناقش قلة النوم أو الإرهاق المستمر مع الطاقم أو الطبيب. سبع ساعات على الأقل مرجع عام للبالغين، وليس وصفة فردية.');
    if (reasonCodes.includes('mood-review')) step('Ask for a private wellbeing check-in', 'اطلب متابعة خاصة لحالتك النفسية',
      'Consider speaking with a trusted crew member or designated support/medical lead. The personal 1–5 mood rating is not a clinical assessment and does not determine a diagnosis.',
      'فكّر في الحديث مع فرد موثوق من الطاقم أو مسؤول الدعم أو الطب. تقييم المزاج الشخصي من ١ إلى ٥ ليس تقييمًا طبيًا ولا يحدد تشخيصًا.');
    if (reasonCodes.includes('uninterpreted-observations')) step('Keep context for uninterpreted measurements', 'احتفظ بسياق القياسات التي لا تُفسّر آليًا',
      'Glucose, HRV and EDA are recorded without automatic treatment advice. Meal timing, medicines, device method and individual baseline matter. Ask your clinician to interpret them and follow an existing personal plan.',
      'السكر وتباين النبض والنشاط الكهربي للجلد تُسجّل بدون نصائح علاج آلية. توقيت الأكل والأدوية وطريقة الجهاز وخط الأساس الشخصي مهمون. اطلب تفسير الطبيب واتبع الخطة الشخصية الموجودة مسبقًا.');
  }

  avoid.push(pair('Do not start, stop, or change medicines or oxygen settings unless a clinician explicitly instructs you.', 'لا تبدأ أو توقف أو تغيّر الأدوية أو إعدادات الأكسجين إلا بتوجيه صريح من الطبيب.'));
  if (level === 'emergency') avoid.push(pair('Do not drive yourself, exert yourself, or delay emergency help to complete this tool.', 'لا تقد السيارة بنفسك أو تبذل مجهودًا أو تؤخر الطوارئ لاستكمال الأداة.'));
  if (!sources.length) { source('breathing'); source('stroke'); }
  const titles = {
    emergency: pair('Emergency help takes priority', 'المساعدة الطارئة لها الأولوية'),
    urgent: pair('Arrange prompt medical contact', 'رتّب تواصلًا طبيًا عاجلًا'),
    review: pair('Medical review and careful observation', 'مراجعة طبية وملاحظة منتبهة'),
    info: pair('Check symptoms and keep the context', 'راجع الأعراض واحتفظ بسياق القياس')
  };
  let summary = level === 'emergency'
    ? pair('A current warning symptom or a recorded emergency reference needs immediate attention. These steps support getting help; they do not diagnose the cause.', 'عرض خطر حالي أو قراءة عند مرجع طارئ يحتاجان انتباهًا فوريًا. الخطوات تدعم طلب المساعدة ولا تشخّص السبب.')
    : pair('These are interim adult Earth-based steps while medical review is arranged. They do not replace your personal care plan or a mission medical protocol.', 'دي خطوات مؤقتة للبالغين على الأرض أثناء ترتيب المراجعة الطبية. لا تحل محل خطتك الشخصية أو بروتوكول طب المهمة.');
  if (oldOnly) summary = pair('Historical observation: this reading is more than 24 hours old and cannot establish your current condition. If the concern is current or unresolved, use the help level shown; current symptoms always take priority.', 'تسجيل قديم: القراءة مرّ عليها أكثر من ٢٤ ساعة ولا تحدد حالتك الآن. إذا كانت المشكلة مستمرة أو لم تُحل، اتبع مستوى المساعدة المعروض؛ الأعراض الحالية لها الأولوية.');
  else if (historical && symptomEmergency) summary = pair('The measurement is historical, but a warning symptom was reported now. Get emergency help for the current symptom regardless of the old numbers.', 'القياس قديم، لكن تم الإبلاغ عن عرض خطر الآن. اطلب الطوارئ للعرض الحالي مهما كانت الأرقام القديمة.');
  else if (record && !recordTimestamp) summary = pair('The observation timestamp is unavailable, so these numbers cannot establish the current state. Follow current symptoms and use the indicated help level if the concern is current or unresolved.', 'وقت التسجيل غير متاح، لذلك الأرقام لا تحدد الحالة الحالية. اتبع الأعراض الحالية ومستوى المساعدة المعروض إذا كانت المشكلة مستمرة أو لم تُحل.');

  return { level, title: titles[level], summary, symptomsComplete, historical, recordTimestamp, steps, avoid, sources, observations, reasonCodes };
}
