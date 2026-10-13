# Class Entry Monitor – setup guide

Two parts:
- **backend/** – Google Apps Script bound to a Google Sheet (stores the data, serves the timetable)
- **app/** – the installable phone app (static files you host on GitHub Pages)

## 1. Backend (about 10 minutes)

1. Create a new Google Sheet, name it **Class Entry Monitor**.
2. **Extensions → Apps Script.** Delete the default code and paste all of `backend/Code.gs`.
3. In Apps Script: **Project Settings → tick "Show appsscript.json"**, then open `appsscript.json` and replace its content with `backend/appsscript.json` (sets time zone Africa/Lagos and public web-app access).
4. Select the function **setup** and click **Run**. Approve the permissions. This creates the sheets: Config, Users, Classes, Periods, Teachers, Subjects, Timetable, Log.
5. *(Optional, for testing)* run **seedDemo** to fill in made-up teachers and a full timetable. Before going live run **clearDemoData** (it also empties Log).
6. Fill in your real data:
   - **Users** – the monitor's PIN is generated for you (change it if you like; keep it 6 digits or more). Role must be `Monitor` or `Admin`. Set Active to FALSE to disable someone.
   - **Periods** – the bell times are PLACEHOLDERS. Put the real start/end times (HH:MM, 24-hour). The app uses them to pick the current period. If Friday has different bell times, add rows with `Fri` in the optional **Day** column; those replace the all-days rows on that day. Days with no lessons in the Timetable (e.g. Saturday, Sunday) show "No school today".
   - **Teachers** (Code, Name, Phone), **Terms** (Name, Start, End as yyyy-mm-dd), **Subjects**, **Timetable** (Day = Mon–Fri, Period 1–8, Class, Subject, TeacherCode). The Timetable columns have dropdowns.
7. **Deploy → New deployment → type: Web app.** Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the URL ending in `/exec`.

## 2. Host the app (GitHub Pages)

1. Open `app/config.js` and paste the `/exec` URL between the quotes.
2. Create a GitHub repository, upload everything inside `app/` to the repository root, then **Settings → Pages → Deploy from branch → main / root**.
3. After a minute the app is live at `https://<your-username>.github.io/<repo-name>/`.

## 3. Install on the monitor's phone

1. Open the link in a browser with data on (Android: **Chrome**, not inside WhatsApp's browser; iPhone/iPad: **Safari**).
2. Sign in with his PIN. The timetable downloads to the phone.
3. **Android Chrome:** menu **⋮ → Install app** (or tap **Install app** in the app's Sync panel). **iOS Safari:** Share → **Add to Home Screen** → **Add**. **Desktop Chrome or Edge:** use the install icon in the address bar.
4. Test: turn on airplane mode, open the app from the home screen, mark a few classes, turn data back on and tap the sync badge → **Sync now**. The rows should appear in the **Log** sheet.

## How he uses it

- Opens the app at the bell. The current period is selected automatically (tap P1–P8 to change).
- To enter or correct a recent day, use **Entry date** above the periods and choose today or one of the previous 7 days. The app asks you to confirm before opening a past date and keeps a correction warning visible while you work. Check both the date and period before changing a mark; past-day edits sync like other entries.
- Per class: **✓** on time, **Late** (then minutes), **A** absent (opens an optional reason field; Save records it, Cancel leaves the class unchanged), **X** no lesson. Tapping another button changes the mark.
- **cover** under a class = a different teacher is taking the lesson (recorded as a cover, not an absence).
- **Unmarked only** (second round) hides classes already marked. A red outline means the period ended with the class still unmarked.
- **Today** tab shows totals and per-period progress.
- Entries sync automatically when there is signal. The top-right badge shows how many are waiting. **Share backup** sends the day's entries as a CSV (e.g. to WhatsApp) if syncing keeps failing.

## Changing the timetable later

Edit the Teachers / Subjects / Timetable sheets. The monitor's phone picks up the change next time the app is opened with internet (it shows "Timetable updated"). Old Log rows keep the teacher recorded at the time.

## Updating the app files later

Upload the new files to GitHub, and increment the `CACHE` value in `app/sw.js` (for example, `class-entry-v11` to `class-entry-v12`) whenever a file in its `SHELL` list changes.

## The Log sheet (before v7; entries now go to Drive, see "Records in Drive" below)

One row per class per period: Key, Date, Day, Period, Class, Subject, Teacher (scheduled), Cover, Status (OT / LATE / ABS / NONE), MinsLate, RecordedBy, RecordedAt, SyncedAt, Device. Current Drive log tabs also append TeacherName, CoverName, HeldMins, HeldIn, and Note. Existing weekly tab headers are not rewritten when columns are added. Time lost = minutes late + the length of the period for each absence (taken from the Periods sheet). When an entry is corrected, the old version is kept in the **Corrections** tab. A row with a Cover teacher should be counted against the cover, not the scheduled teacher.

## Security notes

- The endpoint is public, so access depends on the PIN. After 10 wrong attempts for the same PIN within 10 minutes, that PIN is locked for 10 minutes. A separate higher shared ceiling limits excessive failed attempts across all PINs.
- PINs are stored as plain text in the Users sheet – keep that sheet's sharing restricted. The monitor's PIN is also stored on his phone so it can sync.
- Entries older than 7 days or dated in the future are rejected.

## Updating from the previous version

1. Replace `Code.gs` in Apps Script. Run **setup** again (safe: it keeps your data and only adds the new columns/sheet).
2. **Deploy → Manage deployments → pencil icon → Version: New version → Deploy.** The URL stays the same.
3. Upload everything in `app/` to GitHub, **including the new `manifest.webmanifest` and three `icon-*.png` files** (the old version needed them but they were missing). `sw.js` is already at `class-entry-v2`.
4. Use the sheet menu **Class Entry → Check timetable** to find a class with two lessons in one slot or a teacher in two classes at once.

## What changed in this version

- Missing manifest/icons added; one missing file can no longer stop the service worker installing.
- Rejected entries are no longer retried forever. The badge shows "⚠ n rejected"; the Sync panel can retry or discard them.
- A PIN the server refuses is not resent until the monitor signs in again (tap the red badge), so a changed PIN cannot lock everyone out.
- A banner warns when the phone's date/time differs from the server's.
- Per-day bell times, "No school today", period-based time lost, teacher names in the Log, LogHistory, timetable check, old synced entries pruned after 30 days, sticky header/tabs fixed, and entries keep the name of whoever recorded them even if someone else signs in afterwards.


## Phones, logo, terms and reports (this version)

- **Logo:** save the school logo as `logo.png` in the app root (square or landscape, under about 100 KB). It shows on the login page and at the top of every PDF report. The file included now is a placeholder.
- **School name:** shown in the app header and on reports. Change it in **Admin → School name**. New installs start as "Prototype shown to Badala Academy".
- **Teacher phone numbers:** **Admin → Teachers** has a Phone field. The number shows beside the teacher's name on the Entry and Today screens; tapping it opens the phone's dialer with the number loaded.
- **Today tab:** tap Lessons observed, On time, Late, Absent, Cover lessons or Time lost to see the list (period, class, teacher, minutes late, phone).
- **Terms:** **Admin → Terms** (name, first day, last day). Needed for term reports.
- **Reports tab (Admin only):** choose Day, Week, Month or Term, then use ‹ › to move. Sub-tabs show Teachers, Classes, Periods and Trend; tap a teacher for their incidents and phone number; tap a total box for the list. **Export** gives a formatted PDF or CSV files (by teacher, class, period, day, week, and one row per incident). Reports read the whole Log, so they accumulate automatically as phones sync. They need an internet connection.
- **PDF libraries:** download the two files named in `lib/README.txt` into `app/lib/` (the PDF needs them; CSV works without).
- **Colour thresholds:** green at 95% on time or above, amber from 85%. To change, add `GoodPct` and `WarnPct` rows in the Config sheet.
- **Testing reports:** run **seedDemo**, then **seedDemoLog** (or the sheet menu Class Entry → Add demo Log data) to fill about three weeks of made-up records. Clear them with Admin → Reset data → Clear all recorded entries before going live.

## Sections, school days and overlaps (v5)

- **School days** are Saturday to Wednesday by default. Change them in **Admin → School name & days**. Report weeks start on the first school day after a non-school day (Saturday for Sat–Wed).
- **Sections** (Secondary, Primary, Nursery) are managed in **Admin → Sections**. Each class belongs to a section (**Admin → Classes**) and each section has its own bell times (**Admin → Bell times**, pick the section at the top). Up to 10 periods.
- **Starter bell times** (setup loads them on a new sheet; on an existing sheet use the sheet menu **Class Entry → Load standard bell times**):
  - Secondary: P1 07:45; periods 40 min except P7 35 and P8 30; long break 30 min after P3; short break 10 min after P6.
  - Primary and Nursery: start 08:00; 30-minute periods; long break 30 min after **P3** (please confirm); short break 10 min after P7. Nursery closes at the short break (7 periods). Primary has 9 periods: Primary 1–3 close one period after the short break (leave P9 empty in their timetable), Primary 4–6 close two periods after.
- **Monitor screen:** opens on a section picker showing the current period and how many classes are marked. The section name at the top (⇄) switches back. Each section uses its own bell times, "unmarked" warnings and Today totals. Classes with no lesson in the current period are hidden.
- **Overlaps between sections:** when a teacher's lesson in one section is still running when his next lesson in another section starts, the monitor's card shows "may be held in Primary 5 until 11:00"; the Admin timetable shows a warning (with the number of minutes of overlap); the sheet menu **Class Entry → Check timetable** lists them all. In reports, a late arrival that is no longer than the overlap (plus 5 minutes) is **excused**: counted on time, shown in its own list ("Held in another section"). To count such lateness normally, add a Config row `OverlapExcuse` with value `no`.
- **Reports** can be filtered by section (or All sections) and exported as PDF or CSV.

## Updating to this version

1. Replace `Code.gs` in Apps Script and run **setup** (adds the Sections sheet and the Section columns; keeps your data). Existing classes and bell times count as the first section (Secondary). Then use **Class Entry → Load standard bell times**, and add the Nursery/Primary classes in the app (Admin → Classes). setup adds placeholder class names only on a brand-new sheet.
2. **Deploy → Manage deployments → pencil → Version: New version → Deploy.**
3. Upload everything in `app/` to GitHub (`sw.js` is now `class-entry-v5`), keeping your own `config.js` and the `lib/` PDF libraries.
4. Thursday and Friday lessons from the old Mon–Fri timetable are ignored under the new school days.

## Going live checklist (v6)

1. Replace `Code.gs`, run **setup**, then **Deploy → Manage deployments → New version**. The school name becomes "Badala Academy, Azare" if it was still the prototype placeholder (you can also set it in Admin → School name & days).
2. Upload `app/` to GitHub (new `logo.png` is the Badala Academy crest; `sw.js` is `class-entry-v6`). Make sure `lib/` has the two PDF libraries, and keep your own `config.js`.
3. In the app (as Admin): **Admin → Reset data** to clear any test timetable and entries; enter the real classes, teachers (with phone numbers), subjects, bell times and timetable; set terms; then **change the PINs** (give the monitor his own, keep the Admin PIN private).
4. Sheet menu **Class Entry → Check timetable** to list overlaps and clashes before the first school day.
5. Open the app once on the monitor's phone with internet so everything (including the PDF libraries) is saved for offline use.

## Today's PDF

The monitor taps the sync badge → **Download today's PDF** (or the button at the bottom of the Today tab). The report covers all sections for today and is built on the phone from the entries recorded there, so it works offline once the app has been opened online. It is saved to the phone's Downloads as `ClassEntry_Daily_<date>.pdf`.

Periods show as 1st, 2nd, 3rd … on the monitor's screens and as "1st period", "2nd period" … in reports.

## Records in Drive (v7)

- **Where entries are kept:** one Drive folder for the school ("<School> – Class Entry Records"), one sub-folder per school year ("2026-2027"), one spreadsheet per term ("<School> – Class Entry – 2026-2027 – First Term"), and one tab per week ("Week 05 · 10–16 Oct"). A **Corrections** tab in each term file keeps the older version of any corrected entry. The settings (users, teachers, classes, timetable, bell times, terms) stay in the original spreadsheet.
- **Automatic:** the first entry of a new term or week creates the spreadsheet or tab. A new school year starts a new folder. Nothing to do except add the new terms in **Admin → Terms**.
- **Week numbers** count from the term's start date, so enter Term 1 as starting **Saturday 12 Sep 2026** (then 10–16 Oct is Week 5). Entries dated outside every term go to the nearest term; with no terms entered they go to a file called "Term dates not set".
- **Locking:** a week's tab is protected once its correction window (7 days after the week ends) has closed.
- **Reports** read only the weeks they need. **Admin → Reports → Week** has *This week*, *Last week* and a list of the term's weeks for printing any earlier week.
- **Admin → Saved records** lists the term spreadsheets with links.
- **Ownership:** the files belong to the Google account that owns this script. Use the school's own account.
- **Report footer:** edit the footer and the "Generated by" line in **Admin → School name & days**.

## Updating to v7 (do these in order)

1. Replace `Code.gs`. Run **setup** from the editor and **approve the new permissions** (Google Drive). setup creates the Drive folder, moves entries already in the Log sheet into the term spreadsheets (the old sheet is hidden and renamed "Log (moved ...)"), and is safe to repeat.
2. **Deploy → Manage deployments → pencil → New version → Deploy.**
3. In **Admin → Terms**, enter the terms (Term 1 start Saturday 12 Sep 2026).
4. Upload `app/` to GitHub, including the new `logo.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `manifest.webmanifest`, and your `config.js` and `lib/`. `sw.js` is `class-entry-v7`.
5. On the monitor's phone: remove the old home-screen icon, open the link in Chrome with internet, and install again so the Badala crest icon and loading screen are used.

## What is new in v8

- **Monitors can open Reports** (read-only, same screens and exports as the Admin). The Admin tab is still Admin only.
- **Clashes tab** (Monitors and Admins): lists teachers whose lessons overlap or fall at the same time, including across sections, grouped by teacher with the minutes of overlap and a tap-to-call link; and a second list of late arrivals that an overlap caused in the last 4 weeks (excused or counted). It refreshes when opened and keeps the last list for offline.
- **Freeze a monitor:** Admin → Users & PINs → tick **Frozen** for a Monitor. The monitor can still sign in and view reports, but entries recorded after the freeze are refused ("frozen") and the app shows a red banner and blocks the buttons. Entries recorded before the freeze are kept. Untick to resume. The phone learns about it within a few minutes of being online (or straight away at the next sync).
- **Many users at once:** all writes go through one short queue; if the system is busy the phone retries automatically after a few seconds, and nothing is lost. Settings and the user list are cached for 2 minutes (cleared when an Admin saves), so many phones opening the app together are fast.
- **Data integrity:** every entry is checked before it is saved (real class, a period that exists for that section, a school day, a known teacher, sensible minutes, a date in the correction window); the person recorded is always the signed-in user; the same entry is never saved twice; a correction keeps the older version; old weeks are locked.
- **Checks and backup (sheet menu "Class Entry"):** *Check data integrity* scans every weekly tab; *Turn on daily backup* copies the settings and the current term spreadsheet every night into a Backups folder in Drive (30 days kept). setup turns the backup on for you.

### Updating to v8
1. Replace `Code.gs`, run **setup** and approve any new permission (it now also asks to run a nightly trigger). Deploy a **New version**.
2. Upload `app/` to GitHub including the new `clashes.js` (the current service-worker cache is `class-entry-v11`). Keep your `config.js` and `lib/`.
3. Monitors: open the app with internet once so the new version loads.

## First-time use on iOS

1. Open the live app URL in **Safari** and sign in while connected to the internet.
2. Tap **Share → Add to Home Screen → Add**.
3. Open the Badala Class Entry Monitor icon from the Home Screen. If the install option is missing, reload the app once and open the Share menu again.

The in-app **How to install on this phone** link also shows the Android Chrome and desktop Chrome/Edge steps.

## Current V8 behaviour notes

- The A (absent) action asks for an optional reason of up to 120 characters. Cancel does not save an entry.
- Late-entry overlap decisions are saved with the entry so later timetable edits do not change how that historical event is reported.
- A successful sync checks the phone clock against the server; quota-limit responses are shown separately from ordinary network errors.
- Spreadsheet log rows include the appended `HeldMins`, `HeldIn`, and `Note` values. Older week-tab headers are not rewritten.
- Admin can enable the weekly digest from the sheet menu, review/revoke synced devices, and manage locally queued offline edits.
- The weekly digest sends aggregate counts and the most affected teachers/classes only; it does not include absence notes or individual entry details. Email content is escaped, the recipient is validated before sending, and only a valid HTTPS app link is included.
- Run `npm test` to exercise the weekly digest email-safety checks, and `npm run lint` for the client scripts.
- The Operations Manual Word document was not included in this workspace; these install and marking notes are recorded here instead.
- Increment the service-worker cache name on every release that changes a shell asset so installed copies fetch the update.
