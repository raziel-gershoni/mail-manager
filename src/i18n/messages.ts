// src/i18n/messages.ts — hand-rolled en/he message tables. `MsgKey` derives from
// the `en` table, and typing `messages` as Record<Lang, Record<MsgKey,string>>
// forces the `he` table to carry every key at compile time. Placeholders are
// `{name}` tokens interpolated by t(). Emoji and placeholders are kept verbatim
// across languages. Hebrew is written natural + RTL; do not add LTR punctuation.

const en = {
  // Bot / Telegram
  intro:
    "Hi — I'm your Gmail secretary. 📬\n\n" +
    "Every hour I'll message you about important new mail. Any time, just talk to me normally:\n" +
    '• "what\'s important?" / "anything from the bank?" — I search and summarize your inbox\n' +
    '• "dana is always important" / "I don\'t care about LinkedIn" — I learn your preferences\n' +
    '• "clean my LinkedIn junk" — I propose what to trash; you confirm, and it\'s undoable\n\n' +
    "Nothing is deleted without your OK, and I only take orders from you.",
  settings_hint: "Tap the ⚙️ Settings button at the bottom-left of the chat to open your settings.",
  safety_net:
    "Sorry — I looked but ran out of time on that one. Could you narrow it down — e.g. give me the sender's email address?",
  reconnect_nudge: "⚠️ I lost access to your Gmail{email}. Please reconnect it to keep getting briefs.",
  connect_nudge:
    "👋 Almost set — open the ⚙️ Settings menu and connect your Gmail so I can start watching your inbox.",

  // Command descriptions
  cmd_start: "What I do and how to talk to me",
  cmd_help: "Show what I can do",
  cmd_settings: "Open your settings",

  // Activity verbs (the trail of what the agent did this turn)
  verb_search: "searched",
  verb_count: "counted",
  verb_read: "read",
  verb_list_rules: "checked rules",
  verb_write_rule: "learned a rule",
  verb_delete_rule: "removed a rule",
  verb_propose: "reviewed for trash",
  verb_confirm_trash: "trashed",
  verb_undo: "undid",
  verb_archive: "archived",
  verb_trash: "trashed",
  verb_apply_rules: "applied rules",
  verb_propose_pref: "drafted a preference",
  verb_confirm_pref: "saved a preference",
  verb_restore: "restored",
  verb_recent_activity: "checked recent activity",
  verb_rescue_spam: "rescued from spam",
  verb_read_attachment: "read an attachment",

  // Poll / brief
  // Sent only after QStash has exhausted every retry, so it is a genuine dead end.
  // Says plainly that nothing was changed, because the owner's first worry after a
  // failed cleanup request is what it did before it broke.
  turn_failed: "⚠️ I couldn't finish that one — something broke on my side, and I've stopped retrying. Nothing in your mail was changed. Try asking again?",
  poll_heartbeat: "🟢 No new mail this check.",
  poll_incomplete: "⚠️ I haven't got to about {n} more emails yet — I'll pick up where I left off at the next check. Check Gmail if you don't want to wait.",
  poll_cursor_expired: "⚠️ I lost track of your mail since my last check — Gmail no longer keeps that much history. I've restarted from now, so please look through Gmail for anything that came in before this.",
  poll_trashed: "trashed {n}",
  poll_archived: "archived {n}",
  poll_left: "{n} left in inbox",
  poll_new: "📬 {n} new",
  poll_nothing_important: "nothing important",
  poll_unruled_one:
    "🆕 New sender you haven't ruled: {names}{more} — reply keep/archive/trash to teach a rule.",
  poll_unruled_many:
    "🆕 New senders you haven't ruled: {names}{more} — reply keep/archive/trash to teach a rule.",
  poll_more: " +{n} more",
  poll_fallback_head: "{n} new important email(s):",
  poll_no_subject: "(no subject)",

  // Weekly spam check
  spam_head: "🧹 Spam check (last 7 days): {total} in spam, {n} look legitimate:",
  spam_head_one: "🧹 Spam check (last 7 days): {total} in spam, 1 looks legitimate:",
  spam_none: "🧹 Spam check: {total} in spam, nothing looks legitimate.",
  spam_none_unjudged: "🧹 Spam check: {total} in spam — none of the {judged} I could judge looks legitimate; I couldn't judge {unjudged}.",
  spam_empty: "🧹 Spam check: nothing in spam from the last 7 days.",
  spam_by_rule: "you have a rule for this sender, but Gmail put it in Spam — check it's really them",
  spam_phishing: "⚠️ looks like phishing — rescue only if you're sure",
  spam_more: "+{n} more — ask me",
  spam_reply_hint: 'Reply "rescue 1 3" or "rescue all".',
  spam_capped: "There were more than {n} — I checked the newest {n}.",
  spam_incomplete: "⏱ I ran out of time before checking them all — look through Gmail's Spam folder for the rest.",
  spam_unjudged: "I couldn't judge {n} of them.",

  // A weekly report that failed WEEKLY_MAX_ATTEMPTS times this week: sent instead of it,
  // then the week is closed. Trusted text only.
  weekly_gave_up_spam: "🧹 I couldn't put together this week's spam check — please look through Spam yourself.",
  weekly_gave_up_retro: "🗓 I couldn't put together this week's review — ask me about my recent activity if you'd like to check what I trashed or archived.",

  // Weekly retrospect
  retro_head: "🗓 Week in review: trashed {trashed} · archived {archived} · rescued from spam {rescued} · undone {undone} · rules +{rules}",
  retro_rules_changed: " ({n} changed)",
  retro_top_trashed: "🗑 Most trashed: {list}",
  retro_top_archived: "📥 Most archived: {list}",
  retro_worth_look: "⚠️ Worth a look:",
  retro_item_trashed: "trashed",
  retro_item_archived: "archived",
  retro_more: "+{n} more — ask me",
  retro_reply_hint: "Reply \"restore 1\" or \"restore all\".",
  retro_nothing_wrong: "✅ Second look: nothing looks wrong.",
  retro_partly_checked: "🔎 Second look: none of the {judged} I could re-check looks wrong — I couldn't re-check {unjudged}.",
  retro_ops_head: "🛠 Ops:",
  retro_ops_incomplete: "{n}× a catch-up didn't finish in one run — the next check carried on",
  retro_ops_cursor: "{n}× Gmail history expired — I restarted from that point",
  retro_ops_reconnect: "{n}× Gmail needed reconnecting",
  retro_ops_errored: "{n}× an hourly check failed",
  retro_ops_worker: "{n}× a chat reply failed",
  retro_ops_weekly: "{n}× a weekly report failed — I retried at the next check",
  retro_unjudged: "couldn't re-check {n}",
  retro_not_checked: "+{n} not re-checked",
  retro_gone: "{n} already deleted for good",
  retro_legacy: "{n} older entries can't be re-checked",
  retro_incomplete: "ran out of time — re-checked only part of the week",

  // Action labels (settings view)
  action_guarded_trash: "guarded trash",
  action_guarded_archive: "guarded archive",
  action_keep: "keep",

  // Mini-app
  mini_loading: "Loading…",
  mini_load_error: "Couldn't load settings. Open this from the bot's menu button.",
  mini_saving: "Saving…",
  mini_saved: "Saved ✓",
  mini_save_failed: "Save failed",
  mini_reconnect_failed: "Reconnect failed",
  mini_clear_confirm: "Clear the conversation history? This wipes chat history only; your rules and settings stay.",
  mini_clearing: "Clearing…",
  mini_clear_failed: "Clear failed",
  mini_cleared: "Conversation cleared ✓",
  mini_settings: "Settings",
  mini_timezone: "Timezone",
  mini_language: "Language",
  mini_digest_window: "Active hours",
  mini_pause: "Pause briefs",
  mini_active_days: "Active days",
  mini_day_0: "Sun", mini_day_1: "Mon", mini_day_2: "Tue", mini_day_3: "Wed",
  mini_day_4: "Thu", mini_day_5: "Fri", mini_day_6: "Sat",
  mini_gmail: "Gmail",
  mini_needs_reconnect: "⚠️ needs reconnect",
  mini_connected: "✅ connected",
  mini_not_connected: "not connected",
  mini_reconnect: "Reconnect",
  mini_learned_rules: "Learned rules",
  mini_none_yet: "None yet.",
  mini_context: "Context",
  mini_context_desc: "Estimated size of what the bot remembers for your next message.",
  mini_total: "Total",
  mini_system_rules: "System + rules",
  mini_summary: "Summary",
  mini_recent_turns: "Recent turns",
  mini_clear_conversation: "Clear conversation",
  mini_clear_conversation_desc: "Wipes chat history only — rules and settings are kept.",
  mini_tokens: "tokens",
  mini_context_note: "Rough estimate (excludes tool definitions). Older turns fold into the summary once the recent turns pass ~{n} tokens.",
  mini_provision_title: "Add a user",
  mini_provision_desc: "Creates a Google consent link to send them — they connect their own Gmail (valid 60 min).",
  mini_provision_tgid: "Telegram user ID",
  mini_provision_create: "Create consent link",
  mini_provision_creating: "Creating…",
  mini_provision_created: "✅ Created — send them this link:",
  mini_provision_copy: "Copy link",
  mini_provision_copied: "Copied ✓",
  mini_provision_bad_id: "Telegram user ID must be a whole number.",
  mini_provision_failed: "Couldn't create the link",
  oauth_connected: "✅ Connected {email} — opening the bot…",
  oauth_connected_manual: "✅ Connected {email}. Open Telegram and return to the bot.",
  oauth_open_bot: "Open the bot",
  oauth_expired: "⏳ This connect link has expired. Ask the owner to send you a new one.",
  oauth_failed: "⚠️ Couldn't connect your Gmail. Ask the owner for a new link.",
} as const;

