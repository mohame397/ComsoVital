const PRIVATE_VIEWS = new Set(['overview', 'cases', 'consultations', 'help', 'trends', 'compare', 'records', 'body', 'routine', 'profile', 'alerts']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_ZONES = ['UTC', 'Africa/Cairo', 'Europe/London', 'Europe/Paris', 'Asia/Dubai', 'Asia/Riyadh', 'Asia/Tokyo', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney'];

export function validateAccountForm(kind, values) {
  const email = String(values.email || '').trim().toLowerCase();
  const password = String(values.password || '');
  if (['login', 'signup', 'forgot-password'].includes(kind) && (!EMAIL.test(email) || email.length > 254)) throw new Error('Enter a valid email address.');
  if (['login', 'signup', 'reset-password'].includes(kind) && !password) throw new Error('Enter your password.');
  if (['signup', 'reset-password'].includes(kind)) {
    if (password.length < 12 || password.length > 128) throw new Error('Use a password between 12 and 128 characters.');
    if (password !== String(values.confirmPassword || '')) throw new Error('Passwords do not match.');
  }
  if (kind === 'signup') {
    const displayName = String(values.displayName || '').trim();
    if (!displayName || displayName.length > 80) throw new Error('Enter a display name of up to 80 characters.');
    return {displayName, email, password};
  }
  return kind === 'forgot-password' ? {email} : kind === 'reset-password' ? {password} : {email, password};
}

export function validateProfileInput(values) {
  const display_name = String(values.display_name || '').trim();
  const crew_identifier = String(values.crew_identifier || '').trim();
  const mission_name = String(values.mission_name || '').trim();
  const timeZone = String(values.timeZone || 'UTC');
  const temperatureUnit = String(values.temperatureUnit || '°C');
  const glucoseUnit = String(values.glucoseUnit || 'mg/dL');
  if (!display_name || display_name.length > 80) throw new Error('Enter a display name of up to 80 characters.');
  if (crew_identifier.length > 80 || mission_name.length > 120) throw new Error('Crew identifier or mission name is too long.');
  try { new Intl.DateTimeFormat('en', {timeZone}); } catch { throw new Error('Choose a valid IANA time zone.'); }
  if (!['°C', '°F'].includes(temperatureUnit)) throw new Error('Choose °C or °F.');
  if (!['mg/dL', 'mmol/L'].includes(glucoseUnit)) throw new Error('Choose mg/dL or mmol/L.');
  return {display_name, crew_identifier, mission_name, preferences: {timeZone, temperatureUnit, glucoseUnit}};
}

export function createAccountUI(ctx) {
  const {t, esc, icon, modal, closeModal, toast} = ctx;
  let pending = false, message = '';
  const state = () => ctx.getState() || {};
  const go = view => { message = ''; ctx.navigate(view); };
  const errorSlot = (id = 'form-error') => `<div id="${id}" role="alert" aria-live="assertive"></div>`;
  const field = (label, name, type = 'text', attrs = '') => `<label class="field full" for="acct-${name}">${label}<input id="acct-${name}" name="${name}" type="${type}" ${attrs}></label>`;
  const passwordField = (confirm = false, current = false) => field(confirm ? t('Confirm password', 'تأكيد كلمة المرور') : t('Password', 'كلمة المرور'), confirm ? 'confirmPassword' : 'password', 'password', `autocomplete="${current ? 'current-password' : 'new-password'}" ${current ? '' : 'minlength="12"'} maxlength="128" required`);
  const emailField = () => field(t('Email', 'البريد الإلكتروني'), 'email', 'email', 'autocomplete="email" maxlength="254" inputmode="email" required dir="ltr"');
  const link = (view, label) => `<a href="#${view}" class="text-link" data-action="acct-navigate" data-view="${view}">${label}</a>`;
  const response = result => { if (result?.error) throw result.error; return result; };
  const localError = error => {
    const translations = {
      'Enter a valid email address.': 'اكتب بريدًا إلكترونيًا صالحًا.',
      'Enter your password.': 'اكتب كلمة المرور.',
      'Use a password between 12 and 128 characters.': 'استخدم كلمة مرور من ١٢ إلى ١٢٨ حرفًا.',
      'Passwords do not match.': 'كلمتا المرور غير متطابقتين.',
      'Enter a display name of up to 80 characters.': 'اكتب اسمًا ظاهرًا لا يزيد عن ٨٠ حرفًا.',
      'Crew identifier or mission name is too long.': 'معرّف الطاقم أو اسم المهمة أطول من المسموح.',
      'Choose a valid IANA time zone.': 'اختار منطقة زمنية صالحة من قائمة IANA.',
      'Choose °C or °F.': 'اختار درجة مئوية °C أو فهرنهايت °F.',
      'Choose mg/dL or mmol/L.': 'اختار mg/dL أو mmol/L.'
    };
    const text = error?.message || String(error);
    return new Error(translations[text] ? t(text, translations[text]) : text);
  };
  const banner = () => message ? `<div class="notice account-feedback" role="status">${icon('info')}<p>${esc(message)}</p></div>` : '';
  const configuredNote = () => state().configured ? '' : `<div class="notice orange account-setup">${icon('info')}<div><strong>${t('Cloud accounts are not configured yet.', 'الحسابات السحابية لم تُفعّل بعد.')}</strong><p>${t('A Supabase project and its public configuration are required. No registration, password email, or cloud save is performed in this mode. Existing local observations remain available in this browser.', 'يلزم إعداد مشروع Supabase وبيانات اتصاله العامة. في الوضع الحالي لا يتم إنشاء حساب أو طلب رسالة لكلمة المرور أو حفظ سحابي. القياسات المحلية السابقة تظل متاحة في هذا المتصفح.')}</p>${link('overview', t('Return to the local workspace', 'ارجع لمساحة العمل المحلية'))}</div></div>`;
  function shell(title, description, body) {
    return `<section class="account-layout"><div class="account-intro"><span class="eyebrow">COSMOVITAL · ${t('YOUR HEALTH WORKSPACE', 'مساحة متابعة صحتك')}</span><h1>${title}</h1><p>${description}</p><div class="account-assurance">${icon('shield')}<p>${t('Your account identifies your private workspace. Display names are not account identifiers.', 'حسابك يحدد مساحة العمل الخاصة بك. الاسم الظاهر ليس معرّف الحساب.')}</p></div></div><section class="panel account-panel">${configuredNote()}${banner()}${body}</section></section>`;
  }
  function form(id, body, button, after = '') {
    const disabled = !state().configured || pending;
    return `<form id="acct-${id}" class="account-form" aria-busy="${pending}"><fieldset ${disabled ? 'disabled' : ''}>${body}${errorSlot(id === 'profile' ? 'acct-profile-error' : 'form-error')}<button class="btn btn-primary account-submit" type="submit">${pending ? t('Please wait…', 'جارٍ التنفيذ…') : button}</button></fieldset></form>${after}`;
  }
  function loginView() {
    return shell(t('Welcome back.', 'أهلًا برجوعك.'), t('Sign in to open your own measurements and follow-up workspace.', 'سجّل الدخول لقياساتك وملفات متابعتك الخاصة.'), form('login', emailField() + passwordField(false, true), t('Log in', 'تسجيل الدخول'), `<div class="account-links">${link('forgot-password', t('Forgot password?', 'نسيت كلمة المرور؟'))}${link('signup', t('Create an account', 'إنشاء حساب'))}</div>`));
  }
  function signupView() {
    return shell(t('Make room for your own health story.', 'ابدأ مساحة متابعة خاصة بيك.'), t('Create a personal account. Your existing anonymous browser records are never assigned to an account automatically.', 'أنشئ حسابًا شخصيًا. السجلات المحلية السابقة لا تُنسب لحسابك تلقائيًا.'), form('signup', field(t('Display name', 'الاسم الظاهر'), 'displayName', 'text', 'autocomplete="nickname" maxlength="80" required') + emailField() + passwordField() + passwordField(true) + `<p class="helper-note">${t('Use at least 12 characters. Your authentication provider may require a stronger password. Email verification may be required before login.', 'استخدم ١٢ حرفًا على الأقل. قد يطلب مزوّد تسجيل الدخول كلمة مرور أقوى. قد يلزم تأكيد البريد الإلكتروني قبل الدخول.')}</p>`, t('Create account', 'إنشاء الحساب'), `<div class="account-links">${link('login', t('Already have an account? Log in', 'عندك حساب؟ سجّل الدخول'))}</div>`));
  }
  function forgotView() {
    return shell(t('Recover access to your account.', 'استرجع الوصول لحسابك.'), t('Request a password-reset link through your authentication provider.', 'اطلب رابط إعادة تعيين كلمة المرور من مزوّد تسجيل الدخول.'), form('forgot-password', emailField() + `<p class="helper-note">${t('For privacy, this page does not reveal whether an email address has an account. Request acceptance does not confirm delivery.', 'لحماية الخصوصية، الصفحة لا تكشف إن كان البريد مسجلًا. قبول الطلب لا يؤكد تسليم الرسالة.')}</p>`, t('Request reset link', 'اطلب رابط إعادة التعيين'), `<div class="account-links">${link('login', t('Back to login', 'الرجوع لتسجيل الدخول'))}</div>`));
  }
  function resetView() {
    const s = state(), permitted = !!s.user;
    return shell(t('Choose a new password.', 'اختار كلمة مرور جديدة.'), t('Open the recovery link sent by your provider, or use your current authenticated session.', 'افتح رابط الاسترجاع من مزوّد الخدمة، أو استخدم جلستك الحالية المسجّل دخولها.'), !s.configured ? '' : !permitted ? `<div class="notice orange">${icon('info')}<p>${t('A valid recovery or authenticated session is required. Request a new recovery link if the previous link expired.', 'يلزم وجود جلسة استرجاع أو جلسة دخول صالحة. اطلب رابط استرجاع جديدًا لو انتهت صلاحية الرابط السابق.')}</p></div><div class="account-links">${link('forgot-password', t('Request another recovery link', 'اطلب رابط استرجاع جديد'))}</div>` : form('reset-password', `<input type="hidden" name="userId" value="${esc(s.user.id)}">` + passwordField() + passwordField(true), t('Update password', 'تحديث كلمة المرور')));
  }
  function options(values, selected) { return values.map(value => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join(''); }
  function profileView() {
    const s = state();
    if (!s.user) return shell(t('Your personal profile.', 'ملفك الشخصي.'), t('Account preferences are available after login.', 'تفضيلات الحساب متاحة بعد تسجيل الدخول.'), s.configured ? `<div class="notice">${icon('shield')}<p>${t('Log in to view or edit your private profile.', 'سجّل الدخول لعرض أو تعديل ملفك الشخصي.')}</p></div><div class="account-links">${link('login', t('Log in', 'تسجيل الدخول'))}</div>` : '');
    const p = s.profile || {}, prefs = p.preferences || {};
    let timeZone = typeof prefs.timeZone === 'string' ? prefs.timeZone : 'UTC';
    try { new Intl.DateTimeFormat('en', {timeZone}); } catch { timeZone = 'UTC'; }
    const supported = [...new Set([timeZone, ...TIME_ZONES, ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [])])];
    const created = s.user.created_at || p.created_at;
    let createdText = t('Not available', 'غير متاح');
    if (created && Number.isFinite(Date.parse(created))) createdText = new Intl.DateTimeFormat(t('en-GB', 'ar-EG'), {year: 'numeric', month: 'short', day: 'numeric', timeZone}).format(new Date(created));
    const details = `<dl class="account-metadata"><div><dt>${t('Account ID', 'معرّف الحساب')}</dt><dd class="account-id" dir="ltr">${esc(s.user.id)}</dd></div><div><dt>${t('Email', 'البريد الإلكتروني')}</dt><dd dir="ltr">${esc(s.user.email || '')}</dd></div><div><dt>${t('Account created', 'تاريخ إنشاء الحساب')}</dt><dd>${esc(createdText)}</dd></div></dl>`;
    const fields = `<input type="hidden" name="userId" value="${esc(s.user.id)}"><div class="field-grid">${field(t('Display name', 'الاسم الظاهر'), 'display_name', 'text', `value="${esc(p.display_name || '')}" autocomplete="nickname" maxlength="80" required`)}${field(t('Crew identifier · optional', 'معرّف الطاقم · اختياري'), 'crew_identifier', 'text', `value="${esc(p.crew_identifier || '')}" maxlength="80"`)}${field(t('Mission name · optional', 'اسم المهمة · اختياري'), 'mission_name', 'text', `value="${esc(p.mission_name || '')}" maxlength="120"`)}<label class="field full" for="acct-timeZone">${t('Display and entry time zone', 'المنطقة الزمنية للعرض والإدخال')}<select id="acct-timeZone" name="timeZone">${options(supported, timeZone)}</select><span class="account-field-hint">${t('Measurement instants remain stored in UTC. This preference controls calendar days and displayed times.', 'توقيت القياس يُحفظ بتوقيت UTC. التفضيل ده يحدد الأيام والتوقيت الظاهر.')}</span></label><label class="field" for="acct-temperatureUnit">${t('Temperature unit', 'وحدة الحرارة')}<select id="acct-temperatureUnit" name="temperatureUnit">${options(['°C', '°F'], prefs.temperatureUnit || '°C')}</select></label><label class="field" for="acct-glucoseUnit">${t('Blood glucose unit', 'وحدة سكر الدم')}<select id="acct-glucoseUnit" name="glucoseUnit">${options(['mg/dL', 'mmol/L'], prefs.glucoseUnit || 'mg/dL')}</select></label></div>`;
    return shell(t('Your profile. Your preferences.', 'ملفك وتفضيلاتك.'), t('Your account identifier stays fixed when you change your display name.', 'معرّف حسابك ثابت حتى لو غيّرت اسمك الظاهر.'), details + form('profile', fields, t('Save profile', 'حفظ الملف الشخصي')) + `<div class="account-security"><h2>${t('Account security', 'أمان الحساب')}</h2><div class="account-security-actions">${link('reset-password', t('Change password', 'تغيير كلمة المرور'))}<button class="btn btn-light" data-action="acct-logout">${t('Log out', 'تسجيل الخروج')}</button></div><div class="account-delete"><h3>${t('Delete account and cloud health data', 'حذف الحساب والبيانات الصحية السحابية')}</h3><p>${t('Export anything you need first. Deletion is permanent and affects this account across devices. Downloaded copies and anonymous browser records are outside this cloud deletion.', 'صدّر أي بيانات تحتاجها أولًا. الحذف نهائي ويؤثر على الحساب في كل الأجهزة. النسخ المنزّلة والسجلات المحلية المجهولة خارج الحذف السحابي.')}</p><button class="btn btn-light account-danger" data-action="acct-delete-open">${t('Review account deletion', 'مراجعة حذف الحساب')}</button></div></div>`);
  }
  function header() {
    const s = state();
    if (s.status === 'loading') return `<span class="account-header-status" role="status">${t('Opening account…', 'جارٍ فتح الحساب…')}</span>`;
    if (s.user) return `<button class="account-header" data-action="acct-navigate" data-view="profile" aria-label="${t('Open personal profile', 'افتح ملفك الشخصي')}">${icon('shield')}<span>${esc(s.profile?.display_name || s.user.email || t('My account', 'حسابي'))}</span></button>`;
    return `<button class="account-header" data-action="acct-navigate" data-view="login">${icon('shield')}${s.configured ? t('Log in', 'تسجيل الدخول') : t('Local workspace', 'مساحة عمل محلية')}</button>`;
  }
  function openDelete() {
    const s = state();
    if (!s.configured || !s.user) throw new Error(t('Log in before managing your account.', 'سجّل الدخول قبل إدارة حسابك.'));
    modal(t('Delete your account permanently?', 'حذف حسابك نهائيًا؟'), t('Review, export, then confirm deliberately.', 'راجع البيانات وصدّرها قبل التأكيد.'), `<form id="acct-delete"><input type="hidden" name="userId" value="${esc(s.user.id)}"><div class="notice orange">${icon('info')}<p>${t('This removes your cloud profile, measurements, cases, alerts and consultation drafts. It cannot be undone here. Export a backup before continuing.', 'سيحذف ملفك وقياساتك وحالاتك وتنبيهاتك ومسودات استشاراتك من السحابة. لا يمكن التراجع من هنا. صدّر نسخة احتياطية قبل الاستمرار.')}</p></div>${field(t('Type DELETE to confirm', 'اكتب DELETE للتأكيد'), 'confirmation', 'text', 'required autocomplete="off" spellcheck="false" dir="ltr"')}${passwordField(false, true)}${errorSlot()}</form>`, `<button class="btn btn-light" data-action="close">${t('Keep my account', 'الاحتفاظ بالحساب')}</button><button class="btn btn-primary account-danger-solid" type="submit" form="acct-delete">${t('Delete permanently', 'حذف نهائي')}</button>`);
  }
  async function action(el) {
    if (!el?.dataset?.action?.startsWith('acct-')) return false;
    const a = el.dataset.action;
    if (a === 'acct-navigate') { if (['login', 'signup', 'forgot-password', 'reset-password', 'profile'].includes(el.dataset.view)) go(el.dataset.view); }
    else if (a === 'acct-logout') { await ctx.auth.signOut(); message = t('Signed out.', 'تم تسجيل الخروج.'); ctx.navigate('login'); }
    else if (a === 'acct-delete-open') openDelete();
    return true;
  }
  async function submit(formElement, fd) {
    if (!formElement?.id?.startsWith('acct-')) return false;
    if (!state().configured) throw new Error(t('Cloud accounts are not configured on this deployment.', 'الحسابات السحابية لم تُفعّل على النسخة دي.'));
    if (pending) throw new Error(t('Please wait for the current request.', 'استنى اكتمال الطلب الحالي.'));
    pending = true;
    const id = formElement.id.slice(5), values = Object.fromEntries(fd.entries());
    const buttons = typeof document === 'undefined' ? [] : [...document.querySelectorAll(`#${formElement.id} button[type="submit"],button[form="${formElement.id}"]`)];
    const originalLabels = buttons.map(b => b.textContent);
    buttons.forEach(b => { b.disabled = true; b.textContent = t('Please wait…', 'جارٍ التنفيذ…'); });
    formElement.setAttribute?.('aria-busy', 'true');
    try {
      message = '';
      if (id === 'login') { response(await ctx.auth.signIn(validateAccountForm(id, values))); pending = false; ctx.navigate('overview'); }
      else if (id === 'signup') {
        const result = response(await ctx.auth.signUp(validateAccountForm(id, values)));
        if (result?.session || result?.data?.session || state().user) { pending = false; ctx.navigate('overview'); }
        else { message = t('Registration request accepted. If confirmation is required, check your email and verify it before logging in. This does not confirm email delivery.', 'تم قبول طلب التسجيل. لو تأكيد البريد مطلوب، راجع بريدك وأكّد الحساب قبل الدخول. ده لا يؤكد تسليم الرسالة.'); pending = false; ctx.navigate('login'); }
      } else if (id === 'forgot-password') {
        const {email} = validateAccountForm(id, values); response(await ctx.auth.requestPasswordReset(email));
        message = t('If this address has an eligible account, the provider will process a recovery email. Check your inbox and spam folder. Delivery is not confirmed here.', 'لو البريد مرتبط بحساب مؤهل، مزوّد الخدمة هيعالج طلب رسالة الاسترجاع. راجع البريد والرسائل غير المرغوب فيها. التسليم غير مؤكد من هنا.'); pending = false; ctx.render();
      } else if (id === 'reset-password') {
        if (!state().user || values.userId !== state().user.id) throw new Error(t('The recovery account changed. Reopen the password form.', 'حساب الاسترجاع اتغير. افتح نموذج كلمة المرور من جديد.'));
        const {password} = validateAccountForm(id, values); response(await ctx.auth.updatePassword(password));
        message = t('Password updated.', 'تم تحديث كلمة المرور.'); pending = false; ctx.navigate('profile');
      } else if (id === 'profile') {
        if (!state().user || values.userId !== state().user.id) throw new Error(t('The active account changed. Reopen your profile.', 'الحساب الحالي اتغير. افتح ملفك الشخصي من جديد.'));
        const input = validateProfileInput(values);
        response(await ctx.updateProfile({...input, preferences: {...(state().profile?.preferences || {}), ...input.preferences}}));
        toast(t('Profile saved.', 'تم حفظ الملف الشخصي.')); pending = false; ctx.render();
      } else if (id === 'delete') {
        const before = state().user;
        if (!before || values.userId !== before.id) throw new Error(t('The active account changed. Reopen this confirmation.', 'الحساب الحالي اتغير. افتح التأكيد من جديد.'));
        if (values.confirmation !== 'DELETE') throw new Error(t('Type DELETE exactly to confirm permanent deletion.', 'اكتب DELETE بالضبط لتأكيد الحذف النهائي.'));
        if (!values.password) throw new Error(t('Enter your current password.', 'اكتب كلمة المرور الحالية.'));
        const result = response(await ctx.auth.signIn({email: before.email, password: String(values.password)}));
        const currentId = result?.user?.id || result?.data?.user?.id || state().user?.id;
        if (currentId !== before.id || state().user?.id !== before.id) throw new Error(t('Account identity could not be confirmed. No deletion was requested.', 'تعذّر تأكيد هوية الحساب. لم يُطلب الحذف.'));
        response(await ctx.auth.deleteAccount()); closeModal();
        message = t('Account deletion completed.', 'تم حذف الحساب.'); pending = false; ctx.navigate('login');
      } else return false;
      return true;
    } catch (error) {
      const localized = localError(error), target = formElement.querySelector?.('[role="alert"]');
      if (target) { target.textContent = localized.message; target.className = 'form-error'; target.scrollIntoView?.({block: 'nearest'}); }
      throw localized;
    } finally {
      pending = false;
      formElement.setAttribute?.('aria-busy', 'false');
      buttons.forEach((b, i) => { if (b.isConnected) { b.disabled = false; b.textContent = originalLabels[i]; } });
    }
  }
  return {views: {login: loginView, signup: signupView, 'forgot-password': forgotView, 'reset-password': resetView, profile: profileView}, action, submit, header, protected: view => !!state().configured && !state().user && PRIVATE_VIEWS.has(view)};
}
