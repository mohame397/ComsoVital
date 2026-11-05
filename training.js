/**
 * Fictional interface-workflow training. No patient model, clinical diagnosis,
 * treatment, health-outcome prediction, actual communications, or persistence.
 * Context references (not validation or endorsement of this simulator):
 * NASA communication delay: https://ntrs.nasa.gov/citations/20230012950
 * NASA Earth-independent support:
 * https://www.nasa.gov/centers-and-facilities/ames/ames-science/ames-space-biosciences/a-clinical-decision-support-system-for-earth-independent-medical-operations/
 * delayMinutes values are chosen hypothetical exercise parameters, not a live
 * measurement, countdown, routing calculation, or guaranteed response time.
 */

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

export const TRAINING_SCENARIOS = freezeTree([
  {
    id: 'context-check',
    title: ['Simulation · Verify the recording context', 'محاكاة · التحقق من سياق التسجيل'],
    description: ['Fictional workflow exercise: a recording has incomplete metadata. Practice checking what is known before preparing a review. No patient or clinical measurements are included.', 'تدريب افتراضي على خطوات الاستخدام: تسجيل ببيانات وصفية ناقصة. تدرّب على التحقق من المعلومات قبل تجهيز المراجعة. لا توجد حالة مريض أو قياسات طبية.'],
    mission: ['Simulated station workflow · no real mission connection', 'إجراء محطة افتراضية · دون اتصال بمهمة حقيقية'],
    delayMinutes: 0,
    steps: [
      {
        id: 'verify-metadata',
        prompt: ['Simulation: the source, recording time, and measurement context are missing. What is the next workflow action?', 'محاكاة: مصدر التسجيل وتوقيته وظروف القياس غير موجودة. ما خطوة الاستخدام التالية؟'],
        options: [
          { id: 'check-context', label: ['Verify the source, date, device, and context; mark anything unknown.', 'تحقق من المصدر والتاريخ والجهاز والظروف، وحدد المعلومات المجهولة.'], correct: true, feedback: ['Workflow choice recorded: missing context remains explicit. This does not establish a diagnosis.', 'تم تسجيل اختيار الخطوة: تظل المعلومات الناقصة واضحة. هذا لا يحدد تشخيصًا.'] },
          { id: 'diagnose-confidence', label: ['Assign a confident diagnosis from the incomplete recording.', 'ضع تشخيصًا مؤكدًا اعتمادًا على التسجيل الناقص.'], correct: false, feedback: ['This exercise expects verification of missing context. An incomplete recording cannot justify a confident diagnosis through this interface.', 'المطلوب في التدريب هو التحقق من السياق الناقص. التسجيل غير المكتمل لا يبرر تشخيصًا مؤكدًا من هذه الواجهة.'] }
        ]
      },
      {
        id: 'preserve-unknowns',
        prompt: ['Simulation: the recording time is still unknown. How should the review packet represent it?', 'محاكاة: توقيت التسجيل ما زال مجهولًا. كيف يظهر في ملف المراجعة؟'],
        options: [
          { id: 'mark-unknown', label: ['Keep the recording time unknown and distinguish it from packet preparation time.', 'اترك توقيت التسجيل مجهولًا وميّزه عن وقت تجهيز الملف.'], correct: true, feedback: ['The packet can preserve uncertainty and identify when it was prepared without inventing an observation time.', 'يمكن أن يحفظ الملف عدم اليقين ويوضح وقت تجهيزه دون اختلاق وقت للتسجيل.'] },
          { id: 'invent-time', label: ['Use the current time as the recording time without checking.', 'استخدم الوقت الحالي كتوقيت للتسجيل دون تحقق.'], correct: false, feedback: ['Preparation time and observation time are different. Keep an unknown observation time explicit.', 'وقت تجهيز الملف يختلف عن وقت التسجيل. يجب توضيح أن توقيت التسجيل مجهول.'] }
        ]
      },
      {
        id: 'limit-conclusion',
        prompt: ['Simulation: the metadata review is complete. What conclusion does this training result support?', 'محاكاة: انتهت مراجعة البيانات الوصفية. ما الذي تدعمه نتيجة التدريب؟'],
        options: [
          { id: 'workflow-only', label: ['Only that I practiced the context-review workflow.', 'فقط أنني تدربت على خطوات مراجعة السياق.'], correct: true, feedback: ['Correct scope: the result describes exercise choices, with no assessment of anyone’s health.', 'النطاق صحيح: النتيجة تصف اختيارات التدريب دون تقييم صحة أي شخص.'] },
          { id: 'health-clearance', label: ['That a crew member has been medically cleared.', 'أن أحد أفراد الطاقم حصل على تصريح طبي.'], correct: false, feedback: ['Completing an interface exercise provides no medical clearance. No real person was assessed.', 'إنهاء تدريب على الواجهة لا يمنح تصريحًا طبيًا. لم يتم تقييم أي شخص حقيقي.'] }
        ]
      }
    ]
  },
  {
    id: 'delayed-review',
    title: ['Simulation · Routine review with a communication delay', 'محاكاة · مراجعة روتينية مع تأخر الاتصال'],
    description: ['Fictional non-emergency workflow exercise. The chosen 12-minute delay is hypothetical; it does not run a timer or connect to Earth. Practice preparing an accurate handover packet.', 'تدريب افتراضي على إجراء روتيني غير طارئ. تأخر الاتصال المختار، ١٢ دقيقة، افتراضي؛ لا يشغّل مؤقتًا ولا يتصل بالأرض. تدرّب على تجهيز ملف تسليم دقيق.'],
    mission: ['Simulated deep-space routine review · no actual Earth link', 'مراجعة روتينية في فضاء عميق افتراضي · دون رابط فعلي بالأرض'],
    delayMinutes: 12,
    steps: [
      {
        id: 'prepare-packet',
        prompt: ['Simulation: a non-emergency routine review is planned during a hypothetical communication delay. What can this interface exercise prepare?', 'محاكاة: توجد مراجعة روتينية غير طارئة أثناء تأخر افتراضي للاتصال. ماذا يمكن تجهيزه في هذا التدريب؟'],
        options: [
          { id: 'dated-packet', label: ['Prepare a dated packet listing the source, context, and unresolved questions.', 'جهّز ملفًا مؤرخًا يوضح المصدر والظروف والأسئلة التي لم تُحسم.'], correct: true, feedback: ['A dated packet supports a later handover through an actual approved channel. Nothing has been transmitted by this exercise.', 'يساعد الملف المؤرخ في التسليم لاحقًا عبر قناة فعلية معتمدة. لم يرسل التدريب أي معلومات.'] },
          { id: 'claim-sent', label: ['Display “sent to Earth” as soon as the packet is prepared.', 'اعرض «تم الإرسال إلى الأرض» بمجرد تجهيز الملف.'], correct: false, feedback: ['Preparing a packet is not sending it. This simulator has no Earth connection and cannot confirm delivery.', 'تجهيز الملف لا يعني إرساله. المحاكاة لا تتصل بالأرض ولا يمكنها تأكيد التسليم.'] }
        ]
      },
      {
        id: 'state-delivery',
        prompt: ['Simulation: a packet is prepared, but no real communications channel has been used. Which status is accurate?', 'محاكاة: جُهّز الملف دون استخدام أي قناة اتصال حقيقية. ما الحالة الدقيقة؟'],
        options: [
          { id: 'prepared-unsent', label: ['Prepared in the exercise; not sent or acknowledged.', 'مجهز داخل التدريب؛ لم يُرسل ولم يُؤكد استلامه.'], correct: true, feedback: ['The status distinguishes preparation from transmission and acknowledgement. The delay remains a hypothetical scenario parameter.', 'الحالة تميز التجهيز عن الإرسال وتأكيد الاستلام. التأخر يظل قيمة افتراضية داخل السيناريو.'] },
          { id: 'assume-delivery', label: ['Assume a clinician received it because the hypothetical delay elapsed.', 'افترض أن الطبيب استلمه لأن مدة التأخر الافتراضية انتهت.'], correct: false, feedback: ['Elapsed scenario time cannot prove transmission, receipt, or a clinician’s response. No actual link exists here.', 'مرور وقت افتراضي لا يثبت الإرسال أو الاستلام أو رد الطبيب. لا يوجد رابط فعلي هنا.'] }
        ]
      },
      {
        id: 'change-priority',
        prompt: ['Simulation: an emergency warning is introduced before the routine review. What takes priority?', 'محاكاة: ظهر تنبيه طارئ قبل المراجعة الروتينية. ما الأولوية؟'],
        options: [
          { id: 'available-help', label: ['Seek immediately available emergency help and follow the actual emergency procedure.', 'اطلب المساعدة الطارئة المتاحة فورًا واتبع إجراء الطوارئ الفعلي.'], correct: true, feedback: ['Emergency help takes priority over a routine packet or an Earth reply. In a real mission, alert the crew medical lead; on Earth, contact local emergency services.', 'المساعدة الطارئة تسبق الملف الروتيني أو انتظار رد الأرض. في مهمة حقيقية نبّه مسؤول طب الطاقم، وعلى الأرض اتصل بالطوارئ المحلية.'] },
          { id: 'wait-review', label: ['Keep waiting for the routine Earth review before seeking help.', 'استمر في انتظار المراجعة الروتينية من الأرض قبل طلب المساعدة.'], correct: false, feedback: ['Do not delay immediately available emergency help for a routine review or a remote reply. This is workflow training, not a real alert service.', 'لا تؤخر المساعدة الطارئة المتاحة لانتظار مراجعة روتينية أو رد بعيد. هذا تدريب على الإجراءات وليس خدمة تنبيه فعلية.'] }
        ]
      }
    ]
  },
  {
    id: 'emergency-priority',
    title: ['Simulation · Emergency help comes first', 'محاكاة · المساعدة الطارئة أولًا'],
    description: ['Fictional emergency-workflow exercise with no patient, measurements, or outcome model. Practice prioritising immediately available help. The 20-minute communication delay is hypothetical; no Earth link exists.', 'تدريب افتراضي على خطوات الطوارئ دون مريض أو قياسات أو نموذج للتنبؤ بالنتائج. تدرّب على إعطاء الأولوية للمساعدة المتاحة فورًا. تأخر الاتصال، ٢٠ دقيقة، افتراضي ولا يوجد رابط بالأرض.'],
    mission: ['Simulated mission emergency workflow · no actual emergency dispatch', 'إجراء طوارئ مهمة افتراضية · دون استدعاء طوارئ فعلي'],
    delayMinutes: 20,
    steps: [
      {
        id: 'immediate-help',
        prompt: ['Simulation: an emergency warning appears while a remote reply is delayed. What is the first workflow priority?', 'محاكاة: ظهر تنبيه طارئ مع تأخر الرد البعيد. ما أول أولوية في الإجراء؟'],
        options: [
          { id: 'immediate-available-help', label: ['Alert immediately available help and use the actual emergency procedure.', 'نبّه المساعدة المتاحة فورًا واستخدم إجراء الطوارئ الفعلي.'], correct: true, feedback: ['Do not wait for an Earth reply or finish the app. In a real mission, alert the crew medical lead; on Earth, contact local emergency services. This choice does not make any call.', 'لا تنتظر رد الأرض أو استكمال التطبيق. في مهمة حقيقية نبّه مسؤول طب الطاقم، وعلى الأرض اتصل بالطوارئ المحلية. هذا الاختيار لا يجري أي اتصال.'] },
          { id: 'wait-earth', label: ['Wait for an Earth reply before contacting available help.', 'انتظر رد الأرض قبل التواصل مع المساعدة المتاحة.'], correct: false, feedback: ['Immediate emergency help must not wait for a remote reply. This fictional exercise cannot contact help or direct clinical care.', 'لا تنتظر المساعدة الطارئة الفورية ردًا بعيدًا. هذا التدريب الافتراضي لا يتصل بالمساعدة ولا يوجه الرعاية الطبية.'] }
        ]
      },
      {
        id: 'handover-without-delay',
        prompt: ['Simulation: available emergency help is being contacted. Where does collecting a complete packet fit?', 'محاكاة: يجري التواصل مع المساعدة الطارئة المتاحة. ما موقع جمع ملف كامل ضمن الأولويات؟'],
        options: [
          { id: 'no-delay', label: ['Share concise known context when possible without delaying help.', 'شارك المعلومات المعروفة بإيجاز عند الإمكان دون تأخير المساعدة.'], correct: true, feedback: ['A complete form is not a prerequisite for help. Any handover is secondary to the actual emergency procedure.', 'النموذج الكامل ليس شرطًا لطلب المساعدة. أي تسليم للمعلومات يأتي بعد أولوية إجراء الطوارئ الفعلي.'] },
          { id: 'finish-form-first', label: ['Complete every field before allowing help to be contacted.', 'أكمل كل الحقول قبل السماح بالتواصل مع المساعدة.'], correct: false, feedback: ['Do not make form completion a barrier to emergency help. This simulator cannot assess or resolve an actual emergency.', 'لا تجعل استكمال النموذج عائقًا أمام المساعدة الطارئة. المحاكاة لا تقيّم حالة طارئة فعلية ولا تعالجها.'] }
        ]
      },
      {
        id: 'recognise-simulation',
        prompt: ['Simulation: the exercise is ending. What has the app actually done?', 'محاكاة: ينتهي التدريب. ما الذي فعله التطبيق فعليًا؟'],
        options: [
          { id: 'choices-only', label: ['Recorded exercise choices in memory; made no call and predicted no health outcome.', 'سجّل اختيارات التدريب في الذاكرة؛ لم يتصل بأحد ولم يتنبأ بنتيجة صحية.'], correct: true, feedback: ['Completion reflects workflow choices only. No real emergency team was contacted or real person assessed.', 'الإتمام يعكس اختيارات الإجراء فقط. لم يتم الاتصال بفريق طوارئ حقيقي أو تقييم شخص حقيقي.'] },
          { id: 'claim-dispatch', label: ['Dispatched emergency help and received an actual Earth acknowledgement.', 'استدعى المساعدة الطارئة وتلقى تأكيد استلام فعليًا من الأرض.'], correct: false, feedback: ['This exercise has no dispatch connection and no patient-outcome model. It cannot confirm contact, receipt, recovery, or survival.', 'لا يوجد اتصال لاستدعاء الطوارئ ولا نموذج لنتائج المرضى في هذا التدريب. لا يمكنه تأكيد التواصل أو الاستلام أو التعافي أو النجاة.'] }
        ]
      }
    ]
  }
]);