export type MsgKey = keyof typeof en;

export const messages: Record<"en" | "he", Record<MsgKey, string>> = {
  en,
  he: {
    // Bot / Telegram
    intro:
      "היי — אני המזכיר/ה של הג'ימייל שלך. 📬\n\n" +
      "כל שעה אשלח לך עדכון על מיילים חדשים וחשובים. בכל רגע פשוט דבר/י איתי רגיל:\n" +
      "• \"מה חשוב?\" / \"יש משהו מהבנק?\" — אחפש ואסכם לך את תיבת הדואר\n" +
      "• \"דנה תמיד חשובה\" / \"לא מעניין אותי לינקדאין\" — אלמד את ההעדפות שלך\n" +
      "• \"תנקה לי את הזבל מלינקדאין\" — אציע מה לזרוק; את/ה מאשר/ת, והכול הפיך\n\n" +
      "שום דבר לא נמחק בלי האישור שלך, ואני מקבל/ת פקודות רק ממך.",
    settings_hint: "הקש/י על כפתור ⚙️ ההגדרות בפינה השמאלית-תחתונה של הצ'אט כדי לפתוח את ההגדרות שלך.",
    safety_net:
      "מצטער/ת — חיפשתי אבל נגמר לי הזמן על זה. אפשר לצמצם קצת — למשל לתת לי את כתובת המייל של השולח?",
    reconnect_nudge: "⚠️ איבדתי את הגישה לג'ימייל שלך{email}. חבר/י אותו מחדש כדי להמשיך לקבל עדכונים.",
    connect_nudge:
      "👋 כמעט מוכן — פתח/י את תפריט ⚙️ ההגדרות וחבר/י את הג'ימייל שלך כדי שאתחיל לעקוב אחרי תיבת הדואר.",

    // Command descriptions
    cmd_start: "מה אני עושה ואיך לדבר איתי",
    cmd_help: "הצג/י מה אני יכול/ה לעשות",
    cmd_settings: "פתח/י את ההגדרות שלך",

    // Activity verbs
    verb_search: "חיפשתי",
    verb_count: "ספרתי",
    verb_read: "קראתי",
    verb_list_rules: "בדקתי כללים",
    verb_write_rule: "למדתי כלל",
    verb_delete_rule: "הסרתי כלל",
    verb_propose: "בחנתי לזריקה",
    verb_confirm_trash: "זרקתי",
    verb_undo: "ביטלתי",
    verb_archive: "ארכבתי",
    verb_trash: "זרקתי",
    verb_apply_rules: "החלתי כללים",
    verb_propose_pref: "ניסחתי העדפה",
    verb_confirm_pref: "שמרתי העדפה",
    verb_restore: "שחזרתי",
    verb_recent_activity: "בדקתי פעילות אחרונה",
    verb_rescue_spam: "חילצתי מהספאם",
    verb_read_attachment: "קראתי קובץ מצורף",

    // Poll / brief
    turn_failed: "⚠️ לא הצלחתי לסיים את זה — משהו נשבר אצלי, והפסקתי לנסות שוב. שום דבר בדואר שלך לא השתנה. רוצה לשאול שוב?",
    poll_heartbeat: "🟢 אין דואר חדש בבדיקה הזו.",
    poll_incomplete: "⚠️ עוד לא הגעתי לכ־{n} מיילים נוספים — אמשיך מאיפה שעצרתי בבדיקה הבאה. אפשר לבדוק ישירות ב־Gmail אם לא רוצים לחכות.",
    poll_cursor_expired: "⚠️ איבדתי מעקב אחרי הדואר מאז הבדיקה האחרונה — Gmail כבר לא שומר היסטוריה כל כך ארוכה. התחלתי מחדש מעכשיו, אז כדאי לעבור ב־Gmail על מה שהגיע לפני כן.",
    poll_trashed: "נזרקו {n}",
    poll_archived: "אורכבו {n}",
    poll_left: "{n} נשארו בתיבה",
    poll_new: "📬 {n} חדשים",
    poll_nothing_important: "שום דבר חשוב",
    poll_unruled_one:
      "🆕 שולח חדש שעוד לא הגדרת לו כלל: {names}{more} — השב/י keep/archive/trash כדי ללמד כלל.",
    poll_unruled_many:
      "🆕 שולחים חדשים שעוד לא הגדרת להם כלל: {names}{more} — השב/י keep/archive/trash כדי ללמד כלל.",
    poll_more: " ועוד {n}",
    poll_fallback_head: "{n} מיילים חדשים וחשובים:",
    poll_no_subject: "(ללא נושא)",

    // Weekly spam check
    spam_head: "🧹 בדיקת ספאם (7 הימים האחרונים): {total} בספאם, {n} נראים לגיטימיים:",
    spam_head_one: "🧹 בדיקת ספאם (7 הימים האחרונים): {total} בספאם, אחד נראה לגיטימי:",
    spam_none: "🧹 בדיקת ספאם: {total} בספאם, שום דבר לא נראה לגיטימי.",
    spam_none_unjudged: "🧹 בדיקת ספאם: {total} בספאם — אף אחד מ־{judged} שהצלחתי לשפוט לא נראה לגיטימי; לא הצלחתי לשפוט {unjudged}.",
    spam_empty: "🧹 בדיקת ספאם: אין כלום בספאם מ־7 הימים האחרונים.",
    spam_by_rule: "יש לך כלל לשולח הזה, אבל Gmail שם אותו בספאם — כדאי לוודא שזה באמת השולח",
    spam_phishing: "⚠️ נראה כמו פישינג — לחלץ רק אם את/ה בטוח/ה",
    spam_more: "ועוד {n} — אפשר לשאול אותי",
    spam_reply_hint: "השב/י \"חלץ 1 3\" או \"חלץ הכול\".",
    spam_capped: "היו יותר מ־{n} — בדקתי את {n} החדשים ביותר.",
    spam_incomplete: "⏱ נגמר לי הזמן לפני שבדקתי את כולם — כדאי לעבור על השאר בתיקיית הספאם ב־Gmail.",
    spam_unjudged: "לא הצלחתי לשפוט {n} מהם.",

    // Weekly report given up on
    weekly_gave_up_spam: "🧹 לא הצלחתי להכין את בדיקת הספאם של השבוע — כדאי לעבור על תיקיית הספאם בעצמך.",
    weekly_gave_up_retro: "🗓 לא הצלחתי להכין את סיכום השבוע — אפשר לשאול אותי על הפעילות האחרונה שלי כדי לבדוק מה זרקתי או ארכבתי.",

    // Weekly retrospect
    retro_head: "🗓 סיכום השבוע: נזרקו {trashed} · אורכבו {archived} · חולצו מספאם {rescued} · בוטלו {undone} · כללים +{rules}",
    retro_rules_changed: " ({n} שונו)",
    retro_top_trashed: "🗑 נזרקו הכי הרבה: {list}",
    retro_top_archived: "📥 אורכבו הכי הרבה: {list}",
    retro_worth_look: "⚠️ שווה מבט:",
    retro_item_trashed: "נזרק",
    retro_item_archived: "אורכב",
    retro_more: "ועוד {n} — אפשר לשאול אותי",
    retro_reply_hint: "השב/י \"restore 1\" או \"restore all\" כדי להחזיר לתיבה.",
    retro_nothing_wrong: "✅ מבט שני: שום דבר לא נראה שגוי.",
    retro_partly_checked: "🔎 מבט שני: אף אחד מ־{judged} שהצלחתי לבדוק שוב לא נראה שגוי — לא הצלחתי לבדוק שוב {unjudged}.",
    retro_ops_head: "🛠 תפעול:",
    retro_ops_incomplete: "{n}× השלמה לא הסתיימה בריצה אחת — הבדיקה הבאה המשיכה",
    retro_ops_cursor: "{n}× היסטוריית Gmail פגה — התחלתי מחדש מאותה נקודה",
    retro_ops_reconnect: "{n}× היה צריך לחבר מחדש את Gmail",
    retro_ops_errored: "{n}× בדיקה שעתית נכשלה",
    retro_ops_worker: "{n}× תשובה בצ׳אט נכשלה",
    retro_ops_weekly: "{n}× דוח שבועי נכשל — ניסיתי שוב בבדיקה הבאה",
    retro_unjudged: "לא הצלחתי לבדוק שוב {n}",
    retro_not_checked: "עוד {n} לא נבדקו שוב",
    retro_gone: "{n} כבר נמחקו לצמיתות",
    retro_legacy: "{n} רשומות ישנות שאי אפשר לבדוק שוב",
    retro_incomplete: "נגמר הזמן — בדקתי שוב רק חלק מהשבוע",

    // Action labels
    action_guarded_trash: "זריקה עם בקרה",
    action_guarded_archive: "ארכוב עם בקרה",
    action_keep: "שמירה",

    // Mini-app
    mini_loading: "טוען…",
    mini_load_error: "לא ניתן לטעון את ההגדרות. פתח/י את זה מכפתור התפריט של הבוט.",
    mini_saving: "שומר…",
    mini_saved: "נשמר ✓",
    mini_save_failed: "השמירה נכשלה",
    mini_reconnect_failed: "החיבור מחדש נכשל",
    mini_clear_confirm: "לנקות את היסטוריית השיחה? זה מוחק רק את היסטוריית הצ'אט; הכללים וההגדרות נשארים.",
    mini_clearing: "מנקה…",
    mini_clear_failed: "הניקוי נכשל",
    mini_cleared: "השיחה נוקתה ✓",
    mini_settings: "הגדרות",
    mini_timezone: "אזור זמן",
    mini_language: "שפה",
    mini_digest_window: "שעות פעילות",
    mini_pause: "השהיית עדכונים",
    mini_active_days: "ימי פעילות",
    mini_day_0: "א׳", mini_day_1: "ב׳", mini_day_2: "ג׳", mini_day_3: "ד׳",
    mini_day_4: "ה׳", mini_day_5: "ו׳", mini_day_6: "ש׳",
    mini_gmail: "ג'ימייל",
    mini_needs_reconnect: "⚠️ דורש חיבור מחדש",
    mini_connected: "✅ מחובר",
    mini_not_connected: "לא מחובר",
    mini_reconnect: "חבר/י מחדש",
    mini_learned_rules: "כללים שנלמדו",
    mini_none_yet: "אין עדיין.",
    mini_context: "הקשר",
    mini_context_desc: "הערכת הגודל של מה שהבוט זוכר עבור ההודעה הבאה שלך.",
    mini_total: "סה\"כ",
    mini_system_rules: "מערכת + כללים",
    mini_summary: "סיכום",
    mini_recent_turns: "תורות אחרונים",
    mini_clear_conversation: "נקה שיחה",
    mini_clear_conversation_desc: "מוחק רק את היסטוריית הצ'אט — הכללים וההגדרות נשמרים.",
    mini_tokens: "טוקנים",
    mini_context_note: "הערכה גסה (לא כולל הגדרות כלים). תורות ישנים מתקפלים לתוך הסיכום כשהתורות האחרונים עוברים ~{n} טוקנים.",
    mini_provision_title: "הוספת משתמש",
    mini_provision_desc: "יוצר קישור אישור של גוגל לשליחה אליהם — הם מחברים את הג'ימייל שלהם (תקף 60 דקות).",
    mini_provision_tgid: "מזהה משתמש טלגרם",
    mini_provision_create: "צור קישור אישור",
    mini_provision_creating: "יוצר…",
    mini_provision_created: "✅ נוצר — שלח/י להם את הקישור:",
    mini_provision_copy: "העתק קישור",
    mini_provision_copied: "הועתק ✓",
    mini_provision_bad_id: "מזהה משתמש טלגרם חייב להיות מספר שלם.",
    mini_provision_failed: "לא ניתן ליצור את הקישור",
    oauth_connected: "✅ חובר {email} — פותח את הבוט…",
    oauth_connected_manual: "✅ חובר {email}. פתח/י את טלגרם וחזור/חזרי לבוט.",
    oauth_open_bot: "פתח/י את הבוט",
    oauth_expired: "⏳ קישור החיבור פג. בקש/י מהבעלים לשלוח קישור חדש.",
    oauth_failed: "⚠️ לא ניתן לחבר את הג'ימייל. בקש/י מהבעלים קישור חדש.",
  },
};
