// src/i18n/messages.ts — hand-rolled en/he message tables. `MsgKey` derives from
// the `en` table, and typing `messages` as Record<Lang, Record<MsgKey,string>>
// forces the `he` table to carry every key at compile time. Placeholders are
// `{name}` tokens interpolated by t(). Emoji and placeholders are kept verbatim
// across languages. Hebrew is written natural + RTL; do not add LTR punctuation.

const en = {
  // Bot / Telegram
  intro:
    "Hi — I'm your Gmail secretary. 📬\n\n" +
    "Every ~30 min I'll message you about important new mail. Any time, just talk to me normally:\n" +
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

  // Poll / brief
  poll_heartbeat: "🟢 No new mail this check.",
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
  mini_digest_window: "Digest window",
  mini_pause: "Pause briefs",
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
} as const;

export type MsgKey = keyof typeof en;

export const messages: Record<"en" | "he", Record<MsgKey, string>> = {
  en,
  he: {
    // Bot / Telegram
    intro:
      "היי — אני המזכיר/ה של הג'ימייל שלך. 📬\n\n" +
      "כל ~30 דקות אשלח לך עדכון על מיילים חדשים וחשובים. בכל רגע פשוט דבר/י איתי רגיל:\n" +
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

    // Poll / brief
    poll_heartbeat: "🟢 אין דואר חדש בבדיקה הזו.",
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
    mini_digest_window: "חלון עדכונים",
    mini_pause: "השהיית עדכונים",
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
  },
};