function scenarioById(id) {
  const scenario = TRAINING_SCENARIOS.find(candidate => candidate.id === id);
  if (!scenario) throw new RangeError('Unknown training scenario');
  return scenario;
}

function validTime(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function verifySession(session) {
  if (!session || typeof session !== 'object') throw new TypeError('Invalid training session');
  const scenario = scenarioById(session.scenarioId);
  if (typeof session.id !== 'string' || !session.id || !validTime(session.startedAt)
      || !Array.isArray(session.answers) || !Number.isInteger(session.stepIndex)
      || session.stepIndex < 0 || session.stepIndex > scenario.steps.length
      || session.answers.length !== session.stepIndex
      || session.finished !== (session.stepIndex === scenario.steps.length)) {
    throw new TypeError('Invalid training session state');
  }
  for (let index = 0; index < session.answers.length; index++) {
    const answer = session.answers[index];
    const step = scenario.steps[index];
    const option = answer && step.options.find(candidate => candidate.id === answer.optionId);
    if (!option || answer.stepId !== step.id || answer.correct !== option.correct
        || !validTime(answer.answeredAt) || !Array.isArray(answer.feedback)
        || answer.feedback.length !== 2
        || answer.feedback.some((part, language) => part !== option.feedback[language])) {
      throw new TypeError('Invalid training answer audit');
    }
  }
  return scenario;
}

export function createTrainingSession(scenarioId) {
  scenarioById(scenarioId);
  const id = globalThis.crypto?.randomUUID?.()
    ?? `training-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return freezeTree({ id, scenarioId, startedAt: new Date().toISOString(), answers: [], stepIndex: 0, finished: false });
}

export function answerTrainingStep(session, optionId) {
  const scenario = verifySession(session);
  if (session.finished) throw new RangeError('Training session is finished');
  const step = scenario.steps[session.stepIndex];
  const option = step.options.find(candidate => candidate.id === optionId);
  if (!option) throw new RangeError('Unknown option for current training step');
  const answers = [...session.answers.map(answer => ({ ...answer, feedback: [...answer.feedback] })), {
    stepId: step.id,
    optionId: option.id,
    correct: option.correct,
    feedback: [...option.feedback],
    answeredAt: new Date().toISOString()
  }];
  const stepIndex = session.stepIndex + 1;
  return freezeTree({ id: session.id, scenarioId: session.scenarioId, startedAt: session.startedAt,
    answers, stepIndex, finished: stepIndex === scenario.steps.length });
}

export function trainingSummary(session) {
  const scenario = verifySession(session);
  const correctSteps = session.answers.filter(answer => answer.correct).length;
  return freezeTree({
    completedSteps: session.stepIndex,
    totalSteps: scenario.steps.length,
    correctSteps,
    finished: session.finished,
    feedback: session.finished
      ? ['Simulation complete. The decision count reflects navigation and handover workflow choices only. Review the feedback to revisit the exercise.', 'اكتملت المحاكاة. عدد القرارات يعكس اختيارات التنقل وتسليم المعلومات فقط. راجع الملاحظات لإعادة النظر في التدريب.']
      : ['Simulation in progress. Complete the current workflow step to continue; no health status is being calculated.', 'المحاكاة جارية. أكمل خطوة الإجراء الحالية للمتابعة؛ لا يجري حساب أي حالة صحية.'],
    disclaimer: ['Fictional workflow training only; not NASA-validated training or clinical care. No real patient, treatment, recovery or survival prediction, actual Earth link, message, emergency dispatch, or saved health record. Choices exist only in this session’s memory.', 'تدريب افتراضي على الإجراءات فقط؛ ليس تدريبًا معتمدًا من ناسا أو رعاية طبية. لا يوجد مريض حقيقي أو علاج أو توقع للتعافي أو النجاة أو رابط فعلي بالأرض أو رسالة أو استدعاء طوارئ أو سجل صحي محفوظ. توجد الاختيارات في ذاكرة هذه الجلسة فقط.']
  });
}
